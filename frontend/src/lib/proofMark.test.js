import { describe, expect, it } from 'vitest';
import { FakeKonva } from './konva.fixture.js';
import { SIG_MARGIN, footerBand, toSpec } from './composer.js';
import { signatureWidth } from './brandMark.js';
import {
  INK_ON_LIGHT, MARK_SIZE, addMark, drawMark, markBox, markGround, markInk, markWidth, newAzimutMark,
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
    expect(newAzimutMark('tl')).toEqual({ anchor: 'tl', name: true, size: MARK_SIZE });
    expect(newAzimutMark('middle').anchor).toBe('br');
  });

  it('reads what it can and bounds the rest', () => {
    expect(normalizeAzimutMark({ anchor: 'nowhere', size: 9000, name: 'yes' })).toEqual({ anchor: 'br', name: true, size: 300 });
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

  it('is as wide as the lockup, or as the arrow alone without the name', () => {
    expect(markWidth(mark())).toBeCloseTo(signatureWidth(MARK_SIZE, { tight: true }));
    expect(markWidth(mark({ name: false }))).toBeLessThan(MARK_SIZE);
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

  it('draws the arrow and the six letters, or the arrow alone', () => {
    const calls = [];
    const ctx = new Proxy({}, {
      get: (_, key) => (typeof key === 'string' && ['save', 'restore', 'translate', 'scale', 'fill', 'stroke'].includes(key)
        ? (...args) => calls.push(key) : undefined),
      set: () => true,
    });
    const makePath = (d) => d;
    const box = { x: 100, y: 100, w: markWidth(newAzimutMark()), h: MARK_SIZE };
    drawMark(ctx, newAzimutMark(), box, '#0d1117', { makePath });
    expect(calls.filter((c) => c === 'fill')).toHaveLength(2);
    // the halo first, then the ink: two strokes per flank and letter path
    expect(calls.filter((c) => c === 'stroke')).toHaveLength(2 + 7 * 2);
    calls.length = 0;
    drawMark(ctx, { ...newAzimutMark(), name: false }, box, '#0d1117', { makePath });
    expect(calls.filter((c) => c === 'stroke')).toHaveLength(2);
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
