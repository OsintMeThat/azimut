import { describe, expect, it, vi } from 'vitest';
import {
  blobBase64,
  canvasBlob,
  captureProjection,
  comparisonFilename,
  composeComparison,
  scaleBarLength,
} from './compareExport.js';

const FRAME = { lng: 2.3, lat: 48.8, zoom: 16, bearing: 0, width: 500, height: 300 };

function capture(name, pixelScale = 1) {
  return {
    canvas: { width: 500 * pixelScale, height: 300 * pixelScale, name },
    frame: FRAME,
  };
}

function fakeCanvas() {
  const calls = [];
  const record = (name) => (...args) => calls.push([name, ...args]);
  const context = {
    calls,
    fillStyle: '',
    strokeStyle: '',
    font: '',
    globalAlpha: 1,
    lineWidth: 1,
    imageSmoothingEnabled: true,
    textBaseline: 'alphabetic',
    fillRect: record('fillRect'),
    drawImage: record('drawImage'),
    fillText: record('fillText'),
    measureText: (text) => ({ width: String(text).length * 6 }),
    save: record('save'),
    restore: record('restore'),
    beginPath: record('beginPath'),
    rect: record('rect'),
    roundRect: record('roundRect'),
    clip: record('clip'),
    fill: record('fill'),
    stroke: record('stroke'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    closePath: record('closePath'),
    translate: record('translate'),
    rotate: record('rotate'),
    transform: record('transform'),
    setTransform: record('setTransform'),
    setLineDash: record('setLineDash'),
    arcTo: record('arcTo'),
  };
  return { width: 0, height: 0, context, getContext: () => context };
}

const BASE = {
  a: capture('a'),
  b: capture('b'),
  view: { lat: 48.8, lon: 2.3, zoom: 17 },
  bearing: 32,
  labelA: 'Old',
  labelB: 'New',
  makeCanvas: fakeCanvas,
};

const draws = (out) => out.context.calls.filter(([name]) => name === 'drawImage');

describe('comparison export', () => {
  it('puts side-by-side pixels beside each other under a header', () => {
    const out = composeComparison({ ...BASE, mode: 'side' });
    expect([out.width, out.height]).toEqual([1000, 48 + 300 + 26]);
    expect(draws(out).map((call) => call.slice(1))).toEqual([
      [BASE.a.canvas, 0, 48],
      [BASE.b.canvas, 500, 48],
    ]);
  });

  it('gives a titled export a taller header', () => {
    const out = composeComparison({ ...BASE, mode: 'side', title: 'Harbour' });
    expect(out.height).toBe(64 + 300 + 26);
    expect(out.context.calls).toContainEqual(['fillText', 'Harbour', 16, 25, 600]);
  });

  it('clips A and B at the swipe divider', () => {
    const out = composeComparison({ ...BASE, mode: 'swipe', divider: 73 });
    expect(out.context.calls).toContainEqual(['rect', 0, 48, 365, 300]);
    expect(out.context.calls).toContainEqual(['rect', 365, 48, 135, 300]);
  });

  it('blends B over A in opacity mode', () => {
    const out = composeComparison({ ...BASE, mode: 'opacity', opacity: 25 });
    expect(draws(out)[1][1]).toBe(BASE.b.canvas);
  });

  it('draws the chosen base once and lays the change mask on its ground', () => {
    const mask = { canvas: { width: 250, height: 150 }, frame: FRAME, base: 'a', opacity: 55, visible: true };
    const out = composeComparison({ ...BASE, mode: 'change', change: mask });
    expect(draws(out).map((call) => call[1])).toEqual([BASE.a.canvas, mask.canvas]);
    // the working mask is half the frame's size, so it is scaled back up
    const [, a, , , d] = out.context.calls.find(([name]) => name === 'transform');
    expect(a).toBeCloseTo(2);
    expect(d).toBeCloseTo(2);
    expect(out.height).toBe(48 + 300 + 26 + 30);
  });

  it('lays one reading over both images when the difference is shown on the pair', () => {
    const mask = { canvas: { width: 250, height: 150 }, frame: FRAME, base: 'side', opacity: 55, visible: true };
    const out = composeComparison({ ...BASE, mode: 'change', change: mask });
    expect(out.width).toBe(1000);
    expect(draws(out).map((call) => call[1]))
      .toEqual([BASE.a.canvas, BASE.b.canvas, mask.canvas, mask.canvas]);
    // The second copy is offset onto B's pane, not redrawn over A.
    const offsets = out.context.calls.filter(([name]) => name === 'transform').map((call) => call[5]);
    expect(offsets[1] - offsets[0]).toBe(500);
  });

  it('refuses a change export without a finished mask', () => {
    expect(() => composeComparison({ ...BASE, mode: 'change' })).toThrow('must finish');
  });

  it('shows only the frame blink is on', () => {
    const out = composeComparison({ ...BASE, mode: 'blink', blinkB: true });
    expect(draws(out).map((call) => call[1])).toEqual([BASE.b.canvas]);
  });

  it('projects the ground into a high-density capture', () => {
    const project = captureProjection(capture('a', 2), 0, 48);
    const [x, y] = project([2.3, 48.8]);
    expect(x).toBeCloseTo(500);
    expect(y).toBeCloseTo(300 + 48);
  });

  it('picks a round scale bar length', () => {
    expect(scaleBarLength(1, 120)).toEqual({ metres: 100, pixels: 100 });
    expect(scaleBarLength(3.7, 120).metres).toBe(500);
  });

  it('names the file after the comparison and a stable UTC minute', () => {
    const at = new Date('2026-09-14T08:09:10Z');
    expect(comparisonFilename('', at)).toBe('compare-202609140809');
    expect(comparisonFilename('Harbour: after/before', at)).toBe('Harbour after before 202609140809');
  });
});

describe('comparison image encoding', () => {
  it('encodes a canvas as PNG', async () => {
    const blob = new Blob(['png'], { type: 'image/png' });
    const canvas = { toBlob: (done, type) => done(type === 'image/png' ? blob : null) };
    await expect(canvasBlob(canvas)).resolves.toBe(blob);
  });

  it('turns the blob into base64 without a FileReader', async () => {
    expect(await blobBase64(new Blob([new Uint8Array([0, 1, 2, 255])]))).toBe('AAEC/w==');
  });

  it('reports a tainted provider canvas clearly', async () => {
    const canvas = { toBlob: vi.fn(() => { throw new DOMException('tainted'); }) };
    await expect(canvasBlob(canvas)).rejects.toThrow('cannot be exported');
  });
});
