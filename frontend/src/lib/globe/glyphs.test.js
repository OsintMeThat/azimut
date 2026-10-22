import { describe, expect, it } from 'vitest';
import { colourField, cssFont, wrapWords } from './glyphs.js';

describe('the pictures of names and icons', () => {
  it('turns a style’s font stack into a CSS font, bold where the face says so', () => {
    expect(cssFont(['ui-sans-serif', 'system-ui', 'sans-serif'], 12)).toBe('12px ui-sans-serif, system-ui, sans-serif');
    expect(cssFont(['Noto Sans Bold'], 14)).toBe('bold 14px "Noto Sans Bold", sans-serif');
  });

  it('wraps a long name at its words', () => {
    const width = (text) => text.length * 10;
    expect(wrapWords('Al Khasf Al Marwan', 100, width)).toEqual(['Al Khasf', 'Al Marwan']);
    expect(wrapWords('Sion', 80, width)).toEqual(['Sion']);
  });

  it('colours a distance field: the shape inside its edge, the outline round it', () => {
    // inside, on the outline band, and well outside
    const out = colourField(new Uint8Array([255, 170, 0]), [255, 0, 0, 1], [0, 0, 0, 1], 2, 1);
    expect([...out.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect(out[4 + 3]).toBeGreaterThan(0);
    expect(out[4]).toBeLessThan(255);
    expect(out[8 + 3]).toBe(0);
  });
});
