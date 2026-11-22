import { describe, expect, it } from 'vitest';
import { angleBoxes, anglesOf, bearingTo } from './angles.js';

describe('one event filmed from several places', () => {
  it('measures the compass direction from one place to another', () => {
    expect(Math.round(bearingTo([2.3, 48.8], [2.3, 48.9]))).toBe(0);
    expect(Math.round(bearingTo([2.3, 48.8], [2.4, 48.8]))).toBe(90);
    expect(Math.round(bearingTo([2.3, 48.8], [2.3, 48.7]))).toBe(180);
  });

  it('turns each cone toward the middle of the places, reaching a little past it', () => {
    const west = [34.600, 47.500];
    const east = [34.610, 47.500];
    const { middle, aimed, cones } = anglesOf([west, east]);
    expect(aimed).toBe(true);
    expect(middle).toEqual([34.605, 47.5]);
    expect(cones.map((cone) => cone.bearing)).toEqual([90, 270]);
    expect(cones[0].at).toEqual(west);
    // the middle is ~376 m away: the cone reaches past it
    expect(cones[0].reach).toBeGreaterThan(0.376);
    expect(cones[0].reach).toBeLessThan(0.6);
  });

  it('faces north with a short reach when the files all stand on one spot', () => {
    const { aimed, cones } = anglesOf([[34.6, 47.5], [34.60001, 47.50001]]);
    expect(aimed).toBe(false);
    expect(cones.map((cone) => [cone.bearing, cone.reach])).toEqual([[0, 0.2], [0, 0.2]]);
  });

  it('keeps an angle that stands at the middle itself pointing north while the others face it', () => {
    const { cones } = anglesOf([[34.6, 47.5], [34.62, 47.5], [34.61, 47.5]]);
    expect(cones[2]).toMatchObject({ bearing: 0, reach: 0.2 });
    expect(cones[0].bearing).toBe(90);
  });
});

describe('the files of one event played together', () => {
  it('stand in a strip along the foot of the page, sixteen to nine, in the middle', () => {
    const boxes = angleBoxes(3, 297, 210);
    expect(boxes).toHaveLength(3);
    for (const [, y, w, h] of boxes) {
      expect(Math.abs(h - (w * 9) / 16)).toBeLessThan(0.1);
      expect(Math.abs(y + h - 202)).toBeLessThan(0.1);
    }
    // the same room either side, the same gap between
    expect(Math.abs(boxes[0][0] - (297 - boxes[2][0] - boxes[2][2]))).toBeLessThan(0.2);
    expect(Math.abs(boxes[1][0] - (boxes[0][0] + boxes[0][2]) - 3)).toBeLessThan(0.2);
  });

  it('keeps one alone no wider than a third of the page, and lays past four on two rows', () => {
    expect(angleBoxes(1, 297, 210)[0][2]).toBe(99);
    const six = angleBoxes(6, 297, 210);
    expect(new Set(six.map(([, y]) => y)).size).toBe(2);
    // five: three on the first row, the two left centred under them
    const five = angleBoxes(5, 297, 210);
    expect(five.slice(0, 3).every(([, y]) => y === five[0][1])).toBe(true);
    expect(Math.abs(five[3][0] - (297 - five[4][0] - five[4][2]))).toBeLessThan(0.2);
    expect(angleBoxes(0, 297, 210)).toEqual([]);
  });
});
