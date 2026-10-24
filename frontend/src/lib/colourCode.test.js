import { describe, expect, it } from 'vitest';
import { parseColour } from './colourCode.js';

describe('a colour typed or pasted as text', () => {
  it('reads the hex codes as they are copied', () => {
    expect(parseColour('#D55E00')).toBe('#d55e00');
    expect(parseColour('  d55e00 ')).toBe('#d55e00');
    expect(parseColour('#d50')).toBe('#dd5500');
    expect(parseColour('"#0072b2"')).toBe('#0072b2');
    // an alpha is dropped: the map draws its colours whole
    expect(parseColour('#0072b280')).toBe('#0072b2');
  });

  it('reads red, green and blue, in rgb() or bare', () => {
    expect(parseColour('rgb(213, 94, 0)')).toBe('#d55e00');
    expect(parseColour('RGBA(213,94,0,0.5)')).toBe('#d55e00');
    expect(parseColour('rgb(213 94 0 / 50%)')).toBe('#d55e00');
    expect(parseColour('213, 94, 0')).toBe('#d55e00');
    expect(parseColour('213 94 0')).toBe('#d55e00');
  });

  it('answers null for what is no colour', () => {
    for (const text of ['', 'red', '#12345', '#ggg000', '256, 0, 0', 'rgb(1, 2, 3', '1, 2', null, undefined]) {
      expect(parseColour(text)).toBeNull();
    }
  });
});
