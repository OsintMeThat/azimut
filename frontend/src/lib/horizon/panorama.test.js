import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { cellAt, decodePanorama, depthAt, inSight, openCuts, SKY, skylineAt, skylineWithin, wrap360 } from './panorama.js';

/** The app's distance codes (api/horizon.py `depth_codes`). */
const SCALE = { min: 1, max: 1e6, codes: 65534 };
function codes(metres) {
  const span = Math.log(SCALE.max / SCALE.min);
  return new Uint16Array(metres.map((d) => (Number.isNaN(d) ? 0 : 1 + Math.round((Math.log(d / SCALE.min) / span) * SCALE.codes))));
}

/** A 4 × 3 panorama at 90° a column and 1° a row, sky on the top row. */
function answer() {
  const depth = codes([NaN, NaN, NaN, NaN, 900, 5000, 8000, 12000, 100, 200, 300, 400]);
  const pack = (array) => deflateSync(Buffer.from(array.buffer)).toString('base64');
  return {
    observer: { lat: 46, lon: 7, mode: 'ground', height: 1.7, ground: 2000, altitude: 2001.7 },
    far: 150000,
    near: 0,
    refraction: 0.13,
    azimuth: { start: 0, step: 90, count: 4 },
    elevation: { top: 2, step: 1, count: 3 },
    skyline: [1.2, 1.4, 1.0, 0.8],
    skyline_distance: [900, 5000, 8000, 12000],
    depth: pack(depth),
    depth_scale: SCALE,
    normal_east: pack(new Int8Array([0, 0, 0, 0, 10, -20, 30, -40, 1, 2, 3, 4])),
    normal_north: pack(new Int8Array(12)),
    resolution_m: 3.3,
    credits: [{ label: 'Mapterhorn' }],
  };
}

describe('a panorama from the app', () => {
  it('inflates its rasters, sky made a value a shader can test', async () => {
    const panorama = await decodePanorama(answer());
    expect(panorama.depth).toHaveLength(12);
    expect(Array.from(panorama.depth.slice(0, 4))).toEqual([SKY, SKY, SKY, SKY]);
    expect(panorama.depth[5]).toBeCloseTo(5000, -1);
    expect(Math.abs(panorama.depth[8] / 100 - 1)).toBeLessThan(2e-4);
    expect(Array.from(panorama.east.slice(4, 8))).toEqual([10, -20, 30, -40]);
    expect(panorama.observer.altitude).toBe(2001.7);
  });

  it('reads a cell back by azimuth and elevation, round the turn', async () => {
    const panorama = await decodePanorama(answer());
    expect(cellAt(panorama, 90, 1)).toBe(5);
    expect(cellAt(panorama, 359, 1)).toBe(4); // past the last column is the first
    expect(cellAt(panorama, 0, 5)).toBe(-1); // above the band
    expect(depthAt(panorama, 180, 1)).toBeCloseTo(8000, -1);
    expect(depthAt(panorama, 180, 2)).toBeNull();
    expect(skylineAt(panorama, 92)).toBe(1.4);
    expect(wrap360(-30)).toBe(330);
  });

  it('reads a window of the turn only inside it', async () => {
    const window = { ...(await decodePanorama(answer())), azimuth: { start: 300, step: 30, count: 4, full: false } };
    expect(cellAt(window, 300, 1)).toBe(4);
    expect(cellAt(window, 0, 1)).toBe(6); // two steps on, across north
    expect(cellAt(window, 60, 1)).toBe(-1); // past its last column
    expect(skylineAt(window, 120)).toBeNull();
  });

  it('calls a summit in sight when the ground under its top is about as far as it', async () => {
    const panorama = await decodePanorama(answer());
    expect(inSight(panorama, { azimuth: 90, angle: 1.1, distance: 5100 }, { below: 0.1 })).toBe(true);
    // nearer ground stands in front of it
    expect(inSight(panorama, { azimuth: 90, angle: 1.1, distance: 9000 }, { below: 0.1 })).toBe(false);
    // its top is in the sky band: nothing under it to read
    expect(inSight(panorama, { azimuth: 90, angle: 2.4, distance: 5000 }, { below: 0.1 })).toBe(false);
  });
});

describe('the skyline at each reach haze could leave', () => {
  const pack = (array) => deflateSync(Buffer.from(array.buffer)).toString('base64');

  it('opens one row per reach, nearest first, NaN where no ground stands', async () => {
    const rows = Float32Array.from([1, 2, NaN, 4, 5, 6, 7, 8]);
    const cuts = openCuts(new Uint8Array(rows.buffer), [5_000, 20_000], 4);
    expect(cuts.map((cut) => cut.reach)).toEqual([5_000, 20_000]);
    expect(Array.from(cuts[1].skyline)).toEqual([5, 6, 7, 8]);
    expect(Number.isNaN(cuts[0].skyline[2])).toBe(true);
    // short of a row, or nothing sent: none
    expect(openCuts(new Uint8Array(rows.buffer), [5_000, 20_000, 50_000], 4)).toEqual([]);
    expect(openCuts(null, [5_000], 4)).toEqual([]);
  });

  it('comes with the panorama, and an answer without them has none', async () => {
    const base = await decodePanorama({ ...answer(), skyline_cuts: undefined });
    expect(base.cuts).toEqual([]);
    const count = base.azimuth.count;
    const sent = Float32Array.from({ length: 2 * count }, (_, i) => i);
    const panorama = await decodePanorama({ ...answer(), skyline_cuts: { reach: [5_000, 10_000], skylines: pack(sent) } });
    expect(panorama.cuts).toHaveLength(2);
    expect(panorama.cuts[1].skyline[0]).toBe(count);
    expect(skylineWithin(panorama, 10_000)).toBe(panorama.cuts[1].skyline);
    // a reach not kept, or none: the whole turn
    expect(skylineWithin(panorama, 50_000)).toBe(panorama.skyline);
    expect(skylineWithin(panorama)).toBe(panorama.skyline);
  });
});
