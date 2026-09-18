// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAddedLayersState } from './addedLayers.svelte.js';

/**
 * The store that owns this feature's one network rule.
 *
 * Asserted **both ways**, because either half failing is a different failure: a
 * case that will not open offline, or an app that quietly polls somebody else's
 * server every time a tab is switched.
 */

const FILE_LAYER = {
  name: 'Sightings',
  title: 'Sightings',
  source: { kind: 'file', name: 'sightings.kml' },
  enabled: true,
  hidden: [],
  features: 3,
  categories: [{ name: 'Checkpoints', count: 3, colour: '#f00' }],
  sha256: 'aaa',
};

const followed = (over = {}) => ({
  ...FILE_LAYER,
  name: 'Roadblocks',
  title: 'Roadblocks',
  source: { kind: 'url', url: 'https://example.test/roadblocks.kml' },
  sha256: 'bbb',
  ...over,
});

let api;
let calls;
let notify;
let reloadCase;
let rows;
let collection;

function store() {
  return createAddedLayersState({
    api,
    notify,
    ensureCase: async () => ({ id: 'c1' }),
    reloadCase,
  });
}

/** Let the store's own promise chain settle — `load` is deliberately not awaited. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  calls = [];
  rows = [FILE_LAYER];
  collection = { type: 'FeatureCollection', features: [] };
  notify = vi.fn();
  reloadCase = vi.fn(async () => {});
  api = {
    get: vi.fn(async (path) => {
      calls.push(['GET', path]);
      if (path.endsWith('/data')) return collection;
      return rows;
    }),
    post: vi.fn(async (path) => {
      calls.push(['POST', path]);
      if (path.endsWith('/refresh')) return { ...followed(), sha256: 'ccc' };
      return followed();
    }),
    patch: vi.fn(async (path, body) => {
      calls.push(['PATCH', path, body]);
      return { ...rows[0], ...body };
    }),
    del: vi.fn(async (path) => calls.push(['DELETE', path])),
  };
});

describe('opening a case', () => {
  it('reads what is on disk and nothing else when every layer is a file', async () => {
    const layers = store();
    layers.load('c1');
    await settle();

    expect(calls).toEqual([['GET', '/api/cases/c1/map-layers']]);
    expect(layers.rows).toEqual([FILE_LAYER]);
  });

  it('re-reads a followed map that is enabled and asked to be', async () => {
    rows = [followed()];
    const layers = store();
    layers.load('c1');
    await settle();

    expect(calls).toEqual([
      ['GET', '/api/cases/c1/map-layers'],
      ['POST', '/api/cases/c1/map-layers/Roadblocks/refresh'],
    ]);
  });

  it('leaves a disabled subscription alone — an off layer costs nothing', async () => {
    rows = [followed({ enabled: false })];
    const layers = store();
    layers.load('c1');
    await settle();

    expect(calls).toEqual([['GET', '/api/cases/c1/map-layers']]);
  });

  it('leaves one alone that asked not to be read on open', async () => {
    rows = [followed({ refresh: { on_open: false } })];
    const layers = store();
    layers.load('c1');
    await settle();

    expect(calls).toEqual([['GET', '/api/cases/c1/map-layers']]);
  });

  it('draws the last snapshot when the feed cannot be reached', async () => {
    // a case opened offline is a case that still works
    rows = [followed()];
    api.post = vi.fn(async () => {
      throw new Error('network down');
    });
    const layers = store();
    layers.load('c1');
    await settle();

    expect(layers.drawn.map((row) => row.name)).toEqual(['Roadblocks']);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('drawing', () => {
  it('reads a layer once and keeps it, however often it is switched', async () => {
    const layers = store();
    layers.load('c1');
    await settle();

    await layers.drawing('c1', 'Sightings');
    await layers.drawing('c1', 'Sightings');

    expect(calls.filter(([, path]) => path.endsWith('/data'))).toHaveLength(1);
  });

  it('re-reads it only when a refresh actually moved the bytes', async () => {
    rows = [followed({ refresh: { on_open: false } })];
    const layers = store();
    layers.load('c1');
    await settle();
    await layers.drawing('c1', 'Roadblocks');
    const reads = () => calls.filter(([, path]) => path.endsWith('/data')).length;

    // same sha: the browser already holds exactly these features
    api.post = vi.fn(async () => followed());
    await layers.refresh('c1', layers.rows[0]);
    await layers.drawing('c1', 'Roadblocks');
    expect(reads()).toBe(1);

    // a different sha is a different layer, and the cached copy is dropped
    api.post = vi.fn(async () => followed({ sha256: 'ccc' }));
    await layers.refresh('c1', layers.rows[0]);
    await layers.drawing('c1', 'Roadblocks');
    expect(reads()).toBe(2);
  });

  it('draws only what is enabled', async () => {
    rows = [FILE_LAYER, followed({ enabled: false, refresh: { on_open: false } })];
    const layers = store();
    layers.load('c1');
    await settle();

    expect(layers.drawn.map((row) => row.name)).toEqual(['Sightings']);
  });
});

describe('the acts on a row', () => {
  it('switches a layer off without asking anyone for anything', async () => {
    const layers = store();
    layers.load('c1');
    await settle();
    calls.length = 0;

    await layers.toggle('c1', layers.rows[0]);

    expect(calls).toEqual([
      ['PATCH', '/api/cases/c1/map-layers/Sightings', { enabled: false }],
    ]);
  });

  it('hides one category by sending the whole list back', async () => {
    const layers = store();
    layers.load('c1');
    await settle();
    calls.length = 0;

    await layers.toggleCategory('c1', layers.rows[0], 'Checkpoints');

    expect(calls).toEqual([
      ['PATCH', '/api/cases/c1/map-layers/Sightings', { hidden: ['Checkpoints'] }],
    ]);
  });

  it('says so when a refresh found nothing new', async () => {
    rows = [followed()];
    api.post = vi.fn(async () => followed()); // same sha
    const layers = store();
    layers.load('c1');
    await settle();
    notify.mockClear();

    await layers.refresh('c1', layers.rows[0]);

    expect(notify).toHaveBeenCalledWith('Unchanged since last read', 'ok');
  });

  it('says why when a refresh failed, and keeps the row', async () => {
    rows = [followed({ refresh: { on_open: false } })];
    const layers = store();
    layers.load('c1');
    await settle();
    api.post = vi.fn(async () => {
      throw new Error('that source answered 503');
    });

    await layers.refresh('c1', layers.rows[0]);

    expect(notify).toHaveBeenCalledWith('that source answered 503', 'error');
    expect(layers.rows).toHaveLength(1);
  });

  it('takes a removed layer off the list and out of what is drawn', async () => {
    const layers = store();
    layers.load('c1');
    await settle();

    await layers.remove('c1', layers.rows[0]);

    expect(calls).toContainEqual(['DELETE', '/api/cases/c1/map-layers/Sightings']);
    expect(layers.rows).toEqual([]);
    expect(layers.drawn).toEqual([]);
  });
});

describe('adding', () => {
  it('posts a file as multipart and closes the dialog on success', async () => {
    const layers = store();
    layers.adding = true;

    await layers.addFile(new File(['{}'], 'x.geojson'));

    expect(api.post).toHaveBeenCalledWith(
      '/api/cases/c1/map-layers/upload',
      expect.any(FormData)
    );
    expect(layers.adding).toBe(false);
    expect(layers.rows).toHaveLength(1);
  });

  it('leaves the dialog open when the source was refused, with the reason', async () => {
    // the backend's sentence is something to act on, and closing the dialog
    // would take the input away with it
    api.post = vi.fn(async () => {
      throw new Error('this KMZ holds no KML file');
    });
    const layers = store();
    layers.adding = true;

    await layers.addFile(new File(['x'], 'x.kmz'));

    expect(notify).toHaveBeenCalledWith('this KMZ holds no KML file', 'error');
    expect(layers.adding).toBe(true);
    expect(layers.rows).toEqual([]);
  });

  it('subscribes to a pasted address', async () => {
    const layers = store();

    await layers.subscribe('https://example.test/roadblocks.kml');

    expect(api.post).toHaveBeenCalledWith('/api/cases/c1/map-layers', {
      url: 'https://example.test/roadblocks.kml',
      // on for an address, because following one already reaches the network
      icons: true,
    });
  });

  it('leaves the source icons off for a file unless they were asked for', async () => {
    const layers = store();

    await layers.addFile(new File(['x'], 'x.kmz'));
    const [, sent] = api.post.mock.calls[0];

    expect(sent.get('icons')).toBe('false');
  });

  it('asks for them when the dialog says so', async () => {
    const layers = store();

    await layers.addFile(new File(['x'], 'x.kmz'), true);
    const [, sent] = api.post.mock.calls[0];

    expect(sent.get('icons')).toBe('true');
  });
});

describe('switching case', () => {
  it('drops the previous case, rather than drawing its layers over the new one', async () => {
    const layers = store();
    layers.load('c1');
    await settle();
    expect(layers.rows).toHaveLength(1);

    rows = [];
    layers.load('c2');
    expect(layers.rows).toEqual([]);
  });
});

/**
 * Searching a layer's features, which is this feature's second network rule and
 * the easy one to get wrong: the collection is already in hand, so a keystroke
 * must cost nothing — not a remote request, not a local one.
 */
describe('finding a pin', () => {
  const GATES = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [2, 48] },
        properties: { name: 'North gate', category: 'Checkpoints', colour: '', index: 0 },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [3, 49] },
        properties: { name: 'Warehouse', category: 'Damage', colour: '', index: 1 },
      },
    ],
  };

  it('has nothing to search until the features are in hand, and says so', async () => {
    collection = GATES;
    const layers = store();
    layers.load('c1');
    await settle();

    // not "no match": the layer has not been read yet, which is a different
    // thing to tell somebody who is typing
    expect(layers.search(FILE_LAYER, 'gate')).toEqual({ total: 0, results: [], ready: false });

    await layers.drawing('c1', 'Sightings');

    expect(layers.search(FILE_LAYER, 'gate').ready).toBe(true);
  });

  it('costs no request at all, however much is typed', async () => {
    collection = GATES;
    const layers = store();
    layers.load('c1');
    await settle();
    await layers.drawing('c1', 'Sightings');
    const reads = calls.length;

    for (const query of ['g', 'ga', 'gat', 'gate', 'gate n']) layers.search(FILE_LAYER, query);

    expect(calls).toHaveLength(reads);
    expect(layers.search(FILE_LAYER, 'gate').results.map((hit) => hit.index)).toEqual([0]);
  });

  it('forgets the features when a refresh replaces the snapshot', async () => {
    // the parsed copy is derived from bytes that just moved, so a search over it
    // would be answering about a map nobody is drawing any more
    rows = [followed()];
    collection = GATES;
    const layers = store();
    layers.load('c1');
    await settle();
    await layers.drawing('c1', 'Roadblocks');

    // a feed that had not moved: the features in hand are still the right ones
    await layers.refresh('c1', layers.rows[0]);
    expect(layers.search(layers.rows[0], 'gate').ready).toBe(true);

    api.post = vi.fn(async () => ({ ...followed(), sha256: 'ddd' }));
    await layers.refresh('c1', layers.rows[0]);

    expect(layers.search(layers.rows[0], 'gate').ready).toBe(false);
  });

  it('names the match the map is to be sent to, and counts each picking', async () => {
    const layers = store();
    layers.load('c1');
    await settle();

    await layers.pick('c1', FILE_LAYER, { index: 4, category: 'Checkpoints', hidden: false });
    expect(layers.picked).toEqual({ name: 'Sightings', index: 4, at: 1 });

    await layers.pick('c1', FILE_LAYER, { index: 4, category: 'Checkpoints', hidden: false });
    // picking the same match twice is twice, or the map would go once and
    // ignore the second ask
    expect(layers.picked.at).toBe(2);
    expect(calls.filter(([verb]) => verb === 'PATCH')).toHaveLength(0);
  });

  it('turns a hidden group back on before sending the map to it', async () => {
    const layers = store();
    layers.load('c1');
    await settle();

    await layers.pick(
      'c1',
      { ...FILE_LAYER, hidden: ['Damage'] },
      { index: 9, category: 'Damage', hidden: true }
    );

    expect(calls).toContainEqual([
      'PATCH',
      '/api/cases/c1/map-layers/Sightings',
      { hidden: [] },
    ]);
    expect(layers.picked).toEqual({ name: 'Sightings', index: 9, at: 1 });
  });
});
