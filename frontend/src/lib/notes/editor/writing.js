/**
 * What the toolbar and the keys write: a mark around the selection, a line's
 * prefix, text at the cursor, the cover page; where a jump to a line lands; Enter
 * on an empty list item; a task box ticked.
 */
import { EditorView } from '@codemirror/view';

import { coverChange } from '../reportParts.js';
import { markAtCaret } from './caret.js';
import { drawn } from './decorations.js';
import { PICTURE_LINE } from './pictureBlock.js';
import { runFormat, toggleInline } from './marks.js';
import { lightLines } from './puts.js';
import { blocksIn } from './ranges.js';
import { setFocused, setOpenBlock } from './state.js';

/** What each mark the toolbar and the keys write is, for `editor/marks.js`. */
const WRAPS = { '**': 'bold', '*': 'italic', '`': 'code', '~~': 'strike' };

/**
 * Set a mark on the selection (`**` for bold), or take it off the words that carry
 * it, read from the syntax tree so the `*` of italic is never taken for half of the
 * `**` of bold. One Undo step. With nothing selected on the drawn page, the caret
 * steps out of the mark or into it, or holds it for what is typed next
 * (`markAtCaret`), so no empty `****` is ever written there.
 */
export function toggleWrap(view, mark) {
  const kind = WRAPS[mark] ?? 'bold';
  const caret = view.state.selection.main.empty && view.state.field(drawn, false) ? markAtCaret(view.state, kind) : null;
  if (caret) view.dispatch(caret);
  else runFormat(view, toggleInline(view.state, kind));
  view.focus();
  return true;
}

/** Start the line the cursor is on with `prefix` (`## `, `- [ ] `), replacing a heading or list mark it had. */
export function setLinePrefix(view, prefix) {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const current = /^(\s*)(#{1,6}\s+|>\s*(\[![A-Za-z]+\]\s*)?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)?/.exec(line.text);
  const indent = current[1].length;
  const existing = current[2] ?? '';
  const next = existing === prefix ? '' : prefix;
  view.dispatch({
    changes: { from: line.from + indent, to: line.from + indent + existing.length, insert: next },
    selection: { anchor: line.from + indent + next.length + (line.length - indent - existing.length) },
    userEvent: 'input',
  });
  view.focus();
  return true;
}

/** Put text at the cursor, replacing the selection, with spaces around a chip so it stands alone. */
export function insertAtCursor(view, text, { block = false } = {}) {
  const { state } = view;
  const range = state.selection.main;
  let insert = text;
  if (block) {
    const line = state.doc.lineAt(range.from);
    const lead = line.text.trim() ? (range.from === line.to ? '\n\n' : '\n') : '';
    insert = `${lead}${text}\n`;
  } else {
    const before = state.sliceDoc(range.from - 1, range.from);
    const after = state.sliceDoc(range.to, range.to + 1);
    if (before && !/\s/.test(before)) insert = ` ${insert}`;
    if (!after || !/\s/.test(after)) insert = `${insert} `;
  }
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: range.from + insert.length },
    scrollIntoView: true,
    userEvent: 'input',
  });
  view.focus();
}

/**
 * Put the cursor at the start of a line (0-based), and bring it into view. A line
 * holding a picture is picked, brought into view and lit rather than opened, so the
 * picture stays drawn with its bar, which is where a picture is sized, captioned and
 * sourced. A line inside another drawn block (a table row, a line of an aligned
 * block) opens that block there.
 */
export function jumpToLine(view, line) {
  const number = Math.min(view.state.doc.lines, Math.max(1, Number(line) + 1));
  const target = view.state.doc.line(number);
  const block = blocksIn(view.state, target.from, target.to).find((item) => item.from <= target.from && target.to <= item.to);
  const picture = PICTURE_LINE.test(target.text);
  if (block && picture) {
    view.dispatch({ selection: { anchor: block.from } });
    lightLines(view, target.from, target.to);
    view.focus();
    return;
  }
  const effects = [EditorView.scrollIntoView(target.from, { y: 'center' })];
  if (block) effects.push(setOpenBlock.of({ from: block.from, to: block.to }));
  view.dispatch({ selection: { anchor: target.from }, effects });
  // a picture's line, shown as text, is lit as a picture is
  if (picture) lightLines(view, target.from, target.to);
  view.focus();
}

/**
 * Write the cover page at the top of the note, unless it has one, and put the
 * cursor on its first line to write. Answers whether it wrote one. Without
 * `focus` (Look › Cover was changed) the keyboard stays where it is.
 */
export function insertCover(view, { focus = true } = {}) {
  if (view.state.readOnly) return false;
  const change = coverChange(view.state.doc.toString());
  if (!change) {
    if (!focus) return false;
    view.dispatch({ selection: { anchor: 0 }, scrollIntoView: true });
    view.focus();
    return false;
  }
  const changes = { from: change.from, to: change.to, insert: change.insert };
  if (!focus) {
    view.dispatch({ changes, userEvent: 'input' });
    return true;
  }
  // drawn as focused at once, so the page opens around the cursor rather than over it
  view.dispatch({ changes, selection: { anchor: change.cursor }, effects: setFocused.of(true), scrollIntoView: true, userEvent: 'input' });
  view.focus();
  return true;
}

/**
 * Enter on a list item with nothing in it leaves the list, a task as well as a bullet:
 * Markdown's own Enter counts `[ ]` as the item's text and would start another one.
 * The raw Markdown's rule; the drawn page has its own (`editor/lineKeys.js`).
 */
export function leaveEmptyItem(view) {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty || state.field(drawn, false)) return false;
  const line = state.doc.lineAt(range.head);
  if (range.head !== line.to || !/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s*$/.test(line.text)) return false;
  view.dispatch({ changes: { from: line.from, to: line.to, insert: '' }, selection: { anchor: line.from }, userEvent: 'delete' });
  return true;
}

/** Tick a task box: the `[ ]` at `at` becomes `[x]`, or back. */
export function tickTask(view, at) {
  const marker = view.state.sliceDoc(at, at + 3);
  if (!/^\[[ xX]\]$/.test(marker)) return;
  view.dispatch({ changes: { from: at + 1, to: at + 2, insert: marker[1] === ' ' ? 'x' : ' ' }, userEvent: 'input' });
}
