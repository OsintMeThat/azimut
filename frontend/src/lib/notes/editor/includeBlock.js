/**
 * A chapter: a note a report includes, written `[[include:id]]` alone on its line,
 * drawn as a card with its number, its name and its first words, and its Open and
 * Remove buttons. Open, the line is shown as written.
 */
import { WidgetType } from '@codemirror/view';

import { INCLUDE_LINE, includeLine } from '../look.js';
import { registerBlock } from './blocks.js';
import { openBlockAt } from './ranges.js';
import { noteCase, resolve } from './state.js';
import { markPicked, sourceButton } from './widgets.js';

/** The note a report includes as a chapter: its number, name and first words. */
class IncludeWidget extends WidgetType {
  constructor(id, number, note, picked = false) {
    super();
    this.id = id;
    this.number = number;
    this.note = note;
    this.picked = picked;
  }

  same(other) {
    return other.id === this.id && other.number === this.number && other.note?.title === this.note?.title
      && other.note?.excerpt === this.note?.excerpt;
  }

  /** The kind of block this draws, as `editor/blocks.js` names it. */
  get blockKind() {
    return 'include';
  }

  eq(other) {
    return this.same(other) && other.picked === this.picked;
  }

  /** Picked or not is the only change that keeps the card where it is. */
  updateDOM(dom, _view, previous) {
    if (!previous?.same(this)) return false;
    markPicked(dom, this.picked);
    return true;
  }

  toDOM(view) {
    const box = document.createElement('div');
    box.className = `cm-include${this.note ? '' : ' cm-include-missing'}`;
    box.dataset.include = this.id;
    box.title = 'Double-click to edit the line';
    markPicked(box, this.picked);
    box.addEventListener('dblclick', (event) => {
      if (event.target.closest('button')) return;
      event.preventDefault();
      openBlockAt(view, box);
    });
    const head = document.createElement('div');
    head.className = 'cm-include-head';
    const number = document.createElement('span');
    number.className = 'cm-include-number';
    number.textContent = `Chapter ${this.number}`;
    const actions = document.createElement('span');
    actions.className = 'cm-include-actions';
    if (this.note) actions.append(includeButton('Open', 'cm-include-open', `Open ${this.note.title}`));
    actions.append(includeButton('Remove', 'cm-include-remove', 'Take this chapter out of the report'));
    actions.append(sourceButton(view, box, 'cm-include-source'));
    head.append(number, actions);
    const title = document.createElement('div');
    title.className = 'cm-include-title';
    title.textContent = this.note?.title ?? 'A note no longer in the case';
    box.append(head, title);
    if (this.note) {
      const excerpt = document.createElement('div');
      excerpt.className = 'cm-include-excerpt';
      excerpt.textContent = this.note.excerpt || 'Nothing written yet.';
      box.append(excerpt);
    } else {
      const said = document.createElement('div');
      said.className = 'cm-include-excerpt';
      said.textContent = 'The PDF prints a short line in its place.';
      box.append(said);
    }
    return box;
  }

  ignoreEvent(event) {
    return event.type !== 'mousedown';
  }

  get estimatedHeight() {
    return 92;
  }
}

function includeButton(text, className, title) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  button.title = title;
  return button;
}

/** What a chapter line shows: the note as the home lists it, its record else, null when gone. */
function includedNote(info, id) {
  const row = info.notes.get(id);
  if (row) return { title: row.title, excerpt: row.excerpt ?? '' };
  if (id === 'case') return { title: 'Case notes', excerpt: '' };
  const entity = resolve(info, id);
  return entity?.type === 'note' ? { title: entity.label, excerpt: '' } : null;
}

registerBlock({
  name: 'include',
  // a chapter is its line, as the PDF reads it: whatever is around it
  line: (line, ctx) => {
    const include = !ctx.inCode(line.from) && INCLUDE_LINE.exec(line.text);
    if (!include) return null;
    const number = ctx.count('include');
    ctx.standsWhole(line);
    return { from: line.from, to: line.to, id: include[1], number };
  },
  widget: (spec) => new IncludeWidget(spec.id, spec.number, includedNote(spec.info, spec.id), spec.picked),
  atomic: true,
  source: (ctx, found) => {
    ctx.mark(found.from, found.to, 'cm-ref-source');
    return true;
  },
  // its Open and Remove buttons act on the press; anywhere else on it picks it
  mousedown: (event, view, handlers) => {
    const chapter = event.target.closest?.('[data-include]');
    if (!chapter || event.button !== 0) return false;
    event.preventDefault();
    const at = view.posAtDOM(chapter);
    if (event.target.closest('.cm-include-open')) {
      const id = chapter.dataset.include;
      if (handlers.note) handlers.note(id);
      else {
        const entity = resolve(view.state.field(noteCase), id);
        if (entity) handlers.open?.(entity);
      }
    } else if (event.target.closest('.cm-include-remove')) {
      if (!view.state.readOnly) removeInclude(view, at);
    } else {
      view.dispatch({ selection: { anchor: at } });
      view.focus();
    }
    return true;
  },
});

/**
 * Put a chapter line where the cursor is, as a paragraph of its own: on the empty
 * line it is typed on, or after the line holding words.
 */
export function insertInclude(view, noteId) {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const next = line.number < state.doc.lines ? state.doc.line(line.number + 1).text : null;
  const previous = line.number > 1 ? state.doc.line(line.number - 1).text : '';
  const words = Boolean(line.text.trim());
  const from = words ? line.to : line.from;
  const lead = words ? '\n\n' : previous.trim() ? '\n' : '';
  // a blank line after it, and the cursor on the line past the chapter
  const blankAfter = next !== null && !next.trim();
  const insert = `${lead}${includeLine(noteId)}${blankAfter ? '' : '\n'}`;
  view.dispatch({
    changes: { from, to: line.to, insert },
    selection: { anchor: from + insert.length + (blankAfter ? 1 : 0) },
    scrollIntoView: true,
    userEvent: 'input',
  });
  view.focus();
}

/** Take the chapter line at `pos` out, and the blank line it leaves doubled. */
export function removeInclude(view, pos) {
  const { state } = view;
  const line = state.doc.lineAt(pos);
  if (!INCLUDE_LINE.test(line.text)) return false;
  let to = line.number < state.doc.lines ? state.doc.line(line.number + 1).from : line.to;
  const after = line.number < state.doc.lines ? state.doc.line(line.number + 1) : null;
  const before = line.number > 1 ? state.doc.line(line.number - 1) : null;
  if (after && !after.text.trim() && (!before || !before.text.trim())) to = after.number < state.doc.lines ? state.doc.line(after.number + 1).from : after.to;
  view.dispatch({ changes: { from: line.from, to }, selection: { anchor: line.from }, userEvent: 'delete' });
  return true;
}
