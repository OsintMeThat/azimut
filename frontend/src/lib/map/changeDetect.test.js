import { describe, expect, it } from 'vitest';
import {
  boxBlur,
  cleanMask,
  decodeIndex,
  detectChange,
  estimateAlignment,
  findZones,
  matchTone,
  otsu,
  toLab,
} from './changeDetect.js';

/** An opaque frame filled with one colour, and a way to paint rectangles on it. */
function frame(width, height, colour = [90, 110, 80]) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels.set([...colour, 255], index);
  }
  return {
    pixels,
    paint(x1, y1, x2, y2, rgb) {
      for (let y = y1; y < y2; y += 1) {
        for (let x = x1; x < x2; x += 1) pixels.set([...rgb, 255], (y * width + x) * 4);
      }
      return this;
    },
  };
}

const settings = (patch = {}) => ({
  method: 'colour',
  threshold: 'auto',
  sensitivity: 55,
  normalize: 'none',
  smoothing: 0,
  alignment: 0,
  cleanup: 0,
  ...patch,
});

describe('colour', () => {
  it('converts sRGB to Lab on the standard white and black points', () => {
    const white = toLab(255, 255, 255);
    expect(white[0]).toBeCloseTo(100, 0);
    expect(Math.abs(white[1])).toBeLessThan(0.5);
    expect(toLab(0, 0, 0)[0]).toBeCloseTo(0, 5);
  });
});

describe('preparing the pair', () => {
  it('finds a small translation that registers B onto A', () => {
    const a = frame(24, 24, [0, 0, 0]).paint(8, 8, 12, 12, [240, 240, 240]);
    const b = frame(24, 24, [0, 0, 0]).paint(10, 7, 14, 11, [240, 240, 240]);
    expect(estimateAlignment(a.pixels, b.pixels, 24, 24, 4)).toMatchObject({ x: 2, y: -1 });
  });

  it('moves B’s tones onto A so a brighter day is not change everywhere', () => {
    const a = frame(10, 10, [80, 80, 80]).paint(0, 0, 5, 10, [40, 40, 40]);
    const b = frame(10, 10, [130, 130, 130]).paint(0, 0, 5, 10, [90, 90, 90]);
    for (const mode of ['mean', 'histogram']) {
      const toned = matchTone(a.pixels, b.pixels, mode);
      expect(toned[0]).toBeCloseTo(40, -1);
      expect(toned[(9 * 10 + 9) * 4]).toBeCloseTo(80, -1);
    }
    expect(matchTone(a.pixels, b.pixels, 'none')).toBe(b.pixels);
  });
});

describe('thresholds and filters', () => {
  it('splits a two-population field between its modes', () => {
    const field = new Float32Array([...Array(80).fill(10), ...Array(20).fill(200)]);
    const split = otsu(field, new Uint8Array(100).fill(1));
    expect(split).toBeGreaterThanOrEqual(10);
    expect(split).toBeLessThan(200);
  });

  it('blurs only over valid pixels', () => {
    const field = new Float32Array([0, 90, 0, 0]);
    const blurred = boxBlur(field, 2, 2, 1, new Uint8Array([1, 1, 1, 0]));
    expect(blurred[0]).toBeCloseTo(30);
    expect(blurred[3]).toBe(0);
  });

  it('drops speckle smaller than the cleanup radius and keeps solid regions', () => {
    const width = 12;
    const mask = new Uint8Array(width * width);
    mask[2 * width + 2] = 1; // one stray pixel
    for (let y = 5; y < 10; y += 1) for (let x = 5; x < 10; x += 1) mask[y * width + x] = 1;
    const cleaned = cleanMask(mask, width, width, 1);
    expect(cleaned[2 * width + 2]).toBe(0);
    expect(cleaned[7 * width + 7]).toBe(1);
  });
});

describe('zones', () => {
  it('groups connected pixels with their area on the ground and dominant direction', () => {
    const width = 10;
    const mask = new Uint8Array(100);
    const classes = new Uint8Array(100);
    const strength = new Float32Array(100).fill(128);
    for (let y = 1; y < 3; y += 1) for (let x = 1; x < 4; x += 1) {
      mask[y * width + x] = 1;
      classes[y * width + x] = 2;
    }
    mask[88] = 1;
    classes[88] = 1;
    const { zones } = findZones(mask, classes, strength, width, 10, 2, 10);
    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({ kind: 'loss', pixels: 6, area: 24 });
    expect(zones[0].box).toEqual({ x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.3 });
  });
});

describe('detecting change', () => {
  it('finds a new bright roof as a gain and nothing where the ground is the same', () => {
    const a = frame(40, 40);
    const b = frame(40, 40).paint(10, 10, 20, 18, [235, 230, 220]);
    const result = detectChange({
      a: a.pixels, b: b.pixels, width: 40, height: 40,
      settings: settings(), metresPerPixel: 0.5,
    });
    expect(result.counts.gained).toBe(80);
    expect(result.counts.lost + result.counts.changed).toBe(0);
    expect(result.zones).toHaveLength(1);
    expect(result.zones[0]).toMatchObject({ kind: 'gain', area: 20 });
    expect(result.pixels[(12 * 40 + 12) * 4 + 3]).toBeGreaterThan(0);
    expect(result.pixels[3]).toBe(0);
  });

  it('reads a hue shift at the same lightness as another change, not a gain', () => {
    const a = frame(30, 30, [120, 120, 120]).paint(5, 5, 15, 15, [170, 60, 60]);
    const b = frame(30, 30, [120, 120, 120]).paint(5, 5, 15, 15, [40, 125, 60]);
    const result = detectChange({ a: a.pixels, b: b.pixels, width: 30, height: 30, settings: settings() });
    expect(result.counts.changed).toBeGreaterThan(90);
    expect(result.counts.gained).toBe(0);
  });

  it('shows only the classes asked for, and drops zones under the minimum area', () => {
    const a = frame(40, 40).paint(25, 25, 35, 35, [230, 230, 230]);
    const b = frame(40, 40).paint(2, 2, 6, 6, [230, 230, 230]);
    const losses = detectChange({
      a: a.pixels, b: b.pixels, width: 40, height: 40,
      settings: settings({ classes: ['loss'] }), metresPerPixel: 1,
    });
    expect(losses.counts.gained).toBe(0);
    expect(losses.zones.map((zone) => zone.kind)).toEqual(['loss']);
    const bigOnly = detectChange({
      a: a.pixels, b: b.pixels, width: 40, height: 40,
      settings: settings({ min_area: 50 }), metresPerPixel: 1,
    });
    expect(bigOnly.zones).toHaveLength(1);
    expect(bigOnly.counts.gained).toBe(0);
  });

  it('ignores a uniform tone shift once tones are matched', () => {
    const a = frame(30, 30, [80, 90, 70]).paint(0, 0, 15, 30, [60, 70, 50]);
    const b = frame(30, 30, [120, 130, 110]).paint(0, 0, 15, 30, [100, 110, 90]);
    const raw = detectChange({ a: a.pixels, b: b.pixels, width: 30, height: 30, settings: settings({ threshold: 'manual', sensitivity: 90 }) });
    const toned = detectChange({ a: a.pixels, b: b.pixels, width: 30, height: 30, settings: settings({ threshold: 'manual', sensitivity: 90, normalize: 'histogram' }) });
    expect(raw.share).toBeGreaterThan(0.9);
    expect(toned.share).toBe(0);
  });

  it('reads structure, so a new wall shows even when its colour matches the ground', () => {
    const a = frame(40, 40, [120, 120, 120]);
    const b = frame(40, 40, [120, 120, 120]).paint(10, 10, 30, 30, [60, 60, 60]);
    const result = detectChange({
      a: a.pixels, b: b.pixels, width: 40, height: 40,
      settings: settings({ method: 'structure', threshold: 'manual', sensitivity: 80 }),
    });
    expect(result.counts.gained).toBeGreaterThan(0);
    // the inside of a flat patch has no edges of its own
    expect(result.pixels[(20 * 40 + 20) * 4 + 3]).toBe(0);
  });

  /** Index frames with a cloud class from column `cloudFrom` rightwards. */
  const indexFrame = (width, value, cloudFrom = 99) => {
    const pixels = new Uint8ClampedArray(width * width * 4);
    for (let pixel = 0; pixel < width * width; pixel += 1) {
      const x = pixel % width;
      pixels.set([Math.round((value(x) + 1) * 127.5), x >= cloudFrom ? 9 : 4, 0, 255], pixel * 4);
    }
    return pixels;
  };

  it('reads a real spectral index, masking clouded pixels', () => {
    const width = 20;
    const before = indexFrame(width, () => 0.7);
    const after = indexFrame(width, (x) => (x < 10 ? 0.7 : -0.1), 16);
    const blank = new Uint8ClampedArray(width * width * 4);
    const result = detectChange({
      a: blank, b: blank, width, height: width,
      settings: settings({ method: 'index', ignore_clouds: true, cloud_margin: 0 }),
      index: { a: before, b: after },
    });
    expect(result.counts.lost).toBe(6 * width);
    expect(result.coverage).toBeCloseTo(16 / 20);
    expect(decodeIndex(after).value[0]).toBeCloseTo(0.7, 1);
    expect(() => detectChange({
      a: blank, b: blank, width, height: width, settings: settings({ method: 'index' }),
    })).toThrow('index frames');
  });

  it('grows the cloud mask by the margin, taking the edge it left behind', () => {
    // A classification calls a cloud's soft rim ground, and that rim is where
    // the ring of highlights around every mask comes from.
    const width = 20;
    const before = indexFrame(width, () => 0.7);
    const after = indexFrame(width, (x) => (x < 10 ? 0.7 : -0.1), 16);
    const blank = new Uint8ClampedArray(width * width * 4);
    const read = (cloud_margin) => detectChange({
      a: blank, b: blank, width, height: width,
      settings: settings({ method: 'index', ignore_clouds: true, cloud_margin }),
      index: { a: before, b: after },
    });
    // columns 10…15 changed and 16… are cloud; a 2px margin eats 14 and 15 too
    expect(read(2).counts.lost).toBe(4 * width);
    expect(read(2).coverage).toBeCloseTo(14 / 20);
    // and the margin only ever costs what it says: off, the edge is exact
    expect(read(0).counts.lost).toBe(6 * width);
  });

  it('leaves every pixel alone when nothing is being masked', () => {
    // The margin must not eat anything on its own: it grows a mask, and with
    // both switches off there is no mask to grow.
    const width = 20;
    const before = indexFrame(width, () => 0.7);
    const after = indexFrame(width, (x) => (x < 10 ? 0.7 : -0.1), 16);
    const blank = new Uint8ClampedArray(width * width * 4);
    const result = detectChange({
      a: blank, b: blank, width, height: width,
      settings: settings({ method: 'index', cloud_margin: 4 }),
      index: { a: before, b: after },
    });
    expect(result.counts.lost).toBe(10 * width);
    expect(result.coverage).toBeCloseTo(1);
  });

  it('draws outlines and a heat ramp from the same zones', () => {
    const a = frame(30, 30);
    const b = frame(30, 30).paint(5, 5, 20, 20, [240, 240, 240]);
    const outline = detectChange({ a: a.pixels, b: b.pixels, width: 30, height: 30, settings: settings({ display: 'outline' }) });
    expect(outline.pixels[(5 * 30 + 10) * 4 + 3]).toBe(255);
    expect(outline.pixels[(12 * 30 + 12) * 4 + 3]).toBeLessThan(60);
    const heat = detectChange({ a: a.pixels, b: b.pixels, width: 30, height: 30, settings: settings({ display: 'heat' }) });
    expect(heat.pixels[(12 * 30 + 12) * 4 + 3]).toBeGreaterThan(89);
  });

  it('refuses frames of different sizes', () => {
    expect(() => detectChange({
      a: new Uint8ClampedArray(16), b: new Uint8ClampedArray(12), width: 2, height: 2, settings: {},
    })).toThrow('same pixel geometry');
  });
});
