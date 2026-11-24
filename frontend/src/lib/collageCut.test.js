import { describe, expect, it } from 'vitest';
import {
  cutOf, cutStart, dragCut, filledCells, frameQuad, largestFilled, piecesFrame, sameCut, snapLines, trimFrame,
} from './collageCut.js';

const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const pieces = [{ quad: rect(0, 0, 100, 60) }, { quad: rect(80, 10, 100, 70) }];

describe('where a cut starts', () => {
  it('starts at the frame the collage keeps, else round every piece', () => {
    expect(piecesFrame(pieces)).toEqual({ x: 0, y: 0, w: 180, h: 80 });
    expect(cutStart(pieces, null)).toEqual({ x: 0, y: 0, w: 180, h: 80 });
    expect(cutStart(pieces, { x: 5, y: 5, w: 50, h: 50 })).toEqual({ x: 5, y: 5, w: 50, h: 50 });
    expect(cutStart([], null)).toBeNull();
  });

  it('snaps to every piece corner\'s side and height, a ragged edge\'s highest bottom among them', () => {
    const { xs, ys } = snapLines(pieces);
    expect(xs.sort((a, b) => a - b)).toEqual([0, 80, 100, 180]);
    expect(ys.sort((a, b) => a - b)).toEqual([0, 10, 60, 80]);
  });
});

describe('dragging the frame', () => {
  const start = { x: 0, y: 0, w: 180, h: 80 };

  it('moves the edge in hand and holds the opposite one', () => {
    expect(dragCut(start, 's', [3, -15])).toEqual({ x: 0, y: 0, w: 180, h: 65 });
    expect(dragCut(start, 'w', [20, 9])).toEqual({ x: 20, y: 0, w: 160, h: 80 });
    expect(dragCut(start, 'ne', [-30, 12])).toEqual({ x: 0, y: 12, w: 150, h: 68 });
  });

  it('never lets an edge cross the other, keeping the smallest side', () => {
    expect(dragCut(start, 's', [0, -500], { min: 8 })).toEqual({ x: 0, y: 0, w: 180, h: 8 });
    expect(dragCut(start, 'e', [-500, 0], { min: 8 })).toEqual({ x: 0, y: 0, w: 8, h: 80 });
  });

  it('snaps an edge near a piece\'s side, and lets it go past the reach', () => {
    const snaps = snapLines(pieces);
    expect(dragCut(start, 's', [0, -17], { snaps, reach: 4 }).h).toBe(60);
    expect(dragCut(start, 's', [0, -30], { snaps, reach: 4 }).h).toBe(50);
  });

  it('carries the frame whole, snapping by its nearer edge', () => {
    const small = { x: 20, y: 20, w: 40, h: 30 };
    expect(dragCut(small, 'move', [5, -3])).toEqual({ x: 25, y: 17, w: 40, h: 30 });
    // its right edge comes within reach of 100
    expect(dragCut(small, 'move', [38, 0], { snaps: snapLines(pieces), reach: 3 })).toEqual({ x: 60, y: 20, w: 40, h: 30 });
  });
});

describe('applying a frame', () => {
  it('keeps it rounded to a hundredth of a pixel', () => {
    expect(cutOf({ x: 0.123, y: 4.5678, w: 120.001, h: 40 }, pieces)).toEqual({ x: 0.12, y: 4.57, w: 120, h: 40 });
  });

  it('cuts nothing when the frame holds every piece whole', () => {
    expect(cutOf({ x: -10, y: -10, w: 300, h: 300 }, pieces)).toBeNull();
    expect(cutOf({ x: 0, y: 0, w: 180, h: 80 }, pieces)).toBeNull();
    expect(cutOf(null, pieces)).toBeNull();
  });

  it('reads a frame as the quad of its corners', () => {
    expect(frameQuad({ x: 1, y: 2, w: 3, h: 4 })).toEqual(rect(1, 2, 3, 4));
  });
});

describe('trimming the empty edges', () => {
  /** A grid from rows of '#' (filled) and '.' (empty). */
  const grid = (...rows) => ({ cells: Uint8Array.from(rows.join('').split(''), (c) => (c === '#' ? 1 : 0)), cols: rows[0].length, rows: rows.length });
  const largest = (g) => largestFilled(g.cells, g.cols, g.rows);

  it('finds the largest rectangle of filled cells', () => {
    expect(largest(grid(
      '..##....',
      '.#####..',
      '.######.',
      '..#####.',
      '...#....',
    ))).toEqual({ x: 2, y: 1, w: 4, h: 3 });
    expect(largest(grid('####', '####'))).toEqual({ x: 0, y: 0, w: 4, h: 2 });
    // a tall thin one beats a short wide one
    expect(largest(grid('#....', '#....', '#....', '#....', '###..'))).toEqual({ x: 0, y: 0, w: 1, h: 5 });
    expect(largest(grid('....', '....'))).toBeNull();
  });

  it('agrees with every rectangle tried one by one', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let n = 0; n < 40; n += 1) {
      const cols = 3 + Math.floor(rand() * 9);
      const rows = 3 + Math.floor(rand() * 9);
      const cells = Uint8Array.from({ length: cols * rows }, () => (rand() < 0.75 ? 1 : 0));
      let most = 0;
      for (let y0 = 0; y0 < rows; y0 += 1) for (let x0 = 0; x0 < cols; x0 += 1)
        for (let y1 = y0; y1 < rows; y1 += 1) for (let x1 = x0; x1 < cols; x1 += 1) {
          let all = true;
          for (let y = y0; all && y <= y1; y += 1) for (let x = x0; all && x <= x1; x += 1) all = cells[y * cols + x] === 1;
          if (all) most = Math.max(most, (x1 - x0 + 1) * (y1 - y0 + 1));
        }
      const got = largestFilled(cells, cols, rows);
      expect(got ? got.w * got.h : 0).toBe(most);
      if (got) for (let y = got.y; y < got.y + got.h; y += 1) for (let x = got.x; x < got.x + got.w; x += 1) expect(cells[y * cols + x]).toBe(1);
    }
  });

  it('counts a cell filled only when it and every neighbour are, the grid\'s own sides apart', () => {
    const cover = [255, 255, 255, 255, 255, 255, 255, 249, 255, 255, 255, 255];
    const rgba = Uint8ClampedArray.from(cover.flatMap((a) => [0, 0, 0, a]));
    // 4 × 3, one cell short of full cover: it and the cells round it are left out
    expect([...filledCells(rgba, 4, 3)]).toEqual([
      1, 1, 0, 0,
      1, 1, 0, 0,
      1, 1, 0, 0,
    ]);
  });

  it('reads the pieces as drawn and answers the frame they fill in canvas pixels', async () => {
    const pieces = [
      { id: 'a', url: 'blob:a', quad: rect(10, 20, 100, 40), w: 100, h: 40 },
      { id: 'b', url: 'blob:b', quad: rect(60, 30, 150, 40), w: 150, h: 40 },
      { id: 'c', url: null, missing: true, quad: rect(10, 20, 20, 20), w: 20, h: 20 },
    ];
    const asked = [];
    // the box is 200 × 50 canvas pixels, read at 8 × 2 cells: the left cells of the lower row empty
    const cover = [
      255, 255, 255, 255, 255, 255, 255, 255,
      255, 255, 255, 255, 255, 255, 255, 255,
    ].map((a, i) => (i >= 8 && i < 10 ? 0 : a));
    const drawn = [];
    const canvas = (width, height) => ({
      getContext: () => new Proxy({}, {
        get: (_, name) => (name === 'getImageData'
          ? (x, y, w, h) => (asked.push([x, y, w, h, width, height]), { data: Uint8ClampedArray.from(cover.flatMap((a) => [0, 0, 0, a])) })
          : (...args) => drawn.push([name, ...args])),
        set: () => true,
      }),
    });
    const load = async (url) => ({ url, naturalWidth: 10, naturalHeight: 10 });
    const frame = await trimFrame(pieces, { load, edge: 8, canvas });
    expect(asked).toEqual([[0, 0, 8, 2, 8, 2]]);
    // drawn as they stack, a lost piece hatched, no seam cut
    expect(drawn.filter(([name]) => name === 'drawImage').map(([, image]) => image.url)).toEqual(['blob:a', 'blob:b']);
    expect(drawn.some(([name, rule]) => name === 'clip' && rule === 'evenodd')).toBe(false);
    // the lower row's two left cells are empty, and the cells beside them left out: the right five of both
    expect(frame).toEqual({ x: 10 + 3 * 25, y: 20, w: 5 * 25, h: 50 });
  });

  it('keeps the same cut, to a hundredth of a pixel', () => {
    expect(sameCut(null, null)).toBe(true);
    expect(sameCut({ x: 1, y: 2, w: 3, h: 4 }, null)).toBe(false);
    expect(sameCut({ x: 1, y: 2, w: 3, h: 4 }, { x: 1.004, y: 2, w: 3, h: 4 })).toBe(true);
    expect(sameCut({ x: 1, y: 2, w: 3, h: 4 }, { x: 1.02, y: 2, w: 3, h: 4 })).toBe(false);
  });
});
