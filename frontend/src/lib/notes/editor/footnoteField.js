/**
 * The Footnote field of the selection bubble: one line of words, the comment a reader
 * opens from the footnote's small letter. Enter writes it as `^[words]` right after the
 * words selected, or where the cursor is; on a footnote already written it changes its
 * words, and Remove takes it out. Escape leaves the note as it was. What it writes is in
 * `lib/notes/footnotes.js` (`footnoteMarkdown`), one Undo step.
 */
import { EditorSelection } from '@codemirror/state';

import { findFootnotes, footnoteMarkdown } from '../footnotes.js';
import { iconSvg } from './icon.js';
import { el } from './linkField.js';

/**
 * What the field writes to, for `range`: the footnote the words selected are (a chip picked
 * whole, or inside one), else the place right after the words. `{ from, to, at, words, existing }`.
 */
export function footnoteTarget(state, range = state.selection.main) {
  const line = state.doc.lineAt(range.from);
  const written = findFootnotes(line.text, line.from).find((note) => note.from <= range.from && range.to <= note.to && range.to > range.from);
  if (written) return { from: written.from, to: written.to, at: written.from, words: written.words, existing: true };
  return { from: range.from, to: range.to, at: range.to, words: '', existing: false };
}

/** The footnote starting at `pos`, as the field edits it, or null. */
export function footnoteAt(state, pos) {
  const line = state.doc.lineAt(pos);
  const written = findFootnotes(line.text, line.from).find((note) => note.from === pos);
  return written ? { from: written.from, to: written.to, at: written.from, words: written.words, existing: true } : null;
}

/**
 * `words` written for `target`: a new footnote right after its words, the cursor after it;
 * a written one's words changed in place, or taken out when the words are cleared. Null when
 * there is nothing to write.
 */
export function writeFootnote(target, words) {
  if (!String(words ?? '').trim()) return target.existing ? removeFootnote(target) : null;
  const insert = footnoteMarkdown(words);
  const from = target.existing ? target.from : target.at;
  const to = target.existing ? target.to : target.at;
  return { changes: { from, to, insert }, selection: EditorSelection.cursor(from + insert.length) };
}

/** A written footnote taken out, the cursor where it stood. */
export function removeFootnote(target) {
  if (!target.existing) return null;
  return { changes: { from: target.from, to: target.to, insert: '' }, selection: EditorSelection.cursor(target.from) };
}

/**
 * The field, for `target` (`footnoteTarget`). `act` carries out what is asked: `{ words }`,
 * `{ remove: true }` or `{ close: true }`. Answers `{ dom, focus(), destroy() }`.
 */
export function footnoteField(target, act) {
  const input = el('input', 'cm-link-input cm-footnote-input');
  input.type = 'text';
  input.placeholder = 'Write the footnote';
  input.setAttribute('aria-label', 'Footnote');
  input.value = target.words || '';
  const row = el('div', 'cm-link-row', el('span', 'cm-link-icon cm-footnote-icon', 'a'), input);
  if (target.existing) {
    const remove = el('button', 'cm-link-button cm-link-remove', iconSvg('trash', 13), 'Remove');
    remove.type = 'button';
    remove.title = 'Take the footnote out';
    remove.addEventListener('click', () => act({ remove: true }));
    row.append(remove);
  }
  const dom = el('div', 'cm-link-field cm-footnote-field', row, el('div', 'cm-link-foot', 'The reader opens it from a small letter. Enter to keep it.'));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      act({ close: true });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      act({ words: input.value });
    }
  });
  return {
    dom,
    focus: () => {
      input.focus();
      input.select();
    },
    destroy: () => {},
  };
}
