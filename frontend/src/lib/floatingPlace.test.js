import { describe, expect, it } from 'vitest';
import { GAP, MARGIN, placeFloating } from './floatingPlace.js';

const viewport = { width: 1000, height: 700 };
const size = { width: 220, height: 200 };
const box = (left, top, width = 26, height = 26) => ({ left, top, right: left + width, bottom: top + height });

describe('placeFloating', () => {
  it('opens under its opener, lined up on its left edge', () => {
    expect(placeFloating({ anchor: box(300, 100), size, viewport })).toEqual({ left: 300, top: 126 + GAP, maxHeight: 700 - 2 * MARGIN });
  });

  it('never leaves the window on the left, the bug a right-aligned menu in a narrow panel had', () => {
    // a 220 px menu lined up on the right of an opener 170 px into the window
    expect(placeFloating({ anchor: box(144, 100), size, viewport, align: 'end' }).left).toBe(MARGIN);
    expect(placeFloating({ anchor: box(950, 100), size, viewport }).left).toBe(1000 - MARGIN - 220);
  });

  it('opens upward near the bottom when there is more room above', () => {
    expect(placeFloating({ anchor: box(300, 600), size, viewport }).top).toBe(600 - GAP - 200);
    // no room either way: down, clamped inside the window
    expect(placeFloating({ anchor: box(300, 20), size: { width: 220, height: 900 }, viewport }).top).toBe(MARGIN);
  });

  it('opens at the pointer for a right-click and flips above it at the bottom', () => {
    expect(placeFloating({ at: { x: 500, y: 300 }, size, viewport })).toMatchObject({ left: 500, top: 300 });
    expect(placeFloating({ at: { x: 990, y: 650 }, size, viewport })).toMatchObject({ left: 1000 - MARGIN - 220, top: 450 });
  });
});
