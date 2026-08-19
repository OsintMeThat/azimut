import { describe, expect, it } from 'vitest';
import { describeDiff, diffTables, sameTable } from './sheetDiff.js';

const MINE = {
  columns: ['id', 'Subject', 'Status'],
  rows: [
    ['r1', 'Quai sud', 'done'],
    ['r2', 'Pont nord', ''],
  ],
};

describe('what the grid holds against what the file says', () => {
  it('counts the rows the file has that the grid never saw, and the other way', () => {
    // Phrased from the grid's side, because that is what the analyst is choosing between:
    // `rowsAdded` are the rows an overwrite would delete.
    const diff = diffTables(MINE, {
      columns: ['id', 'Subject', 'Status'],
      rows: [
        ['r1', 'Quai sud', 'done'],
        ['r3', 'Zone 5', 'to do'],
      ],
    });
    expect(diff.rowsAdded).toBe(1);
    expect(diff.rowsGone).toBe(1);
    expect(diff.cellsChanged).toBe(0);
  });

  it('matches rows by key, so a file somebody sorted is not four hundred changes', () => {
    const sorted = { columns: MINE.columns, rows: [...MINE.rows].reverse() };
    expect(sameTable(diffTables(MINE, sorted))).toBe(true);
  });

  it('lists the differing cells, with both readings', () => {
    const diff = diffTables(MINE, {
      columns: ['id', 'Subject', 'Status'],
      rows: [
        ['r1', 'Quai sud', 'ruled out'],
        ['r2', 'Pont nord', ''],
      ],
    });
    expect(diff.cellsChanged).toBe(1);
    expect(diff.changed).toEqual([
      { key: 'r1', column: 'Status', mine: 'done', theirs: 'ruled out' },
    ]);
  });

  it('cuts the list at a sample, because a wall of rows is not evidence', () => {
    const many = (status) => ({
      columns: ['id', 'Status'],
      rows: Array.from({ length: 40 }, (_, index) => [`r${index}`, status]),
    });
    const diff = diffTables(many('done'), many('to do'));
    expect(diff.cellsChanged).toBe(40);
    expect(diff.changed).toHaveLength(12);
  });

  it('names the columns each side has that the other has not', () => {
    const diff = diffTables(MINE, {
      columns: ['id', 'Subject', 'Verdict'],
      rows: [['r1', 'Quai sud', 'yes']],
    });
    expect(diff.columnsAdded).toEqual(['Verdict']);
    expect(diff.columnsGone).toEqual(['Status']);
  });

  it('says the table is the same when a spreadsheet only rewrote every byte of it', () => {
    // A stamp moves whenever the file is written, and opening a CSV and saving it
    // unchanged is exactly that. Saying so is the answer that ends the banner.
    const diff = diffTables(MINE, structuredClone(MINE));
    expect(sameTable(diff)).toBe(true);
    expect(describeDiff(diff)).toBe('The file holds the same table, written again.');
  });

  it('says the difference in one line, from the file side', () => {
    const said = describeDiff({
      rowsAdded: 3,
      rowsGone: 0,
      cellsChanged: 1,
      columnsAdded: ['Verdict'],
      columnsGone: [],
      changed: [],
    });
    expect(said).toBe('On disk: 3 rows not in this grid, 1 cell written differently, a new column (Verdict).');
  });
});
