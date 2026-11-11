/**
 * The contact sheet of a video's series: one picture of its slides for the recap post,
 * a grid of the proofs' saved pictures, each with its number, title and time, the same
 * number `#scenes` gives the place and the same `[0:15]` a post prints (`lib/videoThread.js`).
 *
 * Drawn in the browser from the PNGs each slide already saved, one picture decoded at
 * a time and at the size of its cell (`createImageBitmap` with a resize), then let go,
 * so forty-eight slides cost one picture's memory. Forty-eight at most: past that a
 * cell is too small to read.
 *
 * **16:9**, 1600 × 900: the shape X and Bluesky both show whole in a feed, never
 * cropped, and wide enough for a phone to read eight columns. Its colours are fixed,
 * not the app's theme: it is a picture to post, read on either platform's light or dark
 * page. A JPEG, held under Bluesky's 1 MB per picture by lowering the quality if needed.
 *
 * Nothing is drawn for a whole-video proof's time: no passage, no timecode.
 */
import { fileUrl } from './fileUrl.js';
import { shortTimecode, timecode } from './videoThread.js';

export const SHEET_MAX = 48;
export const SHEET_WIDTH = 1600;
export const SHEET_HEIGHT = 900;
/** Bluesky takes a picture up to 1 MB (`lib/videoLimits.js`), with room to spare. */
export const SHEET_MAX_BYTES = 950_000;
export const SHEET_TYPE = 'image/jpeg';
const QUALITIES = [0.9, 0.82, 0.74, 0.66];

/** The fixed colours of the sheet: a dark neutral page, light words. */
export const SHEET_COLORS = Object.freeze({
  page: '#14171c',
  cell: '#1f242b',
  text: '#f2f4f7',
  muted: '#a3abb7',
  badge: '#f2f4f7',
  badgeText: '#14171c',
});
const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/**
 * The tiles of a sheet: `{ number, title, time, png }` for the first `SHEET_MAX` slides,
 * numbered as the thread posts them, and how many more there were.
 * A slide is `{ title, moments, png }`, as `videoThread.videoSlides` keeps it.
 */
export function sheetTiles(slides) {
  const all = slides ?? [];
  const tiles = all.slice(0, SHEET_MAX).map((slide, i) => ({
    number: i + 1,
    title: String(slide.title ?? ''),
    time: timecode(slide.moments),
    // what a narrow cell says instead: the first time, the rest counted
    short: shortTimecode(slide.moments),
    png: slide.png ?? null,
  }));
  return { tiles, more: Math.max(0, all.length - SHEET_MAX) };
}

/**
 * Where each tile goes on a page of `width` × `height`: a header band for the video's
 * name, then the grid whose pictures come out the largest. Each cell holds a picture box
 * and a caption line under it.
 */
export function sheetLayout(count, { width = SHEET_WIDTH, height = SHEET_HEIGHT } = {}) {
  const unit = width / SHEET_WIDTH;
  const margin = Math.round(28 * unit);
  const gap = Math.round(14 * unit);
  const header = Math.round(64 * unit);
  const areaW = width - margin * 2;
  const areaH = height - margin * 2 - header;
  const n = Math.max(1, count);
  let best = null;
  for (let cols = 1; cols <= n; cols += 1) {
    const rows = Math.ceil(n / cols);
    const cellW = (areaW - gap * (cols - 1)) / cols;
    const cellH = (areaH - gap * (rows - 1)) / rows;
    const caption = Math.max(18, Math.min(34, Math.round(cellW * 0.12)));
    const boxH = cellH - caption;
    if (boxH <= 0) continue;
    // the width a 4:3 picture would get: the grid that shows the pictures largest
    const shown = Math.min(cellW, boxH * (4 / 3));
    if (!best || shown > best.shown + 1e-6) best = { cols, rows, cellW, cellH, caption, shown };
  }
  const { cols, rows, cellW, cellH, caption } = best;
  const usedH = rows * cellH + gap * (rows - 1);
  const top = margin + header + Math.max(0, (areaH - usedH) / 2);
  const cells = Array.from({ length: count }, (_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    // a short last row is centred
    const inRow = row === rows - 1 ? count - row * cols : cols;
    const rowW = inRow * cellW + gap * (inRow - 1);
    const left = margin + (areaW - rowW) / 2;
    const x = left + col * (cellW + gap);
    const y = top + row * (cellH + gap);
    return { x, y, w: cellW, h: cellH, box: { x, y, w: cellW, h: cellH - caption }, caption: { x, y: y + cellH - caption, w: cellW, h: caption } };
  });
  return { cols, rows, margin, header, cells, unit };
}

/** A picture fitted whole in a box, centred. */
export function containIn(box, width, height) {
  const scale = Math.min(box.w / width, box.h / height);
  const w = width * scale;
  const h = height * scale;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/** Words cut to `max` pixels with an ellipsis. */
function fitText(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > max) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/** A case PNG decoded at about `width` pixels wide, its shape kept. */
export async function loadCasePicture(caseId, path, width) {
  const res = await fetch(fileUrl(caseId, path));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  return createImageBitmap(blob, { resizeWidth: Math.max(1, Math.round(width)), resizeQuality: 'high' });
}

function defaultCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function encode(canvas, type, quality) {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('the sheet could not be encoded'))), type, quality),
  );
}

function drawTile(ctx, cell, tile, picture, unit) {
  ctx.fillStyle = SHEET_COLORS.cell;
  ctx.fillRect(cell.box.x, cell.box.y, cell.box.w, cell.box.h);
  if (picture) {
    const at = containIn(cell.box, picture.width, picture.height);
    ctx.drawImage(picture, at.x, at.y, at.w, at.h);
  } else {
    ctx.fillStyle = SHEET_COLORS.muted;
    ctx.font = `${Math.round(12 * Math.max(unit, 0.6))}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No picture', cell.box.x + cell.box.w / 2, cell.box.y + cell.box.h / 2);
  }
  // the number, in a badge over the picture's corner
  const size = Math.max(11, Math.round(cell.caption.h * 0.52));
  ctx.font = `700 ${size}px ${FONT}`;
  const label = String(tile.number);
  const padX = Math.round(size * 0.45);
  const badgeW = ctx.measureText(label).width + padX * 2;
  const badgeH = Math.round(size * 1.5);
  ctx.fillStyle = SHEET_COLORS.badge;
  ctx.fillRect(cell.box.x, cell.box.y, badgeW, badgeH);
  ctx.fillStyle = SHEET_COLORS.badgeText;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cell.box.x + padX, cell.box.y + badgeH / 2);
  // the caption: the title, and the time at the right
  const line = cell.caption;
  const textSize = Math.max(10, Math.round(line.h * 0.5));
  const mid = line.y + line.h / 2;
  let room = line.w;
  if (tile.time) {
    ctx.font = `${textSize}px ${FONT}`;
    const full = ctx.measureText(tile.time).width <= line.w * 0.55 ? tile.time : tile.short || tile.time;
    const time = fitText(ctx, full, line.w * 0.55);
    const timeW = ctx.measureText(time).width;
    ctx.fillStyle = SHEET_COLORS.muted;
    ctx.textAlign = 'right';
    ctx.fillText(time, line.x + line.w, mid);
    room = line.w - timeW - Math.round(textSize * 0.8);
  }
  ctx.font = `600 ${textSize}px ${FONT}`;
  ctx.fillStyle = SHEET_COLORS.text;
  ctx.textAlign = 'left';
  if (room > textSize) ctx.fillText(fitText(ctx, tile.title, room), line.x, mid);
}

/**
 * Draw the sheet of `slides` and answer it as a Blob.
 *
 * `video` is its title, written in the header. `caseId` finds the pictures; or give
 * `loadPicture(path, width)` to decode them another way. `makeCanvas(width, height)` is
 * there for the tests, as are `width` and `height` for the preview.
 */
export async function buildProofSheet(slides, {
  caseId = null,
  video = '',
  width = SHEET_WIDTH,
  height = SHEET_HEIGHT,
  type = SHEET_TYPE,
  maxBytes = SHEET_MAX_BYTES,
  loadPicture = (path, w) => loadCasePicture(caseId, path, w),
  makeCanvas = defaultCanvas,
} = {}) {
  const { tiles, more } = sheetTiles(slides);
  const layout = sheetLayout(tiles.length, { width, height });
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = SHEET_COLORS.page;
  ctx.fillRect(0, 0, width, height);

  // the header: the video's name, and how many places the sheet holds
  const headSize = Math.round(26 * layout.unit);
  const headY = layout.margin + layout.header / 2 - Math.round(6 * layout.unit);
  const count = `${tiles.length + more} ${tiles.length + more === 1 ? 'place' : 'places'}${more ? `, the first ${tiles.length} shown` : ''}`;
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(headSize * 0.7)}px ${FONT}`;
  ctx.fillStyle = SHEET_COLORS.muted;
  ctx.textAlign = 'right';
  ctx.fillText(count, width - layout.margin, headY);
  const countW = ctx.measureText(count).width;
  ctx.font = `700 ${headSize}px ${FONT}`;
  ctx.fillStyle = SHEET_COLORS.text;
  ctx.textAlign = 'left';
  ctx.fillText(fitText(ctx, String(video ?? ''), width - layout.margin * 2 - countW - headSize), layout.margin, headY);

  // one picture at a time, decoded at its cell's size and let go before the next
  for (let i = 0; i < tiles.length; i += 1) {
    const tile = tiles[i];
    const cell = layout.cells[i];
    let picture = null;
    if (tile.png) {
      try {
        picture = await loadPicture(tile.png, cell.box.w);
      } catch {
        picture = null; // a picture that will not load leaves its cell saying so
      }
    }
    try {
      drawTile(ctx, cell, tile, picture, layout.unit);
    } finally {
      picture?.close?.();
    }
  }

  // under the size a platform takes, the quality lowered a step at a time
  let blob = null;
  for (const quality of type === 'image/png' ? [undefined] : QUALITIES) {
    blob = await encode(canvas, type, quality);
    if (!maxBytes || blob.size <= maxBytes) break;
  }
  return blob;
}

/**
 * A small sheet to look at before posting: half the size, with a URL to show it and
 * `revoke()` to let it go.
 */
export async function sheetPreview(slides, options = {}) {
  const blob = await buildProofSheet(slides, { ...options, width: SHEET_WIDTH / 2, height: SHEET_HEIGHT / 2 });
  const url = URL.createObjectURL(blob);
  return { blob, url, revoke: () => URL.revokeObjectURL(url) };
}
