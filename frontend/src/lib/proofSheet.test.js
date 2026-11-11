import { describe, expect, it } from 'vitest';
import {
  SHEET_COLORS, SHEET_HEIGHT, SHEET_MAX, SHEET_MAX_BYTES, SHEET_WIDTH, buildProofSheet, containIn, sheetLayout, sheetPreview, sheetTiles,
} from './proofSheet.js';

/**
 * The contact sheet of a video's series, drawn on a canvas that writes down what it is
 * asked to draw: the browser draws the real one (the e2e screenshot), these hold its
 * rules.
 */

function recorder({ sizes = () => 400_000, charWidth = 8 } = {}) {
  const made = [];
  const makeCanvas = (width, height) => {
    const calls = [];
    const ctx = {
      fillStyle: '', font: '', textAlign: '', textBaseline: '',
      fillRect: (...args) => calls.push({ op: 'fillRect', args, fill: ctx.fillStyle }),
      fillText: (text, x, y) => calls.push({ op: 'fillText', text, x, y, fill: ctx.fillStyle, align: ctx.textAlign }),
      drawImage: (image, x, y, w, h) => calls.push({ op: 'drawImage', image, x, y, w, h }),
      measureText: (text) => ({ width: String(text).length * charWidth }),
    };
    const encoded = [];
    const canvas = {
      width, height, calls, encoded,
      getContext: () => ctx,
      convertToBlob: async ({ type, quality }) => {
        encoded.push({ type, quality });
        return new Blob([new Uint8Array(Math.min(sizes(quality), 2_000_000))], { type });
      },
    };
    made.push(canvas);
    return canvas;
  };
  return { made, makeCanvas };
}

const slide = (i, extra = {}) => ({
  title: `Place ${i}`, moments: [{ start: i * 10, end: i * 10 + 5 }], png: `proofs/p${i}.png`, ...extra,
});

function pictures() {
  const log = [];
  let open = 0;
  let most = 0;
  const loadPicture = async (path, width) => {
    open += 1;
    most = Math.max(most, open);
    log.push({ path, width });
    await Promise.resolve();
    return { width: 400, height: 300, close: () => { open -= 1; } };
  };
  return { log, loadPicture, most: () => most, open: () => open };
}

describe('the tiles', () => {
  it('number the slides as the thread posts them, the time beside each as a post prints it, none for the whole video', () => {
    const { tiles, more } = sheetTiles([slide(1), slide(2, { moments: [] }), slide(3, { moments: [{ start: 3.2, end: null }] })]);
    expect(more).toBe(0);
    expect(tiles).toEqual([
      { number: 1, time: '[0:10–0:15]', short: '[0:10–0:15]', png: 'proofs/p1.png' },
      { number: 2, time: '', short: '', png: 'proofs/p2.png' },
      { number: 3, time: '[0:03]', short: '[0:03]', png: 'proofs/p3.png' },
    ]);
  });

  it('stop at 48', () => {
    const many = Array.from({ length: 60 }, (_, i) => slide(i + 1));
    const { tiles, more } = sheetTiles(many);
    expect(SHEET_MAX).toBe(48);
    expect(tiles).toHaveLength(48);
    expect(more).toBe(12);
  });
});

describe('the layout', () => {
  it('is 16:9 and keeps every cell inside the page and apart from the others', () => {
    expect(SHEET_WIDTH / SHEET_HEIGHT).toBeCloseTo(16 / 9);
    for (let count = 1; count <= SHEET_MAX; count += 1) {
      const { cells, header, margin } = sheetLayout(count);
      expect(cells).toHaveLength(count);
      for (const [i, c] of cells.entries()) {
        expect(c.x).toBeGreaterThanOrEqual(margin - 1e-6);
        expect(c.y).toBeGreaterThanOrEqual(margin + header - 1e-6);
        expect(c.x + c.w).toBeLessThanOrEqual(SHEET_WIDTH - margin + 1e-6);
        expect(c.y + c.h).toBeLessThanOrEqual(SHEET_HEIGHT - margin + 1e-6);
        expect(c.box.h).toBeGreaterThan(40);
        for (const d of cells.slice(i + 1)) {
          const apart = c.x + c.w <= d.x + 1e-6 || d.x + d.w <= c.x + 1e-6 || c.y + c.h <= d.y + 1e-6 || d.y + d.h <= c.y + 1e-6;
          expect(apart, `${count}: cells ${i} and another overlap`).toBe(true);
        }
      }
    }
  });

  it('lays a few slides out large and many in more columns', () => {
    expect(sheetLayout(1).cols).toBe(1);
    expect(sheetLayout(4).cols).toBe(2);
    expect(sheetLayout(48).cols).toBeGreaterThanOrEqual(8);
  });

  it('fits a picture whole in its box, centred', () => {
    expect(containIn({ x: 0, y: 0, w: 200, h: 100 }, 400, 400)).toEqual({ x: 50, y: 0, w: 100, h: 100 });
    expect(containIn({ x: 10, y: 10, w: 200, h: 100 }, 400, 100)).toEqual({ x: 10, y: 35, w: 200, h: 50 });
  });
});

describe('the sheet', () => {
  it('is a JPEG under Bluesky\'s picture size, in fixed colours, numbered and timed, with no title', async () => {
    const { made, makeCanvas } = recorder();
    const pics = pictures();
    const blob = await buildProofSheet([slide(1), slide(2, { moments: [] })], { makeCanvas, loadPicture: pics.loadPicture });

    expect(blob.type).toBe('image/jpeg');
    expect(blob.size).toBeLessThanOrEqual(SHEET_MAX_BYTES);
    const [canvas] = made;
    expect([canvas.width, canvas.height]).toEqual([1600, 900]);
    const texts = canvas.calls.filter((c) => c.op === 'fillText').map((c) => c.text);
    // the numbers and the time, and nothing else: `#scenes` is the legend
    expect(texts).toEqual(['1', '[0:10–0:15]', '2']);
    // the whole-video proof prints no time
    expect(texts.filter((t) => /\d:\d\d/.test(t))).toEqual(['[0:10–0:15]']);
    // the page is the sheet's own colour, whatever the app's theme
    expect(canvas.calls[0]).toMatchObject({ op: 'fillRect', args: [0, 0, 1600, 900], fill: SHEET_COLORS.page });
  });

  it('decodes one picture at a time, at its cell\'s width, and lets it go before the next', async () => {
    const { makeCanvas } = recorder();
    const pics = pictures();
    await buildProofSheet(Array.from({ length: 12 }, (_, i) => slide(i + 1)), { makeCanvas, loadPicture: pics.loadPicture });
    expect(pics.log).toHaveLength(12);
    expect(pics.most()).toBe(1);
    expect(pics.open()).toBe(0);
    const { cells } = sheetLayout(12);
    expect(pics.log[0].width).toBeCloseTo(cells[0].box.w);
  });

  it('draws each picture whole inside its box', async () => {
    const { made, makeCanvas } = recorder();
    const pics = pictures();
    await buildProofSheet([slide(1), slide(2), slide(3)], { makeCanvas, loadPicture: pics.loadPicture });
    const drawn = made[0].calls.filter((c) => c.op === 'drawImage');
    const { cells } = sheetLayout(3);
    expect(drawn).toHaveLength(3);
    drawn.forEach((d, i) => {
      const box = cells[i].box;
      expect(d.x).toBeGreaterThanOrEqual(box.x - 1e-6);
      expect(d.y).toBeGreaterThanOrEqual(box.y - 1e-6);
      expect(d.x + d.w).toBeLessThanOrEqual(box.x + box.w + 1e-6);
      expect(d.y + d.h).toBeLessThanOrEqual(box.y + box.h + 1e-6);
      expect(d.w / d.h).toBeCloseTo(4 / 3);
    });
  });

  it('says the first time and counts the rest in a cell too narrow for them all', async () => {
    const { made, makeCanvas } = recorder({ charWidth: 9 });
    const pics = pictures();
    const many = Array.from({ length: 48 }, (_, i) => slide(i + 1, { moments: [{ start: 0, end: 7 }, { start: 185, end: 192 }] }));
    await buildProofSheet(many, { makeCanvas, loadPicture: pics.loadPicture });
    const texts = made[0].calls.filter((c) => c.op === 'fillText').map((c) => c.text);
    expect(texts).toContain('[0:00–0:07] +1');
    expect(texts).not.toContain('[0:00–0:07] [3:05–3:12]');
  });

  it('says No picture in a cell whose picture will not load, and goes on', async () => {
    const { made, makeCanvas } = recorder();
    const loadPicture = async (path) => {
      if (path.endsWith('p1.png')) throw new Error('gone');
      return { width: 10, height: 10, close() {} };
    };
    await buildProofSheet([slide(1), slide(2), slide(3, { png: null })], { makeCanvas, loadPicture });
    const texts = made[0].calls.filter((c) => c.op === 'fillText').map((c) => c.text);
    expect(texts.filter((t) => t === 'No picture')).toHaveLength(2);
    expect(made[0].calls.filter((c) => c.op === 'drawImage')).toHaveLength(1);
  });

  it('shows the first 48 places and draws no more', async () => {
    const { made, makeCanvas } = recorder();
    const pics = pictures();
    await buildProofSheet(Array.from({ length: 50 }, (_, i) => slide(i + 1)), { makeCanvas, loadPicture: pics.loadPicture });
    expect(pics.log).toHaveLength(48);
    const texts = made[0].calls.filter((c) => c.op === 'fillText').map((c) => c.text);
    expect(texts.filter((t) => /^\d+$/.test(t)).at(-1)).toBe('48');
  });

  it('lowers the quality a step at a time until the picture is small enough', async () => {
    const { made, makeCanvas } = recorder({ sizes: (q) => (q > 0.8 ? 1_400_000 : 700_000) });
    const pics = pictures();
    const blob = await buildProofSheet([slide(1)], { makeCanvas, loadPicture: pics.loadPicture });
    expect(made[0].encoded.map((e) => e.quality)).toEqual([0.9, 0.82, 0.74]);
    expect(blob.size).toBe(700_000);
  });

  it('gives a small preview with a URL to show and let go', async () => {
    const { made, makeCanvas } = recorder();
    const pics = pictures();
    const preview = await sheetPreview([slide(1)], { makeCanvas, loadPicture: pics.loadPicture });
    expect([made[0].width, made[0].height]).toEqual([800, 450]);
    expect(preview.url).toMatch(/^blob:/);
    expect(preview.blob.size).toBeGreaterThan(0);
    preview.revoke();
  });
});
