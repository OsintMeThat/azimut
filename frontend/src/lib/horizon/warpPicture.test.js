import { describe, expect, it } from 'vitest';
import { drawWarped, paintWarped, PULL_PX, triangleTransform, WARP_CELLS } from './warpPicture.js';

/** A 2D context that keeps what it was asked to do. */
function recorder() {
  const calls = [];
  let transform = [1, 0, 0, 1, 0, 0];
  const ctx = {
    calls,
    setTransform: (...m) => (transform = m),
    clearRect: () => calls.push(['clear']),
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    clip: () => {},
    drawImage: (...args) => calls.push(['draw', transform, args]),
  };
  return ctx;
}

const apply = ([a, b, c, d, e, f], [x, y]) => [a * x + c * y + e, b * x + d * y + f];

describe('a pulled photo drawn as a picture', () => {
  it('finds the flat transform that takes one triangle onto another', () => {
    const from = [[0, 0], [100, 0], [0, 50]];
    const to = [[10, 20], [210, 40], [5, 120]];
    const m = triangleTransform(from, to);
    from.forEach((point, index) => {
      const [x, y] = apply(m, point);
      expect(x).toBeCloseTo(to[index][0], 9);
      expect(y).toBeCloseTo(to[index][1], 9);
    });
    expect(triangleTransform([[0, 0], [1, 1], [2, 2]], to)).toBeNull();
  });

  it('lays the photo as two triangles a cell, each from its own pixels, onto the pulled corners', () => {
    const ctx = recorder();
    const corners = [
      { u: 0.1, v: 0 },
      { u: 1, v: 0.1 },
      { u: 0.9, v: 1 },
      { u: 0, v: 0.9 },
    ];
    const laid = drawWarped(ctx, 'photo', { width: 400, height: 300 }, corners, { width: 400, height: 300 }, 4);
    expect(laid).toBe(32);
    const draws = ctx.calls.filter(([kind]) => kind === 'draw');
    expect(draws).toHaveLength(32);
    // the first triangle takes the photo's top left corner to where it was pulled
    const [x, y] = apply(draws[0][1], [0, 0]);
    expect(x).toBeCloseTo(40, 6);
    expect(y).toBeCloseTo(0, 6);
    // and reads only its cell, a pixel wide
    const [, , [, sx, sy, sw, sh]] = draws[0];
    expect([sx, sy, sw, sh]).toEqual([0, 0, 101, 76]);
  });

  it('lays nothing for corners folded onto a line', () => {
    const ctx = recorder();
    const folded = [
      { u: 0, v: 0 },
      { u: 0.5, v: 0 },
      { u: 1, v: 0 },
      { u: 0.3, v: 0 },
    ];
    expect(drawWarped(ctx, 'photo', { width: 10, height: 10 }, folded, { width: 10, height: 10 })).toBe(0);
  });

  it('draws lighter while a corner is in the hand', () => {
    const made = [];
    globalThis.OffscreenCanvas = class {
      constructor(width, height) {
        Object.assign(this, { width, height });
        made.push(this);
      }
      getContext() {
        return recorder();
      }
    };
    try {
      const corners = [
        { u: 0, v: 0 },
        { u: 1, v: 0.1 },
        { u: 1, v: 1 },
        { u: 0, v: 1 },
      ];
      const fine = paintWarped({ width: 4000, height: 3000 }, corners);
      expect([fine.width, fine.height]).toEqual([4000, 3000]);
      const fast = paintWarped({ width: 4000, height: 3000 }, corners, { fast: true });
      expect(fast.width).toBe(PULL_PX);
      expect(fast.height).toBe(768);
      expect(WARP_CELLS.fast).toBeLessThan(WARP_CELLS.fine);
      expect(paintWarped({ width: 0, height: 0 }, corners)).toBeNull();
    } finally {
      delete globalThis.OffscreenCanvas;
    }
  });
});
