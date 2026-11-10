/**
 * How the logo editor of Settings › Publishing frames the analyst's logo: a shape
 * cut around it, a frame along that shape, a background inside it, a margin and a
 * crop. It is drawn once into the logo itself, so the proofs, the Map plates and
 * the notes that print the logo read a plain picture and know nothing of it.
 *
 * Radius, border and padding are shares of the drawn logo's short side, so a frame
 * looks the same on a small picture and a large one. Zoom and the offsets count in
 * the box the picture fits at zoom 1. `api/settings.py` LogoLook keeps the same bounds.
 */

export const SHAPES = Object.freeze(['rectangle', 'rounded', 'circle']);

/** Each number's bounds, as the server checks them. */
export const LIMITS = Object.freeze({
  radius: [0, 0.5],
  border: [0, 0.15],
  padding: [0, 0.25],
  zoom: [0.5, 4],
  x: [-1, 1],
  y: [-1, 1],
});

/** The picture as picked: no shape, frame, background, margin or crop. */
export const PLAIN = Object.freeze({
  shape: 'rectangle',
  radius: 0.2,
  border: 0,
  colour: '#ffffff',
  fill: '',
  padding: 0,
  zoom: 1,
  x: 0,
  y: 0,
});

/** The longest side a framed logo is drawn at, and the shortest. */
export const LONGEST = 1200;
export const SHORTEST = 256;

const HEX = /^#[0-9a-f]{6}$/;

function within(value, [low, high], fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(high, Math.max(low, number)) : fallback;
}

/** A whole look within bounds, whatever was handed in: the plain one fills the gaps. */
export function normaliseLook(raw) {
  const look = raw && typeof raw === 'object' ? raw : {};
  const colour = String(look.colour ?? '').toLowerCase();
  const fill = String(look.fill ?? '').toLowerCase();
  const out = {
    shape: SHAPES.includes(look.shape) ? look.shape : PLAIN.shape,
    colour: HEX.test(colour) ? colour : PLAIN.colour,
    fill: HEX.test(fill) ? fill : '',
  };
  for (const [key, bounds] of Object.entries(LIMITS)) out[key] = within(look[key], bounds, PLAIN[key]);
  return out;
}

/** Whether a look leaves the picture as it was picked, so its bytes can be kept as they are. */
export function isPlain(raw) {
  const look = normaliseLook(raw);
  return look.shape === 'rectangle' && look.border === 0 && !look.fill && look.padding === 0
    && look.zoom === 1 && look.x === 0 && look.y === 0;
}

/**
 * Where everything sits for a picture `width` × `height`, in the picture's own
 * pixels: the logo's size, the frame's width and the outer corner radius, the box
 * the picture fits at zoom 1 (`content`) and where the picture lands (`picture`).
 * A circle's box is square, as wide as the picture's long side.
 */
export function logoLayout(width, height, raw) {
  const look = normaliseLook(raw);
  const side = Math.max(width, height);
  const box = look.shape === 'circle' ? { w: side, h: side } : { w: width, h: height };
  const share = look.border + look.padding;
  const short = Math.min(box.w, box.h) / (1 - 2 * share);
  const margin = share * short;
  const w = box.w + 2 * margin;
  const h = box.h + 2 * margin;
  const radius = look.shape === 'circle' ? w / 2 : look.shape === 'rounded' ? look.radius * short : 0;
  const content = { x: margin, y: margin, w: box.w, h: box.h };
  const pw = width * look.zoom;
  const ph = height * look.zoom;
  const cx = margin + box.w / 2 + look.x * box.w;
  const cy = margin + box.h / 2 + look.y * box.h;
  return {
    shape: look.shape,
    width: w,
    height: h,
    border: look.border * short,
    radius,
    content,
    picture: { x: cx - pw / 2, y: cy - ph / 2, w: pw, h: ph },
  };
}

/** How much to scale a layout so its long side lies between SHORTEST and LONGEST. */
export function outputScale(layout) {
  const long = Math.max(layout.width, layout.height);
  return Math.min(LONGEST, Math.max(SHORTEST, long)) / long;
}

/** The logo's outline, `inset` in from its edge. */
function outline(ctx, layout, inset) {
  const w = layout.width - 2 * inset;
  const h = layout.height - 2 * inset;
  ctx.beginPath();
  if (layout.shape === 'circle') {
    ctx.arc(layout.width / 2, layout.height / 2, Math.max(0, w / 2), 0, Math.PI * 2);
    ctx.closePath();
    return;
  }
  const r = Math.max(0, Math.min(layout.radius - inset, w / 2, h / 2));
  const [x, y] = [inset, inset];
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Draw the framed logo with its top-left corner at the context's origin, in the
 * layout's units: the background and the picture cut to the inside of the frame,
 * then the frame, so it never covers the picture's edge.
 */
export function drawLogo(ctx, image, layout, raw) {
  const look = normaliseLook(raw);
  ctx.save();
  outline(ctx, layout, layout.border);
  ctx.clip();
  if (look.fill) {
    ctx.fillStyle = look.fill;
    ctx.fillRect(0, 0, layout.width, layout.height);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const { x, y, w, h } = layout.picture;
  ctx.drawImage(image, x, y, w, h);
  ctx.restore();
  if (layout.border > 0) {
    outline(ctx, layout, layout.border / 2);
    ctx.lineWidth = layout.border;
    ctx.strokeStyle = look.colour;
    ctx.stroke();
  }
}

function pictureSize(image) {
  return [image.naturalWidth || image.width, image.naturalHeight || image.height];
}

/**
 * The framed logo as a PNG no larger than `maxBytes`, drawn smaller each time it
 * comes out heavier.
 *
 * @returns {Promise<Blob>}
 */
export async function renderLogo(image, raw, { maxBytes, makeCanvas = defaultCanvas } = {}) {
  const [width, height] = pictureSize(image);
  if (!(width > 0 && height > 0)) throw new Error('The picture has no size');
  const layout = logoLayout(width, height, raw);
  let scale = outputScale(layout);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const canvas = makeCanvas(Math.max(1, Math.ceil(layout.width * scale)), Math.max(1, Math.ceil(layout.height * scale)));
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    drawLogo(ctx, image, layout, raw);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('The browser could not draw the logo');
    if (!maxBytes || blob.size <= maxBytes) return blob;
    scale *= 0.7;
  }
  throw new Error('The framed logo stays too large');
}

function defaultCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
