// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorSelection, EditorState } from '@codemirror/state';
import { undo, undoDepth } from '@codemirror/commands';

/**
 * The Data line of an infographic drawn in the note, and a chart's: what the data is, said as
 * a chart's Data line says it, its rows and the panels that read it, and Change…; the panels
 * that read it follow it by themselves, one Undo step of exact bytes, and a view that cannot
 * write draws the fresh rows without writing.
 */

const server = vi.hoisted(() => ({ rows: null, asked: [] }));
vi.mock('../../api.js', async (original) => {
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
      postBytes: vi.fn(async () => ({ data: new TextEncoder().encode('<svg></svg>').buffer, headers: new Headers() })),
      get: vi.fn(async () => ({ colours: [] })),
    },
  };
});

const { focusedState, noteExtensions, setNoteCase } = await import('../liveMarkdown.js');
const { forgetDrawings } = await import('./chartFigure.js');
const { infographicsIn, panelText, readInfographic } = await import('./infographicText.js');
const { readChart, setting } = await import('./chartText.js');

const REGISTER = '| Model | Grade |\n| --- | --- |\n| Cougar | Confirmed |\n| M-ATV | Almost sure |';
const EDITED = `${REGISTER}\n| Kirpi | Confirmed |`;
const FIGURES = '::: chart\nkind: key figures\n| Figure | Words |\n| --- | --- |\n| 51 of 54 | placed |\n:::';
const LOST = `::: chart\nkind: bars\ntitle: Lost\ncount: rows\nby: Model\n${REGISTER}\n:::`;
const BLOCK = `:::: infographic\ndata: sheet:e_s1\ntitle: At least 2 vehicles lost\n\n${FIGURES}\n\n${LOST}\n::::`;
const NOTE = `# Losses\n\n${BLOCK}\n\nAfter.\n`;

let view;
let handlers;
beforeEach(() => {
  server.asked = [];
  server.rows = () => ({ found: true, name: 'Vehicle register', text: EDITED, rows: 3 });
  forgetDrawings();
});
afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

function editor(doc, { readOnly = false } = {}) {
  const parent = document.createElement('div');
  document.body.append(parent);
  handlers = { tableToast: vi.fn(), open: vi.fn(), inCase: true, noteKey: 'c1:n1', noteId: 'n1', infographic: vi.fn(), pickData: vi.fn() };
  view = new EditorView({ parent, state: EditorState.create({ doc, extensions: noteExtensions({ handlers, readOnly, mode: 'drawn' }) }) });
  view.setState(focusedState(view.state.update({ selection: EditorSelection.cursor(0) }).state));
  view.dispatch({ effects: setNoteCase.of({ caseId: 'c1', entities: [] }) });
  view.focus = vi.fn();
  return view;
}

const settle = async () => {
  for (let step = 0; step < 8; step += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const line = () => view.dom.querySelector('.cm-ig-data');
const act = () => line().querySelector('.cm-ig-data-act');
const change = () => line().querySelector('.cm-ig-data-change');
const text = () => view.state.doc.toString();
const graphic = () => infographicsIn(text())[0].source;
const FOLLOWED = NOTE.replace(`${LOST}`, LOST.replace(REGISTER, EDITED));

describe('the Data line of an infographic in the note', () => {
  it('says the sheet as a chart’s Data line does, its rows and the panels that read it', async () => {
    server.rows = () => ({ found: true, name: 'Vehicle register', text: REGISTER, rows: 2 });
    editor(NOTE);
    await settle();
    expect(line().textContent).toBe('DataSheet “Vehicle register”·Open in Sheet2 rows · 1 panel read itChange…');
    expect(server.asked.find((one) => one.path.endsWith('/rows')).body).toEqual({ origin: 'sheet:e_s1' });
    // the drawing leaves where the rows came from to this line
    expect(server.asked.find((one) => one.path.endsWith('/notes/infographic')).body.origins).toBe(false);
    act().click();
    expect(handlers.open).toHaveBeenCalledWith({ id: 'e_s1', type: 'sheet' });
    expect(text()).toBe(NOTE);
  });

  it('copies the sheet’s new rows into the panels that read it by itself, typed-in figures left alone, as one Undo', async () => {
    editor(NOTE);
    await settle();
    expect(text()).toBe(FOLLOWED);
    expect(readChart(panelText(graphic(), 1)).table.rows).toHaveLength(3);
    expect(panelText(graphic(), 0)).toBe(FIGURES);
    expect(undoDepth(view.state)).toBe(1);
    expect(line().textContent).not.toContain('Read again');
    // Undo brings the old copy back, and it stays, said as such
    undo(view);
    expect(text()).toBe(NOTE);
    await new Promise((resolve) => setTimeout(resolve, 340));
    await settle();
    expect(text()).toBe(NOTE);
    expect(line().querySelector('.cm-ig-data-state').textContent).toBe('an older copy, kept by Undo');
  });

  it('draws the fresh rows where the note cannot be written, and writes nothing', async () => {
    // a title of its own: the pages drawn are kept by their text
    const note = NOTE.replace('title: At least 2 vehicles lost', 'title: Seen, not written');
    editor(note, { readOnly: true });
    await settle();
    expect(text()).toBe(note);
    const drawn = server.asked.filter((one) => one.path.endsWith('/notes/infographic')).map((one) => one.body.text);
    expect(drawn.at(-1)).toContain('| Kirpi | Confirmed |');
  });

  it('says a sheet gone, the panels keeping their copy', async () => {
    server.rows = () => ({ found: false, name: '', text: '', rows: 0 });
    editor(NOTE);
    await settle();
    expect(line().querySelector('.cm-ig-data-name').textContent).toBe('A sheet no longer in the case');
    expect(line().querySelector('.cm-ig-data-state').textContent).toBe('the chart keeps its copy');
    expect(text()).toBe(NOTE);
  });

  it('Change… opens the source picker, and the one picked is the page’s data, its panels read in, as one Undo', async () => {
    const before = NOTE.replace('data: sheet:e_s1\n', '');
    editor(before);
    await settle();
    expect(line().querySelector('.cm-ig-data-name').textContent).toBe('Each panel’s own rows');
    expect(change().textContent).toBe('Choose data…');
    change().click();
    expect(handlers.pickData).toHaveBeenCalledTimes(1);
    const asked = handlers.pickData.mock.calls[0][0];
    expect(asked.current).toBe('');
    asked.onpick({ origin: 'sheet:e_s9', data: { found: true, text: EDITED } });
    expect(readInfographic(graphic()).settings.data.value).toBe('sheet:e_s9');
    expect(readChart(panelText(graphic(), 1)).table.rows).toHaveLength(3);
    expect(undoDepth(view.state)).toBe(1);
    undo(view);
    expect(text()).toBe(before);
  });
});

describe('a chart’s Data line', () => {
  const CHART = `::: chart\nkind: bars\ntitle: Lost\ncount: rows\nby: Model\nfrom: sheet:e_s1\n${REGISTER}\n:::`;

  it('says where the rows come from on top of its settings, and Change… writes the source picked and its rows as one Undo', async () => {
    server.rows = () => ({ found: true, name: 'Vehicle register', text: REGISTER, rows: 2 });
    const note = `# Losses\n\n${CHART}\n\nAfter.\n`;
    editor(note);
    await settle();
    const chart = view.dom.querySelector('.cm-chart-block');
    chart.querySelector('.cm-chart-settings').click();
    await settle();
    const data = chart.querySelector('.cm-chart-data');
    expect(data.textContent).toBe('DataSheet “Vehicle register”·Open in SheetChange…');
    data.querySelector('.cm-chart-data-change').click();
    const asked = handlers.pickData.mock.calls[0][0];
    expect(asked.current).toBe('sheet:e_s1');
    // rows from elsewhere may be kept as the chart's own
    expect(asked.own).toBe(true);
    asked.onpick({ origin: 'note:n1#register', data: { found: true, text: EDITED } });
    const written = readChart(text().slice(text().indexOf('::: chart')));
    expect(setting(written, 'from')).toBe('note:n1#register');
    expect(written.table.rows).toHaveLength(3);
    expect(undoDepth(view.state)).toBe(1);
    undo(view);
    expect(text()).toBe(note);
    asked.onpick({ own: true });
    expect(text()).toBe(note.replace('from: sheet:e_s1\n', ''));
  });
});
