// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { undo } from '@codemirror/commands';

import { noteExtensions, setNoteCase, setNoteMode } from '../liveMarkdown.js';
import { blockActions, blockName } from './blockMenu.js';
import { HANDLE, blockHandle, handlePlace } from './handle.js';
import { blockRanges } from './ranges.js';

/**
 * The block handle on screen: a button in the page's margin, named for its block, in
 * the drawn page only; its menu a real menu walked with the arrows, each choice one
 * step of the history, Escape giving the keyboard back to the editor.
 */

let view;
afterEach(() => {
  view?.destroy();
  view = null;
  document.body.innerHTML = '';
});

function editor(doc, { at = 0, mode = 'drawn' } = {}) {
  const parent = document.createElement('div');
  document.body.append(parent);
  view = new EditorView({ parent, state: EditorState.create({ doc, extensions: noteExtensions({ mode }) }) });
  view.dispatch({ effects: setNoteCase.of({ caseId: 'c1', entities: [] }), selection: { anchor: at } });
  // happy-dom answers the editor's own selection at once, inside its update: the keyboard's way back is watched instead
  view.focus = vi.fn();
  return view;
}

/** Press a key where the keyboard is: in a menu, or the editor. */
function press(key, options = {}) {
  const target = document.activeElement?.closest?.('[role="menu"]') ? document.activeElement : view.contentDOM;
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }));
}

const menus = () => [...document.querySelectorAll('[role="menu"]')];
const focusedAction = () => document.activeElement?.dataset?.action;

describe('the handle', () => {
  it('is a button of the drawn page, never of the raw Markdown', () => {
    editor('One\n\nTwo');
    const handle = view.scrollDOM.querySelector('button.cm-handle');
    expect(handle).not.toBeNull();
    expect(handle.getAttribute('aria-haspopup')).toBe('menu');
    expect(view.plugin(blockHandle)).not.toBeNull();
    setNoteMode(view, 'markdown');
    expect(view.scrollDOM.querySelector('.cm-handle')).toBeNull();
    expect(view.plugin(blockHandle)).toBeNull();
    setNoteMode(view, 'drawn');
    expect(view.scrollDOM.querySelector('.cm-handle')).not.toBeNull();
  });

  it('names its block for a screen reader', () => {
    editor('## Losses\n\n> [!internal] Ours\n\n![Roof](roof.png)\n\n- [ ] one');
    const names = blockRanges(view.state).map((block) => blockName(view.state, block));
    expect(names).toEqual(['Subheading', 'Internal passage', 'Picture', 'To-do list']);
  });

  it('stands in the margin, right of the page\'s edge and left of the words, whatever the line', () => {
    const cases = [
      { pageLeft: 212, wordsLeft: 244, lineTop: 400, lineHeight: 20 }, // a paragraph, a 32px margin
      { pageLeft: 212, wordsLeft: 244, lineTop: 400, lineHeight: 34 }, // a heading
      { pageLeft: 212, wordsLeft: 244, lineTop: 400, lineHeight: 12 }, // a page break's thin rule
      { pageLeft: 0, wordsLeft: 14, lineTop: 0, lineHeight: 20 }, // the panel beside the tools, a 14px margin
      { pageLeft: 100, wordsLeft: 400, lineTop: 50, lineHeight: 20 }, // centred words
    ];
    for (const line of cases) {
      const placed = handlePlace(line);
      expect(placed.left, JSON.stringify(line)).toBeGreaterThanOrEqual(line.pageLeft);
      expect(placed.left + placed.width, JSON.stringify(line)).toBeLessThanOrEqual(line.wordsLeft - HANDLE.gap);
      expect(placed.width).toBeGreaterThanOrEqual(10);
      expect(placed.width).toBeLessThanOrEqual(HANDLE.width);
    }
    // no room at all: no handle, rather than one over the words
    expect(handlePlace({ pageLeft: 0, wordsLeft: 8, lineTop: 0, lineHeight: 20 })).toBeNull();
  });
});

describe('the block menu', () => {
  it('opens on Ctrl+/ at the cursor, as a menu with its first entry in hand', () => {
    editor('Before\n\nThe convoy left at dawn.\n\nAfter', { at: 12 });
    press('/', { ctrlKey: true });
    const [menu] = menus();
    expect(menu).toBeTruthy();
    expect(menu.getAttribute('aria-label')).toMatch(/^Paragraph/);
    const entries = [...menu.querySelectorAll('[role^="menuitem"]')].map((item) => item.dataset.action);
    expect(entries).toEqual(['turn', 'internal', 'align', 'up', 'down', 'duplicate', 'page', 'delete']);
    expect(focusedAction()).toBe('turn');
    expect(menu.querySelector('[data-action="turn"]').getAttribute('aria-haspopup')).toBe('menu');
  });

  it('is walked with the arrows, a submenu opened to the right and left again', () => {
    editor('Before\n\nThe convoy left at dawn.', { at: 12 });
    press('/', { ctrlKey: true });
    press('ArrowDown');
    expect(focusedAction()).toBe('internal');
    press('ArrowUp');
    press('ArrowUp');
    expect(focusedAction()).toBe('delete');
    press('Home');
    press('ArrowRight');
    expect(menus()).toHaveLength(2);
    // the submenu starts on what the block is
    expect(focusedAction()).toBe('turn-paragraph');
    expect(document.activeElement.getAttribute('aria-checked')).toBe('true');
    // the callouts follow the kinds of words, past a rule the arrows step over
    press('End');
    expect(focusedAction()).toBe('callout-limits');
    expect([...menus()[1].querySelectorAll('[role^="menuitem"]')].map((item) => item.dataset.action)).toEqual([
      'turn-paragraph', 'turn-h1', 'turn-h2', 'turn-h3', 'turn-bullet', 'turn-numbered', 'turn-task', 'turn-quote',
      'callout-confirmed', 'callout-unverified', 'callout-lead', 'callout-note', 'callout-warning', 'callout-limits',
    ]);
    press('ArrowLeft');
    expect(menus()).toHaveLength(1);
    expect(focusedAction()).toBe('turn');
  });

  it('writes one step on Enter, which one Undo takes back, and gives the keyboard back to the editor', () => {
    const text = 'Before\n\nThe convoy left at dawn.\n\nAfter';
    editor(text, { at: 12 });
    press('/', { ctrlKey: true });
    press('ArrowRight');
    press('ArrowDown');
    expect(focusedAction()).toBe('turn-h1');
    press('Enter');
    expect(menus()).toHaveLength(0);
    expect(view.state.doc.toString()).toBe('Before\n\n# The convoy left at dawn.\n\nAfter');
    expect(view.focus).toHaveBeenCalled();
    undo(view);
    expect(view.state.doc.toString()).toBe(text);
  });

  it('closes on Escape and gives the keyboard back, writing nothing', () => {
    const text = 'Before\n\nWords';
    editor(text, { at: 10 });
    press('/', { ctrlKey: true });
    expect(menus()).toHaveLength(1);
    press('Escape');
    expect(menus()).toHaveLength(0);
    expect(view.focus).toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe(text);
  });

  it('goes to an entry by its first letter, and deletes on Delete', () => {
    editor('Before\n\nWords\n\nAfter', { at: 10 });
    press('/', { ctrlKey: true });
    press('d');
    expect(focusedAction()).toBe('duplicate');
    press('Delete');
    expect(view.state.doc.toString()).toBe('Before\n\nAfter');
  });

  it('marks a passage internal from the menu, and offers Make public on it after', () => {
    editor('Before\n\nOur own source.\n\nAfter', { at: 12 });
    press('/', { ctrlKey: true });
    press('m');
    expect(focusedAction()).toBe('internal');
    press('Enter');
    expect(view.state.doc.toString()).toBe('Before\n\n> [!internal] Our own source.\n\nAfter');
    const passage = blockRanges(view.state)[1];
    expect(blockActions(view.state, passage).some((entry) => entry.id === 'public')).toBe(true);
  });

  it('moves the cursor\'s block with Alt+↑ and Alt+↓, one step each', () => {
    const text = 'One\n\nTwo\n\nThree';
    editor(text, { at: text.indexOf('Two') + 1 });
    press('ArrowDown', { altKey: true });
    expect(view.state.doc.toString()).toBe('One\n\nThree\n\nTwo');
    expect(view.state.sliceDoc(view.state.selection.main.head - 1, view.state.selection.main.head + 2)).toBe('Two');
    press('ArrowUp', { altKey: true });
    press('ArrowUp', { altKey: true });
    expect(view.state.doc.toString()).toBe('Two\n\nOne\n\nThree');
    undo(view);
    undo(view);
    expect(view.state.doc.toString()).toBe('One\n\nThree\n\nTwo');
    undo(view);
    expect(view.state.doc.toString()).toBe(text);
  });

  it('opens nothing on a note that cannot be written', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    view = new EditorView({ parent, state: EditorState.create({ doc: 'Words', extensions: noteExtensions({ readOnly: true }) }) });
    press('/', { ctrlKey: true });
    expect(menus()).toHaveLength(0);
  });
});
