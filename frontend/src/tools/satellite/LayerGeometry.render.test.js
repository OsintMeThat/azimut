// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import LayerGeometry from './LayerGeometry.svelte';
import { createMyLayersState } from './state/myLayers.svelte.js';

let held;
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; });
async function setup(type = 'Polygon') {
  const callbacks = new Map(), removed = vi.fn();
  const engine = { container: { getBoundingClientRect: () => ({ left: 10, top: 20 }) },
    latLngToContainerPoint: ({ lon, lat }) => ({ x: lon * 10, y: lat * 10 }),
    containerPointToLatLng: ({ x, y }) => ({ lon: x / 10, lat: y / 10 }),
    on: (name, run) => { callbacks.set(name, run); return removed; } };
  const row = { editable: true, name: 'work', title: 'Working' };
  const api = { post: vi.fn(async () => ({ layer: row, document: { features: [] } })) };
  const controller = createMyLayersState({ api, layers: { rows: [], edited: vi.fn() },
    caseId: () => 'case', notify: vi.fn(), reloadCase: vi.fn() });
  await controller.open(row); controller.startShape(type);
  held = mount(LayerGeometry, { target: document.body, props: { engine, controller } }); flushSync();
  return { controller, engine, callbacks, removed, api };
}

describe('layer geometry handles', () => {
  it('draws clicked points as a closed area and moves its vertices without a write', async () => {
    const { controller, callbacks, api } = await setup();
    api.post.mockClear();
    callbacks.get('click')({ lon: 2, lat: 4 }); callbacks.get('click')({ lon: 3, lat: 4 }); callbacks.get('click')({ lon: 3, lat: 5 }); flushSync();
    expect(document.querySelector('path').getAttribute('d')).toBe('M20,40 L30,40 L30,50 Z');
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
});
