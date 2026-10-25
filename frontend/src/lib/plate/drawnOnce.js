/**
 * Pictures a page draws the same from one frame to the next (a globe inset, a lit
 * country's shade) kept while what they are drawn from holds, so a drag elsewhere on
 * the page does not draw them again at every move. A few at a time, each let go when
 * it is replaced or pushed out, and none past a size, which is drawn each time instead.
 */

const MAX = 6;
/** Pixels a kept picture may hold. */
const MOST_PIXELS = 6_000_000;
const kept = new Map();

const release = (canvas) => { canvas.width = 0; canvas.height = 0; };

/**
 * The canvas kept under `slot` while its `key` holds, else a new one of `width` by
 * `height` drawn by `make(canvas)`, which says whether it drew; null where there is no
 * canvas to draw on.
 */
export function drawnOnce(slot, key, width, height, make) {
  const held = kept.get(slot);
  if (held && held.key === key) {
    // the last used goes to the back of the line
    kept.delete(slot);
    kept.set(slot, held);
    return held.canvas;
  }
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!canvas?.getContext) return null;
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  if (!make(canvas)) return null;
  if (held) { kept.delete(slot); release(held.canvas); }
  if (canvas.width * canvas.height > MOST_PIXELS) return canvas;
  kept.set(slot, { key, canvas });
  while (kept.size > MAX) {
    const [first, entry] = kept.entries().next().value;
    kept.delete(first);
    release(entry.canvas);
  }
  return canvas;
}

/** How many pictures are kept, for a test. */
export const keptCount = () => kept.size;
