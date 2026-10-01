import { describe, expect, it } from 'vitest';
import {
  affineFromTriangles, isParallelogram, paintCollage, pieceTriangles, thumbFrame, THUMB_EDGE,
} from './collageThumb.js';

const apply = ([a, b, c, d, e, f], [x, y]) => [a * x + c * y + e, b * x + d * y + f];
const close = (p, q) => expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeLessThan(1e-6);

const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

function recorder() {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (_, name) => (...args) => calls.push([name, ...args]),
    set: (_, name, value) => (calls.push([`=${String(name)}`, value]), true),
  });
  return { ctx, calls, named: (n) => calls.filter((c) => c[0] === n) };
}

describe('affineFromTriangles', () => {
  it('sends each corner of one triangle onto the other', () => {
    const s = [[0, 0], [100, 0], [0, 50]];
    const d = [[10, 20], [60, 45], [-5, 70]];
    const m = affineFromTriangles(s, d);
    s.forEach((p, i) => close(apply(m, p), d[i]));
  });

  it('has no map for a triangle with no area', () => {
    expect(affineFromTriangles([[0, 0], [1, 1], [2, 2]], [[0, 0], [1, 0], [0, 1]])).toBeNull();
  });
});

describe('pieceTriangles', () => {
  it('draws a rotated rectangle in one cell, exactly', () => {
    const quad = [[50, 0], [100, 50], [50, 100], [0, 50]];
    expect(isParallelogram(quad)).toBe(true);
    const tris = pieceTriangles(80, 60, quad);
    expect(tris).toHaveLength(2);
    const m = affineFromTriangles(tris[0].src, tris[0].dst);
    close(apply(m, [80, 60]), [50, 100]); // the far corner lands too
  });

  it('cuts a warped piece into a grid that still meets its four corners', () => {
    const quad = [[0, 0], [100, 10], [90, 80], [5, 60]];
    expect(isParallelogram(quad)).toBe(false);
    const tris = pieceTriangles(200, 100, quad);
    expect(tris.length).toBeGreaterThan(2);
    const dst = tris.flatMap((t) => t.dst);
    for (const corner of quad) expect(dst.some((p) => Math.hypot(p[0] - corner[0], p[1] - corner[1]) < 1e-6)).toBe(true);
    for (const t of tris) t.src.forEach(([x, y]) => {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(200);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(100);
    });
  });
});

describe('thumbFrame', () => {
  it('trims to the pieces and shrinks them to the preview edge', () => {
    const frame = thumbFrame([{ quad: rect(100, 50, 1200, 400) }, { quad: rect(1300, 50, 200, 600) }]);
    expect(frame.minX).toBe(100);
    expect(frame.minY).toBe(50);
    expect(frame.width).toBe(THUMB_EDGE);
    expect(frame.height).toBe(Math.round(600 * (THUMB_EDGE / 1400)));
  });

  it('never enlarges a small collage, and has nothing for an empty one', () => {
    expect(thumbFrame([{ quad: rect(0, 0, 120, 80) }])).toMatchObject({ scale: 1, width: 120, height: 80 });
    expect(thumbFrame([])).toBeNull();
  });
});

describe('paintCollage', () => {
  const frame = { minX: 0, minY: 0, scale: 1, width: 300, height: 100 };

  it('draws a loaded piece, hatches a lost one and leaves out one still rendering', () => {
    const { ctx, named } = recorder();
    const image = { naturalWidth: 80, naturalHeight: 60 };
    const nodes = [
      { id: 'a', quad: rect(0, 0, 80, 60), w: 80, h: 60 },
      { id: 'b', quad: rect(100, 0, 80, 60), w: 80, h: 60, missing: true },
      { id: 'c', quad: rect(200, 0, 80, 60), w: 80, h: 60 },
    ];

    paintCollage(ctx, nodes, new Map([['a', image]]), frame);

    expect(named('drawImage')).toEqual([['drawImage', image, 0, 0]]); // a rectangle in one draw
    expect(named('clip')).toHaveLength(0);
    expect(named('fill')).toHaveLength(1); // the lost piece's gap
  });

  it('draws a warped piece cell by cell, each clipped to its own triangle', () => {
    const { ctx, named } = recorder();
    const image = { naturalWidth: 80, naturalHeight: 60 };
    const quad = [[0, 0], [100, 10], [90, 80], [5, 60]];

    paintCollage(ctx, [{ id: 'a', quad }], new Map([['a', image]]), frame);

    const cells = pieceTriangles(80, 60, quad).length;
    expect(named('drawImage')).toHaveLength(cells);
    expect(named('clip')).toHaveLength(cells);
  });

  it('draws the pieces bottom to top, in the order the canvas stacks them', () => {
    const { ctx, named } = recorder();
    const low = { naturalWidth: 10, naturalHeight: 10, name: 'low' };
    const high = { naturalWidth: 10, naturalHeight: 10, name: 'high' };
    const nodes = [{ id: 'low', quad: rect(0, 0, 10, 10) }, { id: 'high', quad: rect(5, 5, 10, 10) }];

    paintCollage(ctx, nodes, new Map([['low', low], ['high', high]]), frame);

    expect(named('drawImage').map((c) => c[1].name)).toEqual(['low', 'high']);
  });
});
