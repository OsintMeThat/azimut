/**
 * Geo Proof marks drawn over a zoom inset's enlargement, and the lock that holds
 * an inset in place.
 *
 * An enlargement is one more surface a mark can belong to, like a panel or an
 * overlay: a mark let go over it is bound to it (`panel` holds the inset's id) and
 * follows it when it is moved or resized. Its pixels are the frame's, measured
 * from the frame's top left at the frame's own size, so the enlargement's zoom is
 * its `box.scale` and a mark keeps its ink in page pixels like any other. Only the
 * marks that can stand free on the page can stand on an inset: a blur, an inset,
 * a callout or a cone only means something on a picture's own pixels.
 *
 * When the frame is moved or reshaped on its picture, the marks keep to the pixels
 * they were drawn on; carried onto another picture, they keep their place in the
 * enlargement. A proof saved before this kept such marks free on the page, and
 * they stay so: nothing is bound again as it opens.
 */
import { moveShapeToSurface, surfaceToPage } from './composer.js';
import { insetBox } from './pageMarks.js';
import { sourceSize } from './proofSurface.js';

/** The `kind` an inset takes in a list of surfaces. */
export const INSET = 'inset';

/**
 * Whether an element is held in place: no drag or resize by pointer moves it, and
 * a press on it is not a press on it. Absent reads as unlocked. Read off one field,
 * `locked`, so a panel or an overlay could take the same lock later.
 */
export const isLocked = (item) => item?.locked === true;

/**
 * The zoom insets as surfaces, front first: the last one in the stack is drawn on
 * top. Each is `{ id, kind: 'inset', item, box, index }` in the shape `surfaces()`
 * gives the pictures, `index` its place among the insets in the stack. `frameOf`
 * gives a picture's frame, and the document's size holds an enlargement inside it.
 */
export function insetSurfaces(shapes, frameOf, docW, docH) {
  const out = [];
  for (const s of shapes ?? []) {
    if (s?.kind !== 'zoom' || !(s.w > 0) || !(s.h > 0) || !(s.iw > 0)) continue;
    const frame = frameOf(s.panel);
    if (!frame) continue;
    const centre = surfaceToPage({ x: s.x + s.w / 2, y: s.y + s.h / 2 }, frame);
    const box = insetBox(centre, s, docW, docH);
    out.push({
      id: s.id,
      kind: INSET,
      item: { id: s.id, natural: [s.w, s.h], rotation: frame.rotation },
      box: { ...box, scale: box.w / s.w, baseScale: 1, row: 0 },
      index: out.length,
    });
  }
  return out.reverse();
}

/** A frame `{ x, y, w, h }` as a surface frame whose page is its picture, at `scale`. */
function frameOn(rect, scale = 1, middle = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }) {
  return {
    box: { x: rect.x, y: rect.y, w: rect.w, h: rect.h, scale },
    image: sourceSize([rect.w, rect.h]),
    rotation: 0,
    middle,
  };
}

/**
 * The proof's marks with those bound to inset `id` carried through a change of
 * its frame, `from` and `to` (`{ x, y, w, h }` in its picture's pixels). On the
 * same picture they keep to the pixels they were drawn on; carried onto another
 * picture, they keep their place in the enlargement and grow or shrink with it.
 */
export function reframedInsetMarks(shapes, id, from, to, samePicture = true) {
  if (!(from?.w > 0) || !(to?.w > 0)) return shapes;
  const same = from.x === to.x && from.y === to.y && from.w === to.w && from.h === to.h;
  if (same && samePicture) return shapes;
  const centre = { x: 0, y: 0 };
  const [a, b] = samePicture
    ? [frameOn(from), frameOn(to)]
    : [frameOn(from, 1, centre), frameOn(to, sourceSize([from.w, from.h])[0] / sourceSize([to.w, to.h])[0], centre)];
  return shapes.map((s) => (s.panel === id ? { ...moveShapeToSurface(s, a, b), panel: id } : s));
}

/**
 * The ids of every mark that goes when the surfaces `ids` go: their own, and the
 * marks drawn over the insets among them or standing on them.
 */
export function goingWith(shapes, ids) {
  const gone = new Set(ids);
  for (const s of shapes ?? []) {
    if (s.kind === 'zoom' && (gone.has(s.panel) || gone.has(s.id))) gone.add(s.id);
  }
  return new Set((shapes ?? []).filter((s) => gone.has(s.id) || gone.has(s.panel)).map((s) => s.id));
}
