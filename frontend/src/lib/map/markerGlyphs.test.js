import { describe, expect, it, vi } from 'vitest';
import { BADGE_GLYPHS, drawMarker, drawOwnMarker, inkBox, isBadge, markerParts, MARKER_PIXELS, OWN_GLYPH, OWN_IMAGE_RATIO,
  ownMarkerSide, ownParts, partTransform } from './markerGlyphs.js';
import symbols from './layerSymbols.json';
import { paths } from '../../components/Icon.svelte';

const badges = symbols.filter((symbol) => symbol.id.startsWith('badge-')).map((symbol) => symbol.id);

describe('marker glyphs', () => {
  it('draws every badge the palette offers, and offers every glyph drawn', () => {
    expect(Object.keys(BADGE_GLYPHS).sort()).toEqual([...badges].sort());
    expect(badges.every(isBadge)).toBe(true);
    expect(['pin', 'circle', 'star', 'flag'].some(isBadge)).toBe(false);
  });

  it('gives every badge a silhouette of its own', () => {
    const drawings = Object.values(BADGE_GLYPHS).map((layers) => JSON.stringify(layers));
    expect(new Set(drawings).size).toBe(drawings.length);
    for (const layers of Object.values(BADGE_GLYPHS)) {
      expect(layers.some(([mode]) => mode === 'fill' || mode === 'line')).toBe(true);
      for (const [mode, d] of layers) {
        expect(['fill', 'cut', 'line', 'cutline']).toContain(mode);
        expect(d).toMatch(/^M[\d.]/);
      }
    }
  });

  it('puts a white silhouette on a strong disc and a dark one on a pale disc', () => {
    const [halo, disc, ...glyph] = markerParts('badge-tank', '#0072b2');
    expect(halo.fill).toMatch(/^rgba\(0, 0, 0/);
    expect(disc).toMatchObject({ fill: '#0072b2', stroke: '#fff', scale: 1, offset: 0 });
    expect(glyph.filter((part) => part.fill === '#ffffff').length).toBeGreaterThan(0);
    // the wheels are carved back out in the disc's own colour
    expect(glyph.some((part) => part.fill === '#0072b2')).toBe(true);
    const pale = markerParts('badge-tank', '#f0e442').slice(2);
    expect(pale.some((part) => part.fill === '#ffffff')).toBe(false);
    expect(pale.some((part) => part.fill === '#14161a')).toBe(true);
  });

  it('strokes lines at their own width and turns a layer about the centre', () => {
    const lines = markerParts('badge-helicopter', '#d55e00').filter((part) => part.stroke && part.scale !== 1);
    expect(lines.map((part) => part.width)).toContain(1.8);
    const clash = markerParts('badge-clash', '#d55e00').slice(2);
    expect(clash.map((part) => part.rotate)).toEqual([45, 45, -45, -45]);
    expect(partTransform(clash[0])).toBe(`translate(${clash[0].offset} ${clash[0].offset}) scale(${clash[0].scale}) rotate(45 12 12)`);
  });

  it('keeps the plain markers as a coloured shape inside a white outline', () => {
    const [outline, pin] = markerParts('pin', '#009e73');
    expect(outline).toMatchObject({ d: paths.pin, stroke: '#fff', width: 4 });
    expect(outline.fill).toBeUndefined();
    expect(pin).toMatchObject({ d: paths.pin, fill: null, stroke: '#009e73' });
    expect(markerParts('star', '#009e73')[1]).toMatchObject({ d: paths.star, fill: '#009e73' });
    expect(markerParts('script', '#009e73')[1].d).toBe(paths.pin);
  });

  it('strokes a damaged marker once and a destroyed one twice, each on a dark bed', () => {
    const plain = markerParts('badge-tank', '#0072b2');
    const strokes = (status) => markerParts('badge-tank', '#0072b2', { status }).length - plain.length;
    expect(strokes('damaged')).toBe(2);
    expect(strokes('destroyed')).toBe(4);
    expect(markerParts('badge-tank', '#0072b2', { status: 'destroyed' }).at(-1)).toMatchObject({ stroke: '#fff', scale: 1 });
    expect(markerParts('pin', '#0072b2', { status: 'damaged' }).length).toBe(4);
  });

  it('dashes the rim of a point somebody else geolocated', () => {
    expect(markerParts('badge-tank', '#0072b2', { external: true })[1].dash).toEqual([6, 4]);
    expect(markerParts('badge-tank', '#0072b2')[1].dash).toBeNull();
    expect(markerParts('star', '#0072b2', { external: true })[0].dash).toBeTruthy();
  });

  it('draws onto a canvas in the order the parts give, and leaves the transform clean', () => {
    const drawn = [];
    vi.stubGlobal('Path2D', class { constructor(path) { drawn.push(path); } });
    const context = { clearRect: vi.fn(), setTransform: vi.fn(), translate: vi.fn(), rotate: vi.fn(), fill: vi.fn(), stroke: vi.fn() };
    try {
      drawMarker(context, 'badge-missile', '#cc79a7');
      expect(context.clearRect).toHaveBeenCalledWith(0, 0, 64, 64);
      expect(drawn).toEqual(markerParts('badge-missile', '#cc79a7').map((part) => part.d));
      expect(context.rotate).toHaveBeenCalledWith((-40 * Math.PI) / 180);
      expect(context.setTransform).toHaveBeenLastCalledWith(1, 0, 0, 1, 0, 0);
    } finally { vi.unstubAllGlobals(); }
  });
});

describe("a marker in one of the analyst's own icons", () => {
  const context = () => ({ clearRect: vi.fn(), setTransform: vi.fn(), translate: vi.fn(), rotate: vi.fn(), fill: vi.fn(),
    stroke: vi.fn(), drawImage: vi.fn(), setLineDash: vi.fn(), fillRect: vi.fn() });

  it('stands on the badge disc in a disc, and on nothing as it is but the marks', () => {
    const disc = ownParts('#d55e00', { mode: 'disc', status: 'damaged' });
    expect(disc.under.map((part) => part.fill)).toEqual(['rgba(0, 0, 0, 0.35)', '#d55e00']);
    expect(disc.over).toHaveLength(2);
    const plain = ownParts('#d55e00', { mode: 'image', external: true });
    expect(plain.under).toEqual([]);
    expect(plain.over[0].dash).toEqual([6, 4]);
  });

  it('sizes a picture drawn as it is at the share of a badge the source icons are drawn at', () => {
    expect(ownMarkerSide({ width: 64, height: 64 }, 'disc')).toBe(MARKER_PIXELS);
    expect(ownMarkerSide({ width: 40, height: 40 }, 'image')).toBe(MARKER_PIXELS);
    expect(ownMarkerSide({ width: 200, height: 100 }, 'image')).toBe(140);
  });

  it('inks the silhouette of a disc icon in the glyph colour, fitted to its painted part', () => {
    vi.stubGlobal('Path2D', class {});
    const scratch = context();
    const canvas = { getContext: () => scratch };
    const into = context();
    const image = { width: 100, height: 100 };
    drawOwnMarker(into, image, '#d55e00', { mode: 'disc', box: { x: 10, y: 30, w: 80, h: 40 } }, 1, () => canvas);
    const fit = OWN_GLYPH / 80;
    expect(scratch.drawImage).toHaveBeenCalledWith(image, 10, 30, 80, 40, (64 - 80 * fit) / 2, (64 - 40 * fit) / 2, 80 * fit, 40 * fit);
    expect(scratch.globalCompositeOperation).toBe('source-in');
    expect(scratch.fillStyle).toBe('#ffffff');
    expect(into.drawImage).toHaveBeenCalledWith(canvas, 0, 0);
    vi.unstubAllGlobals();
  });

  it('draws a picture as it is centred where its source centred it', () => {
    vi.stubGlobal('Path2D', class {});
    const into = context();
    const image = { width: 120, height: 80 };
    drawOwnMarker(into, image, '#d55e00', { mode: 'image' });
    const side = ownMarkerSide(image, 'image');
    expect(into.drawImage).toHaveBeenCalledWith(image, side / 2 - (120 * OWN_IMAGE_RATIO) / 2, side / 2 - (80 * OWN_IMAGE_RATIO) / 2,
      120 * OWN_IMAGE_RATIO, 80 * OWN_IMAGE_RATIO);
    vi.unstubAllGlobals();
  });

  it('finds the painted part of a picture, or takes all of it when its pixels cannot be read', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    data[(1 * 4 + 2) * 4 + 3] = 255; data[(2 * 4 + 1) * 4 + 3] = 255;
    const canvas = { getContext: () => ({ drawImage: vi.fn(), getImageData: () => ({ data }) }) };
    expect(inkBox({ width: 4, height: 4 }, () => canvas)).toEqual({ x: 1, y: 1, w: 2, h: 2 });
    expect(inkBox({ width: 4, height: 4 }, () => null)).toEqual({ x: 0, y: 0, w: 4, h: 4 });
  });
});
