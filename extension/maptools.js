/**
 * The five tools, as state machines with no DOM and no network in them.
 *
 * Each one holds what has been clicked, answers `shapes()` with what should be
 * drawn in geographic coordinates, and `readout()` with the line the panel
 * shows. Turning shapes into pixels is `mapdraw.js`; fetching anything is
 * `mapoverlay.js`, which is also the only file that knows an extension API
 * exists. Split that way so the part with the rules in it can be tested against
 * numbers instead of against a browser.
 *
 * The fifth, `createRefs`, draws no shape and takes no click on the map: it
 * holds the floating panes a reference is compared from (`mapref.js` paints
 * them). It lives here because what it does hold — where a pane sits, how far
 * into the image it is zoomed — is arithmetic, and arithmetic belongs where
 * it can be checked against the app's own.
 *
 * **Much of this is a second copy, and deliberately only as much of one as it
 * needs.** The measures are `lib/measure.js`, the lattice is
 * `lib/gridSearch.js`, the sky arc is `lib/skyOverlay.js`, the mark grouping is
 * `lib/savedMarkers.js`. The extension ships as classic scripts with no build
 * step and cannot import a line of it, so each is written again here and
 * `frontend/src/lib/extensionMapTools.test.js` runs both over the same input and
 * fails on the first digit they disagree about. What is *not* copied is the
 * editing: polygon reshaping, resize handles, review mode and pruning stay the
 * app's. This writes a grid the app then opens with all of that available.
 *
 * Loaded after `mapmath.js` and `maptheme.js`, left on `window.AzimutMapTools`.
 */

(() => {
  const M = window.AzimutMapMath;
  const THEME = window.AzimutMapTheme;

  //. Matches lib/gridSearch.js — a display lattice, not a geodesic one.
  const M_PER_DEG_LAT = 111320;
  const MIN_COS = 0.01;
  /** The app's ceiling, restated: past this a lattice is a grey smear, not a
   *  thing anyone sweeps cell by cell. */
  const MAX_CELLS = 20000;

  /** Prediction error, in pixels, past which one pan counts as having landed
   *  somewhere the model did not expect. Generous, because these maps glide on
   *  after the finger leaves and a single overshoot says nothing; what makes
   *  the tools stop is a run of them (`mapoverlay.js`). */
  const RESIDUAL_LIMIT = 110;

  /** Why a view cannot carry the geometric tools, and what to do about it.
   *  Keyed by `engine/mapsites.py`'s `view_kind`; an unknown kind falls back to
   *  the general sentence. Each one names the way out in the words the viewer
   *  itself uses — a pitch in degrees is the app's reading of the camera, not a
   *  button anyone can find, so the sentence says 2D and 3D instead. */
  const REFUSALS = {
    streetview: "These tools work on the map, not in Street View",
    tilted: "These tools work in 2D only, so turn 3D off",
  };

  function refusal(parsed) {
    return REFUSALS[parsed.view_kind] || "This view is not a map to measure on";
  }

  /**
   * What to do about a view nothing has measured yet — said as the thing to do,
   * rather than as the state it is in.
   *
   * "Pan once" was true and useless. A drag is a measurement only if it moved
   * far enough on *both* axes — a scale is two numbers and a sideways drag gives
   * one of them — and only if the map ended where the pointer left it, which
   * means pausing before letting go, since these viewers glide on and report the
   * landing. Neither condition was anywhere on screen, so a drag that did not
   * count looked exactly like one that did, and the line asking for a pan came
   * back after every one of them.
   */
  const MEASURE_ME = "Drag the map across and down, pausing before you let go";

  /** …and the one thing that is said rather than refused. This far out the map
   *  is a globe: the middle of the screen is still right, the edges are not,
   *  and zooming in is what makes them right. Seeing a region's work at a
   *  glance is worth that, so the drawing stays and the panel dims it. */
  const FAR = "Zoomed out: marks drift from the middle of the screen";

  /**
   * Whether geometry is sound on this view, and if not, the sentence to show.
   *
   * `engine/mapsites.py` owns the URL formats and decides most of it. What is
   * added here is the one thing only a browser can do: measure.
   *
   * What the app adds is `scale_source`: which number in the URL says how far
   * out this view is, if any. All three are the site's own arithmetic — a tile
   * level, a viewport height in metres, a span in degrees — and all three were
   * checked against a browser before being believed (`docs/MAP_SITES.md`). Where
   * one of them speaks, the drawing works from the first frame.
   *
   * Where none does, the map itself is the only authority and one pan asks it.
   * That is now a single view: **Earth**, a free camera with no flattening to
   * name — level, it is a plain uniform scaling of the ground, and a
   * measurement describes it completely.
   *
   * The answer carries `far` as well as `ok`: a view far enough out that the
   * site has gone to a globe still draws, because a region's worth of marks is
   * worth seeing at a glance, but it says so and the panel dims it.
   *
   * @param {object|null} parsed the app's reading of the current URL
   * @param {number|null} residual pixels between prediction and address bar
   * @param {boolean} measured whether a scale has been read off the map yet
   */
  function verdict(parsed, residual, measured = false) {
    if (!parsed || !parsed.site) return { ok: false, why: "This page is not a map Azimut can read" };
    if (parsed.lat == null || parsed.lon == null) {
      return { ok: false, why: "No position in the address bar yet, so move the map once" };
    }
    if (parsed.view_kind && parsed.view_kind !== "map" && parsed.view_kind !== "globe") {
      return { ok: false, why: refusal(parsed) };
    }
    if (residual != null && residual > RESIDUAL_LIMIT) {
      return {
        ok: false,
        why: `The map landed ${Math.round(residual)} px from where it was predicted. Pan once to measure it again`,
      };
    }
    if (!parsed.view_kind) {
      return { ok: false, why: "This view is not one Azimut can compute on" };
    }
    const far = !!parsed.far;
    const drawn = { ok: true, why: far ? FAR : "", far };
    // The URL is enough wherever it states a scale. Everywhere else — Earth,
    // and any view whose address bar has not said how far out it is yet — the
    // map itself is the only authority, and one drag asks it.
    if (parsed.geometry && parsed.scale_source) return drawn;
    return measured ? drawn : { ok: false, why: MEASURE_ME };
  }

  // --- measure ---------------------------------------------------------------

  /**
   * Distance along a clicked path, or the area it encloses.
   *
   * One mode armed at a time and one list of points, because that is what the
   * readout is a reading of — the same rule the app's own measure tool follows,
   * for the same reason: two half-drawn measures with a readout naming one of
   * them is a picture that lies.
   */
  function createMeasure() {
    let mode = null; // null | 'distance' | 'area'
    let points = [];

    return {
      id: "measure",
      label: "Measure",
      icon: "ruler",
      needsGeometry: true,
      /** Whether this tool is waiting for a click on the map. While any tool
       *  is, the overlay takes pointer events away from the page underneath —
       *  so it has to be one question, asked the same way of all four. */
      get armed() {
        return mode !== null;
      },
      get mode() {
        return mode;
      },
      get points() {
        return points;
      },
      setMode(next) {
        mode = mode === next ? null : next;
        points = [];
        return mode;
      },
      /** Stop waiting for a click. Called when the view stops being one this
       *  tool can work on — the points are kept, since going back to a 2D map
       *  brings them back rather than making them wrong. */
      disarm() {
        mode = null;
      },
      clear() {
        points = [];
      },
      click(at) {
        if (!mode) return false;
        points = [...points, at];
        return true;
      },
      /** Undo one click — a slipped point should not cost the whole path. */
      undo() {
        points = points.slice(0, -1);
      },
      shapes() {
        if (!points.length) return [];
        const out = [];
        if (points.length >= 2) {
          out.push(
            mode === "area"
              ? { kind: "polygon", points, ...THEME.MEASURE_STROKE, ...THEME.MEASURE_FILL }
              : { kind: "line", points, ...THEME.MEASURE_STROKE, casing: true }
          );
        }
        for (const at of points) out.push({ kind: "dot", at, ...THEME.MEASURE_DOT });
        return out;
      },
      readout(units) {
        if (!mode) return null;
        if (points.length < 2) return "Click points on the map";
        if (mode === "distance") return M.formatDistance(M.pathLength(points), units);
        return points.length >= 3 ? M.formatArea(M.polygonArea(points), units) : "…";
      },
    };
  }

  // --- media pins ------------------------------------------------------------

  /** Decimal places to key marks on at a given zoom — `lib/savedMarkers.js`.
   *  Five is about a metre: at street zoom only items at genuinely the same spot
   *  merge, and zooming out coarsens the key so a country's worth of pins is a
   *  handful of counted marks instead of a smear. */
  function markerPrecision(zoom) {
    const z = Number(zoom);
    if (!Number.isFinite(z)) return 5;
    if (z < 5) return 0;
    if (z < 8) return 1;
    if (z < 11) return 2;
    if (z < 14) return 3;
    if (z < 16) return 4;
    return 5;
  }

  /** Group rows into marks by rounded coordinate. Rows with no position are
   *  left out; each mark keeps the order its items arrived in. */
  function groupSavedMarkers(rows, precision = 5) {
    const marks = new Map();
    for (const row of rows ?? []) {
      if (row.lat == null || row.lon == null) continue;
      const lat = Number(row.lat);
      const lon = Number(row.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const key = `${lat.toFixed(precision)},${lon.toFixed(precision)}`;
      const mark = marks.get(key);
      if (mark) {
        mark.items.push(row);
        mark.kinds.add(row.kind);
      } else {
        marks.set(key, { key, lat, lon, items: [row], kinds: new Set([row.kind]) });
      }
    }
    return [...marks.values()].map((mark) => ({
      key: mark.key,
      lat: mark.lat,
      lon: mark.lon,
      items: mark.items,
      kinds: [...mark.kinds],
    }));
  }

  /**
   * The case's geolocated work, over someone else's map — and a new point
   * dropped onto it.
   *
   * The one tool that runs on every view, because nothing in it is computed:
   * the analyst says where. What *does* change with the view is which
   * coordinate a new pin may claim. On a flat map it is the pixel that was
   * clicked. On a tilted or panoramic camera there is no sound way from a pixel
   * to the ground, so the pin takes the point the address bar already named —
   * where the camera stands — and the panel says so rather than quietly filing
   * something else.
   *
   * **Nothing is labelled until it is pointed at.** A case with fifty saved
   * points drew fifty names across the map, which is a screenshot of nothing.
   * Points at the same spot merge into one counted mark, exactly as the app's
   * Saved layer merges them, and the name belongs to the mark under the pointer
   * or the one held open by a click.
   */
  function createPins() {
    let rows = [];
    let zoom = null;
    let marks = [];
    let dropping = false;
    let draft = null; // { lat, lon, anchoredOn: 'pixel' | 'view' }
    let hovered = null; // mark key under the pointer
    let held = null; // mark key clicked open

    const regroup = () => {
      marks = groupSavedMarkers(rows, markerPrecision(zoom));
    };

    const nameOf = (mark) =>
      mark.items.length > 1 ? `${mark.items.length} saved here` : mark.items[0].title || "Untitled";

    return {
      id: "pins",
      label: "Points",
      icon: "pin",
      needsGeometry: false,
      get armed() {
        return dropping;
      },
      get rows() {
        return rows;
      },
      get marks() {
        return marks;
      },
      get dropping() {
        return dropping;
      },
      get draft() {
        return draft;
      },
      get hovered() {
        return hovered;
      },
      get held() {
        return held;
      },
      /** The case's saved index, filtered to what can actually be drawn. */
      load(index) {
        rows = (index ?? []).filter(
          (row) => Number.isFinite(row.lat) && Number.isFinite(row.lon)
        );
        regroup();
      },
      /** Marks merge by a precision that follows the zoom, so this is re-run
       *  whenever the view changes scale. */
      atZoom(next) {
        if (markerPrecision(next) === markerPrecision(zoom)) {
          zoom = next;
          return false;
        }
        zoom = next;
        regroup();
        return true;
      },
      toggleDrop() {
        dropping = !dropping;
        if (!dropping) draft = null;
        return dropping;
      },
      disarm() {
        dropping = false;
        draft = null;
      },
      /**
       * A click, while dropping is armed. `at` is the clicked pixel turned into
       * a coordinate, or null when the view cannot do that honestly; `view` is
       * the point the URL named, which is the fallback and never a guess.
       */
      click(at, view) {
        if (!dropping) return false;
        draft = at
          ? { lat: at.lat, lon: at.lon, anchoredOn: "pixel" }
          : { lat: view.lat, lon: view.lon, anchoredOn: "view" };
        held = "draft";
        return true;
      },
      clearDraft() {
        draft = null;
        dropping = false;
        if (held === "draft") held = null;
      },
      /** The mark nearest `at` within `radius` screen pixels, or null.
       *  `project` is passed in because only the overlay knows the view. */
      markAt(at, project, radius = 16) {
        let best = null;
        let closest = radius * radius;
        const all = draft ? [...marks, { key: "draft", lat: draft.lat, lon: draft.lon }] : marks;
        for (const mark of all) {
          const p = project(mark);
          if (!p || !Number.isFinite(p.x)) continue;
          const gap = (p.x - at.x) ** 2 + (p.y - at.y) ** 2;
          if (gap <= closest) {
            closest = gap;
            best = mark;
          }
        }
        return best;
      },
      hover(key) {
        if (hovered === key) return false;
        hovered = key;
        return true;
      },
      /** Clicking a mark opens its name; clicking it again, or elsewhere,
       *  closes it. */
      hold(key) {
        held = held === key ? null : key;
        return held;
      },
      shapes() {
        const out = marks.map((mark) => {
          const only = mark.kinds.length === 1 ? mark.kinds[0] : "place";
          const shown = mark.key === hovered || mark.key === held;
          return {
            kind: "mark",
            at: { lat: mark.lat, lon: mark.lon },
            glyph: THEME.SAVED_GLYPH[only] ?? "pin",
            // a bare place carries no imagery: the app outlines it rather than
            // filling it, so a stack of captures never hides behind one
            place: only === "place",
            count: mark.items.length,
            lit: shown,
            label: shown ? nameOf(mark) : "",
          };
        });
        if (draft) {
          out.push({
            kind: "mark",
            at: { lat: draft.lat, lon: draft.lon },
            glyph: "pin",
            place: true,
            count: 1,
            lit: true,
            label: held === "draft" || hovered === "draft" ? "New point" : "",
          });
        }
        return out;
      },
      readout() {
        if (draft) {
          return draft.anchoredOn === "view"
            ? "Filing the point this view is centred on"
            : "Filing the point you clicked";
        }
        if (dropping) return "Click the map to place a point";
        if (!rows.length) return "Nothing placed in this case yet";
        const merged = rows.length - marks.length;
        return merged > 0 ? `${rows.length} here, in ${marks.length} marks` : `${rows.length} on this map`;
      },
    };
  }

  // --- sun and moon ----------------------------------------------------------

  /**
   * Runs of consecutive samples with the body above the horizon —
   * `lib/skyOverlay.js`.
   *
   * The arc the body actually sweeps, not the whole 24 hours: drawn end to end,
   * the line would close the circle through the bearings the body holds while
   * it is down, which says nothing about where the light came from.
   */
  function upRuns(altitudes) {
    const runs = [];
    let run = null;
    (altitudes ?? []).forEach((altitude, i) => {
      if (altitude >= 0) {
        run = run ?? [];
        run.push(i);
      } else if (run) {
        runs.push(run);
        run = null;
      }
    });
    if (run) runs.push(run);
    return runs.filter((r) => r.length > 1);
  }

  /** Which samples carry an hour tick, and which are the long ones. On the
   *  hour, and only while the body is up. */
  function hourTicks(minutes, altitudes) {
    const ticks = [];
    (minutes ?? []).forEach((minute, i) => {
      if (minute % 60 || altitudes[i] < 0) return;
      ticks.push({ index: i, long: minute % 180 === 0 });
    });
    return ticks;
  }

  /** Where the body's mark rides on its ray, as a fraction of the radius: at
   *  the horizon on the arc, at the zenith on the anchor. */
  function markScale(altitude) {
    return (90 - altitude) / 90;
  }

  const isBelow = (altitude) => altitude < 0;

  /**
   * Which sample of the day is the moment the answer was computed for.
   *
   * The payload carries the whole day as arrays and the current instant as a
   * wall-clock reading, but not the index joining them — so it is found here,
   * by the clock, in the point's own zone. Falls back to the middle of the day
   * rather than to zero: an unreadable moment should open on noon, not on the
   * dark before dawn.
   */
  function nowIndex(payload) {
    const clock = payload?.curve?.clock;
    if (!Array.isArray(clock) || !clock.length) return 0;
    const at = /T(\d{2}):(\d{2})/.exec(payload?.moment?.local ?? "");
    if (!at) return Math.floor(clock.length / 2);
    const minutes = Number(at[1]) * 60 + Number(at[2]);
    let best = 0;
    let closest = Infinity;
    for (let i = 0; i < clock.length; i += 1) {
      const [h, m] = clock[i].split(":").map(Number);
      const gap = Math.abs(h * 60 + m - minutes);
      if (gap < closest) {
        closest = gap;
        best = i;
      }
    }
    return best;
  }

  /**
   * The day's sun and moon, drawn from a planted anchor.
   *
   * Anchored rather than following the view, because the question is "where do
   * the shadows fall *here*" and a path that slid with every pan would answer
   * it about somewhere else. The arithmetic is the app's (`/api/geo/sky`
   * returns the whole day in one response), so scrubbing the hour costs nothing
   * and asks nobody.
   *
   * The picture is the app's too: the arc each body sweeps while it is up, an
   * hour tick on the hour, the current ray from the anchor, and the body itself
   * riding that ray between the centre — which stands for the zenith — and the
   * arc, which stands for the horizon.
   */
  function createSky() {
    let anchor = null;
    let placing = false;
    let day = null; // the whole-day payload, exactly as /api/geo/sky returns it
    let on = null; // the local day being read, or null for the one it is there
    let index = 0;
    let reach = 400; // metres the arc is drawn at; set from the view

    const at = (azimuth, scale = 1) => destination(anchor, azimuth, reach * scale);

    return {
      id: "sky",
      label: "Sun & moon",
      icon: "sun",
      needsGeometry: true,
      /**
       * Zoomed out, this one is not drawn in doubt.
       *
       * What dims a drawing out there is that a Mercator and a globe part
       * company away from the middle of the screen, so a mark lands somewhere
       * the ground is not. This tool has no marks: it answers where the light
       * came from, and a bearing is read off the anchor, which is the one place
       * the two projections still agree. The radius the arc is drawn at is the
       * part that drifts, and nobody reads a distance off a sun path.
       *
       * So it stays at full strength, and the status line goes on saying the
       * view is zoomed out. Dimming it only had the analyst zooming in until the
       * picture looked solid, for an answer that was already right.
       */
      dimsWhenFar: false,
      get armed() {
        return placing;
      },
      get anchor() {
        return anchor;
      },
      get placing() {
        return placing;
      },
      get day() {
        return day;
      },
      /** Which local day is on screen, as the date field writes it. Read back
       *  from the answer rather than kept from the request, so the field shows
       *  the day *at the point* — which is not always the analyst's own. */
      get date() {
        return on ?? day?.date ?? null;
      },
      /** Read another day for the planted point. */
      onDay(value) {
        on = value;
        day = null;
      },
      get index() {
        return index;
      },
      set index(value) {
        index = Math.max(0, Math.min((day?.curve?.clock?.length ?? 1) - 1, value));
      },
      /** How far the arc reaches, off the shorter side of the view: a radius
       *  set by the diagonal runs off the top and bottom of a wide window. */
      fit(spanMetres) {
        reach = Math.max(50, spanMetres * 0.22);
      },
      togglePlacing() {
        placing = !placing;
        return placing;
      },
      disarm() {
        placing = false;
      },
      click(point) {
        if (!placing) return false;
        anchor = point;
        day = null;
        placing = false;
        return true;
      },
      /** The answer for the planted point. The slider lands on the moment the
       *  payload was computed for, so the first thing drawn is now. */
      accept(payload) {
        day = payload;
        index = nowIndex(payload);
      },
      clear() {
        anchor = null;
        day = null;
        on = null;
        placing = false;
      },
      shapes() {
        if (!anchor) return [];
        const out = [];
        const curve = day?.curve;
        if (curve) {
          for (const body of [
            { key: "sun", colour: THEME.TOKENS.skySun },
            { key: "moon", colour: THEME.TOKENS.skyMoon },
          ]) {
            const altitude = curve[`${body.key}_altitude`] ?? [];
            const azimuth = curve[`${body.key}_azimuth`] ?? [];
            // Thin and translucent: the imagery underneath is what is read.
            const thin = { stroke: body.colour, strokeWidth: 2.5, strokeOpacity: 0.9 };
            for (const run of upRuns(altitude)) {
              out.push({ kind: "line", points: run.map((i) => at(azimuth[i])), ...thin });
            }
            for (const tick of hourTicks(curve.minutes, altitude)) {
              out.push({
                kind: "line",
                points: [at(azimuth[tick.index], 0.94), at(azimuth[tick.index], tick.long ? 1.1 : 1.03)],
                ...thin,
              });
            }
            const now = altitude[index];
            if (!Number.isFinite(now)) continue;
            const below = isBelow(now);
            out.push({
              kind: "line",
              points: [anchor, at(azimuth[index])],
              stroke: body.colour,
              strokeWidth: 3.5,
              strokeOpacity: below ? 0.6 : 1,
              dash: below ? [6, 6] : null,
            });
            // Nothing rides the ray while the body is under the horizon: the
            // dashed ray already says where it is, and a mark on it would claim
            // it is visible.
            if (!below) {
              out.push({
                kind: "body",
                at: at(azimuth[index], markScale(now)),
                colour: body.colour,
                bodyKind: body.key,
                illuminated: curve.moon_illuminated?.[index] ?? 0,
                waxing: !!day?.moon?.waxing,
              });
            }
          }
        }
        out.push({ kind: "dot", at: anchor, radius: 4, stroke: "#fff", strokeWidth: 2, fill: THEME.TOKENS.accent, fillOpacity: 1 });
        return out;
      },
      readout() {
        if (placing) return "Click the map to plant the point";
        if (!anchor) return "Plant a point to read its sky";
        if (!day) return "Reading…";
        const clock = day.curve?.clock?.[index] ?? "";
        // the day is named beside the hour: the slider scrubs one day, and a
        // reading with no date on it is a reading of no day in particular
        return day.date ? `${day.date} ${clock}` : clock;
      },
    };
  }

  /** The point reached from `from` on a bearing after `metres` — mirrors
   *  `lib/measure.js`'s `destination`, and the cross-check test says so. */
  function destination(from, bearing, metres) {
    const R = 6378137;
    const rad = (d) => (d * Math.PI) / 180;
    const d = metres / R;
    const br = rad(bearing);
    const lat1 = rad(from.lat);
    const lon1 = rad(from.lon);
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br)
    );
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(br) * Math.sin(d) * Math.cos(lat1),
        Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
      );
    return { lat: (lat2 * 180) / Math.PI, lon: (((lon2 * 180) / Math.PI + 540) % 360) - 180 };
  }

  // --- grid search -----------------------------------------------------------

  /** Cell size in degrees at a reference latitude. Mirrors lib/gridSearch.js. */
  function degSteps(refLat, cellM) {
    const latStep = cellM / M_PER_DEG_LAT;
    const cos = Math.max(MIN_COS, Math.cos((refLat * Math.PI) / 180));
    return { latStep, lonStep: cellM / (M_PER_DEG_LAT * cos) };
  }

  const cellKey = (i, j) => `${i}:${j}`;

  function normalizeBounds(b) {
    return {
      south: Math.min(b.south, b.north),
      north: Math.max(b.south, b.north),
      west: Math.min(b.west, b.east),
      east: Math.max(b.west, b.east),
    };
  }

  /** Bounding box of an area of interest (rect bounds or polygon vertices). */
  function aoiBounds(aoi) {
    if (aoi.type === "rect") return aoi.bounds;
    const lats = aoi.vertices.map((v) => v[0]);
    const lons = aoi.vertices.map((v) => v[1]);
    return {
      south: Math.min(...lats),
      west: Math.min(...lons),
      north: Math.max(...lats),
      east: Math.max(...lons),
    };
  }

  /** Ray-casting point-in-polygon on [lat, lon] vertices. */
  function pointInPolygon(pt, vertices) {
    let inside = false;
    const x = pt.lon;
    const y = pt.lat;
    for (let a = 0, b = vertices.length - 1; a < vertices.length; b = a++) {
      const xi = vertices[a][1];
      const yi = vertices[a][0];
      const xj = vertices[b][1];
      const yj = vertices[b][0];
      const hit = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (hit) inside = !inside;
    }
    return inside;
  }

  const orient = (p, q, r) =>
    (q.lon - p.lon) * (r.lat - p.lat) - (q.lat - p.lat) * (r.lon - p.lon);

  function segsCross(a, b, c, d) {
    const o1 = orient(a, b, c);
    const o2 = orient(a, b, d);
    const o3 = orient(c, d, a);
    const o4 = orient(c, d, b);
    return o1 > 0 !== o2 > 0 && o3 > 0 !== o4 > 0;
  }

  /** Does a cell rectangle touch the polygon at all? Any overlap counts, so the
   *  whole drawn shape gets tiled — no bare strip along a slanted edge. */
  function rectIntersectsPolygon(b, vertices) {
    const box = [
      { lat: b.south, lon: b.west },
      { lat: b.south, lon: b.east },
      { lat: b.north, lon: b.east },
      { lat: b.north, lon: b.west },
    ];
    for (const c of box) if (pointInPolygon(c, vertices)) return true;
    for (const v of vertices) {
      if (v[0] >= b.south && v[0] <= b.north && v[1] >= b.west && v[1] <= b.east) return true;
    }
    for (let i = 0; i < vertices.length; i += 1) {
      const pa = { lat: vertices[i][0], lon: vertices[i][1] };
      const next = vertices[(i + 1) % vertices.length];
      const pb = { lat: next[0], lon: next[1] };
      for (let e = 0; e < 4; e += 1) {
        if (segsCross(pa, pb, box[e], box[(e + 1) % 4])) return true;
      }
    }
    return false;
  }

  /** Close a polygon ring for drawing: the first point repeated at the end,
   *  but only once there are three — a shape still being drawn stays open. */
  function closeRing(points) {
    return points.length >= 3 ? [...points, points[0]] : points;
  }

  /**
   * A fresh grid over an area, in the app's own `azimut_grid: 1` spec.
   *
   * The lattice is pinned to the area's south-west corner rather than to the
   * area itself, which is what lets the app resize the shape later without a
   * mark sliding off the cell it was put on.
   */
  function createGrid(aoi, cellM) {
    const b = aoiBounds(aoi);
    const refLat = (b.south + b.north) / 2;
    const { latStep, lonStep } = degSteps(refLat, cellM);
    return {
      azimut_grid: 1,
      cell_m: cellM,
      anchor: { lat: b.south, lon: b.west },
      lat_step: latStep,
      lon_step: lonStep,
      aoi,
      statuses: {},
    };
  }

  function cellRange(grid) {
    const b = aoiBounds(grid.aoi);
    return {
      iMin: Math.floor((b.south - grid.anchor.lat) / grid.lat_step),
      iMax: Math.ceil((b.north - grid.anchor.lat) / grid.lat_step) - 1,
      jMin: Math.floor((b.west - grid.anchor.lon) / grid.lon_step),
      jMax: Math.ceil((b.east - grid.anchor.lon) / grid.lon_step) - 1,
    };
  }

  function cellBounds(grid, i, j) {
    const south = grid.anchor.lat + i * grid.lat_step;
    const west = grid.anchor.lon + j * grid.lon_step;
    return { south, west, north: south + grid.lat_step, east: west + grid.lon_step };
  }

  /** Every cell inside the area, row-major. A rectangle keeps its whole
   *  bounding box; a polygon keeps every cell that overlaps it. */
  function cellsInAoi(grid) {
    const { iMin, iMax, jMin, jMax } = cellRange(grid);
    const poly = grid.aoi.type === "polygon" ? grid.aoi.vertices : null;
    const out = [];
    for (let i = iMin; i <= iMax; i += 1) {
      for (let j = jMin; j <= jMax; j += 1) {
        if (poly && !rectIntersectsPolygon(cellBounds(grid, i, j), poly)) continue;
        out.push([i, j]);
      }
    }
    return out;
  }

  function estimateCells(grid) {
    const { iMin, iMax, jMin, jMax } = cellRange(grid);
    return Math.max(0, iMax - iMin + 1) * Math.max(0, jMax - jMin + 1);
  }

  function coverage(grid) {
    const cells = cellsInAoi(grid);
    let cleared = 0;
    let flagged = 0;
    for (const [i, j] of cells) {
      const status = grid.statuses[cellKey(i, j)];
      if (status === "cleared") cleared += 1;
      else if (status === "flagged") flagged += 1;
    }
    const done = cleared + flagged;
    return {
      total: cells.length,
      cleared,
      flagged,
      unchecked: cells.length - done,
      percent: cells.length ? Math.round((done / cells.length) * 100) : 0,
    };
  }

  /** Left-click cycle: unchecked → cleared → flagged → unchecked. */
  function cycleStatus(current) {
    if (!current) return "cleared";
    if (current === "cleared") return "flagged";
    return null;
  }

  /**
   * Sweeping an area cell by cell, over a map the app does not own.
   *
   * Draws both shapes the app draws — a dragged rectangle and a clicked
   * polygon — because an area of interest is rarely a rectangle and tiling the
   * bounding box of a quay or a valley means sweeping water and hillside. What
   * it does not carry is the *editing*: reshaping a saved area, dragging its
   * corners, running the review cursor. Those stay one implementation, in the
   * app, and this writes the file the app opens.
   */
  function createGridTool() {
    let grid = null;
    let name = null;
    let drawing = null; // null | 'rect' | 'polygon'
    let vertices = []; // the polygon being clicked out, [lat, lon] pairs
    let marking = false;
    let hidden = false;
    //. Cells marked since the last time the case was told: "i:j" -> status, or
    //. null for one that was cleared back to unchecked. Kept as a patch rather
    //. than as a copy of the grid on purpose — see `pushMarks` in
    //. mapoverlay.js for what a whole-spec save would quietly undo.
    let unsent = {};

    function adopt(aoi, cellM) {
      const candidate = createGrid(aoi, cellM);
      const cells = estimateCells(candidate);
      if (cells > MAX_CELLS) {
        return {
          error: `${cells.toLocaleString("en-US")} cells is past the ${MAX_CELLS.toLocaleString("en-US")} limit. Use a bigger cell or a smaller area`,
        };
      }
      grid = candidate;
      name = null;
      unsent = {};
      return { grid };
    }

    return {
      id: "grid",
      label: "Search grid",
      icon: "grid",
      needsGeometry: true,
      cellM: 500,
      get armed() {
        return drawing !== null || marking;
      },
      get grid() {
        return grid;
      },
      get name() {
        return name;
      },
      get drawing() {
        return drawing;
      },
      get vertices() {
        return vertices;
      },
      get marking() {
        return marking;
      },
      get hidden() {
        return hidden;
      },
      /** Whether there are marks the case has not been told about yet. */
      get dirty() {
        return Object.keys(unsent).length > 0;
      },
      get coverage() {
        return grid ? coverage(grid) : null;
      },

      /** Arm one of the two shapes, or put it down. */
      draw(shape) {
        drawing = drawing === shape ? null : shape;
        vertices = [];
        if (drawing) marking = false;
        return drawing;
      },
      /** Marking is a mode rather than a plain click, because the map
       *  underneath still has to be pannable while a sweep is open. */
      toggleMark() {
        marking = !marking;
        if (marking) drawing = null;
        return marking;
      },
      toggleHidden() {
        hidden = !hidden;
        return hidden;
      },
      disarm() {
        drawing = null;
        marking = false;
        vertices = [];
      },

      /** One corner of the polygon being clicked out. */
      addVertex(point) {
        if (drawing !== "polygon") return false;
        vertices = [...vertices, [point.lat, point.lon]];
        return true;
      },
      undoVertex() {
        vertices = vertices.slice(0, -1);
      },

      /**
       * Close a dragged box into a lattice.
       *
       * The one refusal is an area that would draw more cells than anybody
       * sweeps, and it comes with the count — freezing the tab and leaving the
       * analyst to guess why is the alternative. There is no floor to check:
       * the lattice covers a box by rounding its edges outward, so even a box
       * smaller than one cell is one cell.
       */
      finishBox(bounds) {
        drawing = null;
        if (!bounds) return null;
        return adopt({ type: "rect", bounds: normalizeBounds(bounds) }, this.cellM);
      },

      /** Close the clicked polygon. Three corners is the fewest that enclose
       *  anything; fewer is a line, and a line has no area to sweep. */
      finishPolygon() {
        const drawn = vertices;
        drawing = null;
        vertices = [];
        if (drawn.length < 3) return { error: "A shape needs at least three corners" };
        return adopt({ type: "polygon", vertices: drawn }, this.cellM);
      },

      /** Adopt a grid read back from the case. */
      open(spec, savedName) {
        grid = spec;
        name = savedName;
        unsent = {};
      },

      /**
       * Take the case's copy of the open grid as the truth again.
       *
       * The same sweep is worked from the app at the same time, and a panel
       * that only ever sent its own marks showed a sweep frozen at the moment
       * it was opened. The file wins, with one exception: marks made here that
       * have not been sent yet go back on top, because they are the only copy
       * of themselves.
       */
      sync(spec) {
        if (!grid || !spec) return false;
        const statuses = { ...(spec.statuses || {}) };
        for (const [key, status] of Object.entries(unsent)) {
          if (status) statuses[key] = status;
          else delete statuses[key];
        }
        grid = { ...spec, statuses };
        return true;
      },

      close() {
        grid = null;
        name = null;
        unsent = {};
        drawing = null;
        marking = false;
        vertices = [];
      },

      saved(savedName) {
        name = savedName;
        // the spec that was just written carried every mark in it
        unsent = {};
      },

      /** The marks made since the last call, handed over. Emptied here: the
       *  caller now owns them, and puts them back with `restoreMarks` if the
       *  case never heard about them. */
      takeMarks() {
        const marks = unsent;
        unsent = {};
        return marks;
      },

      /** Marks back from a failed send, without stepping on any made since. */
      restoreMarks(marks) {
        unsent = { ...marks, ...unsent };
      },

      /** Which cell a coordinate falls in, or null when it is outside. */
      cellAt(point) {
        if (!grid) return null;
        const i = Math.floor((point.lat - grid.anchor.lat) / grid.lat_step);
        const j = Math.floor((point.lon - grid.anchor.lon) / grid.lon_step);
        const { iMin, iMax, jMin, jMax } = cellRange(grid);
        if (i < iMin || i > iMax || j < jMin || j > jMax) return null;
        if (grid.aoi.type === "polygon" && !rectIntersectsPolygon(cellBounds(grid, i, j), grid.aoi.vertices)) {
          return null;
        }
        return [i, j];
      },

      click(point) {
        const cell = this.cellAt(point);
        if (!cell) return false;
        const key = cellKey(cell[0], cell[1]);
        const next = cycleStatus(grid.statuses[key]);
        if (next) grid.statuses[key] = next;
        else delete grid.statuses[key];
        unsent[key] = next;
        return true;
      },

      shapes() {
        const out = [];
        if (drawing === "polygon" && vertices.length) {
          const points = vertices.map(([lat, lon]) => ({ lat, lon }));
          out.push({ kind: "line", points: closeRing(points), ...THEME.DRAFT_STYLE });
          for (const at of points) {
            out.push({ kind: "dot", at, radius: 3.5, fill: THEME.AOI_STYLE.stroke, fillOpacity: 1, stroke: "#fff", strokeWidth: 1.5 });
          }
        }
        if (!grid || hidden) return out;
        for (const [i, j] of cellsInAoi(grid)) {
          const status = grid.statuses[cellKey(i, j)] || "unchecked";
          out.push({ kind: "cell", bounds: cellBounds(grid, i, j), ...THEME.CELL_STYLE[status] });
        }
        // No outline around a finished grid. The lattice *is* the area once it
        // exists, and a dashed ring around it is a second line saying the same
        // thing over imagery that has to stay readable. The draft ring above is
        // different: while the shape is being drawn it is the only thing there
        // is to see.
        return out;
      },

      readout() {
        if (drawing === "rect") return "Drag a box over the area to sweep";
        if (drawing === "polygon") {
          return vertices.length < 3
            ? `Click the corners of the area (${vertices.length})`
            : `${vertices.length} corners — close the shape when it fits`;
        }
        if (!grid) return "No grid open";
        const seen = coverage(grid);
        if (marking) return `${seen.percent}% swept — click cells to mark them`;
        return `${seen.percent}% swept · ${seen.cleared} cleared · ${seen.flagged} flagged`;
      },
    };
  }

  // --- reference windows -----------------------------------------------------

  /**
   * The case's own images and videos, held over someone else's map.
   *
   * The tool that is not a map tool. It projects nothing, takes no click on the
   * map and draws no shape: a reference window is a small floating pane holding
   * the shot being geolocated, so it can be eyeballed against the imagery
   * while the map pans under it. Three things follow from that, and they are the
   * reason it is written here rather than folded into the panel:
   *
   * - **It works where geometry does not.** Street View, a pitched camera, a
   *   zoomed-out globe: none of them can carry a measurement, and all of them
   *   are worth holding a reference against. So `needsGeometry` is false and
   *   nothing here consults the verdict.
   * - **The windows stay when another tool is picked up.** "Only the open tool
   *   draws" is a rule about the map, and these are not on the map — putting
   *   the reference down while measuring is exactly what nobody wants.
   * - **They are scratch, and the extension keeps them so.** Nothing is filed,
   *   nothing is remembered between visits, and the panel and its windows are
   *   taken out of the frame before a capture (`background.js`) — a reference
   *   floating over a map must never end up inside the evidence.
   *
   * A video counts as a reference: the frame to place is often in one, and the
   * window plays it. That is the one thing here a map site can refuse — see
   * `mapref.js` — so the window says so rather than showing an empty box.
   *
   * The geometry below is `lib/refViewers.js`, copied for the same reason
   * everything else here is; `extensionMapTools.test.js` runs the two over the
   * same input. Window placement, the corner drag and the cursor-anchored image
   * zoom are all in it.
   */
  const MIN_SCALE = 1; // 1 = the image fits the window; no zooming out past fit
  const MAX_SCALE = 8;
  const DEFAULT_W = 320;
  const DEFAULT_H = 260;
  const MIN_W = 200;
  const MIN_H = 150;
  /** New windows step down-right so the one underneath stays grabbable, and wrap
   *  before they walk off the screen. */
  const STAGGER = 26;
  const STAGGER_WRAP = 6;

  const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

  /** A fresh window on one picked file ({ path, kind, title, filename }). */
  function createViewer(id, media, spawn = {}) {
    return {
      id,
      path: media.path,
      kind: media.kind === "video" ? "video" : "image",
      title: media.title || media.filename || "",
      x: spawn.x ?? 60,
      y: spawn.y ?? 60,
      w: spawn.w ?? DEFAULT_W,
      h: spawn.h ?? DEFAULT_H,
      z: spawn.z ?? 1,
      collapsed: false,
      scale: 1, // image zoom (1 = fit)
      ox: 0, // image pan offset in content px
      oy: 0,
    };
  }

  /** One more than the top window's z — what a newly focused one gets. */
  function nextZ(viewers) {
    return viewers.reduce((top, viewer) => Math.max(top, viewer.z), 0) + 1;
  }

  /**
   * Re-number z so `id` sits on top, keeping the values small and gap-free
   * (1..n) rather than letting the newest window climb without bound — which is
   * what eventually puts one over the panel. Returns id → new z.
   */
  function restack(viewers, id) {
    const others = viewers.filter((viewer) => viewer.id !== id).sort((a, b) => a.z - b.z);
    const z = new Map();
    others.forEach((viewer, i) => z.set(viewer.id, i + 1));
    z.set(id, others.length + 1);
    return z;
  }

  /** Keep a window of `w`×`h` fully inside `bounds` ({ w, h }). */
  function clampWindow(x, y, w, h, bounds) {
    return {
      x: clamp(x, 0, Math.max(0, bounds.w - w)),
      y: clamp(y, 0, Math.max(0, bounds.h - h)),
    };
  }

  /** Clamp a corner drag to the min size and to what fits below and right of it. */
  function clampSize(w, h, x, y, bounds) {
    return {
      w: clamp(w, MIN_W, Math.max(MIN_W, bounds.w - x)),
      h: clamp(h, MIN_H, Math.max(MIN_H, bounds.h - y)),
    };
  }

  /**
   * Keep the zoomed image covering its `w`×`h` pane, so no gap opens at an
   * edge. At fit scale this pins the offset to 0; deeper in it allows panning by
   * as much as the image overflows.
   */
  function clampPan(ox, oy, scale, w, h) {
    return {
      ox: clamp(ox, Math.min(0, w - scale * w), 0),
      oy: clamp(oy, Math.min(0, h - scale * h), 0),
    };
  }

  /**
   * Zoom `view` by `factor` about `cursor` (pane pixels from its top-left),
   * keeping the point under the cursor still. Returns the new { scale, ox, oy }.
   */
  function zoomAt(view, factor, cursor, size) {
    const scale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
    const ratio = scale / view.scale; // what the clamp actually allowed
    const ox = cursor.x - ratio * (cursor.x - view.ox);
    const oy = cursor.y - ratio * (cursor.y - view.oy);
    return { scale, ...clampPan(ox, oy, scale, size.w, size.h) };
  }

  function createRefs() {
    let open = [];
    let spawned = 0; // id source, so two windows on one file stay distinct

    return {
      id: "refs",
      label: "Refs",
      icon: "image",
      needsGeometry: false,
      get armed() {
        return false; // it never waits for a click on the map
      },
      /** The windows, in the order they were spawned. */
      get open() {
        return open;
      },

      /** Spawn a window on one picked file, on top of the others. */
      add(item) {
        const step = (open.length % STAGGER_WRAP) * STAGGER;
        const viewer = createViewer(`ref-${++spawned}`, item, {
          x: 60 + step,
          y: 60 + step,
          z: nextZ(open),
        });
        open.push(viewer);
        return viewer;
      },

      /** Bring one to the front, re-numbering the rest. */
      focus(id) {
        const z = restack(open, id);
        for (const viewer of open) viewer.z = z.get(viewer.id);
      },

      close(id) {
        open = open.filter((viewer) => viewer.id !== id);
      },

      /** Every window down — what changing case does, since the files were the
       *  other case's. */
      clear() {
        open = [];
      },

      disarm() {},

      shapes() {
        return []; // nothing of this is on the map
      },

      /** Fold one away to its header, or unfold it. */
      fold(id) {
        const viewer = open.find((window) => window.id === id);
        if (viewer) viewer.collapsed = !viewer.collapsed;
        return viewer;
      },

      readout() {
        if (!open.length) return "Nothing held over the map";
        return open.length === 1 ? "1 reference open" : `${open.length} references open`;
      },
    };
  }

  window.AzimutMapTools = {
    MAX_CELLS,
    RESIDUAL_LIMIT,
    MEASURE_ME,
    verdict,
    createMeasure,
    createPins,
    createSky,
    createGridTool,
    createRefs,
    // the shared arithmetic, exported so the cross-checks can reach it
    markerPrecision,
    groupSavedMarkers,
    upRuns,
    hourTicks,
    markScale,
    nowIndex,
    degSteps,
    createGrid,
    cellKey,
    cellRange,
    cellBounds,
    cellsInAoi,
    estimateCells,
    coverage,
    cycleStatus,
    aoiBounds,
    pointInPolygon,
    rectIntersectsPolygon,
    closeRing,
    destination,
    createViewer,
    nextZ,
    restack,
    clampWindow,
    clampSize,
    clampPan,
    zoomAt,
  };
})();
