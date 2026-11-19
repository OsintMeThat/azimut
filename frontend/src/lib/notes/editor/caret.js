/**
 * Where the caret stands on the drawn page, which never shows its Markdown, and what
 * typing next to the syntax put away does (`editor/decorations.js` puts it away and
 * says which side of each piece the caret takes).
 *
 * - A line's own marks (`## `, `> `, a bullet, a box) are before its words: the caret
 *   never stands among them, so nothing is typed before them.
 * - The marks around words are crossed as nothing: Left and Right move one character
 *   that shows, and a press, Up and Down put the caret on the side typing should go.
 *   What is typed at the end of bold is bold, at the end of a link or of code it is
 *   not, before either it is not; at the start of a line it takes the first word's.
 * - Ctrl+B (Ctrl+I, Ctrl+E) with nothing selected steps the caret to the other side of
 *   the mark it stands at, or holds the mark for what is typed next.
 * - A change that cuts into marks keeps them whole: a delete never takes half of a
 *   `**`, and the marks of words deleted entirely go with them.
 * - A space ends two shortcuts: `[] ` makes a to-do, and a list's mark typed right under
 *   a line of words gets the blank line that lets it be a list.
 *
 * Each rule reads a state alone and answers a position or a transaction spec, so it is
 * tested without a browser; the extensions at the end put them in the drawn mode.
 */
import { EditorSelection, EditorState, Prec, StateEffect, StateField, Transaction, findClusterBreak } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';

import { drawn } from './decorations.js';
import { INLINE_MARKS } from './marks.js';
import { settle } from './ranges.js';
import { typedAt } from './state.js';

/** The pieces put away around words, crossed as nothing; anything else put away (a chip, a box) is one character. */
const INLINE = new Set(['open', 'start', 'close', 'end']);

/** Lines written right to left: the arrows are left to the browser there. */
const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

/** The pieces of syntax put away that touch `from`–`to`, as `{ from, to, edge, mark }`. */
export function piecesIn(state, from, to = from) {
  const found = [];
  state.field(drawn, false)?.between(Math.max(0, from), Math.min(state.doc.length, to), (start, end, value) => {
    const { conceal, mark } = value.spec;
    if (conceal && end > start) found.push({ from: start, to: end, edge: conceal, mark: mark ?? null });
  });
  return found;
}

/** Where the words of `line` start: after its own marks (a quote's, a heading's, a list's) and the spaces among them. */
export function wordsStart(state, line) {
  let at = line.from;
  let found = false;
  for (;;) {
    let next = at;
    while (next < line.to && /[ \t]/.test(state.doc.sliceString(next, next + 1))) next += 1;
    const piece = piecesIn(state, next).find((one) => one.edge === 'prefix' && one.from === next && one.to > next);
    if (!piece) break;
    found = true;
    at = piece.to;
  }
  return found ? at : line.from;
}

/**
 * The run of marks put away that `pos` stands in, side by side on the page as one
 * place: `{ from, to, pieces }`, `pieces` in order. `from` = `to` = `pos` where none is.
 */
export function chainAt(state, pos) {
  let from = pos;
  let to = pos;
  const pieces = [];
  for (let piece; (piece = piecesIn(state, from).find((one) => INLINE.has(one.edge) && one.to === from && one.from < from));) {
    pieces.unshift(piece);
    from = piece.from;
  }
  for (let piece; (piece = piecesIn(state, to).find((one) => INLINE.has(one.edge) && one.from === to && one.to > to));) {
    pieces.push(piece);
    to = piece.to;
  }
  return { from, to, pieces };
}

/**
 * The place in `chain` typing should go: past the marks that do not carry on (a link's
 * end, code's), before the ones that do (bold's end) and before any opening, except at
 * the start of a line's words, where the first word's bold is carried.
 */
function typingPlace(chain, start) {
  let at = chain.from;
  for (const piece of chain.pieces) {
    if (!(piece.edge === 'end' || (at <= start && piece.edge === 'open'))) break;
    at = piece.to;
  }
  return at;
}

/**
 * Where the caret goes for `pos`: in the line's words, never inside a piece put away,
 * and, with `pick`, at the one place of a run of marks typing should go.
 */
export function caretAt(state, pos, { pick = true } = {}) {
  const line = state.doc.lineAt(pos);
  const start = wordsStart(state, line);
  if (pos < start) pos = start;
  else {
    const within = piecesIn(state, pos).find((piece) => piece.from < pos && piece.to > pos);
    if (within) pos = INLINE.has(within.edge) ? within.from : pos - within.from <= within.to - pos ? within.from : within.to;
  }
  if (!pick) return pos;
  const chain = chainAt(state, pos);
  return chain.pieces.length ? Math.max(start, typingPlace(chain, start)) : pos;
}

/** Where the character that shows right after `at` ends, on its line: a chip or a box is one. */
export function unitAfter(state, at) {
  const line = state.doc.lineAt(at);
  const atom = piecesIn(state, at).find((piece) => piece.from === at && !INLINE.has(piece.edge));
  return atom ? atom.to : line.from + findClusterBreak(line.text, at - line.from, true);
}

/** Where the character that shows right before `at` starts, on its line: a chip or a box is one. */
export function unitBefore(state, at) {
  const line = state.doc.lineAt(at);
  const atom = piecesIn(state, at).find((piece) => piece.to === at && !INLINE.has(piece.edge));
  return atom ? atom.from : line.from + findClusterBreak(line.text, at - line.from, false);
}

/** The caret one character that shows to the right of `pos`, or the start of the next line's words. */
export function stepRight(state, pos) {
  const line = state.doc.lineAt(pos);
  const at = chainAt(state, pos).to;
  if (at >= line.to) {
    if (line.number >= state.doc.lines) return pos;
    return settle(state, caretAt(state, state.doc.line(line.number + 1).from));
  }
  return caretAt(state, unitAfter(state, at));
}

/** The caret one character that shows to the left of `pos`, or the end of the line before. */
export function stepLeft(state, pos) {
  const line = state.doc.lineAt(pos);
  const at = chainAt(state, pos).from;
  if (at <= wordsStart(state, line)) {
    if (line.number <= 1) return pos;
    return settle(state, caretAt(state, state.doc.line(line.number - 1).to));
  }
  return caretAt(state, unitBefore(state, at));
}

/** Left and Right, with Shift to grow the selection: one character that shows. */
function arrow(forward, extend) {
  return (view) => {
    const { state } = view;
    if (!state.field(drawn, false)) return false;
    const ranges = [];
    for (const range of state.selection.ranges) {
      if (RTL.test(state.doc.lineAt(range.head).text)) return false;
      if (!extend && !range.empty) {
        ranges.push(EditorSelection.cursor(caretAt(state, forward ? range.to : range.from)));
        continue;
      }
      const head = forward ? stepRight(state, range.head) : stepLeft(state, range.head);
      ranges.push(extend ? EditorSelection.range(range.anchor, head) : EditorSelection.cursor(head, forward ? -1 : 1));
    }
    const selection = EditorSelection.create(ranges, state.selection.mainIndex);
    if (!selection.eq(state.selection)) view.dispatch({ selection, scrollIntoView: true, userEvent: 'select' });
    return true;
  };
}

/** Ctrl+Left at the start of a line's words goes to the end of the line before, past its marks. */
function wordLeft(view) {
  const { state } = view;
  const range = state.selection.main;
  if (!state.field(drawn, false) || !range.empty || state.selection.ranges.length > 1) return false;
  const line = state.doc.lineAt(range.head);
  if (chainAt(state, range.head).from > wordsStart(state, line) || line.number <= 1) return false;
  view.dispatch({ selection: { anchor: stepLeft(state, range.head) }, scrollIntoView: true, userEvent: 'select' });
  return true;
}

/**
 * Every cursor that a move, a press or an Undo put among a line's marks or inside a
 * piece put away goes to the words, and one a press or a key put in a run of marks to
 * where typing should go. A move by Ctrl+B (`select.mark`), and typing, keep their side.
 */
export const settleCaret = EditorState.transactionFilter.of((transaction) => {
  if (!transaction.selection || !transaction.startState.field(drawn, false)) return transaction;
  const undone = transaction.isUserEvent('undo') || transaction.isUserEvent('redo');
  if (transaction.docChanged && !undone) return transaction;
  const pick = transaction.isUserEvent('select') && !transaction.isUserEvent('select.mark');
  // the page as it will be drawn: the one before serves a plain move, nothing in it depending on where the caret was
  const state = transaction.docChanged || transaction.startState.field(typedAt, false) >= 0 ? transaction.state : transaction.startState;
  const ranges = transaction.selection.ranges.map((range) => {
    if (!range.empty) return range;
    const pos = caretAt(state, range.head, { pick });
    return pos === range.head ? range : EditorSelection.cursor(pos, pos > range.head ? -1 : 1, undefined, range.goalColumn);
  });
  if (ranges.every((range, index) => range === transaction.selection.ranges[index])) return transaction;
  return [transaction, { selection: EditorSelection.create(ranges, transaction.selection.mainIndex), sequential: true }];
});

// -- marks at the caret ---------------------------------------------------------

/** Marks held at the caret for what is typed next, `{ at, kinds }`: Ctrl+B with nothing selected. */
export const setPending = StateEffect.define();
export const pendingMarks = StateField.define({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setPending)) return effect.value;
    return transaction.docChanged || transaction.selection ? null : value;
  },
});

/** The order marks are written in around words, the outermost first. */
const NESTING = ['bold', 'italic', 'strike', 'code'];

/** The marks `kinds` written around words: `{ open, close }`. */
export function marksAround(kinds) {
  let open = '';
  let close = '';
  for (const kind of NESTING) {
    if (!kinds.includes(kind)) continue;
    open += INLINE_MARKS[kind].mark;
    close = INLINE_MARKS[kind].mark + close;
  }
  return { open, close };
}

/**
 * Ctrl+B (`kind` bold), Ctrl+I or Ctrl+E with nothing selected: at the edge of a mark
 * of that kind the caret steps to its other side (what is typed next leaves the mark,
 * or joins it); anywhere else the mark is held for what is typed next, or let go.
 */
export function markAtCaret(state, kind) {
  const range = state.selection.main;
  if (!range.empty || !INLINE_MARKS[kind]) return null;
  const pos = range.head;
  for (const piece of chainAt(state, pos).pieces) {
    if (piece.mark !== kind) continue;
    if (pos <= piece.from) return { selection: EditorSelection.create([EditorSelection.cursor(piece.to, -1)]), userEvent: 'select.mark' };
    if (pos >= piece.to) return { selection: EditorSelection.create([EditorSelection.cursor(piece.from, 1)]), userEvent: 'select.mark' };
  }
  const now = state.field(pendingMarks, false);
  const kinds = new Set(now?.at === pos ? now.kinds : []);
  if (kinds.has(kind)) kinds.delete(kind);
  else kinds.add(kind);
  return { effects: setPending.of(kinds.size ? { at: pos, kinds: [...kinds] } : null) };
}

// -- typing ---------------------------------------------------------------------

/** Whether the line before `line` is words of a paragraph at the top of the note, which a list's mark alone cannot interrupt. */
function underWords(state, line) {
  if (line.number <= 1) return false;
  const before = state.doc.line(line.number - 1);
  if (!before.text.trim()) return false;
  const tree = ensureSyntaxTree(state, before.to, 100) ?? syntaxTree(state);
  // the words and the mark under them may read as a heading underlined already
  for (let node = tree.resolveInner(before.to, -1); node; node = node.parent) {
    if (node.name === 'Paragraph' || /^SetextHeading/.test(node.name)) return node.parent?.name === 'Document';
  }
  return false;
}

/**
 * What a space typed at `pos` makes besides itself: `[] ` (or `[x] `) at the start of a
 * line's words a to-do, and a list's mark typed alone under a line of words a list,
 * with the blank line Markdown needs between them. A spec, or null.
 */
export function spaceShortcut(state, pos) {
  const line = state.doc.lineAt(pos);
  const before = state.sliceDoc(line.from, pos);
  const box = /^([ \t]*(?:>[ \t]?)*)((?:[-*+]|\d{1,9}[.)])[ \t]+)?\[([ xX]?)\]$/.exec(before);
  if (box) {
    const insert = `${box[1]}${box[2] ?? '- '}[${box[3].trim() ? 'x' : ' '}] `;
    return { changes: { from: line.from, to: pos, insert }, selection: EditorSelection.cursor(line.from + insert.length) };
  }
  if (/^[ \t]{0,3}(?:[-*+]|\d{1,9}[.)])$/.test(before) && !state.sliceDoc(pos, line.to).trim() && underWords(state, line)) {
    return { changes: [{ from: line.from, insert: state.lineBreak }, { from: pos, insert: ' ' }], selection: EditorSelection.cursor(pos + 2) };
  }
  return null;
}

/** Whether `a` and `b` show as one place on the page: in one run of marks put away. */
function onePlace(state, a, b) {
  const chain = chainAt(state, Math.min(a, b));
  return chain.to >= Math.max(a, b);
}

/**
 * Typing on the drawn page: marks held by Ctrl+B wrap the words typed, a space may end
 * a shortcut, and what the browser typed on the other side of marks put away goes
 * where the caret is. An input method's composing is left to the browser.
 */
export const typeAtCaret = EditorView.inputHandler.of((view, from, to, text) => {
  const { state } = view;
  if (view.composing || view.compositionStarted || state.readOnly || !state.field(drawn, false)) return false;
  const range = state.selection.main;
  if (!range.empty || state.selection.ranges.length > 1 || from !== to) return false;
  const head = range.head;
  if (from !== head && !onePlace(state, from, head)) return false;
  const pending = state.field(pendingMarks, false);
  if (pending?.at === head) {
    // a space alone keeps the marks waiting: `** **` would show as written
    if (!text.trim()) {
      view.dispatch({
        changes: { from: head, insert: text }, selection: EditorSelection.cursor(head + text.length), userEvent: 'input.type',
        effects: setPending.of({ ...pending, at: head + text.length }),
      });
      return true;
    }
    const { open, close } = marksAround(pending.kinds);
    view.dispatch({
      changes: { from: head, insert: `${open}${text}${close}` }, selection: EditorSelection.cursor(head + open.length + text.length), userEvent: 'input.type',
    });
    return true;
  }
  const shortcut = text === ' ' ? spaceShortcut(state, head) : null;
  if (shortcut) {
    view.dispatch({ ...shortcut, userEvent: 'input.type', scrollIntoView: true });
    return true;
  }
  if (from === head) return false;
  view.dispatch({ changes: { from: head, insert: text }, selection: EditorSelection.cursor(head + text.length), userEvent: 'input.type' });
  return true;
});

// -- deleting -------------------------------------------------------------------

/** The marks around words that `from`–`to` touches, each `{ open: [from, to], close: [from, to] }`. */
export function markSpans(state, from, to) {
  const spans = [];
  const tree = ensureSyntaxTree(state, Math.min(state.doc.length, to + 1), 200) ?? syntaxTree(state);
  tree.iterate({
    from: Math.max(0, from),
    to: Math.min(state.doc.length, to),
    enter: (node) => {
      if (node.to <= from || node.from >= to) return;
      const name = node.name;
      if (name === 'Link') {
        const marks = node.node.getChildren('LinkMark');
        if (state.sliceDoc(node.from, node.from + 2) === '[[' || state.sliceDoc(node.from - 1, node.from) === '[') return;
        if (marks.length >= 3 && node.node.getChild('URL')) spans.push({ open: [marks[0].from, marks[0].to], close: [marks[1].from, node.to] });
        return;
      }
      const spec = Object.values(INLINE_MARKS).find((one) => one.node === name);
      if (!spec) return;
      const marks = node.node.getChildren(spec.child);
      if (marks.length >= 2) spans.push({ open: [marks[0].from, marks[0].to], close: [marks.at(-1).from, marks.at(-1).to] });
    },
  });
  return spans;
}

/** `ranges` (each `[from, to]`) merged where they touch. */
function merged(ranges) {
  const out = [];
  for (const [from, to] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const last = out.at(-1);
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

/** `ranges` with `cut` taken out of each. */
function without(ranges, cut) {
  const out = [];
  for (const [from, to] of ranges) {
    if (cut[1] <= from || cut[0] >= to) out.push([from, to]);
    else {
      if (cut[0] > from) out.push([from, cut[0]]);
      if (cut[1] < to) out.push([cut[1], to]);
    }
  }
  return out;
}

/**
 * A change of `from`–`to` to `insert` rewritten so it keeps marks whole: the marks of
 * words it takes entirely go too, unless it types in their place; a mark whose words
 * partly stay is kept. Answers `{ changes, at }` (`at` where `insert` lands), or null
 * when the change was whole already.
 */
export function keptChange(state, { from, to, insert = '' }) {
  if (to <= from) return null;
  const spans = markSpans(state, from, to);
  if (!spans.length) return null;
  let cut = [[from, to]];
  const gone = [];
  // a mark whose words all go goes too, and then a mark around it whose words were only that one
  for (let more = true; more;) {
    more = false;
    for (const span of spans) {
      if (gone.includes(span)) continue;
      const emptied = cut.reduce((rest, piece) => without(rest, piece), [[span.open[1], span.close[0]]]).every(([start, end]) => end <= start);
      const typedIn = insert && from >= span.open[0] && from <= span.open[1];
      if (!emptied || typedIn) continue;
      gone.push(span);
      cut = merged([...cut, [span.open[0], span.close[1]]]);
      more = true;
    }
  }
  for (const span of spans) {
    if (gone.includes(span)) continue;
    for (const piece of [span.open, span.close]) {
      if (!gone.some((one) => piece[0] >= one.open[0] && piece[1] <= one.close[1])) cut = without(cut, piece);
    }
  }
  cut = cut.filter(([start, end]) => end > start);
  if (cut.length === 1 && cut[0][0] === from && cut[0][1] === to) return null;
  const at = cut[0]?.[0] ?? from;
  const changes = cut.map(([start, end], index) => ({ from: start, to: end, insert: index === 0 ? insert : '' }));
  if (!changes.length && insert) changes.push({ from: at, insert });
  return { changes, at };
}

/** The user events whose changes keep marks whole: typing over words, deleting, pasting. */
function cutsWords(transaction) {
  return (transaction.isUserEvent('delete') || transaction.isUserEvent('input.type') || transaction.isUserEvent('input.paste')
    || transaction.isUserEvent('input.drop')) && !transaction.isUserEvent('input.type.compose');
}

/** Every delete, word typed over a selection and paste on the drawn page keeps the marks whole (`keptChange`). */
export const keepMarks = EditorState.transactionFilter.of((transaction) => {
  if (!transaction.docChanged || !cutsWords(transaction) || !transaction.startState.field(drawn, false)) return transaction;
  const list = [];
  transaction.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => list.push({ from: fromA, to: toA, insert: inserted.toString() }));
  if (list.length !== 1) return transaction;
  const kept = keptChange(transaction.startState, list[0]);
  if (!kept) return transaction;
  const changes = transaction.startState.changes(kept.changes);
  return {
    changes,
    selection: EditorSelection.cursor(changes.mapPos(kept.at, 1)),
    effects: transaction.effects,
    scrollIntoView: transaction.scrollIntoView,
    annotations: Transaction.userEvent.of(transaction.annotation(Transaction.userEvent)),
  };
});

// -- the drawn mode ---------------------------------------------------------------

/** Run a rule that answers a spec on a key: a spec is dispatched, `{}` takes the key and changes nothing. */
export function keyOf(rule) {
  return (view) => {
    if (view.state.readOnly || !view.state.field(drawn, false)) return false;
    const spec = rule(view.state);
    if (!spec) return false;
    if (spec.changes || spec.selection || spec.effects) view.dispatch({ scrollIntoView: true, ...spec });
    return true;
  };
}

const caretKeys = Prec.high(keymap.of([
  { key: 'ArrowRight', run: arrow(true, false), shift: arrow(true, true) },
  { key: 'ArrowLeft', run: arrow(false, false), shift: arrow(false, true) },
  { key: 'Mod-ArrowLeft', mac: 'Alt-ArrowLeft', run: wordLeft },
]));

/** Where the caret stands and what typing does next to the syntax put away, for the drawn mode. */
export const caretExtensions = [pendingMarks, settleCaret, keepMarks, typeAtCaret, caretKeys];
