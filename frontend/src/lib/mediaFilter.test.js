import { describe, it, expect } from 'vitest';
import { matchesQuery, sortItems, visibleMedia } from './mediaFilter.js';

const item = (extra = {}) => ({
  filename: 'strike_video.mp4',
  title: null,
  notes: null,
  folder: null,
  source: null,
  size: 100,
  added_at: '2026-07-01T10:00:00Z',
  ...extra,
});

describe('matchesQuery', () => {
  it('matches on filename, case-insensitively', () => {
    expect(matchesQuery(item(), 'STRIKE')).toBe(true);
    expect(matchesQuery(item(), 'mosque')).toBe(false);
  });

  it('matches on title, notes and folder', () => {
    expect(matchesQuery(item({ title: 'Mosque strike' }), 'mosque')).toBe(true);
    expect(matchesQuery(item({ notes: 'seen near the bridge' }), 'bridge')).toBe(true);
    expect(matchesQuery(item({ folder: 'Sources/Telegram' }), 'telegram')).toBe(true);
  });

  it('matches on the download source title, uploader and URL', () => {
    const it_ = item({
      source: { type: 'download', title: 'Artillery hit', uploader: 'chan42', webpage_url: 'https://t.me/chan42/7' },
    });
    expect(matchesQuery(it_, 'artillery')).toBe(true);
    expect(matchesQuery(it_, 'chan42')).toBe(true);
    expect(matchesQuery(it_, 't.me')).toBe(true);
  });

  it('requires every term (AND), in any field', () => {
    const it_ = item({ title: 'Mosque strike', notes: 'northern district' });
    expect(matchesQuery(it_, 'mosque northern')).toBe(true);
    expect(matchesQuery(it_, 'mosque southern')).toBe(false);
  });

  it('empty or blank query matches everything', () => {
    expect(matchesQuery(item(), '')).toBe(true);
    expect(matchesQuery(item(), '   ')).toBe(true);
    expect(matchesQuery(item(), null)).toBe(true);
  });
});

describe('sortItems', () => {
  const a = item({ filename: 'b.mp4', title: 'Bravo', size: 10, added_at: '2026-07-01T00:00:00Z' });
  const b = item({ filename: 'a.jpg', title: null, size: 30, added_at: '2026-07-03T00:00:00Z' });
  const c = item({ filename: 'c.png', title: 'alpha', size: 20, added_at: '2026-07-02T00:00:00Z' });

  it('newest first (default)', () => {
    expect(sortItems([a, b, c], 'newest').map((i) => i.filename)).toEqual(['a.jpg', 'c.png', 'b.mp4']);
  });

  it('oldest first', () => {
    expect(sortItems([a, b, c], 'oldest').map((i) => i.filename)).toEqual(['b.mp4', 'c.png', 'a.jpg']);
  });

  it('name A–Z uses the display name (title over filename)', () => {
    expect(sortItems([a, b, c], 'name').map((i) => i.filename)).toEqual(['a.jpg', 'c.png', 'b.mp4']);
  });

  it('largest first', () => {
    expect(sortItems([a, b, c], 'size').map((i) => i.filename)).toEqual(['a.jpg', 'c.png', 'b.mp4']);
  });

  it('does not mutate the input', () => {
    const input = [a, b, c];
    sortItems(input, 'name');
    expect(input.map((i) => i.filename)).toEqual(['b.mp4', 'a.jpg', 'c.png']);
  });
});

describe('visibleMedia — case gating', () => {
  const img = (extra = {}) => item({ filename: 'a.jpg', kind: 'image', ...extra });

  it('returns nothing when no case is open, even with items still in memory', () => {
    // Regression: closing a case leaves `items` populated for one reactive flush
    // while caseState.current is null. The grid cards read caseState.current.id,
    // so rendering that stale list threw and aborted the whole flush — which left
    // *other* tools (e.g. the Proof Composer) un-reset. Gating on hasCase makes
    // the grid empty regardless of effect ordering, so nothing dereferences null.
    const items = [img(), img({ filename: 'b.png' })];
    expect(visibleMedia(items, { hasCase: false })).toEqual([]);
  });

  it('returns the filtered+sorted list when a case is open (hasCase defaults true)', () => {
    const items = [
      img({ filename: 'b.jpg', added_at: '2026-07-02T00:00:00Z' }),
      img({ filename: 'a.jpg', added_at: '2026-07-01T00:00:00Z' }),
    ];
    const out = visibleMedia(items, { sort: 'name' });
    expect(out.map((i) => i.filename)).toEqual(['a.jpg', 'b.jpg']);
  });

  it('applies the category matcher, folder filter and query together', () => {
    const items = [
      img({ filename: 'road.jpg', folder: 'north', kind: 'image' }),
      img({ filename: 'road.mp4', folder: 'north', kind: 'video' }),
      img({ filename: 'river.jpg', folder: 'south', kind: 'image' }),
    ];
    const out = visibleMedia(items, {
      hasCase: true,
      catMatch: (i) => i.kind === 'image',
      folderFilter: 'north',
      query: 'road',
    });
    expect(out.map((i) => i.filename)).toEqual(['road.jpg']);
  });

  it('does not mutate the input list', () => {
    const items = [img({ filename: 'b.jpg' }), img({ filename: 'a.jpg' })];
    const snapshot = items.map((i) => i.filename);
    visibleMedia(items, { sort: 'name' });
    expect(items.map((i) => i.filename)).toEqual(snapshot);
  });
});
