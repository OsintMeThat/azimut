// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import AnalyzerSettings from './AnalyzerSettings.svelte';

/** A threshold is shown only where the method reads it, in the unit it reads it in. */
const parameters = { sensitivity: 60, min_area: 2000, max_area: 0, cleanup: 1, smoothing: 2, merge_metres: 30,
  index: 'ndvi', direction: 'both', sar_ground: 'any', ignore_clouds: true, ignore_shadows: true, cloud_margin: 5 };
let live, target;
afterEach(() => { if (live) unmount(live); live = null; target?.remove(); });

function open(capability) {
  target = document.createElement('div'); document.body.append(target);
  live = mount(AnalyzerSettings, { target, props: { recipe: { method: capability.id, parameters: { ...parameters } },
    capability: { sizes: {}, ...capability }, expanded: true } });
  flushSync();
  return target.textContent;
}

it('counts radar averaging on the ground', () => {
  const text = open({ id: 'sar-change', single: false, sensor: 'sentinel1', smoothing_m: 45 });
  expect(text).toContain('Averaging · 90 m');
  expect(text).not.toContain('Smoothing');
});

it('keeps pixels for optical change', () => {
  const text = open({ id: 'surface', single: false, smoothing_m: null });
  expect(text).toContain('Smoothing · 2px');
  expect(text).toContain('Noise cleanup');
});

it('offers no cleanup or smoothing to a method that reads one image', () => {
  const text = open({ id: 'sar-vessels', single: true, sensor: 'sentinel1', smoothing_m: null });
  expect(text).not.toContain('Noise cleanup');
  expect(text).not.toContain('Smoothing');
  expect(text).toContain('Group within');
});
