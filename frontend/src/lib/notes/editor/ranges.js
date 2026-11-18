/**
 * Where the blocks are, read once for every part of the editor that needs them:
 * the keys that step over a block, a press that opens one, the jump to a line, and
 * the selection bubble, the block handle and the grid that sit on them.
 *
 * A drawn block is `{ from, to, kind }`: the whole lines it is drawn over, and the
 * name of its kind in `editor/blocks.js`.
 */
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';

import { calloutOf } from '../callouts.js';
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

/** The blocks of Markdown the syntax tree reads at the top of the note, by node, as the handle names them. */
const MARKDOWN_BLOCKS = {
  Paragraph: 'paragraph',
  SetextHeading1: 'heading',
  SetextHeading2: 'heading',
  BulletList: 'list',
  OrderedList: 'list',
  Blockquote: 'quote',
  FencedCode: 'code',
  CodeBlock: 'code',
  HorizontalRule: 'rule',
  HTMLBlock: 'html',
  CommentBlock: 'html',
  Table: 'table',
};

/** The blocks of Markdown that hold others: a drawn block inside one is part of it. */
const CONTAINERS = new Set(['list', 'quote', 'callout']);

/**
 * Every block of the note, top to bottom, over whole lines, as `{ from, to, kind,
 * drawn }`: a block drawn now as one, its kind from the registry (`drawn` true), and
 * around them each block of Markdown the syntax tree reads at the top of the note,
 * as `paragraph`, `heading`, `list`, `quote`, `callout`, `code`, `table`, `rule` or
 * `html`. A paragraph a drawn block stands in (a picture right under a line of
 * words) keeps the lines left over; a quote, a callout or a list a drawn block
 * stands in (a table in an internal passage) is one block with it. An open block,
 * and every block in the raw Markdown, is read as its Markdown. What the block
 * handle sits on and moves.
 */
export function blockRanges(state) {
  const whole = blocksIn(state, 0, state.doc.length).map((block) => ({ ...block, drawn: true }));
  const found = [...whole];
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
  const under = (pos) => whole.some((block) => pos >= block.from && pos <= block.to);
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    const name = /^ATXHeading[1-6]$/.test(node.name) ? 'heading' : MARKDOWN_BLOCKS[node.name];
    if (!name) continue;
    const kind = name === 'quote' && calloutOf(state.doc.lineAt(node.from).text) ? 'callout' : name;
    // a quote, a callout or a list holding a drawn block (a table, a diagram) is one block with it
    if (CONTAINERS.has(kind)) {
      const start = state.doc.lineAt(node.from).from;
      const end = state.doc.lineAt(node.to).to;
      const held = whole.filter((block) => block.from >= start && block.to <= end);
      if (held.length) {
        for (const block of held) found.splice(found.indexOf(block), 1);
        found.push({ from: start, to: end, kind, drawn: false });
        continue;
      }
    }
    // the lines of it no drawn block stands on, a run at a time
    let run = null;
    for (let number = state.doc.lineAt(node.from).number; number <= state.doc.lineAt(node.to).number; number += 1) {
      const line = state.doc.line(number);
      if (under(line.from)) {
        run = null;
        continue;
      }
      if (run) run.to = line.to;
      else {
        run = { from: line.from, to: line.to, kind, drawn: false };
        found.push(run);
      }
    }
  }
  return found.sort((a, b) => a.from - b.from);
}
