/**
 * Contour lines, as a topographic map draws them: a line every so many metres of
 * height, every fifth one bolder and written with its height.
 *
 * Traced from a grid of heights (`heights.js`) by marching squares, joined into
 * lines, thinned to what shows, and handed to the map as GeoJSON.
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

/**
 * The contour lines of a grid as GeoJSON lines, `properties.ele` their height and
 * `properties.index` true every `INDEX_EVERY` lines. Lines shorter than `shortest`
 * grid points are left out: a hillock's ring says nothing at the map's scale.
 */
export function contourLines(grid, step, { shortest = 6, tolerance = 0.6 } = {}) {
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
      const thin = thinned(line, tolerance);
      features.push({ type: 'Feature', properties: { ele: level, index: level % (step * INDEX_EVERY) === 0 },
        geometry: { type: 'LineString', coordinates: thin.map(([x, y]) => grid.lonLat(x, y).map((value) => Math.round(value * 1e6) / 1e6)) } });
    }
  }
  return { type: 'FeatureCollection', features };
}
