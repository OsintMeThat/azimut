/**
 * What a tool puts in the note: where it lands, on lines of its own, lit for a
 * moment, held as the typing moves it, and taken back if the note still holds it as
 * it was.
 */
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';

import { openCaption } from './pictureBlock.js';

/**
 * Places in the note held while something is being made for them: a position a put
 * will land at, or the stretch it landed as. Each follows the typing around it, so a
 * picture that takes a while still lands where it was asked for, and Undo finds it.
 */
const holdSpot = StateEffect.define();
const dropSpot = StateEffect.define();
let spotSeq = 0;

export const spots = StateField.define({
  create: () => new Map(),
  update(value, transaction) {
    let next = value;
    if (transaction.docChanged && value.size) {
      next = new Map();
      for (const [id, spot] of value) {
        // what is typed at a held position goes before it, as at the start of a stretch; at its end, after it
        const from = transaction.changes.mapPos(spot.from, 1);
        next.set(id, { from, to: spot.to === spot.from ? from : Math.max(from, transaction.changes.mapPos(spot.to, -1)) });
      }
    }
    for (const effect of transaction.effects) {
      if (effect.is(holdSpot)) {
        if (next === value) next = new Map(value);
        next.set(effect.value.id, { from: effect.value.from, to: effect.value.to });
      } else if (effect.is(dropSpot) && next.has(effect.value)) {
        if (next === value) next = new Map(value);
        next.delete(effect.value);
      }
    }
    return next;
  },
});

/** Hold `from`–`to` (a position when they are one) as the note changes; answers its id. */
export function holdRange(view, from, to = from) {
  spotSeq += 1;
  view.dispatch({ effects: holdSpot.of({ id: spotSeq, from, to }) });
  return spotSeq;
}

/** Where a held place is now, `{ from, to }`, or null once let go. */
export function heldRange(view, id) {
  return view.state.field(spots, false)?.get(id) ?? null;
}

export function releaseRange(view, id) {
  if (view.state.field(spots, false)?.has(id)) view.dispatch({ effects: dropSpot.of(id) });
}

/** A picture line's braces, which the bar and the caption field change, read as one. */
function unsized(text) {
  return String(text ?? '').replace(/(\]\]|\))\{[^}\n]*\}/g, '$1');
}

/**
 * The text that puts `text` at `pos` on lines of its own: a blank line from words
 * before it and after it, so a table or a picture is read as one. `inline` puts it
 * in the line at `pos` instead, with a space either side, as a citation is written.
 * Answers `{ insert, start, end }`, the text and where `text` sits in it.
 */
export function blockAt(state, pos, text, { inline = false } = {}) {
  const at = Math.max(0, Math.min(pos, state.doc.length));
  if (inline) {
    const before = state.sliceDoc(at - 1, at);
    const after = state.sliceDoc(at, at + 1);
    const lead = before && !/\s/.test(before) ? ' ' : '';
    const trail = !after || !/\s/.test(after) ? ' ' : '';
    return { insert: `${lead}${text}${trail}`, start: lead.length, end: lead.length + text.length };
  }
  const line = state.doc.lineAt(at);
  const head = line.text.slice(0, at - line.from);
  const tail = line.text.slice(at - line.from);
  const previous = line.number > 1 ? state.doc.line(line.number - 1).text : '';
  const next = line.number < state.doc.lines ? state.doc.line(line.number + 1).text : null;
  // words before it on this line take a blank line; an empty line under words, one more break
  const lead = head.trim() ? '\n\n' : !head && previous.trim() ? '\n' : '';
  // the line's own break follows it unless it is the last: words after it take a blank line
  const trail = tail.trim() ? '\n\n' : next === null ? '\n' : next.trim() ? '\n' : '';
  const insert = `${lead}${text}${trail}`;
  return { insert, start: lead.length, end: lead.length + text.length };
}

/**
 * Put `text` at `pos` (a held place's position when it is the id of one), as
 * `blockAt` writes it. Answers the id of the stretch it now holds in the note, which
 * `takeBackRange` reads. The note's own cursor moves past it only when it was there.
 */
export function placeText(view, pos, text, options = {}) {
  if (view.state.readOnly) return null;
  const { insert, start, end } = blockAt(view.state, pos, text, options);
  const from = Math.max(0, Math.min(pos, view.state.doc.length));
  const head = view.state.selection.main.head;
  view.dispatch({
    changes: { from, insert },
    ...(head === from ? { selection: { anchor: from + insert.length } } : {}),
    userEvent: 'input',
  });
  const id = holdRange(view, from, from + insert.length);
  lightLines(view, from + start, from + end);
  return { id, text: insert };
}

/**
 * Take back what `placeText` put in, if the note still holds it as it was: a
 * picture's size and caption may have been set since, nothing else. False when it
 * changed, or is no longer there.
 */
export function takeBackRange(view, landed) {
  const held = landed ? heldRange(view, landed.id) : null;
  if (!held || view.state.readOnly) return false;
  const now = view.state.sliceDoc(held.from, held.to);
  if (unsized(now) !== unsized(landed.text)) return false;
  view.dispatch({ changes: { from: held.from, to: held.to }, effects: dropSpot.of(landed.id), userEvent: 'delete' });
  return true;
}

/** Light the lines `from`–`to` for a moment and bring them into view: where a put landed. */
const lightOn = StateEffect.define();
const lightOff = StateEffect.define();
const landedLine = Decoration.line({ class: 'cm-landed' });

export const landed = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(lightOff)) next = Decoration.none;
      if (effect.is(lightOn)) {
        const { from, to } = effect.value;
        const lines = [];
        const doc = transaction.state.doc;
        for (let number = doc.lineAt(from).number; number <= doc.lineAt(Math.max(from, to)).number; number += 1) {
          lines.push(landedLine.range(doc.line(number).from));
        }
        next = Decoration.set(lines);
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** How long the lines a put landed as stay lit. */
export const LIGHT_MS = 1800;

export function lightLines(view, from, to = from) {
  const at = Math.max(0, Math.min(from, view.state.doc.length));
  const end = Math.max(at, Math.min(to, view.state.doc.length));
  view.dispatch({ effects: [lightOn.of({ from: at, to: end }), EditorView.scrollIntoView(at, { y: 'center' })] });
  // a picture or a table is drawn in place of its lines, so it is lit itself
  const first = view.state.doc.lineAt(at).number;
  const last = view.state.doc.lineAt(end).number;
  const markBlocks = () => {
    for (const node of view.contentDOM.querySelectorAll('.cm-block')) {
      let number = 0;
      try { number = view.state.doc.lineAt(view.posAtDOM(node)).number; } catch { continue; }
      if (number >= first && number <= last) node.classList.add('cm-block-landed');
    }
  };
  markBlocks();
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(markBlocks);
  clearTimeout(view.lightTimer);
  view.lightTimer = setTimeout(() => {
    if (!view.dom.isConnected) return;
    view.dispatch({ effects: lightOff.of(null) });
    for (const node of view.contentDOM.querySelectorAll('.cm-block-landed')) node.classList.remove('cm-block-landed');
  }, LIGHT_MS);
}

/**
 * Open the caption field of the picture on the line at `pos`, once the page has
 * drawn it. `returnTo` gets the keyboard back after Enter or Escape. Answers whether
 * it opened, after a few frames at most.
 */
export function captionAt(view, pos, { returnTo = null, frames = 6 } = {}) {
  return new Promise((done) => {
    const tryOpen = (left) => {
      const line = view.state.doc.lineAt(Math.min(pos, view.state.doc.length));
      const box = [...view.contentDOM.querySelectorAll('.cm-block-picture')]
        .find((node) => { try { return view.state.doc.lineAt(view.posAtDOM(node)).number === line.number; } catch { return false; } });
      if (box) {
        openCaption(view, box, returnTo);
        done(true);
        return;
      }
      if (left <= 0) {
        done(false);
        return;
      }
      requestAnimationFrame(() => tryOpen(left - 1));
    };
    tryOpen(frames);
  });
}
