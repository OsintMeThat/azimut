/**
 * The skyline in a photo, found by the colours either side of it: an assist to
 * the analyst's trace, never a trace of its own authority.
 *
 * Where a photo's sky meets the ground the colour changes at once, and the sky
 * is the brighter or the bluer side. `skylineField` scores every pixel of a
 * picture for how much such an edge lies just above it, and how busy the
 * picture is above it (a sky is plain, the ground is not). `traceSkyline`
 * follows the strongest such line across the picture, column after column,
 * by dynamic programming: it may climb or fall a few pixels a column, at a
 * small cost each, and a stretch the edge does not carry (a ridge lost in the
 * haze, a tree, a cloud on the summit) is left out rather than guessed.
 * `snapPath` moves a line drawn by hand onto the strongest edge within a few
 * pixels of it, across the line rather than up and down, so a steep flank
 * snaps as well as a crest, and leaves the hand where no edge is clear.
 *
 * A picture is `{ width, height, data }`, RGBA bytes as a canvas gives them.
 * Points are in the picture's pixels, edges between rows at whole numbers: a
 * skyline at y has its sky above y and its ground below. Where the picture is
 * see-through (a collage's pieces laid at a slant leave holes round them,
 * which a canvas reads as black) there is no picture: no edge is read there
 * or beside it, and the sky over a point is counted from where the picture
 * starts again below a hole.
 */

/** The largest colour difference there is, black to white. */
const FULL = 255 * Math.sqrt(3);
/** A colour change this large (a share of `FULL`) scores an edge 0.63, and more only slowly. */
const CLEAR_EDGE = 0.2;
/** Rows either side of a pixel whose colours are compared. */
const SIDE = 2;
/** A step in brightness from one pixel to the next this small (a share of 255) is a sky's grain, not something in it. */
const GRAIN = 3 / 255;
/** Steps past the grain adding up to this much make the picture above a point as busy as ground. */
const BUSY = 1;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/**
 * The picture's colours as three planes of floats, smoothed over 3 × 3 so
 * grain and JPEG blocks read as nothing, and which of its pixels are picture
 * at all (`solid`, 0 on a hole).
 */
export function smoothPlanes({ width: w, height: h, data }) {
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) solid[i] = data[4 * i + 3] >= SOLID ? 1 : 0;
  const planes = [];
  const across = new Float32Array(w * h);
  for (let c = 0; c < 3; c += 1) {
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const left = data[4 * (y * w + Math.max(0, x - 1)) + c];
        const right = data[4 * (y * w + Math.min(w - 1, x + 1)) + c];
        across[y * w + x] = (left + data[4 * (y * w + x) + c] + right) / 3;
      }
    }
    const plane = new Float32Array(w * h);
    for (let y = 0; y < h; y += 1) {
      const up = Math.max(0, y - 1) * w;
      const down = Math.min(h - 1, y + 1) * w;
      for (let x = 0; x < w; x += 1) plane[y * w + x] = (across[up + x] + across[y * w + x] + across[down + x]) / 3;
    }
    planes.push(plane);
  }
  return { width: w, height: h, planes, solid };
}

/**
 * How much of an edge a colour change makes, 0 to 1, from the sky side's
 * colour less the ground side's: an edge whose sky side is the brighter or the
 * bluer counts fully, one the other way round (a lake under a ridge, dark
 * cloud over snow) for less.
 */
function edgeScore(dr, dg, db) {
  const size = Math.hypot(dr, dg, db) / FULL;
  const brighter = 0.299 * dr + 0.587 * dg + 0.114 * db;
  const bluer = db - dr;
  const skyward = clamp((brighter + bluer) / 40, -1, 1);
  // saturating without a ceiling, so the clearest edge still peaks where it is
  return 1 - Math.exp(-(size * (0.6 + 0.4 * skyward)) / CLEAR_EDGE);
}

/** The edge along the top of pixel (x, y), its rows compared straight above and below. */
function edgeDown({ width: w, planes }, x, y) {
  let dr = 0;
  let dg = 0;
  let db = 0;
  for (let j = 0; j < SIDE; j += 1) {
    const sky = (y - 1 - j) * w + x;
    const ground = (y + j) * w + x;
    dr += planes[0][sky] - planes[0][ground];
    dg += planes[1][sky] - planes[1][ground];
    db += planes[2][sky] - planes[2][ground];
  }
  return edgeScore(dr / SIDE, dg / SIDE, db / SIDE);
}

/** A plane read between its pixels' centres, so an edge peaks where it is rather than over a whole pixel. */
function between(smooth, plane, x, y) {
  const { width: w, height: h } = smooth;
  const fx = clamp(x - 0.5, 0, w - 1);
  const fy = clamp(y - 0.5, 0, h - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const top = plane[y0 * w + x0] * (1 - tx) + plane[y0 * w + x1] * tx;
  const bottom = plane[y1 * w + x0] * (1 - tx) + plane[y1 * w + x1] * tx;
  return top * (1 - ty) + bottom * ty;
}

/** Whether a point falls on a hole in the picture. */
function holeAt({ width: w, height: h, solid }, x, y) {
  if (!solid) return false;
  return !solid[clamp(Math.floor(y), 0, h - 1) * w + clamp(Math.floor(x), 0, w - 1)];
}

/**
 * How much a sky-to-ground edge crosses a point, 0 to 1, the sky lying along
 * (nx, ny) from it: the colours `SIDE` pixels either side compared.
 */
export function edgeAcross(smooth, x, y, nx, ny) {
  const { planes } = smooth;
  // a hole's rim is no skyline: nothing is read where a hole lies within the colours compared
  const far = SIDE + 1.5;
  if (holeAt(smooth, x, y) || holeAt(smooth, x + nx * far, y + ny * far) || holeAt(smooth, x - nx * far, y - ny * far)) return 0;
  const d = [0, 0, 0];
  for (let j = 0; j < SIDE; j += 1) {
    const reach = j + 0.5;
    for (let c = 0; c < 3; c += 1) {
      d[c] += between(smooth, planes[c], x + nx * reach, y + ny * reach) - between(smooth, planes[c], x - nx * reach, y - ny * reach);
    }
  }
  return edgeScore(d[0] / SIDE, d[1] / SIDE, d[2] / SIDE);
}

/** A pixel less opaque than this is a hole in the picture, not part of it. */
const SOLID = 128;

/** Levels within which a frame's or a gutter's pixels keep one colour, and how grey that colour is. */
const PLAIN = 4;
const GREY = 14;

/**
 * The frames and gutters a picture holds, which are never sky nor ground: a
 * border of one flat grey (black bars over a video, a white frame round a
 * print, a collage's margin) and the gutters between a collage's panels.
 * A border is one where it is dark, or where the other side has the same; a
 * gutter is a thin band across the whole picture with something either side.
 * A white sky burnt out by the sun is neither: it is not matched below, and
 * it is not thin. Returns `{ rows, columns }`, 1 where a row or a column is
 * a frame's or a gutter's.
 */
export function framing({ width: w, height: h, data }) {
  const flat = (start, step, count) => {
    const r = data[start];
    const g = data[start + 1];
    const b = data[start + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) > GREY) return null;
    for (let k = 1; k < count; k += 1) {
      const i = start + k * step;
      if (Math.abs(data[i] - r) > PLAIN || Math.abs(data[i + 1] - g) > PLAIN || Math.abs(data[i + 2] - b) > PLAIN) return null;
    }
    return [r, g, b];
  };
  const rows = new Uint8Array(h);
  const columns = new Uint8Array(w);
  const rowColour = Array.from({ length: h }, (_, y) => flat(4 * y * w, 4, w));
  const columnColour = Array.from({ length: w }, (_, x) => flat(4 * x, 4 * w, h));
  const same = (a, b) => a && b && a.every((c, i) => Math.abs(c - b[i]) <= 2 * PLAIN);
  const dark = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] < 50;
  const band = (colours, from, step) => {
    let count = 0;
    for (let k = from; k >= 0 && k < colours.length && same(colours[k], colours[from]); k += step) count += 1;
    return count;
  };
  // borders: from each side, the run of flat rows (or columns) of the side's own colour
  for (const [colours, marks] of [
    [rowColour, rows],
    [columnColour, columns],
  ]) {
    const n = colours.length;
    const first = band(colours, 0, 1);
    const last = band(colours, n - 1, -1);
    if (first >= n) continue;
    const matched = first && last && same(colours[0], colours[n - 1]);
    if (first && (dark(colours[0]) || matched)) marks.fill(1, 0, first);
    if (last && (dark(colours[n - 1]) || matched)) marks.fill(1, n - last, n);
  }
  // gutters: thin flat bands across the whole picture, with something either side
  for (const [colours, marks, n] of [
    [rowColour, rows, h],
    [columnColour, columns, w],
  ]) {
    const thinnest = Math.max(2, Math.round(n * 0.04));
    let k = 0;
    while (k < n) {
      if (!colours[k] || marks[k]) {
        k += 1;
        continue;
      }
      const run = band(colours, k, 1);
      const before = k - 1;
      const after = k + run;
      if (run <= thinnest && before >= 0 && after < n && !marks[before] && !marks[after] && !same(colours[before], colours[k])) {
        marks.fill(1, k, after);
      }
      k = after;
    }
  }
  return { rows, columns };
}

/**
 * Each pixel's score for the skyline lying along its top edge, and how busy
 * the picture is above it (0 a plain sky, 1 as busy as ground), column by
 * column: `{ width, height, edge, busy, blocked }`, `edge[x * height + y]`,
 * `blocked[x]` 1 on a frame's or a gutter's columns, where no line goes.
 */
export function skylineField(picture) {
  const smooth = smoothPlanes(picture);
  const { width: w, height: h, planes } = smooth;
  const edge = new Float32Array(w * h);
  const busy = new Float32Array(w * h);
  const luma = (i) => 0.299 * planes[0][i] + 0.587 * planes[1][i] + 0.114 * planes[2][i];
  // frames and gutters, and the rows and columns too near them to be read: a skyline needs a
  // little sky over it inside its own panel, and its edge rows must be the picture's own
  const { rows, columns } = framing(picture);
  const near = SIDE + 1;
  const offRow = new Uint8Array(h);
  const offColumn = new Uint8Array(w);
  // where a panel starts, the sky over a point is counted again from nothing
  const fresh = new Uint8Array(h);
  for (let y = 0; y < h; y += 1) {
    if (!rows[y]) continue;
    for (let k = Math.max(0, y - near); k <= Math.min(h - 1, y + near); k += 1) offRow[k] = 1;
    if (y + 1 < h && !rows[y + 1]) fresh[y + 1] = 1;
  }
  for (let y = 0; y < h; y += 1) if (y < near || y > h - 1 - near) offRow[y] = 1;
  for (let x = 0; x < w; x += 1) {
    if (!columns[x]) continue;
    for (let k = Math.max(0, x - 1); k <= Math.min(w - 1, x + 1); k += 1) offColumn[k] = 1;
  }
  // holes, and the pixels too near one to be read (the smoothing and the rows compared reach that far)
  const data = picture.data;
  const hole = (x, y) => data[4 * (y * w + x) + 3] < SOLID;
  const offHole = new Uint8Array(w * h);
  const reach = SIDE + 2;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!hole(x, y)) continue;
      for (let k = Math.max(0, y - reach); k <= Math.min(h - 1, y + reach); k += 1) {
        for (let j = Math.max(0, x - 1); j <= Math.min(w - 1, x + 1); j += 1) offHole[j * h + k] = 1;
      }
    }
  }
  const steps = new Float32Array(w * h);
  for (let x = 0; x < w; x += 1) {
    for (let y = 1; y < h; y += 1) {
      const i = y * w + x;
      const off = offRow[y] || offColumn[x] || offHole[x * h + y];
      const left = x > 0 ? luma(i - 1) : luma(i);
      steps[x * h + y] = off ? 0 : (Math.abs(luma(i) - luma(i - w)) + Math.abs(luma(i) - left)) / 255;
      edge[x * h + y] = off ? 0 : edgeDown(smooth, x, y);
    }
  }
  // what the picture holds above each point beyond a sky's own smooth fall of light and its grain:
  // a band of far ridges, however pale, counts in full however much sky lies over it
  for (let x = 0; x < w; x += 1) {
    let sum = 0;
    for (let y = 0; y < h; y += 1) {
      // a panel starts, or the picture starts again below a hole
      if (fresh[y] || (y > 0 && hole(x, y - 1) && !hole(x, y))) sum = 0;
      // above the edge's own rows: the sky over it, not the edge itself
      const top = y - SIDE - 1;
      if (top >= 0) sum += Math.max(0, steps[x * h + top] - GRAIN);
      busy[x * h + y] = Math.min(1, sum / BUSY);
    }
  }
  return { width: w, height: h, edge, busy, blocked: offColumn };
}

/** A line with the points that change nothing dropped, `tolerance` pixels at most off it. */
export function simplify(points, tolerance = 0.5) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const a = points[first];
    const b = points[last];
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let far = -1;
    let farthest = tolerance;
    for (let i = first + 1; i < last; i += 1) {
      const p = points[i];
      const off = Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / length;
      if (off > farthest) {
        farthest = off;
        far = i;
      }
    }
    if (far < 0) continue;
    keep[far] = 1;
    stack.push([first, far], [far, last]);
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * The skyline across a picture's field (`skylineField`), as lines of points:
 * one line where the edge carries all the way, several where stretches of it
 * are too faint to follow, none when no edge stands out at all.
 *
 * @param {object} [options]
 * @param {number} [options.jump] pixels the line may climb or fall from one column to the next
 * @param {number} [options.bend] the cost of each of those pixels, against an edge's score
 * @param {number} [options.plain] how much a busy picture above a point counts against it
 * @param {number} [options.faint] a stretch whose edge is under this share of the line's middling edge is left out
 * @param {number} [options.shortest] a piece shorter than this share of the width is dropped
 */
export function traceSkyline(field, { jump = 4, bend = 0.04, plain = 0.75, faint = 0.4, shortest = 0.03 } = {}) {
  const { width: w, height: h, edge, busy, blocked = null } = field;
  if (w < 2 || h < 2 * SIDE + 2) return [];
  const worth = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) worth[i] = edge[i] - plain * busy[i];
  // the best line ending at each pixel of a column, and the row it came from
  let before = new Float32Array(h);
  let now = new Float32Array(h);
  const from = new Int32Array(w * h);
  for (let y = 0; y < h; y += 1) before[y] = -worth[y];
  for (let x = 1; x < w; x += 1) {
    for (let y = 0; y < h; y += 1) {
      let best = Infinity;
      let row = y;
      for (let d = -jump; d <= jump; d += 1) {
        const yy = y + d;
        if (yy < 0 || yy >= h) continue;
        const cost = before[yy] + bend * Math.abs(d);
        if (cost < best) {
          best = cost;
          row = yy;
        }
      }
      now[y] = best - worth[x * h + y];
      from[x * h + y] = row;
    }
    [before, now] = [now, before];
  }
  let y = 0;
  for (let row = 1; row < h; row += 1) if (before[row] < before[y]) y = row;
  const rows = new Int32Array(w);
  for (let x = w - 1; x >= 0; x -= 1) {
    rows[x] = y;
    if (x > 0) y = from[x * h + y];
  }
  // how strong the edge under the line is, smoothed over a few columns
  const strength = Array.from(rows, (row, x) => edge[x * h + row]);
  const middling = [...strength].sort((a, b) => a - b)[Math.floor(w / 2)];
  if (!(middling > 0.05)) return [];
  const held = strength.map((_, x) => {
    let sum = 0;
    let count = 0;
    for (let k = Math.max(0, x - 2); k <= Math.min(w - 1, x + 2); k += 1) {
      sum += strength[k];
      count += 1;
    }
    return !blocked?.[x] && sum / count >= faint * middling;
  });
  const lines = [];
  let line = [];
  const close = () => {
    if (line.length >= Math.max(2, shortest * w)) lines.push(simplify(line, 0.5));
    line = [];
  };
  for (let x = 0; x < w; x += 1) {
    if (held[x]) line.push({ x: x + 0.5, y: rows[x] });
    else close();
  }
  close();
  return lines;
}

/** Points along a line drawn by hand, one pixel apart, each with the way the line goes there. */
function alongLine(points) {
  const samples = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.round(length));
    for (let k = i === 1 ? 0 : 1; k <= steps; k += 1) {
      samples.push({ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps });
    }
  }
  return samples.map((p, i) => {
    const a = samples[Math.max(0, i - 3)];
    const b = samples[Math.min(samples.length - 1, i + 3)];
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    // across the line, the sky's side up
    let nx = (b.y - a.y) / length;
    let ny = -(b.x - a.x) / length;
    if (ny > 0 || (ny === 0 && nx < 0)) {
      nx = -nx;
      ny = -ny;
    }
    return { ...p, nx, ny };
  });
}

/**
 * A line drawn by hand moved onto the skyline nearest it: each point slides
 * across the line, `reach` pixels each way at most, to where the edge is
 * strongest, the line kept whole. Where no edge within reach is clear the
 * points stay where the hand put them.
 *
 * @param {object} smooth the picture as `smoothPlanes` gives it
 * @param {{ x: number, y: number }[]} points the line, in the picture's pixels
 */
export function snapPath(smooth, points, { reach = 12, near = 0.04, bend = 0.05, faint = 0.2 } = {}) {
  if (points.length < 2) return points;
  const samples = alongLine(points);
  const n = samples.length;
  const width = 2 * reach + 1;
  const scores = new Float32Array(n * width);
  for (let i = 0; i < n; i += 1) {
    const s = samples[i];
    const band = new Float32Array(width);
    for (let k = -reach; k <= reach; k += 1) {
      band[k + reach] = edgeAcross(smooth, s.x + k * s.nx, s.y + k * s.ny, s.nx, s.ny);
    }
    const strongest = Math.max(...band);
    const middling = Float32Array.from(band).sort()[reach];
    // an edge is one only where it stands out of its band; elsewhere the hand's own place wins
    if (strongest >= faint && strongest >= 2 * middling) scores.set(band, i * width);
  }
  let before = new Float32Array(width);
  let now = new Float32Array(width);
  const from = new Int8Array(n * width);
  const own = (i, k) => -scores[i * width + k] + (near * Math.abs(k - reach)) / reach;
  for (let k = 0; k < width; k += 1) before[k] = own(0, k);
  for (let i = 1; i < n; i += 1) {
    for (let k = 0; k < width; k += 1) {
      let best = Infinity;
      let step = 0;
      for (let d = -1; d <= 1; d += 1) {
        const kk = k + d;
        if (kk < 0 || kk >= width) continue;
        const cost = before[kk] + bend * Math.abs(d);
        if (cost < best) {
          best = cost;
          step = d;
        }
      }
      now[k] = best + own(i, k);
      from[i * width + k] = step;
    }
    [before, now] = [now, before];
  }
  let k = 0;
  for (let kk = 1; kk < width; kk += 1) if (before[kk] < before[k]) k = kk;
  const moved = new Array(n);
  for (let i = n - 1; i >= 0; i -= 1) {
    const s = samples[i];
    const off = k - reach;
    moved[i] = { x: s.x + off * s.nx, y: s.y + off * s.ny };
    k += from[i * width + k];
  }
  return simplify(moved, 0.4);
}
