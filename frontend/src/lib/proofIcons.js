/**
 * The symbols a proof can stamp onto a panel.
 *
 * These are document content, not interface furniture, which is why they live
 * here and not in `Icon.svelte`: one is drawn into the exported picture and has
 * to survive a save, the other only ever decorates a button.
 *
 * A proof names one of three kinds (`lib/icons/catalog.js`): its own eleven
 * stamps (`lib/icons/stamps.js`), a layer badge's flat glyph, or a vehicle model
 * that turns and tilts. The eleven are filled silhouettes with a dark halo, so a
 * stamp holds over a busy roof; their names never change, so a proof saved before
 * they were redrawn opens with every stamp where it was, drawn the new way.
 *
 * Two rules hold the set together:
 *
 * A symbol takes the active colour like every other annotation, so it joins the
 * legend by colour and claims no vocabulary of its own. The legend is keyed on
 * colour (`featureColors`), and a symbol that meant something the legend could
 * not say would leave the reader with two systems and no way to tell which one
 * the analyst meant.
 *
 * A symbol scales but never deforms. Its box is square and `size` is that box's
 * side, so there is one dimension to change and stretching is not expressible.
 */
import { catalogEntry, isStampable } from './icons/catalog.js';
import { STAMPS } from './icons/stamps.js';

/** Side of the box every path is drawn in. */
export const ICON_BOX = 24;

/** Placed side, in page pixels: the same on every panel and overlay. */
export const ICON_SIZE_DEFAULT = 56;

export const ICON_SIZE_MIN = 12;

/**
 * The stamps that take no stroke width. Point, impact and north are pure
 * silhouettes; a glyph and a model carry their own drawing weight. The other
 * eight read the width as weight, as they did when they were drawn in strokes,
 * so a proof that made a symbol bolder keeps it bolder.
 */
const SOLID = new Set(['point', 'impact', 'nord']);

/**
 * Where the symbol sits on the point it names, in fractions of its box.
 *
 * Centre for everything that marks an area. The pin is the exception and the
 * reason the field exists: a pin means *this pixel*, so it hangs from its tip.
 * Anchored at its centre it would slide off the thing it points at every time
 * the analyst resized it.
 */
const ANCHORS = { point: [0.5, 22.4 / ICON_BOX] };

/** The eleven stamps: `{ name, label, fill, cut, path }`. */
export const PROOF_ICONS = STAMPS;

const BY_NAME = new Map(PROOF_ICONS.map((entry) => [entry.name, entry]));

/** One of the eleven stamps by name, or null for any other id. */
export function stampByName(name) {
  return BY_NAME.get(name) ?? null;
}

/**
 * The symbol by name: a stamp with its drawing, or a glyph or model as
 * `{ name, label, kind }`. Null for a name this build does not know, since a spec
 * may name one a newer build added.
 */
export function iconByName(name) {
  const stamp = BY_NAME.get(name);
  if (stamp) return stamp;
  if (!isStampable(name)) return null;
  const entry = catalogEntry(name);
  return { name: entry.id, label: entry.label, kind: entry.kind };
}

/** Whether the symbol takes no stroke width, so the control hides for it. */
export function isSolidIcon(name) {
  return SOLID.has(name) || (!BY_NAME.has(name) && isStampable(name));
}

/** Anchor of the symbol within its box, in fractions of the side. */
export function iconAnchor(name) {
  return ANCHORS[name] ?? [0.5, 0.5];
}

/**
 * Top-left of the box, given the anchor point the shape stores.
 *
 * The shape keeps the point it names, not the corner it happens to occupy, so
 * resizing a pin leaves its tip where the analyst put it.
 */
export function iconOrigin(name, size) {
  const [ax, ay] = iconAnchor(name);
  return { x: -ax * size, y: -ay * size };
}

/**
 * Ink for the glyph over a badge disc of `discOpacity`.
 *
 * White on a solid disc, dark on a pale one, and the shape's own colour once the
 * disc is too sheer to carry either — a white glyph on a 20%-opaque disc is a
 * white glyph on whatever is underneath, which on aerial imagery is nothing.
 */
export function glyphInk(color, discOpacity) {
  if (!(discOpacity > 0.45)) return color;
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) return '#ffffff';
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#14161a' : '#ffffff';
}

/** The dark ring every free stamp wears, and the shade its carved details take. */
export const STAMP_HALO = 'rgba(0, 0, 0, 0.6)';
export const STAMP_CUT = 'rgba(0, 0, 0, 0.6)';

/** Box units of weight per unit of stroke width: 4, the old default, adds about half a unit. */
const WEIGHT_PER_STROKE = 0.12;
/** The halo's reach beyond the shape, in box units, and never under this many page pixels. */
const HALO_BOX = 0.85;
const HALO_MIN_PX = 1.2;

/** The stamp's weight in box units: what its stroke width adds round its outline. */
export function stampWeight(name, strokeWidth) {
  if (isSolidIcon(name)) return 0;
  const width = Number.isFinite(strokeWidth) ? strokeWidth : 4;
  return Math.max(0, width) * WEIGHT_PER_STROKE;
}

/**
 * What a stamp is drawn from, in its box's units, bottom first: each part a path
 * `d` with a `fill` (even-odd) and maybe a `stroke` of `width`.
 *
 * Over imagery: the halo, the silhouette in the stamp's colour thickened by its
 * weight, then the carved details in a dark shade. On a disc solid enough to carry
 * white (`disc` over 0.45): the silhouette alone in the disc's ink, its details
 * holes the disc shows through, as a map badge's are. `size` is the placed side in
 * page pixels, which keeps the halo visible on a small stamp.
 */
export function stampParts(name, { color = '#ff5252', disc = 0, strokeWidth, size = ICON_SIZE_DEFAULT } = {}) {
  const stamp = BY_NAME.get(name);
  if (!stamp) return [];
  const weight = stampWeight(name, strokeWidth);
  const ink = glyphInk(color, disc);
  if (disc > 0.45) return [{ d: stamp.path, fill: ink, stroke: weight ? ink : null, width: weight }];
  const halo = Math.max(HALO_BOX, (HALO_MIN_PX * ICON_BOX) / Math.max(size, 1));
  const parts = [
    { d: stamp.fill, fill: STAMP_HALO, stroke: STAMP_HALO, width: weight + 2 * halo },
    { d: stamp.fill, fill: ink, stroke: weight ? ink : null, width: weight },
  ];
  if (stamp.cut) parts.push({ d: stamp.cut, fill: STAMP_CUT });
  return parts;
}
