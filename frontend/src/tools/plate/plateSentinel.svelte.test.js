// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { createPlateSentinel } from './plateSentinel.svelte.js';
import { api } from '../../lib/api.js';

let stop = null;
let fetch = null;
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-20T12:00:00Z')); });
afterEach(() => { stop?.(); stop = null; fetch?.mockRestore(); vi.useRealTimers(); });

/** Copernicus as a fake: passes over the Dnipro, a failed lookup anywhere else. */
function copernicus() {
  const asked = [];
  fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    asked.push(String(url));
    if (!String(url).includes('lat=47.5')) return new Response(JSON.stringify({ detail: 'quota spent' }), { status: 429, headers: { 'Content-Type': 'application/json' } });
    const dates = [{ date: '2026-10-18', cloud: 76 }, { date: '2026-10-13', cloud: 8.2 }, { date: '2026-10-08', cloud: 0 }];
    return new Response(JSON.stringify({ dates }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  return asked;
}
const settle = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); flushSync(); };

function plate(maps) {
  const state = $state({ maps, picked: null });
  let sentinel = null;
  stop = $effect.root(() => {
    sentinel = createPlateSentinel({ target: () => state.maps.find((map) => map.id === state.picked) ?? null,
      place: (map) => ({ lat: map.view.lat, lon: map.view.lon }), notify: () => {}, api });
  });
  flushSync();
  return { state, sentinel };
}

describe('the plate\'s one Sentinel-2 state', () => {
  it('asks Copernicus nothing until a map on Sentinel-2 with no pass is picked, then pins the newest under 30% cloud', async () => {
    const asked = copernicus();
    const { state, sentinel } = plate([
      { id: 'plain', basemap: 'plain', view: { lat: 47.5, lon: 34.6, zoom: 12 } },
      { id: 'kept', basemap: 'sentinel2', acquired: '2026-10-08', product: 'SWIR', maxcc: 50, view: { lat: 47.5, lon: 34.6, zoom: 12 } },
      { id: 'new', basemap: 'sentinel2', view: { lat: 47.5, lon: 34.6, zoom: 12 } },
    ]);
    await settle();
    state.picked = 'plain'; flushSync(); await settle();
    expect(sentinel.map).toBe('');
    // a map already on a pass is read as it is
    state.picked = 'kept'; flushSync(); await settle();
    expect(asked).toEqual([]);
    expect(sentinel.map).toBe('kept');
    expect([sentinel.s2.date, sentinel.s2.layer, sentinel.s2.maxcc]).toEqual(['2026-10-08', 'SWIR', 50]);
    state.picked = 'new'; flushSync();
    await vi.waitFor(() => expect(state.maps[2].acquired).toBe('2026-10-13'));
    expect(state.maps[2].maxcc).toBe(30);
    expect(state.maps[2].product ?? '').toBe('');
    expect(asked.filter((url) => url.includes('/sentinel/dates?'))).toHaveLength(1);
    // the first map is as it was
    expect(state.maps[1]).toMatchObject({ acquired: '2026-10-08', product: 'SWIR', maxcc: 50 });
  });

  it('never gives the next map the pass found for the one picked before it', async () => {
    copernicus();
    const { state } = plate([
      { id: 'dnipro', basemap: 'sentinel2', view: { lat: 47.5, lon: 34.6, zoom: 12 } },
      { id: 'elsewhere', basemap: 'sentinel2', view: { lat: 12.6, lon: 43.4, zoom: 12 } },
    ]);
    state.picked = 'dnipro'; flushSync();
    await vi.waitFor(() => expect(state.maps[0].acquired).toBe('2026-10-13'));
    // the lookup over the other map fails: it stays with no pass rather than the Dnipro's
    state.picked = 'elsewhere'; flushSync();
    await settle(); await settle();
    expect(state.maps[1].acquired).toBeUndefined();
  });
});
