/**
 * The crests of the ground, traced as lines for a map drawn in 3D.
 *
 * A ridge is where the ground's two slopes meet at the top, the way a valley is
 * where they meet at the bottom. So the crests are found as a river network is,
 * on the ground turned upside down: each point sends what it holds the way up, and
 * where enough of the ground gathers, that is a crest.
 *
 * Real ground is full of small tops that would stop the way up short. So the way is
 * found from the grid's edges inward, the highest ground first (a priority flood):
 * every point is reached from the highest neighbour that reaches the edge, and a
 * small top is crossed on to the crest it belongs to, over its highest pass.
 */
import { thinned } from './contours.js';

const NEIGHBOURS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

/** A queue of grid points, the highest first, on typed arrays. */
function highestFirst(count) {
  const keys = new Float64Array(count);
  const items = new Int32Array(count);
  let size = 0;
  return {
    get size() { return size; },
    push(item, key) {
      let at = size++;
      while (at > 0) {
        const up = (at - 1) >> 1;
        if (keys[up] >= key) break;
        keys[at] = keys[up]; items[at] = items[up]; at = up;
      }
      keys[at] = key; items[at] = item;
    },
    pop() {
      const top = items[0];
      const key = keys[--size];
      const item = items[size];
      let at = 0;
      for (;;) {
        let child = 2 * at + 1;
        if (child >= size) break;
        if (child + 1 < size && keys[child + 1] > keys[child]) child += 1;
        if (keys[child] <= key) break;
        keys[at] = keys[child]; items[at] = items[child]; at = child;
      }
      keys[at] = key; items[at] = item;
      return top;
    },
  };
}

/**
 * How much of the ground gathers at each point of the grid once each point sends its
 * share the way up (`towards`, the point it sends to; -1 on the grid's edge, where
 * the way leaves it).
 */
export function gathered({ width, height, heights }) {
  const count = width * height;
  const towards = new Int32Array(count).fill(-1);
  const reached = new Uint8Array(count);
  const order = new Int32Array(count);
  let done = 0;
  const queue = highestFirst(count);
  for (let at = 0; at < count; at += 1) {
    const x = at % width;
    const y = (at - x) / width;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) { reached[at] = 1; queue.push(at, heights[at]); }
  }
  // the ground the way reaches next is the highest left, reached from where the way stands
  while (queue.size) {
    const at = queue.pop();
    order[done++] = at;
    const x = at % width;
    const y = (at - x) / width;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (reached[next]) continue;
      reached[next] = 1;
      towards[next] = at;
      queue.push(next, heights[next]);
    }
  }
  // from the last reached back to the edges, each hands on what it holds
  const held = new Float32Array(count).fill(1);
  for (let index = done - 1; index >= 0; index -= 1) {
    const at = order[index];
    if (towards[at] >= 0) held[towards[at]] += held[at];
  }
  return { towards, held };
}

/**
 * The crests as GeoJSON lines over `grid` (`heights.js`), `properties.strength` from 0
 * to 1 by how much of the ground each gathers. `share` is the part of the grid a point
 * gathers before it counts as a crest; `shortest` the fewest points a line keeps.
 */
export function ridgeLines(grid, { share = 1 / 900, shortest = 5, tolerance = 0.7 } = {}) {
  const { width, height, heights } = grid;
  const { towards, held } = gathered(grid);
  const least = Math.max(24, width * height * share);
  let top = 1;
  for (const value of held) if (value > top) top = value;
  const most = Math.log(top);
  // A crest gathers much, and falls away on both sides across the way it runs. A long
  // even slope gathers much too, row by row, but its sides are as high as it is; what
  // gathers far more than that is a crest whichever way it turns.
  const crest = new Uint8Array(width * height);
  for (let at = 0; at < held.length; at += 1) {
    const next = towards[at];
    if (held[at] < least || next < 0) continue;
    const dx = (next % width) - (at % width);
    const dy = Math.floor(next / width) - Math.floor(at / width);
    const side = (sx, sy) => heights[at + sy * width + sx];
    const drop = 1e-3 + 1e-4 * Math.abs(heights[at]);
    if (side(-dy, dx) < heights[at] - drop && side(dy, -dx) < heights[at] - drop) crest[at] = 1;
  }
  // a crest point leads on to the next, so the lines are walked from where each starts
  const into = new Uint8Array(width * height);
  for (let at = 0; at < held.length; at += 1) if (crest[at] && towards[at] >= 0 && crest[towards[at]]) into[towards[at]] += 1;
  const features = [];
  const walked = new Uint8Array(width * height);
  for (let start = 0; start < held.length; start += 1) {
    if (!crest[start] || into[start] === 1 || walked[start]) continue;
    let at = start;
    const line = [];
    while (at >= 0 && crest[at]) {
      line.push([at % width, Math.floor(at / width)]);
      if (walked[at]) break;
      walked[at] = 1;
      at = towards[at];
      // a line ends where it joins a stronger one, which is walked from its own start
      if (at >= 0 && into[at] > 1) { line.push([at % width, Math.floor(at / width)]); break; }
    }
    if (line.length < shortest) continue;
    const strength = Math.max(0, Math.min(1, (Math.log(held[start]) - Math.log(least)) / Math.max(1e-6, most - Math.log(least))));
    features.push({ type: 'Feature', properties: { strength: Math.round(strength * 100) / 100 },
      geometry: { type: 'LineString', coordinates: thinned(line, tolerance).map(([x, y]) => grid.lonLat(x, y).map((value) => Math.round(value * 1e6) / 1e6)) } });
  }
  return { type: 'FeatureCollection', features };
}
