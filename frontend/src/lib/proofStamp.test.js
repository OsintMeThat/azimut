import { describe, expect, it } from 'vitest';
import { STAMP_CUT, STAMP_HALO } from './proofIcons.js';
import { stampNodes } from './proofStamp.js';

/** Konva's constructors as records of what they were asked to draw. */
const node = (kind) => class {
  constructor(config) { Object.assign(this, { kind, ...config }); }
};
const Konva = { Circle: node('circle'), Path: node('path'), Shape: node('shape'), Group: node('group') };

const box = (size, scale = 1) => ({ size: size / scale, scale, origin: { x: -size / scale / 2, y: -size / scale / 2 } });

describe('a stamp over imagery', () => {
  it('wears a halo, then its silhouette, then its carved details in a dark shade', () => {
    const nodes = stampNodes(Konva, { name: 'truck', color: '#ff5252', size: 56, strokeWidth: 4 }, box(56));
    expect(nodes.map((n) => n.kind)).toEqual(['path', 'path', 'path']);
    const [halo, body, cut] = nodes;
    expect(halo.fill).toBe(STAMP_HALO);
    expect(halo.strokeWidth).toBeGreaterThan(body.strokeWidth);
    expect(body.fill).toBe('#ff5252');
    expect(body.fillRule).toBe('evenodd');
    expect(cut.fill).toBe(STAMP_CUT);
    expect(nodes.every((n) => n.listening === false)).toBe(true);
  });

  it('reads the stroke width as weight on the eight stamps that used to be strokes', () => {
    const at = (strokeWidth) => stampNodes(Konva, { name: 'person', color: '#ff5252', size: 56, strokeWidth }, box(56))[1].strokeWidth;
    expect(at(10)).toBeGreaterThan(at(4));
    expect(at(4)).toBeGreaterThan(at(1));
    expect(at(undefined)).toBe(at(4));
  });

  it('gives a solid one no weight, whatever its stroke says', () => {
    const [, body] = stampNodes(Konva, { name: 'impact', color: '#ff5252', size: 56, strokeWidth: 12 }, box(56));
    expect(body.stroke).toBeUndefined();
  });

  it('keeps the halo visible on a small stamp', () => {
    const halo = (size) => stampNodes(Konva, { name: 'point', color: '#ff5252', size }, box(size))[0].strokeWidth;
    expect(halo(20)).toBeGreaterThan(halo(56));
    expect(halo(56)).toBeCloseTo(halo(120));
  });

  it('scales the drawing into its box, so a turn or a resize never deforms it', () => {
    const [, body] = stampNodes(Konva, { name: 'tank', color: '#ff5252', size: 96 }, box(96, 2));
    expect(body.scaleX).toBeCloseTo(48 / 24);
    expect(body.scaleY).toBe(body.scaleX);
    expect(body.x).toBeCloseTo(-24);
  });
});

describe('a stamp on its disc', () => {
  it('draws the disc, ringed, then the symbol in the disc\'s ink with its details as holes', () => {
    const nodes = stampNodes(Konva, { name: 'camera', color: '#ff5252', size: 56, fillOpacity: 1 }, box(56));
    expect(nodes.map((n) => n.kind)).toEqual(['circle', 'circle', 'path']);
    expect(nodes[1].fill).toBe('rgba(255, 82, 82, 1)');
    expect(nodes[1].stroke).toBe('#ff5252');
    expect(nodes[2].fill).toBe('#ffffff');
    expect(nodes.some((n) => n.fill === STAMP_HALO)).toBe(false);
  });

  it('keeps the symbol coloured and haloed over a disc too sheer to carry white', () => {
    const nodes = stampNodes(Konva, { name: 'camera', color: '#69f0ae', size: 56, fillOpacity: 0.3 }, box(56));
    expect(nodes.find((n) => n.kind === 'path').fill).toBe(STAMP_HALO);
    expect(nodes.filter((n) => n.kind === 'path')[1].fill).toBe('#69f0ae');
  });
});

it('draws nothing for a name this build does not know', () => {
  expect(stampNodes(Konva, { name: 'battleship', color: '#ff5252' }, box(56))).toEqual([]);
});
