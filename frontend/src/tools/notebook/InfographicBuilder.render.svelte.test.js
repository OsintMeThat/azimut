// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { undo, undoDepth } from '@codemirror/commands';

/**
 * The infographic builder beside the note: its Data bar says the page's data as a chart's
 * Data line does, the panels that read it follow it by themselves, and each chart panel
 * says Page data or Own rows, one press apart, its rows typed in the grid a chart's
 * numbers are. Every gesture is one change of the note, one Undo.
 */

const server = vi.hoisted(() => ({ rows: null, asked: [] }));
vi.mock('../../lib/api.js', async (original) => {
  const real = await original();
  return {
    ...real,
    api: {
      ...real.api,
      post: vi.fn(async (path, body) => {
        server.asked.push({ path, body });
        if (path.endsWith('/notes/figure/rows')) return server.rows(body);
        if (path.endsWith('/notes/infographic')) return { svg: '<svg viewBox="0 0 10 10"></svg>', width: 10, height: 10, panels: [], legend: {}, warnings: [] };
        return { rows: 0, kinds: [] };
      }),
      postBytes: vi.fn(async () => ({
        data: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>').buffer,
        headers: new Headers({ 'X-Chart-Kind': JSON.stringify({ name: 'bars', label: 'Bars', counts: true, drawn: [0] }) }),
      })),
      get: vi.fn(async () => ({ colours: [], icons: [] })),
    },
  };
});

const { focusedState, noteExtensions, setNoteCase } = await import('../../lib/notes/liveMarkdown.js');
const { replaceBlock } = await import('../../lib/notes/editor/infographicBlock.js');
const { followSource, heldBack } = await import('../../lib/notes/editor/follow.js');
const { panelGrid } = await import('../../lib/notes/editor/panelRows.js');
const { forgetDrawings } = await import('../../lib/notes/editor/chartFigure.js');
const { default: InfographicBuilder } = await import('./InfographicBuilder.svelte');

const REGISTER = '| Model | Grade |\n| --- | --- |\n| Cougar | Confirmed |\n| M-ATV | Almost sure |';
const EDITED = `${REGISTER}\n| Kirpi | Confirmed |`;
const FIGURES = '::: chart\nkind: key figures\n| Figure | Words |\n| --- | --- |\n| 51 of 54 | placed |\n:::';
const LOST = `::: chart\nkind: bars\ntitle: Lost\ncount: rows\nby: Model\n${REGISTER}\n:::`;
const NOTE = `# Losses\n\n:::: infographic\ndata: sheet:e_s1\ntitle: At least 2 vehicles lost\n\n${FIGURES}\n\n${LOST}\n::::\n\nAfter.\n`;

let view;
let app;
let target;
/** The note's text as the editor holds it, which the builder reads. */
const props = $state({ text: '' });

beforeEach(() => {
  server.asked = [];
  server.rows = () => ({ found: true, name: 'Vehicle register', text: REGISTER, rows: 2 });
  forgetDrawings();
});
afterEach(() => {
  if (app) unmount(app);
  app = null;
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

/** The note in an editor, the builder beside it on its infographic, its text following the editor's. */
function open(doc = NOTE) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const handlers = { tableToast: vi.fn(), open: vi.fn(), inCase: true, noteKey: 'c1:n1', noteId: 'n1' };
  props.text = doc;
  const listen = EditorView.updateListener.of((update) => {
    if (update.docChanged) props.text = update.state.doc.toString();
  });
  view = new EditorView({ parent, state: EditorState.create({ doc, extensions: [noteExtensions({ handlers, readOnly: false, mode: 'markdown' }), listen] }) });
  view.setState(focusedState(view.state));
  view.dispatch({ effects: setNoteCase.of({ caseId: 'c1', entities: [] }) });
  const editor = {
    text: () => view.state.doc.toString(),
    replace: (from, to, insert, expected) => replaceBlock(view, from, to, insert, expected),
    panelGrid: (box, options) => panelGrid(view, box, options),
    follow: (origin, rows) => followSource(view, origin, rows),
    heldBack: (origin, rows) => heldBack(view, origin, rows),
    themeClasses: () => view.themeClasses,
    jump: vi.fn(),
  };
  target = document.createElement('div');
  document.body.append(target);
  app = mount(InfographicBuilder, {
    target,
    props: {
      caseId: 'c1', noteId: 'n1', editor, from: doc.indexOf(':::: infographic'),
      get text() {
        return props.text;
      },
    },
  });
  flushSync();
}

const settle = async () => {
  for (let step = 0; step < 10; step += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();
  }
};
const wait = async (ms) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await settle();
};
const text = () => view.state.doc.toString();
const row = (index) => target.querySelectorAll('.ib-panel-name')[index];

describe('the builder’s Data bar', () => {
  it('says the sheet as a chart’s Data line does, its rows and the panels that read it, no Read again', async () => {
    open();
    await wait(300);
    const bar = target.querySelector('.ib-data');
    expect(bar.querySelector('.ib-data-line').textContent.replace(/\s+/g, ' ').trim()).toBe('Sheet “Vehicle register” · Open in Sheet');
    expect(bar.querySelector('.ib-data-said').textContent).toBe('2 rows · 1 panel read it');
    expect(bar.textContent).not.toContain('Read again');
  });

  it('copies the sheet’s new rows into the panels that read it by itself, one Undo', async () => {
    server.rows = () => ({ found: true, name: 'Vehicle register', text: EDITED, rows: 3 });
    open();
    await wait(300);
    expect(text()).toBe(NOTE.replace(LOST, LOST.replace(REGISTER, EDITED)));
    expect(undoDepth(view.state)).toBe(1);
    undo(view);
    await wait(300);
    // what Undo brought back stays
    expect(text()).toBe(NOTE);
  });
});

describe('a chart panel’s rows', () => {
  it('say Page data or Own rows, one press apart, each one Undo', async () => {
    open();
    await wait(300);
    row(1).click();
    flushSync();
    const choice = () => [...target.querySelectorAll('.ib-seg-btn')].map((node) => `${node.textContent}:${node.getAttribute('aria-checked')}`);
    expect(choice()).toEqual(['Page data:true', 'Own rows:false']);
    expect(target.querySelector('.ib-panel-data').textContent.replace(/\s+/g, ' ').trim()).toBe('Data Sheet “Vehicle register” · Open in Sheet Change…');
    target.querySelectorAll('.ib-seg-btn')[1].click();
    await wait(300);
    expect(text()).toContain('by: Model\nrows: own\n');
    expect(choice()).toEqual(['Page data:false', 'Own rows:true']);
    expect(target.querySelector('.ib-panel-data').textContent.replace(/\s+/g, ' ').trim()).toBe('Data Its own rows · Edit Change…');
    target.querySelectorAll('.ib-seg-btn')[0].click();
    await wait(300);
    expect(text()).toBe(NOTE);
  });

  it('are typed in the grid a chart’s numbers are, a cell one change of the panel’s line, one Undo', async () => {
    open();
    await wait(300);
    row(0).click();
    flushSync();
    // the key figures are the panel's own: Edit opens its rows
    const edit = [...target.querySelectorAll('.ib-panel-data .ib-link')].find((node) => node.textContent === 'Edit');
    edit.click();
    await settle();
    const grid = target.querySelector('.ib-rows .cm-rows-grid');
    expect([...grid.querySelectorAll('thead .cm-grid-text')].map((node) => node.textContent)).toEqual(['Figure', 'Words']);
    const cell = grid.querySelector('.cm-grid-cell[data-row="0"][data-col="1"]');
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    const field = grid.querySelector('.cm-grid-input');
    field.value = 'placed on a map';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(text()).toBe(NOTE.replace('| 51 of 54 | placed |', '| 51 of 54 | placed on a map |'));
    expect(undoDepth(view.state)).toBe(1);
    undo(view);
    expect(text()).toBe(NOTE);
  });
});
