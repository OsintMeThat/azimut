// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PlateSteps from './PlateSteps.svelte';

let held = null;
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; });

function show(props = {}) {
  const calls = { onpick: vi.fn(), onadd: vi.fn(), onremove: vi.fn(), onmove: vi.fn(), onchange: vi.fn() };
  held = mount(PlateSteps, { target: document.body, props: {
    steps: [{ id: 's1', name: 'Strike', duration: 3 }, { id: 's2', name: '', duration: 4.5 }],
    current: 's1', dayLabel: '15 Oct 2026', caseId: 'c1',
    elements: [{ id: 'v', kind: 'video', step: 's1', src: 'media/strike.mp4', clip: [12, 20.5], box: [0, 0, 10, 10] },
      { id: 'n', kind: 'text', step: 's1', box: [0, 0, 10, 10] }],
    ...calls, ...props } });
  flushSync();
  return calls;
}
const tiles = () => [...document.body.querySelectorAll('[role="option"]')];

describe('the steps of a day', () => {
  it('lists the day, then each step with its length, the one shown marked', () => {
    show();
    expect(tiles().map((tile) => tile.querySelector('.tile-name').textContent)).toEqual(['15 Oct 2026', 'Strike', 'Step 2']);
    // a step with a clip runs as long as it, one without holds its own seconds
    expect(tiles().slice(1).map((tile) => tile.querySelector('.time').textContent)).toEqual(['0:08.5', '0:04.5']);
    expect(tiles()[1].getAttribute('aria-selected')).toBe('true');
    expect(tiles()[1].querySelector('video').getAttribute('src')).toBe('/files/c1/media/strike.mp4#t=12');
  });

  it('shows a step or the day on a press, and adds a step', () => {
    const calls = show();
    tiles()[2].click(); tiles()[0].click();
    expect(calls.onpick.mock.calls).toEqual([['s2'], [null]]);
    document.body.querySelector('button[aria-label="Add a step"]').click();
    expect(calls.onadd).toHaveBeenCalledOnce();
  });

  it('names a step, moves it, and says what goes with it when it is removed', () => {
    const calls = show();
    document.body.querySelector('button[aria-label="Set Strike"]').click(); flushSync();
    const field = document.body.querySelector('.fields input');
    field.value = ' Dawn strike '; field.dispatchEvent(new Event('change', { bubbles: true }));
    expect(calls.onchange).toHaveBeenCalledWith('s1', { name: 'Dawn strike' });
    // a step with a clip holds as long as it, so its seconds are not asked
    expect(document.body.querySelector('.fields input[type="number"]')).toBeNull();
    const remove = [...document.body.querySelectorAll('.fm-item')].find((item) => item.textContent.includes('Remove'));
    expect(remove.textContent).toContain('Remove it and its 2 elements');
    [...document.body.querySelectorAll('.fm-item')].find((item) => item.textContent.includes('later')).click(); flushSync();
    expect(calls.onmove).toHaveBeenCalledWith('s1', 2);
  });

  it('cuts straight into a step when the video\'s transitions are on, and says nothing of it when they are off', () => {
    const calls = show({ transitions: true });
    document.body.querySelector('button[aria-label="Set Strike"]').click(); flushSync();
    const cut = document.body.querySelector('.cut input');
    cut.click();
    expect(calls.onchange).toHaveBeenLastCalledWith('s1', { transition: 'none' });
    unmount(held); held = null; document.body.innerHTML = '';
    show({ transitions: false });
    document.body.querySelector('button[aria-label="Set Strike"]').click(); flushSync();
    expect(document.body.querySelector('.cut')).toBeNull();
  });
});
