import { describe, expect, it } from 'vitest';
import {
  WEEKDAYS,
  monthDays,
  monthLabel,
  monthOf,
  monthOutOfRange,
  outOfRange,
  parseDay,
  shiftMonth,
  today,
} from './calendar.js';

describe('reading a day', () => {
  it('takes the one form the services and the fields agree on', () => {
    expect(parseDay('2026-09-12')?.toISOString()).toBe('2026-09-12T00:00:00.000Z');
    for (const bad of ['', null, '12/09/2026', '2026-9-1', '2026-09-12T10:00']) {
      expect(parseDay(bad), String(bad)).toBe(null);
    }
  });

  it('refuses a day that does not exist, rather than sliding into the next month', () => {
    // `new Date('2026-02-31')` is March 3rd, which is not the day that was typed
    expect(parseDay('2026-02-31')).toBe(null);
    expect(parseDay('2024-02-29')).not.toBe(null); // …and a leap day does exist
  });

  it('reads today in UTC, the clock the fire layer keeps', () => {
    expect(today(new Date('2026-09-12T23:30:00Z'))).toBe('2026-09-12');
  });
});

describe('the month a calendar opens on', () => {
  it('is the day’s own, and today’s when there is no day yet', () => {
    expect(monthOf('2026-03-04')).toBe('2026-03');
    expect(monthOf('', '2026-09-12')).toBe('2026-09');
    expect(monthOf('nonsense', '2026-09-12')).toBe('2026-09');
  });

  it('walks whole months, across a year', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-03-31', -1)).toBe('2026-02'); // a day is a cursor too
  });

  it('names itself the way the heading reads it', () => {
    expect(monthLabel('2026-09')).toBe('Sep 2026');
  });
});

describe('the grid', () => {
  it('starts on Monday and fills every week to seven', () => {
    expect(WEEKDAYS).toHaveLength(7);
    const cells = monthDays('2026-09');
    expect(cells.length % 7).toBe(0);
    // 1 September 2026 is a Tuesday, so the row before it carries 31 August
    expect(cells[0].iso).toBe('2026-08-31');
    expect(cells[1]).toEqual({ iso: '2026-09-01', day: 1, inMonth: true });
    expect(cells[0].inMonth).toBe(false);
  });

  it('keeps the month whole, and no more rows than it needs', () => {
    const days = monthDays('2026-09').filter((cell) => cell.inMonth);
    expect(days).toHaveLength(30);
    // February 2027 starts on a Monday and runs 28 days: exactly four rows, and
    // a fifth would make the panel jump by a row between two months
    expect(monthDays('2027-02')).toHaveLength(28);
    expect(monthDays('2026-08')).toHaveLength(42); // …and one that does need six
  });

  it('carries a leap day', () => {
    expect(monthDays('2024-02').filter((cell) => cell.inMonth)).toHaveLength(29);
  });
});

describe('what the field will not accept', () => {
  it('is either side of the bounds it was given', () => {
    expect(outOfRange('2026-09-12', '2026-09-01', '2026-09-30')).toBe(false);
    expect(outOfRange('2026-08-31', '2026-09-01', '')).toBe(true);
    expect(outOfRange('2026-10-01', '', '2026-09-30')).toBe(true);
    expect(outOfRange('', '', '')).toBe(true);
  });

  it('takes an empty bound as no bound, which is how an open range is stated', () => {
    expect(outOfRange('1999-01-01', '', '')).toBe(false);
  });

  it('greys the arrow rather than walking into a month nothing can answer for', () => {
    expect(monthOutOfRange('2026-10', '', '2026-09-30')).toBe(true);
    expect(monthOutOfRange('2026-09', '', '2026-09-30')).toBe(false);
    // the bounds fall inside the month: it is reachable, and only some of its
    // days are not
    expect(monthOutOfRange('2026-09', '2026-09-20', '2026-09-30')).toBe(false);
  });
});
