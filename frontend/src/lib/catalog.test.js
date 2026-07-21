import { describe, expect, it } from 'vitest';
import {
  buildCatalogQuery, fetchAllEntities, lookupEntity, fetchDerivation, settleCatalogSummary,
} from './catalog.js';

describe('buildCatalogQuery', () => {
  it('omits unset filters and joins a type set', () => {
    expect(buildCatalogQuery('c1', {})).toBe('/api/cases/c1/catalog/entities');
    expect(
      buildCatalogQuery('c1', {
        limit: 50,
        cursor: '12',
        types: ['media', 'capture'],
        status: 'suggested',
        query: 'ada',
      })
    ).toBe(
      '/api/cases/c1/catalog/entities?limit=50&cursor=12&type=media%2Ccapture&status=suggested&q=ada'
    );
  });

  it('carries a folder path, and lets unfiled win over it', () => {
    expect(buildCatalogQuery('c1', { folder: 'Sources/Telegram' })).toBe(
      '/api/cases/c1/catalog/entities?folder=Sources%2FTelegram'
    );
    expect(buildCatalogQuery('c1', { unfiled: true, folder: 'ignored' })).toBe(
      '/api/cases/c1/catalog/entities?unfiled=true'
    );
  });
});

describe('settleCatalogSummary', () => {
  it('clears a current failed request and ignores a stale response', () => {
    const previous = { total: 12 };
    expect(settleCatalogSummary(previous, null, true)).toBe(null);
    expect(settleCatalogSummary(previous, { total: 3 }, false)).toBe(previous);
  });
});

/** A stand-in backend that pages a fixed id list the way the API does. */
function fakeBackend(ids) {
  return async (path) => {
    if (path.includes('/catalog/summary')) {
      return { total: ids.length, by_type: {}, by_status: {} };
    }
    const url = new URL(path, 'http://x');
    const cursor = Number(url.searchParams.get('cursor') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? 100);
    const slice = ids.slice(cursor, cursor + limit).map((id) => ({ id, type: 'person', label: id }));
    const nextCursor = cursor + limit < ids.length ? String(cursor + limit) : null;
    return { items: slice, next_cursor: nextCursor };
  };
}

describe('fetchAllEntities — the full bounded slice', () => {
  it('walks every page and returns the whole list', async () => {
    const get = fakeBackend(['a', 'b', 'c', 'd', 'e']);
    const all = await fetchAllEntities('c1', { pageSize: 2, get });
    expect(all.map((e) => e.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('passes filters through and is empty without a case', async () => {
    const paths = [];
    const get = async (path) => {
      paths.push(path);
      return { items: [], next_cursor: null };
    };
    await fetchAllEntities('c1', { types: ['place'], status: 'confirmed', get });
    expect(paths[0]).toContain('type=place');
    expect(paths[0]).toContain('status=confirmed');
    expect(await fetchAllEntities(null, { get })).toEqual([]);
  });
});

describe('lookupEntity / fetchDerivation', () => {
  it('resolves an entity by attr, or null', async () => {
    const get = async (path) =>
      path.includes('value=media%2Fa.jpg') ? { entity: { id: 'e1' } } : { entity: null };
    expect((await lookupEntity('c1', 'path', 'media/a.jpg', { get })).id).toBe('e1');
    expect(await lookupEntity('c1', 'path', 'media/none.jpg', { get })).toBe(null);
    expect(await lookupEntity(null, 'path', 'x', { get })).toBe(null);
  });

  it('fetches a derivation subgraph, empty without ids', async () => {
    const get = async () => ({ entities: [{ id: 'p' }], links: [{ from: 'p', to: 'm' }] });
    expect((await fetchDerivation('c1', 'p', { get })).entities).toHaveLength(1);
    expect(await fetchDerivation('c1', null, { get })).toEqual({ entities: [], links: [] });
  });
});
