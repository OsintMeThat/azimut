/**
 * Where the personal-layer edit bar sits on its map.
 *
 * The analyst drags it by its grip. Let go near an edge, it docks there, and on
 * the left or the right it stands upright, as a tool palette does; anywhere
 * else it stays where it was dropped. The place is kept as fractions of the map,
 * so it survives a resized window, and in this browser only: a convenience,
 * not case or app state. It never covers the map's zoom buttons or the layer's
 * panel: it steps aside, along its edge first.
 */

/** Docked under the tool's own row at the top, and centred: where it opened before it could move. */
export const DEFAULT_PLACE = Object.freeze({ edge: 'top', x: 0.5, y: 0 });
/** How far a docked bar keeps from its edge, and from the top… */
export const INSET = 12;
export const TOP_INSET = 58;
/** …and how close to an edge a drop docks there. */
export const SNAP = 36;
/** The space it leaves round what it steps aside from. */
const GAP = 8;
const KEY = 'azimut:layer-bar';
const EDGES = ['top', 'bottom', 'left', 'right'];

const clamp = (value, low, high) => Math.max(low, Math.min(value, Math.max(low, high)));
const overlaps = (box, other) => box.left < other.right && other.left < box.left + box.width
  && box.top < other.bottom && other.top < box.top + box.height;
const inside = (box, frame) => box.left >= 0 && box.top >= 0
  && box.left + box.width <= frame.width && box.top + box.height <= frame.height;

/** Whether a placement stands upright. */
export const upright = (place) => place?.edge === 'left' || place?.edge === 'right';

/**
 * The bar's box in its map for a placement: `frame` is the map's size, `size`
 * the bar's, `obstacles` boxes in the map's pixels (`left/top/right/bottom`).
 */
export function barBox(frame, size, place, obstacles = []) {
  const { width, height } = size;
  const along = (fraction, span, room) => clamp(fraction * room - span / 2, INSET, room - span - INSET);
  let left, top;
  if (place.edge === 'top') { top = TOP_INSET; left = along(place.x, width, frame.width); }
  else if (place.edge === 'bottom') { top = frame.height - height - INSET; left = along(place.x, width, frame.width); }
  else if (place.edge === 'left') { left = INSET; top = along(place.y, height, frame.height); }
  else if (place.edge === 'right') { left = frame.width - width - INSET; top = along(place.y, height, frame.height); }
  else { left = along(place.x, width, frame.width); top = along(place.y, height, frame.height); }
  return stepAside({ left, top, width, height }, frame, obstacles, place.edge);
}

/**
 * The box moved off whatever it covers, along its edge when it can stay on it.
 * A move that lands on another obstacle comes last, so a bar too wide to pass
 * the zoom buttons goes under them rather than up under the place search.
 */
export function stepAside(box, frame, obstacles, edge = null) {
  let current = box;
  for (let pass = 0; pass < obstacles.length + 1; pass += 1) {
    const hit = obstacles.find((other) => overlaps(current, other));
    if (!hit) return current;
    const moves = [{ ...current, top: hit.bottom + GAP }, { ...current, top: hit.top - GAP - current.height },
      { ...current, left: hit.right + GAP }, { ...current, left: hit.left - GAP - current.width }]
      .filter((move) => inside(move, frame) && !(move.left === current.left && move.top === current.top));
    const onEdge = moves.filter((move) => (upright({ edge }) ? move.left === current.left
      : edge ? move.top === current.top : true));
    const clear = (list) => list.filter((move) => !obstacles.some((other) => overlaps(move, other)));
    const pool = [clear(onEdge), clear(moves), onEdge, moves].find((list) => list.length) ?? [];
    if (!pool.length) return current;
    const cost = (move) => Math.hypot(move.left - box.left, move.top - box.top);
    current = pool.reduce((best, move) => (cost(move) < cost(best) ? move : best));
  }
  return current;
}

/**
 * How wide a bar docked on the top or the bottom edge can be in its row: the
 * width between what sits left of the row (the zoom buttons) and right of it
 * (the map's own controls), `row` tall. A bar placed anywhere else has the map.
 */
export function rowRoom(frame, place, obstacles, row) {
  const band = place.edge === 'top' ? [TOP_INSET, TOP_INSET + row]
    : place.edge === 'bottom' ? [frame.height - INSET - row, frame.height - INSET] : null;
  const across = band ? obstacles.filter((other) => other.top < band[1] && other.bottom > band[0]) : [];
  const left = across.filter((other) => other.left < frame.width / 2).reduce((most, other) => Math.max(most, other.right + GAP), INSET);
  const right = across.filter((other) => other.left >= frame.width / 2).reduce((least, other) => Math.min(least, other.left - GAP), frame.width - INSET);
  return Math.max(0, right - left);
}

/** The placement a bar dropped at `box` takes: the nearest edge within reach, else where it is. */
export function snapPlace(frame, box) {
  const gaps = { top: box.top - TOP_INSET, bottom: frame.height - box.top - box.height - INSET,
    left: box.left - INSET, right: frame.width - box.left - box.width - INSET };
  const edge = EDGES.filter((name) => gaps[name] < SNAP).sort((a, b) => gaps[a] - gaps[b])[0] ?? null;
  const round = (value) => Math.round(clamp(value, 0, 1) * 1000) / 1000;
  return { edge, x: round((box.left + box.width / 2) / frame.width), y: round((box.top + box.height / 2) / frame.height) };
}

/** The placement kept in this browser, or the default. */
export function loadPlace(storage = globalThis.localStorage) {
  try {
    const place = JSON.parse(storage?.getItem(KEY) ?? 'null');
    const fraction = (value) => Number.isFinite(value) && value >= 0 && value <= 1;
    if (place && (place.edge === null || EDGES.includes(place.edge)) && fraction(place.x) && fraction(place.y)) return place;
  } catch { /* private window or a hand-edited value: the default */ }
  return { ...DEFAULT_PLACE };
}

export function savePlace(place, storage = globalThis.localStorage) {
  try { storage?.setItem(KEY, JSON.stringify(place)); } catch { /* kept for this visit only */ }
}

const TIPS = 'azimut:layer-bar-tips';

/** Whether the line under the bar says what a press does: on until switched off. */
export function loadTips(storage = globalThis.localStorage) {
  try { return storage?.getItem(TIPS) !== 'off'; } catch { return true; }
}

export function saveTips(on, storage = globalThis.localStorage) {
  try { storage?.setItem(TIPS, on ? 'on' : 'off'); } catch { /* kept for this visit only */ }
}
