/**
 * A proof stamp's drawing as Konva nodes, for the composer's `makeIconNode`.
 *
 * The composer keeps what a stamp is on the page (its group, its hit box, its drag
 * and resize); this module draws what is in it: the badge disc when the stamp has
 * a fill, then the symbol, which is one of the eleven stamps, a layer badge's glyph
 * or a vehicle model. Konva is handed in rather than imported, so the drawing can be
 * checked without a canvas.
 */
import { isModel } from './icons/catalog.js';
import { BADGE_GLYPHS } from './map/markerGlyphs.js';
import { fillPaint } from './proofEdits.js';
import {
  ICON_BOX, ICON_SIZE_DEFAULT, STAMP_CUT, STAMP_HALO, glyphInk, stampByName, stampHalo, stampParts,
} from './proofIcons.js';
import { modelNode } from './proofModelNode.js';

/** The thin dark ring outside a disc, so a pale one holds over snow or sand. */
const DISC_HALO = 'rgba(0, 0, 0, 0.35)';
/** A symbol's share of its disc: filling the box, its corners would stand outside the circle. */
const IN_DISC = 0.76;
/** The pin keeps its whole box on a disc, or its tip would leave the point it names. */
const inDisc = (name) => (name === 'point' ? 1 : IN_DISC);

/** A glyph's stroke widths where a layer's options give none, as a map badge draws them. */
const GLYPH_LINE = 2.2;
const GLYPH_CUT = 1.3;

/**
 * What a layer badge's glyph is drawn from, in its 24-unit box, bottom first.
 *
 * On a disc it is the map badge: the glyph in the disc's ink, its cuts in the disc's
 * colour. Free over imagery the glyph takes the stamp's colour over a dark halo, and
 * its cuts the same dark shade a stamp's carved details take.
 */
export function glyphOps(name, { color = '#ff5252', disc = 0, size = ICON_SIZE_DEFAULT } = {}) {
  const layers = BADGE_GLYPHS[name];
  if (!layers) return [];
  const onDisc = disc > 0.45;
  const ink = glyphInk(color, disc);
  const cut = onDisc ? color : STAMP_CUT;
  const ops = [];
  if (!onDisc) {
    const halo = stampHalo(size);
    for (const [mode, d, { width, rotate = 0 } = {}] of layers) {
      if (mode === 'fill') ops.push({ d, fill: STAMP_HALO, stroke: STAMP_HALO, width: 2 * halo, rotate });
      else if (mode === 'line') ops.push({ d, stroke: STAMP_HALO, width: (width ?? GLYPH_LINE) + 2 * halo, rotate });
    }
  }
  for (const [mode, d, { width, rotate = 0 } = {}] of layers) {
    if (mode === 'fill') ops.push({ d, fill: ink, rotate });
    else if (mode === 'cut') ops.push({ d, fill: cut, rotate });
    else if (mode === 'line') ops.push({ d, stroke: ink, width: width ?? GLYPH_LINE, rotate });
    else ops.push({ d, stroke: cut, width: width ?? GLYPH_CUT, rotate });
  }
  return ops;
}

const parsed = new Map();
const path2d = (d) => {
  let path = parsed.get(d);
  if (!path) parsed.set(d, (path = new Path2D(d)));
  return path;
};

/** Paints a glyph's operations into a context already scaled to its 24-unit box. */
export function paintGlyph(ctx, ops) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const op of ops) {
    ctx.save();
    if (op.rotate) {
      ctx.translate(12, 12);
      ctx.rotate((op.rotate * Math.PI) / 180);
      ctx.translate(-12, -12);
    }
    const path = path2d(op.d);
    if (op.stroke) {
      ctx.strokeStyle = op.stroke;
      ctx.lineWidth = op.width;
      ctx.stroke(path);
    }
    if (op.fill) {
      ctx.fillStyle = op.fill;
      ctx.fill(path);
    }
    ctx.restore();
  }
}

/**
 * The nodes that draw stamp `s` inside its group, in the surface's own pixels.
 * `size` is the box's side there and `scale` the surface's zoom (the side on the
 * page is `size * scale`); `origin` is the box's top left.
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
  if (isModel(s.name)) {
    nodes.push(modelNode(Konva, s, { size, scale, origin, disc }));
    return nodes;
  }
  // Drawn in the box's own units and scaled into it, so a bigger symbol is the same
  // drawing, bigger. On a disc it is drawn smaller, about the disc's middle.
  const fit = disc > 0 ? inDisc(s.name) : 1;
  const k = (size * fit) / ICON_BOX;
  const x = cx - 12 * k;
  const y = cy - 12 * k;
  if (stampByName(s.name)) {
    for (const part of stampParts(s.name, { color: s.color, disc, strokeWidth: s.strokeWidth, size: placed })) {
      nodes.push(new Konva.Path({
        data: part.d, x, y, scaleX: k, scaleY: k, listening: false,
        fill: part.fill, fillRule: 'evenodd',
        ...(part.stroke ? { stroke: part.stroke, strokeWidth: part.width, lineJoin: 'round', lineCap: 'round' } : {}),
      }));
    }
    return nodes;
  }
  const ops = glyphOps(s.name, { color: s.color, disc, size: placed });
  if (ops.length) {
    nodes.push(new Konva.Shape({
      x, y, listening: false,
      sceneFunc(context) {
        const ctx = context._context;
        ctx.save();
        ctx.scale(k, k);
        paintGlyph(ctx, ops);
        ctx.restore();
      },
    }));
  }
  return nodes;
}
