import { describe, expect, it } from 'vitest';
import {
  askable,
  DATED,
  lastDayOf,
  MAX_RANGE_DAYS,
  summary,
  tileParams,
  today,
  WINDOWS,
} from './firms.js';

const SENSORS = [
  { id: 'viirs', label: 'VIIRS (S-NPP + NOAA-20)' },
  { id: 'modis', label: 'MODIS (Terra + Aqua)' },
];

describe('what to ask FIRMS for', () => {
  it('asks by how recent, for the rolling windows', () => {
    expect(tileParams({ sensor: 'viirs', window: '24h' })).toEqual({
      sensor: 'viirs',
      window: '24h',
    });
  });

  it('leaves the dates out of a rolling window', () => {
    // they would be two more things to keep in step with a layer that already
    // means "the last 24 hours"
    const params = tileParams({ sensor: 'viirs', window: '7d', first: '2026-01-01' });
    expect(params.first).toBeUndefined();
  });

  it('asks by date for the archive, and reads one day as a range of itself', () => {
    expect(tileParams({ sensor: 'modis', window: DATED, first: '2026-08-01' })).toEqual({
      sensor: 'modis',
      window: DATED,
      first: '2026-08-01',
      last: '2026-08-01',
    });
  });
});

describe('what the service will answer', () => {
  it('accepts every window it offers', () => {
    for (const entry of WINDOWS) expect(askable({ window: entry.id })).toBe(true);
  });

  it('waits rather than asking, while a dated window has no date', () => {
    // switching to Dates is not an error, so the layer holds instead of
    // fetching tiles that come back as an exception report
    expect(askable({ window: DATED })).toBe(false);
    expect(askable({ window: DATED, first: 'soon' })).toBe(false);
  });

  it('accepts a single day and a range inside the limit', () => {
    expect(askable({ window: DATED, first: '2026-08-01' })).toBe(true);
    expect(askable({ window: DATED, first: '2026-08-01', last: '2026-08-09' })).toBe(true);
  });

  it('refuses a range longer than FIRMS allows', () => {
    expect(askable({ window: DATED, first: '2026-01-01', last: '2026-03-01' })).toBe(false);
  });

  it('refuses a range that ends before it starts', () => {
    expect(askable({ window: DATED, first: '2026-08-09', last: '2026-08-01' })).toBe(false);
  });

  it('says where a range has to stop, so the input can say it too', () => {
    expect(lastDayOf('2026-01-01')).toBe('2026-01-31');
    expect(askable({ window: DATED, first: '2026-01-01', last: lastDayOf('2026-01-01') })).toBe(
      true
    );
    expect(lastDayOf('')).toBe('');
  });

  it('counts the first day as one of the days', () => {
    const first = '2026-05-10';
    const days =
      (new Date(`${lastDayOf(first)}T00:00:00Z`) - new Date(`${first}T00:00:00Z`)) / 86400000;
    expect(days).toBe(MAX_RANGE_DAYS - 1);
  });

  it('opens on a day that exists', () => {
    expect(today(new Date('2026-09-12T22:30:00Z'))).toBe('2026-09-12');
  });
});

describe('what the row says it is showing', () => {
  it('names the instrument without the satellites it is made of', () => {
    // "VIIRS (S-NPP + NOAA-20) · 24 h" does not fit a layer row
    expect(summary({ sensor: 'viirs', window: '24h' }, SENSORS)).toBe('VIIRS · 24 h');
  });

  it('names the day, or the range, when it is showing the archive', () => {
    expect(summary({ sensor: 'modis', window: DATED, first: '2026-08-01' }, SENSORS)).toBe(
      'MODIS · 2026-08-01'
    );
    expect(
      summary({ sensor: 'modis', window: DATED, first: '2026-08-01', last: '2026-08-09' }, SENSORS)
    ).toBe('MODIS · 2026-08-01 → 2026-08-09');
  });

  it('asks for the date it is waiting on', () => {
    expect(summary({ sensor: 'viirs', window: DATED }, SENSORS)).toBe('VIIRS · pick a date');
  });
});
