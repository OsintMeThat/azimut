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
const { default: LayerCopyDialog } = await import('./LayerCopyDialog.svelte');

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

describe('Copy to my layer', () => {
  it('offers the layer chosen last in the case, and remembers the one used', async () => {
    mocks.rows = [{ name: 'a', title: 'First', editable: true }, { name: 'b', title: 'Second', editable: true }, { name: 'src', title: 'GC' }];
    localStorage.setItem('azimut:copy-layer:case', 'b');
    mocks.api.get.mockResolvedValue({ groups: [{ id: 'g1', name: 'One' }, { id: 'g2', name: 'Two' }] });
    const controller = { copying: { caseId: 'case', row: { title: 'GC' }, feature: { properties: { name: 'Strike' } } },
      copyTo: vi.fn(async () => ({})), cancelCopy: vi.fn() };
    show(LayerCopyDialog, { controller }); await settle(); flushSync();
    expect(document.querySelector('[aria-label="Layer to copy into"]').value).toBe('b');
    expect(document.querySelector('[aria-label="Group to copy into"]')).toBeTruthy();
    byText('Copy').click(); await settle();
    expect(controller.copyTo).toHaveBeenCalledWith(mocks.rows[1], 'g1');
    expect(localStorage.getItem('azimut:copy-layer:case')).toBe('b');
  });

  it('makes a layer for the copy when there is none yet', async () => {
    mocks.rows = [];
    mocks.createEditable.mockResolvedValueOnce({ name: 'new', title: 'Copied points', editable: true });
    const controller = { copying: { caseId: 'case', row: { title: 'GC' }, feature: { properties: {} } },
      copyTo: vi.fn(async () => ({})), cancelCopy: vi.fn() };
    show(LayerCopyDialog, { controller });
    byText('Copy').click(); await settle();
    expect(mocks.createEditable).toHaveBeenCalledWith('Copied points');
    expect(controller.copyTo).toHaveBeenCalledWith(expect.objectContaining({ name: 'new' }), null);
  });
});
