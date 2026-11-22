import { describe, expect, it } from 'vitest';

import {
  EMPTY_COLUMNS, EMPTY_FIRST, columnShares, inRowLine, isEmptyColumn, movedColumn, pictureOf, picturesOnly, readColumns, rowOf, rowsIn,
  takenApart, takenOut, widthIn, widthsOf, withColumnAdded, withColumnText, withCount, withWidths, writeColumns,
} from './columns.js';

/**
 * A row of columns read and written as plain text: what each gesture of the editor
 * writes, and what the preview and the `/` menu read. Nothing written is ever lost: what
 * a column gives up goes under the row.
 */

const ROOF = '[[media:m1|Roof]]{caption="The roof"}';
const YARD = '[[media:m2|Yard]]';
const PICTURES = `:::: columns\n::: column\n${ROOF}\n:::\n::: column\n${YARD}\n:::\n::::`;
const WORDS = ':::: columns\n::: column width=66%\nThe bridge is green.\n\n- a list\n:::\n::: column\n[[media:m2|Yard]]\n:::\n::::';

describe('a row read', () => {
  it('reads its columns in order, their widths, their words, where their fences stand', () => {
    const { columns, stray } = readColumns(WORDS);
    expect(columns.map((column) => [column.width, column.text, column.open, column.close])).toEqual([
      [66, 'The bridge is green.\n\n- a list', 1, 5],
      [null, '[[media:m2|Yard]]', 6, 8],
    ]);
    expect(stray).toEqual([]);
  });

  it('keeps a line standing in no column, and reads a column left open to the end', () => {
    const { columns, stray } = readColumns(':::: columns\nloose words\n::: column\nA\n:::\n::: column\nB\n::::');
    expect(stray).toEqual([{ at: 1, text: 'loose words' }]);
    expect(columns.map((column) => [column.text, column.close])).toEqual([['A', 4], ['B', -1]]);
  });

  it('reads a width with or without its percent sign, and none that makes no sense', () => {
    expect(widthIn('width=66%')).toBe(66);
    expect(widthIn('width = 40')).toBe(40);
    expect(widthIn('width=0%')).toBeNull();
    expect(widthIn('width=120%')).toBeNull();
    expect(widthIn('')).toBeNull();
  });

  it('knows a column holding a picture alone, and a row of pictures alone', () => {
    const [roof, yard] = readColumns(PICTURES).columns;
    expect(pictureOf(roof)).toMatchObject({ ref: 'media:m1', caption: 'The roof', line: ROOF });
    expect(pictureOf(yard).ref).toBe('media:m2');
    expect(pictureOf({ text: `${ROOF}\nWords under it` })).toBeNull();
    expect(picturesOnly(readColumns(PICTURES).columns)).toBe(true);
    expect(picturesOnly(readColumns(WORDS).columns)).toBe(false);
    // an empty column is left out of the question; a row of nothing is no row of pictures
    expect(picturesOnly([{ text: ROOF }, { text: '' }])).toBe(true);
    expect(picturesOnly([{ text: '' }, { text: '  ' }])).toBe(false);
    expect(isEmptyColumn({ text: '\n  \n' })).toBe(true);
  });

  it('shares the row by the widths written, the others splitting what is left', () => {
    expect(columnShares([{ width: null }, { width: null }])).toEqual([0.5, 0.5]);
    expect(columnShares([{ width: 66 }, { width: null }]).map((share) => share.toFixed(2))).toEqual(['0.66', '0.34']);
    expect(columnShares([{ width: null }, { width: null }, { width: null }]).map((share) => share.toFixed(3))).toEqual(['0.333', '0.333', '0.333']);
    // widths that run over are scaled to fit
    expect(columnShares([{ width: 80 }, { width: 80 }])).toEqual([0.5, 0.5]);
  });

  it('says which of the three widths two columns take', () => {
    expect(widthsOf(readColumns(PICTURES).columns)).toBe('equal');
    expect(widthsOf(readColumns(WORDS).columns)).toBe('left');
    expect(widthsOf([{ width: null }, { width: 66 }])).toBe('right');
    expect(widthsOf([{ width: 30 }, { width: null }])).toBeNull();
  });

  it('finds every row of a note, never one in code or one left open', () => {
    const note = ['Intro', ...PICTURES.split('\n'), '```', ':::: columns', '```', ':::: columns', 'open'];
    expect(rowsIn(note)).toEqual([{ first: 1, last: 8 }]);
  });
});

describe('a row written', () => {
  it('writes what / › Columns inserts, the caret in the first column', () => {
    expect(EMPTY_COLUMNS).toBe(':::: columns\n::: column\n\n:::\n::: column\n\n:::\n::::');
    expect(EMPTY_COLUMNS.slice(EMPTY_FIRST, EMPTY_FIRST + 1)).toBe('\n');
    expect(readColumns(EMPTY_COLUMNS).columns.every(isEmptyColumn)).toBe(true);
  });

  it('writes its columns back as read, an empty one keeping a line for the caret', () => {
    expect(writeColumns(readColumns(WORDS).columns)).toBe(WORDS);
    expect(writeColumns([{ width: null, text: '\n\nA\n\n' }, { width: null, text: '' }])).toBe(':::: columns\n::: column\nA\n:::\n::: column\n\n:::\n::::');
  });

  it('takes a third column, then gives it back with its words put under the row', () => {
    const three = withCount(PICTURES, 3);
    expect(readColumns(three).columns.map((column) => column.text)).toEqual([ROOF, YARD, '']);
    const filled = withColumnText(three, 2, 'Words in the third');
    expect(withCount(filled, 2)).toBe(`${PICTURES}\n\nWords in the third`);
    // more than three, or fewer than two, is never written
    expect(readColumns(withCount(PICTURES, 9)).columns).toHaveLength(3);
    expect(readColumns(withCount(PICTURES, 1)).columns).toHaveLength(2);
  });

  it('sets the widths of two columns, and three always share alike', () => {
    expect(withWidths(PICTURES, 'right')).toBe(PICTURES.replace(`:::\n::: column\n${YARD}`, `:::\n::: column width=66%\n${YARD}`));
    expect(withWidths(WORDS, 'equal')).toBe(WORDS.replace(' width=66%', ''));
    expect(withWidths(withCount(PICTURES, 3), 'left')).toBeNull();
    expect(readColumns(withCount(WORDS, 3)).columns.map((column) => column.width)).toEqual([null, null, null]);
  });

  it('moves a column left or right, the widths staying with their places', () => {
    const moved = movedColumn(WORDS, 1, -1);
    expect(readColumns(moved).columns.map((column) => [column.width, column.text])).toEqual([
      [66, YARD], [null, 'The bridge is green.\n\n- a list'],
    ]);
    expect(movedColumn(WORDS, 1, 1)).toBeNull();
  });

  it('takes a picture out of the row: two columns become the two one under the other', () => {
    expect(takenOut(PICTURES, 1)).toBe(`${ROOF}\n\n${YARD}`);
    expect(takenOut(PICTURES, 0)).toBe(`${YARD}\n\n${ROOF}`);
    // of three, the row stays with two, the one taken out under it
    const three = withColumnText(withCount(PICTURES, 3), 2, '[[media:m3|Gate]]');
    expect(takenOut(three, 0)).toBe(`:::: columns\n::: column\n${YARD}\n:::\n::: column\n[[media:m3|Gate]]\n:::\n::::\n\n${ROOF}`);
  });

  it('takes the row apart, its columns one under the other, nothing lost', () => {
    expect(takenApart(WORDS)).toBe(`The bridge is green.\n\n- a list\n\n${YARD}`);
    expect(takenApart(':::: columns\nloose\n::: column\nA\n:::\n::: column\n\n:::\n::::')).toBe('A\n\nloose');
  });

  it('writes a picture filling its column: its size and place dropped, its caption and veil kept', () => {
    expect(inRowLine('[[media:m1|Roof]]{width=50% align=center caption="The roof" graphic}')).toBe('[[media:m1|Roof]]{caption="The roof" graphic}');
    expect(inRowLine('  ![Map](media/map.png){width=30%}')).toBe('![Map](media/map.png)');
    expect(inRowLine('Just words')).toBe('Just words');
    expect(rowOf('[[media:m1|Roof]]{width=50%}', YARD)).toBe(`:::: columns\n::: column\n[[media:m1|Roof]]\n:::\n::: column\n${YARD}\n:::\n::::`);
  });

  it('adds a picture to a row at its left or its right, up to three columns', () => {
    const left = withColumnAdded(PICTURES, '[[media:m3|Gate]]{width=20%}', 'left');
    expect(readColumns(left).columns.map((column) => column.text)).toEqual(['[[media:m3|Gate]]', ROOF, YARD]);
    const right = withColumnAdded(PICTURES, '[[media:m3|Gate]]', 'right');
    expect(readColumns(right).columns.map((column) => column.text)).toEqual([ROOF, YARD, '[[media:m3|Gate]]']);
    expect(withColumnAdded(right, '[[media:m4|Quay]]', 'left')).toBeNull();
  });
});
