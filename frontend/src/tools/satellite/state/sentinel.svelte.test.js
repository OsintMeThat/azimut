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

describe('which layers are on offer', () => {
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
