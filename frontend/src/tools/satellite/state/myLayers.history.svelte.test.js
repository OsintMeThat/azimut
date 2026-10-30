// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createMyLayersState } from './myLayers.svelte.js';

const ROW = { name: 'working', title: 'Working map', editable: true, features: 0, track: { on: true, precision: 'day', zone: 'UTC' } };
const line = (y) => ({ type: 'LineString', coordinates: [[0, y], [1, y]] });
const front = { type: 'Feature', geometry: line(1), properties: { key: 'front', name: 'Front', states: [
  { at: '2026-10-03', geometry: line(0) }, { at: '2026-10-12', geometry: line(1), status: 'damaged' }] } };
const later = { type: 'Feature', geometry: { type: 'Point', coordinates: [2, 48] }, properties: { key: 'later', date: '2026-10-20' } };

describe('a tracked layer edited in its past', () => {
  it('shows each feature as it stood on the cursor\'s day, and reshapes that shape', async () => {
    const cursor = $state({ at: null });
    const api = { get: vi.fn(async () => ({ layer: ROW, document: { features: [front, later] } })), post: vi.fn(), patch: vi.fn(), del: vi.fn() };
    const layers = { rows: [{ ...ROW, enabled: true }], toggle: vi.fn(), edited: vi.fn(), time: () => ({ at: cursor.at, trail: true, since: null }) };
    const editor = createMyLayersState({ api, layers, caseId: () => 'case', notify: vi.fn(), reloadCase: vi.fn(),
      beginSession: (path) => api.get(`${path}/edit`) });
    await editor.open(ROW);
    expect(editor.features[0].geometry).toEqual(line(1));
    cursor.at = '2026-10-05';
    expect(editor.features[0].geometry).toEqual(line(0));
    expect(editor.features[0].properties.status).toBeUndefined();
    expect(editor.features[1].properties.$absent).toBe(true);
    editor.select('front');
    expect(editor.selected.geometry).toEqual(line(0));
    editor.editGeometry();
    expect(editor.sketch.rings[0]).toEqual(line(0).coordinates);
    // the cursor moves on: what is picked follows it
    cursor.at = '2026-10-14';
    expect(editor.selected.geometry).toEqual(line(1));
    expect(editor.selected.properties.status).toBe('damaged');
  });
});

describe('a tracked layer read on another day', () => {
  const point = (x) => ({ type: 'Point', coordinates: [x, 48] });
  const depot = { type: 'Feature', geometry: point(2), properties: { key: 'depot', name: 'Depot', status: 'destroyed', states: [
    { at: '2026-10-03', geometry: point(2) }, { at: '2026-10-12', geometry: point(2), status: 'destroyed' }] } };
  const store = { type: 'Feature', geometry: point(3), properties: { key: 'store', name: 'Store', states: [{ at: '2026-10-10', geometry: point(3) }] } };
  const other = { type: 'Feature', geometry: point(4), properties: { key: 'other', name: 'Other' } };

  async function opened(at) {
    const cursor = $state({ at });
    const api = { get: vi.fn(async () => ({ layer: ROW, document: { features: [depot, store, other] } })),
      post: vi.fn(async () => ({ layer: ROW })), patch: vi.fn(async () => ({ layer: ROW })), del: vi.fn() };
    const layers = { rows: [{ ...ROW, enabled: true }], toggle: vi.fn(), edited: vi.fn(), setTime: vi.fn(),
      time: () => ({ at: cursor.at, trail: true, since: null }) };
    const notify = vi.fn();
    const editor = createMyLayersState({ api, layers, caseId: () => 'case', notify, reloadCase: vi.fn(),
      beginSession: (path) => api.get(`${path}/edit`) });
    await editor.open(ROW);
    cursor.at = at;
    return { editor, api, cursor, notify };
  }

  it('never writes the status of the day a feature was picked on another day', async () => {
    const { editor, api, cursor } = await opened('2026-10-05');
    editor.select('depot');
    expect(editor.selected.properties.status).toBeUndefined();
    // a date pressed in its history: the layer is read on the 14th, the depot destroyed then
    cursor.at = '2026-10-14';
    expect(editor.selected.properties.status).toBe('destroyed');
    expect(editor.formChanged).toBe(false);
    expect(editor.changed).toBe(false);
    editor.select('other');
    await editor.whenSaved();
    expect(api.patch).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('sets a status on the day shown, drawn at once', async () => {
    const { editor, api } = await opened('2026-10-14');
    editor.select('depot');
    const saving = editor.setStatus('damaged');
    expect(editor.selected.properties.status).toBe('damaged');
    await saving;
    expect(api.post).toHaveBeenLastCalledWith('/api/cases/case/map-layers/working/selection',
      { keys: ['depot'], changes: { status: 'damaged' }, at: '2026-10-14' });
  });

  it('leaves a feature that is not on the map that day as it is, and says how to change it', async () => {
    const { editor, api, notify } = await opened('2026-10-05');
    editor.select('store');
    expect(editor.selected.properties.$absent).toBe(true);
    await editor.setStatus('destroyed');
    editor.moveSelection();
    expect(editor.sketch).toBeNull();
    editor.editGeometry();
    expect(editor.sketch).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
    expect(notify).toHaveBeenLastCalledWith('Store is not on the map on 5 Oct 2026: change its days in the sheet first', 'info', 5000);
  });
});
