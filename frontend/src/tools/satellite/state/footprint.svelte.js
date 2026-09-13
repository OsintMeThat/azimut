/**
 * Tracing a place's footprint: the shape it really is, drawn by hand.
 *
 * A pin dropped on a guess is what this fixes. "Somewhere on the north quay" is
 * a quay, not a circle around a point, and the case has held the field, its
 * validation and its drawing since places grew a precision (ONTOLOGY §2) — the
 * only way to fill it was to paste GeoJSON into Details, which is a thing
 * nobody does. This is the gesture.
 *
 * Three rules, and each is about a shape being somebody's claim:
 *
 * - **It is traced for one place, named the whole time.** Tracing is armed from
 *   that place's card, so there is never a shape on the map looking for an owner.
 * - **Nothing is written until Save.** Vertices are a draft on a scratch layer;
 *   the point's own footprint is untouched until the analyst says so, and Cancel
 *   leaves the place exactly as it was.
 * - **A shape that is not an area, or that misses its own pin, is refused here**
 *   rather than by the backend: under three corners there is nothing to file, and
 *   a polygon traced beside the point describes somewhere else. The panel says so
 *   rather than sending a request to be told.
 *
 * @param {object} deps
 * @param {object} deps.api the app's fetch wrapper
 * @param {(message: string, kind?: string, ms?: number) => void} deps.notify
 * @param {() => string|undefined} deps.caseId the case the place belongs to
 * @param {() => object|null} deps.engine the map, through the façade
 * @param {() => Promise<any>} deps.onSaved re-read the saved index, so the
 *   traced shape appears under its pin
 * @param {(engine: object) => object} [deps.surface] the drawing layer factory
 */
import { createSurface } from '../../../lib/map/surface.js';
import { containsPoint } from '../../../lib/measure.js';

/** Matches the footprint already drawn under a pin (`SavedOverlay`). */
const STROKE = { stroke: '#f5a623', strokeWidth: 2, strokeOpacity: 0.95 };
const FILL = { fill: '#f5a623', fillOpacity: 0.16 };
const DOT = { radius: 4, stroke: '#fff', strokeWidth: 2, fill: '#f5a623', fillOpacity: 1 };

/** The cap the store enforces (engine/entities.py MAX_FOOTPRINT_POINTS). */
const MAX_POINTS = 4096;

/** A ring of clicked points as GeoJSON: lon first, and closed. */
export function polygonOf(points) {
  if (points.length < 3) return null;
  const ring = points.map((point) => [point.lon, point.lat]);
  return { type: 'Polygon', coordinates: [[...ring, ring[0]]] };
}

export function createFootprintState({
  api,
  notify,
  caseId,
  engine,
  onSaved,
  surface = createSurface,
}) {
  /** The place being traced: `{ id, title, footprint, radius_m, at }`, or null
   *  when off. `at` is the pin itself, which the shape has to contain. */
  let place = $state(null);
  let points = $state([]);
  let saving = $state(false);
  let layer = null;

  function draw() {
    const map = engine();
    if (!map) return;
    layer ??= surface(map);
    layer.set([
      points.length >= 3
        ? { kind: 'polygon', points, style: { ...STROKE, ...FILL } }
        : points.length === 2
          ? { kind: 'line', points, style: STROKE }
          : null,
      ...points.map((point) => ({ kind: 'dot', at: point, style: DOT })),
    ]);
  }

  function stop() {
    place = null;
    points = [];
    layer?.clear();
  }

  /** Whether the shape as drawn holds the pin it belongs to. A place that carries no
   *  point of its own has nothing to contradict. */
  function covers() {
    if (points.length < 3) return false;
    return place?.at ? containsPoint(points, place.at) : true;
  }

  return {
    get on() {
      return Boolean(place);
    },
    get place() {
      return place;
    },
    get points() {
      return points;
    },
    get saving() {
      return saving;
    },
    /** Whether what is drawn is an area, which is the only thing worth saving. */
    get complete() {
      return points.length >= 3;
    },
    /** …and whether that area is this place's: a shape beside the pin is a shape
     *  for somewhere else, so the panel refuses it rather than the store. */
    get covers() {
      return covers();
    },

    /** Begin on a place. Starting again on another one drops the first draft. */
    start(row) {
      if (!row?.id) return false;
      stop();
      // `null` is a point the place does not have, and it numbers as 0 — which would
      // put every untraced place in the Gulf of Guinea and refuse every shape drawn.
      const lat = row.lat == null ? NaN : Number(row.lat);
      const lon = row.lon == null ? NaN : Number(row.lon);
      const at = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
      place = {
        id: row.id,
        title: row.title || 'this place',
        footprint: row.footprint || null,
        radius_m: Number(row.radius_m) > 0 ? Number(row.radius_m) : null,
        at,
      };
      return true;
    },

    /** A map click, while tracing. False means it was not ours. */
    addPoint(at) {
      if (!place) return false;
      if (points.length >= MAX_POINTS) {
        notify(`A footprint holds at most ${MAX_POINTS} points`, 'warn');
        return true; // ours, and deliberately swallowed
      }
      points = [...points, at];
      draw();
      return true;
    },

    /** Take back the last corner. The gesture has no other way to be wrong. */
    undo() {
      points = points.slice(0, -1);
      draw();
    },

    async save() {
      const shape = polygonOf(points);
      const cid = caseId();
      if (!shape || !place || !cid || saving) return;
      if (!covers()) {
        notify('The shape has to contain the place it belongs to', 'warn', 4000);
        return;
      }
      saving = true;
      try {
        // attrs merge server-side, so this writes the footprint and leaves
        // everything else the place holds exactly where it was — except the
        // radius, which the shape replaces: the map draws one of the two, and a
        // circle that survived a tracing it can no longer be seen behind is a
        // precision nobody can read.
        await api.patch(`/api/cases/${cid}/entities/${place.id}`, {
          attrs: { footprint: shape, radius_m: null },
        });
        stop();
        await onSaved?.();
        notify('Footprint saved', 'ok', 2000);
      } catch (e) {
        notify(`Could not save the footprint: ${e.message}`, 'danger', 6000);
      } finally {
        saving = false;
      }
    },

    cancel: stop,
    destroy() {
      layer?.destroy();
      layer = null;
    },
  };
}
