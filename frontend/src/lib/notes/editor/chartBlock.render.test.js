// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorSelection, EditorState } from '@codemirror/state';
import { undo } from '@codemirror/commands';

/**
 * A chart in the drawn note: made from a table by its picture, drawn as the server
 * draws it, its bar's Kind, Settings, Read again, The numbers and Export, its checks
 * with their one-press fixes, every choice one Undo step of exact bytes.
 */

const server = vi.hoisted(() => ({ figure: null, kinds: null, asked: [] }));
vi.mock('../../api.js', async (original) => {
  const real = await original();
  return {
    ...real,
    api: {
      ...real.api,
      postBytes: vi.fn(async (path, body) => {
        server.asked.push({ path, body });
        return server.figure(body);
      }),
      post: vi.fn(async (path, body) => {
        server.asked.push({ path, body });
        return server.kinds(body);
      }),
    },
  };
});

const { focusedState, noteExtensions, setNoteCase, setNoteMode, startChart } = await import('../liveMarkdown.js');
const { forgetDrawings } = await import('./chartFigure.js');

const TABLE = '| Model | Grade | At least |\n| --- | --- | ---: |\n| Streit Cougar | identified | 8 |\n| Al-Wahsh | almost sure | 2 |';
const NOTE = `Who made them.\n\n## Count\n\n${TABLE}\n\nAfter.`;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" class="az-chart az-chart-report" viewBox="0 0 640 300" width="640" height="300"><title>Chart</title><text>Streit Cougar</text></svg>';
const STACKED = { name: 'stacked bars', label: 'Stacked', counts: true, parts: false, stacked: true, up: false, turns: 'stacked columns', style: 'report' };
const BARS = { ...STACKED, name: 'bars', label: 'Bars', stacked: false, turns: 'columns' };
const KINDS = {
  rows: 2,
  kinds: [
    { kind: 'bars', label: 'Bars', settings: { kind: 'bars', count: 'At least', by: 'Model' }, title: 'At least 10, by model', svg: SVG.replace('Chart', 'Bars') },
    {
      kind: 'stacked bars', label: 'Stacked', settings: { kind: 'stacked bars', count: 'At least', by: 'Model', 'colour by': 'Grade' },
      title: 'At least 10, by model and grade', svg: SVG.replace('Chart', 'Stacked'),
    },
    { kind: 'pie', label: 'Pie', settings: { kind: 'pie', count: 'At least', by: 'Grade' }, title: 'At least 10, by grade', svg: SVG.replace('Chart', 'Pie') },
  ],
};
const CHART = [
  '::: chart', 'kind: stacked bars', 'title: At least 10, by model and grade', 'count: At least', 'by: Model', 'colour by: Grade',
  'from: note:n1#count', TABLE, ':::',
].join('\n');
const CHARTED = `Who made them.\n\n## Count\n\n${TABLE}\n\n${CHART}\n\nAfter.`;

/** What the figure route answers: its drawing, and what the check says in its headers. */
function answer({ checks = [], kind = STACKED, proposed = 'At least 10 vehicles, by model and grade', title = 'At least 10, by model and grade' } = {}) {
  return {
    data: new TextEncoder().encode(SVG).buffer,
    headers: new Headers({
      'X-Chart-Title': JSON.stringify(title),
      'X-Chart-Proposed-Title': JSON.stringify(proposed),
      'X-Chart-Kind': JSON.stringify(kind),
      'X-Note-Warnings': JSON.stringify(checks.map((check) => check.message)),
      'X-Note-Warning-Lines': JSON.stringify(checks.map((check) => check.line ?? null)),
      'X-Note-Warning-Kinds': JSON.stringify(checks.map((check) => check.kind ?? 'other')),
      'X-Note-Warning-Fixes': JSON.stringify(checks.map((check) => check.fix ?? [])),
    }),
  };
}

let view;
let handlers;
beforeEach(() => {
  server.asked = [];
  server.figure = () => answer();
  server.kinds = () => KINDS;
  forgetDrawings();
});
afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

function editor(doc, { readOnly = false, mode = 'drawn', noteId = 'n1' } = {}) {
  const parent = document.createElement('div');
  document.body.append(parent);
  handlers = { tableToast: vi.fn(), open: vi.fn(), noteKey: `c1:${noteId}`, noteId };
  view = new EditorView({ parent, state: EditorState.create({ doc, extensions: noteExtensions({ handlers, readOnly, mode }) }) });
  view.setState(focusedState(view.state.update({ selection: EditorSelection.cursor(0) }).state));
  view.dispatch({ effects: setNoteCase.of({ caseId: 'c1', entities: [] }) });
  view.focus = vi.fn();
  return view;
}

const text = () => view.state.doc.toString();
const settle = async () => {
  for (let step = 0; step < 4; step += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const press = (node) => {
  node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  node.click();
};
const chart = () => view.dom.querySelector('.cm-chart-block');
const tool = (name) => chart().querySelector(`.cm-chart-${name}`);
const card = () => chart().querySelector('.cm-chart-settings-panel');
const field = (name) => card().querySelector(`[aria-label="${name}"]`);
const choose = (name, value) => {
  const select = field(name);
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
};
const figureAsks = () => server.asked.filter((one) => one.path.endsWith('/notes/figure'));

describe('a chart made from a table', () => {
  it('shows the kinds the table fits, drawn from its own rows, and writes the one picked under it as one step', async () => {
    editor(NOTE);
    press(view.dom.querySelector('.cm-grid-chart'));
    const picker = view.dom.querySelector('.cm-chart-picker');
    expect(picker.getAttribute('aria-label')).toBe('Pick a chart');
    await settle();
    // the route is asked with the table as written, and only the kinds it fits are offered
    expect(server.asked[0]).toEqual({ path: '/api/cases/c1/notes/figure/kinds', body: { text: TABLE, note: 'n1' } });
    const picks = [...picker.querySelectorAll('button.cm-chart-pick')];
    expect(picks.map((pick) => pick.dataset.kind)).toEqual(['bars', 'stacked bars', 'pie']);
    expect(picks[1].querySelector('.cm-chart-thumb svg title').textContent).toBe('Stacked');
    expect(picker.querySelector('.cm-chart-picker-said').textContent).toBe('Drawn from this table’s 2 rows');
    press(picks[1]);
    expect(text()).toBe(CHARTED);
    expect(view.dom.querySelector('.cm-chart-picker')).toBeNull();
    // the chart is picked where it stands, drawn as the server draws it
    expect(view.state.selection.main.head).toBe(CHARTED.indexOf('::: chart'));
    await settle();
    expect(chart().querySelector('.cm-chart-figure svg')).toBeTruthy();
    undo(view);
    expect(text()).toBe(NOTE);
  });

  it('names the n-th table under a heading, so Read again finds that one', async () => {
    const two = `## Count\n\n| A | N |\n| --- | --- |\n| x | 1 |\n\n${TABLE}\n`;
    editor(two);
    press(view.dom.querySelectorAll('.cm-grid-chart')[1]);
    await settle();
    press(view.dom.querySelector('button.cm-chart-pick[data-kind="bars"]'));
    expect(text()).toContain('from: note:n1#count/2\n| Model |');
  });

  it('writes no from: in a note that is no note of a case', async () => {
    editor(NOTE, { noteId: '' });
    press(view.dom.querySelector('.cm-grid-chart'));
    await settle();
    press(view.dom.querySelector('button.cm-chart-pick[data-kind="pie"]'));
    expect(text()).toContain('::: chart\nkind: pie\ntitle: At least 10, by grade\ncount: At least\nby: Grade\n| Model |');
  });

  it('says so when the route draws nothing', async () => {
    server.kinds = () => { throw new Error('no table to draw'); };
    editor(NOTE);
    press(view.dom.querySelector('.cm-grid-chart'));
    await settle();
    expect(view.dom.querySelector('.cm-chart-picker-said').textContent).toBe('Not drawn: no table to draw');
  });
});

describe('the chart drawn', () => {
  it('draws the server’s picture, asks once per text, and leaves the rows of this note to the editor', async () => {
    editor(CHARTED);
    await settle();
    expect(chart().querySelector('.cm-chart-figure svg text').textContent).toBe('Streit Cougar');
    expect(figureAsks()).toHaveLength(1);
    expect(figureAsks()[0].body).toEqual({ text: CHART, note: 'n1', origins: false });
    expect(tool('kind').textContent).toBe('Stacked');
    // the same chart in another editor is drawn from what was kept
    view.destroy();
    editor(CHARTED);
    await settle();
    expect(figureAsks()).toHaveLength(1);
    expect(chart().querySelector('.cm-chart-figure svg')).toBeTruthy();
  });

  it('shows its bar only where the note can be written, and its lines in the raw Markdown', async () => {
    editor(CHARTED, { readOnly: true });
    await settle();
    expect(chart().querySelector('.cm-chart-bar')).toBeNull();
    expect(chart().querySelector('.cm-chart-figure svg')).toBeTruthy();
    view.destroy();
    editor(CHARTED);
    expect([...chart().querySelectorAll('.cm-chart-bar button')].map((node) => node.getAttribute('aria-label') ?? node.textContent))
      .toEqual(['Kind: Stacked', 'Settings', 'Read again', 'The numbers', 'Export', 'Edit the source']);
    setNoteMode(view, 'markdown');
    expect(chart()).toBeNull();
    expect(view.contentDOM.textContent).toContain('::: chartkind: stacked bars');
  });

  it('says what the check says, and fixes it in one press', async () => {
    const said = '"Vehicles by model" counts at least: say so in its title.';
    server.figure = () => answer({ checks: [{ message: said, line: 1, fix: [['title', 'At least 10 vehicles, by model']] }, { message: 'A chart cites no source.', kind: 'unsourced' }] });
    const floor = CHARTED.replace('title: At least 10, by model and grade', 'title: Vehicles by model');
    editor(floor);
    await settle();
    const checks = [...chart().querySelectorAll('.cm-chart-check')];
    expect(checks.map((item) => item.querySelector('.cm-chart-check-said').textContent)).toEqual([said, 'A chart cites no source.']);
    expect(checks[1].querySelector('.cm-chart-fix')).toBeNull();
    const fix = checks[0].querySelector('.cm-chart-fix');
    expect(fix.textContent).toBe('Add “at least” to the title');
    press(fix);
    expect(text()).toBe(floor.replace('title: Vehicles by model', 'title: At least 10 vehicles, by model'));
    undo(view);
    expect(text()).toBe(floor);
  });

  it('says a drawing it could not have', async () => {
    server.figure = () => { throw new Error('the chart holds no table: write its rows under its settings'); };
    editor(CHARTED);
    await settle();
    expect(chart().querySelector('.cm-chart-failed').textContent).toBe('Chart not drawn: the chart holds no table: write its rows under its settings');
  });
});

describe('the settings, on the chart', () => {
  async function opened(doc = CHARTED) {
    editor(doc);
    await settle();
    press(tool('settings'));
    return card();
  }

  it('open between the bar and the drawing, and close again, the Escape key giving the keyboard back', async () => {
    await opened();
    expect(card().hidden).toBe(false);
    expect(tool('settings').getAttribute('aria-pressed')).toBe('true');
    expect(card().nextElementSibling.classList.contains('cm-chart-figure')).toBe(true);
    card().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(card().hidden).toBe(true);
    expect(tool('settings').getAttribute('aria-pressed')).toBe('false');
    // a double press on the drawing opens them too
    chart().querySelector('.cm-chart-figure').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    expect(card().hidden).toBe(false);
  });

  it('writes a title on Enter, the one line only, and Undo gives the bytes back', async () => {
    await opened();
    const title = field('Title');
    expect(title.value).toBe('At least 10, by model and grade');
    title.value = 'At least 10 armoured vehicles, by model and grade';
    title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(text()).toBe(CHARTED.replace('title: At least 10, by model and grade', 'title: At least 10 armoured vehicles, by model and grade'));
    undo(view);
    expect(text()).toBe(CHARTED);
  });

  it('offers the title the data proposes, and writes it in one press', async () => {
    await opened();
    const offer = card().querySelector('.cm-chart-proposed');
    expect(offer.querySelector('em').textContent).toBe('At least 10 vehicles, by model and grade');
    press(offer.querySelector('.cm-chart-use'));
    expect(text()).toContain('\ntitle: At least 10 vehicles, by model and grade\n');
  });

  it('counts, splits and colours by the table’s columns, each one step', async () => {
    await opened();
    expect([...field('Count').options].map((option) => option.textContent)).toEqual(['Rows', 'At least']);
    expect([...field('By').options].map((option) => option.textContent)).toEqual(['Model', 'Grade']);
    expect([...field('Coloured by').options].map((option) => option.textContent)).toEqual(['One colour', 'Grade']);
    choose('Count', 'rows');
    expect(text()).toBe(CHARTED.replace('count: At least', 'count: rows'));
    undo(view);
    expect(text()).toBe(CHARTED);
    choose('By', 'Grade');
    expect(text()).toBe(CHARTED.replace('by: Model\n', 'by: Grade\n'));
    undo(view);
    expect(text()).toBe(CHARTED);
  });

  it('takes the colour away from stacked bars and turns them plain, in one step', async () => {
    await opened();
    choose('Coloured by', '');
    expect(text()).toBe(CHARTED.replace('kind: stacked bars', 'kind: bars').replace('colour by: Grade\n', ''));
    undo(view);
    expect(text()).toBe(CHARTED);
  });

  it('stacks plain bars once they are coloured by a column', async () => {
    server.figure = () => answer({ kind: BARS });
    const plain = CHARTED.replace('kind: stacked bars', 'kind: bars').replace('colour by: Grade\n', '');
    await opened(plain);
    choose('Coloured by', 'Grade');
    expect(text()).toBe(CHARTED);
  });

  it('shows the table or not, and takes a whole look, each one line', async () => {
    await opened();
    const show = card().querySelector('[aria-label="Show"]');
    expect([...show.querySelectorAll('button')].map((node) => [node.textContent, node.getAttribute('aria-checked')]))
      .toEqual([['Chart', 'true'], ['Chart and table', 'false']]);
    press(show.querySelectorAll('button')[1]);
    expect(text()).toBe(CHARTED.replace('from: note:n1#count', 'show: chart and table\nfrom: note:n1#count'));
    undo(view);
    press(card().querySelector('[aria-label="Style"]').querySelectorAll('button')[1]);
    expect(text()).toBe(CHARTED.replace('from: note:n1#count', 'from: note:n1#count\nstyle: book'));
    undo(view);
    expect(text()).toBe(CHARTED);
  });
});

describe('the bar', () => {
  it('reads the rows again once the table they came from changed, as one step', async () => {
    editor(CHARTED);
    await settle();
    expect(tool('again').hidden).toBe(true);
    const at = text().indexOf('| Al-Wahsh | almost sure | 2 |');
    view.dispatch({ changes: { from: at + 2, to: at + 10, insert: 'Al Wahsh' } });
    await new Promise((resolve) => setTimeout(resolve, 260));
    expect(tool('again').hidden).toBe(false);
    expect(tool('again').title).toBe('The table under “Count” changed: copy its rows again');
    const edited = text();
    press(tool('again'));
    expect(text()).toBe(edited.replace(`${TABLE}\n:::`, `${TABLE.replace('Al-Wahsh', 'Al Wahsh')}\n:::`));
    expect(tool('again').hidden).toBe(true);
    undo(view);
    expect(text()).toBe(edited);
  });

  it('opens the numbers it is drawn from, and says where they came from', async () => {
    editor(CHARTED);
    await settle();
    press(tool('numbers-btn'));
    const numbers = chart().querySelector('.cm-chart-numbers');
    expect(numbers.hidden).toBe(false);
    expect([...numbers.querySelectorAll('th')].map((cell) => cell.textContent)).toEqual(['Model', 'Grade', 'At least']);
    expect(numbers.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(numbers.querySelector('.cm-chart-numbers-said span').textContent).toBe('Same as the table under “Count”.');
    press([...numbers.querySelectorAll('.cm-chart-link')].find((node) => node.textContent === 'Go to the table'));
    expect(view.state.selection.main.head).toBe(CHARTED.indexOf(TABLE));
  });

  it('downloads a picture for the destination picked, from the route', async () => {
    const saved = [];
    URL.createObjectURL = vi.fn(() => 'blob:chart');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function save() { saved.push(this.download); });
    editor(CHARTED);
    await settle();
    press(tool('export'));
    const items = [...view.dom.querySelectorAll('.cm-grid-menu-item')];
    expect(items.map((item) => item.querySelector('.cm-grid-menu-words').textContent)).toEqual(['For X', 'Portrait', 'Square', 'PDF page', 'SVG']);
    press(items[0]);
    await settle();
    expect(figureAsks().at(-1).body).toEqual({ text: CHART, note: 'n1', format: 'png', size: 'x' });
    expect(saved).toEqual(['At least 10, by model and grade (X).png']);
    expect(handlers.tableToast).toHaveBeenCalledWith('Saved At least 10, by model and grade (X).png to your downloads.');
    press(tool('export'));
    press([...view.dom.querySelectorAll('.cm-grid-menu-item')][4]);
    await settle();
    expect(figureAsks().at(-1).body).toEqual({ text: CHART, note: 'n1', format: 'svg', size: 'page' });
    expect(saved.at(-1)).toBe('At least 10, by model and grade.svg');
    click.mockRestore();
  });

  it('changes the kind from the picker, keeping the chart’s own settings', async () => {
    server.kinds = () => ({ rows: 2, kinds: [{ kind: 'pie', label: 'Pie', settings: { kind: 'pie', by: 'Grade', 'colour by': '' }, title: 'x', svg: SVG }] });
    editor(CHARTED);
    await settle();
    press(tool('kind'));
    await settle();
    expect(server.asked.find((one) => one.path.endsWith('/kinds')).body).toEqual({ text: CHART, note: 'n1' });
    expect(view.dom.querySelector('.cm-chart-picker-said').textContent).toBe('Drawn from the chart’s 2 rows');
    press(view.dom.querySelector('button.cm-chart-pick'));
    expect(text()).toBe(CHARTED.replace('kind: stacked bars', 'kind: pie').replace('by: Model\ncolour by: Grade\n', 'by: Grade\n'));
    undo(view);
    expect(text()).toBe(CHARTED);
  });
});

describe('/ › Chart', () => {
  it('opens the kind picker for the note’s one table, the chart landing where / was typed', async () => {
    editor(`${NOTE}\n\n`);
    view.dispatch({ selection: { anchor: text().length } });
    startChart(view);
    await settle();
    press(view.dom.querySelector('button.cm-chart-pick[data-kind="bars"]'));
    expect(text().endsWith(`After.\n\n::: chart\nkind: bars\ntitle: At least 10, by model\ncount: At least\nby: Model\nfrom: note:n1#count\n${TABLE}\n:::\n`)).toBe(true);
  });

  it('asks which table when the note holds several, a chart’s own rows left out', async () => {
    editor(`${CHARTED}\n\n## Units\n\n| Unit | Seen |\n| --- | --- |\n| A | 2 |\n`);
    startChart(view);
    const items = [...view.dom.querySelectorAll('.cm-grid-menu-item')];
    expect(items.map((item) => item.querySelector('.cm-grid-menu-words').textContent))
      .toEqual(['The table under “Count”', 'The table under “Units”']);
    press(items[1]);
    await settle();
    expect(server.asked.at(-1).body.text).toBe('| Unit | Seen |\n| --- | --- |\n| A | 2 |');
  });

  it('starts a small table to fill when the note holds none', () => {
    editor('Words.\n');
    view.dispatch({ selection: { anchor: text().length } });
    startChart(view);
    expect(text()).toContain('| Category | Count |\n| --- | ---: |\n|  |  |');
    expect(handlers.tableToast).toHaveBeenCalledWith('Fill the table, then press Chart above it.', expect.any(Array));
  });
});
