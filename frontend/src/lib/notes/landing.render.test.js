// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import {
  blockAt, captionAt, heldRange, holdRange, jumpToLine, lightLines, noteExtensions, placeText, releaseRange, setNoteCase,
  takeBackRange,
} from './liveMarkdown.js';

/**
 * What a tool puts in the note lands where it was asked for, on lines of its own,
 * lit for a moment, and Undo finds it again whatever was typed around it.
 */

let view;
afterEach(() => {
  view?.destroy();
  view = null;
  vi.useRealTimers();
});

const PICTURE = { id: 'm1', type: 'media', label: 'Roof', attrs: { path: 'media/roof.png', kind: 'image' } };

function editor(doc, { handlers = {}, entities = [PICTURE] } = {}) {
  const parent = document.createElement('div');
  document.body.append(parent);
  view = new EditorView({ parent, state: EditorState.create({ doc, extensions: noteExtensions({ handlers }) }) });
  view.dispatch({ effects: setNoteCase.of({ caseId: 'c1', entities }) });
  return view;
}

const text = () => view.state.doc.toString();

describe('where a put is written', () => {
  const state = (doc) => EditorState.create({ doc });

  it('takes a blank line from the words before and after it', () => {
    expect(blockAt(state('Words'), 5, 'T').insert).toBe('\n\nT\n');
    expect(blockAt(state('Words\nMore'), 5, 'T').insert).toBe('\n\nT\n');
    expect(blockAt(state('Words\n\nMore'), 5, 'T').insert).toBe('\n\nT');
    expect(blockAt(state(''), 0, 'T').insert).toBe('T\n');
    expect(blockAt(state('Words\n'), 6, 'T').insert).toBe('\nT\n');
  });

  it('splits a line it is put in the middle of', () => {
    expect(blockAt(state('Seen here today'), 9, 'T').insert).toBe('\n\nT\n\n');
  });

  it('goes inline with a space either side when asked', () => {
    expect(blockAt(state('Seen at'), 7, 'X', { inline: true }).insert).toBe(' X ');
    expect(blockAt(state('Seen at '), 8, 'X', { inline: true }).insert).toBe('X ');
  });
});

describe('a put landing in the note', () => {
  it('holds its place while the note is typed in, and lands there', () => {
    editor('First.\n\nLast.');
    const spot = holdRange(view, 6);
    view.dispatch({ changes: { from: 0, insert: 'Before. ' } });
    expect(heldRange(view, spot)).toEqual({ from: 14, to: 14 });
    placeText(view, heldRange(view, spot).from, '| A |\n| --- |\n| 1 |');
    releaseRange(view, spot);
    expect(text()).toBe('Before. First.\n\n| A |\n| --- |\n| 1 |\n\nLast.');
    expect(heldRange(view, spot)).toBeNull();
  });

  it('is lit, and the light goes out', () => {
    vi.useFakeTimers();
    editor('Words');
    placeText(view, 5, '48.12345, 37.12345');
    expect(view.contentDOM.querySelectorAll('.cm-landed').length).toBe(1);
    vi.advanceTimersByTime(2000);
    expect(view.contentDOM.querySelectorAll('.cm-landed').length).toBe(0);
  });

  it('moves the note’s own cursor past it only when the cursor was where it landed', () => {
    editor('One\n\nTwo');
    view.dispatch({ selection: { anchor: 0 } });
    placeText(view, view.state.doc.length, 'X');
    expect(view.state.selection.main.head).toBe(0);
    placeText(view, 0, 'Y', { inline: true });
    expect(view.state.selection.main.head).toBe(2);
  });

  it('leaves the cursor right after the text when it is to be typed on from, wherever the note’s cursor was', () => {
    editor('One\n\nTwo');
    view.dispatch({ selection: { anchor: 0 } });
    const landed = placeText(view, view.state.doc.length, 'Reverse search: Quai. Result: ', { caret: true });
    expect(text()).toBe('One\n\nTwo\n\nReverse search: Quai. Result: \n');
    // after the space the line ends on, before the break that follows it
    expect(view.state.selection.main.head).toBe(text().indexOf('Result: ') + 'Result: '.length);
    view.dispatch({ changes: { from: view.state.selection.main.head, insert: 'nothing found' } });
    expect(text()).toContain('Result: nothing found\n');
    // once the analyst has typed in it, Undo leaves it alone
    expect(takeBackRange(view, landed)).toBe(false);
  });

  it('is taken back whole, as long as it is unchanged', () => {
    editor('Words');
    const landed = placeText(view, 5, '> quoted\n\n| A |\n| --- |');
    view.dispatch({ changes: { from: 0, insert: 'More ' } });
    expect(takeBackRange(view, landed)).toBe(true);
    expect(text()).toBe('More Words');
  });

  it('is left alone once its words were changed', () => {
    editor('Words');
    const landed = placeText(view, 5, 'A sentence the tool wrote.');
    const at = text().indexOf('tool');
    view.dispatch({ changes: { from: at, to: at + 4, insert: 'analyst' } });
    expect(takeBackRange(view, landed)).toBe(false);
    expect(text()).toContain('analyst');
  });

  it('counts a picture given a size or a caption since as unchanged', () => {
    editor('Words');
    const landed = placeText(view, 5, '[[media:m1|Roof]]');
    const end = text().indexOf(']]') + 2;
    view.dispatch({ changes: { from: end, insert: '{width=50% caption="Roof of the depot"}' } });
    expect(takeBackRange(view, landed)).toBe(true);
    expect(text()).toBe('Words');
  });
});

describe('a picture that landed', () => {
  it('opens its caption, and gives the keyboard back to where it was', async () => {
    editor('Words');
    const button = document.createElement('button');
    document.body.append(button);
    const landed = placeText(view, 5, '[[media:m1|Roof]]');
    const held = heldRange(view, landed.id);
    expect(await captionAt(view, held.from + 2, { returnTo: button })).toBe(true);
    const field = view.contentDOM.querySelector('.picture-caption-field');
    expect(field).not.toBeNull();
    field.value = 'The depot roof';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(text()).toBe('Words\n\n[[media:m1|Roof]]{caption="The depot roof"}\n');
    expect(document.activeElement).toBe(button);
    button.remove();
  });

  it('is brought into view and lit by Go to, rather than opened as text', () => {
    editor('Words\n\n[[media:m1|Roof]]\n\nMore');
    // happy-dom answers focus() with a selection of its own, which a browser does not
    view.focus = vi.fn();
    jumpToLine(view, 2);
    expect(view.contentDOM.querySelector('.cm-block-picture')).not.toBeNull();
    expect(view.contentDOM.querySelector('.cm-block-picture').classList.contains('cm-block-landed')).toBe(true);
    // picked, not opened: the cursor is at its start and the picture stays drawn with its bar
    expect(view.state.selection.main.head).toBe(7);
    expect(view.contentDOM.querySelector('.cm-block-picture [data-size-bar]')).not.toBeNull();
  });

  it('still opens a line of words for Go to', () => {
    editor('Words\n\nMore');
    jumpToLine(view, 2);
    expect(view.state.selection.main.head).toBe(7);
  });
});

describe('the picture bar', () => {
  const bar = () => view.contentDOM.querySelector('.cm-size-bar');

  it('offers the tool a picture was made in, never printed', () => {
    const open = vi.fn();
    editor('[[media:m1|Roof]]\n\nAfter', { handlers: { opener: (entity) => (entity.id === 'm1' ? { label: 'Open in Map', open } : null) } });
    const button = bar().querySelector('[data-open]');
    expect(button.textContent).toBe('Open in Map');
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    expect(open).toHaveBeenCalledOnce();
  });

  it('has no way back when no tool can reopen it', () => {
    editor('[[media:m1|Roof]]\n\nAfter', { handlers: { opener: () => null } });
    expect(bar().querySelector('[data-open]')).toBeNull();
  });

  it('offers Source… for a picture whose source is the analyst’s to state, and states it', async () => {
    const stateSource = vi.fn(async () => {});
    editor('[[media:m1|Roof]]\n\nAfter', { handlers: { sourceable: async () => true, stateSource } });
    await Promise.resolve();
    await Promise.resolve();
    const said = bar().querySelector('[data-source]');
    expect(said.textContent).toBe('Source…');
    said.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    const field = view.contentDOM.querySelector('.picture-source-field');
    field.value = 'not a link';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(stateSource).not.toHaveBeenCalled();
    field.value = 'https://t.me/port_watch/42';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(stateSource).toHaveBeenCalledWith(PICTURE, 'https://t.me/port_watch/42');
    expect(view.contentDOM.querySelector('.picture-source-field')).toBeNull();
  });

  it('offers no Source… for a picture that already says where it comes from', async () => {
    const sourceable = vi.fn(async () => true);
    editor('[[media:m1|Roof]]\n\nAfter', { handlers: { sourceable }, entities: [{ ...PICTURE, attrs: { ...PICTURE.attrs, source_url: 'https://x.com/a/status/1' } }] });
    await Promise.resolve();
    expect(sourceable).not.toHaveBeenCalled();
    expect(bar().querySelector('[data-source]')).toBeNull();
  });

  it('offers Posted… on a proof, holding where it was posted, and keeps the new address', async () => {
    const proof = { id: 'm1', type: 'proof', label: 'Proof 28', attrs: { path: 'proofs/28.png', posted_url: 'https://x.com/me/status/1' } };
    const statePosted = vi.fn(async () => {});
    editor('[[media:m1|Proof 28]]\n\nAfter', { handlers: { statePosted }, entities: [proof] });
    const posted = bar().querySelector('[data-posted]');
    expect(posted.textContent).toBe('Posted ✓');
    posted.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    const field = view.contentDOM.querySelector('.picture-source-field');
    expect(field.value).toBe('https://x.com/me/status/1');
    expect(field.getAttribute('aria-label')).toBe('Posted at');
    field.value = 'https://x.com/me/status/2';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(statePosted).toHaveBeenCalledWith(proof, 'https://x.com/me/status/2');
    expect(view.contentDOM.querySelector('.picture-source-field')).toBeNull();
  });

  it('offers no Posted… on a picture that is not a proof, nor where it cannot be kept', () => {
    editor('[[media:m1|Roof]]\n\nAfter', { handlers: { statePosted: vi.fn() } });
    expect(bar().querySelector('[data-posted]')).toBeNull();
    view.destroy();
    const proof = { id: 'm1', type: 'proof', label: 'Proof 28', attrs: { path: 'proofs/28.png' } };
    editor('[[media:m1|Proof 28]]\n\nAfter', { handlers: {}, entities: [proof] });
    expect(bar().querySelector('[data-posted]')).toBeNull();
  });
});

describe('lighting lines', () => {
  it('lights every line of a stretch', () => {
    editor('One\nTwo\nThree');
    lightLines(view, 0, 7);
    expect(view.contentDOM.querySelectorAll('.cm-landed').length).toBe(2);
  });
});
