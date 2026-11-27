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
 * A shadow can be read too, when asked for and never otherwise: two clicks, the
 * foot of something and the tip of its shadow, and the sun of the panel's day
 * says the hour it stood opposite and how tall the thing is. The anchor moves to
 * the foot and the slider to that hour, so the sun's ray and the shadow make one
 * line through the foot, the sun on one side and the shadow on the other. While
 * the tip is aimed or an end dragged, the hour and the height are read off the
 * day's curve by the hand. The day is the imagery's when it has one, since that
 * is the day the shadow was cast.
 *
 * The geometry and the glyphs are `lib/skyOverlay.js`; this holds the point,
 * the day, the hour, the shadow, and the layers they are drawn on.
 *
 * @param {object} deps
 * @param {() => object|null} deps.engine the map, once it is up
 * @param {object} deps.api the app's fetch wrapper
 * @param {(message: string, kind?: string, ms?: number) => void} deps.notify
 * @param {() => string|null} [deps.pictureDate] the day the imagery on screen was taken
 * @param {() => string} [deps.units] the analyst's units, for a height
 * @param {(lat: number, lon: number) => string} [deps.coords] a point as the analyst's coordinates read
 * @param {(name: string, fallback: string) => string} [deps.colour] theme lookup
 * @param {(engine: object) => object} [deps.surface] the drawing layer factory
 */
import { untrack } from 'svelte';
import { bearingBetween } from '../../../lib/horizon/geometry.js';
import { cornerHandles } from '../../../lib/map/handles.js';
import { createSurface } from '../../../lib/map/surface.js';
import { destination, formatBearing, formatHeight, haversine } from '../../../lib/measure.js';
import {
  bodyReading,
  bodySvg,
  castsReversed,
  clockOf,
  fallsSentence,
  hourTicks,
  isBelow,
  markScale,
  nearestSample,
  shadowOnCurve,
  shadowSentence,
  upRuns,
} from '../../../lib/skyOverlay.js';

const BODY_SIZE = 20;

/** The arc is a circle around the anchor, so its radius comes off the *shorter*
 *  side of the view: sized by the diagonal it runs off a wide window. */
const REACH = 0.22;

/** A tip this close to the foot is the second click of a double click, not a shadow. */
const SAME_POINT_M = 0.5;

/** A shadow no hour of the day casts is drawn grey, wherever it is drawn. */
const NO_HOUR = '#9b9b9b';
const HANDLE_FILL = '#f5a623';

/**
 * The tip of a shadow, an arrow pointing away from the foot. Its point is the
 * centre of the mark, so it lands on the tip whichever way the map is turned.
 */
function arrowMark(bearing, fill, live = false) {
  return {
    className: `path-handle shadow-tip${live ? ' live' : ''}`,
    html: `<svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true"><path d="M18 18 9.5 33h17z" fill="${fill}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
    size: [36, 36],
    rotation: bearing,
  };
}

function themeColour(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** A full day from the picture's date, or null for a bare year or nothing. */
export function usableDate(text) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(text ?? '')) ? text : null;
}

const escape = (text) =>
  String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function createSkyState({
  engine,
  api,
  notify,
  pictureDate = () => null,
  units = () => 'metric',
  coords = (lat, lon) => `${lat.toFixed(6)}, ${lon.toFixed(6)}`,
  colour = themeColour,
  surface = createSurface,
}) {
  let on = $state(false);
  let anchor = $state.raw(null); // { lat, lon } — fixed, never the moving view
  let day = $state(''); // empty: the backend's today at that point
  let index = $state(0); // sample of the day the slider is on
  let sky = $state(null);
  let loading = $state(false);
  let placing = $state(false);
  let layer = null;
  let ticket = 0;
  // the shadow: { foot, tip }, the tip null while it is still to be clicked
  let shadow = $state.raw(null);
  let tracing = $state(null); // 'foot' | 'tip' while the clicks put it down
  let shadowRead = $state(null); // { date, answer, busy, error }
  let shadowTicket = 0;
  let shadowLayer = null;
  let pointer = null; // where the tip would land, while it is aimed
  let held = false; // an end of the shadow is in the hand
  let aimLayer = null; // what the hand would read, beside it
  // A wall clock to land the slider on once the day's samples are in, from a
  // hand-off. Spent on the first load, so a later date is read at its own hour.
  let handedClock = null;

  function draw() {
    const map = engine();
    if (!map) return;
    // the hour following a dragged end redraws the sky; the handle held stays
    if (!held) drawShadow();
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

  // --- the shadow ---------------------------------------------------------------

  /**
   * The shadow on a layer of its own, so its ends drag without the arcs drawn
   * again under the hand. The layer is made the first time a shadow is put down.
   */
  function drawShadow() {
    if (!shadowLayer && !shadow) return;
    const map = engine();
    if (!map) return;
    shadowLayer ??= surface(map);
    if (!on || !shadow) {
      shadowLayer.clear();
      hideAim();
      return;
    }
    const sun = colour('--sky-sun', '#bd8721');
    const shapes = [];
    if (!shadow.tip) {
      shapes.push({ id: 'shadow-foot', kind: 'dot', at: shadow.foot, style: { radius: 4, stroke: '#fff', strokeWidth: 2, fill: sun, fillOpacity: 1, interactive: false } });
      if (pointer) {
        const casts = preview(shadow.foot, pointer)?.length !== 0;
        shapes.push({ id: 'shadow-live', kind: 'line', points: [shadow.foot, pointer], style: liveStyle(casts) });
        shapes.push({ id: 'shadow-live-tip', kind: 'marker', at: pointer, ...arrowMark(bearingBetween(shadow.foot, pointer), casts ? HANDLE_FILL : NO_HOUR, true), keyboard: false });
      }
      shadowLayer.set(shapes);
      return;
    }
    const points = [shadow.foot, shadow.tip];
    const answer = shadowRead?.answer;
    const none = Boolean(answer && !answer.moments?.length);
    shapes.push({ id: 'shadow-casing', kind: 'line', points, style: { stroke: '#000', strokeWidth: 6, strokeOpacity: 0.4, interactive: false } });
    shapes.push({ id: 'shadow', kind: 'line', points, style: { stroke: none ? NO_HOUR : sun, strokeWidth: 3, strokeOpacity: 1, interactive: false } });
    const [foot, tip] = cornerHandles(points, { prefix: 'shadow-end', onMove: moveEnd, onDrop: dropEnd });
    shapes.push(
      { ...foot, title: 'Drag to move the foot' },
      { ...tip, ...arrowMark(bearingBetween(shadow.foot, shadow.tip), none ? NO_HOUR : HANDLE_FILL), title: 'Drag to move the tip of the shadow' }
    );
    const first = answer?.moments?.[0];
    if (first) {
      const [x, y] = besideFoot();
      shapes.push({
        id: 'shadow-word',
        kind: 'marker',
        at: shadow.foot,
        className: 'measure-word use',
        html: `<span style="transform:translate(${x}px,${y}px)">${escape(`≈ ${formatHeight(first.height_m, units())} tall`)}</span>`,
        keyboard: false,
      });
    }
    shadowLayer.set(shapes);
  }

  function liveStyle(casts) {
    return { stroke: casts ? colour('--sky-sun', '#bd8721') : NO_HOUR, strokeWidth: 2, strokeOpacity: 0.9, dash: '6 5', interactive: false };
  }

  /**
   * Where the height sits: a quarter turn left of the shadow, off both the
   * shadow and the sun's ray, which runs on from the foot the other way.
   */
  function besideFoot() {
    const map = engine();
    const a = map?.latLngToContainerPoint?.(shadow.foot);
    const b = map?.latLngToContainerPoint?.(shadow.tip);
    const length = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
    if (!length) return [0, 24];
    // wider than tall, as the words are
    return [Math.round(((b.y - a.y) / length) * 62), Math.round((-(b.x - a.x) / length) * 28)];
  }

  /**
   * A shadow from `foot` to `end` read off the day's curve, as the hand moves:
   * each moment with its clock, its sample and the height. Null before the day
   * is in, which reads as nothing rather than as no hour.
   */
  function preview(foot, end) {
    if (!sky?.curve) return null;
    const length = haversine(foot, end);
    return shadowOnCurve(sky.curve, bearingBetween(foot, end)).map((moment) => ({
      ...moment,
      height: length * Math.tan((moment.altitude * Math.PI) / 180),
    }));
  }

  /** What the shadow under the hand reads, beside the hand, on a layer of its own. */
  function showAim(at, reading) {
    const map = engine();
    if (!map || !reading) return hideAim();
    aimLayer ??= surface(map);
    const [first] = reading;
    const text = first ? `${first.clock} · ≈ ${formatHeight(first.height, units())} tall` : 'No hour of the day';
    const icon = {
      className: `measure-word mine shadow-aim${first ? '' : ' none'}`,
      html: `<span style="transform:translate(calc(50% + 16px),16px)">${escape(text)}</span>`,
    };
    if (!aimLayer.patch('shadow-aim', { at, icon })) aimLayer.set([{ id: 'shadow-aim', kind: 'marker', at, ...icon, keyboard: false }]);
  }

  function hideAim() {
    aimLayer?.clear();
  }

  /** The slider on the hour the hand's shadow names: the sun's ray swings opposite it. */
  function followHour(reading) {
    if (reading?.length) index = reading[0].index;
  }

  /**
   * An end of the shadow on its way: the line and the arrow follow, the hour and
   * the height are read by the hand, and the backend is asked at the drop.
   */
  function moveEnd(end, at) {
    if (!shadow?.tip) return;
    if (!held) shadowLayer?.patch('shadow-word', { icon: { className: 'measure-word use', html: '' } });
    held = true;
    shadow = end === 0 ? { ...shadow, foot: at } : { ...shadow, tip: at };
    const points = [shadow.foot, shadow.tip];
    const reading = preview(shadow.foot, shadow.tip);
    const casts = reading?.length !== 0;
    shadowLayer?.patch('shadow', { points, style: { stroke: casts ? colour('--sky-sun', '#bd8721') : NO_HOUR, strokeWidth: 3, strokeOpacity: 1, interactive: false } });
    shadowLayer?.patch('shadow-casing', { points });
    const arrow = arrowMark(bearingBetween(shadow.foot, shadow.tip), casts ? HANDLE_FILL : NO_HOUR);
    shadowLayer?.patch('shadow-end-1', { icon: arrow, rotation: arrow.rotation });
    showAim(at, reading);
    followHour(reading);
  }

  function dropEnd() {
    held = false;
    hideAim();
    plantOn(shadow.foot);
    shadowRead = null;
    drawShadow();
    readShadow();
  }

  /**
   * The sun drawn from the shadow's foot, so its ray and the shadow make one
   * line through it. The slider keeps its hour while that point's sky is read,
   * and the reading on screen stays until then: a foot is a few steps from
   * where the sky was read, and a blank arc at every drop would only flicker.
   */
  function plantOn(point) {
    if (anchor && haversine(anchor, point) < SAME_POINT_M) return;
    if (sky) handedClock = sky.curve.clock[index] ?? null;
    anchor = { lat: point.lat, lon: point.lon };
  }

  /** The slider on the hour a moment of the shadow's answer names. */
  function showMoment(i) {
    const moment = shadowRead?.answer?.moments?.[i];
    if (moment && sky) index = nearestSample(sky.curve.clock, clockOf(moment));
  }

  /**
   * Ask when the sun cast the shadow, on the day the sky is read for and in its
   * zone, so the hour lands on the slider's clock. Waits for that day's sky:
   * `load` asks again once it is in.
   */
  async function readShadow() {
    if (!shadow?.tip || !sky) return;
    const { foot, tip } = shadow;
    const date = sky.date;
    const query = new URLSearchParams({
      lat: foot.lat.toFixed(6),
      lon: foot.lon.toFixed(6),
      date,
      bearing: bearingBetween(foot, tip).toFixed(2),
      length: Math.max(0.01, haversine(foot, tip)).toFixed(2),
    });
    if (sky.zone?.name) query.set('zone', sky.zone.name);
    const mine = ++shadowTicket;
    const zone = sky.zone?.name ?? '';
    shadowRead = { date, zone, answer: null, busy: true, error: '' };
    try {
      const answer = await api.get(`/api/geo/shadow?${query}`);
      if (mine !== shadowTicket) return;
      shadowRead = { date, zone, answer, busy: false, error: '' };
      showMoment(0);
    } catch (failure) {
      if (mine !== shadowTicket) return;
      shadowRead = { date, zone, answer: null, busy: false, error: failure?.message || 'Could not read the sun' };
    }
    drawShadow();
  }

  /** A shadow half put down let go of; a whole one stays as it was. */
  function dropShadowStart() {
    tracing = null;
    pointer = null;
    hideAim();
    if (!shadow?.tip) shadow = null;
    drawShadow();
    return true;
  }

  function dropShadow() {
    shadow = null;
    shadowRead = null;
    tracing = null;
    pointer = null;
    held = false;
    hideAim();
    shadowTicket += 1; // an answer in flight is nobody's
    drawShadow();
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

    /** 'foot' or 'tip' while the shadow is being put down, else null. */
    get tracing() {
      return tracing;
    },

    /**
     * The shadow as the panel says it: where the clicks stand, and once read,
     * each moment of the day that casts it, its hour and how tall it makes the
     * thing. `noDay` when the imagery has no day of its own to read it on.
     */
    get shadow() {
      if (!shadow && !tracing) return null;
      const answer = shadowRead?.answer;
      return {
        step: tracing,
        traced: Boolean(shadow?.tip),
        busy: Boolean(shadowRead?.busy),
        error: shadowRead?.error ?? '',
        date: shadowRead?.date ?? '',
        answered: Boolean(answer),
        moments: (answer?.moments ?? []).map((moment) => ({
          clock: clockOf(moment),
          zone: moment.abbreviation ?? '',
          height: formatHeight(moment.height_m, units()),
          sun: `sun at ${formatBearing(moment.sun_azimuth)}, ${Number(moment.sun_altitude).toFixed(1)}° up`,
        })),
        // a shadow no hour casts says which way they fall that day, and whether
        // it was drawn the wrong way round
        falls: answer && !answer.moments?.length && 'falls' in answer ? fallsSentence(answer.falls) : '',
        swappable: Boolean(answer && !answer.moments?.length && castsReversed(answer)),
        noDay: !usableDate(pictureDate()),
      };
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
      // a shadow half put down is let go of; a whole one waits, hidden, like the anchor
      if (tracing) dropShadowStart();
      layer?.clear();
      shadowLayer?.clear();
      hideAim();
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
      if (placing && tracing) dropShadowStart();
      return placing;
    },

    /**
     * Put a shadow down, or stop: the next click is the foot of something, the
     * one after the tip of its shadow. On imagery with a day of its own, the sky
     * is read for that day, the one the shadow was cast on.
     */
    traceShadow() {
      if (tracing) return dropShadowStart();
      placing = false;
      dropShadow();
      tracing = 'foot';
      const pictured = usableDate(pictureDate());
      if (pictured && pictured !== day) {
        day = pictured;
        sky = null;
      }
      return true;
    },

    /** Escape while the shadow is put down: it is let go of. False when none was. */
    stopTracing() {
      if (!tracing) return false;
      dropShadowStart();
      return true;
    },

    /** The shadow off the map. */
    clearShadow() {
      dropShadow();
    },

    /** The pointer while the tip is aimed: the line from the foot follows it. */
    follow(at) {
      if (tracing !== 'tip' || !shadow || !at) return;
      const had = pointer;
      pointer = { lat: at.lat, lon: at.lon };
      const reading = preview(shadow.foot, pointer);
      const casts = reading?.length !== 0;
      if (had) {
        shadowLayer?.patch('shadow-live', { points: [shadow.foot, pointer], style: liveStyle(casts) });
        const arrow = arrowMark(bearingBetween(shadow.foot, pointer), casts ? HANDLE_FILL : NO_HOUR, true);
        shadowLayer?.patch('shadow-live-tip', { at: pointer, icon: arrow, rotation: arrow.rotation });
      } else drawShadow();
      showAim(pointer, reading);
      followHour(reading);
    },

    /** The shadow read with its ends the other way round: the tip is the foot now. */
    swapShadow() {
      if (!shadow?.tip) return;
      shadow = { foot: shadow.tip, tip: shadow.foot };
      plantOn(shadow.foot);
      shadowRead = null;
      drawShadow();
      readShadow();
    },

    showMoment,

    /** The shadow as text to paste: what it says, then where it was drawn. */
    shadowText() {
      const answer = shadowRead?.answer;
      if (!shadow?.tip || !answer) return '';
      const at = (point) => coords(point.lat, point.lon);
      return [
        shadowSentence(answer, units()),
        `Shadow from ${at(shadow.foot)} to ${at(shadow.tip)}, read for ${answer.date ?? shadowRead.date}`,
      ].join('\n');
    },

    /** A map click, while waiting for an anchor or a shadow. False means it was not ours. */
    place(at) {
      const point = { lat: at.lat, lon: at.lon };
      if (tracing === 'foot') {
        shadow = { foot: point, tip: null };
        tracing = 'tip';
        plantOn(point);
        drawShadow();
        return true;
      }
      if (tracing === 'tip') {
        // the second click of a double click on the foot puts no shadow down
        if (haversine(shadow.foot, point) < SAME_POINT_M) return true;
        shadow = { ...shadow, tip: point };
        tracing = null;
        pointer = null;
        hideAim();
        drawShadow();
        readShadow();
        return true;
      }
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
        // a shadow read for another day, or in another zone, is read again for this one
        const read = shadowRead;
        if (shadow?.tip && (read?.date !== result.date || (read?.zone ?? '') !== (result.zone?.name ?? ''))) readShadow();
      } catch {
        if (mine === ticket) notify('Could not read the sky for that point', 'danger');
      } finally {
        if (mine === ticket) loading = false;
      }
    },

    /**
     * Lay the sky and the shadow again. Untracked, so an effect that redraws on
     * the day or the hour does not also redraw on the shadow: an end being
     * dragged moves it, and laying the handles again would drop the one held.
     */
    draw: () => untrack(draw),
    destroy() {
      ticket += 1; // an answer in flight has nothing left to land on
      shadowTicket += 1;
      layer?.destroy();
      shadowLayer?.destroy();
      aimLayer?.destroy();
      layer = shadowLayer = null;
    },
  };
}
