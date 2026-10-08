import { describe, expect, it } from 'vitest';
import { EARTH, REFRACTION, eyeAltitude, eyeFrame, latToY, lonToX, terrarium, tileLat, tileLon } from './geo.js';

describe('the tile grid', () => {
  it('goes from a tile to its corner and back', () => {
    for (const [x, y, z] of [
      [0, 0, 0],
      [33, 22, 6],
      [8513, 5795, 14],
    ]) {
      expect(lonToX(tileLon(x, z), z)).toBeCloseTo(x, 9);
      expect(latToY(tileLat(y, z), z)).toBeCloseTo(y, 6);
    }
    // the equator halves the grid, the Greenwich meridian too
    expect(latToY(0, 4)).toBeCloseTo(8, 9);
    expect(lonToX(0, 4)).toBe(8);
  });

  it('reads heights from terrarium pixels', () => {
    const rgba = new Uint8Array([128, 0, 0, 255, 128, 100, 128, 255, 127, 255, 0, 255]);
    expect([...terrarium(rgba, 3)]).toEqual([0, 100.5, -1]);
  });
});

describe('the eye', () => {
  it('stands over the ground on foot and by drone, over the sea in an aircraft, never under the ground', () => {
    expect(eyeAltitude('ground', 1.7, 1000)).toBeCloseTo(1001.7, 9);
    expect(eyeAltitude('drone', 120, 1000)).toBe(1120);
    expect(eyeAltitude('aircraft', 3000, 1000)).toBe(3000);
    expect(eyeAltitude('aircraft', 500, 1000)).toBe(1001);
  });

  it('places the ground where the app marches it, curve and refraction included', () => {
    const frame = eyeFrame({ lat: 46, lon: 7.8, alt: 1000 });
    expect(frame.R).toBeCloseTo(EARTH / (1 - REFRACTION), 3);
    const out = [0, 0, 0];
    // engine/horizon.py elevation_angle(10000, 1500, 1000) and (50000, 3000, 2000)
    const [lat, lon] = frame.destination(0, 10000);
    frame.place(lat, lon, 1500, out, 0);
    expect(Math.atan2(out[2], Math.hypot(out[0], out[1]))).toBeCloseTo(0.04926709554079477, 7);
    const high = eyeFrame({ lat: 46, lon: 7.8, alt: 2000 });
    const [far, farLon] = high.destination(Math.PI / 3, 50000);
    high.place(far, farLon, 3000, out, 0);
    expect(Math.atan2(out[2], Math.hypot(out[0], out[1]))).toBeCloseTo(0.01657653153712824, 7);
  });

  it('puts east on x, north on y and the eye at the origin', () => {
    const frame = eyeFrame({ lat: 16.99, lon: 45.1, alt: 1200 });
    const out = [0, 0, 0];
    frame.place(16.99, 45.1, 1200, out, 0);
    expect(Math.hypot(...out)).toBeLessThan(1e-6);
    const [lat, lon] = frame.destination(Math.PI / 2, 2000);
    frame.place(lat, lon, 1200, out, 0);
    expect(out[0]).toBeGreaterThan(1999);
    expect(Math.abs(out[1])).toBeLessThan(1);
    // the ground drops away with the square of the distance on the enlarged sphere
    expect(out[2]).toBeCloseTo(-(2000 ** 2) / (2 * frame.R), 2);
  });

  it('finds where a point of its frame stands, and the frame point back', () => {
    const frame = eyeFrame({ lat: 45.94, lon: 7.82, alt: 3100 });
    const out = [0, 0, 0];
    const [lat, lon] = frame.destination(4.9, 12700);
    frame.place(lat, lon, 4478, out, 0);
    const at = frame.locate(...out);
    expect(at.lat).toBeCloseTo(lat, 8);
    expect(at.lon).toBeCloseTo(lon, 8);
    expect(at.h).toBeCloseTo(4478, 4);
    expect(at.d).toBeCloseTo(12700, 3);
    expect(frame.up(4478, at.delta)).toBeCloseTo(out[2], 6);
    // under a point of the level, as the shadow grids read it
    frame.place(lat, lon, 0, out, 0);
    const under = frame.ground(out[0], out[1]);
    expect(under.lat).toBeCloseTo(lat, 8);
    expect(under.lon).toBeCloseTo(lon, 8);
    const [d, bearing] = frame.inverse(lat, lon);
    expect(d).toBeCloseTo(12700, 3);
    expect(bearing).toBeCloseTo(4.9 - 2 * Math.PI, 6);
  });
});
