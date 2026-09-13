// @vitest-environment happy-dom
/**
 * The map tools' arithmetic, on both sides of a boundary it cannot be imported
 * across (extension/mapmath.js).
 *
 * The extension ships as plain classic scripts with no build step, so the
 * geodesic measures the app states in `lib/measure.js` are written a second
 * time over there. That is normally how two copies start disagreeing — so this
 * file is the module system's replacement: it runs both over the same points
 * and fails on the first digit they differ about.
 *
 * The projections have no counterpart in the app (the app owns its own map, and
 * never has to guess someone else's), so they are pinned against the property
 * that actually matters: a round trip, and the two flattenings not being
 * interchangeable.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as app from './measure.js';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '../../../extension/mapmath.js'), 'utf8');

let ext;

beforeAll(() => {
  const scope = { window: {} };
  new Function('window', source)(scope.window);
  ext = scope.window.AzimutMapMath;
});

/** Points spread over latitude, the antimeridian and both hemispheres — the
 *  places a formula that is nearly right stops being right. */
const POINTS = [
  { lat: 0, lon: 0 },
  { lat: 48.8584, lon: 2.2945 },
  { lat: -33.8568, lon: 151.2153 },
  { lat: 68.9585, lon: 33.0827 },
  { lat: -54.8019, lon: -68.302 },
  { lat: 1.3521, lon: 103.8198 },
  { lat: 64.1466, lon: -21.9426 },
];

const view = (over, projection = 'webmercator', zoom = 15) => ({
  lat: over.lat,
  lon: over.lon,
  zoom,
  bearing: 0,
  projection,
});

const AREA = { x: 0, y: 0, w: 1400, h: 900 };

describe('the two copies of the measures agree', () => {
  it('on every distance between the sample points', () => {
    for (const a of POINTS) {
      for (const b of POINTS) {
        expect(ext.haversine(a, b)).toBeCloseTo(app.haversine(a, b), 6);
      }
    }
  });

  it('on the length of a path through all of them', () => {
    expect(ext.pathLength(POINTS)).toBeCloseTo(app.pathLength(POINTS), 6);
  });

  it('on the area of a polygon, at the equator and up north', () => {
    const equator = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
      { lat: 1, lon: 1 },
      { lat: 1, lon: 0 },
    ];
    const arctic = equator.map((p) => ({ lat: p.lat + 70, lon: p.lon }));
    expect(ext.polygonArea(equator)).toBeCloseTo(app.polygonArea(equator), 3);
    expect(ext.polygonArea(arctic)).toBeCloseTo(app.polygonArea(arctic), 3);
  });

  it('on how a distance is written, in both unit systems', () => {
    for (const m of [0, 1, 42, 999, 1000, 1609.344, 25000, 1e6]) {
      expect(ext.formatDistance(m)).toBe(app.formatDistance(m));
      expect(ext.formatDistance(m, 'imperial')).toBe(app.formatDistance(m, 'imperial'));
    }
  });

  it('on how an area is written, in both unit systems', () => {
    for (const m2 of [0, 500, 9999, 10000, 4046.86, 1e6, 1e7, 2.59e6]) {
      expect(ext.formatArea(m2)).toBe(app.formatArea(m2));
      expect(ext.formatArea(m2, 'imperial')).toBe(app.formatArea(m2, 'imperial'));
    }
  });
});

describe('projecting a point onto someone else’s map', () => {
  it('puts the view’s own centre in the middle of the map area', () => {
    for (const point of POINTS) {
      const at = ext.toScreen(point, view(point), AREA);
      expect(at.x).toBeCloseTo(AREA.x + AREA.w / 2, 6);
      expect(at.y).toBeCloseTo(AREA.y + AREA.h / 2, 6);
    }
  });

  it('round-trips a pixel back to the coordinate it came from', () => {
    for (const projection of ['webmercator', 'ellipsoidal']) {
      for (const centre of POINTS) {
        for (const at of [
          { x: 10, y: 10 },
          { x: 700, y: 450 },
          { x: 1390, y: 890 },
        ]) {
          const back = ext.toScreen(ext.toLatLon(at, view(centre, projection), AREA), view(centre, projection), AREA);
          expect(back.x).toBeCloseTo(at.x, 6);
          expect(back.y).toBeCloseTo(at.y, 6);
        }
      }
    }
  });

  it('does not fling a point across the screen at the antimeridian', () => {
    // a kilometre either side of the line is a kilometre, not most of a world
    const centre = { lat: 0, lon: 179.99 };
    const across = { lat: 0, lon: -179.99 };
    const at = ext.toScreen(across, view(centre, 'webmercator', 10), AREA);
    expect(Math.abs(at.x - AREA.w / 2)).toBeLessThan(50);
  });

  it('turns the drawing with a rotated view', () => {
    const centre = { lat: 48.8584, lon: 2.2945 };
    const north = { lat: 48.8684, lon: 2.2945 };
    const up = ext.toScreen(north, { ...view(centre), bearing: 0 }, AREA);
    const turned = ext.toScreen(north, { ...view(centre), bearing: 90 }, AREA);
    expect(up.y).toBeLessThan(AREA.h / 2); // north is up…
    expect(turned.x).toBeLessThan(AREA.w / 2); // …and to the left once turned
  });

  it('refuses a view whose flattening nobody named', () => {
    // guessing here is the failure mode the whole field exists to prevent
    expect(() => ext.toScreen(POINTS[1], view(POINTS[1], null), AREA)).toThrow(/projection/);
    expect(() => ext.toScreen(POINTS[1], view(POINTS[1], 'guess'), AREA)).toThrow(/projection/);
  });
});

describe('the two flattenings are not interchangeable', () => {
  it('agree at the anchor and drift apart across the viewport', () => {
    const centre = { lat: 55.7558, lon: 37.6173 }; // Yandex country
    const middle = { x: AREA.w / 2, y: AREA.h / 2 };
    const edge = { x: AREA.w / 2, y: 0 };
    const sphere = view(centre, 'webmercator', 12);
    const ellipse = view(centre, 'ellipsoidal', 12);

    const atAnchor = ext.haversine(
      ext.toLatLon(middle, sphere, AREA),
      ext.toLatLon(middle, ellipse, AREA)
    );
    const atEdge = ext.haversine(
      ext.toLatLon(edge, sphere, AREA),
      ext.toLatLon(edge, ellipse, AREA)
    );
    expect(atAnchor).toBeLessThan(0.01); // the anchor is shared, so no offset
    expect(atEdge).toBeGreaterThan(1); // …and the scale error shows at the edge
  });

  it('shrinks the disagreement as the view zooms in, since the edge comes closer', () => {
    const centre = { lat: 55.7558, lon: 37.6173 };
    const edge = { x: AREA.w / 2, y: 0 };
    const gap = (zoom) =>
      ext.haversine(
        ext.toLatLon(edge, view(centre, 'webmercator', zoom), AREA),
        ext.toLatLon(edge, view(centre, 'ellipsoidal', zoom), AREA)
      );
    expect(gap(12)).toBeGreaterThan(gap(15));
    expect(gap(15)).toBeGreaterThan(gap(17));
    expect(gap(17)).toBeLessThan(2); // where the tools are actually used
  });
});

describe('what the arithmetic will not do', () => {
  it('offers nothing that learns a scale from a gesture', () => {
    // How big a map is drawn comes from its URL (`engine/mapsites.py`). The
    // pan-measured scale that used to sit here put Earth's drawing four times
    // too small and kept it there, so it went, and this keeps it gone.
    expect(Object.keys(ext).sort()).toEqual(
      [
        'MIN_ANCHOR_PX',
        'MIN_ZOOM_STEP',
        'centreFromZoom',
        'formatArea',
        'formatDistance',
        'haversine',
        'pathLength',
        'polygonArea',
        'project',
        'toLatLon',
        'toScreen',
        'turn',
        'unproject',
        'unturn',
        'zoomFromAnchor',
      ].sort()
    );
  });
});
