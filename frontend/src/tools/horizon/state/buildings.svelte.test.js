// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { BUILDINGS_KEY, MOVE_DELAY, POLL_MS, createBuildingsState } from './buildings.svelte.js';

const EYE = { lat: 13.578, lon: 44.018 };

function memoryStorage(seed = {}) {
  const held = new Map(Object.entries(seed));
  return { getItem: (key) => (held.has(key) ? held.get(key) : null), setItem: (key, value) => held.set(key, String(value)), held };
}

const area = (extra = {}) => ({
  tiles: [], pending: 0, working: 0, counts: { measured: 0, estimated: 0, range: 0, unknown: 0 }, footprints: {}, sources: [],
  failed: [], retry_in: 0, needs: [], downloads: [], ...extra,
});

/** A batch body as the app writes it, one 4-byte tile for each key ready. */
function batch(keys, ready = keys) {
  const parts = keys.flatMap((key) => (ready.includes(key) ? [[4, 0, 0, 0], [1, 2, 3, 4]] : [[0, 0, 0, 0]]));
  return new Uint8Array(parts.flat()).buffer;
}

function setUp({ answers = [], seed = {}, on = true } = {}) {
  const timers = [];
  const storage = memoryStorage(on ? { [BUILDINGS_KEY]: JSON.stringify({ on: true }), ...seed } : seed);
  const queue = [...answers];
  const api = {
    get: vi.fn(async (path) => {
      if (path.startsWith('/api/horizon/buildings/at')) return { height: 9.5, kind: 'estimated', source: 'globfp', date: '2020' };
      return queue.length > 1 ? queue.shift() : queue[0];
    }),
    post: vi.fn(async () => ({ started: ['g.zip'] })),
    del: vi.fn(async () => ({ freed: 10 })),
  };
  const bytes = vi.fn(async (path) => {
    const keys = new URLSearchParams(path.split('?')[1]).get('t').split(',');
    return batch(keys);
  });
  const state = createBuildingsState({
    api, bytes, storage,
    later: (fn, ms) => timers.push({ fn, ms }) && timers.length,
    cancel: () => {},
  });
  const run = async () => {
    const pending = timers.splice(0);
    for (const { fn } of pending) await fn();
  };
  return { state, api, bytes, timers, storage, run };
}

describe('Horizon buildings', () => {
  it('asks the app nothing while the row is off, wherever the eye goes', async () => {
    const s = setUp({ on: false, answers: [area()] });
    s.state.follow(EYE);
    await s.run();
    expect(s.api.get).not.toHaveBeenCalled();
    expect(s.state.sceneTiles).toEqual([]);
    expect(s.state.banner).toBeNull();
  });

  it('asks for the area once the eye rests, then fetches each ready tile once', async () => {
    const s = setUp({
      answers: [area({ tiles: [{ key: '14/1/2', ready: true, version: 'a' }, { key: '14/1/3', ready: false, version: '' }], pending: 1 })],
    });
    s.state.follow(EYE);
    expect(s.timers[0].ms).toBe(MOVE_DELAY);
    await s.run();
    expect(s.api.get.mock.calls[0][0]).toBe('/api/horizon/buildings?lat=13.578000&lon=44.018000&radius=2000&sources=ign,nl3dbag,nrw,nyc,osm,overture,globfp,google');
    expect(s.bytes.mock.calls[0][0]).toBe('/api/horizon/buildings/tiles?t=14/1/2&sources=ign,nl3dbag,nrw,nyc,osm,overture,globfp,google');
    expect(s.state.sceneTiles.map((t) => [t.key, t.x, t.y, t.version])).toEqual([['14/1/2', 1, 2, 'a']]);
    // a tile still coming: asked again a moment later, the one held not fetched twice
    expect(s.timers[0].ms).toBe(POLL_MS);
    await s.run();
    expect(s.bytes).toHaveBeenCalledTimes(1);
  });

  it('fetches a tile again when its version changes, and lets go of one the area left', async () => {
    const s = setUp({
      answers: [
        area({ tiles: [{ key: '14/1/2', ready: true, version: 'a' }, { key: '14/1/4', ready: true, version: 'a' }] }),
        area({ tiles: [{ key: '14/1/2', ready: true, version: 'b' }] }),
      ],
    });
    s.state.follow(EYE);
    await s.run();
    await s.state.refresh();
    expect(s.bytes.mock.calls.at(-1)[0]).toContain('t=14/1/2&');
    expect(s.state.sceneTiles.map((t) => [t.key, t.version])).toEqual([['14/1/2', 'b']]);
  });

  it('asks before a download, sends the yes, and stops asking after "Not now"', async () => {
    const s = setUp({ answers: [area({ needs: [{ grid: 'g.zip', size: 40e6 }] })] });
    s.state.follow(EYE);
    await s.run();
    expect(s.state.question.text).toContain('40 MB');
    // nothing to wait for but the analyst: no polling meanwhile
    expect(s.timers).toHaveLength(0);
    await s.state.allow();
    expect(s.api.post).toHaveBeenCalledWith('/api/horizon/buildings/allow', { grids: ['g.zip'] });
    s.state.decline();
    expect(s.state.question).toBeNull();
  });

  it('keeps its settings in this browser and asks again when the area they define changes', async () => {
    const s = setUp({ answers: [area()] });
    s.state.follow(EYE);
    await s.run();
    s.state.set({ radius: 5000, roofs: 'photo' });
    await Promise.resolve();
    expect(JSON.parse(s.storage.held.get(BUILDINGS_KEY))).toMatchObject({ on: true, radius: 5000, roofs: 'photo' });
    expect(s.api.get.mock.calls.at(-1)[0]).toContain('radius=5000');
    const asked = s.api.get.mock.calls.length;
    s.state.set({ look: 'outline' });
    expect(s.api.get.mock.calls.length).toBe(asked);
    expect(s.state.drawOptions(0)).toMatchObject({ buildings: 'outline', roofs: 'photo', groundShift: [0, 0] });
  });

  it('keeps what it holds when switched off, so switched on again nothing is fetched twice', async () => {
    const s = setUp({
      answers: [area({ tiles: [{ key: '14/1/2', ready: true, version: 'a' }] }), area({ tiles: [{ key: '14/1/2', ready: true, version: 'a' }] })],
    });
    s.state.follow(EYE);
    await s.run();
    s.state.toggle();
    expect(s.state.on).toBe(false);
    expect(s.state.sceneTiles.map((t) => t.key)).toEqual(['14/1/2']);
    s.state.toggle();
    await s.run();
    expect(s.api.get).toHaveBeenCalledTimes(2);
    expect(s.bytes).toHaveBeenCalledTimes(1);
  });

  it('keeps asking while the app is still raising tiles', async () => {
    const s = setUp({ answers: [area({ tiles: [{ key: '14/1/2', ready: true, version: 'a' }], working: 1 })] });
    s.state.follow(EYE);
    await s.run();
    expect(s.timers.at(-1).ms).toBe(POLL_MS);
    expect(s.state.banner).toMatchObject({ kind: 'progress', text: 'Raising the buildings…', share: null });
  });

  it('shows a download over the view with how far along it is', async () => {
    const s = setUp({
      answers: [area({ downloads: [{ grid: 'google', source: 'google', done: 13e6, total: 39e6, error: '' }] })],
    });
    s.state.follow(EYE);
    await s.run();
    expect(s.state.banner).toMatchObject({ kind: 'progress', text: 'Downloading Google 2.5D 13 MB of 39 MB' });
    expect(s.state.banner.share).toBeCloseTo(1 / 3);
  });

  it('notes under the view what the heights rest on while buildings show, nothing once off', async () => {
    const s = setUp({ answers: [area({ counts: { measured: 3, estimated: 0, range: 0, unknown: 1 } })] });
    expect(s.state.caveat).toBeNull();
    s.state.follow(EYE);
    await s.run();
    expect(s.state.caveat).toEqual({
      heights: '4 buildings · heights 75% measured, 25% unknown (drawn at 3 m)',
      note: 'Open data: heights and footprints can be wrong or out of date.',
    });
    s.state.toggle();
    expect(s.state.caveat).toBeNull();
  });

  it('says so when every source is switched off, rather than asking', async () => {
    const s = setUp({ answers: [area()] });
    s.state.follow(EYE);
    await s.run();
    s.state.set({ sources: { ign: false, osm: false, globfp: false } });
    expect(s.state.problems).toEqual(['Switch on at least one source.']);
  });

  it('says what the building under a point is, and nothing while off', async () => {
    const s = setUp({ answers: [area()] });
    s.state.follow(EYE);
    await s.run();
    await s.state.inspect({ lat: 13.5785, lon: 44.0185 });
    expect(s.state.info).toBe('9.5 m, estimated · height from 3D-GloBFP (2020) · footprint from 3D-GloBFP (2020)');
    s.api.get.mockRejectedValueOnce(Object.assign(new Error('No building is drawn here'), { status: 404 }));
    await s.state.inspect({ lat: 13.5, lon: 44.0 });
    expect(s.state.info).toBe('');
  });

  it('forgets the downloaded buildings when asked, and reads the area again', async () => {
    const s = setUp({ answers: [area()] });
    s.state.follow(EYE);
    await s.run();
    await s.state.clearCache();
    expect(s.api.del).toHaveBeenCalledWith('/api/horizon/buildings/cache');
    expect(s.api.get).toHaveBeenCalledTimes(2);
  });
});

describe('the Buildings row in the Layers menu', () => {
  it('switches the buildings, says what the area holds, and asks before a download', async () => {
    const s = setUp({
      answers: [area({ counts: { measured: 90, estimated: 0, range: 0, unknown: 10 }, needs: [{ grid: 'g.zip', size: 40e6 }] })],
    });
    s.state.follow(EYE);
    await s.run();
    const row = s.state.layerRow;
    expect(row).toMatchObject({ id: 'buildings', label: 'Buildings', on: true });
    expect(row.note).toBe('100 buildings · heights 90% measured, 10% unknown');
    expect(row.actions.map((a) => a.label)).toEqual(['Settings']);
    // the question is asked over the view
    const banner = s.state.banner;
    expect(banner).toMatchObject({
      kind: 'ask',
      text: 'To download here: 3D-GloBFP (about 2020) 40 MB. Each is downloaded once and kept on this machine.',
    });
    expect(banner.actions.map((a) => a.label)).toEqual(['Download 3D-GloBFP (40 MB)', 'Not now']);
    banner.actions[1].run();
    expect(s.state.banner).toBeNull();
    s.state.layerRow.actions[0].run();
    expect(s.state.panelOpen).toBe(true);
    row.toggle();
    expect(s.state.layerRow).toMatchObject({ on: false, note: '', actions: [] });
  });
});
