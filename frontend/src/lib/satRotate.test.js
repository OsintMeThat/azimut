import { describe, it, expect } from 'vitest';
import { dragBearing, pivotPanOffset } from './satRotate.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

describe('dragBearing', () => {
  const pivot = { x: 100, y: 100 };

  it('adds the swept angle to the starting bearing', () => {
    // start due east of the pivot, sweep to due south → +90° (screen, Y down)
    const b = dragBearing(30, pivot, { x: 200, y: 100 }, { x: 100, y: 200 });
    expect(near(b, 120)).toBe(true);
  });

  it('turns the other way when the sweep reverses', () => {
    // east → north is -90°
    const b = dragBearing(0, pivot, { x: 200, y: 100 }, { x: 100, y: 0 });
    expect(near(b, -90)).toBe(true);
  });

  it('is a no-op when the cursor has not moved off the reference spoke', () => {
    const b = dragBearing(42, pivot, { x: 160, y: 100 }, { x: 160, y: 100 });
    expect(near(b, 42)).toBe(true);
  });
});

describe('pivotPanOffset', () => {
  it('cancels the drift so panBy re-pins the pivot under the grab point', () => {
    // Leaflet shifts container points by -offset; panning by (now-grab) moves
    // the drifted pivot (now) back onto grab.
    const grab = { x: 120, y: 80 };
    const now = { x: 135, y: 60 };
    const [dx, dy] = pivotPanOffset(grab, now);
    expect([dx, dy]).toEqual([15, -20]);
    // apply the -offset shift Leaflet performs → pivot lands back on grab
    expect(now.x - dx).toBe(grab.x);
    expect(now.y - dy).toBe(grab.y);
  });

  it('is zero when the pivot did not drift', () => {
    expect(pivotPanOffset({ x: 10, y: 10 }, { x: 10, y: 10 })).toEqual([0, 0]);
  });
});
