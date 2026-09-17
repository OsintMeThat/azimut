// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeSettings } from './changeAssist.js';

const runChangeDetection = vi.fn(async ({ width, height }) => ({
  pixels: new Uint8ClampedArray(width * height * 4), width, height, counts: {},
}));
vi.mock('./changeRunner.js', () => ({ runChangeDetection }));
const { detectCaptures, spectralPixels } = await import('./changeCapture.js');
const frame = { lng: 2.3, lat: 48.8, zoom: 15, bearing: 35, width: 800, height: 600 };
const contexts = [];

beforeEach(() => {
  vi.clearAllMocks();
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
      width: 1536, height: 1152, index: null, metresPerPixel: expect.any(Number),
    }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requests the named pass and projects its index pixels onto a rotated frame', async () => {
    const bitmap = { close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
    fetch.mockResolvedValue({ ok: true, blob: async () => new Blob() });
    const data = await spectralPixels(frame, 80, 60, {
      sentinel: { date: '2026-09-01', layer: 'TRUE_COLOR', maxcc: 30 },
    }, 'ndvi');
    expect(data.length).toBe(80 * 60 * 4);
    const [url, request] = fetch.mock.calls[0];
    expect(url).toBe('/api/compare/sentinel-index');
    expect(request.method).toBe('POST');
    expect(JSON.parse(request.body)).toMatchObject({ day: '2026-09-01', index: 'ndvi', maxcc: 30, width: 80, height: 60 });
    const matrix = contexts[0].setTransform.mock.calls[0];
    expect(matrix.every(Number.isFinite)).toBe(true);
    expect(matrix[1]).not.toBe(0);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('reports a quota refusal without decoding or computing a mask', async () => {
    fetch.mockResolvedValue({ ok: false, status: 429, json: async () => ({ detail: 'Sentinel Hub is paused' }) });
    await expect(spectralPixels(frame, 80, 60, { sentinel: { date: '2026-09-01' } }, 'ndvi'))
      .rejects.toThrow('Sentinel Hub is paused');
    expect(runChangeDetection).not.toHaveBeenCalled();
  });
});
