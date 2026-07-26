import { describe, expect, it } from 'vitest';
import { filterEntities, isFiltering, resultMeta, typeChips } from './sidebarSearch.js';

describe('isFiltering', () => {
  it('is false for nothing typed and no chip, true for either', () => {
    expect(isFiltering()).toBe(false);
    expect(isFiltering({ query: '   ' })).toBe(false);
    expect(isFiltering({ query: 'kh' })).toBe(true);
    expect(isFiltering({ type: 'media' })).toBe(true);
  });
});

describe('typeChips', () => {
  it('lists the types present, biggest first, ties by name', () => {
    const chips = typeChips({ by_type: { media: 64, place: 22, capture: 22, proof: 0 } });
    expect(chips).toEqual([
      { type: 'media', count: 64 },
      { type: 'capture', count: 22 },
      { type: 'place', count: 22 },
    ]);
  });

  it('survives a summary that has not landed yet', () => {
    expect(typeChips(null)).toEqual([]);
  });
});

describe('filterEntities', () => {
  const items = [
    { id: '1', label: 'clip_04.mp4', type: 'media', attrs: { folder: 'Terrain/Videos' } },
    { id: '2', label: 'Bridge north', type: 'place', attrs: { folder: 'Terrain' } },
    { id: '3', label: 'Account @relay', type: 'account', attrs: {} },
  ];

  it('matches the label case-insensitively', () => {
    expect(filterEntities(items, { query: 'CLIP' }).map((e) => e.id)).toEqual(['1']);
  });

  it('matches the folder too, so typing a folder name reveals its contents', () => {
    expect(filterEntities(items, { query: 'terrain' }).map((e) => e.id)).toEqual(['1', '2']);
  });

  it('combines the type chip with the text', () => {
    expect(filterEntities(items, { query: 'terrain', type: 'place' }).map((e) => e.id)).toEqual(['2']);
    expect(filterEntities(items, { type: 'account' }).map((e) => e.id)).toEqual(['3']);
  });

  it('returns everything when nothing is filtered', () => {
    expect(filterEntities(items, {})).toHaveLength(3);
  });
});

describe('resultMeta', () => {
  it('shows where a row is filed, and the type alone when it is not', () => {
    expect(resultMeta({ type: 'media', attrs: { folder: 'Terrain/Videos' } })).toBe(
      'media · Terrain/Videos'
    );
    expect(resultMeta({ type: 'media', attrs: {} })).toBe('media');
  });
});
