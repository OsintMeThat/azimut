import { describe, expect, it } from 'vitest';
import { EditorState, Transaction } from '@codemirror/state';
import { history, redo, undo, undoDepth } from '@codemirror/commands';

import { fillDown } from './tableGrid.js';
import {
  FOLD_PAST, FOLD_SHOWN, chain, changeTable, rowsShown, tableIdAt, tableIds, tableNear, tableStartingAt, tablesOf,
} from './gridEdits.js';
import {
  duplicateRow, insertColumn, insertRow, moveColumn, moveRow, pasteInto, removeColumn, removeRow, setAlign, setCell, sortRows,
} from './tableText.js';

/**
 * Every gesture on a grid is one transaction: it changes only the lines it names,
 * and one Undo gives back the note byte for byte.
 */

/** An editor's state and dispatch, which is all a gesture and Undo need. */
function editor(doc) {
  let state = EditorState.create({ doc, extensions: [history(), tableIds] });
  return {
    get state() { return state; },
    dispatch(input) { state = (input instanceof Transaction ? input : state.update(input)).state; },
  };
}

const TABLE = [
  '| Model | Grade | At least |',
  '| --- | --- | ---: |',
  '| Streit Cougar | identified | 8 |',
  '| Al-Wahsh | almost sure | 2 |',
  '| Oshkosh M-ATV | identified | 7 |',
].join('\n');
const NOTE = `## Who made them\n\nWords before.\n\n${TABLE}\n\nWords after.\n`;
const AT = NOTE.indexOf('| Model');

const text = (view) => view.state.doc.toString();
const lines = (view) => text(view).split('\n');

/** Run `change` on the note's table, check it changed only `changed` lines, and that one Undo and one Redo give the bytes back. */
function gesture(change, changed) {
  const view = editor(NOTE);
  const depth = undoDepth(view.state);
  const done = changeTable(view, AT, change);
  expect(done).not.toBeNull();
  expect(undoDepth(view.state)).toBe(depth + 1);
  const before = NOTE.split('\n');
  const after = lines(view);
  if (changed) {
    const differing = after.filter((line, at) => line !== before[at]);
    expect(differing.length).toBeLessThanOrEqual(changed);
  }
  // the words around the table are untouched
  expect(text(view).startsWith('## Who made them\n\nWords before.\n\n')).toBe(true);
  expect(text(view).endsWith('\n\nWords after.\n')).toBe(true);
  const after1 = text(view);
  expect(undo(view)).toBe(true);
  expect(text(view)).toBe(NOTE);
  expect(redo(view)).toBe(true);
  expect(text(view)).toBe(after1);
  return after1;
}

describe('a gesture on a table', () => {
  it('writes a cell on its row\'s line only, and Undo gives the exact bytes back', () => {
    const out = gesture((table) => setCell(table, 1, 1, 'identified'), 1);
    expect(out).toContain('| Al-Wahsh | identified | 2 |');
  });

  it('adds, duplicates, moves and takes out rows in one step each', () => {
    expect(gesture((table) => insertRow(table, 3, ['BATT UMG', 'identified', '2']))).toContain('| Oshkosh M-ATV | identified | 7 |\n| BATT UMG | identified | 2 |');
    expect(gesture((table) => duplicateRow(table, 0))).toContain('| Streit Cougar | identified | 8 |\n| Streit Cougar | identified | 8 |');
    expect(gesture((table) => moveRow(table, 2, 0))).toContain('| ---: |\n| Oshkosh M-ATV');
    expect(gesture((table) => removeRow(table, 1))).not.toContain('Al-Wahsh');
  });

  it('adds, moves, aligns and takes out columns in one step each', () => {
    expect(gesture((table) => insertColumn(table, 1, { header: 'Maker' }))).toContain('| Model | Maker | Grade |');
    expect(gesture((table) => moveColumn(table, 2, 0))).toContain('| At least | Model | Grade |');
    expect(gesture((table) => setAlign(table, 0, 'center'), 1)).toContain('| :---: | --- | ---: |');
    expect(gesture((table) => removeColumn(table, 1))).toContain('| Model | At least |');
  });

  it('sorts in one step, numbers as numbers', () => {
    const out = gesture((table) => sortRows(table, 2, 'desc'));
    expect(out.indexOf('Streit Cougar')).toBeLessThan(out.indexOf('Oshkosh'));
    expect(out.indexOf('Oshkosh')).toBeLessThan(out.indexOf('Al-Wahsh'));
  });

  it('fills a column down, each empty cell taking the one above, a total left alone', () => {
    const note = '| Video | Time |\n| --- | --- |\n| V1 | 0:23 |\n|  | 0:44 |\n| V2 | 1:44 |\n|  | 2:12 |\n| **Total** |  |';
    const view = editor(note);
    changeTable(view, 0, (table) => fillDown(table, 0));
    expect(text(view)).toBe('| Video | Time |\n| --- | --- |\n| V1 | 0:23 |\n| V1 | 0:44 |\n| V2 | 1:44 |\n| V2 | 2:12 |\n| **Total** |  |');
    undo(view);
    expect(text(view)).toBe(note);
  });

  it('pastes cells from a cell on, adding the rows and columns it needs, in one step', () => {
    const out = gesture((table) => pasteInto(table, { row: 2, column: 2 }, [['7', 'x'], ['1', 'y']]));
    expect(out).toContain('| Oshkosh M-ATV | identified | 7 | x |');
    expect(out).toContain('| | | 1 | y |');
  });

  it('keeps two cell edits apart in the history, even typed at once', () => {
    const view = editor(NOTE);
    changeTable(view, AT, (table) => setCell(table, 0, 0, 'Cougar'));
    const between = text(view);
    changeTable(view, AT, (table) => setCell(table, 1, 0, 'Wahsh'));
    undo(view);
    expect(text(view)).toBe(between);
    undo(view);
    expect(text(view)).toBe(NOTE);
  });

  it('makes a cell and a new row one step when they are one gesture (Tab past the last cell)', () => {
    const view = editor(NOTE);
    changeTable(view, AT, (table) => chain(table, (t) => setCell(t, 2, 2, '9'), (t) => insertRow(t, t.rows.length, ['BMC Kirpi II'])));
    expect(text(view)).toContain('| Oshkosh M-ATV | identified | 9 |\n| BMC Kirpi II | | |');
    undo(view);
    expect(text(view)).toBe(NOTE);
  });

  it('writes nothing when the cell already says it', () => {
    const view = editor(NOTE);
    expect(changeTable(view, AT, (table) => setCell(table, 0, 0, 'Streit Cougar'))).toBeNull();
    expect(undoDepth(view.state)).toBe(0);
  });

  it('leaves a note that cannot be written alone', () => {
    let state = EditorState.create({ doc: NOTE, extensions: [history(), EditorState.readOnly.of(true)] });
    const view = { get state() { return state; }, dispatch: (spec) => { state = state.update(spec).state; } };
    expect(changeTable(view, AT, (table) => setCell(table, 0, 0, 'x'))).toBeNull();
    expect(state.doc.toString()).toBe(NOTE);
  });
});

describe('chips in cells', () => {
  const CHIPS = [
    '| Date | Proof | Source |',
    '| --- | --- | --- |',
    '| 14 Sep | [[entity:e_76f5a1c5cc|YEMEN Proof 50]] | [x.com/BashaReport](https://x.com/BashaReport/status/2099613631310688603) |',
    '| 9 Oct | Proof 1 (PNG missing) | [[media:e_7c175733d2|Figure 1]] |',
  ].join('\n');

  it('keeps every chip byte for byte when a cell beside it is typed in', () => {
    const view = editor(CHIPS);
    changeTable(view, 0, (table) => setCell(table, 0, 0, '14 September'));
    expect(lines(view)[2]).toBe('| 14 September | [[entity:e_76f5a1c5cc|YEMEN Proof 50]] | [x.com/BashaReport](https://x.com/BashaReport/status/2099613631310688603) |');
    expect(lines(view)[3]).toBe('| 9 Oct | Proof 1 (PNG missing) | [[media:e_7c175733d2|Figure 1]] |');
  });

  it('never escapes a chip\'s own pipe, and escapes a typed one', () => {
    const view = editor(CHIPS);
    changeTable(view, 0, (table) => setCell(table, 1, 1, 'a | b [[entity:e_1|One]]'));
    expect(lines(view)[3]).toBe('| 9 Oct | a \\| b [[entity:e_1|One]] | [[media:e_7c175733d2|Figure 1]] |');
    undo(view);
    expect(text(view)).toBe(CHIPS);
  });
});

describe('which table is which', () => {
  it('reads tables as the renderers do: a chip in a header, a table in an aligned block', () => {
    const note = '| [[entity:e_1|Video 1]] | Time |\n| --- | --- |\n| A | 0:23 |\n\n::: center\n| a | b |\n| --- | --- |\n| 1 | 2 |\n:::\n';
    const state = EditorState.create({ doc: note });
    const found = tablesOf(state);
    expect(found).toHaveLength(2);
    expect(found[0].table.header).toEqual(['[[entity:e_1|Video 1]]', 'Time']);
    expect(note.slice(found[1].from, found[1].to)).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |');
    expect(tableStartingAt(state, found[1].from)).toBe(found[1]);
    expect(tableNear(state, found[1].to)).toBe(found[1]);
    expect(tableNear(state, note.indexOf(':::'))).toBeNull();
  });

  it('names each table for good: typing above one keeps its name, a new one gets its own', () => {
    const view = editor(NOTE);
    const id = tableIdAt(view.state, AT);
    expect(id).not.toBeNull();
    view.dispatch({ changes: { from: 0, insert: 'A line.\n\n' } });
    expect(tableIdAt(view.state, AT + 9)).toBe(id);
    changeTable(view, AT + 9, (table) => setCell(table, 0, 0, 'Cougar'));
    expect(tableIdAt(view.state, AT + 9)).toBe(id);
    view.dispatch({ changes: { from: 0, insert: '| a |\n| - |\n| 1 |\n\n' } });
    const ids = view.state.field(tableIds).map((item) => item.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids[1]).toBe(id);
  });
});

describe('long tables', () => {
  it('shows the first rows of a table past the fold, all of one opened whole', () => {
    expect(FOLD_PAST).toBe(30);
    expect(rowsShown(30)).toBe(30);
    expect(rowsShown(31)).toBe(FOLD_SHOWN);
    expect(rowsShown(60)).toBe(FOLD_SHOWN);
    expect(rowsShown(60, true)).toBe(60);
  });
});
