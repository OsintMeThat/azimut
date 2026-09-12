/**
 * Sun & moon: one anchored point, one date, and an hour you drag.
 *
 * What it draws is the arc each body sweeps while it is up, hour ticks along
 * it, and the bearing at the chosen moment. Everything on the map is an
 * azimuth, which is the only celestial quantity a plan view can state honestly;
 * altitude stays in the panel, and rides the ray as how far up the body is.
 *
 * The anchor is a point you plant, never the moving view: the whole reading is
 * "from *here*, at this hour", and a shadow line that slid with a pan would be
 * a different question answered every frame.
 *
 * Two ways in, one rendering: the tool's own button, and a point handed over by
 * Coords & Sky. The hand-off carries a clock, so the slider lands on the minute
 * that was asked about rather than on the current one — and only once, because
 * the next day loaded is the analyst's own choice.
 *
 * The geometry and the glyphs are `lib/skyOverlay.js`; this holds the point,
 * the day, the hour, and the layer they are drawn on.
 *
 * @param {object} deps
 * @param {() => object|null} deps.engine the map, once it is up
 * @param {object} deps.api the app's fetch wrapper
 * @param {(message: string, kind?: string, ms?: number) => void} deps.notify
 * @param {(name: string, fallback: string) => string} [deps.colour] theme lookup
 * @param {(engine: object) => object} [deps.surface] the drawing layer factory
 */
import { createSurface } from '../../../lib/map/surface.js';
import { destination } from '../../../lib/measure.js';
import {
  bodyReading,
  bodySvg,
  hourTicks,
  isBelow,
  markScale,
  nearestSample,
  upRuns,
} from '../../../lib/skyOverlay.js';

const BODY_SIZE = 20;

/** The arc is a circle around the anchor, so its radius comes off the *shorter*
 *  side of the view: sized by the diagonal it runs off a wide window. */
const REACH = 0.22;

function themeColour(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function createSkyState({ engine, api, notify, colour = themeColour, surface = createSurface }) {
  let on = $state(false);
  let anchor = $state.raw(null); // { lat, lon } — fixed, never the moving view
  let day = $state(''); // empty: the backend's today at that point
  let index = $state(0); // sample of the day the slider is on
  let sky = $state(null);
  let loading = $state(false);
  let placing = $state(false);
  let layer = null;
  let ticket = 0;
  // A wall clock to land the slider on once the day's samples are in, from a
  // hand-off. Spent on the first load, so a later date is read at its own hour.
  let handedClock = null;

  function draw() {
    const map = engine();
    if (!map) return;
    layer ??= surface(map);
    if (!on || !sky || !anchor) {
      layer.clear();
      return;
    }
    const origin = anchor;
    const { across, down } = map.viewSpanMeters();
    const reach = Math.min(across, down) * REACH;
    const at = (azimuth, scale = 1) => destination(origin, azimuth, reach * scale);
    const curve = sky.curve;
    const shapes = [];

    for (const body of [
      {
        key: 'sun',
        label: 'Sun',
        colour: colour('--sky-sun', '#bd8721'),
        azimuth: curve.sun_azimuth,
        altitude: curve.sun_altitude,
      },
      {
        key: 'moon',
        label: 'Moon',
        colour: colour('--sky-moon', '#4a93cc'),
        azimuth: curve.moon_azimuth,
        altitude: curve.moon_altitude,
      },
    ]) {
      // Thin and translucent: the imagery underneath is what is being read.
      const thin = { stroke: body.colour, strokeWidth: 2.5, strokeOpacity: 0.9 };
      for (const run of upRuns(body.altitude)) {
        shapes.push({ kind: 'line', points: run.map((i) => at(body.azimuth[i])), style: thin });
      }
      for (const { index: i, long } of hourTicks(curve.minutes, body.altitude)) {
        shapes.push({
          kind: 'line',
          points: [at(body.azimuth[i], 0.94), at(body.azimuth[i], long ? 1.1 : 1.03)],
          style: thin,
          tip: `${body.label} ${curve.clock[i]} · az ${Math.round(body.azimuth[i])}°`,
        });
      }
      const altitude = body.altitude[index];
      const below = isBelow(altitude);
      const reading = bodyReading(body.label, curve.clock[index], body.azimuth[index], altitude);
      shapes.push({
        kind: 'line',
        points: [origin, at(body.azimuth[index])],
        style: {
          stroke: body.colour,
          strokeWidth: 3.5,
          strokeOpacity: below ? 0.6 : 1,
          dash: below ? '6 6' : null,
        },
        tip: { text: reading, sticky: true },
      });
      // Nothing rides the ray while the body is under the horizon: the dashed
      // ray already says where it is, and a mark on it would claim it is visible.
      //
      // The body itself is a mark on its own ray: it rides between the anchor,
      // which stands for the zenith, and the arc, which stands for the horizon,
      // so how far up it is reads as how close to you it is.
      if (!below) {
        shapes.push({
          kind: 'marker',
          at: at(body.azimuth[index], markScale(altitude)),
          className: 'sky-body', // replaces the engine's boxed default
          html: bodySvg(
            body.key,
            body.colour,
            curve.moon_illuminated[index],
            sky.moon.waxing,
            BODY_SIZE
          ),
          size: [BODY_SIZE, BODY_SIZE],
          anchor: [BODY_SIZE / 2, BODY_SIZE / 2],
          keyboard: false,
          tip: body.key === 'moon' ? `${reading} · ${sky.moon.phase}` : reading,
        });
      }
    }

    shapes.push({
      kind: 'dot',
      at: origin,
      style: {
        radius: 4,
        stroke: '#fff',
        strokeWidth: 2,
        fill: colour('--accent', '#e8a33d'),
        fillOpacity: 1,
      },
    });
    layer.set(shapes);
  }

  return {
    get on() {
      return on;
    },
    get anchor() {
      return anchor;
    },
    get day() {
      return day;
    },
    get index() {
      return index;
    },
    get sky() {
      return sky;
    },
    get loading() {
      return loading;
    },
    get placing() {
      return placing;
    },

    /** Open on a point, unless one was already planted — the anchor outlives a
     *  close, so reopening reads the same place rather than wherever the map
     *  has since drifted to. */
    open(fallback) {
      on = true;
      anchor ??= fallback;
    },

    close() {
      on = false;
      placing = false;
      layer?.clear();
    },

    setDay(value) {
      day = value;
      sky = null; // the day on screen is not this one's
    },

    setIndex(value) {
      index = value;
    },

    togglePlacing() {
      placing = !placing;
      return placing;
    },

    /** A map click, while waiting for an anchor. False means it was not ours. */
    place(at) {
      if (!placing) return false;
      anchor = at;
      sky = null;
      placing = false;
      return true;
    },

    /** A point, a date and a time from another tool: same mode, second way in. */
    handOff({ lat, lon, date, time }) {
      anchor = { lat, lon };
      day = date ?? '';
      sky = null;
      index = 0;
      handedClock = time ?? null;
      on = true;
    },

    /** Read the sky for the anchored point. Late answers land nowhere. */
    async load() {
      if (!on || !anchor) return;
      const params = new URLSearchParams({ lat: anchor.lat, lon: anchor.lon });
      if (day) params.set('date', day);
      const mine = ++ticket;
      loading = true;
      try {
        const result = await api.get(`/api/geo/sky?${params}`);
        if (mine !== ticket) return;
        sky = result;
        day = result.date;
        index = nearestSample(
          result.curve.clock,
          handedClock ?? result.moment.local.slice(11, 16)
        );
        handedClock = null;
      } catch {
        if (mine === ticket) notify('Could not read the sky for that point', 'danger');
      } finally {
        if (mine === ticket) loading = false;
      }
    },

    draw,
    destroy() {
      ticket += 1; // an answer in flight has nothing left to land on
      layer?.destroy();
      layer = null;
    },
  };
}
