// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createItemLayers, placesAt } from './itemLayers.svelte.js';

const front = { name: 'front', title: 'Front', groups: [{ id: 'g', name: 'Sightings' }],
  markers: [{ key: 'a', group: 'g', lat: 48.1, lon: 2.1 }, { key: 'b', group: 'g', lat: 48.2, lon: 2.2 }] };

describe('a case item in the analyst’s layers', () => {
  it('finds the markers on one of an item’s points, not those on its others', () => {
    expect(placesAt({ lat: 48.1, lon: 2.1 }, [front]).map((place) => [place.marker.key, place.group.name])).toEqual([['a', 'Sightings']]);
    expect(placesAt({ lat: 48.3, lon: 2.3 }, [front])).toEqual([]);
  });

  it('adds a file by its id on the point it stands on', async () => {
    const api = { get: vi.fn(async () => [front]), post: vi.fn(async () => ({ layer: { name: 'front' }, added: 1 })) };
    const layers = { edited: vi.fn() }, notify = vi.fn(), held = new Map();
    const storage = { getItem: (key) => held.get(key) ?? null, setItem: (key, value) => held.set(key, value) };
    const items = createItemLayers({ api, layers, notify, storage });
    expect(await items.add('case', 'media-1', { lat: 48.1, lon: 2.1 }, front, front.groups[0], { symbol: 'badge-video', colour: '#d55e00' })).toBe(true);
    expect(api.post).toHaveBeenCalledWith('/api/cases/case/map-layers/front/links',
      { items: [{ id: 'media-1', lat: 48.1, lon: 2.1 }], group: 'g', symbol: 'badge-video', colour: '#d55e00' });
    expect(api.get).toHaveBeenLastCalledWith('/api/cases/case/layer-targets?entity=media-1');
    expect([items.entity, items.last('case')]).toEqual(['media-1', 'front']);
    expect(notify).toHaveBeenCalledWith('Added to Front', 'ok');
  });
});
