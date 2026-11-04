// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { drawPage, pageScale, releaseCanvas } from './pdfjs.js';

describe('drawing a page', () => {
  it('draws at the screen\'s sharpness, never past two', () => {
    expect(pageScale(1)).toBe(1);
    expect(pageScale(1.5)).toBe(1.5);
    expect(pageScale(3)).toBe(2);
    expect(pageScale(undefined)).toBe(1);
  });

  it('sizes the canvas for its width at that sharpness, and hands the page its canvas', async () => {
    const render = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
    const page = {
      getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
      render,
    };
    const doc = { getPage: vi.fn(async () => page) };
    globalThis.devicePixelRatio = 3;
    const canvas = await drawPage(doc, 2, 300);
    expect(doc.getPage).toHaveBeenCalledWith(3);
    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(800);
    expect(canvas.style.width).toBe('300px');
    expect(canvas.style.height).toBe('400px');
    expect(render.mock.calls[0][0].canvas).toBe(canvas);
    globalThis.devicePixelRatio = 1;
  });

  it('cancels a drawing no longer wanted', async () => {
    const cancel = vi.fn();
    const page = {
      getViewport: () => ({ width: 10, height: 10 }),
      render: () => ({ promise: new Promise(() => {}), cancel }),
    };
    const controller = new AbortController();
    void drawPage({ getPage: async () => page }, 0, 10, { signal: controller.signal });
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    expect(cancel).toHaveBeenCalled();
  });

  it('lets a canvas\'s pixels go', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    document.body.append(canvas);
    releaseCanvas(canvas);
    expect(canvas.width).toBe(0);
    expect(canvas.isConnected).toBe(false);
    expect(() => releaseCanvas(null)).not.toThrow();
  });
});
