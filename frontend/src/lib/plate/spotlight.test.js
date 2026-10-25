import { describe, expect, it } from 'vitest';
import world from './world.json';
import { countryAt, countryNames, shadeOf, spotlightShape } from './spotlight.js';

const holds = (rings, [x, y]) => rings.some((ring) => {
  let hit = false;
  for (let index = 0, last = ring.length - 1; index < ring.length; last = index, index += 1) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[last];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
});
const SEVASTOPOL = [33.52, 44.6];

describe('one country lit on a map', () => {
  it('names the country under a point, and none at sea or in a disputed area', () => {
    expect(countryAt(world, 30.52, 50.45)).toBe('Ukraine');
    expect(countryAt(world, 2.35, 48.86)).toBe('France');
    expect(countryAt(world, ...SEVASTOPOL)).toBe('');
    expect(countryAt(world, -30, 30)).toBe('');
    expect(countryNames(world)).toContain('Ukraine');
    expect(countryNames(world)).toEqual([...countryNames(world)].sort((a, b) => a.localeCompare(b)));
  });

  it('leaves Crimea half lit whether Ukraine or Russia is lit: neither in nor out', () => {
    for (const name of ['Ukraine', 'Russia']) {
      const shape = spotlightShape(world, name);
      expect(holds(shape.half, SEVASTOPOL)).toBe(true);
    }
    // beside Ukraine's outline, it is taken out of the shade with it
    expect(holds(spotlightShape(world, 'Ukraine').lit, SEVASTOPOL)).toBe(true);
    // a country far from any disputed area has none half lit
    expect(spotlightShape(world, 'Portugal').half).toEqual([]);
    expect(spotlightShape(world, 'Atlantis')).toBeNull();
  });

  it('darkens the rest toward black or fades it toward the paper, within bounds', () => {
    expect(shadeOf({ mode: 'dark', dim: 0.5 }, '#f7f4ee')).toEqual({ colour: '#000000', strength: 0.5 });
    expect(shadeOf({ mode: 'fade', dim: 2 }, '#f7f4ee')).toEqual({ colour: '#f7f4ee', strength: 0.9 });
    expect(shadeOf({}).strength).toBe(0.55);
  });
});
