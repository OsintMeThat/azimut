import { describe, expect, it } from 'vitest';
import {
  ICON_BOX,
  ICON_SIZE_DEFAULT,
  PROOF_ICONS,
  glyphInk,
  iconAnchor,
  iconBox,
  iconByName,
  iconOrigin,
  iconSizeFor,
  isSolidIcon,
} from './proofIcons.js';

describe('the symbol set', () => {
  it('names every symbol once', () => {
    const names = PROOF_ICONS.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('keeps every path inside the shared box', () => {
    for (const entry of PROOF_ICONS) {
      // SVG packs numbers without separators — "-.75.34" is two of them — so
      // the tokenizer has to allow a leading dot and no leading digit.
      const numbers = entry.path.match(/-?(?:\d*\.\d+|\d+\.?)/g).map(Number);
      // Arc flags and radii ride in the same stream, so this is a sanity bound
      // rather than a bounding box: nothing may carry a coordinate that could
      // only come from a path drawn for a different canvas.
      expect(Math.max(...numbers)).toBeLessThanOrEqual(ICON_BOX);
      expect(Math.min(...numbers)).toBeGreaterThanOrEqual(-ICON_BOX);
    }
  });

  it('starts every path with a move, so none inherits the last one’s pen', () => {
    for (const entry of PROOF_ICONS) expect(entry.path.startsWith('M')).toBe(true);
  });

  it('closes the paths that are filled rather than stroked', () => {
    for (const entry of PROOF_ICONS) {
      if (isSolidIcon(entry.name)) expect(entry.path).toMatch(/[Zz]$/);
    }
  });

  it('answers by name and refuses one it does not carry', () => {
    expect(iconByName('tank').label).toBe('Tank');
    expect(iconByName('battleship')).toBeNull();
  });
});

describe('where a symbol sits', () => {
  it('centres everything that marks an area', () => {
    expect(iconAnchor('tank')).toEqual([0.5, 0.5]);
    expect(iconOrigin('tank', 100)).toEqual({ x: -50, y: -50 });
  });

  it('hangs the pin from its tip, not its middle', () => {
    const [, ay] = iconAnchor('point');
    expect(ay).toBeGreaterThan(0.9);
    expect(iconOrigin('point', 100).y).toBeLessThan(-90);
  });

  it('keeps the pin’s tip still while it is resized', () => {
    const pin = { name: 'point', x: 300, y: 200 };
    const small = iconBox({ ...pin, size: 40 });
    const large = iconBox({ ...pin, size: 120 });
    // the tip is the anchor, so it reads the same out of both boxes
    const tipOf = (box) => ({ x: box.x + box.w / 2, y: box.y + box.h * (22.4 / ICON_BOX) });
    expect(tipOf(small).x).toBeCloseTo(tipOf(large).x);
    expect(tipOf(small).y).toBeCloseTo(tipOf(large).y);
  });

  it('sizes a symbol against the panel, like stroke width', () => {
    expect(iconSizeFor(1)).toBe(ICON_SIZE_DEFAULT);
    expect(iconSizeFor(2)).toBe(ICON_SIZE_DEFAULT / 2);
    expect(iconSizeFor(0)).toBe(ICON_SIZE_DEFAULT);
  });
});

describe('ink over a badge disc', () => {
  it('leaves the glyph its own colour when there is no disc to sit on', () => {
    expect(glyphInk('#ff5252', 0)).toBe('#ff5252');
    expect(glyphInk('#ff5252', undefined)).toBe('#ff5252');
  });

  it('keeps the glyph coloured while the disc is too sheer to carry white', () => {
    expect(glyphInk('#ff5252', 0.3)).toBe('#ff5252');
  });

  it('turns white on a solid dark disc and dark on a pale one', () => {
    // the palette straddles the threshold: red and magenta take white, the
    // yellow/green/white end takes dark ink
    expect(glyphInk('#ff5252', 1)).toBe('#ffffff');
    expect(glyphInk('#69f0ae', 1)).toBe('#14161a');
    expect(glyphInk('#ffffff', 1)).toBe('#14161a');
    expect(glyphInk('#ffd740', 1)).toBe('#14161a');
  });

  it('falls back to white rather than painting a glyph with a gradient string', () => {
    expect(glyphInk('rgba(0,0,0,.4)', 1)).toBe('#ffffff');
  });
});
