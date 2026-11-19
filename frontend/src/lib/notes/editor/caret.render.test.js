// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';

import { noteExtensions, setNoteCase, toggleWrap } from '../liveMarkdown.js';
import { setFocused } from './state.js';

/**
 * The drawn page in an editor: what is typed lands where the caret shows, Ctrl+B with
 * nothing selected steps out of bold or holds it, the arrows cross the marks put away,
 * a callout's name offers its kinds and a link opens with Ctrl. The raw Markdown is left
 * as it was.
 */

let view;
afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function editor(doc, at, mode = 'drawn') {
  const parent = document.createElement('div');
  document.body.append(parent);
  view = new EditorView({ parent, state: EditorState.create({ doc, extensions: noteExtensions({ mode }) }) });
  view.focus = vi.fn();
  view.dispatch({ effects: [setNoteCase.of({ caseId: 'c1', entities: [] }), setFocused.of(true)] });
  view.dispatch({ selection: EditorSelection.cursor(at ?? doc.length) });
  return view;
}

const text = () => view.state.doc.toString();
const head = () => view.state.selection.main.head;

/** Type `typed` as the browser reports it: at `from` (where the caret is, unless said). */
function type(typed, from = head()) {
  const handled = view.state.facet(EditorView.inputHandler).some((handler) => handler(view, from, from, typed, () => null));
  if (!handled) view.dispatch({ changes: { from, insert: typed }, selection: EditorSelection.cursor(from + typed.length), userEvent: 'input.type' });
}

function key(name, init = {}) {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init });
  view.contentDOM.dispatchEvent(event);
  return event;
}

describe('typing next to the marks put away', () => {
  it('carries bold at its end, and writes outside it once Ctrl+B steps out', () => {
    editor('The **mast** matches.', 10);
    type('s');
    expect(text()).toBe('The **masts** matches.');
    toggleWrap(view, '**');
    type('!');
    expect(text()).toBe('The **masts**! matches.');
  });

  it('types where the caret shows when the browser reports the other side of the marks', () => {
    editor('The **mast** matches.', 10);
    // the browser saw the caret after the closing marks; the page shows it in the bold
    type('s', 12);
    expect(text()).toBe('The **masts** matches.');
  });

  it('holds bold for what is typed next with nothing selected, never writing an empty `****`', () => {
    editor('Seen ', 5);
    toggleWrap(view, '**');
    expect(text()).toBe('Seen ');
    type('twice');
    expect(text()).toBe('Seen **twice**');
    type('!');
    expect(text()).toBe('Seen **twice!**');
  });

  it('keeps the caret outside bold once `**words**` is typed, so the next words are plain', () => {
    editor('', 0);
    for (const char of 'A **b**') type(char);
    type(' c');
    expect(text()).toBe('A **b** c');
  });

  it('makes `[] ` a to-do and gives a list under words its blank line', () => {
    editor('Findings\n', 9);
    type('-');
    type(' ');
    expect(text()).toBe('Findings\n\n- ');
    type('[');
    type(']');
    type(' ');
    expect(text()).toBe('Findings\n\n- [ ] ');
  });
});

describe('the keys', () => {
  it('cross the marks with Left and Right, and Enter leaves an empty item with one Undo', () => {
    editor('x **bold** y\n- one\n- ', 2);
    key('ArrowRight');
    expect(head()).toBe(5);
    view.dispatch({ selection: EditorSelection.cursor(8) });
    key('ArrowRight');
    expect(head()).toBe(11);
    key('ArrowLeft');
    expect(head()).toBe(8);
    view.dispatch({ selection: EditorSelection.cursor(text().length) });
    const before = text();
    key('Enter');
    expect(text()).toBe('x **bold** y\n- one\n\n');
    undo(view);
    expect(text()).toBe(before);
  });
});

describe('a press on the page', () => {
  it('opens the kinds of a callout from its name, and writes the one picked', () => {
    editor('> [!confirmed] The mast matches.\n> Seen twice.', 20);
    const label = view.dom.querySelector('.cm-callout-label');
    expect(label.textContent).toBe('Confirmed');
    label.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    const menu = view.dom.querySelector('.cm-handle-menu');
    expect([...menu.querySelectorAll('.cm-handle-item')].map((item) => item.textContent)).toEqual([
      'Confirmed', 'Unverified', 'Lead', 'Note', 'Warning', 'Limits', 'Plain quote', 'Text', 'Mark internalnot in Public',
    ]);
    menu.querySelector('[data-action="callout-lead"]').click();
    expect(text()).toBe('> [!lead] The mast matches.\n> Seen twice.');
    undo(view);
    expect(text()).toBe('> [!confirmed] The mast matches.\n> Seen twice.');
  });

  it('opens a link\'s page with Ctrl, and leaves a plain press to the caret', () => {
    editor('Read [the report](https://example.org/r) first.', 0);
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null);
    const link = view.dom.querySelector('.cm-link');
    expect(link.textContent).toBe('the report');
    link.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    expect(opened).not.toHaveBeenCalled();
    link.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ctrlKey: true }));
    expect(opened).toHaveBeenCalledWith('https://example.org/r', '_blank', 'noopener,noreferrer');
  });
});

describe('the raw Markdown', () => {
  it('shows every mark and keeps the editor\'s own keys', () => {
    editor('## Title\n\n- one\n- ', undefined, 'markdown');
    expect(view.contentDOM.textContent).toContain('## Title');
    expect(view.contentDOM.querySelector('.cm-bullet, .cm-task, .cm-callout-label')).toBeNull();
    view.dispatch({ selection: EditorSelection.cursor(3) });
    key('Backspace');
    expect(text()).toBe('##Title\n\n- one\n- ');
    toggleWrap(view, '**');
    expect(text()).toBe('##****Title\n\n- one\n- ');
  });
});
