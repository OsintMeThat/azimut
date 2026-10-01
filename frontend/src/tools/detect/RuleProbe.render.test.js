// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import RuleProbe from './RuleProbe.svelte';
import { newRule } from '../../lib/map/analyzerRules.js';

const engine = { on: () => () => {}, latLngToContainerPoint: () => ({ x: 900, y: 40 }) };
const rules = [newRule('index', 'change'), newRule('band', 'b', { band: 'B12' })];

function render(result, extra = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  const live = mount(RuleProbe, { target, props: { engine, rules, colours: ['#f00', '#0f0'], width: 1000, height: 600,
    probe: { point: { lon: 2, lat: 48 }, result, error: '' }, ...extra } });
  flushSync();
  return { target, done: () => { unmount(live); target.remove(); } };
}
const press = (target, words) => [...target.querySelectorAll('button')].find((b) => b.textContent.includes(words)).click();

describe('reading the rules at a point', () => {
  it('says what every rule read there and which one let it go', () => {
    const { target, done } = render({ ready: true, imaged: true, measured: true, kept: false, rules: [
      { passes: true, value: -0.41, before: 0.72, after: 0.31 },
      { passes: false, value: 0.18, before: null, after: null },
    ] });
    expect(target.textContent).toContain('Not kept');
    const rows = [...target.querySelectorAll('li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim());
    expect(rows[0]).toContain('NDVI dropped by 0.25 or more');
    expect(rows[0]).toContain('0.72 → 0.31 (−0.41)');
    expect(rows[0]).toContain('✓');
    expect(rows[1]).toContain('B12 (short-wave 2.2 µm) after is at least 25.0%');
    expect(rows[1]).toContain('18.0%');
    expect(rows[1]).toContain('✗');
    // each rule wears the number and the colour it has in the list and on the map
    expect([...target.querySelectorAll('.dot')].map((dot) => dot.textContent)).toEqual(['1', '2']);
    // near the right edge the card opens to the left of the point
    expect(target.querySelector('.probe').style.left).toBe('566px');
    done();
  });

  it('leaves out the before and after of an analyzer of one date', () => {
    const { target, done } = render({ ready: true, imaged: true, measured: true, kept: true, rules: [
      { passes: true, value: 0.3, before: null, after: null }] }, { single: true, rules: [newRule('band', 'b', { band: 'B12' })] });
    expect(target.querySelector('li').textContent).toContain('B12 (short-wave 2.2 µm) is at least 25.0%');
    done();
  });

  it('says why nothing was read under cloud, off the imagery or outside the ground tested', () => {
    for (const [result, words] of [
      [{ ready: true, imaged: true, measured: false, kept: false, rules: [] }, 'Under cloud or shadow'],
      [{ ready: true, imaged: false, measured: false, kept: false, rules: [] }, 'No imagery here'],
      [{ ready: false }, 'Outside the ground the test read'],
    ]) {
      const { target, done } = render(result);
      expect(target.textContent).toContain(words);
      expect(target.querySelector('li')).toBe(null);
      done();
    }
  });

  it('drops a pin at the point, unless it is off the imagery or nothing can keep it', () => {
    const read = { ready: true, imaged: true, measured: true, kept: true, rules: [] };
    const onmark = vi.fn();
    const { target, done } = render(read, { onmark });
    expect(target.textContent).toContain('Drop a pin here');
    press(target, 'Should stay empty');
    expect(onmark).toHaveBeenCalledWith('empty');
    done();
    const off = render({ ...read, imaged: false }, { onmark });
    expect(off.target.textContent).not.toContain('Should be found');
    off.done();
    const nowhere = render(read);
    expect(nowhere.target.textContent).not.toContain('Should be found');
    nowhere.done();
  });

  it('opens where nothing is read yet, says what is missing, and still takes a pin', () => {
    const onmark = vi.fn();
    const unread = (kind) => render(null, { onmark, probe: { point: { lon: 2, lat: 48 }, result: null, error: '', unread: kind } });
    const frames = unread('frames');
    expect(frames.target.textContent).toContain('Test the check to read the rules here.');
    press(frames.target, 'Should be found');
    expect(onmark).toHaveBeenCalledWith('found');
    frames.done();
    const passes = unread('passes');
    expect(passes.target.textContent).toContain('Pick the passes to read the rules here.');
    passes.done();
  });

  it('offers a pin it was opened on to be turned or taken away, and no new pin', () => {
    const read = { ready: true, imaged: true, measured: true, kept: false, rules: [] };
    const onturn = vi.fn();
    const onremove = vi.fn();
    const { target, done } = render(read, { onmark: vi.fn(), pin: { number: 2, expect: 'found' }, onturn, onremove });
    expect(target.textContent).toContain('Pin 2: should be found');
    expect(target.textContent).not.toContain('Drop a pin here');
    press(target, 'Turn into “Should stay empty”');
    press(target, 'Remove');
    expect(onturn).toHaveBeenCalledOnce();
    expect(onremove).toHaveBeenCalledOnce();
    done();
  });
});
