// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import LayerGeometry from './LayerGeometry.svelte';
import { createMyLayersState } from './state/myLayers.svelte.js';

let held;
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; });
function surface() {
  const box = document.createElement('div');
  box.getBoundingClientRect = () => ({ left: 10, top: 20, width: 800, height: 600 });
  const canvas = document.createElement('canvas');
  box.append(canvas); document.body.append(box);
  return { box, canvas };
}
async function setup(type = 'Polygon', features = []) {
  const callbacks = new Map(), removed = vi.fn();
  const { box, canvas } = surface();
  const engine = { container: box,
    latLngToContainerPoint: ({ lon, lat }) => ({ x: lon * 10, y: lat * 10 }),
    containerPointToLatLng: ({ x, y }) => ({ lon: x / 10, lat: y / 10 }),
    on: (name, run) => { callbacks.set(name, run); return removed; } };
  const row = { editable: true, name: 'work', title: 'Working' };
  const api = { post: vi.fn(async () => ({ layer: row, document: { features },
    groups: [{ id: 'g', name: 'Markers', mode: 'individual', size: 1 }] })) };
  const notify = vi.fn();
  const controller = createMyLayersState({ api, layers: { rows: [], edited: vi.fn() },
    caseId: () => 'case', notify, reloadCase: vi.fn() });
  await controller.open(row); if (type) controller.startShape(type);
  held = mount(LayerGeometry, { target: box, props: { engine, controller } }); flushSync();
  return { controller, engine, callbacks, removed, api, canvas, notify };
}
const point = (key, lon, lat, extra = {}) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: { key, group: 'g', symbol: 'badge-tank', ...extra } });
const press = (target, x, y, init = {}) => target.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: x, clientY: y, bubbles: true, ...init }));

describe('layer geometry handles', () => {
  it('draws clicked points as a closed area and moves its vertices without a write', async () => {
    const { controller, callbacks, api } = await setup();
    api.post.mockClear();
    callbacks.get('click')({ lon: 2, lat: 4 }); callbacks.get('click')({ lon: 3, lat: 4 }); callbacks.get('click')({ lon: 3, lat: 5 }); flushSync();
    expect(document.querySelector('.geometry path').getAttribute('d')).toBe('M20,40 L30,40 L30,50 Z');
    const vertex = document.querySelector('.vertex');
    vertex.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 30, clientY: 60, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 80 }));
    window.dispatchEvent(new PointerEvent('pointerup')); flushSync();
    expect(controller.sketch.rings[0][0]).toEqual([4, 6]);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('supports keyboard movement and removing a vertex, then cancels with Escape', async () => {
    const { controller, callbacks, api } = await setup('LineString'); api.post.mockClear();
    callbacks.get('click')({ lon: 2, lat: 4 }); callbacks.get('click')({ lon: 3, lat: 5 }); flushSync();
    const vertex = document.querySelector('.vertex');
    vertex.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true })); flushSync();
    expect(controller.sketch.rings[0][0]).toEqual([3, 4]);
    vertex.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); flushSync();
    expect(controller.complete).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); flushSync();
    expect(controller.sketch).toBeNull(); expect(document.querySelector('.geometry')).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('saves a complete sketch with Enter and releases map listeners on unmount', async () => {
    const { controller, callbacks, removed, api } = await setup('LineString'); api.post.mockClear();
    callbacks.get('click')({ lon: 2, lat: 4 }); callbacks.get('click')({ lon: 3, lat: 5 }); flushSync();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await controller.whenSaved(); flushSync();
    expect(api.post).toHaveBeenCalledWith('/api/cases/case/map-layers/work/shapes', expect.objectContaining({ geometry: { type: 'LineString', coordinates: [[2, 4], [3, 5]] } }));
    unmount(held); held = null; expect(removed).toHaveBeenCalledTimes(2);
  });

  it('closes a box drawn out to the pointer on the second click, no handle in the way', async () => {
    const { controller, callbacks, api, canvas } = await setup('Rectangle'); api.post.mockClear();
    callbacks.get('click')({ lon: 2, lat: 4 });
    // the box follows the pointer, its far corner under it: a handle there would take the click
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 60, clientY: 100, bubbles: true })); flushSync();
    expect(controller.sketch.rings[0]).toEqual([[2, 4], [5, 4], [5, 8], [2, 8]]);
    expect(document.querySelector('.vertex')).toBeNull();
    callbacks.get('click')({ lon: 5, lat: 8 });
    await controller.whenSaved(); await new Promise((done) => setTimeout(done)); flushSync();
    expect(api.post).toHaveBeenCalledWith('/api/cases/case/map-layers/work/shapes', expect.objectContaining({
      geometry: { type: 'Polygon', coordinates: [[[2, 4], [5, 4], [5, 8], [2, 8], [2, 4]]] } }));
    expect(controller.sketch).toBeNull();
  });

  it('saves a circle drawn out to the pointer with Enter', async () => {
    const { controller, callbacks, api, canvas } = await setup('Circle'); api.post.mockClear();
    callbacks.get('click')({ lon: 2, lat: 4 });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(api.post).not.toHaveBeenCalled();
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 60, clientY: 100, bubbles: true })); flushSync();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await controller.whenSaved(); await new Promise((done) => setTimeout(done)); flushSync();
    expect(api.post).toHaveBeenCalledWith('/api/cases/case/map-layers/work/shapes', expect.objectContaining({ geometry: expect.objectContaining({ type: 'Polygon' }) }));
    expect(api.post.mock.calls.at(-1)[1].geometry.coordinates[0]).toHaveLength(65);
    expect(controller.sketch).toBeNull();
  });

  it('picks a feature on a press, and a drag moves it as one edit the toast can undo', async () => {
    const { controller, api, canvas, notify } = await setup(null, [point('a', 2, 4), point('b', 30, 30)]);
    api.post.mockClear();
    api.post.mockResolvedValueOnce({ layer: { name: 'work' }, document: { features: [point('a', 3, 4)] }, batch: 'undo-1', kept: 0 });
    // the badge is drawn round (20, 40) on screen; the container sits at (10, 20)
    press(canvas, 30, 60);
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 40, clientY: 60 }));
    flushSync();
    expect(controller.dragging).toMatchObject({ keys: ['a'], offset: [1, 0] });
    expect(document.querySelector('.ghost-mark')).not.toBeNull();
    window.dispatchEvent(new PointerEvent('pointerup'));
    await controller.whenSaved(); flushSync();
    expect(api.post).toHaveBeenCalledWith('/api/cases/case/map-layers/work/selection', { keys: ['a'], offset: [1, 0] });
    expect(notify).toHaveBeenCalledWith('Moved', 'info', 7000, expect.objectContaining({ label: 'Undo' }));
    expect(controller.dragging).toBeNull();
  });

  it('leaves a press on bare ground to the map, and lets the selection go on its click', async () => {
    const { controller, canvas, callbacks } = await setup(null, [point('a', 2, 4)]);
    controller.chooseKeys(['a']);
    const down = new PointerEvent('pointerdown', { button: 0, clientX: 600, clientY: 500, bubbles: true, cancelable: true });
    canvas.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
    callbacks.get('click')({ lon: 59, lat: 48 });
    expect(controller.selection).toEqual([]);
  });

  it('adds to the selection on a shift press and removes it with Delete', async () => {
    const { controller, api, canvas } = await setup(null, [point('a', 2, 4), point('b', 30, 30)]);
    press(canvas, 30, 60); window.dispatchEvent(new PointerEvent('pointerup'));
    press(canvas, 310, 320, { shiftKey: true }); flushSync();
    expect(controller.selection).toEqual(['a', 'b']);
    api.post.mockClear();
    api.post.mockResolvedValueOnce({ layer: { name: 'work' }, document: { features: [] }, batch: 'gone' });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
    await controller.whenSaved();
    expect(api.post).toHaveBeenCalledWith('/api/cases/case/map-layers/work/selection', { keys: ['a', 'b'], remove: true });
  });

  it('selects what a loop drawn on the map encloses', async () => {
    const { controller, canvas } = await setup(null, [point('a', 2, 4), point('b', 30, 30)]);
    controller.lasso(); flushSync();
    press(canvas, 10, 40);
    for (const [x, y] of [[60, 40], [60, 90], [10, 90]]) window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y }));
    window.dispatchEvent(new PointerEvent('pointerup')); flushSync();
    expect(controller.selection).toEqual(['a']);
    expect(controller.lassoing).toBe(false);
  });

  it('keeps linked markers where their case item stands when a selection is dragged', async () => {
    const { controller, canvas } = await setup(null, [point('a', 2, 4, { entity_id: 'place-1' })]);
    press(canvas, 30, 60);
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 60, clientY: 60 })); flushSync();
    expect(controller.dragging).toBeNull();
    window.dispatchEvent(new PointerEvent('pointerup'));
  });

  it('opens the paste box on a paste outside any field', async () => {
    const { controller } = await setup(null, []);
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    paste.clipboardData = { getData: () => '48.85, 2.29' };
    window.dispatchEvent(paste); flushSync();
    expect(controller.pasting).toEqual({ text: '48.85, 2.29' });
  });

  it('shows the edit bar with the tools and its Done', async () => {
    await setup(null, []);
    const bar = document.querySelector('[role="toolbar"][aria-label="Layer tools"]');
    for (const name of ['Select', 'Select an area', 'Add markers', 'Draw line', 'Draw area', 'Paste a position', 'Add from the case']) {
      expect(bar.querySelector(`[aria-label="${name}"]`), name).not.toBeNull();
    }
    expect(bar.textContent).toContain('Done');
  });
});
