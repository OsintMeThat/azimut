/**
 * What Enter, Backspace, Delete and Tab do on the drawn page, where a line's marks
 * never show, so the keys act on what the analyst sees: a heading, a list item, a
 * quote or a callout.
 *
 * - **Enter** continues a list, a quote or a callout (Markdown's own Enter does it);
 *   on an empty item or an empty last line of a quote it leaves them, with the blank
 *   line Markdown needs so what is written next is not taken into them; at the start
 *   of a heading or an item it opens a line above, the words staying where they are.
 * - **Backspace** at the start of a line's words: a heading becomes a paragraph, an
 *   item comes out of its list (out of one level when nested), a quote's line joins
 *   the one above, a quote or a callout becomes text. Elsewhere it takes the character
 *   that shows before the caret, never half of a mark (`editor/caret.js`).
 * - **Delete** takes the character that shows after the caret; at the end of a line the
 *   next line's words come up, its marks left behind.
 * - **Tab** and **Shift+Tab** nest an item under the one before it and take it back out;
 *   on any other line Tab does nothing, as four spaces would turn words into code.
 *
 * Each answers a transaction spec from a state, one Undo step, so it is tested without
 * a browser; `{}` takes the key and changes nothing.
 */
import { EditorSelection, Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';

import { calloutOf } from '../callouts.js';
import { caretAt, chainAt, keyOf, unitAfter, unitBefore, wordsStart } from './caret.js';
import { shownCard } from './citationCard.js';
import { blockRanges, blocksIn } from './ranges.js';
import { TEXT_KINDS, turnInto } from './turnInto.js';

function treeOf(state, upto) {
  return ensureSyntaxTree(state, Math.min(state.doc.length, upto + 1), 200) ?? syntaxTree(state);
}

/** A line's quote marks, `> ` or `> > `, as written. */
function quoteOf(text) {
  return /^(?:[ \t]*>[ \t]?)*/.exec(text)[0];
}

/**
 * What a line is, by the marks before its words: `{ type: 'heading' }`, `{ type: 'item',
 * item }` (the list item it starts), `{ type: 'quote', quote }` (the innermost quote it
 * is in), or null for a line of words.
 */
export function lineShape(state, line) {
  let heading = null;
  let item = null;
  let quote = null;
  treeOf(state, line.to).iterate({
    from: line.from,
    to: line.to,
    enter: (node) => {
      const starts = state.doc.lineAt(node.from).number === line.number;
      if (/^ATXHeading[1-6]$/.test(node.name) && starts) heading = node.node;
      else if (node.name === 'ListItem' && starts && node.node.getChild('ListMark')) item = node.node;
      else if (node.name === 'Blockquote' && node.to >= line.from) quote = node.node;
      else if (node.name === 'FencedCode' || node.name === 'CodeBlock') return false;
      return undefined;
    },
  });
  if (heading) return { type: 'heading', node: heading };
  if (item && (!quote || item.from >= quote.from)) return { type: 'item', item };
  if (quote) return { type: 'quote', quote };
  return null;
}

/** Whether the line before `line` holds words, which a line after it would join without a blank line between. */
function wordsAbove(state, line) {
  if (line.number <= 1) return false;
  const before = state.doc.line(line.number - 1).text;
  return Boolean(before.slice(quoteOf(before).length).trim());
}

/** The block of words a line stands in, as the handle reads it, for `turnInto`. */
function wordsBlock(state, line) {
  return blockRanges(state).find((block) => block.from <= line.from && line.to <= block.to && TEXT_KINDS.has(block.kind)) ?? null;
}

/** The block of words of `line` turned into `shape`, as the handle's Turn into writes it. */
function turnLine(state, line, shape) {
  const block = wordsBlock(state, line);
  return (block && turnInto(state, block, shape)) ?? {};
}

// -- lists ------------------------------------------------------------------------

/** How far an item's words start from its mark: what a line nested under it is indented by. */
function markWidth(state, item) {
  const mark = item.getChild('ListMark');
  const line = state.doc.lineAt(mark.from);
  const spaces = /^[ \t]*/.exec(state.sliceDoc(mark.to, line.to))[0].length;
  return mark.to - mark.from + Math.min(Math.max(spaces, 1), 4);
}

/** The item a nested item stands under, or null at the top of its list. */
function parentItem(item) {
  const above = item.parent?.parent;
  return above?.name === 'ListItem' ? above : null;
}

/** The items around `item` in its list, after it. */
function itemsAfter(item) {
  const found = [];
  for (let next = item.nextSibling; next; next = next.nextSibling) if (next.name === 'ListItem') found.push(next);
  return found;
}

/** A numbered item's number written anew, or nothing for a bullet. */
function renumber(state, item, number) {
  const mark = item.getChild('ListMark');
  const written = state.sliceDoc(mark.from, mark.to);
  if (!/^\d/.test(written)) return [];
  const wanted = `${number}${written.slice(-1)}`;
  return wanted === written ? [] : [{ from: mark.from, to: mark.to, insert: wanted }];
}

function numberOf(state, item) {
  const mark = item.getChild('ListMark');
  return Number.parseInt(state.sliceDoc(mark.from, mark.to), 10);
}

/** The lines of `item`, nested items and words under it included. */
function itemLines(state, item) {
  const lines = [];
  for (let number = state.doc.lineAt(item.from).number; number <= state.doc.lineAt(item.to).number; number += 1) lines.push(state.doc.line(number));
  return lines;
}

/**
 * The items whose marks are on the lines `range` touches, the outermost only: what Tab
 * nests and Shift+Tab takes out.
 */
function itemsOf(state, range) {
  const first = state.doc.lineAt(range.from).number;
  const last = state.doc.lineAt(range.to).number;
  const found = [];
  treeOf(state, range.to).iterate({
    from: state.doc.line(first).from,
    to: state.doc.line(last).to,
    enter: (node) => {
      if (node.name !== 'ListItem' || !node.node.getChild('ListMark')) return undefined;
      const at = state.doc.lineAt(node.from).number;
      if (at < first || at > last) return undefined;
      found.push(node.node);
      // an item nested in one taken moves with it
      return false;
    },
  });
  return found;
}

/** `item` nested under the one before it (`step` 1) or taken out of the one it is in (-1), its words and nested items with it. */
function nestItem(state, item, step, alone) {
  const changes = [];
  const first = state.doc.lineAt(item.from);
  const column = item.from - first.from;
  if (step > 0) {
    let before = item.prevSibling;
    while (before && before.name !== 'ListItem') before = before.prevSibling;
    if (!before) return null;
    const pad = markWidth(state, before);
    for (const line of itemLines(state, item)) {
      const lead = /^[\s>]*/.exec(line.text)[0].length;
      changes.push({ from: line.from + Math.min(column, lead), insert: ' '.repeat(pad) });
    }
    if (alone) {
      // the first of a new list under the item before counts from 1; one more after the list there already
      const under = before.lastChild?.name === 'OrderedList' || before.lastChild?.name === 'BulletList' ? before.lastChild : null;
      const last = under ? [...itemsAfter(under.firstChild)].at(-1) ?? under.firstChild : null;
      changes.push(...renumber(state, item, last && /^\d/.test(state.sliceDoc(last.from, last.from + 1)) ? numberOf(state, last) + 1 : 1));
      for (const next of itemsAfter(item)) changes.push(...renumber(state, next, numberOf(state, next) - 1));
    }
    return changes;
  }
  const parent = parentItem(item);
  if (!parent) return null;
  const pad = column - (parent.from - state.doc.lineAt(parent.from).from);
  for (const line of itemLines(state, item)) {
    const quote = quoteOf(line.text).length;
    const spaces = /^[ \t]*/.exec(line.text.slice(quote))[0].length;
    const cut = Math.min(pad, spaces);
    if (cut) changes.push({ from: line.from + quote, to: line.from + quote + cut });
  }
  if (alone) {
    if (/^\d/.test(state.sliceDoc(parent.from, parent.from + 1))) changes.push(...renumber(state, item, numberOf(state, parent) + 1));
    // the items after it in its list now stand under it: they count from 1
    itemsAfter(item).forEach((next, index) => changes.push(...renumber(state, next, index + 1)));
  }
  return changes;
}

/**
 * Tab (`step` 1) or Shift+Tab (-1) on the items the selection touches; on any other line
 * nothing, code keeping its Tab and a citation's card, shown at the caret, taking it.
 */
export function indentItems(state, step) {
  if (shownCard(state)?.by === 'caret') return null;
  const range = state.selection.main;
  const items = itemsOf(state, range);
  if (!items.length) {
    const tree = treeOf(state, range.head);
    for (let node = tree.resolveInner(range.head, -1); node; node = node.parent) {
      if (node.name === 'FencedCode' || node.name === 'CodeBlock') return null;
    }
    return {};
  }
  const changes = [];
  for (const item of items) changes.push(...(nestItem(state, item, step, items.length === 1) ?? []));
  if (!changes.length) return {};
  const set = state.changes(changes);
  return { changes: set, selection: state.selection.map(set, 1), userEvent: step > 0 ? 'input.indent' : 'delete.dedent' };
}

/**
 * An item out of its list: a nested one out of one level; one at the top a paragraph
 * of its own, blank lines parting it from the list around it, its quote marks kept.
 */
function liftItem(state, line, item) {
  if (parentItem(item)) {
    const changes = nestItem(state, item, -1, true);
    if (!changes?.length) return {};
    const set = state.changes(changes);
    return { changes: set, selection: state.selection.map(set, 1), userEvent: 'delete.dedent' };
  }
  const quote = quoteOf(line.text);
  const start = wordsStart(state, line);
  const changes = [];
  if (wordsAbove(state, line)) changes.push({ from: line.from, insert: `${quote.trimEnd()}${state.lineBreak}` });
  changes.push({ from: line.from + quote.length, to: start });
  const last = state.doc.lineAt(item.to);
  if (last.number < state.doc.lines) {
    const after = state.doc.line(last.number + 1).text;
    if (after.slice(quoteOf(after).length).trim()) changes.push({ from: last.to, insert: `${state.lineBreak}${quote.trimEnd()}` });
  }
  const set = state.changes(changes);
  return { changes: set, selection: EditorSelection.cursor(set.mapPos(start, 1)), userEvent: 'delete.lift' };
}

/** Enter on an item with no words: out of its list (one level, when nested), the line left for what comes next. */
function leaveItem(state, line, item) {
  if (parentItem(item)) return liftItem(state, line, item);
  const quote = quoteOf(line.text);
  const insert = wordsAbove(state, line) ? `${quote.trimEnd()}${state.lineBreak}${quote}` : quote;
  return { changes: { from: line.from, to: line.to, insert }, selection: EditorSelection.cursor(line.from + insert.length), userEvent: 'input' };
}

/** Enter at the start of an item's words: an empty item above it, the words staying with the caret. */
function itemAbove(state, line, item, pos) {
  let insert = `${state.sliceDoc(line.from, wordsStart(state, line)).replace(/\[[xX]\]/, '[ ]')}${state.lineBreak}`;
  // an empty item cannot follow a line of words: Markdown would read it as underlining them
  const firstItem = !item.prevSibling;
  if (firstItem && wordsAbove(state, line)) insert = `${state.lineBreak}${insert}`;
  return { changes: { from: line.from, insert }, selection: EditorSelection.cursor(pos + insert.length), userEvent: 'input' };
}

// -- the keys ---------------------------------------------------------------------

/** Enter on a line with marks; null leaves it to Markdown's own Enter, which continues a list or a quote. */
export function enterAt(state) {
  const range = state.selection.main;
  if (!range.empty || state.selection.ranges.length > 1) return null;
  const pos = range.head;
  const line = state.doc.lineAt(pos);
  const start = wordsStart(state, line);
  if (start === line.from) return null;
  const shape = lineShape(state, line);
  if (!shape) return null;
  const words = state.sliceDoc(start, line.to).trim();
  const atStart = chainAt(state, pos).from <= start;
  if (shape.type === 'item') {
    if (!words) return leaveItem(state, line, shape.item);
    return atStart ? itemAbove(state, line, shape.item, pos) : null;
  }
  if (shape.type === 'quote') {
    if (words || state.doc.lineAt(shape.quote.to).number !== line.number) return null;
    const first = state.doc.lineAt(shape.quote.from).number === line.number;
    // a callout's name alone goes on to its first line of words
    if (first && calloutOf(line.text)) return null;
    const insert = first ? '' : state.lineBreak;
    return { changes: { from: line.from, to: line.to, insert }, selection: EditorSelection.cursor(line.from + insert.length), userEvent: 'input' };
  }
  if (shape.type === 'heading' && atStart && words) {
    return { changes: { from: line.from, insert: state.lineBreak }, selection: EditorSelection.cursor(pos + state.lineBreak.length), userEvent: 'input' };
  }
  return null;
}

/** Backspace: the character that shows before the caret, or, at the start of a line's words, what that line is undone. */
export function backspaceAt(state) {
  const range = state.selection.main;
  if (!range.empty || state.selection.ranges.length > 1) return null;
  const pos = range.head;
  const line = state.doc.lineAt(pos);
  const start = wordsStart(state, line);
  const at = chainAt(state, pos).from;
  if (at > start) {
    const from = unitBefore(state, at);
    return { changes: { from, to: at }, selection: EditorSelection.cursor(from), userEvent: 'delete.backward' };
  }
  // a line of words: Markdown's own Backspace joins it to the line before
  if (start === line.from) return null;
  const shape = lineShape(state, line);
  if (!shape) return null;
  if (shape.type === 'heading') return turnLine(state, line, 'paragraph');
  if (shape.type === 'item') return liftItem(state, line, shape.item);
  const firstLine = state.doc.lineAt(shape.quote.from);
  if (firstLine.number === line.number) {
    // an internal passage is never made public by a slip of the key: its menu says Make public
    if (calloutOf(line.text)?.kind === 'internal') return {};
    return turnLine(state, line, 'paragraph');
  }
  // a later line of a quote joins the one before, inside the quote
  const before = state.doc.line(line.number - 1);
  const words = state.sliceDoc(start, line.to);
  if (calloutOf(before.text) && !before.text.replace(/^(\s*>\s*)\[![A-Za-z]+\]\s*/, '').trim() && /^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|```|\|)/.test(words)) return {};
  const end = caretAt(state, before.to, { pick: false });
  return { changes: { from: before.to, to: start }, selection: EditorSelection.cursor(end), userEvent: 'delete.backward' };
}

/** Delete: the character that shows after the caret, or, at the end of a line, the next line's words brought up. */
export function deleteAt(state) {
  const range = state.selection.main;
  if (!range.empty || state.selection.ranges.length > 1) return null;
  const pos = range.head;
  const line = state.doc.lineAt(pos);
  const at = chainAt(state, pos).to;
  if (at < line.to) {
    return { changes: { from: at, to: unitAfter(state, at) }, selection: EditorSelection.cursor(pos), userEvent: 'delete.forward' };
  }
  if (line.number >= state.doc.lines) return {};
  const next = state.doc.line(line.number + 1);
  // a drawn block below is picked first, as a press on it would
  if (blocksIn(state, next.from).some((block) => block.from === next.from)) return { selection: EditorSelection.cursor(next.from), userEvent: 'select' };
  return { changes: { from: line.to, to: wordsStart(state, next) }, selection: EditorSelection.cursor(pos), userEvent: 'delete.forward' };
}

/** Ctrl+Backspace at the start of a line's words does what Backspace does there; elsewhere it takes a word. */
function wordBackspace(state) {
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  if (!state.selection.main.empty || chainAt(state, pos).from > wordsStart(state, line) || wordsStart(state, line) === line.from) return null;
  return backspaceAt(state);
}

/** The keys of the drawn page's lines, after a drawn block's own. */
export const lineKeys = Prec.high(keymap.of([
  { key: 'Enter', run: keyOf(enterAt) },
  { key: 'Backspace', run: keyOf(backspaceAt) },
  { key: 'Mod-Backspace', run: keyOf(wordBackspace) },
  { key: 'Delete', run: keyOf(deleteAt) },
  { key: 'Tab', run: keyOf((state) => indentItems(state, 1)), shift: keyOf((state) => indentItems(state, -1)) },
]));
