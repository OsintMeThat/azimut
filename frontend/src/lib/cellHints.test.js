import { describe, expect, it } from 'vitest';
import { DAYS, EXAMPLE, NUMBERS, UNREAD, cellSays, columnReads, momentText, readsKey, sheetExpects, sheetSays } from './cellHints.js';

/**
 * A grid says what the chart reads: the column its kind, each cell what was understood,
 * what did not read and what to write in an empty one. It never says it by rewriting.
 */

const table = (header, rows) => ({ header, rows, align: header.map(() => null) });

describe('the columns a chart reads', () => {
  it('reads days where the chart reads days, as the engine finds them', () => {
    const rows = [['5 mars 2026', 'Fire'], ['2026-03-07', 'Smoke'], ['Mars rover', 'Ash']];
    expect([...columnReads(table(['When', 'What'], rows), 'timeline')]).toEqual([[0, { kind: DAYS }]]);
    // a chart of categories never reads its categories as days
    expect(columnReads(table(['When', 'What'], rows), 'categories').size).toBe(0);
    // one day is enough under a heading named for days
    expect(columnReads(table(['Date', 'What'], [['5 mars 2026', 'Fire']]), 'timeline').get(0)).toEqual({ kind: DAYS });
  });

  it('reads numbers where three quarters of the filled cells are one, with the column’s decimal mark', () => {
    const rows = [['Cougar', '1,5'], ['Kirpi', '2,25'], ['Otokar', '1,500'], ['Ural', 'n/a'], ['Kamaz', '']];
    expect(columnReads(table(['Model', 'Count'], rows), 'categories').get(1)).toEqual({ kind: NUMBERS, decimal: ',' });
    const loose = [['a', '12'], ['b', 'lots'], ['c', 'many']];
    expect(columnReads(table(['Model', 'Count'], loose), 'categories').size).toBe(0);
  });

  it('leaves out what it does not draw, the pictures, and a column of years', () => {
    const rows = [['2024', '12'], ['2025', '18']];
    const reads = columnReads(table(['Year', 'Strikes'], rows), 'categories');
    // `2024` is never printed 2,024
    expect([...reads.keys()]).toEqual([1]);
    expect(columnReads(table(['Year', 'Strikes'], rows), 'categories', new Set([1])).size).toBe(0);
    expect(columnReads(table(['Picture', '#'], [['a', '1'], ['b', '2']]), 'pictures').size).toBe(0);
    expect(readsKey(columnReads(table(['Year', 'Strikes'], rows), 'line'))).toBe('0:days,1:numbers.');
  });
});

describe('what a cell says of itself', () => {
  const days = { kind: DAYS };
  const numbers = { kind: NUMBERS, decimal: '.' };

  it('shows how the chart reads a day written otherwise, and nothing once it is written so', () => {
    expect(cellSays('5 mars 2026', days)).toEqual({ reading: '5 Mar 2026' });
    expect(cellSays('2026-03-05', days)).toEqual({ reading: '5 Mar 2026' });
    expect(cellSays('mars', days)).toEqual({ reading: 'Mar' });
    expect(cellSays('5 Mar 2026', days)).toBeNull();
    expect(cellSays('**5 Mar 2026**', days)).toBeNull();
    expect(cellSays('Mar 2026', days)).toBeNull();
    expect(cellSays('5 Mar', days)).toBeNull();
  });

  it('shows the number the chart draws, not a mere grouping of its digits', () => {
    expect(cellSays('1200', numbers)).toBeNull();
    expect(cellSays('1 200', numbers)).toBeNull();
    expect(cellSays('1,200', numbers)).toBeNull();
    expect(cellSays('12 %', numbers)).toBeNull();
    expect(cellSays('1 200 €', numbers)).toBeNull();
    expect(cellSays('at least 60', numbers)).toBeNull();
    expect(cellSays('60+', numbers)).toEqual({ reading: 'at least 60' });
    expect(cellSays('≥ 41', numbers)).toEqual({ reading: 'at least 41' });
    expect(cellSays('~60', numbers)).toEqual({ reading: '60' });
    expect(cellSays('8.3M', numbers)).toEqual({ reading: '8,300,000' });
    expect(cellSays('٦٠', numbers)).toEqual({ reading: '60' });
    expect(cellSays('1,5', { kind: NUMBERS, decimal: ',' })).toEqual({ reading: '1.5' });
    expect(cellSays('1,500', { kind: NUMBERS, decimal: ',' })).toEqual({ reading: '1.5' });
  });

  it('says what would read when it does not', () => {
    expect(cellSays('Mars rover', days)).toEqual({ unread: UNREAD[DAYS] });
    expect(cellSays('lots', numbers)).toEqual({ unread: UNREAD[NUMBERS] });
    expect(cellSays('8–10', numbers)).toEqual({ unread: UNREAD[NUMBERS] });
    expect(UNREAD[DAYS]).toBe('Not read as a day. Try 5 Mar 2026, 05/03/2026 or 2026-03-05, in any language.');
    expect(UNREAD[NUMBERS]).toBe('Not read as a number. Try 1200, 1 200, 1,5 or at least 60.');
  });

  it('shows what to write in an empty cell, and nothing for an unknown said with a dash', () => {
    expect(cellSays('', days)).toEqual({ example: EXAMPLE[DAYS] });
    expect(cellSays('  ', numbers)).toEqual({ example: '1 200' });
    expect(cellSays('-', numbers)).toBeNull();
    expect(cellSays('?', days)).toBeNull();
    expect(cellSays('anything', undefined)).toBeNull();
  });
});

describe('a sheet’s date and number columns', () => {
  const when = { kind: 'when', shape: 'date', dayFirst: true };
  const number = { kind: 'number', summary: 'sum' };

  it('expects days of a date column, numbers of a number column, and nothing of a column of clocks', () => {
    expect(sheetExpects(when)).toBe(DAYS);
    expect(sheetExpects(number)).toBe(NUMBERS);
    expect(sheetExpects({ kind: 'when', shape: 'time' })).toBe('');
    expect(sheetExpects({ kind: 'choice' })).toBe('');
    expect(sheetSays({ kind: 'choice' }, 'x')).toBeNull();
  });

  it('says how its role reads a cell, in the chart’s words', () => {
    expect(sheetSays(when, '31/01/2026')).toEqual({ reading: '31 Jan 2026' });
    expect(sheetSays(when, '03/01/2026 06:42')).toEqual({ reading: '3 Jan 2026 06:42' });
    expect(sheetSays(when, '5 mars 2026')).toEqual({ reading: '5 Mar 2026' });
    expect(sheetSays(when, 'mars 2026')).toEqual({ reading: 'Mar 2026' });
    expect(sheetSays(when, '5 Mar 2026')).toEqual({});
    expect(sheetSays(when, 'soon')).toEqual({ unread: UNREAD[DAYS] });
    expect(sheetSays(when, '')).toEqual({ example: '5 Mar 2026' });
    expect(sheetSays(number, '1 200')).toEqual({});
    expect(sheetSays(number, '1 200 €')).toEqual({});
    expect(sheetSays(number, 'at least 60')).toEqual({});
    // the sheet reads a comma as its decimal mark
    expect(sheetSays(number, '1,500')).toEqual({ reading: '1.5' });
    expect(sheetSays(number, 'unknown')).toEqual({ unread: UNREAD[NUMBERS] });
    expect(sheetSays(number, '')).toEqual({ example: '1 200' });
  });

  it('prints a moment at the precision it was read', () => {
    expect(momentText({ shape: 'moment', text: '2026-03' })).toBe('Mar 2026');
    expect(momentText({ shape: 'moment', text: '2026' })).toBe('2026');
    expect(momentText({ shape: 'time', text: '01:57' })).toBe('01:57');
  });
});
