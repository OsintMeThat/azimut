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
