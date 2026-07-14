import { describe, it, expect } from 'vitest';
import {
  clampCrop, moveCrop, resizeCropByHandle,
  QUAD_SIDES, quadEdgeMidpoints, moveQuadEdge, quadCentroid,
} from './inspect.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

describe('clampCrop', () => {
  it('keeps a valid crop untouched', () => {
    expect(clampCrop({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 })).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 });
  });
  it('clamps size and pushes the box back inside the image', () => {
    const c = clampCrop({ x: 0.8, y: 0.9, w: 0.5, h: 0.4 });
    expect(c.x + c.w).toBeLessThanOrEqual(1 + 1e-9);
    expect(c.y + c.h).toBeLessThanOrEqual(1 + 1e-9);
  });
  it('enforces a minimum size', () => {
    expect(clampCrop({ x: 0, y: 0, w: 0.001, h: 0.001 }, 0.02)).toMatchObject({ w: 0.02, h: 0.02 });
  });
});

describe('moveCrop', () => {
  it('translates within bounds', () => {
    const c = moveCrop({ x: 0.2, y: 0.2, w: 0.3, h: 0.3 }, 0.1, -0.1);
    expect(near(c.x, 0.3)).toBe(true);
    expect(near(c.y, 0.1)).toBe(true);
    expect(c.w).toBe(0.3);
    expect(c.h).toBe(0.3);
  });
  it('stops the box at the image edge instead of overflowing', () => {
    const c = moveCrop({ x: 0.6, y: 0.6, w: 0.3, h: 0.3 }, 0.5, 0.5);
    expect(near(c.x, 0.7)).toBe(true);
    expect(near(c.y, 0.7)).toBe(true);
  });
});

describe('resizeCropByHandle', () => {
  const base = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 }; // corners at 0.2 and 0.6

  it('drags the SE corner, keeping the NW corner fixed', () => {
    const c = resizeCropByHandle(base, 'se', 0.8, 0.9);
    expect(c.x).toBe(0.2);
    expect(c.y).toBe(0.2);
    expect(near(c.w, 0.6)).toBe(true);
    expect(near(c.h, 0.7)).toBe(true);
  });

  it('drags the N edge, moving only the top', () => {
    const c = resizeCropByHandle(base, 'n', 0.5, 0.1);
    expect(near(c.y, 0.1)).toBe(true);
    expect(near(c.h, 0.5)).toBe(true);
    expect(c.x).toBe(0.2);
    expect(near(c.w, 0.4)).toBe(true);
  });

  it('drags the W edge, moving only the left', () => {
    const c = resizeCropByHandle(base, 'w', 0.35, 0.5);
    expect(near(c.x, 0.35)).toBe(true);
    expect(near(c.w, 0.25)).toBe(true);
  });

  it('never lets an edge cross past the opposite one', () => {
    const c = resizeCropByHandle(base, 'e', 0.0, 0.5, null, 0.05);
    expect(c.w).toBeGreaterThanOrEqual(0.05 - 1e-9);
    expect(c.x).toBe(0.2);
  });

  it('keeps the aspect ratio on a corner drag', () => {
    // fracAspect 2 → width twice the height
    const c = resizeCropByHandle(base, 'se', 0.8, 0.65, 2);
    expect(near(c.w / c.h, 2)).toBe(true);
    expect(c.x).toBe(0.2);
    expect(c.y).toBe(0.2);
  });

  it('keeps aspect on a vertical edge by growing height about the centre', () => {
    const c = resizeCropByHandle(base, 'e', 0.7, 0.5, 1); // square lock
    // width becomes 0.5, height follows to 0.5, recentred on old centre (0.4)
    expect(near(c.w, c.h)).toBe(true);
    expect(near(c.y + c.h / 2, 0.4, 1e-6)).toBe(true);
  });
});

describe('quad side resize', () => {
  const rect = [[0, 0], [100, 0], [100, 80], [0, 80]]; // TL,TR,BR,BL

  it('exposes an edge midpoint per side', () => {
    expect(QUAD_SIDES.length).toBe(4);
    const mids = quadEdgeMidpoints(rect);
    expect(mids[0]).toMatchObject({ side: 0, x: 50, y: 0 }); // top
    expect(mids[2]).toMatchObject({ side: 2, x: 50, y: 80 }); // bottom
  });

  it('grows the rect by dragging the right edge outward', () => {
    const out = moveQuadEdge(rect, 1, 40, 0); // right edge, drag +x
    expect(out[1][0]).toBe(140); // TR moved out
    expect(out[2][0]).toBe(140); // BR moved out
    expect(out[0]).toEqual([0, 0]); // left edge fixed
    expect(out[3]).toEqual([0, 80]);
  });

  it('ignores drag parallel to the edge (projects onto the normal)', () => {
    const out = moveQuadEdge(rect, 1, 0, 30); // right edge, drag along the edge
    expect(out[1][0]).toBe(100);
    expect(out[2][0]).toBe(100);
  });

  it('keeps the opposite edge fixed on a warped quad', () => {
    const warped = [[10, 5], [110, 0], [120, 90], [0, 85]];
    const out = moveQuadEdge(warped, 0, 0, -20); // top edge outward (up)
    // bottom corners unchanged
    expect(out[2]).toEqual(warped[2]);
    expect(out[3]).toEqual(warped[3]);
    // top corners moved
    expect(out[0]).not.toEqual(warped[0]);
    expect(out[1]).not.toEqual(warped[1]);
  });

  it('moving an edge out then back returns near the start', () => {
    const c0 = quadCentroid(rect);
    const out = moveQuadEdge(moveQuadEdge(rect, 1, 40, 0), 1, -40, 0);
    const c1 = quadCentroid(out);
    expect(near(c0[0], c1[0], 1e-9)).toBe(true);
  });
});
