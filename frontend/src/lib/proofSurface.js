/**
 * Non-destructive panel and overlay geometry for Geo Proof.
 *
 * A crop is a rectangle of the source image and a turn is an angle. Neither is
 * baked into pixels: the canvas draws the source through them, so the selection
 * frame, the crop marks and the annotations all sit on the image's own edges
 * however far it is turned. What the page has to reserve is the upright box a
 * turned image needs, which is what `surfaceBoxSize` answers — the layout keeps
 * working in upright boxes and knows nothing about the angle.
 */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** A safe source size. Image dimensions are positive integers at this boundary. */
export function sourceSize(natural) {
  const width = Math.max(1, Math.round(Number(natural?.[0]) || 1));
  const height = Math.max(1, Math.round(Number(natural?.[1]) || 1));
  return [width, height];
}

/** Keep an angle compact while preserving every free-rotation degree. */
export function normalizeSurfaceAngle(angle) {
  const value = Number(angle);
  if (!Number.isFinite(value)) return 0;
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return Math.abs(normalized) < 0.01 ? 0 : normalized;
}

/**
 * A crop rectangle in source pixels, or null for "the whole image". Null is the
 * absence of a crop rather than a full-size one, so nothing has to special-case
 * a rectangle that happens to cover everything.
 */
export function normalizeSourceCrop(crop, natural) {
  if (!crop || typeof crop !== 'object' || Array.isArray(crop)) return null;
  const [width, height] = sourceSize(natural);
  const rawX = Number(crop.x);
  const rawY = Number(crop.y);
  const rawW = Number(crop.w);
  const rawH = Number(crop.h);
  if (![rawX, rawY, rawW, rawH].every(Number.isFinite) || rawW <= 0 || rawH <= 0) return null;

  const x = clamp(Math.round(rawX), 0, width - 1);
  const y = clamp(Math.round(rawY), 0, height - 1);
  const right = clamp(Math.round(rawX + rawW), x + 1, width);
  const bottom = clamp(Math.round(rawY + rawH), y + 1, height);
  const normalized = { x, y, w: right - x, h: bottom - y };
  return x === 0 && y === 0 && normalized.w === width && normalized.h === height
    ? null
    : normalized;
}

/** The pixels actually drawn: the crop when there is one, else the source. */
export function surfaceImageSize(natural, crop) {
  const source = sourceSize(natural);
  const kept = normalizeSourceCrop(crop, source);
  return kept ? [kept.w, kept.h] : source;
}

/**
 * The upright box a rectangle needs once it is turned by `angle`. Rounded up,
 * but off a hair's tolerance: `cos(90°)` is not quite zero in binary, and
 * without it every quarter turn would hand the box one more pixel to keep.
 */
export function rotatedBoxSize(width, height, angle) {
  const radians = normalizeSurfaceAngle(angle) * Math.PI / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const ceil = (value) => Math.max(1, Math.ceil(value - 1e-6));
  return [ceil(width * cos + height * sin), ceil(width * sin + height * cos)];
}

/** What the page reserves for a surface: its image, turned, boxed upright. */
export function surfaceBoxSize(natural, crop, rotation) {
  const [width, height] = surfaceImageSize(natural, crop);
  return rotatedBoxSize(width, height, rotation);
}

/**
 * Move one annotation with its surface's pixels. A crop shifts the origin the
 * annotations are measured from; a turn moves nothing, because the annotations
 * are drawn inside the image and turn with it.
 */
export function shiftProofShape(shape, dx, dy) {
  if (!dx && !dy) return shape;
  if (Array.isArray(shape.points)) {
    return {
      ...shape,
      points: shape.points.map((value, index) => value + (index % 2 ? dy : dx)),
    };
  }
  return { ...shape, x: (shape.x ?? 0) + dx, y: (shape.y ?? 0) + dy };
}

/** Apply a coordinate edit only to annotations bound to one surface. */
export function mapSurfaceShapes(shapes, surfaceId, edit) {
  return (shapes ?? []).map((shape) => (shape.panel === surfaceId ? edit(shape) : shape));
}
