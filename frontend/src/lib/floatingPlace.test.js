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
    // no room either way, nor beside it: down, clamped inside the window
    expect(placeFloating({ anchor: box(150, 20), size: { width: 220, height: 900 }, viewport: { width: 400, height: 700 } }))
      .toMatchObject({ left: 150, top: MARGIN });
  });

  it('opens beside its opener when it fits neither under nor over it, on the side with more room', () => {
    // a style button low in the right-hand panel: the palette goes over the map on its left, as tall as the window
    const tall = { width: 256, height: 560 };
    expect(placeFloating({ anchor: box(700, 520), size: tall, viewport })).toEqual({ left: 700 - GAP - 256, top: 700 - MARGIN - 560, maxHeight: 700 - 2 * MARGIN });
    // near the window's left, it goes right; level with the opener when the window allows
    expect(placeFloating({ anchor: box(40, 300), size: tall, viewport })).toMatchObject({ left: 66 + GAP, top: 313 - 280 });
    // a menu taller than the window takes all of it
    expect(placeFloating({ anchor: box(700, 300), size: { width: 256, height: 900 }, viewport }).top).toBe(MARGIN);
  });

  it('opens at the pointer for a right-click and flips above it at the bottom', () => {
    expect(placeFloating({ at: { x: 500, y: 300 }, size, viewport })).toMatchObject({ left: 500, top: 300 });
    expect(placeFloating({ at: { x: 990, y: 650 }, size, viewport })).toMatchObject({ left: 1000 - MARGIN - 220, top: 450 });
  });
});
