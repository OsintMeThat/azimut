/**
 * The Measure tool: lines and areas clicked on the map, and what they read.
 *
 * One tool, no modes. A click starts a measure and each click after it adds a
 * point; a double click, a click on the last point or Enter finishes it, and a
 * click on its first point closes it into an area. A finished measure stays on
 * the map with its words written beside it, and the next click starts another,
 * so two bearings can be drawn and read where they cross. The rules are each a
 * thing an analyst reached for rather than a thing the geometry needed:
 *
 * - **A double click is two clicks on the same point.** The second one lands
 *   on the last point, which is what finishes a line, so a double click needs
 *   no event of its own and works the same on the flat map and the globe.
 * - **Backspace takes the last point back** while a measure is drawn; Escape
 *   finishes it rather than throwing five clicks away.
 * - **A finished measure is moved by its corners.** Drag one, drag the dot
 *   halfway along a leg to bend it there, right-click a corner to take it out.
 * - **A click lands on what is already there.** Within a few pixels of a
 *   place, a pin or another measure's corner, the point is put on it, unless
 *   Alt is held.
 * - **A line of two points can be used as something**: rings round A, a cone
 *   from A toward B, a shadow from a foot at A to its tip at B, the ground in
 *   sight from A out to B (`lib/measures.js`).
 * - **The ground is read on a press.** A line's heights and what its eye sees
 *   come from the terrain server, so they are read when the analyst turns the
 *   Ground switch on, or when the 3D view, which reads the relief anyway, is
 *   up. A viewshed or a shadow is asked for by choosing it.
 *
 * The arithmetic is `lib/measure.js` and `lib/measures.js`; this holds what
 * has been clicked, what is selected, what the servers answered, and the
 * layers they are drawn on.
 *
 * @param {object} deps
 * @param {() => object|null} deps.engine the map, once it is up
 * @param {object} deps.api the app's fetch wrapper
 * @param {() => string} deps.units the analyst's own units (Settings)
 * @param {(lat: number, lon: number) => string} deps.coords a point as the analyst's coordinates read
 * @param {() => boolean} [deps.relief] whether the 3D view, which reads the ground anyway, is up
 * @param {() => {lat: number, lon: number, label?: string}[]} [deps.snapTargets] what a click lands on
 * @param {() => string|null} [deps.pictureDate] the day the imagery on screen was taken, `YYYY-MM-DD`
 * @param {(text: string) => void} [deps.copy] a crossing's coordinates, to the clipboard
 * @param {(engine: object) => object} [deps.surface] the drawing layer factory
 */
import { cornerHandles, ghostHandles } from '../../../lib/map/handles.js';
import { createSurface } from '../../../lib/map/surface.js';
import { destination, formatBearing, formatDistance, formatHeight, haversine } from '../../../lib/measure.js';
import {
  crossings,
  headline,
  isPair,
  labels,
  MAX_RINGS,
  newMeasure,
  pairReading,
  shadowSentence,
  sightRuns,
  summary,
  useShapes,
  viewshedGeometry,
} from '../../../lib/measures.js';

const AMBER = '#f5a623';
const SEEN = '#66b578';
const HIDDEN = '#d97070';
const LINE = { stroke: AMBER, strokeWidth: 2.5, strokeOpacity: 0.95 };
const QUIET = { stroke: AMBER, strokeWidth: 2, strokeOpacity: 0.7 };
const CASING = { stroke: '#000', strokeWidth: 6, strokeOpacity: 0.35, interactive: false };
const DOT = { radius: 4, stroke: '#fff', strokeWidth: 2, fill: AMBER, fillOpacity: 1, interactive: false };
const READ_AT = { radius: 6, stroke: '#4cc3ff', strokeWidth: 2.5, fill: '#111', fillOpacity: 1, interactive: false };
const BLOCKED = { radius: 6, stroke: '#fff', strokeWidth: 2, fill: HIDDEN, fillOpacity: 1, interactive: false };
// what a line is used as, in a bright cyan on a dark casing: apart from the amber line, and read on any ground
const SKY = '#2de0ff';
const RING = { stroke: SKY, strokeWidth: 2.5, strokeOpacity: 1, interactive: false };
const CONE = { stroke: SKY, strokeWidth: 2.5, strokeOpacity: 1, fill: SKY, fillOpacity: 0.18, interactive: false };
const USE_CASING = { stroke: '#000', strokeWidth: 5.5, strokeOpacity: 0.5, interactive: false };
// a fill alone: a surface strokes what names no stroke of its own
const BARE = { strokeWidth: 0, strokeOpacity: 0 };
const VIEWSHED = { ...BARE, fill: SKY, fillOpacity: 0.3, interactive: false };
const GONE = { stroke: AMBER, strokeWidth: 1, strokeOpacity: 0, fillOpacity: 0, interactive: false };

/** How finely a line's ground is read: enough for a ridge, little enough to answer fast. */
export const PROFILE_SAMPLES = 400;
/** A person's eyes, and a target on the ground, until the analyst says otherwise. */
export const EYE_HEIGHT = 1.7;
export const TARGET_HEIGHT = 0;
/** How far a viewshed reaches at most (api/terrain.py MAX_VIEWSHED_RADIUS). */
export const VIEWSHED_REACH = 30_000;
/** How near a click must land, in pixels, to be on a point already there. */
const SNAP_PX = 12;
/** …and to be on the measure's own last point, which finishes it. */
const SAME_PX = 8;
/** ms after a corner is let go in which a map click is the drop's, not a new measure. */
const DROP_CLICK_MS = 400;

const UNITS_KEY = 'azimut:measureUnits';
const GROUND_KEY = 'azimut:measureGround';

function remembered(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // a profile that refuses storage only forgets the choice
  }
}

function remember(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* as above */
  }
}

/** A full day from the picture's date, or null for a bare year or nothing. */
export function usableDate(text) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(text ?? '')) ? text : null;
}

const plain = (point) => ({ lat: point.lat, lon: point.lon });
const closedRing = (points) => [...points, points[0]];
const escape = (text) =>
  String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function createMeasureState({
  engine,
  api,
  units: appUnits,
  coords,
  relief = () => false,
  snapTargets = () => [],
  pictureDate = () => null,
  copy = () => {},
  surface = createSurface,
}) {
  let on = $state(false);
  let measures = $state([]);
  let drawingId = $state(null);
  let selectedId = $state(null);
  let unitsChoice = $state(remembered(UNITS_KEY));
  let groundChoice = $state(remembered(GROUND_KEY) === 'on');
  let eyeHeight = $state(EYE_HEIGHT);
  let targetHeight = $state(TARGET_HEIGHT);
  // what the servers answered, by measure: { ground, shadow, viewshed }, each
  // { question, answer, busy, error }
  let answers = $state({});
  // the pointer while a measure is drawn, and what it would land on
  let pointer = $state(null);
  let snapped = $state(null);
  // the sample of the selected line's ground under the pointer, from the map or the chart
  let readIndex = $state(null);
  let nextId = 1;
  let asked = 0;
  const tickets = new Map(); // `${id}:${which}` → the last question's number
  let shapes = null;
  let words = null;
  let fills = null;
  let dragging = null; // the measure whose corner is under the hand
  let droppedAt = -Infinity; // when a corner was last let go
  // the heights chart, put away from its window or the panel until shown again
  let chartShown = $state(true);

  const units = () => unitsChoice ?? appUnits() ?? 'metric';
  const byId = (id) => measures.find((m) => m.id === id) ?? null;
  const drawing = () => byId(drawingId);
  const selected = () => byId(selectedId);
  const groundOn = () => groundChoice || relief();

  function layers() {
    const map = engine();
    if (!map) return false;
    fills ??= surface(map);
    shapes ??= surface(map);
    words ??= surface(map);
    return true;
  }

  // --- where things are on screen ---------------------------------------------

  function screen(point) {
    const at = engine()?.latLngToContainerPoint(point);
    return at && Number.isFinite(at.x) && Number.isFinite(at.y) ? at : null;
  }

  function pixelsApart(a, b) {
    const p = screen(a);
    const q = screen(b);
    return p && q ? Math.hypot(p.x - q.x, p.y - q.y) : Infinity;
  }

  // --- what a measure reads ---------------------------------------------------

  /** The measure in one line, with what its use answered once it is known. */
  function readoutOf(m) {
    const words = headline(m, units());
    const answer = answers[m.id];
    if (isPair(m) && m.use === 'shadow' && answer?.shadow?.answer) return shadowSentence(answer.shadow.answer, units());
    if (isPair(m) && m.use === 'viewshed' && answer?.viewshed?.answer) {
      return `${words} · ${Math.round(answer.viewshed.answer.share * 100)}% in sight`;
    }
    return words;
  }

  // --- drawing ----------------------------------------------------------------

  /** One measure's line or area, its sight, its use and its corners. */
  function measureShapes(m) {
    const mine = m.id === selectedId || m.id === drawingId;
    const points = m.points.map(plain);
    const out = [];
    const ground = answers[m.id]?.ground?.answer;
    const runs = isPair(m) && ground ? sightRuns(ground) : [];
    if (points.length >= 2) {
      // a measure answers a click once drawn; while one is drawn, every click is a point
      const interactive = drawingId == null;
      const style = { ...(mine ? LINE : QUIET), interactive };
      if (runs.length) style.strokeOpacity = 0.25;
      if (m.closed) {
        // only the outline is the area's: a click inside it starts a measure there
        out.push({ id: `m${m.id}-fill`, kind: 'polygon', points, style: { ...BARE, fill: AMBER, fillOpacity: mine ? 0.18 : 0.1, interactive: false } });
      }
      // a dark casing under the line keeps it read over bright ground
      out.push({ id: `m${m.id}-casing`, kind: 'line', points: m.closed ? closedRing(points) : points, style: CASING });
      out.push({
        id: `m${m.id}`,
        kind: 'line',
        points: m.closed ? closedRing(points) : points,
        style,
        onClick: interactive ? () => select(m.id) : undefined,
        tip: interactive && !mine ? readoutOf(m) : undefined,
      });
    }
    // what the eye at A sees of the line, over it
    runs.forEach((run, i) =>
      out.push({
        id: `m${m.id}-sight-${i}`,
        kind: 'line',
        points: run.points,
        style: { stroke: run.seen ? SEEN : HIDDEN, strokeWidth: mine ? 3.5 : 2.5, strokeOpacity: 0.95, interactive: false },
      })
    );
    const blocked = runs.length ? ground.sight?.blocked_at_m : null;
    if (blocked != null) {
      const at = ground.distance_m.findIndex((d) => d >= blocked);
      if (at >= 0) out.push({ id: `m${m.id}-blocked`, kind: 'dot', at: { lat: ground.lat[at], lon: ground.lon[at] }, style: BLOCKED });
    }
    for (const [i, shape] of useShapes(m).entries()) {
      out.push({ ...shape, id: `m${m.id}-use-${i}-casing`, style: USE_CASING });
      out.push({ ...shape, id: `m${m.id}-use-${i}`, style: shape.kind === 'circle' ? RING : CONE });
    }
    if (m.id === drawingId) {
      for (const point of points) out.push({ kind: 'dot', at: point, style: DOT });
    } else if (m.id === selectedId) {
      out.push(...handlesOf(m));
    }
    return out;
  }

  function handlesOf(m) {
    const points = m.points.map(plain);
    const corners = cornerHandles(points, {
      prefix: `m${m.id}-corner`,
      onMove: (index, at) => moveCorner(m.id, index, at),
      onDrop: () => dropCorner(m.id),
      ends: isPair(m),
    }).map((handle, index) => ({
      ...handle,
      title: `${handle.title}, right-click to take it out`,
      onContextMenu: () => removeCorner(m.id, index),
    }));
    const between = ghostHandles(points, {
      prefix: `m${m.id}-bend`,
      closed: m.closed,
      onInsert: (leg, at) => insertCorner(m.id, leg, at),
      onMove: (index, at) => moveCorner(m.id, index, at),
      onDrop: () => dropCorner(m.id),
    });
    return [...corners, ...between];
  }

  function draw() {
    if (!layers()) return;
    const list = measures.flatMap(measureShapes);
    const marks = crossings(measures).map((crossed, i) => ({
      id: `crossing-${i}`,
      kind: 'marker',
      at: crossed.at,
      className: 'measure-crossing',
      html: '<span></span>',
      size: [14, 14],
      title: `The lines cross at ${coords(crossed.at.lat, crossed.at.lon)}. Click to copy`,
      onClick: () => copy(coords(crossed.at.lat, crossed.at.lon)),
    }));
    const reading = readPoint();
    shapes.set([...list, ...marks, reading && { kind: 'dot', at: reading, style: READ_AT }]);
    shapes.visible(on);
    drawWords();
  }

  /**
   * The words beside each measure. A leg's is left out where the leg is too
   * short on screen to hold it; the rest always show.
   */
  function drawWords() {
    if (!layers()) return;
    const list = [];
    for (const m of measures) {
      const mine = m.id === selectedId || m.id === drawingId;
      for (const word of labels(m, units())) {
        if (word.kind === 'leg' && pixelsApart(word.from, word.to) < word.text.length * 6.5 + 24) continue;
        // a corner's angle is read on the measure in hand; on the others it is clutter
        if (word.kind === 'angle' && !mine) continue;
        list.push(wordMark(m, word));
      }
      const extra = useWord(m);
      if (extra) list.push(extra);
    }
    words.set(list);
    words.visible(on);
  }

  function wordClass(m, word) {
    return `measure-word ${word.kind}${m.id === selectedId || m.id === drawingId ? ' mine' : ''}`;
  }

  /**
   * Where a word sits off its point on screen, in pixels: a leg's beside the
   * leg, clear of the dot that bends it, a line's whole length past its end,
   * and a corner's angle outside the corner, along the line that halves it.
   */
  function wordOffset(word) {
    const unit = (p, q) => {
      const length = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      return [(q.x - p.x) / length, (q.y - p.y) / length];
    };
    if (word.kind === 'leg') {
      const [a, b] = [screen(word.from), screen(word.to)];
      if (!a || !b) return [0, -13];
      const [ux, uy] = unit(a, b);
      // the side of the leg that is up the screen, far enough for the word's width
      let [nx, ny] = [-uy, ux];
      if (ny > 0 || (ny === 0 && nx < 0)) [nx, ny] = [-nx, -ny];
      const half = (word.text.length * 6.6 + 10) / 2;
      const reach = Math.abs(nx) * (half + 6) + Math.abs(ny) * 13;
      return [nx * reach, ny * reach];
    }
    if (word.kind === 'total') {
      // past the end of the line, where it was heading
      const [a, b] = [screen(word.around[0]), screen(word.at)];
      if (!a || !b) return [0, -18];
      const [ux, uy] = unit(a, b);
      const reach = Math.abs(ux) * ((word.text.length * 6.6 + 10) / 2 + 12) + Math.abs(uy) * 18;
      return [ux * reach, uy * reach];
    }
    if (word.kind === 'angle') {
      const [v, a, b] = [screen(word.at), screen(word.around[0]), screen(word.around[1])];
      if (!v || !a || !b) return [16, -16];
      const [ax, ay] = unit(v, a);
      const [bx, by] = unit(v, b);
      let [ox, oy] = [-(ax + bx), -(ay + by)];
      const length = Math.hypot(ox, oy);
      // a straight corner has no outside: the word stands off to one side
      [ox, oy] = length < 1e-3 ? [-ay, ax] : [ox / length, oy / length];
      return [ox * 24, oy * 24];
    }
    // what a use answered stands under A, clear of its handle
    if (word.kind.startsWith('use')) return [0, 26];
    return [0, 0];
  }

  function wordHtml(word) {
    const [dx, dy] = wordOffset(word);
    const moved = dx || dy ? ` style="transform:translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px)"` : '';
    return `<span${moved}>${escape(word.text)}</span>`;
  }

  function wordMark(m, word) {
    return {
      id: `m${m.id}-${word.id}`,
      kind: 'marker',
      at: word.at,
      className: wordClass(m, word),
      html: wordHtml(word),
      keyboard: false,
    };
  }

  /** What a line's use answered, written at A: a height from a shadow, a viewshed's share. */
  function useWord(m) {
    if (!isPair(m)) return null;
    let text = '';
    if (m.use === 'shadow') {
      const first = answers[m.id]?.shadow?.answer?.moments?.[0];
      if (first) text = `≈ ${formatHeight(first.height_m, units())} tall`;
    }
    if (m.use === 'viewshed') {
      const share = answers[m.id]?.viewshed?.answer?.share;
      if (share != null) text = `${Math.round(share * 100)}% in sight`;
    }
    return text ? wordMark(m, { id: 'use', kind: m.use === 'viewshed' ? 'use reach' : 'use', at: m.points[0], text }) : null;
  }

  function drawFills() {
    if (!layers()) return;
    const list = [];
    for (const m of measures) {
      const answer = m.use === 'viewshed' && isPair(m) ? answers[m.id]?.viewshed?.answer : null;
      if (answer) list.push({ id: `m${m.id}-viewshed`, kind: 'geojson', geometry: viewshedGeometry(answer), style: VIEWSHED });
    }
    fills.set(list);
    fills.visible(on);
  }

  function readPoint() {
    const profile = answers[selectedId]?.ground?.answer;
    if (readIndex == null || !profile || readIndex >= profile.lat.length) return null;
    return { lat: profile.lat[readIndex], lon: profile.lon[readIndex] };
  }

  // --- moving what is drawn ---------------------------------------------------

  /**
   * A corner on its way: the line, its use and its words follow, and the handles
   * stay under the hand. What the old line answered fades until it is asked again.
   */
  function moveCorner(id, index, at) {
    const m = byId(id);
    if (!m) return;
    if (dragging !== id) {
      dragging = id;
      const runs = sightRuns(answers[id]?.ground?.answer).length;
      for (let i = 0; i < runs; i++) shapes?.patch(`m${id}-sight-${i}`, { style: GONE });
      shapes?.patch(`m${id}-blocked`, { style: GONE });
      fills?.patch(`m${id}-viewshed`, { style: GONE });
    }
    m.points[index] = plain(at);
    const points = m.points.map(plain);
    shapes?.patch(`m${id}`, { points: m.closed ? closedRing(points) : points });
    shapes?.patch(`m${id}-casing`, { points: m.closed ? closedRing(points) : points });
    if (m.closed) shapes?.patch(`m${id}-fill`, { points });
    for (const [i, shape] of useShapes(m).entries()) {
      const moved = shape.kind === 'circle' ? { at: shape.at, radiusM: shape.radiusM } : { points: shape.points };
      shapes?.patch(`m${id}-use-${i}-casing`, moved);
      shapes?.patch(`m${id}-use-${i}`, moved);
    }
    for (const word of labels(m, units())) {
      words?.patch(`m${id}-${word.id}`, { at: word.at, icon: { html: wordHtml(word), className: wordClass(m, word) } });
    }
  }

  function dropCorner(id) {
    dragging = null;
    droppedAt = Date.now();
    forget(id);
    draw();
    drawFills();
    ask(id);
  }

  /** A point put halfway along a leg, as the dot there is taken. Returns its index. */
  function insertCorner(id, leg, at) {
    const m = byId(id);
    if (!m) return -1;
    m.points.splice(leg + 1, 0, plain(at));
    return leg + 1;
  }

  function removeCorner(id, index) {
    const m = byId(id);
    if (!m || m.points.length <= (m.closed ? 3 : 2)) return false;
    m.points.splice(index, 1);
    forget(id);
    draw();
    drawFills();
    ask(id);
    return true;
  }

  // --- what the servers answer ------------------------------------------------

  /** What the measure's old shape was answered: none of it is this shape's. */
  function forget(id) {
    const kept = answers[id];
    if (!kept) return;
    tickets.delete(`${id}:ground`);
    tickets.delete(`${id}:viewshed`);
    tickets.delete(`${id}:shadow`);
    answers[id] = {};
  }

  function slot(id, which, value) {
    answers[id] = { ...(answers[id] ?? {}), [which]: value };
  }

  /** Everything the measure's own answers need, asked again. */
  function ask(id) {
    const m = byId(id);
    if (!m || m.id === drawingId || m.points.length < 2) return;
    if (groundOn() && !m.closed && m.id === selectedId) readGround(m);
    if (isPair(m) && m.use === 'viewshed') readViewshed(m);
    if (isPair(m) && m.use === 'shadow') readShadow(m);
  }

  async function fetchInto(m, which, question, call) {
    const key = `${m.id}:${which}`;
    const mine = ++asked;
    tickets.set(key, mine);
    slot(m.id, which, { question, answer: null, busy: true, error: '' });
    let outcome;
    try {
      outcome = { question, answer: await call(), busy: false, error: '' };
    } catch (failure) {
      outcome = { question, answer: null, busy: false, error: failure.message };
    }
    // a newer question, an edit or a deleted measure: this answer is nobody's
    if (tickets.get(key) !== mine || !byId(m.id)) return;
    slot(m.id, which, outcome);
    draw();
    if (which === 'viewshed') drawFills();
  }

  function readGround(m) {
    const points = m.points.map((p) => [p.lat, p.lon]);
    const question = { points, eye: eyeHeight, target: targetHeight };
    const known = answers[m.id]?.ground;
    if (known && (known.answer || known.busy) && JSON.stringify(known.question) === JSON.stringify(question)) return;
    readIndex = null;
    return fetchInto(m, 'ground', question, () =>
      api.post('/api/terrain/profile', {
        points,
        samples: PROFILE_SAMPLES,
        sight: isPair(m),
        eye_height: eyeHeight,
        target_height: targetHeight,
      })
    );
  }

  function readViewshed(m) {
    const [a] = m.points;
    const radius = Math.min(pairReading(m).length, VIEWSHED_REACH);
    return fetchInto(m, 'viewshed', { radius }, () =>
      api.post('/api/terrain/viewshed', {
        lat: a.lat,
        lon: a.lon,
        radius_m: radius,
        eye_height: eyeHeight,
        target_height: targetHeight,
      })
    );
  }

  function readShadow(m) {
    const date = m.shadowDate ?? usableDate(pictureDate());
    if (!date) {
      slot(m.id, 'shadow', { question: null, answer: null, busy: false, error: '' });
      return;
    }
    const [a] = m.points;
    const { length, bearing } = pairReading(m);
    const query = new URLSearchParams({
      lat: a.lat.toFixed(6),
      lon: a.lon.toFixed(6),
      date,
      bearing: bearing.toFixed(2),
      length: Math.max(0.01, length).toFixed(2),
    });
    return fetchInto(m, 'shadow', { date }, () => api.get(`/api/geo/shadow?${query}`));
  }

  // --- the store --------------------------------------------------------------

  function select(id) {
    selectedId = id;
    readIndex = null;
    draw();
    ask(id);
  }

  function remove(id) {
    measures = measures.filter((m) => m.id !== id);
    delete answers[id];
    if (drawingId === id) drawingId = null;
    if (selectedId === id) selectedId = null;
    draw();
    drawFills();
  }

  function finish() {
    const m = drawing();
    if (!m) return false;
    drawingId = null;
    pointer = null;
    snapped = null;
    if (m.points.length < 2) remove(m.id);
    else select(m.id);
    return true;
  }

  /** One measure changed by the panel: drawn again and asked again. */
  function change(id, edit) {
    const m = byId(id);
    if (!m) return;
    edit(m);
    forget(id);
    draw();
    drawFills();
    ask(id);
  }

  function snap(at, { free = false } = {}) {
    if (!at) return { point: null, target: null };
    if (free) return { point: plain(at), target: null };
    const here = screen(at);
    if (!here) return { point: plain(at), target: null };
    const candidates = [
      ...snapTargets(),
      ...measures
        .filter((m) => m.id !== drawingId)
        .flatMap((m) => m.points.map((p) => ({ ...plain(p), label: `Measure ${m.id}` }))),
    ];
    let best = null;
    let bestPx = SNAP_PX;
    for (const target of candidates) {
      const there = screen(target);
      if (!there) continue;
      const px = Math.hypot(there.x - here.x, there.y - here.y);
      if (px <= bestPx) {
        best = target;
        bestPx = px;
      }
    }
    return best ? { point: plain(best), target: best } : { point: plain(at), target: null };
  }

  function showReading(index) {
    if (index === readIndex) return;
    readIndex = index;
    draw();
  }

  return {
    get on() {
      return on;
    },
    get measures() {
      return measures;
    },
    get drawingId() {
      return drawingId;
    },
    get selectedId() {
      return selectedId;
    },
    get selected() {
      return selected();
    },
    get drawing() {
      return drawingId != null;
    },
    get units() {
      return units();
    },
    /** The units the tool was set to itself, or null when it follows Settings. */
    get unitsChoice() {
      return unitsChoice;
    },
    get groundOn() {
      return groundOn();
    },
    /** The ground is read because the 3D view is up, whatever the switch says. */
    get groundForced() {
      return relief();
    },
    get eyeHeight() {
      return eyeHeight;
    },
    get targetHeight() {
      return targetHeight;
    },
    get answers() {
      return answers;
    },
    get pointer() {
      return pointer;
    },
    get snapped() {
      return snapped;
    },
    get readIndex() {
      return readIndex;
    },

    /** Whether the heights chart of the line in hand is shown, when its ground is read. */
    get chartShown() {
      return chartShown;
    },

    showChart(next) {
      chartShown = Boolean(next);
    },

    /** The selected line's ground and what its eye sees, once asked. */
    get ground() {
      return answers[selectedId]?.ground ?? null;
    },

    /** What one measure reads, with what its use answered. */
    readingOf(id) {
      const m = byId(id);
      return m ? readoutOf(m) : '';
    },

    /** What the measure being drawn reads, else the one selected. */
    get readout() {
      const m = drawing() ?? selected();
      return m ? readoutOf(m) : '';
    },

    /** What to do next, while nothing is read. */
    get hint() {
      if (!on) return '';
      const m = drawing();
      if (!m) return measures.length ? 'Click to start another measure' : 'Click to start a measure';
      if (m.points.length === 1) return 'Click the next point';
      return m.points.length >= 3
        ? 'Double-click to finish, or click the first point for an area'
        : 'Double-click or Enter to finish';
    },

    /**
     * The stretch from the last point to the pointer while a measure is drawn,
     * and what it would add. The overlay draws it, so following the pointer
     * repaints no ground.
     */
    get live() {
      const m = drawing();
      if (!m || !pointer) return null;
      const from = plain(m.points.at(-1));
      const to = snapped ? plain(snapped) : pointer;
      const closing = m.points.length >= 3 && pixelsApart(m.points[0], to) <= SNAP_PX;
      const add = haversine(from, to);
      let total = add;
      for (let i = 1; i < m.points.length; i++) total += haversine(m.points[i - 1], m.points[i]);
      const leg = `${formatDistance(add, units())} · ${formatBearing(pairReading({ points: [from, to] }).bearing)}`;
      const text = closing
        ? 'Click to close the area'
        : m.points.length >= 2
          ? `${leg} · total ${formatDistance(total, units())}`
          : leg;
      return { from, to, first: plain(m.points[0]), closing, text, label: snapped?.label ?? '' };
    },

    open() {
      on = true;
      engine()?.readClicks?.(true);
      draw();
      drawFills();
    },

    close() {
      if (drawingId != null) finish();
      on = false;
      pointer = null;
      snapped = null;
      readIndex = null;
      engine()?.readClicks?.(false);
      shapes?.visible(false);
      words?.visible(false);
      fills?.visible(false);
    },

    /**
     * A map click while the tool is open, already put on what it lands on
     * (`snap`). False when it was not ours.
     */
    addPoint(at) {
      if (!on) return false;
      const point = plain(at);
      const m = drawing();
      // the click a drop can bring, once the handle under it is drawn again, starts nothing
      if (!m && Date.now() - droppedAt < DROP_CLICK_MS) return true;
      if (!m) {
        const fresh = newMeasure(nextId++, point);
        measures = [...measures, fresh];
        drawingId = fresh.id;
        selectedId = fresh.id;
        readIndex = null;
        draw();
        return true;
      }
      // the first point closes an area; the last one, clicked again, finishes
      if (m.points.length >= 3 && pixelsApart(m.points[0], point) <= SNAP_PX) {
        m.closed = true;
        return finish();
      }
      if (pixelsApart(m.points.at(-1), point) <= SAME_PX) {
        if (m.points.length >= 2) return finish();
        return true; // the second click of a double click on a lone point
      }
      m.points.push(point);
      draw();
      return true;
    },

    /** Enter: the measure being drawn is done. False when there is none. */
    finish,

    /** Escape: finish what is drawn, else let go of the selection. False when there was neither. */
    escape() {
      if (drawingId != null) return finish();
      if (selectedId == null) return false;
      selectedId = null;
      readIndex = null;
      draw();
      return true;
    },

    /** Backspace while drawing: the last point taken back. */
    undo() {
      const m = drawing();
      if (!m) return false;
      m.points.pop();
      if (!m.points.length) remove(m.id);
      else draw();
      return true;
    },

    /** Delete: the selected measure taken off the map. */
    removeSelected() {
      if (drawingId != null || selectedId == null) return false;
      remove(selectedId);
      return true;
    },

    remove,
    select,

    clearAll() {
      measures = [];
      answers = {};
      tickets.clear();
      drawingId = null;
      selectedId = null;
      readIndex = null;
      draw();
      drawFills();
    },

    /**
     * Where a click or the pointer lands: on a place, a pin or another
     * measure's corner within a few pixels, unless `free` (Alt held).
     */
    snap,

    /**
     * The pointer over the map: while drawing, the next stretch follows it;
     * over the selected line's ground, the chart reads the sample under it.
     */
    follow(at, { free = false } = {}) {
      if (!on) return;
      if (drawingId != null) {
        const { point, target } = snap(at, { free });
        pointer = at ? plain(at) : null;
        snapped = target ? { ...point, label: target.label ?? '' } : null;
        return;
      }
      const profile = answers[selectedId]?.ground?.answer;
      if (!profile || !at || dragging != null) return;
      const k = Math.cos((at.lat * Math.PI) / 180);
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < profile.lat.length; i++) {
        const d = (profile.lat[i] - at.lat) ** 2 + ((profile.lon[i] - at.lon) * k) ** 2;
        if (d < bestD) {
          best = i;
          bestD = d;
        }
      }
      const near = pixelsApart({ lat: profile.lat[best], lon: profile.lon[best] }, at) <= SNAP_PX;
      showReading(near ? best : null);
    },

    /** The sample the chart reads, marked on the line too, or none. */
    showReading,

    /** The 3D view came up: the line in hand reads its ground, as the switch would have it. */
    readAgain() {
      if (on && selectedId != null) ask(selectedId);
    },

    /** The map moved: the words that fit on screen are placed again. */
    viewChanged() {
      if (on && dragging == null) drawWords();
    },

    // --- what a measure is and reads ------------------------------------------

    setUnits(choice) {
      unitsChoice = choice || null;
      remember(UNITS_KEY, unitsChoice);
      draw();
    },

    setGround(next) {
      groundChoice = Boolean(next);
      // turned on, the ground shows its chart again
      if (groundChoice) chartShown = true;
      remember(GROUND_KEY, groundChoice ? 'on' : null);
      if (selectedId != null) ask(selectedId);
      draw();
    },

    /** The eye's and the target's heights above the ground; a change asks again. */
    setHeights({ eye = eyeHeight, target = targetHeight }) {
      const next = [Math.max(0, Number(eye) || 0), Math.max(0, Number(target) || 0)];
      if (next[0] === eyeHeight && next[1] === targetHeight) return;
      [eyeHeight, targetHeight] = next;
      for (const m of measures) {
        if (m.id !== selectedId && m.use !== 'viewshed') continue;
        if (answers[m.id]) answers[m.id] = { ...answers[m.id], ground: null, viewshed: null };
        ask(m.id);
      }
    },

    /** Look from B toward A instead: the line turned round. */
    swap(id) {
      change(id, (m) => m.points.reverse());
    },

    /** A line of two points given an exact length, B moved along its bearing. */
    setLength(id, metres) {
      if (!isPair(byId(id)) || !(metres > 0)) return;
      change(id, (m) => {
        m.points[1] = destination(m.points[0], pairReading(m).bearing, metres);
      });
    },

    /** …or an exact bearing, B moved round A at the same length. */
    setBearing(id, degrees) {
      if (!isPair(byId(id)) || !Number.isFinite(degrees)) return;
      change(id, (m) => {
        m.points[1] = destination(m.points[0], degrees, pairReading(m).length);
      });
    },

    /** What a line of two points is used as, or back to a plain line with the same press. */
    setUse(id, use) {
      if (!isPair(byId(id))) return;
      change(id, (m) => {
        m.use = m.use === use ? null : use;
      });
    },

    setRings(id, count) {
      change(id, (m) => {
        m.rings = Math.max(1, Math.min(MAX_RINGS, Math.round(Number(count)) || 1));
      });
    },

    setAperture(id, degrees) {
      const value = Number(degrees);
      if (!(value > 0 && value <= 360)) return;
      change(id, (m) => {
        m.aperture = value;
      });
    },

    /** The day a shadow was cast, when the picture's own date is not the one. */
    setShadowDate(id, date) {
      change(id, (m) => {
        m.shadowDate = date || null;
      });
    },

    /** The day a shadow is read on: the analyst's, else the picture's. */
    shadowDate(id) {
      const m = byId(id);
      return m?.shadowDate ?? usableDate(pictureDate());
    },

    /** An open line of three points or more closed into an area, or an area opened. */
    setClosed(id, closed) {
      const m = byId(id);
      if (!m || (closed && m.points.length < 3)) return;
      change(id, (one) => {
        one.closed = closed;
      });
    },

    /** The measure as text to paste. */
    text(id) {
      const m = byId(id);
      if (!m) return '';
      const answer = answers[m.id] ?? {};
      const ground = answer.ground?.answer;
      return summary(m, units(), {
        coords,
        ground: ground ? { corners: ground.corners, sight: isPair(m) ? ground.sight : null } : null,
        shadow: answer.shadow?.answer,
        viewshed: answer.viewshed?.answer,
      });
    },

    /**
     * The measure as a feature of a personal layer: its shape, named by what it
     * reads, with its text in the notes. Rings keep their outer circle and a
     * cone its wedge; a shadow or a viewshed keeps its line and its answer.
     */
    feature(id) {
      const m = byId(id);
      if (!m || m.points.length < 2) return null;
      const ring = (points) => closedRing(points).map((p) => [p.lon, p.lat]);
      const shape = isPair(m) ? useShapes(m).at(-1) : null;
      let geometry;
      if (m.closed) geometry = { type: 'Polygon', coordinates: [ring(m.points)] };
      else if (shape?.kind === 'circle') {
        const points = Array.from({ length: 64 }, (_, i) => destination(shape.at, (360 * i) / 64, shape.radiusM));
        geometry = { type: 'Polygon', coordinates: [ring(points)] };
      } else if (shape?.kind === 'polygon') geometry = { type: 'Polygon', coordinates: [ring(shape.points)] };
      else geometry = { type: 'LineString', coordinates: m.points.map((p) => [p.lon, p.lat]) };
      return { geometry, name: readoutOf(m), description: this.text(id) };
    },

    destroy() {
      engine()?.readClicks?.(false);
      for (const layer of [shapes, words, fills]) layer?.destroy();
      shapes = words = fills = null;
    },
  };
}
