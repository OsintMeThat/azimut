/**
 * The Elevation profile tool: a line drawn on the map, and the ground along it.
 *
 * A tool of its own rather than a button in Measure, because it asks something
 * Measure never should: the heights come from the terrain server, and a
 * distance is drawn without reaching anyone. So the question is put once the
 * line is finished (Enter), and again when one of its corners is dropped
 * somewhere else, never while the line is still being clicked out.
 *
 * Besides the heights, the answer says whether the end of the line is in
 * sight from its start, for an eye and a target standing as high above the
 * ground as the panel says (a person, a mast, a drone). The heights are kept
 * here so a changed one asks again.
 *
 * Where the pointer is on the chart is marked on the line itself.
 *
 * @param {object} deps
 * @param {() => object|null} deps.engine the map, once it is up
 * @param {object} deps.api the app's fetch wrapper
 * @param {(engine: object) => object} [deps.surface] the drawing layer factory
 */
import { cornerHandles } from '../../../lib/map/handles.js';
import { createSurface } from '../../../lib/map/surface.js';
import { blockedSample } from '../../../lib/profile.js';

const STROKE = { stroke: '#4cc3ff', strokeWidth: 2.5, strokeOpacity: 0.95 };
const DOT = { radius: 4, stroke: '#fff', strokeWidth: 2, fill: '#4cc3ff', fillOpacity: 1 };
/** The point the chart is read at, set apart from the line's own corners. */
const READ_AT = { radius: 6, stroke: '#4cc3ff', strokeWidth: 2.5, fill: '#111', fillOpacity: 1 };
/** Where the ground stands in the way of the line of sight. */
const BLOCKED = { radius: 6, stroke: '#fff', strokeWidth: 2, fill: '#d97070', fillOpacity: 1, interactive: false };
/** The stretch from the last corner to the pointer while the line is drawn. */
const PREVIEW = { stroke: '#4cc3ff', strokeWidth: 2, strokeOpacity: 0.7, dash: [2, 2], interactive: false };
const LINE = 'profile-line';
const NEXT = 'profile-next';
/** How finely the line is read: enough for a ridge, little enough to answer fast. */
export const PROFILE_SAMPLES = 400;
/** A person's eyes, and a target on the ground, until the panel says otherwise. */
export const EYE_HEIGHT = 1.7;
export const TARGET_HEIGHT = 0;

export function createProfileState({ engine, api, surface = createSurface }) {
  let on = $state(false);
  let points = $state([]);
  let finished = $state(false);
  let eyeHeight = $state(EYE_HEIGHT);
  let targetHeight = $state(TARGET_HEIGHT);
  let profile = $state(null);
  let busy = $state(false);
  let error = $state('');
  let asked = 0;
  let readAt = null;
  let pointer = null;
  let layer = null;

  function draw() {
    const map = engine();
    if (!map) return;
    layer ??= surface(map);
    const corners = finished
      ? cornerHandles(points, { prefix: 'profile-corner', onMove: moveCorner, onDrop: () => read(), tone: 'ground', ends: true })
      : points.map((point) => ({ kind: 'dot', at: point, style: DOT }));
    const blocked = finished ? blockedSample(profile) : -1;
    layer.set([
      points.length >= 2 && { id: LINE, kind: 'line', points, style: STROKE },
      !finished && points.length >= 1 && pointer && { id: NEXT, kind: 'line', points: [points.at(-1), pointer], style: PREVIEW },
      blocked >= 0 && { kind: 'dot', at: { lat: profile.lat[blocked], lon: profile.lon[blocked] }, style: BLOCKED },
      ...corners,
      readAt && { kind: 'dot', at: readAt, style: READ_AT },
    ]);
  }

  /** A corner on its way: the line follows, the handles stay under the hand. */
  function moveCorner(index, at) {
    points = points.map((point, i) => (i === index ? at : point));
    layer?.patch(LINE, { points });
  }

  async function read() {
    if (!finished || points.length < 2) return;
    const mine = ++asked;
    busy = true;
    error = '';
    if (readAt) {
      readAt = null;
      draw();
    }
    try {
      const answer = await api.post('/api/terrain/profile', {
        points: points.map((point) => [point.lat, point.lon]),
        samples: PROFILE_SAMPLES,
        sight: true,
        eye_height: eyeHeight,
        target_height: targetHeight,
      });
      if (mine === asked) {
        profile = answer;
        draw(); // the obstruction, if any, goes on the line
      }
    } catch (failure) {
      if (mine === asked) error = failure.message;
    } finally {
      if (mine === asked) busy = false;
    }
  }

  function clear() {
    asked += 1;
    pointer = null;
    points = [];
    finished = false;
    profile = null;
    busy = false;
    error = '';
    readAt = null;
    layer?.clear();
  }

  return {
    get on() {
      return on;
    },
    get points() {
      return points;
    },
    get finished() {
      return finished;
    },
    get profile() {
      return profile;
    },
    get busy() {
      return busy;
    },
    get error() {
      return error;
    },
    /** Whether the chart's window is up: once a finished line has an answer coming. */
    get showing() {
      return finished && (busy || !!profile || !!error);
    },
    get eyeHeight() {
      return eyeHeight;
    },
    get targetHeight() {
      return targetHeight;
    },

    /** The eye's and the target's heights above the ground; a change asks again. */
    setHeights({ eye = eyeHeight, target = targetHeight }) {
      const next = [Math.max(0, Number(eye) || 0), Math.max(0, Number(target) || 0)];
      if (next[0] === eyeHeight && next[1] === targetHeight) return;
      [eyeHeight, targetHeight] = next;
      read();
    },

    open() {
      on = true;
    },
    close() {
      on = false;
      clear();
    },

    /** A map click while the tool is on. A finished line takes it and adds
     *  nothing; its corners move by their handles. False when it was not ours. */
    addPoint(at) {
      if (!on) return false;
      if (finished) return true;
      points = [...points, { lat: at.lat, lon: at.lon }];
      draw();
      return true;
    },

    /** Enter: the line is done, its corners become handles, and the ground is read. */
    finish() {
      if (!on || finished || points.length < 2) return false;
      finished = true;
      pointer = null;
      draw();
      read();
      return true;
    },

    /** The pointer over the map while the line is drawn: the next stretch follows it. */
    follow(at) {
      if (!on || finished || !points.length) return;
      const first = !pointer;
      pointer = at ? { lat: at.lat, lon: at.lon } : null;
      if (first || !pointer || !layer?.has(NEXT)) draw();
      else layer.patch(NEXT, { points: [points.at(-1), pointer] });
    },

    /** Mark the point the chart is read at, or take the mark away with null. */
    showReading(at) {
      if (!finished && at) return;
      readAt = at ? { lat: at.lat, lon: at.lon } : null;
      draw();
    },

    clear,
    destroy() {
      layer?.destroy();
      layer = null;
    },
  };
}
