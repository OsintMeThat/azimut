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

describe('reading the rules at a point', () => {
  it('says what every rule read there and which one let it go', () => {
    const { target, done } = render({ ready: true, imaged: true, measured: true, kept: false, rules: [
      { passes: true, value: -0.41, before: 0.72, after: 0.31 },
      { passes: false, value: 0.18, before: null, after: null },
    ] });
    expect(target.textContent).toContain('Not kept');
    const rows = [...target.querySelectorAll('li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim());
    expect(rows[0]).toContain('0.72 → 0.31 (−0.41)');
    expect(rows[0]).toContain('✓');
    expect(rows[1]).toContain('18.0%');
    expect(rows[1]).toContain('✗');
    // near the right edge the card opens to the left of the point
    expect(target.querySelector('.probe').style.left).toBe('566px');
    done();
  });

  it('says why nothing was read under cloud, off the imagery or outside the preview', () => {
    for (const [result, words] of [
      [{ ready: true, imaged: true, measured: false, kept: false, rules: [] }, 'Under cloud or shadow'],
      [{ ready: true, imaged: false, measured: false, kept: false, rules: [] }, 'No imagery here'],
      [{ ready: false }, 'Outside the preview'],
    ]) {
      const { target, done } = render(result);
      expect(target.textContent).toContain(words);
      expect(target.querySelector('li')).toBe(null);
      done();
    }
  });

  it('marks the point in the check on the bench, or in a new check of this view', () => {
    const read = { ready: true, imaged: true, measured: true, kept: true, rules: [] };
    const onmark = vi.fn();
    const { target, done } = render(read, { onmark, markTarget: 'The town that burned' });
    expect(target.textContent).toContain('Mark it in “The town that burned”');
    [...target.querySelectorAll('button')].find((b) => b.textContent === 'Should stay empty').click();
    expect(onmark).toHaveBeenCalledWith('empty');
    done();
    const fresh = render(read, { onmark });
    expect(fresh.target.textContent).toContain('Mark it in a new check of this view');
    fresh.done();
    // nothing to mark off the imagery, and nothing without a way to keep it
    for (const extra of [{ onmark }, {}]) {
      const off = render(extra.onmark ? { ...read, imaged: false } : read, extra);
      expect(off.target.textContent).not.toContain('Should be found');
      off.done();
    }
  });

  it('opens where nothing is read yet, says what is missing, and still takes a mark', () => {
    const onmark = vi.fn();
    const unread = (kind) => render(null, { onmark, probe: { point: { lon: 2, lat: 48 }, result: null, error: '', unread: kind } });
    const frames = unread('frames');
    expect(frames.target.textContent).toContain('Not read here yet');
    [...frames.target.querySelectorAll('button')].find((b) => b.textContent === 'Should be found').click();
    expect(onmark).toHaveBeenCalledWith('found');
    frames.done();
    const passes = unread('passes');
    expect(passes.target.textContent).toContain('Pick the passes to read the rules here.');
    passes.done();
    const nowhere = render(null, { onmark, canMark: false, probe: { point: { lon: 2, lat: 48 }, result: null, error: '', unread: 'passes' } });
    expect(nowhere.target.textContent).toContain('this point can become a mark of a check');
    expect(nowhere.target.textContent).not.toContain('Should be found');
    nowhere.done();
  });
});
