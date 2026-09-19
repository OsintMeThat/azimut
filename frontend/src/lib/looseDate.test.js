import { describe, expect, it } from 'vitest';
import {
  composeLooseDate,
  decomposeLooseDate,
  friendlyDate,
  parseLooseDate,
} from './looseDate.js';
import { TEMPORAL_SYNTAX } from './temporalInput.js';
import { validateTemporalValue } from './timeline.js';

const read = (text) => parseLooseDate(text).value;

// Everything the old three-list editor could write, and every example the
// stored profile documents: the one field must keep each of them exactly.
const STORED = [
  '2025', '2025~', '2025?', '2025%',
  '2025-10', '2025-10~', '2025-10?', '2025-10%',
  '2025-10-24', '2025-10-24~', '2025-10-24?', '2025-10-24%',
  '2025-10-24T14:30:00', '2025-10-24T14:30:05', '2025-10-24T14:30:00Z',
  '2025-10-24T14:30:00+02:00', '2025-10-24T14:30:00-05:30', '2025-10-24T14:30:00.123Z',
  '2025-10-24T14:30:05.250000+01:00',
  '2025-10-24/2025-10-26', '2025-10~/2025-12?', '2025/2026%',
  '2025-10-24T10:00:00Z/2025-10-24T12:30:00Z',
  '2025-10-24T10:00:00+02:00/2025-10-25T09:00:00+02:00',
  '0001', '9998-12-31',
  ...TEMPORAL_SYNTAX.map((row) => row.example),
];

describe('a stored value', () => {
  it('is kept exactly as typed', () => {
    for (const value of STORED) {
      expect(validateTemporalValue(value).valid, value).toBe(true);
      expect(read(value), value).toBe(value);
    }
  });

  it('is written back in a form that reads as the same value', () => {
    for (const value of STORED) {
      const shown = friendlyDate(value);
      expect(read(shown), `${value} shown as ${shown}`).toBe(value);
    }
  });

  it('is shown day-first, the way it was asked for', () => {
    expect(friendlyDate('2025-10-24')).toBe('24/10/2025');
    expect(friendlyDate('2025-10')).toBe('Oct 2025');
    expect(friendlyDate('2025')).toBe('2025');
    expect(friendlyDate('2025-10-24~')).toBe('~24/10/2025');
    expect(friendlyDate('2025-10-24?')).toBe('24/10/2025?');
    expect(friendlyDate('2025-10-24%')).toBe('~24/10/2025?');
    expect(friendlyDate('2025-10-24T14:30:00Z')).toBe('24/10/2025 14:30 UTC');
    expect(friendlyDate('2025-10-24T14:30:05+02:00')).toBe('24/10/2025 14:30:05 +02:00');
    expect(friendlyDate('2025-10-24T14:30:00')).toBe('24/10/2025 14:30');
    expect(friendlyDate('2025-10-24/2025-10-26')).toBe('24/10/2025 to 26/10/2025');
  });

  it('is left alone when it is not one, so the save still refuses it', () => {
    expect(friendlyDate('last tuesday')).toBe('last tuesday');
    expect(friendlyDate('')).toBe('');
  });
});

describe('what an analyst types', () => {
  it('reads a day, day first, whatever the separator', () => {
    for (const text of ['24/10/2025', '24.10.2025', '24-10-2025', '24/10/2025 ', '2025-10-24']) {
      expect(read(text), text).toBe('2025-10-24');
    }
    expect(read('1/2/2025')).toBe('2025-02-01');
  });

  it('reads a month and a year', () => {
    expect(read('10/2025')).toBe('2025-10');
    expect(read('Oct 2025')).toBe('2025-10');
    expect(read('october 2025')).toBe('2025-10');
    expect(read('octobre 2025')).toBe('2025-10');
    expect(read('août 2025')).toBe('2025-08');
    expect(read('2025')).toBe('2025');
  });

  it('reads a day written in words, in either order', () => {
    expect(read('24 Oct 2025')).toBe('2025-10-24');
    expect(read('Oct 24, 2025')).toBe('2025-10-24');
    expect(read('24th October 2025')).toBe('2025-10-24');
    expect(read('1er décembre 2025')).toBe('2025-12-01');
  });

  it('reads how sure the analyst is', () => {
    expect(read('~24/10/2025')).toBe('2025-10-24~');
    expect(read('about Oct 2025')).toBe('2025-10~');
    expect(read('circa 2025')).toBe('2025~');
    expect(read('24/10/2025?')).toBe('2025-10-24?');
    expect(read('~Oct 2025?')).toBe('2025-10%');
  });

  it('reads a time, local unless a zone follows it', () => {
    expect(read('24/10/2025 14:30')).toBe('2025-10-24T14:30:00');
    expect(read('24/10/2025 14h30')).toBe('2025-10-24T14:30:00');
    expect(read('24/10/2025 14:30 UTC')).toBe('2025-10-24T14:30:00Z');
    expect(read('24/10/2025 14:30Z')).toBe('2025-10-24T14:30:00Z');
    expect(read('24/10/2025 14:30 +02:00')).toBe('2025-10-24T14:30:00+02:00');
    expect(read('24/10/2025 14:30 UTC+2')).toBe('2025-10-24T14:30:00+02:00');
    expect(read('24/10/2025 14:30 -0530')).toBe('2025-10-24T14:30:00-05:30');
    expect(read('2025-10-24T14:30')).toBe('2025-10-24T14:30:00');
    expect(read('24 Oct 2025 09:05:07')).toBe('2025-10-24T09:05:07');
  });

  it('reads two dates as a range', () => {
    expect(read('24/10/2025 to 26/10/2025')).toBe('2025-10-24/2025-10-26');
    expect(read('Oct 2025 - Dec 2025')).toBe('2025-10/2025-12');
    expect(read('between 2024 and 2025')).toBe('2024/2025');
    expect(read('~Oct 2025 to Dec 2025?')).toBe('2025-10~/2025-12?');
    expect(read('24/10/2025 10:00 to 12:30 UTC')).toBe('2025-10-24T10:00:00Z/2025-10-24T12:30:00Z');
  });

  it('never reads the minus of an offset as a range', () => {
    expect(read('24/10/2025 14:30 -05:00')).toBe('2025-10-24T14:30:00-05:00');
  });
});

describe('what cannot be read', () => {
  const error = (text) => parseLooseDate(text).error;

  it('says why, and stores nothing in its place', () => {
    expect(parseLooseDate('last tuesday').value).toBeNull();
    expect(error('last tuesday')).toMatch(/Try 24\/10\/2025/);
    expect(error('31/02/2025')).toBe('That date does not exist.');
    expect(error('24/10/25')).toBe('Write the year in full, like 2025.');
    expect(error('~24/10/2025 14:30')).toMatch(/cannot be marked/);
    expect(error('Oct 2025 14:30')).toMatch(/full day/);
    expect(error('14:30')).toMatch(/day this time/);
    expect(error('26/10/2025 to 24/10/2025')).toBe('The end must come after the start.');
    expect(error('24/10/2025 10:00 to 24/10/2025 12:00')).toMatch(/timezones/);
  });

  it('reads an empty field as no date at all', () => {
    expect(parseLooseDate('   ')).toEqual({ value: '', error: '' });
  });
});

describe('a date built by pointing at it', () => {
  it('writes the pieces the builder collects into the stored profile', () => {
    expect(composeLooseDate({ start: '2025-10-24' })).toBe('2025-10-24');
    expect(composeLooseDate({ start: '2025-10', approximate: true })).toBe('2025-10~');
    expect(composeLooseDate({ start: '2025', uncertain: true })).toBe('2025?');
    expect(composeLooseDate({ start: '2025-10-24', approximate: true, uncertain: true }))
      .toBe('2025-10-24%');
    // the marks describe how well the date is known, so both ends carry them
    expect(composeLooseDate({ start: '2025-10', end: '2025-12', approximate: true }))
      .toBe('2025-10~/2025-12~');
    expect(composeLooseDate({ start: '' })).toBe('');
  });

  it('is read back the same way, so the builder opens on what is there', () => {
    expect(decomposeLooseDate('2025-10-24%')).toEqual({
      start: '2025-10-24', end: '', approximate: true, uncertain: true,
    });
    expect(decomposeLooseDate('2025-10~/2025-12~')).toEqual({
      start: '2025-10', end: '2025-12', approximate: true, uncertain: false,
    });
    expect(decomposeLooseDate('')).toEqual({
      start: '', end: '', approximate: false, uncertain: false,
    });
  });

  it('refuses to draw what it cannot build, rather than dropping half of it', () => {
    // an hour is typed: a builder of hours is the three-list form this replaced
    expect(decomposeLooseDate('2025-10-24T14:30:00Z')).toBeNull();
    expect(decomposeLooseDate('nonsense')).toBeNull();
  });

  it('round-trips through the field, whatever was built', () => {
    for (const value of ['2025', '2025-10~', '2025-10-24%', '2025-10~/2025-12~']) {
      expect(composeLooseDate(decomposeLooseDate(value))).toBe(value);
      expect(parseLooseDate(friendlyDate(value)).value).toBe(value);
    }
  });
});
