import { describe, expect, it, vi } from 'vitest';
import { EditorState, Transaction } from '@codemirror/state';
import { history, undo, undoDepth } from '@codemirror/commands';

vi.mock('../../api.js', () => ({ api: { post: vi.fn(() => new Promise(() => {})), postBytes: vi.fn(() => new Promise(() => {})) } }));

import {
  dataPanel, dataPanels, dataSaid, dataState, pageWords, readData, sourceChoices,
} from './infographicData.js';
import {
  WRITTEN_ORDER, dataOf, infographicsIn, inheritingPanels, inherits, ownSourcePanels, panelText, readInfographic,
  withDataSource, withSetting,
} from './infographicText.js';
import { readChart, setting } from './chartText.js';
import { replaceBlock } from './infographicBlock.js';

/**
 * An infographic's data (`infographicData.js`, `infographicText.js`): `data:` names a sheet or
 * a table of a note, the chart panels whose columns it holds take it, and Change… writes the
 * page as one change, so one Undo gives the note back; the panels follow the data by
 * themselves (`follow.test.js`).
 */

const REGISTER = ['| Model | Made in | Grade |', '| --- | --- | --- |', '| Streit Cougar | UAE | Confirmed |', '| Al-Wahsh | Jordan | Almost sure |'].join('\n');
const EDITED = `${REGISTER}\n| Oshkosh M-ATV | USA | Confirmed |`;
const FIGURES = '::: chart\nkind: key figures\n| Figure | Words |\n| --- | --- |\n| 51 of 54 | placed |\n:::';
const chart = (title, table, extra = []) => ['::: chart', 'kind: bars', `title: ${title}`, 'count: rows', 'by: Model', ...extra, table, ':::'].join('\n');
const LOST = chart('What was lost', REGISTER, ['from: note:n1#the-register']);
const GRADES = chart('Grades', REGISTER.split('\n').map((line) => line.replace(/\| [^|]* \|$/, '|')).join('\n'));
const OWN = chart('Seen', REGISTER, ['from: sheet:s9']);
const BLOCK = [':::: infographic', 'title: At least 2 vehicles lost', '', FIGURES, '', LOST, '', GRADES, '', OWN, '::::'].join('\n');
const NOTE = `# Losses\n\n${BLOCK}\n\n## The register\n\n${REGISTER}\n`;

function editor(doc) {
  let state = EditorState.create({ doc, extensions: [history()] });
  return {
    get state() { return state; },
    dispatch(input) { state = (input instanceof Transaction ? input : state.update(input)).state; },
  };
}

/** Run `change` on the note's infographic through the editor: one change, one Undo, the bytes back. */
function gesture(note, change) {
  const view = editor(note);
  const [found] = infographicsIn(note);
  expect(replaceBlock(view, found.from, found.to, change(found.source), found.source)).toBe(true);
  const after = view.state.doc.toString();
  expect(undoDepth(view.state)).toBe(1);
  undo(view);
  expect(view.state.doc.toString()).toBe(note);
  return infographicsIn(after)[0].source;
}

const sheetData = (text = REGISTER, total = 0) => ({ found: true, name: 'Vehicle register', text, total });

describe('the data line', () => {
  it('is written first, as one line, and read back', () => {
    expect(WRITTEN_ORDER[0]).toBe('data');
    const set = withSetting(BLOCK, 'data', 'sheet:s1');
    expect(set.split('\n').slice(0, 3)).toEqual([':::: infographic', 'data: sheet:s1', 'title: At least 2 vehicles lost']);
    expect(dataOf(set)).toBe('sheet:s1');
    expect(dataOf(BLOCK)).toBe('');
  });

  it('lets the panels whose columns the data holds take it, never typed-in figures or a source of their own', () => {
    const columns = ['Model', 'Made in', 'Grade'];
    expect(readInfographic(BLOCK).panels.map((panel) => panel.origin)).toEqual(['', 'note:n1#the-register', '', 'sheet:s9']);
    expect([0, 1, 2, 3].map((index) => inherits(BLOCK, index, columns))).toEqual([false, false, true, false]);
    expect(inheritingPanels(BLOCK, columns)).toEqual([2]);
    expect(ownSourcePanels(BLOCK)).toEqual([1, 3]);
    // a column the data lacks makes the rows the panel's own
    expect(inheritingPanels(BLOCK, ['Model'])).toEqual([]);
  });
});

describe('Change…', () => {
  it('sets the data and, the first time, gives it the charts drawn from a table of its columns, their rows read in, as one Undo', () => {
    const after = gesture(NOTE, (source) => withDataSource(source, 'sheet:s1', EDITED).text);
    expect(dataOf(after)).toBe('sheet:s1');
    const panels = readInfographic(after).panels;
    // the chart copied from the note's register takes the data; the one with a sheet of its own (same columns) too
    expect(panels.map((panel) => panel.origin)).toEqual(['', '', '', '']);
    for (const index of [1, 2, 3]) expect(readChart(panelText(after, index)).table.rows).toHaveLength(3);
    // its settings stay, its figures typed in stay
    expect(setting(readChart(panelText(after, 1)), 'title')).toBe('What was lost');
    expect(panelText(after, 0)).toBe(FIGURES);
  });

  it('changing data later leaves a panel with a source of its own as it was, unless it named this very source', () => {
    const set = withSetting(BLOCK, 'data', 'sheet:s1');
    const made = withDataSource(set, 'sheet:s9', EDITED);
    const panels = readInfographic(made.text).panels;
    expect(panels.map((panel) => panel.origin)).toEqual(['', 'note:n1#the-register', '', '']);
    expect(made.panels).toEqual([2, 3]);
    expect(readChart(panelText(made.text, 1)).table.rows).toHaveLength(2);
  });
});

describe('what the bar says', () => {
  it('reads a sheet from the server, fresh when asked, and says it as a chart’s Data line does, with its rows and its readers', async () => {
    const rows = vi.fn(async () => sheetData(EDITED, 3));
    const source = withSetting(BLOCK, 'data', 'sheet:s1');
    const state = await dataState({ caseId: 'c1', noteId: 'n1', noteText: NOTE, source, fresh: true }, { rows });
    expect(rows).toHaveBeenCalledWith({ caseId: 'c1', origin: 'sheet:s1', fresh: true });
    expect(pageWords('sheet:s1', state.data)).toMatchObject({ name: 'Sheet “Vehicle register”', act: { id: 'sheet', label: 'Open in Sheet' }, state: '' });
    expect(pageWords('sheet:s1', state.data, { held: true }).state).toBe('an older copy, kept by Undo');
    expect(state.panels).toEqual({ inheriting: [2], own: [1, 3], differs: [2] });
    expect(dataSaid(state.data, state.panels)).toBe('3 rows · 1 panel read it');
    const same = dataPanels(source, (await readData({ caseId: 'c1', origin: 'sheet:s1' }, { rows: async () => sheetData() })));
    expect(same.differs).toEqual([]);
  });

  it('says a chart holds the first rows of a long sheet, and when the data is gone', async () => {
    const long = await readData({ caseId: 'c1', origin: 'sheet:s1' }, { rows: async () => sheetData(REGISTER, 620) });
    expect(dataSaid(long, { inheriting: [], own: [], differs: [] })).toBe('first 2 of 620 rows · no panel reads it yet');
    const gone = await readData({ caseId: 'c1', origin: 'sheet:s1' }, { rows: async () => ({ found: false, name: '', text: '' }) });
    expect(pageWords('sheet:s1', gone)).toEqual({ name: 'A sheet no longer in the case', act: null, state: 'the chart keeps its copy' });
    expect(dataSaid(gone, dataPanels(BLOCK, gone))).toBe('');
    expect(pageWords('', null).name).toBe('Each panel’s own rows');
  });

  it('reads a table of this very note as it is typed, without asking', async () => {
    const rows = vi.fn();
    const data = await readData({ caseId: 'c1', noteId: 'n1', noteText: NOTE, origin: 'note:n1#the-register' }, { rows });
    expect(rows).not.toHaveBeenCalled();
    expect(data).toMatchObject({ found: true, local: true, name: 'The register', rows: 2, columns: ['Model', 'Made in', 'Grade'] });
    expect(pageWords('note:n1#the-register', data, { noteId: 'n1' }).name).toBe('Table “The register” of this note');
    expect(pageWords('note:n2#the-register', { ...data, local: false, name: 'Register' }, { noteId: 'n1' }).name).toBe('Table “The register” of the note “Register”');
  });
});

describe('the source picker’s choices', () => {
  it('lists the sheets first, then this note’s tables outside its figures, the one in use marked', () => {
    const sheets = [{ origin: 'sheet:s1', title: 'Vehicle register', rows: 60, columns: ['Model', 'Grade'] }];
    const choices = sourceChoices({ sheets, noteId: 'n1', noteText: NOTE, current: 'note:n1#the-register' });
    expect(choices.map((one) => [one.group, one.label, one.hint, one.current])).toEqual([
      ['sheet', 'Vehicle register', 'Sheet · 60 rows', false],
      ['table', 'The register', 'This note · 2 rows', true],
    ]);
    // a note with no id (a template) offers only the sheets
    expect(sourceChoices({ sheets, noteText: NOTE })).toHaveLength(1);
  });
});

describe('a new panel from the data', () => {
  it('writes the kind picked with the data’s rows and no from:, so it takes the page’s data', () => {
    const panel = dataPanel({ settings: { kind: 'donut', count: 'rows', by: 'Made in' }, title: 'Where they were made' }, REGISTER);
    const read = readChart(panel);
    expect(setting(read, 'from')).toBe('');
    expect(setting(read, 'title')).toBe('Where they were made');
    expect(read.text).toBe(REGISTER);
  });
});
