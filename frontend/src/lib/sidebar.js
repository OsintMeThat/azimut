/**
 * Case sidebar width. The sidebar's left edge is a drag handle, and the width
 * it lands on survives reloads. Pure helpers here — the pointer glue lives in
 * CaseSidebar.svelte.
 *
 * The width is clamped both ways: narrow enough and the entity tree turns into
 * ellipses, wide enough and it eats the tool canvas it exists to annotate. The
 * viewport-relative cap is what stops a wide window's setting from swallowing a
 * laptop screen when the case is reopened there.
 */

export const MIN_W = 240;
export const MAX_W = 640;
export const DEFAULT_W = 320;
const MAX_VIEWPORT_FRACTION = 0.5;

const KEY = 'azimut:sidebarW';

/** The widest the sidebar may get in a `viewportW`-wide window. */
export function maxWidth(viewportW) {
  const cap = Math.min(MAX_W, Math.round(viewportW * MAX_VIEWPORT_FRACTION));
  return Math.max(MIN_W, cap); // a tiny window still gets a usable sidebar
}

/** Snap any width — dragged, restored, or garbage — into the allowed range. */
export function clampWidth(w, viewportW = Infinity) {
  if (!Number.isFinite(w)) return DEFAULT_W;
  return Math.min(maxWidth(viewportW), Math.max(MIN_W, Math.round(w)));
}

export function loadWidth() {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === null ? DEFAULT_W : clampWidth(Number(stored));
  } catch {
    return DEFAULT_W; // localStorage unavailable (private mode) — non-fatal
  }
}

export function saveWidth(w) {
  try {
    localStorage.setItem(KEY, String(w));
  } catch {
    /* ignore */
  }
}
