// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { leaveEmptyItem, mentionSource, noteExtensions, setNoteCase, slashSource } from './liveMarkdown.js';

let view;
afterEach(() => { view?.destroy(); view = null; });

function editor(doc) {
  const parent = document.createElement('div');
  document.body.append(parent);
  view = new EditorView({ parent, state: EditorState.create({ doc, extensions: noteExtensions({}) }) });
  view.dispatch({
    effects: setNoteCase.of({ caseId: 'c1', entities: [{ id: 'p1', type: 'place', label: 'Quay', attrs: {} }] }),
    selection: { anchor: doc.length },
  });
  return view;
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

describe('Enter on an empty item', () => {
  it('leaves a task list, and lets Markdown carry on anywhere else', () => {
    editor('- [ ] Archive\n- [ ] ');
    expect(leaveEmptyItem(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('- [ ] Archive\n');
    editor('- [ ] Archive');
    expect(leaveEmptyItem(view)).toBe(false);
  });
});
