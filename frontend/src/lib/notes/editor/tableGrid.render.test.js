// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorSelection, EditorState } from '@codemirror/state';
import { undo, undoDepth } from '@codemirror/commands';

const { focusedState, noteExtensions, registerTableChart, setNoteCase, setNoteMode } = await import('../liveMarkdown.js');
const { pickedCell, pickCell } = await import('./tablePictures.js');

/**
 * A table on the drawn page is a grid: a press puts the caret in a cell, the keys
 * move between cells, and each cell written is one step Undo takes back whole.
 */

const VIDEO = { id: 'v1', type: 'media', label: 'Ground tour', attrs: { path: 'media/tour.mp4', kind: 'video' } };
const ROOF = { id: 'm1', type: 'media', label: 'Roof', attrs: { path: 'media/roof.png', kind: 'image' } };
const PROOF = { id: 'e_50', type: 'proof', label: 'YEMEN Proof 50', attrs: {} };
const QUAY = { id: 'p1', type: 'place', label: 'Quay', attrs: {} };
const ENTITIES = [VIDEO, ROOF, PROOF, QUAY];

const TABLE = '| Model | Grade | At least |\n| --- | --- | ---: |\n| Streit Cougar | identified | 8 |\n| Al-Wahsh | almost sure | 2 |';
const NOTE = `Words before.\n\n${TABLE}\n\nWords after.`;

let view;
let handlers;
afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
  pickCell('c1:n1', null);
  vi.useRealTimers();
});

function editor(doc, { readOnly = false, mode = 'drawn', extra = {} } = {}) {
  const parent = document.createElement('div');
  document.body.append(parent);
  handlers = { tableToast: vi.fn(), open: vi.fn(), cutFrame: vi.fn(), noteKey: 'c1:n1', ...extra };
  view = new EditorView({ parent, state: EditorState.create({ doc, extensions: noteExtensions({ handlers, readOnly, mode }) }) });
  view.dispatch({ effects: setNoteCase.of({ caseId: 'c1', entities: ENTITIES }) });
  view.setState(focusedState(view.state.update({ selection: EditorSelection.cursor(0) }).state));
  view.dispatch({ effects: setNoteCase.of({ caseId: 'c1', entities: ENTITIES }) });
  view.focus = vi.fn();
  return view;
}

const text = () => view.state.doc.toString();
const grid = (at = 0) => view.dom.querySelectorAll('.cm-grid-block')[at];
const cell = (row, col, at = 0) => grid(at).querySelector(`.cm-grid-cell[data-row="${row}"][data-col="${col}"]`);
const field = () => view.dom.querySelector('.cm-grid-input');
const mouse = (node, type = 'mousedown', extra = {}) => node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...extra }));
const press = (node) => {
  mouse(node, 'mousedown');
  node.click();
};
function key(name, options = {}, target = field()) {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}
/** Type in the open field, as the browser does: its value, then an input event. */
function type(words, { replace = true } = {}) {
  const input = field();
  input.value = replace ? words : `${input.value}${words}`;
  input.setSelectionRange(input.value.length, input.value.length);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('the grid drawn', () => {
  it('draws a table as a grid with its bar, numbered rows and a menu on each column', () => {
    editor(NOTE);
    const box = grid();
    expect(box).toBeTruthy();
    expect([...box.querySelectorAll('thead .cm-grid-text')].map((node) => node.textContent)).toEqual(['Model', 'Grade', 'At least']);
    expect([...box.querySelectorAll('.cm-grid-rowbtn')].map((node) => node.textContent)).toEqual(['1', '2']);
    expect(box.querySelectorAll('.cm-grid-colbtn')).toHaveLength(3);
    const tools = [...box.querySelectorAll('.cm-grid-bar button')].map((node) => node.getAttribute('aria-label') ?? node.textContent);
    // the charts' own lot registers the Chart button (`editor/chartBlock.js`); Settings is `tableSettings.js`'
    expect(tools).toEqual(['Row', 'Column', 'Paste from a spreadsheet', 'From a file', 'Settings', 'Chart', 'More', 'Edit the source']);
    expect(cell(0, 2).style.textAlign).toBe('right');
    // the words around it stay words
    expect(view.contentDOM.textContent).toContain('Words before.');
  });

  it('draws chips, links and pictures in their cells, and opens a chip on Ctrl+click', () => {
    editor('| Proof | Source | Picture |\n| --- | --- | --- |\n| [[entity:e_50|YEMEN Proof 50]] | [site](https://example.org/a) | [[media:m1|Roof]] |');
    const chip = cell(0, 0).querySelector('.cm-chip');
    expect(chip.textContent).toContain('YEMEN Proof 50');
    expect(cell(0, 1).querySelector('a').getAttribute('href')).toBe('https://example.org/a');
    expect(cell(0, 2).querySelector('img.cm-grid-thumb').getAttribute('src')).toContain('roof.png');
    // a press types in the cell; Ctrl+click opens the record, as a link opens
    mouse(chip);
    expect(handlers.open).not.toHaveBeenCalled();
    expect(field().value).toBe('[[entity:e_50|YEMEN Proof 50]]');
    key('Escape');
    mouse(cell(0, 0).querySelector('.cm-chip'), 'mousedown', { ctrlKey: true });
    expect(handlers.open).toHaveBeenCalledWith(PROOF);
  });

  it('draws a table whose header holds a chip, which the Markdown parser misses', () => {
    editor('| [[entity:v1|Ground tour]] | Frame |\n| --- | --- |\n| 0:23 |  |');
    expect(grid()).toBeTruthy();
    expect(cell(-1, 0).querySelector('.cm-chip').textContent).toContain('Ground tour');
  });

  it('shows the Chart button once the lot that draws charts registers it', () => {
    const open = vi.fn();
    const undoChart = registerTableChart(open);
    editor(NOTE);
    const chart = grid().querySelector('.cm-grid-chart');
    expect(chart).toBeTruthy();
    press(chart);
    expect(open).toHaveBeenCalledWith(view, expect.objectContaining({ from: NOTE.indexOf('| Model') }));
    undoChart();
    editor(NOTE);
    expect(grid().querySelector('.cm-grid-chart')).toBeNull();
  });

  it('stays the plain table in a note nobody can write in, and the pipes in the raw Markdown', () => {
    editor(NOTE, { readOnly: true });
    expect(grid().querySelector('.cm-grid-bar')).toBeNull();
    mouse(cell(0, 0));
    expect(field()).toBeNull();
    editor(NOTE);
    setNoteMode(view, 'markdown');
    expect(view.dom.querySelector('.cm-grid-block')).toBeNull();
    expect(view.contentDOM.textContent).toContain('| Model | Grade | At least |');
  });
});

describe('typing in a cell', () => {
  it('opens a press on a cell as its Markdown, and writes it on Tab as one step', () => {
    editor(NOTE);
    mouse(cell(1, 1));
    expect(field().value).toBe('almost sure');
    expect(document.activeElement).toBe(field());
    type('identified');
    expect(text()).toBe(NOTE);
    const depth = undoDepth(view.state);
    key('Tab');
    expect(text()).toBe(NOTE.replace('| Al-Wahsh | almost sure | 2 |', '| Al-Wahsh | identified | 2 |'));
    expect(undoDepth(view.state)).toBe(depth + 1);
    expect(field().value).toBe('2');
    expect(field().closest('.cm-grid-cell').dataset.col).toBe('2');
    expect(undo(view)).toBe(true);
    expect(text()).toBe(NOTE);
  });

  it('shows a cell\'s chips as their Markdown while it is typed in', () => {
    editor('| Proof | Note |\n| --- | --- |\n| [[entity:e_50|YEMEN Proof 50]] | x |');
    mouse(cell(0, 0));
    expect(field().value).toBe('[[entity:e_50|YEMEN Proof 50]]');
    key('Escape');
    expect(text()).toBe('| Proof | Note |\n| --- | --- |\n| [[entity:e_50|YEMEN Proof 50]] | x |');
  });

  it('moves with Tab, Shift+Tab, Enter, Shift+Enter and the arrows at a cell\'s edges', () => {
    editor(NOTE);
    mouse(cell(0, 0));
    const at = () => [Number(field().closest('.cm-grid-cell').dataset.row), Number(field().closest('.cm-grid-cell').dataset.col)];
    key('Tab');
    expect(at()).toEqual([0, 1]);
    key('Tab', { shiftKey: true });
    expect(at()).toEqual([0, 0]);
    key('Enter');
    expect(at()).toEqual([1, 0]);
    key('Enter', { shiftKey: true });
    expect(at()).toEqual([0, 0]);
    key('ArrowUp');
    expect(at()).toEqual([-1, 0]);
    key('ArrowDown');
    expect(at()).toEqual([0, 0]);
    // Right at the end of a cell goes on; Left inside the words is the field's own
    key('ArrowRight');
    expect(at()).toEqual([0, 1]);
    field().setSelectionRange(3, 3);
    expect(key('ArrowLeft').defaultPrevented).toBe(false);
    field().setSelectionRange(0, 0);
    key('ArrowLeft');
    expect(at()).toEqual([0, 0]);
    key('Tab', { shiftKey: true });
    expect(at()).toEqual([-1, 2]);
    expect(text()).toBe(NOTE);
  });

  it('opens a new row past the last cell, written once something is typed in it', () => {
    editor(NOTE);
    mouse(cell(1, 2));
    key('Tab');
    expect(grid().querySelector('.cm-grid-ghost')).toBeTruthy();
    expect(text()).toBe(NOTE);
    type('BMC Kirpi II');
    key('Tab');
    expect(text()).toContain('| Al-Wahsh | almost sure | 2 |\n| BMC Kirpi II | | |\n\nWords after.');
    expect(grid().querySelector('.cm-grid-ghost')).toBeNull();
    type('identified');
    key('Tab');
    type('1');
    key('Enter');
    expect(text()).toContain('| BMC Kirpi II | identified | 1 |\n\nWords after.');
    // Enter left a new row open under it; leaving it empty writes nothing
    expect(grid().querySelector('.cm-grid-ghost')).toBeTruthy();
    key('Escape');
    expect(grid().querySelector('.cm-grid-ghost')).toBeNull();
    expect(text()).toContain('| BMC Kirpi II | identified | 1 |\n\nWords after.');
    // three cells, three steps
    undo(view);
    undo(view);
    undo(view);
    expect(text()).toBe(NOTE);
  });

  it('leaves the grid on Escape, the table picked, and around it with the arrows', () => {
    editor(NOTE);
    mouse(cell(0, 0));
    type('Cougar');
    key('Escape');
    expect(field()).toBeNull();
    expect(text()).toContain('| Cougar | identified | 8 |');
    expect(view.state.selection.main.head).toBe(NOTE.indexOf('| Model'));
    mouse(cell(-1, 1));
    key('ArrowUp');
    expect(field()).toBeNull();
    expect(view.state.selection.main.head).toBe('Words before.\n'.length);
    mouse(cell(1, 1));
    key('ArrowDown');
    expect(view.state.selection.main.head).toBe(text().indexOf('Words after.') - 1);
  });

  it('never draws the cell being typed in again, whatever else changes', () => {
    editor(`${NOTE}\n\n| A | B |\n| --- | --- |\n| 1 | 2 |`);
    mouse(cell(0, 0));
    const input = field();
    type('Cougar (typed)');
    // another row of the same table changes (another editor of the note), then the other table
    const other = text().indexOf('| Al-Wahsh');
    view.dispatch({ changes: { from: other + 2, to: other + 10, insert: 'Wahsh' } });
    expect(field()).toBe(input);
    expect(input.value).toBe('Cougar (typed)');
    expect(cell(1, 0).textContent).toBe('Wahsh');
    const second = text().lastIndexOf('| 1 | 2 |');
    view.dispatch({ changes: { from: second + 2, to: second + 3, insert: 'one' } });
    expect(field()).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(cell(0, 0, 1).textContent).toBe('one');
    key('Tab');
    expect(text()).toContain('| Cougar (typed) | identified | 8 |');
  });

  it('keeps the caret in the grid when a chip goes in the header, which the Markdown parser then misses', () => {
    editor(NOTE);
    mouse(cell(-1, 0));
    type('[[entity:v1|Model]]');
    key('Tab');
    expect(text()).toContain('| [[entity:v1|Model]] | Grade | At least |');
    expect(document.activeElement).toBe(field());
    expect(field().value).toBe('Grade');
    type('Grade [[entity:p1|Quay]]');
    key('Tab');
    expect(document.activeElement).toBe(field());
    expect(field().value).toBe('At least');
    expect(view.dom.querySelectorAll('.cm-grid-block')).toHaveLength(1);
  });

  it('takes Undo in a cell with nothing typed as the grid\'s Undo', () => {
    editor(NOTE);
    mouse(cell(0, 0));
    type('Cougar');
    key('Tab');
    expect(text()).toContain('| Cougar |');
    const event = key('z', { ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(text()).toBe(NOTE);
    // with something typed, Undo is the field's
    type('2nd');
    expect(key('z', { ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it('lets a composition finish: Enter while composing is the input method\'s', () => {
    editor(NOTE);
    mouse(cell(0, 0));
    field().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    type('ストライト');
    const event = key('Enter', { isComposing: true });
    expect(event.defaultPrevented).toBe(false);
    expect(field().closest('.cm-grid-cell').dataset.row).toBe('0');
    expect(text()).toBe(NOTE);
    field().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'ストライト' }));
    key('Enter');
    expect(text()).toContain('| ストライト | identified | 8 |');
  });

  it('writes what was typed when the caret leaves the grid for anywhere else', () => {
    editor(NOTE);
    mouse(cell(0, 1));
    type('confirmed');
    field().dispatchEvent(new FocusEvent('blur'));
    expect(text()).toContain('| Streit Cougar | confirmed | 8 |');
    // the cell stays picked for a tool's picture, until the note's text is pressed
    expect(pickedCell('c1:n1')).toEqual({ table: 0, row: 0, col: 1 });
    expect(cell(0, 1).classList.contains('cm-grid-picked')).toBe(true);
    view.contentDOM.dispatchEvent(new FocusEvent('focus'));
    expect(pickedCell('c1:n1')).toBeNull();
  });
});

describe('the @ menu in a cell', () => {
  it('offers the case\'s records and writes the chip picked', () => {
    editor(NOTE);
    mouse(cell(0, 0));
    type('Seen at @Qu');
    const menu = view.dom.querySelector('.cm-grid-mention');
    expect(menu).toBeTruthy();
    expect(menu.querySelector('li[aria-selected] .cm-completionLabel').textContent).toBe('Quay');
    key('Enter');
    expect(field().value).toBe('Seen at [[entity:p1|Quay]] ');
    expect(view.dom.querySelector('.cm-grid-mention')).toBeNull();
    key('Tab');
    expect(text()).toContain('| Seen at [[entity:p1|Quay]] | identified | 8 |');
  });
});

describe('the bar and the menus', () => {
  const menuItem = (label) => [...view.dom.querySelectorAll('.cm-grid-menu-item')].find((node) => node.textContent.startsWith(label));

  it('adds a row and a column at the end, the caret in them', () => {
    editor(NOTE);
    press(grid().querySelector('.cm-grid-add-row'));
    expect(text()).toContain('| Al-Wahsh | almost sure | 2 |\n| | | |\n\nWords after.');
    expect(field().closest('.cm-grid-cell').dataset.row).toBe('2');
    press(grid().querySelector('.cm-grid-add-col'));
    expect(text()).toContain('| Model | Grade | At least | |');
    expect(field().closest('.cm-grid-cell').dataset.row).toBe('-1');
    expect(field().closest('.cm-grid-cell').dataset.col).toBe('3');
    undo(view);
    undo(view);
    expect(text()).toBe(NOTE);
  });

  it('sorts a column of numbers from its menu, in one step', () => {
    editor(NOTE);
    press(cell(-1, 2).querySelector('.cm-grid-colbtn'));
    expect(menuItem('Sort 9 → 1')).toBeTruthy();
    press(menuItem('Sort 1 → 9'));
    expect(text().indexOf('Al-Wahsh')).toBeLessThan(text().indexOf('Streit Cougar'));
    undo(view);
    expect(text()).toBe(NOTE);
  });

  it('aligns, inserts, moves, fills down and deletes columns from their menu', () => {
    editor(NOTE);
    press(cell(-1, 0).querySelector('.cm-grid-colbtn'));
    press(menuItem('Align right'));
    expect(text()).toContain('| ---: | --- | ---: |');
    press(cell(-1, 1).querySelector('.cm-grid-colbtn'));
    press(menuItem('Insert a column left'));
    expect(text()).toContain('| Model | | Grade | At least |');
    expect(field().closest('.cm-grid-cell').dataset.col).toBe('1');
    key('Escape');
    press(cell(-1, 1).querySelector('.cm-grid-colbtn'));
    press(menuItem('Delete the column'));
    expect(text()).toContain('| Model | Grade | At least |');
    press(cell(-1, 0).querySelector('.cm-grid-colbtn'));
    press(menuItem('Move right'));
    expect(text()).toContain('| Grade | Model | At least |');
  });

  it('inserts, duplicates, moves and deletes rows from their number', () => {
    editor(NOTE);
    press(grid().querySelectorAll('.cm-grid-rowbtn')[1]);
    press(menuItem('Move up'));
    expect(text().indexOf('Al-Wahsh')).toBeLessThan(text().indexOf('Streit Cougar'));
    press(grid().querySelectorAll('.cm-grid-rowbtn')[0]);
    press(menuItem('Duplicate'));
    expect(text().match(/Al-Wahsh/g)).toHaveLength(2);
    press(grid().querySelectorAll('.cm-grid-rowbtn')[0]);
    press(menuItem('Delete the row'));
    expect(text().match(/Al-Wahsh/g)).toHaveLength(1);
    press(grid().querySelectorAll('.cm-grid-rowbtn')[0]);
    press(menuItem('Insert a row above'));
    expect(text()).toContain('| --- | --- | ---: |\n| | | |\n| Al-Wahsh');
    expect(field().closest('.cm-grid-cell').dataset.row).toBe('0');
  });
});

describe('pasting cells', () => {
  function pasteIn(target, { html = '', text: words = '' }) {
    const data = new DataTransfer();
    if (words) data.setData('text/plain', words);
    if (html) data.setData('text/html', html);
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: data });
    target.dispatchEvent(event);
    return event;
  }

  it('fills the grid from the cell pasted into, adding rows and columns', () => {
    editor(NOTE);
    mouse(cell(1, 1));
    const event = pasteIn(field(), { text: 'identified\t3\tUAE\nidentified\t1\tUSA' });
    expect(event.defaultPrevented).toBe(true);
    expect(text()).toContain('| Model | Grade | At least | |');
    expect(text()).toContain('| Al-Wahsh | identified | 3 | UAE |\n| | identified | 1 | USA |');
    expect(handlers.tableToast).toHaveBeenCalledWith('Pasted 2 rows × 3 columns from a spreadsheet.', [], 'info');
    undo(view);
    expect(text()).toBe(NOTE);
  });

  it('leaves words pasted in a cell to the cell', () => {
    editor(NOTE);
    mouse(cell(0, 0));
    expect(pasteIn(field(), { text: 'just words' }).defaultPrevented).toBe(false);
    expect(text()).toBe(NOTE);
  });
});

describe('long tables', () => {
  const long = (count) => `| # | Model |\n| --- | --- |\n${Array.from({ length: count }, (_, at) => `| ${at + 1} | V${at + 1} |`).join('\n')}`;

  it('shows the first rows of a long table and how many more, opened whole on a press', () => {
    editor(long(60));
    expect(grid().querySelectorAll('tbody .cm-grid-row')).toHaveLength(20);
    const fold = grid().querySelector('.cm-grid-foldbtn');
    expect(fold.textContent).toBe('40 more rows · show all 60');
    press(fold);
    expect(grid().querySelectorAll('tbody .cm-grid-row')).toHaveLength(60);
    expect(grid().querySelector('.cm-grid-foldbtn').textContent).toBe('Show the first 20 only');
    // drawn again (a change in it), it stays whole
    mouse(cell(40, 1));
    type('Changed');
    key('Enter');
    expect(grid().querySelectorAll('tbody .cm-grid-row').length).toBeGreaterThanOrEqual(60);
  });

  it('opens a folded table whole when the caret goes past its fold', () => {
    editor(long(40));
    mouse(cell(19, 1));
    key('Enter');
    expect(grid().querySelectorAll('tbody .cm-grid-row')).toHaveLength(40);
    expect(field().closest('.cm-grid-cell').dataset.row).toBe('20');
  });

  it('leaves a table of thirty rows whole', () => {
    editor(long(30));
    expect(grid().querySelectorAll('tbody .cm-grid-row')).toHaveLength(30);
    expect(grid().querySelector('.cm-grid-fold').hidden).toBe(true);
  });
});

describe('pictures in cells', () => {
  const WALL = '| # | Model | [[entity:v1|Ground tour]] | Frame |\n| --- | --- | --- | --- |\n| 1 | Streit Cougar | S04 0:23-0:37 |  |\n| 2 | Al-Wahsh | – |  |\n| 3 | BATT UMG | 4:18 | [[media:m1|Roof]] |';

  it('offers to cut the frame of an empty picture cell whose row names a video and a time', () => {
    editor(WALL);
    const cut = cell(0, 3).querySelector('.cm-grid-cut');
    expect(cut).toBeTruthy();
    expect(cut.textContent).toContain('0:23');
    // no time in the row, or a picture there already: no offer
    expect(cell(1, 3).querySelector('.cm-grid-cut')).toBeNull();
    expect(cell(2, 3).querySelector('.cm-grid-cut')).toBeNull();
    press(cut);
    expect(handlers.cutFrame).toHaveBeenCalledWith({ entity: VIDEO, time: 23 });
    expect(pickedCell('c1:n1')).toEqual({ table: 0, row: 0, col: 3 });
  });

  it('takes a case picture dropped on a cell as its chip', () => {
    editor(WALL);
    const data = new DataTransfer();
    data.setData('application/x-azimut-media', JSON.stringify([{ path: 'media/roof.png', title: 'Roof' }]));
    const over = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(over, 'dataTransfer', { value: data });
    cell(1, 3).dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: data });
    cell(1, 3).dispatchEvent(drop);
    expect(text()).toContain('| 2 | Al-Wahsh | – | [[media:m1|Roof]] |');
    undo(view);
    expect(text()).toBe(WALL);
  });
});
