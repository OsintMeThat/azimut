import { describe, it, expect } from 'vitest';
import { litPath, glyphRotation } from './moonphase.js';

// The path is two arcs: the lit rim, then the terminator back across the disc.
// Its second arc's x-radius is what the phase actually changes, so that is what
// these read, rather than comparing whole path strings.
function terminator(path) {
  const arcs = path.match(/A([\d.]+),/g);
  return Number(arcs[1].slice(1, -1));
}
function sweep(path) {
  return Number(path.match(/A[\d.]+,[\d.]+ 0 0 (\d)/g).pop().slice(-1));
}

describe('litPath', () => {
  it('draws a full disc at full moon', () => {
    const path = litPath(10, 1.0, 0);
    // terminator as wide as the disc, bulging away from the lit side
    expect(terminator(path)).toBeCloseTo(10, 1);
    expect(sweep(path)).toBe(1);
  });

  it('draws a straight terminator at a quarter', () => {
    const path = litPath(10, 0.5, 90);
    expect(terminator(path)).toBeCloseTo(0, 1);
  });

  it('carves the terminator inwards for a crescent', () => {
    const crescent = litPath(10, 0.2, 127);
    const gibbous = litPath(10, 0.8, 53);
    // same width either side of a quarter, opposite direction
    expect(terminator(crescent)).toBeCloseTo(terminator(gibbous), 1);
    expect(sweep(crescent)).toBe(0);
    expect(sweep(gibbous)).toBe(1);
  });

  it('encloses nothing at new moon, so the moon reads as an outline', () => {
    const path = litPath(10, 0, 180);
    // the terminator retraces the lit rim: same radius, same direction
    expect(terminator(path)).toBeCloseTo(10, 1);
    expect(sweep(path)).toBe(0);
  });

  it('scales with the radius it is given', () => {
    expect(litPath(7, 1, 0)).toContain('A7,7');
    expect(litPath(20, 1, 0)).toContain('A20,20');
  });

  it('widens the terminator monotonically away from a quarter', () => {
    const widths = [90, 70, 45, 20, 0].map((angle) => terminator(litPath(10, 0.6, angle)));
    for (const [i, width] of widths.entries()) {
      if (i) expect(width).toBeGreaterThan(widths[i - 1]);
    }
  });
});

describe('glyphRotation', () => {
  it('lights the right side of a waxing moon, the left of a waning one', () => {
    expect(glyphRotation(true)).toBe(0);
    expect(glyphRotation(false)).toBe(180);
  });

  it('follows the real bright-limb angle when given one', () => {
    // celestial position angles turn anticlockwise, SVG rotations clockwise
    expect(glyphRotation(true, 0)).toBe(-90);
    expect(glyphRotation(true, 90)).toBe(-180);
    expect(glyphRotation(false, 270)).toBe(-360);
  });

  it('ignores the waxing convention once a real angle is known', () => {
    expect(glyphRotation(true, 45)).toBe(glyphRotation(false, 45));
  });
});
