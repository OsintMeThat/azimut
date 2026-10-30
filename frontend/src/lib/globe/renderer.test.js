import { describe, expect, it } from 'vitest';
import { groundUniforms, rgbOf, TINT_STOPS, toneUniforms } from './renderer.js';

describe('the plain ground the globe draws without a picture', () => {
  it('waits for its picture as a pale stone lit by its relief, as Satellite always drew it', () => {
    const bare = groundUniforms(null);
    expect(bare.tintCount).toBe(0);
    expect(bare.shade).toBe(1);
    // shaded under what is laid on it, not over: a road over a slope stays its own colour
    expect(bare.shadeLaid).toBe(0);
  });

  it('takes a plate ground’s colour, its height tints and its shading', () => {
    const plain = groundUniforms({ colour: '#f4f1e8', tints: [[0, '#c3dba9'], [400, '#eeeac0'], [4200, '#f6f4f1']], shade: 0.45 });
    expect(plain.bare.map((c) => Math.round(c * 255))).toEqual([0xf4, 0xf1, 0xe8]);
    expect(plain.tintCount).toBe(3);
    expect([...plain.tintAt.slice(0, 3)]).toEqual([0, 400, 4200]);
    expect([...plain.tintColour.slice(3, 6)].map((c) => Math.round(c * 255))).toEqual([0xee, 0xea, 0xc0]);
    expect(plain.shade).toBe(0.45);
    expect(plain.shadeLaid).toBe(1);
  });

  it('keeps no more stops than the shader holds, and drops what it cannot read', () => {
    const many = Array.from({ length: TINT_STOPS + 4 }, (_, i) => [i * 100, '#808080']);
    expect(groundUniforms({ colour: '#000000', tints: many }).tintCount).toBe(TINT_STOPS);
    expect(groundUniforms({ colour: 'nope', tints: [[0, 'red'], ['x', '#ffffff']] }).tintCount).toBe(0);
    expect(rgbOf('#ff8000')).toEqual([1, 128 / 255, 0]);
    expect(rgbOf('orange')).toBe(null);
  });
});

describe('a picture’s tone, as the flat map paints a raster', () => {
  it('leaves a picture as it is by default', () => {
    const tone = toneUniforms();
    expect(tone.spin.map((w) => Math.round(w * 1e6) / 1e6 + 0)).toEqual([1, 0, 0]);
    expect(tone).toMatchObject({ saturation: -0, contrast: 1, brightnessLow: 0, brightnessHigh: 1, opacity: 1 });
  });

  it('greys, lifts, darkens and fades with the flat map’s own factors', () => {
    const grey = toneUniforms({ saturation: -1, contrast: 0.5, brightness: 0.7, opacity: 0.4 });
    expect(grey.saturation).toBe(1);
    expect(grey.contrast).toBe(2);
    expect(grey.brightnessHigh).toBe(0.7);
    expect(grey.opacity).toBe(0.4);
    expect(toneUniforms({ saturation: 0.5 }).saturation).toBeCloseTo(1 - 1 / 0.501, 6);
    expect(toneUniforms({ contrast: -0.5 }).contrast).toBe(0.5);
  });

  it('turns the hue by the flat map’s weights, a full turn back where it was', () => {
    const round = (spin) => spin.map((w) => Math.round(w * 1e6) / 1e6 + 0);
    expect(round(toneUniforms({ hue: 120 }).spin)).toEqual([0, 0, 1]);
    expect(round(toneUniforms({ hue: 360 }).spin)).toEqual([1, 0, 0]);
  });
});
