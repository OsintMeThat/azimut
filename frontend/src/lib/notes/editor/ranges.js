/**
 * Where the drawn blocks are, read once for every part of the editor that needs
 * them: the keys that step over a block, a press that opens one, the jump to a line,
 * and the selection bubble, the block handle and the grid that will sit on them.
 *
 * A block is `{ from, to, kind }`: the whole lines it is drawn over, and the name of
 * its kind in `editor/blocks.js`.
 */
import { blockKind, blockKindOf } from './blocks.js';
import { drawn } from './decorations.js';
import { setOpenBlock } from './state.js';

/** The blocks drawn now that touch `from`–`to`, as `{ from, to, kind }`: the ones whose source is closed. */
export function blocksIn(state, from, to = from) {
  const found = [];
  state.field(drawn, false)?.between(Math.max(0, from), Math.min(state.doc.length, to), (start, end, value) => {
    const kind = blockKindOf(value.spec.widget);
    if (kind) found.push({ from: start, to: end, kind });
  });
  return found;
}

/** The block the cursor stands at the start of, which is picked, or null. */
export function pickedBlock(state) {
  const range = state.selection.main;
  return range.empty ? blocksIn(state, range.head).find((block) => block.from === range.head) ?? null : null;
}

/** A cursor at a block's start, inside it or at its end goes to its start, where it is picked. */
export function settle(state, pos) {
  return blocksIn(state, pos).find((block) => block.from <= pos && pos <= block.to)?.from ?? pos;
}

/** Open `block`'s source in place, the cursor at its start: what a kind does unless it says otherwise. */
export function openSource(view, block) {
  view.dispatch({ selection: { anchor: block.from }, effects: setOpenBlock.of({ from: block.from, to: block.to }), scrollIntoView: true });
  view.focus();
  return true;
}

/** Open the block drawn at `at` (a position, or its element), as its kind opens. */
export function openBlockAt(view, at) {
  const pos = typeof at === 'number' ? at : view.posAtDOM(at);
  const block = blocksIn(view.state, pos).find((item) => item.from <= pos && pos <= item.to);
  if (!block) return false;
  return (blockKind(block.kind)?.open ?? openSource)(view, block);
}
