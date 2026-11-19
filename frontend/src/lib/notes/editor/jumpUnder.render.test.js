// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';

import { noteExtensions, setNoteCase } from '../liveMarkdown.js';
import { jumpFor } from '../warnings.js';
import { setFocused } from './state.js';
import { jumpToLine, underHeading } from './writing.js';

/**
 * A warning's Go to about a heading, "Section "Method" is empty." above all, lands on the
 * line under the heading: on the drawn page the caret cannot stand among a heading's
 * hidden marks, so landing on the heading's line put it after `## ` and what was typed
 * lengthened the heading. An empty section gets a paragraph of its own, one Undo step.
 */

let view;
afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

function editor(doc) {
  const parent = document.createElement('div');
  document.body.append(parent);
  view = new EditorView({ parent, state: EditorState.create({ doc, extensions: noteExtensions({ mode: 'drawn' }) }) });
  view.focus = vi.fn();
  view.dispatch({ effects: [setNoteCase.of({ caseId: 'c1', entities: [] }), setFocused.of(true)] });
  view.dispatch({ selection: EditorSelection.cursor(0) });
  return view;
}

const text = () => view.state.doc.toString();
const caret = () => `${text().slice(0, view.state.selection.main.head)}‸${text().slice(view.state.selection.main.head)}`;

function type(typed) {
  const from = view.state.selection.main.head;
  const handled = view.state.facet(EditorView.inputHandler).some((handler) => handler(view, from, from, typed, () => null));
  if (!handled) view.dispatch({ changes: { from, insert: typed }, selection: EditorSelection.cursor(from + typed.length), userEvent: 'input.type' });
}

function undoOnce() {
  undo({ state: view.state, dispatch: (transaction) => view.dispatch(transaction) });
}

/** The note the owner's test found it in: an empty Method between two lines and Sources. */
const NOTE = ['Line 1', '', '## Method', '', '## Sources', '', 'Archive.'].join('\n');

describe("a warning's Go to on a heading", () => {
  it('starts an empty section on a line of its own, never inside the heading, and one Undo takes it back', () => {
    editor(NOTE);
    jumpToLine(view, 2, jumpFor({ kind: 'empty-section' }));
    expect(caret()).toBe('Line 1\n\n## Method\n\n‸\n\n## Sources\n\nArchive.');
    type('Measured shadows.');
    expect(text()).toBe('Line 1\n\n## Method\n\nMeasured shadows.\n\n## Sources\n\nArchive.');
    undoOnce();
    expect(text()).toBe('Line 1\n\n## Method\n\n\n\n## Sources\n\nArchive.');
    undoOnce();
    expect(text(), 'the empty paragraph is one Undo step of its own').toBe(NOTE);
  });

  it('lands at the first words of a section that has some, and writes nothing', () => {
    editor('## Method\n\nWe measured the shadows.\n\n## Limits\n\nOne day only.');
    jumpToLine(view, 0, { section: true });
    expect(caret()).toBe('## Method\n\n‸We measured the shadows.\n\n## Limits\n\nOne day only.');
  });

  it('opens a paragraph at the end of the note, and after the guidance a template left under the heading', () => {
    editor('Intro\n\n## Limits');
    jumpToLine(view, 2, { section: true });
    expect(caret()).toBe('Intro\n\n## Limits\n\n‸');
    view.destroy();
    editor('## Method\n<!--? How it was found -->\n## Limits\n');
    jumpToLine(view, 0, { section: true });
    expect(caret()).toBe('## Method\n<!--? How it was found -->\n\n‸\n\n## Limits\n');
  });

  it('writes nothing more when the empty paragraph is already there', () => {
    const ready = '## Method\n\n\n\n## Sources';
    editor(ready);
    jumpToLine(view, 0, { section: true });
    expect(caret()).toBe('## Method\n\n‸\n\n## Sources');
    expect(view.state.doc.toString()).toBe(ready);
  });

  it('leaves every other line, and a link warning, where it was', () => {
    editor('## Sources [site](https://example.org)\n\n- [ ] Call back\n\nText.');
    jumpToLine(view, 0, jumpFor({ kind: 'unarchived' }));
    expect(view.state.doc.toString()).toBe('## Sources [site](https://example.org)\n\n- [ ] Call back\n\nText.');
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(1);
    jumpToLine(view, 2, jumpFor({ kind: 'open-task' }));
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(3);
    // a page pressed in the Page pane goes to its first line, heading or not
    jumpToLine(view, 0);
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(1);
    expect(view.state.doc.toString()).toBe('## Sources [site](https://example.org)\n\n- [ ] Call back\n\nText.');
  });

  it('reads a heading only where Markdown has one: not in a quote or in code', () => {
    const quoted = EditorState.create({ doc: '> ## Inside\n\nText', extensions: noteExtensions({ mode: 'drawn' }) });
    expect(underHeading(quoted, 1)).toBeNull();
    const code = EditorState.create({ doc: '```\n## not a heading\n```\n', extensions: noteExtensions({ mode: 'drawn' }) });
    expect(underHeading(code, 2)).toBeNull();
  });
});
