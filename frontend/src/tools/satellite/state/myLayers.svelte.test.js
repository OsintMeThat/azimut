// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMyLayersState } from './myLayers.svelte.js';

const ROW = { name: 'working', title: 'Working map', editable: true, features: 0 };
const feature = (key, properties = {}) => ({ type: 'Feature',
  geometry: { type: 'Point', coordinates: [2.35, 48.85] },
  properties: { key, name: key, colour: '#0072b2', symbol: 'pin', ...properties } });
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
let owner, api, layers, notify, reloadCase, sequence;
const store = () => createMyLayersState({ api, layers, caseId: () => owner, notify, reloadCase });

beforeEach(() => {
  owner = 'first';
  sequence = 0;
  api = {
    get: vi.fn(async () => ({ layer: ROW, document: { features: [] } })),
    post: vi.fn(async () => ({ layer: { ...ROW, features: ++sequence }, marker: feature(`m${sequence}`) })),
    patch: vi.fn(),
  };
  layers = { rows: [{ ...ROW, enabled: false }], toggle: vi.fn(), edited: vi.fn(),
    createEditable: vi.fn(async () => ROW), importEditable: vi.fn(async () => ROW),
    copyEditable: vi.fn(async () => ROW) };
  notify = vi.fn();
  reloadCase = vi.fn();
});

describe('personal layer editing', () => {
  it('reads nothing and takes no map click before editing starts', () => {
    const editor = store();
    expect(editor.addPoint({ lat: 1, lon: 2 })).toBe(false);
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('opens an editable layer from local data and switches it on', async () => {
    const editor = store();
    await editor.open(ROW);
    expect(editor.editor.title).toBe('Working map');
    expect(layers.toggle).toHaveBeenCalledWith('first', layers.rows[0]);
    expect(editor.placing).toBe(false);
  });

  it('saves rapid clicks in order using the style chosen at each click', async () => {
    const gate = deferred();
    api.post.mockImplementationOnce(() => gate.promise);
    const editor = store();
    await editor.open(ROW);
    editor.start();
    editor.draft.name = 'North';
    editor.addPoint({ lat: 1, lon: 2 });
    editor.draft.name = 'South';
    editor.draft.symbol = 'star';
    editor.addPoint({ lat: 3, lon: 4 });
    await Promise.resolve();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(editor.pending).toBe(2);
    gate.resolve({ layer: ROW, marker: feature('first-marker') });
    await editor.whenSaved();
    expect(api.post.mock.calls.map(([, body]) => body.name)).toEqual(['North', 'South']);
    expect(api.post.mock.calls[1][1]).toMatchObject({ lat: 3, lon: 4, symbol: 'star' });
    expect(editor.features).toHaveLength(2);
    expect(editor.pending).toBe(0);
    expect(api.post.mock.calls.every(([path]) => path.endsWith('/markers'))).toBe(true);
  });

  it('stops accepting clicks without losing ones already queued', async () => {
    const editor = store();
    await editor.open(ROW);
    editor.start();
    editor.addPoint({ lat: 1, lon: 2 });
    editor.stop();
    expect(editor.addPoint({ lat: 3, lon: 4 })).toBe(false);
    await editor.whenSaved();
    expect(editor.features).toHaveLength(1);
  });

  it('keeps saving later clicks after a refused one', async () => {
    api.post.mockRejectedValueOnce(new Error('First click refused'));
    const editor = store();
    await editor.open(ROW);
    editor.start();
    editor.addPoint({ lat: 1, lon: 2 });
    editor.addPoint({ lat: 3, lon: 4 });
    await editor.whenSaved();
    expect(editor.features).toHaveLength(1);
    expect(notify).toHaveBeenCalledWith('First click refused', 'danger', 5000);
    expect(editor.pending).toBe(0);
  });

  it('does not let a late save change another case or editor', async () => {
    const gate = deferred();
    api.post.mockImplementationOnce(() => gate.promise);
    const editor = store();
    await editor.open(ROW);
    editor.start();
    editor.addPoint({ lat: 1, lon: 2 });
    owner = 'second';
    editor.close();
    await editor.open(ROW);
    gate.resolve({ layer: ROW, marker: feature('old-marker') });
    await editor.whenSaved();
    expect(editor.features).toEqual([]);
    expect(layers.edited).not.toHaveBeenCalled();
  });

  it('creates a place only on an explicit promotion and refreshes the case', async () => {
    const editor = store();
    await editor.open(ROW);
    api.post.mockResolvedValueOnce({ layer: ROW, marker: feature('kept', { place_id: 'e1' }),
      place: { id: 'e1', label: 'Kept place' } });
    await editor.promote('kept');
    expect(api.post).toHaveBeenCalledWith('/api/cases/first/map-layers/working/markers/kept/place', {});
    expect(reloadCase).toHaveBeenCalledOnce();
    expect(editor.features[0].properties.place_id).toBe('e1');
  });

  it('creates an editable copy through the existing layer store', async () => {
    const editor = store();
    const source = { name: 'source', title: 'Source map' };
    editor.newLayer(source);
    await editor.create('My copy');
    expect(layers.copyEditable).toHaveBeenCalledWith(expect.objectContaining(source), 'My copy');
    expect(editor.dialog).toBe(null);
    expect(editor.editor.name).toBe(ROW.name);
  });

  it('imports a file without asking for web icons', async () => {
    const editor = store();
    const file = new File(['kmz'], 'source.kmz');
    editor.newLayer();
    await editor.create('My copy', file);
    expect(layers.importEditable).toHaveBeenCalledWith(file, 'My copy');
    expect(layers.createEditable).not.toHaveBeenCalled();
  });

  it('keeps a failed creation dialog open for a retry', async () => {
    layers.createEditable.mockResolvedValue(null);
    const editor = store();
    editor.newLayer();
    await editor.create('Working map');
    expect(editor.dialog).not.toBe(null);
    expect(editor.editor).toBe(null);
  });
});
