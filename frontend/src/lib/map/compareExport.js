/**
 * Turn two captured map frames into the comparison the analyst is reading.
 *
 * This composes pixels, not the Compare DOM: provider menus, zoom buttons and
 * the swipe handle are controls. The picture is the two aligned images plus
 * what explains them: which source and date each side is, where the camera
 * was, a scale bar and north arrow, the Difference legend, the credits, and
 * the annotations projected onto the ground they were pinned to.
 *
 * Everything is placed from each side's camera frame (`groundFrame.js`), so
 * the composer needs no map: a projection is recomputed from the frame, and
 * a change mask computed for an earlier camera is laid where its ground is.
 */

import { drawAnnotations, onSide } from './compareAnnotations.js';
import {
  apply,
  compose,
  frameToFrame,
  groundPerPixel,
  invert,
  scale as scaleBy,
  screenToMercator,
  toMercator,
} from './groundFrame.js';
import { CHANGE_PALETTES } from './changeAssist.js';
import { fileDate } from './pictureDate.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const INK = '#f3f4f6';
const MUTED = '#a7adb5';
const BAND = '#0f1114';
const ACCENT = '#e8a33d';
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, "SF Mono", "Cascadia Code", monospace';

/**
 * What an exported comparison is called: its title, then the dates of its two
 * pictures, which say what the file shows. When neither picture is dated, the
 * moment of the export stands in, so the name still tells two exports apart.
 *
 * @param {string} [title]
 * @param {{ a?: string | null, b?: string | null }} [dates] each a day or a UTC instant
 * @param {Date} [at]
 */
export function comparisonFilename(title = '', { a = null, b = null } = {}, at = new Date()) {
  const stem = String(title).trim().replace(/[\\/:*?"<>|#%]+/g, ' ').replace(/\s+/g, ' ').slice(0, 80);
  const first = fileDate(a);
  const second = fileDate(b);
  if (first || second) {
    const dates = `${first || 'undated'}_${second || 'undated'}`;
    return stem ? `${stem} ${dates}` : `compare-${dates}`;
  }
  const stamp = at.toISOString().replace(/[^0-9]/g, '').slice(0, 12);
  return stem ? `${stem} ${stamp}` : `compare-${stamp || 'undated'}`;
}

/**
 * The dates a saved comparison files for its two pictures, as form fields.
 *
 * Two instants rather than a range: the image does not say anything happened
 * between them. A date its provider only estimated goes with `exact: false`.
 *
 * @param {{ a?: object, b?: object }} dates each side's `pictureDate()` reading
 * @returns {Array<[string, string]>}
 */
export function pictureDateFields(dates) {
  const fields = [];
  for (const side of ['a', 'b']) {
    const picture = dates?.[side] ?? {};
    if (!picture.imageryWhen) continue;
    fields.push([`imagery_${side}`, picture.imageryWhen]);
    if (picture.imageryExact === false) fields.push([`imagery_${side}_exact`, 'false']);
  }
  return fields;
}

function canvasOf(width, height, makeCanvas) {
  const canvas = makeCanvas ? makeCanvas() : document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/** `[lon, lat]` → pixel of a captured canvas, from the frame it was captured at. */
export function captureProjection(capture, offsetX = 0, offsetY = 0) {
  const pixelScale = capture.canvas.width / capture.frame.width;
  const toPixels = compose(scaleBy(pixelScale), invert(screenToMercator(capture.frame)));
  return ([lon, lat]) => {
    const [x, y] = apply(toPixels, ...toMercator(lon, lat));
    return [x + offsetX, y + offsetY];
  };
}

/** A round ground length that fits in about `target` pixels. */
export function scaleBarLength(metresPerPixel, target = 120) {
  const raw = metresPerPixel * target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].find((candidate) => candidate * magnitude >= raw * 0.62) ?? 10;
  const metres = step * magnitude;
  return { metres, pixels: metres / metresPerPixel };
}

const readableLength = (metres) =>
  metres >= 1000 ? `${metres / 1000} km` : `${metres} m`;

function drawTag(ctx, text, x, y, { scale, accent = false, align = 'left' }) {
  ctx.font = `700 ${Math.round(12 * scale)}px ${FONT}`;
  const padX = 8 * scale;
  const height = 22 * scale;
  const width = ctx.measureText(text).width + padX * 2;
  const left = align === 'right' ? x - width : x;
  ctx.fillStyle = 'rgba(12,14,17,.82)';
  ctx.beginPath();
  ctx.roundRect?.(left, y, width, height, 5 * scale) ?? ctx.rect(left, y, width, height);
  ctx.fill();
  ctx.fillStyle = accent ? ACCENT : INK;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + padX, y + height / 2 + 0.5);
  ctx.textBaseline = 'alphabetic';
}

function drawScaleAndNorth(ctx, frame, x, y, { scale, bearing, units }) {
  const perPixel = groundPerPixel(frame) / scale;
  let { metres, pixels } = scaleBarLength(perPixel, 120 * scale);
  let label = readableLength(metres);
  if (units === 'imperial') {
    const feetPerPixel = perPixel * 3.28084;
    const bar = scaleBarLength(feetPerPixel, 120 * scale);
    pixels = bar.pixels;
    label = bar.metres >= 5280 ? `${bar.metres / 5280} mi` : `${bar.metres} ft`;
  }
  const height = 30 * scale;
  const width = pixels + 70 * scale;
  ctx.fillStyle = 'rgba(12,14,17,.78)';
  ctx.beginPath();
  ctx.roundRect?.(x, y - height, width, height, 5 * scale) ?? ctx.rect(x, y - height, width, height);
  ctx.fill();
  const barX = x + 10 * scale;
  const barY = y - 11 * scale;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2 * scale;
  ctx.beginPath();
  ctx.moveTo(barX, barY - 5 * scale);
  ctx.lineTo(barX, barY);
  ctx.lineTo(barX + pixels, barY);
  ctx.lineTo(barX + pixels, barY - 5 * scale);
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.font = `600 ${Math.round(11 * scale)}px ${FONT}`;
  ctx.fillText(label, barX + 2 * scale, barY - 7 * scale);
  // north needle, turned with the picture
  const cx = x + width - 18 * scale;
  const cy = y - height / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((-bearing * Math.PI) / 180);
  ctx.beginPath();
  ctx.moveTo(0, -10 * scale);
  ctx.lineTo(5 * scale, 7 * scale);
  ctx.lineTo(0, 3 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, -10 * scale);
  ctx.lineTo(-5 * scale, 7 * scale);
  ctx.lineTo(0, 3 * scale);
  ctx.closePath();
  ctx.lineWidth = 1.2 * scale;
  ctx.stroke();
  ctx.restore();
}

/** Lay a change mask computed for `mask.frame` onto a picture captured at `target`. */
function drawChangeMask(ctx, mask, target, x, y, pixelScale, opacity) {
  const toTarget = compose(
    scaleBy(pixelScale),
    compose(frameToFrame(mask.frame, target), scaleBy(mask.frame.width / mask.canvas.width))
  );
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, target.width * pixelScale, target.height * pixelScale);
  ctx.clip();
  ctx.globalAlpha *= clamp(opacity, 0, 100) / 100;
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform?.(1, 0, 0, 1, 0, 0);
  ctx.transform(toTarget.a, toTarget.b, toTarget.c, toTarget.d, toTarget.e + x, toTarget.f + y);
  ctx.drawImage(mask.canvas, 0, 0);
  ctx.restore();
}

/**
 * @param {object} input
 * @param {{canvas: HTMLCanvasElement, frame: object}} input.a  A as captured, with its camera frame
 * @param {{canvas: HTMLCanvasElement, frame: object}} input.b
 * @param {'side'|'swipe'|'opacity'|'blink'} input.mode
 * @param {object|null} input.change  a finished difference to lay over the view, or null
 */
export function composeComparison({
  a,
  b,
  mode,
  title = '',
  divider = 50,
  opacity = 50,
  blinkB = false,
  change = null,
  annotations = [],
  labelA = 'Imagery A',
  labelB = 'Imagery B',
  attributionA = '',
  attributionB = '',
  view,
  bearing = 0,
  units = 'metric',
  makeCanvas,
}) {
  if (!a?.canvas?.width || !b?.canvas?.width || !a?.frame || !b?.frame) {
    throw new Error('both maps must be ready before they can be exported');
  }

  if (change && !(change.canvas?.width && change.frame)) {
    throw new Error('the difference must finish before it can be exported');
  }
  const pixelScale = a.canvas.width / a.frame.width;
  const s = pixelScale;
  const side = mode === 'side';
  const mapWidth = side ? a.canvas.width + b.canvas.width : Math.max(a.canvas.width, b.canvas.width);
  const mapHeight = Math.max(a.canvas.height, b.canvas.height);
  const header = Math.round((title ? 64 : 48) * s);
  const legend = change ? Math.round(30 * s) : 0;
  const footer = Math.round(26 * s) + legend;
  const output = canvasOf(mapWidth, header + mapHeight + footer, makeCanvas);
  const ctx = output.getContext('2d');
  if (!ctx) throw new Error('this browser cannot compose the comparison');

  ctx.fillStyle = BAND;
  ctx.fillRect(0, 0, output.width, output.height);

  const top = header;
  const paneB = side ? a.canvas.width : 0;
  // A framed export cuts the imagery, not the marks pinned to it, so what
  // falls outside the pane has to be held there: unclipped, a note anchored
  // off-frame would be painted over the header band.
  const clipped = (offsetX, width, height, draw) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(offsetX, top, width, height);
    ctx.clip();
    draw();
    ctx.restore();
  };
  // The highlights ride on the image they were asked over, in whatever view.
  const maskOn = (capture, letter, offsetX) => {
    if (!change || change.opacity <= 0) return;
    if (change.base !== 'both' && change.base !== letter) return;
    drawChangeMask(ctx, change, capture.frame, offsetX, top, s, change.opacity);
  };
  const markAnnotations = (capture, letter, offsetX) => {
    const marks = annotations.filter((mark) => onSide(mark, letter));
    clipped(offsetX, capture.canvas.width, capture.canvas.height, () =>
      drawAnnotations(ctx, marks, captureProjection(capture, offsetX, top), { scale: s, units })
    );
  };

  if (side) {
    ctx.drawImage(a.canvas, 0, top);
    ctx.drawImage(b.canvas, paneB, top);
    maskOn(a, 'a', 0);
    maskOn(b, 'b', paneB);
    markAnnotations(a, 'a', 0);
    markAnnotations(b, 'b', paneB);
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.fillRect(paneB - Math.round(s), top, Math.max(2, Math.round(2 * s)), mapHeight);
    drawTag(ctx, 'A', 12 * s, top + 12 * s, { scale: s, accent: true });
    drawTag(ctx, 'B', paneB + 12 * s, top + 12 * s, { scale: s, accent: true });
  } else if (mode === 'swipe') {
    const split = Math.round((clamp(Number(divider), 0, 100) / 100) * mapWidth);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, split, mapHeight);
    ctx.clip();
    ctx.drawImage(a.canvas, 0, top);
    maskOn(a, 'a', 0);
    markAnnotations(a, 'a', 0);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(split, top, mapWidth - split, mapHeight);
    ctx.clip();
    ctx.drawImage(b.canvas, 0, top);
    maskOn(b, 'b', 0);
    markAnnotations(b, 'b', 0);
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,.95)';
    ctx.fillRect(split - Math.round(s), top, Math.max(2, Math.round(2 * s)), mapHeight);
    if (split > 40 * s) drawTag(ctx, 'A', 12 * s, top + 12 * s, { scale: s, accent: true });
    if (mapWidth - split > 40 * s) {
      drawTag(ctx, 'B', mapWidth - 12 * s, top + 12 * s, { scale: s, accent: true, align: 'right' });
    }
  } else if (mode === 'opacity') {
    ctx.drawImage(a.canvas, 0, top);
    maskOn(a, 'a', 0);
    // B's highlights fade with B, as they do on screen.
    ctx.save();
    ctx.globalAlpha = clamp(Number(opacity), 0, 100) / 100;
    ctx.drawImage(b.canvas, 0, top);
    maskOn(b, 'b', 0);
    ctx.restore();
    markAnnotations(a, 'a', 0);
    const onlyB = annotations.filter((mark) => mark.side === 'b');
    clipped(0, b.canvas.width, b.canvas.height, () =>
      drawAnnotations(ctx, onlyB, captureProjection(b, 0, top), { scale: s, units })
    );
    drawTag(ctx, `B ${Math.round(opacity)}%`, mapWidth - 12 * s, top + 12 * s, { scale: s, accent: true, align: 'right' });
  } else {
    const shown = mode === 'blink' && blinkB ? b : a;
    const letter = shown === b ? 'b' : 'a';
    ctx.drawImage(shown.canvas, 0, top);
    maskOn(shown, letter, 0);
    markAnnotations(shown, letter, 0);
    drawTag(ctx, letter.toUpperCase(), 12 * s, top + 12 * s, { scale: s, accent: true });
  }

  drawScaleAndNorth(ctx, a.frame, 12 * s, top + mapHeight - 12 * s, { scale: s, bearing, units });

  // Header: what is being compared, then where.
  const left = 16 * s;
  let line = 0;
  // Where the written header ends on the row the camera reading would share.
  let taken = left;
  if (title) {
    ctx.fillStyle = INK;
    ctx.font = `700 ${Math.round(17 * s)}px ${FONT}`;
    ctx.fillText(title, left, 25 * s, mapWidth * 0.6);
    taken = left + Math.min(ctx.measureText(title).width, mapWidth * 0.6);
    line = 20 * s;
  }
  ctx.font = `600 ${Math.round(12 * s)}px ${FONT}`;
  ctx.fillStyle = ACCENT;
  ctx.fillText('A', left, 24 * s + line);
  ctx.fillStyle = INK;
  ctx.fillText(labelA, left + 14 * s, 24 * s + line, mapWidth * 0.3);
  const labelAWidth = Math.min(ctx.measureText(labelA).width, mapWidth * 0.3);
  const bx = left + 14 * s + labelAWidth + 22 * s;
  ctx.fillStyle = ACCENT;
  ctx.fillText('B', bx, 24 * s + line);
  ctx.fillStyle = INK;
  ctx.fillText(labelB, bx + 14 * s, 24 * s + line, mapWidth * 0.3);
  if (!title) {
    taken = bx + 14 * s + Math.min(ctx.measureText(labelB).width, mapWidth * 0.3);
  }

  const lat = Number(view?.lat);
  const lon = Number(view?.lon);
  const zoom = Number(view?.zoom);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    const camera = `${lat.toFixed(5)}, ${lon.toFixed(5)}  ·  z${Math.round(zoom)}  ·  ${Math.round(bearing)}°`;
    ctx.font = `${Math.round(11 * s)}px ${MONO}`;
    const width = ctx.measureText(camera).width;
    const x = mapWidth - width - 16 * s;
    // The header keeps its height whatever the export is framed to, so on a
    // narrow one the camera reading is what goes: the picture can be read
    // without it, and not without knowing which side is which.
    if (x > taken + 12 * s) {
      ctx.fillStyle = MUTED;
      ctx.fillText(camera, x, (title ? 25 : 24) * s);
    }
  }

  // Legend for a change reading, stated as what it is: an assist.
  const bottom = top + mapHeight;
  if (legend) {
    const palette = CHANGE_PALETTES[change.palette] ?? CHANGE_PALETTES.directional;
    const entries = [
      ['gain', change.labels?.gain ?? 'Appeared or brighter in B'],
      ['loss', change.labels?.loss ?? 'Gone or darker in B'],
      ['changed', 'Other change'],
    ];
    let x = left;
    const y = bottom + 20 * s;
    ctx.font = `${Math.round(11 * s)}px ${FONT}`;
    // On a framed export the legend can outrun the picture: an entry that
    // would run off the edge is dropped rather than half-written.
    for (const [key, text] of entries) {
      const width = ctx.measureText(text).width;
      if (x + 15 * s + width > mapWidth - 16 * s) break;
      const [r, g, bl] = palette[key];
      ctx.fillStyle = `rgb(${r},${g},${bl})`;
      ctx.fillRect(x, y - 9 * s, 10 * s, 10 * s);
      ctx.fillStyle = INK;
      ctx.fillText(text, x + 15 * s, y);
      x += width + 34 * s;
    }
    if (change.summary) {
      const width = ctx.measureText(change.summary).width;
      if (x + width <= mapWidth - 16 * s) {
        ctx.fillStyle = MUTED;
        ctx.fillText(change.summary, mapWidth - width - 16 * s, y);
      }
    }
  }

  ctx.fillStyle = MUTED;
  ctx.font = `${Math.round(10 * s)}px ${FONT}`;
  const credits = `A: ${attributionA || labelA}   |   B: ${attributionB || labelB}`;
  ctx.fillText(credits, left, output.height - 9 * s, Math.max(0, mapWidth - 32 * s));
  return output;
}

export function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('the comparison could not be encoded'))),
        'image/png'
      );
    } catch (error) {
      reject(new Error(`these imagery pixels cannot be exported: ${error.message}`));
    }
  });
}

export async function blobBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  // Bounded by the server's image limit, but chunking avoids the argument-size
  // limit that spreading a multi-megabyte Uint8Array would hit.
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}
