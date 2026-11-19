// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorSelection, EditorState } from '@codemirror/state';

vi.mock('../../api.js', async (original) => {
  const real = await original();
  return { ...real, api: { ...real.api, postBytes: vi.fn(async () => ({ data: new TextEncoder().encode('<svg></svg>').buffer, headers: new Headers() })) } };
});

const { focusedState, noteExtensions, setNoteCase } = await import('../liveMarkdown.js');
const { forgetHeights } = await import('./heights.js');
const { drawn } = await import('./decorations.js');

/**
 * A drawn block is estimated at the height it was last drawn at: the editor estimates a
 * block it does not draw, and a block made again off-screen (unpicked, a line beside it
 * changed) would otherwise stand in its height map at a guess, everything under it out of
 * place and the note jumping once the editor lets go of the keyboard. The browser's
 * measure is stood in for: each box's height is what the test says.
 * `e2e/notebook-grid.spec.js` checks it on a real page.
 */

const observed = new Set();
const watchers = [];
class FakeResizeObserver {
  constructor(callback) {
    this.callback = callback;
    this.boxes = new Set();
    watchers.push(this);
  }

  observe(box) {
    this.boxes.add(box);
    observed.add(box);
  }

  unobserve(box) {
    this.boxes.delete(box);
    observed.delete(box);
  }

  disconnect() {
    for (const box of this.boxes) observed.delete(box);
    this.boxes.clear();
  }

  /** The browser measured `box` at `height`: each watcher of that box hears it. */
  static measure(box, height) {
    for (const watcher of watchers) if (watcher.boxes.has(box)) watcher.callback([{ target: box, borderBoxSize: [{ blockSize: height }] }]);
  }
}

const ROWS = Array.from({ length: 40 }, (_, at) => `| ${at + 1} | A long cell that wraps onto several lines in the note |`).join('\n');
const TABLE = `| # | What |\n| --- | --- |\n${ROWS}`;
const NOTE = `Words.\n\n${TABLE}\n\nEnd.`;

let view;
beforeEach(() => {
  globalThis.ResizeObserver = FakeResizeObserver;
  forgetHeights();
  observed.clear();
});
afterEach(() => {
  view?.destroy();
  view = null;
  delete globalThis.ResizeObserver;
});

function editor(doc) {
  const parent = document.createElement('div');
  document.body.append(parent);
  view = new EditorView({ parent, state: EditorState.create({ doc, extensions: noteExtensions({ handlers: { noteId: 'n1' } }) }) });
  view.dispatch({ effects: setNoteCase.of({ caseId: 'c1', entities: [] }) });
  return view;
}

/** The table's widget as the page makes it now. */
function tableWidget() {
  let found = null;
  view.state.field(drawn).between(0, view.state.doc.length, (_from, _to, value) => {
    if (value.spec.widget?.blockKind === 'table') found = value.spec.widget;
  });
  return found;
}

describe('the height a drawn block was last drawn at', () => {
  it('is its estimate once made again, picked or not, and a guess only for a block never drawn', () => {
    editor(NOTE);
    const guess = tableWidget().estimatedHeight;
    const box = view.contentDOM.querySelector('.cm-grid-block');
    expect(observed.has(box)).toBe(true);
    FakeResizeObserver.measure(box, 1876);
    // the cursor goes to the table and the editor has the keyboard: it is made again, picked
    const at = NOTE.indexOf('| # |');
    view.setState(focusedState(view.state.update({ selection: EditorSelection.cursor(at) }).state));
    view.dispatch({ effects: setNoteCase.of({ caseId: 'c1', entities: [] }) });
    expect(tableWidget().picked).toBe(true);
    expect(tableWidget().estimatedHeight).toBe(1876);
    // a block none like it was drawn is still a guess
    forgetHeights();
    expect(tableWidget().estimatedHeight).toBe(guess);
    expect(guess).toBeLessThan(1876);
  });

  it('follows a box kept for a block that changed, until the box measures otherwise', () => {
    editor(NOTE);
    const box = view.contentDOM.querySelector('.cm-grid-block');
    FakeResizeObserver.measure(box, 1500);
    const at = NOTE.indexOf('| 40 |');
    view.dispatch({ changes: { from: at + 2, to: at + 4, insert: '41' } });
    // the grid is drawn again in place: the same box, kept for the table as it reads now
    expect(view.contentDOM.querySelector('.cm-grid-block')).toBe(box);
    expect(tableWidget().estimatedHeight).toBe(1500);
    FakeResizeObserver.measure(box, 1530);
    expect(tableWidget().estimatedHeight).toBe(1530);
  });

  it('lets a box go once it leaves the page', () => {
    editor(NOTE);
    const box = view.contentDOM.querySelector('.cm-grid-block');
    view.destroy();
    view = null;
    expect(observed.has(box)).toBe(false);
  });
});

describe('the lines the editor reads its line height from', () => {
  it('are never a short heading, code or table line: those wear a mark, the cursor’s own included', () => {
    editor('# Count\n\nWords.\n\n```\nx = 1\n```\n\n## A longer heading than twenty letters\n\nEnd.');
    const marked = () => [...view.contentDOM.querySelectorAll('.cm-unsampled')].map((node) => node.closest('.cm-line').textContent);
    expect(marked()).toEqual(expect.arrayContaining(['Count', '```', 'x = 1']));
    expect(marked()).not.toContain('Words.');
    expect(marked().some((text) => text.includes('longer heading'))).toBe(false);
    view.dispatch({ selection: { anchor: 2 } });
    expect(view.contentDOM.querySelector('.cm-h1 .cm-unsampled')).toBeTruthy();
  });
});
