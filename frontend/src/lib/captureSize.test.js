import { describe, it, expect } from 'vitest';
import { clampSize, scaledCapture, SIZE_MIN, SIZE_MAX } from './captureSize.js';

describe('clampSize', () => {
  it('clamps to the min/max bounds', () => {
    expect(clampSize(10)).toBe(SIZE_MIN);
    expect(clampSize(999999)).toBe(SIZE_MAX);
  });

  it('rounds and falls back to the minimum for junk input', () => {
    expect(clampSize(300.6)).toBe(301);
    expect(clampSize(NaN)).toBe(SIZE_MIN);
  });
});

describe('scaledCapture', () => {
  // every built-in preset must show a real difference between 1x and 2x —
  // this is the exact regression a user hit: presets exceeding SIZE_MAX at 2x
  // were silently clamped straight back down to 1x, so the resolution picker
  // appeared to do nothing.
  const presets = [
    { w: 1200, h: 675 }, // Tweet 16:9
    { w: 1080, h: 1080 }, // Square
    { w: 1200, h: 630 }, // OG card
    { w: 1280, h: 800 }, // Wide
  ];

  for (const { w, h } of presets) {
    it(`doubles the pixel size at 2x for a ${w}x${h} preset`, () => {
      const base = scaledCapture(w, h, 1, 16, 19);
      const doubled = scaledCapture(w, h, 2, 16, 19);
      expect(doubled.mult).toBe(2);
      expect(doubled.width).toBe(w * 2);
      expect(doubled.height).toBe(h * 2);
      expect(doubled.zoom).toBe(base.zoom + 1);
      expect(doubled.width).not.toBe(base.width);
    });
  }

  it('1x keeps the base size and zoom unchanged', () => {
    const r = scaledCapture(1200, 675, 1, 16, 19);
    expect(r).toEqual({ zoom: 16, width: 1200, height: 675, mult: 1 });
  });

  it('max resolution captures as many zoom levels as the provider allows', () => {
    const r = scaledCapture(600, 400, 'max', 16, 18);
    expect(r.mult).toBe(4); // 2 zoom levels deeper, still under SIZE_MAX
    expect(r.zoom).toBe(18);
    expect(r.width).toBe(2400);
    expect(r.height).toBe(1600);
  });

  it('walks the multiplier back down when it would exceed SIZE_MAX', () => {
    const r = scaledCapture(2200, 2200, 2, 16, 19);
    expect(r.mult).toBe(1); // 2x would be 4400px, over SIZE_MAX
    expect(r.width).toBe(2200);
  });

  it('never captures past the provider max zoom', () => {
    const r = scaledCapture(500, 500, 'max', 18, 19);
    expect(r.zoom).toBeLessThanOrEqual(19);
  });
});
