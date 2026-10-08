import { describe, expect, it } from 'vitest';
import {
  fieldSpans,
  outsideSpans,
  silhouette,
  STRIP_GROUND,
  STRIP_LEAST,
  STRIP_NEAR,
  stripAzimuth,
  stripLevel,
  stripRange,
  stripScale,
  stripX,
  stripY,
  WINDS,
} from './strip.js';

const WIDTH = 1080; // 3 px a degree

describe('the 360° strip', () => {
  it('runs north to north across', () => {
    expect(stripScale(WIDTH)).toBe(3);
    expect(stripX(0, WIDTH)).toBe(0);
    expect(stripX(90, WIDTH)).toBe(270);
    expect(stripX(-90, WIDTH)).toBe(810);
    expect(stripAzimuth(270, WIDTH)).toBe(90);
  });

  it('fits its height to the skyline, the highest ground near the top and the lowest on the ground row', () => {
    const range = stripRange({ skyline: [-2, 1, 6, 3] });
    expect(range).toEqual({ low: -2, high: 6 });
    expect(stripY(-2, range)).toBe(STRIP_GROUND);
    expect(stripY(6, range)).toBeLessThan(STRIP_GROUND / 4);
    expect(stripY(2, range)).toBeGreaterThan(stripY(6, range));
    expect(stripLevel(range)).toBeCloseTo(stripY(0, range), 9);
  });

  it('leaves the slope under the feet out of the fit', () => {
    const range = stripRange({ skyline: [25, 1, 4], skylineDistance: [STRIP_NEAR - 1, 40_000, 9000] });
    expect(range).toEqual({ low: 1, high: 4 });
    // nothing stands that far: the whole skyline sets it
    expect(stripRange({ skyline: [20, 24], skylineDistance: [300, 500] })).toEqual({ low: 20, high: 24 });
  });

  it('keeps a plain flat, widening a thin range about its middle', () => {
    const range = stripRange({ skyline: [0.1, 0.3, 0.2] });
    expect(range.high - range.low).toBeCloseTo(STRIP_LEAST, 9);
    expect((range.high + range.low) / 2).toBeCloseTo(0.2, 9);
    expect(stripRange(null)).toEqual({ low: -STRIP_LEAST / 2, high: STRIP_LEAST / 2 });
    expect(stripLevel({ low: 1, high: 4 })).toBeNull();
  });

  it('draws the turn\'s skyline, the highest ground of each column, and leaves gaps open', () => {
    const skyline = new Array(3600).fill(1);
    skyline[900] = 5; // a summit at 90°
    for (let i = 1800; i < 1900; i += 1) skyline[i] = null; // nothing known to the south
    const range = { low: 1, high: 5 };
    const shape = silhouette({ azimuth: { start: 0, step: 0.1 }, skyline }, WIDTH, range);
    expect(shape.line.startsWith('M')).toBe(true);
    expect(shape.line.split('M')).toHaveLength(3); // one gap, two runs
    expect(shape.line).toContain(`,${stripY(5, range).toFixed(1)}`);
    expect(shape.fill).toContain(`,${STRIP_GROUND.toFixed(1)}`);
    expect(silhouette(null, WIDTH)).toBeNull();
  });

  it('hatches the azimuths whose skyline is the slope close by', () => {
    const skyline = new Array(360).fill(2);
    const skylineDistance = new Array(360).fill(30_000);
    for (let i = 180; i < 270; i += 1) {
      skyline[i] = 20;
      skylineDistance[i] = 400;
    }
    const shape = silhouette({ azimuth: { start: 0, step: 1 }, skyline, skylineDistance }, 360);
    expect(shape.near).toHaveLength(1);
    expect(shape.near[0].x).toBeCloseTo(180, 6);
    expect(shape.near[0].width).toBeCloseTo(90, 6);
    // without distances nothing is known to be near
    expect(silhouette({ azimuth: { start: 0, step: 1 }, skyline }, 360).near).toEqual([]);
  });

  it('draws a coarse turn wider than its azimuths without gaps', () => {
    const coarse = { azimuth: { start: 0, step: 0.5 }, skyline: new Array(720).fill(2) };
    const shape = silhouette(coarse, 1036);
    expect(shape.line.split('M')).toHaveLength(2); // one unbroken run
    expect(shape.line.split('L')).toHaveLength(1036);
  });

  it('brackets the field, in two parts past north, and not at all for a whole turn', () => {
    expect(fieldSpans(65, 60, WIDTH)).toEqual([{ x: 195, width: 180 }]);
    const wrapped = fieldSpans(340, 40, WIDTH);
    expect(wrapped).toHaveLength(2);
    expect(wrapped[0]).toEqual({ x: 1020, width: 60 });
    expect(wrapped[1].x).toBe(0);
    expect(wrapped[1].width).toBeCloseTo(60, 6);
    expect(fieldSpans(0, 360, WIDTH)).toEqual([]);
  });

  it('veils what the field leaves of the turn, and nothing for a whole turn', () => {
    expect(outsideSpans([{ x: 195, width: 180 }], WIDTH)).toEqual([
      { x: 0, width: 195 },
      { x: 375, width: 705 },
    ]);
    // past north: one veil between the two parts
    expect(outsideSpans([{ x: 1020, width: 60 }, { x: 0, width: 60 }], WIDTH)).toEqual([{ x: 60, width: 960 }]);
    expect(outsideSpans([], WIDTH)).toEqual([]);
  });

  it('names the eight winds, four of them cardinal', () => {
    expect(WINDS.map((wind) => wind.label)).toEqual(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);
    expect(WINDS.filter((wind) => wind.cardinal).map((wind) => wind.azimuth)).toEqual([0, 90, 180, 270]);
  });
});
