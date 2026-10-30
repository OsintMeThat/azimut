/**
 * A map plate out of the tab: the page drawn at print resolution, one day or each
 * of its days, and posted to be written in the folder saved for views
 * (`api/mapplates.export_plate`).
 *
 * The maps are drawn by their own engines (`PlateMap.snapshot`); this puts their
 * pictures on the page under everything else (`draw.js`), at the scale asked.
 */
import { api } from '../api.js';
import { drawPage } from './draw.js';
import { FONTS, pageSize } from './page.js';

/** What a page is drawn at, by what it is for. */
export const QUALITIES = {
  screen: { label: 'Screen', dpi: 150 },
  print: { label: 'Print', dpi: 300 },
};
/** How large a played plate is, by its long side in pixels: 720p and 1080p, a story upright. */
export const VIDEO_SIDES = [1280, 1920];

/** A played plate's frame at `side` pixels along its long edge, both sides even as H.264 wants. */
export function videoSize(spec, side) {
  const { width, height } = pageSize(spec.page);
  const even = (value) => Math.max(2, Math.round(value / 2) * 2);
  return width >= height ? { width: even(side), height: even((side * height) / width) } : { width: even((side * width) / height), height: even(side) };
}
/** The largest canvas side a browser draws reliably. */
const MAX_EDGE = 16_000;

/** Canvas pixels a millimetre, for a page at `dpi`, held under the browser's bound. */
export function scaleFor(spec, dpi) {
  const { width, height } = pageSize(spec.page);
  return Math.min(dpi / 25.4, MAX_EDGE / Math.max(width, height));
}

/** Canvas pixels a millimetre, for a page `pixels` wide. */
export function scaleForWidth(spec, pixels) {
  return pixels / pageSize(spec.page).width;
}

/** The page on one canvas: the paper, the maps' pictures, then everything else. */
export function composePage(spec, scale, context, makeCanvas = () => document.createElement('canvas')) {
  const { width, height } = pageSize(spec.page);
  const canvas = makeCanvas();
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  drawPage(ctx, spec, { ...context, scale, paper: true, editing: false });
  return canvas;
}

/** The page's picture put on the clipboard, as a PNG. */
export async function copyPage(canvas) {
  const blob = await canvasBlob(canvas);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

/**
 * The page on each day, side by side, each with its day under it: what a printed
 * report holds where a video cannot go.
 */
export function evolutionSheet(pages, labels, theme, makeCanvas = () => document.createElement('canvas')) {
  const columns = pages.length <= 4 ? 2 : pages.length <= 9 ? 3 : 4;
  const rows = Math.ceil(pages.length / columns);
  const cell = { width: pages[0].width, height: pages[0].height };
  const gap = Math.round(cell.width * 0.04);
  const caption = Math.round(cell.width * 0.06);
  const canvas = makeCanvas();
  canvas.width = columns * cell.width + (columns + 1) * gap;
  canvas.height = rows * (cell.height + caption) + (rows + 1) * gap;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = theme.paper; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = `600 ${Math.round(caption * 0.55)}px ${(FONTS[theme.font] ?? FONTS.inter).family}, sans-serif`;
  ctx.textBaseline = 'middle';
  pages.forEach((page, index) => {
    const x = gap + (index % columns) * (cell.width + gap);
    const y = gap + Math.floor(index / columns) * (cell.height + caption + gap);
    ctx.drawImage(page, x, y, cell.width, cell.height);
    ctx.strokeStyle = theme.ink; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, cell.width - 1, cell.height - 1);
    ctx.fillStyle = theme.ink;
    ctx.fillText(labels[index] ?? '', x, y + cell.height + caption / 2);
  });
  return canvas;
}

/**
 * Canvases whose pixels go now, rather than when the garbage collector reaches them:
 * a print page or a map drawn for it is tens of megabytes, and an export draws many.
 */
export function release(...canvases) {
  for (const canvas of canvases) {
    if (!canvas || !('width' in canvas)) continue;
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function canvasBlob(canvas, type = 'image/png', quality = 0.92) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('the page could not be encoded'))), type, quality));
}

const pictureName = (blob, stem) => `${stem}.${blob.type === 'image/jpeg' ? 'jpg' : 'png'}`;

/**
 * Post one export: a page sends its picture as `frames`, a played plate the
 * `staged` token its pictures were sent under (`stagedPictures`). A plate played
 * through its steps sends `beats`, one per frame (how long it holds, the clips running
 * over it and what stands over them, the transition it opens on).
 */
export function postExport(caseId, { format, frames = [], filename, widthMm, heightMm, interval = 900, transparent = false, beats = null, staged = '',
  signal = undefined }, post = api.post) {
  const body = new FormData();
  frames.forEach((blob, index) => body.append('frames', blob, pictureName(blob, index)));
  if (staged) body.append('staged', staged);
  if (beats) body.append('beats', JSON.stringify(beats));
  body.append('format', format);
  body.append('filename', filename);
  body.append('width_mm', String(widthMm));
  body.append('height_mm', String(heightMm));
  body.append('interval', String(interval));
  if (transparent) body.append('transparent', 'true');
  return post(`/api/cases/${caseId}/map-plates/export`, body, signal ? { signal } : undefined);
}

/** A batch of a played plate's pictures goes out once it holds this much, or this many (`engine/mapplates.MAX_PICTURES_PER_POST`). */
const BATCH_BYTES = 4_000_000;
const BATCH_COUNT = 12;

/**
 * A played plate's pictures, sent to the server as they are drawn rather than held
 * until the end: a long video is hundreds of them, which the tab and the server
 * would both have held at once. `add(series, blob)` keeps one, `series` being
 * 'frames', 'overs' (what stands over a beat's clips) or 'tweens' (the transitions'
 * frames), each in its order, and sends its batch once full. `count(series)` is how
 * many came. `finish(export)` sends what is left and writes the export
 * (`postExport`'s fields); `drop()` lets the server forget them, for an export
 * stopped on the way.
 */
export function stagedPictures(caseId, { signal = undefined, post = api.post, del = api.del } = {}) {
  let staged = '';
  const waiting = { frames: [], overs: [], tweens: [] };
  const counts = { frames: 0, overs: 0, tweens: 0 };
  async function send(series) {
    const batch = waiting[series];
    if (!batch.length) return;
    waiting[series] = [];
    const body = new FormData();
    if (staged) body.append('staged', staged);
    body.append('series', series);
    batch.forEach((blob, index) => body.append('pictures', blob, pictureName(blob, `${series}${counts[series] - batch.length + index}`)));
    staged = (await post(`/api/cases/${caseId}/map-plates/export/pictures`, body, signal ? { signal } : undefined)).staged;
  }
  return {
    count: (series) => counts[series],
    async add(series, blob) {
      waiting[series].push(blob);
      counts[series] += 1;
      const held = waiting[series].reduce((sum, item) => sum + item.size, 0);
      if (waiting[series].length >= BATCH_COUNT || held >= BATCH_BYTES) await send(series);
    },
    async finish(form) {
      for (const series of Object.keys(waiting)) await send(series);
      return postExport(caseId, { ...form, staged, signal }, post);
    },
    drop() {
      Object.keys(waiting).forEach((series) => { waiting[series] = []; });
      if (staged) del(`/api/cases/${caseId}/map-plates/export/pictures/${staged}`).catch(() => {});
      staged = '';
    },
  };
}
