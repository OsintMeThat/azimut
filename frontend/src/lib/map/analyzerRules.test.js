import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARAMETERS, KEPT_BIT, MEASURED_BIT, describeReading, describeRecipe, describeRule, formatShare,
  formatValue, fromDifference, newRecipe, newRule, opsFor, paintMask, productCount, recipeBands,
  recipeCapability, recipeProblem, retarget, scaleOf, signalOf, toEngine,
  checkState, checksSummary, describeChecks, describeOutcome, markOutcomes, newCheck, signature, withMark, withoutMark,
  clipToBounds, insideBounds,
} from './analyzerRules.js';
import { changeSettings } from './changeAssist.js';
import { toMercator } from './groundFrame.js';

const METHODS = [
  { id: 'rules', single: false, clouds: true, sensor: 'sentinel2', frames: 4, sizes: { medium: { min_area: 2000, cleanup: 1 } }, rules: true },
  { id: 'sar-change', single: false, clouds: false, sensor: 'sentinel1', frames: 4, sizes: { medium: { smoothing: 2 } }, smoothing_m: 45 },
  { id: 'vessels', single: true, clouds: true, sensor: 'sentinel2', frames: 2 },
];

const recipe = (...rules) => ({ ...newRecipe(METHODS), rules });

describe('a new rule', () => {
  it('starts on the published line for what it measures', () => {
    expect(newRule('index', 'change')).toMatchObject({ op: 'le', value: -0.25, index: 'ndvi' });
    expect(newRule('index', 'change', { index: 'nbr' })).toMatchObject({ op: 'le', value: -0.27 });
    expect(newRule('index', 'b', { index: 'mndwi' })).toMatchObject({ op: 'ge', value: 0 });
    expect(newRule('radar', 'change')).toMatchObject({ op: 'moved', value: 3 });
    // a colour distance and a ground class only make sense one way
    expect(newRule('colour', 'b').on).toBe('change');
    expect(newRule('class', 'change')).toMatchObject({ on: 'b', op: 'is', classes: ['water'] });
    // a line named outright is the line it keeps
    expect(newRule('index', 'change', { value: -0.3 })).toMatchObject({ op: 'le', value: -0.3 });
    expect(newRule('index', 'b', { index: 'nbr', op: 'le', value: 0.1 })).toMatchObject({ op: 'le', value: 0.1 });
  });

  it('carries every field the engine model spells', () => {
    expect(Object.keys(newRule()).sort()).toEqual(
      ['around', 'band', 'bands', 'classes', 'index', 'measure', 'on', 'op', 'polarisation', 'upper', 'value']);
  });

  it('moves to the new quantity’s line when what or when changes, and keeps the rest', () => {
    const loss = newRule('index', 'change');
    expect(retarget(loss, { on: 'a' })).toMatchObject({ on: 'a', op: 'ge', value: 0.4 });
    expect(retarget(loss, { measure: 'band' })).toMatchObject({ measure: 'band', op: 'moved', value: 0.05 });
    const tuned = retarget(loss, { value: -0.4 });
    expect(tuned.value).toBe(-0.4);
    expect(retarget(tuned, { op: 'between' }).upper).toBeGreaterThan(-0.4);
    expect(retarget(tuned, { op: 'moved' }).value).toBe(0.4);
    expect(retarget(newRule('index', 'b'), { measure: 'class' })).toMatchObject({ on: 'b', op: 'is' });
  });

  it('offers only the comparisons that mean something', () => {
    expect(opsFor(newRule('index', 'b')).map(([id]) => id)).toEqual(['ge', 'le', 'between']);
    expect(opsFor(newRule('index', 'change')).map(([id]) => id)).toContain('moved');
    expect(opsFor(newRule('class', 'b')).map(([id]) => id)).toEqual(['is', 'not']);
  });
});

describe('values and scales', () => {
  it('shows reflectance in percent and keeps the engine in fractions', () => {
    const band = newRule('band', 'b');
    expect(scaleOf(band)).toMatchObject({ factor: 100, suffix: '%', min: 0, max: 100 });
    expect(formatValue(band, 0.253)).toBe('25.3%');
    expect(toEngine(band, 25.3)).toBe(0.253);
    const change = newRule('index', 'change');
    expect(formatValue(change, -0.312, { signed: true })).toBe('−0.31');
    expect(formatValue(change, 0.1, { signed: true })).toBe('+0.10');
    expect(formatValue(newRule('radar', 'b'), -4)).toBe('−4.0 dB');
    expect(formatValue(change, null)).toBe('–');
  });
});

describe('what a recipe reads', () => {
  it('counts the bands and the requests its rules cost', () => {
    const built = recipe(newRule('index', 'change', { index: 'bsi' }), newRule('band', 'b', { band: 'B12' }));
    expect(recipeBands(built)).toEqual(['B02', 'B04', 'B08', 'B11', 'B12']);
    expect(productCount(built)).toBe(2);
    expect(recipeCapability(built, METHODS)).toMatchObject({ single: false, sensor: 'sentinel2', clouds: true, frames: 6 });
  });

  it('reads one date when every rule is on B, and radar when a rule is', () => {
    const present = recipe(newRule('band', 'b'));
    expect(recipeCapability(present, METHODS)).toMatchObject({ single: true, frames: 2 });
    const radar = recipe(newRule('radar', 'change'));
    expect(recipeCapability(radar, METHODS)).toMatchObject({
      sensor: 'sentinel1', clouds: false, smoothing_m: 45, sizes: { medium: { smoothing: 2 } } });
    // a built-in keeps what the catalogue says of its method
    expect(recipeCapability({ method: 'vessels' }, METHODS)).toBe(METHODS[2]);
  });

  it('says why it cannot run before the engine has to', () => {
    expect(recipeProblem(recipe())).toMatch(/Add a rule/);
    expect(recipeProblem(recipe(newRule('index', 'change'), newRule('radar', 'change')))).toMatch(/two satellites/);
    expect(recipeProblem(recipe({ ...newRule('nd', 'b'), bands: ['B08', 'B08'] }))).toMatch(/two different bands/);
    const wide = recipe(...['B01', 'B03', 'B05', 'B07'].map((first, i) => newRule('nd', 'b', { bands: [first, ['B02', 'B04', 'B06', 'B8A'][i]] })));
    expect(recipeProblem(wide, { max_bands: 6 })).toMatch(/at most 6 bands/);
    expect(recipeProblem(recipe(newRule()))).toBe('');
  });

  it('ranks by the first rule that measures something', () => {
    expect(signalOf(recipe(newRule('class', 'b'), newRule('index', 'change')))).toBe(1);
    expect(signalOf(recipe(newRule('class', 'b')))).toBe(-1);
  });
});

describe('the words', () => {
  it('reads each rule as a clause', () => {
    expect(describeRule(newRule('index', 'change'))).toBe('NDVI dropped by 0.25 or more');
    expect(describeRule(newRule('index', 'change', { index: 'mndwi' }))).toBe('MNDWI rose by 0.25 or more');
    expect(describeRule(newRule('index', 'a'))).toBe('NDVI on A at least 0.40');
    expect(describeRule(newRule('band', 'b', { band: 'B12' }))).toBe('B12 (short-wave 2.2 µm) on B at least 25.0%');
    expect(describeRule({ ...newRule('band', 'b'), around: 150, value: 0.08 }))
      .toBe('B08 (near infrared) on B at least +8.0% against the ground within 150 m');
    expect(describeRule({ ...newRule('class', 'b'), classes: ['water', 'bare'], op: 'not' }))
      .toBe('ground on B is not water or bare ground');
    expect(describeRule(newRule('nd', 'b', { bands: ['B8A', 'B11'] }))).toMatch(/^NDMI on B/);
    expect(describeRule(newRule('radar', 'change'))).toBe('VV moved by 3.0 dB or more either way');
  });

  it('reads the whole analyzer as one sentence', () => {
    const built = recipe(newRule('index', 'change'), newRule('index', 'a'));
    expect(describeRecipe(built)).toBe('Keeps ground where NDVI dropped by 0.25 or more and NDVI on A at least 0.40, outside cloud.');
    expect(describeRecipe({ ...built, match: 'any' })).toMatch(/or NDVI on A/);
  });

  it('words a candidate from its signal rule', () => {
    const built = recipe(newRule('class', 'b'), newRule('index', 'change'));
    expect(describeReading(built, { before: 0.81, after: 0.12, signed: -0.69 })).toBe('NDVI 0.81 → 0.12 (−0.69)');
    expect(describeReading(recipe(newRule('band', 'b')), { value: 0.31 })).toBe('B08 (near infrared) 31.0%');
    expect(describeReading(recipe(newRule('class', 'b')), { value: 1 })).toBe('');
  });

  it('prints the funnel’s shares without false precision', () => {
    expect(formatShare(0)).toBe('0 %');
    expect(formatShare(0.0004)).toBe('< 0.1 %');
    expect(formatShare(0.0123)).toBe('1.2 %');
    expect(formatShare(0.5)).toBe('50 %');
  });
});

describe('from Difference', () => {
  it('turns an index reading into the same rule, cleanup and sky', () => {
    const settings = changeSettings({ method: 'index', index: 'nbr', sensitivity: 50, classes: ['loss'],
      min_area: 400, cleanup: 2, smoothing: 4, ignore_clouds: true, ignore_shadows: true, cloud_margin: 50 });
    const built = fromDifference(settings);
    expect(built.method).toBe('rules');
    expect(built.rules[0]).toMatchObject({ measure: 'index', index: 'nbr', on: 'change', op: 'le' });
    expect(built.rules[0].value).toBeLessThan(0);
    expect(built.parameters).toMatchObject({ min_area: 400, cleanup: 2, smoothing: 3, ignore_clouds: true, cloud_margin: 5 });
    expect(built.name).toBe('NBR: Burnt');
    expect(fromDifference({ ...settings, classes: ['gain', 'loss', 'changed'] }).rules[0].op).toBe('moved');
    expect(Object.keys(built.parameters).sort()).toEqual(Object.keys(DEFAULT_PARAMETERS).sort());
  });
});

describe('the preview mask', () => {
  it('paints each shown rule in its colour and a hovered one alone', () => {
    const bits = new Uint8Array([0, 1 << MEASURED_BIT, 0b1 | (1 << MEASURED_BIT), 0b11 | (1 << KEPT_BIT)]);
    const colours = ['#ff0000', '#00ff00'];
    const both = paintMask(bits, { shown: [true, true], colours });
    expect([...both.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect([...both.slice(4, 8)]).toEqual([0, 0, 0, 0]);      // measured, nothing passed
    expect([...both.slice(8, 11)]).toEqual([255, 0, 0]);
    expect([...both.slice(12, 15)]).toEqual([0, 255, 0]);     // the later rule on top
    const first = paintMask(bits, { shown: [true, false], colours });
    expect([...first.slice(12, 15)]).toEqual([255, 0, 0]);
    const hovered = paintMask(bits, { shown: [true, true], hover: 0, colours });
    expect(hovered[15]).toBeGreaterThan(both[15]);
    expect([...hovered.slice(12, 15)]).toEqual([255, 0, 0]);
  });
});

describe('layers', () => {
  it('suggests the layer that shows what a rule reads, among those on offer', async () => {
    const { suggestedLayer } = await import('./analyzerRules.js');
    const offered = ['TRUE_COLOR', 'FALSE_COLOR', 'SWIR', 'NDVI'].map((id) => ({ id }));
    expect(suggestedLayer(newRule('index', 'change'), offered)).toBe('NDVI');
    expect(suggestedLayer(newRule('index', 'change', { index: 'nbr' }), offered)).toBe('SWIR');
    expect(suggestedLayer(newRule('index', 'b', { index: 'mndwi' }), offered)).toBe('FALSE_COLOR');
    expect(suggestedLayer(newRule('band', 'b', { band: 'B12' }), offered)).toBe('SWIR');
    expect(suggestedLayer(newRule('colour', 'change'), offered)).toBe('TRUE_COLOR');
    expect(suggestedLayer(newRule('class', 'b'), offered)).toBe('TRUE_COLOR');
    expect(suggestedLayer(newRule('index', 'b', { index: 'mndwi' }), [...offered, { id: 'NDWI' }])).toBe('NDWI');
    expect(suggestedLayer(null, offered)).toBe('TRUE_COLOR');
  });
});

describe('checks', () => {
  const place = { west: 2, south: 48, east: 2.02, north: 48.02 };
  const pass = (date) => ({ provider: 'sentinel2', date, layer: 'SWIR' });

  it('reads the same signature whatever order the recipe’s keys come in', () => {
    const built = recipe(newRule('index', 'change'));
    const reordered = { ...built, parameters: Object.fromEntries(Object.entries(built.parameters).reverse()),
      rules: built.rules.map((rule) => Object.fromEntries(Object.entries(rule).reverse())) };
    expect(signature(reordered)).toBe(signature(built));
    expect(signature(built)).toMatch(/^[0-9a-z]{1,32}$/);
    // what reads differently signs differently; the name does not read at all
    expect(signature({ ...built, match: 'any' })).not.toBe(signature(built));
    expect(signature({ ...built, rules: [{ ...built.rules[0], value: -0.3 }] })).not.toBe(signature(built));
    expect(signature({ ...built, name: 'Renamed' })).toBe(signature(built));
  });

  it('keeps the view and passes it was saved on, and grows to hold a mark', () => {
    const check = newCheck({ name: 'Here', a: pass('2023-08-08'), b: pass('2023-08-13'), bounds: place });
    expect(check.id).toMatch(/^[a-zA-Z0-9_-]{1,48}$/);
    expect(check).toMatchObject({ name: 'Here', marks: [], result: null, b: { date: '2023-08-13', layer: 'SWIR' } });
    const marked = withMark({ ...check, result: { signature: 'x', count: 1, covered: [] } }, [2.05, 48.01], 'empty');
    expect(marked.marks).toEqual([{ point: [2.05, 48.01], expect: 'empty' }]);
    expect(marked.bounds.east).toBeGreaterThan(2.05);
    expect(marked.result).toBe(null);            // it answered for the marks it had
    expect(withoutMark(marked, 0).marks).toEqual([]);
  });

  it('says where each check stands, and when its answer is out of date', () => {
    const built = recipe(newRule('index', 'change'));
    const current = signature(built);
    const base = { ...newCheck({ name: 'Here', a: pass('2023-08-08'), b: pass('2023-08-13'), bounds: place }),
      marks: [{ point: [2.01, 48.01], expect: 'found' }, { point: [2.015, 48.01], expect: 'found' },
        { point: [2.005, 48.005], expect: 'empty' }] };
    const read = (covered, count = 3, sign = current) => ({ ...base, result: { signature: sign, count, covered } });
    expect(checkState(base, current)).toBe('unrun');
    expect(describeOutcome(base, current)).toBe('Not run yet');
    expect(checkState(read([true, true, false]), current)).toBe('pass');
    expect(describeOutcome(read([true, true, false]), current)).toBe('2 of 2 found · stayed empty');
    expect(checkState(read([true, false, true]), current)).toBe('fail');
    expect(describeOutcome(read([true, false, true]), current)).toBe('1 of 2 found · 1 of 1 flagged');
    expect(markOutcomes(read([true, false, true]))).toEqual([true, false, false]);
    expect(checkState(read([true, true, false], 3, 'old'), current)).toBe('stale');
    const counted = { ...base, marks: [], result: { signature: current, count: 12, covered: [] } };
    expect(checkState(counted, current)).toBe('counted');
    expect(describeOutcome(counted, current)).toBe('12 candidates');
  });

  it('sums up an analyzer’s checks for the library', () => {
    const built = recipe(newRule('index', 'change'));
    const current = signature(built);
    const check = (covered, sign = current) => ({ id: 'c', name: 'c', a: pass('2023-08-08'), b: pass('2023-08-13'),
      bounds: place, marks: [{ point: [2.01, 48.01], expect: 'found' }], result: covered ? { signature: sign, count: 1, covered } : null });
    expect(describeChecks(built)).toBe('');
    expect(describeChecks({ ...built, checks: [check(null), check(null)] })).toBe('2 checks · not run');
    expect(describeChecks({ ...built, checks: [check([true]), check([true])] })).toBe('2 checks · all pass');
    expect(describeChecks({ ...built, checks: [check([true]), check([false])] })).toBe('2 checks · 1 fails');
    expect(describeChecks({ ...built, checks: [check([true]), check([true], 'old')] })).toBe('2 checks · 1 pass');
    expect(checksSummary({ ...built, checks: [check([true]), check(null)] })).toMatchObject({ total: 2, pass: 1, waiting: 1 });
  });
});


describe('an open check keeps the preview to its frame', () => {
  // A 4x4 mask over a box of four degrees a side, every pixel painted.
  const [west, north] = toMercator(0, 4);
  const [east, south] = toMercator(4, 0);
  const box = { west, east, north, south };
  const painted = () => new Uint8ClampedArray(4 * 4 * 4).fill(255);
  const alphaAt = (rgba, x, y) => rgba[(y * 4 + x) * 4 + 3];

  it('clears every pixel outside the frame and keeps the ones inside', () => {
    // the frame covers the west half, full height
    const kept = clipToBounds(painted(), 4, 4, box, { west: 0, south: 0, east: 2, north: 4 });
    expect([0, 1].every((x) => [0, 1, 2, 3].every((y) => alphaAt(kept, x, y) === 255))).toBe(true);
    expect([2, 3].every((x) => [0, 1, 2, 3].every((y) => alphaAt(kept, x, y) === 0))).toBe(true);
  });

  it('keeps nothing when the frame is off the mask, and everything when it holds it', () => {
    const off = clipToBounds(painted(), 4, 4, box, { west: 10, south: 10, east: 12, north: 12 });
    expect(off.every((value) => value === 0)).toBe(true);
    const all = clipToBounds(painted(), 4, 4, box, { west: -1, south: -1, east: 5, north: 5 });
    expect(all.every((value) => value === 255)).toBe(true);
  });

  it('says whether a candidate stands inside the frame', () => {
    const frame = { west: 0, south: 0, east: 2, north: 4 };
    expect(insideBounds([1, 2], frame)).toBe(true);
    expect(insideBounds([3, 2], frame)).toBe(false);
    expect(insideBounds([1, 5], frame)).toBe(false);
  });
});
