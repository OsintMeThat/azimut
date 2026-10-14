import { describe, expect, it } from 'vitest';
import {
  bubbleTail,
  CALLOUT_OFFSET,
  calloutBox,
  calloutInk,
  calloutToLabel,
  clampRect,
  insetBox,
  insetConnectors,
  insetHeight,
  insetPlacement,
  isPageMark,
  labelToCallout,
  nearestOnRect,
} from './pageMarks.js';

describe('which marks draw on the page', () => {
  it('names the callout and the inset, and nothing drawn inside a picture', () => {
    expect(isPageMark({ kind: 'callout' })).toBe(true);
    expect(isPageMark({ kind: 'zoom' })).toBe(true);
    for (const kind of ['rect', 'text', 'icon', 'number', 'blur', 'arrow']) {
      expect(isPageMark({ kind })).toBe(false);
    }
    expect(isPageMark(null)).toBe(false);
  });
});

describe('a callout label on the page', () => {
  it('centres its box on the tip plus its offset', () => {
    const box = calloutBox({ x: 100, y: 200 }, { dx: 50, dy: -40 }, 60, 20, 1000, 1000);
    expect(box).toEqual({ x: 120, y: 150, w: 60, h: 20 });
  });

  it('stays inside the document, which is all the export draws', () => {
    expect(calloutBox({ x: 990, y: 5 }, { dx: 50, dy: -40 }, 60, 20, 1000, 800))
      .toEqual({ x: 940, y: 0, w: 60, h: 20 });
  });

  it('reads its line and dot off its font size', () => {
    expect(calloutInk(22).line).toBe(2);
    expect(calloutInk(8).line).toBe(1.5);
    expect(calloutInk(44).dot).toBeCloseTo(8.8);
  });

  it('finds the side of the box a tip faces, and nothing under the box', () => {
    const box = { x: 10, y: 10, w: 100, h: 40 };
    expect(nearestOnRect({ x: 50, y: 100 }, box)).toEqual({ x: 50, y: 50, side: 'bottom' });
    expect(nearestOnRect({ x: -20, y: 30 }, box)).toEqual({ x: 10, y: 30, side: 'left' });
    expect(nearestOnRect({ x: 200, y: 0 }, box)).toMatchObject({ x: 110, y: 10, side: 'right' });
    expect(nearestOnRect({ x: 50, y: 30 }, box)).toBeNull();
  });

  it('draws a bubble tail from the facing side to the tip, off the corners', () => {
    const box = { x: 0, y: 0, w: 100, h: 40 };
    // tip below, near the left corner: the base slides right of the rounding
    expect(bubbleTail({ x: 2, y: 90 }, box, 8, 6)).toEqual([6, 39, 2, 90, 22, 39]);
    // tip to the right: the base stands on the right side
    expect(bubbleTail({ x: 160, y: 20 }, box, 8, 6)).toEqual([99, 12, 160, 20, 99, 28]);
    expect(bubbleTail({ x: 50, y: 20 }, box, 8, 6)).toBeNull();
  });

  it('keeps a moved rectangle its size', () => {
    expect(clampRect({ x: -5, y: 900, w: 10, h: 10 }, 100, 100)).toEqual({ x: 0, y: 90, w: 10, h: 10 });
  });
});

describe('a zoom inset', () => {
  it('keeps the frame’s proportions at its own width', () => {
    expect(insetHeight({ w: 40, h: 20, iw: 200 })).toBe(100);
    const box = insetBox({ x: 100, y: 100 }, { w: 40, h: 20, iw: 200, dx: 150, dy: 0 }, 1000, 1000);
    expect(box).toEqual({ x: 150, y: 50, w: 200, h: 100 });
  });

  it('goes beside its frame when the page has the room', () => {
    const frame = { x: 100, y: 100, w: 40, h: 40 };
    const picture = { x: 0, y: 0, w: 400, h: 400 };
    const placed = insetPlacement(frame, picture, 1000, 400);
    expect(placed.iw).toBe(100);
    expect(placed.dx).toBeCloseTo(20 + 24 + 50);
    expect(placed.dy).toBe(0);
  });

  it('takes the far corner of its picture when nothing fits beside it', () => {
    // a frame filling the bottom-right of a picture that fills the page
    const frame = { x: 180, y: 180, w: 200, h: 200 };
    const picture = { x: 0, y: 0, w: 400, h: 400 };
    const placed = insetPlacement(frame, picture, 400, 400);
    // up and to the left of a frame in the bottom-right corner
    expect(placed.dx).toBeLessThan(0);
    expect(placed.dy).toBeLessThan(0);
    expect(placed.iw).toBeLessThanOrEqual(400 * 0.4);
  });

  it('joins the facing sides of the frame and the inset', () => {
    const f = ['ftl', 'ftr', 'fbr', 'fbl'];
    const i = ['itl', 'itr', 'ibr', 'ibl'];
    expect(insetConnectors(f, i, { x: 1, y: 0 })).toEqual([['ftr', 'itl'], ['fbr', 'ibl']]);
    expect(insetConnectors(f, i, { x: -1, y: 0.2 })).toEqual([['ftl', 'itr'], ['fbl', 'ibr']]);
    expect(insetConnectors(f, i, { x: 0, y: 1 })).toEqual([['fbl', 'itl'], ['fbr', 'itr']]);
    expect(insetConnectors(f, i, { x: 0.1, y: -1 })).toEqual([['ftl', 'ibl'], ['ftr', 'ibr']]);
  });
});

describe('a label and a callout are one mark, with or without its pointer', () => {
  const label = { id: 's1', panel: 'p1', kind: 'text', color: '#f00', text: 'gate', fontSize: 30, x: 5, y: 5, frame: true };

  it('gives a label a pointer where it stood, and moves the label off it', () => {
    const callout = labelToCallout(label, { x: 40, y: 12 }, 'leader');
    expect(callout).toEqual({
      id: 's1', panel: 'p1', kind: 'callout', color: '#f00', text: 'gate', fontSize: 30,
      x: 40, y: 12, dx: CALLOUT_OFFSET.dx, dy: CALLOUT_OFFSET.dy, tail: 'leader',
    });
  });

  it('takes the pointer off into a framed label where the box stood', () => {
    const callout = labelToCallout(label, { x: 40, y: 12 }, 'bubble');
    expect(calloutToLabel(callout, { x: 70, y: -30 }, 0)).toEqual({
      id: 's1', panel: 'p1', kind: 'text', color: '#f00', text: 'gate', fontSize: 30,
      x: 70, y: -30, frame: true,
    });
    expect(calloutToLabel(callout, { x: 0, y: 0 }, -30).rotation).toBe(-30);
  });
});
