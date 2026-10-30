import { describe, expect, it } from 'vitest';
import { contourLines, contourStep, INDEX_EVERY, isoline, joined, labelAnchors, smoothed, thinned } from './contours.js';

/** A round hill, `top` metres high in the middle of a square grid `size` points wide. */
function hill(size = 41, top = 100) {
  const heights = new Float32Array(size * size);
  const middle = (size - 1) / 2;
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) heights[y * size + x] = top - Math.hypot(x - middle, y - middle) * (top / middle);
  return { width: size, height: size, heights, lonLat: (x, y) => [x / 100, -y / 100] };
}

describe('contour lines', () => {
  it('rings a hill at the height asked, in one closed line', () => {
    const lines = isoline(hill(), 50);
    expect(lines).toHaveLength(1);
    const [line] = lines;
    // closed: it ends where it starts
    expect(Math.hypot(line[0][0] - line.at(-1)[0], line[0][1] - line.at(-1)[1])).toBeLessThan(1e-6);
    // every point is half way up, ten points from the middle
    for (const [x, y] of line) expect(Math.hypot(x - 20, y - 20)).toBeCloseTo(10, 0);
  });

  it('joins segments end to end, whichever way round they come', () => {
    expect(joined([[[1, 0], [2, 0]], [[0, 0], [1, 0]], [[3, 0], [2, 0]]])).toEqual([[[0, 0], [1, 0], [2, 0], [3, 0]]]);
  });

  it('keeps only the points that change a line\'s shape', () => {
    expect(thinned([[0, 0], [1, 0.01], [2, 0], [3, 0], [3, 3]])).toEqual([[0, 0], [3, 0], [3, 3]]);
  });

  it('keeps a ring round a summit a ring once thinned', () => {
    const [ring] = isoline(hill(), 50);
    const thin = thinned(ring);
    expect(thin.length).toBeGreaterThan(8);
    // still round the middle, every way
    const xs = thin.map(([x]) => x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(18);
  });

  it('rounds a line’s corners, a ring staying a ring and an open line keeping its ends', () => {
    const square = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
    const round = smoothed(square, 2);
    expect(round[0]).toEqual(round.at(-1));
    // no point is left on a corner, and none strays outside the square
    for (const corner of [[0, 0], [4, 0], [4, 4], [0, 4]]) expect(round.some(([x, y]) => x === corner[0] && y === corner[1])).toBe(false);
    for (const [x, y] of round) expect(x >= 0 && x <= 4 && y >= 0 && y <= 4).toBe(true);
    const open = smoothed([[0, 0], [2, 2], [4, 0]], 3);
    expect(open[0]).toEqual([0, 0]);
    expect(open.at(-1)).toEqual([4, 0]);
    expect(open.length).toBeGreaterThan(3);
  });

  it('traces a round hill’s lines round, never turning sharply from one step to the next', () => {
    const lines = contourLines(hill(41, 100), 10);
    const ring = lines.features.find((feature) => feature.properties.ele === 50).geometry.coordinates;
    const turn = (a, b, c) => {
      const one = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const two = Math.atan2(c[1] - b[1], c[0] - b[0]);
      return Math.abs(((two - one + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    };
    let sharpest = 0;
    for (let i = 1; i < ring.length - 1; i += 1) sharpest = Math.max(sharpest, turn(ring[i - 1], ring[i], ring[i + 1]));
    // straight steps across each cell turned some 25° at a time; rounded, a few degrees
    expect((sharpest * 180) / Math.PI).toBeLessThan(12);
  });

  it('draws a line every interval, every fifth one bolder, as GeoJSON on the ground', () => {
    const lines = contourLines(hill(41, 100), 10);
    const levels = [...new Set(lines.features.map((feature) => feature.properties.ele))];
    expect(levels).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90]);
    expect(lines.features.find((feature) => feature.properties.ele === 50).properties.index).toBe(true);
    expect(lines.features.find((feature) => feature.properties.ele === 40).properties.index).toBe(false);
    expect(lines.features[0].geometry.type).toBe('LineString');
    expect(INDEX_EVERY).toBe(5);
  });

  it('marks where the globe writes a bolder line\'s height, since it writes names at a point only', () => {
    // along a straight line of 700 grid points: at 150, then every 300
    expect(labelAnchors([[0, 0], [700, 0]]).map(([x, y]) => [Math.round(x), y])).toEqual([[150, 0], [450, 0]]);
    // a line too short for the spacing is written at its middle, a scrap not at all
    expect(labelAnchors([[0, 0], [100, 0]])).toEqual([[50, 0]]);
    expect(labelAnchors([[0, 0], [30, 0]])).toEqual([]);
    const plain = contourLines(hill(161, 100), 10);
    expect(plain.features.every((feature) => feature.geometry.type === 'LineString')).toBe(true);
    const written = contourLines(hill(161, 100), 10, { anchors: true });
    const points = written.features.filter((feature) => feature.geometry.type === 'Point');
    expect(points.length).toBeGreaterThan(0);
    expect(points.every((feature) => feature.properties.index && feature.properties.ele === 50)).toBe(true);
    expect(written.features.length - points.length).toBe(plain.features.length);
  });

  it('spaces its lines by the map\'s scale, wider over high ground so they never crowd', () => {
    expect(contourStep(15)).toBe(10);
    expect(contourStep(12)).toBe(50);
    expect(contourStep(4)).toBe(1000);
    expect(contourStep(15, 0, 3000)).toBe(80);
  });
});
