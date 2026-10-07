import { expect, it } from 'vitest';
import { KEPT_BIT, MEASURED_BIT, newRule, passesValue, readingKey, redrawRule, shareOf } from './analyzerRules.js';

/**
 * Moving a rule's line without asking the engine again.
 *
 * The engine sends what each rule read, pixel for pixel; the browser applies the
 * same comparison. `tests/test_detect_rules.py` proves the two agree on real
 * tiles — these are the arithmetic and the care taken with everything that is
 * not this rule.
 */

const SEEN = 1 << MEASURED_BIT;
const KEPT = 1 << KEPT_BIT;

it('crosses a line the way the engine crosses it', () => {
  const at = (op, value, upper = 0) => ({ ...newRule('band', 'b'), op, value, upper });
  expect(passesValue(at('ge', 0.25), 0.3)).toBe(true);
  expect(passesValue(at('ge', 0.25), 0.25)).toBe(true);   // the line itself passes
  expect(passesValue(at('ge', 0.25), 0.2)).toBe(false);
  expect(passesValue(at('le', -0.2), -0.3)).toBe(true);
  expect(passesValue(at('le', -0.2), -0.1)).toBe(false);
  expect(passesValue(at('between', 0.1, 0.4), 0.25)).toBe(true);
  expect(passesValue(at('between', 0.1, 0.4), 0.45)).toBe(false);
  // a move either way is read as a size, whichever side it went
  expect(passesValue(at('moved', 0.05), -0.2)).toBe(true);
  expect(passesValue(at('moved', 0.05), 0.01)).toBe(false);
});

it('redraws one rule and leaves every other bit of the mask alone', () => {
  const rule = { ...newRule('nd', 'b'), op: 'ge', value: 0.5 };
  //            measured+rule1+kept   measured+rule1   measured   not measured
  const bits = new Uint8Array([SEEN | 0b10 | KEPT, SEEN | 0b10, SEEN, 0]);
  const values = [0.9, 0.1, 0.9, 0.9];
  const out = redrawRule(bits, 0, values, rule);

  // rule 0 set where its reading crosses, cleared where it does not
  expect([...out].map((b) => !!(b & 1))).toEqual([true, false, true, false]);
  // rule 1, the measured bit and the kept bit are untouched
  expect([...out].map((b) => !!(b & 0b10))).toEqual([true, true, false, false]);
  expect([...out].map((b) => !!(b & SEEN))).toEqual([true, true, true, false]);
  expect([...out].map((b) => !!(b & KEPT))).toEqual([true, false, false, false]);
  // and the mask it was given is not written through
  expect(bits[1] & 1).toBe(0);
});

it('never paints ground the sensor did not measure', () => {
  // cloud and missing imagery carry no reading, so a line can never catch them
  const rule = { ...newRule('band', 'b'), op: 'ge', value: -99 };
  const out = redrawRule(new Uint8Array([0, SEEN]), 0, [5, 5], rule);
  expect(out[0] & 1).toBe(0);
  expect(out[1] & 1).toBe(1);
});

it('counts the share of measured ground a redrawn rule keeps', () => {
  const masks = [new Uint8Array([SEEN | 1, SEEN, 0, SEEN | 1])];
  expect(shareOf(masks, 0)).toBeCloseTo(2 / 3);
  expect(shareOf([new Uint8Array([0, 0])], 0)).toBe(0);
});

it('keys a reading on everything but where the line sits', () => {
  const rule = newRule('nd', 'b', { bands: ['B12', 'B11'] });
  const moved = { ...rule, op: 'le', value: 0.9, upper: 1 };
  // the download answers for the bands and the dates, never the threshold
  expect(readingKey(moved)).toBe(readingKey(rule));
  expect(readingKey({ ...rule, bands: ['B08', 'B04'] })).not.toBe(readingKey(rule));
  expect(readingKey({ ...rule, on: 'a' })).not.toBe(readingKey(rule));
  expect(readingKey({ ...rule, around: 60 })).not.toBe(readingKey(rule));
});
