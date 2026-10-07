// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { Bench, lookupBounds } from './bench.svelte.js';
import { newCheck, newRecipe, newRule, signature } from './analyzerRules.js';
import { displayLayers } from '../sentinelLayers.js';

const METHODS = [{ id: 'rules', sizes: { all: { min_area: 0, cleanup: 0 } } }];
/** What the engine names a layer previewed before it is saved. */
const DRAFT = 'AZIMUT_DRAFT_ABC123DEF456';
const VIEW = { west: 2, south: 48, east: 2.2, north: 48.2 };
const PLOT = [2.01, 48.01];
const REEF = [2.05, 48.05];
const settle = async () => {
  await vi.advanceTimersByTimeAsync(300);
  flushSync();
};

/** A bench on a recipe of two dates, with an engine that answers what a real one would. */
function make({ dates = 'two', sensor = 'sentinel2', checks = [], answers = {}, layerState = null,
  limits = { max_checks: 12, max_marks: 60 } } = {}) {
  const recipe = $state({ ...newRecipe(METHODS, { sensor, dates }), name: 'Mine', checks });
  const calls = [];
  const api = {
    post: vi.fn(async (url, body) => {
      calls.push([url, body]);
      const answer = answers[url];
      if (answer instanceof Error) throw answer;
      if (typeof answer === 'function') return answer(body);
      if (url.endsWith('/check/plan')) return answer ?? { tiles: 1, missing: 2 };
      if (url.endsWith('/check')) {
        return answer ?? { ready: true, missing: 0, count: 1, covered: body.check.marks.map((mark) => mark.expect === 'found'),
          tiles: [{ x: 1, y: 2, box: { west: 0, east: 1, north: 1, south: 0 }, mask: 'AAAA' }], size: 512,
          rules: body.recipe.rules.map(() => ({ share: 0.05, kept: 0.05 })), candidates: [], readings: [] };
      }
      if (url.endsWith('/check/values')) {
        return answer ?? { ready: true, missing: 0, size: 512, rule: body.rule, low: -1, high: 1,
          steps: 65535, tiles: [{ x: 1, y: 2, box: { west: 0, east: 1, north: 1, south: 0 }, values: 'AAAA' }] };
      }
      if (url.endsWith('/probe')) return answer ?? { ready: true, imaged: true, measured: true, kept: true, rules: [] };
      if (url.endsWith('/acquisitions')) return answer ?? { dates: [{ date: '2023-08-13', cloud: 3, coverage: 1 }], truncated: false };
      throw new Error(`unexpected ${url}`);
    }),
    // Drawing a rule renders it through the ordinary draft-preview path.
    put: vi.fn(async (url, body) => {
      calls.push([url, body]);
      if (url.endsWith('/draft-layer')) return { id: DRAFT };
      throw new Error(`unexpected ${url}`);
    }),
    del: vi.fn(async (url) => { calls.push([url, null]); return {}; }),
  };
  const fly = vi.fn();
  const say = vi.fn();
  const bench = new Bench({ api, recipe, limits, layers: () => [], layerState: () => layerState, viewBounds: () => VIEW, fly, say });
  return { recipe, api, calls, bench, fly, say };
}

const pass = (date) => ({ provider: 'sentinel2', date, layer: 'TRUE_COLOR', maxcc: 100 });
const made = (name, marks = [{ point: PLOT, expect: 'found' }]) =>
  newCheck({ name, a: pass('2023-08-08'), b: pass('2023-08-13'), marks });

let live = [];
const open = (options) => {
  const made = make(options);
  live.push(made.bench);
  return made;
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  live.forEach((bench) => bench.destroy());
  live = [];
  vi.useRealTimers();
});

describe('making a check', () => {
  it('takes the passes, then the pins, and keeps the panel waiting until it is valid', () => {
    const { bench, recipe } = open();
    bench.startDraft();
    expect(bench.locked).toBe(true);
    expect(bench.draft.step).toBe('passes');
    expect(bench.choosingPasses).toBe(true);
    expect(bench.check.name).toBe('Check 1');
    bench.setPass('b', { date: '2023-08-13' });
    bench.continueDraft();                          // a before pass is missing, so it cannot go on
    expect(bench.draft.step).toBe('passes');
    bench.setPass('a', { date: '2023-08-08' });
    expect(bench.dated).toBe(true);
    bench.continueDraft();
    expect(bench.draft.step).toBe('pins');
    expect(bench.pinning).toBe('found');
    expect(bench.canFinish).toBe(false);             // no pin yet
    bench.dropPin({ lon: PLOT[0], lat: PLOT[1] });
    expect(bench.marks).toEqual([{ point: PLOT, expect: 'found' }]);
    expect(bench.canFinish).toBe(true);
    expect(recipe.checks).toHaveLength(0);            // nothing is kept until it is finished
    bench.finishDraft();
    expect(recipe.checks).toHaveLength(1);
    expect(bench.locked).toBe(false);
    expect(bench.selected).toBe(recipe.checks[0].id);
    expect(bench.pinning).toBe(null);
  });

  it('puts back what was on the bench when it is given up', () => {
    const first = made('Plot');
    const { bench, recipe } = open({ checks: [first] });
    bench.select(first.id);
    bench.startDraft();
    expect(bench.selected).toBe(null);
    bench.cancelDraft();
    expect(bench.draft).toBe(null);
    expect(bench.selected).toBe(first.id);
    expect(recipe.checks).toHaveLength(1);
  });

  it('takes the name of a check being made as it is typed, and none once it is given up', () => {
    const { bench } = open();
    bench.startDraft();
    bench.nameDraft('The plot');
    expect(bench.check.name).toBe('The plot');
    bench.cancelDraft();
    bench.nameDraft('Too late');                   // nothing is being made
    expect(bench.draft).toBe(null);
  });

  it('names each check with a number nobody has used', () => {
    const { bench } = open({ checks: [made('Check 1'), made('Check 3')] });
    bench.startDraft();
    expect(bench.check.name).toBe('Check 3'.replace('3', '4'));
  });

  it('asks for one date only when the analyzer reads one', () => {
    const { bench } = open({ dates: 'one' });
    bench.startDraft();
    bench.setPass('b', { date: '2023-08-13' });
    expect(bench.dated).toBe(true);
    bench.continueDraft();
    expect(bench.draft.step).toBe('pins');
  });

  it('refuses a twelfth-and-one check and a pin past the limit, and says so', () => {
    const { bench, say } = open({ limits: { max_checks: 1, max_marks: 1 }, checks: [made('Plot')] });
    bench.startDraft();
    expect(bench.draft).toBe(null);
    bench.select(bench.checks[0].id);
    bench.arm('empty');
    bench.dropPin({ lon: REEF[0], lat: REEF[1] });
    expect(bench.marks).toHaveLength(1);
    expect(say).toHaveBeenCalledWith('A check holds at most 1 pins.', 'warn');
  });

  it.each([{ max_marks: 60 }, {}])('keeps sixty pins and refuses another from either the map or a probe with limits %j', (limits) => {
    const { bench, recipe, say } = open({ limits, checks: [made('Plot')] });
    bench.select(bench.checks[0].id);
    bench.arm('empty');
    for (let i = 0; i < 58; i++) bench.dropPin({ lon: REEF[0] + i / 10000, lat: REEF[1] });
    bench.probe = { point: { lon: REEF[0], lat: REEF[1] }, pin: null };
    bench.markProbe('empty');
    expect(bench.marks).toHaveLength(60);
    expect(recipe.checks[0].marks).toHaveLength(60);
    bench.dropPin({ lon: REEF[0], lat: REEF[1] });
    bench.probe = { point: { lon: REEF[0], lat: REEF[1] }, pin: null };
    bench.markProbe('empty');
    expect(bench.marks).toHaveLength(60);
    expect(say).toHaveBeenCalledTimes(2);
    expect(say).toHaveBeenLastCalledWith('A check holds at most 60 pins.', 'warn');
    bench.removePin(59);
    bench.markProbe('empty');
    expect(bench.marks).toHaveLength(60);
    expect(bench.probe).toBe(null);
  });

  it('changes the passes of a check already kept, and forgets what they had answered', () => {
    const kept = { ...made('Plot'), result: { signature: 'x', count: 1, covered: [true] } };
    const { bench, recipe } = open({ checks: [kept] });
    bench.select(kept.id);
    bench.changePasses();
    expect(bench.choosingPasses).toBe(true);
    expect(bench.locked).toBe(false);
    bench.setPass('b', { date: '2023-09-01' });
    expect(recipe.checks[0].b.date).toBe('2023-09-01');
    expect(recipe.checks[0].result).toBe(null);
    bench.closePasses();
    expect(bench.choosingPasses).toBe(false);
  });

  it('drops no pin while the passes are being chosen', () => {
    const { bench } = open();
    bench.startDraft();
    bench.arm('found');
    expect(bench.pinning).toBe(null);
    bench.dropPin({ lon: PLOT[0], lat: PLOT[1] });
    expect(bench.marks).toEqual([]);
  });
});

describe('choosing a check', () => {
  it('goes to its pins, takes its layer and lets the basemap back', () => {
    const kept = made('Plot');
    kept.b.layer = 'SWIR';
    const { bench, fly } = open({ checks: [kept] });
    bench.select(kept.id);
    expect(bench.check.name).toBe('Plot');
    expect(fly).toHaveBeenCalledWith({ bounds: expect.objectContaining({ west: expect.any(Number) }) });
    expect(bench.layer).toBe('SWIR');
    bench.select(null);
    expect(bench.check).toBe(null);
    expect(bench.imagery).toEqual({ mode: 'basemap' });
  });

  it('puts a check away with its tests', () => {
    const kept = made('Plot');
    const { bench, recipe } = open({ checks: [kept] });
    bench.select(kept.id);
    bench.remove(kept.id);
    expect(recipe.checks).toEqual([]);
    expect(bench.selected).toBe(null);
  });

  it('renames a check, and keeps its name when the new one is blank', () => {
    const kept = made('Plot');
    const { bench, recipe } = open({ checks: [kept] });
    bench.rename(kept.id, '  The plot ');
    expect(recipe.checks[0].name).toBe('The plot');
    bench.rename(kept.id, '   ');
    expect(recipe.checks[0].name).toBe('The plot');
  });
});

describe('the imagery under the pins', () => {
  it('checks layers only on a check action and keeps the basemap until availability is known', async () => {
    const state = $state({ layers: [{ id: 'TRUE_COLOR' }], layersSource: 'catalogue', layersBusy: false, layersNote: '',
      loadLayers: vi.fn(async () => {}) });
    const { bench } = open({ layerState: state });
    flushSync();
    expect(state.loadLayers).not.toHaveBeenCalled();
    bench.startDraft();
    expect(state.loadLayers).toHaveBeenCalledWith(true, true, false);
    bench.setPass('b', { date: '2023-08-13' });
    expect(bench.imagery.mode).toBe('basemap');
    state.layersSource = 'instance'; flushSync();
    expect(bench.imagery.b.layer).toBe('TRUE_COLOR');
  });

  it('holds the display through an unproven configuration rather than falling to a layer written here', () => {
    // A layer written here needs no confirmation, a configured one does. Until
    // the instance answers, picking over the unconfirmed leaves only the
    // analyst's own standing — and the display never came back from them.
    const state = $state({ layers: [{ id: 'TRUE_COLOR' }, { id: 'SWIR' }, { id: 'B12', custom: true }],
      layersSource: 'catalogue', loadLayers: vi.fn(async () => true) });
    const kept = made('Plot');
    const { bench } = open({ checks: [kept], layerState: state });
    flushSync();
    expect(bench.layer).toBe('TRUE_COLOR');
    expect(bench.suggestion).toBe('TRUE_COLOR');
    bench.select(kept.id); flushSync();
    expect(bench.layer).toBe('TRUE_COLOR');
    expect(bench.layersNote).not.toContain('unavailable');
    // Unproven costs the basemap, which the note explains, and nothing else.
    expect(bench.imagery.mode).toBe('basemap');
    state.layersSource = 'instance'; flushSync();
    expect(bench.layer).toBe('TRUE_COLOR');
    expect(bench.imagery.b.layer).toBe('TRUE_COLOR');
  });

  it('still repairs a display no configuration holds, to TRUE_COLOR over a layer written here', () => {
    const state = $state({ layers: [{ id: 'TRUE_COLOR' }, { id: 'B12', custom: true }], layersSource: 'catalogue',
      loadLayers: vi.fn(async () => true) });
    const kept = made('Plot'); kept.b.layer = 'NDVI';
    const { bench } = open({ checks: [kept], layerState: state });
    bench.select(kept.id); flushSync();
    expect(bench.layer).toBe('TRUE_COLOR');
  });

  it('repairs an unavailable saved display using its actual alias, without changing the rules', () => {
    const state = $state({ layers: [{ id: 'TRUE_COLOR' }, { id: 'VEGETATION_INDEX' }], layersSource: 'instance',
      loadLayers: vi.fn(async () => true) });
    const kept = made('Plot'); kept.b.layer = 'NDVI';
    const { bench, recipe } = open({ checks: [kept], layerState: state });
    bench.select(kept.id); flushSync();
    expect(bench.imagery.b.layer).toBe('VEGETATION_INDEX');
    expect(bench.layersNote).toContain('NDVI is unavailable; showing VEGETATION_INDEX');
    expect(recipe.rules[0].measure).toBe('brightness');
    bench.setLayer('SWIR');
    expect(bench.layer).toBe('VEGETATION_INDEX');
  });

  it('keeps NDVI rules testable without an NDVI display, but blocks a missing optical data source', async () => {
    const state = $state({ layers: [{ id: 'TRUE_COLOR' }], layersSource: 'instance', loadLayers: vi.fn(async () => true) });
    const { bench, recipe, api } = open({ checks: [made('Plot')], layerState: state });
    recipe.rules = [newRule('index', 'change')];
    bench.select(bench.checks[0].id); await settle();
    expect(bench.canTest).toBe(true);
    expect(bench.offered.find((entry) => entry.id === 'NDVI').enabled).toBe(false);
    state.layers = [{ id: 'SWIR' }]; flushSync();
    expect(bench.canTest).toBe(false);
    expect(bench.dataProblem).toContain('TRUE_COLOR');
    await bench.testAll();
    expect(api.post.mock.calls.some(([path]) => path.endsWith('/check'))).toBe(false);
  });
  it('is the basemap until a check has a pass, then each pass as it is picked', () => {
    const { bench } = open();
    expect(bench.imagery).toEqual({ mode: 'basemap' });
    bench.startDraft();
    expect(bench.imagery).toEqual({ mode: 'basemap' });
    bench.setPass('b', { date: '2023-08-13' });
    expect(bench.imagery).toEqual({ mode: 'single', b: { provider: 'sentinel2', date: '2023-08-13', layer: 'TRUE_COLOR' } });
    bench.setPass('a', { date: '2023-08-08' });
    expect(bench.imagery).toEqual({ mode: 'swipe', a: expect.objectContaining({ date: '2023-08-08' }),
      b: expect.objectContaining({ date: '2023-08-13' }) });
    expect(bench.split).toBe(true);
  });

  it('shows one date alone for an analyzer of one date, and radar by its time of day', () => {
    const one = open({ dates: 'one' });
    one.bench.startDraft();
    one.bench.setPass('b', { date: '2023-08-13' });
    expect(one.bench.imagery.mode).toBe('single');
    const radar = open({ sensor: 'sentinel1' });
    radar.bench.startDraft();
    radar.bench.setPass('a', { date: '2023-08-08', time: '05:30:12' });
    radar.bench.setPass('b', { date: '2023-08-13', time: '05:30:12' });
    expect(radar.bench.imagery).toEqual({ mode: 'swipe', a: { provider: 'sentinel1', date: '2023-08-08', time: '05:30:12' },
      b: { provider: 'sentinel1', date: '2023-08-13', time: '05:30:12' } });
  });

  it('goes back to the basemap on request, and to the passes when one is picked', () => {
    const kept = made('Plot');
    const { bench } = open({ checks: [kept] });
    bench.select(kept.id);
    expect(bench.imagery.mode).toBe('swipe');
    bench.setBasemap(true);
    expect(bench.imagery.mode).toBe('basemap');
    bench.setLayer('SWIR');
    expect(bench.imagery.mode).toBe('swipe');
    expect(bench.imagery.b.layer).toBe('SWIR');
  });

  it('starts on the layer that shows what the ranking rule reads, and the layer is not what is read', () => {
    const kept = made('Plot');
    const { bench, recipe } = open({ checks: [kept] });
    expect(bench.layer).toBe('TRUE_COLOR');
    bench.select(kept.id);
    bench.setLayer('SWIR');
    expect(recipe.checks[0].b.layer).toBe('SWIR');
    expect(recipe.checks[0].a.layer).toBe('SWIR');
  });
});

describe('what a test would cost', () => {
  it('asks the engine once the pins and passes are there, and says what it will read', async () => {
    const kept = made('Plot');
    const { bench, calls } = open({ checks: [kept] });
    bench.select(kept.id);
    expect(bench.planning).toBe(true);
    await settle();
    const [url, body] = calls[0];
    expect(url).toBe('/api/compare/analyzers/check/plan');
    expect(body.recipe).toMatchObject({ method: 'rules', sensor: 'sentinel2', dates: 'two' });
    expect(body.check.result).toBe(null);
    expect(bench.plan).toMatchObject({ tiles: 1, missing: 2 });
    expect(bench.planning).toBe(false);
    expect(bench.blocked).toBe('');
  });

  it('is not asked again when a line moves, but is when a pin or a band does', async () => {
    const kept = made('Plot');
    const { bench, recipe, calls } = open({ checks: [kept] });
    bench.select(kept.id);
    await settle();
    expect(calls).toHaveLength(1);
    recipe.rules[0].value = -0.4;
    await settle();
    expect(calls).toHaveLength(1);
    bench.arm('empty');
    bench.dropPin({ lon: REEF[0], lat: REEF[1] });
    await settle();
    expect(calls).toHaveLength(2);
    recipe.rules[0] = newRule('index', 'change', { index: 'nbr' });
    await settle();
    expect(calls).toHaveLength(3);
  });

  it('says what stops a check being tested, before anything is asked', async () => {
    const { bench } = open();
    expect(bench.blocked).toBe('Pick a check to try the rules on.');
    bench.startDraft();
    expect(bench.blocked).toBe('Pick the before and after passes.');
    bench.setPass('b', { date: '2023-08-13' });
    bench.setPass('a', { date: '2023-08-08' });
    expect(bench.blocked).toBe('Drop a pin to choose what this check reads.');
    bench.continueDraft();
    bench.dropPin({ lon: PLOT[0], lat: PLOT[1] });
    await settle();
    expect(bench.blocked).toBe('');
  });

  it('carries the engine’s own words when the pins reach too much ground', async () => {
    const refusal = new Error('these pins reach 21 tiles and a check reads at most 20');
    const kept = made('Plot');
    const { bench } = open({ checks: [kept], answers: { '/api/compare/analyzers/check/plan': refusal } });
    bench.select(kept.id);
    await settle();
    expect(bench.blocked).toBe(refusal.message);
    expect(bench.plan.error).toBe(refusal.message);
    expect(bench.canTest).toBe(false);
    await bench.test();
    expect(bench.last).toBe(null);
  });

  it('adds up what every check still lacks for Test all', async () => {
    const { bench } = open({ checks: [made('One'), made('Two', [{ point: REEF, expect: 'empty' }])] });
    bench.select(bench.checks[0].id);
    await settle();
    expect(bench.allMissing).toBe(4);
  });
});

describe('testing', () => {
  async function ready(options) {
    const kept = made('Plot', [{ point: PLOT, expect: 'found' }, { point: REEF, expect: 'empty' }]);
    const made_ = open({ checks: [kept], ...options });
    made_.bench.select(kept.id);
    await settle();
    return { ...made_, kept };
  }

  it('reads what is missing, keeps what the map draws and the answer on the check', async () => {
    const { bench, recipe, calls } = await ready();
    await bench.test();
    const [, body] = calls.at(-1);
    expect(calls.at(-1)[0]).toBe('/api/compare/analyzers/check');
    expect(body).toMatchObject({ read: true, detail: true });
    expect(bench.detail.tiles).toHaveLength(1);
    expect(bench.stale).toBe(false);
    expect(recipe.checks[0].result).toEqual({ signature: signature(recipe), count: 1, covered: [true, false] });
    expect(bench.outcomes).toEqual([true, true]);
    expect(bench.pins.map((pin) => pin.ok)).toEqual([true, true]);
    expect(bench.plan.missing).toBe(0);
  });

  it('does not run by itself when a line moves, and says the picture is older than the rules', async () => {
    const { bench, recipe, calls } = await ready();
    await bench.test();
    const asked = calls.length;
    recipe.rules[0].value = -0.4;
    await settle();
    expect(calls.length).toBe(asked);
    expect(bench.stale).toBe(true);
    expect(bench.detail).not.toBe(null);            // still there to look at
    expect(bench.outcomes).toEqual([]);             // but no pin claims to have passed
    await bench.test();
    expect(bench.stale).toBe(false);
  });

  it('goes stale too when a pin is moved, and keeps no result for pins it did not read', async () => {
    const { bench, recipe } = await ready();
    await bench.test();
    bench.arm('empty');
    bench.dropPin({ lon: 2.06, lat: 48.06 });
    expect(bench.stale).toBe(true);
    expect(recipe.checks[0].result).toBe(null);
    bench.removePin(2);
    bench.flipPin(1);
    expect(bench.marks.map((mark) => mark.expect)).toEqual(['found', 'found']);
  });

  it('keeps the answer to the rules it was asked with when they change while it reads', async () => {
    let release;
    const slow = () => new Promise((resolve) => { release = resolve; });
    const { bench, recipe } = await ready({ answers: { '/api/compare/analyzers/check': slow } });
    const running = bench.test();
    expect(bench.testing).toBe(true);
    recipe.rules[0].value = -0.4;
    release({ ready: true, missing: 0, count: 1, covered: [true, false], tiles: [], size: 512, rules: [], candidates: [], readings: [] });
    await running;
    expect(recipe.checks[0].result).toBe(null);
    expect(bench.stale).toBe(true);
  });

  it('says on its button what the next test costs, and that there is nothing to do once it is done', async () => {
    const { bench, recipe } = await ready();
    expect(bench.testLabel).toBe('Test · 2 requests');
    expect(bench.canTest).toBe(true);
    await bench.test();
    expect(bench.testLabel).toBe('Tested');
    expect(bench.tested).toBe(true);
    expect(bench.canTest).toBe(false);
    recipe.rules[0].value = -0.4;
    expect(bench.testLabel).toBe('Test again');
    expect(bench.tested).toBe(false);
    expect(bench.canTest).toBe(true);
  });

  it('does not test while it is asking what the test costs, or with a rule that cannot run', async () => {
    const kept = made('Plot');
    const { bench, recipe, calls } = open({ checks: [kept] });
    bench.select(kept.id);
    await bench.test();                            // still asking what it costs
    expect(calls.filter(([url]) => url.endsWith('/check'))).toHaveLength(0);
    await settle();
    recipe.rules = [];
    await bench.test();
    expect(bench.blocked).toBe('Add a rule.');
    expect(calls.filter(([url]) => url.endsWith('/check'))).toHaveLength(0);
  });

  it('says what went wrong in the engine’s words', async () => {
    const { bench } = await ready({ answers: { '/api/compare/analyzers/check': new Error('Copernicus could not be reached') } });
    await bench.test();
    expect(bench.last.error).toBe('Copernicus could not be reached');
    expect(bench.testing).toBe(false);
    expect(bench.detail).toBe(null);
  });

  it('tests every check, one after the other, and draws only the one on the bench', async () => {
    const one = made('One');
    const two = made('Two', [{ point: REEF, expect: 'empty' }]);
    const { bench, recipe, calls } = open({ checks: [one, two] });
    bench.select(one.id);
    await settle();
    const all = bench.testAll();
    await Promise.resolve();
    expect(bench.running).toBe('Testing 1 of 2…');
    await all;
    expect(bench.running).toBe('');
    const tests = calls.filter(([url]) => url.endsWith('/check'));
    expect(tests.map(([, body]) => [body.check.id, body.detail])).toEqual([[one.id, true], [two.id, false]]);
    expect(recipe.checks.map((check) => check.result?.signature)).toEqual([signature(recipe), signature(recipe)]);
    expect(bench.detail).not.toBe(null);
  });

  it('holds Test all while layers are checked and explains a missing data source', async () => {
    let release;
    const state = $state({ layers: [{ id: 'SWIR' }], layersSource: 'instance',
      loadLayers: vi.fn(() => new Promise((resolve) => { release = resolve; })) });
    const { bench, calls, say } = open({ checks: [made('Plot')], layerState: state });
    const pending = bench.testAll();
    expect(bench.running).toBe('Checking layers…');
    await bench.testAll();
    expect(state.loadLayers).toHaveBeenCalledTimes(1);
    release(true); await pending;
    expect(bench.running).toBe('');
    expect(say).toHaveBeenCalledWith(expect.stringContaining('TRUE_COLOR'), 'warn');
    expect(calls.filter(([url]) => url.endsWith('/check'))).toHaveLength(0);
  });
});

describe('a point of the ground', () => {
  it('says why nothing is read where nothing has been', async () => {
    const { bench } = open();
    await bench.probeAt({ lon: 2, lat: 48 });
    expect(bench.probe).toBe(null);                    // no check, nothing to read against
    bench.startDraft();
    await bench.probeAt({ lon: 2, lat: 48 });
    expect(bench.probe.unread).toBe('passes');
    bench.setPass('b', { date: '2023-08-13' });
    bench.setPass('a', { date: '2023-08-08' });
    await bench.probeAt({ lon: 2, lat: 48 });
    expect(bench.probe.unread).toBe('frames');
  });

  it('reads every rule at the point once the check has been tested, and drops a pin from it', async () => {
    const kept = made('Plot');
    const { bench, calls } = open({ checks: [kept] });
    bench.select(kept.id);
    await settle();
    await bench.test();
    await bench.probeAt({ lon: 2.02, lat: 48.02 });
    const [url, body] = calls.at(-1);
    expect(url).toBe('/api/compare/analyzers/probe');
    expect(body.point).toEqual([2.02, 48.02]);
    expect(bench.probe.result.kept).toBe(true);
    bench.markProbe('empty');
    expect(bench.marks.at(-1)).toEqual({ point: [2.02, 48.02], expect: 'empty' });
    expect(bench.probe).toBe(null);
  });

  it('reads the ground under a pin, which is then the pin the card is about', async () => {
    const kept = made('Plot');
    const { bench, calls } = open({ checks: [kept] });
    bench.select(kept.id);
    await settle();
    await bench.test();
    await bench.probePin(0);
    expect(calls.at(-1)[1].point).toEqual(PLOT);
    expect(bench.probe).toMatchObject({ pin: 0, point: { lon: PLOT[0], lat: PLOT[1] } });
    await bench.probePin(7);                          // no such pin: nothing changes
    expect(bench.probe.pin).toBe(0);
    await bench.probeAt({ lon: 2, lat: 48 });
    expect(bench.probe.pin).toBe(null);
  });

  it('forgets a reading that comes back after it was closed', async () => {
    const kept = made('Plot');
    let release;
    const { bench } = open({ checks: [kept], answers: { '/api/compare/analyzers/probe': () => new Promise((resolve) => { release = resolve; }) } });
    bench.select(kept.id);
    await settle();
    await bench.test();
    const reading = bench.probeAt({ lon: 2, lat: 48 });
    bench.closeProbe();
    release({ ready: true, rules: [] });
    await reading;
    expect(bench.probe).toBe(null);
  });
});

describe('a day picked from the calendar', () => {
  const june = { dates: [{ date: '2026-06-03', cloud: 5, coverage: 1 }, { date: '2026-06-18', cloud: 40, coverage: 1 }] };

  it('asks for a month once, over the middle of the map, and keeps the answer', async () => {
    const { bench, calls } = open({ answers: { '/api/satellite/sentinel/acquisitions': june } });
    bench.startDraft();
    bench.openCalendar('b');
    expect(bench.calendar).toMatchObject({ side: 'b', list: [] });
    await bench.loadMonth('2026-06');
    const [url, body] = calls[0];
    expect(url).toBe('/api/satellite/sentinel/acquisitions');
    expect(body).toMatchObject({ collection: 'sentinel2', start: '2026-06-01', end: expect.stringMatching(/^2026-06-(30|\d\d)$/) });
    expect(bench.calendar.list).toHaveLength(2);
    expect(bench.calendar.busy).toBe(false);
    // the same month again costs nothing, and another month is asked for
    await bench.loadMonth('2026-06');
    expect(calls).toHaveLength(1);
    await bench.loadMonth('2026-05');
    expect(calls).toHaveLength(2);
    expect(calls[1][1].start).toBe('2026-05-01');
    expect(calls[1][1].end).toBe('2026-05-31');
  });

  it('holds a month read for radar apart from one read for optical, and says what went wrong', async () => {
    const radar = open({ sensor: 'sentinel1', answers: { '/api/satellite/sentinel/acquisitions': new Error('Copernicus could not be reached') } });
    radar.bench.startDraft();
    radar.bench.openCalendar('a');
    await radar.bench.loadMonth('2026-06');
    expect(radar.calls[0][1].collection).toBe('sentinel1');
    expect(radar.bench.calendar).toMatchObject({ error: 'Copernicus could not be reached', busy: false });
  });

  it('takes a pass from the calendar as that side of the check and closes', () => {
    const { bench } = open();
    bench.startDraft();
    bench.openCalendar('b');
    bench.pickFromCalendar('b', { date: '2026-06-18', cloud: 40 });
    expect(bench.check.b).toMatchObject({ date: '2026-06-18', provider: 'sentinel2' });
    expect(bench.calendar.side).toBe('');
    bench.typeDay('a', '2026-06-03');
    expect(bench.check.a.date).toBe('2026-06-03');
    bench.typeDay('a', '');                        // a cleared field changes nothing
    expect(bench.check.a.date).toBe('2026-06-03');
    expect(bench.dated).toBe(true);
  });

  it('offers only the days that keep the passes in order', () => {
    const { bench } = open();
    bench.startDraft();
    bench.setPass('b', { date: '2026-06-10' });
    const before = bench.eligible('a');
    expect(before({ date: '2026-06-03' })).toBe(true);
    expect(before({ date: '2026-06-18' })).toBe(false);
    bench.setPass('a', { date: '2026-06-03' });
    const after = bench.eligible('b');
    expect(after({ date: '2026-06-18' })).toBe(true);
    expect(after({ date: '2026-05-30' })).toBe(false);
  });

  it('looks up the recent passes only for a window of days, never for the calendar', async () => {
    const { bench, calls } = open();
    bench.setLookback('dates');
    await bench.lookUpPasses();
    expect(calls).toHaveLength(0);
    expect(bench.passes.lookback).toBe('dates');
    bench.openCalendar('a');
    bench.setLookback(30);
    expect(bench.calendar.side).toBe('');
    await bench.lookUpPasses();
    expect(calls).toHaveLength(1);
  });
});

describe('the room the console takes', () => {
  it('starts with none, for a card to keep clear of', () => {
    const { bench } = open();
    expect(bench.reach).toBe(0);
  });
});

describe('the keyboard and the split', () => {
  it('lets go of the reading first, then of the armed pin, and says when it had nothing to do', async () => {
    const kept = made('Plot');
    const { bench } = open({ checks: [kept] });
    bench.select(kept.id);
    bench.arm('found');
    await bench.probeAt({ lon: 2, lat: 48 });
    expect(bench.escape()).toBe(true);
    expect(bench.probe).toBe(null);
    expect(bench.pinning).toBe('found');
    expect(bench.escape()).toBe(true);
    expect(bench.pinning).toBe(null);
    expect(bench.escape()).toBe(false);
  });

  it('keeps the split on the map', () => {
    const { bench } = open();
    expect(bench.divider).toBe(50);
    bench.setDivider(130);
    expect(bench.divider).toBe(100);
    bench.setDivider(-5);
    expect(bench.divider).toBe(0);
    bench.setLookback(365);
    expect(bench.passes.lookback).toBe(365);
  });
});

describe('the rules on the map', () => {
  it('opens and closes each rule’s eye, and opens the one pressed while the detections stand alone', () => {
    const { bench, recipe } = open();
    recipe.rules = [newRule('index', 'change'), newRule('index', 'a'), newRule('band', 'b')];
    expect([0, 1, 2].map((i) => bench.painted(i))).toEqual([true, true, true]);
    bench.toggleRule(1);
    expect([0, 1, 2].map((i) => bench.painted(i))).toEqual([true, false, true]);
    bench.view = 'detections';
    expect([0, 1, 2].map((i) => bench.painted(i))).toEqual([false, false, false]);
    bench.toggleRule(1);
    expect(bench.view).toBe('rules');
    expect([0, 1, 2].map((i) => bench.painted(i))).toEqual([true, true, true]);
  });

  it('shows the rule the pointer is on alone, unless its eye is shut', () => {
    const { bench, recipe } = open();
    recipe.rules = [newRule('index', 'change'), newRule('index', 'a')];
    bench.hoverRule(1);
    expect(bench.hovered).toBe(1);
    bench.toggleRule(1);
    expect(bench.hovered).toBe(null);             // hidden stays hidden while the pointer is on its row
    bench.hoverRule(null);
    expect(bench.hovered).toBe(null);
  });

  it('keeps an eye with its rule when one is removed or moved up', () => {
    const { bench, recipe } = open();
    recipe.rules = [newRule('index', 'change'), newRule('index', 'a'), newRule('band', 'b')];
    bench.toggleRule(2);
    bench.rulesReordered([2, 0, 1]);
    expect([0, 1, 2].map((i) => bench.isShown(i))).toEqual([false, true, true]);
    bench.hoverRule(1);
    recipe.rules = recipe.rules.filter((_, i) => i !== 0);
    bench.ruleRemoved(0);
    expect(bench.hover).toBe(null);
    expect([0, 1].map((i) => bench.isShown(i))).toEqual([true, true]);
  });
});

describe('the passes a lookup finds', () => {
  it('looks round the middle of the map, for the satellite the analyzer reads', async () => {
    const { bench, calls } = open();
    await bench.lookUpPasses(30);
    const [url, body] = calls[0];
    expect(url).toBe('/api/satellite/sentinel/acquisitions');
    expect(body.collection).toBe('sentinel2');
    expect(body.zones[0].points).toEqual([[2, 48.2], [2.2, 48]]);
    expect(bench.passes).toMatchObject({ searched: true, busy: false, lookback: 30 });
    expect(bench.passes.list[0].date).toBe('2023-08-13');
    const radar = open({ sensor: 'sentinel1' });
    await radar.bench.lookUpPasses();
    expect(radar.calls[0][1].collection).toBe('sentinel1');
  });

  it('says what went wrong and is not left reading', async () => {
    const { bench } = open({ answers: { '/api/satellite/sentinel/acquisitions': new Error('Copernicus could not be reached') } });
    await bench.lookUpPasses();
    expect(bench.passes).toMatchObject({ error: 'Copernicus could not be reached', busy: false, searched: false });
  });

  it('holds a wide view to the ground round its middle', () => {
    expect(lookupBounds({ west: 0, south: 40, east: 10, north: 50 })).toEqual({ west: 4.85, south: 44.85, east: 5.15, north: 45.15 });
    expect(lookupBounds(VIEW)).toEqual(VIEW);
    const corner = lookupBounds({ west: 179.9, south: 84.9, east: 181, north: 86 });
    expect(corner.east).toBe(180);                               // never past what the engine accepts
    expect(corner.north).toBe(85);
    expect(lookupBounds(null)).toBe(null);
  });
});

it('offers a layer written in Azimut as a display, and says it is yours', () => {
  // the bench reads the same list every map tab does, so a script written on
  // the Satellite map is on the analyzer's Display menu without a request
  const offered = displayLayers(
    [{ id: 'TRUE_COLOR', label: 'True colour' }, { id: 'PLUME_SWIR', label: 'My plume', custom: true }],
    false
  );
  const mine = offered.find((entry) => entry.id === 'PLUME_SWIR');
  expect(mine.enabled).toBe(true);
  expect(mine.custom).toBe(true);
});

describe('a rule drawn as imagery', () => {
  /** A bench on a check, with a display the catalogue serves. */
  const bench0 = () => {
    const state = $state({ layers: [{ id: 'TRUE_COLOR' }, { id: 'SWIR' }], layersSource: 'instance',
      loadLayers: vi.fn(async () => true) });
    const kept = made('Plot');
    const found = open({ checks: [kept], layerState: state });
    found.bench.select(kept.id);
    flushSync();
    return found;
  };

  it('puts the rule\u2019s own arithmetic on the map, and gives the display back after', async () => {
    const { bench, api } = bench0();
    expect(bench.imagery.b.layer).toBe('TRUE_COLOR');

    await bench.showRule(0);                    // the default rule measures brightness
    flushSync();
    const [url, body] = api.put.mock.calls[0];
    expect(url).toBe('/api/satellite/sentinel/draft-layer');
    expect(body.script).toContain('(p.B02 + p.B03 + p.B04) / 3');
    expect(body.base).toBe('TRUE_COLOR');       // a script needs a data source, never radar
    // the draft is what the map draws, while the chosen display waits underneath
    expect(bench.shownLayer).toBe(DRAFT);
    expect(bench.imagery.b.layer).toBe(DRAFT);
    expect(bench.layer).toBe('TRUE_COLOR');

    bench.hideRule();
    flushSync();
    expect(bench.shownLayer).toBe('TRUE_COLOR');
    expect(bench.imagery.b.layer).toBe('TRUE_COLOR');
  });

  it('draws nothing for a rule that is not one quantity', async () => {
    const { bench, recipe, api } = bench0();
    recipe.rules = [newRule('class', 'b')];
    flushSync();
    await bench.showRule(0);
    expect(api.put).not.toHaveBeenCalled();
    expect(bench.ruleLayer).toBe(null);
  });

  it('pressing the same rule again lets it go', async () => {
    const { bench } = bench0();
    await bench.showRule(0); flushSync();
    expect(bench.ruleLayer.index).toBe(0);
    await bench.showRule(0); flushSync();
    expect(bench.ruleLayer).toBe(null);
  });

  it('choosing a display is choosing what the map draws, so it ends the drawing', async () => {
    const { bench } = bench0();
    await bench.showRule(0); flushSync();
    expect(bench.shownLayer).toBe(DRAFT);
    bench.setLayer('SWIR');
    flushSync();
    expect(bench.ruleLayer).toBe(null);
    expect(bench.shownLayer).toBe('SWIR');
  });

  it('removing the rule removes what it was drawing', async () => {
    const { bench, recipe } = bench0();
    recipe.rules = [newRule('brightness', 'b'), newRule('brightness', 'b')];
    flushSync();
    await bench.showRule(0); flushSync();
    recipe.rules = [recipe.rules[1]];
    bench.ruleRemoved(0);
    flushSync();
    expect(bench.ruleLayer).toBe(null);
  });
});

describe('moving a line without asking again', () => {
  /** A bench on a tested check, which is what a reading needs. */
  async function tested() {
    const found = open({ checks: [made('The plot')] });
    found.bench.select(found.recipe.checks[0].id);
    flushSync();
    await settle();
    await found.bench.test();
    await settle();
    return found;
  }

  it('fetches one rule’s reading, once, and never the imagery with it', async () => {
    const { bench, api, calls } = await tested();
    expect(bench.isLive(0)).toBe(false);
    await bench.loadReading(0);
    flushSync();
    expect(bench.isLive(0)).toBe(true);
    const asked = calls.filter(([url]) => url.endsWith('/check/values'));
    expect(asked).toHaveLength(1);
    // the route reads the cache the test filled; nothing says `read`
    expect(asked[0][1].rule).toBe(0);
    expect(asked[0][1].read).toBeUndefined();

    // asking again while it still answers costs nothing
    await bench.loadReading(0);
    expect(calls.filter(([url]) => url.endsWith('/check/values'))).toHaveLength(1);
    expect(api.post).toBeDefined();
  });

  it('keeps the reading while only the line moves, and drops it when the bands change', async () => {
    const { bench, recipe } = await tested();
    await bench.loadReading(0);
    flushSync();

    // the line is the one thing a reading does not answer for
    recipe.rules[0] = { ...recipe.rules[0], value: 0.42 };
    flushSync();
    expect(bench.isLive(0)).toBe(true);
    expect(bench.live.map((row) => row.index)).toEqual([0]);

    // what it reads is
    recipe.rules[0] = { ...recipe.rules[0], measure: 'nd', bands: ['B12', 'B11'] };
    flushSync();
    expect(bench.isLive(0)).toBe(false);
    expect(bench.live).toEqual([]);
  });

  it('stops calling the picture old when the only change is a line it can redraw', async () => {
    const { bench, recipe } = await tested();
    expect(bench.stale).toBe(false);
    await bench.loadReading(0);
    flushSync();

    // the line moved: the verdict below is older, but the ground is redrawn
    // from the very numbers the test measured, so the layer is not dimmed
    recipe.rules[0] = { ...recipe.rules[0], value: 0.42 };
    flushSync();
    expect(bench.stale).toBe(true);
    expect(bench.staleToDraw).toBe(false);

    // a second rule whose reading nobody has asked for does dim it
    recipe.rules = [...recipe.rules, newRule('band', 'b')];
    flushSync();
    expect(bench.staleToDraw).toBe(true);
  });

  it('calls the picture old when what a rule reads changes, reading or not', async () => {
    const { bench, recipe } = await tested();
    await bench.loadReading(0);
    flushSync();
    recipe.rules[0] = { ...recipe.rules[0], measure: 'nd', bands: ['B12', 'B11'] };
    flushSync();
    expect(bench.staleToDraw).toBe(true);
  });

  it('asks for nothing before a test, and nothing for a ground class', async () => {
    const { bench, recipe, calls } = open({ checks: [made('The plot')] });
    bench.select(recipe.checks[0].id); flushSync(); await settle();
    // no test has read the frames, so there is nothing cached to read back
    await bench.loadReading(0);
    expect(calls.filter(([url]) => url.endsWith('/check/values'))).toEqual([]);

    await bench.test(); await settle();
    recipe.rules = [newRule('class', 'b')];
    flushSync();
    await bench.loadReading(0);
    expect(calls.filter(([url]) => url.endsWith('/check/values'))).toEqual([]);
  });
});
