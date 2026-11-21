// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorSelection, EditorState } from '@codemirror/state';
import { undo, undoDepth } from '@codemirror/commands';

/**
 * The numbers of a chart are a grid to type in, the note tables' own: its own rows take
 * every gesture of a table, one change of the changed line, one Undo; a column the chart
 * does not draw stays, greyed and marked; rows from a table of this note or a sheet are
 * typed in where they live.
 */

const server = vi.hoisted(() => ({ kind: null, rows: null, sheet: null, saved: [], asked: [] }));
vi.mock('../../api.js', async (original) => {
  const real = await original();
  return {
    ...real,
    api: {
      ...real.api,
      postBytes: vi.fn(async (path, body) => {
        server.asked.push({ path, body });
        return {
          data: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>').buffer,
          headers: new Headers({ 'X-Chart-Title': '"Chart"', 'X-Chart-Kind': JSON.stringify(server.kind) }),
        };
      }),
      post: vi.fn(async (path, body) => {
        server.asked.push({ path, body });
        return path.endsWith('/rows') ? server.rows(body) : { rows: 0, kinds: [] };
      }),
      get: vi.fn(async (path) => {
        server.asked.push({ path });
        if (path.includes('/sheets/')) return structuredClone(server.sheet);
        return { colours: [] };
      }),
      put: vi.fn(async (path, body) => {
        server.saved.push({ path, body });
        server.sheet = { ...server.sheet, rows: body.rows, stamp: `${server.sheet.stamp}+` };
        return { status: 'saved' };
      }),
    },
  };
});

const { focusedState, noteExtensions, setNoteCase } = await import('../liveMarkdown.js');
const { forgetDrawings } = await import('./chartFigure.js');

const TABLE = '| Model | Grade | Seen in |\n| --- | --- | --- |\n| Cougar | Confirmed | S01 |\n| Kirpi | Almost sure | S02 |';
const chartOf = (lines) => ['::: chart', ...lines, ':::'].join('\n');
const OWN = chartOf(['kind: bars', 'count: rows', 'by: Model', TABLE]);
const BARS = { name: 'bars', label: 'Bars', counts: true, drawn: [0] };

let view;
let handlers;
beforeEach(() => {
  server.asked = [];
  server.saved = [];
  server.kind = BARS;
  server.rows = () => ({ found: false });
  forgetDrawings();
});
afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

function editor(doc, entities = []) {
  const parent = document.createElement('div');
  document.body.append(parent);
  handlers = { tableToast: vi.fn(), open: vi.fn(), inCase: true, noteKey: 'c1:n1', noteId: 'n1' };
  view = new EditorView({ parent, state: EditorState.create({ doc, extensions: noteExtensions({ handlers, readOnly: false, mode: 'drawn' }) }) });
  view.setState(focusedState(view.state.update({ selection: EditorSelection.cursor(0) }).state));
  view.dispatch({ effects: setNoteCase.of({ caseId: 'c1', entities }) });
  view.focus = vi.fn();
  return view;
}

const settle = async () => {
  for (let step = 0; step < 8; step += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const text = () => view.state.doc.toString();
const mouse = (node) => node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
const press = (node) => {
  mouse(node);
  node.click();
};
const numbers = () => view.dom.querySelector('.cm-chart-numbers');
const cell = (row, col) => numbers().querySelector(`.cm-grid-cell[data-row="${row}"][data-col="${col}"]`);
const field = () => numbers().querySelector('.cm-grid-input');
function typeIn(row, col, words) {
  mouse(cell(row, col));
  field().value = words;
  field().dispatchEvent(new Event('input', { bubbles: true }));
  field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
}
async function opened(doc, entities) {
  editor(doc, entities);
  await settle();
  press(view.dom.querySelector('.cm-chart-numbers-btn'));
  await settle();
}

describe('its own rows', () => {
  it('are typed in: a cell is one change of its line, one Undo', async () => {
    const note = `Words.\n\n${OWN}\n`;
    await opened(note);
    expect(numbers().querySelector('.cm-chart-numbers-data').textContent).toBe('DataIts own rows');
    expect([...numbers().querySelectorAll('.cm-rows-bar button')].map((node) => node.textContent)).toEqual(['Row', 'Column', 'Paste from a spreadsheet']);
    typeIn(1, 0, 'Kirpi II');
    expect(text()).toBe(note.replace('| Kirpi | Almost sure | S02 |', '| Kirpi II | Almost sure | S02 |'));
    expect(undoDepth(view.state)).toBe(1);
    // the next cell has the keyboard, and the grid drew the new words
    expect(field().getAttribute('aria-label')).toBe('Grade, row 2');
    expect(cell(1, 0).textContent).toBe('Kirpi II');
    undo(view);
    expect(text()).toBe(note);
  });

  it('keep a column the chart does not draw, greyed and marked, never refused', async () => {
    await opened(`Words.\n\n${OWN}\n`);
    const heads = [...numbers().querySelectorAll('thead .cm-grid-head')];
    expect(heads.map((head) => head.querySelector('.cm-grid-idle-mark')?.textContent ?? '')).toEqual(['', 'not drawn', 'not drawn']);
    expect(cell(0, 2).classList.contains('cm-grid-idle')).toBe(true);
    expect(cell(0, 0).classList.contains('cm-grid-idle')).toBe(false);
    // still typed in as any other
    typeIn(0, 2, 'S03');
    expect(text()).toContain('| Cougar | Confirmed | S03 |');
  });

  it('of a picture wall with a column it does not read: As a form and Fill from the case stay one press away', async () => {
    server.kind = { name: 'pictures', label: 'Picture wall', counts: true, per_row: true, drawn: [0, 1, 2] };
    const wall = chartOf(['kind: pictures', '| Picture | # | Model | State |', '| --- | --- | --- | --- |', '| [[media:e_0000000001|v1.jpg]] | #1 | Kirpi | destroyed |']);
    const picture = { id: 'e_0000000001', type: 'media', label: 'v1.jpg', attrs: { path: 'media/crops/v1.jpg', folder: 'crops', kind: 'image' } };
    await opened(`Words.\n\n${wall}\n`, [picture]);
    expect(numbers().querySelector('thead .cm-grid-head[data-col="3"] .cm-grid-idle-mark').textContent).toBe('not drawn');
    expect([...numbers().querySelectorAll('.cm-rows-bar button')].map((node) => node.textContent))
      .toEqual(['Row', 'Column', 'Paste from a spreadsheet', 'As a form', 'Fill from the case…']);
    press(numbers().querySelector('.cm-rows-fill'));
    const form = view.dom.querySelector('.cm-chart-form-panel');
    expect(form.hidden).toBe(false);
    expect(form.querySelector('.cf-fill').hidden).toBe(false);
  });
});

describe('rows that live elsewhere', () => {
  const REGISTER = '| Model | Grade |\n| --- | --- |\n| Cougar | Confirmed |\n| Kirpi | Almost sure |';

  it('from a table of this note: a cell is written in the table and the copy, one change, one Undo', async () => {
    const note = `## Register\n\n${REGISTER}\n\n${chartOf(['kind: bars', 'count: rows', 'by: Model', 'from: note:n1#register', REGISTER])}\n`;
    await opened(note);
    expect(numbers().querySelector('.cm-chart-numbers-data').textContent).toBe('DataTable “Register” of this note·Go to the table');
    // its rows are the table's: no row or column is added here
    expect(numbers().querySelector('.cm-rows-bar')).toBeNull();
    typeIn(1, 1, 'Confirmed');
    expect(text()).toBe(note.replaceAll('| Kirpi | Almost sure |', '| Kirpi | Confirmed |'));
    expect(undoDepth(view.state)).toBe(1);
    undo(view);
    expect(text()).toBe(note);
  });

  it('from a sheet: a cell is written in the sheet with its stamp, then the copy follows', async () => {
    const note = `Words.\n\n${chartOf(['kind: bars', 'count: rows', 'by: Model', 'from: sheet:e_s1', REGISTER])}\n`;
    server.sheet = { columns: ['id', 'Model', 'Grade'], rows: [['r1', 'Cougar', 'Confirmed'], ['r2', 'Kirpi', 'Almost sure']], meta: {}, stamp: 's-1' };
    server.rows = () => ({ found: true, name: 'Register', text: `| Model | Grade |\n| --- | --- |\n${server.sheet.rows.map((row) => `| ${row[1]} | ${row[2]} |`).join('\n')}` });
    await opened(note);
    expect(numbers().querySelector('.cm-chart-numbers-data').textContent).toBe('DataSheet “Register”·Open in Sheet');
    typeIn(1, 1, 'Confirmed');
    // drawn as typed while it is written there
    expect(cell(1, 1).textContent).toBe('Confirmed');
    await settle();
    expect(server.saved).toEqual([{ path: '/api/cases/c1/sheets/e_s1', body: {
      columns: ['id', 'Model', 'Grade'], rows: [['r1', 'Cougar', 'Confirmed'], ['r2', 'Kirpi', 'Confirmed']], meta: {}, stamp: 's-1',
    } }]);
    expect(text()).toBe(note.replace('| Kirpi | Almost sure |', '| Kirpi | Confirmed |'));
  });

  it('from a sheet: a cell the sheet keeps itself is drawn back and opens the sheet instead', async () => {
    const note = `Words.\n\n${chartOf(['kind: bars', 'count: rows', 'by: Model', 'from: sheet:e_s1', REGISTER])}\n`;
    server.sheet = { columns: ['id', 'Model', 'Grade'], rows: [['r1', 'Cougar', 'Confirmed'], ['r2', 'Kirpi', 'Almost sure']], meta: { links: { r2: { Model: 'e_9' } } }, stamp: 's-1' };
    server.rows = () => ({ found: true, name: 'Register', text: REGISTER });
    await opened(note);
    typeIn(1, 0, 'Kirpi II');
    await settle();
    expect(server.saved).toEqual([]);
    expect(cell(1, 0).textContent).toBe('Kirpi');
    expect(text()).toBe(note);
    const [words, actions, kind] = handlers.tableToast.mock.calls.at(-1);
    expect([words, kind]).toEqual(['That cell points at a record of the case: edit it in the sheet', 'warn']);
    actions[0].onClick();
    expect(handlers.open).toHaveBeenCalledWith({ id: 'e_s1', type: 'sheet' });
  });
});
