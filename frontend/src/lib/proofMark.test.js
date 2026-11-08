import { describe, expect, it } from 'vitest';
import { FakeKonva } from './konva.fixture.js';
import { SIG_MARGIN, footerBand, toSpec } from './composer.js';
import { LETTERS, MARK, signatureWidth } from './brandMark.js';
import {
  INK_ON_LIGHT, MARK_SIZE, NAME_ALONE, addMark, drawMark, markBox, markGround, markInk, markWidth, newAzimutMark,
  normalizeAzimutMark,
} from './proofMark.js';

const W = 1800;
const H = 1000;

describe('the Azimut mark as a proof stores it', () => {
  it('is off unless asked, and a proof from before it saves as it did', () => {
    expect(normalizeAzimutMark(undefined)).toBeNull();
    expect(normalizeAzimutMark(null)).toBeNull();
    expect(normalizeAzimutMark(true)).toBeNull();
    expect(toSpec({ title: 'T', panels: [], shapes: [] })).not.toHaveProperty('azimutMark');
  });

  it('starts in the corner given, with its name, at the handle size', () => {
    expect(newAzimutMark('tl')).toEqual({ anchor: 'tl', show: 'both', size: MARK_SIZE });
    expect(newAzimutMark('middle').anchor).toBe('br');
  });

  it('reads what it can and bounds the rest', () => {
    expect(normalizeAzimutMark({ anchor: 'nowhere', size: 9000, show: 'icon' })).toEqual({ anchor: 'br', show: 'both', size: 300 });
    for (const show of ['both', 'logo', 'name']) expect(normalizeAzimutMark({ show }).show).toBe(show);
    expect(normalizeAzimutMark({ size: 2 }).size).toBe(12);
  });
});

describe('where the mark lands', () => {
  const mark = (patch = {}) => ({ ...newAzimutMark(), ...patch });

  it('takes its corner, inside the signature margin', () => {
    const box = markBox(mark(), W, H);
    expect(box.x + box.w).toBeCloseTo(W - SIG_MARGIN);
    expect(box.y + box.h).toBeCloseTo(H - SIG_MARGIN);
    const top = markBox(mark({ anchor: 'tl' }), W, H);
    expect([top.x, top.y]).toEqual([SIG_MARGIN, SIG_MARGIN]);
  });

  it('is as wide as what it shows: the lockup, the arrow alone, or the name alone at its height', () => {
    expect(markWidth(mark())).toBeCloseTo(signatureWidth(MARK_SIZE, { tight: true }));
    expect(markWidth(mark({ show: 'logo' }))).toBeLessThan(MARK_SIZE);
    // the name alone is set like type of that size, its capitals a handle's beside it
    expect(markWidth(mark({ show: 'name' }))).toBeCloseTo((MARK_SIZE * NAME_ALONE * 503.3) / 115);
    expect(markWidth(mark({ show: 'name' }))).toBeGreaterThan(markWidth(mark({ show: 'logo' })));
  });

  it('steps inward past the logo and the handle already in its corner', () => {
    const handle = { x: W - 20 - 200, y: H - 20 - 30, w: 200, h: 30 };
    const box = markBox(mark(), W, H, { avoid: [handle] });
    expect(box.x + box.w).toBeLessThan(handle.x);
    const left = markBox(mark({ anchor: 'bl' }), W, H, { avoid: [{ x: 20, y: H - 60, w: 120, h: 40 }] });
    expect(left.x).toBeGreaterThan(140);
  });

  it('rides on the footer line in a bottom corner, and over the band when the words run on its side', () => {
    const footer = { lines: 2, size: 20, pad: 20, align: 'left' };
    const right = markBox(mark(), W, H, { footer });
    expect(right.y + right.h / 2).toBeCloseTo(H - 20 - footerBand(20) / 2);
    const left = markBox(mark({ anchor: 'bl' }), W, H, { footer });
    expect(left.y + left.h).toBeLessThanOrEqual(H - 20 - footerBand(20, 2));
  });

  it('stays on the page, however large', () => {
    const box = markBox(mark({ size: 300 }), 400, 200);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
  });
});

describe('how the mark is inked', () => {
  it('reads light on a dark page and dark on a pale one, with a halo for a picture', () => {
    expect(markInk('#0d1117').ink).not.toBe(INK_ON_LIGHT);
    expect(markInk('#ffffff').ink).toBe(INK_ON_LIGHT);
    expect(markInk('#000000').halo).toMatch(/^rgba\(0, 0, 0/);
    expect(markInk('#f4f1ea').halo).toMatch(/^rgba\(255, 255, 255/);
  });

  it('reads on what it lies over: the page in a margin, a dark ground on a picture', () => {
    const panel = { id: 'p', row: 0, scale: 1, natural: [1600, 900], sourceNatural: [1600, 900] };
    const proof = { bg: '#ffffff', panels: [panel], layout: 'grid', space: { pad: 20, gap: 16, rowGap: 18 } };
    expect(markGround(proof, { x: 100, y: 100, w: 80, h: 28 })).toBe('#0d1117');
    expect(markGround(proof, { x: 100, y: 1000, w: 80, h: 28 })).toBe('#ffffff');
    expect(markGround({ bg: '#ffffff' }, { x: 0, y: 0, w: 10, h: 10 })).toBe('#ffffff');
  });

  /** What a draw does to a canvas: each call by name, and the paths it filled and stroked. */
  function record(show) {
    const calls = [];
    const ctx = new Proxy({}, {
      get: (_, key) => (typeof key === 'string' && ['save', 'restore', 'translate', 'scale', 'fill', 'stroke'].includes(key)
        ? (...args) => calls.push([key, args[0]]) : undefined),
      set: () => true,
    });
    const mark = { ...newAzimutMark(), show };
    const box = markBox(mark, W, H);
    drawMark(ctx, mark, box, '#0d1117', { makePath: (d) => d });
    return {
      fills: calls.filter(([c]) => c === 'fill').map(([, d]) => d),
      strokes: calls.filter(([c]) => c === 'stroke').map(([, d]) => d),
    };
  }

  it('draws the logo and the name: both flanks of the arrow, then the six letters, each over its halo', () => {
    const { fills, strokes } = record('both');
    expect(fills).toEqual([MARK.west, MARK.east]);
    expect(strokes).toEqual([MARK.west, MARK.east, ...LETTERS.map((l) => l.d), ...LETTERS.map((l) => l.d)]);
  });

  it('draws the logo alone: the arrow and no letter', () => {
    const { fills, strokes } = record('logo');
    expect(fills).toEqual([MARK.west, MARK.east]);
    expect(strokes).toEqual([MARK.west, MARK.east]);
  });

  it('draws the name alone: the letters and no arrow', () => {
    const { fills, strokes } = record('name');
    expect(fills).toEqual([]);
    expect(strokes).toEqual([...LETTERS.map((l) => l.d), ...LETTERS.map((l) => l.d)]);
  });
});

describe('the mark on a page', () => {
  it('is added last, beside what the page already signs with', () => {
    const layer = new FakeKonva.Layer();
    layer.add(new FakeKonva.Text({ id: 'sig-text', x: W - 220, y: H - 50, text: '@handle', fontSize: 30 }));
    const node = addMark(FakeKonva, layer, { azimutMark: newAzimutMark(), bg: '#000000' }, { width: W, height: H, pad: 20 });
    expect(node.id()).toBe('azimut-mark');
    expect(layer.children.at(-1)).toBe(node);
    expect(node.attrs.listening).toBe(false);
  });

  it('adds nothing to a proof without one', () => {
    const layer = new FakeKonva.Layer();
    expect(addMark(FakeKonva, layer, { bg: '#000000' }, { width: W, height: H, pad: 20 })).toBeNull();
    expect(layer.children).toHaveLength(0);
  });
});
