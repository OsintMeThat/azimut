/**
 * Capture-sized change detection, with Sentinel-2 band frames fetched once and
 * then reused.
 *
 * A band frame is a metered request, so one is fetched only when the caller
 * allows it (`fetchAllowed`); Compare says when. Each frame is fetched with a
 * margin of ground around the view and held: a later reading whose view still
 * falls inside it, at a similar resolution, is served from that copy, or from a
 * fetch still on its way that reaches it, rather than giving up on bands
 * already paid for. Past that, a reading not allowed to fetch is told so.
 */
import { changeNeedsFrames } from './changeAssist.js';
import { runChangeDetection } from './changeRunner.js';
import { compose, frameBox, groundPerPixel, imageToMercator, invert, mercatorPerPixel, scale,
  screenToMercator } from './groundFrame.js';

/** Ground kept around the view, as a share of it on each side. */
const MARGIN = 0.2;
/**
 * Sentinel-2 classifies the scene at 20 m, so a finer sky frame buys no
 * detail, only pixels on the bill. Read at 20 m, the pixels a 20% margin
 * would take at the view's resolution cover far more ground, and the margin
 * grows into them, up to a whole view past each edge.
 */
const SKY_GROUND_METRES = 20;
const MARGIN_MAX = 1;
/** What the backend will render, one side at a time. */
const MAX_EDGE = 2048;
/** How far the held copy's resolution may drift from what a reading wants. */
const SCALE_RANGE = [0.6, 2.5];

const held = new Map();
/** Fetches under way, each with the ground and resolution it will hold. */
const inflight = new Map();

const grow = (box, share) => {
  const width = (box.east - box.west) * share;
  const height = (box.north - box.south) * share;
  return { west: box.west - width, east: box.east + width,
    south: box.south - height, north: box.north + height };
};

const covers = (outer, inner) => outer.west <= inner.west && outer.east >= inner.east
  && outer.south <= inner.south && outer.north >= inner.north;

/** For tests only: the held frames otherwise last as long as the page. */
export function forgetBandFrames() {
  held.clear();
  inflight.clear();
}

function frameKey(side, product) {
  const sentinel = side?.sentinel ?? {};
  return [product, sentinel.effectiveDate || sentinel.date || '', sentinel.layer ?? '',
    sentinel.maxcc ?? ''].join('|');
}

/** Whether a frame, held or on its way, reaches `box` at about `resolution`. */
function serves(frame, box, resolution) {
  if (!frame || !covers(frame.box, box)) return false;
  const drift = frame.metresPerPixel / resolution;
  return drift >= SCALE_RANGE[0] && drift <= SCALE_RANGE[1];
}

/**
 * The bytes of one band frame over `box`, from the held copy, a fetch already
 * on its way, or the network. Resolutions are Web Mercator metres per pixel,
 * the unit the box is in. `floor` is the product's own: no frame is asked for
 * finer than the sensor measured it.
 *
 * @returns {Promise<{blob: Blob, box: object, width: number, height: number}|null>}
 *   null when a fetch was needed and `fetchAllowed` said no.
 */
async function frameBytes(side, product, box, metresPerPixel, fetchAllowed, floor = 0) {
  const key = frameKey(side, product);
  const resolution = Math.max(metresPerPixel, floor);
  const copy = held.get(key);
  if (serves(copy, box, resolution)) return copy;
  const pending = inflight.get(key);
  if (serves(pending, box, resolution)) return pending.promise;
  if (!fetchAllowed) return null;
  // As many pixels as a 20% margin at the view's own resolution: exactly that
  // margin when the floor does not bite, more ground when it does.
  const margin = Math.min(MARGIN_MAX, ((1 + 2 * MARGIN) * (resolution / metresPerPixel) - 1) / 2);
  const wanted = grow(box, margin);
  const width = Math.min(MAX_EDGE, Math.max(1, Math.round((wanted.east - wanted.west) / resolution)));
  const height = Math.min(MAX_EDGE, Math.max(1, Math.round((wanted.north - wanted.south) / resolution)));
  const fetched = { box: wanted, width, height, metresPerPixel: (wanted.east - wanted.west) / width };
  fetched.promise = (async () => {
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
    fetched.blob = await response.blob();
    held.set(key, fetched);
    return fetched;
  })();
  inflight.set(key, fetched);
  try {
    return await fetched.promise;
  } finally {
    if (inflight.get(key) === fetched) inflight.delete(key);
  }
}

/**
 * One Sentinel-2 band frame projected onto the compared view.
 *
 * `product` is a spectral index, or `sky` for the scene classification alone —
 * the cloud filter's answer over the picture methods.
 */
export async function bandFrame(frame, width, height, side, product, fetchAllowed = true) {
  const box = frameBox(frame);
  // Along the projection, as the box is: a ground metre here would ask for
  // 1/cos(latitude) more pixels a side than the reading draws.
  const metres = mercatorPerPixel(frame.zoom) * frame.width / width;
  const floor = product === 'sky' ? SKY_GROUND_METRES / Math.cos((frame.lat * Math.PI) / 180) : 0;
  const source = await frameBytes(side, product, box, metres, fetchAllowed, floor);
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
