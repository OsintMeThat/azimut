import { describe, expect, it } from 'vitest';
import {
  MAX_PASTE_ROWS,
  linkRows,
  looksLikeLinks,
  parseBlock,
  pasteBlock,
  toBlock,
} from './sheetClipboard.js';
import { keyIndex } from './sheet.js';

const table = () => ({
  columns: ['id', 'Subject', 'Status'],
  rows: [
    ['r1', 'Quai sud', 'ruled out'],
    ['r2', 'Pont nord', ''],
  ],
});

describe('reading a clipboard block', () => {
  it('splits cells on tabs and rows on newlines', () => {
    expect(parseBlock('a\tb\nc\td')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('keeps a quoted note whole, line breaks and tabs and all', () => {
    // What a spreadsheet actually puts on the clipboard for a cell holding
    // sentences. Reading it naively turns one row of prose into three rows.
    const block = parseBlock('AB-123\t"two\nlines\there"\nAB-124\tplain');
    expect(block).toEqual([
      ['AB-123', 'two\nlines\there'],
      ['AB-124', 'plain'],
    ]);
  });

  it('reads a doubled quote as one quote', () => {
    expect(parseBlock('"he said ""no"""')).toEqual([['he said "no"']]);
  });

  it('reads an unclosed quote to the end rather than refusing the paste', () => {
    expect(parseBlock('"never closed\tstill mine')).toEqual([['never closed\tstill mine']]);
  });

  it('normalises the line endings every platform sends', () => {
    expect(parseBlock('a\r\nb\rc')).toEqual([['a'], ['b'], ['c']]);
  });

  it('treats the trailing line break as a terminator, not an empty row', () => {
    expect(parseBlock('a\tb\n')).toEqual([['a', 'b']]);
  });

  it('keeps a genuinely blank row in the middle', () => {
    expect(parseBlock('a\n\nb')).toEqual([['a'], [''], ['b']]);
  });

  it('reads nothing out of nothing', () => {
    expect(parseBlock('')).toEqual([]);
    expect(parseBlock(null)).toEqual([]);
  });
});

describe('writing a range to the clipboard', () => {
  it('separates with tabs, which is what a spreadsheet expects to receive', () => {
    expect(toBlock([['a', 'b'], ['c', 'd']])).toBe('a\tb\nc\td');
  });

  it('quotes a cell a reader would otherwise read as several', () => {
    expect(toBlock([['two\nlines']])).toBe('"two\nlines"');
    expect(toBlock([['with\ttab']])).toBe('"with\ttab"');
    expect(toBlock([['he said "no"']])).toBe('"he said ""no"""');
  });

  it('round-trips whatever it wrote', () => {
    const range = [['plain', 'two\nlines'], ['he said "no"', 'with\ttab']];
    expect(parseBlock(toBlock(range))).toEqual(range);
  });
});

describe('a block of links', () => {
  it('is recognised by having links and no tabs', () => {
    expect(looksLikeLinks('https://a.example/x\nhttps://b.example/y')).toBe(true);
    // One link is a cell someone pasted into a cell, not an inbox.
    expect(looksLikeLinks('https://a.example/x')).toBe(false);
    // A table has tabs, whatever its cells hold.
    expect(looksLikeLinks('https://a.example\tnote\nhttps://b.example\tnote')).toBe(false);
  });

  it('becomes one row per link, even when prose surrounds them', () => {
    const text = 'look at https://a.example/one\nand also https://b.example/two, later';
    expect(linkRows(text)).toEqual([['https://a.example/one'], ['https://b.example/two']]);
  });

  it('keeps a repeated link rather than deciding it was a mistake', () => {
    expect(linkRows('https://a.example\nhttps://a.example')).toHaveLength(2);
  });
});

describe('pasting into a table', () => {
  it('writes the block where the cursor is', () => {
    const { table: next } = pasteBlock(table(), [['A', 'B']], { row: 0, column: 1 });
    expect(next.rows[0]).toEqual(['r1', 'A', 'B']);
    expect(next.rows[1]).toEqual(['r2', 'Pont nord', '']);
  });

  it('never mutates the table it was handed', () => {
    const before = table();
    pasteBlock(before, [['A']], { row: 0, column: 1 });
    expect(before.rows[0][1]).toBe('Quai sud');
  });

  it('grows the sheet by as many rows as the block needs, each with its own key', () => {
    const { table: next, added } = pasteBlock(
      table(),
      [['A'], ['B'], ['C']],
      { row: 1, column: 1 },
    );
    expect(added).toBe(2);
    expect(next.rows).toHaveLength(4);
    expect(next.rows.map((row) => row[1])).toEqual(['Quai sud', 'A', 'B', 'C']);
    const keys = next.rows.map((row) => row[keyIndex(next.columns)]);
    expect(new Set(keys).size).toBe(4);
    expect(keys[3]).toMatch(/^r[0-9a-f]{10}$/);
  });

  it('clips a block wider than the table and says by how much', () => {
    // Inventing a column would change the file's schema from a keystroke, and a
    // heading nobody chose is worse than a cell that did not fit.
    const { table: next, clipped } = pasteBlock(table(), [['A', 'B', 'C']], { row: 0, column: 1 });
    expect(clipped).toBe(1);
    expect(next.columns).toEqual(['id', 'Subject', 'Status']);
    expect(next.rows[0]).toEqual(['r1', 'A', 'B']);
  });

  it('never writes the key column, whatever lands on it', () => {
    const { table: next } = pasteBlock(table(), [['stolen', 'A']], { row: 0, column: 0 });
    expect(next.rows[0][0]).toBe('r1');
    expect(next.rows[0][1]).toBe('A');
  });

  it('skips the key column when it is not the first, rather than shifting the block', () => {
    const moved = {
      columns: ['Subject', 'id', 'Status'],
      rows: [['Quai sud', 'r1', 'ruled out']],
    };
    const { table: next } = pasteBlock(moved, [['A', 'B', 'C']], { row: 0, column: 0 });
    expect(next.rows[0]).toEqual(['A', 'r1', 'C']);
  });

  it('lands on the rows that are on screen, not on the ones under them in the file', () => {
    // Three rows of a filtered sheet were copied off the screen; they have to come back
    // to the screen. Writing rows 1..3 of the file would fill rows nobody can see.
    const filtered = {
      columns: ['id', 'Subject', 'Status'],
      rows: [
        ['r1', 'Quai sud', 'ruled out'],
        ['r2', 'hidden', ''],
        ['r3', 'Pont nord', ''],
        ['r4', 'hidden', ''],
      ],
    };
    const { table: next } = pasteBlock(filtered, [['A'], ['B']], { row: 0, column: 1 }, {
      rows: [0, 2],
      columns: [0, 1, 2],
    });
    expect(next.rows.map((row) => row[1])).toEqual(['A', 'hidden', 'B', 'hidden']);
  });

  it('walks the columns in the order they are drawn', () => {
    const { table: next } = pasteBlock(table(), [['A', 'B']], { row: 0, column: 2 }, {
      rows: [0, 1],
      columns: [0, 2, 1],
    });
    expect(next.rows[0]).toEqual(['r1', 'B', 'A']);
  });

  it('counts a column that is not drawn as one the block did not fit in', () => {
    const { table: next, clipped } = pasteBlock(table(), [['A', 'B']], { row: 0, column: 1 }, {
      rows: [0, 1],
      columns: [0, 1],
    });
    expect(clipped).toBe(1);
    expect(next.rows[0]).toEqual(['r1', 'A', 'ruled out']);
  });

  it('grows past the last row on screen rather than past the last row of the file', () => {
    const filtered = {
      columns: ['id', 'Subject', 'Status'],
      rows: [
        ['r1', 'Quai sud', ''],
        ['r2', 'hidden', ''],
      ],
    };
    const { table: next, added } = pasteBlock(filtered, [['A'], ['B']], { row: 0, column: 1 }, {
      rows: [0],
      columns: [0, 1, 2],
    });
    expect(added).toBe(1);
    expect(next.rows.map((row) => row[1])).toEqual(['A', 'hidden', 'B']);
  });

  it('falls back to the file\'s order for a cell the view does not hold', () => {
    // The pinned row is drawn above the list, so it is in no view; a paste on it still
    // has to land on it.
    const { table: next } = pasteBlock(table(), [['A']], { row: 1, column: 1 }, {
      rows: [0],
      columns: [0, 1, 2],
    });
    expect(next.rows[1][1]).toBe('A');
  });

  it('bounds how far one paste may grow the sheet', () => {
    expect(MAX_PASTE_ROWS).toBe(20_000);
    const huge = Array.from({ length: MAX_PASTE_ROWS + 10 }, (_, index) => [`v${index}`]);
    const { added } = pasteBlock(table(), huge, { row: 0, column: 1 });
    expect(added).toBe(MAX_PASTE_ROWS);
  });
});
