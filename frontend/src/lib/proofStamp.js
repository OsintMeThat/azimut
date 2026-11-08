/**
 * A proof stamp's drawing as Konva nodes, for the composer's `makeIconNode`.
 *
 * The composer keeps what a stamp is on the page (its group, its hit box, its drag
 * and resize); this module draws what is in it: the badge disc when the stamp has
 * a fill, then the symbol. Konva is handed in rather than imported, so the drawing
 * can be checked without a canvas.
 */
import { fillPaint } from './proofEdits.js';
import { ICON_BOX, ICON_SIZE_DEFAULT, stampParts } from './proofIcons.js';

/** The thin dark ring outside a disc, so a pale one holds over snow or sand. */
const DISC_HALO = 'rgba(0, 0, 0, 0.35)';

/**
 * The nodes that draw stamp `s` inside its group, in the surface's own pixels.
 * `size` is the box's side there and `scale` the surface's pixels per page pixel's
 * inverse (the side on the page is `size * scale`); `origin` is the box's top left.
 */
export function stampNodes(Konva, s, { size, scale = 1, origin }) {
  const placed = s.size ?? ICON_SIZE_DEFAULT;
  const nodes = [];
  const disc = s.fillOpacity ?? 0;
  const cx = origin.x + size / 2;
  const cy = origin.y + size / 2;
  if (disc > 0) {
    // The ring stays at full opacity so a sheer disc keeps an edge; without
    // it a badge at 30% has no silhouette left to read against the imagery.
    const ring = Math.max(placed * 0.035, 0.5) / scale;
    nodes.push(new Konva.Circle({
      x: cx, y: cy, radius: size / 2 + ring / 2 + 1 / scale, listening: false,
      stroke: DISC_HALO, strokeWidth: 2 / scale,
    }));
    nodes.push(new Konva.Circle({
      x: cx, y: cy, radius: size / 2, listening: false,
      fill: fillPaint(s.color, disc), stroke: s.color, strokeWidth: ring,
    }));
  }
  // the parts are in the box's units, so the path is scaled into the box and its
  // stroke widths scale with it: a bigger symbol is the same drawing, bigger
  const k = size / ICON_BOX;
  for (const part of stampParts(s.name, { color: s.color, disc, strokeWidth: s.strokeWidth, size: placed })) {
    nodes.push(new Konva.Path({
      data: part.d, x: origin.x, y: origin.y, scaleX: k, scaleY: k, listening: false,
      fill: part.fill, fillRule: 'evenodd',
      ...(part.stroke ? { stroke: part.stroke, strokeWidth: part.width, lineJoin: 'round', lineCap: 'round' } : {}),
    }));
  }
  return nodes;
}
