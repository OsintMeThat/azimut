import { describe, expect, it } from 'vitest';
import { cutOf, cutStart, dragCut, frameQuad, piecesFrame, snapLines } from './collageCut.js';

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
