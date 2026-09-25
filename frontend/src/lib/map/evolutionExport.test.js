import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  composeEvolutionFrame, composeEvolutionSheet, drawPicture, drawPictures, fetchTile,
} from './evolutionExport.js';

const PROVIDER = { tile_size: 256, max_zoom: 19 };
const FRAME = { lng: 2.35, lat: 48.85, zoom: 16, bearing: 0, width: 600, height: 400 };

/** A canvas whose context records what is drawn, and can say what its pixels are. */
function fakeCanvas(pixels = () => null) {
  const calls = [];
  const record = (name) => (...args) => calls.push([name, ...args]);
  const canvas = { width: 0, height: 0, calls };
  const context = {
    calls,
    measureText: (text) => ({ width: String(text).length * 6 }),
    getImageData: () => ({ data: pixels(canvas) }),
  };
  for (const name of [
    'fillRect', 'drawImage', 'fillText', 'save', 'restore', 'beginPath', 'rect', 'roundRect', 'clip',
    'fill', 'stroke', 'moveTo', 'lineTo', 'closePath', 'translate', 'rotate', 'scale', 'transform',
    'setTransform', 'setLineDash', 'arcTo', 'arc',
  ]) {
    context[name] = record(name);
  }
  canvas.getContext = () => context;
  return canvas;
}

const tileImage = () => ({ width: 256, height: 256, close: vi.fn() });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('drawing one picture', () => {
  it('asks the proxy for each tile of the variant and paints them in the plan order', async () => {
    const urls = [];
    const loadTile = vi.fn(async (url) => {
      urls.push(url);
      return tileImage();
    });
    const picture = await drawPicture({
      frame: FRAME, pixelScale: 1, provider: PROVIDER, variant: 'esri-wayback~20', loadTile, makeCanvas: () => fakeCanvas(),
    });
    expect(picture.empty).toBe(false);
    expect([picture.canvas.width, picture.canvas.height]).toEqual([600, 400]);
    expect(urls.every((url) => url.startsWith('/api/tiles/esri-wayback~20/17/'))).toBe(true);
    const painted = picture.canvas.calls.filter(([name]) => name === 'drawImage');
    expect(painted).toHaveLength(urls.length);
    // Each tile is grown by half an output pixel on every side.
    expect(painted[0].slice(6)).toEqual([-0.5, -0.5, 257, 257].map((value) => expect.closeTo(value, 6)));
  });

  it('leaves ground the archive does not cover dark, and says when none was covered', async () => {
    const picture = await drawPicture({
      frame: FRAME, pixelScale: 1, provider: PROVIDER, variant: 'sentinel2', loadTile: async () => null,
      makeCanvas: () => fakeCanvas(),
    });
    expect(picture.empty).toBe(true);
  });

  it('ends on the proxy refusing, with its own sentence', async () => {
    const refusal = new Error('Copernicus is paused');
    const loadTile = vi.fn(async (url) => {
      if (url.endsWith('/0') || loadTile.mock.calls.length > 2) throw refusal;
      return tileImage();
    });
    await expect(drawPicture({
      frame: FRAME, pixelScale: 1, provider: PROVIDER, variant: 'sentinel2', loadTile, makeCanvas: () => fakeCanvas(),
    })).rejects.toBe(refusal);
  });

  it('refuses a frame that would take too many tiles', async () => {
    await expect(drawPicture({
      frame: { ...FRAME, width: 5000, height: 5000 }, pixelScale: 1, provider: PROVIDER, variant: 'x',
      loadTile: async () => tileImage(), makeCanvas: () => fakeCanvas(),
    })).rejects.toThrow('too many tiles');
  });
});

describe('drawing the pictures', () => {
  const ENTRIES = ['a', 'b', 'c', 'd'].map((key) => ({ key, date: '2024-01-01' }));
  // The picture being drawn, so a stand-in canvas knows which pixels to report.
  let current = null;

  it('leaves out a picture with no imagery and one repeating the one before, and counts both', async () => {
    const shown = { a: 1, b: null, c: 1, d: 2 };
    const seen = [];
    const tally = await drawPictures({
      entries: ENTRIES,
      frame: { ...FRAME, width: 256, height: 256 },
      pixelScale: 1,
      provider: PROVIDER,
      variantFor: (entry) => entry.key,
      loadTile: async (url) => (shown[url.split('/')[3]] === null ? null : tileImage()),
      makeCanvas: () => {
        const canvas = fakeCanvas(() => new Uint8ClampedArray([shown[current]]));
        return canvas;
      },
      onprogress: (done) => (current = ENTRIES[done]?.key),
      onpicture: async ({ entry, index }) => seen.push([entry.key, index]),
    });
    expect(seen).toEqual([['a', 0], ['d', 3]]);
    expect(tally).toEqual({ drawn: 2, empty: 1, repeated: 1 });
  });

  it('stops between two pictures once cancelled', async () => {
    const controller = new AbortController();
    const onpicture = vi.fn(async () => controller.abort());
    await expect(drawPictures({
      entries: ENTRIES, frame: FRAME, pixelScale: 1, provider: PROVIDER, variantFor: () => 'x',
      signal: controller.signal, loadTile: async () => tileImage(), makeCanvas: () => fakeCanvas(), onpicture,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(onpicture).toHaveBeenCalledTimes(1);
  });
});

describe('fetching a tile', () => {
  it('reads a 404 as ground with no imagery', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    expect(await fetchTile('/api/tiles/x/1/0/0')).toBeNull();
  });

  it('passes a refusal on in the proxy’s words', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'Sentinel-2 is paused' }), { status: 429 })));
    await expect(fetchTile('/api/tiles/x/1/0/0')).rejects.toMatchObject({ message: 'Sentinel-2 is paused', status: 429 });
  });
});

describe('composing', () => {
  const picture = () => {
    const canvas = fakeCanvas();
    canvas.width = 1200;
    canvas.height = 800;
    return { canvas, frame: { ...FRAME, width: 1200, height: 800 } };
  };
  const texts = (out) => out.calls.filter(([name]) => name === 'fillText').map(([, text]) => text);

  it('dates a frame on the imagery, places it on the line of dates, and credits the archive', () => {
    const out = composeEvolutionFrame({
      picture: picture(), title: 'Harbour', label: 'Esri Wayback', date: '~2021-05-02', current: 1,
      positions: [0, 0.5, 1], attribution: 'Esri, Maxar', makeCanvas: () => fakeCanvas(),
    });
    const s = 1.2;
    expect(out.width).toBe(1200);
    expect(out.height).toBe(Math.round(64 * s) + 800 + Math.round(46 * s));
    expect(texts(out)).toEqual(expect.arrayContaining(['~2021-05-02', 'Harbour', 'Esri Wayback · 3 pictures', 'Esri, Maxar']));
    // two quiet ticks and a lit one
    const ticks = out.calls.filter(([name, , , w, h]) => name === 'fillRect' && h >= 8 * s && w <= 4 * s);
    expect(ticks).toHaveLength(3);
  });

  it('only draws the marks set on both sides', () => {
    const mark = (id, side) => ({ id, side, kind: 'rect', colour: '#ef4444', points: [[2.349, 48.849], [2.351, 48.851]] });
    const out = composeEvolutionFrame({
      picture: picture(), label: 'Sentinel-2', date: '2024-01-01', current: 0, positions: [0, 1],
      annotations: [mark('shared', 'both'), mark('before', 'a')], makeCanvas: () => fakeCanvas(),
    });
    const outlines = out.calls.filter(([name]) => name === 'stroke');
    expect(outlines.length).toBeGreaterThan(0);
    const alone = composeEvolutionFrame({
      picture: picture(), label: 'Sentinel-2', date: '2024-01-01', current: 0, positions: [0, 1],
      annotations: [mark('before', 'a')], makeCanvas: () => fakeCanvas(),
    });
    expect(alone.calls.filter(([name]) => name === 'stroke').length).toBeLessThan(outlines.length);
  });

  it('signs the credits line when asked', () => {
    const paths = [];
    vi.stubGlobal('Path2D', class { constructor(d) { paths.push(d); } });
    const input = {
      picture: picture(), label: 'Sentinel-2', date: '2024-01-01', current: 0, positions: [0, 1],
      makeCanvas: () => fakeCanvas(),
    };
    composeEvolutionFrame({ ...input, signed: false });
    expect(paths).toHaveLength(0);
    composeEvolutionFrame({ ...input, signed: true });
    expect(paths).toHaveLength(9); // two flanks, seven letter strokes
  });

  it('lays a sheet out in rows, oldest first, with one date per cell', () => {
    const cells = ['2020', '2021', '2022', '2023', '2024'].map((year) => {
      const canvas = fakeCanvas();
      canvas.width = 400;
      canvas.height = 300;
      return { picture: { canvas, frame: { ...FRAME, width: 400, height: 300 } }, date: `${year}-06-01` };
    });
    const out = composeEvolutionSheet({ cells, label: 'Sentinel-2', span: '2020-06-01 to 2024-06-01', makeCanvas: () => fakeCanvas() });
    // five pictures in three columns, two rows
    expect(out.width).toBe(3 * 400 + 4 * 8);
    expect(out.height).toBe(48 + 2 * 300 + 3 * 8 + 26);
    const placed = out.calls.filter(([name]) => name === 'drawImage').map(([, , x, y]) => [x, y]);
    expect(placed).toEqual([[8, 56], [416, 56], [824, 56], [8, 364], [416, 364]]);
    expect(texts(out)).toEqual(expect.arrayContaining([
      '2020-06-01', '2024-06-01', 'Sentinel-2 · 5 pictures · 2020-06-01 to 2024-06-01',
    ]));
  });
});
