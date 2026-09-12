import { describe, expect, it } from 'vitest';
import { QUESTIONS } from './entityFilter.js';
import {
  MAP_PINS,
  WAITING,
  familyBars,
  familyCounts,
  lastTouched,
  mapPins,
  nothingWaiting,
  unfiledCount,
  waitingRows,
  weekAgo,
} from './overview.js';

const summary = (over = {}) => ({
  total: 0,
  by_type: {},
  by_status: {},
  by_folder: {},
  by_source: {},
  linked_to: {},
  unlinked: 0,
  countable: 0,
  ...over,
});

describe('what the case is waiting on', () => {
  it('prices the Board standing questions rather than wording its own', () => {
    // the number here and the count on that table have to be one predicate asked
    // twice, or the home page quietly says something the Board contradicts
    for (const row of WAITING.filter((entry) => entry.surface === 'board')) {
      const question = QUESTIONS.find((entry) => entry.id === row.id);
      expect(question, `${row.id} is not a Board question`).toBeTruthy();
      expect(row.label).toBe(question.label);
      expect(row.hint).toBe(question.hint);
      expect(row.terms).toEqual(question.terms);
    }
  });

  it('leaves "added this week" out: it says what happened, not what is outstanding', () => {
    expect(WAITING.map((row) => row.id)).not.toContain('week');
  });

  it('reads each count off the payload that already holds it', () => {
    const rows = waitingRows({
      summary: summary({ total: 30, by_status: { suggested: 4 }, unlinked: 7, by_folder: { a: 10, b: 8 } }),
      timeline: { undated: 2 },
    });
    expect(Object.fromEntries(rows.map((row) => [row.id, row.count]))).toEqual({
      review: 4,
      loose: 7,
      unfiled: 12,
      undated: 2,
    });
  });

  it('answers zero rather than NaN before the reads land', () => {
    const rows = waitingRows({});
    expect(rows.map((row) => row.count)).toEqual([0, 0, 0, 0]);
    expect(nothingWaiting(rows)).toBe(true);
  });

  it('tells a clear case from a case with one thing left', () => {
    const rows = waitingRows({ summary: summary({ total: 3, by_folder: { a: 3 } }), timeline: { undated: 1 } });
    expect(nothingWaiting(rows)).toBe(false);
  });
});

describe('what sits in none of the folders', () => {
  it('is the case less what the folders hold', () => {
    expect(unfiledCount(summary({ total: 12, by_folder: { work: 5, old: 2 } }))).toBe(5);
  });

  it('is the whole case when no folder exists yet', () => {
    expect(unfiledCount(summary({ total: 12 }))).toBe(12);
  });

  it('never goes negative on a summary read mid-write', () => {
    // the two counts are separate scans; a folder count can briefly outrun the total
    expect(unfiledCount(summary({ total: 2, by_folder: { a: 5 } }))).toBe(0);
  });

  it('is zero on nothing at all', () => {
    expect(unfiledCount(null)).toBe(0);
  });
});

describe('the case in figures', () => {
  const familyOf = (type) => ({ person: 'actor', account: 'identifier', media: 'collected' })[type] ?? null;

  it('sums types into their family, biggest first', () => {
    const counts = familyCounts(
      summary({ by_type: { person: 3, account: 9, media: 40 } }),
      familyOf
    );
    expect(counts).toEqual([
      { family: 'collected', count: 40 },
      { family: 'identifier', count: 9 },
      { family: 'actor', count: 3 },
    ]);
  });

  it('counts a free type the vocabulary never heard of rather than dropping it', () => {
    // a free-typed entity is still something the case holds, and a total that skips
    // it disagrees with the total beside it
    const counts = familyCounts(summary({ by_type: { widget: 2 } }), familyOf);
    expect(counts).toEqual([{ family: 'other', count: 2 }]);
  });

  it('breaks a tie by name, so the same case draws the same line twice', () => {
    const counts = familyCounts(summary({ by_type: { account: 1, person: 1 } }), familyOf);
    expect(counts.map((entry) => entry.family)).toEqual(['actor', 'identifier']);
  });

  it('leaves out a family the case holds none of', () => {
    expect(familyCounts(summary({ by_type: { person: 0 } }), familyOf)).toEqual([]);
  });
});

describe('the bars the figures are drawn as', () => {
  const familyOf = (type) => ({ person: 'actor', media: 'collected' })[type] ?? null;

  it('measures every family against the biggest, not against the total', () => {
    // against the total, a case four fifths of which is media draws six bars of
    // nothing beside one full one, and says less than the numbers it replaced
    const bars = familyBars(summary({ by_type: { media: 40, person: 10 } }), familyOf);
    expect(bars.map((bar) => [bar.family, bar.count, bar.share])).toEqual([
      ['collected', 40, 1],
      ['actor', 10, 0.25],
    ]);
  });

  it('draws nothing rather than dividing by nothing', () => {
    expect(familyBars(summary(), familyOf)).toEqual([]);
  });
});

describe('the case as points on the map', () => {
  const row = (over) => ({ key: 'k', kind: 'place', title: 'Quai sud', ...over });

  it('hands the map the position, the kind and the title it draws them with', () => {
    const { pins, total } = mapPins([row({ lat: 49.98, lon: 36.25 })]);
    expect(total).toBe(1);
    expect(pins[0]).toEqual({
      id: 'k',
      kind: 'place',
      title: 'Quai sud',
      lat: 49.98,
      lon: 36.25,
    });
  });

  it('keeps the rows in the order they arrived, newest first as the index served them', () => {
    const { pins } = mapPins([row({ key: 'n', lat: 51, lon: 4 }), row({ key: 's', lat: 48, lon: 4 })]);
    expect(pins.map((pin) => pin.id)).toEqual(['n', 's']);
  });

  it('names a row that carries no key of its own, since a dot is drawn by id', () => {
    const { pins } = mapPins([{ id: 'e7', lat: 50, lon: 4 }, { lat: 12, lon: 77 }]);
    expect(pins.map((pin) => pin.id)).toEqual(['e7', '12,77']);
    // and a row that says nothing about what it is is still a place
    expect(pins[1].kind).toBe('place');
  });

  it('leaves out what has nowhere to be drawn', () => {
    const { pins, total } = mapPins([
      row({ key: 'a', lat: 50, lon: 4 }),
      row({ key: 'b', lat: null, lon: null }),
      row({ key: 'c' }),
    ]);
    expect(pins).toHaveLength(1);
    expect(total).toBe(1);
  });

  it('stops drawing past the cap, and says how many there were', () => {
    const many = Array.from({ length: MAP_PINS + 20 }, (_, i) =>
      row({ key: `k${i}`, lat: 50 + i * 0.01, lon: 4 })
    );
    const { pins, total } = mapPins(many);
    expect(pins).toHaveLength(MAP_PINS);
    expect(total).toBe(MAP_PINS + 20);
  });

  it('is empty on a case that saved nothing', () => {
    expect(mapPins([])).toEqual({ pins: [], total: 0 });
    expect(mapPins(null)).toEqual({ pins: [], total: 0 });
  });
});

describe('the week the recent band counts', () => {
  it('is seven days back, as the bare date the catalog compares against', () => {
    expect(weekAgo(Date.UTC(2026, 2, 15, 12))).toBe('2026-03-08');
  });

  it('crosses a month boundary', () => {
    expect(weekAgo(Date.UTC(2026, 2, 3, 12))).toBe('2026-02-24');
  });
});

describe('when the case was last touched', () => {
  const current = { id: 'c1', updated_at: '2026-01-02T00:00:00Z' };

  it('prefers the list stamp, which is recomputed off the database', () => {
    // the manifest's own stamp only moves when the manifest is rewritten, so a case
    // worked on all afternoon would read as touched the day it was renamed
    const list = [{ id: 'c1', updated_at: '2026-03-04T00:00:00Z' }];
    expect(lastTouched(current, list)).toBe('2026-03-04T00:00:00Z');
  });

  it('keeps the manifest stamp when it is the fresher of the two', () => {
    const list = [{ id: 'c1', updated_at: '2025-12-01T00:00:00Z' }];
    expect(lastTouched(current, list)).toBe('2026-01-02T00:00:00Z');
  });

  it('falls back to the open case when the list has not landed', () => {
    expect(lastTouched(current, [])).toBe('2026-01-02T00:00:00Z');
  });

  it('never reads another case row', () => {
    expect(lastTouched(current, [{ id: 'other', updated_at: '2030-01-01T00:00:00Z' }])).toBe(
      '2026-01-02T00:00:00Z'
    );
  });

  it('says nothing rather than guessing with no case open', () => {
    expect(lastTouched(null, [])).toBe('');
  });
});
