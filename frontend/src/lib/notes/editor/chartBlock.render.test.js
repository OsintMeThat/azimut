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

const server = vi.hoisted(() => ({ figure: null, kinds: null, rows: null, sources: null, palette: [], asked: [] }));
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
        return path.endsWith('/rows') ? server.rows(body) : server.kinds(body);
      }),
      get: vi.fn(async (path) => {
        server.asked.push({ path });
        return path.endsWith('/layer-palette') ? { colours: server.palette } : server.sources(path);
      }),
      put: vi.fn(async (path, body) => {
        server.asked.push({ path, body });
        server.palette = body.colours;
        return { colours: body.colours, icons: [] };
      }),
    },
  };
});

const { focusedState, noteExtensions, setNoteCase, setNoteMode, startChart } = await import('../liveMarkdown.js');
const { forgetDrawings } = await import('./chartFigure.js');
const { keptSaid } = await import('./chartBlock.js');

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
function answer({ checks = [], kind = STACKED, proposed = 'At least 10 vehicles, by model and grade', title = 'At least 10, by model and grade', colours = [] } = {}) {
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
      'X-Chart-Colours': JSON.stringify(colours),
    }),
  };
}

let view;
let handlers;
beforeEach(() => {
  server.asked = [];
  server.figure = () => answer();
  server.kinds = () => KINDS;
  server.rows = () => ({ found: false, name: '', text: '' });
  server.sources = () => ({ tables: [], sheets: [] });
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
    // it stands over the note, out of the editor's flow: in it, it shrank the page and the note jumped
    expect(getComputedStyle(picker).position).toBe('fixed');
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

  it('says how a story page shows a picture wall with groups, whole or one group per step, each one line', async () => {
    const WALL = { name: 'pictures', label: 'Picture wall', counts: true, per_row: true, parts: false, stacked: false, style: 'report',
      keys: ['picture', 'label', 'words', 'shape', 'flag', 'flags', 'story'] };
    server.figure = () => answer({ kind: WALL, title: 'At least 2 vehicles, one by one' });
    const block = (...settings) => ['::: chart', 'kind: pictures', 'title: At least 2 vehicles, one by one', ...settings, 'picture: Picture', 'label: #',
      '| Picture | # | Model | Grade |', '| --- | --- | --- | --- |', '| e_0000000001 | #1 | Streit Cougar | Confirmed |',
      '| e_0000000002 | #2 | BATT UMG | Almost sure |', ':::'].join('\n');
    const WALLED = `Words.\n\n${block('by: Model', 'colour by: Grade')}\n`;
    await opened(WALLED);
    const story = () => card().querySelector('[aria-label="In a story"]');
    const choices = () => [...story().querySelectorAll('button')].map((node) => [node.textContent, node.getAttribute('aria-checked')]);
    expect(choices()).toEqual([['Whole wall', 'true'], ['One group per step', 'false']]);
    press(story().querySelectorAll('button')[1]);
    expect(text()).toBe(WALLED.replace('label: #\n', 'label: #\nstory: one group per step\n'));
    await settle();
    expect(choices()).toEqual([['Whole wall', 'false'], ['One group per step', 'true']]);
    undo(view);
    expect(text()).toBe(WALLED);
    view.destroy();

    // the same words written another way read the same, and Whole wall takes the line out
    const STEPPED = `Words.\n\n${block('by: Model', 'colour by: Grade', 'story: Groups')}\n`;
    await opened(STEPPED);
    expect(choices()).toEqual([['Whole wall', 'false'], ['One group per step', 'true']]);
    press(story().querySelectorAll('button')[0]);
    expect(text()).toBe(STEPPED.replace('story: Groups\n', ''));
    view.destroy();

    // a wall of one group has nothing to step through
    await opened(`Words.\n\n${block('colour by: Grade')}\n`);
    expect(story()).toBeNull();
    expect(card().querySelector('[aria-label="Shape"]')).not.toBeNull();
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

describe('a timeline’s settings', () => {
  const TIMELINE = { name: 'timeline', label: 'Timeline', counts: false, parts: false, stacked: false, style: 'report', keys: ['layout', 'labels'], layout: 'numbered' };
  const BLOCK = ['::: chart', 'kind: timeline', 'title: The announcements', '| Day | What | Kind |', '| --- | --- | --- |',
    '| 9 Oct 2026 | The strait announced cleared | Claim |', '| 19 Oct 2026 | Footage on the north edge | Geolocated |', ':::'].join('\n');
  const DOC = `Words.\n\n${BLOCK}\n`;

  it('lays it out, colours it by a column and shortens its labels, each one line and one Undo', async () => {
    server.figure = () => answer({ kind: TIMELINE, title: 'The announcements', proposed: '' });
    editor(DOC);
    await settle();
    press(tool('settings'));
    // what a timeline is about: not a count nor a by, but its layout, its colours and its labels
    expect(field('Count')).toBe(null);
    expect(field('By')).toBe(null);
    const layout = () => field('Layout');
    expect([...layout().querySelectorAll('button')].map((one) => [one.textContent, one.getAttribute('aria-checked')]))
      .toEqual([['Auto', 'true'], ['Across', 'false'], ['Numbered', 'false'], ['List', 'false']]);
    expect(layout().querySelector('button').title).toBe('Up to 8 events across, up to 20 numbered, more as a list; always a list on a phone');
    expect(layout().closest('.cm-chart-field').querySelector('.cm-chart-field-note').textContent).toBe('Drawn numbered here');
    press(layout().querySelectorAll('button')[1]);
    expect(text()).toBe(DOC.replace('title: The announcements\n', 'title: The announcements\nlayout: across\n'));
    undo(view);
    expect(text()).toBe(DOC);
    // neither the days nor the words colour it
    expect([...field('Coloured by').options].map((option) => option.textContent)).toEqual(['One colour', 'Kind']);
    choose('Coloured by', 'Kind');
    expect(text()).toBe(DOC.replace('title: The announcements\n', 'title: The announcements\ncolour by: Kind\n'));
    undo(view);
    const labels = field('Labels');
    expect([...labels.querySelectorAll('button')].map((one) => [one.textContent, one.getAttribute('aria-checked')]))
      .toEqual([['Full', 'true'], ['Short', 'false']]);
    press(labels.querySelectorAll('button')[1]);
    expect(text()).toBe(DOC.replace('title: The announcements\n', 'title: The announcements\nlabels: short\n'));
    undo(view);
    expect(text()).toBe(DOC);
  });

  it('says when an across too crowded for its lanes was numbered', async () => {
    server.figure = () => answer({ kind: TIMELINE, title: 'The announcements', proposed: '' });
    editor(DOC.replace('title: The announcements\n', 'title: The announcements\nlayout: across\n'));
    await settle();
    press(tool('settings'));
    expect(field('Layout').querySelectorAll('button')[1].getAttribute('aria-checked')).toBe('true');
    expect(card().querySelector('.cm-chart-field-note').textContent).toBe('Too crowded across: drawn numbered');
  });
});

describe('Keep these colours for the case', () => {
  const COLOURS = [
    { value: 'identified', colour: '#184F95', origin: 'grade' },
    { value: 'almost sure', colour: '#3987e5', origin: 'grade' },
    { value: 'UAE', colour: '#eb6834', origin: 'case' },
    { value: 'Other', colour: '#a9a79f', origin: 'other' },
  ];

  it('names the colours the chart chose in the case’s palette in one press, the case’s own left as they are, with an Undo', async () => {
    server.palette = [{ name: 'UAE', colour: '#eb6834' }];
    server.figure = () => answer({ colours: COLOURS });
    editor(CHARTED);
    await settle();
    press(tool('settings'));
    const row = card().querySelector('.cm-chart-colours');
    expect(row.hidden).toBe(false);
    expect([...row.querySelectorAll('.cm-chart-swatch')].map((node) => node.textContent)).toEqual(['identified', 'almost sure']);
    const keep = row.querySelector('.cm-chart-keep');
    expect(keep.textContent).toBe('Keep these colours for the case');
    expect(keep.title).toBe('Name these colours in the case, so every chart, map and layer paints them the same');
    const before = text();
    press(keep);
    await settle();
    expect(server.asked.filter((one) => one.path === '/api/cases/c1/layer-palette' && one.body).at(-1).body).toEqual({
      colours: [{ name: 'UAE', colour: '#eb6834' }, { name: 'identified', colour: '#184f95' }, { name: 'almost sure', colour: '#3987e5' }],
    });
    // the note is not written; the chart is drawn again in the case's colours
    expect(text()).toBe(before);
    expect(figureAsks().length).toBeGreaterThan(1);
    const [said, actions] = handlers.tableToast.mock.calls.at(-1);
    expect(said).toBe('Kept for the case: every chart, map and layer paints them the same');
    actions[0].onClick();
    await settle();
    expect(server.palette).toEqual([{ name: 'UAE', colour: '#eb6834' }]);
  });

  it('says which names the case could not take', () => {
    expect(keptSaid([])).toBe('Kept for the case: every chart, map and layer paints them the same');
    expect(keptSaid(['set aside (#34 a pickup, #37 not in the owner’s lists)'])).toBe(
      'Kept for the case, but not “set aside (#34 a pickup…”: a case names a colour once, 12 at most, in 40 letters');
  });

  it('is not offered once every colour is the case’s', async () => {
    server.figure = () => answer({ colours: [{ value: 'UAE', colour: '#eb6834', origin: 'case' }] });
    editor(CHARTED);
    await settle();
    press(tool('settings'));
    expect(card().querySelector('.cm-chart-colours').hidden).toBe(true);
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
      .toEqual(['The table under “Count”', 'The table under “Units”', 'From scratch', 'Copy rows from another note or a sheet']);
    press(items[1]);
    await settle();
    expect(server.asked.at(-1).body.text).toBe('| Unit | Seen |\n| --- | --- |\n| A | 2 |');
  });

  it('shows every kind from scratch when the note holds no table, asking the server nothing', async () => {
    editor('Words.\n');
    view.dispatch({ selection: { anchor: text().length } });
    startChart(view);
    await settle();
    expect(server.asked).toEqual([]);
    const picker = view.dom.querySelector('.cm-chart-picker');
    expect(picker.querySelector('.cm-chart-picker-said').textContent).toBe('Every kind has a form made for it');
    expect([...picker.querySelectorAll('.cm-chart-picker-part')].map((node) => node.textContent)).toEqual(['From scratch']);
    expect(picker.querySelectorAll('button.cf-scratch')).toHaveLength(15);
    expect(document.activeElement).toBe(picker.querySelector('button.cf-scratch[data-kind="timeline"]'));
    expect(text()).toBe('Words.\n');
  });
});

const OTHER = '| Model | At least |\n| --- | ---: |\n| Streit Cougar | 9 |\n| Al-Wahsh | 2 |';
const SOURCES = {
  tables: [{ origin: 'note:n2#count', note: 'Register', heading: 'Count', rows: 2, columns: ['Model', 'At least'] },
    { origin: 'note:n2#count/2', note: 'Register', heading: 'Count', rows: 4, columns: ['Unit', 'Seen'] }],
  sheets: [{ origin: 'sheet:s1', title: 'Sightings', rows: 3, columns: ['Model', 'Seen'] }],
};
const words = () => [...view.dom.querySelectorAll('.cm-grid-menu-item')].map((item) => item.querySelector('.cm-grid-menu-words').textContent);
const item = (label) => [...view.dom.querySelectorAll('.cm-grid-menu-item')].find((node) => node.querySelector('.cm-grid-menu-words').textContent === label);

describe('Copy rows from another note or a sheet', () => {
  it('lists the other notes’ tables and the sheets, shows the kinds the rows picked fit, and writes them with from:', async () => {
    server.sources = () => SOURCES;
    server.rows = ({ origin }) => (origin === 'note:n2#count' ? { found: true, name: 'Register', text: OTHER } : { found: false });
    editor('Words.\n');
    view.dispatch({ selection: { anchor: text().length } });
    startChart(view);
    await settle();
    press(view.dom.querySelector('.cm-chart-picker .cm-chart-copy'));
    await settle();
    expect(words()).toEqual(['“Count”', '“Count”, table 2', 'Sightings']);
    expect([...view.dom.querySelectorAll('.cm-grid-menu-item small')].map((node) => node.textContent))
      .toEqual(['Register · 2 rows', 'Register · 4 rows', 'Sheet · 3 rows']);
    press(item('“Count”'));
    await settle();
    expect(server.asked.find((one) => one.path.endsWith('/rows')).body).toEqual({ origin: 'note:n2#count' });
    const picker = view.dom.querySelector('.cm-chart-picker');
    expect(server.asked.find((one) => one.path.endsWith('/kinds')).body).toEqual({ text: OTHER, note: 'n1' });
    expect(picker.querySelector('.cm-chart-picker-foot').textContent).toContain('They are copied into this note');
    expect(picker.querySelector('.cm-chart-picker-said').textContent).toBe('Drawn from the 2 rows to copy');
    press(picker.querySelector('button.cm-chart-pick[data-kind="bars"]'));
    expect(text()).toBe(`Words.\n\n::: chart\nkind: bars\ntitle: At least 10, by model\ncount: At least\nby: Model\nfrom: note:n2#count\n${OTHER}\n:::\n`);
    await settle();
    expect(view.dom.querySelector('.cm-chart-anchor')).toBeNull();
    undo(view);
    expect(text()).toBe('Words.\n');
  });

  it('is offered beside the note’s own tables, and under the kind picker of its one table', async () => {
    server.sources = () => SOURCES;
    editor(`${CHARTED}\n\n## Units\n\n| Unit | Seen |\n| --- | --- |\n| A | 2 |\n`);
    startChart(view);
    expect(words()).toEqual(['The table under “Count”', 'The table under “Units”', 'From scratch', 'Copy rows from another note or a sheet']);
    expect(view.dom.querySelector('.cm-grid-menu-line')).toBeTruthy();
    view.destroy();
    editor(`${NOTE}\n\n`);
    startChart(view);
    await settle();
    const copy = view.dom.querySelector('.cm-chart-picker .cm-chart-copy');
    expect(copy.textContent).toBe('Copy rows from another note or a sheet');
    press(copy);
    await settle();
    expect(view.dom.querySelector('.cm-chart-picker')).toBeNull();
    expect(words()).toEqual(['“Count”', '“Count”, table 2', 'Sightings']);
  });
});

describe('Read again, for rows from another note or a sheet', () => {
  const FROM_OTHER = CHARTED.replace('from: note:n1#count', 'from: note:n2#count');
  const FROM_SHEET = CHARTED.replace('from: note:n1#count', 'from: sheet:s1');

  it('asks the server for the rows, offers Read again once they differ, and copies them in as one step', async () => {
    server.rows = () => ({ found: true, name: 'Register', text: OTHER });
    editor(FROM_OTHER);
    await settle();
    // the editor says itself whether they match: the drawing is asked without the origin check
    expect(figureAsks()[0].body.origins).toBe(false);
    expect(server.asked.find((one) => one.path.endsWith('/rows')).body).toEqual({ origin: 'note:n2#count' });
    expect(tool('again').hidden).toBe(false);
    expect(tool('again').title).toBe('The table in “Register” changed: copy its rows again');
    press(tool('numbers-btn'));
    await settle();
    const said = chart().querySelector('.cm-chart-numbers-said');
    expect(said.querySelector('span').textContent).toBe('The table in “Register” changed since they were copied.');
    press([...said.querySelectorAll('.cm-chart-link')].find((node) => node.textContent === 'Read again'));
    expect(text()).toBe(FROM_OTHER.replace(`${TABLE}\n:::`, `${OTHER}\n:::`));
    undo(view);
    expect(text()).toBe(FROM_OTHER);
  });

  it('says a sheet’s rows are the same, and a source gone from the case', async () => {
    server.rows = () => ({ found: true, name: 'Sightings', text: TABLE });
    editor(FROM_SHEET);
    await settle();
    expect(tool('again').hidden).toBe(true);
    press(tool('numbers-btn'));
    await settle();
    expect(chart().querySelector('.cm-chart-numbers-said span').textContent).toBe('Same as the sheet “Sightings”.');
    view.destroy();
    forgetDrawings();
    server.rows = () => ({ found: false, name: '', text: '' });
    editor(FROM_SHEET);
    await settle();
    press(tool('numbers-btn'));
    await settle();
    expect(chart().querySelector('.cm-chart-numbers-said span').textContent).toBe('The sheet it came from is no longer in the case.');
    expect(tool('again').hidden).toBe(true);
  });
});
