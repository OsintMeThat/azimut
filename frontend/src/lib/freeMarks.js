/**
 * Geo Proof marks free on the page: a box, a label, a symbol or a line that
 * belongs to the proof's page rather than to one of its pictures.
 *
 * The page is handled as one more surface, after the overlays and the panels: an
 * upright one at scale 1 whose pixels are the document's, so a free mark is
 * stored, drawn, picked and edited like any other, with `panel` set to `PAGE`.
 * It stays where it is when a panel moves, it can sit in a margin or across two
 * pictures, and it is drawn over every picture. The page grows right and down to
 * hold the free marks put past its edge, background and all, with the footer
 * kept under them; it never grows up or left, so the pictures keep their place.
 *
 * A straight line or arrow can also hold to pictures by its ends, which is how
 * one detail is tied to the same detail on another picture. Such a link is a
 * page mark whose `ends` hold, for each end, the picture and the pixel it holds
 * to, or null for an end left free on the page. `points` keep the ends where the
 * page last saw them, which is where an end falls back to when its picture is
 * removed.
 */
import { pageToSurface, surfaceFrame, surfaceHitTest, surfaceToPage } from './composer.js';
import { ICON_SIZE_DEFAULT } from './proofIcons.js';

/** The `panel` a free mark is drawn on. */
export const PAGE = 'page';

export const isFree = (shape) => shape?.panel === PAGE;

/**
 * Marks that only mean something on a picture's own pixels: a blur hides them,
 * an inset shows them bigger, a cone stands on them and a callout points at one.
 */
const PICTURE_ONLY = new Set(['blur', 'zoom', 'callout', 'cone']);

export const canBeFree = (kind) => !!kind && !PICTURE_ONLY.has(kind);

/** The page as a surface, in the shape `surfaces()` gives the panels and overlays. */
export function pageEntry(width, height) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  return {
    id: PAGE,
    kind: 'page',
    item: { id: PAGE, natural: [w, h] },
    box: { x: 0, y: 0, w, h, scale: 1, baseScale: 1, row: 0 },
    index: -1,
  };
}

/** How far right and down a free mark may take the page, in its pixels. */
export const PAGE_REACH = 8000;

/** A page point held where the page is or can grow to: never above it or left of it. */
export function onPage(point) {
  return {
    x: Math.min(Math.max(point.x, 0), PAGE_REACH),
    y: Math.min(Math.max(point.y, 0), PAGE_REACH),
  };
}

/**
 * The page as what a mark let go at `point` lands on, wherever the page can grow
 * to; null above it or left of it. `list` holds the page entry.
 */
export function pageHit(list, point) {
  const entry = list.find((x) => x.id === PAGE);
  if (!entry || point.x < 0 || point.y < 0) return null;
  return { ...entry, frame: surfaceFrame(entry), nx: point.x, ny: point.y };
}

/**
 * What a free mark covers on the page: `{ left, top, right, bottom }`, ink and
 * a tag included. `measure(s)` gives a label's `{ w, h }`, and `frameOf` the
 * frames a line's ends hold to.
 */
export function markBounds(s, { measure, frameOf }) {
  const ink = (s.strokeWidth ?? 4) / 2;
  const xs = [];
  const ys = [];
  let grow = ink;
  const turned = (w, h) => {
    const r = ((s.rotation ?? 0) * Math.PI) / 180;
    for (const [cx, cy] of [[0, 0], [w, 0], [w, h], [0, h]]) {
      xs.push(s.x + cx * Math.cos(r) - cy * Math.sin(r));
      ys.push(s.y + cx * Math.sin(r) + cy * Math.cos(r));
    }
  };
  if (s.kind === 'rect' || s.kind === 'blur') {
    turned(s.w ?? 0, s.h ?? 0);
    if (s.tag) grow += (s.tagSize ?? 18) * 1.6;
  } else if (s.kind === 'ellipse') {
    const r = ((s.rotation ?? 0) * Math.PI) / 180;
    const rx = (s.w ?? 0) / 2;
    const ry = (s.h ?? 0) / 2;
    const ex = Math.hypot(rx * Math.cos(r), ry * Math.sin(r));
    const ey = Math.hypot(rx * Math.sin(r), ry * Math.cos(r));
    xs.push(s.x - ex, s.x + ex);
    ys.push(s.y - ey, s.y + ey);
  } else if (Array.isArray(s.points)) {
    const points = s.ends ? linkPoints(s, frameOf) : s.points;
    for (let i = 0; i < points.length; i += 2) {
      xs.push(points[i]);
      ys.push(points[i + 1]);
    }
    if (s.kind === 'arrow') grow += 14;
  } else if (s.kind === 'text') {
    const { w, h } = measure(s);
    turned(w, h);
  } else {
    // a symbol or a marker hangs round its point by up to its size
    const size = s.size ?? ICON_SIZE_DEFAULT;
    xs.push(s.x - size, s.x + size);
    ys.push(s.y - size, s.y + size);
  }
  if (!xs.length) return null;
  return {
    left: Math.min(...xs) - grow,
    top: Math.min(...ys) - grow,
    right: Math.max(...xs) + grow,
    bottom: Math.max(...ys) + grow,
  };
}

/** How far right and down the free marks reach, for the page to grow to. */
export function freeExtent(shapes, helpers) {
  let right = 0;
  let bottom = 0;
  for (const s of shapes ?? []) {
    if (!isFree(s)) continue;
    const b = markBounds(s, helpers);
    if (!b) continue;
    right = Math.max(right, b.right);
    bottom = Math.max(bottom, b.bottom);
  }
  return { right, bottom };
}

/** A straight line or arrow: the marks whose two ends can each hold to a picture. */
export const isLink = (shape) =>
  (shape?.kind === 'line' || shape?.kind === 'arrow') && shape.points?.length === 4;

/** Whether a mark follows a picture: drawn on one, or a link holding to one. */
export const holdsToPicture = (shape) => !isFree(shape) || !!shape?.ends?.some(Boolean);

/**
 * A link's ends on the page now: an end that holds where its picture has it, a
 * free one where it was left. `frameOf` gives a surface's frame, or null once it
 * is gone, and an end whose picture is gone stays where the page last saw it.
 */
export function linkPoints(shape, frameOf) {
  const points = [...shape.points];
  (shape.ends ?? []).forEach((tie, i) => {
    const frame = tie && frameOf(tie.panel);
    if (!frame) return;
    const p = surfaceToPage(tie, frame);
    points[i * 2] = p.x;
    points[i * 2 + 1] = p.y;
  });
  return points;
}

/**
 * A line settled from what holds each of its ends. Each end is `{ page, on }`:
 * where it is on the page, and the picture it holds to (`{ id, nx, ny }`, the
 * pixel in that picture's own units) or null for free. Both ends on one picture
 * make a mark of that picture; anything else is a page mark that keeps what each
 * end holds to.
 */
export function settleLink(shape, a, b) {
  const out = { ...shape };
  delete out.ends;
  delete out.rotation;
  if (a.on && b.on && a.on.id === b.on.id) {
    out.panel = a.on.id;
    out.points = [a.on.nx, a.on.ny, b.on.nx, b.on.ny];
    return out;
  }
  out.panel = PAGE;
  out.points = [a.page.x, a.page.y, b.page.x, b.page.y];
  const tie = (end) => (end.on ? { panel: end.on.id, x: end.on.nx, y: end.on.ny } : null);
  const ends = [tie(a), tie(b)];
  if (ends.some(Boolean)) out.ends = ends;
  return out;
}

/** The picture under a page point, never the page itself: what an end can hold to. */
export function pictureUnder(list, point) {
  return surfaceHitTest(list.filter((entry) => entry.id !== PAGE), point);
}

/**
 * A link whose ends were moved on the page by (`dx`, `dy`), each end that holds
 * to a picture moving inside it, so it keeps holding where it was carried.
 */
export function nudgedLink(shape, dx, dy, frameOf) {
  const points = shape.points.map((v, i) => v + (i % 2 === 0 ? dx : dy));
  if (!shape.ends) return { points };
  const ends = shape.ends.map((tie) => {
    const frame = tie && frameOf(tie.panel);
    if (!frame) return tie;
    const page = surfaceToPage(tie, frame);
    const own = pageToSurface({ x: page.x + dx, y: page.y + dy }, frame);
    return { ...tie, x: own.x, y: own.y };
  });
  return { points, ends };
}

/**
 * A link with its hold on one picture let go, for when that picture leaves the
 * proof: the end stays where the page saw it, free. Anything else is returned as
 * it is.
 */
export function letGoOf(shape, surfaceId, frame) {
  if (!shape.ends?.some((tie) => tie?.panel === surfaceId)) return shape;
  const points = linkPoints(shape, (id) => (id === surfaceId ? frame : null));
  const ends = shape.ends.map((tie) => (tie?.panel === surfaceId ? null : tie));
  const out = { ...shape, points };
  if (ends.some(Boolean)) out.ends = ends;
  else delete out.ends;
  return out;
}

/**
 * The holds on one picture moved by (`dx`, `dy`) of its pixels, for when its
 * crop moves the corner its pixels are measured from. The picture's own marks
 * are moved by the caller, the same way.
 */
export function shiftedTies(shapes, surfaceId, dx, dy) {
  if (!dx && !dy) return shapes;
  return shapes.map((shape) => {
    if (!shape.ends?.some((tie) => tie?.panel === surfaceId)) return shape;
    const ends = shape.ends.map((tie) => (tie?.panel === surfaceId ? { ...tie, x: tie.x + dx, y: tie.y + dy } : tie));
    return { ...shape, ends };
  });
}
