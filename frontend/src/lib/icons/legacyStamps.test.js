// Every proof saved before the stamps were redrawn names one of these eleven. They
// must all still resolve and draw, under the same names and labels, with the pin
// still hung from its tip and the view cone still finding its camera.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ICON_BOX, iconAnchor, iconByName, isSolidIcon, stampParts } from '../proofIcons.js';
import { STAMPS } from './stamps.js';

const OLD_NAMES = {
  point: 'Point', impact: 'Impact', vehicle: 'Vehicle', truck: 'Truck', tank: 'Tank', person: 'Person',
  building: 'Building', drone: 'Drone', camera: 'Camera', antenna: 'Antenna', nord: 'North',
};

/** Every coordinate pair in a path made of M, L and Z. */
const points = (d) => [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);

describe('the eleven stamps a saved proof can name', () => {
  it('keeps every old name, in the old order, under its old label', () => {
    expect(STAMPS.map((s) => s.name)).toEqual(Object.keys(OLD_NAMES));
    for (const [name, label] of Object.entries(OLD_NAMES)) expect(iconByName(name).label).toBe(label);
  });

  it('draws each of them, inside the box, in closed shapes', () => {
    for (const name of Object.keys(OLD_NAMES)) {
      const stamp = iconByName(name);
      for (const d of [stamp.fill, stamp.cut].filter(Boolean)) {
        expect(d.startsWith('M')).toBe(true);
        expect(d.endsWith('Z')).toBe(true);
        for (const [x, y] of points(d)) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(ICON_BOX);
          expect(y).toBeLessThanOrEqual(ICON_BOX);
        }
      }
      expect(stampParts(name, { color: '#ff5252' }).length).toBeGreaterThanOrEqual(2);
      expect(stampParts(name, { color: '#ff5252', disc: 1 })).toHaveLength(1);
    }
  });

  it('carves the details inside the silhouette', () => {
    const extent = (d) => {
      const p = points(d);
      return [Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1]))];
    };
    for (const stamp of STAMPS.filter((s) => s.cut)) {
      const [x0, y0, x1, y1] = extent(stamp.fill);
      const [a0, b0, a1, b1] = extent(stamp.cut);
      expect(a0).toBeGreaterThanOrEqual(x0);
      expect(b0).toBeGreaterThanOrEqual(y0);
      expect(a1).toBeLessThanOrEqual(x1);
      expect(b1).toBeLessThanOrEqual(y1);
    }
  });

  it('joins both layers into one outline for whatever strokes or fills a stamp in one go', () => {
    for (const stamp of STAMPS) expect(stamp.path).toBe(stamp.fill + stamp.cut);
  });

  it('keeps the same three silhouettes free of a stroke width, and the pin on its tip', () => {
    expect(Object.keys(OLD_NAMES).filter(isSolidIcon)).toEqual(['point', 'impact', 'nord']);
    expect(iconAnchor('point')).toEqual([0.5, 22.4 / ICON_BOX]);
    const tip = points(iconByName('point').fill).reduce((low, p) => (p[1] > low[1] ? p : low));
    expect(tip[0]).toBeCloseTo(12, 1);
    expect(tip[1]).toBeCloseTo(22.4, 1);
  });

  it('leaves the view cone its camera, a body round a lens', () => {
    const camera = iconByName('camera');
    expect(camera.path.match(/M/g).length).toBeGreaterThanOrEqual(3);
    const composer = readFileSync(new URL('../../tools/ProofComposer.svelte', import.meta.url), 'utf8');
    const cone = composer.slice(composer.indexOf('function makeConeNode'), composer.indexOf('function drawConeHandles'));
    expect(cone).toContain("iconByName('camera')");
    expect(cone).toContain('data: camera.path');
  });
});
