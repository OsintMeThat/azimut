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
 * **And the model is checked against the map, not trusted.** A named projection
 * is a guess about someone else's renderer, and those age — a site can change
 * flattening between two releases and the drawing would go on looking just as
 * confident. So a pan is treated as an experiment: the pointer moved a known
 * number of pixels, the URL then says where the centre went, and that is the
 * local scale with no projection assumed in it. The named ones are the
 * bootstrap and a way to put a name to what was measured; the measurement is
 * the authority, and its residual is what says when to stop drawing.
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

  // --- Equal Earth (Šavrič, Patterson & Jenny, 2018) ------------------------
  //
  // Here before anything needs it, on purpose. No site in the table draws in it
  // today; the point is that the day one starts, the overlay measures the map,
  // recognises what it is looking at and keeps drawing — instead of refusing,
  // or worse, carrying on in Mercator. Costing one afternoon now to not be the
  // reason a tool breaks later is the trade.
  //
  // Pseudocylindrical and equal-area, so unlike the two above it is not a
  // square: the world comes out about 2.05 times wider than tall, and meridians
  // curve, which means x depends on latitude as well as longitude. Both are
  // handled below; what they rule out is the shortcut of treating x and y
  // separately.
  const EE = { a1: 1.340264, a2: -0.081106, a3: 0.000893, a4: 0.003796 };
  const EE_M = Math.sqrt(3) / 2;

  /** The polynomial in θ that both the northing and the easting are built on. */
  function eeNorthing(t) {
    const t2 = t * t;
    const t6 = t2 * t2 * t2;
    return t * (EE.a1 + EE.a2 * t2 + t6 * (EE.a3 + EE.a4 * t2));
  }

  /** …and its derivative, which is the easting's denominator. */
  function eeSlope(t) {
    const t2 = t * t;
    const t6 = t2 * t2 * t2;
    return EE.a1 + 3 * EE.a2 * t2 + t6 * (7 * EE.a3 + 9 * EE.a4 * t2);
  }

  //. Half the world's width in the projection's own units, so it can be scaled
  //. into the same `worldSize(zoom)` box the other two use and stay comparable.
  const EE_HALF = Math.PI / (EE_M * EE.a1);

  function projectEqualEarth(lat, lon, zoom) {
    const size = worldSize(zoom);
    const phi = rad(Math.max(-90, Math.min(90, lat)));
    const t = Math.asin(EE_M * Math.sin(phi));
    const x = (rad(lon) * Math.cos(t)) / (EE_M * eeSlope(t));
    const y = eeNorthing(t);
    return {
      x: ((x + EE_HALF) / (2 * EE_HALF)) * size,
      y: size / 2 - (y / (2 * EE_HALF)) * size,
    };
  }

  /** Inverted by Newton on the northing — six rounds put it below a pixel, and
   *  it leaves early once it stops moving. */
  function unprojectEqualEarth(x, y, zoom) {
    const size = worldSize(zoom);
    const yr = ((size / 2 - y) * 2 * EE_HALF) / size;
    const xr = (x / size) * 2 * EE_HALF - EE_HALF;
    let t = yr;
    for (let i = 0; i < 12; i += 1) {
      const step = (eeNorthing(t) - yr) / eeSlope(t);
      t -= step;
      if (Math.abs(step) < 1e-12) break;
    }
    return {
      lat: deg(Math.asin(Math.sin(t) / EE_M)),
      lon: deg((EE_M * xr * eeSlope(t)) / Math.cos(t)),
    };
  }

  /**
   * The flattenings we can write down. Named by the app
   * (`engine/mapsites.py`) to bootstrap a view before any pan has been
   * measured, and unknown is a refusal rather than a default. Adding one here
   * also makes it identifiable from a measurement, with nothing else to write.
   */
  const PROJECTIONS = {
    webmercator: { project: projectSpherical, unproject: unprojectSpherical },
    ellipsoidal: { project: projectEllipsoidal, unproject: unprojectEllipsoidal },
    equalearth: { project: projectEqualEarth, unproject: unprojectEqualEarth },
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
   * centred on the area. `area` is that rectangle, `{ x, y, w, h }` — the
   * calibration, not a fact about the site.
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
   * The same turn `screenToOffset` applies, with no centre in it: a drag and a
   * zoom anchor are vectors rather than points, and both are measured against
   * coordinates, which run along the world's axes and not the screen's. On a
   * map turned 90° a horizontal drag is a move along a meridian, and dividing
   * its pixels by a difference of longitude answers about nothing.
   */
  function unturn(dx, dy, view) {
    const turn = rad(view?.bearing || 0);
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    return { dx: dx * cos - dy * sin, dy: dx * sin + dy * cos };
  }

  /** Fold a longitude back inside ±180, the way every one of these maps does. */
  function wrapLon(lon) {
    return ((((lon + 180) % 360) + 360) % 360) - 180;
  }

  // --- measuring the map instead of assuming it ----------------------------
  //
  // Everything above is a model of how a site draws. A model is a guess, and a
  // guess about someone else's renderer ages: a site can change flattening
  // between two Tuesdays, and the drawing would go on looking exactly as
  // confident as it did the week before.
  //
  // So the model is not the authority — the address bar is. Panning the map is
  // an experiment: the pointer moved a known number of pixels, and the URL then
  // says where the centre went. That is the local scale, read off the one
  // surface we are already allowed to read, with no projection assumed anywhere
  // in it.
  //
  // Over one viewport any smooth projection is near enough affine, which is why
  // two numbers describe it: pixels per degree, each way. What that buys is
  // independence from the whole table above — a site that switched to Equal
  // Earth overnight would be measured, not mis-drawn.

  /** How far apart two samples must be before they say anything about scale.
   *  A two-pixel nudge divided into a rounded coordinate is mostly noise. */
  const MIN_PAN_PX = 40;

  /**
   * One pan, turned into a scale reading.
   *
   * Dragging the content by `dx`/`dy` moves the centre the other way, so the
   * coordinate that is centred afterwards is the one that sat `dx`/`dy` pixels
   * away before. Returns only the axes this pan actually exercised.
   *
   * The pointer's travel is turned back into the world's axes first, because
   * that is what the two degree differences are measured along. Without it a
   * rotated map measured a scale that was a mix of both axes, the next pan
   * missed its prediction by hundreds of pixels, and the panel stopped drawing
   * — which is what turning the view on Google Earth used to do.
   */
  function readPan(before, after, dx, dy) {
    const out = {};
    const turned = unturn(dx, dy, before);
    const dLon = wrapNear(after.lon, before.lon) - before.lon;
    const dLat = after.lat - before.lat;
    if (Math.abs(turned.dx) >= MIN_PAN_PX && dLon) out.pxPerLon = -turned.dx / dLon;
    if (Math.abs(turned.dy) >= MIN_PAN_PX && dLat) out.pxPerLat = -turned.dy / dLat;
    return out;
  }

  /** How far a new reading may sit from the one held before it is taken for a
   *  gesture that overshot rather than for the map having changed scale. */
  const MAX_SCALE_JUMP = 0.25;

  const wild = (held, next) =>
    held != null && Math.abs(next - held) / Math.abs(held) > MAX_SCALE_JUMP;

  /**
   * A scale measured from the map itself, and how well it is holding.
   *
   * `residual` is the honest part: each new pan is first *predicted* with what
   * is already known, then compared with what the URL actually said. While that
   * stays small the model describes this map; when it grows, something changed
   * — a projection, a globe, a side panel — and the caller is expected to stop
   * drawing rather than draw wrong.
   */
  function createCalibration() {
    let pxPerLon = null;
    let pxPerLat = null;
    let residual = null;
    let samples = 0;

    return {
      get scale() {
        return pxPerLon && pxPerLat ? { pxPerLon, pxPerLat } : null;
      },
      get samples() {
        return samples;
      },
      /** Pixels between prediction and what the address bar said, last pan.
       *  Null until there was something to predict with. */
      get residual() {
        return residual;
      },

      /** Record one pan. Returns the residual it produced, or null. */
      observe(before, after, dx, dy) {
        const read = readPan(before, after, dx, dy);
        if (!read.pxPerLon && !read.pxPerLat) return null;
        if (pxPerLon && pxPerLat) {
          const dLon = wrapNear(after.lon, before.lon) - before.lon;
          const dLat = after.lat - before.lat;
          // scored in the world's axes, where the scale lives — the pointer's
          // travel is turned into them rather than the prediction out of them,
          // and a distance is the same length either way round
          const turned = unturn(dx, dy, before);
          residual = Math.hypot(-dLon * pxPerLon - turned.dx, -dLat * pxPerLat - turned.dy);
        }
        // The newest reading wins rather than being averaged in: scale is a
        // function of zoom and latitude, so an old sample is not a second
        // opinion about the same quantity, it is an answer about another view.
        //
        // Unless it is wild. These maps glide on after the finger leaves, so a
        // pan that ends in inertia reports a move the pointer never made and
        // reads as a scale a third larger than the real one. A zoom or a
        // rotation — the only things that legitimately move the scale — reset
        // this outright, so a jump this big with neither is a bad sample, and a
        // bad sample adopted is a drawing that is wrong until the next pan.
        if (read.pxPerLon && !wild(pxPerLon, read.pxPerLon)) pxPerLon = read.pxPerLon;
        if (read.pxPerLat && !wild(pxPerLat, read.pxPerLat)) pxPerLat = read.pxPerLat;
        samples += 1;
        return residual;
      },

      /**
       * Carry the scale through a zoom the address bar does not name.
       *
       * A view that quotes a camera span instead of a zoom (Google's satellite
       * and Earth) states a number proportional to metres per pixel, so the
       * ratio of two of them is the ratio of two scales. Without this, every
       * zoom threw the measurement away and the panel asked for another pan.
       */
      rescale(factor) {
        if (!Number.isFinite(factor) || factor <= 0) return false;
        if (!pxPerLon || !pxPerLat) return false;
        pxPerLon *= factor;
        pxPerLat *= factor;
        residual = null; // nothing has been predicted at this scale yet
        return true;
      },

      /** A zoom or a rotation makes every reading stale at once. */
      reset() {
        pxPerLon = null;
        pxPerLat = null;
        residual = null;
        samples = 0;
      },
    };
  }

  /**
   * The zoom a measured horizontal scale implies, exactly.
   *
   * Mercator puts longitude on the x axis linearly — `x = (lon+180)/360 · 256·2^z`
   * — so `pxPerLon` names the zoom and nothing else does. Both flattenings agree
   * about it, since only the northing differs between them.
   *
   * This is what lets a measurement correct a *scale* without replacing the
   * *shape*: the site table says which flattening is drawn, the map itself says
   * how big, and the two together beat either alone. A zoom read off the address
   * bar is rounded to a decimal — three and a half percent at the wrong moment,
   * which is a drawing that slides as it leaves the middle of the screen.
   */
  function zoomFromScale(pxPerLon) {
    if (!pxPerLon) return null;
    return Math.log2((Math.abs(pxPerLon) * 360) / TILE);
  }

  /**
   * The factor a zoom changed the scale by, read off the point it turned about.
   *
   * Every one of these maps zooms about something it keeps still — the cursor
   * for a wheel notch, the click for a double-click. Take a point whose
   * coordinate was known before the zoom and which is still under the same
   * pixel afterwards, and the new scale falls straight out of where the address
   * bar now says the centre is:
   *
   *     pxPerLon' = (anchorX - centreX) / (anchorLon - centreLon')
   *
   * No projection, no tile size, no zoom level, no device pixel ratio — the two
   * inputs are a pixel this window measured and a coordinate the site itself
   * wrote. That is what makes it right on any screen, any browser and any map,
   * and it is why a zoom no longer costs the analyst another pan to re-measure.
   *
   * Returns null when the geometry cannot answer: an anchor too near the centre
   * divides by almost nothing, which is a refusal rather than an approximation.
   * A rotated map is not one of those any more — the anchor's own offset is
   * turned back into the world's axes, the same undoing a pan gets.
   *
   * @param {{x: number, y: number, lat: number, lon: number}} anchor the point
   *   the zoom held still, with the coordinate it had before
   * @param {object} view where the address bar says the centre is now
   * @param {{x,y,w,h}} area the map rectangle
   * @param {{pxPerLon: number, pxPerLat: number}} scale what was measured before
   */
  function rescaleFromAnchor(anchor, view, area, scale) {
    if (!anchor || anchor.lat == null || !scale) return null;
    const { dx: dxPx, dy: dyPx } = screenToOffset(anchor, view, area);
    const dLon = wrapNear(anchor.lon, view.lon) - view.lon;
    const dLat = anchor.lat - view.lat;
    // the better-conditioned axis wins: near the centre the division is noise,
    // and a factor is a factor whichever way round it was read
    const candidates = [];
    if (Math.abs(dxPx) >= MIN_ANCHOR_PX && Math.abs(dLon) > 1e-12) {
      candidates.push([Math.abs(dxPx), dxPx / dLon / scale.pxPerLon]);
    }
    if (Math.abs(dyPx) >= MIN_ANCHOR_PX && Math.abs(dLat) > 1e-12) {
      candidates.push([Math.abs(dyPx), dyPx / dLat / scale.pxPerLat]);
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => b[0] - a[0]);
    const factor = candidates[0][1];
    return factor > 0 && Number.isFinite(factor) && factor < 64 && factor > 1 / 64 ? factor : null;
  }

  /** How far from the centre the held point has to be before the division above
   *  says more than the address bar's own rounding does. */
  const MIN_ANCHOR_PX = 80;

  // --- where the site draws its own centre ---------------------------------
  //
  // Everything above answers "how big". This answers "where": which pixel of
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

  /** Project through a measured scale rather than a named projection. */
  function toScreenMeasured(point, view, area, scale) {
    const dx = (wrapNear(point.lon, view.lon) - view.lon) * scale.pxPerLon;
    const dy = (point.lat - view.lat) * scale.pxPerLat;
    return offsetToScreen(dx, dy, view, area);
  }

  /** …and back. */
  function toLatLonMeasured(at, view, area, scale) {
    const { dx, dy } = screenToOffset(at, view, area);
    return { lat: view.lat + dy / scale.pxPerLat, lon: wrapLon(view.lon + dx / scale.pxPerLon) };
  }

  /**
   * Which of the flattenings we know matches what was measured — or null,
   * meaning this map is drawn in something we cannot name.
   *
   * Both axes are compared, because one is not enough. Equal Earth's latitude
   * scale crosses Mercator's somewhere in the low thirties, so at that latitude
   * the northing alone cannot tell them apart; their easting scales differ by
   * some seven percent everywhere, and settle it.
   *
   * The honest limit runs the other way. Spherical and elliptical Mercator
   * differ by well under one percent, which is inside the noise of a coordinate
   * the address bar has rounded — so a measurement cannot really choose between
   * *those* two. That is what `prefer` is for: the app's site table
   * (`engine/mapsites.py`) knows which one a site draws in, and keeps that
   * answer unless the measurement clearly disagrees with it. Each covers the
   * other's blind spot — the measurement catches a whole family changing under
   * us, the table settles a difference too fine to measure.
   *
   * @param {object|null} scale the measured `{ pxPerLon, pxPerLat }`
   * @param {object} view where the camera is, for the latitude the scale is at
   * @param {object} [opts]
   * @param {number} [opts.tolerance] accepted relative error, per axis
   * @param {string} [opts.prefer] what the site table said, kept when it is
   *   within a hair of the best measured match
   */
  function identify(scale, view, { tolerance = 0.02, prefer = null } = {}) {
    if (!scale) return null;
    const step = 0.001; // a thousandth of a degree, well inside any viewport
    const scored = [];
    for (const [name, pair] of Object.entries(PROJECTIONS)) {
      const north = pair.project(view.lat + step, view.lon, view.zoom).y
        - pair.project(view.lat - step, view.lon, view.zoom).y;
      const east = pair.project(view.lat, view.lon + step, view.zoom).x
        - pair.project(view.lat, view.lon - step, view.zoom).x;
      const expectLat = north / (2 * step);
      const expectLon = east / (2 * step);
      const offLat = Math.abs(expectLat - scale.pxPerLat) / Math.abs(expectLat);
      const offLon = Math.abs(expectLon - scale.pxPerLon) / Math.abs(expectLon);
      if (offLat <= tolerance && offLon <= tolerance) {
        scored.push({ name, off: Math.max(offLat, offLon) });
      }
    }
    if (!scored.length) return null;
    scored.sort((a, b) => a.off - b.off);
    const best = scored[0];
    // The table's answer stands unless the measurement is markedly better —
    // two candidates a fraction of a percent apart are one candidate.
    const preferred = scored.find((entry) => entry.name === prefer);
    if (preferred && preferred.off <= best.off * 2 + 0.002) return preferred.name;
    return best.name;
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
    toScreenMeasured,
    toLatLonMeasured,
    createCalibration,
    turn,
    unturn,
    identify,
    zoomFromScale,
    rescaleFromAnchor,
    MIN_ANCHOR_PX,
    MIN_PAN_PX,
    haversine,
    pathLength,
    polygonArea,
    formatDistance,
    formatArea,
  };
})();
