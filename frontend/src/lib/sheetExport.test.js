import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn(async () => ({ file: 'Candidates.csv', path: '/cases/harbour/exports' }));
vi.mock('./api.js', () => ({ api: { post } }));

const { exportCsv, provenance, revealSheetExports, toMarkdown, viewTable } = await import(
  './sheetExport.js'
);

const table = {
  columns: ['id', 'Subject', 'Status', 'Notes'],
  rows: [
    ['r1', 'Quai sud', 'ruled out', 'seen'],
    ['r2', 'Pont nord', '', ''],
    ['r3', 'Gare est', 'to check', 'asked'],
  ],
};

/** The grid's own shape: the columns drawn, each carrying the index it reads from. */
const drawn = (...names) =>
  names.map((name) => ({ name, index: table.columns.indexOf(name) }));

describe('what an export carries', () => {
  it('takes the columns drawn, in the order they are drawn', () => {
    // A column moved or hidden in the grid is a decision about how the table reads, and
    // the file handed over is that reading rather than the one on disk.
    const view = viewTable(table, drawn('id', 'Status', 'Subject'), [0, 1, 2]);
    expect(view.columns).toEqual(['id', 'Status', 'Subject']);
    expect(view.rows[0]).toEqual(['r1', 'ruled out', 'Quai sud']);
  });

  it('takes the rows on screen, in the order they are on screen', () => {
    // Filtered to the rows left to check and sorted: exporting all four hundred would
    // hand over a file the analyst did not ask for and did not read.
    const view = viewTable(table, drawn('id', 'Subject'), [2, 1]);
    expect(view.rows).toEqual([
      ['r3', 'Gare est'],
      ['r2', 'Pont nord'],
    ]);
  });

  it('reads a short row as empty cells rather than as undefined', () => {
    const ragged = { columns: ['id', 'Subject'], rows: [['r1']] };
    expect(viewTable(ragged, drawn('id', 'Subject'), [0]).rows).toEqual([['r1', '']]);
  });
});

describe('handing the file over', () => {
  beforeEach(() => post.mockClear());

  it('asks the server to write it, and says where it landed', async () => {
    // The CSV is written on the Python side, into the folder this case files sheets in:
    // one CSV writer in the app, and one place finished work goes.
    const answer = await exportCsv('case-a', 'e_sheet', { columns: ['id'], rows: [['r1']] });

    expect(post).toHaveBeenCalledWith('/api/cases/case-a/sheets/e_sheet/csv', {
      columns: ['id'],
      rows: [['r1']],
    });
    expect(answer.file).toBe('Candidates.csv');
    expect(answer.path).toBe('/cases/harbour/exports');
  });

  it('opens that folder without being told where it is', async () => {
    await revealSheetExports('case-a');
    expect(post).toHaveBeenCalledWith('/api/cases/case-a/sheets/csv/reveal');
  });
});

describe('the same reading as a Markdown table', () => {
  it('writes a header, a rule and the rows', () => {
    const view = viewTable(table, drawn('Subject', 'Status'), [0, 1]);
    expect(toMarkdown(view)).toBe(
      '| Subject | Status |\n| --- | --- |\n| Quai sud | ruled out |\n| Pont nord |  |\n',
    );
  });

  it('keeps a cell from breaking the table it sits in', () => {
    const view = { columns: ['Note'], rows: [['a | b\ntwo lines']] };
    expect(toMarkdown(view)).toContain('| a \\| b<br>two lines |');
  });

  it('writes nothing for a view with no column', () => {
    expect(toMarkdown({ columns: [], rows: [] })).toBe('');
  });
});

describe('where a copied table came from', () => {
  it('states the case, the sheet, how much of it and when', () => {
    // What the retired sheet plate was actually for. Twelve rows pasted into a ticket
    // with no case and no filter are twelve rows nobody can check a week later.
    expect(
      provenance({
        caseName: 'Harbour',
        sheet: 'Geolocation index',
        filter: 'Coordinates is empty',
        sort: 'Date, newest first',
        shown: 12,
        total: 468,
        at: '2026-08-17T14:32:07.000Z',
      }),
    ).toEqual([
      'Harbour · Geolocation index — 12 of 468 rows',
      'Showing Coordinates is empty',
      'Sorted by Date, newest first',
      '2026-08-17 14:32',
    ]);
  });

  it('says nothing about a filter or a sort that is not on', () => {
    expect(provenance({ caseName: 'Harbour', sheet: 'Leads', shown: 3, total: 3 })).toEqual([
      'Harbour · Leads — 3 of 3 rows',
    ]);
    expect(provenance()).toEqual([]);
  });

  it('quotes those lines above the table, so they are read before the numbers', () => {
    const view = viewTable(table, drawn('Subject'), [0]);
    expect(toMarkdown(view, ['Harbour · Leads — 1 of 3 rows'])).toBe(
      '> Harbour · Leads — 1 of 3 rows\n\n| Subject |\n| --- |\n| Quai sud |\n',
    );
    // And a table copied without them is the table it always was.
    expect(toMarkdown(view)).toBe('| Subject |\n| --- |\n| Quai sud |\n');
  });
});
