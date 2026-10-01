import { describe, expect, it } from 'vitest';
import {
  ADVISED_MAXCC, areaLine, canPickPass, ceilingWarning, newestLabel, newestLine, newestPick, passBefore, setSide, shadowLength, shadowWarning, sharedSide, sideLine, uniform,
  whenNeed, whenSummary, withRule,
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

  it('requires A before B for each dated comparison, including radar time', () => {
    const base = { single: false, routine: false, against: 'previous', chooseB: true };
    expect(passBefore({ date: '2026-09-05' }, { date: '2026-09-06' })).toBe(true);
    expect(passBefore({ date: '2026-09-07' }, { date: '2026-09-06' })).toBe(false);
    expect(passBefore({ date: '2026-09-06' }, { date: '2026-09-06' })).toBe(false);
    expect(passBefore({ date: '2026-09-06', time: '05:00:00' },
      { date: '2026-09-06', time: '17:00:00' }, true)).toBe(true);
    expect(whenNeed({ ...base, pairs: [pair('x', '2026-09-07', '2026-09-06')] }))
      .toBe('Date A must be before date B.');
    expect(whenNeed({ ...base, pairs: [pair('x', '2026-09-05', '2026-09-06'),
      pair('y', '2026-09-07', '2026-09-06')] })).toBe('Date A must be before date B.');
  });

  it('keeps radar calendar choices on the other date\'s track', () => {
    const a = { date: '2026-09-05', time: '05:00:00' };
    const same = { date: '2026-09-17', time: '05:00:02' };
    const other = { date: '2026-09-17', time: '05:08:00' };
    expect(canPickPass('b', same, a, null, true)).toBe(true);
    expect(canPickPass('b', other, a, null, true)).toBe(false);
    expect(canPickPass('a', a, null, other, true)).toBe(false);
    expect(canPickPass('b', { ...same, date: '2026-09-04' }, a, null, true)).toBe(false);
  });

  it('asks a routine for A until a run has finished', () => {
    const base = { single: false, routine: true, chooseB: true, pairs: [pair('x')] };
    expect(whenNeed({ ...base, against: 'previous', followupId: null }))
      .toBe('Choose A, the picture the first run compares with.');
    expect(whenNeed({ ...base, against: 'previous', lastPasses: { x: { date: '2026-08-01' } } })).toBe('');
    expect(whenNeed({ ...base, against: 'previous', lastPasses: {} }))
      .toBe('Choose A, the picture the first run compares with.');
    expect(whenNeed({ ...base, against: 'reference', lastPasses: { x: { date: '2026-08-01' } } }))
      .toBe('Choose A, the picture every run compares with.');
    // a routine names no B, whatever the switch last said
    expect(whenNeed({ ...base, single: true, against: 'previous', followupId: null })).toBe('');
  });

  it('lists one area\'s days when the areas differ', () => {
    const once = { single: false, routine: false };
    // "newest" is the newest the ceiling allows, and says so
    expect(areaLine(pair('x', '2026-08-01'), once)).toBe('A 2026-08-01 → B newest pass under 30% cloud');
    expect(areaLine(pair('x', '', '2026-09-06'), once)).toBe('A not chosen → B 2026-09-06');
    expect(areaLine(pair('x', '', '2026-09-06'), { ...once, single: true })).toBe('2026-09-06');
    expect(areaLine(pair('x', '2026-08-01'), { ...once, routine: true })).toBe('A 2026-08-01');
    expect(areaLine(pair('x'), { single: true, routine: true })).toBe('newest pass under 30% cloud');
  });

  it('sums the step up in one line', () => {
    const once = { single: false, routine: false, against: 'previous' };
    expect(whenSummary({ ...once, pairs: [pair('x', '2026-08-01')] })).toBe('2026-08-01 → newest pass');
    expect(whenSummary({ ...once, maxcc: 30, pairs: [pair('x', '2026-08-01')] }))
      .toBe('2026-08-01 → newest pass under 30% cloud');
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
    expect(whenSummary({ ...routine, single: true, maxcc: 20, against: 'previous', pairs: [pair('x')] }))
      .toBe('Each run: the newest pass under 20% cloud');
    const radar = [{ ...pair('x', '2026-08-01'), a: { date: '2026-08-01', time: '16:32:10' } }];
    expect(whenSummary({ ...once, radar: true, pairs: radar })).toBe('2026-08-01 16:32 UTC → newest pass');
    // radar sees through cloud, whatever the ceiling says
    expect(whenSummary({ ...once, radar: true, maxcc: 30, pairs: radar })).toBe('2026-08-01 16:32 UTC → newest pass');
  });
});

describe('what "newest" takes, and what it steps over', () => {
  // Lyman, 2026-09-26: three newer passes over the ceiling, then a clear one
  const lyman = [
    { date: '2026-09-26', cloud: 51.1, coverage: 1 },
    { date: '2026-09-24', cloud: 82.2, coverage: 1 },
    { date: '2026-09-22', cloud: 89.2, coverage: 1 },
    { date: '2026-09-19', cloud: 0.7, coverage: 1 },
    { date: '2026-09-17', cloud: 13.5, coverage: 1 },
  ];

  it('warns about a ceiling only above the advised one', () => {
    expect(ADVISED_MAXCC).toBe(30);
    expect(ceilingWarning(30)).toBe('');
    expect(ceilingWarning(20)).toBe('');
    expect(ceilingWarning(undefined)).toBe('');
    expect(ceilingWarning(31)).toBe('Above 30%, the pass taken can be mostly cloud, and ground under cloud is left out.');
  });

  it('names the ceiling in the label, and only a real one', () => {
    expect(newestLabel({ maxcc: 30 })).toBe('newest pass under 30% cloud');
    expect(newestLabel({ maxcc: 100 })).toBe('newest pass');
    expect(newestLabel({ maxcc: 30, radar: true })).toBe('newest pass');
    expect(newestLabel()).toBe('newest pass');
  });

  it('takes the newest pass the ceiling allows and lists the newer ones it skips', () => {
    const pick = newestPick(lyman, { maxcc: 30 });
    expect(pick.pass.date).toBe('2026-09-19');
    expect(pick.skipped.map((entry) => [entry.date, entry.why])).toEqual([
      ['2026-09-26', 'cloud'], ['2026-09-24', 'cloud'], ['2026-09-22', 'cloud'],
    ]);
    expect(newestLine(pick, { maxcc: 30 })).toBe(
      'Now 2026-09-19. Newer: 2026-09-26 (51% cloud), 2026-09-24 (82% cloud), 2026-09-22 (89% cloud). '
      + 'Pick one below to read it anyway.'
    );
  });

  it('takes the newest pass itself when the ceiling is off', () => {
    const pick = newestPick(lyman, { maxcc: 100 });
    expect(pick).toEqual({ pass: lyman[0], skipped: [] });
    expect(newestLine(pick)).toBe('Now 2026-09-26, looked up again when the run starts.');
  });

  it('steps over a pass whose cloud is unknown or that misses part of the area, as the run does', () => {
    const pick = newestPick([
      { date: '2026-09-26', cloud: null, coverage: 1 },
      { date: '2026-09-24', cloud: 5, coverage: 0.6 },
      { date: '2026-09-22', cloud: 5, coverage: 1 },
    ], { maxcc: 30 });
    expect(pick.pass.date).toBe('2026-09-22');
    expect(newestLine(pick, { maxcc: 30 })).toContain('2026-09-26 (cloud unknown), 2026-09-24 (60% of the area)');
  });

  it('says so when nothing in the window will do', () => {
    const pick = newestPick(lyman.slice(0, 3), { maxcc: 30 });
    expect(pick.pass).toBeNull();
    expect(newestLine(pick, { maxcc: 30 })).toBe('No pass in this window is under 30% cloud over the whole area. Pick one below.');
  });

  it('keeps a radar pick on the track the pair reads', () => {
    const passes = [
      { date: '2026-09-25', time: '15:11:51', coverage: 1 },
      { date: '2026-09-22', time: '03:38:55', coverage: 1 },
    ];
    expect(newestPick(passes, { radar: true, track: '03:38:27' }).pass.date).toBe('2026-09-22');
    expect(newestPick(passes, { radar: true }).pass.date).toBe('2026-09-25');
  });

  it('shortens a long run of skipped passes', () => {
    const cloudy = Array.from({ length: 5 }, (_, day) => ({ date: `2026-09-2${9 - day}`, cloud: 90, coverage: 1 }));
    const line = newestLine(newestPick([...cloudy, { date: '2026-09-20', cloud: 2, coverage: 1 }], { maxcc: 30 }), { maxcc: 30 });
    expect(line).toMatch(/^Now 2026-09-20\. Newer: .* and 2 more\./);
  });
});

describe('the shadow warning', () => {
  // The Isfahan airbase, where a January and a September pass put a candidate
  // on most buildings.
  const airbase = { id: 'base', kind: 'rect', points: [[51.81, 32.72], [51.96, 32.82]] };

  it('works the shadow out from the sun at the pass, as the engine does', () => {
    expect(shadowLength('2026-01-21', 32.77)).toBeCloseTo(14.7, 0);
    expect(shadowLength('2026-09-25', 32.77)).toBeCloseTo(7.2, 0);
  });

  it('warns when the shadows of a pair differ by half a pixel or more', () => {
    const text = shadowWarning([pair('base', '2026-01-21', '2026-09-25')], [airbase]);
    expect(text).toBe('A 10 m building casts 15 m of shadow on 2026-01-21 and 7 m on 2026-09-25, '
      + 'so most buildings will read as changed. Passes closer together avoid it.');
    expect(shadowWarning([pair('base', '2026-01-16', '2026-01-21')], [airbase])).toBe('');
  });

  it('names the worst of several areas', () => {
    const other = { ...airbase, id: 'other' };
    const text = shadowWarning([pair('base', '2026-01-16', '2026-01-21'), pair('other', '2026-06-21', '2026-12-21')],
      [airbase, other]);
    expect(text).toContain('on 2026-06-21');
  });

  it('says nothing without two chosen days, on one image, or on radar', () => {
    const far = [pair('base', '2026-01-21', '2026-09-25')];
    expect(shadowWarning([pair('base', '2026-01-21', '')], [airbase])).toBe('');
    expect(shadowWarning(far, [airbase], { single: true })).toBe('');
    expect(shadowWarning(far, [airbase], { radar: true })).toBe('');
  });

  it('stays finite where the sun barely rises', () => {
    expect(Number.isFinite(shadowLength('2026-12-21', 68))).toBe(true);
  });
});
