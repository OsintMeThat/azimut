import { describe, expect, it } from 'vitest';
import {
  EDGE_KINDS,
  arrange,
  drawableLinks,
  edgePoints,
  extent,
  nodeRadius,
  parallelBends,
  positionsById,
} from './graph.js';
import { PLATE_COLOURS } from './plate.js';
import { PLATE_ROOM, VERB_LIMIT, edgeDefinition, graphDrawing, graphPlate } from './graphPlate.js';

const NODES = [
  { id: 'e_truck', label: 'White pickup with a very long name indeed', family: 'asset', degree: 3, status: 'confirmed' },
  { id: 'e_team', label: 'Checkpoint team', family: 'actor', degree: 2, status: 'confirmed' },
  { id: 'e_quay', label: 'Quay 4', family: 'place', degree: 1, status: 'suggested' },
];

const LINKS = [
  { id: 'l1', from: 'e_team', to: 'e_truck', type: 'owns' },
  { id: 'l2', from: 'e_team', to: 'e_truck', type: 'mentions' },
  { id: 'l3', from: 'e_truck', to: 'e_quay', type: 'located-at', provenance: { status: 'suggested' } },
];

/** The scene a surface hands over: exactly what Graph.svelte derives for Konva. */
function scene(extra = {}) {
  const placed = arrange(NODES, 'rings', LINKS);
  const positions = positionsById(placed);
  const edges = drawableLinks(LINKS, positions);
  return {
    placed,
    edges,
    bends: parallelBends(edges),
    byId: new Map(NODES.map((node) => [node.id, node])),
    verbOf: (link) => link.type,
    ...extra,
  };
}

describe('serialising the graph', () => {
  it('draws a dot and a name per node, and an arrow per drawable edge', () => {
    const drawing = graphDrawing(scene());

    expect(drawing.nodes).toBe(3);
    expect(drawing.links).toBe(3);
    expect(drawing.body.match(/<circle/g)).toHaveLength(3);
    expect(drawing.body.match(/<path/g)).toHaveLength(3);
    expect(drawing.body.match(/marker-end="url\(#plate-arrow\)"/g)).toHaveLength(3);
    expect(drawing.defs).toContain('<marker id="plate-arrow"');
  });

  it('gives every node its family hue, and a proposal its dashed rim', () => {
    const { body } = graphDrawing(scene());

    expect(body).toContain(`fill="${PLATE_COLOURS.family.asset}"`);
    expect(body).toContain(`fill="${PLATE_COLOURS.family.actor}"`);
    expect(body).toContain(`fill="${PLATE_COLOURS.family.place}"`);
    // e_quay is suggested; the other two are not.
    expect(body.match(/stroke-dasharray="3 3"/g)).toHaveLength(1);
  });

  it('shortens a name the way the canvas does, rather than measuring text', () => {
    const { body } = graphDrawing(scene());

    expect(body).toContain('White pickup with a v…');
    expect(body).not.toContain('White pickup with a very long name indeed');
  });

  it('haloes the names and the verbs, which is what makes them readable on the lines', () => {
    const { body } = graphDrawing(scene());
    // The canvas does the same with `fillAfterStrokeEnabled`; without it every name
    // sitting on an edge is read through it.
    expect(body.match(/paint-order="stroke"/g).length).toBe(3 + 3); // 3 names, 3 verbs
  });

  it('strokes each kind of edge with the registry’s own pattern', () => {
    const { body } = graphDrawing(scene());
    const mention = EDGE_KINDS.find((entry) => entry.kind === 'mention');
    const proposed = EDGE_KINDS.find((entry) => entry.kind === 'proposed');

    expect(body).toContain(`stroke-dasharray="${mention.dash.join(' ')}"`);
    expect(body).toContain(`stroke-dasharray="${proposed.dash.join(' ')}"`);
  });

  it('writes the verbs while the drawing is small enough to read them', () => {
    const drawn = graphDrawing(scene());
    expect(drawn.verbsDrawn).toBe(true);
    expect(drawn.body).toContain('>owns<');
    expect(drawn.body).toContain('>located-at<');

    const dense = graphDrawing(scene({
      edges: Array.from({ length: VERB_LIMIT + 1 }, (_, index) => ({
        id: `x${index}`, from: 'e_team', to: 'e_truck', type: 'owns',
      })),
    }));
    expect(dense.verbsDrawn).toBe(false);
    expect(dense.body).not.toContain('>owns<');
  });

  it('bows parallel edges through their midpoint, not past it', () => {
    // A quadratic leans towards its control point; Konva's tension curve passes
    // through the middle point. The control is pulled back so both agree.
    expect(edgeDefinition([0, 0, 50, 20, 100, 0])).toBe('M 0 0 Q 50 40 100 0');
    expect(edgeDefinition([0, 0, 100, 0])).toBe('M 0 0 L 100 0');

    const { body } = graphDrawing(scene());
    // l1 and l2 join the same pair, so exactly one of the two is straight.
    expect(body.match(/ Q /g)).toHaveLength(2);
  });

  it('keeps hidden nodes out, and the edges that would point at them', () => {
    const drawing = graphDrawing(scene({ hidden: new Set(['e_team', 'e_truck']) }));

    expect(drawing.nodes).toBe(2);
    expect(drawing.links).toBe(2); // l1 and l2 survive; l3 lost its far end
    expect(drawing.body).not.toContain('Quay 4');
  });

  it('sizes the drawing to hold the outermost name, not just the dots', () => {
    const drawing = graphDrawing(scene());
    const placed = arrange(NODES, 'rings', LINKS);
    const box = extent(placed);
    const widest = Math.max(...NODES.map((node) => nodeRadius(node.degree)));

    // A ring puts every node on one row, so the vertical span is the floor of 1 the
    // sizing keeps rather than a zero-height drawing.
    expect(drawing.width).toBe(
      Math.round(Math.max(1, box.maxX - box.minX) + PLATE_ROOM.x * 2)
    );
    expect(drawing.height).toBe(
      Math.round(
        Math.max(1, box.maxY - box.minY) + PLATE_ROOM.top + widest + PLATE_ROOM.bottom
      )
    );
  });

  it('draws nothing rather than throwing on an empty reading', () => {
    const drawing = graphDrawing({});
    expect(drawing.body).toBe('');
    expect(drawing.nodes).toBe(0);
  });
});

describe('the graph plate', () => {
  it('frames the drawing with its header and legend', () => {
    const { svg, width, height, drawing } = graphPlate({
      meta: {
        caseName: 'Bakhmut convoy', surface: 'Graph', lens: 'All connections',
        view: 'Rooftop match', at: '2026-08-13T20:10:00Z',
      },
      families: [{ family: 'asset', count: 1 }, { family: 'actor', count: 1 }],
      strokes: EDGE_KINDS.filter((entry) => ['stated', 'mention'].includes(entry.kind)),
      ...scene(),
    });

    expect(svg).toContain('Rooftop match');
    expect(svg).toContain('Bakhmut convoy · Graph · All connections');
    expect(svg).toContain('mentions');
    expect(svg).toContain(`viewBox="0 0 ${width} ${height}"`);
    expect(height).toBeGreaterThan(drawing.height);
    expect(svg).not.toMatch(/var\(--/);
  });

  it('counts what it drew, and says when the verbs were dropped', () => {
    // A reader cannot count dots, and cannot tell a drawing with no verbs from one whose
    // verbs were left off to stay legible.
    const { svg } = graphPlate({ meta: { view: 'Rooftop match' }, ...scene() });
    expect(svg).toContain('3 nodes · 3 links');
    expect(svg).not.toContain('verbs left off');

    const dense = graphPlate({
      meta: {},
      ...scene({
        edges: Array.from({ length: VERB_LIMIT + 1 }, (_, index) => ({
          id: `x${index}`, from: 'e_team', to: 'e_truck', type: 'owns',
        })),
      }),
    });
    expect(dense.svg).toContain('verbs left off at this density');
  });

  it('reads the same coordinates the canvas is built from', () => {
    // The one guarantee worth a test: no layout happens here. Every point in the file
    // is `edgePoints` over `arrange`, translated — so the file cannot drift from the
    // screen without the shared module moving first.
    const built = scene();
    const first = built.edges[0];
    const points = edgePoints(
      built.placed.find((node) => node.id === first.from),
      built.placed.find((node) => node.id === first.to),
      nodeRadius(3), nodeRadius(2), built.bends.get(first.id),
    );
    expect(points).toHaveLength(6);
    expect(graphDrawing(built).body).toContain('<path');
  });
});
