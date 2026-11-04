// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import {
  insertInclude, leaveEmptyItem, mentionSource, noteExtensions, removeInclude, setNoteCase, slashSource,
} from './liveMarkdown.js';

let view;
afterEach(() => { view?.destroy(); view = null; });

function editor(doc, options = {}) {
  const parent = document.createElement('div');
  document.body.append(parent);
  view?.destroy();
  view = new EditorView({ parent, state: EditorState.create({ doc, extensions: noteExtensions(options) }) });
  view.dispatch({
    effects: setNoteCase.of({
      caseId: 'c1',
      entities: [{ id: 'p1', type: 'place', label: 'Quay', attrs: {} }],
      notes: [{ id: 'n2', title: 'Shadows', excerpt: 'Measured at noon.' }],
    }),
    selection: { anchor: doc.length },
  });
  return view;
}

/** Type text at the cursor as a keyboard does. */
function type(text) {
  const { from, to } = view.state.selection.main;
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, userEvent: 'input.type' });
}

/** Pick the first thing a source offers, as Enter does. */
function accept(source, label) {
  const pos = view.state.selection.main.head;
  const result = source(new CompletionContext(view.state, pos, false));
  const option = label ? result.options.find((one) => one.label === label) : result.options[0];
  option.apply(view, option, result.from, pos);
}

describe('what @ and / write', () => {
  it('@ writes the reference, with a space after it', () => {
    editor('Seen at @Qu');
    accept(mentionSource);
    expect(view.state.doc.toString()).toBe('Seen at [[entity:p1|Quay]] ');
  });

  it('/ on an empty line starts it as a task', () => {
    editor('First line.\n/todo');
    accept(slashSource({}), 'To-do');
    expect(view.state.doc.toString()).toBe('First line.\n- [ ] ');
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
  });

  it('/ after words puts the block on a line of its own', () => {
    editor('Some words /divider');
    accept(slashSource({}), 'Divider');
    expect(view.state.doc.toString()).toBe('Some words \n\n---\n');
  });

  it('/ for a callout opens the line as one', () => {
    editor('/confirmed');
    accept(slashSource({}), 'Confirmed');
    expect(view.state.doc.toString()).toBe('> [!confirmed] ');
  });
});

describe('a chapter', () => {
  it('/ offers to include a note, and leaves the picking to the editor', () => {
    let asked = 0;
    editor('Intro\n/incl');
    accept(slashSource({ include: () => { asked += 1; } }), 'Include a note');
    expect(asked).toBe(1);
    expect(view.state.doc.toString()).toBe('Intro\n');
  });

  it('goes in as a paragraph of its own, wherever the cursor is', () => {
    editor('Intro');
    insertInclude(view, 'n2');
    expect(view.state.doc.toString()).toBe('Intro\n\n[[include:n2]]\n');
    expect(view.state.selection.main.head).toBe(view.state.doc.length);

    editor('Intro\n\nAfter');
    view.dispatch({ selection: { anchor: 6 } });
    insertInclude(view, 'n2');
    expect(view.state.doc.toString()).toBe('Intro\n\n[[include:n2]]\n\nAfter');

    editor('Intro\nAfter');
    view.dispatch({ selection: { anchor: 2 } });
    insertInclude(view, 'n2');
    expect(view.state.doc.toString()).toBe('Intro\n\n[[include:n2]]\n\nAfter');
  });

  it('is drawn as a block with its note, and Remove takes its line out', () => {
    editor('Intro\n\n[[include:n2]]\n\nAfter', {});
    view.dispatch({ selection: { anchor: 0 } });
    const card = view.dom.querySelector('[data-include="n2"]');
    expect(card.textContent).toContain('Chapter 1');
    expect(card.textContent).toContain('Shadows');
    expect(removeInclude(view, 8)).toBe(true);
    expect(view.state.doc.toString()).toBe('Intro\n\nAfter');
  });

  it('opens the note it names from its Open button', () => {
    const opened = [];
    editor('[[include:n2]]\n\nAfter', { handlers: { note: (id) => opened.push(id) } });
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    const open = view.dom.querySelector('.cm-include-open');
    open.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    expect(opened).toEqual(['n2']);
  });
});

describe('guidance', () => {
  it('in a note, is replaced by what is typed on it', () => {
    editor('## Claim\n\n<!--? Who said it -->\n\nBody');
    view.dispatch({ selection: { anchor: 10 } });
    type('A');
    type('n');
    expect(view.state.doc.toString()).toBe('## Claim\n\nAn\n\nBody');
  });

  it('in a note, stays when Enter opens a line beside it', () => {
    editor('<!--? Who said it -->');
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    type('\n');
    expect(view.state.doc.toString()).toBe('<!--? Who said it -->\n');
  });

  it('in a template, is text like any other', () => {
    editor('<!--? Who said it -->', { template: true });
    view.dispatch({ selection: { anchor: 6 } });
    type('X');
    expect(view.state.doc.toString()).toBe('<!--? XWho said it -->');
  });

  it('/ writes a line of it in a template only', () => {
    editor('/guid', { template: true });
    accept(slashSource({}, { template: true }), 'Guidance');
    expect(view.state.doc.toString()).toBe('<!--?  -->\n');
    expect(view.state.selection.main.head).toBe(6);
    editor('/guid');
    const offered = slashSource({})(new CompletionContext(view.state, view.state.doc.length, false));
    expect(offered.options.map((option) => option.label)).not.toContain('Guidance');
  });
});

describe('Enter on an empty item', () => {
  it('leaves a task list, and lets Markdown carry on anywhere else', () => {
    editor('- [ ] Archive\n- [ ] ');
    expect(leaveEmptyItem(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('- [ ] Archive\n');
    editor('- [ ] Archive');
    expect(leaveEmptyItem(view)).toBe(false);
  });
});
