/**
 * Geo Proof marks that point from a picture out onto the page: a callout, whose
 * label is tied to one pixel by a leader line or a bubble's tail, and a zoom
 * inset, which frames a detail and shows it bigger elsewhere on the page.
 *
 * Both belong to the picture they point at. A callout's tip and an inset's frame
 * are in that surface's own pixels (`x`, `y`, and `w`, `h` for a frame), so they
 * follow it when it moves, grows, turns or is cropped. What they put on the page,
 * the label or the enlargement, is placed by an offset in page pixels from that
 * anchor (`dx`, `dy`, from the tip or from the frame's centre), stays upright,
 * and is held inside the document: the panels are what give the document its
 * size, and nothing drawn past its edge would reach the export.
 */

export const PAGE_KINDS = new Set(['callout', 'zoom']);

/** Whether a mark draws on the page rather than inside its picture. */
export const isPageMark = (shape) => PAGE_KINDS.has(shape?.kind);

/** How a callout reaches its point: a thin line ending on a dot, or a bubble's tail. */
export const CALLOUT_TAILS = ['leader', 'bubble'];
export const CALLOUT_FONT = 22;
/** Where a callout placed with a click puts its label: up and to the right. */
export const CALLOUT_OFFSET = { dx: 80, dy: -60 };

export const INSET_ZOOM = 2.5;
export const INSET_GAP = 24;
export const INSET_MIN = 60;
/** The share of the document's smaller side a new inset may take. */
export const INSET_SHARE = 0.4;

/** A rectangle moved, not resized, so it lies inside the document where it can. */
export function clampRect(rect, docW, docH) {
  return {
    ...rect,
    x: Math.min(Math.max(rect.x, 0), Math.max(0, docW - rect.w)),
    y: Math.min(Math.max(rect.y, 0), Math.max(0, docH - rect.h)),
  };
}

/** A callout's label box on the page: centred on its tip plus its offset. */
export function calloutBox(tip, shape, w, h, docW, docH) {
  const x = tip.x + (shape.dx ?? 0) - w / 2;
  const y = tip.y + (shape.dy ?? 0) - h / 2;
  return clampRect({ x, y, w, h }, docW, docH);
}

/**
 * The line width and the dot a callout draws: its own width once one is set,
 * which lets its words grow without the line, and otherwise read off its font.
 */
export function calloutInk(fontSize = CALLOUT_FONT, width = null) {
  const line = width > 0 ? width : Math.max(1.5, fontSize / 11);
  return { line, dot: line * 2.2 };
}

/**
 * The point of a rectangle's outline nearest to `p`, and the side it lies on.
 * Null when `p` is inside: a tip under its own label has no line to draw.
 */
export function nearestOnRect(p, rect) {
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  if (p.x > rect.x && p.x < right && p.y > rect.y && p.y < bottom) return null;
  const past = [
    ['left', rect.x - p.x],
    ['right', p.x - right],
    ['top', rect.y - p.y],
    ['bottom', p.y - bottom],
  ].reduce((a, b) => (b[1] > a[1] ? b : a));
  return {
    x: Math.min(Math.max(p.x, rect.x), right),
    y: Math.min(Math.max(p.y, rect.y), bottom),
    side: past[0],
  };
}

/**
 * A speech bubble's tail: a triangle from the side of the box facing the tip to
 * the tip, as flat points for a closed line. Its base is centred where the tip
 * is nearest and kept off the rounded corners, and it starts a pixel inside the
 * box so the two fills read as one shape. Null when the tip is under the box.
 */
export function bubbleTail(tip, rect, half, radius = 0) {
  const near = nearestOnRect(tip, rect);
  if (!near) return null;
  const upright = near.side === 'left' || near.side === 'right';
  const start = upright ? rect.y : rect.x;
  const length = upright ? rect.h : rect.w;
  const lo = start + radius + half;
  const hi = start + length - radius - half;
  const aim = upright ? near.y : near.x;
  const mid = lo <= hi ? Math.min(Math.max(aim, lo), hi) : start + length / 2;
  const base = {
    left: rect.x + 1,
    right: rect.x + rect.w - 1,
    top: rect.y + 1,
    bottom: rect.y + rect.h - 1,
  }[near.side];
  return upright
    ? [base, mid - half, tip.x, tip.y, base, mid + half]
    : [mid - half, base, tip.x, tip.y, mid + half, base];
}

/** An inset's height: the frame's own proportions at the inset's width. */
export function insetHeight(shape) {
  return shape.w > 0 ? (shape.iw * shape.h) / shape.w : shape.iw;
}

/** An inset's box on the page: centred on its frame's centre plus its offset. */
export function insetBox(centre, shape, docW, docH) {
  const w = shape.iw;
  const h = insetHeight(shape);
  return clampRect({ x: centre.x + (shape.dx ?? 0) - w / 2, y: centre.y + (shape.dy ?? 0) - h / 2, w, h }, docW, docH);
}

/**
 * Where a new inset goes and how big it is. It shows the frame `zoom` times
 * bigger, up to a share of the document's smaller side. Beside the frame on the
 * page if that size fits there, right first, then left, below and above; else in
 * the corner of the frame's own picture farthest from the frame, which is where
 * proofs usually carry one, and the analyst moves it from there.
 *
 * `frame` and `picture` are upright page boxes. What comes back is the inset's
 * width and its centre's offset from the frame's centre, in page pixels.
 */
export function insetPlacement(frame, picture, docW, docH, zoom = INSET_ZOOM, gap = INSET_GAP) {
  const ratio = frame.w > 0 ? frame.h / frame.w : 1;
  const cap = (Math.min(docW, docH) * INSET_SHARE) / Math.max(1, ratio);
  const iw = Math.max(INSET_MIN, Math.min(frame.w * zoom, cap));
  const ih = iw * ratio;
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  const fits = (x, y) => x - iw / 2 >= 0 && x + iw / 2 <= docW && y - ih / 2 >= 0 && y + ih / 2 <= docH;
  const across = frame.w / 2 + gap + iw / 2;
  const down = frame.h / 2 + gap + ih / 2;
  for (const [dx, dy] of [[across, 0], [-across, 0], [0, down], [0, -down]]) {
    if (fits(cx + dx, cy + dy)) return { iw, dx, dy };
  }
  const corners = [
    [picture.x + gap + iw / 2, picture.y + gap + ih / 2],
    [picture.x + picture.w - gap - iw / 2, picture.y + gap + ih / 2],
    [picture.x + picture.w - gap - iw / 2, picture.y + picture.h - gap - ih / 2],
    [picture.x + gap + iw / 2, picture.y + picture.h - gap - ih / 2],
  ];
  const [x, y] = corners.reduce((a, b) => (
    Math.hypot(b[0] - cx, b[1] - cy) > Math.hypot(a[0] - cx, a[1] - cy) ? b : a
  ));
  return { iw, dx: x - cx, dy: y - cy };
}

/**
 * The two lines between a frame and its enlargement. Corners are
 * [top-left, top-right, bottom-right, bottom-left] in the picture's own turn,
 * and `towards` is the inset's direction from the frame in that same turn. The
 * frame's side facing the inset joins the inset's side facing back, so the two
 * lines run along the pair rather than across either one.
 */
export function insetConnectors(frameCorners, insetCorners, towards) {
  const { x, y } = towards;
  let pairs;
  if (Math.abs(x) >= Math.abs(y)) pairs = x >= 0 ? [[1, 0], [2, 3]] : [[0, 1], [3, 2]];
  else pairs = y >= 0 ? [[3, 0], [2, 1]] : [[0, 3], [1, 2]];
  return pairs.map(([a, b]) => [frameCorners[a], insetCorners[b]]);
}

/**
 * A label given a pointer. Its point is where the label stood, in its picture's
 * pixels, and the label moves off it the way a click would place a new callout.
 */
export function labelToCallout(label, point, tail) {
  return {
    id: label.id,
    panel: label.panel,
    kind: 'callout',
    color: label.color,
    text: label.text ?? '',
    fontSize: label.fontSize ?? CALLOUT_FONT,
    x: point.x,
    y: point.y,
    dx: CALLOUT_OFFSET.dx,
    dy: CALLOUT_OFFSET.dy,
    tail,
  };
}

/**
 * A callout with its pointer taken off: a framed label where its box stood,
 * `origin` being the box's top-left in its picture's pixels and `turn` what
 * keeps it upright on the page over a turned picture.
 */
export function calloutToLabel(callout, origin, turn) {
  return {
    id: callout.id,
    panel: callout.panel,
    kind: 'text',
    color: callout.color,
    text: callout.text ?? '',
    fontSize: callout.fontSize ?? CALLOUT_FONT,
    x: origin.x,
    y: origin.y,
    ...(turn ? { rotation: turn } : {}),
    frame: true,
  };
}
