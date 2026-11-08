/**
 * Non-destructive panel and overlay geometry for Geo Proof.
 *
 * A crop is a rectangle of the source image and a turn is an angle. Neither is
 * baked into pixels: the canvas draws the source through them, so the selection
 * frame, the crop marks and the annotations all sit on the image's own edges
 * however far it is turned. What the page has to reserve is the upright box a
 * turned image needs, which is what `surfaceBoxSize` answers — the layout keeps
 * working in upright boxes and knows nothing about the angle.
 *
 * A crop runs along the picture's edges, so it tilts with a turned picture. A cut
 * is the other way to keep part of one: a rectangle square to the page, which is
 * what cropping a turned image means to the person looking at it. It is held in
 * upright units, one to a source pixel, measured from the middle of the picture,
 * and it replaces the box the page reserves. The picture's own pixels, and so
 * every annotation, stay exactly where they were. A surface has a crop or a cut,
 * never both, and one that has never been turned only ever has a crop.
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

/** What the page reserves for a surface: its cut, or its image turned and boxed upright. */
export function surfaceBoxSize(natural, crop, rotation, cut = null) {
  if (cut) return [cut.w, cut.h];
  const [width, height] = surfaceImageSize(natural, crop);
  return rotatedBoxSize(width, height, rotation);
}

/** A vector turned by `degrees`, clockwise on the page as Konva turns a node. */
export function turned(x, y, degrees) {
  if (!degrees) return { x, y };
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

/** No turn or a quarter turn: the picture's edges already lie along the page's. */
export function isQuarterTurn(angle) {
  const off = Math.abs(normalizeSurfaceAngle(angle)) % 90;
  return Math.min(off, 90 - off) < 0.01;
}

/**
 * A cut read off a spec or a draft, in whole upright units, or null for none. A
 * surface with a crop has no cut: only a hand-edited spec could hold both, and
 * the crop is the one every older build reads.
 */
export function normalizeSurfaceCut(cut, crop = null) {
  if (crop || !cut || typeof cut !== 'object' || Array.isArray(cut)) return null;
  const x = Number(cut.x);
  const y = Number(cut.y);
  const w = Number(cut.w);
  const h = Number(cut.h);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  const left = Math.round(x);
  const top = Math.round(y);
  return {
    x: left,
    y: top,
    w: Math.max(1, Math.round(x + w) - left),
    h: Math.max(1, Math.round(y + h) - top),
  };
}

/** How far a whole source reaches once turned, about its middle: where upright marks stop. */
export function surfaceCutReach(natural, rotation) {
  const [width, height] = sourceSize(natural);
  const radians = normalizeSurfaceAngle(rotation) * Math.PI / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const halfW = (width * cos + height * sin) / 2;
  const halfH = (width * sin + height * cos) / 2;
  return { left: -halfW, top: -halfH, right: halfW, bottom: halfH };
}

/** The upright box around what a surface shows before any cut: where its marks open. */
export function surfaceCutStart(natural, crop, rotation) {
  const [width, height] = sourceSize(natural);
  const kept = normalizeSourceCrop(crop, [width, height]) ?? { x: 0, y: 0, w: width, h: height };
  const middle = turned(kept.x + kept.w / 2 - width / 2, kept.y + kept.h / 2 - height / 2, rotation);
  const reach = surfaceCutReach([kept.w, kept.h], rotation);
  return {
    x: middle.x + reach.left,
    y: middle.y + reach.top,
    w: reach.right - reach.left,
    h: reach.bottom - reach.top,
  };
}

/** The cut upright marks leave behind. Marks standing on the whole picture leave none. */
export function settleSurfaceCut(draft, natural, rotation) {
  const kept = normalizeSurfaceCut(draft);
  if (!kept) return null;
  const reach = surfaceCutReach(natural, rotation);
  const whole = kept.x <= reach.left + 1 && kept.y <= reach.top + 1
    && kept.x + kept.w >= reach.right - 1 && kept.y + kept.h >= reach.bottom - 1;
  return whole ? null : kept;
}

/** Where a cut's middle lies from the picture's, which is where the page box is off the group. */
export function surfaceCutMiddle(cut) {
  return cut ? { x: cut.x + cut.w / 2, y: cut.y + cut.h / 2 } : { x: 0, y: 0 };
}

/** Whether a turn swaps width and height: a quarter turn either way, or three. */
export function isSideways(angle) {
  return isQuarterTurn(angle) && Math.abs(Math.round(normalizeSurfaceAngle(angle) / 90)) % 2 === 1;
}

/**
 * The same cut once its picture has turned from one angle to another, about the
 * cut's own middle, so what the analyst is looking at turns in place. A quarter
 * turn takes the cut round with the picture, the way a cropped photo turns. Any
 * other turn leaves the cut square on the page and turns the picture under it,
 * which is how a horizon is levelled a little further.
 */
export function turnSurfaceCut(cut, from, to) {
  if (!cut) return cut;
  const delta = normalizeSurfaceAngle(to - from);
  const middle = surfaceCutMiddle(cut);
  const moved = turned(middle.x, middle.y, delta);
  const [w, h] = isSideways(delta) ? [cut.h, cut.w] : [cut.w, cut.h];
  return { x: moved.x - w / 2, y: moved.y - h / 2, w, h };
}

/**
 * A cut read off a spec, or null when nothing of it is left. It is kept as it was
 * saved, blank corners and all, since a cut picture turned a few degrees further
 * may lie past its picture's reach, and a reload must draw what was saved. Only a
 * cut out of all proportion to its picture is held in, at a bound no gesture
 * reaches: half again the picture's diagonal from its middle.
 */
export function fitSurfaceCut(cut, natural) {
  const kept = normalizeSurfaceCut(cut);
  if (!kept) return null;
  const [width, height] = sourceSize(natural);
  const bound = Math.ceil(Math.hypot(width, height) * 1.5);
  const left = Math.max(kept.x, -bound);
  const top = Math.max(kept.y, -bound);
  const right = Math.min(kept.x + kept.w, bound);
  const bottom = Math.min(kept.y + kept.h, bound);
  if (right - left < 1 || bottom - top < 1) return null;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * The source rectangle an upright cut stands for once the picture's edges lie
 * along the page's, at no turn or a quarter turn: a plain crop, held to the
 * source, or null when it keeps the whole picture. At any other angle it is the
 * source rectangle around the cut.
 */
export function cutToSourceCrop(cut, natural, rotation) {
  const [width, height] = sourceSize(natural);
  const corners = [[cut.x, cut.y], [cut.x + cut.w, cut.y], [cut.x + cut.w, cut.y + cut.h], [cut.x, cut.y + cut.h]]
    .map(([x, y]) => turned(x, y, -normalizeSurfaceAngle(rotation)));
  const xs = corners.map((p) => p.x + width / 2);
  const ys = corners.map((p) => p.y + height / 2);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return normalizeSourceCrop({ x: left, y: top, w: Math.max(...xs) - left, h: Math.max(...ys) - top }, [width, height]);
}

/**
 * How a cut sits in its surface's own pixels: at this corner, turned back this
 * far, it stands square on the page. `image` is the size of the pixels drawn.
 */
export function surfaceCutSeat(cut, image, rotation) {
  const turn = normalizeSurfaceAngle(rotation);
  const corner = turned(cut.x, cut.y, -turn);
  return { x: image[0] / 2 + corner.x, y: image[1] / 2 + corner.y, rotation: -turn || 0 };
}

/** A cut's four corners in its surface's own pixels, clockwise from its top left. */
export function surfaceCutOutline(cut, image, rotation) {
  const turn = normalizeSurfaceAngle(rotation);
  return [[0, 0], [cut.w, 0], [cut.w, cut.h], [0, cut.h]].map(([x, y]) => {
    const corner = turned(cut.x + x, cut.y + y, -turn);
    return { x: image[0] / 2 + corner.x, y: image[1] / 2 + corner.y };
  });
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

/**
 * The upright rectangle that contains a `w`×`h` box placed at (x, y) and turned
 * by `deg` about that corner.
 */
function uprightCover(x, y, w, h, deg) {
  const radians = (Number(deg) || 0) * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const xs = [];
  const ys = [];
  for (const [cx, cy] of [[0, 0], [w, 0], [w, h], [0, h]]) {
    xs.push(x + cx * cos - cy * sin);
    ys.push(y + cx * sin + cy * cos);
  }
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { x: left, y: top, w: Math.max(...xs) - left, h: Math.max(...ys) - top };
}

/**
 * The patch of a surface a blur box covers, in that surface's own drawn pixels
 * and in the source's.
 *
 * A blur is not paint: it redraws the picture under the box through a filter, so
 * the box has to name the source pixels it stands over. The surface's drawn space
 * starts at the crop's top-left, so a box at (x, y) there is at (crop.x + x,
 * crop.y + y) in the file.
 *
 * Clamped to the picture, because a box dragged half off the panel would
 * otherwise ask for pixels the file does not have — and a crop past the edge is
 * drawn as whatever happens to be in memory. What comes back is the part that
 * overlaps, positioned relative to the box itself, or null when none of it does.
 *
 * `margin` widens the patch that is *read* without widening what is drawn: a
 * blur mixes in what surrounds each pixel, so a patch cut exactly to the box
 * mixes in the transparency past its own edge and comes out washed out at the
 * border — the one place a redaction has to hold. The caller clips the box back
 * to size, so the margin is context for the filter and nothing else.
 *
 * A turned box (`rect.rotation`) reads the upright rectangle that contains it and
 * hands back the `turn` that puts the patch level with the picture again: the
 * pixels have to come from the ground the box stands on, and the ground does not
 * turn with it. `dx`/`dy` are always in the box's own space, so the caller seats
 * the patch inside the box and lets the clip do the rest.
 */
export function blurPatch(rect, natural, crop, margin = 0) {
  const [width, height] = surfaceImageSize(natural, crop);
  const kept = normalizeSourceCrop(crop, sourceSize(natural));
  const turn = normalizeSurfaceAngle(rect?.rotation);
  const left = Number(rect?.x) || 0;
  const top = Number(rect?.y) || 0;
  const cover = uprightCover(left, top, Number(rect?.w) || 0, Number(rect?.h) || 0, turn);
  const x = clamp(cover.x, 0, width);
  const y = clamp(cover.y, 0, height);
  const right = clamp(cover.x + cover.w, 0, width);
  const bottom = clamp(cover.y + cover.h, 0, height);
  if (right - x < 1 || bottom - y < 1) return null;
  const pad = Math.max(0, Math.round(Number(margin) || 0));
  const ex = clamp(x - pad, 0, width);
  const ey = clamp(y - pad, 0, height);
  const ew = clamp(right + pad, 0, width) - ex;
  const eh = clamp(bottom + pad, 0, height) - ey;
  // where the patch sits inside the box, so the node can be a child of it
  const radians = turn * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const offX = ex - left;
  const offY = ey - top;
  return {
    dx: offX * cos + offY * sin,
    dy: offY * cos - offX * sin,
    turn: -turn || 0,
    w: ew,
    h: eh,
    crop: { x: (kept?.x ?? 0) + ex, y: (kept?.y ?? 0) + ey, width: ew, height: eh },
  };
}

/**
 * How hard a blur box blurs, in the surface's own pixels.
 *
 * Proportional to the box, so a licence plate and a whole street get a blur of
 * the same strength *relative to what they hide*; a fixed radius either leaves a
 * small box legible or costs a fortune on a large one. The floor is what makes
 * a thumbnail-sized box unreadable; the ceiling is where Konva's own blur stops
 * improving.
 */
export function blurRadiusFor(rect) {
  const side = Math.min(Math.abs(Number(rect?.w) || 0), Math.abs(Number(rect?.h) || 0));
  return clamp(Math.round(side / 5), 6, 80);
}
