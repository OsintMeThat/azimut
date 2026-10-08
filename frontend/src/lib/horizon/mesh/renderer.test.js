import { describe, expect, it } from 'vitest';
import { createMeshRenderer, lightVector } from './renderer.js';

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

  it('says so when the browser has no WebGL2, or no float targets to draw distances in', () => {
    expect(createMeshRenderer({ getContext: () => null })).toBeNull();
    expect(createMeshRenderer({ getContext: () => ({ getExtension: () => null }) })).toBeNull();
  });
});
