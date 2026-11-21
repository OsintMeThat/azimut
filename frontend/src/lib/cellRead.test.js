import { describe, expect, it } from 'vitest';
import FIXTURE from './cellReading.fixture.json';
import WORDS from './cellWords.json';
import {
  NO_YEAR,
  columnMarks,
  dayColumns,
  dayText,
  dayWords,
  digits,
  fold,
  monthWord,
  numberText,
  readAmount,
  readDay,
  readNumber,
} from './cellRead.js';

/**
 * One reader of a cell, in the browser and in the engine: what the grid says a cell holds
 * is what the chart draws off it. The fixture is the contract both sides answer exactly
 * (`tests/test_cellread.py` reads the same file).
 */

describe('the contract both readers answer', () => {
  it.each(FIXTURE.days.map((one) => [one.cell, one.reads]))('reads the day in %j', (cell, reads) => {
    expect(readDay(cell)).toEqual(reads);
  });

  it.each(FIXTURE.numbers.map((one) => [one.cell, one.decimal, one.reads]))('reads the number in %j (decimal %j)', (cell, decimal, reads) => {
    expect(readAmount(cell, decimal)).toEqual(reads);
  });

  it.each(FIXTURE.columns.map((one) => [one.cells, one.values]))('reads the column %j', (cells, values) => {
    const { decimal } = columnMarks(cells);
    expect(cells.map((cell) => readAmount(cell, decimal)?.value ?? null)).toEqual(values);
  });
});

describe('the words of a day', () => {
  it('folds a word as the tables were made', () => {
    expect(fold('Février.')).toBe('fevrier');
    expect(fold('MÄRZ')).toBe('marz');
    // accents stay outside the Latin script, where they are letters of the word
    expect(fold('Μαρτίου')).toBe('μαρτίου');
    expect(fold('5º')).toBe('5o');
    expect(fold('  a   b ')).toBe('a b');
  });

  it('holds every month and weekday as fold writes it', () => {
    for (const word of Object.keys(WORDS.months)) expect(fold(word)).toBe(word);
    for (const word of WORDS.weekdays) expect(fold(word)).toBe(word);
  });

  it('names a month in any language', () => {
    expect(monthWord('Mars')).toBe(3);
    expect(monthWord('listopad')).toBe(11);
    expect(monthWord('במרץ')).toBe(3);
    expect(monthWord('rover')).toBeNull();
    expect(monthWord('')).toBeNull();
  });

  it('makes every script’s digits ASCII', () => {
    expect(digits('٢٠٢٦')).toBe('2026');
    expect(digits('۱۲۰۰')).toBe('1200');
    expect(digits('१२')).toBe('12');
    expect(digits('１２')).toBe('12');
    expect(digits('𝟓')).toBe('5');
    expect(digits('١٫٥ ١٬٢٠٠')).toBe('1.5 1,200');
  });

  it('takes a month of three words, and a month whose first word is a small word', () => {
    expect(readDay('5 арван нэгдүгээр сар 2026')).toEqual({ precision: 'day', date: '2026-11-05', year: true });
    expect(dayWords('am faoilleach 2026')).toEqual({ day: null, month: 1, year: 2026 });
  });

  it('reads a number token as written, so a dot never joins two numbers', () => {
    expect(readDay('5. März 2026')?.date).toBe('2026-03-05');
    expect(readDay('1.5 March 2026')).toBeNull();
    expect(readDay('5º marzo 2026')?.date).toBe('2026-03-05');
    expect(readDay('123 March')).toBeNull();
    expect(readDay('tháng 1.2 2026')).toBeNull();
    expect(readDay('5 March 5 2026')).toBeNull();
  });

  it('leaves a day’s parts unchecked for a field that says what is wrong', () => {
    expect(dayWords('31 février 2026')).toEqual({ day: 31, month: 2, year: 2026 });
    expect(readDay('31 février 2026')).toBeNull();
    expect(dayWords('2026')).toBeNull();
  });
});

describe('a day', () => {
  it('takes the year given to a day written without one, and says it has one', () => {
    expect(readDay('5 Mar', 2024)).toEqual({ precision: 'day', date: '2024-03-05', year: true });
    expect(readDay('29 Feb')).toEqual({ precision: 'day', date: `${NO_YEAR}-02-29`, year: false });
    expect(readDay('29 Feb', 2025)).toBeNull();
  });

  it('reads a numeric day with one separator, and a year between 1000 and 2999', () => {
    expect(readDay('2026/03')?.precision).toBe('month');
    expect(readDay('3.2026')?.date).toBe('2026-03-01');
    expect(readDay('2026-03/05')).toBeNull();
    expect(readDay('05/03-2026')).toBeNull();
    expect(readDay('0999')).toBeNull();
    expect(readDay('3000')).toBeNull();
  });

  it('is printed the way the chart prints it', () => {
    expect(dayText(readDay('5 mars 2026'))).toBe('5 Mar 2026');
    expect(dayText(readDay('mars 2026'))).toBe('Mar 2026');
    expect(dayText(readDay('2026'))).toBe('2026');
    expect(dayText(readDay('5 mars'))).toBe('5 Mar');
    expect(dayText(readDay('Mars'))).toBe('Mar');
    expect(dayText(readDay('5 mars 2026'), { year: false })).toBe('5 Mar');
  });

  it('finds a table’s columns of days as the engine does', () => {
    const rows = [['5 mars 2026', 'Fire', '3'], ['6 mars', 'Smoke', '4'], ['', 'Ash', '']];
    expect(dayColumns(['When', 'What', 'Count'], rows)).toEqual([0]);
    // one day is enough in a column named for days
    expect(dayColumns(['Date', 'What'], [['5 mars 2026', 'Fire']])).toEqual([0]);
    expect(dayColumns(['Seen', 'What'], [['5 mars 2026', 'Fire']])).toEqual([]);
    expect(dayColumns(['Date', 'What'], [['5 mars 2026', 'Fire'], ['soon', 'Ash']])).toEqual([]);
  });
});

describe('a number', () => {
  it('is not a day, a bare year aside', () => {
    expect(readAmount('2026')).toEqual({ value: 2026, floor: false });
    expect(readAmount('2026-03')).toBeNull();
    expect(readAmount('3.2026')).toBeNull();
    expect(readAmount('5 mart')).toBeNull();
    expect(readAmount('360 m')).toEqual({ value: 360, floor: false });
  });

  it('keeps everything the cell says of it', () => {
    expect(readNumber('up to 20 km')).toMatchObject({ value: 20, ceiling: true, unit: 'km' });
    expect(readNumber('$120k-$250k')).toMatchObject({ value: null, range: [120000, 250000] });
  });

  it('is printed the way the chart prints it', () => {
    expect(numberText(1200)).toBe('1,200');
    expect(numberText(64e9)).toBe('64,000,000,000');
    expect(numberText(1200.5)).toBe('1,200.5');
    expect(numberText(1.25)).toBe('1.25');
    expect(numberText(2.256)).toBe('2.26');
    expect(numberText(-1234.5)).toBe('-1,234.5');
    expect(numberText(-5)).toBe('-5');
    // a tie goes to the even digit, as Python's format rounds it
    expect(numberText(0.125)).toBe('0.12');
    expect(numberText(0.375)).toBe('0.38');
    expect(numberText(1.005)).toBe('1');
  });
});
