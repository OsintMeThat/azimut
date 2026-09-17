/**
 * Capture-sized change detection, with Sentinel-2 band frames fetched once and
 * then reused.
 *
 * A band frame is a metered request, so it is asked for by an explicit act —
 * Run, or switching the cloud filter on — and never by a pan. To keep the
 * filter working while the analyst moves around, each frame is fetched with a
 * margin of ground around the view and held: a later reading whose view still
 * falls inside it, at a similar resolution, is served from that copy. A move
 * past the margin, a zoom, or another date leaves the reading waiting for Run
 * rather than quietly spending a request.
 */
import { changeNeedsFrames } from './changeAssist.js';
import { runChangeDetection } from './changeRunner.js';
import { compose, frameBox, groundPerPixel, imageToMercator, invert, scale, screenToMercator } from './groundFrame.js';

/** Ground kept around the view, as a share of it on each side. */
const MARGIN = 0.2;
/** What the backend will render, one side at a time. */
const MAX_EDGE = 2048;
/** How far the held copy's resolution may drift from what a reading wants. */
const SCALE_RANGE = [0.6, 2.5];

const held = new Map();

const grow = (box, share) => {
  const width = (box.east - box.west) * share;
  const height = (box.north - box.south) * share;
  return { west: box.west - width, east: box.east + width,
    south: box.south - height, north: box.north + height };
};

const covers = (outer, inner) => outer.west <= inner.west && outer.east >= inner.east
  && outer.south <= inner.south && outer.north >= inner.north;

/** Only for tests and for a case being closed: the held frames are per session. */
export function forgetBandFrames() {
  held.clear();
}

function frameKey(side, product) {
  const sentinel = side?.sentinel ?? {};
  return [product, sentinel.effectiveDate || sentinel.date || '', sentinel.layer ?? '',
    sentinel.maxcc ?? ''].join('|');
}

/**
 * The bytes of one band frame over `box`, from the held copy or from the network.
 *
 * @returns {Promise<{blob: Blob, box: object, width: number, height: number}|null>}
 *   null when a fetch was needed and `fetchAllowed` said no.
 */
async function frameBytes(side, product, box, metresPerPixel, fetchAllowed) {
  const key = frameKey(side, product);
  const copy = held.get(key);
  const drift = copy ? copy.metresPerPixel / metresPerPixel : 0;
  if (copy && covers(copy.box, box) && drift >= SCALE_RANGE[0] && drift <= SCALE_RANGE[1]) {
    return copy;
  }
  if (!fetchAllowed) return null;
  const wanted = grow(box, MARGIN);
  const width = Math.min(MAX_EDGE, Math.max(1, Math.round((wanted.east - wanted.west) / metresPerPixel)));
  const height = Math.min(MAX_EDGE, Math.max(1, Math.round((wanted.north - wanted.south) / metresPerPixel)));
  const response = await fetch('/api/compare/sentinel-frame', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...wanted, width, height, day: side.sentinel.effectiveDate || side.sentinel.date,
      maxcc: side.sentinel.maxcc, layer: side.sentinel.layer, product }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : `Band request failed (${response.status})`);
  }
  const fetched = { blob: await response.blob(), box: wanted, width, height,
    metresPerPixel: (wanted.east - wanted.west) / width };
  held.set(key, fetched);
  return fetched;
}

/**
 * One Sentinel-2 band frame projected onto the compared view.
 *
 * `product` is a spectral index, or `sky` for the scene classification alone —
 * the cloud filter's answer over the picture methods.
 */
export async function bandFrame(frame, width, height, side, product, fetchAllowed = true) {
  const box = frameBox(frame);
  const metres = groundPerPixel(frame) * frame.width / width;
  const source = await frameBytes(side, product, box, metres, fetchAllowed);
  if (!source) return null;
  // No colour management and no premultiplied alpha: these bytes are a
  // measurement and a scene class, not a picture.
  const bitmap = await createImageBitmap(source.blob,
    { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const matrix = compose(scale(width / frame.width), compose(invert(screenToMercator(frame)),
      imageToMercator(source.box, source.width, source.height)));
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, width, height).data;
  } finally {
    bitmap.close();
  }
}

/**
 * Read the two captured views.
 *
 * `fetchAllowed` is false for a reading that follows the camera on its own: it
 * then runs on held frames, or reports `needsFetch` so the caller can leave the
 * last reading up and wait for Run.
 */
export async function detectCaptures(sources, settings, sides, status = null, fetchAllowed = true) {
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
  const needed = changeNeedsFrames(settings, status);
  let frames = null;
  if (needed) {
    const product = needed === 'index' ? settings.index : 'sky';
    const [a, b] = await Promise.all(
      sides.map((side) => bandFrame(frame, width, height, side, product, fetchAllowed)));
    if (!a || !b) return { needsFetch: true };
    frames = { a, b };
  }
  const result = await runChangeDetection({ a: pixels(sources.a), b: pixels(sources.b), width, height,
    settings, frames, family: status?.family ?? '',
    ground: {
      lat: frame.lat,
      bearing: frame.bearing ?? 0,
      days: sides.map((side) => side?.sentinel?.effectiveDate || side?.sentinel?.date || ''),
    },
    metresPerPixel: groundPerPixel(frame) * frame.width / width });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(result.pixels, width, height), 0, 0);
  return { ...result, canvas, frame };
}
