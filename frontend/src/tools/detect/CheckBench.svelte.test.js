// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { Bench } from '../../lib/map/bench.svelte.js';
import { newCheck, newRecipe, newRule, signature } from '../../lib/map/analyzerRules.js';
import CheckBench from './CheckBench.svelte';

const METHODS = [{ id: 'rules', sizes: { all: {} } }];
const VIEW = { west: 2, south: 48, east: 2.2, north: 48.2 };
const pass = (date) => ({ provider: 'sentinel2', date, layer: 'TRUE_COLOR', maxcc: 100 });
const made = (name, extra = {}) => ({ ...newCheck({ name, a: pass('2026-05-04'), b: pass('2026-05-11'),
  marks: [{ point: [2.01, 48.01], expect: 'found' }, { point: [2.05, 48.05], expect: 'empty' }] }), ...extra });

let live, bench, target, calls;
beforeEach(() => { vi.useFakeTimers(); calls = []; });
afterEach(() => {
  if (live) unmount(live);
  bench?.destroy();
  live = bench = null;
  target?.remove();
  vi.useRealTimers();
});

function open({ dates = 'two', sensor = 'sentinel2', checks = [], layers, layerState = null, planError = '' } = {}) {
  const recipe = $state({ ...newRecipe(METHODS, { sensor, dates }), name: 'Mine', checks });
  const api = { post: vi.fn(async (url, body) => {
    calls.push([url, body]);
    if (url.endsWith('/check/plan')) {
      if (planError) throw new Error(planError);
      return { tiles: 1, missing: 4 };
    }
    if (url.endsWith('/check')) {
      const covered = body.check.marks.map((mark) => mark.expect === 'found');
      return { ready: true, missing: 0, count: 1, covered, size: 512, tiles: [], rules: body.recipe.rules.map(() => ({ share: 0.1, kept: 0.1 })),
        candidates: [], readings: [] };
    }
    return { dates: [{ date: '2026-05-11', cloud: 4, coverage: 1 }, { date: '2026-05-04', cloud: 2, coverage: 1 }], truncated: false };
  }),
  // Letting a drawn rule go clears the draft it was rendered under.
  put: vi.fn(async () => ({ id: 'AZIMUT_DRAFT_ABC123' })),
  del: vi.fn(async () => ({})) };
  bench = new Bench({ api, recipe, limits: { max_checks: 12, max_marks: 60 }, layers: () => layers ?? [],
    layerState: () => layerState, viewBounds: () => VIEW });
  target = document.createElement('div');
  document.body.append(target);
  live = mount(CheckBench, { target, props: { bench } });
  flushSync();
  return { bench, recipe };
}
const settle = async () => { await vi.advanceTimersByTimeAsync(300); flushSync(); };
const query = (selector) => target.querySelector(selector);
const buttons = (selector = '.console') => [...query(selector).querySelectorAll('button')];
const named = (text, selector) => buttons(selector).find((button) => button.textContent.trim().startsWith(text));
const click = (node) => { node.click(); flushSync(); };

it('asks for a check when none is on the map, and offers a new one', () => {
  open();
  expect(query('.head').textContent).toContain('Basemap only');
  expect(query('.head').textContent).toContain('Pick a check to try the rules on it.');
  expect(query('.tools')).toBe(null);
  click(named('New check'));
  expect(bench.draft).not.toBe(null);
  expect(query('[aria-label="Passes of the new check"]')).not.toBe(null);
});

it('lists the checks with how each came out, picks one, and closes on Escape or a press elsewhere', async () => {
  const good = made('The plot', { result: null });
  open({ checks: [good, made('The reef', { marks: [] })] });
  click(query('[aria-label="Check on the map"]'));
  const menu = query('[role="menu"][aria-label="Checks"]');
  expect([...menu.querySelectorAll('[role="menuitemradio"]')].map((row) => row.textContent.replace(/\s+/g, ' ').trim()))
    .toEqual(['Basemap only', '– The plot Not tested yet', '! The reef Needs a pin']);
  click(menu.querySelectorAll('[role="menuitemradio"]')[1]);
  expect(bench.check.name).toBe('The plot');
  expect(query('[role="menu"]')).toBe(null);
  expect(query('[aria-label="Check on the map"]').textContent).toContain('The plot');
  // a press elsewhere, and Escape, each close it
  click(query('[aria-label="Check on the map"]'));
  expect(query('[role="menu"]')).not.toBe(null);
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); flushSync();
  expect(query('[role="menu"]')).toBe(null);
  click(query('[aria-label="Check on the map"]'));
  query('.bench-root').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); flushSync();
  expect(query('[role="menu"]')).toBe(null);
  await settle();
});

it('switches between the before pass, the split and the after pass of a check of two dates, not of one', () => {
  open({ checks: [made('The plot')] });
  bench.select(bench.checks[0].id); flushSync();
  const seg = query('[role="group"][aria-label="Which pass to look at"]');
  expect([...seg.querySelectorAll('button')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()))
    .toEqual(['Before 2026-05-04', 'Split', 'After 2026-05-11']);
  click(seg.querySelectorAll('button')[0]);
  expect(bench.divider).toBe(100);
  click(seg.querySelectorAll('button')[2]);
  expect(bench.divider).toBe(0);
  click(seg.querySelectorAll('button')[1]);
  expect(bench.divider).toBe(50);
  // with the basemap up there is no pass to switch between
  bench.setBasemap(true); flushSync();
  expect([...seg.querySelectorAll('button')].every((b) => b.disabled)).toBe(true);
  unmount(live); bench.destroy(); target.remove();
  open({ dates: 'one', checks: [made('The plot', { a: {} })] });
  bench.select(bench.checks[0].id); flushSync();
  expect(query('[aria-label="Which pass to look at"]')).toBe(null);
  expect(query('.date').textContent).toBe('2026-05-11');
});

it('arms a pin, says what a click will do, and says how many are down', () => {
  open({ checks: [made('The plot')] });
  bench.select(bench.checks[0].id); flushSync();
  const pins = query('[role="group"][aria-label="Pin to drop on the map"]');
  expect(pins.textContent).toContain('2 pins');
  click([...pins.querySelectorAll('button')][1]);
  expect(bench.pinning).toBe('empty');
  expect(query('.note').textContent).toBe('Click the ground where none should be (Esc stops).');
  click([...pins.querySelectorAll('button')][1]);
  expect(bench.pinning).toBe(null);
});

it('changes only the check display and restores its choices after hiding all overlays', async () => {
  const { recipe } = open({ checks: [made('The plot')] });
  bench.select(bench.checks[0].id); flushSync(); await settle();
  const savedRecipe = JSON.stringify(recipe), before = calls.length;
  click(query('[aria-label="Which overlays"]'));
  await Promise.resolve(); flushSync();
  const rows = [...query('[role="menu"]').querySelectorAll('[role="menuitemcheckbox"]')];
  expect(rows.map((row) => row.textContent.trim())).toEqual(['Markers', 'Outlines', 'Check pins']);
  click(rows[0]); click(rows[2]);
  expect([bench.markers, bench.outlines, bench.checkPins]).toEqual([false, true, false]);
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); flushSync();
  click(query('[aria-label="Hide the check overlays"]'));
  expect(bench.hideOverlays).toBe(true);
  click(query('[aria-label="Hide the check overlays"]'));
  expect(bench.hideOverlays).toBe(false);
  expect([bench.markers, bench.outlines, bench.checkPins]).toEqual([false, true, false]);
  await settle();
  expect(JSON.stringify(recipe)).toBe(savedRecipe);
  expect(calls).toHaveLength(before);
});

it('shows the tile limit error while a pin is armed and blocks Test before fetching', async () => {
  const error = 'these pins reach 21 tiles and a check reads at most 20: start another check';
  open({ checks: [made('The plot')], planError: error });
  bench.select(bench.checks[0].id);
  bench.arm('found'); flushSync();
  await settle();
  expect(bench.pinning).toBe('found');
  expect(query('.note.warn[role="status"]').textContent).toBe(error);
  expect(query('.test').title).toBe(error);
  expect(query('.test').disabled).toBe(true);
  click(query('.test')); await settle();
  expect(calls.some(([url]) => url.endsWith('/check'))).toBe(false);
  bench.arm('found'); flushSync();
  expect(query('.note.warn').textContent).toBe(error);
});

it('says what a test costs before it reads, then that it is done, and draws a chip for each rule', async () => {
  const { recipe } = open({ checks: [made('The plot')] });
  recipe.rules = [newRule('index', 'change'), newRule('index', 'a')];
  bench.select(bench.checks[0].id); flushSync();
  await settle();
  expect(query('.test').textContent.trim()).toBe('Test · 4 requests');
  expect(query('.result')).toBe(null);
  click(query('.test')); await settle();
  expect(query('.test').textContent.trim()).toBe('Tested');
  expect(query('.test').disabled).toBe(true);
  expect(query('.outcome').textContent).toBe('1 of 1 found · stayed empty · 1 candidate');
  const chips = [...query('[role="group"][aria-label="Rules on the map"]').querySelectorAll('button')];
  expect(chips.map((chip) => chip.textContent.trim())).toEqual(['1NDVI change', '2NDVI before']);
  // a chip hides its rule, shows it again, and a pointer on it lights that rule alone
  click(chips[1]);
  expect(bench.painted(1)).toBe(false);
  chips[0].dispatchEvent(new Event('pointerenter')); flushSync();
  expect(bench.hover).toBe(0);
  chips[0].dispatchEvent(new Event('pointerleave')); flushSync();
  expect(bench.hover).toBe(null);
  const view = query('[role="group"][aria-label="What the map shows"]');
  click(view.querySelectorAll('button')[1]);
  expect(bench.view).toBe('detections');
});

it('says the rules changed, in place of the outcome, and what went wrong in the engine’s words', async () => {
  const { recipe } = open({ checks: [made('The plot')] });
  bench.select(bench.checks[0].id); flushSync();
  await settle();
  click(query('.test')); await settle();
  recipe.rules[0].value = -0.5; flushSync();
  expect(query('.result').classList.contains('stale')).toBe(true);
  expect(query('.outcome').textContent).toBe('The rules or pins changed since this test.');
  expect(query('.test').textContent.trim()).toBe('Test again');          // its frames are held now, so it costs nothing
  expect(signature(recipe)).toBeTruthy();
});

it('shows the passes in the layer the rules read best, or the basemap in their place, from an eye', () => {
  const { recipe } = open({ checks: [made('The plot')], layers: [{ id: 'TRUE_COLOR', label: 'True colour' }, { id: 'NDVI', label: 'NDVI (vegetation index)', hint: 'Greens' }] });
  recipe.rules = [newRule('index', 'change')];
  bench.select(bench.checks[0].id); flushSync();
  const look = query('[aria-label="Copernicus layer"][aria-haspopup]');
  expect(look.textContent.trim()).toBe('Display: True colour');
  click(look);
  const menu = query('[role="menu"][aria-label="Copernicus layer"]');
  const rows = [...menu.querySelectorAll('[role="menuitemradio"]')];
  // the tag names the bands rather than a star that lives at the other end of the screen
  expect(rows.map((row) => row.textContent.replace(/\s+/g, ' ').trim())).toEqual(['True colourTRUE_COLOR', 'NDVI (vegetation index)NDVI shows B08 · B04']);
  click(rows[1]);
  expect(bench.layer).toBe('NDVI');
  expect(look.textContent.trim()).toBe('Display: NDVI');
  expect(query('[role="menu"]')).toBe(null);

  // the eye puts the basemap where the passes were, and back
  const eye = query('button[aria-label="Passes on the map"]');
  expect(eye.getAttribute('aria-pressed')).toBe('true');
  expect(eye.getAttribute('title')).toBe('Show the basemap');
  click(eye);
  expect(bench.basemap).toBe(true);
  expect(eye.getAttribute('aria-pressed')).toBe('false');
  expect(eye.getAttribute('title')).toBe('Show the passes');
  expect(look.classList.contains('off')).toBe(true);
  click(eye);
  expect(bench.basemap).toBe(false);
  // a layer picked with the basemap up brings the passes back in it
  click(eye);
  click(look);
  click(query('[role="menu"]').querySelectorAll('[role="menuitemradio"]')[0]);
  expect(bench.basemap).toBe(false);
  expect(bench.layer).toBe('TRUE_COLOR');
});

it('has no layer to choose for radar, which has one picture, and still has the eye', () => {
  open({ sensor: 'sentinel1', checks: [made('The plot', { a: { provider: 'sentinel1', date: '2026-05-04', time: '05:30:12' },
    b: { provider: 'sentinel1', date: '2026-05-11', time: '05:30:12' } })] });
  bench.select(bench.checks[0].id); flushSync();
  expect(query('[aria-label="Copernicus layer"]')).toBe(null);
  expect(query('button[aria-label="Passes on the map"]')).not.toBe(null);
});

it('shows missing displays disabled with a reason and offers setup and refresh', () => {
  const layerState = { layers: [{ id: 'TRUE_COLOR', label: 'True colour' },
    { id: 'VEGETATION_INDEX', label: 'Vegetation Index - NDVI' }], layersSource: 'instance',
    loadLayers: vi.fn(async () => true) };
  open({ checks: [made('The plot')], layerState });
  bench.select(bench.checks[0].id); flushSync();
  click(query('[aria-label="Copernicus layer"][aria-haspopup]'));
  const menu = query('[role="menu"][aria-label="Copernicus layer"]');
  const rows = [...menu.querySelectorAll('[role="menuitemradio"]')];
  expect(rows.find((row) => row.textContent.includes('VEGETATION_INDEX')).disabled).toBe(false);
  const missing = rows.find((row) => row.textContent.includes('SWIR'));
  expect(missing.disabled).toBe(true);
  expect(missing.textContent).toContain('Not in your Copernicus configuration.');
  click(missing);
  expect(bench.layer).toBe('TRUE_COLOR');
  expect(menu.querySelector('summary').textContent).toBe('Set up Copernicus layers');
  click([...menu.querySelectorAll('button')].find((row) => row.textContent.trim() === 'Refresh layers'));
  expect(layerState.loadLayers).toHaveBeenLastCalledWith(true, true, true);
});

it('makes a new check in three steps: its passes, its pins, and Finish', async () => {
  const { recipe } = open();
  click(named('New check'));
  expect(query('.drawer header strong').textContent).toBe('New check');
  expect(query('.drawer .hint').textContent.replace(/\s+/g, ' ')).toBe('Pick the pass before and the pass after, looked up for the ground at the middle of the map.');
  expect(named('Place the pins', '.drawer').disabled).toBe(true);
  click(named('Find passes', '.drawer')); await settle();
  expect(calls.at(-1)[0]).toBe('/api/satellite/sentinel/acquisitions');
  const rows = [...target.querySelectorAll('.drawer li')];
  expect(rows[1].textContent).toContain('2026-05-04');
  click(rows[1].querySelectorAll('button')[0]);          // Before
  click(rows[0].querySelectorAll('button')[1]);          // After
  expect(query('.slots').textContent.replace(/\s+/g, ' ')).toContain('Before 2026-05-04');
  expect(query('.slots').textContent.replace(/\s+/g, ' ')).toContain('After 2026-05-11');
  click(named('Place the pins', '.drawer'));
  expect(query('.drawer')).toBe(null);
  expect(bench.pinning).toBe('found');
  // the name can be changed while the pins go down, and Finish waits for one
  const name = query('input.name');
  name.value = 'The plot'; name.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
  expect(named('Finish').disabled).toBe(true);
  bench.dropPin({ lon: 2.01, lat: 48.01 }); flushSync();
  click(named('Finish'));
  expect(recipe.checks.map((check) => check.name)).toEqual(['The plot']);
  expect(query('[aria-label="Check on the map"]').textContent).toContain('The plot');
});

it('lets the passes be picked from a calendar too, with the month asked for only when it is opened', async () => {
  open();
  click(named('New check'));
  click(named('Dates', '.drawer'));
  expect(query('.dates')).not.toBe(null);
  expect(calls.filter(([url]) => url.endsWith('/acquisitions'))).toHaveLength(0);
  click(query('button[aria-label="After pass"]')); await settle();
  expect(calls.filter(([url]) => url.endsWith('/acquisitions'))).toHaveLength(1);
  expect(query('.pass-calendar')).not.toBe(null);
});

it('closes the drawer of a check being made by giving the check up, and Escape does the same', () => {
  open();
  click(named('New check'));
  query('.bench-root').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); flushSync();
  expect(bench.draft).toBe(null);
  expect(query('.drawer')).toBe(null);
});

it('separates what the map shows from what the rules read, where the two are confused', () => {
  open({ checks: [made('The plot')], layers: [{ id: 'TRUE_COLOR', label: 'True colour' }] });
  bench.select(bench.checks[0].id); flushSync();
  click(query('[aria-label="Copernicus layer"][aria-haspopup]'));
  const menu = query('[role="menu"][aria-label="Copernicus layer"]');
  expect(menu.querySelector('.layer-aside').textContent.trim())
    .toBe('What you look at. Rules read the bands themselves.');
});

it('says when a rule is drawn in the display’s place, and gives the display back', async () => {
  const { recipe } = open({ checks: [made('The plot')], layers: [{ id: 'TRUE_COLOR', label: 'True colour' }] });
  recipe.rules = [newRule('nd', 'b', { bands: ['B12', 'B11'] })];
  bench.select(bench.checks[0].id); flushSync();
  // the draft never reaches a picker, so the chip says the rule rather than a layer name
  bench.ruleLayer = { index: 0, id: 'AZIMUT_DRAFT_ABC123', back: 'TRUE_COLOR' };
  flushSync();
  const look = query('[aria-label="Copernicus layer"][aria-haspopup]');
  expect(look.textContent.trim()).toBe('Display: rule 1');
  click(look);
  const back = query('.layer-drawn');
  expect(back.textContent).toContain('Rule 1 is drawn on the map');
  click(back);
  expect(bench.ruleLayer).toBe(null);
  expect(look.textContent.trim()).toBe('Display: True colour');
});
