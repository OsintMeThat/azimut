// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProofLayers, orderedTargets, placesOf } from './proofLayers.svelte.js';

const front = { name: 'front', title: 'Front', groups: [{ id: 'g1', name: 'Positions' }, { id: 'g2', name: 'Checkpoints', mode: 'uniform', symbol: 'star', colour: '#009e73' }], markers: [] };
const strikes = { name: 'strikes', title: 'Strikes', groups: [{ id: 's', name: 'Markers' }], markers: [] };

describe('where a proof’s points are in the layers', () => {
  it('gives each marker to the point it stands nearest to', () => {
    const layers = [{ ...front, markers: [{ key: 'a', group: 'g2', lat: 48.8601, lon: 2.3601 }] },
      { ...strikes, markers: [{ key: 'b', group: 's', lat: 48.85, lon: 2.35 }, { key: 'c', group: 's', lat: 48.86, lon: 2.36 }] }];
    const places = placesOf(['48.85, 2.35', '48.86, 2.36', ''], layers);
    expect(places.get(0).map((place) => place.marker.key)).toEqual(['b']);
    expect(places.get(1).map((place) => [place.layer.name, place.group?.name, place.marker.key])).toEqual([
      ['front', 'Checkpoints', 'a'], ['strikes', 'Markers', 'c']]);
    expect(places.has(2)).toBe(false);
    // no point written yet: nowhere to put them
    expect(placesOf(['', ''], layers).size).toBe(0);
  });

  it('offers the layer used last first, the others in their order', () => {
    expect(orderedTargets([front, strikes]).map((layer) => layer.name)).toEqual(['front', 'strikes']);
    expect(orderedTargets([front, strikes], 'strikes').map((layer) => layer.name)).toEqual(['strikes', 'front']);
  });
});

describe('a proof’s point added to and taken out of a layer', () => {
  let api, layers, notify, refreshEditor, storage, lookup, held;
  beforeEach(() => {
    held = new Map();
    storage = { getItem: (key) => held.get(key) ?? null, setItem: (key, value) => held.set(key, value) };
    api = { get: vi.fn(async () => [strikes]), post: vi.fn(async () => ({ layer: { name: 'strikes' }, added: 1 })), del: vi.fn(async () => ({ layer: { name: 'strikes' } })) };
    layers = { edited: vi.fn(), createEditable: vi.fn(async () => ({ name: 'new-layer', title: 'New layer' })) };
    notify = vi.fn(); refreshEditor = vi.fn(); lookup = vi.fn(async () => ({ id: 'proof-1' }));
  });
  const store = () => createProofLayers({ api, layers, lookup, notify, refreshEditor, storage });

  it('reads the layers, with the proof’s markers once it is saved', async () => {
    const proofLayers = store();
    await proofLayers.refresh('case', null);
    expect(api.get).toHaveBeenLastCalledWith('/api/cases/case/layer-targets');
    expect(proofLayers.entity).toBeNull();
    await proofLayers.refresh('case', 'strike');
    expect(lookup).toHaveBeenCalledWith('case', 'spec', 'proofs/.meta/strike.json');
    expect(api.get).toHaveBeenLastCalledWith('/api/cases/case/layer-targets?entity=proof-1');
    expect(proofLayers.targets).toEqual([strikes]);
  });

  it('adds the point as a marker in the icon and colour chosen', async () => {
    const proofLayers = store();
    await proofLayers.add('case', 'strike', '48.85, 2.29', strikes, strikes.groups[0], { symbol: 'badge-tank', colour: '#d55e00' });
    expect(api.post).toHaveBeenCalledWith('/api/cases/case/map-layers/strikes/links',
      { items: [{ id: 'proof-1', lat: 48.85, lon: 2.29 }], group: 's', symbol: 'badge-tank', colour: '#d55e00' });
  });

  it('adds the saved point into the group chosen, and remembers the layer', async () => {
    const proofLayers = store();
    expect(await proofLayers.add('case', 'strike', '48.85, 2.29', front, front.groups[1])).toBe(true);
    expect(api.post).toHaveBeenCalledWith('/api/cases/case/map-layers/front/links', { items: [{ id: 'proof-1', lat: 48.85, lon: 2.29 }], group: 'g2' });
    expect(layers.edited).toHaveBeenCalledWith('case', { name: 'strikes' });
    expect(refreshEditor).toHaveBeenCalledWith('front');
    expect(notify).toHaveBeenCalledWith('Added to Front', 'ok');
    expect(proofLayers.last('case')).toBe('front');
    expect(api.get).toHaveBeenCalled();
  });

  it('makes a layer for the point and reads the list again, so the menu can open it', async () => {
    const proofLayers = store();
    expect(await proofLayers.create('case', 'strike', 'New layer')).toBe('new-layer');
    expect(layers.createEditable).toHaveBeenCalledWith('New layer');
    expect(api.get).toHaveBeenCalledWith('/api/cases/case/layer-targets?entity=proof-1');
    expect(api.post).not.toHaveBeenCalled();
    layers.createEditable.mockResolvedValueOnce(null);
    expect(await proofLayers.create('case', 'strike', 'Refused')).toBeNull();
    expect(proofLayers.busy).toBe(false);
  });

  it('takes a marker out with a way back', async () => {
    const proofLayers = store();
    await proofLayers.remove('case', 'strike', { layer: strikes, marker: { key: 'm1' } });
    expect(api.del).toHaveBeenCalledWith('/api/cases/case/map-layers/strikes/markers/m1');
    const [message, kind, , action] = notify.mock.calls.at(-1);
    expect([message, kind, action.label]).toEqual(['Taken out of Strikes', 'info', 'Undo']);
    api.post.mockResolvedValueOnce({ layer: { name: 'strikes' } });
    await action.onClick();
    expect(api.post).toHaveBeenCalledWith('/api/cases/case/map-layers/strikes/markers/m1/restore', {});
  });

  it('says why a point could not be added', async () => {
    lookup.mockResolvedValueOnce(null);
    const proofLayers = store();
    expect(await proofLayers.add('case', 'gone', '48.85, 2.29', strikes, null)).toBe(false);
    expect(notify).toHaveBeenCalledWith('This proof is no longer in the case', 'danger');
    expect(proofLayers.busy).toBe(false);
  });
});
