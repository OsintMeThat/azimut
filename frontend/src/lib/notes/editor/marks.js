/**
 * What the selection bubble, the toolbar and the keys write around words and lines:
 * bold, italic, code or strikethrough set or taken off, lines turned into a heading,
 * a list or a quote, a passage marked internal, the marks cleared, a link written,
 * changed or taken off, a case item cited in place of words.
 *
 * Each reads the note's syntax tree, so a mark is known for what it is (the `*` of
 * italic is never taken for half of the `**` of bold), and answers a transaction
 * spec, `{ changes, selection }`, or null when there is nothing to do: tested on a
 * state alone. `runFormat` dispatches one as a single Undo step. What is written is
 * the Markdown an expert would type.
 */
import { isolateHistory } from '@codemirror/commands';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { EditorSelection } from '@codemirror/state';

import { CALLOUT_LINE, calloutOf } from '../callouts.js';
import { findReferences } from '../syntax.js';
import { blockRanges } from './ranges.js';

/** The marks set around words, each the node the parser reads it as and the node of its two marks. */
export const INLINE_MARKS = {
  bold: { node: 'StrongEmphasis', mark: '**', child: 'EmphasisMark' },
  italic: { node: 'Emphasis', mark: '*', child: 'EmphasisMark' },
  code: { node: 'InlineCode', mark: '`', child: 'CodeMark' },
  strike: { node: 'Strikethrough', mark: '~~', child: 'StrikethroughMark' },
};

/** The note's syntax tree, read at least to `upto`. */
function treeOf(state, upto = state.doc.length) {
  return ensureSyntaxTree(state, Math.min(state.doc.length, upto + 1), 200) ?? syntaxTree(state);
}

/** The nodes called `name` that overlap `from`–`to`. */
function nodesIn(state, name, from, to) {
  const found = [];
  treeOf(state, to).iterate({
    from: Math.max(0, from - 1),
    to: Math.min(state.doc.length, to + 1),
    enter: (node) => {
      if (node.name === name && node.from < Math.max(to, from + 1) && node.to > Math.min(from, to - 1)) found.push(node.node);
    },
  });
  return found;
}

/** The innermost node called `name` that holds all of `range`, or null. */
function enclosing(state, name, range) {
  const holding = nodesIn(state, name, range.from, range.to).filter((node) => node.from <= range.from && node.to >= range.to);
  return holding.sort((a, b) => (a.to - a.from) - (b.to - b.from))[0] ?? null;
}

/** A mark node's opening and closing marks, or null when it is not closed. */
function marksOf(node, spec) {
  const marks = node.getChildren(spec.child);
  return marks.length >= 2 ? [marks[0], marks[marks.length - 1]] : null;
}

/** Whether `range` lies inside a written link (not a chip), and that link. */
export function linkAt(state, range = state.selection.main) {
  const node = enclosing(state, 'Link', range);
  if (!node) return null;
  if (state.sliceDoc(node.from, node.from + 2) === '[[' || state.sliceDoc(node.from - 1, node.from) === '[') return null;
  const marks = node.getChildren('LinkMark');
  const url = node.getChild('URL');
  if (marks.length < 4 || !url) return null;
  return { from: node.from, to: node.to, words: state.sliceDoc(marks[0].to, marks[1].from), url: state.sliceDoc(url.from, url.to) };
}

/**
 * `from`–`to` grown over every written link and chip it cuts through, so that a mark
 * or a link set on it never splits one.
 */
function wholeSpans(state, from, to) {
  const cuts = (start, end) => (start < from && end > from) || (start < to && end > to);
  for (let grown = true; grown;) {
    grown = false;
    const spans = nodesIn(state, 'Link', from, to).map((node) => [node.from, node.to]);
    for (let number = state.doc.lineAt(from).number; number <= state.doc.lineAt(to).number; number += 1) {
      const line = state.doc.line(number);
      for (const ref of findReferences(line.text, line.from)) spans.push([ref.from, ref.to]);
    }
    for (const [start, end] of spans) {
      if (!cuts(start, end)) continue;
      from = Math.min(from, start);
      to = Math.max(to, end);
      grown = true;
    }
  }
  return { from, to };
}

/** Words as the page shows them: a written link as its words, a chip as its label. */
export function shownWords(text) {
  return String(text)
    .replace(/\[\[(?:entity|media):[^|\]\n]+\|([^\]\n]+)\]\](?:\{[^}\n]*\})?/g, '$1')
    .replace(/(?<!!)\[([^\]\n]*)\]\([^)\s]*\)/g, '$1');
}

/** The block-level marks a line opens with: quote marks, a callout's marker, a heading's or a list item's. */
const LEAD = /^(?:\s*>\s?)*(?:\[![A-Za-z]+\]\s*)?(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)?/;

/** The lines `range` touches; a selection ending at the very start of a line leaves that line out. */
function touchedLines(state, range) {
  const first = state.doc.lineAt(range.from);
  let last = state.doc.lineAt(range.to);
  if (range.to > range.from && range.to === last.from && last.number > first.number) last = state.doc.line(last.number - 1);
  const lines = [];
  for (let number = first.number; number <= last.number; number += 1) lines.push(state.doc.line(number));
  return lines;
}

/** Which marks the words of `range` carry, and what its first line is: what the bubble lights. */
export function activeFormats(state, range = state.selection.main) {
  const active = new Set();
  for (const [kind, spec] of Object.entries(INLINE_MARKS)) if (enclosing(state, spec.node, range)) active.add(kind);
  if (linkAt(state, range)) active.add('link');
  const line = state.doc.lineAt(range.from);
  const lead = /^(\s*(?:>\s?)*)(#{1,6}\s|[-*+]\s(?!\[[ xX]\]))?/.exec(line.text);
  if (lead[2]?.startsWith('#')) active.add('heading');
  else if (lead[2]) active.add('bullet');
  if (/^\s*>/.test(line.text)) active.add('quote');
  if (internalAround(state, range)) active.add('internal');
  return active;
}

// -- marks around words -----------------------------------------------------------

/** `text` in `open`/`close`, its spaces kept outside: `**a** `, never `**a **`. */
function wrapped(text, open, close) {
  if (!text.trim()) return text;
  const lead = /^\s*/.exec(text)[0];
  const trail = /\s*$/.exec(text)[0];
  return `${lead}${open}${text.trim()}${close}${trail}`;
}

/** Take mark `spec` off the part of `node` that `range` covers: the rest of it keeps the mark. */
function unwrap(state, node, spec, range) {
  const [open, close] = marksOf(node, spec);
  const opening = state.sliceDoc(open.from, open.to);
  const closing = state.sliceDoc(close.from, close.to);
  const from = Math.max(range.from, open.to);
  const to = Math.min(range.to, close.from);
  const left = wrapped(state.sliceDoc(open.to, from), opening, closing);
  const middle = state.sliceDoc(from, to);
  const right = wrapped(state.sliceDoc(to, close.from), opening, closing);
  const start = open.from + left.length;
  return {
    changes: { from: open.from, to: close.to, insert: `${left}${middle}${right}` },
    selection: EditorSelection.range(start, start + middle.length),
  };
}

/**
 * Set mark `spec` on `range`, line by line, past each line's own marks and spaces.
 * The same mark met inside or across the words goes, so the words carry it once.
 */
function wrap(state, kind, spec, range) {
  const changes = [];
  const kept = [];
  let delta = 0;
  for (const line of touchedLines(state, range)) {
    let from = Math.max(range.from, line.from + LEAD.exec(line.text)[0].length);
    let to = Math.min(range.to, line.to);
    const text = state.sliceDoc(from, to);
    from += text.length - text.trimStart().length;
    to -= text.length - text.trimEnd().length;
    if (to <= from) continue;
    ({ from, to } = wholeSpans(state, from, to));
    const inner = nodesIn(state, spec.node, from, to)
      .filter((node) => node.from < to && node.to > from && node.from >= line.from && node.to <= line.to && marksOf(node, spec));
    for (const node of inner) {
      from = Math.min(from, node.from);
      to = Math.max(to, node.to);
    }
    const gone = inner.flatMap((node) => marksOf(node, spec)).sort((a, b) => a.from - b.from);
    let words = '';
    let at = from;
    for (const mark of gone) {
      words += state.sliceDoc(at, mark.from);
      at = mark.to;
    }
    words += state.sliceDoc(at, to);
    const tick = kind === 'code' && words.includes('`');
    const open = tick ? '`` ' : spec.mark;
    const close = tick ? ' ``' : spec.mark;
    const insert = `${open}${words}${close}`;
    changes.push({ from, to, insert });
    kept.push(from + delta + open.length, from + delta + open.length + words.length);
    delta += insert.length - (to - from);
  }
  if (!changes.length) return null;
  return { changes, selection: EditorSelection.range(kept[0], kept[kept.length - 1]) };
}

/**
 * Bold, italic, code or strikethrough (`kind`) on the words of `range`, or off the
 * words that carry it. With no words selected, the two marks with the cursor
 * between them, or the pair the cursor stands between taken away.
 */
export function toggleInline(state, kind, range = state.selection.main) {
  const spec = INLINE_MARKS[kind];
  if (!spec) return null;
  if (range.empty) {
    const { mark } = spec;
    if (state.sliceDoc(range.from - mark.length, range.from) === mark && state.sliceDoc(range.from, range.from + mark.length) === mark) {
      return { changes: { from: range.from - mark.length, to: range.from + mark.length }, selection: EditorSelection.cursor(range.from - mark.length) };
    }
    return { changes: { from: range.from, insert: `${mark}${mark}` }, selection: EditorSelection.cursor(range.from + mark.length) };
  }
  if (kind === 'code' && state.doc.lineAt(range.from).number !== touchedLines(state, range).at(-1).number) return toggleCodeBlock(state, range);
  const node = enclosing(state, spec.node, range);
  if (node && marksOf(node, spec)) return unwrap(state, node, spec, range);
  return wrap(state, kind, spec, range);
}

/** Lines in a fenced code block, or a code block's fences taken off. */
function toggleCodeBlock(state, range) {
  const block = enclosing(state, 'FencedCode', range);
  if (block) {
    const first = state.doc.lineAt(block.from);
    const last = state.doc.lineAt(block.to);
    if (first.number === last.number) return null;
    return {
      changes: [{ from: first.from, to: first.to + 1 }, { from: last.from - 1, to: last.to }],
      selection: EditorSelection.range(first.from, last.from - 1 - (first.length + 1)),
    };
  }
  const lines = touchedLines(state, range);
  const from = lines[0].from;
  const to = lines.at(-1).to;
  return {
    changes: [{ from, insert: '```\n' }, { from: to, insert: '\n```' }],
    selection: EditorSelection.range(from + 4, to + 4),
  };
}

/** Every bold, italic, code and strikethrough mark on the words of `range` taken off. Links stay: Remove link takes one off. */
export function clearInline(state, range = state.selection.main) {
  const gone = [];
  for (const spec of Object.values(INLINE_MARKS)) {
    for (const node of nodesIn(state, spec.node, range.from, range.to)) {
      if (node.from >= range.to || node.to <= range.from) continue;
      for (const mark of marksOf(node, spec) ?? []) gone.push({ from: mark.from, to: mark.to });
    }
  }
  if (!gone.length) return null;
  const seen = new Set();
  const changes = gone.filter((mark) => !seen.has(mark.from) && seen.add(mark.from)).sort((a, b) => a.from - b.from);
  const set = state.changes(changes);
  return { changes: set, selection: EditorSelection.range(set.mapPos(range.from, 1), set.mapPos(range.to, -1)) };
}

// -- whole lines ------------------------------------------------------------------

/** A line's quote marks, and the heading or list mark after them. */
const LINE_MARK = /^(\s*(?:>\s?)*)(#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)?/;

/** The selection carried through `changes`, kept on the same words. */
function carried(state, changes, range) {
  const set = state.changes(changes);
  return { changes: set, selection: EditorSelection.range(set.mapPos(range.anchor, range.anchor > range.head ? -1 : 1), set.mapPos(range.head, range.head >= range.anchor ? -1 : 1)) };
}

/**
 * The lines of `range` as headings (`heading`, `## `) or as a bulleted list
 * (`bullet`, `- `), or back to plain lines when every one already is. A callout's
 * first line, whose marker would stop either, is left as it is.
 */
export function toggleLines(state, kind, range = state.selection.main) {
  const prefix = { heading: '## ', bullet: '- ' }[kind];
  if (!prefix) return null;
  const lines = touchedLines(state, range).filter((line) => line.text.trim() && !CALLOUT_LINE.test(line.text));
  if (!lines.length) return null;
  const is = (mark) => (kind === 'heading' ? /^#{1,6}\s+$/.test(mark) : /^[-*+]\s+$/.test(mark));
  const off = lines.every((line) => is(LINE_MARK.exec(line.text)[2] ?? ''));
  const changes = [];
  for (const line of lines) {
    const [, outer, mark = ''] = LINE_MARK.exec(line.text);
    const insert = off ? '' : prefix;
    if (insert !== mark) changes.push({ from: line.from + outer.length, to: line.from + outer.length + mark.length, insert });
  }
  return changes.length ? carried(state, changes, range) : null;
}

/** The lines of `range` as a quote, blank lines inside it included, or out of the quote (a callout with its marker) when every one is in it. */
export function toggleQuote(state, range = state.selection.main) {
  const lines = touchedLines(state, range);
  const written = lines.filter((line) => line.text.trim());
  if (!written.length) return null;
  const off = written.every((line) => /^\s*>/.test(line.text));
  const changes = [];
  for (const line of lines) {
    if (off) {
      const mark = CALLOUT_LINE.exec(line.text)?.[0] ?? /^\s*>\s?/.exec(line.text)?.[0];
      if (mark) changes.push({ from: line.from, to: line.from + mark.length });
    } else changes.push({ from: line.from, insert: line.text.trim() ? '> ' : '>' });
  }
  return carried(state, changes, range);
}

// -- an internal passage ----------------------------------------------------------

/** The internal passage `range` stands in, as `{ from, to }` over its lines, or null. */
function internalAround(state, range) {
  if (!state.doc.length) return null;
  const tree = treeOf(state, range.to);
  for (let node = tree.resolveInner(range.from, 1); node; node = node.parent) {
    if (node.name !== 'Blockquote') continue;
    if (calloutOf(state.doc.lineAt(node.from).text)?.kind === 'internal' && node.to >= range.to) return { from: node.from, to: node.to };
  }
  return null;
}

/** Whether a line starts a block of its own, which the marker of a callout cannot share. */
const BLOCK_LINE = /^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|```|~~~|:::|\||!\[|\[\[(?:media|include):|<!--)/;

/**
 * The whole blocks `range` touches marked internal (`> [!internal]`, left out of the
 * public edition), or taken out of the internal passage they are in. A quote or a
 * callout marked internal becomes the passage; its own marker goes.
 */
export function toggleInternal(state, range = state.selection.main) {
  const inside = internalAround(state, range);
  if (inside) {
    const changes = [];
    for (const line of touchedLines(state, { from: inside.from, to: inside.to })) {
      const mark = CALLOUT_LINE.exec(line.text)?.[0] ?? /^\s*>\s?/.exec(line.text)?.[0];
      if (mark) changes.push({ from: line.from, to: line.from + mark.length });
    }
    return carried(state, changes, range);
  }
  let from = state.doc.lineAt(range.from).from;
  let to = touchedLines(state, range).at(-1).to;
  for (const block of blockRanges(state)) {
    if (block.to < from || block.from > to) continue;
    from = Math.min(from, block.from);
    to = Math.max(to, block.to);
  }
  // the passage runs from its first written line to its last
  const lines = touchedLines(state, { from, to });
  while (lines.length && !lines[0].text.trim()) lines.shift();
  while (lines.length && !lines.at(-1).text.trim()) lines.pop();
  if (!lines.length) return null;
  from = lines[0].from;
  to = lines.at(-1).to;
  const [first, ...rest] = lines.map((line) => {
    const mark = CALLOUT_LINE.exec(line.text)?.[0] ?? /^\s*>\s?/.exec(line.text)?.[0] ?? '';
    return line.text.slice(mark.length);
  });
  const own = BLOCK_LINE.test(first);
  const head = own ? `> [!internal]\n> ${first}` : `> [!internal] ${first}`;
  const insert = [head, ...rest.map((text) => (text.trim() ? `> ${text}` : '>'))].join('\n');
  const start = from + (own ? '> [!internal]\n> ' : '> [!internal] ').length;
  return { changes: { from, to, insert }, selection: EditorSelection.range(start, from + insert.length) };
}

// -- links and citations ----------------------------------------------------------

/** Link words as Markdown reads them: a bracket escaped, one line. */
function linkWords(words) {
  return String(words).replace(/\s*\n\s*/g, ' ').replace(/(?<!\\)([[\]])/g, '\\$1');
}

/** An address as a Markdown link holds it: a space or a bracket that would end it encoded. */
function linkAddress(url) {
  return String(url).trim().replace(/[\s()<>]/g, (char) => ({ '(': '%28', ')': '%29', '<': '%3C', '>': '%3E' }[char] ?? '%20'));
}

/** What the Link field writes to: the written link `range` is in, else the words of `range`. */
export function linkTarget(state, range = state.selection.main) {
  const link = linkAt(state, range);
  if (link) return { ...link, existing: true };
  // a link or a chip the words cut through is taken whole, and read as the page shows it
  const { from, to } = wholeSpans(state, range.from, range.to);
  return { from, to, words: shownWords(state.sliceDoc(from, to)), url: '', existing: false };
}

/** `target` linked to `url`: `[words](url)`, the words those selected, else `title`, else the address. */
export function writeLink(target, url, { title = '' } = {}) {
  const words = linkWords(target.words.trim() ? target.words : title || url);
  const insert = `[${words}](${linkAddress(url)})`;
  return { changes: { from: target.from, to: target.to, insert }, selection: EditorSelection.range(target.from + 1, target.from + 1 + words.length) };
}

/** A written link taken off, its words kept. */
export function removeLink(target) {
  if (!target.existing) return null;
  return { changes: { from: target.from, to: target.to, insert: target.words }, selection: EditorSelection.range(target.from, target.from + target.words.length) };
}

/**
 * Case item `entity` cited in place of the words of `target`, as a chip named as the
 * item is, which is how the page draws it and the PDF prints it: the words "BBC, 5 Oct"
 * become the bookmark they stood for.
 */
export function writeCitation(target, entity) {
  const label = String(entity.label ?? '').replace(/\s*\n\s*/g, ' ').replace(/[[\]]/g, '').trim() || entity.id;
  const insert = `[[entity:${entity.id}|${label}]]`;
  return { changes: { from: target.from, to: target.to, insert }, selection: EditorSelection.range(target.from, target.from + insert.length) };
}

/** Dispatch `spec` as one Undo step of its own; false when there was nothing to do. */
export function runFormat(view, spec) {
  if (!spec || view.state.readOnly) return false;
  view.dispatch({ ...spec, scrollIntoView: true, userEvent: 'input.format', annotations: isolateHistory.of('full') });
  return true;
}
