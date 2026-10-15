// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAddedLayersState } from './addedLayersState.svelte.js';
import { createLayerMemory } from './layerMemory.js';

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
/** This browser's storage, shared by every store a test makes, as a reload shares it. */
let storage;

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

function store() {
  return createAddedLayersState({
    api,
    notify,
    ensureCase: async () => ({ id: 'c1' }),
    reloadCase,
    memory: createLayerMemory(() => storage),
  });
}

/** What this browser kept for one case. */
const kept = (caseId = 'c1') => JSON.parse(storage.getItem(`azimut:map-layers:${caseId}`) ?? '{}');

/** Let the store's own promise chain settle — `load` is deliberately not awaited. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  calls = [];
  storage = memoryStorage();
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
  it('reads what is on disk and nothing else', async () => {
    rows = [FILE_LAYER, followed()];
    const layers = store();
    layers.load('c1');
    await settle();

    expect(calls).toEqual([['GET', '/api/cases/c1/map-layers']]);
    expect(layers.rows.map((row) => row.name)).toEqual(['Sightings', 'Roadblocks']);
  });

  it('draws nothing in a case that never switched a layer on', async () => {
    rows = [FILE_LAYER, followed()];
    const layers = store();
    layers.load('c1');
    await settle();

    expect(layers.rows.every((row) => row.enabled === false)).toBe(true);
    expect(layers.drawn).toEqual([]);
  });

  it('puts back what was on in the previous store, as a reload does', async () => {
    const before = store();
    before.load('c1');
    await settle();
    await before.toggle('c1', before.rows[0]);
    expect(before.drawn).toHaveLength(1);

    const after = store();
    after.load('c1');
    await settle();

    expect(after.drawn.map((row) => row.name)).toEqual(['Sightings']);
  });
});

describe('switching a layer on', () => {
  it('re-reads a followed map the first time, and never again in the session', async () => {
    rows = [followed()];
    const layers = store();
    layers.load('c1');
    await settle();
    calls.length = 0;

    await layers.toggle('c1', layers.rows[0]); // on
    await layers.toggle('c1', layers.rows[0]); // off
    await layers.toggle('c1', layers.rows[0]); // on again

    expect(calls).toEqual([['POST', '/api/cases/c1/map-layers/Roadblocks/refresh']]);
    expect(layers.drawn.map((row) => row.name)).toEqual(['Roadblocks']);
  });

  it('asks nothing of a file, or of a subscription that asked not to be', async () => {
    rows = [FILE_LAYER, followed({ refresh: { on_open: false } })];
    const layers = store();
    layers.load('c1');
    await settle();
    calls.length = 0;

    await layers.toggle('c1', layers.rows[0]);
    await layers.toggle('c1', layers.rows[1]);

    expect(calls).toEqual([]);
    expect(layers.drawn).toHaveLength(2);
  });

  it('never sends the switch to the backend', async () => {
    const layers = store();
    layers.load('c1');
    await settle();
    calls.length = 0;

    await layers.toggle('c1', layers.rows[0]);
    await layers.toggle('c1', layers.rows[0]);

    expect(calls).toEqual([]);
    expect(layers.drawn).toEqual([]);
  });

  it('draws the last snapshot when the feed cannot be reached', async () => {
    // switched on offline, a layer still draws what it holds
    rows = [followed()];
    api.post = vi.fn(async () => {
      throw new Error('network down');
    });
    const layers = store();
    layers.load('c1');
    await settle();

    await layers.toggle('c1', layers.rows[0]);

    expect(layers.drawn.map((row) => row.name)).toEqual(['Roadblocks']);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('drawing', () => {
  it('keeps a late drawing from overwriting a personal layer edit', async () => {
    const layers = store();
    layers.load('c1');
    await settle();
    let release;
    api.get.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const old = layers.drawing('c1', 'Sightings');
    layers.edited('c1', { ...FILE_LAYER, editable: true, sha256: 'edited' });
    const updated = { type: 'FeatureCollection', features: [{ properties: { key: 'new-marker' } }] };
    api.get.mockResolvedValueOnce(updated);
    expect(await layers.drawing('c1', 'Sightings')).toBe(updated);
    release(collection);
    await old;
    expect(await layers.drawing('c1', 'Sightings')).toBe(updated);
  });

  it('keeps a late drawing out of another case with the same layer name', async () => {
    const layers = store();
    layers.load('c1');
    await settle();
    let release;
    api.get.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const old = layers.drawing('c1', 'Sightings');
    layers.load('c2');
    await settle();
    release(collection);
    await old;
    const updated = { type: 'FeatureCollection', features: [{ properties: { key: 'other-case' } }] };
    api.get.mockResolvedValueOnce(updated);
    expect(await layers.drawing('c2', 'Sightings')).toBe(updated);
  });

  it('reads a layer once and keeps it, however often it is switched', async () => {
    const layers = store();
    layers.load('c1');
    await settle();

    await layers.drawing('c1', 'Sightings');
    await layers.drawing('c1', 'Sightings');

    expect(calls.filter(([, path]) => path.endsWith('/data'))).toHaveLength(1);
  });

  it('asks the server for the features, past whatever the browser kept', async () => {
    // the address is the same through every refresh, and Chrome had kept one
    // it filled before the backend said no-cache
    const layers = store();
    layers.load('c1');
    await settle();

    await layers.drawing('c1', 'Sightings');

    expect(api.get).toHaveBeenCalledWith('/api/cases/c1/map-layers/Sightings/data', {
      cache: 'no-cache',
    });
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

  it('draws only what is switched on', async () => {
    rows = [FILE_LAYER, followed({ refresh: { on_open: false } })];
    const layers = store();
    layers.load('c1');
    await settle();

    await layers.toggle('c1', layers.rows[0]);

    expect(layers.drawn.map((row) => row.name)).toEqual(['Sightings']);
  });
});

describe('the acts on a row', () => {
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

  it('reads every followed layer again in turn, and says what it found once', async () => {
    rows = [FILE_LAYER, followed(), followed({ name: 'Convoys', title: 'Convoys', sha256: 'ddd' })];
    api.post = vi.fn(async (path) => {
      calls.push(['POST', path]);
      if (path.includes('Convoys')) throw new Error('that source answered 503');
      return { ...followed(), sha256: 'ccc' };
    });
    const layers = store();
    layers.load('c1');
    await settle();
    calls.length = 0;
    notify.mockClear();

    await layers.refreshAll('c1');

    // a file has nothing to read and is left alone
    expect(calls).toEqual([
      ['POST', '/api/cases/c1/map-layers/Roadblocks/refresh'],
      ['POST', '/api/cases/c1/map-layers/Convoys/refresh'],
    ]);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('1 updated, 1 could not be reached', 'warn');
    expect(layers.refreshing).toBe(false);
  });

  it('asks nothing when no layer is followed', async () => {
    const layers = store();
    layers.load('c1');
    await settle();
    calls.length = 0;

    await layers.refreshAll('c1');

    expect(calls).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
  });

  it('moves the rows at once and keeps the order the backend answers with', async () => {
    rows = [FILE_LAYER, followed()];
    api.put = vi.fn(async (path, body) => {
      calls.push(['PUT', path, body]);
      return [followed(), FILE_LAYER];
    });
    const layers = store();
    layers.load('c1');
    await settle();
    calls.length = 0;

    const saving = layers.reorder('c1', ['Roadblocks', 'Sightings']);
    // before the answer: the list and what is drawn already follow the drag
    expect(layers.rows.map((row) => row.name)).toEqual(['Roadblocks', 'Sightings']);
    await saving;

    expect(calls).toEqual([
      ['PUT', '/api/cases/c1/map-layers/order', { names: ['Roadblocks', 'Sightings'] }],
    ]);
    expect(layers.rows.map((row) => row.name)).toEqual(['Roadblocks', 'Sightings']);
  });

  it('restacks one section without moving rows from the other section', async () => {
    rows = [FILE_LAYER, { ...FILE_LAYER, name: 'first', editable: true }, followed(),
      { ...FILE_LAYER, name: 'second', editable: true }];
    api.put = vi.fn(async () => null);
    const layers = store(); layers.load('c1'); await settle();
    await layers.reorder('c1', ['second', 'first']);
    expect(layers.rows.map((row) => row.name)).toEqual(['Sightings', 'second', 'Roadblocks', 'first']);
  });

  it('puts the order back when it could not be kept', async () => {
    rows = [FILE_LAYER, followed()];
    api.put = vi.fn(async () => {
      throw new Error('disk full');
    });
    const layers = store();
    layers.load('c1');
    await settle();

    await layers.reorder('c1', ['Roadblocks', 'Sightings']);

    expect(layers.rows.map((row) => row.name)).toEqual(['Sightings', 'Roadblocks']);
    expect(notify).toHaveBeenCalledWith('disk full', 'error');
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

describe('a name the URL would cut', () => {
  it('encodes every name it puts in a path, so "Ops #2" never reaches "Ops"', async () => {
    const ops = followed({ name: 'Ops #2', title: 'Ops #2', refresh: { on_open: false } });
    rows = [ops];
    api.post = vi.fn(async (path) => {
      calls.push(['POST', path]);
      return ops;
    });
    const layers = store();
    layers.load('c1');
    await settle();
    calls.length = 0;

    await layers.drawing('c1', 'Ops #2');
    await layers.refresh('c1', layers.rows[0]);
    await layers.toggleCategory('c1', layers.rows[0], 'Checkpoints');
    await layers.remove('c1', layers.rows[0]);

    const paths = calls.map(([, path]) => path);
    expect(paths).toEqual([
      '/api/cases/c1/map-layers/Ops%20%232/data',
      '/api/cases/c1/map-layers/Ops%20%232/refresh',
      '/api/cases/c1/map-layers/Ops%20%232',
      '/api/cases/c1/map-layers/Ops%20%232',
    ]);
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

  it('draws what was just added, without reading its source a second time', async () => {
    const layers = store();

    await layers.subscribe('https://example.test/roadblocks.kml');
    calls.length = 0;
    await layers.toggle('c1', layers.rows[0]); // off
    await layers.toggle('c1', layers.rows[0]); // on again

    expect(layers.drawn.map((row) => row.name)).toEqual(['Roadblocks']);
    expect(calls).toEqual([]);
  });

  it('names what was just added, so its row opens unfolded', async () => {
    const layers = store();
    expect(layers.justAdded).toBe('');

    await layers.subscribe('https://example.test/roadblocks.kml');

    expect(layers.justAdded).toBe('Roadblocks');
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

describe('the time filter', () => {
  const DATED = {
    type: 'FeatureCollection',
    features: [
      { properties: { name: 'a', category: 'Checkpoints', date: '2026-09-01', index: 0 } },
      { properties: { name: 'b', category: 'Checkpoints', date: '2026-09-10', index: 1 } },
      { properties: { name: 'c', category: 'Checkpoints', date: '2026-09-18', index: 2 } },
    ],
  };

  async function drawn() {
    collection = DATED;
    const layers = store();
    layers.load('c1');
    await settle();
    await layers.toggle('c1', layers.rows[0]);
    await layers.drawing('c1', 'Sightings');
    return layers;
  }

  it('has nothing to index until the features are in hand, nor for an undated layer', async () => {
    const layers = store();
    layers.load('c1');
    await settle();
    expect(layers.dates(layers.rows[0])).toBeNull();

    collection = { type: 'FeatureCollection', features: [{ properties: { name: 'x' } }] };
    await layers.drawing('c1', 'Sightings');
    expect(layers.dates(layers.rows[0])).toBeNull();
  });

  it('follows a dragged strip in the page and tells the backend nothing yet', async () => {
    const layers = await drawn();
    calls.length = 0;

    await layers.setPeriod('c1', layers.rows[0], { start: '2026-09-05', end: '' }, false);

    expect(calls).toEqual([]);
    expect(layers.rows[0].period).toEqual({ start: '2026-09-05', end: '' });
    expect(layers.rows[0].shown).toBe(2);
    expect(layers.drawn[0].period).toEqual({ start: '2026-09-05', end: '' });
  });

  it('keeps the period on the layer when the strip is let go', async () => {
    const layers = await drawn();
    calls.length = 0;
    const period = { start: '2026-09-05', end: '2026-09-12' };

    await layers.setPeriod('c1', layers.rows[0], period, true);

    expect(calls).toEqual([['PATCH', '/api/cases/c1/map-layers/Sightings', { period }]]);
    expect(layers.rows[0].period).toEqual(period);
    expect(layers.rows[0].shown).toBe(1);
  });

  it('clears it with two blanks, which is what the backend reads as none', async () => {
    const layers = await drawn();
    calls.length = 0;

    await layers.setPeriod('c1', layers.rows[0], null, true);

    expect(calls).toEqual([
      ['PATCH', '/api/cases/c1/map-layers/Sightings', { period: { start: '', end: '' } }],
    ]);
  });

  it('puts back the stored period when it could not be kept', async () => {
    const layers = await drawn();
    api.patch = vi.fn(async () => {
      throw new Error('offline');
    });

    await layers.setPeriod('c1', layers.rows[0], { start: '2026-09-05', end: '' }, true);

    expect(layers.rows[0].period).toBeNull();
    expect(layers.rows[0].shown).toBeUndefined();
  });

  it('lets every date back in before going to a match outside the period', async () => {
    const layers = await drawn();
    calls.length = 0;

    await layers.pick('c1', layers.rows[0], { index: 0, category: 'Checkpoints', hidden: true, outside: true });

    expect(calls).toContainEqual([
      'PATCH',
      '/api/cases/c1/map-layers/Sightings',
      { period: { start: '', end: '' } },
    ]);
    // the group was never off, so it is not switched
    expect(calls.some(([, , body]) => body?.hidden)).toBe(false);
    expect(layers.picked.index).toBe(0);
  });
});

describe('adding from GeoConfirmed', () => {
  it('posts the query and closes both dialogs on success', async () => {
    const layers = store();
    layers.geoconfirmed = true;
    const body = { conflict: 'Ukraine', days: 30 };

    await layers.addGeoConfirmed(body);

    expect(api.post).toHaveBeenCalledWith('/api/cases/c1/map-layers/geoconfirmed', body);
    expect(layers.geoconfirmed).toBe(false);
    expect(layers.adding).toBe(false);
  });

  it('keeps the dialog open with the reason when GeoConfirmed refused', async () => {
    api.post = vi.fn(async () => {
      throw new Error('GeoConfirmed maps no conflict called Atlantis');
    });
    const layers = store();
    layers.geoconfirmed = true;

    await layers.addGeoConfirmed({ conflict: 'Atlantis', days: 7 });

    expect(notify).toHaveBeenCalledWith('GeoConfirmed maps no conflict called Atlantis', 'error');
    expect(layers.geoconfirmed).toBe(true);
  });

  it('reads the conflict list once per session, however often the dialog opens', async () => {
    rows = [{ conflict: 'Ukraine', name: 'Ukraine' }];
    const layers = store();

    await layers.conflicts();
    await layers.conflicts();

    expect(calls.filter(([, path]) => path === '/api/geoconfirmed/conflicts')).toHaveLength(1);
  });

  it('asks nothing of GeoConfirmed until its dialog does', async () => {
    const layers = store();
    layers.load('c1');
    await settle();

    expect(calls.some(([, path]) => path.includes('geoconfirmed'))).toBe(false);
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
    api.post = vi.fn(async () => followed());
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

describe('one store, every map', () => {
  it('reads the list once per case and reload, however many maps ask', async () => {
    const layers = store();
    // Satellite, Compare, Detect and Horizon all mounted, all hearing the case open
    layers.load('c1', 0);
    layers.load('c1', 0);
    layers.load('c1', 0);
    await settle();
    expect(calls).toEqual([['GET', '/api/cases/c1/map-layers']]);

    layers.load('c1', 1); // the case was reloaded
    layers.load('c1', 1);
    await settle();
    expect(calls).toHaveLength(2);
  });

  it('lists a layer Detect filed from its findings in every map after the reload', async () => {
    const layers = store();
    const detect = layers.scope('detect');
    layers.load('c1', 0);
    await settle();
    expect(detect.rows.map((row) => row.name)).toEqual(['Sightings']);

    // Detect's "Add to the SAT layers" writes the snapshot, then reloads the case
    rows = [FILE_LAYER, { ...FILE_LAYER, name: 'Strikes', title: 'Strikes', sha256: 'ddd' }];
    layers.load('c1', 1);
    await settle();

    expect(detect.rows.map((row) => row.name)).toEqual(['Sightings', 'Strikes']);
    expect(layers.rows.map((row) => row.name)).toEqual(['Sightings', 'Strikes']);
    // listed, not drawn: it starts off like every other layer
    expect(detect.drawn).toEqual([]);
  });

  it('lets an answer for a reload that moved on land nowhere', async () => {
    let answer;
    api.get = vi.fn(() => new Promise((resolve) => (answer = resolve)));
    const layers = store();
    layers.load('c1', 0);
    const first = answer;
    layers.load('c1', 1);
    answer([FILE_LAYER, followed()]);
    first([]);
    await settle();

    expect(layers.rows.map((row) => row.name)).toEqual(['Sightings', 'Roadblocks']);
  });

  it('keeps each map its own switches, so a layer is drawn only where it was asked for', async () => {
    const layers = store();
    const compare = layers.scope('compare');
    const horizon = layers.scope('horizon');
    layers.load('c1');
    await settle();

    await compare.toggle('c1', compare.rows[0]);

    expect(compare.drawn.map((row) => row.name)).toEqual(['Sightings']);
    expect(horizon.drawn).toEqual([]);
    expect(layers.drawn).toEqual([]); // the Map's own switch is untouched
  });

  it('re-reads a followed layer once in the session, whichever map switched it on first', async () => {
    rows = [followed()];
    const layers = store();
    const detect = layers.scope('detect');
    layers.load('c1');
    await settle();
    calls.length = 0;

    await detect.toggle('c1', detect.rows[0]);
    await layers.toggle('c1', layers.rows[0]);

    expect(calls).toEqual([['POST', '/api/cases/c1/map-layers/Roadblocks/refresh']]);
  });

  it('reads the features once for every map that draws them', async () => {
    const layers = store();
    layers.load('c1');
    await settle();
    calls.length = 0;

    await layers.drawing('c1', 'Sightings'); // Compare's A
    await layers.drawing('c1', 'Sightings'); // Compare's B
    await layers.drawing('c1', 'Sightings'); // Detect

    expect(calls).toEqual([['GET', '/api/cases/c1/map-layers/Sightings/data']]);
  });

  it('takes a removed layer off in every map', async () => {
    const layers = store();
    const detect = layers.scope('detect');
    layers.load('c1');
    await settle();
    await detect.toggle('c1', detect.rows[0]);
    await layers.toggle('c1', layers.rows[0]);

    await layers.remove('c1', layers.rows[0]);
    // a layer filed again under the same name comes back off, everywhere
    layers.load('c1', 1);
    await settle();

    expect(detect.rows.map((row) => row.name)).toEqual(['Sightings']);
    expect(detect.drawn).toEqual([]);
    expect(layers.drawn).toEqual([]);
  });
});

/**
 * Each map's switches, kept per case in this browser, and the guard that keeps a
 * layer heavy enough to take the tab down from doing it on every reload.
 */
describe('kept between sessions', () => {
  const three = () => [
    FILE_LAYER,
    { ...FILE_LAYER, name: 'Checkpoints', title: 'Checkpoints', sha256: 'c' },
    { ...FILE_LAYER, name: 'Strikes', title: 'Strikes', sha256: 'd' },
  ];

  /** A store reopened on c1 after each map had switched layers on in an earlier one. */
  async function reopened(byScope) {
    storage.setItem('azimut:map-layers:c1', JSON.stringify({ added: byScope }));
    const layers = store();
    layers.load('c1');
    await settle();
    return layers;
  }

  it('keeps every map apart, and each case apart', async () => {
    const layers = store();
    const detect = layers.scope('detect');
    layers.load('c1');
    await settle();
    await detect.toggle('c1', detect.rows[0]);

    expect(kept().added).toEqual({ detect: ['Sightings'] });
    const again = store();
    again.load('c1');
    await settle();
    expect(again.scope('detect').drawn.map((row) => row.name)).toEqual(['Sightings']);
    expect(again.drawn).toEqual([]);

    again.load('c2');
    await settle();
    expect(again.scope('detect').drawn).toEqual([]);
    expect(storage.getItem('azimut:map-layers:c2')).toBeNull();
  });

  it('puts the layers back one at a time, each once the one before is drawn', async () => {
    rows = three();
    const layers = await reopened({ satellite: ['Sightings', 'Checkpoints', 'Strikes'] });

    // every one listed as on, one drawn
    expect(layers.rows.every((row) => row.enabled)).toBe(true);
    expect(layers.drawn.map((row) => row.name)).toEqual(['Sightings']);

    layers.watch.start('Sightings');
    layers.watch.end('Sightings', 'drawn');
    expect(layers.drawn.map((row) => row.name)).toEqual(['Sightings', 'Checkpoints']);

    layers.watch.start('Checkpoints');
    layers.watch.end('Checkpoints', 'drawn');
    expect(layers.drawn).toHaveLength(3);
  });

  it('waits on a map hidden before its layer was drawn, rather than moving on', async () => {
    rows = three();
    const layers = await reopened({ satellite: ['Sightings', 'Checkpoints'] });

    layers.watch.start('Sightings');
    layers.watch.end('Sightings', 'dropped');

    expect(layers.drawn.map((row) => row.name)).toEqual(['Sightings']);
    expect(kept().drawing).toEqual([]);
  });

  it('lets the next one in when the one being drawn is switched off', async () => {
    rows = three();
    const layers = await reopened({ satellite: ['Sightings', 'Checkpoints', 'Strikes'] });

    await layers.toggle('c1', layers.rows[0]); // Sightings off, mid-draw
    expect(layers.drawn.map((row) => row.name)).toEqual(['Checkpoints']);
    await layers.toggle('c1', layers.rows[2]); // Strikes off, still waiting

    expect(kept().added.satellite).toEqual(['Checkpoints']);
    layers.watch.start('Checkpoints');
    layers.watch.end('Checkpoints', 'drawn');
    expect(layers.drawn.map((row) => row.name)).toEqual(['Checkpoints']);
  });

  it('asks nothing of a followed layer it puts back: it draws the snapshot on disk', async () => {
    rows = [followed()];
    const layers = await reopened({ satellite: ['Roadblocks'] });

    expect(layers.drawn.map((row) => row.name)).toEqual(['Roadblocks']);
    expect(calls).toEqual([['GET', '/api/cases/c1/map-layers']]);
  });

  it('drops a layer the case no longer has, and forgets it', async () => {
    const layers = await reopened({ satellite: ['Gone', 'Sightings'] });

    expect(layers.drawn.map((row) => row.name)).toEqual(['Sightings']);
    expect(kept().added.satellite).toEqual(['Sightings']);
  });

  it('forgets a removed layer', async () => {
    const layers = await reopened({ satellite: ['Sightings'], detect: ['Sightings'] });

    await layers.remove('c1', layers.rows[0]);

    expect(kept().added).toEqual({ satellite: [], detect: [] });
  });

  it('leaves off a layer the last session stopped while drawing, and says which', async () => {
    rows = three();
    const before = await reopened({ satellite: ['Sightings', 'Checkpoints'] });
    before.watch.start('Sightings');
    expect(kept().drawing).toEqual(['Sightings']);
    // …and the tab dies here: no end, no pagehide

    const after = store();
    after.load('c1');
    await settle();

    expect(after.rows.find((row) => row.name === 'Sightings').enabled).toBe(false);
    expect(after.drawn.map((row) => row.name)).toEqual(['Checkpoints']);
    expect(notify).toHaveBeenCalledWith(
      'Sightings was left off: the last session stopped while drawing it', 'warn', 10000);
    expect(kept()).toMatchObject({ added: { satellite: ['Checkpoints'] }, drawing: [] });
  });

  it('draws it again once switched back on, and keeps it on if it holds', async () => {
    storage.setItem('azimut:map-layers:c1', JSON.stringify({ added: { satellite: ['Sightings'] }, drawing: ['Sightings'] }));
    const layers = store();
    layers.load('c1');
    await settle();
    expect(layers.drawn).toEqual([]);

    await layers.toggle('c1', layers.rows[0]);
    layers.watch.start('Sightings');
    layers.watch.end('Sightings', 'drawn');

    expect(kept()).toMatchObject({ added: { satellite: ['Sightings'] }, drawing: [] });
  });

  it('blames nothing when the page was closed on purpose mid-draw', async () => {
    const before = await reopened({ satellite: ['Sightings'] });
    before.watch.start('Sightings');
    before.leave(); // pagehide

    const after = store();
    after.load('c1');
    await settle();

    expect(after.drawn.map((row) => row.name)).toEqual(['Sightings']);
    expect(notify).not.toHaveBeenCalled();
  });

  it('clears the mark only once every map drawing a layer is done with it', async () => {
    const layers = await reopened({ compare: ['Sightings'] });
    const compare = layers.scope('compare');

    compare.watch.start('Sightings'); // A
    compare.watch.start('Sightings'); // B
    compare.watch.end('Sightings', 'drawn');
    expect(kept().drawing).toEqual(['Sightings']);
    compare.watch.end('Sightings', 'drawn');
    expect(kept().drawing).toEqual([]);
  });

  it('switches off a layer that could not be drawn, everywhere and said once', async () => {
    const layers = await reopened({ satellite: ['Sightings'], compare: ['Sightings'] });
    const compare = layers.scope('compare');

    compare.watch.start('Sightings');
    layers.watch.start('Sightings');
    compare.watch.end('Sightings', 'failed');
    layers.watch.end('Sightings', 'failed');

    expect(layers.drawn).toEqual([]);
    expect(compare.drawn).toEqual([]);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('Sightings could not be drawn and was switched off', 'error');
    expect(kept().added).toEqual({ satellite: [], compare: [] });
  });

  it('marks nothing of a case it has since left', async () => {
    const layers = await reopened({ satellite: ['Sightings'] });
    layers.watch.start('Sightings');

    rows = [];
    layers.load('c2');
    await settle();
    layers.watch.end('Sightings', 'failed');

    expect(kept('c1').drawing).toEqual([]);
    expect(storage.getItem('azimut:map-layers:c2')).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });
});
