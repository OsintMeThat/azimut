import { describe, expect, it } from 'vitest';
import { markerGeometry, markerSvg, MARKER_GEOMETRY } from './mapMarkers.js';

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
