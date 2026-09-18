import { describe, expect, it } from 'vitest';
import {
  MIN_FRAME,
  boundedRect,
  cropCapture,
  cropSources,
  exportFrameSpec,
  frameSpan,
  groundRect,
  screenRect,
} from './exportFrame.js';
import { mercatorPerPixel } from './groundFrame.js';

const FRAME = { lng: 2.3, lat: 48.8, zoom: 17, bearing: 0, width: 1200, height: 800 };

function fakeCanvas() {
  const drawn = [];
  return {
    width: 0,
    height: 0,
    drawn,
    getContext: () => ({
      imageSmoothingQuality: '',
      drawImage: (...args) => drawn.push(args),
    }),
  };
}

const capture = (frame = FRAME, pixelScale = 1) => ({
  canvas: { width: frame.width * pixelScale, height: frame.height * pixelScale },
  frame,
});

describe('screenRect / groundRect', () => {
  it('round-trips a drawn box through the ground', () => {
    const rect = { x: 320, y: 180, w: 400, h: 260 };
    const back = screenRect(groundRect(rect, FRAME), FRAME);
    expect(back.x).toBeCloseTo(rect.x, 6);
    expect(back.y).toBeCloseTo(rect.y, 6);
    expect(back.w).toBeCloseTo(rect.w, 6);
    expect(back.h).toBeCloseTo(rect.h, 6);
  });

  it('follows the ground when the camera moves', () => {
    const points = groundRect({ x: 400, y: 300, w: 300, h: 200 }, FRAME);
    const panned = { ...FRAME, lng: FRAME.lng + 0.001 };
    const moved = screenRect(points, panned);
    expect(moved.x).toBeLessThan(400);
    expect(moved.w).toBeCloseTo(300, 6);
  });

  it('keeps the same ground box under two frames of the same camera', () => {
    const points = groundRect({ x: 100, y: 120, w: 500, h: 300 }, FRAME);
    const wider = { ...FRAME, width: 1600 };
    const rect = screenRect(points, wider);
    expect(rect.w).toBeCloseTo(500, 6);
    expect(rect.x).toBeCloseTo(100 + 200, 6);
  });
});

describe('boundedRect', () => {
  it('holds a frame inside the view', () => {
    const rect = boundedRect({ x: -80, y: 700, w: 500, h: 400 }, FRAME);
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(FRAME.height - 400);
  });

  it('grows a small drawing to the minimum around its own centre', () => {
    const rect = boundedRect({ x: 600, y: 400, w: 40, h: 30 }, FRAME);
    expect(rect.w).toBe(MIN_FRAME);
    expect(rect.h).toBe(MIN_FRAME);
    expect(rect.x + rect.w / 2).toBeCloseTo(620, 6);
    expect(rect.y + rect.h / 2).toBeCloseTo(415, 6);
  });

  it('never asks for more than the view holds', () => {
    const narrow = { ...FRAME, width: 200, height: 150 };
    const rect = boundedRect({ x: 0, y: 0, w: 10, h: 10 }, narrow);
    expect(rect).toEqual({ x: 0, y: 0, w: 200, h: 150 });
  });
});

describe('frameSpan', () => {
  const equator = { lng: 0, lat: 0, zoom: 12, bearing: 0, width: 800, height: 600 };

  it('reads the frame as ground metres', () => {
    const span = frameSpan(groundRect({ x: 100, y: 100, w: 400, h: 200 }, equator));
    expect(span.width).toBeCloseTo(400 * mercatorPerPixel(12), 3);
    expect(span.height).toBeCloseTo(200 * mercatorPerPixel(12), 3);
  });

  it('shrinks with the latitude, like the ground itself', () => {
    const at60 = { ...equator, lat: 60 };
    const span = frameSpan(groundRect({ x: 100, y: 250, w: 400, h: 100 }, at60));
    expect(span.width).toBeCloseTo(400 * mercatorPerPixel(12) * Math.cos((60 * Math.PI) / 180), 0);
  });

  it('reads width and height along a rotated screen', () => {
    const turned = { ...equator, bearing: 31 };
    const span = frameSpan(groundRect({ x: 100, y: 100, w: 400, h: 200 }, turned), turned.bearing);
    expect(span.width).toBeCloseTo(400 * mercatorPerPixel(12), 2);
    expect(span.height).toBeCloseTo(200 * mercatorPerPixel(12), 2);
  });
});

describe('cropCapture', () => {
  it('cuts the pixels and re-centres the frame on the cut', () => {
    const cropped = cropCapture(capture(), { x: 400, y: 200, w: 300, h: 200 }, fakeCanvas);
    expect(cropped.canvas.width).toBe(300);
    expect(cropped.canvas.height).toBe(200);
    expect(cropped.canvas.drawn[0].slice(1, 5)).toEqual([400, 200, 300, 200]);
    expect(cropped.frame.width).toBe(300);
    expect(cropped.frame.height).toBe(200);
    expect(cropped.frame.zoom).toBe(FRAME.zoom);
    // The cut sits left of and above the view centre, so the frame follows.
    expect(cropped.frame.lng).toBeLessThan(FRAME.lng);
    expect(cropped.frame.lat).toBeGreaterThan(FRAME.lat);
  });

  it('reads the crop in captured pixels, not CSS ones', () => {
    const cropped = cropCapture(capture(FRAME, 2), { x: 400, y: 300, w: 300, h: 200 }, fakeCanvas);
    expect(cropped.canvas.width).toBe(600);
    expect(cropped.canvas.drawn[0].slice(1, 5)).toEqual([800, 600, 600, 400]);
    // Its own frame is still the CSS box it covers, so projections hold.
    expect(cropped.frame.width).toBe(300);
  });

  it('leaves a whole-view frame the size it was', () => {
    const cropped = cropCapture(capture(), { x: 0, y: 0, w: 1200, h: 800 }, fakeCanvas);
    expect(cropped.frame.lng).toBeCloseTo(FRAME.lng, 9);
    expect(cropped.frame.lat).toBeCloseTo(FRAME.lat, 9);
  });
});

describe('cropSources', () => {
  const sources = () => ({ a: capture(), b: capture({ ...FRAME, lng: FRAME.lng + 0.00001 }) });

  it('returns the captures untouched with no frame', () => {
    const whole = sources();
    expect(cropSources(whole, null, fakeCanvas)).toBe(whole);
  });

  it('cuts both sides to the same ground box', () => {
    const frame = { points: groundRect({ x: 300, y: 200, w: 480, h: 320 }, FRAME) };
    const cut = cropSources(sources(), frame, fakeCanvas);
    expect(cut.a.frame.width).toBe(480);
    expect(cut.b.frame.width).toBe(480);
    // Within the pixel each cut is rounded to: at zoom 17 that is about a metre.
    expect(cut.a.frame.lng).toBeCloseTo(cut.b.frame.lng, 4);
    expect(cut.a.frame.lat).toBeCloseTo(cut.b.frame.lat, 4);
    // B's camera sits a shade east, so that ground has slid left in its
    // capture and the same box is taken from further left.
    expect(cut.b.canvas.drawn[0][1]).toBeLessThan(cut.a.canvas.drawn[0][1]);
  });

  it('refuses to substitute another area when the saved ground is off screen', () => {
    const frame = { points: groundRect({ x: -40, y: 200, w: 480, h: 320 }, FRAME) };
    expect(() => cropSources(sources(), frame, fakeCanvas)).toThrow('must be fully visible');
  });
});

describe('exportFrameSpec', () => {
  it('keeps two ground corners', () => {
    expect(exportFrameSpec({ points: [[2.3, 48.8], [2.31, 48.79]] }))
      .toEqual({ points: [[2.3, 48.8], [2.31, 48.79]] });
  });

  it('drops anything that is not a pair of ground points', () => {
    expect(exportFrameSpec(null)).toBeNull();
    expect(exportFrameSpec({ points: [[2.3, 48.8]] })).toBeNull();
    expect(exportFrameSpec({ points: [[2.3, 48.8], [999, 48.8]] })).toBeNull();
    expect(exportFrameSpec({ points: [[2.3, 48.8], ['x', 48.8]] })).toBeNull();
    expect(exportFrameSpec({ points: [[2.3, 48.8], [2.3, 48.8]] })).toBeNull();
  });
});
