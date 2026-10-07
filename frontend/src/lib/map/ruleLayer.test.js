import { expect, it } from 'vitest';
import { newRule } from './analyzerRules.js';
import { ruleLayerScript, ruleLayerWords, whyNoLayer } from './ruleLayer.js';

/**
 * A rule drawn as imagery.
 *
 * What matters is that the layer is the rule's *own* arithmetic, not a layer
 * that happens to show its bands well — and that a rule which is not one
 * quantity says so instead of drawing something that would be read as the
 * measure.
 */

it('draws a chosen pair as the normalised difference the rule measures', () => {
  const script = ruleLayerScript(newRule('nd', 'b', { bands: ['B12', 'B11'] }));
  // the arithmetic, in the rule's own order: high first
  expect(script).toContain('(p.B12 - p.B11) / sum');
  expect(script).toContain('const sum = p.B12 + p.B11;');
  // and it asks for exactly those bands
  expect(script).toContain('input: ["B12", "B11", "dataMask"]');
});

it('draws a published index from its own bands, on a ramp that suits it', () => {
  const ndvi = ruleLayerScript(newRule('index', 'b', { index: 'ndvi' }));
  expect(ndvi).toContain('(p.B08 - p.B04) / sum');
  expect(ndvi).toContain('vegetation ramp');

  const ndwi = ruleLayerScript(newRule('index', 'b', { index: 'ndwi' }));
  expect(ndwi).toContain('(p.B03 - p.B08) / sum');
  expect(ndwi).toContain('water ramp');

  expect(ruleLayerScript(newRule('index', 'b', { index: 'nbr' }))).toContain('(p.B08 - p.B12) / sum');
  expect(ruleLayerScript(newRule('index', 'b', { index: 'ndbi' }))).toContain('(p.B11 - p.B08) / sum');
});

it('never bakes the threshold in, so moving the line costs no tiles', () => {
  // the script is the draft's name is the tile cache's key: a threshold in it
  // would fetch the whole frame again at every nudge of the slider
  const low = ruleLayerScript(newRule('nd', 'b', { bands: ['B12', 'B11'], op: 'ge', value: 0.1 }));
  const high = ruleLayerScript(newRule('nd', 'b', { bands: ['B12', 'B11'], op: 'ge', value: 0.6 }));
  expect(low).toBe(high);
  expect(low).not.toContain('left dark');
});

it('draws a band as that band in grey, not as a colour', () => {
  const script = ruleLayerScript(newRule('band', 'b', { band: 'B11' }));
  expect(script).toContain('B11 alone, as grey');
  expect(script).toContain('input: ["B11", "dataMask"]');
});

it('draws brightness as the visible bands averaged', () => {
  const script = ruleLayerScript(newRule('brightness', 'b'));
  expect(script).toContain('const mean = (p.B02 + p.B03 + p.B04) / 3;');
  expect(script).toContain('input: ["B02", "B03", "B04", "dataMask"]');
});

it('refuses what one picture of one day cannot hold, and says which', () => {
  const colour = newRule('colour', 'change');
  expect(ruleLayerScript(colour)).toBe('');
  expect(whyNoLayer(colour)).toContain('between two dates');

  const ground = newRule('class', 'b');
  expect(ruleLayerScript(ground)).toBe('');
  expect(whyNoLayer(ground)).toContain('classification');

  const radar = newRule('radar', 'b');
  expect(ruleLayerScript(radar)).toBe('');
  expect(whyNoLayer(radar)).toContain('another collection');

  // BSI is four bands, so it is not the two-band generator's job
  const bsi = newRule('index', 'b', { index: 'bsi' });
  expect(ruleLayerScript(bsi)).toBe('');
  expect(whyNoLayer(bsi)).toContain('BSI');
});

it('says nothing against a rule it can draw', () => {
  expect(whyNoLayer(newRule('nd', 'b', { bands: ['B12', 'B11'] }))).toBe('');
  expect(whyNoLayer(newRule('band', 'b', { band: 'B08' }))).toBe('');
  expect(whyNoLayer(newRule('brightness', 'b'))).toBe('');
});

it('says what the drawn layer shows, in the rule’s own terms', () => {
  expect(ruleLayerWords(newRule('nd', 'b', { bands: ['B12', 'B11'] })))
    .toBe('(B12 − B11) / (B12 + B11), on a ramp');
  expect(ruleLayerWords(newRule('band', 'b', { band: 'B11' }))).toBe('B11 reflectance, as grey');
  expect(ruleLayerWords(newRule('brightness', 'b'))).toBe('B02 · B03 · B04 averaged, as grey');
  expect(ruleLayerWords(newRule('class', 'b'))).toBe('');
});
