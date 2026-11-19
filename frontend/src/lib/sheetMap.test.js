/**
 * What a sheet is proposed to go on a map with, and how the plan is said.
 *
 * The proposal reads the roles the sheet already has, then `detectRole` — the register the
 * owner keeps writes its positions as `12.74625, 43.49463 (±30 m)` and `~12.7590, 43.4950
 * (±450 m)`, so the first table here is that register's shape.
 */
import { describe, expect, it } from 'vitest';
import {
  cleanChoice, datedWords, howWords, placedWords, sheetLine, suggestChoice, unplacedWords, updatedWords,
} from './sheetMap.js';

const RECORDED = {
  columns: ['id', '#', 'Identification', 'Grade', 'Conf.', 'State', 'Position', 'Close-up', 'Frame'],
  rows: [
    ['r1', '1', 'Streit Cougar', 'confirmed', '80%', 'burned', 'zone: between Dhubab and the airport road', '–', ''],
    ['r2', '6', 'BATT UMG', 'confirmed', '95%', 'burned', '~12.7590, 43.4950 (±450 m)', 'A', ''],
    ['r3', '7', 'Oshkosh M-ATV', 'confirmed', '90%', 'abandoned nose down in a ditch', '12.74625, 43.49463 (±30 m)', 'C', ''],
    ['r4', '9', 'Toyota Land Cruiser 70', 'set aside', '60%', 'burned', '~12.7451, 43.4949 (±60 m)', 'C', ''],
    ['r5', '10', 'Harrow Tygor E1', 'almost sure', '65%', 'abandoned, intact', '12.73568, 43.49312 (±30 m)', 'D', ''],
    ['r6', '12', 'Al-Wahsh MRAP', 'almost sure', '85%', 'abandoned, damaged', '12.73586, 43.49302 (±30 m)', 'D', ''],
    ['r7', '17', 'BATT UMG', 'strong doubt', '55%', 'destroyed', '12.72547, 43.49280 (±20 m)', 'F', ''],
  ],
};
/** Twice as long, as the register is: a set of four grades only reads as one over enough rows. */
const REGISTER = { columns: RECORDED.columns, rows: [...RECORDED.rows, ...RECORDED.rows.map(([id, ...rest]) => [`${id}b`, ...rest])] };

describe('the columns proposed', () => {
  it('reads a register: its hedged positions, its names, its grades and a card of the rest', () => {
    const choice = suggestChoice(REGISTER, {});
    expect(choice.place).toBe('Position');
    expect(choice.lon).toBe('');
    expect(choice.name).toBe('Identification');
    expect(choice.colour).toBe('Grade');
    expect(choice.start).toBe('');
    // an empty column is left off the card, and the place and the name are not on it twice
    expect(choice.card).toEqual(['#', 'Grade', 'Conf.', 'State', 'Close-up']);
  });

  it('takes two columns of numbers named like a latitude and a longitude', () => {
    const table = { columns: ['id', 'Name', 'Lat', 'Longitude'], rows: [['r1', 'A', '12.5', '43.4'], ['r2', 'B', '12.6', '43.5']] };
    expect(suggestChoice(table, {})).toMatchObject({ place: 'Lat', lon: 'Longitude', name: 'Name' });
  });

  it('lets a role the analyst set win over what the cells look like', () => {
    const table = { columns: ['id', 'Where', 'When', 'Until', 'Side'],
      rows: [['r1', 'Kherson', '2026-09-03', '2026-09-05', 'A'], ['r2', 'Mykolaiv', '2026-09-04', '', 'B'], ['r3', 'Odesa', '', '', 'A']] };
    const meta = { roles: { Where: { kind: 'latlon' }, When: { kind: 'when' }, Until: { kind: 'when' }, Side: { kind: 'choice' } } };
    expect(suggestChoice(table, meta)).toMatchObject({ place: 'Where', start: 'When', end: 'Until', colour: 'Side' });
  });

  it('falls back on a column named for places, and proposes nothing it cannot find', () => {
    const table = { columns: ['id', 'Notes', 'Location'], rows: [['r1', 'one', 'Kherson'], ['r2', 'two', 'Odesa']] };
    expect(suggestChoice(table, {}).place).toBe('Location');
    expect(suggestChoice({ columns: ['id'], rows: [] }, {})).toEqual({ place: '', lon: '', name: '', card: [], colour: '', start: '', end: '' });
  });

  it('never sends an end without a start, nor a card longer than a point shows', () => {
    const many = Array.from({ length: 12 }, (_, index) => `C${index}`);
    expect(cleanChoice({ place: 'P', end: 'E', card: many })).toEqual({
      place: 'P', lon: '', name: '', colour: '', start: '', end: '', card: many.slice(0, 8),
    });
  });
});

describe('the plan, said', () => {
  const plan = { rows: 23, placed: 18, unplaced_count: 5, hows: { coordinates: 17, mgrs: 1 }, dated: 3, undated: 15, first: '2026-09-03', last: '2026-11-01' };

  it('counts the rows that go on the map and the ones that stay off it', () => {
    expect(placedWords(plan)).toBe('18 of 23 rows go on the map.');
    expect(placedWords({ rows: 2, placed: 2 })).toBe('All 2 rows go on the map.');
    expect(placedWords({ rows: 2, placed: 0 })).toBe('No row has a place the map can read.');
    expect(unplacedWords(plan)).toBe('5 rows have no place the map can read and stay off it.');
    expect(unplacedWords({ unplaced_count: 1 })).toBe('1 row has no place the map can read and stays off it.');
    expect(unplacedWords({ unplaced_count: 0 })).toBe('');
  });

  it('says how the places were read and what the days are', () => {
    expect(howWords(plan.hows)).toBe('Read as coordinates (17) and a grid reference (1).');
    expect(datedWords(plan, { start: 'Seen' })).toBe('3 points are dated from 3 Sep 2026 to 1 Nov 2026. 15 with no readable date show on every day.');
    expect(datedWords(plan, { start: '' })).toBe('');
  });

  it('says what an update did and what it kept of the analyst’s', () => {
    expect(updatedWords({ added: 2, changed: 1, removed: 0, kept: 1, left_out: 1 }))
      .toBe('Layer updated: 2 added, 1 changed. 1 point keeps your edits; 1 you took out stays out.');
    expect(updatedWords({ added: 0, changed: 0, removed: 0, kept: 0, left_out: 0 })).toBe('The layer already says what the sheet says.');
    expect(updatedWords({ added: 1, changed: 0 }, 5)).toBe('Layer updated: 1 added. 5 rows have no place and stay off it.');
  });

  it('says where a layer comes from and when its sheet moved on or left', () => {
    expect(sheetLine({ sheet: { title: 'Register', changed: false } })).toBe('From the sheet “Register”');
    expect(sheetLine({ sheet: { title: 'Register', changed: true } })).toBe('The sheet changed');
    expect(sheetLine({ sheet: { title: 'Register', gone: true } })).toBe('Its sheet “Register” is no longer in the case');
    expect(sheetLine({})).toBe('');
  });
});
