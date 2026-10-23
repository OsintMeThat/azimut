import { describe, expect, it } from 'vitest';
import { colourField, createGlyphs, cssFont, wrapWords } from './glyphs.js';

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

  it('measures a name before writing it, to the box its picture gets, a share a frame', () => {
    const drawn = [];
    // a context whose text is 7 px a letter, and that records what it writes
    const ctx = new Proxy({}, {
      get: (_, key) => (key === 'measureText' ? (text) => ({ width: text.length * 7 }) : key === 'fillText' ? (text) => drawn.push(text) : () => {}),
      set: () => true,
    });
    const glyphs = createGlyphs({ image: () => null, canvas: () => ({ getContext: () => ctx }), ratio: () => 1, perFrame: 1, measuredPerFrame: 2 });
    const spec = (text) => ({ text, size: 10, font: ['sans-serif'], spacing: 0, maxWidth: 100, haloWidth: 1, colour: '#fff', halo: '#000' });
    glyphs.begin();
    const size = glyphs.labelSize(spec('Sion'));
    expect(size).toMatchObject({ width: 4 * 7 + 2 + 2, height: 14 });
    expect(drawn).toEqual([]);
    expect(glyphs.labelSize(spec('Brig'))).not.toBeNull();
    expect(glyphs.labelSize(spec('Visp'))).toBeNull();
    // a size held is free, and the picture is written to it
    expect(glyphs.labelSize(spec('Sion'))).toBe(size);
    const picture = glyphs.label(spec('Sion'));
    expect(picture).toMatchObject({ width: size.width, height: size.height });
    expect(drawn).toEqual(['Sion']);
    expect(glyphs.label(spec('Brig'))).toBeNull();
    glyphs.begin();
    expect(glyphs.labelSize(spec('Visp'))).not.toBeNull();
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
