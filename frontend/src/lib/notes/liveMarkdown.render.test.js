// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { Compartment, EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import {
  insertInclude, leaveEmptyItem, mentionSource, noteExtensions, removeInclude, resizePicture, setNoteCase, slashSource,
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

  it('/ offers Internal, found by what it is for too', () => {
    editor('/private');
    accept(slashSource({}), 'Internal');
    expect(view.state.doc.toString()).toBe('> [!internal] ');
  });
});

describe('an internal passage', () => {
  it('is drawn as an Internal callout in its own colour, that says on hover what it does', () => {
    editor('Public words.\n\n> [!internal] Who told us.\n> And how.\n\nAfter.');
    const lines = [...view.dom.querySelectorAll('.cm-callout-internal')];
    expect(lines).toHaveLength(2);
    expect(lines[0].style.getPropertyValue('--callout')).toBe('var(--internal)');
    const label = view.dom.querySelector('.cm-callout-internal .cm-callout-label');
    expect(label.textContent).toBe('Internal');
    expect(label.title).toBe('Left out of the public edition');
    // the other callouts keep no hover of their own
    editor('> [!lead] Ask the port.\n');
    expect(view.dom.querySelector('.cm-callout-label').title).toBe('');
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

describe('a page break', () => {
  it('/ writes one on a line of its own, drawn as a named rule', () => {
    editor('Before /page');
    accept(slashSource({}), 'Page break');
    expect(view.state.doc.toString()).toBe('Before \n\n<!-- pagebreak -->\n');
    view.dispatch({ selection: { anchor: 0 } });
    const rule = view.dom.querySelector('[data-pagebreak]');
    expect(rule.textContent).toBe('Page break');
  });

});

describe('a picture’s size in the PDF', () => {
  function withPicture(doc) {
    editor(doc);
    view.dispatch({
      effects: setNoteCase.of({
        caseId: 'c1',
        entities: [{ id: 'm1', type: 'media', label: 'Roof', attrs: { path: 'media/roof.png', kind: 'image' } }],
        notes: [],
      }),
      selection: { anchor: doc.length },
    });
  }

  it('is offered over the picture, and a press writes it on the line', () => {
    withPicture('[[media:m1|Roof]]\n\nAfter');
    const bar = view.dom.querySelector('[data-size-bar]');
    expect([...bar.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['S', 'M', 'L', 'Full', '', '', '', 'Caption']);
    bar.querySelector('[data-share="0.5"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    expect(view.state.doc.line(1).text).toBe('[[media:m1|Roof]]{width=50%}');
    view.dom.querySelector('[data-align="center"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    expect(view.state.doc.line(1).text).toBe('[[media:m1|Roof]]{width=50% align=center}');
  });

  it('marks the size the picture has', () => {
    withPicture('[[media:m1|Roof]]{width=75% align=right}\n\nAfter');
    const pressed = [...view.dom.querySelectorAll('[data-size-bar] [aria-pressed="true"]')];
    expect(pressed.map((button) => button.textContent || button.dataset.align)).toEqual(['L', 'right']);
  });

  it('is changed from the Page pane by the line the server gave, or the nearest holding it', () => {
    withPicture('Intro\n\n[[media:m1|Roof]]\n\nAfter');
    expect(resizePicture(view, 3, 'media:m1', { width: '33%' })).toBe(true);
    expect(view.state.doc.line(3).text).toBe('[[media:m1|Roof]]{width=33%}');
    expect(resizePicture(view, 2, 'media:gone', { width: '33%' })).toBe(false);
  });

  it('is changed from the keyboard, Enter on a button giving a click', () => {
    withPicture('[[media:m1|Roof]]\n\nAfter');
    view.dom.querySelector('[data-share="0.75"]').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(view.state.doc.line(1).text).toBe('[[media:m1|Roof]]{width=75%}');
    // a mouse click was handled on its press already
    view.dom.querySelector('[data-share="0.5"]').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(view.state.doc.line(1).text).toBe('[[media:m1|Roof]]{width=75%}');
  });

  it('comes once a note read while it was locked can be written', () => {
    const editable = new Compartment();
    editor('[[media:m1|Roof]]\n\nAfter', { readOnly: true, editable });
    view.dispatch({
      effects: setNoteCase.of({ caseId: 'c1', entities: [{ id: 'm1', type: 'media', label: 'Roof', attrs: { path: 'media/roof.png' } }], notes: [] }),
    });
    expect(view.dom.querySelector('[data-size-bar]')).toBeNull();
    view.dispatch({ effects: editable.reconfigure([EditorState.readOnly.of(false), EditorView.editable.of(true)]) });
    expect(view.dom.querySelector('[data-size-bar]')).not.toBeNull();
  });

  it('is not offered in a note that cannot be changed', () => {
    editor('[[media:m1|Roof]]\n\nAfter', { readOnly: true });
    view.dispatch({
      effects: setNoteCase.of({ caseId: 'c1', entities: [{ id: 'm1', type: 'media', label: 'Roof', attrs: { path: 'media/roof.png' } }], notes: [] }),
    });
    expect(view.dom.querySelector('[data-size-bar]')).toBeNull();
    expect(resizePicture(view, 0, 'media:m1', { width: '50%' })).toBe(false);
  });
});

describe('a picture’s caption', () => {
  function withPicture(doc) {
    editor(doc);
    view.dispatch({
      effects: setNoteCase.of({
        caseId: 'c1',
        entities: [{ id: 'm1', type: 'media', label: 'Roof', attrs: { path: 'media/roof.png', kind: 'image' } }],
        notes: [],
      }),
      selection: { anchor: doc.length },
    });
  }
  // cancelable as a real press is, so the editor leaves it to the picture
  const press = (selector) => view.dom.querySelector(selector).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  const key = (field, name) => field.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));

  it('is drawn under the picture, as the PDF prints it', () => {
    withPicture('[[media:m1|Roof]]{width=50% align=center caption="Smoke over the port"}\n\nAfter');
    const caption = view.dom.querySelector('.cm-block-picture .markdown-caption');
    expect(caption.textContent).toBe('Smoke over the port');
    expect(caption.className).toContain('align-center');
  });

  it('is written in a field in place, Enter writing it on the line', () => {
    withPicture('[[media:m1|Roof]]{width=50%}\n\nAfter');
    press('[data-caption]');
    const field = view.dom.querySelector('.cm-block-picture .picture-caption-field');
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe('');
    field.value = 'Smoke over the port';
    key(field, 'Enter');
    expect(view.state.doc.line(1).text).toBe('[[media:m1|Roof]]{width=50% caption="Smoke over the port"}');
    expect(view.dom.querySelector('.picture-caption-field')).toBeNull();
    expect(view.dom.querySelector('.markdown-caption').textContent).toBe('Smoke over the port');
  });

  it('stays open, and the picture stays drawn, when the case is read again unchanged', () => {
    // a tool that files a picture reloads the case: the same records come back as a new list
    withPicture('[[media:m1|Roof]]{width=50%}\n\nAfter');
    const drawn = view.dom.querySelector('.cm-block-picture');
    press('[data-caption]');
    const field = view.dom.querySelector('.picture-caption-field');
    field.value = 'Half typed';
    view.dispatch({ effects: setNoteCase.of({
      caseId: 'c1',
      entities: [{ id: 'm1', type: 'media', label: 'Roof', attrs: { path: 'media/roof.png', kind: 'image' } }],
      notes: [],
    }) });
    expect(view.dom.querySelector('.cm-block-picture')).toBe(drawn);
    expect(view.dom.querySelector('.picture-caption-field')).toBe(field);
    expect(field.value).toBe('Half typed');
  });

  it('is drawn again when the record it shows changed', () => {
    withPicture('[[media:m1|Roof]]{width=50%}\n\nAfter');
    const drawn = view.dom.querySelector('.cm-block-picture');
    view.dispatch({ effects: setNoteCase.of({
      caseId: 'c1',
      entities: [{ id: 'm1', type: 'media', label: 'Roof', attrs: { path: 'media/roof-renamed.png', kind: 'image' } }],
      notes: [],
    }) });
    expect(view.dom.querySelector('.cm-block-picture')).not.toBe(drawn);
  });

  it('is left as it was on Escape, and the note keeps its text', () => {
    withPicture('[[media:m1|Roof]]{caption="Old"}\n\nAfter');
    press('[data-caption]');
    const field = view.dom.querySelector('.picture-caption-field');
    expect(field.value).toBe('Old');
    field.value = 'New';
    key(field, 'Escape');
    expect(view.state.doc.line(1).text).toBe('[[media:m1|Roof]]{caption="Old"}');
    expect(view.dom.querySelector('.picture-caption-field')).toBeNull();
  });

  it('is taken off when the field is emptied', () => {
    withPicture('[[media:m1|Roof]]{width=50% caption="Old"}\n\nAfter');
    press('[data-caption]');
    const field = view.dom.querySelector('.picture-caption-field');
    field.value = '  ';
    key(field, 'Enter');
    expect(view.state.doc.line(1).text).toBe('[[media:m1|Roof]]{width=50%}');
  });
});
