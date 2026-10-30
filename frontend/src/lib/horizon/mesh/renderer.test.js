import { describe, expect, it } from 'vitest';
import { createMeshRenderer, lightVector, topsGrid } from './renderer.js';

// The shaders run in Chromium (the Horizon e2e checks); importing the module
// here is what catches a shader source that breaks the file it is written in.
describe('the Horizon renderer', () => {
  it('points its light the way an azimuth and an altitude say', () => {
    const [east, north, up] = lightVector(90, 0);
    expect(east).toBeCloseTo(1, 9);
    expect(north).toBeCloseTo(0, 9);
    expect(up).toBeCloseTo(0, 9);
    expect(lightVector(0, 90)[2]).toBeCloseTo(1, 9);
    const nw = lightVector(315, 45);
    expect(Math.hypot(...nw)).toBeCloseTo(1, 9);
    expect(nw[0]).toBeLessThan(0);
    expect(nw[1]).toBeGreaterThan(0);
  });

  it('keeps the shadows’ tops on the finest grid’s own cells, just past the roofs, never past the grid', () => {
    const finest = { reach: 6000, size: 1536 };
    const cell = 12000 / 1536;
    const near = topsGrid(finest, 1000);
    expect(near.cell).toBeCloseTo(cell, 9);
    // 128 cells reach 1000 m, and a margin of 8 for a wall's ray
    expect(near.size).toBe(2 * (128 + 8));
    expect(near.reach).toBeCloseTo(136 * cell, 6);
    // the cells line up with the finest grid's: its edge is a whole number of them away
    expect(((finest.reach - near.reach) / cell) % 1).toBeCloseTo(0, 6);
    expect(topsGrid(finest, 9000)).toEqual({ reach: 6000, size: 1536, cell });
  });

  it('says so when the browser has no WebGL2, or no float targets to draw distances in', () => {
    expect(createMeshRenderer({ getContext: () => null })).toBeNull();
    expect(createMeshRenderer({ getContext: () => ({ getExtension: () => null }) })).toBeNull();
  });
});
