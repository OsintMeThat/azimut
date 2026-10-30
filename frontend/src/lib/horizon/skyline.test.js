import { describe, expect, it } from 'vitest';
import { framing, simplify, skylineField, smoothPlanes, snapPath, traceSkyline } from './skyline.js';

const W = 320;
const H = 200;

/** The same noise every run. */
function noise(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/**
 * A photo of a ridge: a sky that pales towards the horizon over rock with
 * grain in it. `ridge(x)` is the skyline's row; `paint(x, y, sky)` can change
 * a pixel's colour, [r, g, b].
 */
function photo(ridge, { paint = null, seed = 7, ground = [96, 84, 72] } = {}) {
  const random = noise(seed);
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const sky = y < ridge(x);
      let colour = sky
        ? [120 + (y / H) * 70, 160 + (y / H) * 50, 220]
        : ground.map((c) => c + (random() - 0.5) * 50);
      if (paint) colour = paint(x, y, sky, colour) ?? colour;
      const i = 4 * (y * W + x);
      data[i] = colour[0];
      data[i + 1] = colour[1];
      data[i + 2] = colour[2];
      data[i + 3] = 255;
    }
  }
  return { width: W, height: H, data };
}

const wavy = (x) => 80 + 25 * Math.sin(x / 40) + 8 * Math.sin(x / 9);

/** Where the picture's skyline lies over a column: the first row of ground. */
const edgeRow = (ridge, column) => Math.ceil(ridge(column));

/** How far each point of the lines lies from the true skyline, in rows. */
const misses = (lines, ridge) => lines.flat().map((p) => Math.abs(p.y - edgeRow(ridge, Math.floor(p.x))));

/** How far each point lies from the picture's skyline, measured to the nearest stretch of it, in pixels. */
function offEdge(points, ridge) {
  return points.map((p) => {
    let nearest = Infinity;
    for (let c = Math.max(0, Math.floor(p.x) - 6); c < Math.min(W - 1, Math.floor(p.x) + 6); c += 1) {
      const a = { x: c + 0.5, y: edgeRow(ridge, c) };
      const b = { x: c + 1.5, y: edgeRow(ridge, c + 1) };
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
      nearest = Math.min(nearest, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
    }
    return nearest;
  });
}
const span = (lines) => lines.reduce((sum, line) => sum + line.at(-1).x - line[0].x, 0);

describe('the skyline found in a photo', () => {
  it('follows a ridge against the sky, all the way across', () => {
    const lines = traceSkyline(skylineField(photo(wavy)));
    expect(lines).toHaveLength(1);
    expect(span(lines)).toBeGreaterThan(W * 0.97);
    expect(Math.max(...misses(lines, wavy))).toBeLessThanOrEqual(2);
  });

  it('is not drawn to a cloud over the ridge', () => {
    const cloud = (x, y, sky) => {
      if (!sky) return null;
      const inside = ((x - 160) / 60) ** 2 + ((y - 25) / 14) ** 2;
      if (inside > 1) return null;
      // a soft white cloud, paler at its heart
      const white = 235 - inside * 25;
      return [white, white, white + 8];
    };
    const lines = traceSkyline(skylineField(photo(wavy, { paint: cloud })));
    expect(span(lines)).toBeGreaterThan(W * 0.95);
    expect(Math.max(...misses(lines, wavy))).toBeLessThanOrEqual(2);
  });

  it('holds a hazy ridge, pale against the sky', () => {
    const haze = (x, y, sky, colour) => (sky ? null : colour.map((c, i) => c * 0.35 + [150, 175, 205][i] * 0.65));
    const lines = traceSkyline(skylineField(photo(wavy, { paint: haze })));
    expect(span(lines)).toBeGreaterThan(W * 0.9);
    expect(Math.max(...misses(lines, wavy))).toBeLessThanOrEqual(2);
  });

  it('counts a band of far relief over an edge in full, however much sky lies over the band', () => {
    // a pale far ridge, its faces lit and shaded, 20 rows deep, high or low under the sky
    const banded = (top) =>
      photo(() => top + 60, { paint: (x, y, sky) => (sky && y >= top ? [165, 178, 192].map((c) => c + 22 * Math.sin(x / 4 + y / 3)) : null) });
    const high = skylineField(banded(20));
    const low = skylineField(banded(100));
    const x = 150;
    // the near ridge's edge under the band is held back alike
    expect(high.busy[x * H + 80]).toBeGreaterThan(0.15);
    expect(Math.abs(high.busy[x * H + 80] - low.busy[x * H + 160])).toBeLessThan(0.02);
    // the sky's own smooth fall of light counts for nothing over the far ridge's top
    expect(low.busy[x * H + 100]).toBeLessThan(0.01);
  });

  it('leaves out a stretch where no edge is there to follow', () => {
    // from x 140 to 190 the ground is lost in a sky of its colour: nothing to see
    const lost = (x, y) => (x >= 140 && x < 190 ? [120 + (y / H) * 70, 160 + (y / H) * 50, 220] : null);
    const lines = traceSkyline(skylineField(photo(wavy, { paint: lost })));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) {
      for (const p of line) expect(p.x < 145 || p.x > 185).toBe(true);
    }
    expect(Math.max(...misses(lines, wavy))).toBeLessThanOrEqual(2);
  });

  it('finds nothing in a plain picture', () => {
    const plain = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(128) };
    expect(traceSkyline(skylineField(plain))).toEqual([]);
  });
});

/** A picture laid inside a border of one colour, `top` rows above and below, `side` columns either side. */
function framed(inner, { top = 0, side = 0, colour = [0, 0, 0] }) {
  const w = inner.width + 2 * side;
  const h = inner.height + 2 * top;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const ix = x - side;
      const iy = y - top;
      const inside = ix >= 0 && ix < inner.width && iy >= 0 && iy < inner.height;
      data.set(inside ? inner.data.subarray(4 * (iy * inner.width + ix), 4 * (iy * inner.width + ix) + 4) : [...colour, 255], 4 * (y * w + x));
    }
  }
  return { width: w, height: h, data };
}

/** Two pictures side by side (or one over the other) with a gutter of one colour between, as a collage lays them. */
function collage(a, b, { gutter = 6, colour = [255, 255, 255], stacked = false }) {
  const w = stacked ? a.width : a.width + gutter + b.width;
  const h = stacked ? a.height + gutter + b.height : a.height;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let pixel = [...colour, 255];
      const second = stacked ? y - a.height - gutter : x - a.width - gutter;
      if (stacked ? y < a.height : x < a.width) pixel = a.data.subarray(4 * (y * a.width + x), 4 * (y * a.width + x) + 4);
      else if (second >= 0) pixel = stacked ? b.data.subarray(4 * (second * b.width + x), 4 * (second * b.width + x) + 4) : b.data.subarray(4 * (y * b.width + second), 4 * (y * b.width + second) + 4);
      data.set(pixel, 4 * (y * w + x));
    }
  }
  return { width: w, height: h, data };
}

describe('frames and gutters, never a skyline', () => {
  const ridge = photo(wavy);

  it('leaves black bars over and under a video out', () => {
    const bars = framed(ridge, { top: 24 });
    expect(framing(bars).rows.slice(0, 24).every(Boolean)).toBe(true);
    const lines = traceSkyline(skylineField(bars));
    expect(span(lines)).toBeGreaterThan(W * 0.95);
    expect(Math.max(...misses(lines, (x) => wavy(x) + 24))).toBeLessThanOrEqual(2);
  });

  it('leaves a white frame round a print out', () => {
    const print = framed(ridge, { top: 10, side: 10, colour: [250, 250, 250] });
    const lines = traceSkyline(skylineField(print));
    for (const p of lines.flat()) {
      expect(p.x).toBeGreaterThan(10);
      expect(p.x).toBeLessThan(W + 10);
    }
    expect(Math.max(...misses(lines.map((line) => line.map((p) => ({ x: p.x - 10, y: p.y - 10 }))), wavy))).toBeLessThanOrEqual(2);
  });

  it('cuts the line at a gutter between two photos side by side', () => {
    const other = (x) => 110 + 20 * Math.cos(x / 25);
    const pair = collage(ridge, photo(other, { seed: 9 }), { gutter: 6 });
    const lines = traceSkyline(skylineField(pair));
    for (const p of lines.flat()) expect(p.x < W || p.x > W + 6).toBe(true);
    const left = lines.filter((line) => line[0].x < W);
    const right = lines.filter((line) => line[0].x > W + 6);
    expect(Math.max(...misses(left, wavy))).toBeLessThanOrEqual(2);
    expect(Math.max(...misses(right.map((line) => line.map((p) => ({ x: p.x - W - 6, y: p.y }))), other))).toBeLessThanOrEqual(2);
  });

  it('never follows a gutter between two photos one over the other', () => {
    const pair = collage(ridge, photo(wavy, { seed: 5 }), { gutter: 6, stacked: true, colour: [20, 20, 20] });
    expect(framing(pair).rows.slice(H, H + 6).every(Boolean)).toBe(true);
    const lines = traceSkyline(skylineField(pair));
    for (const p of lines.flat()) expect(Math.abs(p.y - H) > 4 && Math.abs(p.y - (H + 6)) > 4).toBe(true);
  });

  it('never follows the holes round a collage\'s slanted pieces, which a canvas reads as black', () => {
    // a piece laid at a slant: see-through wedges over and under it, read back as (0, 0, 0, 0)
    const piece = photo(wavy);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        if (y > 6 + x * 0.06 && y < H - 10 - x * 0.04) continue;
        piece.data.fill(0, 4 * (y * W + x), 4 * (y * W + x) + 4);
      }
    }
    const lines = traceSkyline(skylineField(piece));
    expect(span(lines)).toBeGreaterThan(W * 0.9);
    expect(Math.max(...misses(lines, wavy))).toBeLessThanOrEqual(2);
  });

  it('takes a sky burnt white for sky, not for a frame', () => {
    const burnt = photo(wavy, { paint: (x, y, sky) => (sky ? [255, 255, 255] : null) });
    const { rows } = framing(burnt);
    expect(rows.some(Boolean)).toBe(false);
    const lines = traceSkyline(skylineField(burnt));
    expect(span(lines)).toBeGreaterThan(W * 0.95);
    expect(Math.max(...misses(lines, wavy))).toBeLessThanOrEqual(2);
  });
});

describe('a line drawn by hand, snapped to the skyline', () => {
  const smooth = smoothPlanes(photo(wavy));
  const random = noise(3);
  // drawn 6 px low and shaky, as a hand does
  const hand = Array.from({ length: 40 }, (_, i) => {
    const x = 20 + i * 7;
    return { x, y: wavy(x) + 6 + (random() - 0.5) * 4 };
  });

  it('lands on the edge a few pixels from the hand', () => {
    const snapped = snapPath(smooth, hand, { reach: 12 });
    expect(Math.max(...offEdge(snapped, wavy))).toBeLessThanOrEqual(1);
    // the ends slide across the line, never along it
    expect(Math.abs(snapped[0].x - 20)).toBeLessThan(3);
    expect(Math.abs(snapped.at(-1).x - hand.at(-1).x)).toBeLessThan(3);
  });

  it('snaps a steep flank too, across the line rather than up and down', () => {
    // a flank at 70°: the ridge drops 2.75 rows a column
    const steep = (x) => (x < 100 ? 40 : x < 140 ? 40 + (x - 100) * 2.75 : 150);
    const flank = smoothPlanes(photo(steep));
    const drawn = [];
    for (let y = 50; y <= 140; y += 6) drawn.push({ x: 100 + (y - 40) / 2.75 + 5, y });
    const snapped = snapPath(flank, drawn, { reach: 10 });
    for (const p of snapped) {
      // across a 70° flank, a 5 px slip sideways is about 4.7 px off the line
      const off = Math.abs(p.y - (40 + (p.x - 100) * 2.75)) / Math.hypot(1, 2.75);
      expect(off).toBeLessThanOrEqual(1.2);
    }
  });

  it('never snaps onto the rim of a hole, which a canvas reads as black', () => {
    // a sky with nothing under it: a collage's piece ends at row 100, see-through below
    const piece = photo(() => H + 10);
    piece.data.fill(0, 4 * 100 * W);
    const drawn = [
      { x: 40, y: 106 },
      { x: 160, y: 106 },
      { x: 280, y: 106 },
    ];
    for (const p of snapPath(smoothPlanes(piece), drawn, { reach: 12 })) expect(Math.abs(p.y - 106)).toBeLessThanOrEqual(1);
  });

  it('stays where the hand put it when no edge is in reach', () => {
    const far = hand.map((p) => ({ x: p.x, y: p.y + 40 }));
    const snapped = snapPath(smooth, far, { reach: 8 });
    for (const p of snapped) {
      const drawn = far.reduce((best, q) => (Math.abs(q.x - p.x) < Math.abs(best.x - p.x) ? q : best));
      expect(Math.abs(p.y - drawn.y)).toBeLessThanOrEqual(3);
    }
  });
});

describe('a line made lighter', () => {
  it('drops the points that change nothing', () => {
    const straight = Array.from({ length: 50 }, (_, i) => ({ x: i, y: 10 + (i % 2) * 0.1 }));
    expect(simplify(straight, 0.5)).toEqual([straight[0], straight.at(-1)]);
    const bent = [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }];
    expect(simplify(bent, 0.5)).toEqual(bent);
  });
});
