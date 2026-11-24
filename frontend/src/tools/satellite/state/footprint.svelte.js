/**
 * Tracing a place's footprint: the shape it really is, drawn by hand, or a new zone.
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
 *   that place's card, so there is never a shape on the map looking for an owner;
 *   a new zone (Save place's arrow) is named in the panel before it is saved.
 * - **Nothing is written until Save.** Corners are a draft on a scratch layer;
 *   the point's own footprint is untouched until the analyst says so, and Cancel
 *   leaves the place exactly as it was.
 * - **A shape that is not an area, or that misses its own pin, is refused here**
 *   rather than by the backend: under three corners there is nothing to file, and
 *   a polygon traced beside the point describes somewhere else. The panel says so
 *   rather than sending a request to be told. A zone's pin is only where its card
 *   hangs, so a zone reshaped away from it takes its pin along instead.
 *
 * A shape already traced opens with its corners: each is dragged to move it, the
 * dot halfway along a side is dragged to add one there, and a corner clicked is
 * picked for Delete to remove. A click on the map adds a corner after the last.
 *
 * @param {object} deps
 * @param {object} deps.api the app's fetch wrapper
 * @param {(message: string, kind?: string, ms?: number) => void} deps.notify
 * @param {() => string|undefined} deps.caseId the case the place belongs to
 * @param {() => object|null} deps.engine the map, through the façade
 * @param {(caseId: string) => Promise<any>} deps.onSaved re-read the owning
 *   case's saved index, so the traced shape appears under its pin
 * @param {(zone: {title: string, at: {lat: number, lon: number}, footprint: object}) => Promise<any>} [deps.createZone]
 *   files a new zone as a place of the case
 * @param {(engine: object) => object} [deps.surface] the drawing layer factory
 */
import { createSurface } from '../../../lib/map/surface.js';
import { cornerHandles, ghostHandles } from '../../../lib/map/handles.js';
import { containsPoint } from '../../../lib/measure.js';

/** Matches the footprint already drawn under a pin (`SavedOverlay`). */
const STROKE = { stroke: '#f5a623', strokeWidth: 2, strokeOpacity: 0.95 };
const FILL = { fill: '#f5a623', fillOpacity: 0.16 };

/** The cap the store enforces (engine/entities.py MAX_FOOTPRINT_POINTS). */
const MAX_POINTS = 4096;
/** The longest name a zone takes, as a place's. */
export const ZONE_NAME_MAX = 200;
/** What tells a click on a corner from the click a drag of it ends in. */
const AFTER_DRAG_MS = 300;

/** A ring of clicked points as GeoJSON: lon first, and closed. */
export function polygonOf(points) {
  if (points.length < 3) return null;
  const ring = points.map((point) => [point.lon, point.lat]);
  return { type: 'Polygon', coordinates: [[...ring, ring[0]]] };
}

/** The corners of a traced shape, back as points: its outer ring, unclosed. */
export function cornersOf(footprint) {
  const ring =
    footprint?.type === 'Polygon'
      ? footprint.coordinates?.[0]
      : footprint?.type === 'MultiPolygon'
        ? footprint.coordinates?.[0]?.[0]
        : null;
  if (!Array.isArray(ring) || ring.length < 4) return [];
  const points = ring.map(([lon, lat]) => ({ lat: Number(lat), lon: Number(lon) }));
  const [first, last] = [points[0], points.at(-1)];
  return first.lat === last.lat && first.lon === last.lon ? points.slice(0, -1) : points;
}

/**
 * A point inside an area, where its pin and its card can stand: the corners' mean
 * when that falls inside, else the middle of the first stretch of a line across it
 * at that latitude, which is inside whatever the shape's outline does.
 */
export function insidePoint(points) {
  if (points.length < 3) return null;
  const mean = {
    lat: points.reduce((sum, p) => sum + p.lat, 0) / points.length,
    lon: points.reduce((sum, p) => sum + p.lon, 0) / points.length,
  };
  if (containsPoint(points, mean)) return mean;
  const crossings = [];
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length];
    if ((a.lat > mean.lat) === (b.lat > mean.lat)) return;
    crossings.push(a.lon + ((mean.lat - a.lat) / (b.lat - a.lat)) * (b.lon - a.lon));
  });
  crossings.sort((x, y) => x - y);
  return crossings.length >= 2 ? { lat: mean.lat, lon: (crossings[0] + crossings[1]) / 2 } : points[0];
}

const plain = (at) => ({ lat: at.lat, lon: at.lon });

export function createFootprintState({
  api,
  notify,
  caseId,
  engine,
  onSaved,
  createZone = null,
  surface = createSurface,
}) {
  /** The place being traced, including its owning case, or null when off.
   *  `at` is the pin itself, which the shape has to contain; `fresh` a new zone. */
  let place = $state(null);
  let points = $state([]);
  // the corner picked, which Delete removes; -1 when none is
  let selected = $state(-1);
  // a new zone's name, typed in the panel
  let title = $state('');
  let saving = $state(false);
  let layer = null;
  let operation = 0;
  let draggedAt = 0;

  function outline(pts) {
    if (pts.length >= 3) return { id: 'fp-shape', kind: 'polygon', points: pts, style: { ...STROKE, ...FILL } };
    if (pts.length === 2) return { id: 'fp-shape', kind: 'line', points: pts, style: STROKE };
    return null;
  }

  function draw() {
    const map = engine();
    if (!map) return;
    layer ??= surface(map);
    const pts = points.map(plain);
    const corners = cornerHandles(pts, { prefix: 'fp-corner', onMove: move, onDrop: () => draw() }).map(
      (handle, index) => ({
        ...handle,
        className: index === selected ? `${handle.className} picked` : handle.className,
        title: 'Drag to move this corner, click to pick it for Delete',
        onDragStart: () => (draggedAt = Date.now()),
        onClick: () => {
          if (Date.now() - draggedAt < AFTER_DRAG_MS) return;
          selected = selected === index ? -1 : index;
          draw();
        },
      })
    );
    const sides = pts.length >= 3
      ? ghostHandles(pts, { prefix: 'fp-side', closed: true, onInsert: insert, onMove: move, onDrop: () => draw() })
          .map((handle) => ({ ...handle, title: 'Drag to add a corner here' }))
      : [];
    layer.set([outline(pts), ...sides, ...corners].filter(Boolean));
  }

  /** A corner dragged: the outline follows without tearing the handles down under the hand. */
  function move(index, at) {
    draggedAt = Date.now();
    points[index] = plain(at);
    const shape = outline(points.map(plain));
    if (shape) layer?.patch?.('fp-shape', { points: shape.points });
  }

  /** A side's dot taken: a corner goes in after `leg`'s start, and is the one dragged. */
  function insert(leg, at) {
    if (points.length >= MAX_POINTS) return -1;
    points = [...points.slice(0, leg + 1), plain(at), ...points.slice(leg + 1)];
    selected = -1;
    return leg + 1;
  }

  function stop() {
    operation += 1;
    saving = false;
    place = null;
    points = [];
    selected = -1;
    title = '';
    layer?.clear();
  }

  /** Whether the shape as drawn holds the pin it belongs to. A place that carries no
   *  point of its own, or a zone whose pin goes where its shape is, has nothing to
   *  contradict. */
  function covers() {
    if (points.length < 3) return false;
    if (!place?.at || place.zone) return true;
    return containsPoint(points, place.at);
  }

  /** A zone's pin, moved to stand inside a shape reshaped away from it. The move
   *  takes the old shape along; the new one is written right after it. */
  async function keepPin(target) {
    if (!target.zone || !target.at || containsPoint(points, target.at)) return;
    await api.post(`/api/cases/${target.caseId}/satellite/places/${target.id}/move`, insidePoint(points));
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
    get selected() {
      return selected;
    },
    get title() {
      return title;
    },
    set title(value) {
      title = String(value ?? '').slice(0, ZONE_NAME_MAX);
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
    /** Whether Save can go: an area, its place's, and a new zone named. */
    get ready() {
      return points.length >= 3 && covers() && (!place?.fresh || title.trim().length > 0);
    },

    /** Begin on a place, from its card: with the corners it has, or none. Starting
     *  again on another one drops the first draft. */
    start(row) {
      const ownerCaseId = caseId();
      if (!row?.id || !ownerCaseId) return false;
      stop();
      // `null` is a point the place does not have, and it numbers as 0 — which would
      // put every untraced place in the Gulf of Guinea and refuse every shape drawn.
      const lat = row.lat == null ? NaN : Number(row.lat);
      const lon = row.lon == null ? NaN : Number(row.lon);
      const at = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
      place = {
        id: row.id,
        caseId: ownerCaseId,
        title: row.title || 'this place',
        footprint: row.footprint || null,
        radius_m: Number(row.radius_m) > 0 ? Number(row.radius_m) : null,
        zone: Boolean(row.zone),
        at,
      };
      points = cornersOf(row.footprint);
      draw();
      return true;
    },

    /** Begin a new zone, from Save place's arrow: drawn first, named in the panel. */
    startNew() {
      const ownerCaseId = caseId();
      if (!ownerCaseId || !createZone) return false;
      stop();
      place = { id: null, caseId: ownerCaseId, title: '', footprint: null, radius_m: null, zone: true, fresh: true, at: null };
      return true;
    },

    /** A map click, while tracing. False means it was not ours. */
    addPoint(at) {
      if (!place) return false;
      if (points.length >= MAX_POINTS) {
        notify(`A footprint holds at most ${MAX_POINTS} points`, 'warn');
        return true; // ours, and deliberately swallowed
      }
      points = [...points, plain(at)];
      selected = -1;
      draw();
      return true;
    },

    /** Take back the last corner. True when there was one. */
    undo() {
      if (!points.length) return false;
      points = points.slice(0, -1);
      selected = -1;
      draw();
      return true;
    },

    /** Remove the corner picked, as Delete does. True when one was picked. */
    removeSelected() {
      if (selected < 0 || selected >= points.length) return false;
      points = points.filter((_, index) => index !== selected);
      selected = -1;
      draw();
      return true;
    },

    async save() {
      const shape = polygonOf(points);
      const target = place;
      if (!shape || !target || saving) return;
      if (!covers()) {
        notify('The shape has to contain the place it belongs to', 'warn', 4000);
        return;
      }
      if (target.fresh && !title.trim()) {
        notify('Name the zone first', 'warn', 3000);
        return;
      }
      const run = ++operation;
      saving = true;
      try {
        if (target.fresh) {
          await createZone({ title: title.trim(), at: insidePoint(points), footprint: shape });
        } else {
          await keepPin(target);
          // attrs merge server-side, so this writes the footprint and leaves
          // everything else the place holds exactly where it was — except the
          // radius, which the shape replaces: the map draws one of the two, and a
          // circle that survived a tracing it can no longer be seen behind is a
          // precision nobody can read.
          await api.patch(`/api/cases/${target.caseId}/entities/${target.id}`, {
            attrs: { footprint: shape, radius_m: null },
          });
        }
        if (run !== operation || place !== target) return;
        await onSaved?.(target.caseId);
        if (run !== operation || place !== target) return;
        notify(target.fresh ? 'Zone saved' : 'Footprint saved', 'ok', 2000);
        stop();
      } catch (e) {
        if (run === operation && place === target) {
          notify(`Could not save the ${target.fresh ? 'zone' : 'footprint'}: ${e.message}`, 'danger', 6000);
        }
      } finally {
        if (run === operation) saving = false;
      }
    },

    cancel: stop,
    destroy() {
      layer?.destroy();
      layer = null;
    },
  };
}
