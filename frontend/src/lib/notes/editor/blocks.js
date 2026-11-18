/**
 * The kinds of block the note page draws whole: a picture, a table, a diagram, an
 * aligned block, steps and a story, a map, an HTML block, a chapter, a page break and
 * the end of the cover. Each kind is a module that registers itself here, and the
 * page (`editor/decorations.js`), the ranges the cursor and the handle read
 * (`editor/ranges.js`) and the drawn block (`editor/widgets.js`) ask this registry
 * rather than knowing any kind by name. `editor/kinds.js` loads them, in order.
 *
 * A kind says:
 *
 * - **how it is found and its range**, one of three ways, each answering
 *   `{ from, to, ...data }`, the stretch it covers (whole lines are drawn), or null
 *   when what was found is not one. `ctx` is the page being worked out
 *   (`editor/decorations.js` says what it holds).
 *   `fence` is the line a `:::` block opens with (a RegExp), the block running to
 *   the first line `close` matches (`:::` alone unless it says otherwise);
 *   `read({ match, from, to, first, last }, ctx)` may narrow it, or answer null to leave
 *   it to the next kind the line opens; the whole block else.
 *   `node` is the name, or names, of the syntax-tree node it is (`Table`,
 *   `FencedCode`, `Image`, `CommentBlock`), and `read(node, ctx)` says whether this
 *   one is. `line(line, ctx)` reads a line of its own the Markdown parser does not
 *   see as a block, line by line after the tree. A kind may be found two ways (a
 *   picture is an `Image` node and a `[[media:…]]` line).
 * - **its widget**: `widget(spec)` makes what stands in its lines. `spec` holds
 *   `kind`, `source` (its lines), `info` (the case), `writable`, `blockAlign` (the
 *   place of the aligned block it stands in), `pinned`, `picked` and whatever `read`
 *   answered. Most kinds draw with the shared `blockWidget` (`editor/widgets.js`),
 *   which calls back `draw(box, widget, view)` to fill its box.
 * - **its source**: `source(ctx, range)` dresses its lines while it is open, and
 *   answers whether it did: false leaves them to the ordinary marks (a diagram's
 *   lines are then code). A fence's first and last lines are greyed by default.
 * - **whether it is atomic**: `atomic` (true for every block today) makes the cursor
 *   step over it whole and a delete take it whole.
 * - **how it opens**: `open(view, block)`, on a double press, Enter or its `</>`.
 *   Without one, its source opens in place (`openSource` in `editor/ranges.js`).
 *
 * And optionally: `height` (an estimate before it is drawn, in pixels), `fallback`
 * (read after every other kind of the same node), `tools(box, widget, view)` (a bar
 * of its own, which then carries its `</>`), `bar` (the selector of that bar, whose
 * presses go to `press(target, box, view)` rather than picking the block), `fields`
 * (the selector of inputs it holds, whose keys and presses the editor leaves alone),
 * `listen(box, widget, view)` (more listeners on its box), `mousedown(event, view,
 * handlers)` (a press the editor sees on it, answering whether it took it) and
 * `theme` (its own rules, after the editor's sheet).
 */

const kinds = [];
const byName = new Map();
let byNode = null;

/**
 * Add a kind, or replace the one of that name where it stands: a later module can
 * give tables a grid by registering `{ ...blockKind('table'), open }`.
 */
export function registerBlock(kind) {
  if (!kind?.name || typeof kind.widget !== 'function') throw new Error('A block kind needs a name and a widget');
  if (!kind.fence && !kind.node && !kind.line) throw new Error(`Block kind ${kind.name} says neither fence, node nor line`);
  const at = kinds.findIndex((one) => one.name === kind.name);
  if (at >= 0) kinds[at] = kind;
  else kinds.push(kind);
  byName.set(kind.name, kind);
  byNode = null;
  return kind;
}

/** Take a kind out again (for tests of a kind of their own). */
export function unregisterBlock(name) {
  const at = kinds.findIndex((one) => one.name === name);
  if (at >= 0) kinds.splice(at, 1);
  byName.delete(name);
  byNode = null;
}

/** The kind called `name`, or null. */
export function blockKind(name) {
  return byName.get(name) ?? null;
}

/** Every kind, in the order they were registered. */
export function blockKinds() {
  return kinds;
}

/** The kinds found as `:::` blocks, in order. */
export function fenceKinds() {
  return kinds.filter((kind) => kind.fence);
}

/** The kinds found as lines of their own, in order. */
export function lineKinds() {
  return kinds.filter((kind) => kind.line);
}

/** The kinds a syntax-tree node called `name` may be, in order, the fallbacks last. */
export function nodeKinds(name) {
  if (!byNode) {
    byNode = new Map();
    const ordered = [...kinds.filter((kind) => !kind.fallback), ...kinds.filter((kind) => kind.fallback)];
    for (const kind of ordered) {
      for (const node of [kind.node ?? []].flat()) {
        if (!byNode.has(node)) byNode.set(node, []);
        byNode.get(node).push(kind);
      }
    }
  }
  return byNode.get(name) ?? [];
}

/** The kind of block a widget draws, or null for anything else (a chip, a task box). */
export function blockKindOf(widget) {
  return widget?.blockKind ?? null;
}

/** Whether a widget stands for a block the cursor steps over and a delete takes whole. */
export function isAtomic(widget) {
  const name = blockKindOf(widget);
  return name !== null && (byName.get(name)?.atomic ?? true);
}
