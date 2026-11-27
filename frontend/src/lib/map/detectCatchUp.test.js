import { describe, expect, it } from 'vitest';
import { MAX_CATCH_UP, catchUpSpan, chosenPasses, missedPasses, whyLabel } from './detectCatchUp.js';

const pass = (date, cloud = 5, coverage = 1, extra = {}) => ({ date, cloud, coverage, ...extra });

describe('catching a routine up', () => {
  it('looks from the first pass read, or a month back for a routine never run', () => {
    expect(catchUpSpan(['2026-10-02', '2026-09-27'], '2026-11-24')).toEqual({ start: '2026-09-27', end: '2026-11-24' });
    expect(catchUpSpan([], '2026-11-24')).toEqual({ start: '2026-10-25', end: '2026-11-24' });
    // a routine against a fixed day looks from that day, when it comes before what it read
    expect(catchUpSpan(['2026-11-25'], '2026-11-27', '2026-07-27')).toEqual({ start: '2026-07-27', end: '2026-11-27' });
    expect(catchUpSpan([], '2026-11-27', '2026-07-27')).toEqual({ start: '2026-07-27', end: '2026-11-27' });
    expect(catchUpSpan(['2026-06-01'], '2026-11-27', '2026-07-27')).toEqual({ start: '2026-06-01', end: '2026-11-27' });
  });

  it('ticks the newer passes the rule would take, and marks the rest', () => {
    const rows = missedPasses([
      pass('2026-11-23'), pass('2026-11-21', 62), pass('2026-11-18', 4, 0.6), pass('2026-11-03'), pass('2026-10-14'),
      pass('2026-11-23'),
    ], ['2026-09-27', '2026-11-03'], { maxcc: 30 });
    expect(rows.map((row) => [row.date, row.read, row.gap, row.why, row.picked])).toEqual([
      ['2026-11-23', false, false, '', true],
      ['2026-11-21', false, false, 'cloud', false],
      ['2026-11-18', false, false, 'cover', false],
      ['2026-11-03', true, false, '', false],
      ['2026-10-14', false, true, '', false],
    ]);
    expect(whyLabel(rows[1], 30)).toBe('over the 30% cloud limit');
    expect(whyLabel(rows[2], 30)).toBe('60% of the areas');
  });

  it('keeps a radar routine on its track, whatever the sky', () => {
    const rows = missedPasses([
      pass('2026-11-20', null, 1, { time: '05:42:10' }), pass('2026-11-19', null, 1, { time: '17:20:00' }),
    ], ['2026-11-01'], { radar: true, track: '05:41:00' });
    expect(rows.map((row) => [row.date, row.why, row.picked])).toEqual([['2026-11-20', '', true], ['2026-11-19', 'track', false]]);
    expect(whyLabel(rows[1])).toBe('another track');
  });

  it('sends the ticked passes oldest first, never one already read', () => {
    const rows = missedPasses([pass('2026-11-23'), pass('2026-11-21', 62), pass('2026-11-03')], ['2026-11-03'], { maxcc: 30 });
    const ticked = new Set(['2026-11-23', '2026-11-21', '2026-11-03']);
    expect(chosenPasses(rows, ticked)).toEqual([{ date: '2026-11-21' }, { date: '2026-11-23' }]);
    expect(MAX_CATCH_UP).toBe(30);
  });
});
