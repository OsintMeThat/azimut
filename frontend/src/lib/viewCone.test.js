import { describe, expect, it } from 'vitest';
import {
  along,
  bearingTo,
  coneHandles,
  fovFromEdge,
  fovOfFocal,
  lensFov,
  lensOf,
  uprightFov,
} from './viewCone.js';

describe('a phone camera as a view cone', () => {
  it('reads a lens off its 35 mm equivalent', () => {
    expect(fovOfFocal(26)).toBeCloseTo(69.4, 1);
    expect(lensFov('0.5')).toBeCloseTo(108.3, 1);
    expect(lensFov('2')).toBeCloseTo(38.2, 1);
    expect(lensFov('nope')).toBeNull();
  });

  it('sees narrower held upright, across the short side of the frame', () => {
    expect(uprightFov(lensFov('1'))).toBeCloseTo(42.6, 1);
    expect(lensFov('1', true)).toBeLessThan(lensFov('1'));
  });

  it('names the lens a width is, and nothing for a width set by hand', () => {
    expect(lensOf(69)).toEqual({ id: '1', upright: false });
    expect(lensOf(lensFov('2', true))).toEqual({ id: '2', upright: true });
    expect(lensOf(55)).toBeNull();
  });
});

describe('the cone on its picture', () => {
  it('measures bearings clockwise from up', () => {
    expect(bearingTo({ x: 0, y: 0 }, { x: 0, y: -10 })).toBeCloseTo(0);
    expect(bearingTo({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(90);
    expect(bearingTo({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(180);
    expect(bearingTo({ x: 0, y: 0 }, { x: -10, y: 0 })).toBeCloseTo(-90);
    const right = along(90);
    expect(right.x).toBeCloseTo(1);
    expect(right.y).toBeCloseTo(0);
  });

  it('puts its handles at the far end and on both edges', () => {
    const cone = { x: 100, y: 100, rotation: 90, reach: 50, fov: 60 };
    const { end, left, right } = coneHandles(cone);
    expect(end.x).toBeCloseTo(150);
    expect(end.y).toBeCloseTo(100);
    // 30° either side of the line of sight
    expect(bearingTo(cone, left)).toBeCloseTo(60);
    expect(bearingTo(cone, right)).toBeCloseTo(120);
  });

  it('opens to twice an edge’s angle, settling on a lens near one', () => {
    const cone = { x: 0, y: 0, rotation: 0, reach: 50, fov: 60 };
    // 27.5° off the line of sight: 55°, no lens there
    const free = fovFromEdge(cone, { x: Math.tan((27.5 * Math.PI) / 180) * 50, y: -50 });
    expect(free.fov).toBeCloseTo(55, 0);
    expect(free.lens).toBeNull();
    // 34.5° off: 69°, the main lens
    const main = fovFromEdge(cone, { x: Math.tan((34.5 * Math.PI) / 180) * 50, y: -50 });
    expect(main).toMatchObject({ lens: '1', upright: false });
    expect(main.fov).toBeCloseTo(lensFov('1'), 3);
    // never a slit narrower than 4°, nor wider than 170°
    expect(fovFromEdge(cone, { x: 0, y: -50 }).fov).toBe(4);
    expect(fovFromEdge(cone, { x: 1, y: 50 }).fov).toBe(170);
  });
});
