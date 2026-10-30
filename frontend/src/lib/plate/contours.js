/**
 * Contour lines, as a topographic map draws them: a line every so many metres of
 * height, every fifth one bolder and written with its height.
 *
 * Traced from a grid of heights (`heights.js`) by marching squares, joined into
 * lines, thinned to what shows, rounded, and handed to the map as GeoJSON.
 * Marching squares cut a line into straight steps across each cell of the
 * grid, where the ground curves: the corners are cut away a few times
 * (`smoothed`), so a line follows the slope as a surveyor draws it.
 */

/** The interval between two lines at a map's zoom, in metres: about what a printed map of that scale uses. */
const INTERVALS = [[15, 10], [14, 20], [13, 25], [12, 50], [10, 100], [9, 200], [8, 250], [7, 500], [0, 1000]];
/** At most this many levels of lines on one map, so a mountain range never turns grey. */
const MOST_LEVELS = 50;
/** Every this many lines, one is bolder and says its height. */
export const INDEX_EVERY = 5;

/** The interval for a map at `zoom` over ground from `low` to `high` metres. */
export function contourStep(zoom, low = 0, high = 0) {
  let step = INTERVALS.find(([from]) => zoom >= from)?.[1] ?? 1000;
  while ((high - low) / step > MOST_LEVELS) step *= 2;
  return step;
}

/**
 * The lines where the grid crosses `level`, each a list of grid points `[x, y]`
 * (marching squares, a saddle read from the middle of its cell), joined end to end.
 */
export function isoline({ width, height, heights }, value) {
  // a hair above the height, so no line runs exactly through a point of the grid and splits there
  const level = value + 1e-3;
  const segments = [];
  const at = (x, y) => heights[y * width + x];
  const cross = (x0, y0, a, x1, y1, b) => {
    const t = (level - a) / (b - a);
    return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
  };
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const tl = at(x, y);
      const tr = at(x + 1, y);
      const br = at(x + 1, y + 1);
      const bl = at(x, y + 1);
      const code = (tl >= level ? 8 : 0) | (tr >= level ? 4 : 0) | (br >= level ? 2 : 0) | (bl >= level ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const top = () => cross(x, y, tl, x + 1, y, tr);
      const right = () => cross(x + 1, y, tr, x + 1, y + 1, br);
      const bottom = () => cross(x, y + 1, bl, x + 1, y + 1, br);
      const left = () => cross(x, y, tl, x, y + 1, bl);
      const high = (tl + tr + br + bl) / 4 >= level;
      switch (code) {
        case 1: case 14: segments.push([left(), bottom()]); break;
        case 2: case 13: segments.push([bottom(), right()]); break;
        case 3: case 12: segments.push([left(), right()]); break;
        case 4: case 11: segments.push([top(), right()]); break;
        case 6: case 9: segments.push([top(), bottom()]); break;
        case 7: case 8: segments.push([left(), top()]); break;
        case 5: if (high) { segments.push([left(), top()]); segments.push([bottom(), right()]); } else { segments.push([left(), bottom()]); segments.push([top(), right()]); } break;
        case 10: if (high) { segments.push([top(), right()]); segments.push([left(), bottom()]); } else { segments.push([left(), top()]); segments.push([bottom(), right()]); } break;
        default: break;
      }
    }
  }
  return joined(segments);
}

/** Segments joined end to end into the fewest lines. */
export function joined(pieces) {
  const key = ([x, y]) => `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
  // a line brushing a point of the grid leaves a piece too short to have two ends
  const segments = pieces.filter(([a, b]) => key(a) !== key(b));
  const ends = new Map();
  const add = (point, index) => {
    const k = key(point);
    const list = ends.get(k);
    if (list) list.push(index); else ends.set(k, [index]);
  };
  segments.forEach(([a, b], index) => { add(a, index); add(b, index); });
  const used = new Uint8Array(segments.length);
  const next = (point, from) => (ends.get(key(point)) ?? []).find((index) => index !== from && !used[index]);
  const lines = [];
  for (let start = 0; start < segments.length; start += 1) {
    if (used[start]) continue;
    used[start] = 1;
    const line = [...segments[start]];
    for (const forward of [true, false]) {
      let last = start;
      for (;;) {
        const end = forward ? line.at(-1) : line[0];
        const found = next(end, last);
        if (found === undefined) break;
        used[found] = 1;
        const [a, b] = segments[found];
        const far = key(a) === key(end) ? b : a;
        if (forward) line.push(far); else line.unshift(far);
        last = found;
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * A line rounded by cutting its corners `rounds` times (Chaikin): each step
 * between two points keeps its quarter and three-quarter marks. A ring, whose
 * last point is its first, stays a ring; an open line keeps its two ends.
 */
export function smoothed(points, rounds = 2) {
  if (points.length < 3) return points;
  const [fx, fy] = points[0];
  const [lx, ly] = points.at(-1);
  const ring = fx === lx && fy === ly;
  let line = points;
  for (let round = 0; round < rounds; round += 1) {
    const next = ring ? [] : [line[0]];
    for (let i = 0; i < line.length - 1; i += 1) {
      const [ax, ay] = line[i];
      const [bx, by] = line[i + 1];
      next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    if (ring) next.push(next[0]);
    else next.push(line.at(-1));
    line = next;
  }
  return line;
}

/** A line thinned to the points that change its shape by more than `tolerance` (Douglas-Peucker). */
export function thinned(points, tolerance = 0.6) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const length = Math.hypot(bx - ax, by - ay);
    let far = -1;
    let most = tolerance;
    for (let index = first + 1; index < last; index += 1) {
      const [px, py] = points[index];
      // a ring comes back to where it starts: its points are measured from there
      const off = length ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length : Math.hypot(px - ax, py - ay);
      if (off > most) { most = off; far = index; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([first, far], [far, last]); }
  }
  return points.filter((_, index) => keep[index]);
}

/** Grid points between two heights written on one line, about what the flat map leaves between two (`symbol-spacing`). */
const LABEL_SPACING = 300;
/** A line shorter than this many grid points is not written on. */
const LABEL_SHORTEST = 60;

/**
 * Where a line's height is written by a map that cannot write along a line (the
 * globe): a point every `spacing` grid points of its length, the first half that
 * in, or the middle of a line too short for one.
 */
export function labelAnchors(line, spacing = LABEL_SPACING) {
  const lengths = line.slice(1).map(([x, y], index) => Math.hypot(x - line[index][0], y - line[index][1]));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total < LABEL_SHORTEST) return [];
  const anchors = [];
  let walked = 0;
  let next = Math.min(spacing / 2, total / 2);
  lengths.forEach((length, index) => {
    const [ax, ay] = line[index];
    const [bx, by] = line[index + 1];
    while (length > 0 && walked + length >= next) {
      const t = (next - walked) / length;
      anchors.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
      next += spacing;
    }
    walked += length;
  });
  return anchors;
}

/**
 * The contour lines of a grid as GeoJSON lines, `properties.ele` their height and
 * `properties.index` true every `INDEX_EVERY` lines. Lines shorter than `shortest`
 * grid points are left out: a hillock's ring says nothing at the map's scale.
 * `anchors` adds the points the bolder lines' heights are written at, for a map
 * that writes names at a point only (the globe, `labelAnchors`).
 */
export function contourLines(grid, step, { shortest = 6, tolerance = 0.6, rounds = 2, anchors = false } = {}) {
  let low = Infinity;
  let high = -Infinity;
  for (const value of grid.heights) {
    if (value < low) low = value;
    if (value > high) high = value;
  }
  const features = [];
  if (!(high > low)) return { type: 'FeatureCollection', features };
  for (let level = Math.ceil(Math.max(low, 0.5) / step) * step; level < high; level += step) {
    for (const line of isoline(grid, level)) {
      if (line.length < shortest) continue;
      // thinned to its shape first, so the rounding is not undone by the thinning after it
      const thin = smoothed(thinned(line, tolerance), rounds);
      const index = level % (step * INDEX_EVERY) === 0;
      const ground = ([x, y]) => grid.lonLat(x, y).map((value) => Math.round(value * 1e6) / 1e6);
      features.push({ type: 'Feature', properties: { ele: level, index }, geometry: { type: 'LineString', coordinates: thin.map(ground) } });
      if (anchors && index) {
        for (const at of labelAnchors(thin)) features.push({ type: 'Feature', properties: { ele: level, index }, geometry: { type: 'Point', coordinates: ground(at) } });
      }
    }
  }
  return { type: 'FeatureCollection', features };
}
