import { expect, it } from 'vitest';
import {
  DEFAULT_GAIN,
  RAMPS,
  WAYS,
  compositeScript,
  indexScript,
  ramp,
  scriptFor,
} from './layerScripts.js';

/**
 * The Composite and Index forms do not make a different kind of layer: they
 * write the script a Custom one would have been typed as. So what matters is
 * the text — that it is a valid evalscript, that it says what the form said,
 * and that it keeps the nodata mask, without which a hole in the pass renders
 * as black ground and reads as burnt or flooded.
 */

const valid = (script) => {
  expect(script.startsWith('//VERSION=3')).toBe(true);
  expect(script).toContain('function setup()');
  expect(script).toContain('function evaluatePixel(');
  expect(script).toContain('output: { bands: 4 }');
  expect(script).toContain('p.dataMask');
};

it('writes three bands onto three channels', () => {
  const script = compositeScript({ red: 'B12', green: 'B11', blue: 'B04' });
  valid(script);
  expect(script).toContain('input: ["B12", "B11", "B04", "dataMask"]');
  expect(script).toContain(`return [${DEFAULT_GAIN} * p.B12, ${DEFAULT_GAIN} * p.B11, ${DEFAULT_GAIN} * p.B04, p.dataMask]`);
  expect(script).toContain('B12 → red');
});

it('asks for a band once, however many channels read it', () => {
  // a single band on all three is grey, and Sentinel Hub refuses a repeated input
  const script = compositeScript({ red: 'B11', green: 'B11', blue: 'B11' });
  expect(script).toContain('input: ["B11", "dataMask"]');
  expect(script).toContain('B11 alone, as grey');
  expect(script).toContain('p.B11, 2.5 * p.B11, 2.5 * p.B11');
});

it('carries the gain, without a float’s trailing noise', () => {
  expect(compositeScript({ red: 'B04', green: 'B03', blue: 'B02', gain: 1.1 })).toContain('1.1 * p.B04');
  expect(compositeScript({ red: 'B04', green: 'B03', blue: 'B02', gain: 3 })).toContain('3 * p.B04');
});

it('writes a normalised difference, guarded against a zero sum', () => {
  const script = indexScript({ high: 'B08', low: 'B04', rampId: 'vegetation' });
  valid(script);
  expect(script).toContain('input: ["B08", "B04", "dataMask"]');
  expect(script).toContain('const sum = p.B08 + p.B04;');
  // two dark bands over water sum to zero, and a NaN would paint the first stop
  expect(script).toContain('sum === 0 ? 0 : (p.B08 - p.B04) / sum');
  expect(script).toContain('(B08 − B04) / (B08 + B04)');
});

it('puts the chosen ramp’s stops in the script, and names it', () => {
  const script = indexScript({ high: 'B08', low: 'B04', rampId: 'heat' });
  expect(script).toContain('on the heat ramp');
  for (const [at] of ramp('heat').stops) expect(script).toContain(`[${at},`);
  expect(script).toContain('function colour(');
});

it('leaves the ramp whole unless a threshold is asked for', () => {
  const whole = indexScript({ high: 'B08', low: 'B04' });
  expect(whole).not.toContain('left dark');
  expect(whole).not.toContain('index <=');

  const cut = indexScript({ high: 'B12', low: 'B11', threshold: 0.1 });
  expect(cut).toContain('at or below 0.1 is left dark');
  expect(cut).toContain('if (index <= 0.1) return [0.04, 0.04, 0.04, p.dataMask];');
});

it('treats an empty threshold box as no threshold', () => {
  // the form's number input hands back '' when it is cleared
  for (const nothing of ['', null, undefined]) {
    expect(indexScript({ high: 'B08', low: 'B04', threshold: nothing })).not.toContain('index <=');
  }
  // and zero is a threshold, not an absence
  expect(indexScript({ high: 'B08', low: 'B04', threshold: 0 })).toContain('index <= 0)');
});

it('offers the three ways in, and an unknown ramp falls back rather than breaking', () => {
  expect(WAYS.map((way) => way.id)).toEqual(['composite', 'index', 'script']);
  expect(ramp('nonsense')).toBe(RAMPS[0]);
  for (const entry of RAMPS) {
    expect(entry.stops.length).toBeGreaterThan(1);
    // stops run upward, or `colour` would never reach the later ones
    const ats = entry.stops.map(([at]) => at);
    expect([...ats].sort((one, other) => one - other)).toEqual(ats);
    for (const [, rgb] of entry.stops) {
      expect(rgb).toHaveLength(3);
      for (const channel of rgb) expect(channel).toBeGreaterThanOrEqual(0);
      for (const channel of rgb) expect(channel).toBeLessThanOrEqual(1);
    }
  }
});

it('hands over whichever way is open', () => {
  const state = {
    composite: { red: 'B12', green: 'B11', blue: 'B04' },
    index: { high: 'B08', low: 'B04' },
    script: '//VERSION=3\nmine\n',
  };
  expect(scriptFor('composite', state)).toContain('p.B12');
  expect(scriptFor('index', state)).toContain('const sum');
  expect(scriptFor('script', state)).toBe('//VERSION=3\nmine\n');
});

it('stays well inside the script budget, whatever the form says', () => {
  const longest = indexScript({ high: 'B8A', low: 'B12', rampId: 'divergent', threshold: -0.35 });
  expect(longest.length).toBeLessThan(2000);
});
