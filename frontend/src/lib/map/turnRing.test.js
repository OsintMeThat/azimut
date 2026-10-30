import { describe, expect, it } from 'vitest';
import { bearingToward, facingLabel, knobAt, screenNorth } from './turnRing.js';

// a flat map, north up, a degree a hundred thousand pixels; and the same turned a quarter clockwise
const northUp = (lon, lat) => ({ x: lon * 1e5, y: -lat * 1e5 });
const turned = (lon, lat) => ({ x: lat * 1e5, y: lon * 1e5 });

describe('the ring that turns a marker', () => {
  it('reads north on screen from the map, however it is turned', () => {
    expect(screenNorth(northUp, 2, 48)).toBeCloseTo(0);
    expect(screenNorth(turned, 2, 48)).toBeCloseTo(90);
  });

  it('puts the knob where the marker faces', () => {
    const centre = { x: 100, y: 100 };
    const east = knobAt(centre, 30, 90, 0);
    expect(east.x).toBeCloseTo(130); expect(east.y).toBeCloseTo(100);
    // the same direction on a map turned so that north points right: the knob points down
    const down = knobAt(centre, 30, 90, 90);
    expect(down.x).toBeCloseTo(100); expect(down.y).toBeCloseTo(130);
  });

  it('turns toward the pointer by steps of five, free with Shift', () => {
    const centre = { x: 0, y: 0 };
    expect(bearingToward(centre, { x: 10, y: -10 }, 0)).toBe(45);
    expect(bearingToward(centre, { x: 10, y: -9 }, 0)).toBe(50);
    expect(bearingToward(centre, { x: 10, y: -9 }, 0, true)).toBe(48);
    expect(bearingToward(centre, { x: -1, y: -100 }, 0)).toBe(0);
    // pointing right on a map whose north is to the right is north
    expect(bearingToward(centre, { x: 50, y: 0 }, 90)).toBe(0);
  });

  it('reads as degrees and the nearest wind', () => {
    expect(facingLabel(47)).toBe('47° NE');
    expect(facingLabel(359.6)).toBe('0° N');
    expect(facingLabel(212)).toBe('212° SW');
    expect(facingLabel('')).toBe('');
    expect(facingLabel(null)).toBe('');
  });
});
