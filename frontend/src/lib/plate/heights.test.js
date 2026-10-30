import { describe, expect, it } from 'vitest';
import { gridLevel, halved, heightGrid, MAX_TILES, tilesOver } from './heights.js';

describe('the heights under a map', () => {
  it('reads the tiles a box covers, at a level that keeps them few', () => {
    expect(tilesOver([2.2, 48.8, 2.4, 48.9], 10).map(([x, y]) => [x, y])).toEqual([[518, 352]]);
    const level = gridLevel([0, 40, 10, 50], 12);
    expect(tilesOver([0, 40, 10, 50], level).length).toBeLessThanOrEqual(MAX_TILES);
    expect(level).toBeLessThan(12);
  });

  it('lays the tiles side by side into one grid, the sea where a tile has none', async () => {
    const asked = [];
    const load = async (z, x, y) => {
      asked.push([z, x, y]);
      return x % 2 ? null : new Float32Array(4 * 4).fill(100 + y);
    };
    const grid = await heightGrid([-0.5, -0.5, 0.5, 0.5], 1, load, 4);
    expect(asked.length).toBe(4);
    expect([grid.width, grid.height]).toEqual([8, 8]);
    expect(grid.heights[0]).toBe(100);
    expect(grid.heights[4]).toBe(0);
    const [lon, lat] = grid.lonLat(3.5, 3.5);
    expect(lon).toBeCloseTo(0, 5);
    expect(lat).toBeCloseTo(0, 5);
  });

  it('halves a grid by the mean of each four heights', () => {
    const grid = { width: 2, height: 2, heights: Float32Array.from([1, 2, 3, 6]), lonLat: (x, y) => [x, y] };
    const half = halved(grid);
    expect([half.width, half.height, half.heights[0]]).toEqual([1, 1, 3]);
  });
});
