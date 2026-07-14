/**
 * Reference viewers for the Satellite tab — small floating windows that hold a
 * media image (the shot you're trying to geolocate) over the map, so you can
 * eyeball it against the imagery while you pan. Pure, framework-free helpers for
 * the fiddly bits: window placement/clamping, z-ordering, and cursor-anchored
 * image zoom/pan. The Svelte glue (pointer events, DOM) lives in RefViewer.svelte.
 *
 * These viewers are session-only scratch aids: never captured, never saved.
 */

export const MIN_SCALE = 1; // 1 = image fits the window; can't zoom out past fit
export const MAX_SCALE = 8;
export const DEFAULT_W = 320;
export const DEFAULT_H = 260;
export const MIN_W = 200;
export const MIN_H = 150;

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * A fresh viewer for `media` ({ path, title }). `spawn` seeds the initial
 * position/size/z so the caller can stagger new windows and stack them on top.
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
