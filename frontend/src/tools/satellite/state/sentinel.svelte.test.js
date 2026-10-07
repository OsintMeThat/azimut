import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSentinelState } from './sentinel.svelte.js';

/**
 * Every question this store asks is a billed request about a place the map may
 * already have left, so what it must get right is *when it asks* and *what it
 * refuses to claim* — not the arithmetic, which is `lib/sentinel.js`.
 */

let at;
let get;
let notify;
let billed;

function store() {
  return createSentinelState({
    place: () => at,
    onBilled: billed,
    notify,
    api: { get },
  });
}

/** `{ 'YYYY-MM-DD': {cloud, granules} }` as the dates route answers it. */
const answer = (days) => ({ dates: days.map(([date, cloud]) => ({ date, cloud, granules: 1 })) });

beforeEach(() => {
  at = { lat: 48.8584, lon: 2.2945 };
  notify = vi.fn();
  billed = vi.fn();
  get = vi.fn(async (path) => {
    if (path.includes('/sentinel/layers')) {
      return { layers: [{ id: 'TRUE_COLOR', label: 'True colour' }], source: 'instance' };
    }
    if (path.includes('/sentinel/dates')) return answer([['2026-05-11', 4], ['2026-05-16', 62]]);
    return { available: true };
  });
});

describe('asking for a month of passes', () => {
  it('bills the lookup, and says so once', async () => {
    const s2 = store();
    await s2.loadPasses();
    expect(Object.keys(s2.passes)).toEqual(['2026-05-11', '2026-05-16']);
    expect(billed).toHaveBeenCalledTimes(1);
  });

  it('pays once for a month already seen', async () => {
    const s2 = store();
    await s2.loadPasses();
    await s2.loadPasses();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('pays once for a month asked for twice at the same time', async () => {
    const s2 = store();
    await Promise.all([s2.loadPasses(), s2.loadPasses()]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('asks again a few kilometres away, because the answer differs there', async () => {
    const s2 = store();
    await s2.loadPasses();
    at = { lat: 49.5, lon: 2.2945 };
    await s2.loadPasses();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('says a month is empty when it is', async () => {
    get = vi.fn(async () => answer([]));
    const s2 = store();
    await s2.loadPasses();
    expect(s2.passesNote).toBe('No Sentinel-2 pass here this month.');
  });

  it('never passes a failed lookup off as an empty month', async () => {
    // greying every day out because the network hiccuped would be a lie about
    // what exists
    get = vi.fn(async () => {
      throw new Error('offline');
    });
    const s2 = store();
    await s2.loadPasses();
    expect(s2.passes).toEqual({});
    expect(s2.passesNote).toContain('do not confirm coverage');
    expect(s2.stale).toBe(false); // there is nothing on screen to be stale
  });

  it('calls what is on screen stale once the map has moved off it', async () => {
    const s2 = store();
    await s2.loadPasses();
    expect(s2.stale).toBe(false);
    at = { lat: 12, lon: 34 };
    expect(s2.stale).toBe(true);
  });
});

describe('picking a day', () => {
  it('checks the crosshair before changing the map, and bills that check', async () => {
    const s2 = store();
    await s2.loadPasses();
    await s2.pickDate('2026-05-11');
    expect(s2.date).toBe('2026-05-11');
    expect(get).toHaveBeenCalledWith(expect.stringContaining('/sentinel/coverage'));
    expect(billed).toHaveBeenCalledTimes(2); // the month, then the check
  });

  it('remembers the answer, so the same day is checked once', async () => {
    const s2 = store();
    await s2.loadPasses();
    await s2.pickDate('2026-05-11');
    s2.clearDate();
    const before = get.mock.calls.length;
    await s2.pickDate('2026-05-11');
    expect(get).toHaveBeenCalledTimes(before);
    expect(s2.date).toBe('2026-05-11');
  });

  it('leaves the map where it was when the crosshair has no imagery', async () => {
    get = vi.fn(async (path) =>
      path.includes('/sentinel/dates') ? answer([['2026-05-11', 4]]) : { available: false }
    );
    const s2 = store();
    await s2.loadPasses();
    await s2.pickDate('2026-05-11');
    expect(s2.date).toBe('');
    expect(notify).toHaveBeenCalledWith('No imagery at the crosshair on 2026-05-11.', 'warn');
  });

  it('refuses a day it has no pass for', async () => {
    const s2 = store();
    await s2.loadPasses();
    await s2.pickDate('2026-05-12');
    expect(s2.date).toBe('');
    expect(get).toHaveBeenCalledTimes(1); // no check was spent on it
  });

  it('says why a cloudy day is not offered, instead of costing a tile to find out', async () => {
    const s2 = store();
    await s2.loadPasses();
    s2.setMaxcc(20);
    await s2.pickDate('2026-05-16'); // 62% cloud
    expect(s2.date).toBe('');
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('over the 20% ceiling'),
      'warn'
    );
  });

  it('asks the analyst again when the view moved under a slow check', async () => {
    let release;
    get = vi.fn(async (path) => {
      if (path.includes('/sentinel/dates')) return answer([['2026-05-11', 4]]);
      await new Promise((r) => (release = r));
      return { available: true };
    });
    const s2 = store();
    await s2.loadPasses();
    const picking = s2.pickDate('2026-05-11');
    at = { lat: 12, lon: 34 }; // panned away mid-flight
    release();
    await picking;
    expect(s2.date).toBe('');
    expect(notify).toHaveBeenCalledWith('The view changed. Pick the date again.', 'warn');
  });

  it('takes a pinned day back off when a new ceiling excludes it', async () => {
    const s2 = store();
    await s2.loadPasses();
    await s2.pickDate('2026-05-16'); // 62% cloud, allowed at 100
    expect(s2.date).toBe('2026-05-16');
    s2.setMaxcc(20);
    // that day now renders nothing, so it goes back to most recent rather than
    // to a blank map nobody asked for
    expect(s2.date).toBe('');
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('Back to most recent'),
      'warn'
    );
  });

  it('refuses a ceiling that is not one', () => {
    const s2 = store();
    s2.setMaxcc(140);
    s2.setMaxcc('abc');
    expect(s2.maxcc).toBe(100);
  });
});

describe('what the pill can claim', () => {
  it('names the most recent pass the ceiling still allows', async () => {
    const s2 = store();
    await s2.resolveLatest('2026-05-20');
    expect(s2.latest).toBe('2026-05-16');
    s2.setMaxcc(20);
    await s2.resolveLatest('2026-05-20');
    expect(s2.latest).toBe('2026-05-11'); // the cloudy pass is not rendered
  });

  it('steps back a month rather than claiming there was no pass', async () => {
    get = vi.fn(async (path) => {
      if (!path.includes('/sentinel/dates')) return { available: true };
      return path.includes('start=2026-05') ? answer([]) : answer([['2026-04-28', 3]]);
    });
    const s2 = store();
    await s2.resolveLatest('2026-05-02');
    expect(s2.latest).toBe('2026-04-28');
  });

  it('claims nothing when the lookup failed', async () => {
    get = vi.fn(async () => {
      throw new Error('offline');
    });
    const s2 = store();
    await s2.resolveLatest('2026-05-20');
    expect(s2.latest).toBe('');
  });

  it('resolves once per place and ceiling', async () => {
    const s2 = store();
    await s2.resolveLatest('2026-05-20');
    const before = get.mock.calls.length;
    await s2.resolveLatest('2026-05-20');
    expect(get).toHaveBeenCalledTimes(before);
  });

  it('carries the layer, the window and the ceiling on the provider id', async () => {
    const s2 = store();
    expect(s2.variant).toEqual({ layer: 'TRUE_COLOR', from: '', to: '', maxcc: 100 });
    await s2.loadPasses();
    await s2.pickDate('2026-05-11');
    expect(s2.variant).toEqual({
      layer: 'TRUE_COLOR',
      from: '2026-05-11',
      to: '2026-05-11',
      maxcc: 100,
    });
  });
});

/**
 * Sending no window does not render the most recent pass: Sentinel Hub applies
 * the mosaicking order per pixel over the whole archive, so a swath edge or a
 * granule gap in the newest scene comes back filled from an older one and the
 * tile is a blend of dates. "Most recent" therefore resolves to a day, and that
 * day is the window — holes where the pass has no pixels, which can be read.
 */
describe('never showing a blend of dates', () => {
  it('renders the resolved pass as a one-day window, not an open one', async () => {
    const s2 = store();
    expect(s2.window).toEqual({ from: '', to: '' }); // nothing resolved yet
    await s2.resolveLatest('2026-05-20');
    expect(s2.day).toBe('2026-05-16');
    expect(s2.window).toEqual({ from: '2026-05-16', to: '2026-05-16' });
    expect(s2.variant.from).toBe('2026-05-16');
  });

  it('prefers a pinned day over the resolved one', async () => {
    const s2 = store();
    await s2.resolveLatest('2026-05-20');
    await s2.loadPasses();
    await s2.pickDate('2026-05-11');
    expect(s2.day).toBe('2026-05-11');
    expect(s2.window).toEqual({ from: '2026-05-11', to: '2026-05-11' });
  });

  it('separates "not asked yet" from "there is no pass here"', async () => {
    const s2 = store();
    // before the lookup the map must not call itself undated: it has not asked
    expect(s2.resolved).toBe(false);
    expect(s2.undated).toBe(false);
    await s2.resolveLatest('2026-05-20');
    expect(s2.resolved).toBe(true);
    expect(s2.undated).toBe(false);
  });

  it('declares the blend when no pass could be dated at all', async () => {
    get = vi.fn(async (path) => (path.includes('/sentinel/dates') ? answer([]) : { available: true }));
    const s2 = store();
    await s2.resolveLatest('2026-05-20');
    expect(s2.day).toBe('');
    expect(s2.window).toEqual({ from: '', to: '' });
    // deep polar winter, a persistent gap: real, and said rather than papered over
    expect(s2.undated).toBe(true);
  });

  it('stays silent rather than declaring a blend when the lookup failed', async () => {
    get = vi.fn(async () => {
      throw new Error('offline');
    });
    const s2 = store();
    await s2.resolveLatest('2026-05-20');
    // a failed lookup proves nothing about the place, so it claims nothing
    expect(s2.undated).toBe(false);
    expect(s2.resolved).toBe(false);
  });

  it('answers again for a new ceiling, since a different pass may be newest', async () => {
    const s2 = store();
    await s2.resolveLatest('2026-05-20');
    expect(s2.day).toBe('2026-05-16');
    s2.setMaxcc(20);
    expect(s2.resolved).toBe(false); // the old answer was for the old ceiling
    await s2.resolveLatest('2026-05-20');
    expect(s2.day).toBe('2026-05-11');
  });

  it('holds the day it resolved while a new place is being looked up', async () => {
    const s2 = store();
    await s2.resolveLatest('2026-05-20');
    at = { lat: 26.3833, lon: 56.4383 };
    // the map has moved and nothing is resolved here yet, but the tiles must
    // not fall back to a blend in the meantime
    expect(s2.resolved).toBe(false);
    expect(s2.day).toBe('2026-05-16');
    expect(s2.undated).toBe(false);
  });
});

describe('which layers are on offer', () => {
  it('does not mistake the local catalogue for a checked instance and shares concurrent checks', async () => {
    get = vi.fn(async (path) => ({ source: path.includes('?check=true') ? 'instance' : 'catalogue',
      layers: [{ id: 'TRUE_COLOR', label: 'True colour' }, { id: 'VEGETATION_INDEX', label: 'Vegetation index' }] }));
    const s2 = store();
    expect(get).not.toHaveBeenCalled();
    await s2.loadLayers();
    expect(s2.layersSource).toBe('catalogue');
    await Promise.all([s2.loadLayers(true, true), s2.loadLayers(true, true)]);
    expect(get.mock.calls.filter(([path]) => path.includes('?check=true'))).toHaveLength(1);
    expect(s2.layersSource).toBe('instance');
    expect(s2.layersBusy).toBe(false);
    await s2.loadLayers(true, true);
    expect(get).toHaveBeenCalledTimes(2);
    await s2.loadLayers(true, true, true);
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('keeps a failed capabilities lookup unverified and lets the user retry', async () => {
    get = vi.fn(async () => ({ source: 'catalogue', layers: [{ id: 'NDVI' }], detail: 'offline' }));
    const s2 = store();
    expect(await s2.loadLayers(true, true)).toBe(false);
    expect(s2.layersNote).toContain('Could not check');
    expect(s2.layer).toBe('TRUE_COLOR');
    get.mockResolvedValue({ source: 'instance', layers: [{ id: 'TRUE_COLOR' }] });
    expect(await s2.loadLayers(true, true)).toBe(true);
    expect(s2.layersNote).toBe('');
  });

  it('reports a refused request and finishes the loading state', async () => {
    get = vi.fn(async () => { throw new Error('key refused'); });
    const s2 = store();
    expect(await s2.loadLayers(true, true)).toBe(false);
    expect(s2.layersSource).toBe('');
    expect(s2.layersBusy).toBe(false);
    expect(s2.layersNote).toContain('basemap stays on');
  });
  it('asks the instance once a session, quietly, and takes its answer', async () => {
    const s2 = store();
    s2.toggleMenu();
    await vi.waitFor(() => expect(s2.layers).toHaveLength(1));
    expect(get).toHaveBeenCalledWith('/api/satellite/sentinel/layers?check=true');
    expect(notify).not.toHaveBeenCalled(); // the first ask says nothing
    s2.toggleMenu();
    s2.toggleMenu();
    const asks = get.mock.calls.filter(([path]) => path.includes('/layers')).length;
    expect(asks).toBe(1);
  });

  it('drops a selected layer the instance no longer serves', async () => {
    get = vi.fn(async (path) =>
      path.includes('/layers')
        ? { layers: [{ id: 'SWIR', label: 'SWIR' }], source: 'instance' }
        : answer([])
    );
    const s2 = store();
    await s2.loadLayers(true, true);
    expect(s2.layer).toBe('SWIR');
  });
});

/**
 * A layer written here is a name like any other, plus a script. The store's
 * part is small and worth pinning: it must offer a new one without spending a
 * request to learn what this machine just wrote, and it must never read a
 * preview's digest out loud as though it were a layer name.
 */
describe('layers written here', () => {
  it('offers a layer just saved, without asking the instance again', async () => {
    const s2 = store();
    await s2.loadLayers(true, true);
    const asked = get.mock.calls.length;
    s2.rememberLayer({ id: 'PLUME_SWIR', label: 'SWIR plume', hint: 'hot spots' });
    expect(get).toHaveBeenCalledTimes(asked);
    const row = s2.layers.find((entry) => entry.id === 'PLUME_SWIR');
    expect(row).toMatchObject({ label: 'SWIR plume', hint: 'hot spots', custom: true });
    // and the verified instance list is not thrown away to learn it
    expect(s2.layersSource).toBe('instance');
  });

  it('replaces a layer of the same name rather than listing it twice', () => {
    const s2 = store();
    s2.rememberLayer({ id: 'PLUME', label: 'First' });
    s2.rememberLayer({ id: 'PLUME', label: 'Second' });
    const rows = s2.layers.filter((entry) => entry.id === 'PLUME');
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('Second');
  });

  it('reads a layer with no label as its own name', () => {
    const s2 = store();
    s2.rememberLayer({ id: 'NDWI_MINE' });
    expect(s2.layers.at(-1).label).toBe('NDWI_MINE');
  });

  it('calls a script being previewed a draft, not its digest', () => {
    const s2 = store();
    s2.layer = 'AZIMUT_DRAFT_A1B2C3D4E5F6';
    expect(s2.draft).toBe(true);
    expect(s2.layerShort).toBe('draft');
    expect(s2.layerLabel).toBe('draft layer');
    s2.layer = 'PLUME_SWIR';
    expect(s2.draft).toBe(false);
    expect(s2.layerShort).toBe('PLUME SWIR');
  });
});
