// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompletionContext } from '@codemirror/autocomplete';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { undo, undoDepth } from '@codemirror/commands';

import { noteDecorations, noteExtensions, noteState, openedState, setNoteCase } from '../liveMarkdown.js';
import { bubbleShown, openFootnoteField } from './bubble.js';
import { FootnoteWidget } from './inline.js';
import { slashSource } from './slashMenu.js';
import { setFocused } from './state.js';

/**
 * A footnote on the drawn page: `^[words]` is never shown as written, only as its small
 * letter, a, b… as the documents letter them, its words on hover. The bubble's Footnote,
 * the `/` menu's Footnote and a press on a letter open one field: Enter writes the words,
 * Escape leaves the note alone, Remove takes a footnote out, each one Undo step.
 */

let view;

function editor(doc, from = doc.length, to = from, { mode = 'drawn' } = {}) {
  const parent = document.createElement('div');
  document.body.append(parent);
  view = new EditorView({ parent, state: EditorState.create({ doc, extensions: noteExtensions({ mode }) }) });
  // happy-dom answers focus() with a selection of its own, which a browser does not; the editor is made focused by its state
  view.focus = vi.fn();
  view.dispatch({ effects: [setNoteCase.of({ caseId: 'c1', entities: [] }), setFocused.of(true)] });
  view.dispatch({ selection: EditorSelection.range(from, to) });
  return view;
}

const text = () => view.state.doc.toString();
const field = () => view.dom.querySelector('.cm-footnote-field');
const input = () => field()?.querySelector('input');
const key = (name) => input().dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));

function select(words) {
  const at = text().indexOf(words);
  view.dispatch({ selection: EditorSelection.range(at, at + words.length) });
}

/** Type `words` in the field and press Enter. */
function write(words) {
  input().value = words;
  key('Enter');
}

/** The footnotes the page draws, as `letter from-to: title`. */
function letters(state) {
  const out = [];
  noteDecorations(state).between(0, state.doc.length, (from, to, value) => {
    const widget = value.spec.widget;
    if (widget instanceof FootnoteWidget) out.push(`${widget.letter} ${from}-${to}: ${widget.toDOM().title}`);
  });
  return out;
}

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('a footnote on the page', () => {
  it('is its letter, in reading order, its words on hover with no Markdown', () => {
    const doc = 'Open to both,^[The 1921 text, [see it](https://example.org/t).] for long.\n\nThen^[A *second* one.].';
    const state = noteState(doc);
    const first = doc.indexOf('^[');
    const second = doc.lastIndexOf('^[');
    expect(letters(state)).toEqual([
      `a ${first}-${doc.indexOf(' for long')}: Footnote a: The 1921 text, see it.`,
      `b ${second}-${doc.length - 1}: Footnote b: A second one.`,
    ]);
    // nothing of what it holds is drawn beside it: its link is the footnote's
    const inside = [];
    noteDecorations(state).between(first + 1, doc.indexOf(' for long') - 1, (from, to, value) => {
      if (from > first && to < doc.indexOf(' for long')) inside.push(value.spec.class ?? 'hidden');
    });
    expect(inside).toEqual([]);
  });

  it('counts the footnotes before it in a table too, and leaves code alone', () => {
    const doc = '| A | B |\n| --- | --- |\n| x^[In a cell.] | 2 |\n\n`^[code]` and^[After.]\n\n```\n^[fenced]\n```';
    expect(letters(noteState(doc)).map((said) => said.split(' ')[0])).toEqual(['b']);
  });

  it('shows as written in a block whose source is open', () => {
    const doc = '::: center\nWords^[An aside.]\n:::\n\nAfter.';
    const opened = openedState(noteState(doc), 12);
    const marks = [];
    noteDecorations(opened).between(0, doc.length, (from, to, value) => {
      if (value.spec.class === 'cm-footnote-source') marks.push(doc.slice(from, to));
    });
    expect(letters(opened)).toEqual([]);
    expect(marks).toEqual(['^[An aside.]']);
  });

  it('draws as a small letter the cursor steps over whole', () => {
    editor('Open,^[An aside.] then.', 0);
    const mark = view.dom.querySelector('sup.cm-footnote');
    expect(mark.textContent).toBe('a');
    expect(mark.getAttribute('aria-label')).toBe('Footnote a');
    expect(view.dom.textContent).not.toContain('^[');
  });
});

describe('the Footnote field', () => {
  it('opens from the bubble and writes the words right after the words selected, as one Undo step', async () => {
    editor('The strait was open to both, for long.', 0, 0);
    select('open to both,');
    const depth = undoDepth(view.state);
    view.dom.querySelector('.cm-bubble [data-action="footnote"]').click();
    expect(field()).not.toBeNull();
    expect(input().placeholder).toBe('Write the footnote');
    expect(field().querySelector('.cm-link-remove')).toBeNull();
    write('The 1921 text calls it a “common passage”.');
    expect(text()).toBe('The strait was open to both,^[The 1921 text calls it a “common passage”.] for long.');
    expect(undoDepth(view.state)).toBe(depth + 1);
    expect(view.state.selection.main.head).toBe(text().indexOf(' for long'));
    expect(field()).toBeNull();
    undo(view);
    expect(text()).toBe('The strait was open to both, for long.');
  });

  it('escapes a bracket that would end the footnote early, and writes nothing for no words', () => {
    editor('Seen there.', 0, 0);
    select('Seen');
    openFootnoteField(view);
    write('a ] b');
    expect(text()).toBe('Seen^[a \\] b] there.');
    select('there');
    openFootnoteField(view);
    write('   ');
    expect(text()).toBe('Seen^[a \\] b] there.');
  });

  it('closes on Escape and leaves the note as it was', () => {
    editor('Seen there.', 0, 0);
    select('Seen');
    openFootnoteField(view);
    input().value = 'Never kept';
    key('Escape');
    expect(field()).toBeNull();
    expect(text()).toBe('Seen there.');
  });

  it('opens alone on a press on a letter, with its words to change and Remove', () => {
    editor('Open,^[An aside.] then.', 0);
    const mark = view.dom.querySelector('sup.cm-footnote');
    mark.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
    expect(bubbleShown(view.state)).toBe(true);
    expect(view.dom.querySelector('.cm-bubble').classList.contains('cm-bubble-alone')).toBe(true);
    expect(input().value).toBe('An aside.');
    write('A better aside.');
    expect(text()).toBe('Open,^[A better aside.] then.');

    view.dom.querySelector('sup.cm-footnote').dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
    const depth = undoDepth(view.state);
    field().querySelector('.cm-link-remove').click();
    expect(text()).toBe('Open, then.');
    expect(undoDepth(view.state)).toBe(depth + 1);
  });

  it('takes a footnote out when its words are cleared', () => {
    editor('Open,^[An aside.] then.', 0);
    view.dom.querySelector('sup.cm-footnote').dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
    write('');
    expect(text()).toBe('Open, then.');
  });

  it('edits the footnote a selection picked whole', () => {
    editor('Open,^[An aside.] then.', 5, 17);
    view.dom.querySelector('.cm-bubble [data-action="footnote"]').click();
    expect(input().value).toBe('An aside.');
    expect(field().querySelector('.cm-link-remove')).not.toBeNull();
  });
});

describe('the / menu\'s Footnote', () => {
  function pick(label) {
    const result = slashSource({})(new CompletionContext(view.state, view.state.selection.main.head, true));
    const option = result.options.find((one) => one.label === label);
    option.apply(view, option, result.from, view.state.selection.main.head);
  }

  it('opens the field where it was typed, the letter on the word before', () => {
    editor('Open to both, /foot');
    pick('Footnote');
    expect(text()).toBe('Open to both,');
    expect(view.dom.querySelector('.cm-bubble').classList.contains('cm-bubble-alone')).toBe(true);
    write('The 1921 text.');
    expect(text()).toBe('Open to both,^[The 1921 text.]');
  });

  it('writes the brackets in the raw Markdown, the cursor between them', () => {
    editor('Open to both, /foot', undefined, undefined, { mode: 'markdown' });
    pick('Footnote');
    expect(text()).toBe('Open to both,^[]');
    expect(view.state.selection.main.head).toBe(text().length - 1);
  });
});
