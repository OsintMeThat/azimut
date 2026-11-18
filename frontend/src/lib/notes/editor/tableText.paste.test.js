// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import excel from './fixtures/paste-excel.html?raw';
import libreOffice from './fixtures/paste-libreoffice.html?raw';
import sheets from './fixtures/paste-sheets.html?raw';
import web from './fixtures/paste-web.html?raw';
import { gridToTable, parseTable, pasteInto, readClipboard, readColumns, readHtmlTable, serializeTable } from './tableText.js';

// read as Vite hands them over: under happy-dom a test's own address is no file path
const FIXTURES = { 'paste-excel.html': excel, 'paste-libreoffice.html': libreOffice, 'paste-sheets.html': sheets, 'paste-web.html': web };
const fixture = (name) => FIXTURES[name];

describe('a spreadsheet\'s HTML', () => {
  it('reads Excel\'s: its styles left out, a line break a space, a merged cell spread out', () => {
    const grid = readHtmlTable(fixture('paste-excel.html'));
    expect(grid).toMatchObject({ format: 'html', header: true });
    expect(grid.cells).toEqual([
      ['Model', 'Grade', 'At least', 'Unit price'],
      ['Streit Cougar', 'identified', '8', '1\u00a0234,5'],
      ['Harrow Tygor E1', 'almost sure second look', '7', '120,0'],
      ['Al-Wahsh', 'almost sure', '2', ''],
      ['Total identified', '', '17', '5\\*3\\*2 | x'],
    ]);
  });

  it('reads LibreOffice\'s own export: the cell spanning two rows repeats in both', () => {
    const grid = readHtmlTable(fixture('paste-libreoffice.html'));
    expect(grid.cells).toEqual([
      ['Model', 'Grade', 'At least', 'Unit price'],
      ['Streit Cougar', 'identified', '8', '1\u00a0234,5'],
      ['Streit Cougar', 'almost sure second line', '2', '[source](https://example.org/price) | note'],
      ['Total identified', '', '10', '\\*not\\* [priced]'],
    ]);
    expect(grid.header).toBe(true);
  });

  it('reads Google Sheets\': numbers as written, its link kept, a chip typed in it kept as text', () => {
    const grid = readHtmlTable(fixture('paste-sheets.html'));
    expect(grid.cells).toEqual([
      ['Date', 'Vehicles', 'Share', 'Source'],
      ['2026-11-13', '1,234', '12.5%', '[Agency report](https://example.org/report?id=7&lang=en)'],
      ['2026-11-14', '56', '87.5%', 'Two lines in one cell'],
      ['Merged across', '', '', '\\[\\[entity:e_1|kept as text\\]\\]'],
    ]);
    const [date, vehicles, share] = readColumns(gridToTable(grid).table);
    expect(date.numeric).toBe(false);
    expect(vehicles.values).toEqual([1234, 56, null]);
    expect(share).toMatchObject({ numeric: true, unit: '%', values: [12.5, 87.5, null] });
  });

  it('writes a pasted chip-like text so it stays text, its pipe escaped', () => {
    const { text } = gridToTable(readHtmlTable(fixture('paste-sheets.html')));
    expect(text.split('\n').at(-1)).toBe('| Merged across | | | \\[\\[entity:e_1\\|kept as text\\]\\] |');
    expect(parseTable(text).rows[2][3]).toBe('\\[\\[entity:e_1|kept as text\\]\\]');
  });
});

describe('a web page\'s table', () => {
  const grid = readHtmlTable(fixture('paste-web.html'));

  it('takes the data table, not the layout around it, with its caption', () => {
    expect(grid.caption).toBe('Armoured vehicles by maker');
    expect(grid.cells[0]).toEqual(['Maker', 'Model', 'Price (USD) Low', 'Price (USD) High', 'Seen']);
    expect(grid.header).toBe(true);
  });

  it('spreads merged cells: down a row span, across only once, hidden words left out', () => {
    expect(grid.cells.slice(1)).toEqual([
      ['[Streit Group](https://example.org/wiki/Streit_Group)', 'Cougar[1]', '150,000', '250,000', '8'],
      ['[Streit Group](https://example.org/wiki/Streit_Group)', 'Spartan SUT', '180,000', '350,000', '2'],
      ['Oshkosh', 'M-ATV', 'about 470,000 ([order](https://example.org/order%20%282009%29))', '', '≥ 7'],
      ['NIMR', 'Ajban 440A', '250,000', '450,000', '1'],
    ]);
  });

  it('becomes a table whose number columns are set right, three numbers in four being enough', () => {
    const { table, text } = gridToTable(grid);
    expect(table.align).toEqual([null, null, 'right', 'right', 'right']);
    expect(text.split('\n')[1]).toBe('| --- | --- | ---: | ---: | ---: |');
    expect(readColumns(table)[4]).toMatchObject({ numeric: true, values: [8, 2, 7, 1], floors: [false, false, true, false] });
  });
});

describe('the clipboard', () => {
  it('prefers the HTML table, and falls back to tab-separated text', () => {
    const html = fixture('paste-excel.html');
    expect(readClipboard({ html, text: 'Model\tGrade\n' }).format).toBe('html');
    expect(readClipboard({ html: '<p>words</p>', text: 'a\tb\n1\t2\n' })).toMatchObject({ format: 'tsv', cells: [['a', 'b'], ['1', '2']] });
    expect(readClipboard({ html: '<p>words</p>', text: 'words' })).toBeNull();
  });

  it('gives a single copied cell as a 1×1 grid', () => {
    const grid = readClipboard({ html: '<table><tr><td>one</td></tr></table>', text: 'one' });
    expect(grid.cells).toEqual([['one']]);
    expect(grid.header).toBe(false);
  });

  it('guesses a header from the words when no row says it', () => {
    expect(readHtmlTable('<table><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></table>').header).toBe(false);
    expect(readHtmlTable('<table><tr><th>a</th><th>b</th></tr><tr><th>row</th><td>4</td></tr></table>').cells[1]).toEqual(['row', '4']);
  });

  it('keeps a huge span from blowing the grid up', () => {
    const grid = readHtmlTable('<table><tr><td colspan="100000">wide</td></tr><tr><td rowspan="99999">tall</td><td>x</td></tr></table>');
    expect(grid.cells[0].length).toBeLessThanOrEqual(200);
    expect(grid.cells).toHaveLength(2);
  });

  it('is null without a table', () => {
    expect(readHtmlTable('<p>no table</p>')).toBeNull();
    expect(readHtmlTable('')).toBeNull();
  });

  it('fills a grid from the pressed cell', () => {
    const before = parseTable('| a | b |\n| --- | --- |\n| 1 | 2 |');
    const grid = readClipboard({ text: 'x\ty\nz\tw' });
    const { text } = pasteInto(before, { row: 0, column: 0 }, grid.cells);
    expect(text).toBe('| a | b |\n| --- | --- |\n| x | y |\n| z | w |');
    expect(serializeTable(before)).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |');
  });
});
