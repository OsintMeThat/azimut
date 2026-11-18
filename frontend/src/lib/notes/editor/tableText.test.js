import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MAX_ROWS, applyChanges, cellText, displayWidth, duplicateRow, escapeCell, escapeText, fillColumn, gridToTable,
  guessDelimiter, guessHeader, insertColumn, insertRow, isTotalRow, lineChanges, moveColumn, moveRow, newTable,
  parseTable, pasteInto, plainText, readClipboard, readColumns, readDate, readDelimited, readFile, readNumber,
  removeColumn, removeRow, serializeTable, setAlign, setCell, sortRows, tableAt, tablesIn, unescapeCell,
} from './tableText.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const REAL = fixture('real-tables.md');
const EDGE = fixture('edge-tables.md');
const real = tablesIn(REAL).map((found) => found.table);
const [costs, vertices, annex, videos, families, register, tiers, prices, timeline] = real;
/** The edge corpus's table of short rows, the last one a line of prose written under it. */
const ragged = tablesIn(EDGE)[2].table;
const PROSE = 'A line of prose written right under the table.';

/** A change's outcome checked whole: the changes make the text, and the text reads back as the table. */
function made(before, result) {
  expect(applyChanges(serializeTable(before), result.changes)).toBe(result.text);
  expect(serializeTable(result.table)).toBe(result.text);
  return result;
}

/** The lines of `after` that differ from `before`'s, when both have as many. */
function changedLines(before, after) {
  const was = before.split('\n');
  return after.split('\n').map((line, index) => (line === was[index] ? null : index)).filter((index) => index !== null);
}

const table = (text) => parseTable(text);

describe('reading a table', () => {
  it('reads the header, the sides and the rows', () => {
    const read = table('| a | b | c |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |');
    expect(read.header).toEqual(['a', 'b', 'c']);
    expect(read.align).toEqual(['left', 'center', 'right']);
    expect(read.rows).toEqual([['1', '2', '3']]);
  });

  it('keeps chips whole: their pipe is no cell break', () => {
    const read = table('| Proof | Media |\n| --- | --- |\n| [[entity:e_1|YEMEN Proof 50]] | [[media:m_2|Board]]{width=50% caption="a | b"} |');
    expect(read.rows[0]).toEqual(['[[entity:e_1|YEMEN Proof 50]]', '[[media:m_2|Board]]{width=50% caption="a | b"}']);
  });

  it('takes the backslash off an escaped pipe, a code span splitting as the renderers split it', () => {
    const read = table('| a | b |\n| --- | --- |\n| x \\| y | `p \\| q` |\n| `p | q` |');
    expect(read.rows[0]).toEqual(['x | y', '`p | q`']);
    expect(read.rows[1]).toEqual(['`p', 'q`']);
  });

  it('pads a short row and drops the cells past the header, as the renderers do', () => {
    const read = table('| a | b | c |\n| --- | --- | --- |\n| 1 |\n| 1 | 2 | 3 | 4 |');
    expect(read.rows).toEqual([['1', '', ''], ['1', '2', '3']]);
  });

  it('takes a line of prose under a table for one of its rows', () => {
    const read = table('| a | b |\n| --- | --- |\n| 1 | 2 |\nProse right under.');
    expect(read.rows[1]).toEqual(['Prose right under.', '']);
  });

  it('reads a table without the pipes at the ends', () => {
    const read = table('Name | Value\n-----|------:\nalpha | 1');
    expect(read.header).toEqual(['Name', 'Value']);
    expect(read.align).toEqual([null, 'right']);
  });

  it('is null for what is not exactly one table', () => {
    expect(parseTable('')).toBeNull();
    expect(parseTable('| a | b |')).toBeNull();
    expect(parseTable('| a | b |\n| --- |')).toBeNull();
    expect(parseTable('a b\n| --- |')).toBeNull();
    expect(parseTable('| a | b |\n| --- | --- |\n| 1 | 2 |\n\n| 3 | 4 |')).toBeNull();
    expect(parseTable('| a | b |\n| --- | --- |\n- a list')).toBeNull();
    expect(parseTable('    | a | b |\n    | --- | --- |')).toBeNull();
    expect(parseTable('|\n| --- |')).toBeNull();
    expect(parseTable('[[entity:e_1|chip]]\n---')).toBeNull();
    expect(parseTable('| a | b |\n|---||---|')).toBeNull();
  });

  it('reads a header-only table and an all-empty one', () => {
    expect(table('| a | b |\n| --- | --- |').rows).toEqual([]);
    const empty = table('| | |\n| --- | --- |\n| | |');
    expect(empty.header).toEqual(['', '']);
    expect(empty.rows).toEqual([['', '']]);
  });

  it('reads emoji, right-to-left text and a very long cell untouched', () => {
    const long = 'word '.repeat(2000).trim();
    const text = `| Sign | Text | Long |\n| --- | --- | --- |\n| 🛰️ 👍🏽 🇫🇷 | قوات درع الوطن \\| باب المندب | ${long} |\n| \u200fRTL | ي | x |`;
    const read = table(text);
    expect(read.rows[0]).toEqual(['🛰️ 👍🏽 🇫🇷', 'قوات درع الوطن | باب المندب', long]);
    expect(read.rows[1][0]).toBe('\u200fRTL');
    expect(serializeTable(read)).toBe(text);
  });
});

describe('writing a table back', () => {
  it('writes every table of two real notes back byte for byte', () => {
    for (const { from, to, table: read } of tablesIn(REAL)) expect(serializeTable(read)).toBe(REAL.slice(from, to));
  });

  it('writes every edge case back byte for byte', () => {
    for (const { from, to, table: read } of tablesIn(EDGE)) expect(serializeTable(read)).toBe(EDGE.slice(from, to));
  });

  it('escapes each real cell back to its own bytes, a chip never escaped', () => {
    for (const read of real) {
      for (const line of [read.layout.lines.header, ...read.layout.lines.rows]) {
        for (const slot of line.slots) expect(escapeCell(slot.text)).toBe(slot.raw);
      }
    }
    expect(annex.rows[0][6]).toBe('[[entity:e_fixture001|YEMEN Proof 50]]');
  });

  it('keeps the line breaks after the table and Windows line ends', () => {
    const text = '| a | b |\r\n| --- | --- |\r\n| 1 | 2 |\r\n\r\n';
    const read = table(text);
    expect(serializeTable(read)).toBe(text);
    const { text: edited } = made(read, setCell(read, 0, 1, 'x'));
    expect(edited).toBe('| a | b |\r\n| --- | --- |\r\n| 1 | x |\r\n\r\n');
    expect(made(read, insertRow(read)).text).toBe('| a | b |\r\n| --- | --- |\r\n| 1 | 2 |\r\n| | |\r\n\r\n');
  });

  it('makes a new table the usual way', () => {
    const made = newTable({ header: ['Model', 'At least'], rows: [['Cougar', '8'], ['Tygor']], align: [null, 'right'] });
    expect(serializeTable(made)).toBe('| Model | At least |\n| --- | ---: |\n| Cougar | 8 |\n| Tygor | |');
    expect(serializeTable(newTable())).toBe('| |\n| --- |');
  });
});

describe('cells', () => {
  it('escapes a typed pipe but never a chip\'s, nor a picture\'s braces, nor one already escaped', () => {
    expect(escapeCell('a | b')).toBe('a \\| b');
    expect(escapeCell('[[entity:e_1|Label]] or [[media:m_1|Pic]]{caption="x|y"}')).toBe('[[entity:e_1|Label]] or [[media:m_1|Pic]]{caption="x|y"}');
    expect(escapeCell('![a](b.png){caption="x|y"} z|w')).toBe('![a](b.png){caption="x|y"} z\\|w');
    expect(escapeCell('[[entity:e_1|a|b]]')).toBe('[[entity:e_1|a\\|b]]');
    expect(escapeCell('`code | span`')).toBe('`code \\| span`');
    expect(escapeCell('already \\| escaped')).toBe('already \\| escaped');
    expect(escapeCell('a backslash \\\\| then a pipe')).toBe('a backslash \\\\\\| then a pipe');
    expect(escapeCell('[x](https://a.org/a|b)')).toBe('[x](https://a.org/a\\|b)');
  });

  it('unescapes as markdown-it does, the backslash before a pipe coming off', () => {
    expect(unescapeCell('a \\| b')).toBe('a | b');
    expect(unescapeCell('c \\\\| d')).toBe('c \\| d');
    expect(unescapeCell('[[entity:e_1|x]]')).toBe('[[entity:e_1|x]]');
    expect(unescapeCell('no pipe \\ here')).toBe('no pipe \\ here');
  });

  it('makes a typed cell one line: a new line is a space, never a <br>', () => {
    expect(cellText('  first\nsecond\r\nthird\u2028fourth  ')).toBe('first second third fourth');
    expect(cellText('keeps  inner  spaces')).toBe('keeps  inner  spaces');
    expect(cellText(null)).toBe('');
  });

  it('reads a cell as the words it shows', () => {
    expect(plainText('**Total** [[entity:e_1|Proof 5]] [site](https://a.org) `x` \\*')).toBe('Total Proof 5 site x *');
    expect(plainText('*not* _this_ ~~gone~~')).toBe('not this gone');
  });

  it('measures what a monospace font shows', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('日本')).toBe(4);
    expect(displayWidth('🛰️')).toBe(2);
    expect(displayWidth('e\u0301')).toBe(1);
    expect(displayWidth('باب')).toBe(3);
  });
});

describe('a cell edit', () => {
  it('rewrites only its own line', () => {
    const before = serializeTable(costs);
    const result = made(costs, setCell(costs, 2, 3, '$480k-$900k'));
    expect(changedLines(before, result.text)).toEqual([4]);
    expect(result.changes).toHaveLength(1);
    expect(result.table.rows[2][3]).toBe('$480k-$900k');
  });

  it('escapes a typed pipe and turns a new line into a space', () => {
    const result = made(costs, setCell(costs, 0, 4, 'a | b\nc'));
    expect(result.text.split('\n')[2]).toBe('| Harrow Tygor E1 | Harrow Security Vehicles, UAE | 8 | $120k-$250k | a \\| b c |');
    expect(result.table.rows[0][4]).toBe('a | b c');
  });

  it('writes a chip as it is and keeps the other chips of the row', () => {
    const result = made(annex, setCell(annex, 1, 6, '[[entity:e_new|YEMEN Proof 1]]'));
    expect(result.text.split('\n')[3]).toMatch(/\| \[\[entity:e_new\|YEMEN Proof 1\]\] \|$/);
    expect(result.table.rows[0][6]).toBe('[[entity:e_fixture001|YEMEN Proof 50]]');
  });

  it('edits the header (row -1)', () => {
    const result = made(costs, setCell(costs, -1, 2, 'At least'));
    expect(changedLines(serializeTable(costs), result.text)).toEqual([0]);
  });

  it('changes nothing when the text is the same', () => {
    expect(setCell(costs, 0, 0, 'Harrow Tygor E1').changes).toEqual([]);
  });

  it('keeps a short row short, and lengthens it only as far as the typed cell', () => {
    const read = table('| a | b | c | d |\n| --- | --- | --- | --- |\n| 1 |');
    expect(made(read, setCell(read, 0, 0, '9')).text.split('\n')[2]).toBe('| 9 |');
    expect(made(read, setCell(read, 0, 2, 'x')).text.split('\n')[2]).toBe('| 1 | | x |');
    const prose = ragged.rows.length - 1;
    expect(made(ragged, setCell(ragged, prose, 0, 'Another line.')).text.split('\n').at(-1)).toBe('Another line.');
  });

  it('keeps a row a row on a table without its opening pipes', () => {
    const read = table('Name | Value\n-----|------:\nalpha | 1');
    expect(made(read, setCell(read, 0, 0, '- dash')).text.split('\n')[2]).toBe('| - dash | 1');
    expect(made(read, setCell(read, 0, 0, '')).text.split('\n')[2]).toBe('| | 1');
    expect(made(read, setCell(read, 0, 1, '')).text.split('\n')[2]).toBe('alpha | |');
    expect(made(read, setCell(read, 0, 0, '# x')).table.rows[0]).toEqual(['# x', '1']);
  });

  it('keeps a cell ending in a backslash from escaping the next pipe', () => {
    const read = table('|a|b|\n|-|-|\n|1|2|');
    const result = made(read, setCell(read, 0, 0, 'end\\'));
    expect(result.text.split('\n')[2]).toBe('|end\\ |2|');
    expect(result.table.rows[0]).toEqual(['end\\', '2']);
  });

  it('keeps a padded table padded, and widens a column on every line when it must', () => {
    const padded = table('| Model         | Grade       | At least |\n| :------------ | :---------- | -------: |\n| Streit Cougar | identified  |        8 |\n| Al-Wahsh      | almost sure |        2 |');
    const shorter = made(padded, setCell(padded, 0, 0, 'Cougar'));
    expect(shorter.changes).toHaveLength(1);
    expect(shorter.text.split('\n')[2]).toBe('| Cougar        | identified  |        8 |');
    expect(made(padded, setCell(padded, 1, 2, '1234')).text.split('\n')[3]).toBe('| Al-Wahsh      | almost sure |     1234 |');
    const wider = made(padded, setCell(padded, 1, 1, 'strong doubt'));
    expect(wider.text).toBe('| Model         | Grade        | At least |\n| :------------ | :----------- | -------: |\n| Streit Cougar | identified   |        8 |\n| Al-Wahsh      | strong doubt |        2 |');
  });

  it('pads none into a table that was not padded', () => {
    const read = table('| a | b |\n| --- | --- |\n| abc | d |');
    expect(made(read, setCell(read, 0, 1, 'a much longer cell')).text).toBe('| a | b |\n| --- | --- |\n| abc | a much longer cell |');
    const aligned = table('| abc | def |\n| --- | --- |\n| ghi | jkl |');
    expect(made(aligned, setCell(aligned, 0, 0, 'x')).text.split('\n')[2]).toBe('| x | jkl |');
  });

  it('keeps an edited cell\'s own spacing', () => {
    const read = table('|  a  |b|\n|---|---|\n|  1  |2|');
    expect(made(read, setCell(read, 0, 0, '10')).text.split('\n')[2]).toBe('|  10  |2|');
  });

  it('refuses a cell that is not there', () => {
    expect(() => setCell(costs, 99, 0, 'x')).toThrow(RangeError);
    expect(() => setCell(costs, 0, 9, 'x')).toThrow(RangeError);
    expect(() => setCell(costs, -2, 0, 'x')).toThrow(RangeError);
  });
});

describe('rows', () => {
  it('puts a row in at the end, the start or between, writing only that line', () => {
    const before = serializeTable(costs);
    const atEnd = made(costs, insertRow(costs));
    expect(atEnd.text).toBe(`${before}\n| | | | | |`);
    expect(atEnd.changes).toEqual([{ from: before.length, to: before.length, insert: '\n| | | | | |' }]);
    const first = made(costs, insertRow(costs, 0, ['Model X', 'Maker']));
    expect(first.text.split('\n')[2]).toBe('| Model X | Maker | | | |');
    expect(first.changes).toHaveLength(1);
    expect(first.changes[0].insert).toBe('| Model X | Maker | | | |\n');
  });

  it('duplicates a row exactly', () => {
    const result = made(annex, duplicateRow(annex, 0));
    const lines = result.text.split('\n');
    expect(lines[3]).toBe(lines[2]);
    expect(result.table.rows).toHaveLength(annex.rows.length + 1);
  });

  it('removes a row, the last one too', () => {
    const before = serializeTable(costs);
    const last = made(costs, removeRow(costs, costs.rows.length - 1));
    expect(last.text).toBe(before.slice(0, before.lastIndexOf('\n')));
    expect(made(costs, removeRow(costs, 0)).table.rows[0][0]).toBe('Streit Cougar');
  });

  it('moves a row with its own bytes, touching only the lines between', () => {
    const before = serializeTable(costs);
    const result = made(costs, moveRow(costs, 0, 3));
    expect(result.table.rows.map((row) => row[0]).slice(0, 4)).toEqual(['Streit Cougar', 'Oshkosh M-ATV', 'Al-Wahsh', 'Harrow Tygor E1']);
    expect(changedLines(before, result.text)).toEqual([2, 3, 4, 5]);
    expect(result.text.split('\n').sort()).toEqual(before.split('\n').sort());
  });

  it('keeps each row\'s own line through a move, an irregular one too', () => {
    const read = table('| a | b |\n| --- | --- |\n|1|2|\n|   3   | 4 |');
    expect(made(read, moveRow(read, 1, 0)).text).toBe('| a | b |\n| --- | --- |\n|   3   | 4 |\n|1|2|');
  });

  it('pastes cells from a cell on, adding the rows and columns they need', () => {
    const read = table('| a | b |\n| --- | --- |\n| 1 | 2 |');
    const result = made(read, pasteInto(read, { row: 0, column: 1 }, [['p', 'q'], ['r', 's | t']]));
    expect(result.text).toBe('| a | b | |\n| --- | --- | --- |\n| 1 | p | q |\n| | r | s \\| t |');
    expect(made(read, pasteInto(read, { row: -1, column: 0 }, [['A', 'B']])).table.header).toEqual(['A', 'B']);
  });
});

describe('columns', () => {
  it('puts a column in, every other cell keeping its bytes', () => {
    const result = made(costs, insertColumn(costs, 1, { header: 'Grade', cells: ['identified'] }));
    const lines = result.text.split('\n');
    expect(lines[0]).toBe('| Model | Grade | Maker, country | Count (at least) | Unit price, low-high | Price basis |');
    expect(lines[1]).toBe('| --- | --- | --- | --- | --- | --- |');
    expect(lines[2]).toBe('| Harrow Tygor E1 | identified | Harrow Security Vehicles, UAE | 8 | $120k-$250k | class estimate |');
    expect(lines[3]).toBe('| Streit Cougar | | Streit Group, UAE | 8 | $150k-$250k | class estimate |');
  });

  it('removes and moves a column; a move and its way back give the same bytes', () => {
    const removed = made(annex, removeColumn(annex, 2));
    expect(removed.table.header).toEqual(['Date of media', 'Place', 'What it shows', 'Holder', 'Source video', 'Proof']);
    const moved = made(register, moveColumn(register, 8, 0));
    expect(moved.table.header[0]).toBe('Close-up');
    expect(moveColumn(moved.table, 0, 8).text).toBe(serializeTable(register));
    expect(moveColumn(moveColumn(families, 0, 4).table, 4, 0).text).toBe(serializeTable(families));
    // a line of prose under a table becomes a row with its pipes, its words kept
    const there = made(ragged, moveColumn(ragged, 0, 2));
    expect(there.text.split('\n').at(-1)).toBe(`| | | ${PROSE}`);
    expect(moveColumn(there.table, 2, 0).table.rows).toEqual(ragged.rows);
  });

  it('closes a line of prose under a table with a pipe and a space when a cell is added to it', () => {
    const result = made(ragged, setCell(ragged, ragged.rows.length - 1, 1, 'n/a'));
    expect(result.text.split('\n').at(-1)).toBe(`${PROSE} | n/a`);
  });

  it('keeps a table one column wide at least', () => {
    expect(() => removeColumn(table('| a |\n| --- |'), 0)).toThrow(RangeError);
  });

  it('pads a new column and keeps the padding through column changes', () => {
    const padded = table('| Model         | At least |\n| :------------ | -------: |\n| Streit Cougar |        8 |');
    expect(made(padded, insertColumn(padded, 1, { header: 'Maker', cells: ['Streit Group'] })).text)
      .toBe('| Model         | Maker        | At least |\n| :------------ | ------------ | -------: |\n| Streit Cougar | Streit Group |        8 |');
    expect(made(padded, moveColumn(padded, 1, 0)).text).toBe('| At least | Model         |\n| -------: | :------------ |\n|        8 | Streit Cougar |');
  });

  it('sets a side on the delimiter row alone, keeping its dashes', () => {
    const before = serializeTable(costs);
    const right = made(costs, setAlign(costs, 2, 'right'));
    expect(right.text.split('\n')[1]).toBe('| --- | --- | ---: | --- | --- |');
    expect(changedLines(before, right.text)).toEqual([1]);
    expect(made(right.table, setAlign(right.table, 2, 'center')).text.split('\n')[1]).toBe('| --- | --- | :---: | --- | --- |');
    expect(made(right.table, setAlign(right.table, 2, null)).text).toBe(before);
    const padded = table('| Model    | n |\n| -------- | - |\n| Cougar   | 8 |');
    expect(made(padded, setAlign(padded, 0, 'center')).text.split('\n')[1]).toBe('| :------: | - |');
    expect(() => setAlign(costs, 0, 'middle')).toThrow(RangeError);
  });

  it('fills a column, every cell, the empty ones or by a rule', () => {
    const result = made(families, fillColumn(families, 1, 'n/a', { onlyEmpty: true }));
    expect(result.table.rows.filter((row) => row[1] === 'n/a')).toHaveLength(4);
    expect(changedLines(serializeTable(families), result.text)).toEqual([13, 14, 15, 16]);
    const numbered = made(costs, fillColumn(costs, 4, (_cells, row) => `#${row + 1}`, { from: 0, to: 3 }));
    expect(numbered.table.rows.slice(0, 4).map((row) => row[4])).toEqual(['#1', '#2', '#3', 'class estimate']);
  });
});

describe('sorting', () => {
  const firsts = (result, column = 0) => result.table.rows.map((row) => row[column]);

  it('sorts numbers as numbers, stably, the total row staying last', () => {
    const result = made(costs, sortRows(costs, 2, 'desc'));
    expect(result.kind).toBe('number');
    expect(firsts(result)).toEqual(['Harrow Tygor E1', 'Streit Cougar', 'Oshkosh M-ATV', 'Al-Wahsh', 'BATT UMG', 'Streit Cobra LAMV', 'Streit Spartan-SUT', 'BMC Kirpi II', 'ERAF Tares III', 'NIMR Ajban 440A', 'NIMR JAIS Mk2', '**Total identified**']);
    expect(firsts(sortRows(costs, 2, 'asc'))[0]).toBe('BMC Kirpi II');
  });

  it('sorts amounts with their scale, and ranges on their low end', () => {
    expect(firsts(sortRows(prices, 3), 3)).toEqual(['$350k', '$400k', '$450k', '$460k', '$500k', '$550k', '$600k', '$700k', '$1.4M', '$1.4M', '$4.9M']);
    const ranges = sortRows(costs, 3);
    expect(ranges.kind).toBe('number');
    expect(firsts(ranges, 3).slice(0, 3)).toEqual(['$120k-$250k', '$150k-$250k', '$150k-$280k']);
  });

  it('sorts dates, written without their year or as a span', () => {
    const result = made(annex, sortRows(annex, 0, 'desc'));
    expect(result.kind).toBe('date');
    expect(firsts(result)).toEqual(['13 Nov', '13 Nov', '13 Nov', '10-14 Nov', '8 Nov', '4-6 Nov', '2 Nov', '27 Oct', '21 Oct', '20 Oct', '19 Oct', '18 Oct', '9 Oct', '14 Sep']);
    expect(firsts(sortRows(timeline, 0))).toEqual(['Jan 2026', '10–11 Sep 2026', '5–6 Oct 2026', '13 Nov 2026', '15 Nov 2026', '16 Nov 2026']);
  });

  it('sorts words naturally, by what chips and links show', () => {
    const result = sortRows(annex, 6);
    expect(result.kind).toBe('text');
    expect(firsts(result, 6).map(plainText).slice(0, 3)).toEqual(['Proof 1 (PNG missing)', 'YEMEN Proof 14', 'YEMEN Proof 15']);
    expect(firsts(sortRows(vertices, 0, 'desc'))).toEqual(['V8', 'V7', 'V6', 'V5', 'V4', 'V3', 'V2', 'V1']);
  });

  it('puts empty cells last either way', () => {
    const read = table('| a |\n| --- |\n| |\n| 2 |\n| – |\n| 10 |');
    expect(firsts(sortRows(read, 0, 'asc'))).toEqual(['2', '10', '', '–']);
    expect(firsts(sortRows(read, 0, 'desc'))).toEqual(['10', '2', '', '–']);
  });

  it('takes a forced kind', () => {
    expect(firsts(sortRows(vertices, 2, 'asc', { kind: 'text' }), 2)[0]).toBe('12.6875');
  });
});

describe('numbers', () => {
  it.each([
    ['41', 41, {}],
    ['**35**', 35, {}],
    ['1 234,5', 1234.5, { decimal: ',', thousands: ' ' }],
    ['1\u00a0234,5', 1234.5, { thousands: '\u00a0' }],
    ['1,234.5', 1234.5, { decimal: '.', thousands: ',' }],
    ['1.234,5', 1234.5, { decimal: ',' }],
    ['12.7590', 12.759, {}],
    ['$8.3M', 8300000, { unit: '$' }],
    ['$155k', 155000, { unit: '$' }],
    ['1.05bn', 1050000000, {}],
    ['80%', 80, { unit: '%' }],
    ['600 m', 600, { unit: 'm' }],
    ['12 vehicles', 12, { unit: 'vehicles' }],
    ['-5', -5, {}],
    ['−5', -5, {}],
    ['EUR 40', 40, { unit: 'EUR' }],
    ['≥ 41', 41, { floor: true }],
    ['41+', 41, { floor: true }],
    ['at least $9.1M', 9100000, { floor: true }],
    ['41 or more', 41, { floor: true }],
    ['up to about $20.0M', 20000000, { ceiling: true, approx: true }],
    ['~12', 12, { approx: true }],
  ])('reads %s', (text, value, flags) => {
    expect(readNumber(text)).toMatchObject({ value, ...flags });
  });

  it.each(['', '–', 'n/a', 'class 90%', '12.7590, 43.4950', 'S04 0:23-0:37', '#12', '4x4', '13 Nov', '2026-11-13', 'Jan 2026', 'almost sure', '$470k–$700k–$900k'])(
    'reads %s as no number', (text) => {
      expect(readNumber(text)).toBeNull();
    },
  );

  it('reads a range as its two ends', () => {
    expect(readNumber('$120k-$250k')).toMatchObject({ value: null, range: [120000, 250000], unit: '$' });
    expect(readNumber('8–10M')).toMatchObject({ range: [8000000, 10000000] });
    expect(readNumber('4 to 6')).toMatchObject({ range: [4, 6] });
  });

  it('reads 1,234 as a thousand and more unless the comma is the decimal mark', () => {
    expect(readNumber('1,234').value).toBe(1234);
    expect(readNumber('1,234', { decimal: ',' }).value).toBe(1.234);
    expect(readNumber('1,5').value).toBe(1.5);
  });

  it('reads each column of a real table for a chart', () => {
    const [model, , count, price] = readColumns(costs);
    expect(model.numeric).toBe(false);
    expect(count).toMatchObject({ numeric: true, floor: true, values: [8, 8, 7, 2, 2, 2, 2, 1, 1, 1, 1, 35], count: 12, filled: 12 });
    expect(count.floors.every(Boolean)).toBe(true);
    expect(price.numeric).toBe(false);
    expect(price.readings[0].range).toEqual([120000, 250000]);
    const [, , low, , high] = readColumns(tiers);
    expect(low.values).toEqual([8300000, 155000, 645000, null, null, 9100000]);
    expect(low.readings[5].floor).toBe(true);
    expect(high).toMatchObject({ numeric: true, unit: '$' });
    expect(high.readings[5]).toMatchObject({ value: 20000000, ceiling: true, approx: true });
    const latitude = readColumns(vertices)[2];
    expect(latitude).toMatchObject({ numeric: true, decimal: '.', thousands: '' });
    expect(readColumns(annex)[0].numeric).toBe(false);
  });

  it('finds a column\'s decimal mark and thousands separator', () => {
    const french = newTable({ header: ['Prix'], rows: [['1 234,5'], ['12,75'], ['1 000']] });
    expect(readColumns(french)[0]).toMatchObject({ decimal: ',', thousands: ' ', values: [1234.5, 12.75, 1000] });
    const english = newTable({ header: ['Price'], rows: [['1,234'], ['2,500,000'], ['3']] });
    expect(readColumns(english)[0]).toMatchObject({ decimal: '.', thousands: ',', values: [1234, 2500000, 3] });
    const commas = newTable({ header: ['n'], rows: [['1,234'], ['0,5']] });
    expect(readColumns(commas)[0].values).toEqual([1.234, 0.5]);
    expect(readColumns(commas, { decimal: '.' })[0].values).toEqual([1.234, 0.5]);
  });

  it('tells a total row', () => {
    expect(isTotalRow(costs.rows.at(-1))).toBe(true);
    expect(isTotalRow(['**Range**', '', '**at least $9.1M**'])).toBe(true);
    expect(isTotalRow(['Total', '3'])).toBe(true);
    expect(isTotalRow(['Totally new', '3'])).toBe(false);
    expect(isTotalRow(costs.rows[0])).toBe(false);
  });
});

describe('dates', () => {
  it.each([
    ['2026-11-13', { year: 2026, month: 11, day: 13 }],
    ['2026-11', { year: 2026, month: 11, day: null }],
    ['2026-11-13 14:05', { minutes: 845 }],
    ['13/11/2026', { year: 2026, month: 11, day: 13 }],
    ['11/13/2026', { month: 11, day: 13 }],
    ['13.11.26', { year: 2026 }],
    ['13 Nov 2026', { year: 2026, month: 11, day: 13 }],
    ['Nov 13, 2026', { year: 2026, month: 11, day: 13 }],
    ['November 2026', { year: 2026, month: 11, day: null }],
    ['14 Sep', { year: null, month: 9, day: 14 }],
    ['4-6 Nov', { month: 11, day: 4 }],
    ['10–11 Sep 2026', { year: 2026, month: 9, day: 10 }],
    ['13 novembre 2026', { month: 11 }],
    ['1er févr. 2026', { month: 2, day: 1 }],
    ['13 Nov (claim)', { month: 11, day: 13 }],
  ])('reads %s', (text, expected) => {
    expect(readDate(text)).toMatchObject(expected);
  });

  it.each(['2026', '8 vehicles', '13/13/2026', 'V12', 'S04 0:23'])('reads %s as no date', (text) => {
    expect(readDate(text)).toBeNull();
  });
});

describe('delimited text', () => {
  it('reads LibreOffice\'s tab-separated copy, a line break inside quotes', () => {
    const grid = readClipboard({ text: fixture('libreoffice.tsv') });
    expect(grid).toMatchObject({ format: 'tsv', header: true });
    expect(grid.cells[2]).toEqual(['', 'almost sure second line', '2', 'source | note']);
    expect(grid.cells[3][3]).toBe('\\*not\\* [priced]');
  });

  it('reads a French CSV: semicolons, decimal commas, a byte-order mark', () => {
    const grid = readFile(`\uFEFF${fixture('libreoffice-fr.csv')}`, { name: 'vehicles.csv' });
    expect(grid).toMatchObject({ format: 'csv', delimiter: ';', header: true });
    expect(grid.cells[0]).toEqual(['Model', 'Grade', 'At least', 'Unit price']);
    expect(grid.cells[1][3]).toBe('1\u00a0234,5');
  });

  it('reads quotes, doubled quotes and line breaks in quotes', () => {
    expect(readDelimited('name,note\n"A, B","say ""hi"""\n"multi\r\nline",x\r\n').cells)
      .toEqual([['name', 'note'], ['A, B', 'say "hi"'], ['multi line', 'x']]);
    expect(readDelimited('a,b\n5" pipe,"unclosed\n').cells).toEqual([['a', 'b'], ['5" pipe', '"unclosed']]);
    expect(readDelimited('a,b\n"quoted" then,x\n').cells[1]).toEqual(['"quoted" then', 'x']);
    expect(readDelimited('a,b,\n1,2,\n').cells).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('follows Excel\'s sep= line and a given separator', () => {
    expect(readDelimited('sep=;\na;b\n1,5;2\n')).toMatchObject({ delimiter: ';', cells: [['a', 'b'], ['1,5', '2']] });
    expect(readDelimited('a|b\n1|2', { delimiter: '|' }).cells).toEqual([['a', 'b'], ['1', '2']]);
    expect(readFile('a\tb\n1\t2', { name: 'x.TSV' }).format).toBe('tsv');
  });

  it('guesses the separator', () => {
    expect(guessDelimiter('a\tb\n1\t2')).toBe('\t');
    expect(guessDelimiter('Model;Price\nA;1,5\nB;2,5')).toBe(';');
    expect(guessDelimiter('name,note\n"A; B",5\nC,6')).toBe(',');
    expect(guessDelimiter('a|b\n1|2')).toBe('|');
    expect(guessDelimiter('one value a line\nanother')).toBeNull();
    expect(readDelimited('one\ntwo').cells).toEqual([['one'], ['two']]);
  });

  it('takes no words for a table: tabs on every row, as many on each', () => {
    expect(readClipboard({ text: 'Hello, world.\nBye, now.' })).toBeNull();
    expect(readClipboard({ text: 'function f() {\n\treturn 1;\n}' })).toBeNull();
    expect(readClipboard({ text: 'just words' })).toBeNull();
    expect(readClipboard({ text: 'a\tb' }).cells).toEqual([['a', 'b']]);
  });

  it('escapes what would turn into Markdown, and nothing that would not', () => {
    expect(escapeText('5*3*2')).toBe('5\\*3\\*2');
    expect(escapeText('a * b')).toBe('a * b');
    expect(escapeText('snake_case and _this_')).toBe('snake_case and \\_this\\_');
    expect(escapeText('~12.7 to ~13')).toBe('\\~12.7 to \\~13');
    expect(escapeText('~12.7590')).toBe('~12.7590');
    expect(escapeText('[1]')).toBe('[1]');
    expect(escapeText('[x](y)')).toBe('\\[x\\](y)');
    expect(escapeText('<b>bold</b> < 5')).toBe('\\<b>bold\\</b> < 5');
    expect(escapeText('C:\\path and \\*')).toBe('C:\\path and \\\\*');
    expect(escapeText('AT&T &amp;')).toBe('AT&T \\&amp;');
  });

  it('guesses whether a first row is a header', () => {
    expect(guessHeader([['Model', 'Count'], ['Cougar', '8']])).toBe(true);
    expect(guessHeader([['1', '2'], ['3', '4']])).toBe(false);
    expect(guessHeader([['13 Nov', 'x'], ['14 Nov', 'y']])).toBe(false);
    expect(guessHeader([['a', 'a'], ['b', 'c']])).toBe(false);
    expect(guessHeader([['only one row']])).toBe(false);
    expect(guessHeader([['', 'Video 1'], ['What', 'Tour']])).toBe(true);
  });
});

describe('a grid becoming a table', () => {
  it('takes the first row for the header, sets numbers right and cuts past the limit', () => {
    const rows = Array.from({ length: MAX_ROWS + 20 }, (_, index) => [`V${index}`, String(index)]);
    const { table: made, text, cut } = gridToTable({ format: 'csv', cells: [['Code', 'n'], ...rows], header: true });
    expect(cut).toBe(20);
    expect(made.rows).toHaveLength(MAX_ROWS);
    expect(made.align).toEqual([null, 'right']);
    expect(text.split('\n').slice(0, 3)).toEqual(['| Code | n |', '| --- | ---: |', '| V0 | 0 |']);
  });

  it('leaves the header empty when the caller says there is none', () => {
    const { text } = gridToTable({ format: 'tsv', cells: [['a', 'b'], ['c', 'd']], header: true }, { header: false, alignNumbers: false });
    expect(text).toBe('| | |\n| --- | --- |\n| a | b |\n| c | d |');
  });

  it('pads uneven rows', () => {
    expect(gridToTable({ cells: [['a', 'b', 'c'], ['1']], header: true }).table.rows).toEqual([['1', '', '']]);
  });
});

describe('finding tables in a note', () => {
  it('finds every table of the real notes, the vehicle register with its nine columns', () => {
    expect(real.map((read) => [read.header.length, read.rows.length])).toEqual([[5, 12], [5, 8], [7, 14], [3, 5], [5, 15], [9, 60], [5, 6], [5, 11], [2, 6], [4, 6]]);
    expect(register.header).toEqual(['#', 'Identification', 'Grade', 'Conf.', 'State', 'Video 1', 'Video 2', 'Position', 'Close-up']);
  });

  it('gives the table a position stands in', () => {
    const at = REAL.indexOf('| V3 |');
    expect(tableAt(REAL, at).table.header[0]).toBe('Vertex');
    expect(tableAt(REAL, 0)).toBeNull();
  });

  it('leaves out tables in a fence, an HTML block or indented as code, and stops at a :: line', () => {
    const text = '```\n| a | b |\n| --- | --- |\n```\n\n<div>\n| a | b |\n| --- | --- |\n</div>\n\n    | a | b |\n    | --- | --- |\n\n::: center\n| a | b |\n| --- | --- |\n| 1 | 2 |\n:::\n';
    const found = tablesIn(text);
    expect(found).toHaveLength(1);
    expect(text.slice(found[0].from, found[0].to)).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |');
  });
});

describe('changes', () => {
  it('are the smallest that turn one text into the other', () => {
    expect(lineChanges('a\nb\nc', 'a\nB\nc')).toEqual([{ from: 2, to: 3, insert: 'B' }]);
    expect(lineChanges('a\nb', 'a\nb\nc')).toEqual([{ from: 3, to: 3, insert: '\nc' }]);
    expect(lineChanges('same', 'same')).toEqual([]);
    expect(lineChanges('x 😀 y', 'x 😁 y')).toEqual([{ from: 2, to: 4, insert: '😁' }]);
  });
});

describe('any run of gestures', () => {
  it('keeps the changes, the text and the table in step, a cell edit touching one line', () => {
    const tables = [...real, ...tablesIn(EDGE).map((found) => found.table)];
    let seed = 7;
    const pick = (count) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return Math.floor((seed / 2147483648) * count);
    };
    const words = ['x', 'a | b', '[[entity:e_9|Chip]]', '`c|d`', 'end\\', '- item', '', '  spaced  ', 'two\nlines', '🛰️ wide', 'قوات', '**35**', '\\| kept', '# h', ':::'];
    for (let round = 0; round < 400; round += 1) {
      let current = tables[pick(tables.length)];
      for (let step = 0; step < 4; step += 1) {
        const before = serializeTable(current);
        const rows = current.rows.length;
        const columns = current.header.length;
        const gesture = pick(10);
        let result;
        if (gesture < 2) {
          const row = pick(rows + 1) - 1;
          const column = pick(columns);
          const word = words[pick(words.length)];
          result = setCell(current, row, column, word);
          const cells = row === -1 ? result.table.header : result.table.rows[row];
          expect(cells[column]).toBe(unescapeCell(escapeCell(cellText(word))));
          if (!current.layout.style.widths) expect(changedLines(before, result.text).length).toBeLessThanOrEqual(1);
        } else if (gesture === 2) result = insertRow(current, pick(rows + 1), [words[pick(words.length)]]);
        else if (gesture === 3 && rows) result = removeRow(current, pick(rows));
        else if (gesture === 4 && rows) result = moveRow(current, pick(rows), pick(rows));
        else if (gesture === 5) result = insertColumn(current, pick(columns + 1), { header: words[pick(words.length)] });
        else if (gesture === 6 && columns > 1) result = removeColumn(current, pick(columns));
        else if (gesture === 7) result = moveColumn(current, pick(columns), pick(columns));
        else if (gesture === 8) result = setAlign(current, pick(columns), [null, 'left', 'center', 'right'][pick(4)]);
        else if (gesture === 9 && rows) result = sortRows(current, pick(columns), pick(2) ? 'asc' : 'desc');
        else continue;
        expect(applyChanges(before, result.changes)).toBe(result.text);
        expect(serializeTable(result.table)).toBe(result.text);
        current = result.table;
      }
    }
  });
});

describe('keeping it fast', () => {
  const big = (count) => newTable({
    header: register.header,
    rows: Array.from({ length: count }, (_, index) => register.rows[index % register.rows.length].map((cell, column) => (column === 0 ? String(index + 1) : cell))),
  });

  it('runs every gesture on a 200-row table in a few milliseconds each', () => {
    const read = big(200);
    const text = serializeTable(read);
    const started = performance.now();
    expect(serializeTable(parseTable(text))).toBe(text);
    setCell(read, 150, 2, 'identified');
    insertRow(read, 100);
    removeRow(read, 100);
    moveRow(read, 0, 199);
    insertColumn(read, 4, { header: 'New' });
    moveColumn(read, 0, 8);
    sortRows(read, 1);
    sortRows(read, 0, 'desc');
    fillColumn(read, 3, '50%');
    readColumns(read);
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it('grows with the table, not with its square', () => {
    const time = (count) => {
      const read = big(count);
      const started = performance.now();
      for (let round = 0; round < 3; round += 1) {
        parseTable(serializeTable(read));
        setCell(read, count - 1, 1, `x${round}`);
        sortRows(read, 0, 'desc');
      }
      return performance.now() - started;
    };
    time(300);
    const small = time(500);
    const large = time(5000);
    expect(large / small).toBeLessThan(40);
  });
});
