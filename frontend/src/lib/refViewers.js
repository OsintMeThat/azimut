/**
 * Reference viewers for the Satellite tab — small floating windows that hold a
 * media image (the shot you're trying to geolocate) over the map, so you can
 * eyeball it against the imagery while you pan. Pure, framework-free helpers for
 * the fiddly bits: window placement/clamping, z-ordering, cursor-anchored image
 * zoom/pan, the fade, where a window is placed (a column beside the map or a
 * corner over it) and the facts it can unfold. The Svelte glue (pointer events,
 * DOM) lives in RefViewer.svelte.
 *
 * These viewers are session-only scratch aids: never captured, never saved.
 */

export const MIN_SCALE = 1; // 1 = image fits the window; can't zoom out past fit
export const MAX_SCALE = 8;
export const DEFAULT_W = 320;
export const DEFAULT_H = 260;
export const MIN_W = 200;
export const MIN_H = 150;
/** Faded further than this, the picture is gone and the window looks empty. */
export const MIN_OPACITY = 0.15;
/** Where the fade button goes the first time, before a value has been picked. */
export const FADE_TO = 0.5;
/** A docked column: as wide as this to start, never narrower than its floor. */
export const DOCK_W = 340;
export const DOCK_MIN_W = 220;
/** A window dragged this close to an edge of the map settles against it, at the
 *  margin; two edges at once are a corner, and it stays pinned there. */
export const SNAP_REACH = 16;
export const SNAP_MARGIN = 8;
/** The speeds the slow-motion button walks through, back to normal at the end. */
export const SLOW_RATES = [1, 0.5, 0.25, 0.1];

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * A fresh viewer for `media` ({ path, title }). `spawn` seeds the initial
 * position/size/z so the caller can stagger new windows and stack them on top,
 * and where it opens: docked in a column (`'left'`, `'right'`) or pinned to a
 * corner over the map (`'tl'`, `'tr'`, `'bl'`, `'br'`). It is one or the other.
 *
 * `still` is a frame kept from a clip: the picture itself, held in the session
 * rather than in the case, so the window shows it instead of reading `path`.
 */
export function createViewer(id, media, spawn = {}) {
  return {
    id,
    path: media.path,
    kind: media.kind === 'video' ? 'video' : 'image',
    title: media.title || media.filename || '',
    x: spawn.x ?? 60,
    y: spawn.y ?? 60,
    w: spawn.w ?? DEFAULT_W,
    h: spawn.h ?? DEFAULT_H,
    z: spawn.z ?? 1,
    collapsed: false,
    scale: 1, // image zoom (1 = fit)
    ox: 0, // image pan offset in content px
    oy: 0,
    opacity: 1,
    fadeTo: FADE_TO, // the see-through value the fade button flips back to
    docked: spawn.docked ?? false, // a column beside the map, which narrows for it
    corner: spawn.corner ?? false, // pinned there, over the map, as the map changes size
    aspect: null, // the picture's width over its height, once it has loaded
    info: false, // the facts strip under the title, folded to start
    facts: mediaFacts(media),
    still: media.still ?? null,
    fps: null, // a clip's frame rate, once the app has read it
    rate: 1,
    muted: false,
    at: 0, // where a clip was, so a window drawn again picks up there
    playing: false,
  };
}

/** One more than the top-most viewer's z — the z to give a newly focused window. */
export function nextZ(viewers) {
  return viewers.reduce((m, v) => Math.max(m, v.z), 0) + 1;
}

/**
 * Re-number z so `id` sits on top, keeping the values small and gap-free
 * (1..n) instead of letting them climb without bound. Returns a Map of
 * viewer id → new z for the caller to apply.
 */
export function restack(viewers, id) {
  const others = viewers.filter((v) => v.id !== id).sort((a, b) => a.z - b.z);
  const z = new Map();
  others.forEach((v, i) => z.set(v.id, i + 1));
  z.set(id, others.length + 1);
  return z;
}

/** Keep a window of size `w`×`h` fully inside `bounds` ({ w, h }). */
export function clampWindow(x, y, w, h, bounds) {
  return {
    x: clamp(x, 0, Math.max(0, bounds.w - w)),
    y: clamp(y, 0, Math.max(0, bounds.h - h)),
  };
}

/**
 * A drag that keeps the window inside `bounds` and settles it against an edge it
 * comes within `SNAP_REACH` of, `SNAP_MARGIN` in; near two edges, in that corner.
 */
export function snapWindow(x, y, w, h, bounds) {
  const c = clampWindow(x, y, w, h, bounds);
  const settle = (at, size, span) => {
    if (span - size < 2 * SNAP_MARGIN) return at; // no room for a margin either side
    if (at < SNAP_REACH) return SNAP_MARGIN;
    if (span - (at + size) < SNAP_REACH) return span - size - SNAP_MARGIN;
    return at;
  };
  return { x: settle(c.x, w, bounds.w), y: settle(c.y, h, bounds.h) };
}

/** The corner a window settled into, against two edges at once, or null. */
export function settledCorner(x, y, w, h, bounds) {
  const side = (at, size, span) =>
    at === SNAP_MARGIN ? 'start' : at === span - size - SNAP_MARGIN ? 'end' : null;
  const across = side(x, w, bounds.w);
  const down = side(y, h, bounds.h);
  if (!across || !down) return null;
  return `${down === 'start' ? 't' : 'b'}${across === 'start' ? 'l' : 'r'}`;
}

/**
 * The six places a window can be put, in the order the header offers them:
 * a column on either side, then the four corners.
 */
export const PLACES = [
  { id: 'left', docked: 'left', icon: 'panelLeft', label: 'Column on the left' },
  { id: 'right', docked: 'right', icon: 'panelRight', label: 'Column on the right' },
  { id: 'tl', corner: 'tl', icon: 'cornerTL', label: 'Top left corner' },
  { id: 'tr', corner: 'tr', icon: 'cornerTR', label: 'Top right corner' },
  { id: 'bl', corner: 'bl', icon: 'cornerBL', label: 'Bottom left corner' },
  { id: 'br', corner: 'br', icon: 'cornerBR', label: 'Bottom right corner' },
];

/** Where a window is now, as one of `PLACES`, or null while it floats free. */
export function placeOf(viewer) {
  return PLACES.find((place) => place.id === (viewer.docked || viewer.corner)) ?? null;
}

/**
 * Where a window pinned to `corner` sits: as near that corner as it can get
 * without covering any of `obstacles` (the map's own controls, `{ x, y, w, h }`
 * in the map's pixels), `SNAP_MARGIN` clear of them and of the edges. Each place
 * tried lines the window up past one control on each axis, and the nearest one
 * that covers none wins. A window too big to fit anywhere goes in the corner.
 */
export function cornerSpot(corner, w, h, bounds, obstacles = []) {
  const right = corner.endsWith('r');
  const bottom = corner.startsWith('b');
  const m = SNAP_MARGIN;
  const fromX = [m, ...obstacles.map((o) => (right ? bounds.w - o.x : o.x + o.w) + m)];
  const fromY = [m, ...obstacles.map((o) => (bottom ? bounds.h - o.y : o.y + o.h) + m)];
  const at = (dx, dy) => ({ x: right ? bounds.w - dx - w : dx, y: bottom ? bounds.h - dy - h : dy });
  const clear = ({ x, y }) =>
    x >= 0 &&
    y >= 0 &&
    x + w <= bounds.w &&
    y + h <= bounds.h &&
    obstacles.every((o) => x >= o.x + o.w + m || x + w <= o.x - m || y >= o.y + o.h + m || y + h <= o.y - m);
  let best = null;
  for (const dx of fromX) {
    for (const dy of fromY) {
      const spot = at(dx, dy);
      if (clear(spot) && (!best || dx + dy < best.cost)) best = { ...spot, cost: dx + dy };
    }
  }
  if (best) return { x: best.x, y: best.y };
  const fallback = at(m, m);
  return {
    x: Math.max(0, Math.min(fallback.x, bounds.w - w)),
    y: Math.max(0, Math.min(fallback.y, bounds.h - h)),
  };
}

/** Clamp a resize to the min size and to what fits between (x,y) and `bounds`. */
export function clampSize(w, h, x, y, bounds) {
  return {
    w: clamp(w, MIN_W, Math.max(MIN_W, bounds.w - x)),
    h: clamp(h, MIN_H, Math.max(MIN_H, bounds.h - y)),
  };
}

/**
 * Keep the scaled image covering its `w`×`h` viewport — no gap can open at an
 * edge. At scale 1 this pins the offset to 0; deeper in it allows panning up to
 * the amount the image overflows.
 */
export function clampPan(ox, oy, scale, w, h) {
  return {
    ox: clamp(ox, Math.min(0, w - scale * w), 0),
    oy: clamp(oy, Math.min(0, h - scale * h), 0),
  };
}

/**
 * Zoom `view` by `factor` about `cursor` (content-px, relative to the viewport
 * top-left), keeping the image point under the cursor fixed. `size` is the
 * viewport ({ w, h }). Returns the new { scale, ox, oy }, pan re-clamped.
 */
export function zoomAt(view, factor, cursor, size) {
  const scale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
  const f = scale / view.scale; // actual ratio after clamping
  const ox = cursor.x - f * (cursor.x - view.ox);
  const oy = cursor.y - f * (cursor.y - view.oy);
  return { scale, ...clampPan(ox, oy, scale, size.w, size.h) };
}

/** The dock as wide as asked, never under its floor nor past half of `total`. */
export function clampDock(w, total) {
  return Math.round(clamp(w, DOCK_MIN_W, Math.max(DOCK_MIN_W, total / 2)));
}

/** An opacity the slider can hold: between the floor and solid, in 5% steps. */
export function clampOpacity(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return 1;
  return clamp(Math.round(v * 20) / 20, MIN_OPACITY, 1);
}

/**
 * The fade button: solid goes to the last see-through value, and see-through
 * goes solid, remembering where it was. One press compares the picture against
 * the map and back again.
 */
export function flipFade({ opacity, fadeTo }) {
  if (opacity < 1) return { opacity: 1, fadeTo: opacity };
  return { opacity: clampOpacity(fadeTo ?? FADE_TO), fadeTo: fadeTo ?? FADE_TO };
}

/** The next speed down, and normal speed again after the slowest. */
export function nextSlowRate(rate) {
  return SLOW_RATES[(SLOW_RATES.indexOf(rate) + 1) % SLOW_RATES.length];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A date as the file states it, read and never moved to another clock: a camera
 * writes its own wall time with no zone, and converting it would invent one.
 * yt-dlp's compact `20260312` reads as the day it is.
 */
export function factDate(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  const value = raw.trim();
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  const m = compact
    ? [value, compact[1], compact[2], compact[3]]
    : value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?/);
  const month = m ? MONTHS[Number(m[2]) - 1] : null;
  if (!month) return value;
  const day = `${Number(m[3])} ${month} ${m[1]}`;
  if (!m[4]) return day;
  const zone = m[6] === 'Z' ? ' UTC' : m[6] ? ` UTC${m[6]}` : '';
  return `${day}, ${m[4]}:${m[5]}${zone}`;
}

/** A web address worth a link: http or https, and nothing a click could run. */
function webUrl(raw) {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * What a window can unfold under its title: when the picture was captured and
 * published, where it came from, and the analyst's notes. Read once from the
 * media item it opened on, so a kept frame carries its clip's.
 */
export function mediaFacts(item = {}) {
  const source = item.source && typeof item.source === 'object' ? item.source : {};
  const url = webUrl(source.webpage_url || source.url);
  const host = url?.hostname.replace(/^www\./, '') ?? '';
  const uploader = typeof source.uploader === 'string' ? source.uploader.trim() : '';
  return {
    captured: factDate(item.taken_at || source.captured_at),
    published: factDate(source.upload_date),
    source: url ? { url: url.href, label: uploader ? `${host} · ${uploader}` : host } : null,
    notes: typeof item.notes === 'string' ? item.notes.trim() : '',
  };
}

/** Whether there is anything to unfold at all; a window with none shows no button. */
export function hasFacts(facts) {
  return Boolean(facts && (facts.captured || facts.published || facts.source || facts.notes));
}
