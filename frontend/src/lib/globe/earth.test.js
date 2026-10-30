import { describe, expect, it } from 'vitest';
import { EARTH, cross, dot, ecef, geodetic, haversine, length, localFrame, metresPerPixel, raySphere, rotate, wrapLon } from './earth.js';

describe('points on the Earth', () => {
  it('reads a point back where it was put, height included', () => {
    for (const [lat, lon, h] of [
      [46.56, 7.91, 2000],
      [-33.9, 151.2, 0],
      [0, 179.999, -420],
      [85, -120, 8000],
    ]) {
      const back = geodetic(ecef(lat, lon, h));
      expect(back.lat).toBeCloseTo(lat, 9);
      expect(back.lon).toBeCloseTo(lon, 9);
      expect(back.h).toBeCloseTo(h, 5);
    }
  });

  it('gives each point an up, east and north at right angles, north toward the pole', () => {
    const { up, east, north } = localFrame(ecef(45, 30, 0));
    expect(length(up)).toBeCloseTo(1, 12);
    expect(dot(up, east)).toBeCloseTo(0, 12);
    expect(dot(up, north)).toBeCloseTo(0, 12);
    expect(dot(east, north)).toBeCloseTo(0, 12);
    // right-handed: east then north make up
    const made = cross(east, north);
    for (let i = 0; i < 3; i += 1) expect(made[i]).toBeCloseTo(up[i], 12);
    expect(north[2]).toBeGreaterThan(0);
  });

  it('keeps a frame at the poles, where east is not defined by the meridian', () => {
    const { east, north } = localFrame([0, 0, EARTH]);
    expect(length(east)).toBeCloseTo(1, 12);
    expect(length(north)).toBeCloseTo(1, 12);
  });

  it('turns a vector right-handed about an axis', () => {
    const turned = rotate([1, 0, 0], [0, 0, 1], Math.PI / 2);
    expect(turned[0]).toBeCloseTo(0, 12);
    expect(turned[1]).toBeCloseTo(1, 12);
  });

  it('finds where a ray meets a sphere from outside and from inside, and misses past it', () => {
    expect(raySphere([0, 0, 2 * EARTH], [0, 0, -1], EARTH)).toBeCloseTo(EARTH, 3);
    expect(raySphere([0, 0, 0], [1, 0, 0], EARTH)).toBeCloseTo(EARTH, 3);
    expect(raySphere([0, 0, 2 * EARTH], [1, 0, 0], EARTH)).toBe(null);
    // the sphere behind the eye is not met
    expect(raySphere([0, 0, 2 * EARTH], [0, 0, 1], EARTH)).toBe(null);
  });

  it('measures and wraps as the flat map does', () => {
    expect(haversine({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo((2 * Math.PI * EARTH) / 360, 3);
    expect(wrapLon(190)).toBeCloseTo(-170, 12);
    expect(wrapLon(-181)).toBeCloseTo(179, 12);
    // zoom counted on 256 px tiles: a level halves a pixel's reach
    expect(metresPerPixel(0, 1) / metresPerPixel(0, 2)).toBeCloseTo(2, 12);
  });
});
