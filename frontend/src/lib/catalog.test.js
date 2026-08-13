import { describe, expect, it } from 'vitest';
import {
  buildCatalogQuery, fetchAllEntities, fetchAttrFacets, lookupEntity, fetchDerivation,
  settleCatalogSummary,
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
    expect(buildCatalogQuery('c1', { folder: 'Sources', recursive: true })).toBe(
      '/api/cases/c1/catalog/entities?folder=Sources&recursive=true'
    );
  });

  it('asks the sentence: one field holding one value, linked to a type', () => {
    expect(
      buildCatalogQuery('c1', {
        types: ['media'],
        attr: 'kind',
        value: 'video',
        linked: 'place',
      })
    ).toBe('/api/cases/c1/catalog/entities?type=media&attr=kind&value=video&linked=place');
  });

  it('leaves a field with no value out, since half an act is not a term', () => {
    // The field is picked and its values have just been fetched. Sent as a term, the
    // table would empty itself between two clicks of one act.
    expect(buildCatalogQuery('c1', { attr: 'kind' })).toBe('/api/cases/c1/catalog/entities');
  });

  it('asks what the case connects to nothing, which no column reports', () => {
    expect(buildCatalogQuery('c1', { unlinked: true })).toBe(
      '/api/cases/c1/catalog/entities?unlinked=true'
    );
  });

  it('asks how a row got here: when it was filed, and by what', () => {
    expect(
      buildCatalogQuery('c1', { since: '2026-08-03', until: '2026-08-10', by: ['user', 'satellite'] })
    ).toBe('/api/cases/c1/catalog/entities?since=2026-08-03&until=2026-08-10&by=user%2Csatellite');
  });

  it('keeps fact time separate from filing time', () => {
    expect(buildCatalogQuery('c1', {
      temporalFrom: '2026-08-01T00:00:00Z',
      temporalTo: '2026-09-01T00:00:00Z',
      temporalCategories: ['statement', 'media'],
    })).toBe(
      '/api/cases/c1/catalog/entities?temporal_from=2026-08-01T00%3A00%3A00Z'
      + '&temporal_to=2026-09-01T00%3A00%3A00Z&temporal_category=statement%2Cmedia'
    );
  });

  it('orders the whole filtered set, and says nothing when it does not', () => {
    expect(buildCatalogQuery('c1', { order: '-created' })).toBe(
      '/api/cases/c1/catalog/entities?order=-created'
    );
    expect(buildCatalogQuery('c1', { order: '' })).toBe('/api/cases/c1/catalog/entities');
  });

  it('opens a frozen saved answer by its case-owned view id', () => {
    expect(buildCatalogQuery('c1', { view: 'v_123' })).toBe(
      '/api/cases/c1/catalog/entities?view=v_123'
    );
  });
});

describe('fetchAttrFacets — the menus a field filter is chosen from', () => {
  it('narrows to the types being listed and unwraps the answer', async () => {
    const asked = [];
    const rows = await fetchAttrFacets('c1', ['media', 'capture'], {
      get: async (path) => {
        asked.push(path);
        return { attrs: [{ key: 'kind', entities: 3, values: [], truncated: false }] };
      },
    });

    expect(asked).toEqual(['/api/cases/c1/catalog/attributes?type=media%2Ccapture']);
    expect(rows[0].key).toBe('kind');
  });

  it('answers with nothing rather than throwing when the read fails', async () => {
    expect(await fetchAttrFacets('', [])).toEqual([]);
    expect(await fetchAttrFacets('c1', [], { get: async () => null })).toEqual([]);
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

  it('pages an exact folder or the unfiled bucket', async () => {
    const paths = [];
    const get = async (path) => {
      paths.push(path);
      return { items: [], next_cursor: null };
    };
    await fetchAllEntities('c1', {
      folder: 'Research/Images', recursive: true, status: 'confirmed', get,
    });
    await fetchAllEntities('c1', { unfiled: true, status: 'confirmed', get });
    expect(paths[0]).toContain('folder=Research%2FImages');
    expect(paths[0]).toContain('recursive=true');
    expect(paths[0]).toContain('status=confirmed');
    expect(paths[1]).toContain('unfiled=true');
  });

  it('walks every page inside a folder instead of stopping at the first page', async () => {
    const paths = [];
    const labels = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];
    const get = async (path) => {
      paths.push(path);
      const url = new URL(path, 'http://x');
      const cursor = Number(url.searchParams.get('cursor') ?? 0);
      const limit = Number(url.searchParams.get('limit'));
      const items = labels.slice(cursor, cursor + limit).map((label) => ({ id: label, label }));
      return {
        items,
        next_cursor: cursor + limit < labels.length ? String(cursor + limit) : null,
      };
    };

    const all = await fetchAllEntities('c1', {
      folder: 'Research/Images',
      pageSize: 2,
      get,
    });
    expect(all.map((entity) => entity.label)).toEqual(labels);
    expect(paths).toHaveLength(3);
    expect(paths.every((path) => path.includes('folder=Research%2FImages'))).toBe(true);
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
