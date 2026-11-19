// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../api.js', () => ({ api: { post: vi.fn() } }));

import { createData, fileKind, gridToSheet, readPaste, sheetCell } from './newData.js';

/**
 * *New data…* (`newData.js`): a table pasted is read by the note grid's own paste reader and
 * kept as a sheet's plain cells; a CSV and a workbook go to the Sheet tool's own imports.
 */

const HTML = `<table><thead><tr><th>Model</th><th>Made in</th><th>Source</th></tr></thead><tbody>
  <tr><td>Streit Cougar</td><td>UAE</td><td><a href="https://example.org/v1">video 1</a></td></tr>
  <tr><td>Al-Wahsh</td><td>Jordan</td><td>https://example.org/v2</td></tr></tbody></table>`;

describe('a paste', () => {
  it('reads a spreadsheet’s HTML table, its header and its links kept as a sheet holds them', () => {
    const grid = readPaste({ html: HTML, text: 'Model\tMade in\tSource\n' });
    expect(grid.header).toBe(true);
    expect(gridToSheet(grid)).toEqual({
      columns: ['Model', 'Made in', 'Source'],
      rows: [['Streit Cougar', 'UAE', 'video 1 (https://example.org/v1)'], ['Al-Wahsh', 'Jordan', 'https://example.org/v2']],
    });
  });

  it('reads cells copied from a spreadsheet as text, and a CSV typed in', () => {
    const grid = readPaste({ text: 'Model\tGrade\nCougar\tConfirmed\nM-ATV\tAlmost sure\n' });
    expect(gridToSheet(grid).rows).toEqual([['Cougar', 'Confirmed'], ['M-ATV', 'Almost sure']]);
    expect(gridToSheet(readPaste({ text: 'Model;Grade\nCougar;Confirmed\n' })).columns).toEqual(['Model', 'Grade']);
    // the first row as a row, its columns named for the analyst to rename
    expect(gridToSheet(grid, { header: false }).columns).toEqual(['Column 1', 'Column 2']);
    expect(gridToSheet(grid, { header: false }).rows).toHaveLength(3);
  });

  it('is no table when it holds words', () => {
    expect(readPaste({ text: 'Just a sentence about vehicles.' })).toBeNull();
    expect(readPaste({ text: '' })).toBeNull();
  });

  it('turns the grid’s Markdown back into plain words', () => {
    expect(sheetCell('a \\*starred\\* \\| piped')).toBe('a *starred* | piped');
    expect(sheetCell('[https://x.org](https://x.org)')).toBe('https://x.org');
  });
});

describe('making the sheet', () => {
  it('files a paste as a sheet with its rows, under the name given', async () => {
    const post = vi.fn(async () => ({ id: 'e_s1', label: 'Vehicle register' }));
    const grid = readPaste({ html: HTML });
    const made = await createData({ caseId: 'c 1', name: ' Vehicle register ', grid }, { post });
    expect(post).toHaveBeenCalledWith('/api/cases/c%201/sheets', {
      title: 'Vehicle register', columns: ['Model', 'Made in', 'Source'],
      rows: [['Streit Cougar', 'UAE', 'video 1 (https://example.org/v1)'], ['Al-Wahsh', 'Jordan', 'https://example.org/v2']],
    });
    expect(made).toEqual({ id: 'e_s1', title: 'Vehicle register', others: [] });
  });

  it('files a CSV through the Sheet tool’s import, and a workbook a sheet a tab, the first the data', async () => {
    const post = vi.fn(async (path) => (path.endsWith('import-xlsx')
      ? { sheets: [{ id: 'e_a', label: 'Register' }, { id: 'e_b', label: 'Timeline' }], empty: [] }
      : { id: 'e_c', label: 'Losses' }));
    const csv = new File(['Model,Grade\nCougar,Confirmed\n'], 'losses.csv', { type: 'text/csv' });
    expect(await createData({ caseId: 'c1', name: 'Losses', file: csv }, { post })).toEqual({ id: 'e_c', title: 'Losses', others: [] });
    expect(post).toHaveBeenLastCalledWith('/api/cases/c1/sheets/import', { title: 'Losses', text: 'Model,Grade\nCougar,Confirmed\n' });
    const book = new File(['PK'], 'binder.xlsx');
    expect(await createData({ caseId: 'c1', name: '', file: book }, { post })).toEqual({ id: 'e_a', title: 'Register', others: ['Timeline'] });
    expect(post.mock.lastCall[0]).toBe('/api/cases/c1/sheets/import-xlsx');
    expect(post.mock.lastCall[1]).toBeInstanceOf(FormData);
  });

  it('asks for a name and a table first', async () => {
    const post = vi.fn();
    await expect(createData({ caseId: 'c1', name: '', grid: readPaste({ html: HTML }) }, { post })).rejects.toThrow('name the data first');
    await expect(createData({ caseId: 'c1', name: 'X', grid: null }, { post })).rejects.toThrow('paste a table first');
    expect(post).not.toHaveBeenCalled();
    expect([fileKind('a.XLSX'), fileKind('b.csv'), fileKind('c.tsv'), fileKind('d.pdf')]).toEqual(['xlsx', 'csv', 'csv', '']);
  });
});
