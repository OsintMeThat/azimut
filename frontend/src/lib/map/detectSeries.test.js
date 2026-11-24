import { describe, expect, it } from 'vitest';
import {
  AREA_PALETTE, CATEGORIES, areaColours, buildSeries, categoryCounts, daysBetween, metres, presenceLine, seriesFigures, seriesPasses, shortDay,
  spansYears, spotPicks,
} from './detectSeries.js';

// ~10 m apart at this latitude, one step of `east`
const AT = [54.55, 24.25];
const east = (metresEast) => [AT[0] + metresEast / (111320 * Math.cos((AT[1] * Math.PI) / 180)), AT[1]];

const result = (id, coordinates, { area = 'apron', review = 'new' } = {}) => ({ id, area_id: area, coordinates, review });
const run = (id, date, results, { areas = ['apron'], unread = [] } = {}) => ({
  id,
  title: 'Base',
  created_at: `${date}T20:00:00+00:00`,
  dates: ['2026-07-24', date],
  areas: [...areas.map((area) => ({ area_id: area, status: 'ready', a: '2026-07-24', b: date })),
    ...unread.map((area) => ({ area_id: area, status: 'failed', a: '2026-07-24', b: date }))],
  results,
});

describe('days and distances', () => {
  it('writes a day short, with its year when asked', () => {
    expect(shortDay('2026-09-07')).toBe('7 Sep');
    expect(shortDay('2026-09-07', true)).toBe('7 Sep 2026');
    expect(shortDay('soon')).toBe('');
    expect(spansYears(['2025-12-30', '2026-01-02'])).toBe(true);
    expect(spansYears(['2026-12-30', '2026-01-02'])).toBe(false);
    expect(daysBetween('2026-11-03', '2026-11-24')).toBe(21);
  });

  it('measures metres on the ground', () => {
    expect(metres(AT, east(40))).toBeCloseTo(40, 0);
  });
});

describe('area colours', () => {
  it('keeps each area its own colour when they differ, and parts them when they share one', () => {
    const areas = [{ id: 'a', colour: '#F6A81A' }, { id: 'b', colour: '#38bdf8' }];
    expect(areaColours(['a', 'b'], areas)).toEqual({ a: '#f6a81a', b: '#38bdf8' });
    const same = [{ id: 'a', colour: '#38bdf8' }, { id: 'b', colour: '#38bdf8' }];
    expect(areaColours(['a', 'b'], same)).toEqual({ a: AREA_PALETTE[0], b: AREA_PALETTE[1] });
    expect(areaColours(['gone'], [])).toEqual({ gone: AREA_PALETTE[0] });
  });
});

describe('passes', () => {
  it('reads one pass per day, oldest first, a day run twice by its newest run', () => {
    const passes = seriesPasses([run('b', '2026-10-02', []), run('a', '2026-09-27', []), run('c', '2026-10-02', [])]);
    expect(passes.map((pass) => [pass.date, pass.id])).toEqual([['2026-09-27', 'a'], ['2026-10-02', 'c']]);
  });

  it('knows an area that was not read from one read empty', () => {
    const [pass] = seriesPasses([run('a', '2026-09-27', [], { areas: ['apron'], unread: ['north'] })]);
    expect([...pass.read]).toEqual(['apron']);
  });
});

describe('spots', () => {
  const rows = [
    run('r1', '2026-09-27', [result('p', AT), result('q', east(100))]),
    run('r2', '2026-09-29', [result('p', east(15)), result('q', east(105))]),
    run('r3', '2026-10-02', [result('p', east(5)), result('n', east(300))]),
  ];

  it('gathers the candidates of one place across passes', () => {
    const { spots } = buildSeries(rows);
    expect(spots.map((spot) => [spot.id, spot.seen, presenceLine(spot.presence), spot.category])).toEqual([
      ['S1', 3, '●●●', 'steady'],
      ['S2', 2, '●●○', 'gone'],
      ['S3', 1, '○○●', 'new'],
    ]);
    expect(spots[0].first).toBe('2026-09-27');
    expect(spots[0].last).toBe('2026-10-02');
  });

  it('keeps two things parked side by side as two spots', () => {
    const { spots } = buildSeries([
      run('r1', '2026-09-27', [result('a', AT), result('b', east(25))]),
      run('r2', '2026-09-29', [result('a', east(2)), result('b', east(27))]),
    ]);
    expect(spots.map((spot) => spot.seen)).toEqual([2, 2]);
  });

  it('follows the radius it is given', () => {
    expect(buildSeries(rows, { radius: 10 }).spots.length).toBeGreaterThan(buildSeries(rows).spots.length);
  });

  it('never joins two areas, and narrows to one', () => {
    const both = [
      run('r1', '2026-09-27', [result('a', AT), result('b', AT, { area: 'north' })], { areas: ['apron', 'north'] }),
    ];
    expect(buildSeries(both).spots.length).toBe(2);
    const only = buildSeries(both, { only: 'north' });
    expect(only.spots.map((spot) => spot.areaId)).toEqual(['north']);
    expect(only.passes[0].counts.total).toBe(1);
  });

  it('marks a pass that did not read the area as not looked at, and leaves it out of the rules', () => {
    const { spots } = buildSeries([
      run('r1', '2026-09-27', [result('a', AT)]),
      run('r2', '2026-09-29', [], { areas: [], unread: ['apron'] }),
      run('r3', '2026-10-02', [result('a', east(3))]),
    ]);
    expect(presenceLine(spots[0].presence)).toBe('●·●');
    expect(spots[0].category).toBe('steady');
    expect([spots[0].seen, spots[0].read]).toEqual([2, 2]);
  });

  it('says what came and went on each pass since the one before', () => {
    const { passes } = buildSeries(rows);
    expect(passes.map((pass) => [pass.arrived, pass.left, pass.compared])).toEqual([
      [[], [], false],
      [[], [], true],
      [['S3'], ['S2'], true],
    ]);
  });

  it('counts the verdicts a spot holds and asks a verdict only of what is not pinned', () => {
    const { spots } = buildSeries([
      run('r1', '2026-09-27', [result('a', AT, { review: 'kept' })]),
      run('r2', '2026-09-29', [result('a', AT, { review: 'noted' })]),
      run('r3', '2026-10-02', [result('a', AT)]),
    ]);
    expect(spots[0].verdicts).toEqual({ total: 3, toReview: 1, noted: 1, pinned: 1 });
    expect(spotPicks(spots[0])).toEqual([{ run_id: 'r2', result_id: 'a' }, { run_id: 'r3', result_id: 'a' }]);
  });

  it('counts each category and every rule is said', () => {
    const { spots } = buildSeries(rows);
    expect(categoryCounts(spots)).toEqual({ all: 3, new: 1, gone: 1, steady: 1, once: 0, mixed: 0 });
    expect(CATEGORIES.every((category) => category.label && category.rule)).toBe(true);
  });

  it('calls nothing new on a routine with one pass', () => {
    const { spots } = buildSeries([run('r1', '2026-09-27', [result('a', AT)])]);
    expect(spots[0].category).toBe('once');
  });
});

describe('figures', () => {
  it('sums a series up', () => {
    const figures = seriesFigures(buildSeries([
      run('r1', '2026-09-27', [result('p', AT), result('q', east(100), { review: 'noted' })]),
      run('r2', '2026-09-29', [result('p', east(3))]),
    ]));
    expect(figures).toMatchObject({ passes: 2, first: '2026-09-27', last: '2026-09-29', candidates: 3, toReview: 2,
      spots: 2, newest: 1, arrived: 0, left: 1, steady: 1 });
    expect(figures.peak.date).toBe('2026-09-27');
  });

  it('answers an empty series', () => {
    expect(seriesFigures(buildSeries([]))).toMatchObject({ passes: 0, candidates: 0, spots: 0, peak: null });
  });
});
