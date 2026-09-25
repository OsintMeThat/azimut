/**
 * Drawing an evolution: each dated picture fetched from the tile proxy onto the
 * export's ground, then composed as a GIF frame or as one cell of a sheet.
 *
 * The choosing and the geometry are pure and live in `evolution.js`.
 */

import { drawAnnotations } from './compareAnnotations.js';
import {
  EXPORT_STYLE, captureProjection, drawScaleAndNorth, drawTag, signFooter, signatureRoom,
} from './compareExport.js';
import { compassAngle } from './groundFrame.js';
import { MAX_PICTURE_TILES, pictureTiles, samePixels, sheetColumns } from './evolution.js';
import { wrapLon } from '../coords.js';

const { INK, MUTED, BAND, ACCENT, FONT, MONO } = EXPORT_STYLE;
/** What shows where the archive has no pixels. */
const PAPER = '#14171d';
/** Tiles asked at once for one picture. */
const PARALLEL = 6;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function canvasOf(width, height, makeCanvas) {
  const canvas = makeCanvas ? makeCanvas() : document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function stopIfAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('The export was cancelled', 'AbortError');
}

/**
 * One tile through the proxy. A 404 is ground the archive does not cover and
 * comes back as nothing; any other refusal (a paused quota, a key gone bad) ends
 * the export with the proxy's own sentence.
 */
export async function fetchTile(url, signal) {
  const response = await fetch(url, { signal });
  if (response.status === 404) return null;
  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.json()).detail;
    } catch {
      /* not JSON */
    }
    const error = new Error(typeof detail === 'string' && detail ? detail : `a tile answered HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  try {
    return await createImageBitmap(await response.blob());
  } catch {
    return null;
  }
}

/**
 * One picture of `frame`, drawn from `variant`'s tiles.
 *
 * Tiles are fetched a few at a time and painted in the plan's order once all are
 * in, so two releases holding the same pixels draw the same picture. Each tile is
 * grown by half an output pixel so a turned frame shows no seams.
 *
 * @returns {Promise<{ canvas, frame, empty: boolean }>} `empty` when no tile had imagery
 */
export async function drawPicture({
  frame, pixelScale, provider, variant, signal, loadTile = fetchTile, makeCanvas,
}) {
  const plan = pictureTiles(frame, provider, pixelScale);
  if (plan.tiles.length > MAX_PICTURE_TILES) {
    throw new Error('this frame needs too many tiles; zoom in or draw a smaller frame');
  }
  const images = new Array(plan.tiles.length).fill(null);
  let next = 0;
  let failed = null;
  const worker = async () => {
    while (next < plan.tiles.length && !failed) {
      const index = next;
      next += 1;
      const tile = plan.tiles[index];
      try {
        stopIfAborted(signal);
        images[index] = await loadTile(
          `/api/tiles/${encodeURIComponent(variant)}/${tile.z}/${tile.x}/${tile.y}`,
          signal,
        );
      } catch (error) {
        failed ??= error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, plan.tiles.length) }, worker));
  if (failed) {
    images.forEach((image) => image?.close?.());
    throw failed;
  }

  const canvas = canvasOf(plan.width, plan.height, makeCanvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('this browser cannot draw the evolution');
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  let drawn = 0;
  plan.tiles.forEach((tile, index) => {
    const image = images[index];
    if (!image) return;
    const m = tile.matrix;
    const pad = 0.5 / Math.max(1e-6, Math.hypot(m.a, m.b));
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.drawImage(image, 0, 0, image.width, image.height, -pad, -pad, tile.size + pad * 2, tile.size + pad * 2);
    image.close?.();
    drawn += 1;
  });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { canvas, frame: { ...frame }, empty: drawn === 0 };
}

/** A picture's pixels, to tell a repeated release; null where the canvas cannot say. */
function pixelsOf(canvas) {
  try {
    return canvas.getContext('2d')?.getImageData?.(0, 0, canvas.width, canvas.height)?.data ?? null;
  } catch {
    return null;
  }
}

/**
 * Draw every chosen picture in order and hand each over as it is done, so a GIF
 * frame can be encoded and its picture let go before the next is fetched.
 *
 * A picture with no imagery at all, or with exactly the pixels of the one before
 * it, is left out and counted, never dropped without a word.
 *
 * @returns {Promise<{ drawn: number, empty: number, repeated: number }>}
 */
export async function drawPictures({
  entries, frame, pixelScale, provider, variantFor, signal, onprogress, onpicture, loadTile, makeCanvas,
}) {
  let previous = null;
  const tally = { drawn: 0, empty: 0, repeated: 0 };
  for (const [index, entry] of entries.entries()) {
    stopIfAborted(signal);
    onprogress?.(index, entries.length);
    const picture = await drawPicture({
      frame, pixelScale, provider, variant: variantFor(entry), signal, loadTile, makeCanvas,
    });
    if (picture.empty) {
      tally.empty += 1;
      continue;
    }
    const pixels = pixelsOf(picture.canvas);
    if (samePixels(previous, pixels)) {
      tally.repeated += 1;
      continue;
    }
    previous = pixels;
    await onpicture({ entry, picture, index });
    tally.drawn += 1;
  }
  onprogress?.(entries.length, entries.length);
  return tally;
}

/** Marks drawn on both sides stand on every picture; a mark pinned to A or B does not. */
const sharedMarks = (annotations) => (annotations ?? []).filter((mark) => mark?.side === 'both');

function drawMarks(ctx, picture, annotations, x, y, units) {
  const marks = sharedMarks(annotations);
  if (!marks.length) return;
  const pixelScale = picture.canvas.width / picture.frame.width;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, picture.canvas.width, picture.canvas.height);
  ctx.clip();
  drawAnnotations(ctx, marks, captureProjection(picture, x, y), { scale: pixelScale, units });
  ctx.restore();
}

function header(ctx, { title, line, right, width, scale }) {
  const left = 16 * scale;
  let offset = 0;
  if (title) {
    ctx.fillStyle = INK;
    ctx.font = `700 ${Math.round(17 * scale)}px ${FONT}`;
    ctx.fillText(title, left, 25 * scale, width * 0.6);
    offset = 20 * scale;
  }
  ctx.fillStyle = INK;
  ctx.font = `600 ${Math.round(12 * scale)}px ${FONT}`;
  ctx.fillText(line, left, 24 * scale + offset, width * 0.62);
  if (right) {
    ctx.font = `${Math.round(11 * scale)}px ${MONO}`;
    const measured = ctx.measureText(right).width;
    const taken = left + Math.min(ctx.measureText(line).width, width * 0.62);
    if (width - measured - 16 * scale > taken + 12 * scale) {
      ctx.fillStyle = MUTED;
      ctx.fillText(right, width - measured - 16 * scale, (title ? 25 : 24) * scale);
    }
  }
}

function credits(ctx, text, y, width, scale, signed) {
  const room = signed && signFooter(ctx, width - 14 * scale, y - 4 * scale, scale) ? signatureRoom(scale) : 0;
  ctx.fillStyle = MUTED;
  ctx.font = `${Math.round(10 * scale)}px ${FONT}`;
  ctx.fillText(text, 16 * scale, y, Math.max(0, width - 32 * scale - room));
}

const whereLine = (frame) => {
  const lat = Number(frame.lat);
  const lon = wrapLon(Number(frame.lng));
  return Number.isFinite(lat) && Number.isFinite(lon) ? `${lat.toFixed(5)}, ${lon.toFixed(5)}` : '';
};

/**
 * One frame of an evolution GIF: the picture under a header naming the series,
 * its date large on the imagery, and a line along the footer placing it among
 * the others by date.
 *
 * @param {object} input
 * @param {{canvas, frame}} input.picture
 * @param {number} input.current index of this picture among `positions`
 * @param {number[]} input.positions each chosen picture's place on the line, 0 to 1
 */
export function composeEvolutionFrame({
  picture, title = '', label, date, current, positions, attribution = '', annotations = [],
  units = 'metric', signed = false, makeCanvas,
}) {
  const width = picture.canvas.width;
  const s = clamp(width / 1000, 1, 2);
  const pixelScale = width / picture.frame.width;
  const top = Math.round((title ? 64 : 48) * s);
  const footer = Math.round(46 * s);
  const bottom = top + picture.canvas.height;
  const output = canvasOf(width, bottom + footer, makeCanvas);
  const ctx = output.getContext('2d');
  if (!ctx) throw new Error('this browser cannot compose the evolution');
  ctx.fillStyle = BAND;
  ctx.fillRect(0, 0, output.width, output.height);
  ctx.drawImage(picture.canvas, 0, top);
  drawMarks(ctx, picture, annotations, 0, top, units);
  drawTag(ctx, date, 12 * s, top + 12 * s, { scale: 1.4 * s, accent: true });
  drawScaleAndNorth(ctx, picture.frame, 12 * s, bottom - 12 * s, {
    scale: s, pixelScale, bearing: compassAngle(-picture.frame.bearing), units,
  });
  header(ctx, {
    title,
    line: `${label} · ${positions.length} pictures`,
    right: whereLine(picture.frame),
    width,
    scale: s,
  });

  // The line of dates: every chosen picture a tick, this one lit.
  const from = 16 * s;
  const to = width - 16 * s;
  const y = bottom + 14 * s;
  ctx.fillStyle = MUTED;
  ctx.fillRect(from, y - 0.75 * s, to - from, 1.5 * s);
  positions.forEach((position, index) => {
    if (index === current) return;
    ctx.fillRect(from + position * (to - from) - s, y - 4 * s, 2 * s, 8 * s);
  });
  const lit = positions[current];
  if (Number.isFinite(lit)) {
    ctx.fillStyle = ACCENT;
    ctx.fillRect(from + lit * (to - from) - 2 * s, y - 7 * s, 4 * s, 14 * s);
  }
  credits(ctx, attribution || label, output.height - 9 * s, width, s, signed);
  return output;
}

/**
 * The pictures of an evolution side by side on one page, oldest first, reading
 * left to right then down. One scale bar serves them all, since every cell
 * covers the same ground at the same scale.
 *
 * @param {object} input
 * @param {Array<{ picture: {canvas, frame}, date: string }>} input.cells
 */
export function composeEvolutionSheet({
  cells, title = '', label, span = '', attribution = '', annotations = [], units = 'metric',
  signed = false, makeCanvas,
}) {
  if (!cells.length) throw new Error('an evolution sheet needs its pictures');
  const columns = sheetColumns(cells.length);
  const rows = Math.ceil(cells.length / columns);
  const cellWidth = Math.max(...cells.map((cell) => cell.picture.canvas.width));
  const cellHeight = Math.max(...cells.map((cell) => cell.picture.canvas.height));
  const gap = 8;
  const width = columns * cellWidth + (columns + 1) * gap;
  const s = clamp(width / 1400, 1, 2);
  const top = Math.round((title ? 64 : 48) * s);
  const footer = Math.round(26 * s);
  const height = top + rows * cellHeight + (rows + 1) * gap + footer;
  const output = canvasOf(width, height, makeCanvas);
  const ctx = output.getContext('2d');
  if (!ctx) throw new Error('this browser cannot compose the evolution');
  ctx.fillStyle = BAND;
  ctx.fillRect(0, 0, output.width, output.height);
  const tagScale = clamp(cellWidth / 420, 0.8, 1.6);
  cells.forEach(({ picture, date }, index) => {
    const x = gap + (index % columns) * (cellWidth + gap);
    const y = top + gap + Math.floor(index / columns) * (cellHeight + gap);
    ctx.drawImage(picture.canvas, x, y);
    drawMarks(ctx, picture, annotations, x, y, units);
    drawTag(ctx, date, x + 8 * tagScale, y + 8 * tagScale, { scale: tagScale, accent: true });
  });
  const first = cells[0].picture;
  drawScaleAndNorth(ctx, first.frame, gap + 8 * tagScale, top + gap + first.canvas.height - 8 * tagScale, {
    scale: tagScale,
    pixelScale: first.canvas.width / first.frame.width,
    bearing: compassAngle(-first.frame.bearing),
    units,
  });
  header(ctx, {
    title,
    line: [label, `${cells.length} pictures`, span].filter(Boolean).join(' · '),
    right: whereLine(first.frame),
    width,
    scale: s,
  });
  credits(ctx, attribution || label, output.height - 9 * s, width, s, signed);
  return output;
}
