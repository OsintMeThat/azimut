/**
 * The symbols a proof can stamp onto a panel.
 *
 * These are document content, not interface furniture, which is why they live
 * here and not in `Icon.svelte`: one is drawn into the exported picture and has
 * to survive a save, the other only ever decorates a button. They share a
 * geometry — a 24×24 box, stroke-based, round caps — so a symbol reads as part
 * of the same drawing as the boxes and arrows beside it.
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

/** Side of the box every path is drawn in. */
export const ICON_BOX = 24;

/** Placed side, in screen pixels at panel scale 1 — see `iconSizeFor`. */
export const ICON_SIZE_DEFAULT = 56;

export const ICON_SIZE_MIN = 12;

/**
 * Solid symbols carry no stroke: their shape *is* the mark. A pin outlined at
 * 1px vanishes over noisy imagery, and a burst reads as a burst only when it is
 * filled. They ignore the stroke-width control, which is why it hides for them
 * rather than sitting there doing nothing.
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

export const PROOF_ICONS = [
  {
    name: 'point',
    label: 'Point',
    path: 'M12 22.4s7.3-7.2 7.3-12.1a7.3 7.3 0 0 0-14.6 0C4.7 15.2 12 22.4 12 22.4Zm0-9.2a2.9 2.9 0 1 0 0-5.8 2.9 2.9 0 0 0 0 5.8Z',
  },
  {
    name: 'impact',
    label: 'Impact',
    path: 'M12 1.5 13.8 7.6 17.7 6.3 16.4 10.2 22 12 16.4 13.8 18.2 18.2 13.8 16.4 12 22.5 10.2 16.4 6.2 17.8 7.6 13.8 2.4 12 7.6 10.2 5.9 5.9 10.2 7.6Z',
  },
  {
    name: 'vehicle',
    label: 'Vehicle',
    path: 'M2.3 16.4v-2.9a1 1 0 0 1 .7-1l3.4-.9 2.5-3.3a1.5 1.5 0 0 1 1.2-.6h4.2a1.5 1.5 0 0 1 1.1.5l3 3.4 3.4.9a1 1 0 0 1 .7 1v2.9M2.3 16.4h2.5M9.2 16.4h5.6M19.2 16.4h3.3M4.8 17.2a2.2 2.2 0 1 0 4.4 0 2.2 2.2 0 0 0-4.4 0Zm10 0a2.2 2.2 0 1 0 4.4 0 2.2 2.2 0 0 0-4.4 0Z',
  },
  {
    name: 'truck',
    label: 'Truck',
    path: 'M7.4 15.5V6a.8.8 0 0 1 .8-.8h13.2a.8.8 0 0 1 .8.8v9.5M7.4 8.1H4.75a1 1 0 0 0-.75.34L1.35 10.84a1 1 0 0 0-.25.66v3.2a.8.8 0 0 0 .8.8h.7M6.6 15.5h8.9M19.5 15.5h2.7M2.6 16.6a2 2 0 1 0 4 0 2 2 0 0 0-4 0Zm12.9 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z',
  },
  {
    name: 'tank',
    label: 'Tank',
    path: 'M4.3 15.4h15.4a2.1 2.1 0 1 1 0 4.2H4.3a2.1 2.1 0 1 1 0-4.2ZM7.3 17.5h.01M12 17.5h.01M16.7 17.5h.01M2.9 15.4v-2.6a.9.9 0 0 1 .6-.85l2.8-.95h13.4a.9.9 0 0 1 .9.9v3.5M9 11V9a1 1 0 0 1 1-1h4.6a1 1 0 0 1 1 1v2M9 9.4H2.4',
  },
  {
    name: 'person',
    label: 'Person',
    path: 'M12 2a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8ZM12 6.8v7.2M12 9.2 7.9 12.2M12 9.2l4.1 3M12 14 8.7 21.4M12 14l3.3 7.4',
  },
  {
    name: 'building',
    label: 'Building',
    path: 'M5.2 20.5V4.3a.9.9 0 0 1 .9-.9h11.8a.9.9 0 0 1 .9.9v16.2M3.6 20.5h16.8M8.2 7.3h1.9M13.9 7.3h1.9M8.2 11.1h1.9M13.9 11.1h1.9M10.1 20.5v-4.3h3.8v4.3',
  },
  {
    name: 'drone',
    label: 'Drone',
    path: 'M9.2 10.4h5.6a.6.6 0 0 1 .6.6v2a.6.6 0 0 1-.6.6H9.2a.6.6 0 0 1-.6-.6v-2a.6.6 0 0 1 .6-.6ZM8.6 10.4 7 7.8M15.4 10.4 17 7.8M8.6 13.6 7 16.2M15.4 13.6 17 16.2M5.6 3a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2Zm12.8 0a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2ZM5.6 15.8a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2Zm12.8 0a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2Z',
  },
  {
    name: 'camera',
    label: 'Camera',
    path: 'M3.2 8.4h4.2l1.6-2.8h6l1.6 2.8h4.2a1 1 0 0 1 1 1v9.6a1 1 0 0 1-1 1H3.2a1 1 0 0 1-1-1V9.4a1 1 0 0 1 1-1ZM12 10.1a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z',
  },
  {
    name: 'antenna',
    label: 'Antenna',
    path: 'M12 5.2a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4ZM9 21 11.4 7.6M15 21 12.6 7.6M9.7 17h4.6M10.4 13h3.2M7.8 21h8.4M9.9 4.3a3 3 0 0 0 0 4.2M14.1 4.3a3 3 0 0 1 0 4.2M8.2 2.6a5.4 5.4 0 0 0 0 7.6M15.8 2.6a5.4 5.4 0 0 1 0 7.6',
  },
  {
    // Two-tone needle: the whole silhouette filled, the left half punched back
    // out with the even-odd rule, which is how a compass rose reads north.
    name: 'nord',
    label: 'North',
    path: 'M12 2 16.7 20.4 12 17 7.3 20.4ZM11.85 5.2 9 17.6 11.85 15.2Z',
  },
];

const BY_NAME = new Map(PROOF_ICONS.map((entry) => [entry.name, entry]));

/** The symbol by name, or null — a spec may name one this build dropped. */
export function iconByName(name) {
  return BY_NAME.get(name) ?? null;
}

/** Whether the symbol is a filled silhouette, so has no stroke to set. */
export function isSolidIcon(name) {
  return SOLID.has(name);
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

/** Box a placed symbol covers, in the surface's natural pixels. */
export function iconBox(shape) {
  const size = shape.size ?? ICON_SIZE_DEFAULT;
  const origin = iconOrigin(shape.name, size);
  return { x: (shape.x ?? 0) + origin.x, y: (shape.y ?? 0) + origin.y, w: size, h: size };
}

/**
 * Placed side in natural pixels, so a symbol reads the same on a 4000px frame
 * and an 800px one. Mirrors how stroke width is normalised by `baseScale`.
 */
export function iconSizeFor(baseScale) {
  return ICON_SIZE_DEFAULT / (baseScale || 1);
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
