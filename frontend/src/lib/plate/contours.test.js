import { describe, expect, it } from 'vitest';
import { contourLines, contourStep, INDEX_EVERY, isoline, joined, thinned } from './contours.js';

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

  it('draws a line every interval, every fifth one bolder, as GeoJSON on the ground', () => {
    const lines = contourLines(hill(41, 100), 10);
    const levels = [...new Set(lines.features.map((feature) => feature.properties.ele))];
    expect(levels).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90]);
    expect(lines.features.find((feature) => feature.properties.ele === 50).properties.index).toBe(true);
    expect(lines.features.find((feature) => feature.properties.ele === 40).properties.index).toBe(false);
    expect(lines.features[0].geometry.type).toBe('LineString');
    expect(INDEX_EVERY).toBe(5);
  });

  it('spaces its lines by the map\'s scale, wider over high ground so they never crowd', () => {
    expect(contourStep(15)).toBe(10);
    expect(contourStep(12)).toBe(50);
    expect(contourStep(4)).toBe(1000);
    expect(contourStep(15, 0, 3000)).toBe(80);
  });
});
