// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorSelection, EditorState } from '@codemirror/state';
import { undo, undoDepth } from '@codemirror/commands';

/**
 * The Data line of an infographic drawn in the note, and a chart's source line: what the data
 * is, its rows and whether it changed since, Read again (all panels) and Change…, each written
 * as one Undo step of exact bytes.
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

function editor(doc) {
  const parent = document.createElement('div');
  document.body.append(parent);
  handlers = { tableToast: vi.fn(), open: vi.fn(), noteKey: 'c1:n1', noteId: 'n1', infographic: vi.fn(), pickData: vi.fn() };
  view = new EditorView({ parent, state: EditorState.create({ doc, extensions: noteExtensions({ handlers, readOnly: false, mode: 'drawn' }) }) });
  view.setState(focusedState(view.state.update({ selection: EditorSelection.cursor(0) }).state));
  view.dispatch({ effects: setNoteCase.of({ caseId: 'c1', entities: [] }) });
  view.focus = vi.fn();
  return view;
}

const settle = async () => {
  for (let step = 0; step < 8; step += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const press = (node) => node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
const line = () => view.dom.querySelector('.cm-ig-data');
const act = (name) => line().querySelector(`[data-ig-act="${name}"]`);
const text = () => view.state.doc.toString();
const graphic = () => infographicsIn(text())[0].source;

describe('the Data line of an infographic in the note', () => {
  it('says the sheet, its rows, the panels that read it and that it changed since', async () => {
    editor(NOTE);
    await settle();
    expect(line().textContent).toBe('DataSheet “Vehicle register”3 rows · 1 panel read it · changed sinceRead again (all panels)Change…');
    expect(server.asked.find((one) => one.path.endsWith('/rows')).body).toEqual({ origin: 'sheet:e_s1' });
    // the drawing leaves where the rows came from to this line
    expect(server.asked.find((one) => one.path.endsWith('/notes/infographic')).body.origins).toBe(false);
  });

  it('reads the data again into the panels that take it, typed-in figures left alone, as one Undo', async () => {
    editor(NOTE);
    await settle();
    press(act('again'));
    await settle();
    expect(server.asked.filter((one) => one.path.endsWith('/rows')).length).toBeGreaterThan(1);
    expect(readChart(panelText(graphic(), 1)).table.rows).toHaveLength(3);
    expect(panelText(graphic(), 0)).toBe(FIGURES);
    expect(undoDepth(view.state)).toBe(1);
    undo(view);
    expect(text()).toBe(NOTE);
  });

  it('says nothing to read again once the rows match, and a sheet gone in red', async () => {
    server.rows = () => ({ found: true, name: 'Vehicle register', text: REGISTER, rows: 2 });
    editor(NOTE);
    await settle();
    expect(act('again')).toBeNull();
    expect(line().querySelector('.cm-ig-data-said').textContent).toBe('2 rows · 1 panel read it');
    view.destroy();
    server.rows = () => ({ found: false, name: '', text: '', rows: 0 });
    forgetDrawings();
    editor(NOTE.replace('Losses', 'Gone'));
    await settle();
    expect(line().querySelector('.cm-ig-data-gone').textContent).toBe('A sheet no longer in the case');
  });

  it('Change… opens the source picker, and the one picked is the page’s data, its panels read in, as one Undo', async () => {
    const before = NOTE.replace('data: sheet:e_s1\n', '');
    editor(before);
    await settle();
    expect(line().querySelector('.cm-ig-data-name').textContent).toBe('None');
    expect(act('change').textContent).toBe('Choose data…');
    press(act('change'));
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

describe('a chart’s source line', () => {
  const CHART = `::: chart\nkind: bars\ntitle: Lost\ncount: rows\nby: Model\nfrom: sheet:e_s1\n${REGISTER}\n:::`;

  it('says where the rows come from on top of its settings, and Change… writes the source picked and its rows as one Undo', async () => {
    const note = `# Losses\n\n${CHART}\n\nAfter.\n`;
    editor(note);
    await settle();
    const chart = view.dom.querySelector('.cm-chart-block');
    chart.querySelector('.cm-chart-settings').click();
    await settle();
    const data = chart.querySelector('.cm-chart-data');
    expect(data.querySelector('.cm-chart-data-name').textContent).toBe('Sheet “Vehicle register”');
    expect(data.querySelector('.cm-chart-data-state').textContent).toBe('changed since');
    data.querySelector('.cm-chart-data-change').click();
    const asked = handlers.pickData.mock.calls[0][0];
    expect(asked.current).toBe('sheet:e_s1');
    asked.onpick({ origin: 'note:n1#register', data: { found: true, text: EDITED } });
    const written = readChart(text().slice(text().indexOf('::: chart')));
    expect(setting(written, 'from')).toBe('note:n1#register');
    expect(written.table.rows).toHaveLength(3);
    expect(undoDepth(view.state)).toBe(1);
    undo(view);
    expect(text()).toBe(note);
  });
});
