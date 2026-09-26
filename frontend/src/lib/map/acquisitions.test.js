import { describe, expect, it } from 'vitest';
import {
  FULL_COVER,
  acquisitionQuery,
  allowed,
  areaKey,
  coverClass,
  coverLabel,
  coverageWarning,
  lookupSpan,
  olderSpan,
  spanProblem,
  sweptNote,
  withOlder,
} from './acquisitions.js';

const zone = (id) => ({
  id,
  name: 'Harbour',
  kind: 'rect',
  points: [[2.2, 48.8], [2.3, 48.9]],
});

describe('acquisitions over drawn areas', () => {
  it('asks about the areas over a window ending today', () => {
    const now = new Date('2026-05-31T09:00:00Z');
    const query = acquisitionQuery([zone('a'), zone('b')], 30, now);
    expect(query.start).toBe('2026-05-01');
    expect(query.end).toBe('2026-05-31');
    expect(query.zones).toHaveLength(2);
    // only the shape the backend's Zone model accepts; extra:'forbid' there
    // turns a stray key into a 422 rather than an ignored field
    expect(Object.keys(query.zones[0]).sort()).toEqual(['id', 'kind', 'name', 'points']);
  });

  it('asks about two days picked in the calendar as they are', () => {
    const query = acquisitionQuery([zone('a')], { start: '2019-03-01', end: '2019-06-30' }, undefined, 'sentinel1');
    expect([query.start, query.end, query.collection]).toEqual(['2019-03-01', '2019-06-30', 'sentinel1']);
    expect(lookupSpan(90, new Date('2026-05-31T09:00:00Z'))).toEqual({ start: '2026-03-02', end: '2026-05-31' });
  });

  it('needs both days, in order, and nothing of a preset', () => {
    expect(spanProblem(30)).toBe('');
    expect(spanProblem({ start: '2019-03-01', end: '' })).toBe('Pick the first and the last day.');
    expect(spanProblem({ start: '2019-06-30', end: '2019-03-01' })).toBe('The first day comes after the last.');
    expect(spanProblem({ start: '2019-03-01', end: '2019-03-01' })).toBe('');
  });

  it('looks for what a cut list lacks before its oldest pass, that day included', () => {
    const list = [{ date: '2026-05-11' }, { date: '2026-02-03' }];
    expect(olderSpan({ start: '2025-01-01', end: '2026-05-31' }, list)).toEqual({ start: '2025-01-01', end: '2026-02-03' });
    expect(olderSpan(365, list, new Date('2026-05-31T09:00:00Z'))).toEqual({ start: '2025-05-31', end: '2026-02-03' });
    // the list already reaches the first day asked, or there is no list
    expect(olderSpan({ start: '2026-02-03', end: '2026-05-31' }, list)).toBe(null);
    expect(olderSpan(365, [])).toBe(null);
  });

  it('adds the older passes under the list, each pass once and the fuller copy kept', () => {
    const cut = { date: '2026-02-03', coverage: 0.4 };
    const whole = { date: '2026-02-03', coverage: 1 };
    const merged = withOlder([{ date: '2026-05-11' }, cut], [whole, { date: '2026-01-29' }]);
    expect(merged.map((entry) => entry.date)).toEqual(['2026-05-11', '2026-02-03', '2026-01-29']);
    expect(merged[1]).toBe(whole);
    // a radar day holds two passes, told apart by their time
    const radar = withOlder([{ date: '2026-05-14', time: '17:33:02' }], [{ date: '2026-05-14', time: '05:42:10' }]);
    expect(radar.map((entry) => entry.time)).toEqual(['17:33:02', '05:42:10']);
  });

  it('drops nothing a stray editor field added to a zone', () => {
    const query = acquisitionQuery([{ ...zone('a'), selected: true, colour: '#fff' }], 30);
    expect(query.zones[0].selected).toBeUndefined();
    expect(query.zones[0].points).toEqual([[2.2, 48.8], [2.3, 48.9]]);
  });

  it('ties a coverage share to the shapes it was measured over', () => {
    // redraw the areas and every number in the list is about ground nobody is
    // asking about any more, so the key changes and the list goes
    const drawn = [zone('a')];
    expect(areaKey(drawn)).toBe(areaKey([zone('a')]));
    expect(areaKey(drawn)).not.toBe(areaKey([{ ...zone('a'), points: [[9, 40], [9.1, 40.1]] }]));
    expect(areaKey(drawn)).not.toBe(areaKey([zone('a'), zone('b')]));
    expect(areaKey([])).toBe(areaKey(undefined));
  });

  it('does not charge a Copernicus request for renaming an area', () => {
    // geometry only: a name is nothing a satellite swath cares about
    const drawn = [zone('a')];
    expect(areaKey(drawn)).toBe(areaKey([{ ...zone('a'), id: 'other', name: 'Renamed' }]));
  });

  it('reads a coverage share as whole, partial or barely there', () => {
    expect(coverLabel(1)).toBe('Full cover');
    expect(coverLabel(FULL_COVER)).toBe('Full cover');
    expect(coverLabel(0.62)).toBe('62% of the areas');
    expect(coverClass(1)).toBe('full');
    expect(coverClass(0.62)).toBe('part');
    expect(coverClass(0.2)).toBe('thin');
    expect(coverClass(undefined)).toBe('unknown');
  });

  it('keeps a pass the service gave no cloud figure for', () => {
    const list = [
      { date: '2026-05-11', cloud: 3 },
      { date: '2026-05-08', cloud: 74 },
      { date: '2026-05-06', cloud: null },
    ];
    // an unknown is not a reason to hide real imagery
    expect(allowed(list, 30).map((entry) => entry.date)).toEqual(['2026-05-11', '2026-05-06']);
    expect(allowed(undefined, 30)).toEqual([]);
  });

  it('warns before the run about the part of the area a pass misses', () => {
    expect(coverageWarning({ date: '2026-05-11', coverage: 1 })).toBe('');
    expect(coverageWarning(null)).toBe('');
    const note = coverageWarning({ date: '2026-05-08', coverage: 0.62 });
    expect(note).toContain('2026-05-08');
    expect(note).toContain('62%');
    expect(note).toContain('not swept');
  });

  it('says afterwards how much of the areas the run actually read', () => {
    // "nothing found" and "never looked" are not the same answer
    expect(sweptNote(1)).toBe('');
    expect(sweptNote(undefined)).toBe('');
    expect(sweptNote(0.62)).toContain('Swept 62%');
  });
});
