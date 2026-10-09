import { describe, expect, it, vi } from 'vitest';
import {
  CLEARANCE,
  CLEARANCE_SHARE,
  createEyeGuard,
  createGroundSampler,
  EYE_ZOOM,
  liftFor,
  sampleHeights,
} from './eyeGuard.js';

/** A tile of heights that rise one metre a sample eastward and ten southward. */
function slope(size) {
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) heights[y * size + x] = x + 10 * y;
  return heights;
}

/** Until the test lets them, tile reads wait. */
function reads(heights) {
  const asked = [];
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const load = vi.fn(async (z, x, y) => {
    asked.push([z, x, y]);
    await gate;
    return heights;
  });
  return { load, asked, release: () => release() };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The engine's camera, as a camera update hands it over. */
function transform({ altitude, centreElevation = 500, eye = { lng: 7.9, lat: 46.6 } }) {
  return {
    center: { lng: eye.lng, lat: eye.lat + 0.05 },
    elevation: centreElevation,
    bearing: -20,
    pitch: 80,
    getCameraLngLat: () => eye,
    getCameraAltitude: () => altitude,
    calculateCenterFromCameraLngLatAlt: vi.fn(() => ({
      center: { lng: eye.lng, lat: eye.lat + 0.08 },
      elevation: centreElevation,
      zoom: 12.5,
    })),
  };
}

const LIFTED = { center: { lng: 7.9, lat: 46.68 }, elevation: 500, zoom: 12.5 };

describe('the ground under the eye', () => {
  it('reads a height between its four nearest samples', () => {
    const heights = slope(4);
    // the middle of the sample at column 1, row 2
    expect(sampleHeights(heights, 4, 1.5 / 4, 2.5 / 4)).toBeCloseTo(21);
    // halfway between columns 1 and 2
    expect(sampleHeights(heights, 4, 2 / 4, 2.5 / 4)).toBeCloseTo(21.5);
    // a point past the last sample keeps to the edge
    expect(sampleHeights(heights, 4, 1, 1)).toBeCloseTo(33);
  });

  it('answers nothing while its tile is read, asks for it once, then answers at once', async () => {
    const tile = reads(new Float32Array(4).fill(1800));
    const ground = createGroundSampler({ load: tile.load, size: 2 });
    const heard = vi.fn();
    ground.onLoad(heard);
    expect(ground.at(46.6, 7.9)).toBeNull();
    expect(ground.at(46.6, 7.9)).toBeNull();
    tile.release();
    await settled();
    expect(tile.load).toHaveBeenCalledTimes(1);
    expect(tile.asked[0][0]).toBe(EYE_ZOOM);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(ground.at(46.6, 7.9)).toBeCloseTo(1800);
  });

  it('does not ask again for a tile it could not read, nor for a point off the map', async () => {
    const load = vi.fn(async () => null);
    const ground = createGroundSampler({ load, size: 2 });
    ground.at(10, 10);
    await settled();
    expect(ground.at(10, 10)).toBeNull();
    expect(ground.at(89, 0)).toBeNull();
    expect(ground.at(Number.NaN, 0)).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('lifting the eye clear of the ground', () => {
  it('leaves an eye that clears the ground alone', () => {
    expect(liftFor(transform({ altitude: 3000 }), 1000)).toEqual({});
    expect(liftFor(transform({ altitude: 3000 }), Number.NaN)).toEqual({});
  });

  it('raises an eye inside the mountain straight up to its clearance, tilt and heading kept', () => {
    const tr = transform({ altitude: 2245 });
    const lift = liftFor(tr, 2880);
    expect(lift).toEqual(LIFTED);
    const [eye, altitude, bearing, pitch] = tr.calculateCenterFromCameraLngLatAlt.mock.calls[0];
    expect(eye).toEqual({ lng: 7.9, lat: 46.6 });
    expect([bearing, pitch]).toEqual([-20, 80]);
    // the point looked at is 5.5 km away: its share of that is more than the least clearance
    expect(altitude).toBeGreaterThan(2880 + CLEARANCE);
    expect(altitude).toBeCloseTo(2880 + CLEARANCE_SHARE * 5560, -1);
    expect('pitch' in lift).toBe(false);
  });

  it('counts the heights as drawn, exaggeration included', () => {
    expect(liftFor(transform({ altitude: 2500 }), 1000)).toEqual({});
    expect(liftFor(transform({ altitude: 2500 }), 1000, 3)).toEqual(LIFTED);
  });

  it('never lifts to below the point it looks at', () => {
    // a lift that would end lower than the centre is no camera the engine can take
    expect(liftFor(transform({ altitude: 100, centreElevation: 3000 }), 200)).toEqual({});
  });
});

describe('the guard on a map', () => {
  function guardedMap() {
    return {
      terrain: { exaggeration: 1 },
      _camera: { transformCameraUpdate: null, elevationFreeze: false, transform: transform({ altitude: 2245 }) },
      isMoving: () => false,
      jumpTo: vi.fn(),
    };
  }

  it('lifts every camera while on, and none once off', async () => {
    const tile = reads(new Float32Array(512 * 512).fill(2880));
    const map = guardedMap();
    const guard = createEyeGuard(map, tile.load);
    guard.start();
    const lift = map._camera.transformCameraUpdate;
    expect(typeof lift).toBe('function');
    // the tile under the eye is not in yet: nothing to go by
    expect(lift(transform({ altitude: 2245 }))).toEqual({});
    tile.release();
    await settled();
    expect(lift(transform({ altitude: 2245 }))).toEqual(LIFTED);
    guard.stop();
    expect(map._camera.transformCameraUpdate).toBeNull();
  });

  it('lifts a camera that already sank when the ground under it arrives', async () => {
    const tile = reads(new Float32Array(512 * 512).fill(2880));
    const map = guardedMap();
    createEyeGuard(map, tile.load).start();
    map._camera.transformCameraUpdate(map._camera.transform);
    tile.release();
    await settled();
    expect(map.jumpTo).toHaveBeenCalledWith(LIFTED);
  });
});
