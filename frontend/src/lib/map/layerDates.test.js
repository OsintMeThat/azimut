import { describe, expect, it } from 'vitest';
import {
  active,
  bars,
  dayLabel,
  dayNumber,
  histogram,
  indexDates,
  inPeriod,
  isoDay,
  periodFrom,
  within,
} from './layerDates.js';

/**
 * The arithmetic under an added layer's time filter. What matters is that the
 * strip, the counter and the map agree about which features a period holds.
 */

const at = (date, category = 'Russia') => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [37, 48] },
  properties: { name: date, category, ...(date ? { date } : {}) },
});

const EVENTS = {
  type: 'FeatureCollection',
  features: [
    at('2026-09-01'),
    at('2026-09-01', 'Ukraine'),
    at('2026-09-05'),
    at('2026-09-10', 'Ukraine'),
    at('2026-09-18'),
    at(''), // an undated site
  ],
};

describe('days', () => {
  it('round-trip through the number the strip is laid out in', () => {
    expect(isoDay(dayNumber('2026-09-18'))).toBe('2026-09-18');
    expect(dayNumber('2026-09-19') - dayNumber('2026-09-18')).toBe(1);
  });

  it('refuse anything that is not a day', () => {
    expect(dayNumber('')).toBeNull();
    expect(dayNumber('Sept 18')).toBeNull();
    expect(dayNumber(undefined)).toBeNull();
  });

  it('are written the way the row writes them, whatever the locale', () => {
    expect(dayLabel('2026-08-12')).toBe('12 Aug 2026');
  });
});

describe('the index', () => {
  it('spans the first and last dated feature, and leaves the undated out', () => {
    const index = indexDates(EVENTS);

    expect(isoDay(index.first)).toBe('2026-09-01');
    expect(isoDay(index.last)).toBe('2026-09-18');
    expect([...index.groups.keys()].sort()).toEqual(['Russia', 'Ukraine']);
  });

  it('is nothing for a layer that dates nothing, so no strip is drawn', () => {
    expect(indexDates({ features: [at('')] })).toBeNull();
    expect(indexDates(null)).toBeNull();
  });
});

describe('the bars', () => {
  it('are days for a month, weeks for a year and months past two', () => {
    expect(bars(dayNumber('2026-09-01'), dayNumber('2026-09-30'))).toHaveLength(30);
    expect(bars(dayNumber('2025-09-19'), dayNumber('2026-09-18'))).toHaveLength(53);
    expect(bars(dayNumber('2022-02-24'), dayNumber('2026-09-18'))).toHaveLength(56);
  });

  it('cover the span exactly, first day to last', () => {
    const first = dayNumber('2022-02-24');
    const last = dayNumber('2026-09-18');
    const edges = bars(first, last);

    expect(edges[0].from).toBe(first);
    expect(edges.at(-1).to).toBe(last);
    for (let i = 1; i < edges.length; i += 1) expect(edges[i].from).toBe(edges[i - 1].to + 1);
  });

  it('count the visible groups only', () => {
    const index = indexDates(EVENTS);
    const edges = bars(index.first, index.last);

    expect(histogram(index, [], edges).reduce((a, b) => a + b, 0)).toBe(5);
    expect(histogram(index, ['Ukraine'], edges).reduce((a, b) => a + b, 0)).toBe(3);
    expect(histogram(index, [], edges)[0]).toBe(2); // two events on the first day
  });
});

describe('a period', () => {
  const index = indexDates(EVENTS);

  it('counts what it holds, in all and per group', () => {
    const counted = within(index, [], { start: '2026-09-02', end: '2026-09-10' });

    expect(counted.total).toBe(2);
    expect(counted.byGroup).toEqual({ Russia: 1, Ukraine: 1 });
  });

  it('includes both of its days', () => {
    expect(within(index, [], { start: '2026-09-01', end: '2026-09-01' }).total).toBe(2);
  });

  it('runs to the layer’s own edge where a bound is open', () => {
    expect(within(index, [], { start: '2026-09-05', end: '' }).total).toBe(3);
    expect(within(index, [], { start: '', end: '2026-09-05' }).total).toBe(3);
  });

  it('leaves a hidden group out of the total and in its own count', () => {
    const counted = within(index, ['Ukraine'], { start: '2026-09-01', end: '2026-09-30' });

    expect(counted.total).toBe(3);
    expect(counted.byGroup.Ukraine).toBe(2);
  });

  it('keeps an undated feature out, and keeps everything in when there is no period', () => {
    expect(inPeriod('', { start: '2026-09-01', end: '' })).toBe(false);
    expect(inPeriod('', null)).toBe(true);
    expect(inPeriod('2026-09-05', { start: '2026-09-01', end: '2026-09-05' })).toBe(true);
    expect(inPeriod('2026-09-06', { start: '2026-09-01', end: '2026-09-05' })).toBe(false);
  });

  it('dragged back out to both edges is no period at all', () => {
    expect(periodFrom(index.first, index.last, index)).toBeNull();
    expect(active(periodFrom(index.first, index.last, index))).toBe(false);
  });

  it('left on the last day stays open, so a refresh’s new events are in it', () => {
    expect(periodFrom(dayNumber('2026-09-05'), index.last, index)).toEqual({
      start: '2026-09-05',
      end: '',
    });
  });

  it('comes out the right way round whichever handle was dragged past the other', () => {
    expect(periodFrom(dayNumber('2026-09-10'), dayNumber('2026-09-05'), index)).toEqual({
      start: '2026-09-05',
      end: '2026-09-10',
    });
  });
});
