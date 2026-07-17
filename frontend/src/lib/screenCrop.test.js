import { describe, it, expect } from 'vitest';
import { isRegistered, sourceRect, frameFitsView, REGISTRATION_TOLERANCE } from './screenCrop.js';

// A widget capture crops real pixels out of a tab frame, so every bug in here
// produces a plausible-looking image of the wrong thing — which is the one
// failure a proof tool cannot ship. These tests pin the mapping and the refusals.

describe('isRegistered', () => {
  it('accepts the viewport the crop math assumes, at any pixel density', () => {
    expect(isRegistered(1440, 900, 1440, 900)).toBe(true); // 1:1
    expect(isRegistered(2880, 1800, 1440, 900)).toBe(true); // 2× dpr
  });

  it('refuses a frame whose shape is not the expected viewport', () => {
    // a stale frame from before a resize, or browser zoom changing mid-flight:
    // the same scale factor applied to different pixels would crop the wrong
    // thing and look fine doing it
    expect(isRegistered(1920, 1080, 800, 600)).toBe(false);
  });

  it('tolerates rounding but not a real mismatch', () => {
    const w = 800, h = 600;
    const ratio = w / h;
    const justInside = ratio * (1 + REGISTRATION_TOLERANCE * 0.9);
    const justOutside = ratio * (1 + REGISTRATION_TOLERANCE * 1.1);
    expect(isRegistered(justInside * 600, 600, w, h)).toBe(true);
    expect(isRegistered(justOutside * 600, 600, w, h)).toBe(false);
  });

  it('treats a frame with no dimensions as unregistered', () => {
    // an image that hasn't decoded yet must never pass
    expect(isRegistered(0, 0, 800, 600)).toBe(false);
  });
});

describe('sourceRect', () => {
  const mapRect = { left: 100, top: 50, width: 800, height: 600 };

  it('offsets by the map element rect within the viewport frame', () => {
    const out = sourceRect(
      { x: 10, y: 20, w: 400, h: 300 },
      { mapRect, viewportWidth: 1440, videoWidth: 1440, videoHeight: 900 }
    );
    expect(out).toEqual({ sx: 110, sy: 70, sw: 400, sh: 300 });
  });

  it('scales a frame taken at a higher device pixel ratio', () => {
    const out = sourceRect(
      { x: 10, y: 20, w: 400, h: 300 },
      { mapRect, viewportWidth: 1440, videoWidth: 2880, videoHeight: 1800 }
    );
    expect(out).toEqual({ sx: 220, sy: 140, sw: 800, sh: 600 });
  });

  it('refuses a frame that runs past the captured pixels', () => {
    // rather than return a crop padded with whatever sat at the edge
    expect(
      sourceRect(
        { x: 700, y: 500, w: 900, h: 600 },
        { mapRect, viewportWidth: 1440, videoWidth: 1440, videoHeight: 900 }
      )
    ).toBe(null);
  });

  it('refuses a rect that starts off-surface', () => {
    expect(
      sourceRect(
        { x: -200, y: 0, w: 100, h: 100 },
        { mapRect, viewportWidth: 1440, videoWidth: 1440, videoHeight: 900 }
      )
    ).toBe(null);
  });
});

describe('frameFitsView', () => {
  const mapRect = { left: 0, top: 0, width: 800, height: 600 };

  it('accepts a frame the screen can actually supply', () => {
    expect(frameFitsView({ x: 0, y: 0, w: 800, h: 600 }, mapRect)).toBe(true);
  });

  it('rejects a preset larger than the map view', () => {
    // screen pixels are the ceiling for a widget basemap: a 1200×675 preset has
    // nowhere to come from in an 800×600 view (a tile basemap would just fetch)
    expect(frameFitsView({ x: 0, y: 0, w: 1200, h: 675 }, mapRect)).toBe(false);
  });
});
