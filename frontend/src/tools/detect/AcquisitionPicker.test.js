// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import AcquisitionPicker from './AcquisitionPicker.svelte';

const passes = [
  { date: '2026-05-11', cloud: 3, granules: 2, coverage: 1 },
  { date: '2026-05-08', cloud: 41, granules: 1, coverage: 0.62 },
];

function render(props = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  const live = mount(AcquisitionPicker, {
    target,
    props: {
      list: passes, days: 30, searched: true, areas: 1,
      ondays: () => {}, onlook: () => {}, onpick: () => {}, ...props,
    },
  });
  flushSync();
  return { target, done: () => { unmount(live); target.remove(); } };
}

const rows = (target) => [...target.querySelectorAll('li')];
const button = (target, name) =>
  [...target.querySelectorAll('button')].find((node) => node.textContent.trim() === name);

describe('the acquisition picker', () => {
  it('lists what exists rather than every day on the calendar', () => {
    const { target, done } = render();
    expect(rows(target)).toHaveLength(2);
    expect(target.querySelector('input[type="date"]')).toBe(null);
    done();
  });

  it('shows how much of the areas each pass reaches, beside its cloud', () => {
    const { target, done } = render();
    expect(rows(target)[0].textContent).toContain('Full cover');
    expect(rows(target)[0].textContent).toContain('3% cloud');
    // the fact a crosshair lookup cannot give, and a sweep cannot do without
    expect(rows(target)[1].textContent).toContain('62% of the areas');
    done();
  });

  it('asks for an area before it asks Copernicus anything', () => {
    const onlook = vi.fn();
    const { target, done } = render({ areas: 0, list: [], searched: false });
    expect(target.textContent).toContain('Draw an area in step 1');
    expect(button(target, 'Find passes').disabled).toBe(true);
    done();
  });

  it('does not reach the network until it is asked to', () => {
    const onlook = vi.fn();
    const { target, done } = render({ list: [], searched: false, onlook });
    // local-first: mounting the panel must never spend a request
    expect(onlook).not.toHaveBeenCalled();
    expect(target.textContent).toContain('billed as one Copernicus request');
    button(target, 'Find passes').click();
    expect(onlook).toHaveBeenCalledOnce();
    done();
  });

  it('hands a chosen pass back for the slot it was chosen for', () => {
    const onpick = vi.fn();
    const { target, done } = render({ onpick });
    button(target, 'A').click();
    expect(onpick).toHaveBeenCalledWith('a', passes[0]);
    done();
  });

  it('offers one slot for a method that reads a single image', () => {
    const { target, done } = render({ single: true });
    expect(button(target, 'A')).toBeUndefined();
    expect(button(target, 'Use')).toBeDefined();
    done();
  });

  it('hides the compare slot when a rule will resolve it at run time', () => {
    const { target, done } = render({ wantsCompare: false });
    expect(button(target, 'B')).toBeUndefined();
    expect(button(target, 'A')).toBeDefined();
    done();
  });

  it('says when the catalogue stopped short instead of implying a full list', () => {
    const { target, done } = render({ truncated: true });
    expect(target.textContent).toContain('stopped at 100 passes');
    done();
  });

  it('suggests a longer window when nothing reaches the areas', () => {
    const { target, done } = render({ list: [] });
    expect(target.textContent).toContain('No pass reaches these areas');
    done();
  });

  it('lists radar passes by time and direction, and holds a pair to one track', () => {
    const radar = [
      { date: '2026-05-14', time: '17:33:02', orbit: 'ascending', cloud: null, coverage: 1 },
      { date: '2026-05-14', time: '05:42:10', orbit: 'descending', cloud: null, coverage: 1 },
    ];
    const { target, done } = render({ list: radar, radar: true, a: { date: '2026-05-02', time: '05:42:40' } });
    expect(rows(target)).toHaveLength(2);
    expect(rows(target)[1].textContent).toContain('05:42 UTC ↓');
    expect(target.textContent).not.toContain('cloud');
    // the evening pass is another track than A's: it cannot be its pair
    const [evening, morning] = rows(target).map((row) => [...row.querySelectorAll('button')].at(-1));
    expect(evening.disabled).toBe(true);
    expect(morning.disabled).toBe(false);
    done();
  });
});
