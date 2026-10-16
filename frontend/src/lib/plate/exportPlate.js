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
/** How wide a played plate is, in pixels. */
export const WIDTHS = [1280, 1920];
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

export function canvasBlob(canvas, type = 'image/png', quality = 0.92) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('the page could not be encoded'))), type, quality));
}

/**
 * Post one export: `frames` are blobs, one for a page, one per day for a played
 * plate. A plate played through its steps sends `beats`, one per frame (how long it
 * holds, the clips running over it, the transition it opens on), `overs`, what stands
 * over those clips, and `tweens`, the frames of its transitions.
 */
export function postExport(caseId, { format, frames, filename, widthMm, heightMm, interval = 900, transparent = false, beats = null, overs = [], tweens = [] },
  post = api.post) {
  const body = new FormData();
  frames.forEach((blob, index) => body.append('frames', blob, `${index}.${blob.type === 'image/jpeg' ? 'jpg' : 'png'}`));
  if (beats) {
    body.append('beats', JSON.stringify(beats));
    overs.forEach((blob, index) => body.append('overs', blob, `over${index}.png`));
    tweens.forEach((blob, index) => body.append('tweens', blob, `tween${index}.jpg`));
  }
  body.append('format', format);
  body.append('filename', filename);
  body.append('width_mm', String(widthMm));
  body.append('height_mm', String(heightMm));
  body.append('interval', String(interval));
  if (transparent) body.append('transparent', 'true');
  return post(`/api/cases/${caseId}/map-plates/export`, body);
}
