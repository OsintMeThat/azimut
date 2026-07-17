import { describe, it, expect } from 'vitest';
import {
  clampCrop, moveCrop, resizeCropByHandle,
  QUAD_SIDES, quadEdgeMidpoints, moveQuadEdge, quadCentroid,
  quadsBounds, translateQuad, moveQuads, rotateQuads, scaleQuads, pinholeOps,
} from './inspect.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

describe('pinholeOps', () => {
  const remap = { op: 'remap', params: { warp: 'cylindrical' } };
  const bright = { op: 'brightness', params: { amount: 1.2 } };

  it('leaves a piece that was never stitched alone', () => {
    expect(pinholeOps({ ops: [bright] })).toEqual([bright]);
  });
  it('drops a solved warp so a re-stitch never compounds two projections', () => {
    expect(pinholeOps({ ops: [bright, remap] })).toEqual([bright]);
  });
  it('drops every warp, however many stitches a piece has been through', () => {
    expect(pinholeOps({ ops: [remap, bright, remap] })).toEqual([bright]);
  });
  it('handles a recipe with no ops at all', () => {
    expect(pinholeOps({})).toEqual([]);
    expect(pinholeOps(null)).toEqual([]);
  });
});

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

// ---------------------------------------------------------------------------
// Multi-select group transforms: the block moves/turns/grows as one rigid unit
// about a shared pivot, so an off-centre piece is carried around the block's
// centre rather than spinning about its own.
// ---------------------------------------------------------------------------

// two 10x10 squares side by side: group box 0..30 x 0..10, centre [15, 5]
const sqA = [[0, 0], [10, 0], [10, 10], [0, 10]];
const sqB = [[20, 0], [30, 0], [30, 10], [20, 10]];

describe('quadsBounds', () => {
  it('spans every quad of the group and centres between them', () => {
    expect(quadsBounds([sqA, sqB])).toMatchObject({
      minX: 0, minY: 0, maxX: 30, maxY: 10, width: 30, height: 10, center: [15, 5],
    });
  });

  it('is the quad itself for a single-piece selection', () => {
    expect(quadsBounds([sqA])).toMatchObject({ minX: 0, maxX: 10, center: [5, 5] });
  });

  it('covers a rotated/warped quad by its extreme corners', () => {
    const warped = [[10, 5], [110, 0], [120, 90], [0, 85]];
    expect(quadsBounds([warped])).toMatchObject({ minX: 0, minY: 0, maxX: 120, maxY: 90 });
  });

  it('returns null for an empty selection', () => {
    expect(quadsBounds([])).toBe(null);
  });
});

describe('translateQuad + moveQuads', () => {
  it('shifts a single quad by the delta', () => {
    expect(translateQuad(sqA, 5, -3)).toEqual([[5, -3], [15, -3], [15, 7], [5, 7]]);
  });

  it('shifts every quad of the group by the same delta (block keeps its shape)', () => {
    const [a, b] = moveQuads([sqA, sqB], 100, 50);
    expect(a).toEqual([[100, 50], [110, 50], [110, 60], [100, 60]]);
    expect(b).toEqual([[120, 50], [130, 50], [130, 60], [120, 60]]);
    // the gap between the two pieces is untouched
    expect(quadsBounds([a, b]).width).toBe(quadsBounds([sqA, sqB]).width);
  });

  it('does not mutate the input quads', () => {
    moveQuads([sqA], 10, 10);
    expect(sqA).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]);
  });
});

describe('rotateQuads — the block turns as one', () => {
  it('half-turns the group about its centre, swapping the two pieces over', () => {
    const [a, b] = rotateQuads([sqA, sqB], Math.PI);
    // A lands on B's box and vice versa — proof the pivot is the *group* centre
    expect(quadsBounds([a]).minX).toBeCloseTo(20);
    expect(quadsBounds([a]).maxX).toBeCloseTo(30);
    expect(quadsBounds([b]).minX).toBeCloseTo(0);
    expect(quadsBounds([b]).maxX).toBeCloseTo(10);
  });

  it('carries an off-centre piece around instead of spinning it in place', () => {
    const [a] = rotateQuads([sqA, sqB], Math.PI / 2);
    // a per-piece rotation would have left A's centroid at (5, 5)
    expect(quadCentroid(a)).not.toEqual([5, 5]);
  });

  it('is rigid — the distance between the pieces is preserved', () => {
    const d0 = Math.hypot(...quadCentroid(sqA).map((v, i) => v - quadCentroid(sqB)[i]));
    const [a, b] = rotateQuads([sqA, sqB], 0.7);
    const d1 = Math.hypot(...quadCentroid(a).map((v, i) => v - quadCentroid(b)[i]));
    expect(d1).toBeCloseTo(d0);
  });

  it('leaves the group centre fixed', () => {
    const out = rotateQuads([sqA, sqB], 0.4);
    const c = quadsBounds(out).center;
    expect(c[0]).toBeCloseTo(15);
    expect(c[1]).toBeCloseTo(5);
  });

  it('rotating out and back returns to the start', () => {
    const out = rotateQuads(rotateQuads([sqA, sqB], 0.9, [15, 5]), -0.9, [15, 5]);
    expect(out[0][0][0]).toBeCloseTo(0);
    expect(out[0][0][1]).toBeCloseTo(0);
    expect(out[1][2][0]).toBeCloseTo(30);
  });

  it('honours an explicit pivot over the group centre', () => {
    const [a] = rotateQuads([sqA], Math.PI, [0, 0]); // pivot at A's own corner
    const b = quadsBounds([a]);
    expect(b.minX).toBeCloseTo(-10);
    expect(b.minY).toBeCloseTo(-10);
    expect(b.maxX).toBeCloseTo(0);
    expect(b.maxY).toBeCloseTo(0);
  });

  it('returns an empty array for an empty selection', () => {
    expect(rotateQuads([], 1)).toEqual([]);
  });
});

describe('scaleQuads — the block grows as one', () => {
  it('scales the whole group box about its centre', () => {
    const out = scaleQuads([sqA, sqB], 2);
    const b = quadsBounds(out);
    expect(b.width).toBeCloseTo(60); // 2x the original 30
    expect(b.center[0]).toBeCloseTo(15); // centre pinned
    expect(b.center[1]).toBeCloseTo(5);
  });

  it('pushes the pieces apart, not just enlarges each in place', () => {
    const [a, b] = scaleQuads([sqA, sqB], 2);
    const gap = quadsBounds([b]).minX - quadsBounds([a]).maxX;
    const gap0 = sqB[0][0] - sqA[1][0]; // 10
    expect(gap).toBeCloseTo(gap0 * 2);
  });

  it('shrinking then growing back returns to the start', () => {
    const out = scaleQuads(scaleQuads([sqA, sqB], 0.25, [15, 5]), 4, [15, 5]);
    expect(out[0][0][0]).toBeCloseTo(0);
    expect(out[1][2][0]).toBeCloseTo(30);
  });

  it('returns an empty array for an empty selection', () => {
    expect(scaleQuads([], 2)).toEqual([]);
  });
});
