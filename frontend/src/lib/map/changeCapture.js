/** Capture-sized change detection, with on-demand spectral frames. */
import { runChangeDetection } from './changeRunner.js';
import { compose, frameBox, groundPerPixel, imageToMercator, invert, scale, screenToMercator } from './groundFrame.js';

export async function spectralPixels(frame, width, height, side, index) {
  const box = frameBox(frame);
  const response = await fetch('/api/compare/sentinel-index', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...box, width, height, day: side.sentinel.effectiveDate || side.sentinel.date,
      maxcc: side.sentinel.maxcc, layer: side.sentinel.layer, index }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : `Spectral request failed (${response.status})`);
  }
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const matrix = compose(scale(width / frame.width), compose(invert(screenToMercator(frame)), imageToMercator(box, width, height)));
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, width, height).data;
  } finally {
    bitmap.close();
  }
}

export async function detectCaptures(sources, settings, sides) {
  const frame = sources.a.frame;
  const ratio = Math.min(1, 1536 / Math.max(sources.a.canvas.width, sources.a.canvas.height));
  const width = Math.max(1, Math.round(sources.a.canvas.width * ratio));
  const height = Math.max(1, Math.round(sources.a.canvas.height * ratio));
  const pixels = (source) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.drawImage(source.canvas, 0, 0, width, height);
    return context.getImageData(0, 0, width, height).data;
  };
  let index = null;
  if (settings.method === 'index') {
    const [a, b] = await Promise.all(sides.map((side) => spectralPixels(frame, width, height, side, settings.index)));
    index = { a, b };
  }
  const result = await runChangeDetection({ a: pixels(sources.a), b: pixels(sources.b), width, height,
    settings, index, metresPerPixel: groundPerPixel(frame) * frame.width / width });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(result.pixels, width, height), 0, 0);
  return { ...result, canvas, frame };
}
