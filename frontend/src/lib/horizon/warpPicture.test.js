import { describe, expect, it } from 'vitest';
import { BEND_CELLS, drawLaid, drawStraightened, drawWarped, paintStraightened, paintWarped, PULL_PX, triangleTransform, WARP_CELLS } from './warpPicture.js';
import { bendShape, straightened } from './overlay.js';

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

  it('lays a photo as a search read it on its own grid, each cell by its middle, nothing where it lies nowhere', () => {
    const ctx = recorder();
    const laid = { us: [0, 0.5, 1], vs: [0, 1], place: (u, v, cell) => (cell.u > 0.5 ? null : { u: u + 0.1, v }) };
    expect(drawLaid(ctx, 'photo', { width: 100, height: 50 }, laid, { width: 100, height: 50 })).toBe(2);
    const draws = ctx.calls.filter(([kind]) => kind === 'draw');
    const [x, y] = apply(draws[0][1], [0, 0]);
    expect(x).toBeCloseTo(10, 6);
    expect(y).toBeCloseTo(0, 6);
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

describe('a photo straightened from its lens’s curve', () => {
  const SHAPE = bendShape(4 / 3);

  it('lays each cell’s corners where a straight lens would have put them', () => {
    const ctx = recorder();
    const laid = drawStraightened(ctx, 'photo', { width: 400, height: 300 }, -0.12, SHAPE, { width: 400, height: 300 }, 4);
    expect(laid).toBe(32);
    const draws = ctx.calls.filter(([kind]) => kind === 'draw');
    // the photo's top left corner goes out past the frame, as a barrel's corners do once straightened
    const corner = straightened({ u: 0, v: 0 }, -0.12, SHAPE);
    const [x, y] = apply(draws[0][1], [0, 0]);
    expect(x).toBeCloseTo(corner.u * 400, 6);
    expect(y).toBeCloseTo(corner.v * 300, 6);
    expect(corner.u).toBeLessThan(0);
    // the middle stays put
    const middle = draws.find(([, transform]) => {
      const [mx, my] = apply(transform, [200, 150]);
      return Math.abs(mx - 200) < 1e-6 && Math.abs(my - 150) < 1e-6;
    });
    expect(middle).toBeTruthy();
  });

  it('is the photo as it is with no curve', () => {
    const ctx = recorder();
    drawStraightened(ctx, 'photo', { width: 400, height: 300 }, 0, SHAPE, { width: 200, height: 150 }, 2);
    const [, transform] = ctx.calls.find(([kind]) => kind === 'draw');
    expect(apply(transform, [400, 300])).toEqual([200, 150]);
  });

  it('draws at the photo’s own size, lighter while the curve is being set, and a video’s frame as a photo', () => {
    globalThis.OffscreenCanvas = class {
      constructor(width, height) {
        Object.assign(this, { width, height });
      }
      getContext() {
        return recorder();
      }
    };
    try {
      const fine = paintStraightened({ width: 4000, height: 3000 }, 0.1, SHAPE);
      expect([fine.width, fine.height]).toEqual([4000, 3000]);
      const fast = paintStraightened({ width: 4000, height: 3000 }, 0.1, SHAPE, { fast: true });
      expect(fast.width).toBe(PULL_PX);
      expect(BEND_CELLS.fast).toBeLessThan(BEND_CELLS.fine);
      const video = paintStraightened({ width: 0, height: 0, videoWidth: 1920, videoHeight: 1080 }, 0.1, SHAPE);
      expect([video.width, video.height]).toEqual([1920, 1080]);
      expect(paintStraightened({ width: 0, height: 0 }, 0.1, SHAPE)).toBeNull();
    } finally {
      delete globalThis.OffscreenCanvas;
    }
  });
});
