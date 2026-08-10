/**
 * Placing a case graph on a canvas, deterministically.
 *
 * The rule this file exists for: **the same case draws the same picture every
 * time.** A graph screenshot goes into a report beside a satellite capture, and a
 * capture is reproducible — a layout that settled somewhere new on every open
 * would make the picture an illustration rather than a reading of the case. So
 * nothing here simulates, jitters or animates towards a rest position. Every
 * coordinate is a pure function of the payload, and equal payloads give equal
 * pixels.
 *
 * That rules out the usual answer — an animated, randomly seeded simulation run
 * until it goes quiet — but not the physics. Two placements are built, each
 * carrying meaning:
 *
 * - **Clusters**, for the whole case. A ring per family (ONTOLOGY §2), ordered by
 *   degree, is the seed; a relaxation with a fixed pass count then pulls linked
 *   nodes together and pushes the rest apart, so the parts of the case that are
 *   about each other end up next to each other. Position means connectivity, and
 *   the same payload gives the same pixels.
 * - **Columns per hop**, for a neighbourhood. Distance from the root is the
 *   question being asked, so it becomes the horizontal axis and nothing else
 *   competes with it.
 *
 * **A node the analyst dragged wins over both.** An arrangement somebody built by
 * hand carries more than one a relaxation computed, so a pinned node is a fixed
 * point: it pushes and pulls, nothing moves it, and the rest of the case settles
 * around it. That does not weaken the rule above — a pin is part of the payload, so
 * the same case with the same pins still draws the same picture. It is what lets a
 * new node join an arrangement instead of restarting it.
 *
 * Neither placement reads a clock. When stated time lands (SPEC §6, v4), it
 * becomes a third arrangement beside these two rather than a change to either:
 * `arrange` dispatches on a mode, and a time mode is one more branch taking the
 * same nodes and returning the same `{id, x, y}` shape.
 */

/** Golden-angle radians: the spacing that keeps a ring from forming spokes. */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** Ring geometry, in canvas units before the view transform. */
const RING_GAP = 190;
const NODE_GAP = 78;
const COLUMN_GAP = 260;
const ROW_GAP = 74;

/**
 * The families in drawing order, outermost ring last. Subjects sit innermost
 * because a case is read from who and what, then out to the material that shows
 * them and the statements made about them.
 */
export const FAMILY_ORDER = [
  'actor',
  'asset',
  'class',
  'identifier',
  'place',
  'collected',
  'document',
  'claim',
];

/** Where a family sits in the ring order; unknown families ring outside them all. */
export function familyRank(family) {
  const at = FAMILY_ORDER.indexOf(family);
  return at === -1 ? FAMILY_ORDER.length : at;
}

/**
 * Sort nodes into the order a ring is filled: most connected first, then by
 * label, then by id. The last two are what make the layout stable — degree alone
 * ties constantly, and a tie broken by array order would move a node whenever the
 * server returned the same set differently.
 */
export function ringOrder(nodes) {
  return [...nodes].sort(
    (a, b) =>
      b.degree - a.degree ||
      String(a.label).localeCompare(String(b.label)) ||
      String(a.id).localeCompare(String(b.id)),
  );
}

/**
 * Seed a whole-case view: one ring per family present, ordered by degree.
 *
 * This is the **starting** position, not the final one. On its own a ring is a bad
 * graph layout — every node on a circle means every edge crosses the middle, which
 * is the most crossings possible and tells the eye nothing. What it is good at is
 * being a deterministic, well-spread, family-grouped starting point for the
 * relaxation in `arrangeClusters`, which is what actually turns position into
 * meaning.
 *
 * A ring's radius grows with how many nodes it holds, so a crowded family does
 * not overlap the one outside it. Empty families take no ring at all rather than
 * leaving a gap, which is what keeps a small case compact instead of drawing the
 * skeleton of a large one.
 */
export function arrangeRings(nodes) {
  const byFamily = new Map();
  for (const node of nodes) {
    const key = node.family || 'other';
    if (!byFamily.has(key)) byFamily.set(key, []);
    byFamily.get(key).push(node);
  }
  const families = [...byFamily.keys()].sort(
    (a, b) => familyRank(a) - familyRank(b) || a.localeCompare(b),
  );

  const placed = [];
  let radius = 0;
  for (const family of families) {
    const members = ringOrder(byFamily.get(family));
    // The circumference has to hold every member at NODE_GAP apart, and a ring
    // never pulls inside the one it encloses.
    radius = Math.max(radius + RING_GAP, (members.length * NODE_GAP) / (2 * Math.PI));
    if (members.length === 1) {
      placed.push({ id: members[0].id, x: radius, y: 0, family, ring: radius });
      continue;
    }
    members.forEach((node, index) => {
      // Golden-angle offset per ring so neighbouring rings do not line their
      // nodes up into spokes, which reads as structure that is not there.
      const angle = (index / members.length) * 2 * Math.PI + familyRank(family) * GOLDEN;
      placed.push({
        id: node.id,
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
        family,
        ring: radius,
      });
    });
  }
  return placed;
}

/**
 * Place a neighbourhood: one column per hop, the root alone on the left.
 *
 * Distance from the root is the whole question, so it owns the horizontal axis.
 * Within a column, the same degree-then-label order as a ring, so a node does not
 * move when the same neighbourhood is opened twice.
 */
export function arrangeHops(nodes) {
  const byHop = new Map();
  for (const node of nodes) {
    const hop = Number.isFinite(node.hop) ? node.hop : 0;
    if (!byHop.has(hop)) byHop.set(hop, []);
    byHop.get(hop).push(node);
  }
  const placed = [];
  for (const hop of [...byHop.keys()].sort((a, b) => a - b)) {
    const column = ringOrder(byHop.get(hop));
    const top = -((column.length - 1) * ROW_GAP) / 2;
    column.forEach((node, index) => {
      placed.push({ id: node.id, x: hop * COLUMN_GAP, y: top + index * ROW_GAP, hop });
    });
  }
  return placed;
}

/** Where the parked column of unconnected nodes sits, relative to the cluster. */
const PARK_GAP = 150;
const PARK_ROWS = 8;

/**
 * Where a node was put by hand, or null when nobody has moved it.
 *
 * Two sources, one answer. The payload carries `pin` for a node the case has
 * recorded; `pins` carries the drag that has just happened and may not have
 * reached the server yet. The local one wins, because it is the more recent
 * statement of the same thing.
 *
 * `null` rather than `{x: 0, y: 0}` for an unplaced node: the origin is a real
 * spot on the canvas, and a node the layout owns has to be told apart from one
 * that was dropped in the middle.
 */
function pinOf(node, pins) {
  const local = pins.get(node.id);
  if (local && Number.isFinite(local.x) && Number.isFinite(local.y)) return local;
  const stated = node.pin;
  if (!Array.isArray(stated) || !Number.isFinite(stated[0]) || !Number.isFinite(stated[1])) {
    return null;
  }
  return { x: stated[0], y: stated[1] };
}

/**
 * Seed a node the layout still owns beside the fixed points it is attached to.
 *
 * Without this a new node starts on its family ring, which can be most of the
 * canvas away from the neighbours that will end up pulling it: the early passes
 * then drag it across the picture and where it stops depends on how many passes
 * there were. Starting it where it is going to end up makes the arrival quiet,
 * which is the whole point of adding to an arrangement rather than recomputing it.
 *
 * This is where an arrival lands once the whole drawing is a fixed point: a node
 * opened into a case of two thousand appears beside the neighbours that asked for
 * it, and the two thousand do not stir.
 *
 * The fan-out is by index, not at random, so a node that arrives beside three
 * pinned neighbours lands in the same place on every read.
 */
function seedBesideAnchors(ids, anchors, springs, at) {
  const nearby = new Map();
  for (const [a, b] of springs) {
    for (const [self, other] of [
      [a, b],
      [b, a],
    ]) {
      const id = ids[self];
      const anchor = anchors.get(ids[other]);
      if (!anchor || anchors.has(id)) continue;
      if (!nearby.has(id)) nearby.set(id, []);
      nearby.get(id).push(anchor);
    }
  }
  let placed = 0;
  for (const [id, around] of nearby) {
    const x = around.reduce((sum, spot) => sum + spot.x, 0) / around.length;
    const y = around.reduce((sum, spot) => sum + spot.y, 0) / around.length;
    // A ring of arrivals around the anchor rather than a pile on top of it.
    const angle = placed * GOLDEN;
    placed += 1;
    at.set(id, { x: x + Math.cos(angle) * NODE_GAP, y: y + Math.sin(angle) * NODE_GAP });
  }
}

/**
 * How many relaxation passes a graph of this size gets.
 *
 * Fixed per size rather than "until it settles": a stopping rule that reads the
 * current state is what makes a layout wander between runs. This is a pure
 * function of the node count, so the same case gets the same number of passes
 * forever, and a large graph does not pay O(n²) three hundred times.
 */
export function passesFor(count) {
  return Math.max(60, Math.min(300, Math.round(2600 / Math.max(count, 1))));
}

/**
 * Place a whole-case view so that **position means connectivity**.
 *
 * The ring seeding groups families and spreads them evenly; this then relaxes the
 * result so nodes that are linked pull together and everything else pushes apart.
 * What comes out is clusters — the parts of the case that are actually about each
 * other end up near each other, and the eye reads structure instead of a circle of
 * dots with lines through the middle.
 *
 * **It is still reproducible.** The objection to a force layout is that it settles
 * somewhere new each time, and that objection is about *animated, randomly seeded,
 * run-until-quiet* simulations. None of those apply: the seed is the deterministic
 * ring, the pass count is fixed by size, the cooling schedule is fixed, and no
 * clock or random number is read. Same payload, same pixels — which is what a graph
 * that ends up in a report needs.
 *
 * **Unconnected nodes are parked, not mixed in.** A node nothing links to has no
 * place in a picture about links: left in the cloud it drifts wherever repulsion
 * pushes it and reads as meaningful position. It goes in a tidy column to the side,
 * where being set apart is itself the reading.
 *
 * **A node the analyst placed is a fixed point.** An arrangement somebody built by
 * hand outranks the one this computes, so a pinned node is never moved by a force —
 * it still pushes its neighbours and still pulls what it is linked to, but nothing
 * pushes back. Everything else settles around the pins, which is what lets a new
 * node join an arrangement instead of restarting it.
 *
 * **So is a node the drawing already holds.** `settled` is where each node ended up
 * last time this same question was drawn, and it is fixed for the same reason a pin
 * is one step weaker: nobody put it there, but somebody has been *reading* the
 * picture it is part of. Opening twenty nodes into a drawing of two thousand then
 * costs twenty placements rather than two thousand, and — the part that matters more
 * than the seconds — nothing already on screen moves when something arrives. The
 * caller decides what "the same question" means and empties the map when it changes.
 *
 * The price, accepted: the picture depends on the order things were opened in. Pins
 * already broke pure reproducibility, an arrangement built by hand is already part
 * of the payload, and it becomes reproducible again the day a view is saved.
 *
 * The park is not part of that promise. It is placed *relative to* the drawing, so a
 * column that follows the cluster's edge as the cluster grows is doing its job.
 */
export function arrangeClusters(nodes, links, pins = new Map(), settled = new Map()) {
  const anchors = new Map();
  for (const node of nodes) {
    const spot = pinOf(node, pins);
    if (spot) anchors.set(node.id, spot);
  }
  // A node that was placed by hand is not parked, whatever its degree: somebody
  // chose where it goes, and the park is for what nothing has been decided about.
  const linked = nodes.filter((node) => node.degree > 0 || anchors.has(node.id));
  const loose = ringOrder(
    nodes.filter((node) => node.degree <= 0 && !anchors.has(node.id)),
  );
  if (!linked.length) return parkOnly(loose);

  // Both kinds of fixed point in one map: what the analyst placed, over what the
  // drawing already held. A pin wins, because the two disagree only just after a
  // drag, and the drag is the more recent statement of the same thing.
  const held = new Map();
  for (const node of linked) {
    const spot = settled.get(node.id);
    if (spot && Number.isFinite(spot.x) && Number.isFinite(spot.y)) {
      held.set(node.id, { x: spot.x, y: spot.y });
    }
  }
  for (const [id, spot] of anchors) held.set(id, spot);

  const seats = arrangeRings(linked);
  const at = new Map();
  for (const seat of seats) at.set(seat.id, { x: seat.x, y: seat.y });
  for (const [id, spot] of held) at.set(id, { x: spot.x, y: spot.y });

  // **Indices come from the seating, not from the payload.** The relaxation sums a
  // force per node in index order, and floating-point addition is not associative,
  // so the same case handed back by the server in another order would settle a
  // fraction of a pixel away and keep amplifying that over three hundred passes.
  // The ring seating is already sorted by family and degree, so taking the order
  // from it makes the whole arrangement a function of the case rather than of the
  // response.
  const ids = seats.map((seat) => seat.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const byId = new Map(linked.map((node) => [node.id, node]));
  // A hub claims room and holds its ground: it pushes harder and is moved less by
  // what it is attached to. Without this the node with thirty edges is dragged
  // into the middle of its own satellites and the cluster reads as a blob.
  const mass = ids.map((id) => 1 + Math.sqrt(Math.max(byId.get(id).degree, 0)) * 0.5);

  // Edges between two placed nodes are the only ones that can pull. Sorted for the
  // same reason the nodes are: the pulls are summed in this order.
  const springs = [];
  for (const link of links ?? []) {
    const a = index.get(link.from);
    const b = index.get(link.to);
    if (a !== undefined && b !== undefined && a !== b) {
      springs.push(a < b ? [a, b] : [b, a]);
    }
  }
  springs.sort((one, other) => one[0] - other[0] || one[1] - other[1]);

  if (held.size) seedBesideAnchors(ids, held, springs, at);
  const xs = ids.map((id) => at.get(id).x);
  const ys = ids.map((id) => at.get(id).y);
  const fixed = ids.map((id) => held.has(id));
  // Gravity pulls towards the middle of the arrangement, which is the middle of
  // what is fixed once anything is. Towards the origin instead, an analyst who laid
  // the case out away from the centre would watch every new node appear back where
  // they had moved away from.
  const centre = { x: 0, y: 0 };
  if (held.size) {
    for (const spot of held.values()) {
      centre.x += spot.x / held.size;
      centre.y += spot.y / held.size;
    }
  }

  const n = ids.length;
  const spread = 130; // the distance a linked pair settles at
  const passes = passesFor(n);
  // The one loop that costs the square of the drawing, walked so that it costs the
  // square of what can still *move*. Every node comes up, movers first, and only a
  // mover opens an inner loop — so a fixed pair is never visited, and a mover meets
  // every node exactly once whichever side it is on.
  //
  // **Nothing about the result changes.** The force on a fixed node was already
  // computed and thrown away by the integration below; not computing it cannot
  // arrive anywhere else. With nothing fixed, `order` is the index order and this is
  // the pair loop it replaces, term for term.
  const movers = [];
  const anchored = [];
  for (let i = 0; i < n; i += 1) (fixed[i] ? anchored : movers).push(i);
  const order = movers.concat(anchored);
  for (let pass = 0; pass < passes; pass += 1) {
    // A fixed cooling ramp: strong early moves, fine adjustments late. Linear,
    // and read off the pass number rather than off the current state, because a
    // stopping rule that looks at the layout is what makes a layout wander.
    const heat = 1 - pass / passes;
    const dx = new Array(n).fill(0);
    const dy = new Array(n).fill(0);

    // Repulsion falls off as 1/d and attraction grows as d², which is what makes
    // a cluster a cluster: a pair with an edge between them settles at `spread`,
    // and two nodes with no edge have nothing holding them at any distance, so
    // they drift out of each other's way. A repulsion that fell off as 1/d²
    // instead let unrelated nodes sit closer than linked ones.
    for (let a = 0; a < movers.length; a += 1) {
      const i = order[a];
      for (let b = a + 1; b < order.length; b += 1) {
        const j = order[b];
        let ox = xs[i] - xs[j];
        let oy = ys[i] - ys[j];
        let dist = Math.hypot(ox, oy);
        if (dist < 1e-3) {
          // Two nodes exactly on top of each other have no direction to separate
          // along. Offset by index rather than at random, so the tie breaks the
          // same way every run.
          ox = (i % 7) - 3 || 1;
          oy = (j % 5) - 2 || 1;
          dist = Math.hypot(ox, oy);
        }
        // A hub claims room: it pushes harder, and below it is moved less.
        const push = ((spread * spread) / dist) * mass[i] * mass[j];
        dx[i] += (ox / dist) * push;
        dy[i] += (oy / dist) * push;
        dx[j] -= (ox / dist) * push;
        dy[j] -= (oy / dist) * push;
      }
    }

    for (const [a, b] of springs) {
      const ox = xs[b] - xs[a];
      const oy = ys[b] - ys[a];
      const dist = Math.hypot(ox, oy) || 1;
      const pull = (dist * dist) / spread;
      dx[a] += (ox / dist) * pull;
      dy[a] += (oy / dist) * pull;
      dx[b] -= (ox / dist) * pull;
      dy[b] -= (oy / dist) * pull;
    }

    for (const i of movers) {
      // What is fixed is where it was put, or where the drawing already had it. It
      // pushed and pulled above, which is how the rest of the case arranges itself
      // around it, but no force moves it.
      // Gravity keeps a case of several components from drifting apart forever,
      // and pulls the heaviest nodes hardest, so the busiest part of the case
      // ends up in the middle of the picture rather than on an edge of it.
      dx[i] -= (xs[i] - centre.x) * 0.9 * mass[i];
      dy[i] -= (ys[i] - centre.y) * 0.9 * mass[i];
      const force = Math.hypot(dx[i], dy[i]);
      if (force < 1e-9) continue;
      const step = Math.min(force / mass[i], spread * 0.5 * heat + 1);
      xs[i] += (dx[i] / force) * step;
      ys[i] += (dy[i] / force) * step;
    }
  }

  // `pinned` travels with the seat so the canvas can mark a hand-placed node
  // without asking a second question: a node that ignores the layout has to say so,
  // or it reads as one the layout simply left there. Read off `anchors` and not off
  // `fixed`: a node held where the drawing already had it is not one somebody placed,
  // and marking it with a pin would offer "let it go" for a choice nobody made.
  const placed = ids.map((id, i) =>
    anchors.has(id) ? { id, x: xs[i], y: ys[i], pinned: true } : { id, x: xs[i], y: ys[i] },
  );
  return placed.concat(park(loose, placed));
}

/** The unconnected column, to the right of whatever the cluster occupies. */
function park(loose, placed) {
  if (!loose.length) return [];
  const box = extent(placed);
  const left = box.maxX + PARK_GAP;
  const top = -((Math.min(loose.length, PARK_ROWS) - 1) * ROW_GAP) / 2;
  return loose.map((node, i) => ({
    id: node.id,
    x: left + Math.floor(i / PARK_ROWS) * PARK_GAP,
    y: top + (i % PARK_ROWS) * ROW_GAP,
    parked: true,
  }));
}

function parkOnly(loose) {
  const top = -((Math.min(loose.length, PARK_ROWS) - 1) * ROW_GAP) / 2;
  return loose.map((node, i) => ({
    id: node.id,
    x: Math.floor(i / PARK_ROWS) * PARK_GAP,
    y: top + (i % PARK_ROWS) * ROW_GAP,
    parked: true,
  }));
}

/**
 * Place nodes for a mode. The one entry point every caller uses, and the seam a
 * stated-time arrangement lands on without touching either existing branch.
 *
 * `pins` and `settled` reach the cluster arrangement only. A neighbourhood gives its
 * horizontal axis to distance from the root, so a coordinate stated against the
 * cluster would fight the one thing that arrangement exists to show.
 */
export function arrange(nodes, mode = 'rings', links = [], pins = new Map(), settled = new Map()) {
  return mode === 'hops' ? arrangeHops(nodes) : arrangeClusters(nodes, links, pins, settled);
}

/**
 * The bounding box of a placement, or a unit box when nothing is placed. What the
 * view transform is computed from, so an empty case does not divide by zero.
 */
export function extent(placed) {
  if (!placed.length) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of placed) {
    if (node.x < minX) minX = node.x;
    if (node.y < minY) minY = node.y;
    if (node.x > maxX) maxX = node.x;
    if (node.y > maxY) maxY = node.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Scale and offset that fit a placement inside a viewport, capped at 1 so a
 * two-node case is not blown up to fill a screen.
 */
export function fit(placed, width, height, pad = 56) {
  const box = extent(placed);
  const spanX = Math.max(box.maxX - box.minX, 1);
  const spanY = Math.max(box.maxY - box.minY, 1);
  const scale = Math.min(
    1,
    Math.max((width - pad * 2) / spanX, 0.05),
    Math.max((height - pad * 2) / spanY, 0.05),
  );
  return {
    scale,
    x: width / 2 - ((box.minX + box.maxX) / 2) * scale,
    y: height / 2 - ((box.minY + box.maxY) / 2) * scale,
  };
}

/**
 * Index a placement by id, so drawing an edge is two lookups rather than a scan.
 */
export function positionsById(placed) {
  return new Map(placed.map((node) => [node.id, node]));
}

/**
 * The edges a placement can actually draw. The server returns a closed set, so a
 * dangling edge means the payload and the placement disagree — dropping it keeps
 * the canvas honest rather than drawing a line to the origin. An edge onto its own
 * node goes too: it has no length to draw and would show as a smudge under the
 * node, while still being counted in the degree the node reports.
 */
export function drawableLinks(links, positions) {
  return links.filter(
    (link) => link.from !== link.to && positions.has(link.from) && positions.has(link.to),
  );
}

/**
 * Who each node touches, as a set of distinct neighbours.
 *
 * Distinct, not one entry per edge, because the question every fold asks is *what
 * else holds this node* — and two verbs between the same pair are one holder said
 * twice. A node's edge onto itself is left out for the same reason it is never
 * drawn: it holds nothing up.
 */
function adjacency(nodes, links) {
  const near = new Map();
  for (const node of nodes) near.set(node.id, new Set());
  for (const link of links) {
    if (link.from === link.to) continue;
    const from = near.get(link.from);
    const to = near.get(link.to);
    if (!from || !to) continue;
    from.add(link.to);
    to.add(link.from);
  }
  return near;
}

/**
 * What a fold takes off the screen, and what it leaves alone.
 *
 * Folding a node puts away **what only hung off it**: pull the node out of the
 * drawing in your head, and whatever falls off with it is what the fold takes. The
 * node itself stays, carrying the count of what it now holds.
 *
 * The rule has to answer one hard case, and the answer is the whole of why this is
 * not simply "everything one hop away". Removing a node shatters the drawing into
 * pieces, and every piece is, technically, hanging off it — including the rest of
 * the case. So:
 *
 * - a **lone node** hanging off the fold always goes. This is the clutter the fold
 *   exists for: the forty captures around one account, the identifiers under one
 *   person, none of which the drawing holds for any other reason.
 * - among the pieces that have some structure of their own, **the biggest stays**.
 *   That piece is the drawing, and a fold that could take the case away with it
 *   would be a trapdoor rather than a control.
 * - a piece holding a node the analyst **placed by hand** never goes. An arrangement
 *   somebody built is a statement that those nodes matter, and no automatic rule
 *   outranks it.
 *
 * What follows from that, and it is the guarantee worth stating: **a fold never cuts
 * a link between two nodes that both stay.** Everything it takes was joined to the
 * drawing through the node being folded and through nothing else, so the picture
 * left behind says exactly what it said before, with fewer dots.
 *
 * Deterministic like everything else here: the pieces are compared by size, then by
 * their lowest id, so the same drawing folds the same way every time.
 *
 * Returns `{ hidden, by }` — the ids that leave, and how many left because of each
 * folded node, which is the count the node then carries.
 */
export function foldAway(collapsed, nodes, links, anchors = new Set()) {
  const hidden = new Set();
  const by = new Map();
  const present = new Set(nodes.map((node) => node.id));
  const seeds = [...new Set(collapsed)].filter((id) => present.has(id));
  if (!seeds.length) return { hidden, by };

  const near = adjacency(nodes, links);
  const folded = new Set(seeds);
  // The drawing minus the folded nodes, walked into its pieces. A piece that touches
  // no folded node at all is somewhere else in the case and is never this fold's
  // business, which is what keeps folding one node from reaching across the drawing.
  const seen = new Set(folded);
  const pieces = [];
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    const members = [];
    const touches = new Set();
    const queue = [node.id];
    seen.add(node.id);
    while (queue.length) {
      const id = queue.pop();
      members.push(id);
      for (const other of near.get(id) ?? []) {
        if (folded.has(other)) {
          touches.add(other);
          continue;
        }
        if (seen.has(other)) continue;
        seen.add(other);
        queue.push(other);
      }
    }
    if (!touches.size) continue;
    pieces.push({
      members,
      touches,
      held: members.some((id) => anchors.has(id)),
      low: members.reduce((least, id) => (id < least ? id : least), members[0]),
    });
  }

  // The biggest piece with a shape of its own is the drawing, and it stays. Lone
  // nodes are never in the running: a fold that spared one arbitrary leaf out of
  // forty would look broken, and the leaf it spared would be picked by a tie-break
  // nobody can see.
  const standing = pieces
    .filter((piece) => piece.members.length > 1)
    .sort((a, b) => b.members.length - a.members.length || (a.low < b.low ? -1 : 1));
  const body = standing[0] ?? null;

  for (const piece of pieces) {
    if (piece === body || piece.held) continue;
    for (const id of piece.members) hidden.add(id);
    // Charged to the first folded node the piece touches, in the order they were
    // folded, so two folds sharing a piece do not each claim all of it and the counts
    // on screen add up to what actually left.
    const owner = seeds.find((id) => piece.touches.has(id)) ?? seeds[0];
    by.set(owner, (by.get(owner) ?? 0) + piece.members.length);
  }
  return { hidden, by };
}

/**
 * How many nodes folding this one would take, on the drawing as it currently
 * stands. What the switch on the node counts before it is pressed.
 */
export function foldableCount(id, nodes, links, anchors = new Set()) {
  return foldAway([id], nodes, links, anchors).hidden.size;
}

/**
 * Every node within `hops` steps of one node, walked over the edges given.
 *
 * **Undirected on purpose.** An arrowhead is a reading of a connection, not a wall:
 * asking what surrounds an account and being handed only what it posted — never who
 * posted about it — answers a question nobody asked. Direction is what the edge
 * *says*, and it is written on the edge; distance is what the focus *is*.
 *
 * Walked over the drawn edges rather than asked of the case, which is what keeps
 * this a reading of the picture on screen. Two hops through a node the view had to
 * cut would be a claim the drawing cannot back up, and the analyst would have no way
 * to see where the extra ring came from.
 *
 * The start is always in the set, so an unconnected node focuses on itself rather
 * than on nothing.
 */
export function ringsAround(links, start, hops = 1) {
  const reached = new Set([start]);
  if (!start || hops < 1) return reached;
  const near = new Map();
  for (const link of links) {
    if (!near.has(link.from)) near.set(link.from, []);
    if (!near.has(link.to)) near.set(link.to, []);
    near.get(link.from).push(link.to);
    near.get(link.to).push(link.from);
  }
  let frontier = [start];
  for (let step = 0; step < hops && frontier.length; step += 1) {
    const next = [];
    for (const id of frontier) {
      for (const other of near.get(id) ?? []) {
        if (reached.has(other)) continue;
        reached.add(other);
        next.push(other);
      }
    }
    frontier = next;
  }
  return reached;
}

/**
 * The four ways an edge is drawn, and what each one means.
 *
 * One table, read by both the stroke and the legend, because an unexplained dash
 * pattern is decoration: the analyst has no way to learn that fine dots mean a
 * mention. The semantics ride on the line rather than on the colour, so the
 * picture survives being printed in black and white — which is what happens to a
 * graph that reaches a report.
 */
export const EDGE_KINDS = [
  { kind: 'lineage', label: 'produced from', dash: [], width: 1.7 },
  { kind: 'stated', label: 'stated relation', dash: [8, 5], width: 1.3 },
  // Drawn apart from every other thing an analyst states, because it is the only
  // verb saying two rows of the case cannot both stand: a reader scanning a
  // statement cluster has to see the argument without reading the labels. Dash-dot
  // rather than a hue, for the reason the whole table is patterns — the families own
  // the palette and a report prints grey — and a long dash broken by a beat is what
  // opposition looks like on paper.
  { kind: 'contradiction', label: 'contradicts', dash: [10, 4, 2, 4], width: 1.8 },
  { kind: 'mention', label: 'mentions', dash: [1.5, 4], width: 1 },
  // Thicker because it stands for several, and worded so the picture says which lines
  // are a path rather than a row: an edge that folded three citations is not the same
  // object as one the analyst stated, and it cannot be confirmed or removed. The
  // wording is the edge panel's own — *drawn as one edge* — because **fold** is what
  // an expansion does in this tool, and one word cannot name two acts.
  { kind: 'folded', label: 'sources, drawn as one edge', dash: [8, 5], width: 2.4 },
  { kind: 'proposed', label: 'proposed, not confirmed', dash: [3, 5], width: 1 },
];

const EDGE_BY_KIND = new Map(EDGE_KINDS.map((entry) => [entry.kind, entry]));

/** Which of the six an edge is. A proposal is drawn as one whatever its verb, and a
 *  fold as one whatever it folded — the two are the same rule, applied to the two
 *  things an edge can be besides its verb. */
export function edgeKind(link, chainTypes = []) {
  if (link.provenance?.status === 'suggested') return 'proposed';
  if (link.folded) return 'folded';
  if (chainTypes.includes(link.type)) return 'lineage';
  if (link.type === 'contradicts') return 'contradiction';
  if (link.type === 'mentions') return 'mention';
  return 'stated';
}

/**
 * How an edge is stroked, including its head. **Every edge carries one**: the
 * vocabulary is directed — a photo is recorded at a place, never the reverse — so
 * a line without a head hides half of what the edge says.
 */
export function edgeStyle(link, chainTypes = []) {
  const kind = edgeKind(link, chainTypes);
  return { ...EDGE_BY_KIND.get(kind), kind };
}

/** How far apart parallel edges are pulled at their midpoint. */
const BEND_GAP = 22;

/**
 * How much each edge bows out of the straight line.
 *
 * Two nodes can hold several edges — a unit that owns a vehicle and is mentioned
 * by the report naming it — and drawn straight they land on top of each other, so
 * the picture says "one link" where the case says two. Each edge of a pair is bent
 * to its own side of the line, and the order is the payload's own so the bend does
 * not change between reads.
 */
export function parallelBends(links) {
  const groups = new Map();
  for (const link of links) {
    const pair = [link.from, link.to].sort().join('\u0000');
    if (!groups.has(pair)) groups.set(pair, []);
    groups.get(pair).push(link);
  }
  const bends = new Map();
  for (const group of groups.values()) {
    group.forEach((link, index) => {
      bends.set(link.id, group.length === 1 ? 0 : (index - (group.length - 1) / 2) * BEND_GAP);
    });
  }
  return bends;
}

/**
 * The points an edge is drawn through, cut back to the rim of the nodes it joins.
 *
 * Cut back because a head buried under the target circle points at nothing, and
 * an arrow that starts at the centre of a hub is a line across it. A bend adds a
 * third point off the midpoint, which is what separates parallel edges.
 */
export function edgePoints(from, to, fromRadius, toRadius, bend = 0) {
  const ox = to.x - from.x;
  const oy = to.y - from.y;
  const dist = Math.hypot(ox, oy) || 1;
  const ux = ox / dist;
  const uy = oy / dist;
  // The head needs a little air off the rim, or it reads as touching the node.
  const start = { x: from.x + ux * (fromRadius + 2), y: from.y + uy * (fromRadius + 2) };
  const end = { x: to.x - ux * (toRadius + 6), y: to.y - uy * (toRadius + 6) };
  if (!bend) return [start.x, start.y, end.x, end.y];
  const mid = {
    x: (start.x + end.x) / 2 - uy * bend,
    y: (start.y + end.y) / 2 + ux * bend,
  };
  return [start.x, start.y, mid.x, mid.y, end.x, end.y];
}

/**
 * Where an edge's verb is written: beside the line rather than on it.
 *
 * `lift` is in canvas units and pushes the words off the stroke, perpendicular to
 * it. Written on the line, a verb is read through its own dashes; written at the
 * exact midpoint of a hub's edge, it lands on the hub's own label.
 */
export function edgeMidpoint(points, lift = 0) {
  const bowed = points.length >= 6;
  const end = bowed ? { x: points[4], y: points[5] } : { x: points[2], y: points[3] };
  const chord = { x: (points[0] + end.x) / 2, y: (points[1] + end.y) / 2 };
  const at = bowed ? { x: points[2], y: points[3] } : chord;
  if (!lift) return at;
  if (bowed) {
    // Lifted the way the bow already leans, which pulls two parallel edges' words
    // apart instead of stacking them one over the other.
    const ox = at.x - chord.x;
    const oy = at.y - chord.y;
    const away = Math.hypot(ox, oy) || 1;
    return { x: at.x + (ox / away) * lift, y: at.y + (oy / away) * lift };
  }
  const ox = end.x - points[0];
  const oy = end.y - points[1];
  const dist = Math.hypot(ox, oy) || 1;
  // Always lifted towards the top of the canvas, so the two halves of a path
  // through one node do not write their verbs on the same spot.
  const sign = oy > 0 ? -1 : 1;
  return { x: at.x + (oy / dist) * lift * sign, y: at.y - (ox / dist) * lift * sign };
}

/**
 * The mini card a node becomes when the view is close enough to read one.
 *
 * In **screen** pixels, not canvas units, which is what makes the card viable at
 * all: drawn in canvas units a 158-wide card would overlap its neighbours at every
 * zoom, since the placement only spaces nodes 130 apart. Held at a fixed size on
 * screen, the gap between two nodes grows with the zoom while the card does not,
 * so past `CARD_SCALE` the cards have room and below it they would not.
 */
export const CARD = { w: 176, h: 50, art: 34, pad: 8, stripe: 4 };

/** The zoom past which a node is worth drawing as a card rather than as a dot. */
export const CARD_SCALE = 1.15;

/**
 * How far the rim of a card sits from its centre, along one direction.
 *
 * An arrow has to stop at the edge of what it points at, and in card mode that is
 * a rectangle rather than a circle. Exact for a centred axis-aligned box: whichever
 * side the ray leaves through is the nearer of the two crossings.
 */
export function boxRadius(halfWidth, halfHeight, dx, dy) {
  const ux = Math.abs(dx);
  const uy = Math.abs(dy);
  if (ux < 1e-9) return halfHeight;
  if (uy < 1e-9) return halfWidth;
  const length = Math.hypot(ux, uy);
  return Math.min((halfWidth * length) / ux, (halfHeight * length) / uy);
}

/**
 * Fit a picture inside the card's art box without distorting it.
 *
 * A thumbnail is whatever shape its source was — a screenshot is wide, a phone
 * photo is tall — and stretching both into a square makes a row of cards look
 * wrong in a way that is hard to name and easy to see.
 */
export function fitInside(naturalWidth, naturalHeight, box) {
  const width = Math.max(Number(naturalWidth) || 0, 1);
  const height = Math.max(Number(naturalHeight) || 0, 1);
  const scale = Math.min(box / width, box / height);
  const drawn = { w: width * scale, h: height * scale };
  return { ...drawn, dx: (box - drawn.w) / 2, dy: (box - drawn.h) / 2 };
}

/**
 * The node under a point on the canvas, or null.
 *
 * Hit-testing in canvas units rather than asking the renderer, because the answer
 * is needed while a link is being dragged — when the shape under the pointer is
 * covered by the rubber band being drawn over it. Geometry has no such problem,
 * and it is the same geometry the arrows already stop at: a circle below the card
 * zoom, a box above it.
 *
 * The nearest match wins, so two overlapping nodes resolve to the one whose centre
 * is closer rather than to whichever was drawn last.
 */
export function nodeAt(placed, byId, point, { carded = false, scale = 1 } = {}) {
  let best = null;
  let closest = Infinity;
  const half = { x: CARD.w / 2 / scale, y: CARD.h / 2 / scale };
  for (const seat of placed) {
    const dx = point.x - seat.x;
    const dy = point.y - seat.y;
    const inside = carded
      ? Math.abs(dx) <= half.x && Math.abs(dy) <= half.y
      : Math.hypot(dx, dy) <= nodeRadius(byId.get(seat.id)?.degree) + 4;
    if (!inside) continue;
    const away = Math.hypot(dx, dy);
    if (away < closest) {
      closest = away;
      best = seat.id;
    }
  }
  return best;
}

/**
 * A node's radius: a hub reads as a hub without a label being counted. Growth is
 * by square root so a degree-80 node is legible beside a degree-2 one instead of
 * swallowing the canvas.
 */
export function nodeRadius(degree) {
  // A node whose degree never arrived still has to draw. `Math.max` propagates a
  // NaN rather than clamping it, so the value is coerced before it is compared.
  const edges = Math.max(Number(degree) || 0, 0);
  return 11 + Math.min(Math.sqrt(edges) * 2.6, 13);
}

/**
 * Shorten a label to fit under a node. Long labels are the fastest way to turn a
 * readable graph into a wall of text, and the full value is one click away in
 * Details.
 */
export function shortLabel(label, max = 22) {
  const text = String(label ?? '').trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * The drawing as one string, for the undo stack.
 *
 * The graph is unusual in what it costs to undo: the picture is **derived** from a
 * handful of explicit lists, so there is no inverse to write per act and no inverse
 * that can be wrong. Remember the lists, put them back, and every act that has ever
 * edited the drawing is undone by the same six lines — including the ones added
 * later, which is what keeps this from rotting.
 *
 * Serialized here rather than in the component because the history compares
 * snapshots as strings: two states that differ only in the order a `Set` iterated
 * would fork the timeline and record an act nobody performed. What has no meaningful
 * order is sorted; what carries the analyst's own order is left in it.
 */
export function drawingSnapshot(state = {}) {
  return JSON.stringify({
    lens: state.lens ?? 'all',
    order: state.order ?? 'degree',
    root: state.root ?? null,
    hops: state.hops ?? 1,
    folder: state.folder ?? '',
    families: [...(state.families ?? [])].sort(),
    // Left in the order they were asked for: the case echoes these back in it, and
    // it is the analyst's own list rather than a set the drawing happens to hold.
    kept: [...(state.kept ?? [])],
    expanded: [...(state.expanded ?? [])],
    omitted: [...(state.omitted ?? [])],
    collapsed: [...(state.collapsed ?? [])],
    putAway: Object.fromEntries(
      Object.entries(state.putAway ?? {})
        .map(([id, gone]) => [id, [...gone].sort()])
        .sort(([one], [two]) => (one < two ? -1 : one > two ? 1 : 0)),
    ),
    arrangement: [...(state.arrangement ?? [])]
      .map((spot) => ({ id: spot.id, x: spot.x, y: spot.y }))
      .sort((one, two) => (one.id < two.id ? -1 : one.id > two.id ? 1 : 0)),
  });
}

/**
 * What has to be filed to put an arrangement back: the pins to place, and the ones
 * to let go of.
 *
 * Read over the nodes **currently drawn** on both sides, which is the guard that
 * matters: a pinned node the budget cut or a filter left out is in neither list, so
 * an undo can never drop an arrangement it could not see.
 */
export function arrangementDiff(now = [], want = []) {
  const at = new Map(now.map((spot) => [spot.id, spot]));
  const wanted = new Map(want.map((spot) => [spot.id, spot]));
  return {
    place: want.filter((spot) => {
      const had = at.get(spot.id);
      return !had || had.x !== spot.x || had.y !== spot.y;
    }),
    drop: now.filter((spot) => !wanted.has(spot.id)).map((spot) => spot.id),
  };
}
