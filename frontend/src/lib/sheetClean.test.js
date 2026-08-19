import { describe, expect, it } from 'vitest';
import {
  MAX_PARTS,
  caseEdits,
  extractTable,
  mergeTable,
  replaceEdits,
  splitPreview,
  splitTable,
  tidyEdits,
} from './sheetClean.js';
import { emptyMeta } from './sheet.js';

const table = () => ({
  columns: ['id', 'Place', 'Status', 'Source'],
  rows: [
    ['r1', 'Kherson, Ukraine', 'OK en cours', 'seen at https://t.me/chan/12 today'],
    ['r2', ' Mykolaiv , Ukraine ', 'done', 'no source'],
    ['r3', 'Odesa', 'OK en cours', 'https://example.org/a and https://t.me/chan/13'],
  ],
});

const everyRow = [0, 1, 2];

describe('replacing a word', () => {
  it('rewrites only the cells that change', () => {
    const edits = replaceEdits(table(), {
      columns: [2],
      rows: everyRow,
      find: 'OK en cours',
      replace: 'in progress',
    });
    expect(edits.map((edit) => edit.row)).toEqual([0, 2]);
    expect(edits[0].after).toBe('in progress');
  });

  it('replaces every occurrence in a cell, not just the first', () => {
    const one = { columns: ['id', 'Note'], rows: [['r1', 'a-a-a']] };
    expect(replaceEdits(one, { columns: [1], rows: [0], find: 'a', replace: 'b' })[0].after)
      .toBe('b-b-b');
  });

  it('is case-insensitive unless told otherwise', () => {
    const one = { columns: ['id', 'Note'], rows: [['r1', 'Done']] };
    expect(replaceEdits(one, { columns: [1], rows: [0], find: 'done', replace: 'x' })[0].after)
      .toBe('x');
    expect(replaceEdits(one, { columns: [1], rows: [0], find: 'done', replace: 'x', matchCase: true }))
      .toEqual([]);
  });

  it('tells a value from a substring when the whole cell is asked for', () => {
    const one = { columns: ['id', 'Note'], rows: [['r1', 'undone'], ['r2', 'done']] };
    const edits = replaceEdits(one, {
      columns: [1], rows: [0, 1], find: 'done', replace: 'ruled out', wholeCell: true,
    });
    expect(edits.map((edit) => edit.row)).toEqual([1]);
  });

  it('never writes the row handle, whatever it is asked', () => {
    expect(replaceEdits(table(), { columns: [0], rows: everyRow, find: 'r', replace: 'x' }))
      .toEqual([]);
  });

  it('finds nothing to do when nothing is asked for', () => {
    expect(replaceEdits(table(), { columns: [2], rows: everyRow, find: '' })).toEqual([]);
  });
});

describe('taking the spacing out', () => {
  it('trims the ends and collapses what is inside', () => {
    const edits = tidyEdits(table(), [1], everyRow);
    expect(edits).toHaveLength(1);
    expect(edits[0].after).toBe('Mykolaiv , Ukraine');
  });

  it('keeps the line breaks a note column holds', () => {
    const one = { columns: ['id', 'Note'], rows: [['r1', ' two\n  lines ']] };
    expect(tidyEdits(one, [1], [0])[0].after).toBe('two\nlines');
  });
});

describe('recasing a column', () => {
  it('upper, lower and one that reads like a name', () => {
    const one = { columns: ['id', 'Place'], rows: [['r1', 'saint-jean de LUZ']] };
    expect(caseEdits(one, [1], [0], 'upper')[0].after).toBe('SAINT-JEAN DE LUZ');
    expect(caseEdits(one, [1], [0], 'lower')[0].after).toBe('saint-jean de luz');
    expect(caseEdits(one, [1], [0], 'title')[0].after).toBe('Saint-Jean De Luz');
  });

  it('refuses a casing it does not know rather than guessing one', () => {
    expect(caseEdits(table(), [1], everyRow, 'sentence')).toEqual([]);
  });
});

describe('splitting a column', () => {
  it('says what it would do before doing it', () => {
    const read = splitPreview(table(), 1, ',');
    expect(read.parts).toBe(2);
    expect(read.rows).toBe(2);
    expect(read.samples[0]).toEqual(['Kherson', 'Ukraine']);
  });

  it('makes one column per part, beside the original, and keeps it', () => {
    const { table: next, names } = splitTable(table(), emptyMeta(), 1, { separator: ',' });
    expect(names).toEqual(['Place 1', 'Place 2']);
    expect(next.columns).toEqual(['id', 'Place', 'Place 1', 'Place 2', 'Status', 'Source']);
    expect(next.rows[0].slice(1, 4)).toEqual(['Kherson, Ukraine', 'Kherson', 'Ukraine']);
    expect(next.rows[2].slice(2, 4)).toEqual(['Odesa', '']);
  });

  it('drops the original on request, and what the sidecar knew about it', () => {
    const meta = { ...emptyMeta(), widths: { Place: 200 }, frozen: 'Place' };
    const { table: next, meta: moved } = splitTable(table(), meta, 1, {
      separator: ',', keep: false,
    });
    expect(next.columns).toEqual(['id', 'Place 1', 'Place 2', 'Status', 'Source']);
    expect(moved.widths.Place).toBeUndefined();
    expect(moved.frozen).toBeNull();
  });

  it('does nothing where the separator is nowhere in the column', () => {
    const { table: next, names } = splitTable(table(), emptyMeta(), 1, { separator: '|' });
    expect(names).toEqual([]);
    expect(next.columns).toHaveLength(4);
  });

  it('keeps the tail of a cell that breaks into more parts than there are columns', () => {
    // Twelve segments used to become eight columns and four segments written nowhere — and
    // with the original dropped after them, the words were gone from the file. The last
    // column keeps the rest, the way every maxsplit does.
    const wide = {
      columns: ['id', 'Prose'],
      rows: [['r1', 'a,b,c,d,e,f,g,h,i,j,k,l']],
    };
    const read = splitPreview(wide, 1, ',');
    expect(read.parts).toBe(MAX_PARTS);
    expect(read.over).toBe(1);
    expect(read.samples[0].at(-1)).toBe('h,i,j,k,l');

    const { table: next } = splitTable(wide, emptyMeta(), 1, { separator: ',', keep: false });
    expect(next.columns).toEqual([
      'id', 'Prose 1', 'Prose 2', 'Prose 3', 'Prose 4', 'Prose 5', 'Prose 6', 'Prose 7', 'Prose 8',
    ]);
    // Nothing dropped: every segment is still readable in the row.
    expect(next.rows[0].slice(1).join(',')).toBe('a,b,c,d,e,f,g,h,i,j,k,l');
  });

  it('says nothing about a tail when every cell fits', () => {
    expect(splitPreview(table(), 1, ',').over).toBe(0);
  });
});

describe('merging columns', () => {
  it('writes one column after the last of them and leaves the empties out', () => {
    const { table: next, name } = mergeTable(table(), emptyMeta(), [1, 2], { joiner: ' — ' });
    expect(name).toBe('Place + Status');
    expect(next.columns[3]).toBe('Place + Status');
    expect(next.rows[0][3]).toBe('Kherson, Ukraine — OK en cours');
  });

  it('joins nothing onto nothing rather than leaving a bare separator', () => {
    const one = { columns: ['id', 'A', 'B'], rows: [['r1', '', 'only']] };
    expect(mergeTable(one, emptyMeta(), [1, 2], { joiner: ', ' }).table.rows[0][3]).toBe('only');
  });

  it('refuses to merge one column with itself', () => {
    expect(mergeTable(table(), emptyMeta(), [1], {}).name).toBeNull();
  });

  it('drops the originals on request', () => {
    const { table: next } = mergeTable(table(), emptyMeta(), [1, 2], { keep: false });
    expect(next.columns).toEqual(['id', 'Place + Status', 'Source']);
  });
});

describe('lifting the links out of a column', () => {
  it('makes a column of the addresses it found', () => {
    const { table: next, name, filled } = extractTable(table(), emptyMeta(), 3, { what: 'url' });
    expect(name).toBe('Source links');
    expect(filled).toBe(2);
    expect(next.rows[0][4]).toBe('https://t.me/chan/12');
    expect(next.rows[2][4]).toBe('https://example.org/a, https://t.me/chan/13');
    expect(next.rows[1][4]).toBe('');
  });

  it('makes a column of hosts, deduplicated, which is what counts as a reading', () => {
    const { table: next } = extractTable(table(), emptyMeta(), 3, { what: 'host' });
    expect(next.rows[2][4]).toBe('example.org, t.me');
  });

  it('adds no column where the column holds no link at all', () => {
    const { table: next, name } = extractTable(table(), emptyMeta(), 1, { what: 'url' });
    expect(name).toBeNull();
    expect(next.columns).toHaveLength(4);
  });
});
