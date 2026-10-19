// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const mocks = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
  rows: [],
  createEditable: vi.fn(),
}));
vi.mock('../../lib/api.js', () => ({ api: mocks.api }));
vi.mock('../../lib/map/addedLayersState.svelte.js', () => ({
  addedLayers: { get rows() { return mocks.rows; }, createEditable: mocks.createEditable },
}));
vi.mock('../../lib/state.svelte.js', () => ({ caseState: { current: { id: 'case' } }, fmtCoords: (lat, lon) => `${lat}, ${lon}`, toast: vi.fn() }));

const { default: LayerLinkDialog } = await import('./LayerLinkDialog.svelte');
const { default: LayerPasteDialog } = await import('./LayerPasteDialog.svelte');
const { default: LayerCopyMenu } = await import('./LayerCopyMenu.svelte');

let held;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const byText = (label) => [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === label);
function show(component, props) { held = mount(component, { target: document.body, props }); flushSync(); }
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; vi.clearAllMocks(); localStorage.clear(); });

describe('Add from the case', () => {
  it('lists located items by kind, marks what the layer holds, and adds the ones checked', async () => {
    mocks.api.get.mockResolvedValueOnce([
      { id: 'p1', kind: 'place', title: 'Gate', lat: 48, lon: 2 },
      { id: 'pr', kind: 'proof', title: 'Strike · Crater', lat: 49, lon: 3 },
      { id: 'm1', kind: 'media', title: 'clip.mp4', lat: 50, lon: 4 },
    ]);
    const controller = { features: [{ properties: { entity_id: 'p1' }, geometry: { coordinates: [2, 48] } }],
      pending: 0, addLinks: vi.fn(async () => ({})), closeLinking: vi.fn() };
    show(LayerLinkDialog, { controller }); await settle(); flushSync();
    expect(mocks.api.get).toHaveBeenCalledWith('/api/cases/case/layer-links');
    expect(document.body.textContent).toContain('In the layer');
    byText('Proofs 1').click(); flushSync();
    expect(document.querySelectorAll('ul[aria-label="Located in the case"] li')).toHaveLength(1);
    document.querySelector('ul input[type="checkbox"]').click(); flushSync();
    byText('Add 1').click(); await settle();
    expect(controller.addLinks).toHaveBeenCalledWith([{ id: 'pr', lat: 49, lon: 3 }]);
    expect(controller.closeLinking).toHaveBeenCalled();
  });
});

describe('Paste a position', () => {
  it('reads the text, keeps its sources and day, and marks a post as somebody else\'s', async () => {
    vi.useFakeTimers();
    mocks.api.post.mockResolvedValueOnce({ points: [{ lat: 48.85, lon: 2.29, text: '48.85, 2.29' }],
      links: ['https://x.com/a/1'], date: '2026-09-13' });
    const controller = { pasting: { text: 'Strike 13 SEP 2026 48.85, 2.29 https://x.com/a/1' }, pending: 0,
      addPoints: vi.fn(async () => ({})), closePaste: vi.fn() };
    const onfly = vi.fn();
    show(LayerPasteDialog, { controller, onfly });
    await vi.advanceTimersByTimeAsync(300); vi.useRealTimers(); await settle(); flushSync();
    expect(mocks.api.post).toHaveBeenCalledWith('/api/geo/scan', { text: 'Strike 13 SEP 2026 48.85, 2.29 https://x.com/a/1' });
    expect(document.querySelector('.check input').checked).toBe(true);
    byText('Add marker').click(); await settle();
    expect(controller.addPoints).toHaveBeenCalledWith([{ lat: 48.85, lon: 2.29 }],
      { date: '2026-09-13', links: ['https://x.com/a/1'], provenance: 'external' });
    expect(onfly).toHaveBeenCalled();
  });
});

describe('a source layer’s feature put in one of the analyst’s layers', () => {
  const front = { name: 'b', title: 'Second', styles: [], markers: [], groups: [
    { id: 'g1', name: 'Positions', mode: 'individual', colour: '#0072b2', symbol: 'pin' },
    { id: 'g2', name: 'Checkpoints', mode: 'uniform', colour: '#009e73', symbol: 'star' }] };
  const first = { name: 'a', title: 'First', styles: [], markers: [], groups: [{ id: 'm', name: 'Markers', mode: 'uniform', colour: '#cc79a7', symbol: 'pin' }] };
  const job = (feature) => ({ caseId: 'case', row: { title: 'GeoConfirmed' }, anchor: null, feature });

  it('goes layer, group, icon, on the feature’s own colour, with the layer used last first', async () => {
    mocks.rows = [{ name: 'a', title: 'First', editable: true }, { name: 'b', title: 'Second', editable: true }];
    localStorage.setItem('azimut:layer-last:case', 'b');
    mocks.api.get.mockImplementation(async (url) => (url.includes('layer-targets') ? [first, front] : { colours: [] }));
    const controller = { copying: job({ geometry: { type: 'Point', coordinates: [2, 48] }, properties: { name: 'Strike', colour: '#d55e00' } }),
      copyTo: vi.fn(async () => ({})), cancelCopy: vi.fn() };
    show(LayerCopyMenu, { controller }); await settle(); flushSync();
    const menu = document.querySelector('[role="menu"][aria-label="Add to a layer"]');
    expect(menu.textContent).toContain('“Strike” stays GeoConfirmed\'s geolocation, with its day and sources.');
    expect([...menu.querySelectorAll('.targets .fm-item')].map((node) => node.textContent.trim())).toEqual(['Second', 'First']);
    // what it shows is said on the way, whichever step the menu is at
    byText('Destroyed').click(); flushSync();
    byText('Second').click(); flushSync();
    byText('Positions').click(); flushSync();
    expect(document.querySelector('[aria-label="What it shows"] [aria-pressed="true"]').textContent).toBe('Destroyed');
    document.querySelector('[aria-label="Point icon Tank icon"]').click(); flushSync();
    byText('Add to Positions').click(); await settle();
    expect(controller.copyTo).toHaveBeenCalledWith(mocks.rows[1], 'g1', { symbol: 'badge-tank', icon: '', colour: '#d55e00' }, 'destroyed');
    expect(localStorage.getItem('azimut:layer-last:case')).toBe('b');
  });

  it('keeps the icon its map dressed it in unless another is picked, the layer copying the picture', async () => {
    mocks.rows = [{ name: 'b', title: 'Second', editable: true }];
    mocks.api.get.mockImplementation(async (url) => (url.includes('layer-targets') ? [front] : url.endsWith('/icons') ? [] : { colours: [] }));
    const dressed = { geometry: { type: 'Point', coordinates: [2, 48] }, properties: { name: 'Strike', colour: '#d55e00', icon: 'abcdef0123456789' } };
    const controller = { copying: { ...job(dressed), row: { name: 'GeoConfirmed-Yemen', title: 'GeoConfirmed', icons: 40 } },
      copyTo: vi.fn(async () => ({})), cancelCopy: vi.fn() };
    show(LayerCopyMenu, { controller }); await settle(); flushSync();
    byText('Second').click(); flushSync();
    byText('Positions').click(); flushSync();
    const own = [...document.querySelectorAll('.fm-item.own')];
    expect(own).toHaveLength(1);
    expect(own[0].textContent).toContain('Its own icon');
    expect(own[0].getAttribute('aria-pressed')).toBe('true');
    byText('Add to Positions').click(); await settle();
    expect(controller.copyTo).toHaveBeenLastCalledWith(mocks.rows[0], 'g1',
      { symbol: 'pin', colour: '#d55e00', icon: 'abcdef0123456789', icon_from: 'GeoConfirmed-Yemen' }, '');
    // another pick replaces it, and the point no longer asks for the map's picture
    unmount(held); document.body.innerHTML = '';
    show(LayerCopyMenu, { controller }); await settle(); flushSync();
    byText('Second').click(); flushSync();
    byText('Positions').click(); flushSync();
    document.querySelector('[aria-label="Point icon Tank icon"]').click(); flushSync();
    expect(document.querySelector('.fm-item.own').getAttribute('aria-pressed')).toBe('false');
    byText('Add to Positions').click(); await settle();
    expect(controller.copyTo).toHaveBeenLastCalledWith(mocks.rows[0], 'g1', { symbol: 'badge-tank', colour: '#d55e00', icon: '' }, '');
  });

  it('adds a line at once, in the group it is put in', async () => {
    mocks.rows = [];
    mocks.api.get.mockImplementation(async (url) => (url.includes('layer-targets') ? [front] : { colours: [] }));
    const controller = { copying: job({ geometry: { type: 'LineString', coordinates: [[2, 48], [2.1, 48]] }, properties: { name: 'Front line' } }),
      copyTo: vi.fn(async () => ({})), cancelCopy: vi.fn() };
    show(LayerCopyMenu, { controller }); await settle(); flushSync();
    byText('Second').click(); flushSync();
    byText('Positions').click(); await settle();
    expect(controller.copyTo).toHaveBeenCalledWith(expect.objectContaining({ name: 'b' }), 'g1', null, '');
  });
});
