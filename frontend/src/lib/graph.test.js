import { describe, it, expect } from 'vitest';
import {
  CARD,
  arrangementDiff,
  drawingSnapshot,
  nodeAt,
  CARD_SCALE,
  CARD_GROWTH,
  EDGE_KINDS,
  arrange,
  boxRadius,
  cardFactor,
  cropToFill,
  arrangeClusters,
  arrangeHops,
  arrangeRings,
  drawableLinks,
  edgeKind,
  edgeMidpoint,
  edgePoints,
  edgeStyle,
  foldAway,
  foldableCount,
  extent,
  familyRank,
  fit,
  nodeRadius,
  parallelBends,
  positionsById,
  ringOrder,
  ringsAround,
  shortLabel,
} from './graph.js';

const node = (id, family, degree = 0, label = id) => ({ id, family, degree, label });

describe('ring order', () => {
  it('puts the most connected first', () => {
    const order = ringOrder([node('a', 'actor', 1), node('b', 'actor', 9)]);
    expect(order.map((n) => n.id)).toEqual(['b', 'a']);
  });

  it('breaks ties on label then id, so equal degrees never shuffle', () => {
    // The layout is only reproducible if ties are broken by something stable.
    // Degree alone ties constantly on a real case.
    const shuffled = [
      { id: 'z', family: 'actor', degree: 2, label: 'Bravo' },
      { id: 'a', family: 'actor', degree: 2, label: 'Alpha' },
    ];
    expect(ringOrder(shuffled).map((n) => n.id)).toEqual(['a', 'z']);
    expect(ringOrder([...shuffled].reverse()).map((n) => n.id)).toEqual(['a', 'z']);
  });
});

describe('ring layout', () => {
  it('draws the same picture for the same payload', () => {
    const nodes = [node('a', 'actor', 3), node('b', 'place', 1), node('c', 'actor', 2)];
    expect(arrangeRings(nodes)).toEqual(arrangeRings(nodes));
  });

  it('does not move a node when the server returns the set in another order', () => {
    const nodes = [node('a', 'actor', 3), node('b', 'actor', 1), node('c', 'actor', 2)];
    const first = positionsById(arrangeRings(nodes));
    const second = positionsById(arrangeRings([...nodes].reverse()));
    for (const id of ['a', 'b', 'c']) {
      expect(second.get(id).x).toBeCloseTo(first.get(id).x, 10);
      expect(second.get(id).y).toBeCloseTo(first.get(id).y, 10);
    }
  });

  it('gives each family its own ring, innermost by family order', () => {
    const placed = positionsById(
      arrangeRings([node('a', 'actor'), node('b', 'claim'), node('c', 'place')]),
    );
    expect(placed.get('a').ring).toBeLessThan(placed.get('c').ring);
    expect(placed.get('c').ring).toBeLessThan(placed.get('b').ring);
  });

  it('takes no ring for a family the case does not hold', () => {
    // A small case must draw compactly, not as the skeleton of a large one.
    const one = arrangeRings([node('a', 'claim')]);
    expect(one).toHaveLength(1);
    expect(one[0].ring).toBeLessThan(400);
  });

  it('widens a ring so a crowded family does not overlap the next', () => {
    const crowded = Array.from({ length: 60 }, (_, i) => node(`a${i}`, 'actor'));
    const placed = positionsById(arrangeRings([...crowded, node('p', 'place')]));
    expect(placed.get('p').ring).toBeGreaterThan(placed.get('a0').ring);
  });

  it('files an unknown family outside the ones the ontology names', () => {
    expect(familyRank('actor')).toBeLessThan(familyRank('made-up'));
  });

  it('rings a model beside the objects it classifies, not out with the documents', () => {
    // `class` is read with who and what: a T-72B3 belongs next to the tanks that
    // are one, not out past the material that shows them.
    expect(familyRank('class')).toBeLessThan(familyRank('collected'));
    expect(familyRank('asset')).toBeLessThan(familyRank('class'));
  });
});

describe('hop layout', () => {
  const hood = [
    { id: 'root', family: 'actor', degree: 4, label: 'Root', hop: 0 },
    { id: 'n1', family: 'organization', degree: 2, label: 'One', hop: 1 },
    { id: 'n2', family: 'actor', degree: 1, label: 'Two', hop: 1 },
    { id: 'far', family: 'place', degree: 1, label: 'Far', hop: 2 },
  ];

  it('gives distance from the root the horizontal axis', () => {
    const placed = positionsById(arrangeHops(hood));
    expect(placed.get('root').x).toBeLessThan(placed.get('n1').x);
    expect(placed.get('n1').x).toBeLessThan(placed.get('far').x);
  });

  it('puts one hop in one column', () => {
    const placed = positionsById(arrangeHops(hood));
    expect(placed.get('n1').x).toBe(placed.get('n2').x);
    expect(placed.get('n1').y).not.toBe(placed.get('n2').y);
  });

  it('centres a column on the axis', () => {
    const placed = arrangeHops(hood).filter((n) => n.hop === 1);
    const mid = placed.reduce((sum, n) => sum + n.y, 0) / placed.length;
    expect(mid).toBeCloseTo(0, 10);
  });

  it('is reproducible like the rings are', () => {
    expect(arrangeHops(hood)).toEqual(arrangeHops([...hood].reverse()));
  });

  it('treats a node with no hop as the root column', () => {
    expect(arrangeHops([node('a', 'actor')])[0].x).toBe(0);
  });
});

describe('cluster layout', () => {
  /** A dumbbell: two triangles joined by one edge, plus a node nothing touches. */
  const dumbbell = {
    nodes: [
      node('a1', 'actor', 3),
      node('a2', 'actor', 2),
      node('a3', 'actor', 2),
      node('b1', 'place', 3),
      node('b2', 'place', 2),
      node('b3', 'place', 2),
      node('lonely', 'document', 0),
    ],
    links: [
      { id: 'l1', from: 'a1', to: 'a2' },
      { id: 'l2', from: 'a2', to: 'a3' },
      { id: 'l3', from: 'a3', to: 'a1' },
      { id: 'l4', from: 'b1', to: 'b2' },
      { id: 'l5', from: 'b2', to: 'b3' },
      { id: 'l6', from: 'b3', to: 'b1' },
      { id: 'bridge', from: 'a1', to: 'b1' },
    ],
  };

  const spread = (placed) => {
    const at = positionsById(placed);
    return (from, to) => Math.hypot(at.get(from).x - at.get(to).x, at.get(from).y - at.get(to).y);
  };

  it('draws the same picture for the same payload, twice over', () => {
    // The whole reason a simulation is allowed here: fixed seed, fixed pass count,
    // no clock and no random number, so the screenshot in a report is reproducible.
    expect(arrangeClusters(dumbbell.nodes, dumbbell.links)).toEqual(
      arrangeClusters(dumbbell.nodes, dumbbell.links),
    );
  });

  it('does not move a node when the server returns the set in another order', () => {
    // Exactly, not nearly. The relaxation sums a force per node in index order and
    // floating-point addition is not associative, so "close enough" here would mean
    // the indices still came from the response — and a fraction of a pixel at pass
    // one is a visible drift by pass three hundred.
    expect(arrangeClusters([...dumbbell.nodes].reverse(), [...dumbbell.links].reverse())).toEqual(
      arrangeClusters(dumbbell.nodes, dumbbell.links),
    );
  });

  it('puts what is connected together and what is not apart', () => {
    // This is the whole claim of the layout: position means connectivity. A ring
    // seed alone put every node the same distance from every other one, which is
    // a picture with no structure in it.
    const gap = spread(arrangeClusters(dumbbell.nodes, dumbbell.links));
    expect(gap('a1', 'a2')).toBeLessThan(gap('a2', 'b2'));
    expect(gap('b1', 'b2')).toBeLessThan(gap('a3', 'b3'));
  });

  it('leaves the hubs nearer the middle than their own satellites', () => {
    const at = positionsById(arrangeClusters(dumbbell.nodes, dumbbell.links));
    const from = (id) => Math.hypot(at.get(id).x, at.get(id).y);
    expect(from('a1')).toBeLessThan(from('a2'));
    expect(from('b1')).toBeLessThan(from('b2'));
  });

  it('parks what nothing connects to instead of mixing it into the cloud', () => {
    const at = positionsById(arrangeClusters(dumbbell.nodes, dumbbell.links));
    expect(at.get('lonely').parked).toBe(true);
    expect(at.get('lonely').x).toBeGreaterThan(at.get('a1').x);
    expect(at.get('a1').parked).toBeUndefined();
  });

  it('parks a case that holds nothing but unconnected nodes', () => {
    const placed = arrangeClusters([node('a', 'actor'), node('b', 'place')], []);
    expect(placed.every((seat) => seat.parked)).toBe(true);
    expect(placed).toHaveLength(2);
  });

  it('places every node it was given, links or not', () => {
    const placed = arrangeClusters(dumbbell.nodes, dumbbell.links);
    expect(placed.map((seat) => seat.id).sort()).toEqual(
      dumbbell.nodes.map((n) => n.id).sort(),
    );
    expect(placed.every((seat) => Number.isFinite(seat.x) && Number.isFinite(seat.y))).toBe(true);
  });

  it('ignores an edge whose end it was not given', () => {
    const placed = arrangeClusters([node('a', 'actor', 1)], [{ id: 'l', from: 'a', to: 'gone' }]);
    expect(placed).toHaveLength(1);
    expect(Number.isFinite(placed[0].x)).toBe(true);
  });
});

describe('a node the analyst placed', () => {
  /** The dumbbell again, with one hub dropped somewhere the layout would not put it. */
  const pinnedAt = (id, x, y, nodes) =>
    nodes.map((entry) => (entry.id === id ? { ...entry, pin: [x, y] } : entry));

  const dumbbell = {
    nodes: [
      node('a1', 'actor', 3),
      node('a2', 'actor', 2),
      node('a3', 'actor', 2),
      node('b1', 'place', 3),
      node('b2', 'place', 2),
      node('b3', 'place', 2),
      node('lonely', 'document', 0),
    ],
    links: [
      { id: 'l1', from: 'a1', to: 'a2' },
      { id: 'l2', from: 'a2', to: 'a3' },
      { id: 'l3', from: 'a3', to: 'a1' },
      { id: 'l4', from: 'b1', to: 'b2' },
      { id: 'l5', from: 'b2', to: 'b3' },
      { id: 'l6', from: 'b3', to: 'b1' },
      { id: 'bridge', from: 'a1', to: 'b1' },
    ],
  };

  it('stays exactly where it was put, not approximately', () => {
    // An anchor that drifted by a few pixels would make every drag feel broken.
    const nodes = pinnedAt('a1', -900, 400, dumbbell.nodes);
    const at = positionsById(arrangeClusters(nodes, dumbbell.links));
    expect(at.get('a1').x).toBe(-900);
    expect(at.get('a1').y).toBe(400);
    expect(at.get('a1').pinned).toBe(true);
  });

  it('reads a drag that has not reached the server yet, and prefers it', () => {
    // The local map is the more recent statement of the same thing.
    const nodes = pinnedAt('a1', -900, 400, dumbbell.nodes);
    const at = positionsById(
      arrangeClusters(nodes, dumbbell.links, new Map([['a1', { x: 50, y: 60 }]])),
    );
    expect([at.get('a1').x, at.get('a1').y]).toEqual([50, 60]);
  });

  it('pulls its own neighbours over to it instead of leaving them behind', () => {
    // The point of an anchor: it still pushes and pulls, so the cluster follows the
    // node that was moved rather than staying where the relaxation had put it.
    const loose = positionsById(arrangeClusters(dumbbell.nodes, dumbbell.links));
    const nodes = pinnedAt('a1', -2000, 0, dumbbell.nodes);
    const anchored = positionsById(arrangeClusters(nodes, dumbbell.links));
    expect(anchored.get('a2').x).toBeLessThan(loose.get('a2').x);
    expect(anchored.get('a3').x).toBeLessThan(loose.get('a3').x);
  });

  it('leaves a node nobody moved to the layout', () => {
    const nodes = pinnedAt('a1', -900, 400, dumbbell.nodes);
    expect(positionsById(arrangeClusters(nodes, dumbbell.links)).get('a2').pinned)
      .toBeUndefined();
  });

  it('draws the same picture for the same payload and the same pins', () => {
    const nodes = pinnedAt('b1', 300, -150, dumbbell.nodes);
    expect(arrangeClusters(nodes, dumbbell.links)).toEqual(
      arrangeClusters(nodes, dumbbell.links),
    );
  });

  it('keeps a hand-placed node out of the parked column, whatever its degree', () => {
    // Somebody chose where it goes. The park is for what nothing has been decided
    // about, and a caption saying "nothing connects to these" over a node the
    // analyst deliberately placed would be a lie about their own work.
    const nodes = pinnedAt('lonely', 88, 99, dumbbell.nodes);
    const at = positionsById(arrangeClusters(nodes, dumbbell.links));
    expect([at.get('lonely').x, at.get('lonely').y]).toEqual([88, 99]);
    expect(at.get('lonely').parked).toBeUndefined();
  });

  it('pulls new arrivals towards the arrangement, not back to the origin', () => {
    // An analyst who laid the case out away from the centre must not watch every
    // node that arrives afterwards appear where they moved away from.
    const far = [
      { ...node('hub', 'actor', 2), pin: [4000, 4000] },
      { ...node('other', 'actor', 1), pin: [4200, 4000] },
      node('fresh', 'actor', 1),
    ];
    const at = positionsById(
      arrangeClusters(far, [
        { id: 'l1', from: 'hub', to: 'fresh' },
        { id: 'l2', from: 'hub', to: 'other' },
      ]),
    );
    expect(at.get('fresh').x).toBeGreaterThan(2000);
    expect(at.get('fresh').y).toBeGreaterThan(2000);
  });

  it('seats an arrival beside the pinned neighbour it is attached to', () => {
    const nodes = [
      { ...node('anchor', 'actor', 1), pin: [1000, 0] },
      node('arrival', 'document', 1),
    ];
    const at = positionsById(
      arrangeClusters(nodes, [{ id: 'l', from: 'anchor', to: 'arrival' }]),
    );
    const gap = Math.hypot(at.get('arrival').x - 1000, at.get('arrival').y);
    expect(gap).toBeLessThan(400);
  });

  it('survives a pin that arrived as nonsense', () => {
    // A coordinate is bounded at the API, but a doctored case.db or a half-written
    // payload must draw rather than throw: an unusable pin is no pin.
    const nodes = [
      { ...node('a', 'actor', 1), pin: [Number.NaN, 3] },
      { ...node('b', 'actor', 1), pin: 'somewhere' },
    ];
    const placed = arrangeClusters(nodes, [{ id: 'l', from: 'a', to: 'b' }]);
    expect(placed.every((seat) => Number.isFinite(seat.x) && Number.isFinite(seat.y))).toBe(
      true,
    );
    expect(placed.every((seat) => seat.pinned === undefined)).toBe(true);
  });

  it('never anchors a neighbourhood, where distance from the root owns the axis', () => {
    const nodes = [{ ...node('a', 'actor', 1), hop: 1, pin: [500, 500] }];
    expect(arrange(nodes, 'hops', [])).toEqual(arrangeHops(nodes));
  });
});

describe('a node the drawing already held', () => {
  const dumbbell = {
    nodes: [
      node('a1', 'actor', 3),
      node('a2', 'actor', 2),
      node('a3', 'actor', 2),
      node('b1', 'place', 3),
      node('b2', 'place', 2),
      node('b3', 'place', 2),
      node('lonely', 'document', 0),
    ],
    links: [
      { id: 'l1', from: 'a1', to: 'a2' },
      { id: 'l2', from: 'a2', to: 'a3' },
      { id: 'l3', from: 'a3', to: 'a1' },
      { id: 'l4', from: 'b1', to: 'b2' },
      { id: 'l5', from: 'b2', to: 'b3' },
      { id: 'l6', from: 'b3', to: 'b1' },
      { id: 'bridge', from: 'a1', to: 'b1' },
    ],
  };

  /** What the client keeps between two reads of the same question: the cluster only. */
  const settle = (placed) =>
    new Map(
      placed.filter((seat) => !seat.parked).map((seat) => [seat.id, { x: seat.x, y: seat.y }]),
    );

  it('does not move at all when the same question is drawn again', () => {
    // The promise the whole step rests on, and it has to be exact: a node that
    // drifted two pixels every time something arrived would make a large case
    // unreadable by the tenth expansion.
    const first = arrangeClusters(dumbbell.nodes, dumbbell.links);
    const again = arrangeClusters(dumbbell.nodes, dumbbell.links, new Map(), settle(first));
    expect(again).toEqual(first);
  });

  it('places the arrival and nothing else', () => {
    // Opening one node into a drawing costs one placement. Everything on screen is a
    // fixed point, so the case the analyst was reading is the case they get back.
    const before = arrangeClusters(dumbbell.nodes, dumbbell.links);
    const grown = arrangeClusters(
      [...dumbbell.nodes, node('fresh', 'document', 1)],
      [...dumbbell.links, { id: 'l7', from: 'a1', to: 'fresh' }],
      new Map(),
      settle(before),
    );
    const was = positionsById(before);
    const now = positionsById(grown);
    for (const seat of before) {
      if (seat.parked) continue;
      expect([now.get(seat.id).x, now.get(seat.id).y]).toEqual([seat.x, seat.y]);
    }
    // And the arrival lands beside the neighbour that asked for it, rather than on
    // its family ring half a canvas away.
    const gap = Math.hypot(
      now.get('fresh').x - was.get('a1').x,
      now.get('fresh').y - was.get('a1').y,
    );
    expect(gap).toBeLessThan(400);
  });

  it('is not marked as one the analyst placed', () => {
    // The pin mark offers "let it go", and there is nothing to let go of: nobody
    // chose this spot, the drawing simply already had it.
    const first = arrangeClusters(dumbbell.nodes, dumbbell.links);
    const again = arrangeClusters(dumbbell.nodes, dumbbell.links, new Map(), settle(first));
    expect(again.every((seat) => seat.pinned === undefined)).toBe(true);
  });

  it('gives way to a hand placed on the same node', () => {
    // The two disagree only just after a drag, and the drag is the more recent
    // statement of the same thing.
    const first = arrangeClusters(dumbbell.nodes, dumbbell.links);
    const at = positionsById(
      arrangeClusters(
        dumbbell.nodes,
        dumbbell.links,
        new Map([['a1', { x: 700, y: -400 }]]),
        settle(first),
      ),
    );
    expect([at.get('a1').x, at.get('a1').y]).toEqual([700, -400]);
    expect(at.get('a1').pinned).toBe(true);
  });

  it('hands one node back to the layout when its spot is forgotten', () => {
    // What "let it go" does: the node is the one thing the relaxation still owns, so
    // it is placed against a case that stays where it is.
    const first = arrangeClusters(dumbbell.nodes, dumbbell.links);
    const kept = settle(first);
    kept.delete('a2');
    const at = positionsById(arrangeClusters(dumbbell.nodes, dumbbell.links, new Map(), kept));
    const was = positionsById(first);
    expect([at.get('a1').x, at.get('a1').y]).toEqual([was.get('a1').x, was.get('a1').y]);
    expect(Number.isFinite(at.get('a2').x)).toBe(true);
  });

  it('parks an unconnected node wherever the park now is', () => {
    // The park is placed against the cluster's edge rather than against the case, so
    // it follows the drawing as the drawing grows. A spot remembered beside a cluster
    // that has since moved would strand it in the middle of the picture.
    const first = arrangeClusters(dumbbell.nodes, dumbbell.links);
    const kept = settle(first);
    kept.set('lonely', { x: -5000, y: -5000 });
    const at = positionsById(arrangeClusters(dumbbell.nodes, dumbbell.links, new Map(), kept));
    expect(at.get('lonely').parked).toBe(true);
    expect(at.get('lonely').x).toBeGreaterThan(at.get('a1').x);
  });

  it('survives a remembered spot that arrived as nonsense', () => {
    const at = positionsById(
      arrangeClusters(
        dumbbell.nodes,
        dumbbell.links,
        new Map(),
        new Map([
          ['a1', { x: Number.NaN, y: 3 }],
          ['a2', { x: 10 }],
        ]),
      ),
    );
    expect(Number.isFinite(at.get('a1').x)).toBe(true);
    expect(Number.isFinite(at.get('a2').y)).toBe(true);
  });

  it('draws the same picture for the same payload and the same memory', () => {
    const first = arrangeClusters(dumbbell.nodes, dumbbell.links);
    const kept = settle(first);
    kept.delete('b2');
    expect(arrangeClusters(dumbbell.nodes, dumbbell.links, new Map(), kept)).toEqual(
      arrangeClusters(dumbbell.nodes, dumbbell.links, new Map(), kept),
    );
  });
});

describe('arrange', () => {
  it('dispatches on the mode', () => {
    const nodes = [{ id: 'a', family: 'actor', degree: 1, label: 'A', hop: 1 }];
    const links = [{ id: 'l', from: 'a', to: 'a' }];
    expect(arrange(nodes, 'hops', links)).toEqual(arrangeHops(nodes));
    expect(arrange(nodes, 'rings', links)).toEqual(arrangeClusters(nodes, links));
  });

  it('carries what the drawing already held through to the cluster', () => {
    const nodes = [node('a', 'actor', 1), node('b', 'place', 1)];
    const links = [{ id: 'l', from: 'a', to: 'b' }];
    const kept = new Map([['a', { x: 120, y: -60 }]]);
    expect(arrange(nodes, 'rings', links, new Map(), kept)).toEqual(
      arrangeClusters(nodes, links, new Map(), kept),
    );
    // A neighbourhood gives its horizontal axis to distance from the root, so a
    // coordinate stated against the cluster would fight the one thing it shows.
    expect(arrange(nodes, 'hops', links, new Map(), kept)).toEqual(arrangeHops(nodes));
  });
});

describe('fitting the viewport', () => {
  it('survives an empty case without dividing by zero', () => {
    const view = fit([], 800, 600);
    expect(Number.isFinite(view.scale)).toBe(true);
    expect(Number.isFinite(view.x)).toBe(true);
  });

  it('never blows a two-node case up past its own size', () => {
    expect(fit([{ x: 0, y: 0 }, { x: 10, y: 0 }], 900, 700).scale).toBeLessThanOrEqual(1);
  });

  it('shrinks a placement that overflows', () => {
    const wide = [{ x: -4000, y: 0 }, { x: 4000, y: 0 }];
    expect(fit(wide, 800, 600).scale).toBeLessThan(1);
  });

  it('centres what it fits', () => {
    const view = fit([{ x: -100, y: -50 }, { x: 100, y: 50 }], 800, 600);
    expect(view.x).toBeCloseTo(400, 6);
    expect(view.y).toBeCloseTo(300, 6);
  });

  it('reports a unit box for nothing placed', () => {
    expect(extent([])).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
  });
});

describe('edges', () => {
  const chain = ['derived-from', 'depends-on'];

  it('drops an edge whose end was not placed', () => {
    // The server returns a closed set; a dangling edge means the two disagree,
    // and a line to the origin would be a drawing of nothing.
    const positions = positionsById([{ id: 'a', x: 0, y: 0 }]);
    const links = [{ from: 'a', to: 'gone', type: 'owns' }];
    expect(drawableLinks(links, positions)).toEqual([]);
  });

  it('keeps an edge with both ends placed', () => {
    const positions = positionsById([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 1 }]);
    const links = [{ from: 'a', to: 'b', type: 'owns' }];
    expect(drawableLinks(links, positions)).toHaveLength(1);
  });

  it('drops an edge onto its own node, which has no line to draw', () => {
    const positions = positionsById([{ id: 'a', x: 0, y: 0 }]);
    expect(drawableLinks([{ from: 'a', to: 'a', type: 'owns' }], positions)).toEqual([]);
  });

  it('carries its meaning in the stroke, not the colour', () => {
    // A graph that reaches a report gets printed, and a printed graph is grey.
    const derivation = edgeStyle({ type: 'derived-from' }, chain);
    const relation = edgeStyle({ type: 'owns' }, chain);
    const mention = edgeStyle({ type: 'mentions' }, chain);
    expect(derivation.dash).toEqual([]);
    expect(relation.dash.length).toBeGreaterThan(0);
    expect(mention.dash).not.toEqual(relation.dash);
  });

  it('draws a proposal differently from a stated edge', () => {
    const suggested = edgeStyle(
      { type: 'located-at', provenance: { status: 'suggested' } },
      chain,
    );
    const stated = edgeStyle(
      { type: 'located-at', provenance: { status: 'confirmed' } },
      chain,
    );
    expect(suggested.dash).not.toEqual(stated.dash);
    expect(edgeKind({ type: 'derived-from', provenance: { status: 'suggested' } }, chain)).toBe(
      'proposed',
    );
  });

  it('draws an edge that stands for several as one of its own', () => {
    // A folded edge is not a row: it cannot be confirmed or removed, and it says more
    // than its verb. Drawn like a stated relation it would read as one.
    const folded = edgeStyle(
      { type: 'cites', folded: { sources: 3, via: ['bookmark'], accounts: 1 } },
      chain,
    );
    expect(folded.kind).toBe('folded');
    expect(folded.width).toBeGreaterThan(edgeStyle({ type: 'cites' }, chain).width);
    // A proposal anywhere along the path still outranks it: the fold is only as
    // confirmed as its weakest part, and that is what the dash says.
    expect(
      edgeKind({ type: 'cites', folded: {}, provenance: { status: 'suggested' } }, chain),
    ).toBe('proposed');
  });

  it('draws what stands against a statement apart from what states it', () => {
    // A statement cluster has to show its arguments before any label is read: an
    // ordinary relation and a contradiction saying the same thing in the same dash
    // is the picture hiding the one finding a reader is scanning for.
    const against = edgeStyle({ type: 'contradicts' }, chain);
    const stated = edgeStyle({ type: 'owns' }, chain);
    expect(against.kind).toBe('contradiction');
    expect(against.dash).not.toEqual(stated.dash);
    expect(against.width).toBeGreaterThan(stated.width);
    // Patterns, not hues: the families own the palette and a printed report is grey.
    expect(EDGE_KINDS.map((entry) => entry.dash.join())).toHaveLength(
      new Set(EDGE_KINDS.map((entry) => `${entry.dash.join()}|${entry.width}`)).size,
    );
    // A proposal still outranks it, the rule every other verb follows.
    expect(
      edgeKind({ type: 'contradicts', provenance: { status: 'suggested' } }, chain),
    ).toBe('proposed');
  });

  it('draws a ruled-out relation apart from one nobody has assessed', () => {
    // Eliminating a candidate is a finding the case keeps, not a deletion: twelve are
    // checked and eleven ruled out. Drawn like any other stated relation, those eleven
    // read as live hypotheses to anyone glancing at the picture.
    const out = edgeStyle({ type: 'owns', confidence: -1 }, chain);
    const stated = edgeStyle({ type: 'owns' }, chain);
    expect(out.kind).toBe('refuted');
    expect(out.dash).not.toEqual(stated.dash);
    expect(out.label).toBe('ruled out');
  });

  it('gives a stroke to the verdict and not to the other three levels', () => {
    // A verdict is not a nuance. *Probable* against *possible* is read one edge at a
    // time in the panel; four more dash patterns would put "what kind of edge is this"
    // and "how sure of it" on one channel, which is the mixture the three assessments
    // are kept apart to prevent (ONTOLOGY §3).
    for (const level of [3, 2, 1, null]) {
      expect(edgeKind({ type: 'owns', confidence: level }, chain)).toBe('stated');
    }
  });

  it('lets every other reading of an edge outrank the verdict', () => {
    // A rating only ever reaches an ordinary stated relation — the API refuses one on
    // a derivation, a mention and a claim connector — so nothing here is a contest.
    // What is: an unreviewed edge is unreviewed first, and a fold is not a row at all.
    expect(
      edgeKind({ type: 'owns', confidence: -1, provenance: { status: 'suggested' } }, chain),
    ).toBe('proposed');
    expect(edgeKind({ type: 'cites', confidence: -1, folded: {} }, chain)).toBe('folded');
    expect(edgeKind({ type: 'derived-from', confidence: -1 }, chain)).toBe('lineage');
  });

  it('gives the legend and the stroke one table to read, so a dash is explained', () => {
    // An unexplained dash pattern is decoration: nothing tells the analyst that
    // fine dots mean a mention.
    for (const entry of EDGE_KINDS) expect(entry.label).toBeTruthy();
    const kinds = EDGE_KINDS.map((entry) => entry.kind);
    expect(kinds).toContain(edgeKind({ type: 'owns' }, chain));
    expect(kinds).toContain(edgeKind({ type: 'mentions' }, chain));
    expect(edgeStyle({ type: 'owns' }, chain).label).toBe('stated relation');
  });

  it('leaves the word “fold” to the act an expansion is undone by', () => {
    // The legend read *sources, folded into one* while the toolbar, the panel and the
    // menu all used folding for taking an expansion back out. One word cannot name two
    // acts in the same picture, so the edge takes the panel's own wording.
    const label = edgeStyle(
      { type: 'cites', folded: { sources: 3, via: ['bookmark'], accounts: 1 } },
      chain,
    ).label;
    expect(label).toBe('sources, drawn as one edge');
    for (const entry of EDGE_KINDS) expect(entry.label).not.toMatch(/fold/i);
  });

  it('separates two edges between the same pair, in either direction', () => {
    // Drawn straight they land on top of each other, and the picture says "one
    // link" where the case says two.
    const bends = parallelBends([
      { id: 'x', from: 'a', to: 'b' },
      { id: 'y', from: 'b', to: 'a' },
    ]);
    expect(bends.get('x')).toBe(-bends.get('y'));
    expect(bends.get('x')).not.toBe(0);
  });

  it('leaves a lone edge straight', () => {
    expect(parallelBends([{ id: 'x', from: 'a', to: 'b' }]).get('x')).toBe(0);
  });

  it('cuts an edge back to the rim of both nodes, leaving room for the head', () => {
    // A head buried under the target circle points at nothing.
    const points = edgePoints({ x: 0, y: 0 }, { x: 200, y: 0 }, 20, 20);
    expect(points).toHaveLength(4);
    expect(points[0]).toBeGreaterThan(20);
    expect(points[2]).toBeLessThan(180);
  });

  it('writes a verb beside the line rather than through its own dashes', () => {
    const points = edgePoints({ x: 0, y: 0 }, { x: 200, y: 0 }, 10, 10);
    const on = edgeMidpoint(points);
    const beside = edgeMidpoint(points, 12);
    expect(beside.x).toBeCloseTo(on.x, 6);
    expect(Math.abs(beside.y - on.y)).toBeCloseTo(12, 6);
  });

  it('lifts two parallel edges apart instead of stacking their verbs', () => {
    // The bend already separates the lines; lifting both the same way would put
    // the two verbs back on top of each other.
    const bends = parallelBends([
      { id: 'x', from: 'a', to: 'b' },
      { id: 'y', from: 'b', to: 'a' },
    ]);
    const one = edgeMidpoint(
      edgePoints({ x: 0, y: 0 }, { x: 200, y: 0 }, 10, 10, bends.get('x')),
      12,
    );
    const other = edgeMidpoint(
      edgePoints({ x: 0, y: 0 }, { x: 200, y: 0 }, 10, 10, bends.get('y')),
      12,
    );
    const apart = Math.abs(one.y - other.y);
    expect(apart).toBeGreaterThan(2 * Math.abs(bends.get('x')));
  });

  it('bows a bent edge off the straight line and writes the verb on the bow', () => {
    const straight = edgePoints({ x: 0, y: 0 }, { x: 200, y: 0 }, 10, 10);
    const bent = edgePoints({ x: 0, y: 0 }, { x: 200, y: 0 }, 10, 10, 30);
    expect(bent).toHaveLength(6);
    expect(Math.abs(edgeMidpoint(bent).y)).toBeCloseTo(30, 6);
    // The midpoint of the line as drawn, which is the trimmed segment rather than
    // the span between the two centres: that is where the verb has to sit.
    expect(edgeMidpoint(straight).y).toBeCloseTo(0, 6);
    expect(edgeMidpoint(straight).x).toBeCloseTo((straight[0] + straight[2]) / 2, 6);
    expect(edgeMidpoint(straight).x).toBeGreaterThan(90);
  });
});

describe('the card a node becomes close up', () => {
  it('is measured in screen pixels, which is what lets it fit at all', () => {
    // In canvas units a card this wide would overlap its neighbours at every zoom,
    // since the placement only spaces nodes 130 apart.
    expect(CARD.w).toBeGreaterThan(130);
    expect(CARD_SCALE).toBeGreaterThan(1);
  });

  it('stops an arrow at the side of the box rather than under it', () => {
    const wide = boxRadius(80, 25, 1, 0);
    const tall = boxRadius(80, 25, 0, 1);
    expect(wide).toBeCloseTo(80, 6);
    expect(tall).toBeCloseTo(25, 6);
    // A ray out of a corner leaves through whichever side it reaches first.
    expect(boxRadius(80, 25, 1, 1)).toBeCloseTo(25 * Math.SQRT2, 6);
  });

  it('fills the art column from the middle of the picture', () => {
    // A wide capture keeps its full height and gives up the sides; a tall photo
    // keeps its full width. Either way the column is filled and nothing is stretched.
    const wide = cropToFill(640, 360, 1);
    expect(wide.height).toBeCloseTo(360, 6);
    expect(wide.width).toBeCloseTo(360, 6);
    expect(wide.x).toBeCloseTo(140, 6);
    expect(wide.y).toBeCloseTo(0, 6);
    const tall = cropToFill(360, 640, 1);
    expect(tall.width).toBeCloseTo(360, 6);
    expect(tall.y).toBeCloseTo(140, 6);
    const square = cropToFill(100, 100, 1);
    expect(square).toMatchObject({ x: 0, y: 0, width: 100, height: 100 });
  });

  it('crops to the column it is given rather than to a square', () => {
    const half = cropToFill(400, 400, 2);
    expect(half.width / half.height).toBeCloseTo(2, 6);
    expect(half.width).toBeCloseTo(400, 6);
    expect(half.y).toBeCloseTo(100, 6);
  });

  it('survives a picture whose size never arrived', () => {
    const crop = cropToFill(undefined, 0, 1);
    expect(Number.isFinite(crop.width)).toBe(true);
    expect(crop.width).toBeGreaterThan(0);
  });

  it('grows with the zoom, but slower than the case spreads out', () => {
    // The point of the growth: zooming in has to make the card bigger on screen, or
    // close up the drawing is a handful of stamps floating between long arrows.
    const onScreen = (zoom) => cardFactor(zoom) * zoom;
    expect(onScreen(CARD_SCALE)).toBeCloseTo(1, 6);
    expect(onScreen(2)).toBeGreaterThan(onScreen(CARD_SCALE));
    expect(onScreen(3.2)).toBeGreaterThan(onScreen(2));
    expect(onScreen(3.2)).toBeLessThanOrEqual(CARD_GROWTH);
    // And the reason it can grow at all: between two zooms the gap between nodes
    // widens faster than the card does, so cards that had room keep it.
    const spread = 3.2 / CARD_SCALE;
    expect(onScreen(3.2) / onScreen(CARD_SCALE)).toBeLessThan(spread);
  });

  it('never shrinks a card below its own size, or on a zoom that never arrived', () => {
    expect(cardFactor(0.4) * 0.4).toBeCloseTo(1, 6);
    expect(Number.isFinite(cardFactor(undefined))).toBe(true);
    expect(Number.isFinite(cardFactor(0))).toBe(true);
  });

  it('gives the picture a column as tall as the card', () => {
    // The crop assumes the column is the card's own height; the glyph sits inside
    // that same column, which is what keeps every title on a row aligned.
    expect(CARD.art).toBe(CARD.h);
    expect(CARD.glyph).toBeLessThan(CARD.art);
    expect(CARD.stripe + CARD.art + CARD.pad).toBeLessThan(CARD.w / 2);
  });
});

describe('node drawing', () => {
  it('grows a hub without letting it swallow the canvas', () => {
    expect(nodeRadius(0)).toBeLessThan(nodeRadius(4));
    expect(nodeRadius(4)).toBeLessThan(nodeRadius(40));
    expect(nodeRadius(4000)).toBeLessThan(nodeRadius(4) * 3);
  });

  it('treats a missing degree as none rather than as NaN', () => {
    expect(Number.isFinite(nodeRadius(undefined))).toBe(true);
  });

  it('shortens a long label and leaves a short one alone', () => {
    expect(shortLabel('Short')).toBe('Short');
    expect(shortLabel('x'.repeat(60))).toHaveLength(22);
    expect(shortLabel('x'.repeat(60)).endsWith('…')).toBe(true);
  });

  it('survives a label that is not a string', () => {
    expect(shortLabel(null)).toBe('');
    expect(shortLabel(42)).toBe('42');
  });
});


describe('what a pointer is over', () => {
  const placed = [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 200, y: 0 },
  ];
  const byId = new Map([
    ['a', { id: 'a', degree: 0 }],
    ['b', { id: 'b', degree: 40 }],
  ]);

  it('answers with the node the point falls inside', () => {
    expect(nodeAt(placed, byId, { x: 2, y: 2 })).toBe('a');
    expect(nodeAt(placed, byId, { x: 200, y: 3 })).toBe('b');
  });

  it('answers with nothing over empty canvas', () => {
    expect(nodeAt(placed, byId, { x: 100, y: 100 })).toBe(null);
  });

  it('picks the nearer of two nodes that overlap', () => {
    // Two cards sitting on top of each other resolve to the one being pointed at,
    // not to whichever happened to be drawn last.
    const stacked = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 30, y: 0 },
    ];
    expect(nodeAt(stacked, byId, { x: 26, y: 0 }, { carded: true })).toBe('b');
  });

  it('uses the card box once the view draws cards', () => {
    // A point 60 units out is well past any circle and well inside a card.
    expect(nodeAt(placed, byId, { x: 60, y: 0 })).toBe(null);
    expect(nodeAt(placed, byId, { x: 60, y: 0 }, { carded: true })).toBe('a');
  });

  it('follows the card as it grows with the zoom', () => {
    // The box tested here is the box on screen. A card drawn 1.7× its base size has
    // to be clickable across all of it, or the drawing stops answering its own edges.
    const far = { x: (CARD.w / 2) * cardFactor(3.2) - 1, y: 0 };
    expect(nodeAt(placed, byId, far, { carded: true, scale: 3.2 })).toBe('a');
    expect(nodeAt(placed, byId, { x: far.x + 3, y: 0 }, { carded: true, scale: 3.2 })).toBe(
      null,
    );
  });
});

describe('rings around a node', () => {
  // a — b — c — d, plus e hanging off a.
  const chain = [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
    { from: 'c', to: 'd' },
    { from: 'a', to: 'e' },
  ];

  it('holds the node itself at every reach', () => {
    // An unconnected node focuses on itself, never on an empty set: the panel is
    // open on it, and a highlight that excludes what it is about is a bug on screen.
    expect([...ringsAround([], 'lonely', 1)]).toEqual(['lonely']);
    expect(ringsAround(chain, 'a', 1).has('a')).toBe(true);
  });

  it('reaches one hop, which is what a click asks', () => {
    expect([...ringsAround(chain, 'a', 1)].sort()).toEqual(['a', 'b', 'e']);
  });

  it('reaches two, which is the ring a click cannot show', () => {
    expect([...ringsAround(chain, 'a', 2)].sort()).toEqual(['a', 'b', 'c', 'e']);
  });

  it('reaches three', () => {
    expect([...ringsAround(chain, 'a', 3)].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('walks against the arrow as readily as along it', () => {
    // Direction is what an edge says, not a wall. Asked what surrounds the far end
    // of a one-way edge, a directed walk would answer "nothing".
    expect(ringsAround([{ from: 'a', to: 'b' }], 'b', 1).has('a')).toBe(true);
  });

  it('stops at the reach asked for, on a graph that goes further', () => {
    expect(ringsAround(chain, 'a', 1).has('c')).toBe(false);
    expect(ringsAround(chain, 'a', 2).has('d')).toBe(false);
  });

  it('terminates on a cycle', () => {
    const ring = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'a' },
    ];
    expect([...ringsAround(ring, 'a', 3)].sort()).toEqual(['a', 'b', 'c']);
  });

  it('counts each node once however many edges reach it', () => {
    const parallel = [
      { from: 'a', to: 'b' },
      { from: 'a', to: 'b' },
      { from: 'b', to: 'a' },
    ];
    expect(ringsAround(parallel, 'a', 2).size).toBe(2);
  });

  it('reaches nothing below one hop', () => {
    expect([...ringsAround(chain, 'a', 0)]).toEqual(['a']);
  });
});

describe('folding a node', () => {
  // A hub, the leaves that hang off it alone, and a case for them to hang off.
  const hub = (leaves, extra = []) => {
    const nodes = [node('h', 'actor', leaves + 2), node('body1', 'place'), node('body2', 'place')];
    const links = [
      { from: 'h', to: 'body1' },
      { from: 'body1', to: 'body2' },
      { from: 'body2', to: 'h' },
    ];
    for (let i = 0; i < leaves; i += 1) {
      nodes.push(node(`leaf${i}`, 'collected', 1));
      links.push({ from: 'h', to: `leaf${i}` });
    }
    return { nodes: [...nodes, ...(extra.nodes ?? [])], links: [...links, ...(extra.links ?? [])] };
  };

  it('takes the leaves that hung off it alone', () => {
    const { nodes, links } = hub(4);
    const { hidden } = foldAway(['h'], nodes, links);
    expect([...hidden].sort()).toEqual(['leaf0', 'leaf1', 'leaf2', 'leaf3']);
  });

  it('leaves the node itself on screen, carrying what it took', () => {
    const { nodes, links } = hub(4);
    const { hidden, by } = foldAway(['h'], nodes, links);
    expect(hidden.has('h')).toBe(false);
    expect(by.get('h')).toBe(4);
  });

  it('keeps a leaf something else also holds', () => {
    // The one that surprises, and the one that makes the rule trustworthy: a capture
    // two accounts both posted is in the drawing for a second reason.
    const { nodes, links } = hub(3);
    links.push({ from: 'body1', to: 'leaf0' });
    const { hidden } = foldAway(['h'], nodes, links);
    expect(hidden.has('leaf0')).toBe(false);
    expect([...hidden].sort()).toEqual(['leaf1', 'leaf2']);
  });

  it('follows a chain out to its end', () => {
    // account -> post -> capture, where neither the post nor the capture is held by
    // anything else. Stopping at the post would leave the capture floating.
    const { nodes, links } = hub(0);
    nodes.push(node('post', 'document', 2), node('shot', 'collected', 1));
    links.push({ from: 'h', to: 'post' }, { from: 'post', to: 'shot' });
    const { hidden } = foldAway(['h'], nodes, links);
    expect([...hidden].sort()).toEqual(['post', 'shot']);
  });

  it('takes a small ring hanging off it, not only a tree', () => {
    const { nodes, links } = hub(0);
    nodes.push(node('p', 'document', 2), node('q', 'place', 2));
    links.push({ from: 'h', to: 'p' }, { from: 'p', to: 'q' }, { from: 'q', to: 'h' });
    const { hidden } = foldAway(['h'], nodes, links);
    expect([...hidden].sort()).toEqual(['p', 'q']);
  });

  it('never takes the drawing away with it', () => {
    // The trapdoor this rule exists to close: the rest of the case is, technically,
    // hanging off any node you fold. The biggest piece with a shape of its own stays.
    const { nodes, links } = hub(3);
    const { hidden } = foldAway(['h'], nodes, links);
    expect(hidden.has('body1')).toBe(false);
    expect(hidden.has('body2')).toBe(false);
  });

  it('folds nothing when the node holds nothing up', () => {
    const { nodes, links } = hub(0);
    expect(foldAway(['h'], nodes, links).hidden.size).toBe(0);
    expect(foldableCount('h', nodes, links)).toBe(0);
  });

  it('empties a star down to its hub, since every leaf is clutter', () => {
    // No piece here has a shape of its own, so none of them is the drawing. Sparing
    // one arbitrary leaf out of eleven would read as a bug.
    const nodes = [node('h', 'actor', 3)];
    const links = [];
    for (const id of ['a', 'b', 'c']) {
      nodes.push(node(id, 'collected', 1));
      links.push({ from: 'h', to: id });
    }
    expect([...foldAway(['h'], nodes, links).hidden].sort()).toEqual(['a', 'b', 'c']);
  });

  it('spares a piece holding a node the analyst placed by hand', () => {
    const { nodes, links } = hub(3);
    const { hidden } = foldAway(['h'], nodes, links, new Set(['leaf1']));
    expect(hidden.has('leaf1')).toBe(false);
    expect([...hidden].sort()).toEqual(['leaf0', 'leaf2']);
  });

  it('never reaches a part of the case it does not touch', () => {
    // A second cluster, joined to nothing. Folding here says nothing about it.
    const { nodes, links } = hub(2);
    nodes.push(node('far', 'actor', 0));
    const { hidden } = foldAway(['h'], nodes, links);
    expect(hidden.has('far')).toBe(false);
  });

  it('cuts no link between two nodes that both stay', () => {
    // The guarantee, checked rather than asserted. What leaves is joined to the
    // drawing through the folded node and nothing else, so every link that ends on
    // something still on screen ends on the node that was folded.
    const { nodes, links } = hub(3);
    links.push({ from: 'body1', to: 'leaf0' });
    const { hidden } = foldAway(['h'], nodes, links);
    for (const link of links) {
      for (const [gone, stays] of [
        [link.from, link.to],
        [link.to, link.from],
      ]) {
        if (hidden.has(gone) && !hidden.has(stays)) expect(stays).toBe('h');
      }
    }
  });

  it('adds two folds up without counting a shared piece twice', () => {
    const { nodes, links } = hub(2);
    nodes.push(node('h2', 'actor', 2), node('shared', 'collected', 2));
    links.push({ from: 'h2', to: 'body1' }, { from: 'h', to: 'shared' }, { from: 'h2', to: 'shared' });
    const { hidden, by } = foldAway(['h', 'h2'], nodes, links);
    expect(hidden.has('shared')).toBe(true);
    expect([...by.values()].reduce((sum, n) => sum + n, 0)).toBe(hidden.size);
  });

  it('folds the same drawing the same way whatever order it arrives in', () => {
    const { nodes, links } = hub(4);
    const first = foldAway(['h'], nodes, links).hidden;
    const again = foldAway(['h'], [...nodes].reverse(), [...links].reverse()).hidden;
    expect([...first].sort()).toEqual([...again].sort());
  });

  it('ignores a fold on a node the drawing no longer holds', () => {
    const { nodes, links } = hub(2);
    expect(foldAway(['gone'], nodes, links).hidden.size).toBe(0);
  });

  it('counts a pair joined twice as one holder', () => {
    // Two verbs between the same pair are one holder said twice, so a leaf joined to
    // its hub by two edges is still a leaf.
    const nodes = [node('h', 'actor', 4), node('body1', 'place'), node('body2', 'place'), node('leaf', 'collected', 2)];
    const links = [
      { from: 'h', to: 'body1' },
      { from: 'body1', to: 'body2' },
      { from: 'body2', to: 'h' },
      { from: 'h', to: 'leaf' },
      { from: 'leaf', to: 'h' },
    ];
    expect([...foldAway(['h'], nodes, links).hidden]).toEqual(['leaf']);
  });
});

describe('the drawing as a snapshot, for the way back', () => {
  const at = (over = {}) => ({
    lens: 'ground',
    order: 'recent',
    root: null,
    hops: 1,
    folder: 'field',
    families: ['document', 'collected'],
    kept: ['b', 'a'],
    expanded: ['x'],
    omitted: [],
    collapsed: [],
    putAway: { n2: ['z', 'y'], n1: ['q'] },
    arrangement: [{ id: 'two', x: 3, y: 4 }, { id: 'one', x: 1, y: 2 }],
    ...over,
  });

  it('reads the same for two states that differ only in iteration order', () => {
    // The history compares snapshots as strings, so a set that came out the other way
    // round would fork the timeline and record an act nobody performed.
    expect(drawingSnapshot(at())).toBe(
      drawingSnapshot(
        at({
          families: ['collected', 'document'],
          putAway: { n1: ['q'], n2: ['y', 'z'] },
          arrangement: [{ id: 'one', x: 1, y: 2 }, { id: 'two', x: 3, y: 4 }],
        }),
      ),
    );
  });

  it('keeps the analyst\'s own lists in the order they were asked for', () => {
    // The case echoes `keep` back in it, and these are named nodes rather than a set
    // the drawing happens to hold.
    expect(JSON.parse(drawingSnapshot(at())).kept).toEqual(['b', 'a']);
  });

  it('tells one reading from another', () => {
    expect(drawingSnapshot(at())).not.toBe(drawingSnapshot(at({ lens: 'all' })));
    expect(drawingSnapshot(at())).not.toBe(drawingSnapshot(at({ omitted: ['a'] })));
    expect(drawingSnapshot(at())).not.toBe(
      drawingSnapshot(at({ arrangement: [{ id: 'one', x: 9, y: 2 }, { id: 'two', x: 3, y: 4 }] })),
    );
  });

  it('answers for a state with nothing in it', () => {
    const bare = JSON.parse(drawingSnapshot());
    expect(bare.lens).toBe('all');
    expect(bare.kept).toEqual([]);
    expect(bare.arrangement).toEqual([]);
  });
});

describe('putting an arrangement back', () => {
  it('places what moved and lets go of what was not pinned then', () => {
    const now = [{ id: 'a', x: 1, y: 1 }, { id: 'b', x: 2, y: 2 }];
    const want = [{ id: 'a', x: 5, y: 5 }];
    expect(arrangementDiff(now, want)).toEqual({ place: [{ id: 'a', x: 5, y: 5 }], drop: ['b'] });
  });

  it('files nothing when the arrangement is already the one asked for', () => {
    const same = [{ id: 'a', x: 1, y: 1 }];
    expect(arrangementDiff(same, same)).toEqual({ place: [], drop: [] });
  });

  it('places a pin that is not there at all', () => {
    expect(arrangementDiff([], [{ id: 'a', x: 1, y: 1 }])).toEqual({
      place: [{ id: 'a', x: 1, y: 1 }],
      drop: [],
    });
  });

  it('never drops a pin it cannot see', () => {
    // Both sides are read over the nodes currently drawn, so a pinned node the budget
    // cut is in neither list and an undo cannot take an arrangement it never saw.
    expect(arrangementDiff([], []).drop).toEqual([]);
  });
});
