// @vitest-environment happy-dom
/**
 * One panel for two seats: Measure's lines and their uses, and Align's
 * alignments with how far they run on and where they meet. Each is shown on a
 * real store over a flat fake map.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import MeasurePanel from './MeasurePanel.svelte';
import { createMeasureState } from './state/measure.svelte.js';
import { destination } from '../../lib/measure.js';

let held = [];
let engine;
beforeEach(() => {
  localStorage.clear();
  engine = { latLngToContainerPoint: ({ lat, lon }) => ({ x: lon * 1000, y: -lat * 1000 }), readClicks: vi.fn() };
});
afterEach(() => {
  for (const one of held) unmount(one);
  held = [];
  document.body.innerHTML = '';
});

const layer = () => ({ set: vi.fn(), patch: vi.fn(), visible: vi.fn(), clear: vi.fn(), destroy: vi.fn() });
const store = (more = {}) =>
  createMeasureState({
    engine: () => engine,
    api: { post: vi.fn(), get: vi.fn() },
    units: () => 'metric',
    coords: (lat, lon) => `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
    surface: layer,
    ...more,
  });

function show(tool) {
  held.push(mount(MeasurePanel, { target: document.body, props: { tool, onkeep: vi.fn(), oncopy: vi.fn(), onlook: vi.fn() } }));
  flushSync();
}

const text = () => document.querySelector('.measure-panel').textContent;
const named = (name) => [...document.querySelectorAll('button')].find((one) => one.textContent.trim() === name);

it('offers a measured line as rings, a cone or a viewshed, and reads its ground', () => {
  const tool = store();
  tool.open();
  tool.addPoint({ lat: 46, lon: 7 });
  tool.addPoint({ lat: 46, lon: 7.02 });
  tool.finish();
  show(tool);
  expect(document.querySelector('.title').textContent.trim()).toBe('Measure');
  expect([...document.querySelectorAll('.tiles button')].map((one) => one.textContent.trim())).toEqual(['Ring', 'Cone', 'Viewshed']);
  expect(text()).toContain('Ground');
  expect(named('Look from A')).toBeTruthy();
});

it('opens Align on what to click, then on how far an alignment runs on and how loosely', () => {
  const tool = store({ align: true });
  tool.open();
  show(tool);
  expect(document.querySelector('.title').textContent.trim()).toBe('Align');
  expect(text()).toContain('Click two things lined up in the picture.');
  expect(document.querySelector('[data-guide="map.measure"]')).toBeNull();

  const camera = { lat: 46.05, lon: 7.05 };
  tool.addPoint(destination(camera, 10, 5000));
  tool.addPoint(destination(camera, 10, 2000));
  flushSync();
  expect(document.querySelector('.list').getAttribute('aria-label')).toBe('Alignments');
  expect(document.querySelector('.list li.on .what').textContent).toBe('Alignment · 190°');
  // no uses, no ground and no look along it: only the run
  expect(document.querySelector('.tiles')).toBeNull();
  expect(text()).not.toContain('Ground');
  expect(named('Look from A')).toBeFalsy();
  expect(document.querySelector('[aria-label="How far the line runs on"]').value).toBe('20');
  expect(document.querySelector('[aria-label="Tolerance in degrees"]')).toBeTruthy();
  expect(text()).toContain('The camera stands on the line, on the side of the nearer thing.');
  // the next two clicks are another alignment
  expect(text()).not.toContain('Click two things lined up in the picture.');
  tool.select(null);
  flushSync();
  expect(document.querySelector('.how').textContent).toBe('Click two things lined up in the picture');
});
