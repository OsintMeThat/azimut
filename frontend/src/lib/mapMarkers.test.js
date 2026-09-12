import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  markerGeometry,
  markerSvg,
  MARKER_GEOMETRY,
  TEARDROP,
  TEARDROP_CARD_OFFSET,
} from './mapMarkers.js';

describe('markerSvg', () => {
  it('draws the pin as a teardrop with an eye in it', () => {
    const svg = markerSvg('pin');
    expect(svg).toContain('<path d="M15 41');
    expect(svg).toContain('<circle cx="15" cy="14"');
  });

  it('draws the crosshair twice, dark under light, so it reads on any imagery', () => {
    const svg = markerSvg('crosshair');
    expect(svg).toContain('stroke="#000"');
    expect(svg).toContain('stroke="#fff"');
  });

  it('leaves the centre of the crosshair open, because that gap is the point', () => {
    // The arms stop short of 23 on both sides; nothing is drawn across it.
    expect(markerSvg('crosshair')).toContain('x1="1" y1="23" x2="16" y2="23"');
    expect(markerSvg('crosshair')).toContain('x1="30" y1="23" x2="45" y2="23"');
  });

  it('falls back to the crosshair for a style it does not know', () => {
    expect(markerSvg('something-else')).toBe(markerSvg('crosshair'));
  });
});

describe('markerGeometry', () => {
  it('anchors the pin at its tip, not its centre', () => {
    const { size, anchor } = markerGeometry('pin');
    expect(anchor).toEqual([size[0] / 2, size[1]]);
  });

  it('anchors the crosshair at its centre', () => {
    const { size, anchor } = markerGeometry('crosshair');
    expect(anchor).toEqual([size[0] / 2, size[1] / 2]);
  });

  it('gives every style an anchor inside its own box', () => {
    for (const style of Object.keys(MARKER_GEOMETRY)) {
      const { size, anchor } = markerGeometry(style);
      expect(anchor[0]).toBeLessThanOrEqual(size[0]);
      expect(anchor[1]).toBeLessThanOrEqual(size[1]);
    }
  });

  it('matches the box the SVG actually declares', () => {
    for (const style of Object.keys(MARKER_GEOMETRY)) {
      const [w, h] = markerGeometry(style).size;
      expect(markerSvg(style)).toContain(`width="${w}" height="${h}"`);
    }
  });
});

/**
 * The mark the overlays put on a saved point. It is CSS rather than an SVG — a
 * 24 px box with one sharp corner, turned 45° — so what is pinned here is the
 * arithmetic that turns that rotation into an anchor, and the agreement with
 * `extension/mapdraw.js`, which draws the same shape on other people's maps
 * and cannot import this file.
 */
describe('the teardrop on a saved point', () => {
  it('anchors on the sharp corner, half a diagonal below the middle', () => {
    const [, height] = TEARDROP.size;
    expect(TEARDROP.anchor[0]).toBe(TEARDROP.size[0] / 2);
    expect(TEARDROP.anchor[1]).toBeCloseTo(height / 2 + (height / 2) * Math.SQRT2, 6);
  });

  it('stands the body clear of the point rather than around it', () => {
    // What `surface.js` turns the anchor into: the element's centre, relative
    // to the coordinate. Negative is upward, which is where the body goes.
    const offsetY = TEARDROP.size[1] / 2 - TEARDROP.anchor[1];
    expect(offsetY).toBeCloseTo(-16.97, 2);
  });

  it('hangs a card off the point far enough to clear that body', () => {
    expect(TEARDROP_CARD_OFFSET).toBeGreaterThanOrEqual(
      TEARDROP.anchor[1] - TEARDROP.size[1] / 2
    );
  });

  it('states the same geometry the extension draws with', () => {
    const source = readFileSync(new URL('../../../extension/mapdraw.js', import.meta.url), 'utf8');
    const box = Number(/const MARK = (\d+);/.exec(source)[1]);
    expect(box).toBe(TEARDROP.size[1]);
    expect(source).toContain('const MARK_TIP = (MARK / 2) * Math.SQRT2;');
  });
});
