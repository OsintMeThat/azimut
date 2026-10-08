import { describe, expect, it } from 'vitest';
import { fieldSpans, silhouette, STRIP_HEIGHT, STRIP_LEVEL, stripAzimuth, stripScale, stripX, stripY } from './strip.js';

const WIDTH = 1080; // 3 px a degree

describe('the 360° strip', () => {
  it('runs north to north across, at the same scale up as across', () => {
    expect(stripScale(WIDTH)).toBe(3);
    expect(stripX(0, WIDTH)).toBe(0);
    expect(stripX(90, WIDTH)).toBe(270);
    expect(stripX(-90, WIDTH)).toBe(810);
    expect(stripAzimuth(270, WIDTH)).toBe(90);
    expect(stripY(0, WIDTH)).toBe(STRIP_LEVEL);
    expect(stripY(2, WIDTH)).toBe(STRIP_LEVEL - 6);
  });

  it('draws the turn\'s skyline, the highest ground of each column, and leaves gaps open', () => {
    const skyline = new Array(3600).fill(1);
    skyline[900] = 5; // a summit at 90°
    for (let i = 1800; i < 1900; i += 1) skyline[i] = null; // nothing known to the south
    const shape = silhouette({ azimuth: { start: 0, step: 0.1 }, skyline }, WIDTH);
    expect(shape.line.startsWith('M')).toBe(true);
    expect(shape.line.split('M')).toHaveLength(3); // one gap, two runs
    expect(shape.line).toContain(`,${(STRIP_LEVEL - 15).toFixed(1)}`);
    expect(shape.fill).toContain(`,${STRIP_HEIGHT.toFixed(1)}`);
    expect(silhouette(null, WIDTH)).toBeNull();
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
});
