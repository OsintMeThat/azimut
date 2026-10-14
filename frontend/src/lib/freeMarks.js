/**
 * Geo Proof marks free on the page: a box, a label, a symbol or a line that
 * belongs to the proof's page rather than to one of its pictures.
 *
 * The page is handled as one more surface, after the overlays and the panels: an
 * upright one at scale 1 whose pixels are the document's, so a free mark is
 * stored, drawn, picked and edited like any other, with `panel` set to `PAGE`.
 * It stays where it is when a panel moves, it can sit in a margin or across two
 * pictures, and it is drawn over every picture. It is held inside the document,
 * which the panels alone size.
 *
 * A straight line or arrow can also hold to pictures by its ends, which is how
 * one detail is tied to the same detail on another picture. Such a link is a
 * page mark whose `ends` hold, for each end, the picture and the pixel it holds
 * to, or null for an end left free on the page. `points` keep the ends where the
 * page last saw them, which is where an end falls back to when its picture is
 * removed.
 */
import { pageToSurface, surfaceFrame, surfaceHitTest, surfaceToPage } from './composer.js';

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

/** A page point held inside the document. */
export function onPage(point, width, height) {
  return {
    x: Math.min(Math.max(point.x, 0), width),
    y: Math.min(Math.max(point.y, 0), height),
  };
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

/** A frame for the page, for the helpers that read one off a surface. */
export const pageFrame = (width, height) => surfaceFrame(pageEntry(width, height));

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
