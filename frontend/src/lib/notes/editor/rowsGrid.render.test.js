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
  // a press lands on the cell's words, which make way for its field
  mouse(cell(row, col).querySelector('.cm-grid-text') ?? cell(row, col));
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
    mouse(cell(1, 0).querySelector('.cm-grid-text'));
    // the chart around it leaves the press to the grid: the keyboard stays in the cell
    expect(view.focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field());
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

describe('what the chart reads in its rows', () => {
  const TIMELINE = { name: 'timeline', label: 'Timeline', counts: false, drawn: [0, 1] };
  const DAYS_TABLE = '| When | What happened |\n| --- | --- |\n| 5 mars 2026 | Fire |\n| 2026-03-07 | Smoke |\n| 8 Mar 2026 | Ash |\n| Mars rover | Dust |\n|  | Rain |';
  const reading = (row, col) => cell(row, col).querySelector('.cm-grid-reading')?.textContent ?? '';
  const words = (row, col) => cell(row, col).querySelector('.cm-grid-text');
  const tag = (col) => cell(-1, col).querySelector('.cm-grid-expects');

  it('says a column of days in its heading, and in each cell the day the chart draws', async () => {
    server.kind = TIMELINE;
    const note = `Words.\n\n${chartOf(['kind: timeline', DAYS_TABLE])}\n`;
    await opened(note);
    expect(tag(0).textContent).toBe('Days');
    expect(tag(0).title).toBe('The chart reads this column as days');
    expect(tag(1)).toBeNull();
    expect(reading(0, 0)).toBe('5 Mar 2026');
    expect(reading(1, 0)).toBe('7 Mar 2026');
    // written as the chart prints it: nothing more to say
    expect(reading(2, 0)).toBe('');
    // the cell keeps its words, the reading comes after them
    expect(words(0, 0).firstChild.textContent).toBe('5 mars 2026');
    expect(reading(0, 1)).toBe('');
    expect(text()).toBe(note);
  });

  it('underlines a cell it does not read, says what would, and shows an example in an empty one', async () => {
    server.kind = TIMELINE;
    await opened(`Words.\n\n${chartOf(['kind: timeline', DAYS_TABLE])}\n`);
    expect(words(3, 0).classList.contains('cm-grid-unread')).toBe(true);
    expect(words(3, 0).title).toBe('Not read as a day. Try 5 Mar 2026, 05/03/2026 or 2026-03-05, in any language.');
    expect(words(4, 0).dataset.placeholder).toBe('5 Mar 2026');
    expect(words(4, 0).textContent).toBe('');
    expect(words(4, 1).dataset.placeholder).toBeUndefined();
  });

  it('follows what is typed, and never rewrites it', async () => {
    server.kind = TIMELINE;
    const note = `Words.\n\n${chartOf(['kind: timeline', DAYS_TABLE])}\n`;
    await opened(note);
    typeIn(4, 0, '9 mars 2026');
    await settle();
    expect(text()).toBe(note.replace('|  | Rain |', '| 9 mars 2026 | Rain |'));
    expect(reading(4, 0)).toBe('9 Mar 2026');
    typeIn(0, 0, 'Mars rover');
    await settle();
    expect(words(0, 0).classList.contains('cm-grid-unread')).toBe(true);
  });

  it('says a column of numbers, and the number the chart draws where it is written otherwise', async () => {
    server.kind = { name: 'bars', label: 'Bars', counts: true, drawn: [0, 1] };
    const table = '| Model | Count |\n| --- | --- |\n| Cougar | 1 200 |\n| Kirpi | 60+ |\n| Otokar | about 12 |\n| Ural | lots |\n| Kamaz |  |';
    await opened(`Words.\n\n${chartOf(['kind: bars', 'by: Model', 'count: Count', table])}\n`);
    expect(tag(0)).toBeNull();
    expect(tag(1).textContent).toBe('Numbers');
    expect(reading(0, 1)).toBe('');
    expect(reading(1, 1)).toBe('at least 60');
    expect(reading(2, 1)).toBe('12');
    expect(words(3, 1).title).toBe('Not read as a number. Try 1200, 1 200, 1,5 or at least 60.');
    expect(words(4, 1).dataset.placeholder).toBe('1 200');
  });

  it('reads a comma as the decimal mark of a column that says so', async () => {
    server.kind = { name: 'bars', label: 'Bars', counts: true, drawn: [0, 1] };
    const table = '| Model | Count |\n| --- | --- |\n| Cougar | 1,5 |\n| Kirpi | 2,25 |\n| Otokar | 1,500 |';
    await opened(`Words.\n\n${chartOf(['kind: bars', 'by: Model', 'count: Count', table])}\n`);
    expect([0, 1, 2].map((row) => reading(row, 1))).toEqual(['1.5', '2.25', '1.5']);
  });

  it('says nothing of a column the chart does not draw', async () => {
    server.kind = { name: 'bars', label: 'Bars', counts: true, drawn: [0] };
    const table = '| Model | Count |\n| --- | --- |\n| Cougar | 60+ |\n| Kirpi | 12 |';
    await opened(`Words.\n\n${chartOf(['kind: bars', 'count: rows', 'by: Model', table])}\n`);
    expect(tag(1)).toBeNull();
    expect(reading(0, 1)).toBe('');
  });
});
