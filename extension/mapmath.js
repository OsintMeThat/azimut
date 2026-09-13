/**
 * The arithmetic behind the map tools: Web Mercator, and the geodesic measures
 * drawn with it. No DOM, no extension API, no site knowledge — just numbers.
 *
 * **Why this is a second copy.** The app states these same rules in
 * `frontend/src/lib/measure.js`, and stating a rule twice is normally how the
 * two versions start disagreeing. There is no import across this boundary: the
 * extension ships as plain classic scripts with no build step, deliberately, so
 * that what the analyst loads into their browser is the file in the repo. The
 * guard is a test instead of a module system — `extensionMapMath.test.js` runs
 * both copies over the same points and fails on the first digit they disagree
 * about. Add a formula here, add it to that comparison.
 *
 * **Nothing here reads the site's map.** Where the camera is comes from the
 * address bar, parsed by the app (`engine/mapsites.py`); this turns that into
 * pixels. That is the rail the whole capture path already runs on: a coordinate
 * is what the URL says, verifiable by anyone holding the recorded link.
 *
 * **And nothing here is learned from a gesture.** How big the map is drawn is a
 * number the site wrote (a level, a height in metres, a span, a camera
 * distance), checked against a browser before it was believed
 * (`docs/MAP_SITES.md`). Measuring it off a drag instead is what put Earth's
 * drawing four times too small: a drag loses pixels to the site's threshold
 * and gains them to its glide, and one bad reading lived on through every zoom.
 * The one thing a gesture still says is *where* a site draws its centre, from a
 * zoom about a held pixel, below.
 *
 * Loaded before `mapoverlay.js` and left on `window.AzimutMapMath`.
 */

(() => {
  const TILE = 256; // the tile edge every one of these sites is scaled in
  const R = 6378137; // WGS84 equatorial radius (m) — the one Web Mercator uses
  //. Mercator sends the poles to infinity, so the projection is defined on a
  //. square and cut here. This is the value every slippy map cuts at.
  const MAX_LAT = 85.05112877980659;

  const rad = (deg) => (deg * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;
  const clampLat = (lat) => Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));

  /** The whole world, in CSS pixels, at this zoom. */
  function worldSize(zoom) {
    return TILE * Math.pow(2, zoom);
  }

  //. WGS84's first eccentricity — the whole difference between the two
  //. Mercators below. Anchored on the view centre they agree there and drift
  //. apart across the viewport, which measures as tens of metres at z12 and
  //. under a metre by z17. Which one a site draws in is still never assumed:
  //. a grid cell is metres wide.
  const E = 0.081819190842621;

  /** Geographic → world pixels, spherical Mercator (EPSG:3857). */
  function projectSpherical(lat, lon, zoom) {
    const size = worldSize(zoom);
    const phi = rad(clampLat(lat));
    return {
      x: ((lon + 180) / 360) * size,
      y: ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * size,
    };
  }

  /** World pixels → geographic, spherical Mercator. */
  function unprojectSpherical(x, y, zoom) {
    const size = worldSize(zoom);
    const n = Math.PI - (2 * Math.PI * y) / size;
    return {
      lat: deg(Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))),
      lon: (x / size) * 360 - 180,
    };
  }

  /**
   * Geographic → world pixels, elliptical Mercator (EPSG:3395) — Yandex.
   *
   * The same map with the Earth's flattening kept in. Longitude is untouched;
   * only the northing moves, and only by a scale factor — which is why the
   * error from picking the wrong one grows with distance from the anchor
   * rather than showing up as a jump.
   */
  function projectEllipsoidal(lat, lon, zoom) {
    const size = worldSize(zoom);
    const phi = rad(clampLat(lat));
    const es = E * Math.sin(phi);
    const t = Math.tan(Math.PI / 4 + phi / 2) * Math.pow((1 - es) / (1 + es), E / 2);
    return {
      x: ((lon + 180) / 360) * size,
      y: ((1 - Math.log(t) / Math.PI) / 2) * size,
    };
  }

  /**
   * World pixels → geographic, elliptical Mercator.
   *
   * No closed form for the inverse, so it is iterated. The correction shrinks by
   * about the eccentricity squared each round, which puts eight rounds far below
   * a pixel anywhere on the map — and the loop leaves early once it stops moving.
   */
  function unprojectEllipsoidal(x, y, zoom) {
    const size = worldSize(zoom);
    const t = Math.exp((1 - (2 * y) / size) * Math.PI);
    let phi = Math.PI / 2 - 2 * Math.atan(1 / t);
    for (let i = 0; i < 8; i += 1) {
      const es = E * Math.sin(phi);
      const next =
        Math.PI / 2 - 2 * Math.atan((1 / t) * Math.pow((1 - es) / (1 + es), E / 2));
      if (Math.abs(next - phi) < 1e-12) {
        phi = next;
        break;
      }
      phi = next;
    }
    return { lat: deg(phi), lon: (x / size) * 360 - 180 };
  }

  /**
   * The flattenings we can write down, named per site by the app
   * (`engine/mapsites.py`). Unknown is a refusal rather than a default.
   */
  const PROJECTIONS = {
    webmercator: { project: projectSpherical, unproject: unprojectSpherical },
    ellipsoidal: { project: projectEllipsoidal, unproject: unprojectEllipsoidal },
  };

  function flattening(view) {
    const pair = PROJECTIONS[view?.projection];
    if (!pair) throw new Error(`no projection named "${view?.projection}"`);
    return pair;
  }

  const project = (lat, lon, zoom, how = "webmercator") =>
    PROJECTIONS[how].project(lat, lon, zoom);
  const unproject = (x, y, zoom, how = "webmercator") =>
    PROJECTIONS[how].unproject(x, y, zoom);

  /**
   * The way of writing `lon` that sits nearest `near`.
   *
   * A point a kilometre west of the antimeridian is at +179.99 and the view at
   * -179.99; subtract them raw and the point lands most of a world away, on the
   * far edge of the screen. The map wraps, so the nearest writing is the true
   * one.
   */
  function wrapNear(lon, near) {
    let out = lon;
    while (out - near > 180) out -= 360;
    while (near - out > 180) out += 360;
    return out;
  }

  /**
   * Where a point falls inside the map area, in CSS pixels of the page.
   *
   * `view` is what the URL said: `{ lat, lon, zoom, bearing }`, the camera
   * centred on the area. `area` is that rectangle, `{ x, y, w, h }` — placed
   * where this site draws its centre (`centreFromZoom`).
   */
  function toScreen(point, view, area) {
    const flat = flattening(view);
    const centre = flat.project(view.lat, view.lon, view.zoom);
    const here = flat.project(point.lat, wrapNear(point.lon, view.lon), view.zoom);
    return offsetToScreen(here.x - centre.x, here.y - centre.y, view, area);
  }

  /** The inverse: a page pixel back to a coordinate. */
  function toLatLon(at, view, area) {
    const flat = flattening(view);
    const centre = flat.project(view.lat, view.lon, view.zoom);
    const { dx, dy } = screenToOffset(at, view, area);
    return flat.unproject(centre.x + dx, centre.y + dy, view.zoom);
  }

  /**
   * A world-pixel offset from the centre, turned by the view's bearing.
   *
   * Bearing is the compass direction the map has *up* — Google Earth's `h`, and
   * the façade's own reading. So east up means north points left, which is a
   * turn of minus the bearing, not plus it.
   */
  function offsetToScreen(dx, dy, view, area) {
    const spun = turn(dx, dy, view);
    return { x: area.x + area.w / 2 + spun.dx, y: area.y + area.h / 2 + spun.dy };
  }

  /** A world-axis displacement in screen axes: the bearing applied, with no
   *  centre in it. `unturn` is the same turn the other way. */
  function turn(dx, dy, view) {
    const angle = -rad(view?.bearing || 0);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return { dx: dx * cos - dy * sin, dy: dx * sin + dy * cos };
  }

  /** …and back, turning the other way. */
  function screenToOffset(at, view, area) {
    const { dx, dy } = unturn(at.x - (area.x + area.w / 2), at.y - (area.y + area.h / 2), view);
    return { dx, dy };
  }

  /**
   * A screen *displacement* back in the world's own axes.
   *
   * The same turn `screenToOffset` applies, with no centre in it: a zoom
   * anchor's offset is a vector rather than a point, and it is compared with
   * coordinates, which run along the world's axes and not the screen's.
   */
  function unturn(dx, dy, view) {
    const turn = rad(view?.bearing || 0);
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    return { dx: dx * cos - dy * sin, dy: dx * sin + dy * cos };
  }

  // --- where the site draws its own centre ---------------------------------
  //
  // The address bar says how big. This answers "where": which pixel of
  // the window the coordinate in the address bar is actually under.
  //
  // It is not the middle of the window on every site, and the difference is not
  // small. Measured in a browser at 1600×1000: Yandex's centre sits 210 px
  // right of the window's, because its results panel is 420 px wide and the map
  // is centred in what is left; Apple's sits 67 px right; Bing's 40 px down,
  // under its header; OpenStreetMap's 27 px down, under its. Drawn on the
  // window's centre instead, every one of those is a fixed offset on the
  // ground — 90 m at z15 for Yandex — that no amount of scale accuracy touches,
  // because a pan cannot see it: slide the whole map and the offset slides with
  // it.
  //
  // A zoom can. Every one of these maps zooms about a point it holds still, so
  // that point is under the same pixel before and after while the centre
  // underneath it has moved — and the pixel that did not move is the one the
  // arithmetic below solves for. Two coordinates the site wrote, two zooms it
  // stated, one pixel this window counted; no assumption about panels, screens
  // or layout anywhere in it.

  /** How much the zoom has to have changed before the division below is worth
   *  doing. A tenth of a level is mostly the address bar's own rounding, and
   *  the answer comes out amplified by 1/(1−2^Δz). */
  const MIN_ZOOM_STEP = 0.5;

  /**
   * The pixel the site's camera centre is drawn at, from a zoom about a held
   * point — or null when this zoom cannot say.
   *
   * With `s = 2^zoom` and world coordinates `w()` taken at zoom 0, the held
   * point `P` is under the same pixel `p` before and after:
   *
   *     p = C + s₀·(w(P) − w(c₀)) = C + s₁·(w(P) − w(c₁))
   *
   * which fixes `w(P)`, and `C` with it. Both axes are solved the same way and
   * independently, so a site that is off-centre one way only says so.
   *
   * @param {object} before the view the address bar stated before the zoom
   * @param {object} after the view it states now
   * @param {{x: number, y: number}} at the pixel the zoom was made about
   */
  function centreFromZoom(before, after, at) {
    if (!before || !after || !at) return null;
    // A gesture that turned *and* zoomed cannot be read: the offset below is
    // turned by one bearing and there were two. A view held at a bearing is
    // fine, and that is what a rotated map is between two nudges of its
    // compass.
    if ((before.bearing || 0) !== (after.bearing || 0)) return null;
    if (before.zoom == null || after.zoom == null) return null;
    if (Math.abs(after.zoom - before.zoom) < MIN_ZOOM_STEP) return null;
    if (before.projection !== after.projection) return null;
    if (!PROJECTIONS[before.projection]) return null; // a view nothing can be drawn on
    const flat = flattening(before);
    const s0 = Math.pow(2, before.zoom);
    const s1 = Math.pow(2, after.zoom);
    const c0 = flat.project(before.lat, before.lon, 0);
    const c1 = flat.project(after.lat, wrapNear(after.lon, before.lon), 0);
    // Where the held point is in the world follows from the two zooms alone —
    // the bearing cancels, since the same turn carries both sides of `p = C +
    // R·s·(w(P) − w(c))`. What the turn does touch is the last step: the offset
    // taken off the held pixel is a world-axis one, and on a rotated map that
    // is not the offset the screen sees.
    const held = (axis) => (s0 * c0[axis] - s1 * c1[axis]) / (s0 - s1);
    const spun = turn(s0 * (held("x") - c0.x), s0 * (held("y") - c0.y), before);
    const centre = { x: at.x - spun.dx, y: at.y - spun.dy };
    return Number.isFinite(centre.x) && Number.isFinite(centre.y) ? centre : null;
  }

  /** How far from the centre the held point has to be before the division below
   *  says more than the address bar's own rounding does. */
  const MIN_ANCHOR_PX = 80;

  /**
   * The zoom a view is really at, from the pixel a zoom held still — even when
   * the address bar rounded the number it landed on.
   *
   * Bing is why. Its wheel moves a third of a level at a time and it writes one
   * decimal, so "15.3" is really 15.3333: a fortieth of a level, which is two
   * and a third percent of scale, which is five metres at the edge of the
   * screen. The centre solve above cannot see it — the frame is an offset, and
   * a scale error grows outward from it.
   *
   * With the frame already known, the same held point says it outright. The
   * point sits `d` pixels from the centre both before and after, so its place
   * in the world follows from the scale before it, and the scale after it
   * follows from where the centre went:
   *
   *     w(P) = w(c₀) + d/s₀      s₁ = d / (w(P) − w(c₁))
   *
   * Two things it will not do. It needs a `before` whose zoom is already exact,
   * because an error there comes straight out the other side — a whole level is
   * exact by definition, and a corrected one stays exact. And it is a
   * correction, not a replacement: an answer more than half a level from what
   * the site said is something else having moved, and is refused.
   *
   * @param {object} before the view before the zoom, at a zoom known to be true
   * @param {object} after what the address bar says now
   * @param {{x: number, y: number}} at the pixel the zoom was made about
   * @param {{x: number, y: number}} centre where this site draws its camera
   */
  function zoomFromAnchor(before, after, at, centre) {
    if (!before || !after || !at || !centre) return null;
    if ((before.bearing || 0) !== (after.bearing || 0)) return null;
    if (before.zoom == null || after.zoom == null) return null;
    if (before.projection !== after.projection) return null;
    if (!PROJECTIONS[before.projection]) return null;
    const flat = flattening(before);
    const s0 = Math.pow(2, before.zoom);
    const c0 = flat.project(before.lat, before.lon, 0);
    const c1 = flat.project(after.lat, wrapNear(after.lon, before.lon), 0);
    // the held pixel's offset from the centre, in the world's axes — which is
    // the frame the two coordinates below are measured in
    const held = unturn(at.x - centre.x, at.y - centre.y, before);
    const offsets = { x: held.dx, y: held.dy };
    const solve = (axis) => {
      const d = offsets[axis];
      if (Math.abs(d) < MIN_ANCHOR_PX) return null;
      const span = c0[axis] + d / s0 - c1[axis];
      if (!span || !Number.isFinite(span)) return null;
      const zoom = Math.log2(d / span);
      return Number.isFinite(zoom) ? zoom : null;
    };
    // the axis whose anchor sits furthest from the centre divides by the most
    const wide = Math.abs(offsets.x) >= Math.abs(offsets.y);
    const first = wide ? solve("x") : solve("y");
    const other = wide ? solve("y") : solve("x");
    const zoom = first ?? other;
    if (zoom == null) return null;
    return Math.abs(zoom - after.zoom) <= 0.5 ? zoom : null;
  }

  // --- geodesic measures (mirrored from lib/measure.js) --------------------

  /** Great-circle distance between two points, in metres (haversine). */
  function haversine(a, b) {
    const dLat = rad(b.lat - a.lat);
    const dLon = rad(b.lon - a.lon);
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /** Total length of a clicked path, in metres. */
  function pathLength(points) {
    let total = 0;
    for (let i = 1; i < points.length; i += 1) total += haversine(points[i - 1], points[i]);
    return total;
  }

  /** Area of a closed polygon on the sphere, in square metres. */
  function polygonArea(points) {
    if (points.length < 3) return 0;
    let sum = 0;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      sum += rad(b.lon - a.lon) * (2 + Math.sin(rad(a.lat)) + Math.sin(rad(b.lat)));
    }
    return Math.abs((sum * R * R) / 2);
  }

  const FT_PER_M = 3.28084;
  const FT_PER_MI = 5280;
  const SQFT_PER_ACRE = 43560;
  const SQMI_PER_SQM = 3.861021585e-7;

  //. Written exactly as `lib/measure.js` writes them — the cross-check test
  //. compares the two strings, not just the two numbers, because a readout that
  //. reads differently in the extension is a second answer to one question.
  function formatDistance(m, units = "metric") {
    if (units === "imperial") {
      const ft = m * FT_PER_M;
      if (ft < FT_PER_MI) return `${ft < 10 ? ft.toFixed(1) : Math.round(ft)} ft`;
      const mi = ft / FT_PER_MI;
      return `${mi.toFixed(mi < 10 ? 2 : 1)} mi`;
    }
    if (m < 1000) return `${m < 10 ? m.toFixed(1) : Math.round(m)} m`;
    return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
  }

  function formatArea(m2, units = "metric") {
    if (units === "imperial") {
      const sqft = m2 * FT_PER_M * FT_PER_M;
      if (sqft < SQFT_PER_ACRE) return `${Math.round(sqft)} ft²`;
      const sqmi = m2 * SQMI_PER_SQM;
      if (sqmi < 1) return `${(sqft / SQFT_PER_ACRE).toFixed(2)} acres`;
      return `${sqmi.toFixed(2)} mi²`;
    }
    if (m2 < 10000) return `${Math.round(m2)} m²`;
    if (m2 < 1e6) return `${(m2 / 10000).toFixed(2)} ha`;
    return `${(m2 / 1e6).toFixed(2)} km²`;
  }

  // Exported: what another file or a test actually calls. The projections'
  // primitives are here because the round trip through them is the property
  // that pins this file down; everything else stays inside it.
  window.AzimutMapMath = {
    project,
    unproject,
    centreFromZoom,
    zoomFromAnchor,
    MIN_ZOOM_STEP,
    toScreen,
    toLatLon,
    turn,
    unturn,
    MIN_ANCHOR_PX,
    haversine,
    pathLength,
    polygonArea,
    formatDistance,
    formatArea,
  };
})();
