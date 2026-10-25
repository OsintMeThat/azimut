// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { GRAIN_MM, drawGrain, grainStrength } from './grain.js';

describe('the paper\'s grain', () => {
  it('shows as much as the page asks, never past its ceiling', () => {
    expect(grainStrength(0)).toBe(0);
    expect(grainStrength(undefined)).toBe(0);
    expect(grainStrength(1)).toBeCloseTo(0.55);
    expect(grainStrength(4)).toBeCloseTo(0.55);
  });

  it('is multiplied over an export\'s whole page in tiles of the same millimetres at any resolution, and not at all at none', () => {
    const tiles = [];
    const ctx = { save: vi.fn(), restore: vi.fn(), drawImage: (image, x, y, w, h) => tiles.push([x, y, w, h]), globalAlpha: 1, globalCompositeOperation: '' };
    const spec = { page: { paper: 'a4', orientation: 'landscape', grain: 0 } };
    drawGrain(ctx, spec, 2);
    expect(tiles).toEqual([]);
    const made = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: () => {} });
    try {
      drawGrain(ctx, { page: { ...spec.page, grain: 0.5 } }, 2);
      expect(ctx.globalCompositeOperation).toBe('multiply');
      expect(tiles[0]).toEqual([0, 0, GRAIN_MM * 2, GRAIN_MM * 2]);
      // 297 by 210 millimetres, in tiles of 36
      expect(tiles).toHaveLength(Math.ceil(297 / GRAIN_MM) * Math.ceil(210 / GRAIN_MM));
    } finally { made.mockRestore(); }
  });
});
