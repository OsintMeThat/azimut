import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARAMETERS, KEPT_BIT, MEASURED_BIT, amountOf, describeReading, describeReads, describeRecipe, describeRule,
  describeWithout, directionOf, directionsFor, lineScale, shortRule, withAmount, withDirection,
  formatShare, formatValue, fromDifference, measuresFor, newRecipe, newRule, paintMask, passSource,
  pinTicks, productCount, readingRecipe, recipeBands, recipeCapability, recipeProblem, retarget, savingProblem,
  scaleOf, sideOf, signalOf, suggestedLayer, toEngine, whensFor,
  checkDated, checkKey, checkState, checksSummary, describeChecks, describeOutcome, marksBounds, markOutcomes,
  newCheck, signature, testedCheck, withFlippedMark, withMark, withoutMark,
} from './analyzerRules.js';
import { changeSettings } from './changeAssist.js';

const METHODS = [
  { id: 'rules', single: false, clouds: true, sensor: 'sentinel2', frames: 4, sizes: { medium: { min_area: 2000, cleanup: 1 }, all: { min_area: 0, cleanup: 0 } }, rules: true },
  { id: 'sar-change', single: false, clouds: false, sensor: 'sentinel1', frames: 4, sizes: { medium: { smoothing: 2 } }, smoothing_m: 45 },
  { id: 'vessels', single: true, clouds: true, sensor: 'sentinel2', frames: 2 },
];

// A recipe that has not said what it reads, as one saved before it did: the rules tell.
const recipe = (...rules) => {
  const { sensor, dates, ...rest } = newRecipe(METHODS);
  return { ...rest, rules };
};

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
});

describe('saying a rule’s line', () => {
  const labels = (rule) => directionsFor(rule).map(([, label]) => label);

  it('offers a change a drop, a rise or a move, and a state at least or at most', () => {
    expect(labels(newRule('index', 'change'))).toEqual(['Dropped', 'Rose', 'Either way', 'Between']);
    expect(labels(newRule('index', 'a'))).toEqual(['At least', 'At most', 'Between']);
    expect(labels(newRule('colour', 'change'))).toEqual(['At least', 'At most', 'Between']);
    expect(labels(newRule('class', 'b'))).toEqual(['Is', 'Is not']);
  });

  it('reads the direction off the operator and the sign, and back', () => {
    const drop = newRule('index', 'change');                          // at most -0.25
    expect(directionOf(drop)).toBe('drop');
    expect(directionOf({ ...drop, op: 'ge', value: 0.25 })).toBe('rise');
    expect(directionOf({ ...drop, op: 'moved', value: 0.25 })).toBe('moved');
    expect(directionOf({ ...drop, op: 'between', upper: 0 })).toBe('between');
    expect(directionOf(newRule('index', 'a'))).toBe('ge');
    expect(directionOf(newRule('class', 'b'))).toBe('is');
    const rise = withDirection(drop, 'rise');
    expect(rise).toMatchObject({ op: 'ge', value: 0.25 });
    expect(withDirection(rise, 'drop')).toMatchObject({ op: 'le', value: -0.25 });
    expect(withDirection(rise, 'moved')).toMatchObject({ op: 'moved', value: 0.25 });
    expect(withDirection(rise, 'between').upper).toBeGreaterThan(0.25);
    expect(withDirection(newRule('index', 'a'), 'le')).toMatchObject({ op: 'le', value: 0.4 });
  });

  it('sets a line by the size of the drop, and keeps the sign the direction needs', () => {
    const drop = newRule('index', 'change');
    expect(amountOf(drop)).toBe(0.25);
    expect(withAmount(drop, 0.4)).toBe(-0.4);
    expect(withAmount({ ...drop, op: 'ge' }, 0.4)).toBe(0.4);
    expect(amountOf({ ...drop, op: 'moved', value: 0.3 })).toBe(0.3);
    // a state, a colour distance and a range are the value itself
    expect(amountOf(newRule('index', 'a'))).toBe(0.4);
    expect(amountOf(newRule('colour', 'change'))).toBe(0.05);
    expect(withAmount({ ...drop, op: 'between', value: -0.4 }, -0.1)).toBe(-0.1);
  });

  it('runs a drop’s slider from nothing up, and a state’s across its whole range', () => {
    expect(lineScale(newRule('index', 'change'))).toMatchObject({ min: 0, max: 1 });
    expect(lineScale(newRule('band', 'change'))).toMatchObject({ min: 0, max: 50, suffix: '%' });
    expect(lineScale(newRule('radar', 'change'))).toMatchObject({ min: 0, max: 20 });
    expect(lineScale(newRule('index', 'a'))).toMatchObject({ min: -1, max: 1 });
    expect(lineScale({ ...newRule('index', 'change'), op: 'between', upper: 0 })).toMatchObject({ min: -1, max: 1 });
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

  it('keeps to what it declared when it was made, and works it out only when it never did', () => {
    const declared = newRecipe(METHODS, { sensor: 'sentinel1', dates: 'two' });
    expect(recipeCapability(declared, METHODS)).toMatchObject({ sensor: 'sentinel1', single: false, clouds: false });
    // one date, declared, whatever a rule says: the rules have to agree, not the other way round
    const one = { ...newRecipe(METHODS, { dates: 'one' }), rules: [newRule('band', 'change')] };
    expect(recipeCapability(one, METHODS).single).toBe(true);
    expect(recipeProblem(one)).toMatch(/no before pass for this rule/);
    const two = { ...newRecipe(METHODS), rules: [newRule('band', 'b')] };
    expect(recipeProblem(two)).toMatch(/before date or on the change/);
    expect(recipeProblem({ ...newRecipe(METHODS), rules: [newRule('radar', 'change')] })).toBe('Radar rules need a radar analyzer.');
    expect(recipeProblem({ ...declared, rules: [newRule('index', 'change')] })).toBe('Optical rules need a Sentinel-2 analyzer.');
    expect(describeReads(declared)).toBe('Sentinel-1 radar · two dates');
    expect(describeReads(newRecipe(METHODS, { dates: 'one' }))).toBe('Sentinel-2 · one date');
    expect(describeReads(recipe(newRule('band', 'b')))).toBe('Sentinel-2 · one date');
  });

  it('offers a rule only the measures and dates its analyzer can use', () => {
    expect(measuresFor(newRecipe(METHODS)).map((measure) => measure.id)).not.toContain('radar');
    expect(measuresFor(newRecipe(METHODS, { sensor: 'sentinel1' })).map((measure) => measure.id)).toEqual(['radar']);
    // a colour distance is a change, which one date does not have
    expect(measuresFor(newRecipe(METHODS)).map((measure) => measure.id)).toContain('colour');
    expect(measuresFor(newRecipe(METHODS, { dates: 'one' })).map((measure) => measure.id)).not.toContain('colour');
    const two = newRecipe(METHODS);
    expect(whensFor(two, newRule('index', 'b')).map(([id]) => id)).toEqual(['a', 'b', 'change']);
    expect(whensFor(two, newRule('class', 'b')).map(([id]) => id)).toEqual(['a', 'b']);
    expect(whensFor(two, newRule('colour', 'b')).map(([id]) => id)).toEqual(['change']);
    expect(whensFor(newRecipe(METHODS, { dates: 'one' }), newRule('index', 'b'))).toEqual([]);
    expect(whensFor(two, newRule('index', 'b')).map(([, label]) => label)).toEqual(['Before', 'After', 'Change']);
  });

  it('starts every kind of analyzer on a rule it can run', () => {
    for (const sensor of ['sentinel2', 'sentinel1']) {
      for (const dates of ['one', 'two']) {
        const made = newRecipe(METHODS, { sensor, dates });
        expect(recipeProblem(made), `${sensor} ${dates}`).toBe('');
        expect([made.sensor, made.dates]).toEqual([sensor, dates]);
      }
    }
    // radar starts from radar change's averaging, which is what keeps speckle from reading as a target
    expect(newRecipe(METHODS, { sensor: 'sentinel1' }).parameters.smoothing).toBe(0);
    const radarSizes = METHODS.map((method) => (method.id === 'sar-change' ? { ...method, sizes: { all: { smoothing: 2, min_area: 0 } } } : method));
    expect(newRecipe(radarSizes, { sensor: 'sentinel1' }).parameters.smoothing).toBe(2);
  });

  it('starts blank optical analyzers on brightness and true colour', () => {
    const two = newRecipe(METHODS);
    expect(two.rules[0]).toMatchObject({ measure: 'brightness', on: 'change', op: 'moved', value: 0.05 });
    expect(newRecipe(METHODS, { dates: 'one' }).rules[0]).toMatchObject({ measure: 'brightness', on: 'b', op: 'ge', value: 0.2 });
    expect(suggestedLayer(two.rules[0], [{ id: 'TRUE_COLOR' }, { id: 'NDVI' }])).toBe('TRUE_COLOR');
  });

  it('suggests actual configuration identifiers and skips disabled display products', () => {
    expect(suggestedLayer(newRule('index'), [{ id: 'TRUE_COLOR' }, { id: 'NDVI', enabled: false },
      { id: 'VEGETATION_INDEX' }])).toBe('VEGETATION_INDEX');
    expect(suggestedLayer(newRule('index'), [{ id: 'TRUE_COLOR' }, { id: 'NDVI', enabled: false }])).toBe('TRUE_COLOR');
    expect(suggestedLayer(newRule('index', 'b', { index: 'ndwi' }), [{ id: 'COLOR_INFRARED' }])).toBe('COLOR_INFRARED');
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
    expect(describeRule(newRule('index', 'a'))).toBe('NDVI before is at least 0.40');
    expect(describeRule(newRule('index', 'a'), { single: true })).toBe('NDVI is at least 0.40');
    expect(describeRule(newRule('band', 'b', { band: 'B12' }))).toBe('B12 (short-wave 2.2 µm) after is at least 25.0%');
    expect(describeRule({ ...newRule('band', 'b'), around: 150, value: 0.08 }))
      .toBe('B08 (near infrared) after is at least +8.0% against the ground within 150 m');
    expect(describeRule({ ...newRule('class', 'b'), classes: ['water', 'bare'], op: 'not' }))
      .toBe('ground after is not water or bare ground');
    expect(describeRule({ ...newRule('class', 'b'), classes: ['water'] }, { single: true })).toBe('ground is water');
    expect(describeRule(newRule('nd', 'b', { bands: ['B8A', 'B11'] }))).toMatch(/^NDMI after is/);
    expect(describeRule(newRule('radar', 'change'))).toBe('VV moved by 3.0 dB or more either way');
  });

  it('names a rule in a couple of words for its chip on the map', () => {
    expect(shortRule(newRule('index', 'change'))).toBe('NDVI change');
    expect(shortRule(newRule('index', 'a'))).toBe('NDVI before');
    expect(shortRule(newRule('band', 'b', { band: 'B12' }))).toBe('B12 after');
    expect(shortRule(newRule('nd', 'b', { bands: ['B8A', 'B11'] }))).toBe('NDMI after');
    expect(shortRule(newRule('nd', 'b', { bands: ['B02', 'B11'] }))).toBe('B02/B11 after');
    expect(shortRule(newRule('class', 'b'))).toBe('ground after');
    expect(shortRule(newRule('colour', 'change'))).toBe('colour change');
    expect(shortRule(newRule('radar', 'change', { polarisation: 'ratio' }))).toBe('VV − VH change');
    expect(shortRule(newRule('band', 'b', { band: 'B12' }), { single: true })).toBe('B12');
  });

  it('reads the whole analyzer as one sentence', () => {
    const built = recipe(newRule('index', 'change'), newRule('index', 'a'));
    expect(describeRecipe(built)).toBe('Keeps ground where NDVI dropped by 0.25 or more and NDVI before is at least 0.40, outside cloud.');
    expect(describeRecipe(recipe(newRule('band', 'b')))).toBe('Keeps ground where B08 (near infrared) is at least 25.0%, outside cloud.');
    expect(describeRecipe({ ...built, match: 'any' })).toMatch(/or NDVI before is/);
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
    expect([built.sensor, built.dates]).toEqual(['sentinel2', 'two']);
    expect(fromDifference({ ...settings, classes: ['gain', 'loss', 'changed'] }).rules[0].op).toBe('moved');
    expect(Object.keys(built.parameters).sort()).toEqual(Object.keys(DEFAULT_PARAMETERS).sort());
  });
});

describe('the test mask', () => {
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

  it('tints the ground a test measured, under the rules, and leaves cloud and missing imagery clear', () => {
    const bits = new Uint8Array([0, 1 << MEASURED_BIT, 0b1 | (1 << MEASURED_BIT)]);
    const tinted = paintMask(bits, { shown: [true], colours: ['#ff0000'], veil: 30 });
    expect([...tinted.slice(0, 4)]).toEqual([0, 0, 0, 0]);            // not measured: clear
    expect(tinted[7]).toBe(30);                                        // measured, no rule: the veil alone
    expect([...tinted.slice(8, 12)]).toEqual([255, 0, 0, 110]);        // a rule over the veil
    // no veil unless asked for, so the parts of a split map do not tint twice
    expect(paintMask(bits, { shown: [true], colours: ['#ff0000'] })[7]).toBe(0);
    // a rule hidden on the map leaves the veil
    expect(paintMask(bits, { shown: [false], colours: ['#ff0000'], veil: 30 })[11]).toBe(30);
  });

  it('puts a rule on the half of a split map it reads, and a change across both', () => {
    const before = newRule('index', 'a');
    const after = newRule('index', 'b');
    const change = newRule('index', 'change');
    expect([before, after, change].map((rule) => sideOf(rule, true))).toEqual(['before', 'after', 'shared']);
    expect([before, after, change].map((rule) => sideOf(rule, false))).toEqual(['shared', 'shared', 'shared']);
  });
});

describe('pins on a rule’s line', () => {
  const marks = [{ point: [2, 48], expect: 'found' }, { point: [2.01, 48], expect: 'empty' }, { point: [2.02, 48], expect: 'found' }];
  const readings = [
    { rules: [{ passes: true, value: -0.6 }] },
    { rules: [{ passes: false, value: -0.05 }] },
    { rules: [{ passes: true, value: -1.4 }] },
  ];

  it('places each pin’s reading along the slider, pinned to an end when it lies past it', () => {
    const rule = newRule('index', 'a');   // a state: the slider runs -1 to 1
    const ticks = pinTicks(rule, marks, readings, 0);
    expect(ticks.map((tick) => [tick.pin, tick.expect, tick.passes])).toEqual([[0, 'found', true], [1, 'empty', false], [2, 'found', true]]);
    expect(ticks[0].at).toBeCloseTo(0.2);
    expect(ticks[1].at).toBeCloseTo(0.475);
    expect(ticks[2]).toMatchObject({ at: 0, clipped: true });
    expect(ticks[0].clipped).toBe(false);
  });

  it('measures a drop by its size, so a pin where the ground rose sits at nothing', () => {
    const drop = newRule('index', 'change');                     // the slider runs 0 to 1
    const ticks = pinTicks(drop, marks, [{ rules: [{ value: -0.6 }] }, { rules: [{ value: 0.1 }] }, { rules: [{ value: -1.4 }] }], 0);
    expect(ticks[0]).toMatchObject({ at: expect.closeTo(0.6), clipped: false });
    expect(ticks[1]).toMatchObject({ at: 0, clipped: true });
    expect(ticks[2]).toMatchObject({ at: 1, clipped: true });
  });

  it('reads the size of a move either way, and in the units the slider shows', () => {
    const moved = { ...newRule('index', 'change'), op: 'moved', value: 0.2 };
    expect(pinTicks(moved, marks, readings, 0)[0].at).toBeCloseTo(0.6);          // |-0.6| on a 0 to 1 slider
    const band = newRule('band', 'b');                                          // percent, 0 to 100
    expect(pinTicks(band, [marks[0]], [{ rules: [{ passes: true, value: 0.25 }] }], 0)[0].at).toBeCloseTo(0.25);
  });

  it('draws nothing for a ground class, an unread pin or a reading off the ground', () => {
    expect(pinTicks(newRule('class', 'b'), marks, readings, 0)).toEqual([]);
    expect(pinTicks(newRule('index', 'change'), marks, [], 0)).toEqual([]);
    expect(pinTicks(newRule('index', 'change'), [marks[0]], [{ rules: [{ passes: false, value: null }] }], 0)).toEqual([]);
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
  const pass = (date) => ({ provider: 'sentinel2', date, layer: 'SWIR' });
  const pins = [{ point: [2.01, 48.01], expect: 'found' }, { point: [2.015, 48.01], expect: 'found' },
    { point: [2.005, 48.005], expect: 'empty' }];

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

  it('is its passes and its pins, with no frame of its own', () => {
    const check = newCheck({ name: 'Here', a: pass('2023-08-08'), b: pass('2023-08-13') });
    expect(check.id).toMatch(/^[a-zA-Z0-9_-]{1,48}$/);
    expect(check).toMatchObject({ name: 'Here', marks: [], result: null, b: { date: '2023-08-13', layer: 'SWIR' } });
    expect(check).not.toHaveProperty('bounds');
    const marked = withMark({ ...check, result: { signature: 'x', count: 1, covered: [] } }, [2.05, 48.01], 'empty');
    expect(marked.marks).toEqual([{ point: [2.05, 48.01], expect: 'empty' }]);
    expect(marked.result).toBe(null);            // it answered for the pins it had
    expect(withoutMark(marked, 0).marks).toEqual([]);
    const flipped = withFlippedMark(withMark(marked, [2.06, 48.01], 'found'), 0);
    expect(flipped.marks.map((mark) => mark.expect)).toEqual(['found', 'found']);
    // what it is made from is copied, so the pin on the map is not the one in the list
    const copied = newCheck({ name: 'Copy', marks: pins });
    copied.marks[0].point[0] = 0;
    expect(pins[0].point[0]).toBe(2.01);
  });

  it('tells a check from another by the passes and pins it is read on, and nothing else', () => {
    const one = newCheck({ name: 'One', a: pass('2023-08-08'), b: pass('2023-08-13'), marks: pins });
    expect(checkKey({ ...one, name: 'Renamed', id: 'other', result: { signature: 'x', count: 1, covered: [] } })).toBe(checkKey(one));
    expect(checkKey(withMark(one, [2.02, 48.02], 'found'))).not.toBe(checkKey(one));
    expect(checkKey({ ...one, b: pass('2023-08-14') })).not.toBe(checkKey(one));
    // how the passes are shown is not what is read
    expect(checkKey({ ...one, a: { ...one.a, layer: 'NDVI' }, b: { ...one.b, layer: 'NDVI' } })).toBe(checkKey(one));
    expect(testedCheck(one).result).toBe(null);
  });

  it('has the passes its analyzer reads', () => {
    const two = recipe(newRule('index', 'change'));
    const one = recipe(newRule('band', 'b'));
    const after = { b: pass('2023-08-13') };
    expect(checkDated(two, newCheck({ name: 'x', ...after }))).toBe(false);
    expect(checkDated(two, newCheck({ name: 'x', a: pass('2023-08-08'), ...after }))).toBe(true);
    expect(checkDated(one, newCheck({ name: 'x', ...after }))).toBe(true);
    expect(checkDated(one, newCheck({ name: 'x' }))).toBe(false);
  });

  it('turns a source into the pass the engine reads, in the layer it is shown in', () => {
    const optical = recipe(newRule('index', 'change'));
    expect(passSource(optical, { date: '2023-08-13' }, 'SWIR')).toEqual({ provider: 'sentinel2', date: '2023-08-13', layer: 'SWIR', maxcc: 100 });
    const radar = newRecipe(METHODS, { sensor: 'sentinel1' });
    expect(passSource(radar, { date: '2023-08-13', time: '05:30:12' }, 'SWIR')).toEqual({ provider: 'sentinel1', date: '2023-08-13', time: '05:30:12' });
    expect(passSource(radar, { date: '2023-08-13' })).toEqual({ provider: 'sentinel1', date: '2023-08-13', time: '' });
  });

  it('asks a test only for what reads, and frames the pins', () => {
    const built = { ...newRecipe(METHODS), name: 'Mine', description: 'x', colour: '#ff0000', checks: [{ id: 'a' }], rules: [newRule('index', 'change')] };
    expect(readingRecipe(built)).toEqual({ name: 'Test', method: 'rules', sensor: 'sentinel2', dates: 'two',
      rules: built.rules, match: 'all', parameters: built.parameters });
    const box = marksBounds(pins);
    expect(box.west).toBeLessThan(2.005);
    expect(box.east).toBeGreaterThan(2.015);
    const alone = marksBounds([pins[0]]);
    expect(alone.east - alone.west).toBeGreaterThan(0);
  });

  it('says where each check stands, and when its answer is out of date', () => {
    const built = recipe(newRule('index', 'change'));
    const current = signature(built);
    const base = newCheck({ name: 'Here', a: pass('2023-08-08'), b: pass('2023-08-13'), marks: pins });
    const read = (covered, count = 3, sign = current) => ({ ...base, result: { signature: sign, count, covered } });
    expect(checkState(base, current)).toBe('unrun');
    expect(describeOutcome(base, current)).toBe('Not tested yet');
    expect(checkState(read([true, true, false]), current)).toBe('pass');
    expect(describeOutcome(read([true, true, false]), current)).toBe('2 of 2 found · stayed empty');
    expect(checkState(read([true, false, true]), current)).toBe('fail');
    expect(describeOutcome(read([true, false, true]), current)).toBe('1 of 2 found · 1 of 1 flagged');
    expect(markOutcomes(read([true, false, true]))).toEqual([true, false, false]);
    expect(checkState(read([true, true, false], 3, 'old'), current)).toBe('stale');
    expect(describeOutcome(read([true, true, false], 3, 'old'), current)).toBe('Rules changed since its last test');
    // one saved with no pin, before a check was pins alone, cannot be tested until it has one
    const bare = { ...base, marks: [] };
    expect(checkState(bare, current)).toBe('unpinned');
    expect(describeOutcome(bare, current)).toBe('Needs a pin');
  });

  it('sums up an analyzer’s checks for the library', () => {
    const built = recipe(newRule('index', 'change'));
    const current = signature(built);
    const check = (covered, sign = current) => ({ id: 'c', name: 'c', a: pass('2023-08-08'), b: pass('2023-08-13'),
      marks: [{ point: [2.01, 48.01], expect: 'found' }], result: covered ? { signature: sign, count: 1, covered } : null });
    expect(describeChecks(built)).toBe('');
    expect(describeChecks({ ...built, checks: [check(null), check(null)] })).toBe('2 checks · not tested');
    expect(describeChecks({ ...built, checks: [check([true]), check([true])] })).toBe('2 checks · all pass');
    expect(describeChecks({ ...built, checks: [check([true]), check([false])] })).toBe('2 checks · 1 fails');
    expect(describeChecks({ ...built, checks: [check([true]), check([true], 'old')] })).toBe('2 checks · 1 pass');
    expect(checksSummary({ ...built, checks: [check([true]), check(null)] })).toMatchObject({ total: 2, pass: 1, waiting: 1 });
  });
});

describe('what the pins would come to without a rule', () => {
  const pins = [{ point: [2, 48], expect: 'found' }, { point: [2.1, 48], expect: 'empty' }, { point: [2.2, 48], expect: 'empty' }];

  it('says a rule helps when pins would come out wrong without it', () => {
    // now: found on the first, none on the others. Without it: the trap is flagged too.
    expect(describeWithout(pins, [true, false, false], [true, true, false])).toBe('Without it, 1 pin would come out wrong.');
    expect(describeWithout(pins, [true, false, false], [true, true, true])).toBe('Without it, 2 pins would come out wrong.');
  });

  it('says a rule hurts when pins would come out right without it', () => {
    // now: the plot is lost and a trap is flagged. Without it: both come out right.
    expect(describeWithout(pins, [false, true, false], [true, false, false])).toBe('Without it, 2 pins would come out right.');
    expect(describeWithout(pins, [false, false, false], [true, false, false])).toBe('Without it, 1 pin would come out right.');
  });

  it('says both when it does both, and that nothing changes when nothing does', () => {
    expect(describeWithout(pins, [false, false, false], [true, true, false])).toBe('Without it, 1 pin would come out right and 1 wrong.');
    expect(describeWithout(pins, [true, false, false], [true, false, false])).toBe('Without it, no pin changes.');
  });

  it('says nothing without an answer for every pin', () => {
    expect(describeWithout(pins, [true, false, false], undefined)).toBe('');
    expect(describeWithout(pins, [true, false, false], [true])).toBe('');
    expect(describeWithout(pins, [], [true, false, false])).toBe('');
  });
});

describe('what stops an analyzer being saved', () => {
  const built = (...checks) => ({ ...newRecipe(METHODS), name: 'Mine', checks });
  const good = () => newCheck({ name: 'Plot', a: { date: '2023-08-08' }, b: { date: '2023-08-13' },
    marks: [{ point: [2.01, 48.01], expect: 'found' }] });

  it('needs a check, and one with a pin where something should be found', () => {
    expect(savingProblem(built())).toMatch(/Add a check/);
    expect(savingProblem(built(good()))).toBe('');
    const trap = newCheck({ name: 'Reef', a: { date: '2023-08-08' }, b: { date: '2023-08-13' },
      marks: [{ point: [2.03, 48.01], expect: 'empty' }] });
    // a place where nothing may be found proves a rule, but something has to be found somewhere
    expect(savingProblem(built(trap))).toMatch(/something should be found/);
    expect(savingProblem(built(good(), trap))).toBe('');
  });

  it('names the check that is missing its pin or its passes', () => {
    expect(savingProblem(built({ ...good(), marks: [] }))).toBe('The check “Plot” needs a pin.');
    expect(savingProblem(built({ ...good(), a: {} }))).toBe('The check “Plot” needs its passes.');
    expect(savingProblem(built({ ...good(), b: { date: '' } }))).toBe('The check “Plot” needs its passes.');
    // one date needs only the after pass
    const single = { ...newRecipe(METHODS, { dates: 'one' }), name: 'Mine', checks: [{ ...good(), a: {} }] };
    expect(savingProblem(single)).toBe('');
  });

  it('puts a problem with the rules first, so the fix is where the eye is', () => {
    const broken = { ...built(good()), rules: [] };
    expect(savingProblem(broken)).toMatch(/Add a rule/);
  });
});
