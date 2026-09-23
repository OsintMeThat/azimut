import { describe, expect, it } from 'vitest';
import {
  areaLine, setSide, sharedSide, sideLine, uniform, whenNeed, whenSummary, withRule,
} from './detectWhen.js';

const pair = (id, a = '', b = '', extra = {}) => ({
  area_id: id,
  a: { provider: 'sentinel2', date: a, layer: 'TRUE_COLOR', maxcc: 30 },
  b: { provider: 'sentinel2', date: b, layer: 'TRUE_COLOR', maxcc: 30 },
  date_rule: 'latest_reference',
  ...extra,
});

describe('the When step of a detection', () => {
  it('reads a side as its day, and a radar pass with its time', () => {
    expect(sideLine({ date: '2026-08-01' })).toBe('2026-08-01');
    expect(sideLine({ date: '2026-08-01', time: '16:32:10' }, true)).toBe('2026-08-01 16:32 UTC');
    expect(sideLine({ date: '' })).toBe('');
  });

  it('speaks for every area only while they agree', () => {
    const pairs = [pair('x', '2026-08-01'), pair('y', '2026-08-01')];
    expect(sharedSide(pairs, 'a')).toEqual({ date: '2026-08-01', time: '' });
    expect(uniform(pairs)).toBe(true);
    pairs[1].a.date = '2026-07-20';
    expect(sharedSide(pairs, 'a')).toBe(null);
    expect(uniform(pairs)).toBe(false);
    expect(sharedSide([], 'a')).toBe(null);
  });

  it('sets one side of every area, and a pass on B makes the run manual', () => {
    const set = setSide([pair('x'), pair('y')], 'b', '2026-09-06');
    expect(set.map((row) => row.b.date)).toEqual(['2026-09-06', '2026-09-06']);
    expect(set.map((row) => row.date_rule)).toEqual(['manual', 'manual']);
    expect(setSide(set, 'b', '').map((row) => row.date_rule)).toEqual(['latest_reference', 'latest_reference']);
    // a routine that compares with the pass before keeps that rule
    const routine = setSide([pair('x', '', '', { date_rule: 'latest_previous' })], 'b', '2026-09-06');
    expect(routine[0].date_rule).toBe('latest_previous');
  });

  it('keeps a radar time and drops a leftover one on optical sides', () => {
    expect(setSide([pair('x')], 'a', '2026-08-01', '16:32:10', true)[0].a.time).toBe('16:32:10');
    expect(setSide([pair('x')], 'a', '2026-08-01', '16:32:10', false)[0].a.time).toBe('');
  });

  it('follows the routine rule once it is chosen', () => {
    expect(withRule([pair('x')], 'previous')[0].date_rule).toBe('latest_previous');
    expect(withRule([pair('x')], 'reference')[0].date_rule).toBe('latest_reference');
  });

  it('says what is missing, in the words of the step', () => {
    const base = { single: false, routine: false, against: 'previous', followupId: null, chooseB: false };
    expect(whenNeed({ ...base, pairs: [pair('x')] })).toBe('Choose A, the picture before.');
    expect(whenNeed({ ...base, pairs: [pair('x', '2026-08-01'), pair('y')] })).toBe('Choose A for every area.');
    expect(whenNeed({ ...base, pairs: [pair('x', '2026-08-01')] })).toBe('');
    expect(whenNeed({ ...base, chooseB: true, pairs: [pair('x', '2026-08-01')] }))
      .toBe('Choose the day of B, or take the newest pass.');
    expect(whenNeed({ ...base, single: true, chooseB: true, pairs: [pair('x')] }))
      .toBe('Choose the day, or take the newest pass.');
    expect(whenNeed({ ...base, single: true, pairs: [pair('x')] })).toBe('');
  });

  it('asks a routine for A until a run has finished', () => {
    const base = { single: false, routine: true, chooseB: true, pairs: [pair('x')] };
    expect(whenNeed({ ...base, against: 'previous', followupId: null }))
      .toBe('Choose A, the picture the first run compares with.');
    expect(whenNeed({ ...base, against: 'previous', followupId: 'abcdef123456' })).toBe('');
    expect(whenNeed({ ...base, against: 'reference', followupId: 'abcdef123456' }))
      .toBe('Choose A, the picture every run compares with.');
    // a routine names no B, whatever the switch last said
    expect(whenNeed({ ...base, single: true, against: 'previous', followupId: null })).toBe('');
  });

  it('lists one area\'s days when the areas differ', () => {
    const once = { single: false, routine: false };
    expect(areaLine(pair('x', '2026-08-01'), once)).toBe('A 2026-08-01 → B newest pass');
    expect(areaLine(pair('x', '', '2026-09-06'), once)).toBe('A not chosen → B 2026-09-06');
    expect(areaLine(pair('x', '', '2026-09-06'), { ...once, single: true })).toBe('2026-09-06');
    expect(areaLine(pair('x', '2026-08-01'), { ...once, routine: true })).toBe('A 2026-08-01');
    expect(areaLine(pair('x'), { single: true, routine: true })).toBe('newest pass');
  });

  it('sums the step up in one line', () => {
    const once = { single: false, routine: false, against: 'previous' };
    expect(whenSummary({ ...once, pairs: [pair('x', '2026-08-01')] })).toBe('2026-08-01 → newest pass');
    expect(whenSummary({ ...once, pairs: [pair('x', '2026-08-01', '2026-09-06')] })).toBe('2026-08-01 → 2026-09-06');
    expect(whenSummary({ ...once, single: true, pairs: [pair('x')] })).toBe('Newest pass');
    expect(whenSummary({ ...once, pairs: [pair('x', '2026-08-01'), pair('y', '2026-07-20')] }))
      .toBe('Its own days for each area');
    const routine = { single: false, routine: true };
    expect(whenSummary({ ...routine, against: 'previous', pairs: [pair('x', '2026-08-01')] }))
      .toBe('Each run: the newest pass against the one before, first against 2026-08-01');
    expect(whenSummary({ ...routine, against: 'reference', pairs: [pair('x', '2026-08-01')] }))
      .toBe('Each run: the newest pass against 2026-08-01');
    expect(whenSummary({ ...routine, single: true, against: 'previous', pairs: [pair('x')] }))
      .toBe('Each run: the newest pass');
    const radar = [{ ...pair('x', '2026-08-01'), a: { date: '2026-08-01', time: '16:32:10' } }];
    expect(whenSummary({ ...once, radar: true, pairs: radar })).toBe('2026-08-01 16:32 UTC → newest pass');
  });
});
