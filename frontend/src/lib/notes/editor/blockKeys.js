/**
 * What the keys and the typing do at a drawn block: Enter opens a picked block,
 * Escape closes an open one, Backspace and Delete take one out whole, the arrows
 * step over one as a unit, and what is typed at one starts a paragraph after it.
 */
import { Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';

import { drawn } from './decorations.js';
import { blocksIn, openBlockAt, pickedBlock, settle } from './ranges.js';
import { focused, openBlock, setOpenBlock } from './state.js';

/** Take a drawn block out of the note, with the line break it stands on and a blank line it would leave doubled. */
function removeBlock(view, block) {
  const { doc } = view.state;
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
  view.dispatch({ changes: { from, to }, selection: { anchor: from }, scrollIntoView: true, userEvent: 'delete' });
}

/** Enter on a picked block opens its source. */
function openPicked(view) {
  const block = pickedBlock(view.state);
  return block ? openBlockAt(view, block.from) : false;
}

/**
 * Tab on a picked block never indents its source: on a picture it goes to its bar, which
 * is where it is sized and captioned, and on any other block it does nothing. (After
 * Escape the editor lets Tab leave it, as it does everywhere.)
 */
function tabOnPicked(view) {
  if (!pickedBlock(view.state)) return false;
  view.dom.querySelector('.cm-picked [data-size-bar] button')?.focus({ preventScroll: true });
  return true;
}

/** Escape inside an open block closes it, and picks it. */
function closeOpen(view) {
  const open = view.state.field(openBlock, false);
  if (!open) return false;
  view.dispatch({ selection: { anchor: open.from }, effects: setOpenBlock.of(null), scrollIntoView: true });
  return true;
}

/**
 * Backspace and Delete at a drawn block take the whole of it out in one step, which
 * Undo brings back. Next to it, on a line of words, they pick it first: the words
 * would otherwise be joined onto the block's source.
 */
function removeAtBlock(forward) {
  return (view) => {
    const { state } = view;
    const range = state.selection.main;
    if (!range.empty || state.readOnly) return false;
    const block = blocksIn(state, range.head).find((item) => item.from === range.head || item.to === range.head);
    if (block) {
      removeBlock(view, block);
      return true;
    }
    const line = state.doc.lineAt(range.head);
    let next = null;
    if (forward && range.head === line.to && line.text) next = blocksIn(state, range.head + 1).find((item) => item.from === range.head + 1);
    if (!forward && range.head === line.from && line.text && line.number > 1) next = blocksIn(state, range.head - 1).find((item) => item.to === range.head - 1);
    if (!next) return false;
    view.dispatch({ selection: { anchor: next.from }, scrollIntoView: true });
    return true;
  };
}

/**
 * Where the cursor goes to leave `block` forward or back: the start of the line after it, the end of the line before it,
 * or, at the end of the note or its start, where it is.
 */
function past(state, block, forward) {
  if (forward) return block.to < state.doc.length ? settle(state, block.to + 1) : block.to;
  return block.from > 0 ? settle(state, block.from - 1) : block.from;
}

/** Left and Right step over a block as one unit: from the next line or the previous, onto it; off it, past it. */
function stepAcross(forward) {
  return (view) => {
    const { state } = view;
    const range = state.selection.main;
    if (!range.empty) return false;
    const picked = pickedBlock(state);
    let target = null;
    if (picked) target = past(state, picked, forward);
    else if (!forward) {
      const line = state.doc.lineAt(range.head);
      if (range.head === line.from && line.number > 1) target = blocksIn(state, range.head - 1).find((item) => item.to === range.head - 1)?.from ?? null;
    }
    if (target === null) return false;
    view.dispatch({ selection: { anchor: target }, scrollIntoView: true, userEvent: 'select' });
    return true;
  };
}

/**
 * Up and Down step over a block as one unit too: off a picked block, to the line
 * past it; onto one, wherever the vertical move would have put the cursor in it.
 */
function stepAlong(down) {
  return (view) => {
    const { state } = view;
    const range = state.selection.main;
    if (!range.empty) return false;
    const picked = pickedBlock(state);
    let target;
    if (picked) {
      target = past(state, picked, down);
    } else {
      try { target = view.moveVertically(range, down).head; } catch { return false; }
      if (target === range.head) return false;
      // a browser's vertical move goes over a drawn block whole: the first one crossed is picked
      const line = state.doc.lineAt(range.head);
      const crossed = blocksIn(state, Math.min(range.head, target), Math.max(range.head, target))
        .filter((block) => (down ? block.from > line.to : block.to < line.from))
        .sort((a, b) => (down ? a.from - b.from : b.from - a.from))[0];
      if (crossed) target = crossed.from;
      else if (settle(state, target) === target) return false;
      else target = settle(state, target);
    }
    view.dispatch({ selection: { anchor: target }, scrollIntoView: true, userEvent: 'select' });
    return true;
  };
}

/**
 * Typing at a drawn block starts a line after it and types there: the block's own
 * line is never typed into, so a picture keeps its line whole.
 */
/** Type `text` on a paragraph of its own after `block`, a blank line either side. */
function typeAfter(view, block, text) {
  const { state } = view;
  const last = state.doc.lineAt(block.to);
  const following = last.number < state.doc.lines ? state.doc.line(last.number + 1) : null;
  const insert = `\n\n${text}${following?.text.trim() ? '\n' : ''}`;
  view.dispatch({
    changes: { from: block.to, insert },
    selection: { anchor: block.to + 2 + text.length },
    scrollIntoView: true,
    userEvent: 'input.type',
  });
}

export const typeNextToBlock = EditorView.inputHandler.of((view, from, to, text) => {
  const { state } = view;
  const range = state.selection.main;
  if (state.readOnly || from !== to || !text || !range.empty || range.head !== from) return false;
  const block = blocksIn(state, from).find((item) => item.from === from || item.to === from);
  if (!block) return false;
  if (!text.trim()) return true;
  typeAfter(view, block, text);
  return true;
});

/**
 * A key typed while a block is picked, read before the browser types it: the caret
 * the browser keeps is not at the block (it cannot stand inside a drawn one), so
 * the text it would type lands on the line after, glued to the block's own.
 */
export const typeOnPicked = EditorView.domEventHandlers({
  keydown(event, view) {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return false;
    if (view.state.readOnly || !view.state.field(focused, false)) return false;
    const block = pickedBlock(view.state);
    if (!block) return false;
    event.preventDefault();
    if (event.key.trim()) typeAfter(view, block, event.key);
    return true;
  },
});

export const blockKeys = Prec.high(keymap.of([
  { key: 'Enter', run: openPicked },
  { key: 'Tab', run: tabOnPicked, shift: tabOnPicked },
  { key: 'Escape', run: closeOpen },
  { key: 'Backspace', run: removeAtBlock(false) },
  { key: 'Delete', run: removeAtBlock(true) },
  { key: 'ArrowRight', run: stepAcross(true) },
  { key: 'ArrowLeft', run: stepAcross(false) },
  { key: 'ArrowDown', run: stepAlong(true) },
  { key: 'ArrowUp', run: stepAlong(false) },
]));

/** While a block is picked the editor wears a class, which puts the cursor away: the outline says where it is. */
export const pickedClass = EditorView.editorAttributes.compute(['selection', focused, openBlock, drawn], (state) => (
  state.field(focused, false) && pickedBlock(state) ? { class: 'cm-block-picking' } : {}
));
