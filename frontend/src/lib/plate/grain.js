/**
 * The paper's grain: fine specks multiplied over the whole page, ink and maps with
 * it, as a printed sheet shows them. One tile, made once from a fixed seed, so the
 * page on the screen and every export carry the same specks. The screen lays it as
 * a layer over the page (`grainUrl`); an export draws it last (`drawGrain`).
 */
import { pageSize } from './page.js';

/** Millimetres of the page one tile covers, whatever the export's resolution. */
export const GRAIN_MM = 36;
/** How dark the darkest speck is at full grain, out of 255. */
const DEPTH = 70;
const SIDE = 192;

let tile = null;
let url = null;

/** The tile, or null where there is no canvas to make it on. */
export function grainTile() {
  if (tile) return tile;
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const ctx = canvas?.getContext?.('2d');
  if (!ctx?.createImageData) return null;
  canvas.width = SIDE;
  canvas.height = SIDE;
  const image = ctx.createImageData(SIDE, SIDE);
  let seed = 20261025;
  const next = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let index = 0; index < image.data.length; index += 4) {
    // most of the paper white, the specks a little darker, a few darker still
    const value = 255 - Math.round(Math.abs(next() + next() - 1) ** 1.6 * DEPTH * 1.6);
    image.data[index] = value;
    image.data[index + 1] = value;
    image.data[index + 2] = Math.max(0, value - 3);
    image.data[index + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  tile = canvas;
  return tile;
}

/** The tile as a picture a page's layer repeats, made once, or '' where none can be made. */
export function grainUrl() {
  if (url !== null) return url;
  try {
    url = grainTile()?.toDataURL?.('image/png') ?? '';
  } catch {
    url = '';
  }
  return url;
}

/** How strongly the grain shows at the page's `grain`, from 0 to 1. */
export const grainStrength = (grain) => Math.max(0, Math.min(1, grain ?? 0)) * 0.55;

/** The grain over an export's page, `scale` canvas pixels a millimetre. */
export function drawGrain(ctx, spec, scale) {
  const strength = grainStrength(spec.page?.grain);
  const made = strength > 0 ? grainTile() : null;
  if (!made) return;
  const { width, height } = pageSize(spec.page);
  const step = GRAIN_MM * scale;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = strength;
  for (let y = 0; y < height * scale; y += step) {
    for (let x = 0; x < width * scale; x += step) ctx.drawImage(made, x, y, step, step);
  }
  ctx.restore();
}
