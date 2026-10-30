/**
 * Straightening a collage along a line the analyst says is level in the world: a
 * shore, a field's far edge, a road running along the valley. A pan stitched with
 * its tilt a little off bends such a line into a smile or a slope; this lays it
 * flat again.
 *
 * The whole collage is bent as one picture: every column of its pixels moves up or
 * down by what the line is off there, so the pixels of each frame follow the line and
 * two frames meeting at a seam move alike. The server draws the collage and bends it
 * (`exportBend` says by how much). The line is a rounded curve through every click, read left to right
 * whatever order they came in, so a point added between two others bends only
 * the stretch around it. Past its ends the picture moves as the end does: a slope
 * carried on across a wide pan would tip its far side off the canvas.
 */

/** Points a level line needs before it can straighten anything. */
export const LEVEL_MIN_POINTS = 2;

/** Clicks closer than this across (canvas pixels) are one column, read at their mean height. */
const SAME_COLUMN = 0.5;

/** The line's points left to right, one per column. */
function columns(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [x, y] of sorted) {
    const last = out[out.length - 1];
    if (last && x - last.x < SAME_COLUMN) {
      last.sum += y;
      last.count += 1;
    } else out.push({ x, sum: y, count: 1 });
  }
  return out.map((c) => [c.x, c.sum / c.count]);
}

/**
 * The vertical shift that lays the line flat, as a function of the column, or null
 * when the line is too short to say (fewer than `LEVEL_MIN_POINTS` points, or all at
 * one column). The line is laid at its own mean height, so the collage stays where
 * it was on average.
 *
 * @param {[number, number][]} points the line, canvas pixels
 * @returns {{ shift: (x: number) => number, level: number, from: number, to: number } | null}
 */
export function levelShift(points) {
  if (!Array.isArray(points) || points.length < LEVEL_MIN_POINTS) return null;
  const knots = columns(points);
  const n = knots.length;
  if (n < 2) return null;
  // Catmull-Rom slopes on uneven columns: each point leans like the chord over its two neighbours
  const slopes = knots.map((_, i) => {
    const [x0, y0] = knots[Math.max(0, i - 1)];
    const [x1, y1] = knots[Math.min(n - 1, i + 1)];
    return (y1 - y0) / (x1 - x0);
  });
  const from = knots[0][0];
  const to = knots[n - 1][0];
  const curve = (x) => {
    if (x <= from) return knots[0][1];
    if (x >= to) return knots[n - 1][1];
    let i = 0;
    while (knots[i + 1][0] < x) i += 1;
    const [x0, y0] = knots[i];
    const [x1, y1] = knots[i + 1];
    const h = x1 - x0;
    const t = (x - x0) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * slopes[i]
      + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * slopes[i + 1];
  };
  const level = knots.reduce((sum, k) => sum + k[1], 0) / n;
  return { shift: (x) => level - curve(x), level, from, to };
}

/**
 * The bend an export of the collage takes (`/inspect/compose`'s `bend`): each output column's downward shift in
 * output pixels, for the export frame `frame` (lib/inspect.js `exportFrame`), and the room it needs: the pieces
 * laid `pad` pixels lower so nothing bends past the top, the picture `height` tall. Null when the line cannot say.
 *
 * @param {[number, number][]} points the line, canvas pixels
 * @param {{ minX: number, scale: number, width: number, height: number }} frame
 * @returns {{ shifts: number[], pad: number, height: number } | null}
 */
export function exportBend(points, frame) {
  const bend = levelShift(points);
  if (!bend) return null;
  const shifts = Array.from({ length: frame.width }, (_, column) => bend.shift(frame.minX + (column + 0.5) / frame.scale) * frame.scale);
  const pad = Math.ceil(Math.max(0, -Math.min(...shifts)));
  return { shifts, pad, height: frame.height + pad + Math.ceil(Math.max(0, ...shifts)) };
}
