// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompletionContext } from '@codemirror/autocomplete';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';

import { focusedState, noteExtensions, noteState, setNoteCase } from '../liveMarkdown.js';
import { INSERT_SECTIONS, SLASH_COMMANDS, slashMatches } from '../syntax.js';
import { INSERT_HINT_KEY } from './insertHint.js';
import { openInsertMenu, plusAt, plusLine } from './insertMenu.js';
import { insertPreview, sampleMarkdown } from './insertPreview.js';
import { slashSource } from './slashMenu.js';
import { setFocused } from './state.js';

/**
 * The insert menu: `/` or the + of an empty line open one menu in five parts, each
 * entry with its icon, its name, its line and a preview; typing filters it by names
 * and the words each goes by, and every entry the `/` menu ever had is still found by
 * the words it was found by. An empty note says once what the + and `/` are for.
 */

let view;

function editor(doc, { at = doc.length, handlers = {} } = {}) {
  const parent = document.createElement('div');
  document.body.append(parent);
  view = new EditorView({ parent, state: EditorState.create({ doc, extensions: noteExtensions({ handlers }) }) });
  // happy-dom answers focus() with a selection of its own, which a browser does not; the editor is made focused by its state
  view.focus = vi.fn();
  view.dispatch({ effects: setNoteCase.of({ caseId: 'c1', entities: [] }) });
  view.dispatch({ selection: EditorSelection.cursor(at), effects: setFocused.of(true) });
  return view;
}

/** The menu as the editor asks for it at the cursor. */
function menu(handlers = {}) {
  return slashSource(handlers)(new CompletionContext(view.state, view.state.selection.main.head, true));
}

/** Pick the entry called `label`, as Enter does. */
function pick(label, handlers = {}) {
  const result = menu(handlers);
  const option = result.options.find((one) => one.label === label);
  option.apply(view, option, result.from, view.state.selection.main.head);
}

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
  localStorage.clear();
});

describe('the bare menu', () => {
  it('comes in five parts, in order, every entry with an icon, its name, a line and a preview', () => {
    editor('/');
    const { options } = menu();
    const parts = [...new Set(options.map((option) => option.section.name))];
    expect(parts).toEqual(['Text', 'Media', 'From the case', 'Layout', 'Figures']);
    expect(INSERT_SECTIONS.map((section) => section.label)).toEqual(parts);
    for (const option of options) {
      expect(option.insertEntry.icon, option.label).toBeTruthy();
      expect(option.detail, option.label).not.toBe('');
      expect(option.info().querySelector('.cm-ip-name').textContent).toBe(option.label);
    }
    expect(options.map((option) => option.label).slice(0, 8)).toEqual(
      ['Heading 1', 'Heading 2', 'Heading 3', 'Bulleted list', 'Numbered list', 'To-do', 'Quote', 'Callout']);
    expect(options.filter((option) => option.section.name === 'Figures').map((option) => option.label)).toEqual(['Table', 'Chart', 'Diagram']);
  });

  it('keeps the kinds of a group under it, and opens them together when it is picked', () => {
    editor('/');
    const bare = menu().options.map((option) => option.label);
    expect(bare).toContain('Callout');
    expect(bare).toContain('Internal');
    expect(bare).not.toContain('Confirmed');
    pick('Callout');
    expect(view.state.doc.toString()).toBe('/callout');
    const kinds = menu();
    expect(kinds.options.map((option) => option.label)).toEqual(['Confirmed', 'Unverified', 'Lead', 'Note', 'Warning', 'Limits', 'Internal']);
    expect(kinds.options[0].section.name).toBe('Callout');
  });
});

describe('typing in the menu', () => {
  it('finds names and the words each entry goes by, best first', () => {
    const first = (query) => slashMatches(query)[0]?.label;
    expect(first('tab')).toBe('Table');
    expect(first('grid')).toBe('Table');
    expect(first('journal')).toBe('Log entry');
    expect(first('private')).toBe('Internal');
    expect(first('separator')).toBe('Divider');
    expect(first('chapter')).toBe('Include a note');
    expect(first('scrolly')).toBe('Story');
    expect(first('date')).toBe('Today’s date');
    expect(first('title')).toBe('Heading 1');
    expect(first('placeholder')).toBe('Field: title');
  });

  it('still finds every entry the / menu had, by the words it was found by', () => {
    const found = (query, id) => slashMatches(query).some((command) => command.id === id);
    const OLD = {
      h1: 'heading 1', h2: 'subtitle', h3: 'h3', entry: 'log', task: 'todo', bullet: 'bullet', numbered: 'ordered',
      'callout-confirmed': 'confirmed', 'callout-unverified': 'unverified', 'callout-lead': 'lead', 'callout-note': 'note',
      'callout-warning': 'warning', 'callout-limits': 'caveats', 'callout-internal': 'internal', quote: 'blockquote', cite: 'mention',
      picture: 'photo', upload: 'upload', map: 'interactive', include: 'include', table: 'table', diagram: 'mermaid', steps: 'carousel',
      story: 'story', code: 'monospace', divider: 'divider', pagebreak: 'page break', cover: 'cover', signature: 'signature',
      'my-logo': 'logo', 'align-center': 'centre', 'align-right': 'align right', 'align-top-left': 'corner', 'align-top-right': 'corner',
      'align-bottom-left': 'corner', 'align-bottom-right': 'corner', date: 'today',
    };
    for (const [id, words] of Object.entries(OLD)) expect(found(words, id), `${id} by "${words}"`).toBe(true);
    // Alignment is still the one entry in the bare list
    expect(slashMatches('').some((command) => command.id === 'align')).toBe(true);
    // and guidance in a template
    expect(slashMatches('guid', { template: true })[0].id).toBe('hint');
  });

  it('shows no parts once something is typed, the best match first', () => {
    editor('/tab');
    const { options } = menu();
    expect(options[0].label).toBe('Table');
    expect(options[0].section).toBeUndefined();
  });

  it('writes an entry as one Undo step', () => {
    editor('Seen.\n/div');
    pick('Divider');
    expect(view.state.doc.toString()).toBe('Seen.\n---\n');
    undo(view);
    expect(view.state.doc.toString()).toBe('Seen.\n/div');
  });

  it('restyles a line in one step too', () => {
    editor('Seen.\n/todo');
    pick('To-do');
    expect(view.state.doc.toString()).toBe('Seen.\n- [ ] ');
    undo(view);
    expect(view.state.doc.toString()).toBe('Seen.\n/todo');
  });

  it('puts a field the PDF fills in where it is typed', () => {
    editor('By /name');
    pick('Field: name');
    expect(view.state.doc.toString()).toBe('By {name}');
  });
});

describe('the + in the margin', () => {
  it('stands on the empty line being written, never in a table or on words, where the block handle stands', () => {
    const at = (doc, pos) => plusLine(focusedState(noteState(doc).update({ selection: EditorSelection.cursor(pos) }).state));
    expect(at('Words.\n\n', 8)?.number).toBe(3);
    expect(at('Words.\n\n', 3)).toBeNull();
    expect(at('Words.\n\n/tab', 12)).toBeNull();
    expect(at('```\n\n```', 4)).toBeNull();
    expect(plusLine(noteState('').update({ selection: EditorSelection.cursor(0) }).state)).toBeNull();
  });

  it('opens the menu without writing, finds what is typed, and inserts a callout in one Undo step', () => {
    editor('Seen.\n\n');
    const plus = view.dom.querySelector('.cm-insert-plus');
    expect(plus?.getAttribute('aria-label')).toBe('Insert a block');
    plus.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(view.state.field(plusAt)).toBe(7);
    expect(view.state.doc.toString()).toBe('Seen.\n\n');
    expect(menu().options[0].section.name).toBe('Text');

    view.dispatch({ changes: { from: 7, insert: 'call' }, selection: { anchor: 11 }, userEvent: 'input.type' });
    expect(menu().options.map((option) => option.label)).toContain('Confirmed');
    view.dispatch({ changes: { from: 7, to: 11 }, selection: { anchor: 7 } });
    pick('Callout');
    pick('Confirmed');
    expect(view.state.doc.toString()).toBe('Seen.\n\n> [!confirmed] ');
  });

  it('opens after words too, a group still coming up under its name', () => {
    editor('Seen');
    openInsertMenu(view);
    pick('Callout');
    expect(view.state.doc.toString()).toBe('Seen /callout');
    expect(menu().options[0].label).toBe('Confirmed');
  });

  it('opens from the toolbar too, at the cursor', () => {
    editor('Seen.\n\n');
    expect(openInsertMenu(view)).toBe(true);
    expect(view.state.field(plusAt)).toBe(7);
    pick('Interactive map', { map: () => { view.dispatch({ changes: { from: 7, insert: 'MAP' } }); } });
    expect(view.state.doc.toString()).toBe('Seen.\n\nMAP');
  });
});

describe('the hint of an empty note', () => {
  it('shows until the menu is used, then never again in this browser', () => {
    editor('');
    expect(view.dom.querySelector('.cm-insert-hint')?.textContent).toBe('Type / or press + to add anything');
    view.dom.querySelector('.cm-insert-plus').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(localStorage.getItem(INSERT_HINT_KEY)).toBe('1');
    view.destroy();
    editor('');
    expect(view.dom.querySelector('.cm-insert-hint')).toBeNull();
  });

  it('counts an entry picked after / as the menu used', () => {
    editor('/div');
    pick('Divider');
    expect(localStorage.getItem(INSERT_HINT_KEY)).toBe('1');
  });
});

describe('the preview', () => {
  it('draws what an entry makes and the Markdown it writes, which is never to type', () => {
    const command = (id) => SLASH_COMMANDS.find((item) => item.id === id);
    const table = insertPreview(command('table'));
    expect(table.querySelector('.cm-ip-table')).not.toBeNull();
    expect(table.querySelector('.cm-ip-md').textContent).toBe('| Source | Status |\n| --- | --- |\n|  |  |');
    expect(sampleMarkdown(command('callout-confirmed'))).toBe('> [!confirmed]');
    expect(sampleMarkdown(command('h2'))).toBe('## Your words');
    expect(sampleMarkdown(command('align-top-right'))).toBe('::: top-right\nYour words\n:::');
    const group = insertPreview(command('callout'));
    expect(group.querySelector('.cm-ip-md')).toBeNull();
    expect(group.querySelector('.cm-ip-members').textContent).toBe('Confirmed · Unverified · Lead · Note · Warning · Limits');
    for (const item of SLASH_COMMANDS) expect(insertPreview(item).querySelector('.cm-ip-paper').childElementCount, item.id).toBeGreaterThan(0);
  });
});
