// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorSelection, EditorState } from '@codemirror/state';
import { undo } from '@codemirror/commands';

/**
 * A pictogram chart's icons set on its card in the drawn note: an icon of the library, the
 * app's badge, one per category, an SVG imported on the spot through the Settings › Icons
 * import, each one line of exact bytes and one Undo step.
 */

const COUGAR = 'aaaaaaaaaaaaaaaa';
const MATV = 'bbbbbbbbbbbbbbbb';
const IMPORTED = 'eeeeeeeeeeeeeeee';
const server = vi.hoisted(() => ({ icons: [], posted: [] }));
vi.mock('../../api.js', async (original) => {
  const real = await original();
  return {
    ...real,
    api: {
      ...real.api,
      postBytes: vi.fn(async () => server.figure()),
      get: vi.fn(async (path) => (path === '/api/icons' ? { icons: server.icons, max: 1000 } : {})),
      post: vi.fn(async (path, body) => {
        server.posted.push({ path, body });
        if (path !== '/api/icons') return {};
        server.icons = [...server.icons, { key: IMPORTED, name: 'Truck', group: 'My icons', mode: 'disc', vector: true }];
        return { added: [server.icons.at(-1)], already: 0, skipped: [], filed: [{ name: 'Truck', key: IMPORTED }] };
      }),
    },
  };
});
// the browser draws the SVG as a PNG: happy-dom has no canvas, so the drawing is stood in for
vi.mock('../../iconImport.js', async (original) => {
  const real = await original();
  return { ...real, importIcons: (files, options) => real.importIcons(files, { ...options, collect: (list) => real.collectIcons(list, { svg: async () => new Blob(['png']) }) }) };
});

const { focusedState, noteExtensions, setNoteCase } = await import('../liveMarkdown.js');
const { forgetDrawings } = await import('./chartFigure.js');
const { closeGlyphPicker } = await import('./chartIcons.js');

const CHART = [
  '::: chart', 'kind: pictograms', 'title: At least 17 armoured vehicles, by model', 'count: At least', 'by: Model',
  '| Model | At least |', '| --- | ---: |', '| Streit Cougar | 8 |', '| Oshkosh M-ATV | 7 |', '| Al-Wahsh | 2 |', ':::',
].join('\n');
const NOTE = `Count.\n\n${CHART}\n\nAfter.`;
const KIND = {
  name: 'pictograms', label: 'Pictograms', counts: true, parts: true, stacked: false, up: false, turns: '', style: 'report',
  keys: ['icon', 'icons', 'per glyph'], values: ['Streit Cougar', 'Oshkosh M-ATV', 'Al-Wahsh'],
};
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" class="az-chart" viewBox="0 0 640 300"><title>Chart</title></svg>';

let view;
beforeEach(() => {
  server.icons = [
    { key: COUGAR, name: 'Cougar', group: 'Vehicles', mode: 'disc' },
    { key: MATV, name: 'M-ATV', group: 'Vehicles', mode: 'disc' },
  ];
  server.posted = [];
  server.figure = () => ({
    data: new TextEncoder().encode(SVG).buffer,
    headers: new Headers({
      'X-Chart-Title': '"At least 17 armoured vehicles, by model"', 'X-Chart-Proposed-Title': '""', 'X-Chart-Kind': JSON.stringify(KIND),
      'X-Note-Warnings': '[]', 'X-Note-Warning-Lines': '[]', 'X-Note-Warning-Kinds': '[]', 'X-Note-Warning-Fixes': '[]',
    }),
  });
  forgetDrawings();
});
afterEach(() => {
  closeGlyphPicker();
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

function editor(doc) {
  const parent = document.createElement('div');
  document.body.append(parent);
  view = new EditorView({ parent, state: EditorState.create({ doc, extensions: noteExtensions({ handlers: { tableToast: vi.fn(), open: vi.fn(), noteKey: 'c1:n1', noteId: 'n1' }, mode: 'drawn' }) }) });
  view.setState(focusedState(view.state.update({ selection: EditorSelection.cursor(0) }).state));
  view.dispatch({ effects: setNoteCase.of({ caseId: 'c1', entities: [] }) });
  view.focus = vi.fn();
}

const text = () => view.state.doc.toString();
const settle = async () => {
  for (let step = 0; step < 6; step += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const press = (node) => {
  node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  node.click();
};
const card = () => view.dom.querySelector('.cm-chart-settings-panel');
const picker = () => document.querySelector('.cm-glyph-picker');

async function opened() {
  editor(NOTE);
  await settle();
  press(view.dom.querySelector('.cm-chart-settings'));
  await settle();
  return card();
}

describe('a pictogram chart’s icons', () => {
  it('writes an icon of the library as the chart’s icon line, one Undo step of exact bytes', async () => {
    await opened();
    const button = card().querySelector('.cm-chart-icons [data-key="Icon"]');
    expect(button.getAttribute('aria-label')).toBe('Icon: Dot');
    press(button);
    await settle();
    expect([...picker().querySelectorAll('.cm-glyph-section')].map((section) => section.getAttribute('aria-label')).slice(0, 3))
      .toEqual(['Vehicles', 'Vehicles', 'Forces']);
    press(picker().querySelector('[aria-label="Cougar"]'));
    expect(text()).toBe(NOTE.replace('by: Model\n', `by: Model\nicon: own:${COUGAR}\n`));
    undo(view);
    expect(text()).toBe(NOTE);
  });

  it('writes the app’s badge by its name', async () => {
    await opened();
    press(card().querySelector('.cm-chart-icons [data-key="Icon"]'));
    press(picker().querySelector('[aria-label="Armoured vehicle"]'));
    expect(text()).toBe(NOTE.replace('by: Model\n', 'by: Model\nicon: armoured vehicle\n'));
  });

  it('gives each model the icon named like it in one line, and one Undo takes it back', async () => {
    await opened();
    const each = [...card().querySelectorAll('.cm-chart-icons [aria-label="Icon"] button')].find((node) => node.textContent === 'One per category');
    press(each);
    expect(text()).toBe(NOTE.replace('by: Model\n', `by: Model\nicons: Streit Cougar = own:${COUGAR}, Oshkosh M-ATV = own:${MATV}, Al-Wahsh = dot\n`));
    await settle();
    expect(card().querySelector('.cm-chart-icons .cm-glyph-said').textContent)
      .toBe('Streit Cougar, Oshkosh M-ATV took the icon named like them; the others keep the chart’s icon.');
    undo(view);
    expect(text()).toBe(NOTE);
  });

  it('imports an SVG on the spot, sends it beside its picture, and wears it at once', async () => {
    await opened();
    press(card().querySelector('.cm-chart-icons [data-key="Icon"]'));
    const input = picker().querySelector('input[type="file"]');
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><path d="M2 4h36v12H2z"/></svg>'], 'Truck.svg', { type: 'image/svg+xml' });
    Object.defineProperty(input, 'files', { value: [svg], configurable: true });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(text()).toBe(NOTE.replace('by: Model\n', `by: Model\nicon: own:${IMPORTED}\n`)));
    const form = server.posted.find((one) => one.path === '/api/icons').body;
    expect(form.getAll('files')).toHaveLength(1);
    expect(form.getAll('vectors')[0]).toContain('viewBox="0 0 40 20"');
    undo(view);
    expect(text()).toBe(NOTE);
  });
});
