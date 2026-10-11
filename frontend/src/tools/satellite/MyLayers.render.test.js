// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import MyLayers from './MyLayers.svelte';
import NewLayerDialog from './NewLayerDialog.svelte';

let held;
const byText = (label) => [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === label);
function show(component, props) {
  held = mount(component, { target: document.body, props });
  flushSync();
}
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; });

describe('personal layers', () => {
  it('lists only editable layers and offers creation without a new tab', () => {
    const onnew = vi.fn();
    show(MyLayers, { rows: [{ title: 'Source map', name: 'source' },
      { title: 'Working map', name: 'working', editable: true }], controller: {}, onnew });
    expect(document.body.textContent).toContain('My layers');
    expect(document.body.textContent).toContain('Working map');
    expect(document.body.textContent).not.toContain('Source map');
    byText('New layer').click();
    expect(onnew).toHaveBeenCalledOnce();
  });

  it('shows marker defaults and explains their destination while adding', () => {
    show(MyLayers, { rows: [], controller: { editor: { title: 'Working map' }, placing: true,
      draft: { name: '', colour: '#0072b2', symbol: 'pin' }, features: [], pending: 0 } });
    expect(document.body.textContent).toContain('Click the map to add markers. Esc to stop.');
    expect(document.body.textContent).toContain('Markers stay in this layer until saved as case places.');
    expect(document.querySelector('[aria-label="New marker symbol"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="New marker blue"]')).toBeTruthy();
  });

  it('offers explicit place promotion only for a selected point', () => {
    const marker = { properties: { key: 'm1', name: 'Gate' }, geometry: { type: 'Point', coordinates: [2, 48] } };
    const promote = vi.fn();
    show(MyLayers, { controller: { editor: { title: 'Working map' }, selected: marker,
      features: [marker], pending: 0, promote } });
    byText('Save as case place').click();
    expect(promote).toHaveBeenCalledWith('m1');
  });

  it('shows an already promoted point without offering another promotion', () => {
    const marker = { properties: { key: 'm1', name: 'Gate', place_id: 'e1' }, geometry: { type: 'Point' } };
    show(MyLayers, { controller: { editor: { title: 'Working map' }, selected: marker,
      features: [marker], pending: 0 } });
    expect(byText('Saved as case place').disabled).toBe(true);
  });
});

describe('new layer', () => {
  it('creates a blank layer from the visible actions', () => {
    const oncreate = vi.fn();
    show(NewLayerDialog, { oncreate, onclose: vi.fn() });
    byText('Create layer').click();
    expect(oncreate).toHaveBeenCalledWith('My layer', null);
    expect(byText('From a file')).toBeTruthy();
  });

  it('requires a file when starting from a file', () => {
    show(NewLayerDialog, { onclose: vi.fn() });
    byText('From a file').click();
    flushSync();
    expect(byText('Create layer').disabled).toBe(true);
    expect(document.body.textContent).toContain('External icons are left out.');
  });
});
