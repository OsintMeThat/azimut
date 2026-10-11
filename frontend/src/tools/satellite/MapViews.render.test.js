// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
const mocks = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), del: vi.fn() }, caseState: { current: { id: 'case' } }, uiState: { tool: 'satellite' },
  personalLayers: { maps: { caseId: 'case', name: '' }, legend: null, editor: null, whenSaved: vi.fn(async () => {}), setLegend: vi.fn(), closeMaps: vi.fn() },
  ensureCase: vi.fn(async () => ({ id: 'case' })), reloadCase: vi.fn(), toast: vi.fn(), applyMapView: vi.fn(async () => []), deletedToast: vi.fn(),
}));
vi.mock('../../lib/api.js', () => ({ api: mocks.api }));
vi.mock('../../lib/state.svelte.js', () => ({ caseState: mocks.caseState, uiState: mocks.uiState, ensureCase: mocks.ensureCase, reloadCase: mocks.reloadCase, toast: mocks.toast }));
vi.mock('../../lib/map/personalLayers.svelte.js', () => ({ personalLayers: mocks.personalLayers }));
vi.mock('../../lib/map/addedLayersState.svelte.js', () => ({ addedLayers: {} }));
vi.mock('../../lib/map/mapViews.js', async (actual) => ({ ...await actual(), applyMapView: mocks.applyMapView }));
vi.mock('../../lib/trash.js', () => ({ deletedToast: mocks.deletedToast }));
import MapViews from './MapViews.svelte';
let held;
const button = (name) => [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === name);
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); flushSync(); };
const item = { id: 'a'.repeat(32), title: 'Saved view', note: 'Legend note', show_legend: true, layers: [], provider: 'esri', camera: { lat: 48, lon: 2, zoom: 10 }, overlays: [] };
beforeEach(() => {
  vi.clearAllMocks(); mocks.caseState.current = { id: 'case' }; mocks.uiState.tool = 'satellite';
  mocks.personalLayers.maps = { caseId: 'case', name: '' }; mocks.personalLayers.editor = null;
  mocks.api.get.mockResolvedValue([item]); mocks.api.post.mockResolvedValue(item);
});
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; });
async function show() {
  held = mount(MapViews, { target: document.body, props: { tool: 'satellite', engine: { camera: () => item.camera }, provider: 'esri', rows: [], scope: { rows: [] }, onprovider: vi.fn() } });
  flushSync(); await settle();
}
describe('saved map controls', () => {
  it('renders safely when there is no case and no legend', async () => {
    mocks.caseState.current = null; mocks.personalLayers.maps = null;
    await show(); expect(document.querySelector('[aria-label="Map legend"]')).toBeNull();
  });
  it('saves the current view and opens an existing view with its legend', async () => {
    mocks.api.get.mockResolvedValue([]);
    await show(); button('Save this map').click(); await settle();
    expect(mocks.api.post).toHaveBeenCalledWith('/api/cases/case/map-views', expect.objectContaining({ title: 'My map', provider: 'esri', layers: [], show_legend: true }));
    expect(mocks.personalLayers.setLegend).toHaveBeenCalledWith(item, 'case');
    button('Saved view').click(); await settle();
    expect(mocks.applyMapView).toHaveBeenCalledWith(item, expect.objectContaining({ caseId: 'case' }));
    expect(mocks.personalLayers.closeMaps).toHaveBeenCalledOnce();
  });
  it('updates a named composition and keeps opening disabled while a layer is being edited', async () => {
    mocks.personalLayers.maps.name = item.id; mocks.personalLayers.editor = { caseId: 'case' };
    await show(); expect(document.querySelector('[aria-label="Map name"]').value).toBe('Saved view');
    expect(button('Saved view').disabled).toBe(true);
    button('Update with this view').click(); await settle();
    expect(mocks.api.post).toHaveBeenCalledWith('/api/cases/case/map-views', expect.objectContaining({ id: item.id }));
  });
  it('keeps the chosen title when saving creates the first case', async () => {
    mocks.caseState.current = null; mocks.personalLayers.maps.caseId = null;
    mocks.api.get.mockResolvedValue([]);
    mocks.ensureCase.mockImplementationOnce(async () => { mocks.caseState.current = { id: 'case' }; return mocks.caseState.current; });
    await show();
    const input = document.querySelector('[aria-label="Map name"]'); input.value = 'First map'; input.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    button('Save this map').click(); await settle();
    expect(mocks.api.post).toHaveBeenCalledWith('/api/cases/case/map-views', expect.objectContaining({ title: 'First map' }));
    expect(mocks.personalLayers.maps.caseId).toBe('case');
    expect(mocks.personalLayers.setLegend).toHaveBeenCalledWith(item, 'case');
  });
  it('does not put a late list or save result in another case', async () => {
    let resolve; mocks.api.get.mockImplementation(() => new Promise((done) => { resolve = done; }));
    await show(); mocks.caseState.current = { id: 'other' }; resolve([item]); await settle();
    expect(button('Saved view')).toBeUndefined();
    mocks.caseState.current = { id: 'case' };
    let saved; mocks.api.post.mockImplementation(() => new Promise((done) => { saved = done; }));
    button('Save this map').click(); await settle(); mocks.caseState.current = { id: 'other' }; saved(item); await settle();
    expect(mocks.personalLayers.setLegend).not.toHaveBeenCalled();
  });
});
