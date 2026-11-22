/**
 * What the page draws for a state: everything is worked out from the editor state
 * alone (`noteDecorations`), so it is tested without a browser.
 *
 * Three passes, in this order, each leaving alone what an earlier one drew whole:
 * the `:::` blocks line by line, then the syntax tree, then the lines the Markdown
 * parser does not see (chapters, `[[media:…]]` pictures, case references, footnotes,
 * coordinates, the words the PDF fills in). The blocks drawn whole are the kinds
 * registered in `editor/blocks.js`; the marks inside a line (headings, emphasis,
 * links, quotes and callouts, lists and tasks, code) are this module's own.
 *
 * No line shows its Markdown, the one the cursor is on included: a heading's `#`, a
 * quote's `>`, a list's mark, the `**` of bold and the address of a link are put away
 * wherever they are, and the caret steps over them (`editor/caret.js`). Each piece put
 * away says which side of it the caret takes (`conceal`): what is typed at the end of
 * bold stays bold, at the end of a link it does not. Only an open block shows its
 * source, and a shortcut being typed (`##`, `-`) stays as typed until it is one.
 *
 * What a kind's `read` and `source` get as `ctx`:
 * `state`, `info` (the case), `pick` (the position a press picked, or -1),
 * `isOpen(from, to)` (whether the block over those lines shows its source),
 * `inCode(pos)`, `line(pos, className)`, `lines(from, to, className)` and
 * `mark(from, to, className)` (to dress open lines), `aligns` (the place of the
 * aligned block each line stands in, by line number), `count(name)` (the next
 * number of a kind, a chapter's), `standsWhole(range)` (nothing the parser found
 * inside is drawn) and `coverEnd()` (the 1-based line of the cover rule, 0 without).
 */
import { EditorState, StateField, Transaction } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import { HighlightStyle, ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { tags } from '@lezer/highlight';

import { CALLOUT_LINE, calloutOf } from '../callouts.js';
import { footnoteLetter, footnotesOf } from '../footnotes.js';
import { HINT_LINE, PAGE_BREAK_LINE } from '../look.js';
import { COVER_LINE, coverLineIndex, findPlaceholders } from '../reportParts.js';
import { findCoordinates, findReferences } from '../syntax.js';
import { blockKind, fenceKinds, isAtomic, lineKinds, nodeKinds } from './blocks.js';
import {
  BulletWidget, CalloutLabelWidget, ChipWidget, CoordinatesWidget, FootnoteWidget, HintWidget, NumberWidget, PlaceholderWidget, TaskWidget,
} from './inline.js';
import {
  cursorLines, focused, noteCase, noteHandlers, openBlock, resolve, selecting, setFocused, setNoteCase, setSelecting, templateMode, typedAt,
} from './state.js';

/**
 * A piece of syntax put away, and the side of it the caret takes (`editor/caret.js`):
 * `prefix`, a line's own marks, the caret after them; `open` and `close`, the marks of
 * bold, italic and strikethrough, the caret before each, so what is typed at their end
 * carries the mark; `start` and `end`, the marks of code and of a link, the caret
 * outside both. `mark` names the mark they belong to, for Ctrl+B at the caret.
 */
const conceal = (edge, mark) => Decoration.replace({ conceal: edge, mark });

/** The class each mark around words is drawn in. */
const MARK_CLASS = { bold: 'cm-strong', italic: 'cm-em', strike: 'cm-strike' };

/** What a link's words say on hover: its address, and how to open it. Never shown inline. */
export function linkTitle(url) {
  const key = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '') ? '⌘' : 'Ctrl';
  return `${url}\n${key}+click to open, Ctrl+K to edit`;
}

/** A link's words, which carry its address for a press with Ctrl to open. */
function linkMark(url) {
  return Decoration.mark({ class: 'cm-link', attributes: { 'data-href': url, title: linkTitle(url) } });
}

function lineClass(name, attributes) {
  return Decoration.line({ class: name, attributes });
}

/** The line a `:::` block closes on, unless its kind says otherwise. */
const FENCE_CLOSE = /^:::[ \t]*$/;

/**
 * The lines being written in: the ones the cursor is on, when the editor has focus.
 * Only a template's guidance shows as text there; nothing else of a line changes
 * with the cursor. While the mouse is pressed, the lines held when it went down stay
 * as they were (`selecting`), so nothing moves under the pointer.
 */
function editedLines(state) {
  const held = state.field(selecting, false);
  if (!held) return cursorLines(state);
  return new Set(held.lines.filter((number) => number <= state.doc.lines));
}

function touches(lines, state, from, to) {
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(Math.max(from, to)).number;
  for (let line = first; line <= last; line += 1) if (lines.has(line)) return true;
  return false;
}

/** Whether the comment `from`–`to` is one line of guidance (`<!--? … -->`). */
function hintOn(state, from, to) {
  const line = state.doc.lineAt(from);
  return to <= line.to && HINT_LINE.test(line.text);
}

/** The guidance line at `pos`, outside code, or null. */
export function hintLineAt(state, pos) {
  const line = state.doc.lineAt(pos);
  if (!HINT_LINE.test(line.text)) return null;
  const tree = ensureSyntaxTree(state, line.to, 50) ?? syntaxTree(state);
  const start = line.from + /^[ \t]*/.exec(line.text)[0].length;
  for (let node = tree.resolveInner(start, 1); node; node = node.parent) {
    if (node.name === 'CommentBlock') return line;
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') return null;
  }
  return null;
}

/** A fence's first and last lines, greyed while its source is open. */
function fenceSource(ctx, range) {
  ctx.line(range.from, 'cm-fence-line');
  ctx.line(ctx.state.doc.line(range.last).from, 'cm-fence-line');
  return true;
}

/**
 * Everything the page draws for this state, as one set. Exported so the drawing is
 * tested on a state with no view.
 */
export function noteDecorations(state) {
  const info = state.field(noteCase);
  const lines = editedLines(state);
  const open = state.field(openBlock, false);
  const heads = state.selection.ranges.map((range) => range.head);
  /** Whether the lines `from`–`to` are in the block that was opened. */
  const inOpen = (from, to) => Boolean(open && open.from <= state.doc.lineAt(Math.max(from, to)).to && state.doc.lineAt(from).from <= open.to);
  /** Whether the block over `from`–`to` shows its source: it was opened, or the cursor is inside it (a jump, an Undo). */
  const isOpen = (from, to) => {
    const start = state.doc.lineAt(from).from;
    const end = state.doc.lineAt(Math.max(from, to)).to;
    return inOpen(from, to) || heads.some((head) => head > start && head < end);
  };
  const range = state.selection.main;
  const pick = state.field(focused, false) && range.empty ? range.head : -1;
  const typed = state.field(typedAt, false) ?? -1;
  const opened = []; // [from, to] of the blocks whose source shows, every line of it as written
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
  const ranges = [];
  const covered = []; // [from, to] of blocks drawn whole; nothing else goes inside them
  const inside = (pos) => covered.some(([from, to]) => pos >= from && pos <= to);
  const code = []; // [from, to] of code, where references and coordinates stay text
  const inCode = (pos) => code.some(([from, to]) => pos >= from && pos < to);
  const template = state.facet(templateMode);
  const whole = []; // what stands for its whole stretch: a chip, a chapter; a mark the parser found inside is not drawn
  const counts = new Map();
  let coverEnd; // the 1-based line of the cover rule, 0 without one: found when a corner asks

  const ctx = {
    state,
    info,
    pick,
    isOpen,
    inCode,
    aligns: new Map(), // the place of the aligned block each line stands in, by line number, for a picture there
    line: (pos, className) => ranges.push(lineClass(className).range(pos)),
    lines: (from, to, className) => {
      for (let number = state.doc.lineAt(from).number; number <= state.doc.lineAt(to).number; number += 1) {
        ranges.push(lineClass(className).range(state.doc.line(number).from));
      }
    },
    mark: (from, to, className) => ranges.push(Decoration.mark({ class: className }).range(from, to)),
    count: (name) => {
      counts.set(name, (counts.get(name) ?? 0) + 1);
      return counts.get(name);
    },
    standsWhole: (item) => whole.push({ from: item.from, to: item.to }),
    coverEnd: () => {
      coverEnd ??= coverLineIndex(state.doc.toString()) + 1;
      return coverEnd;
    },
  };

  /** Draw the block of kind `name` over the whole lines of `found`, a press at its start picking it. */
  const block = (name, found) => {
    const first = state.doc.lineAt(found.from);
    const last = state.doc.lineAt(found.to);
    covered.push([first.from, last.to]);
    const widget = blockKind(name).widget({
      ...found,
      kind: name,
      source: state.doc.sliceString(first.from, last.to),
      info,
      writable: !state.readOnly,
      blockAlign: ctx.aligns.get(first.number) ?? '',
      pinned: Boolean(found.pinned),
      picked: first.from === pick,
    });
    ranges.push(Decoration.replace({ widget, block: true }).range(first.from, last.to));
  };

  /** A kind found at `found`: drawn whole, or its source dressed while it is open. Answers whether it took the lines. */
  const place = (kind, found) => {
    if (!isOpen(found.from, found.to)) {
      block(kind.name, found);
      return true;
    }
    opened.push([state.doc.lineAt(found.from).from, state.doc.lineAt(found.to).to]);
    return Boolean((kind.source ?? (kind.fence ? fenceSource : null))?.(ctx, found));
  };

  // `:::` blocks, the old Notebook's aligned text, steps and stories and maps: drawn as they read unless open
  const fences = fenceKinds();
  scan: for (let number = 1; fences.length && number <= state.doc.lines; number += 1) {
    const text = state.doc.line(number).text;
    for (const kind of fences) {
      const match = kind.fence.exec(text);
      if (!match) continue;
      const close = kind.close ?? FENCE_CLOSE;
      let end = number + 1;
      while (end <= state.doc.lines && !close.test(state.doc.line(end).text)) end += 1;
      // a block left open runs to the end of the note: nothing after it is read as a block
      if (end > state.doc.lines) break scan;
      const fence = { match, from: state.doc.line(number).from, to: state.doc.line(end).to, first: number, last: end };
      const found = kind.read ? kind.read(fence, ctx) : fence;
      // a kind may leave a fence it opens with to the next (a story to its own kind)
      if (!found) continue;
      place(kind, { ...fence, ...found });
      number = end;
      break;
    }
  }

  /** Whether the lines `from`–`to` show their source: in a block that was opened, or whose source shows. */
  const shows = (from, to = from) => inOpen(from, to) || opened.some(([start, end]) => from >= start && to <= end);
  /** Put the syntax `from`–`to` away, unless its lines show their source. */
  const hide = (from, to, edge, mark) => {
    if (to > from && !shows(from, to)) ranges.push(conceal(edge, mark).range(from, to));
  };
  /** A piece of a line drawn as `widget` in place of its syntax, the caret taking `edge` of it. */
  const swap = (from, to, widget, edge) => {
    if (to > from && !shows(from, to)) ranges.push(Decoration.replace({ widget, conceal: edge }).range(from, to));
  };
  const numbers = new Map(); // where each item of a numbered list starts → the number it shows
  const quoted = new Set(); // the lines whose quote marks are put away already: a quote in a quote has them once

  tree?.iterate({
    enter(node) {
      const { name, from, to } = node;
      // the document itself starts where a block drawn whole may: only what is in it is skipped
      if (name !== 'Document' && inside(from)) return false;
      const editing = touches(lines, state, from, to);
      if (name === 'CommentBlock' && hintOn(state, from, to)) {
        const line = state.doc.lineAt(from);
        // a template's guidance is edited as text; a note's stays drawn, and typing replaces it
        if (template && editing) ranges.push(lineClass('cm-hint-line').range(line.from));
        else ranges.push(Decoration.replace({ widget: new HintWidget(HINT_LINE.exec(line.text)[1], template) }).range(line.from, line.to));
        return false;
      }
      for (const kind of nodeKinds(name)) {
        const found = kind.read(node, ctx);
        if (!found) continue;
        if (place(kind, found)) return false;
        break;
      }
      if (name === 'FencedCode') {
        code.push([from, to]);
        const first = state.doc.lineAt(from).number;
        const last = state.doc.lineAt(to).number;
        // the fences of code, the one Markdown left on the page, stay faint beside what they hold
        for (let line = first; line <= last; line += 1) {
          ranges.push(lineClass('cm-code-line').range(state.doc.line(line).from));
          if (line === first || (line === last && /^\s*(`{3,}|~{3,})\s*$/.test(state.doc.line(line).text))) ranges.push(lineClass('cm-fence-line').range(state.doc.line(line).from));
        }
        return false;
      }
      if (name === 'InlineCode') {
        code.push([from, to]);
        ranges.push(Decoration.mark({ class: 'cm-inline-code' }).range(from, to));
        const marks = node.node.getChildren('CodeMark');
        if (marks.length >= 2) {
          hide(marks[0].from, marks[0].to, 'start', 'code');
          hide(marks.at(-1).from, marks.at(-1).to, 'end', 'code');
        }
        return false;
      }
      if (name === 'SetextHeading1' || name === 'SetextHeading2') {
        const rule = node.node.getChild('HeaderMark');
        const under = rule ? state.doc.lineAt(rule.from) : null;
        // a `-` just typed under words starts a list: they are no heading for it
        if (under && typed === under.to && /^ {0,3}[-=][ \t]*$/.test(under.text)) return undefined;
        const level = name.endsWith('1') ? 1 : 2;
        ranges.push(lineClass(`cm-heading cm-h${level}`).range(state.doc.lineAt(from).from));
        if (under && !shows(under.from)) ranges.push(lineClass('cm-setext-rule').range(under.from));
        return undefined;
      }
      if (/^ATXHeading[1-6]$/.test(name)) {
        const line = state.doc.lineAt(from);
        const marks = node.node.getChildren('HeaderMark');
        const open = marks[0];
        // `##` just typed with nothing after it: a heading once the space comes
        if (!open || (typed === line.to && open.to === line.to)) return undefined;
        ranges.push(lineClass(`cm-heading cm-h${name.slice(-1)}`).range(line.from));
        const words = open.to + /^[ \t]*/.exec(state.sliceDoc(open.to, line.to))[0].length;
        hide(open.from, words, 'prefix');
        // the closing `#`s some write, `## Title ##`, with the spaces before them
        const last = marks.at(-1);
        if (marks.length > 1 && last.from >= words) hide(last.from - /[ \t]*$/.exec(state.sliceDoc(words, last.from))[0].length, line.to, 'close');
        return undefined;
      }
      if (name === 'StrongEmphasis' || name === 'Emphasis' || name === 'Strikethrough') {
        const kind = name === 'StrongEmphasis' ? 'bold' : name === 'Emphasis' ? 'italic' : 'strike';
        const marks = node.node.getChildren(name === 'Strikethrough' ? 'StrikethroughMark' : 'EmphasisMark');
        if (marks.length < 2) return undefined;
        const open = marks[0];
        const close = marks.at(-1);
        // the first `*` closing `**words*` just typed reads as italics: drawn once the second comes
        if (typed === close.to && state.sliceDoc(open.from - 1, open.from) === state.sliceDoc(open.from, open.from + 1)) return undefined;
        ranges.push(Decoration.mark({ class: MARK_CLASS[kind] }).range(from, to));
        hide(open.from, open.to, 'open', kind);
        hide(close.from, close.to, 'close', kind);
        return undefined;
      }
      if (name === 'Link') {
        // `[[entity:…|…]]` holds a bracket pair the parser reads as a link; it is a reference
        if (state.doc.sliceString(from, from + 2) === '[[' || state.doc.sliceString(from - 1, from) === '[') return false;
        const marks = node.node.getChildren('LinkMark');
        const url = node.node.getChild('URL');
        // words in brackets with no address, `[1]` or `[sic]`, print as they are written
        if (!url || marks.length < 3) return undefined;
        ranges.push(linkMark(state.sliceDoc(url.from, url.to)).range(from, to));
        hide(marks[0].from, marks[0].to, 'start', 'link');
        hide(marks[1].from, to, 'end', 'link');
        // the words of a link may be bold
        return undefined;
      }
      if (name === 'Autolink') {
        const marks = node.node.getChildren('LinkMark');
        const url = node.node.getChild('URL');
        if (url) ranges.push(linkMark(state.sliceDoc(url.from, url.to)).range(from, to));
        if (url && marks.length === 2) {
          hide(marks[0].from, marks[0].to, 'start', 'link');
          hide(marks[1].from, marks[1].to, 'end', 'link');
        }
        return false;
      }
      if (name === 'URL') {
        // an address written bare, which the PDF links too
        if (!['Link', 'Image', 'Autolink'].includes(node.node.parent?.name)) ranges.push(linkMark(state.sliceDoc(from, to)).range(from, to));
        return false;
      }
      if (name === 'Escape') {
        // `\*` prints `*`: its backslash is put away, the caret never between the two
        hide(from, from + 1, 'start');
        return false;
      }
      if (name === 'Image') {
        // a picture inside words, or whose source is open: shown as a link
        ranges.push(Decoration.mark({ class: 'cm-link' }).range(from, to));
        return false;
      }
      if (name === 'Blockquote') {
        const firstLine = state.doc.lineAt(from);
        const lastNumber = state.doc.lineAt(to).number;
        // `>` just typed alone on its line: a quote once the space comes
        if (lastNumber === firstLine.number && typed === firstLine.to && /^[ \t]*>$/.test(firstLine.text)) return undefined;
        const callout = calloutOf(firstLine.text);
        for (let number = firstLine.number; number <= lastNumber; number += 1) {
          const line = state.doc.line(number);
          ranges.push(lineClass(callout ? `cm-callout cm-callout-${callout.kind}` : 'cm-quote',
            callout ? { style: `--callout: ${callout.colour}` } : undefined).range(line.from));
          if (quoted.has(number)) continue;
          quoted.add(number);
          const mark = /^(?:[ \t]*>[ \t]?)+/.exec(line.text);
          if (mark) hide(line.from, line.from + mark[0].length, 'prefix');
        }
        if (callout) {
          const marker = CALLOUT_LINE.exec(firstLine.text);
          const quote = /^\s*>\s?/.exec(firstLine.text)[0].length;
          swap(firstLine.from + quote, firstLine.from + marker[0].length, new CalloutLabelWidget(callout, firstLine.from), 'prefix');
        }
        return undefined;
      }
      if (name === 'QuoteMark') return false;
      if (name === 'OrderedList') {
        // the numbers a list prints: its first item's, then one more each
        let number = null;
        for (let item = node.node.firstChild; item; item = item.nextSibling) {
          const mark = item.name === 'ListItem' ? item.getChild('ListMark') : null;
          if (!mark) continue;
          const written = state.sliceDoc(mark.from, mark.to);
          number = number === null ? Number.parseInt(written, 10) : number + 1;
          numbers.set(item.from, `${number}${written.slice(-1)}`);
        }
        return undefined;
      }
      if (name === 'ListItem') {
        const mark = node.node.getChild('ListMark');
        if (!mark) return undefined;
        const line = state.doc.lineAt(from);
        // a mark just typed with nothing after it, `-` or `1.`: an item once the space comes
        if (mark.to === line.to && typed === line.to) return undefined;
        // the spaces after a mark are part of it, but past four the words start after one
        const gap = (at) => {
          const spaces = /^[ \t]*/.exec(state.sliceDoc(at, line.to))[0].length;
          return at + (spaces > 4 ? 1 : spaces);
        };
        const task = node.node.getChild('Task')?.getChild('TaskMarker');
        if (task) {
          const done = /x/i.test(state.doc.sliceString(task.from, task.to));
          if (done) ranges.push(lineClass('cm-task-done').range(line.from));
          swap(mark.from, gap(task.to), new TaskWidget(done, task.from), 'prefix');
        } else if (/\d/.test(state.sliceDoc(mark.from, mark.to))) {
          swap(mark.from, gap(mark.to), new NumberWidget(numbers.get(from) ?? state.sliceDoc(mark.from, mark.to)), 'prefix');
        } else {
          swap(mark.from, gap(mark.to), new BulletWidget(), 'prefix');
        }
        return undefined;
      }
      return undefined;
    },
  });

  // References, footnotes, coordinates and chapters are not Markdown: found line by line, outside code.
  // an editor with no map around it says so with a null `point` (the extension's panel)
  const mapless = state.facet(noteHandlers).point === null;
  const ownLines = lineKinds();
  // a footnote's letter counts every footnote before it, in a table or a block too, as the documents letter them
  const notes = state.doc.toString().includes('^[') ? footnotesOf(state.doc.toString()) : [];
  for (let number = 1; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number);
    if (inside(line.from) || !line.text) continue;
    let taken = false;
    for (const kind of ownLines) {
      const found = kind.line(line, ctx);
      if (!found) continue;
      taken = place(kind, found);
      break;
    }
    if (taken) continue;
    // only a block whose source is open shows what a line is made of
    const source = shows(line.from, line.to);
    // a footnote is its letter, whatever it holds: its words show on hover and open in the Footnote field
    const footnotes = notes.filter((note) => note.from >= line.from && note.to <= line.to && !inCode(note.from));
    for (const note of footnotes) {
      if (source) ranges.push(Decoration.mark({ class: 'cm-footnote-source' }).range(note.from, note.to));
      else {
        whole.push(note);
        ranges.push(Decoration.replace({ widget: new FootnoteWidget(footnoteLetter(notes.indexOf(note)), note.words, note.from), conceal: 'atom' })
          .range(note.from, note.to));
      }
    }
    const refs = findReferences(line.text, line.from).filter((ref) => !inCode(ref.from));
    for (const ref of refs) {
      const entity = resolve(info, ref.id);
      if (source) ranges.push(Decoration.mark({ class: 'cm-ref-source' }).range(ref.from, ref.to));
      else {
        whole.push(ref);
        ranges.push(Decoration.replace({ widget: new ChipWidget(ref, entity), conceal: 'atom' }).range(ref.from, ref.to));
      }
    }
    for (const point of findCoordinates(line.text, line.from)) {
      if (inCode(point.from) || refs.some((ref) => point.from < ref.to && point.to > ref.from)) continue;
      ranges.push(Decoration.mark({ class: 'cm-coords' }).range(point.from, point.to));
      if (!mapless) ranges.push(Decoration.widget({ widget: new CoordinatesWidget(point.lat, point.lon), side: 1 }).range(point.to));
    }
    // the words the PDF fills in, drawn as they print, their source in an open block
    const placeholders = HINT_LINE.test(line.text) ? [] : findPlaceholders(line.text, line.from);
    for (const word of placeholders) {
      if (inCode(word.from) || refs.some((ref) => word.from < ref.to && word.to > ref.from)) continue;
      if (source) ranges.push(Decoration.mark({ class: 'cm-placeholder-source' }).range(word.from, word.to));
      else ranges.push(Decoration.replace({ widget: new PlaceholderWidget(word.id, info.identity), conceal: 'atom' }).range(word.from, word.to));
    }
  }
  // a chip stands for its whole reference, and a chapter for its line: a mark the parser found inside is not drawn
  // and what a block drawn whole stands over is its own: the marks of a quote around a table go with it
  const kept = ranges.filter((range) => !whole.some((item) => range.from >= item.from && range.to <= item.to
    && !(range.from === item.from && range.to === item.to))
    && !(range.value.spec.conceal && covered.some(([from, to]) => range.from >= from && range.to <= to)));
  return Decoration.set(kept, true);
}

/** The page drawn now; absent from the state in the raw Markdown mode. */
export const drawn = StateField.define({
  create: (state) => noteDecorations(state),
  update(value, transaction) {
    const refocused = transaction.effects.some((effect) => effect.is(setFocused) || effect.is(setNoteCase) || effect.is(setSelecting));
    // a note read while it was locked gets its pictures' bars once it can be written
    const unlocked = transaction.startState.readOnly !== transaction.state.readOnly;
    // a block opened or closed is drawn as source or as itself
    const reopened = transaction.startState.field(openBlock, false) !== transaction.state.field(openBlock, false);
    if (transaction.docChanged || transaction.selection || refocused || unlocked || reopened) return noteDecorations(transaction.state);
    return value;
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    // a drawn block is one piece, so the cursor steps over it; in a note so is a line of guidance, and a delete takes it whole;
    // and so is every piece of syntax put away, a chip, a bullet: the caret never stands inside one
    EditorView.atomicRanges.of((view) => view.state.field(field).update({
      filter: (_from, _to, value) => Boolean(value.spec.conceal) || isAtomic(value.spec.widget)
        || (!view.state.facet(templateMode) && value.spec.widget instanceof HintWidget),
    })),
  ],
});

/**
 * In a note, what is typed on a line of guidance takes its place: the grey words
 * are a prompt, not text to write after. Enter still opens a line beside it.
 */
export const typeOverHints = EditorState.transactionFilter.of((transaction) => {
  if (!transaction.docChanged || !transaction.isUserEvent('input') || transaction.startState.facet(templateMode)) return transaction;
  const inserts = [];
  transaction.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => inserts.push({ fromA, toA, text: inserted.toString() }));
  if (inserts.length !== 1) return transaction;
  const [{ fromA, toA, text }] = inserts;
  if (fromA !== toA || /^\n*$/.test(text)) return transaction;
  const line = hintLineAt(transaction.startState, fromA);
  if (!line) return transaction;
  return {
    changes: { from: line.from, to: line.to, insert: text },
    selection: { anchor: line.from + text.length },
    scrollIntoView: true,
    annotations: Transaction.userEvent.of(transaction.annotation(Transaction.userEvent) ?? 'input.type'),
  };
});

// -- the raw Markdown ---------------------------------------------------------------

/** What the raw Markdown keeps of the page: headings, code, tables and guidance lines in their own type, nothing hidden or replaced. */
function rawLines(state) {
  const ranges = [];
  const code = [];
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
  const eachLine = (from, to, className) => {
    for (let number = state.doc.lineAt(from).number; number <= state.doc.lineAt(to).number; number += 1) {
      ranges.push(lineClass(className).range(state.doc.line(number).from));
    }
  };
  tree?.iterate({
    enter(node) {
      const { name, from, to } = node;
      if (name === 'FencedCode' || name === 'CodeBlock') {
        code.push([from, to]);
        eachLine(from, to, 'cm-code-line');
        return false;
      }
      if (name === 'Table') {
        eachLine(from, to, 'cm-table-line');
        return false;
      }
      if (/^ATXHeading[1-6]$/.test(name)) eachLine(from, from, `cm-heading cm-h${name.slice(-1)}`);
      else if (name === 'SetextHeading1' || name === 'SetextHeading2') eachLine(from, from, `cm-heading cm-h${name.slice(-1)}`);
      return undefined;
    },
  });
  for (let number = 1; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number);
    if (!line.text || code.some(([from, to]) => line.from >= from && line.from < to)) continue;
    if (HINT_LINE.test(line.text)) ranges.push(lineClass('cm-hint-line').range(line.from));
    else if (PAGE_BREAK_LINE.test(line.text) || COVER_LINE.test(line.text)) ranges.push(lineClass('cm-pagebreak-line').range(line.from));
  }
  return Decoration.set(ranges, true);
}

export const rawField = StateField.define({
  create: (state) => rawLines(state),
  update: (value, transaction) => (transaction.docChanged ? rawLines(transaction.state) : value),
  provide: (field) => EditorView.decorations.from(field),
});

export const rawHighlight = HighlightStyle.define([
  { tag: tags.strong, fontWeight: '650' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--info)' },
]);
