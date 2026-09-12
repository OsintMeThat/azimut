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

/**
 * The map itself: dragging the content by dx/dy moves the centre the other way,
 * in the flattening the site really draws in.
 *
 * The extension never does this — it moves the canvas and waits for the address
 * bar to say where the map landed — so the simulator lives here, where being
 * the ground truth is the whole job.
 */
function dragged(view, dx, dy) {
  const centre = ext.project(view.lat, view.lon, view.zoom, view.projection);
  const moved = ext.unproject(centre.x - dx, centre.y - dy, view.zoom, view.projection);
  return { ...view, ...moved };
}

describe('the zoom a measured scale names', () => {
  it('reads back the zoom the map was drawn at', () => {
    // what makes a measurement able to correct a *scale* without replacing the
    // *shape*: pxPerLon names the zoom, and both Mercators agree about it
    for (const zoom of [3, 12.37, 17, 21.5]) {
      for (const how of ['webmercator', 'ellipsoidal']) {
        const step = 0.0005;
        const at = { lat: 48.8584, lon: 2.2945 };
        const east = ext.project(at.lat, at.lon + step, zoom, how).x;
        const west = ext.project(at.lat, at.lon - step, zoom, how).x;
        expect(ext.zoomFromScale((east - west) / (2 * step))).toBeCloseTo(zoom, 9);
      }
    }
  });

  it('has nothing to say without a scale', () => {
    expect(ext.zoomFromScale(0)).toBe(null);
    expect(ext.zoomFromScale(null)).toBe(null);
  });
});

describe('reading the new scale off the point a zoom held still', () => {
  /** A map at `zoom`, and the view that results from zooming about `at` by
   *  `factor` while keeping whatever is under that pixel where it is. */
  function zoomAbout(view, factor, at) {
    const held = ext.toLatLon(at, view, AREA);
    const centre = ext.project(view.lat, view.lon, view.zoom, view.projection);
    const point = ext.project(held.lat, held.lon, view.zoom, view.projection);
    // The held point keeps its pixel offset from the centre while the scale
    // grows by `factor`, so in the fixed world of the old zoom the centre closes
    // in on it by the same factor.
    const after = {
      x: point.x + (centre.x - point.x) / factor,
      y: point.y + (centre.y - point.y) / factor,
    };
    const moved = ext.unproject(after.x, after.y, view.zoom, view.projection);
    return { view: { ...view, ...moved }, held };
  }

  const START = { lat: 48.8584, lon: 2.2945, zoom: 14, bearing: 0, projection: 'webmercator' };

  function scaleAt(view) {
    const step = 0.0005;
    const east = ext.project(view.lat, view.lon + step, view.zoom, view.projection).x;
    const west = ext.project(view.lat, view.lon - step, view.zoom, view.projection).x;
    const north = ext.project(view.lat + step, view.lon, view.zoom, view.projection).y;
    const south = ext.project(view.lat - step, view.lon, view.zoom, view.projection).y;
    return { pxPerLon: (east - west) / (2 * step), pxPerLat: (north - south) / (2 * step) };
  }

  it('recovers the factor exactly off the longitude axis', () => {
    // Longitude is where Mercator is linear, so the answer is the factor itself
    // — no projection, no zoom level, no tile size anywhere in the arithmetic.
    const scale = scaleAt(START);
    for (const at of [{ x: 1100, y: 300 }, { x: 200, y: 700 }]) {
      for (const factor of [2, 0.5, 1.37]) {
        const { view, held } = zoomAbout(START, factor, at);
        expect(ext.rescaleFromAnchor({ x: at.x, y: at.y, ...held }, view, AREA, scale))
          .toBeCloseTo(factor, 6);
      }
    }
  });

  it('is within a thousandth off the latitude axis, where Mercator bends', () => {
    // An anchor straight above the centre leaves only the northing to divide by,
    // and the northing is not linear in latitude. Over a few hundred pixels that
    // is a fraction of a percent — small enough to draw with, and the residual
    // is watching it either way.
    const at = { x: AREA.x + AREA.w / 2, y: 160 };
    const { view, held } = zoomAbout(START, 2, at);
    const factor = ext.rescaleFromAnchor({ x: at.x, y: at.y, ...held }, view, AREA, scaleAt(START));
    expect(factor).toBeCloseTo(2, 2);
  });

  it('refuses an anchor too close to the centre to divide by', () => {
    // there the difference in coordinate is smaller than the address bar's own
    // rounding, and the division turns that into any number at all
    const at = { x: AREA.x + AREA.w / 2 + 5, y: AREA.y + AREA.h / 2 + 5 };
    const { view, held } = zoomAbout(START, 2, at);
    expect(ext.rescaleFromAnchor({ x: at.x, y: at.y, ...held }, view, AREA, scaleAt(START))).toBe(null);
  });

  it('reads a rotated map, the anchor turned back into the world’s axes', () => {
    // Turning a view changes which way the screen looks at the ground and
    // nothing about how big the ground is drawn, so the factor is the same one.
    // This used to be a refusal, and on Google Earth — the one view with no
    // scale in its URL — a refusal here meant the tools stopped at the first
    // nudge of the compass.
    const turned = { ...START, bearing: 30 };
    const scale = scaleAt(turned);
    for (const at of [{ x: 1100, y: 300 }, { x: 200, y: 700 }]) {
      const { view, held } = zoomAbout(turned, 2, at);
      expect(ext.rescaleFromAnchor({ x: at.x, y: at.y, ...held }, view, AREA, scale))
        .toBeCloseTo(2, 2);
    }
  });

  it('refuses when there is nothing to rescale from', () => {
    expect(ext.rescaleFromAnchor(null, START, AREA, scaleAt(START))).toBe(null);
    expect(ext.rescaleFromAnchor({ x: 900, y: 300, lat: 1, lon: 1 }, START, AREA, null)).toBe(null);
  });

  it('refuses a factor no zoom could have produced', () => {
    // a stale anchor, or a jump to somewhere else entirely: a hundredfold is
    // not a zoom step, it is a different map
    const anchor = { x: 900, y: 300, lat: 48.8584, lon: 2.2945 + 1e-6 };
    expect(ext.rescaleFromAnchor(anchor, START, AREA, scaleAt(START))).toBe(null);
  });
});

describe('carrying a measured scale through a zoom nobody named', () => {
  it('rescales by the ratio of two camera spans', () => {
    const cal = ext.createCalibration();
    const real = { lat: 10, lon: -66, zoom: 14, bearing: 0, projection: 'webmercator' };
    for (const [dx, dy] of [[200, 0], [0, -150]]) cal.observe(real, dragged(real, dx, dy), dx, dy);
    const before = { ...cal.scale };
    // the address bar went from 4378 m across to 2189: twice as close, twice
    // the pixels per degree
    expect(cal.rescale(4378 / 2189)).toBe(true);
    expect(cal.scale.pxPerLon).toBeCloseTo(before.pxPerLon * 2, 9);
    expect(cal.scale.pxPerLat).toBeCloseTo(before.pxPerLat * 2, 9);
    // and it claims nothing about a prediction it has not made yet
    expect(cal.residual).toBe(null);
  });

  it('refuses to carry what it never measured, or by a factor that is not one', () => {
    const cal = ext.createCalibration();
    expect(cal.rescale(2)).toBe(false); // nothing measured yet
    const real = { lat: 10, lon: -66, zoom: 14, bearing: 0, projection: 'webmercator' };
    for (const [dx, dy] of [[200, 0], [0, -150]]) cal.observe(real, dragged(real, dx, dy), dx, dy);
    expect(cal.rescale(0)).toBe(false);
    expect(cal.rescale(-1)).toBe(false);
    expect(cal.rescale(Number.NaN)).toBe(false);
  });
});

describe('measuring the map instead of assuming it', () => {
  const AT = { lat: 55.7558, lon: 37.6173 }; // Moscow, where the two differ most

  /** Pan a simulated map drawn in `truth`, and hand the calibration what the
   *  address bar would have said afterwards — never which projection it was. */
  function survey(truth, pans = [[200, 0], [0, -150]], zoom = 14) {
    const real = { ...AT, zoom, bearing: 0, projection: truth };
    const cal = ext.createCalibration();
    for (const [dx, dy] of pans) cal.observe(real, dragged(real, dx, dy), dx, dy);
    return { cal, real };
  }

  it('puts a name to the flattening it just measured', () => {
    for (const truth of ['webmercator', 'ellipsoidal']) {
      const { cal, real } = survey(truth);
      expect(ext.identify(cal.scale, real)).toBe(truth);
    }
  });

  it('says nothing rather than the nearest thing, for a map drawn in neither', () => {
    // an equal-area map stretches latitude the other way; nothing in the table
    // matches, and the honest answer is that we cannot name it
    const { cal, real } = survey('webmercator');
    const foreign = { ...cal.scale, pxPerLat: cal.scale.pxPerLat * 0.6 };
    expect(ext.identify(foreign, real)).toBe(null);
  });

  it('draws through the measurement without consulting any projection', () => {
    const { cal, real } = survey('ellipsoidal');
    const point = { lat: AT.lat + 0.004, lon: AT.lon + 0.006 };
    const truth = ext.toScreen(point, real, AREA);
    const measured = ext.toScreenMeasured(point, real, AREA, cal.scale);
    // within a pixel of the projection it never saw
    expect(measured.x).toBeCloseTo(truth.x, 0);
    expect(measured.y).toBeCloseTo(truth.y, 0);
  });

  it('round-trips a pixel through the measured scale', () => {
    const { cal, real } = survey('webmercator');
    for (const at of [{ x: 100, y: 120 }, { x: 900, y: 700 }]) {
      const back = ext.toScreenMeasured(
        ext.toLatLonMeasured(at, real, AREA, cal.scale),
        real,
        AREA,
        cal.scale
      );
      expect(back.x).toBeCloseTo(at.x, 6);
      expect(back.y).toBeCloseTo(at.y, 6);
    }
  });

  it('ignores a nudge too small to divide into a rounded coordinate', () => {
    const { cal } = survey('webmercator', [[3, 0], [0, -4]]);
    expect(cal.samples).toBe(0);
    expect(cal.scale).toBe(null);
  });

  it('needs a pan on each axis before it can draw anything', () => {
    const { cal } = survey('webmercator', [[200, 0]]);
    expect(cal.samples).toBe(1);
    expect(cal.scale).toBe(null); // one axis is not a scale
  });

  it('reports a small residual while the map keeps behaving', () => {
    const { cal, real } = survey('ellipsoidal', [[200, 0], [0, -150]]);
    cal.observe(real, dragged(real, 120, -90), 120, -90);
    expect(cal.residual).toBeLessThan(1);
  });

  it('reports a large one the moment the map stops matching', () => {
    // the site switched flattening under us, or drew a globe, or opened a panel
    const { cal, real } = survey('webmercator');
    const elsewhere = { ...real, projection: 'ellipsoidal', zoom: real.zoom - 3 };
    cal.observe(real, dragged(elsewhere, 300, -200), 300, -200);
    expect(cal.residual).toBeGreaterThan(10);
  });

  /**
   * A map that is turned, which on Google Earth is one drag of the compass away
   * and used to stop the tools dead.
   *
   * What is measured is pixels per degree, and degrees run along the world's
   * axes however the screen is oriented — so the pointer's travel is turned back
   * into them first. Read raw, a drag on a map turned 30° divides an x-travel by
   * a difference of longitude the drag only partly made: the scale came out
   * wrong, the next pan missed its prediction, and the panel refused to draw.
   */
  describe('a map held at a bearing', () => {
    /** The same drag on a turned map. The coordinate that sat under the pixel
     *  the pointer started from is the one centred afterwards, which is what a
     *  pan *is* — stated through the projection rather than through the turn
     *  the code under test does itself. */
    function draggedTurned(view, dx, dy) {
      const mid = { x: AREA.x + AREA.w / 2, y: AREA.y + AREA.h / 2 };
      const moved = ext.toLatLon({ x: mid.x - dx, y: mid.y - dy }, view, AREA);
      return { ...view, ...moved };
    }

    const PANS = [[200, 0], [0, -150], [140, 90]];

    function measure(bearing) {
      const real = { ...AT, zoom: 14, bearing, projection: 'webmercator' };
      const cal = ext.createCalibration();
      for (const [dx, dy] of PANS) cal.observe(real, draggedTurned(real, dx, dy), dx, dy);
      return { cal, real };
    }

    it('measures the same scale as the same map facing north', () => {
      // To a thousandth, and the rest is Mercator: a turned drag covers a
      // different span of latitude for the same pixels, and the northing is not
      // linear in it. That is the same error a level pan carries.
      const level = measure(0).cal.scale;
      for (const bearing of [30, 90, 187.5, 315]) {
        const { cal } = measure(bearing);
        expect(cal.scale.pxPerLon / level.pxPerLon).toBeCloseTo(1, 3);
        expect(cal.scale.pxPerLat / level.pxPerLat).toBeCloseTo(1, 3);
      }
    });

    it('predicts the next pan on it, so nothing reads as drift', () => {
      // The residual is what makes the panel stop drawing. Measured raw on a
      // turned map it ran to hundreds of pixels and the tools switched off.
      const { cal, real } = measure(30);
      cal.observe(real, draggedTurned(real, 120, -90), 120, -90);
      expect(cal.residual).toBeLessThan(1);
    });

    it('still reports the drift that is real', () => {
      const { cal, real } = measure(30);
      const elsewhere = { ...real, zoom: real.zoom - 3 };
      cal.observe(real, draggedTurned(elsewhere, 300, -200), 300, -200);
      expect(cal.residual).toBeGreaterThan(10);
    });

    it('draws through that measurement as accurately as a level map', () => {
      const { cal, real } = measure(30);
      const point = { lat: AT.lat + 0.004, lon: AT.lon + 0.006 };
      const truth = ext.toScreen(point, real, AREA);
      const measured = ext.toScreenMeasured(point, real, AREA, cal.scale);
      expect(measured.x).toBeCloseTo(truth.x, 0);
      expect(measured.y).toBeCloseTo(truth.y, 0);
    });
  });

  it('forgets everything when the zoom changes, since scale is a function of it', () => {
    const { cal } = survey('webmercator');
    expect(cal.scale).not.toBe(null);
    cal.reset();
    expect(cal.scale).toBe(null);
    expect(cal.residual).toBe(null);
  });
});

describe('Equal Earth, carried before anything asks for it', () => {
  it('round-trips over the whole globe, poles and antimeridian included', () => {
    for (const lat of [-89, -70, -23.5, 0, 23.5, 45, 70, 89]) {
      for (const lon of [-180, -120, -1, 0, 55, 179]) {
        const at = ext.project(lat, lon, 10, 'equalearth');
        const back = ext.unproject(at.x, at.y, 10, 'equalearth');
        expect(back.lat).toBeCloseTo(lat, 8);
        expect(back.lon).toBeCloseTo(lon, 8);
      }
    }
  });

  it('is equal-area, so it does not stretch the poles the way Mercator does', () => {
    // Mercator's latitude scale runs away towards the pole; an equal-area map's
    // does the opposite. That is the whole reason anyone wants to switch.
    const scaleAt = (lat, projection) =>
      Math.abs(
        ext.project(lat + 0.001, 0, 12, projection).y - ext.project(lat - 0.001, 0, 12, projection).y
      );
    expect(scaleAt(70, 'webmercator')).toBeGreaterThan(scaleAt(0, 'webmercator'));
    expect(scaleAt(70, 'equalearth')).toBeLessThan(scaleAt(0, 'equalearth'));
  });

  it('curves its meridians, so longitude narrows towards the poles', () => {
    const widthAt = (lat) =>
      ext.project(lat, 1, 12, 'equalearth').x - ext.project(lat, -1, 12, 'equalearth').x;
    expect(widthAt(70)).toBeLessThan(widthAt(0));
    // …where Mercator's does not move at all
    const merc = (lat) =>
      ext.project(lat, 1, 12, 'webmercator').x - ext.project(lat, -1, 12, 'webmercator').x;
    expect(merc(70)).toBeCloseTo(merc(0), 6);
  });

  it('is recognised from a measurement, so a site switching to it keeps working', () => {
    const { cal, real } = surveyIn('equalearth', 48.85);
    expect(ext.identify(cal.scale, real, { prefer: 'webmercator' })).toBe('equalearth');
  });

  it('is told apart from Mercator even where their latitude scales cross', () => {
    // they cross in the low thirties, where the northing alone says nothing —
    // the easting is what settles it
    for (const lat of [30, 32, 34]) {
      for (const truth of ['webmercator', 'equalearth']) {
        const { cal, real } = surveyIn(truth, lat);
        expect(ext.identify(cal.scale, real, { prefer: 'webmercator' }), `${truth} at ${lat}`).toBe(
          truth
        );
      }
    }
  });
});

describe('where measurement cannot decide, the site table does', () => {
  it('keeps the table’s answer for two Mercators under a percent apart', () => {
    // no address bar rounds finely enough to separate these, so overruling the
    // site table here would be noise deciding a fact
    for (const truth of ['webmercator', 'ellipsoidal']) {
      const { cal, real } = surveyIn(truth, 55.75);
      expect(ext.identify(cal.scale, real, { prefer: 'ellipsoidal' })).toBe('ellipsoidal');
    }
  });

  it('overrules the table when the measurement is nowhere near it', () => {
    const { cal, real } = surveyIn('equalearth', 48.85);
    expect(ext.identify(cal.scale, real, { prefer: 'ellipsoidal' })).toBe('equalearth');
  });
});

/** Pan a simulated map drawn in `truth` and hand the calibration only what the
 *  address bar would have said — never which projection produced it. */
function surveyIn(truth, lat, zoom = 14) {
  const real = { lat, lon: 10, zoom, bearing: 0, projection: truth };
  const cal = ext.createCalibration();
  for (const [dx, dy] of [[220, 0], [0, -170]]) {
    cal.observe(real, dragged(real, dx, dy), dx, dy);
  }
  return { cal, real };
}
