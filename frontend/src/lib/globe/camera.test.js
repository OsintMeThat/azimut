import { describe, expect, it } from 'vitest';
import {
  MAX_TILT,
  aimed,
  axes,
  cameraFor,
  distanceFor,
  dolly,
  levelled,
  lifted,
  tiltCeiling,
  orbit,
  project,
  rayAt,
  turnBetween,
  turned,
  viewOf,
  zoomFor,
} from './camera.js';
import { EARTH, add, dot, ecef, geodetic, length, normalize, raySphere, scale, sub } from './earth.js';

const SIZE = { width: 1280, height: 720 };
const VIEWS = [
  { lat: 46.56, lon: 7.91, zoom: 13.4, bearing: 30, pitch: 60, elevation: 2000 },
  { lat: -33, lon: 151, zoom: 4, bearing: 0, pitch: 0, elevation: 0 },
  { lat: 15.35, lon: 43.95, zoom: 16, bearing: 270, pitch: 85, elevation: 2300 },
];

/** Where a pixel's ray meets the sphere `h` metres up. */
function groundAt(camera, x, y, h = 0) {
  const dir = rayAt(camera, SIZE, x, y);
  return add(camera.eye, scale(dir, raySphere(camera.eye, dir, EARTH + h)));
}

describe('the eye a view of the app has', () => {
  it('reads back the view it was made from, centre, zoom, turn, tilt and height', () => {
    for (const view of VIEWS) {
      const camera = cameraFor(view, SIZE);
      const back = viewOf(camera, SIZE, ecef(view.lat, view.lon, view.elevation));
      expect(back.lat).toBeCloseTo(view.lat, 8);
      expect(back.lon).toBeCloseTo(view.lon, 8);
      expect(back.zoom).toBeCloseTo(view.zoom, 8);
      expect(back.bearing).toBeCloseTo(view.bearing, 6);
      expect(back.pitch).toBeCloseTo(view.pitch, 6);
      expect(back.elevation).toBeCloseTo(view.elevation, 4);
    }
  });

  it('puts the centre of the view in the middle of the screen', () => {
    for (const view of VIEWS) {
      const camera = cameraFor(view, SIZE);
      const at = project(camera, SIZE, ecef(view.lat, view.lon, view.elevation));
      expect(at.x).toBeCloseTo(SIZE.width / 2, 6);
      expect(at.y).toBeCloseTo(SIZE.height / 2, 6);
      const ray = rayAt(camera, SIZE, SIZE.width / 2, SIZE.height / 2);
      const toward = normalize(sub(ecef(view.lat, view.lon, view.elevation), camera.eye));
      expect(dot(ray, toward)).toBeCloseTo(1, 12);
    }
  });

  it('stands as far as the flat map at that zoom, at the flat map turn', () => {
    const view = VIEWS[0];
    const camera = cameraFor({ ...view, pitch: 0 }, SIZE);
    expect(geodetic(camera.eye).h - view.elevation).toBeCloseTo(distanceFor(view.lat, view.zoom, SIZE.height), 3);
    expect(zoomFor(view.lat, distanceFor(view.lat, view.zoom, SIZE.height), SIZE.height)).toBeCloseTo(view.zoom, 10);
    // the app's bearing turns the map, so the eye faces the other way round
    expect(camera.heading).toBeCloseTo(330, 6);
  });

  it('hides what is behind the eye', () => {
    const camera = cameraFor(VIEWS[0], SIZE);
    const behind = add(camera.eye, scale(axes(camera).forward, -1000));
    expect(project(camera, SIZE, behind)).toBe(null);
  });
});

describe('moving the eye', () => {
  it('keeps the grabbed ground under the hand when the Earth turns, at the same height', () => {
    for (const view of VIEWS) {
      const camera = cameraFor(view, SIZE);
      const grab = groundAt(camera, 300, 500, view.elevation);
      const dir = rayAt(camera, SIZE, 700, 300);
      const meets = add(camera.eye, scale(dir, raySphere(camera.eye, dir, length(grab))));
      const turn = turnBetween(meets, grab);
      const moved = turned(camera, [0, 0, 0], turn.axis, turn.angle);
      const at = project(moved, SIZE, grab);
      expect(at.x).toBeCloseTo(700, 6);
      expect(at.y).toBeCloseTo(300, 6);
      expect(geodetic(moved.eye).h).toBeCloseTo(geodetic(camera.eye).h, 4);
    }
  });

  it('swings round a pivot, which stays put, and holds its tilt between straight down and the horizon', () => {
    const view = VIEWS[0];
    const camera = cameraFor(view, SIZE);
    const pivot = ecef(view.lat, view.lon, view.elevation);
    const swung = orbit(camera, pivot, 25, 10);
    const at = project(swung, SIZE, pivot);
    expect(at.x).toBeCloseTo(SIZE.width / 2, 6);
    expect(at.y).toBeCloseTo(SIZE.height / 2, 6);
    const read = viewOf(swung, SIZE, pivot);
    expect(read.pitch).toBeCloseTo(70, 6);
    expect(read.bearing).toBeCloseTo(5, 6);
    // the distance to the pivot is kept
    expect(length(sub(swung.eye, pivot))).toBeCloseTo(length(sub(camera.eye, pivot)), 4);
    expect(viewOf(orbit(camera, pivot, 0, 80), SIZE, pivot).pitch).toBeCloseTo(MAX_TILT, 6);
    expect(viewOf(orbit(camera, pivot, 0, -80), SIZE, pivot).pitch).toBeCloseTo(0, 6);
  });

  it('slides the eye along its line of sight, the point it slides to staying on its pixel', () => {
    const camera = cameraFor(VIEWS[0], SIZE);
    const target = groundAt(camera, 300, 500, 2000);
    const half = dolly(camera, target, 0.5);
    expect(length(sub(half.eye, target))).toBeCloseTo(length(sub(camera.eye, target)) / 2, 3);
    const at = project(aimed(half, SIZE, target, 300, 500), SIZE, target);
    expect(at.x).toBeCloseTo(300, 2);
    expect(at.y).toBeCloseTo(500, 2);
  });

  it('aims back onto a point from far off, where levelling the horizon turns the picture', () => {
    let camera = cameraFor(VIEWS[1], SIZE);
    const target = groundAt(camera, 300, 500);
    // a wheel's worth of small slides from 8 800 km up
    for (let i = 0; i < 60; i += 1) camera = aimed(dolly(camera, target, 0.05), SIZE, target, 300, 500);
    const at = project(camera, SIZE, target);
    expect(at.x).toBeCloseTo(300, 2);
    expect(at.y).toBeCloseTo(500, 2);
  });

  it('never aims worse than the move alone', () => {
    const camera = cameraFor(VIEWS[1], SIZE);
    const target = groundAt(camera, 300, 500);
    const far = dolly(camera, target, 0.9);
    const miss = (c) => {
      const at = project(c, SIZE, target);
      return at ? Math.hypot(at.x - 300, at.y - 500) : Infinity;
    };
    expect(miss(aimed(far, SIZE, target, 300, 500))).toBeLessThanOrEqual(miss(far));
  });

  it('levels the horizon, and a camera looking a little behind straight down keeps its heading', () => {
    const camera = cameraFor({ ...VIEWS[0], pitch: 0 }, SIZE);
    const { forward, up } = axes({ ...camera, tilt: -5 });
    const back = levelled(camera.eye, forward, up);
    expect(back.tilt).toBeCloseTo(-5, 8);
    expect(back.heading).toBeCloseTo(camera.heading, 8);
  });

  it('rises straight up, the way it looks kept', () => {
    const camera = cameraFor(VIEWS[0], SIZE);
    const up = lifted(camera, 100);
    expect(geodetic(up.eye).h - geodetic(camera.eye).h).toBeCloseTo(100, 4);
    expect(up.tilt).toBeCloseTo(camera.tilt, 8);
    expect(up.heading).toBeCloseTo(camera.heading, 8);
  });
});

describe('how far the eye may tilt', () => {
  it('nearly to the horizon near the ground, and less as it rises, so the Earth stays in view', () => {
    expect(tiltCeiling(0)).toBe(MAX_TILT);
    expect(tiltCeiling(2000)).toBeGreaterThan(85);
    expect(tiltCeiling(1e6)).toBeLessThan(55);
    // from 20 000 km the Earth spans 14 degrees either side of straight down
    expect(tiltCeiling(2e7)).toBeLessThan(3);
    // the middle of the screen meets the Earth at that tilt
    for (const h of [5e4, 1e6, 2e7]) {
      const camera = levelled([0, 0, EARTH + h], [0, Math.sin((tiltCeiling(h) * Math.PI) / 180), -Math.cos((tiltCeiling(h) * Math.PI) / 180)], [0, 1, 0]);
      expect(raySphere(camera.eye, rayAt(camera, SIZE, SIZE.width / 2, SIZE.height / 2), EARTH)).not.toBe(null);
    }
  });
});
