import { describe, it, expect } from 'vitest';
import {
  hasMediaForFilters,
  isGenericImage,
  isMadeHere,
  isSatelliteMedia,
  mediaDisplayKind,
  matchesQuery,
  mediaPoint,
  hasPosition,
  sortItems,
  visibleMedia,
} from './mediaFilter.js';

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

describe('media categories', () => {
  it('classifies native satellite captures as Satellite', () => {
    const capture = { kind: 'image', source: { type: 'satellite' } };
    expect(isSatelliteMedia(capture)).toBe(true);
    expect(isGenericImage(capture)).toBe(false);
  });

  it('classifies explicit satellite screenshots as Satellite', () => {
    const capture = {
      kind: 'image',
      source: { type: 'screenshot', imagery_mode: 'satellite' },
    };
    expect(isSatelliteMedia(capture)).toBe(true);
    expect(isGenericImage(capture)).toBe(false);
  });

  it('keeps ordinary extension screenshots under Images', () => {
    const capture = { kind: 'image', source: { type: 'screenshot' } };
    expect(isSatelliteMedia(capture)).toBe(false);
    expect(isGenericImage(capture)).toBe(true);
    expect(mediaDisplayKind(capture)).toBe('image');
  });

  it('uses the Satellite label for satellite captures while keeping image data', () => {
    expect(mediaDisplayKind({ kind: 'image', source: { type: 'satellite' } })).toBe('satellite');
    expect(
      mediaDisplayKind({ kind: 'image', source: { type: 'screenshot', imagery_mode: 'satellite' } })
    ).toBe('satellite');
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

  it('reverses a column when requested', () => {
    expect(sortItems([a, b, c], 'name', 'desc').map((i) => i.filename)).toEqual(['b.mp4', 'c.png', 'a.jpg']);
    expect(sortItems([a, b, c], 'size', 'asc').map((i) => i.filename)).toEqual(['b.mp4', 'c.png', 'a.jpg']);
  });

  it('sorts the details-list type and folder columns', () => {
    const image = item({ filename: 'image.png', kind: 'image', folder: 'evidence' });
    const video = item({ filename: 'video.mp4', kind: 'video', folder: 'archive' });
    expect(sortItems([image, video], 'type').map((i) => i.filename)).toEqual(['image.png', 'video.mp4']);
    expect(sortItems([image, video], 'folder').map((i) => i.filename)).toEqual(['video.mp4', 'image.png']);
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

describe('hasMediaForFilters', () => {
  const items = [
    { kind: 'image', folder: 'sources' },
    { kind: 'video', folder: 'sources' },
    { kind: 'image', folder: 'evidence' },
  ];

  it('finds whether a folder and category intersection exists', () => {
    expect(hasMediaForFilters(items, { folderFilter: 'sources', catMatch: (i) => i.kind === 'image' })).toBe(true);
    expect(hasMediaForFilters(items, { folderFilter: 'evidence', catMatch: (i) => i.kind === 'video' })).toBe(false);
  });

  it('ignores the text query because it only validates the two filter facets', () => {
    expect(hasMediaForFilters(items, { folderFilter: 'sources' })).toBe(true);
  });
});

describe('mediaPoint', () => {
  it('reads the position a file states about itself, whatever wrote it', () => {
    // EXIF for an image, container tags for a video: enrichment lands both here
    expect(mediaPoint({ gps: { lat: 48.8583, lon: 2.2945 } })).toEqual({ lat: 48.8583, lon: 2.2945 });
    expect(mediaPoint({ kind: 'video', gps: { lat: -33.86, lon: 151.21 } })).toEqual({
      lat: -33.86,
      lon: 151.21,
    });
  });

  it('refuses a point the map could not place', () => {
    expect(mediaPoint({})).toBeNull();
    expect(mediaPoint({ gps: null })).toBeNull();
    expect(mediaPoint({ gps: { lat: 48.0 } })).toBeNull();
    expect(mediaPoint({ gps: { lat: 'north', lon: 'east' } })).toBeNull();
    expect(hasPosition({ gps: { lat: 0, lon: 0 } })).toBe(true); // enrichment already dropped 0,0
  });
});

describe('visibleMedia — position filter', () => {
  const located = item({ filename: 'gps.jpg', gps: { lat: 1, lon: 2 } });
  const bare = item({ filename: 'plain.jpg' });

  it('keeps only the files that state one, and composes with the other filters', () => {
    expect(visibleMedia([located, bare], { gpsOnly: true }).map((i) => i.filename)).toEqual([
      'gps.jpg',
    ]);
    expect(visibleMedia([located, bare], { gpsOnly: false }).length).toBe(2);
    expect(visibleMedia([located, bare], { gpsOnly: true, query: 'plain' })).toEqual([]);
  });
});

describe('what the case made, apart from what it collected', () => {
  const frame = item({ filename: 'frame.png', source: { type: 'inspect', op: 'frame' } });
  const collage = item({ filename: 'collage.png', source: { type: 'inspect', op: 'collage' } });
  const upload = item({ filename: 'handed-over.jpg', source: { type: 'upload' } });
  const capture = item({ filename: 'map.png', source: { type: 'satellite' } });

  it('counts only the tools that compose case material', () => {
    expect(isMadeHere(frame)).toBe(true);
    expect(isMadeHere(collage)).toBe(true);
    // Original imagery brought into the case, not made out of what it holds.
    expect(isMadeHere(capture)).toBe(false);
    expect(isMadeHere(upload)).toBe(false);
    expect(isMadeHere(item())).toBe(false);
    expect(isMadeHere(null)).toBe(false);
  });

  it('takes them out of the grid on request, and composes with the other filters', () => {
    // The in-memory pass a case small enough for one page takes; a large case is
    // filtered in SQL, and both read the same set.
    expect(
      visibleMedia([frame, upload, capture], { collectedOnly: true, sort: 'name' }).map(
        (i) => i.filename
      )
    ).toEqual(['handed-over.jpg', 'map.png']);
    expect(visibleMedia([frame, upload, capture], { collectedOnly: false }).length).toBe(3);
    expect(visibleMedia([frame, upload], { collectedOnly: true, query: 'frame' })).toEqual([]);
  });
});
