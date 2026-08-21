/**
 * The Graph, serialised as SVG.
 *
 * Konva draws the screen and cannot write a vector file, so this module walks the same
 * scene the canvas is built from — `placed`, the drawable links, the parallel bends —
 * and writes it out. It is a second *serialiser* over one set of coordinates, not a
 * second layout: nothing here decides where a node goes, so the file and the screen
 * cannot disagree about the drawing.
 *
 * What the plate deliberately leaves out: the cards, their photos and every mark that
 * belongs to working the graph — hover, selection, pins, folds in progress. A plate is
 * the reading, not the session. Dots and names is what the drawing looks like framed,
 * and a file carrying two hundred base64 thumbnails is not a file anybody opens twice.
 */

import {
  edgeMidpoint,
  edgePoints,
  edgeStyle,
  extent,
  nodeRadius,
  shortLabel,
} from './graph.js';
import {
  PLATE_COLOURS,
  familyColour,
  plateDocument,
  round,
  svgCircle,
  svgPath,
  svgText,
} from './plate.js';

/** Room around the drawing: a name is 140 wide under its dot, so the outer nodes need
 *  half of that on each side or the labels leave the page. */
export const PLATE_ROOM = { x: 76, top: 30, bottom: 34 };

/**
 * Past this many edges the verbs stop being written.
 *
 * On screen a verb appears when its edge is lit, so the picture is never a wall of
 * words. A plate has no pointer, so the choice is made once for the whole drawing:
 * under the limit every edge says what it says, and above it the strokes and the
 * legend carry the reading, which is what a dense case is legible as anyway.
 */
export const VERB_LIMIT = 60;

const ARROW = 'plate-arrow';

const ARROW_DEF =
  `<marker id="${ARROW}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5"`
  + ` markerHeight="5" orient="auto-start-reverse">`
  + `<path d="M 0 0 L 10 5 L 0 10 z" fill="${PLATE_COLOURS.label}" /></marker>`;

/**
 * The path an edge is drawn along, in plate coordinates.
 *
 * A straight edge is two points and a line. A bowed one is three, and the middle one
 * is a point the curve **passes through** — Konva's tension spline does — while a
 * quadratic's control point is one it only leans towards. So the control is pulled back
 * out of the midpoint (`2·mid − (start+end)/2`), which puts the curve back on it.
 */
export function edgeDefinition(points) {
  const at = (index) => round(points[index]);
  if (points.length < 6) return `M ${at(0)} ${at(1)} L ${at(2)} ${at(3)}`;
  const controlX = 2 * points[2] - (points[0] + points[4]) / 2;
  const controlY = 2 * points[3] - (points[1] + points[5]) / 2;
  return `M ${at(0)} ${at(1)} Q ${round(controlX)} ${round(controlY)} ${at(4)} ${at(5)}`;
}

/**
 * The drawing on its own, sized to what it holds.
 *
 * `hidden`, when given, is the set of nodes still on screen — the graph hides by
 * painting rather than by relaying out, so the plate applies the same rule the canvas
 * does: a node not in it is left out, and an edge survives only when both of its ends
 * do. A line running to a node that is not there reads as the case continuing off the
 * page when it does not.
 */
export function graphDrawing({
  placed = [],
  edges = [],
  bends = new Map(),
  byId = new Map(),
  hidden = null,
  chainTypes = [],
  verbOf = (link) => link.type,
  verbs = 'auto',
} = {}) {
  const kept = placed.filter((node) => !hidden || hidden.has(node.id));
  const positions = new Map(kept.map((node) => [node.id, node]));
  const drawable = edges.filter(
    (link) => positions.has(link.from) && positions.has(link.to),
  );
  const box = extent(kept);
  const radiusOf = (id) => nodeRadius(byId.get(id)?.degree);
  const widest = kept.reduce((most, node) => Math.max(most, radiusOf(node.id)), 0);
  const width = Math.max(1, box.maxX - box.minX) + PLATE_ROOM.x * 2;
  // The bottom edge carries the widest dot *and* the name hanging under it, which is
  // the one side of the drawing that is taller than the nodes themselves.
  const height =
    Math.max(1, box.maxY - box.minY) + PLATE_ROOM.top + widest + PLATE_ROOM.bottom;
  const shift = (node) => ({
    x: node.x - box.minX + PLATE_ROOM.x,
    y: node.y - box.minY + PLATE_ROOM.top,
  });
  const named = verbs === true || (verbs === 'auto' && drawable.length <= VERB_LIMIT);

  const wires = [];
  const words = [];
  for (const link of drawable) {
    const from = shift(positions.get(link.from));
    const to = shift(positions.get(link.to));
    const style = edgeStyle(link, chainTypes);
    const points = edgePoints(
      from, to, radiusOf(link.from), radiusOf(link.to), bends.get(link.id) ?? 0,
    );
    wires.push(svgPath(edgeDefinition(points), {
      stroke: PLATE_COLOURS.label,
      width: style.width ?? 1.3,
      dash: (style.dash ?? []).join(' ') || undefined,
      marker: `url(#${ARROW})`,
      opacity: 0.85,
    }));
    if (!named) continue;
    const verb = String(verbOf(link) ?? '').trim();
    if (!verb) continue;
    const at = edgeMidpoint(points, 9);
    words.push(svgText(verb, {
      x: at.x, y: at.y, size: 9, anchor: 'middle', fill: PLATE_COLOURS.hint, halo: 2.5,
    }));
  }

  const dots = [];
  const names = [];
  for (const node of kept) {
    const data = byId.get(node.id) ?? {};
    const at = shift(node);
    const radius = radiusOf(node.id);
    dots.push(svgCircle({
      x: at.x, y: at.y, r: radius,
      fill: familyColour(data.family),
      stroke: PLATE_COLOURS.paper,
      strokeWidth: 1.5,
      // A proposal is drawn as one everywhere it appears (ONTOLOGY §4).
      ...(data.status === 'suggested' ? { dash: '3 3' } : {}),
    }));
    names.push(svgText(shortLabel(data.label ?? node.id), {
      // Konva places a text box by its top; SVG by its baseline, hence the drop.
      x: at.x, y: at.y + radius + 14, size: 11, anchor: 'middle',
      fill: PLATE_COLOURS.label, halo: 3,
    }));
  }

  return {
    defs: ARROW_DEF,
    // Edges first, then their words, then the nodes: the same order the canvas draws
    // in, so a dot always covers the line that reaches it.
    body: [...wires, ...words, ...dots, ...names].filter(Boolean).join('\n'),
    width: Math.round(width),
    height: Math.round(height),
    nodes: kept.length,
    links: drawable.length,
    verbsDrawn: named,
  };
}

/**
 * The whole plate: the drawing under its header, above its legend.
 *
 * The header states what the drawing holds, because the reader cannot count dots and has
 * no way of telling an absence of verbs from a density that dropped them.
 */
export function graphPlate({ meta = {}, families = [], strokes = [], ...scene } = {}) {
  const drawing = graphDrawing(scene);
  const tally = [
    `${drawing.nodes} node${drawing.nodes === 1 ? '' : 's'}`,
    `${drawing.links} link${drawing.links === 1 ? '' : 's'}`,
    drawing.verbsDrawn ? '' : 'verbs left off at this density',
  ].filter(Boolean).join(' · ');
  return {
    ...plateDocument({ meta: { ...meta, tally }, families, strokes, drawing }),
    drawing,
  };
}
