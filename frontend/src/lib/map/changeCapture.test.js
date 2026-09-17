// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeSettings } from './changeAssist.js';

const runChangeDetection = vi.fn(async ({ width, height }) => ({
  pixels: new Uint8ClampedArray(width * height * 4), width, height, counts: {},
}));
vi.mock('./changeRunner.js', () => ({ runChangeDetection }));
const { detectCaptures, bandFrame, forgetBandFrames } = await import('./changeCapture.js');
const frame = { lng: 2.3, lat: 48.8, zoom: 15, bearing: 35, width: 800, height: 600 };
const contexts = [];

beforeEach(() => {
  vi.clearAllMocks();
  forgetBandFrames();
  contexts.length = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
    const context = {
      drawImage: vi.fn(), setTransform: vi.fn(), putImageData: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(this.width * this.height * 4) })),
    };
    contexts.push(context);
    return context;
  });
  vi.stubGlobal('ImageData', class {
    constructor(data, width, height) { Object.assign(this, { data, width, height }); }
  });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('captured change frames', () => {
  it('bounds worker frames and retains their exact ground frame without network', async () => {
    const capture = { canvas: { width: 1600, height: 1200 }, frame };
    const result = await detectCaptures({ a: capture, b: capture }, changeSettings(), []);
    expect(result.frame).toEqual(frame);
    expect(result.canvas.width).toBe(1536);
    expect(result.canvas.height).toBe(1152);
    expect(runChangeDetection).toHaveBeenCalledWith(expect.objectContaining({
      width: 1536, height: 1152, frames: null, metresPerPixel: expect.any(Number),
      ground: expect.objectContaining({ lat: frame.lat, bearing: frame.bearing }),
    }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requests the named pass with a margin, and projects it onto a rotated frame', async () => {
    const bitmap = { close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
    fetch.mockResolvedValue({ ok: true, blob: async () => new Blob() });
    const side = { sentinel: { date: '2026-09-01', layer: 'TRUE_COLOR', maxcc: 30 } };
    const data = await bandFrame(frame, 80, 60, side, 'ndvi');
    expect(data.length).toBe(80 * 60 * 4);
    const [url, request] = fetch.mock.calls[0];
    expect(url).toBe('/api/compare/sentinel-frame');
    expect(request.method).toBe('POST');
    const asked = JSON.parse(request.body);
    expect(asked).toMatchObject({ day: '2026-09-01', product: 'ndvi', maxcc: 30 });
    // Ground is kept around the view, at the resolution the reading works at.
    expect(asked.width).toBeGreaterThan(80);
    expect(asked.height).toBeGreaterThan(60);
    const matrix = contexts[0].setTransform.mock.calls[0];
    expect(matrix.every(Number.isFinite)).toBe(true);
    expect(matrix[1]).not.toBe(0);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('serves a pan inside the margin from the frame it holds, and refuses to fetch on its own', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close: vi.fn() })));
    fetch.mockResolvedValue({ ok: true, blob: async () => new Blob() });
    const side = { sentinel: { date: '2026-09-01', layer: 'TRUE_COLOR', maxcc: 30 } };
    await bandFrame(frame, 80, 60, side, 'ndvi');
    expect(fetch).toHaveBeenCalledTimes(1);
    // a nudge of the camera: the held frame still reaches, so nothing is spent
    const nudged = { ...frame, lng: frame.lng + 0.0005 };
    expect(await bandFrame(nudged, 80, 60, side, 'ndvi')).not.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    // a move past the margin, with no leave to fetch: the caller is told, not billed
    const away = { ...frame, lng: frame.lng + 0.2 };
    expect(await bandFrame(away, 80, 60, side, 'ndvi', false)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await bandFrame(away, 80, 60, side, 'ndvi')).not.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('fetches the sky alone when the cloud filter is on over the picture methods', async () => {
    const bitmap = { close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
    fetch.mockResolvedValue({ ok: true, blob: async () => new Blob() });
    const capture = { canvas: { width: 400, height: 300 }, frame };
    const sides = [{ sentinel: { date: '2026-08-01' } }, { sentinel: { date: '2026-09-01' } }];
    await detectCaptures({ a: capture, b: capture }, changeSettings({ ignore_clouds: true }), sides,
      { ok: true, clouds: true, family: 'sentinel2' });
    expect(fetch.mock.calls.map(([, request]) => JSON.parse(request.body).product)).toEqual(['sky', 'sky']);
    // A reading that follows the camera may use what is held, never the network.
    forgetBandFrames();
    fetch.mockClear();
    const held = await detectCaptures({ a: capture, b: capture },
      changeSettings({ ignore_clouds: true }), sides, { ok: true, clouds: true, family: 'sentinel2' }, false);
    expect(held).toEqual({ needsFetch: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(runChangeDetection).toHaveBeenCalledWith(expect.objectContaining({
      family: 'sentinel2',
      ground: expect.objectContaining({ days: ['2026-08-01', '2026-09-01'] }),
    }));
  });

  it('reports a quota refusal without decoding or computing a mask', async () => {
    fetch.mockResolvedValue({ ok: false, status: 429, json: async () => ({ detail: 'Sentinel Hub is paused' }) });
    await expect(bandFrame(frame, 80, 60, { sentinel: { date: '2026-09-01' } }, 'ndvi'))
      .rejects.toThrow('Sentinel Hub is paused');
    expect(runChangeDetection).not.toHaveBeenCalled();
  });
});
