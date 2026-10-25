import { describe, expect, it } from 'vitest';
import { areaAt, orthographic } from './globe2d.js';
import world from './world.json';

describe('the globe a locator is drawn as', () => {
  it('stands the map\'s middle in its own middle, the far side on the rim', () => {
    const project = orthographic(48, 31);
    const [x, y, seen] = project(31, 48);
    expect(Math.abs(x) + Math.abs(y)).toBeLessThan(1e-9);
    expect(seen).toBe(true);
    const far = project(-149, -48);
    expect(far[2]).toBe(false);
    expect(Math.hypot(far[0], far[1])).toBeCloseTo(1, 6);
    // north is up
    expect(project(31, 60)[1]).toBeLessThan(0);
  });

  it('knows the country a point stands in from Natural Earth\'s, and none at sea', () => {
    expect(world.source).toMatch(/Natural Earth/);
    expect(areaAt(world, 30.52, 50.45)?.n).toBe('Ukraine');
    expect(areaAt(world, 2.35, 48.85)?.n).toBe('France');
    expect(areaAt(world, 37.6, 55.75)?.n).toBe('Russia');
    expect(areaAt(world, -30, 30)).toBe(null);
    expect(areaAt(null, 0, 0)).toBe(null);
  });

  it('picks out a disputed area itself, never the country holding it', () => {
    // Sevastopol and Donetsk lie in areas Natural Earth draws inside the country holding them
    for (const [lon, lat] of [[33.6, 44.6], [37.8, 48.0]]) {
      const area = areaAt(world, lon, lat);
      expect(world.disputed).toContain(area);
      expect(area.n).toBeUndefined();
    }
  });
});
