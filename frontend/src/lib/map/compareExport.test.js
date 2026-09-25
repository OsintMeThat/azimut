import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  blobBase64,
  canvasBlob,
  captureProjection,
  comparisonFilename,
  pictureDateFields,
  composeComparison,
  gifColours,
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
    scale: record('scale'),
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

/** A framed export: the capture and its frame are both cut down. */
const FRAMED = {
  canvas: { width: 300, height: 300 },
  frame: { ...FRAME, width: 300, height: 300 },
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

  const mask = (base) => ({ canvas: { width: 250, height: 150 }, frame: FRAME, base, opacity: 55 });

  it('lays the difference on its ground, scaled back up, with a legend', () => {
    const change = mask('a');
    const out = composeComparison({ ...BASE, mode: 'side', change });
    expect(draws(out).map((call) => call[1])).toEqual([BASE.a.canvas, BASE.b.canvas, change.canvas]);
    // the working mask is half the frame's size, so it is scaled back up
    const [, a, , , d] = out.context.calls.find(([name]) => name === 'transform');
    expect(a).toBeCloseTo(2);
    expect(d).toBeCloseTo(2);
    expect(out.width).toBe(1000);
    expect(out.height).toBe(48 + 300 + 26 + 30);
  });

  it('lays one reading over both panes side by side', () => {
    const change = mask('both');
    const out = composeComparison({ ...BASE, mode: 'side', change });
    expect(draws(out).map((call) => call[1]))
      .toEqual([BASE.a.canvas, BASE.b.canvas, change.canvas, change.canvas]);
    // The second copy is offset onto B's pane, not redrawn over A.
    const offsets = out.context.calls.filter(([name]) => name === 'transform').map((call) => call[5]);
    expect(offsets[1] - offsets[0]).toBe(500);
  });

  it('keeps the view mode under the difference', () => {
    const change = mask('b');
    const swipe = composeComparison({ ...BASE, mode: 'swipe', divider: 40, change });
    expect(swipe.width).toBe(500);
    expect(draws(swipe).map((call) => call[1])).toEqual([BASE.a.canvas, BASE.b.canvas, change.canvas]);
    // blink shows the highlights only on the side that carries them
    const onA = composeComparison({ ...BASE, mode: 'blink', blinkB: false, change });
    expect(draws(onA).map((call) => call[1])).toEqual([BASE.a.canvas]);
    const onB = composeComparison({ ...BASE, mode: 'blink', blinkB: true, change });
    expect(draws(onB).map((call) => call[1])).toEqual([BASE.b.canvas, change.canvas]);
  });

  it('fades B’s highlights with B', () => {
    const alphas = [];
    const makeCanvas = () => {
      const canvas = fakeCanvas();
      const { context } = canvas;
      const saved = [];
      context.save = () => saved.push(context.globalAlpha);
      context.restore = () => { context.globalAlpha = saved.pop(); };
      context.drawImage = (image) => alphas.push([image, context.globalAlpha]);
      return canvas;
    };
    const change = mask('b');
    composeComparison({ ...BASE, makeCanvas, mode: 'opacity', opacity: 40, change });
    // B's highlights are drawn inside B's faded pass: B's alpha times their own.
    expect(alphas[0]).toEqual([BASE.a.canvas, 1]);
    expect(alphas[1]).toEqual([BASE.b.canvas, 0.4]);
    expect(alphas[2][0]).toBe(change.canvas);
    expect(alphas[2][1]).toBeCloseTo(0.4 * 0.55);
  });

  it('draws nothing extra and no legend without a difference', () => {
    const out = composeComparison({ ...BASE, mode: 'swipe', divider: 50 });
    expect(draws(out).map((call) => call[1])).toEqual([BASE.a.canvas, BASE.b.canvas]);
    expect(out.height).toBe(48 + 300 + 26);
  });

  it('refuses a difference export without a finished mask', () => {
    expect(() => composeComparison({ ...BASE, mode: 'side', change: { base: 'both' } })).toThrow('must finish');
  });

  it('shows only the frame blink is on', () => {
    const out = composeComparison({ ...BASE, mode: 'blink', blinkB: true });
    expect(draws(out).map((call) => call[1])).toEqual([BASE.b.canvas]);
  });

  it('writes the camera reading beside the labels when the width allows', () => {
    const out = composeComparison({ ...BASE, mode: 'side' });
    const camera = out.context.calls.find(([name, text]) => name === 'fillText' && String(text).includes('z17'));
    expect(camera).toBeTruthy();
  });

  it('drops the camera reading rather than write it over the labels', () => {
    const out = composeComparison({ ...BASE, a: FRAMED, b: FRAMED, mode: 'blink' });
    const written = out.context.calls.filter(([name]) => name === 'fillText').map(([, text]) => text);
    expect(written).toContain('Old');
    expect(written).toContain('New');
    expect(written.some((text) => String(text).includes('z17'))).toBe(false);
  });

  it('holds annotations inside the pane they belong to', () => {
    const marks = [{ id: 'far', kind: 'text', side: 'a', colour: '#f6a81a',
      points: [[2.5, 48.9]], text: 'Off frame', font_size: 16, stroke_width: 3, fill_opacity: 0 }];
    const out = composeComparison({ ...BASE, mode: 'side', annotations: marks });
    expect(out.context.calls).toContainEqual(['rect', 0, 48, 500, 300]);
    expect(out.context.calls).toContainEqual(['rect', 500, 48, 500, 300]);
  });

  it('drops a change legend entry that would run off a framed export', () => {
    const out = composeComparison({ ...BASE, a: FRAMED, b: FRAMED, mode: 'blink', change: mask('a') });
    const written = out.context.calls.filter(([name]) => name === 'fillText').map(([, text]) => text);
    expect(written).toContain('Appeared or brighter in B');
    expect(written).not.toContain('Other change');
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

  it('names the file after the comparison and the dates of its two pictures', () => {
    const at = new Date('2026-09-14T08:09:10Z');
    const dates = { a: '2024-05-03', b: '2026-09-02T05:42:10Z' };
    expect(comparisonFilename('Harbour', dates, at)).toBe('Harbour 2024-05-03_2026-09-02T0542Z');
    expect(comparisonFilename('', dates, at)).toBe('compare-2024-05-03_2026-09-02T0542Z');
    expect(comparisonFilename('', { b: '2026-09-02' }, at)).toBe('compare-undated_2026-09-02');
  });

  it('files each dated picture, and says which date was only estimated', () => {
    expect(pictureDateFields({
      a: { imageryWhen: '2024-05-03', imageryExact: false },
      b: { imageryWhen: '2026-09-02T05:42:10Z', imageryExact: true },
    })).toEqual([
      ['imagery_a', '2024-05-03'], ['imagery_a_exact', 'false'], ['imagery_b', '2026-09-02T05:42:10Z'],
    ]);
    expect(pictureDateFields({ a: { imageryWhen: null }, b: {} })).toEqual([]);
  });

  it('falls back to a stable UTC minute when neither picture is dated', () => {
    const at = new Date('2026-09-14T08:09:10Z');
    expect(comparisonFilename('', {}, at)).toBe('compare-202609140809');
    expect(comparisonFilename('Harbour: after/before', {}, at)).toBe('Harbour after before 202609140809');
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

describe('keeping colours in a GIF', () => {
  it('names every mark colour, the numeral inks and the export inks, each once', () => {
    const marks = [
      { id: 'a', kind: 'rect', colour: '#EF4444', points: [[0, 0], [1, 1]] },
      { id: 'b', kind: 'number', colour: '#f6a81a', number: 1, points: [[0, 0]] },
      { id: 'c', kind: 'line', colour: '#ef4444', points: [[0, 0], [1, 1]] },
    ];
    const kept = gifColours(marks).split(',');
    expect(kept.slice(0, 3)).toEqual(['#ef4444', '#f6a81a', '#14161a']);
    expect(kept).toEqual(expect.arrayContaining(['#e8a33d', '#f3f4f6', '#0f1114']));
    expect(new Set(kept).size).toBe(kept.length);
    expect(kept).not.toContain('#e3e3e3');
    expect(gifColours([], { signed: true }).split(',')).toContain('#e3e3e3');
  });

  it('stays inside what the server reads', () => {
    const marks = Array.from({ length: 60 }, (_, index) => ({
      id: `m${index}`, kind: 'line', colour: `#${index.toString(16).padStart(6, '0')}`, points: [[0, 0], [1, 1]],
    }));
    const field = gifColours(marks, { signed: true });
    expect(field.split(',')).toHaveLength(32);
    expect(field).toMatch(/^(#[0-9a-f]{6})(,#[0-9a-f]{6})*$/);
  });
});

describe('signing an export', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('closes the credits line with the lockup, and shortens the credits to make room', () => {
    const paths = [];
    vi.stubGlobal('Path2D', class { constructor(d) { paths.push(d); } });
    const plain = composeComparison({ ...BASE, mode: 'side' });
    expect(paths).toHaveLength(0);
    const signed = composeComparison({ ...BASE, mode: 'side', signed: true });
    expect(paths).toHaveLength(9);
    const credits = (out) => out.context.calls.filter(([name, text]) => name === 'fillText' && String(text).startsWith('A: '));
    expect(credits(signed)[0][4]).toBeLessThan(credits(plain)[0][4]);
    expect([signed.width, signed.height]).toEqual([plain.width, plain.height]);
  });

  it('leaves the picture whole where the browser cannot trace the lockup', () => {
    vi.stubGlobal('Path2D', undefined);
    expect(() => composeComparison({ ...BASE, mode: 'side', signed: true })).not.toThrow();
  });
});
