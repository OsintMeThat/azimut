/**
 * Drag-resizable side panels. A panel's edge is a drag handle and the width it
 * lands on survives reloads; the pointer glue lives in the components.
 *
 * The width is clamped both ways: narrow enough and the content turns into
 * ellipses, wide enough and it eats the canvas it exists to annotate. The
 * viewport-relative cap is what stops a wide window's setting from swallowing a
 * laptop screen when the app is reopened there.
 */

/**
 * Build the pure width helpers for one panel.
 *
 * @param {object} opts
 * @param {string} opts.key localStorage key holding the remembered width
 * @param {number} opts.min narrowest usable width, px
 * @param {number} opts.max hard cap, px
 * @param {number} opts.def width before the user ever drags, px
 * @param {number} [opts.fraction] share of the window the panel may take
 */
export function panelWidth({ key, min, max, def, fraction = 0.5 }) {
  /** The widest the panel may get in a `viewportW`-wide window. */
  function maxWidth(viewportW) {
    const cap = Math.min(max, Math.round(viewportW * fraction));
    return Math.max(min, cap); // a tiny window still gets a usable panel
  }

  /** Snap any width — dragged, restored, or garbage — into the allowed range. */
  function clampWidth(w, viewportW = Infinity) {
    if (!Number.isFinite(w)) return def;
    return Math.min(maxWidth(viewportW), Math.max(min, Math.round(w)));
  }

  function loadWidth() {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? def : clampWidth(Number(stored));
    } catch {
      return def; // localStorage unavailable (private mode) — non-fatal
    }
  }

  function saveWidth(w) {
    try {
      localStorage.setItem(key, String(w));
    } catch {
      /* ignore */
    }
  }

  return { MIN_W: min, MAX_W: max, DEFAULT_W: def, maxWidth, clampWidth, loadWidth, saveWidth };
}
