/**
 * What the block handle writes (`editor/handle.js`, `editor/blockMenu.js`): a block
 * turned into another kind, put in a callout or in `> [!internal]`, aligned, pinned
 * to a corner of the cover, moved, duplicated or deleted, a page started before it.
 *
 * Each answers one transaction spec, or null when it would change nothing, which the
 * menu dispatches as one step: one Undo gives back the exact bytes. The cursor moves
 * with the block when it was in it; else it stays, and so does the page. Each writes the
 * Markdown an expert would type, the syntax the PDF, the HTML page and the old
 * Notebook already read, and touches only the block it names (and the line around
 * it a page break or a move needs). Pure: a state and a block of `blockRanges` in,
 * a spec out, so each is tested without a browser.
 */
import { ChangeSet } from '@codemirror/state';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';

import { CALLOUT_LINE, calloutOf } from '../callouts.js';
import { PAGE_BREAK } from '../look.js';
import { BLOCK_OPEN, picturesIn, sizedLine } from '../pictureSize.js';
import { coverLineIndex } from '../reportParts.js';
import { blockRanges } from './ranges.js';

/** The kinds of block that are words, which Turn into and Callout rewrite. */
export const TEXT_KINDS = new Set(['paragraph', 'heading', 'list', 'quote', 'callout']);

/** What Turn into offers, in its order: what each writes is `shapeOf`'s other side. */
export const SHAPES = [
  { id: 'paragraph', label: 'Text', icon: 'text' },
  { id: 'h1', label: 'Heading', glyph: 'H1' },
  { id: 'h2', label: 'Subheading', glyph: 'H2' },
  { id: 'h3', label: 'Small heading', glyph: 'H3' },
  { id: 'bullet', label: 'Bulleted list', icon: 'list' },
  { id: 'numbered', label: 'Numbered list', icon: 'numbered' },
  { id: 'task', label: 'To-do', icon: 'square' },
  { id: 'quote', label: 'Quote', icon: 'quote' },
];

/** The userEvent every edit of the handle carries: none of them joins the step before it in the history. */
const EVENT = 'block';

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+|$)/;
const ATX_CLOSE = /[ \t]+#+[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const QUOTE_MARK = /^ {0,3}> ?/;
const RULE = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
/** A line that starts a block of its own, which a callout's marker cannot share. */
const BLOCK_START = /^(?: {0,3}(?:#{1,6}(?:[ \t]|$)|[-*+][ \t]|\d{1,9}[.)][ \t]|>|```|~~~|\||<)|[ \t]*$)/;

/** The whole lines of a block, top to bottom, as `{ from, to, text }`. */
function blockLines(state, block) {
  const lines = [];
  for (let number = state.doc.lineAt(block.from).number; number <= state.doc.lineAt(block.to).number; number += 1) {
    const line = state.doc.line(number);
    lines.push({ from: line.from, to: line.to, text: line.text });
  }
  return lines;
}

/** A list item's mark: `- `, `1. `, `- [ ] `, with where its words start, or null for any other line. */
function listMark(text) {
  const match = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+|$)/.exec(text);
  if (!match || RULE.test(text)) return null;
  // more than four spaces after the mark start an indented code block: the words start after one
  const width = match[3].length > 4 ? match[1].length + match[2].length + 1 : match[0].length;
  const box = /^\[([ xX])\](?:[ \t]+|$)/.exec(text.slice(match[0].length));
  return {
    indent: match[1].length,
    marker: match[2],
    width,
    task: box ? box[1] : null,
    start: match[0].length + (box ? box[0].length : 0),
  };
}

/**
 * What a block of words is now, as Turn into names it: `paragraph`, `h1`…`h6`,
 * `bullet`, `numbered`, `task`, `quote` or `callout:<kind>`; null for any other block.
 */
export function shapeOf(state, block) {
  if (!TEXT_KINDS.has(block.kind)) return null;
  const lines = blockLines(state, block);
  if (block.kind === 'heading') {
    const atx = ATX.exec(lines[0].text);
    if (atx) return `h${atx[1].length}`;
    return SETEXT.exec(lines.at(-1).text)?.[1][0] === '=' ? 'h1' : 'h2';
  }
  if (block.kind === 'list') {
    const mark = listMark(lines[0].text);
    if (mark?.task) return 'task';
    return mark && /\d/.test(mark.marker) ? 'numbered' : 'bullet';
  }
  if (block.kind === 'callout') return `callout:${calloutOf(lines[0].text)?.kind ?? 'note'}`;
  return block.kind;
}

// -- the words of a block, read as units -------------------------------------------

/**
 * Each line of a block as a unit of words: its `text` without the marks that make it
 * what it is, the `line` of the block it came from and `at`, where in that line the
 * words start. A quote and a callout give the words inside them.
 */
function units(state, block) {
  const lines = blockLines(state, block);
  return lines.map((line, index) => {
    let cut = 0;
    if (block.kind === 'quote' || block.kind === 'callout') {
      const marker = index === 0 && block.kind === 'callout' ? CALLOUT_LINE.exec(line.text) : null;
      cut = marker ? marker[0].length : (QUOTE_MARK.exec(line.text)?.[0].length ?? 0);
    }
    return { text: line.text.slice(cut), line: index, at: cut };
  }).filter((unit, index) => !(index === 0 && block.kind === 'callout' && !unit.text.trim()));
}

/** A unit with `cut` more characters taken off its start. */
const shifted = (unit, cut) => ({ ...unit, text: unit.text.slice(cut), at: unit.at + cut });

/** A unit with its leading spaces taken off. */
const trimmed = (unit) => shifted(unit, unit.text.length - unit.text.trimStart().length);

/**
 * The units read as chunks of Markdown, split at blank lines: a `heading` (one unit, its
 * marks taken off), a `list` (its items, each a first unit and the units under it,
 * brought back to the left) or a `paragraph` (its units).
 */
function chunks(list, { setext = false } = {}) {
  const found = [];
  let group = [];
  const close = () => {
    if (!group.length) return;
    const first = listMark(group[0].text);
    if (first) {
      const items = [];
      for (const unit of group) {
        const mark = listMark(unit.text);
        if (mark && (!items.length || mark.indent < items[0].mark.width)) items.push({ mark, units: [shifted(unit, mark.start)] });
        else {
          const item = items.at(-1);
          const lead = unit.text.length - unit.text.trimStart().length;
          item.units.push(shifted(unit, Math.min(lead, item.mark.width)));
        }
      }
      found.push({ type: 'list', items });
    } else if (setext && group.length > 1 && SETEXT.test(group.at(-1).text)) {
      found.push({ type: 'heading', units: group.slice(0, -1).map(trimmed) });
    } else {
      found.push({ type: 'paragraph', units: group.map(trimmed) });
    }
    group = [];
  };
  for (const unit of list) {
    if (!unit.text.trim()) {
      close();
      continue;
    }
    const atx = ATX.exec(unit.text);
    if (atx) {
      close();
      const words = shifted(unit, atx[0].length);
      found.push({ type: 'heading', units: [{ ...words, text: words.text.replace(ATX_CLOSE, '') }] });
      continue;
    }
    group.push(unit);
  }
  close();
  return found;
}

/** The items a list is made of, from chunks: a paragraph or a heading is one item, a list its own. */
function itemsOf(parts) {
  return parts.flatMap((part) => (part.type === 'list' ? part.items.map((item) => item.units) : [part.units]));
}

// -- writing a block's new lines -------------------------------------------------

/**
 * One transaction replacing a block's lines with `out`, each `{ prefix, parts }` where
 * a part is a unit (`text`, the `line` and `at` it came from); `parts` of one line are
 * joined by a space. The cursor, when it was in the block, stays on the words it was on.
 */
function rewrite(state, block, out) {
  const lines = blockLines(state, block);
  const head = state.selection.main.head;
  const inside = state.selection.main.empty && head >= block.from && head <= block.to;
  let text = '';
  let caret = null;
  out.forEach((row, index) => {
    if (index) text += '\n';
    text += row.prefix;
    row.parts.forEach((part, at) => {
      if (at) text += ' ';
      if (inside && caret === null && part.line !== undefined) {
        const line = lines[part.line];
        const start = line.from + part.at;
        if (head >= line.from && head <= line.to && head <= start + part.text.length) {
          caret = block.from + text.length + Math.max(0, Math.min(part.text.length, head - start));
        }
      }
      text += part.text;
    });
  });
  const old = state.sliceDoc(block.from, block.to);
  if (text === old) return null;
  const spec = { changes: { from: block.from, to: block.to, insert: text }, userEvent: `${EVENT}.turn` };
  // the cursor stays where it was: on the words, when it was in the block, and the page stays still else
  if (inside) Object.assign(spec, { selection: { anchor: caret ?? block.from + (out[0]?.prefix.length ?? 0) }, scrollIntoView: true });
  return spec;
}

const line = (prefix, parts) => ({ prefix, parts: [parts].flat() });

/**
 * Words put at the start of a block's line, escaped where Markdown would read them as a
 * mark: a heading `1. What it cost` turned into text is `1\. What it cost`, not a list.
 */
function asWords(unit) {
  const number = /^\d{1,9}(?=[.)](?:\s|$))/.exec(unit.text);
  const at = number ? number[0].length : /^(?:[-+*](?=\s|$)|#{1,6}(?=\s|$)|>)/.test(unit.text) ? 0 : -1;
  return at < 0 ? unit : { ...unit, text: `${unit.text.slice(0, at)}\\${unit.text.slice(at)}` };
}

/** The lines of a list of `items` (each a list of units) under `marker(index)`, its words under it indented to match. */
function listLines(items, marker) {
  return items.flatMap((item, index) => {
    const mark = marker(index);
    const pad = ' '.repeat(mark.replace(/\[[ xX]\] $/, '').length);
    return item.map((unit, at) => line(at ? pad : mark, asWords(unit)));
  });
}

const MARKERS = {
  bullet: () => '- ',
  numbered: (index) => `${index + 1}. `,
  task: () => '- [ ] ',
};

/**
 * A list as another kind of list: only the marks of its own items change, the words
 * under each moved to stay under it. A task keeps its tick between to-do lists.
 */
function relist(state, block, shape) {
  const lines = blockLines(state, block);
  const top = listMark(lines[0].text);
  const out = [];
  let count = 0;
  let shift = 0;
  let width = top.width;
  for (const [index, row] of lines.entries()) {
    const mark = listMark(row.text);
    if (mark && mark.indent < width) {
      const marker = shape === 'task' ? `- [${mark.task ?? ' '}] ` : MARKERS[shape](count);
      count += 1;
      const indent = row.text.slice(0, mark.indent);
      // the words under an item are indented to its words: the same amount further, or back
      shift = marker.replace(/\[[ xX]\] $/, '').length - (mark.width - mark.indent);
      width = mark.width;
      out.push(line(indent + marker, { text: row.text.slice(mark.start), line: index, at: mark.start }));
      continue;
    }
    const lead = row.text.length - row.text.trimStart().length;
    if (!row.text.trim() || lead < width || !shift) {
      out.push(line('', { text: row.text, line: index, at: 0 }));
      continue;
    }
    const cut = shift < 0 ? Math.min(lead, -shift) : 0;
    out.push(line(' '.repeat(Math.max(0, shift)), { text: row.text.slice(cut), line: index, at: cut }));
  }
  return rewrite(state, block, out);
}

/** A quote or a callout given another marker, or none: the words inside stay as they are. */
function remark(state, block, kind) {
  const [first, second] = blockLines(state, block);
  const marker = block.kind === 'callout' ? CALLOUT_LINE.exec(first.text) : null;
  const userEvent = `${EVENT}.turn`;
  if (marker && kind) {
    const at = first.from + marker[1].length + 2;
    return { changes: { from: at, to: at + marker[2].length, insert: kind }, userEvent };
  }
  if (marker) {
    // the marker alone on its line goes with its line; else the words after it stay
    const rest = first.text.slice(marker[0].length);
    if (!rest.trim() && second) return { changes: { from: first.from, to: second.from }, userEvent };
    return { changes: { from: first.from + marker[1].length, to: first.from + marker[0].length, insert: marker[1].trimEnd().length < marker[1].length ? '' : ' ' }, userEvent };
  }
  const quote = QUOTE_MARK.exec(first.text)[0];
  const rest = first.text.slice(quote.length);
  const lead = quote.endsWith(' ') ? quote : `${quote} `;
  if (BLOCK_START.test(rest)) return { changes: { from: first.from, insert: `${lead}[!${kind}]\n` }, userEvent };
  return { changes: { from: first.from, to: first.from + quote.length, insert: `${lead}[!${kind}] ` }, userEvent };
}

/**
 * Turn a block of words into `shape` (`SHAPES`' ids, or `callout:<kind>`), keeping its
 * words: a heading's marks, a list's, a quote's go, the new ones come. A list put in a
 * quote or a callout stays a list inside it; one turned into text gives a paragraph an
 * item. Null when it is that already, or is no block of words.
 */
export function turnInto(state, block, shape) {
  const now = shapeOf(state, block);
  if (!now || now === shape) return null;
  const callout = /^callout:([a-z]+)$/.exec(shape)?.[1] ?? null;
  // a quote and a callout change their marker only, what is inside them untouched
  if ((block.kind === 'quote' || block.kind === 'callout') && (callout || shape === 'quote')) return remark(state, block, callout);
  if (block.kind === 'list' && shape in MARKERS) return relist(state, block, shape);
  const parts = chunks(units(state, block), { setext: block.kind === 'heading' || block.kind === 'quote' || block.kind === 'callout' });
  if (!parts.length) return null;
  const heading = /^h([1-6])$/.exec(shape);
  if (heading) {
    const words = parts.flatMap((part) => (part.type === 'list' ? part.items.flatMap((item) => item.units) : part.units))
      .map(trimmed).filter((unit) => unit.text.trim());
    return rewrite(state, block, [line(`${'#'.repeat(Number(heading[1]))} `, words)]);
  }
  if (shape === 'paragraph') {
    const out = [];
    const blank = () => out.push(line('', []));
    for (const part of parts) {
      for (const item of part.type === 'list' ? part.items.map((one) => one.units) : [part.units]) {
        if (out.length) blank();
        out.push(...item.map((unit) => line('', asWords(unit))));
      }
    }
    return rewrite(state, block, out);
  }
  if (shape in MARKERS) return rewrite(state, block, listLines(itemsOf(parts), MARKERS[shape]));
  // a quote or a callout, from a paragraph, a heading or a list
  const lead = callout ? `> [!${callout}] ` : '> ';
  if (block.kind === 'list') {
    const lines = blockLines(state, block).map((row, index) => line(row.text.trim() ? '> ' : '>', { text: row.text, line: index, at: 0 }));
    return rewrite(state, block, callout ? [line(`> [!${callout}]`, []), ...lines] : lines);
  }
  const words = parts.flatMap((part) => part.units ?? []);
  return rewrite(state, block, words.map((unit, index) => line(index ? '> ' : lead, asWords(unit))));
}

// -- internal passages -----------------------------------------------------------

/** Whether a block is an internal passage, which the public edition leaves out. */
export function isInternal(state, block) {
  return block.kind === 'callout' && calloutOf(state.doc.lineAt(block.from).text)?.kind === 'internal';
}

/** The kinds of block a `> [!internal]` can hold, so the public edition leaves them out whole. */
export const INTERNAL_KINDS = new Set([...TEXT_KINDS, 'code', 'table', 'picture', 'diagram']);

/**
 * Put a block in `> [!internal]`, the same rule the server strips from the public
 * edition (`engine/notes_markdown.py` `strip_internal`): a paragraph opens the callout
 * on its first line, anything else under a marker line of its own, each line quoted.
 * A blank line is put between it and a line of words right before or after it, which
 * would otherwise run into the passage. Null for a block that cannot be one, or is.
 */
export function markInternal(state, block) {
  if (!INTERNAL_KINDS.has(block.kind) || isInternal(state, block)) return null;
  const lines = blockLines(state, block);
  const out = block.kind === 'paragraph'
    ? lines.map((row, index) => line(index ? '> ' : '> [!internal] ', { text: row.text, line: index, at: 0 }))
    : [line('> [!internal]', []), ...lines.map((row, index) => line(row.text.trim() ? '> ' : '>', { text: row.text, line: index, at: 0 }))];
  const spec = rewrite(state, block, out);
  const first = state.doc.lineAt(block.from);
  const last = state.doc.lineAt(block.to);
  const before = first.number > 1 && state.doc.line(first.number - 1).text.trim() ? '\n' : '';
  const after = last.number < state.doc.lines && state.doc.line(last.number + 1).text.trim() ? '\n' : '';
  spec.changes.insert = `${before}${spec.changes.insert}${after}`;
  if (spec.selection) spec.selection.anchor += before.length;
  spec.userEvent = `${EVENT}.internal`;
  return spec;
}

/** Take a block out of `> [!internal]`, so the public edition prints it: the inverse of `markInternal`. */
export function makePublic(state, block) {
  if (!isInternal(state, block)) return null;
  const lines = blockLines(state, block);
  const out = [];
  lines.forEach((row, index) => {
    if (index === 0) {
      const marker = CALLOUT_LINE.exec(row.text);
      const rest = row.text.slice(marker[0].length);
      if (rest.trim() || lines.length === 1) out.push(line('', { text: rest, line: 0, at: marker[0].length }));
      return;
    }
    const cut = QUOTE_MARK.exec(row.text)?.[0].length ?? 0;
    out.push(line('', { text: row.text.slice(cut), line: index, at: cut }));
  });
  const spec = rewrite(state, block, out);
  if (spec) spec.userEvent = `${EVENT}.internal`;
  return spec;
}

// -- where a block sits ----------------------------------------------------------

/** The `:::` name an aligned block opens with (`center`, `top-right`…), or null. */
function fenceName(state, block) {
  return block.kind === 'aligned' ? BLOCK_OPEN.exec(state.doc.lineAt(block.from).text)?.[1] ?? null : null;
}

/** The kinds of block Align sets on a side of the line. */
const ALIGNABLE = new Set(['paragraph', 'heading', 'picture', 'aligned']);

/** Where a block sits on its line: `left`, `center` or `right`; null for one Align does not set (a corner). */
export function alignOf(state, block) {
  if (!ALIGNABLE.has(block.kind)) return null;
  if (block.kind === 'picture') {
    const [picture] = picturesIn(state.doc.lineAt(block.from).text);
    return picture ? picture.align || 'left' : null;
  }
  if (block.kind === 'aligned') {
    const name = fenceName(state, block);
    return name && !name.includes('-') ? name : null;
  }
  return 'left';
}

/** Put the block's lines in `::: name` … `:::`. */
function fence(state, block, name) {
  return {
    changes: [{ from: block.from, insert: `::: ${name}\n` }, { from: block.to, insert: '\n:::' }],
    userEvent: `${EVENT}.align`,
  };
}

/** An aligned block's `:::` lines renamed `name`, or taken off for none. */
function refence(state, block, name) {
  const first = state.doc.lineAt(block.from);
  const last = state.doc.lineAt(block.to);
  if (!name) {
    if (last.number - first.number < 2) return { changes: { from: first.from, to: last.to }, userEvent: `${EVENT}.align` };
    return {
      changes: [{ from: first.from, to: state.doc.line(first.number + 1).from }, { from: state.doc.line(last.number - 1).to, to: last.to }],
      userEvent: `${EVENT}.align`,
    };
  }
  const open = /^(:::[ \t]*)([a-z-]+)/.exec(first.text);
  return { changes: { from: first.from + open[1].length, to: first.from + open[0].length, insert: name }, userEvent: `${EVENT}.align` };
}

/**
 * Set a block on the left, the centre or the right of the line, with the syntax the
 * app writes already: a picture's `align=` (as its bar does), an aligned block's
 * `::: center` / `::: right`, taken off for left; words put in one. Null when it is there.
 */
export function alignBlock(state, block, side) {
  const now = alignOf(state, block);
  if (!now || now === side) return null;
  if (block.kind === 'picture') {
    const target = state.doc.lineAt(block.from);
    const [picture] = picturesIn(target.text);
    const text = sizedLine(target.text, picture.ref, { align: side });
    return text === null || text === target.text ? null
      : { changes: { from: target.from, to: target.to, insert: text }, userEvent: `${EVENT}.align` };
  }
  if (block.kind === 'aligned') return refence(state, block, side === 'left' ? null : side);
  return fence(state, block, side);
}

/** The 1-based line of the cover's end (`<!-- cover -->`), 0 without one. */
function coverEnd(state) {
  return coverLineIndex(state.doc.toString()) + 1;
}

/** The kinds of block a corner of the cover can hold. */
const CORNER_KINDS = new Set(['paragraph', 'heading', 'list', 'picture', 'aligned']);

/** Whether a block stands above the end of the note's own cover, where a corner pins it to page 1. */
export function onCover(state, block) {
  const end = coverEnd(state);
  return end > 0 && CORNER_KINDS.has(block.kind) && state.doc.lineAt(block.to).number < end;
}

/** The corner of the cover a block is pinned to (`top-right`…), or null. */
export function cornerOf(state, block) {
  const name = fenceName(state, block);
  return name?.includes('-') ? name : null;
}

/**
 * Pin a block of the cover to `corner` (`top-left`…), or take it out of its corner
 * with null: the `::: top-right` block the cover skeleton writes. Null when it is there.
 */
export function cornerBlock(state, block, corner) {
  if (!onCover(state, block)) return null;
  const now = cornerOf(state, block);
  if (now === corner) return null;
  if (block.kind === 'aligned') return corner || now ? refence(state, block, corner) : null;
  return corner ? fence(state, block, corner) : null;
}

// -- pages -------------------------------------------------------------------------

/** The page break right above a block, as a block of `blockRanges`, or null. */
export function breakAbove(state, block, blocks = blockRanges(state)) {
  const index = blocks.findIndex((one) => one.from === block.from);
  const before = index > 0 ? blocks[index - 1] : null;
  return before?.kind === 'pagebreak' ? before : null;
}

/** Whether a page can be started before a block: not the note's first, and not a rule. */
export function canBreakBefore(state, block, blocks = blockRanges(state)) {
  return blocks[0]?.from !== block.from && block.kind !== 'pagebreak' && block.kind !== 'cover';
}

/** Start a new page before a block (`<!-- pagebreak -->` on a line of its own), or take back the one right above it. */
export function pageBreakBefore(state, block, blocks = blockRanges(state)) {
  const above = breakAbove(state, block, blocks);
  if (above) return { changes: { from: above.from, to: block.from }, userEvent: `${EVENT}.page` };
  if (!canBreakBefore(state, block, blocks)) return null;
  return { changes: { from: block.from, insert: `${PAGE_BREAK}\n\n` }, userEvent: `${EVENT}.page` };
}

// -- moving, duplicating, deleting ------------------------------------------------

/** The space between two blocks as it is kept: a blank line at least, so they never run into each other. */
function spacing(between) {
  return /\n[ \t]*\n/.test(between) ? between : '\n\n';
}

const same = (a) => (b) => b.from === a.from && b.to === a.to;

/**
 * Move a block before `before` (another block of `blockRanges`), or to the end of the
 * note with null. It goes with the space that followed it (that preceded it, for the
 * last), a blank line at least; the cursor, when it was in it, goes with it. Null when
 * it would stay where it is.
 */
export function moveBlock(state, block, before, blocks = blockRanges(state)) {
  const index = blocks.findIndex(same(block));
  const target = before ? blocks.findIndex(same(before)) : blocks.length;
  if (index < 0 || target < 0 || target === index || target === index + 1) return null;
  const text = state.sliceDoc(block.from, block.to);
  const next = blocks[index + 1];
  const previous = blocks[index - 1];
  let cut;
  let between;
  if (next) {
    between = state.sliceDoc(block.to, next.from);
    cut = /\S/.test(between) ? { from: block.from, to: block.to + 1 } : { from: block.from, to: next.from };
  } else {
    between = state.sliceDoc(previous.to, block.from);
    cut = /\S/.test(between) ? { from: block.from - 1, to: block.to } : { from: previous.to, to: block.to };
  }
  const gap = /\S/.test(between) ? '\n\n' : spacing(between);
  const atEnd = target === blocks.length;
  const at = atEnd ? blocks.at(-1).to : blocks[target].from;
  const insert = atEnd ? `${gap}${text}` : `${text}${gap}`;
  const changes = ChangeSet.of([{ from: cut.from, to: cut.to }, { from: at, insert }], state.doc.length);
  const spec = { changes, userEvent: `${EVENT}.move` };
  const { head, empty } = state.selection.main;
  if (empty && head >= block.from && head <= block.to) {
    spec.selection = { anchor: changes.mapPos(at, -1) + (atEnd ? gap.length : 0) + (head - block.from) };
    spec.scrollIntoView = true;
  }
  return spec;
}

/** Move a block one place up (`-1`) or down (`1`), past the block next to it. Null at the top or the bottom. */
export function moveBy(state, block, step, blocks = blockRanges(state)) {
  const index = blocks.findIndex(same(block));
  if (index < 0) return null;
  if (step < 0) return index > 0 ? moveBlock(state, block, blocks[index - 1], blocks) : null;
  if (index >= blocks.length - 1) return null;
  return moveBlock(state, block, blocks[index + 2] ?? null, blocks);
}

/** A copy of a block right under it, a blank line between; the cursor, when it was in it, goes to the copy. */
export function duplicateBlock(state, block) {
  if (block.kind === 'cover') return null;
  const text = state.sliceDoc(block.from, block.to);
  const spec = { changes: { from: block.to, insert: `\n\n${text}` }, userEvent: `${EVENT}.duplicate` };
  const { head, empty } = state.selection.main;
  if (empty && head >= block.from && head <= block.to) Object.assign(spec, { selection: { anchor: block.to + 2 + (head - block.from) }, scrollIntoView: true });
  return spec;
}

/** Take a block out, with the line break it stands on and a blank line it would leave doubled, as Delete does a picked block. */
export function deleteBlock(state, block) {
  const { doc } = state;
  const first = doc.lineAt(block.from);
  const last = doc.lineAt(block.to);
  const before = first.number > 1 ? doc.line(first.number - 1) : null;
  const after = last.number < doc.lines ? doc.line(last.number + 1) : null;
  let from = first.from;
  let to = last.to;
  if (after) {
    to = after.from;
    if (!after.text.trim() && (!before || !before.text.trim())) to = after.number < doc.lines ? doc.line(after.number + 1).from : after.to;
  } else if (before) from = before.to;
  return { changes: { from, to }, selection: { anchor: from }, userEvent: `${EVENT}.delete`, scrollIntoView: true };
}

// -- a link to a heading ---------------------------------------------------------

/** A heading's words as the HTML page reads them (`notes_markdown.inline_text`): marks, pictures and addresses left out. */
export function headingWords(text) {
  const words = String(text ?? '')
    .replace(ATX, '').replace(ATX_CLOSE, '')
    .replace(/!\[[^\]\n]*\]\([^)\n]*\)(?:\{[^}\n]*\})?/g, '')
    .replace(/\[\[(?:entity|media):[A-Za-z0-9_-]+\|([^\]\n]+)\]\](?:\{[^}\n]*\})?/g, '$1')
    .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(\*\*|__|\*|_|~~|`)/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!|~<>])/g, '$1');
  return words.split(/\s+/).filter(Boolean).join(' ');
}

/** A heading's anchor as the HTML page names it (`engine/notes_html.py` `_slug`). */
export function slugOf(words) {
  // Python's casefold, as near as it matters: ß is ss and a final sigma a sigma
  const folded = String(words ?? '').normalize('NFKC').toLowerCase().replace(/ß/g, 'ss').replace(/ς/g, 'σ');
  let slug = folded.replace(/[^\p{L}\p{N}_]+/gu, '-').replace(/^[-_]+|[-_]+$/g, '');
  slug = [...slug].slice(0, 60).join('').replace(/^[-_]+|[-_]+$/g, '');
  return /^\d/.test(slug) ? `s-${slug}` : slug;
}

/** The ids the HTML page keeps for itself, which a heading's anchor steps around (`RESERVED_IDS`, `RESERVED_ID`). */
const RESERVED = new Set(['sources', 'corrections', 'contents', 'top', 'main', 'cover', 'footer']);
const RESERVED_ID = /^(?:src|clip|fig|step|limits|map)-\d+$/;

/**
 * The link to a heading the HTML page follows, `[Words](#words)`: its anchor as the
 * page names it, counting the headings and the Limits callouts before it as the page
 * does (`_new_id`). The PDF prints the words. Null for any other block.
 */
export function headingLink(state, block) {
  if (block.kind !== 'heading') return null;
  const ids = new Set();
  const take = (wanted) => {
    let base = wanted || 'section';
    if (RESERVED.has(base) || RESERVED_ID.test(base)) base = `${base}-section`;
    let candidate = base;
    for (let count = 2; ids.has(candidate); count += 1) candidate = `${base}-${count}`;
    ids.add(candidate);
    return candidate;
  };
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
  let found = null;
  tree.iterate({
    enter(node) {
      if (found) return false;
      if (/^ATXHeading\d$/.test(node.name) || /^SetextHeading\d$/.test(node.name)) {
        const first = state.doc.lineAt(node.from);
        const text = node.name.startsWith('ATX') ? first.text.replace(QUOTE_MARK, '').replace(/^(?: {0,3}> ?)+/, '')
          : state.sliceDoc(node.from, state.doc.lineAt(node.to).number > first.number ? state.doc.line(state.doc.lineAt(node.to).number - 1).to : node.to);
        const words = headingWords(text);
        const id = take(slugOf(words));
        if (node.from >= block.from && node.from <= block.to) found = { words, id };
        return false;
      }
      if (node.name === 'Blockquote' && calloutOf(state.doc.lineAt(node.from).text)?.kind === 'limits') take('limits');
      return undefined;
    },
  });
  if (!found) return null;
  const words = found.words.replace(/([[\]])/g, '\\$1');
  return { id: found.id, words: found.words, markdown: `[${words}](#${found.id})` };
}
