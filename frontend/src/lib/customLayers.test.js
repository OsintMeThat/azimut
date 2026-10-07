import { expect, it } from 'vitest';
import { newRule } from './map/analyzerRules.js';
import {
  DRAFT_PREFIX,
  NAME_RE,
  asName,
  dataSources,
  formMemo,
  isDraftLayer,
  layerAsRule,
  layerPayload,
  layerProblem,
  layerRuleWords,
  preferredBase,
  startForm,
  whyNotARule,
} from './customLayers.js';

/**
 * A layer name is a URL path segment and a directory name on three operating
 * systems before it is anything else, so the rules here have to match
 * `engine/sentinel.py`'s allowlist exactly — the backend refuses what this lets
 * through, and a form that offers a name the save rejects is a dead end.
 */

it('types a name into the only shape a layer name has', () => {
  expect(asName('plume swir')).toBe('PLUME_SWIR');
  expect(asName('b12/b11 ratio')).toBe('B12_B11_RATIO');
  expect(asName('  leading')).toBe('LEADING');
  // the variant separator and traversal cannot survive being typed
  expect(asName('a~b')).toBe('A_B');
  expect(asName('../escape')).toBe('ESCAPE');
  expect(asName('x'.repeat(60))).toHaveLength(40);
  expect(NAME_RE.test(asName('é&plume'))).toBe(true);
});

it('says in one clause why a layer cannot be saved', () => {
  const ok = { id: 'PLUME', base: 'TRUE_COLOR', script: '//VERSION=3' };
  expect(layerProblem(ok)).toBe('');
  expect(layerProblem({ ...ok, id: '' })).toBe('Name the layer.');
  expect(layerProblem({ ...ok, id: 'plume' })).toContain('capitals');
  expect(layerProblem({ ...ok, script: '  ' })).toBe('Write the script.');
  expect(layerProblem({ ...ok, base: '' })).toContain('read through');
  expect(layerProblem({ ...ok, script: 'x'.repeat(50) }, { scriptMax: 10 })).toContain('10');
});

it('refuses a name the configuration already uses', () => {
  // saving over it would silently change what everything filed under that name
  // renders, captures included
  const problem = layerProblem(
    { id: 'SWIR', base: 'TRUE_COLOR', script: '//VERSION=3' },
    { taken: ['TRUE_COLOR', 'SWIR'] }
  );
  expect(problem).toContain('already a layer');
});

it('tells a layer being previewed from one that was kept', () => {
  expect(isDraftLayer(`${DRAFT_PREFIX}A1B2C3`)).toBe(true);
  expect(isDraftLayer('PLUME_SWIR')).toBe(false);
  expect(isDraftLayer(undefined)).toBe(false);
});

it('never reads Sentinel-2 bands through the radar layer', () => {
  // a configuration with radar often lists it first, and a script reading
  // through it renders nothing at all
  const configured = [{ id: 'RADAR' }, { id: 'TRUE_COLOR' }, { id: 'SWIR' }];
  expect(dataSources(configured, 'RADAR')).toEqual(['TRUE_COLOR', 'SWIR']);
  expect(preferredBase(['RADAR', 'SWIR', 'TRUE_COLOR'], 'RADAR')).toBe('TRUE_COLOR');
  // true colour is what every setup guide builds, so it wins over list order
  expect(preferredBase(['SWIR', 'TRUE_COLOR'])).toBe('TRUE_COLOR');
  // and without it, the first layer that can answer
  expect(preferredBase(['RADAR', 'VEGETATION_INDEX'], 'RADAR')).toBe('VEGETATION_INDEX');
  // nothing configured yet: the name the standard template ships
  expect(preferredBase([], 'RADAR')).toBe('TRUE_COLOR');
});

it('leaves a script out of what another script reads from', () => {
  const mixed = [{ id: 'TRUE_COLOR' }, { id: 'PLUME_SWIR', custom: true }];
  expect(dataSources(mixed)).toEqual(['TRUE_COLOR']);
});

it('starts a draft on a composite that already renders something', () => {
  const form = startForm({ bases: ['TRUE_COLOR'], bands: ['B04', 'B08', 'B11', 'B12'] });
  expect(form.way).toBe('composite');
  expect(form.composite).toMatchObject({ red: 'B12', green: 'B11', blue: 'B04' });
  expect(form.base).toBe('TRUE_COLOR');
  expect(form.editing).toBe('');
});

it('starts a draft of a saved layer on its script, keeping what it is filed as', () => {
  const form = startForm({
    layer: { id: 'PLUME', label: 'Plume', base: 'SWIR', hint: 'hot', script: '//VERSION=3' },
    bases: ['TRUE_COLOR', 'SWIR'],
  });
  // nothing records which form once wrote a saved layer
  expect(form.way).toBe('script');
  expect(form.typed).toBe('//VERSION=3');
  expect(form.editing).toBe('PLUME');
  expect(form.base).toBe('SWIR');
});

it('keeps a draft’s bands to what the instance actually carries', () => {
  // an instance that answered with a short list must not leave the form holding
  // a band it cannot ask for
  const form = startForm({ bands: ['B02', 'B03'] });
  expect(['B02', 'B03']).toContain(form.composite.red);
  expect(['B02', 'B03']).toContain(form.index.high);
});

it('sends the save route exactly the body it takes, and nothing else', () => {
  // the draft carries which form is open, the other ways' text and the name it
  // is an edit of; the route forbids what it does not know
  const form = startForm({ bases: ['TRUE_COLOR'] });
  form.id = 'PLUME_SWIR';
  form.label = 'SWIR plume';
  form.hint = 'hot spots';
  const body = layerPayload(form, '//VERSION=3');
  expect(Object.keys(body).sort()).toEqual(['base', 'form', 'hint', 'id', 'label', 'script']);
  expect(body).toMatchObject({ id: 'PLUME_SWIR', base: 'TRUE_COLOR', script: '//VERSION=3' });
});

it('remembers what a form said, so the layer does not reopen as JavaScript', () => {
  const form = startForm({ bases: ['TRUE_COLOR'] });
  expect(formMemo(form)).toEqual({
    way: 'composite', red: 'B12', green: 'B11', blue: 'B04', gain: 2.5,
  });

  form.way = 'index';
  form.index.threshold = 0.1;
  expect(formMemo(form)).toEqual({
    way: 'index', high: 'B08', low: 'B04', ramp: 'vegetation', threshold: 0.1,
  });
  // an empty threshold box is no threshold, not zero
  form.index.threshold = '';
  expect(formMemo(form).threshold).toBeNull();

  // a script somebody typed has nothing to remember
  form.way = 'script';
  expect(formMemo(form)).toBeNull();
});

it('reopens a saved layer on the form that wrote it', () => {
  const layer = {
    id: 'PLUME_SWIR',
    base: 'TRUE_COLOR',
    script: '//VERSION=3',
    form: { way: 'index', high: 'B12', low: 'B11', ramp: 'heat', threshold: 0.15 },
  };
  const form = startForm({ layer, bases: ['TRUE_COLOR'] });
  expect(form.way).toBe('index');
  expect(form.index).toEqual({ high: 'B12', low: 'B11', rampId: 'heat', threshold: 0.15 });
  // and one with no memo is JavaScript, which is all anyone can say about it
  expect(startForm({ layer: { ...layer, form: null } }).way).toBe('script');
});

it('reads an index layer as the Detect rule it already is', () => {
  // `(A − B) / (A + B)` is what a rule measures with `nd`, so the line the
  // layer paints with is the line the rule crosses
  const rule = layerAsRule({
    form: { way: 'index', high: 'B12', low: 'B11', ramp: 'heat', threshold: 0.15 },
  });
  expect(rule).toEqual({ measure: 'nd', bands: ['B12', 'B11'], op: 'ge', value: 0.15 });

  // an index with no threshold still reads, from zero
  expect(layerAsRule({ form: { way: 'index', high: 'B08', low: 'B04' } }).value).toBe(0);
});

it('reads a band painted grey as the band rule it already is', () => {
  // the same band in all three channels is not a colour, it is that band's
  // reflectance — which the engine measures as `band`
  const grey = { form: { way: 'composite', red: 'B12', green: 'B12', blue: 'B12', gain: 2.5 } };
  expect(layerAsRule(grey)).toEqual({ measure: 'band', band: 'B12' });
  // and it brings no line: the gain is how bright it is drawn, not a threshold
  expect(newRule('band', 'b', { band: 'B12' })).toMatchObject({ op: 'ge', value: 0.25 });
});

it('refuses to invent a rule out of what is not one quantity', () => {
  // three different channels are not a number, and JavaScript is not readable as one
  expect(layerAsRule({ form: { way: 'composite', red: 'B12', green: 'B11', blue: 'B04' } })).toBeNull();
  expect(layerAsRule({ form: { way: 'composite', red: 'B12' } })).toBeNull();
  expect(layerAsRule({ form: null })).toBeNull();
  expect(layerAsRule({})).toBeNull();
});

it('says why a layer cannot become a rule rather than leaving it out', () => {
  // the menu shows every layer, so each one that cannot come over carries why
  expect(whyNotARule({ form: { way: 'index', high: 'B12', low: 'B11' } })).toBe('');
  expect(whyNotARule({ form: { way: 'composite', red: 'B12', green: 'B12', blue: 'B12' } })).toBe('');
  expect(whyNotARule({ form: { way: 'composite', red: 'B12', green: 'B11', blue: 'B04' } }))
    .toBe('three bands in colour, not one quantity');
  expect(whyNotARule({ form: null })).toContain('script');
});

it('says the arithmetic a layer turns into', () => {
  expect(layerRuleWords({ form: { way: 'index', high: 'B12', low: 'B11', threshold: 0.15 } }))
    .toBe('(B12 − B11) / (B12 + B11) ≥ 0.15');
  expect(layerRuleWords({ form: { way: 'index', high: 'B08', low: 'B04', threshold: null } }))
    .toBe('(B08 − B04) / (B08 + B04)');
  expect(layerRuleWords({ form: { way: 'composite', red: 'B12', green: 'B12', blue: 'B12' } }))
    .toBe('B12 reflectance');
  expect(layerRuleWords({ form: null })).toBe('');
});

it('becomes a whole rule the engine accepts, with the analyzer deciding the dates', () => {
  const layer = { form: { way: 'index', high: 'B12', low: 'B11', threshold: 0.15 } };
  const { measure, ...line } = layerAsRule(layer);
  // what the builder does: the layer brings the quantity and the line, the
  // analyzer brings which dates it is read on
  const rule = newRule(measure, 'b', line);
  expect(rule).toMatchObject({
    measure: 'nd', bands: ['B12', 'B11'], on: 'b', op: 'ge', value: 0.15, around: 0,
  });
  // and the fields the engine's model needs are all there
  for (const key of ['index', 'band', 'polarisation', 'classes', 'upper']) {
    expect(rule).toHaveProperty(key);
  }
});
