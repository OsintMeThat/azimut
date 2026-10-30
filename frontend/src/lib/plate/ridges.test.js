import { describe, expect, it } from 'vitest';
import { gathered, ridgeLines } from './ridges.js';

/** A long ridge running north and south down the middle, rising to the north. */
function ridge(size = 60) {
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) heights[y * size + x] = 500 - Math.abs(x - size / 2) * 10 + (size - y) * 2;
  }
  return { width: size, height: size, heights, lonLat: (x, y) => [x, -y] };
}

describe('ridge lines', () => {
  it('sends each point to its steepest way up, so the crest gathers its slopes', () => {
    const grid = ridge();
    const { towards, held } = gathered(grid);
    const crest = 30 * 60 + 30;
    const flank = 30 * 60 + 20;
    expect(held[crest]).toBeGreaterThan(held[flank] * 10);
    // the crest leads north, up the ridge
    expect(towards[crest]).toBe(29 * 60 + 30);
  });

  it('traces the crest as a line along the top of the ridge', () => {
    const lines = ridgeLines(ridge());
    expect(lines.features.length).toBeGreaterThan(0);
    const longest = lines.features.reduce((best, feature) => (feature.geometry.coordinates.length > best.geometry.coordinates.length ? feature : best));
    const xs = longest.geometry.coordinates.map(([x]) => x);
    for (const x of xs) expect(Math.abs(x - 30)).toBeLessThanOrEqual(1);
    expect(longest.properties.strength).toBeGreaterThan(0);
  });

  it('finds no crest on flat ground', () => {
    const size = 30;
    expect(ridgeLines({ width: size, height: size, heights: new Float32Array(size * size), lonLat: (x, y) => [x, y] }).features).toEqual([]);
  });
});
