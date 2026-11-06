// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorSelection, EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { cursorCharRight, undo } from '@codemirror/commands';

// a diagram is drawn by Mermaid in a browser; here it answers at once
const { drawDiagram } = vi.hoisted(() => ({ drawDiagram: vi.fn(async () => ({ svg: '<svg data-drawn="true"></svg>' })) }));
vi.mock('../mermaid.js', () => ({ renderMermaidSvg: drawDiagram }));

const {
  focusedState, jumpToLine, noteExtensions, noteMode, openBlockAt, placeText, resizePicture, setNoteCase, setNoteMode, slashSource, takeBackRange,
} = await import('./liveMarkdown.js');

/**
 * The blocks of a note stay drawn when they are clicked: a press picks one, its
 * source opens on a double press, Enter or its </> button, and closes when the
 * cursor leaves. The page can also be the raw Markdown. What happens at the keys,
 * which a browser lays out and happy-dom does not, is driven through the editor's
 * own handlers.
 */

const ROOF = { id: 'm1', type: 'media', label: 'Roof', attrs: { path: 'media/roof.png', kind: 'image' } };
const NOTES = [{ id: 'n2', title: 'Shadows', excerpt: 'Measured at noon.' }];

let view;
afterEach(() => {
  view?.destroy();
  view = null;
});

function editor(doc, options = {}) {
  const parent = document.createElement('div');
  document.body.append(parent);
  view = new EditorView({ parent, state: EditorState.create({ doc, extensions: noteExtensions(options) }) });
  view.dispatch({ effects: setNoteCase.of({ caseId: 'c1', entities: [ROOF], notes: NOTES }) });
  // happy-dom answers focus() with a selection of its own, which a browser does not; the editor is made focused by its state
  view.focus = vi.fn();
  return view;
}

/** The editor as one writes in it: focused, the cursor at `anchor`. */
function writing(doc, anchor = 0, options = {}) {
  editor(doc, options);
  view.setState(focusedState(view.state.update({ selection: EditorSelection.cursor(anchor) }).state));
  return view;
}

const text = () => view.state.doc.toString();
const head = () => view.state.selection.main.head;
const mouse = (node, type, extra = {}) => node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...extra }));
const key = (name, options = {}) => {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...options });
  view.contentDOM.dispatchEvent(event);
  return event;
};
/** Type `text` at the cursor the way the browser hands it to the editor. */
const typeText = (typed) => {
  const at = view.state.selection.main.head;
  return view.state.facet(EditorView.inputHandler).some((handler) => handler(view, at, at, typed, () => view.state.update({})));
};
const settle = async () => { for (let round = 0; round < 4; round += 1) await Promise.resolve(); };
const pictures = () => view.dom.querySelectorAll('.cm-block-picture');
const blocks = () => [...view.dom.querySelectorAll('.cm-block, .cm-include, .cm-pagebreak')];

const PICTURE = 'Intro\n\n[[media:m1|Roof]]\n\nEnd';
const FROM = 7;
const TO = 7 + '[[media:m1|Roof]]'.length;

describe('a press on a block', () => {
  it('picks it and leaves it drawn, in the same element', () => {
    writing(PICTURE, 0);
    const box = view.dom.querySelector('.cm-block-picture');
    expect(box.classList.contains('cm-picked')).toBe(false);
    mouse(box, 'mousedown');
    expect(head()).toBe(FROM);
    expect(view.focus).toHaveBeenCalled();
    expect(view.dom.querySelector('.cm-block-picture')).toBe(box);
    expect(box.classList.contains('cm-picked')).toBe(true);
    expect(view.contentDOM.textContent).not.toContain('[[media');
    // a press elsewhere unpicks it, and the element stays too
    view.dispatch({ selection: { anchor: 2 } });
    expect(box.classList.contains('cm-picked')).toBe(false);
    expect(view.dom.querySelector('.cm-block-picture')).toBe(box);
  });

  it('picks a table, a diagram, an aligned block, a rule and a chapter the same way, never opening any', () => {
    const docs = {
      table: '| A | B |\n| --- | --- |\n| 1 | 2 |\n\nEnd',
      diagram: '```mermaid\nflowchart LR\n  A --> B\n```\n\nEnd',
      aligned: '::: right\nSigned\n:::\n\nEnd',
      html: '<details>More</details>\n\nEnd',
      pagebreak: '<!-- pagebreak -->\n\nEnd',
      cover: '<!-- cover -->\n\nEnd',
      include: '[[include:n2]]\n\nEnd',
    };
    for (const [kind, doc] of Object.entries(docs)) {
      writing(doc, doc.length);
      const [box] = blocks();
      mouse(box, 'mousedown');
      expect(head(), kind).toBe(0);
      expect(blocks()[0], kind).toBe(box);
      expect(box.classList.contains('cm-picked'), kind).toBe(true);
      expect(blocks(), kind).toHaveLength(1);
    }
  });

  it('puts the cursor away while a block is picked, and brings it back with the cursor in words', () => {
    writing(PICTURE, FROM);
    expect(view.dom.classList.contains('cm-block-picking')).toBe(true);
    view.dispatch({ selection: { anchor: 2 } });
    expect(view.dom.classList.contains('cm-block-picking')).toBe(false);
    view.dispatch({ selection: { anchor: FROM } });
    expect(view.dom.classList.contains('cm-block-picking')).toBe(true);
    key('Enter');
    expect(view.dom.classList.contains('cm-block-picking')).toBe(false);
  });

  it('draws the picture bar while it is picked, and a size press leaves it picked', () => {
    writing(PICTURE, FROM);
    const box = view.dom.querySelector('.cm-block-picture');
    expect(box.classList.contains('cm-picked')).toBe(true);
    expect(box.querySelector('[data-size-bar]')).not.toBeNull();
    mouse(box.querySelector('[data-share="0.5"]'), 'mousedown');
    expect(text()).toContain('[[media:m1|Roof]]{width=50%}');
    expect(view.dom.querySelector('.cm-block-picture')).not.toBeNull();
    expect(head()).toBe(FROM);
  });

  it('is opened by a double press, the cursor at its start, and closes when the cursor leaves', () => {
    writing(PICTURE, 2);
    mouse(view.dom.querySelector('.cm-block-picture'), 'dblclick');
    expect(pictures()).toHaveLength(0);
    expect(head()).toBe(FROM);
    expect(view.contentDOM.textContent).toContain('[[media:m1|Roof]]');
    // the cursor stays in its source: still open, on any of its characters
    view.dispatch({ selection: { anchor: TO } });
    expect(pictures()).toHaveLength(0);
    view.dispatch({ selection: { anchor: 2 } });
    expect(pictures()).toHaveLength(1);
    expect(view.contentDOM.textContent).not.toContain('[[media');
  });

  it('is opened by its </> button, a press or the keyboard', () => {
    writing(PICTURE, 2);
    const edit = view.dom.querySelector('.cm-size-bar .cm-size-edit');
    expect(edit.title).toBe('Edit the source');
    expect(edit.getAttribute('aria-label')).toBe('Edit the source');
    mouse(edit, 'mousedown');
    expect(pictures()).toHaveLength(0);
    expect(head()).toBe(FROM);
    view.dispatch({ selection: { anchor: 0 } });
    // Enter and Space on a button give a click with no press before it
    view.dom.querySelector('.cm-size-edit').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(pictures()).toHaveLength(0);
    // a click that follows a press is the press's, not a second opening
    view.dispatch({ selection: { anchor: 0 } });
    view.dom.querySelector('.cm-size-edit').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(pictures()).toHaveLength(1);
  });

  it('is not opened by a double press on its bar', () => {
    writing(PICTURE, 2);
    mouse(view.dom.querySelector('.cm-size-bar [data-share="0.5"]'), 'dblclick');
    expect(pictures()).toHaveLength(1);
  });

  it('wears the </> button on every kind of block, says what it does, and opens its own block only', () => {
    const docs = {
      picture: '[[media:m1|Roof]]\n\nEnd',
      table: '| A | B |\n| --- | --- |\n| 1 | 2 |\n\nEnd',
      diagram: '```mermaid\nflowchart LR\n  A --> B\n```\n\nEnd',
      aligned: '::: right\nSigned\n:::\n\nEnd',
      html: '<details>More</details>\n\nEnd',
      pagebreak: '<!-- pagebreak -->\n\nEnd',
      cover: '<!-- cover -->\n\nEnd',
      include: '[[include:n2]]\n\nEnd',
    };
    for (const [kind, doc] of Object.entries(docs)) {
      writing(doc, doc.length);
      expect(blocks(), kind).toHaveLength(1);
      const buttons = view.dom.querySelectorAll('[data-edit-source]');
      expect(buttons, kind).toHaveLength(1);
      expect(buttons[0].title, kind).toBe('Edit the source');
      expect(buttons[0].getAttribute('aria-label'), kind).toBe('Edit the source');
      mouse(buttons[0], 'mousedown');
      expect(blocks(), kind).toHaveLength(0);
      expect(head(), kind).toBe(0);
      expect(view.contentDOM.textContent, kind).toContain(doc.split('\n')[0]);
    }
    // beside others, a button opens its block and no other
    writing('| A |\n| --- |\n\n<!-- pagebreak -->\n\n[[include:n2]]', 0);
    expect(blocks()).toHaveLength(3);
    mouse(view.dom.querySelectorAll('[data-edit-source]')[1], 'mousedown');
    expect(blocks().map((node) => node.dataset.block ?? node.className)).toEqual(['table', 'cm-include']);
  });

  it('keeps its </> button when a diagram is drawn into it', async () => {
    writing('```mermaid\nflowchart LR\n  A --> B\n```\n\nEnd', 0);
    await settle();
    const diagram = view.dom.querySelector('.cm-block-diagram');
    expect(diagram.querySelector('svg[data-drawn]')).not.toBeNull();
    expect(diagram.querySelector('[data-edit-source]')).not.toBeNull();
    mouse(diagram, 'dblclick');
    expect(view.dom.querySelector('.cm-block-diagram')).toBeNull();
    expect(view.contentDOM.textContent).toContain('flowchart LR');
  });

  it('is opened in a note nobody can write in, too, to be read', () => {
    writing(PICTURE, 2, { readOnly: true });
    expect(view.dom.querySelector('.cm-size-bar')).toBeNull();
    const edit = view.dom.querySelector('.cm-block-picture > [data-edit-source]');
    expect(edit).not.toBeNull();
    mouse(edit, 'mousedown');
    expect(pictures()).toHaveLength(0);
    expect(view.contentDOM.textContent).toContain('[[media:m1|Roof]]');
  });

  it('can be opened by position, and says when there is nothing drawn there', () => {
    writing(PICTURE, 2);
    expect(openBlockAt(view, 3)).toBe(false);
    expect(openBlockAt(view, FROM + 4)).toBe(true);
    expect(head()).toBe(FROM);
    expect(pictures()).toHaveLength(0);
  });
});

describe('the keyboard at a picked block', () => {
  it('opens it on Enter, the cursor at the start of its source, and leaves Enter to Markdown elsewhere', () => {
    writing(PICTURE, FROM);
    const event = key('Enter');
    expect(event.defaultPrevented).toBe(true);
    expect(pictures()).toHaveLength(0);
    expect(head()).toBe(FROM);
    expect(text()).toBe(PICTURE);
    // in words, Enter is the editor's own
    writing('Words', 5);
    key('Enter');
    expect(text()).toBe('Words\n');
  });

  it('opens a table, a diagram and a chapter the same way', () => {
    const doc = '| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n[[include:n2]]';
    for (const at of [0, doc.indexOf('```mermaid'), doc.indexOf('[[include')]) {
      writing(doc, at);
      const before = blocks().length;
      key('Enter');
      expect(blocks().length).toBe(before - 1);
      expect(head()).toBe(at);
    }
  });

  it('sends Tab to the picture bar, and never indents the source of a block', () => {
    writing(PICTURE, FROM);
    key('Tab');
    expect(text()).toBe(PICTURE);
    expect(document.activeElement).toBe(view.dom.querySelector('.cm-picked [data-size-bar] button'));
    writing('| A | B |\n| --- | --- |\n| 1 | 2 |', 0);
    key('Tab');
    key('Tab', { shiftKey: true });
    expect(text()).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |');
    // in words Tab is the editor's own
    writing('Words', 0);
    key('Tab');
    expect(text()).not.toBe('Words');
  });

  it('removes the whole block on Backspace, in one step Undo takes back', () => {
    writing(PICTURE, FROM);
    const event = key('Backspace');
    expect(event.defaultPrevented).toBe(true);
    expect(text()).toBe('Intro\n\nEnd');
    expect(head()).toBe(FROM);
    expect(undo(view)).toBe(true);
    expect(text()).toBe(PICTURE);
    expect(pictures()).toHaveLength(1);
  });

  it('removes it on Delete too, and a table, and the last block of a note', () => {
    writing(PICTURE, FROM);
    key('Delete');
    expect(text()).toBe('Intro\n\nEnd');
    writing('Intro\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nEnd', 7);
    key('Delete');
    expect(text()).toBe('Intro\n\nEnd');
    writing('Intro\n\n[[media:m1|Roof]]', FROM);
    key('Backspace');
    expect(text()).toBe('Intro\n');
    writing('[[media:m1|Roof]]\nWords', 0);
    key('Backspace');
    expect(text()).toBe('Words');
    writing('[[media:m1|Roof]]', 0);
    key('Backspace');
    expect(text()).toBe('');
  });

  it('removes a block the cursor stands after, as at the end of the note', () => {
    writing(PICTURE, 2);
    view.dispatch({ selection: { anchor: TO } });
    key('Backspace');
    expect(text()).toBe('Intro\n\nEnd');
  });

  it('removes nothing from a note nobody can write in', () => {
    writing(PICTURE, FROM, { readOnly: true });
    key('Backspace');
    key('Delete');
    expect(text()).toBe(PICTURE);
    expect(pictures()).toHaveLength(1);
  });

  it('picks a block before it would be joined to the words next to it', () => {
    writing('[[media:m1|Roof]]\nWords', '[[media:m1|Roof]]\n'.length);
    key('Backspace');
    expect(text()).toBe('[[media:m1|Roof]]\nWords');
    expect(head()).toBe(0);
    key('Backspace');
    expect(text()).toBe('Words');
    writing('Words\n[[media:m1|Roof]]', 'Words'.length);
    key('Delete');
    expect(text()).toBe('Words\n[[media:m1|Roof]]');
    expect(head()).toBe('Words\n'.length);
    // on an empty line the keys are the editor's own
    writing('[[media:m1|Roof]]\n\nWords', '[[media:m1|Roof]]\n'.length);
    key('Backspace');
    expect(text()).toBe('[[media:m1|Roof]]\nWords');
  });

  it('closes an open block on Escape and picks it', () => {
    writing('| A | B |\n| --- | --- |\n| 1 | 2 |\n\nEnd', 0);
    key('Enter');
    view.dispatch({ selection: { anchor: 14 } });
    expect(view.dom.querySelector('.cm-block-table')).toBeNull();
    const event = key('Escape');
    expect(event.defaultPrevented).toBe(true);
    expect(head()).toBe(0);
    expect(view.dom.querySelector('.cm-block-table.cm-picked')).not.toBeNull();
    // with nothing open, Escape does nothing to the note
    key('Escape');
    expect(head()).toBe(0);
    expect(view.dom.querySelector('.cm-block-table.cm-picked')).not.toBeNull();
  });

  it('types on a new line after the block, never into its line', () => {
    writing(PICTURE, FROM);
    expect(typeText('x')).toBe(true);
    expect(text()).toBe('Intro\n\n[[media:m1|Roof]]\n\nx\n\nEnd');
    expect(head()).toBe(TO + 3);
    expect(pictures()).toHaveLength(1);
    // as many times as it is typed to: the cursor is past the block now
    expect(typeText('y')).toBe(false);
    // next to words with no blank line between, one is made
    writing('[[media:m1|Roof]]\nNext', 0);
    typeText('x');
    expect(text()).toBe('[[media:m1|Roof]]\n\nx\n\nNext');
    // at the end of the note
    writing('[[media:m1|Roof]]', 0);
    typeText('x');
    expect(text()).toBe('[[media:m1|Roof]]\n\nx');
    expect(head()).toBe(text().length);
    // with the cursor after the block, as at the end of the note
    writing('Words\n\n| A | B |\n| --- | --- |\n| 1 | 2 |', 7);
    view.dispatch({ selection: { anchor: text().length } });
    typeText('/');
    expect(text().endsWith('| 1 | 2 |\n\n/')).toBe(true);
  });

  it('never types into a table, a diagram or a chapter either, and ignores a space', () => {
    writing('| A | B |\n| --- | --- |\n| 1 | 2 |', 0);
    expect(typeText(' ')).toBe(true);
    expect(text()).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |');
    typeText('t');
    expect(text()).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |\n\nt');
    writing('[[include:n2]]', 0);
    typeText('t');
    expect(text()).toBe('[[include:n2]]\n\nt');
  });

  it('leaves typing alone in words, on a selection, in an open block and in a note nobody can write in', () => {
    writing('Words here', 3);
    expect(typeText('x')).toBe(false);
    writing(PICTURE, FROM);
    view.dispatch({ selection: EditorSelection.range(FROM, TO) });
    expect(typeText('x')).toBe(false);
    writing(PICTURE, FROM, { readOnly: true });
    expect(typeText('x')).toBe(false);
    writing(PICTURE, FROM);
    key('Enter');
    expect(typeText('x')).toBe(false);
  });

  it('starts a / menu next to a picture, on the line it made', () => {
    writing(PICTURE, FROM);
    typeText('/');
    expect(text()).toBe('Intro\n\n[[media:m1|Roof]]\n\n/\n\nEnd');
    const offered = slashSource({})(new CompletionContext(view.state, head(), false));
    expect(offered.options.length).toBeGreaterThan(5);
  });
});

describe('the arrow keys over a block', () => {
  it('step off a picked block to the line past it, or the line before it', () => {
    writing(PICTURE, FROM);
    expect(key('ArrowDown').defaultPrevented).toBe(true);
    expect(head()).toBe(TO + 1);
    writing(PICTURE, FROM);
    key('ArrowUp');
    expect(head()).toBe(FROM - 1);
    writing(PICTURE, FROM);
    key('ArrowRight');
    expect(head()).toBe(TO + 1);
    writing(PICTURE, FROM);
    key('ArrowLeft');
    expect(head()).toBe(FROM - 1);
  });

  it('step from block to block as from line to line, and stay at the ends of the note', () => {
    // chapters and pictures are lines of their own: blocks can follow one another with no line between
    const doc = '[[media:m1|Roof]]\n[[include:n2]]\n[[include:n2]]';
    const second = doc.indexOf('[[include');
    const third = doc.lastIndexOf('[[include');
    writing(doc, 0);
    key('ArrowDown');
    expect(head()).toBe(second);
    key('ArrowRight');
    expect(head()).toBe(third);
    key('ArrowUp');
    expect(head()).toBe(second);
    key('ArrowLeft');
    expect(head()).toBe(0);
    // at the top of the note there is nowhere above
    key('ArrowUp');
    expect(head()).toBe(0);
    // at the foot of it, nowhere below: the cursor goes to the end of the block
    writing('Intro\n\n[[media:m1|Roof]]', FROM);
    key('ArrowDown');
    expect(head()).toBe(FROM + '[[media:m1|Roof]]'.length);
  });

  it('pick a block the cursor comes to from the line below, going left', () => {
    writing('[[media:m1|Roof]]\nWords', '[[media:m1|Roof]]\n'.length);
    key('ArrowLeft');
    expect(head()).toBe(0);
    expect(view.dom.querySelector('.cm-block-picture.cm-picked')).not.toBeNull();
    // anywhere else Left is the editor's own
    writing('Words here', 3);
    key('ArrowLeft');
    expect(head()).toBe(2);
  });

  it('pick a block the vertical move would have put the cursor in, wherever it lands', () => {
    const doc = 'Words\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nEnd';
    writing(doc, 6);
    const table = doc.indexOf('| A');
    // a browser lays the lines out and answers where Down goes: into the middle of the table
    view.moveVertically = vi.fn(() => EditorSelection.cursor(table + 14));
    key('ArrowDown');
    expect(view.moveVertically).toHaveBeenCalledWith(expect.anything(), true);
    expect(head()).toBe(table);
    expect(view.dom.querySelector('.cm-block-table.cm-picked')).not.toBeNull();
    // out of it, going up, onto the end of the table
    writing(doc, doc.length);
    view.moveVertically = vi.fn(() => EditorSelection.cursor(table + 30));
    key('ArrowUp');
    expect(head()).toBe(table);
    // a move that lands in words is the editor's own: ours does nothing
    writing('Words\n\nMore\n\nEnd', 2);
    view.moveVertically = vi.fn(() => EditorSelection.cursor(8));
    const own = vi.spyOn(view, 'dispatch');
    key('ArrowDown');
    expect(own.mock.calls.every(([spec]) => !(spec?.selection?.anchor === 8 && spec?.userEvent === 'select'))).toBe(true);
    // and a vertical move the layout cannot answer is left to the editor too
    view.moveVertically = vi.fn(() => { throw new Error('not laid out'); });
    expect(() => key('ArrowDown')).not.toThrow();
    expect(text()).toBe('Words\n\nMore\n\nEnd');
  });

  it('are stepped into and out of a picture, a table and a diagram alike', () => {
    const kinds = {
      picture: '[[media:m1|Roof]]',
      table: '| A | B |\n| --- | --- |\n| 1 | 2 |',
      diagram: '```mermaid\nflowchart LR\n  A --> B\n```',
    };
    for (const [kind, block] of Object.entries(kinds)) {
      const doc = `Words\n\n${block}\n\nEnd`;
      const from = 'Words\n\n'.length;
      const to = from + block.length;
      // down from the line above: the vertical move lands in the block, the cursor picks it
      writing(doc, 0);
      view.moveVertically = vi.fn(() => EditorSelection.cursor(from + 3));
      key('ArrowDown');
      expect(head(), kind).toBe(from);
      expect(view.dom.querySelector('.cm-picked'), kind).not.toBeNull();
      // down again, off it, to the line past it; up, to the line before it
      key('ArrowDown');
      expect(head(), kind).toBe(to + 1);
      writing(doc, from);
      key('ArrowUp');
      expect(head(), kind).toBe(from - 1);
      // up from the line below: the move lands at the end of the block, and picks it
      writing(doc, to + 1);
      view.moveVertically = vi.fn(() => EditorSelection.cursor(to));
      key('ArrowUp');
      expect(head(), kind).toBe(from);
      expect(view.dom.querySelector('.cm-picked'), kind).not.toBeNull();
    }
  });

  it('are the editor\'s own to the right of the line above a block: its next place is the block\'s start', () => {
    writing('Words\n[[media:m1|Roof]]', 5);
    key('ArrowRight');
    expect(head()).toBe(6);
    expect(view.dom.querySelector('.cm-block-picture.cm-picked')).not.toBeNull();
  });

  it('leave the cursor to the editor with a range selected', () => {
    writing(PICTURE, FROM);
    view.dispatch({ selection: EditorSelection.range(2, 4) });
    key('ArrowRight');
    // the editor's own: the range closes at its end, the block it is next to is not picked
    expect(head()).toBe(4);
    expect(view.dom.querySelector('.cm-picked')).toBeNull();
  });

  it('make every drawn block one piece for the cursor, which the motion commands skip', () => {
    writing(`${PICTURE}\n\n| A | B |\n| --- | --- |\n| 1 | 2 |`, FROM);
    const ranges = [];
    for (const source of view.state.facet(EditorView.atomicRanges)) {
      source(view).between(0, view.state.doc.length, (from, to) => ranges.push([from, to]));
    }
    expect(ranges).toContainEqual([FROM, TO]);
    expect(ranges).toContainEqual([text().indexOf('| A'), text().length]);
    // the editor's own step to the right goes over the block, not into it
    cursorCharRight(view);
    expect(head()).toBe(TO);
  });
});

describe('a line that is jumped to', () => {
  it('opens a table at the row, picks a picture and lights it', () => {
    writing('Words\n\n[[media:m1|Roof]]\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nEnd', 0);
    jumpToLine(view, 6);
    expect(view.dom.querySelector('.cm-block-table')).toBeNull();
    expect(head()).toBe(text().indexOf('| 1 | 2 |'));
    view.dispatch({ selection: { anchor: 0 } });
    expect(view.dom.querySelector('.cm-block-table')).not.toBeNull();
    jumpToLine(view, 2);
    expect(head()).toBe(7);
    const picture = view.dom.querySelector('.cm-block-picture');
    expect(picture).not.toBeNull();
    expect(picture.classList.contains('cm-block-landed')).toBe(true);
  });

  it('opens an aligned block at the line a warning names', () => {
    writing('Intro\n\n::: right\nSigned\n:::\n\nEnd', 0);
    jumpToLine(view, 3);
    expect(view.dom.querySelector('.cm-block-aligned')).toBeNull();
    expect(head()).toBe(text().indexOf('Signed'));
  });
});

describe('the raw Markdown mode', () => {
  const NOTE = '# Title\n\nSeen at [[entity:p1|Quay]]\n\n[[media:m1|Roof]]{width=50%}\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```\ncode\n```\n\n<!--? Who said it -->\n\n<!-- pagebreak -->\n\n- [ ] Task';

  it('shows the lines as written, nothing drawn, hidden or replaced', () => {
    editor(NOTE, { mode: 'markdown' });
    expect(noteMode(view.state)).toBe('markdown');
    expect(blocks()).toHaveLength(0);
    expect(view.dom.querySelector('[data-chip], .cm-task, .cm-bullet, [data-hint], [data-pagebreak]')).toBeNull();
    const shown = view.contentDOM.textContent;
    for (const raw of ['# Title', '[[entity:p1|Quay]]', '[[media:m1|Roof]]{width=50%}', '| --- | --- |', '<!--? Who said it -->', '<!-- pagebreak -->', '- [ ] Task']) {
      expect(shown, raw).toContain(raw);
    }
  });

  it('keeps headings, code, tables and guidance lines in their own type', () => {
    editor(NOTE, { mode: 'markdown' });
    const classes = (name) => view.contentDOM.querySelectorAll(`.${name}`).length;
    expect(classes('cm-h1')).toBe(1);
    expect(classes('cm-table-line')).toBe(3);
    expect(classes('cm-code-line')).toBe(3);
    expect(classes('cm-hint-line')).toBe(1);
    expect(classes('cm-pagebreak-line')).toBe(1);
  });

  it('switches in place, keeping the text, the cursor and the Undo', () => {
    writing(NOTE, 12);
    expect(blocks().length).toBeGreaterThan(0);
    view.dispatch({ changes: { from: 7, insert: '!' }, userEvent: 'input.type' });
    const written = text();
    expect(setNoteMode(view, 'markdown')).toBe(true);
    expect(noteMode(view.state)).toBe('markdown');
    expect(blocks()).toHaveLength(0);
    expect(text()).toBe(written);
    expect(head()).toBe(13);
    // the same mode again changes nothing
    expect(setNoteMode(view, 'markdown')).toBe(false);
    expect(setNoteMode(view, 'drawn')).toBe(true);
    expect(blocks().length).toBeGreaterThan(0);
    expect(text()).toBe(written);
    expect(head()).toBe(13);
    expect(undo(view)).toBe(true);
    expect(text()).toBe(NOTE);
  });

  it('forgets an open block and a pick, and draws the others', () => {
    writing(PICTURE, FROM);
    key('Enter');
    setNoteMode(view, 'markdown');
    setNoteMode(view, 'drawn');
    // opened before, closed after: the cursor is at its start, picked
    expect(view.dom.querySelector('.cm-block-picture.cm-picked')).not.toBeNull();
  });

  it('leaves every key of the blocks to the text: no atomic ranges, Backspace deletes a character', () => {
    writing(PICTURE, FROM, { mode: 'markdown' });
    expect(view.state.facet(EditorView.atomicRanges)).toHaveLength(0);
    key('Enter');
    expect(text()).toBe('Intro\n\n\n[[media:m1|Roof]]\n\nEnd');
    writing(PICTURE, TO, { mode: 'markdown' });
    typeText('x');
    expect(text()).toBe(PICTURE);
    view.dispatch({ changes: { from: TO, insert: 'x' } });
    expect(text()).toBe('Intro\n\n[[media:m1|Roof]]x\n\nEnd');
  });

  it('still takes what is put in, resizes a picture and offers the / menu', () => {
    writing('Words', 5, { mode: 'markdown' });
    const landed = placeText(view, 5, '[[media:m1|Roof]]');
    expect(text()).toBe('Words\n\n[[media:m1|Roof]]\n');
    expect(resizePicture(view, 2, 'media:m1', { width: '50%' })).toBe(true);
    expect(text()).toBe('Words\n\n[[media:m1|Roof]]{width=50%}\n');
    expect(takeBackRange(view, landed)).toBe(true);
    expect(text()).toBe('Words');
    writing('First line.\n/todo', 17, { mode: 'markdown' });
    const result = slashSource({})(new CompletionContext(view.state, 17, false));
    result.options.find((option) => option.label === 'To-do').apply(view, null, result.from, 17);
    expect(text()).toBe('First line.\n- [ ] ');
  });

  it('goes to a line as a cursor on its start, a picture included', () => {
    writing('Words\n\n[[media:m1|Roof]]\n\nEnd', 0, { mode: 'markdown' });
    jumpToLine(view, 2);
    expect(head()).toBe(7);
    expect(view.dom.querySelector('.cm-landed')).not.toBeNull();
  });

  it('lets typing on a line of guidance add to it, not replace it', () => {
    writing('<!--? Who said it -->', 10, { mode: 'markdown' });
    view.dispatch({ changes: { from: 10, insert: 'A' }, selection: { anchor: 11 }, userEvent: 'input.type' });
    expect(text()).toBe('<!--? Who Asaid it -->');
    writing('<!--? Who said it -->', 10);
    view.dispatch({ changes: { from: 10, insert: 'A' }, selection: { anchor: 11 }, userEvent: 'input.type' });
    expect(text()).toBe('A');
  });
});
