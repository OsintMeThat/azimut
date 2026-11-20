// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorSelection, EditorState } from '@codemirror/state';
import { undo } from '@codemirror/commands';

/**
 * A chart from scratch in the drawn note: `/` › Chart shows every kind with no table, the
 * one picked is written with its columns and its form opens on it; each field committed, row
 * added, moved, taken out, colour and fill is one Undo step of exact bytes; Settings › Edit
 * the data opens the form again; Fill from the case lists what it would take first.
 */

const server = vi.hoisted(() => ({ asked: [], events: null, sources: null, rows: null, counts: null, palette: [] }));
vi.mock('../../api.js', async (original) => {
  const real = await original();
  return {
    ...real,
    api: {
      ...real.api,
      postBytes: vi.fn(async (path, body) => {
        server.asked.push({ path, body });
        return figure(body);
      }),
      post: vi.fn(async (path, body) => {
        server.asked.push({ path, body });
        if (path.endsWith('/rows')) return server.rows(body);
        if (path.endsWith('/counts')) return server.counts(body);
        return { rows: 0, kinds: [] };
      }),
      get: vi.fn(async (path) => {
        server.asked.push({ path });
        if (path.endsWith('/layer-palette')) return { colours: server.palette, icons: [] };
        if (path.includes('/figure/events')) return server.events(path);
        return server.sources(path);
      }),
    },
  };
});

const { focusedState, noteExtensions, setNoteCase, startChart } = await import('../liveMarkdown.js');
const { forgetDrawings } = await import('./chartFigure.js');
const { layerPalette } = await import('../../map/layerPalette.svelte.js');

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" class="az-chart az-chart-report" viewBox="0 0 640 300"><title>Chart</title></svg>';
let drawnKind = { name: 'timeline', label: 'Timeline', counts: false };
let drawnColours = [];
function figure() {
  return {
    data: new TextEncoder().encode(SVG).buffer,
    headers: new Headers({
      'X-Chart-Title': '""', 'X-Chart-Proposed-Title': JSON.stringify(drawnKind.counts ? 'At least 40 vehicles, by class' : ''),
      'X-Chart-Kind': JSON.stringify(drawnKind), 'X-Note-Warnings': '[]', 'X-Note-Warning-Lines': '[]', 'X-Note-Warning-Kinds': '[]',
      'X-Note-Warning-Fixes': '[]', 'X-Chart-Colours': JSON.stringify(drawnColours),
    }),
  };
}

let view;
beforeEach(() => {
  server.asked = [];
  server.events = () => ({ items: [], total: 0, undated: 0, first: null, last: null });
  server.sources = () => ({ tables: [], sheets: [] });
  server.rows = () => ({ found: false, name: '', text: '' });
  server.counts = () => ({ rows: [] });
  server.palette = [{ name: 'Tank', colour: '#d55e00' }];
  drawnKind = { name: 'timeline', label: 'Timeline', counts: false };
  drawnColours = [];
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
  const handlers = { tableToast: vi.fn(), open: vi.fn(), noteKey: 'c1:n1', noteId: 'n1' };
  view = new EditorView({ parent, state: EditorState.create({ doc, extensions: noteExtensions({ handlers, readOnly: false, mode: 'drawn' }) }) });
  view.setState(focusedState(view.state.update({ selection: EditorSelection.cursor(doc.length) }).state));
  view.dispatch({ effects: setNoteCase.of({ caseId: 'c1', entities }) });
  view.focus = vi.fn();
  return view;
}

const text = () => view.state.doc.toString();
const settle = async () => {
  for (let step = 0; step < 5; step += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const press = (node) => {
  node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  node.click();
};
const form = () => view.dom.querySelector('.cm-chart-form-panel');
const row = (index) => form().querySelector(`.cf-row[data-row="${index}"]`);
const field = (index, name) => row(index).querySelector(`[data-field="${name}"]`);
/** Type into a field and leave it, as Tab does. */
function fill(node, value) {
  node.focus();
  node.value = value;
  node.dispatchEvent(new Event('change', { bubbles: true }));
  node.dispatchEvent(new Event('blur'));
}
const add = (id) => press(form().querySelector(`.cf-add[data-add="${id}"]`));
const chartOf = (lines) => ['::: chart', ...lines, ':::'].join('\n');

async function fromScratch(kind, doc = 'Words.\n', entities = []) {
  editor(doc, entities);
  startChart(view);
  await settle();
  press(view.dom.querySelector(`.cm-chart-picker button.cf-scratch[data-kind="${kind}"]`));
  await settle();
}

describe('a timeline from scratch', () => {
  it('is written with its columns, its form open on it, then filled field by field, each one Undo', async () => {
    await fromScratch('timeline');
    const STARTER = chartOf(['kind: timeline', '| When | What happened |', '| --- | --- |']);
    expect(text()).toBe(`Words.\n\n${STARTER}\n`);
    expect(form().hidden).toBe(false);
    // nothing drawn of nothing: the chart says what to do, and the server is not asked
    expect(view.dom.querySelector('.cm-chart-empty').textContent).toBe('Add an event or a period: the timeline is drawn as you fill it.');
    expect(server.asked.filter((one) => one.path.endsWith('/figure'))).toEqual([]);
    // the keyboard is in the first event's day, a row not yet in the note
    expect(document.activeElement).toBe(field(0, 'when'));
    expect(row(0).classList.contains('cf-draft')).toBe(true);

    fill(field(0, 'when'), '2026-10-18');
    const ONE = chartOf(['kind: timeline', '| When | What happened |', '| --- | --- |', '| 18 Oct 2026 | |']);
    expect(text()).toBe(`Words.\n\n${ONE}\n`);
    expect(row(0).classList.contains('cf-draft')).toBe(false);
    fill(field(0, 'what'), 'Giants Brigades on a peak');
    const NAMED = ONE.replace('| 18 Oct 2026 | |', '| 18 Oct 2026 | Giants Brigades on a peak |');
    expect(text()).toBe(`Words.\n\n${NAMED}\n`);
    await settle();
    expect(server.asked.filter((one) => one.path.endsWith('/figure')).at(-1).body.text).toBe(NAMED);

    // a month: the precision first, then the month and its year
    add('event');
    const precision = row(1).querySelector('.cf-precision');
    precision.value = 'month';
    precision.dispatchEvent(new Event('change', { bubbles: true }));
    expect(text()).toBe(`Words.\n\n${NAMED}\n`);
    const month = field(1, 'when');
    month.value = '10';
    month.dispatchEvent(new Event('change', { bubbles: true }));
    expect(text()).toBe(`Words.\n\n${NAMED}\n`);
    fill(field(1, 'when-year'), '2026');
    fill(field(1, 'what'), 'The front moves north');
    // a period: from, until, words
    add('period');
    expect(row(2).querySelector('.cf-tag').textContent).toBe('Period');
    fill(field(2, 'when'), '2026-11-10');
    fill(field(2, 'until'), '2026-11-14');
    fill(field(2, 'what'), 'Presence northeast of Huwayrib');
    const FILLED = chartOf(['kind: timeline', '| When | What happened | Until |', '| --- | --- | --- |', '| 18 Oct 2026 | Giants Brigades on a peak | |',
      '| Oct 2026 | The front moves north | |', '| 10 Nov 2026 | Presence northeast of Huwayrib | 14 Nov 2026 |']);
    expect(text()).toBe(`Words.\n\n${FILLED}\n`);

    // each committed field was one step
    undo(view);
    expect(text()).toContain('| 10 Nov 2026 | | 14 Nov 2026 |');
    // with no second day left, no row is a period: the column goes
    undo(view);
    expect(text()).toContain('| Oct 2026 | The front moves north |\n| 10 Nov 2026 | |\n:::');
    undo(view);
    undo(view);
    expect(text()).toContain('| Oct 2026 | |\n:::');
    await settle();
    // the form reads the block again: the period went with its row
    expect(form().querySelectorAll('.cf-row:not(.cf-heading)')).toHaveLength(2);
  });

  it('colours an event by its kind, lays it out and shortens its labels, each one Undo', async () => {
    drawnKind = { name: 'timeline', label: 'Timeline', counts: false, layout: 'across' };
    const BLOCK = chartOf(['kind: timeline', '| When | What happened |', '| --- | --- |', '| 9 Oct 2026 | The strait announced cleared |',
      '| 19 Oct 2026 | Footage on the north edge |']);
    editor(`Words.\n\n${BLOCK}\n`);
    await settle();
    view.dom.querySelector('.cm-chart-block').chart.toggleForm(true);
    await settle();
    // a kind a row, offered from a few before any is written
    const kind = field(0, 'colour');
    const offered = () => [...document.getElementById(field(0, 'colour').getAttribute('list')).querySelectorAll('option')].map((one) => one.value);
    expect(offered()).toEqual(['Claim', 'Geolocated', 'Press']);
    expect(form().querySelector('.cf-heading').textContent).toContain('Kind');
    fill(kind, 'Claim');
    const KINDED = chartOf(['kind: timeline', 'colour by: Kind', '| When | What happened | Kind |', '| --- | --- | --- |',
      '| 9 Oct 2026 | The strait announced cleared | Claim |', '| 19 Oct 2026 | Footage on the north edge | |']);
    expect(text()).toBe(`Words.\n\n${KINDED}\n`);
    expect(offered()).toEqual(['Claim']);
    // its layout, Auto saying what it drew
    await settle();
    const layout = () => form().querySelector('[aria-label="Layout"]');
    expect([...layout().querySelectorAll('button')].map((one) => [one.textContent, one.getAttribute('aria-checked')]))
      .toEqual([['Auto', 'true'], ['Across', 'false'], ['Numbered', 'false'], ['List', 'false']]);
    expect(form().querySelector('.cf-layout-said').textContent).toBe('Drawn across here');
    press(layout().querySelectorAll('button')[2]);
    const NUMBERED = KINDED.replace('colour by: Kind\n', 'colour by: Kind\nlayout: numbered\n');
    expect(text()).toBe(`Words.\n\n${NUMBERED}\n`);
    expect(layout().querySelectorAll('button')[2].getAttribute('aria-checked')).toBe('true');
    // short labels
    const short = form().querySelector('[data-extra="short"]');
    expect(short.closest('label').title).toBe('Each event’s day and first words; the page shows the rest on hover, the PDF and pictures print them whole');
    short.checked = true;
    short.dispatchEvent(new Event('change', { bubbles: true }));
    expect(text()).toBe(`Words.\n\n${NUMBERED.replace('layout: numbered\n', 'layout: numbered\nlabels: short\n')}\n`);
    undo(view);
    expect(text()).toBe(`Words.\n\n${NUMBERED}\n`);
    undo(view);
    expect(text()).toBe(`Words.\n\n${KINDED}\n`);
    undo(view);
    expect(text()).toBe(`Words.\n\n${BLOCK}\n`);
  });

  it('writes a day moved with the calendar’s arrows once it rests, as one step', async () => {
    const BLOCK = chartOf(['kind: timeline', '| When | What happened |', '| --- | --- |', '| 18 Oct 2026 | First |']);
    editor(`Words.\n\n${BLOCK}\n`);
    await settle();
    view.dom.querySelector('.cm-chart-block').chart.toggleForm(true);
    const day = field(0, 'when');
    day.focus();
    for (const value of ['2026-10-19', '2026-10-20', '2026-10-21']) {
      day.value = value;
      day.dispatchEvent(new Event('change', { bubbles: true }));
    }
    expect(text()).toBe(`Words.\n\n${BLOCK}\n`);
    await new Promise((resolve) => setTimeout(resolve, 760));
    expect(text()).toBe(`Words.\n\n${BLOCK.replace('18 Oct', '21 Oct')}\n`);
    undo(view);
    expect(text()).toBe(`Words.\n\n${BLOCK}\n`);
  });

  it('moves a row with Alt+↓ and takes one out, each one Undo', async () => {
    const BLOCK = chartOf(['kind: timeline', '| When | What happened |', '| --- | --- |', '| 18 Oct 2026 | First |', '| 20 Oct 2026 | Second |', '| 22 Oct 2026 | Third |']);
    editor(`Words.\n\n${BLOCK}\n`);
    await settle();
    view.dom.querySelector('.cm-chart-block').chart.toggleForm(true);
    expect(form().querySelectorAll('.cf-body .cf-row')).toHaveLength(3);
    field(0, 'what').focus();
    field(0, 'what').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
    expect(text()).toBe(`Words.\n\n${BLOCK.replace('| 18 Oct 2026 | First |\n| 20 Oct 2026 | Second |', '| 20 Oct 2026 | Second |\n| 18 Oct 2026 | First |')}\n`);
    expect(document.activeElement).toBe(field(1, 'what'));
    undo(view);
    expect(text()).toBe(`Words.\n\n${BLOCK}\n`);
    press(row(2).querySelector('.cf-remove'));
    expect(text()).toBe(`Words.\n\n${BLOCK.replace('\n| 22 Oct 2026 | Third |', '')}\n`);
    undo(view);
    expect(text()).toBe(`Words.\n\n${BLOCK}\n`);
  });

  it('fills from the case’s events, listing them first, adding the ticked ones as one step', async () => {
    server.events = (path) => (path.includes('from=') ? { items: [], total: 0, undated: 0, first: '2026-10-18', last: '2026-11-14' } : {
      items: [
        { id: 'p1', type: 'proof', day: '2026-10-18', last: '', precision: 'day', approximate: true, what: 'Giants Brigades on a peak', refuted: false },
        { id: 'c1', type: 'claim', day: '2026-11-01', last: '', precision: 'month', approximate: false, what: 'A strike on the port', refuted: true },
        { id: 'p2', type: 'proof', day: '2026-11-10', last: '2026-11-14', precision: 'day', approximate: false, what: 'Presence near Huwayrib', refuted: false },
      ],
      total: 3, undated: 1, first: '2026-10-18', last: '2026-11-14',
    });
    await fromScratch('timeline');
    const before = text();
    press(form().querySelector('.cf-fill-open'));
    await settle();
    const fillBox = form().querySelector('.cf-fill');
    expect(server.asked.find((one) => one.path.includes('/figure/events')).path).toBe('/api/cases/c1/notes/figure/events');
    expect(fillBox.querySelector('[aria-label="From"]').value).toBe('2026-10-18');
    expect(fillBox.querySelector('[aria-label="Until"]').value).toBe('2026-11-14');
    expect(fillBox.querySelector('.cf-fill-status').textContent).toBe('3 in this period, 1 with no day left out.');
    const lines = [...fillBox.querySelectorAll('.cf-fill-line')];
    expect(lines.map((line) => line.querySelector('.cf-fill-day').textContent)).toEqual(['18 Oct 2026', 'Nov 2026', '10 Nov 2026 – 14 Nov 2026']);
    expect(lines.map((line) => line.querySelector('input').checked)).toEqual([true, false, true]);
    expect(lines[1].querySelector('.cf-fill-said').textContent).toBe('refuted');
    // nothing written while it is listed
    expect(text()).toBe(before);
    const go = fillBox.querySelector('.cf-go');
    expect(go.textContent).toBe('Add 2 events');
    press(go);
    const FILLED = chartOf(['kind: timeline', '| When | What happened | Until |', '| --- | --- | --- |', '| 18 Oct 2026 | Giants Brigades on a peak | |',
      '| 10 Nov 2026 | Presence near Huwayrib | 14 Nov 2026 |']);
    expect(text()).toBe(`Words.\n\n${FILLED}\n`);
    expect(form().querySelector('.cf-fill').hidden).toBe(true);
    undo(view);
    expect(text()).toBe(before);
  });
});

describe('key figures from scratch', () => {
  it('writes the figure as written, at least when ticked, Enter going on to the next figure', async () => {
    drawnKind = { name: 'key figures', label: 'Key figures', counts: false };
    await fromScratch('key figures');
    fill(field(0, 'figure'), '60');
    const tick = field(0, 'floor');
    tick.checked = true;
    tick.dispatchEvent(new Event('change', { bubbles: true }));
    fill(field(0, 'words'), 'vehicles seen in the two videos');
    field(0, 'words').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(field(1, 'figure'));
    // a floor typed in the figure ticks it
    fill(field(1, 'figure'), '12+');
    fill(field(1, 'words'), 'models told apart');
    expect(text()).toBe(`Words.\n\n${chartOf(['kind: key figures', '| Figure | What it says |', '| --- | --- |', '| at least 60 | vehicles seen in the two videos |',
      '| at least 12 | models told apart |'])}\n`);
    expect(field(1, 'floor').checked).toBe(true);
  });
});

describe('a donut from scratch', () => {
  it('writes categories and counts, a colour from the case’s palette, the floors in the counts’ heading', async () => {
    drawnKind = { name: 'donut', label: 'Donut', counts: true, parts: true };
    layerPalette.load('c1', true);
    await fromScratch('donut');
    expect(form().querySelector('.cf-needs').textContent).toBe('Categories and their counts');
    fill(field(0, 'category'), 'MRAP');
    fill(field(0, 'count'), '23');
    add('category');
    fill(field(1, 'category'), 'Tank');
    fill(field(1, 'count'), '4');
    const head = form().querySelector('[data-head="count"]');
    fill(head, 'Vehicles');
    const floor = form().querySelector('[data-extra="floor"]');
    floor.checked = true;
    floor.dispatchEvent(new Event('change', { bubbles: true }));
    const BLOCK = chartOf(['kind: donut', 'count: Vehicles (at least)', 'by: Category', '| Category | Vehicles (at least) |', '| --- | ---: |', '| MRAP | 23 |', '| Tank | 4 |']);
    expect(text()).toBe(`Words.\n\n${BLOCK}\n`);
    await settle();
    // the title the data proposes, at least included, one press away
    expect(form().querySelector('.cm-chart-proposed em').textContent).toBe('At least 40 vehicles, by class');

    press(field(1, 'colour'));
    const swatches = document.body.querySelector('.cf-swatches');
    expect([...swatches.querySelectorAll('.cf-swatches-head')].map((node) => node.textContent)).toEqual(['The case’s colours', 'The chart’s']);
    press(swatches.querySelector('.cf-chip[aria-label="Tank, #d55e00"]'));
    const COLOURED = BLOCK.replace('by: Category\n', 'by: Category\ncolours: Tank #d55e00\n');
    expect(text()).toBe(`Words.\n\n${COLOURED}\n`);
    // a category renamed keeps its colour
    fill(field(1, 'category'), 'Main battle tank');
    expect(text()).toBe(`Words.\n\n${COLOURED.replace('colours: Tank', 'colours: Main battle tank').replace('| Tank |', '| Main battle tank |')}\n`);
    undo(view);
    undo(view);
    expect(text()).toBe(`Words.\n\n${BLOCK}\n`);
  });

  it('fills its counts from a table of the case, the counts listed before they are written', async () => {
    drawnKind = { name: 'donut', label: 'Donut', counts: true, parts: true };
    server.sources = () => ({ tables: [{ origin: 'note:n2#register', note: 'Vehicles', heading: 'Register', rows: 4, columns: ['Model', 'Class'] }], sheets: [] });
    server.rows = () => ({ found: true, name: 'Vehicles', text: '| Model | Class |\n| --- | --- |\n| Cougar | MRAP |\n| M-ATV | MRAP |\n| BMP | APC |\n| Hilux |  |' });
    server.counts = (body) => ({ found: true, name: 'Vehicles', rows: [{ value: 'MRAP', split: '', count: '2' }, { value: 'APC', split: '', count: '1' }], floor: false, blank: 1, unread: 0, totals: 0, asked: body });
    await fromScratch('donut');
    press(form().querySelector('.cf-fill-open'));
    await settle();
    const fillBox = form().querySelector('.cf-fill');
    const origin = fillBox.querySelector('select[aria-label="Rows from"]');
    origin.value = 'note:n2#register';
    origin.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(fillBox.querySelector('select[aria-label="Count by"]').value).toBe('Model');
    const by = fillBox.querySelector('select[aria-label="Count by"]');
    by.value = 'Class';
    by.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(server.asked.filter((one) => one.path.endsWith('/counts')).at(-1).body).toEqual({ origin: 'note:n2#register', by: 'Class', split: '', amount: '', days: false });
    expect([...fillBox.querySelectorAll('.cf-fill-table td')].map((cell) => cell.textContent)).toEqual(['MRAP', '2', 'APC', '1']);
    expect(fillBox.querySelector('.cf-fill-status').textContent).toBe('2 rows from 4. Left out: 1 with no value.');
    const before = text();
    press(fillBox.querySelector('.cf-go'));
    expect(text()).toBe(`Words.\n\n${chartOf(['kind: donut', 'count: Count', 'by: Category', '| Category | Count |', '| --- | ---: |', '| MRAP | 2 |', '| APC | 1 |'])}\n`);
    undo(view);
    expect(text()).toBe(before);
  });
});

describe('Edit the data', () => {
  it('opens the form from the chart’s settings and from The numbers, not for rows counted one a line', async () => {
    drawnKind = { name: 'donut', label: 'Donut', counts: true, parts: true };
    const BLOCK = chartOf(['kind: donut', 'count: Count', 'by: Category', '| Category | Count |', '| --- | ---: |', '| MRAP | 23 |', '| APC | 9 |']);
    editor(`Words.\n\n${BLOCK}\n`);
    await settle();
    const box = view.dom.querySelector('.cm-chart-block');
    press(box.querySelector('.cm-chart-settings'));
    const edit = box.querySelector('.cm-chart-edit-data');
    expect(edit.textContent).toBe('Edit the data');
    press(edit);
    expect(box.querySelector('.cm-chart-settings-panel').hidden).toBe(true);
    expect(form().hidden).toBe(false);
    expect(field(1, 'category').value).toBe('APC');
    form().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(form().hidden).toBe(true);
    press(box.querySelector('.cm-chart-numbers-btn'));
    const link = [...box.querySelectorAll('.cm-chart-link')].find((node) => node.textContent === 'Edit the data');
    press(link);
    expect(form().hidden).toBe(false);
    view.destroy();

    drawnKind = { name: 'bars', label: 'Bars', counts: true };
    editor(`Words.\n\n${chartOf(['kind: bars', 'count: rows', 'by: Model', '| Model | Grade |', '| --- | --- |', '| A | identified |', '| B | almost sure |'])}\n`);
    await settle();
    press(view.dom.querySelector('.cm-chart-settings'));
    expect(view.dom.querySelector('.cm-chart-data').hidden).toBe(true);
  });
});

describe('a picture wall from scratch', () => {
  const picture = (id, label, folder = 'crops') => ({ id, type: 'media', label, attrs: { path: `media/${folder}/${label}`, folder, kind: 'image' } });
  const ENTITIES = [picture('e_0000000001', 'vehicle-01.jpg'), picture('e_0000000002', 'vehicle-02.jpg'), picture('e_0000000010', 'vehicle-10.jpg'),
    picture('e_0000000099', 'map.png', '')];

  it('picks each picture from the case, then its words, group and colour, each one Undo; the shape is one press', async () => {
    drawnKind = { name: 'pictures', label: 'Picture wall', counts: true, per_row: true, keys: ['picture', 'label', 'words', 'shape', 'flag', 'flags'] };
    await fromScratch('pictures', 'Words.\n', ENTITIES);
    const STARTER = chartOf(['kind: pictures', 'picture: Picture', 'label: #', '| Picture | # |', '| --- | --- |']);
    expect(text()).toBe(`Words.\n\n${STARTER}\n`);
    expect(view.dom.querySelector('.cm-chart-empty').textContent).toBe('Add a picture of the case: the wall is drawn as you fill it.');
    // the first row's picture takes the keyboard; pressed, it opens the case's pictures
    expect(document.activeElement).toBe(field(0, 'picture'));
    expect(field(0, 'picture').classList.contains('cf-picture-empty')).toBe(true);
    press(field(0, 'picture'));
    const picker = view.dom.querySelector('.cm-picker');
    expect([...picker.querySelectorAll('.cm-picker-name')].map((node) => node.textContent)).toEqual(['map.png', 'vehicle-01.jpg', 'vehicle-02.jpg', 'vehicle-10.jpg']);
    press(picker.querySelector('[data-entity-pick="e_0000000002"]'));
    const ONE = chartOf(['kind: pictures', 'picture: Picture', 'label: #', '| Picture | # |', '| --- | --- |', '| [[media:e_0000000002|vehicle-02.jpg]] | |']);
    expect(text()).toBe(`Words.\n\n${ONE}\n`);
    expect(field(0, 'picture').querySelector('.cf-picture-name').textContent).toBe('vehicle-02.jpg');
    expect(document.activeElement).toBe(field(0, 'label'));

    fill(field(0, 'label'), '#2');
    fill(field(0, 'words'), 'burned');
    fill(field(0, 'group'), 'Streit Cougar');
    fill(field(0, 'colour'), 'Confirmed');
    const FILLED = chartOf(['kind: pictures', 'by: Group', 'colour by: Grade', 'picture: Picture', 'label: #', 'words: Words',
      '| Picture | # | Words | Group | Grade |', '| --- | --- | --- | --- | --- |', '| [[media:e_0000000002|vehicle-02.jpg]] | #2 | burned | Streit Cougar | Confirmed |']);
    expect(text()).toBe(`Words.\n\n${FILLED}\n`);
    // the grades are offered as its colour, the groups typed as its group
    expect([...form().querySelectorAll(`#${field(0, 'colour').getAttribute('list')} option`)].map((node) => node.value))
      .toEqual(['Confirmed', 'Almost sure', 'Strong doubt', 'Set aside']);
    expect([...form().querySelectorAll(`#${field(0, 'group').getAttribute('list')} option`)].map((node) => node.value)).toEqual(['Streit Cougar']);

    const square = [...form().querySelectorAll('.cf-seg-btn')].find((node) => node.textContent === '1:1');
    press(square);
    expect(text()).toBe(`Words.\n\n${FILLED.replace('words: Words', 'words: Words\nshape: 1:1')}\n`);
    undo(view);
    expect(text()).toBe(`Words.\n\n${FILLED}\n`);
    undo(view);
    expect(text()).toContain('| [[media:e_0000000002|vehicle-02.jpg]] | #2 | burned | Streit Cougar |\n:::');
  });

  it('fills from a folder of the case’s pictures, labelled by their number, the ones it shows left unticked', async () => {
    drawnKind = { name: 'pictures', label: 'Picture wall', counts: true, per_row: true, keys: [] };
    const BLOCK = chartOf(['kind: pictures', 'picture: Picture', 'label: #', '| Picture | # |', '| --- | --- |', '| [[media:e_0000000002|vehicle-02.jpg]] | #2 |']);
    editor(`Words.\n\n${BLOCK}\n`, ENTITIES);
    await settle();
    view.dom.querySelector('.cm-chart-block').chart.toggleForm(true);
    press(form().querySelector('.cf-fill-open'));
    const folder = form().querySelector('.cf-fill select');
    expect([...folder.options].map((option) => option.textContent)).toEqual(['Every folder', 'No folder', 'crops']);
    folder.value = 'crops';
    folder.dispatchEvent(new Event('change', { bubbles: true }));
    const lines = [...form().querySelectorAll('.cf-fill-line')];
    expect(lines.map((line) => [line.querySelector('input').checked, line.querySelector('.cf-fill-words').textContent])).toEqual([
      [true, 'vehicle-01.jpg'], [false, 'vehicle-02.jpg'], [true, 'vehicle-10.jpg']]);
    expect(lines[1].querySelector('.cf-fill-said').textContent).toBe('already in the wall');
    const go = form().querySelector('.cf-go');
    expect(go.textContent).toContain('Add 2 pictures');
    press(go);
    expect(text()).toBe(`Words.\n\n${BLOCK.replace('#2 |\n:::', '#2 |\n| [[media:e_0000000001|vehicle-01.jpg]] | #1 |\n| [[media:e_0000000010|vehicle-10.jpg]] | #10 |\n:::')}\n`);
    undo(view);
    expect(text()).toBe(`Words.\n\n${BLOCK}\n`);
  });
});
