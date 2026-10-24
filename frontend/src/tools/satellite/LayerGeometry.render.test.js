// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
async function setup(type = 'Polygon', features = [], props = {}) {
  const callbacks = new Map(), removed = vi.fn();
  const { box, canvas } = surface();
  const engine = { container: box,
    latLngToContainerPoint: ({ lon, lat }) => ({ x: lon * 10, y: lat * 10 }),
    containerPointToLatLng: ({ x, y }) => ({ lon: x / 10, lat: y / 10 }),
    on: (name, run) => { callbacks.set(name, run); return removed; }, readClicks: vi.fn() };
  const row = { editable: true, name: 'work', title: 'Working' };
  const api = { post: vi.fn(async () => ({ layer: row, document: { features },
    groups: [{ id: 'g', name: 'Markers', mode: 'individual', size: 1 }] })) };
  const notify = vi.fn();
  const controller = createMyLayersState({ api, layers: { rows: [], edited: vi.fn() },
    caseId: () => 'case', notify, reloadCase: vi.fn() });
  await controller.open(row); if (type) controller.startShape(type);
  held = mount(LayerGeometry, { target: box, props: { engine, controller, ...props } }); flushSync();
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

  it('picks a feature on a click, and a drag of it picked moves it as one edit the toast can undo', async () => {
    const { controller, api, canvas, notify } = await setup(null, [point('a', 2, 4), point('b', 30, 30)]);
    api.post.mockClear();
    api.post.mockResolvedValueOnce({ layer: { name: 'work' }, document: { features: [point('a', 3, 4)] }, batch: 'undo-1', kept: 0 });
    // the badge is drawn round (20, 40) on screen; the container sits at (10, 20)
    press(canvas, 30, 60); window.dispatchEvent(new PointerEvent('pointerup', { clientX: 30, clientY: 60 }));
    expect(controller.selection).toEqual(['a']);
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

  it('pans the map on a drag that starts on a marker not picked, moving nothing', async () => {
    const { controller, api, canvas } = await setup(null, [point('a', 2, 4)]);
    api.post.mockClear();
    const down = new PointerEvent('pointerdown', { button: 0, clientX: 30, clientY: 60, bubbles: true, cancelable: true });
    canvas.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 90, clientY: 60 }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 90, clientY: 60 })); flushSync();
    expect(controller.dragging).toBeNull();
    expect(controller.selection).toEqual([]);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('moves a picked area by its edge, and pans the map on a drag from inside it', async () => {
    const zone = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 0]]] }, properties: { key: 'zone', group: 'g' } };
    const { controller, api, canvas } = await setup(null, [zone]);
    controller.chooseKeys(['zone']); api.post.mockClear();
    // inside, on screen (70, 30): far from every side of the triangle
    const inside = new PointerEvent('pointerdown', { button: 0, clientX: 80, clientY: 50, bubbles: true, cancelable: true });
    canvas.dispatchEvent(inside);
    expect(inside.defaultPrevented).toBe(false);
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 140, clientY: 50 }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 140, clientY: 50 })); flushSync();
    expect(controller.dragging).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
    // on its top edge, on screen (50, 0)
    api.post.mockResolvedValueOnce({ layer: { name: 'work' }, document: { features: [zone] }, kept: 0 });
    press(canvas, 60, 20);
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 70, clientY: 20 })); flushSync();
    expect(controller.dragging).toMatchObject({ keys: ['zone'], offset: [1, 0] });
    window.dispatchEvent(new PointerEvent('pointerup'));
    await controller.whenSaved();
    expect(api.post).toHaveBeenCalledWith('/api/cases/case/map-layers/work/selection', { keys: ['zone'], offset: [1, 0] });
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
    press(canvas, 30, 60); window.dispatchEvent(new PointerEvent('pointerup', { clientX: 30, clientY: 60 }));
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
    controller.chooseKeys(['a']);
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

  it('takes no position from the paste a middle click sends while turning the camera', async () => {
    const { controller } = await setup(null, []);
    window.dispatchEvent(new MouseEvent('mousedown', { button: 1 }));
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    paste.clipboardData = { getData: () => '48.85, 2.29' };
    window.dispatchEvent(paste); flushSync();
    window.dispatchEvent(new MouseEvent('mouseup', { button: 1 }));
    window.dispatchEvent(paste); flushSync();
    expect(controller.pasting).toBeFalsy();
  });

  it('shows the edit bar with the tools and its Done', async () => {
    await setup(null, []);
    const bar = document.querySelector('[role="toolbar"][aria-label="Layer tools"]');
    for (const name of ['Select', 'Select an area', 'Add markers', 'Draw line', 'Draw area', 'Paste a position', 'Add from the case']) {
      expect(bar.querySelector(`[aria-label="${name}"]`), name).not.toBeNull();
    }
    expect(bar.textContent).toContain('Done');
  });

  describe('what the map shows once a feature is let go', () => {
    const zone = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 0]]] }, properties: { key: 'zone', group: 'g' } };

    it('reshapes an area on a double click, and a click after it adds no corner', async () => {
      const { controller, canvas, callbacks } = await setup(null, [zone]);
      canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: 70, clientY: 40, bubbles: true, cancelable: true })); flushSync();
      expect(controller.sketch).toMatchObject({ key: 'zone', type: 'Polygon' });
      expect(document.querySelectorAll('.vertex')).toHaveLength(3);
      callbacks.get('click')({ lon: 50, lat: 50 }); flushSync();
      expect(document.querySelectorAll('.vertex')).toHaveLength(3);
      expect(controller.sketch.rings[0]).toEqual([[0, 0], [10, 0], [10, 10]]);
      // nor does hovering promise one: only a corner being dragged shows where it would land
      canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 12, clientY: 22, bubbles: true })); flushSync();
      expect(document.querySelector('.snap')).toBeNull();
    });

    it('stands where it landed while the move saves: copies, halo and grip, never at its old place', async () => {
      const { controller, api, canvas } = await setup(null, [point('a', 2, 4), point('b', 30, 30)]);
      let answer;
      api.post.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
      controller.chooseKeys(['a']);
      press(canvas, 30, 60);
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 40, clientY: 60 }));
      window.dispatchEvent(new PointerEvent('pointerup')); flushSync();
      expect(controller.features.find((one) => one.properties.key === 'a').geometry.coordinates).toEqual([3, 4]);
      expect(document.querySelector('.ghost-mark').style.left).toBe('30px');
      expect(document.querySelector('circle.halo').getAttribute('cx')).toBe('30');
      answer({ layer: { name: 'work' }, document: { features: [point('a', 3, 4), point('b', 30, 30)] }, kept: 0 });
      await controller.whenSaved(); flushSync();
      expect(document.querySelector('.ghost-mark')).toBeNull();
      expect(document.querySelector('circle.halo').getAttribute('cx')).toBe('30');
    });

    it('turns a marker the moment its knob is let go', async () => {
      const { controller, api } = await setup(null, [point('a', 2, 4)]);
      api.patch = vi.fn(() => new Promise(() => {}));
      controller.select('a'); flushSync();
      const knob = document.querySelector('.turn-knob');
      knob.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 30, clientY: 30, bubbles: true }));
      // this test map draws north down the screen, so east is to the left of the marker
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 0, clientY: 60 }));
      window.dispatchEvent(new PointerEvent('pointerup')); flushSync();
      expect(controller.features[0].properties.bearing).toBe(90);
      expect(document.querySelector('.turn-knob').getAttribute('aria-label')).toBe('Direction 90° E');
    });
  });
});

describe('layer geometry on the globe and while drawing', () => {
  /** The globe's canvas, which stands beside the flat map's box rather than in it. */
  function globe(engine) {
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    engine.onSurface = (target) => target === canvas;
    engine.readClicks = vi.fn();
    return canvas;
  }

  it('picks a feature pressed on the globe, and the click the globe hands on keeps it picked', async () => {
    const { controller, engine, callbacks } = await setup(null, [point('a', 2, 4)]);
    const sphere = globe(engine);
    press(sphere, 30, 60); window.dispatchEvent(new PointerEvent('pointerup', { clientX: 30, clientY: 60 }));
    expect(controller.selection).toEqual(['a']);
    // the globe relays its click to the flat map, where the tools hear it: not a click on bare ground
    callbacks.get('click')({ lon: 2, lat: 4 });
    expect(controller.selection).toEqual(['a']);
    // the next click on bare ground lets it go
    press(sphere, 600, 500); callbacks.get('click')({ lon: 59, lat: 48 });
    expect(controller.selection).toEqual([]);
  });

  it('stops a press on a picked feature before the globe turns under the drag', async () => {
    const { controller, engine } = await setup(null, [point('a', 2, 4)]);
    const sphere = globe(engine);
    controller.chooseKeys(['a']);
    let reached = false;
    sphere.addEventListener('pointerdown', () => { reached = true; });
    press(sphere, 30, 60);
    expect(reached).toBe(false);
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 40, clientY: 60 })); flushSync();
    expect(controller.dragging).toMatchObject({ keys: ['a'], offset: [1, 0] });
    window.dispatchEvent(new PointerEvent('pointercancel'));
  });

  it('has the globe read a double click as two clicks while a layer is edited, and gives the zoom back after', async () => {
    const { engine } = await setup(null);
    expect(engine.readClicks).toHaveBeenLastCalledWith(true);
    unmount(held); held = null;
    expect(engine.readClicks).toHaveBeenLastCalledWith(false);
  });

  it('opens a shape on a double click on the globe', async () => {
    const zone = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 0]]] }, properties: { key: 'zone', group: 'g' } };
    const { controller, engine } = await setup(null, [zone]);
    const sphere = globe(engine);
    sphere.dispatchEvent(new MouseEvent('dblclick', { clientX: 60, clientY: 20, bubbles: true }));
    expect(controller.sketch).toMatchObject({ key: 'zone', type: 'Polygon' });
  });

  it('draws the leg to the pointer and says the length a line would have', async () => {
    const { callbacks, canvas } = await setup('LineString');
    callbacks.get('click')({ lon: 0, lat: 0 }); callbacks.get('click')({ lon: 0, lat: 0.01 }); flushSync();
    // the pointer at (0.02, 0.01): a leg twice as long, east
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 10.2, clientY: 20.1, bubbles: true })); flushSync();
    expect(document.querySelector('.geometry path.pending')).not.toBeNull();
    expect(document.querySelector('.reading').textContent).toBe('3.34 km');
    // off the map, the leg goes and the length stays with the corners laid
    document.body.dispatchEvent(new PointerEvent('pointermove', { clientX: 900, clientY: 900, bubbles: true }));
    await new Promise((done) => requestAnimationFrame(done));
    document.body.dispatchEvent(new PointerEvent('pointermove', { clientX: 900, clientY: 900, bubbles: true })); flushSync();
    expect(document.querySelector('.geometry path.pending')).toBeNull();
    expect(document.querySelector('.reading').textContent).toBe('1.11 km');
  });

  it('copies a marker\'s point from its right-click menu, and hands it to the map\'s own menu', async () => {
    const onmenu = vi.fn();
    const { canvas } = await setup(null, [point('a', 2, 4, { name: 'Bridge' })], { onmenu });
    canvas.dispatchEvent(new MouseEvent('contextmenu', { clientX: 30, clientY: 60, bubbles: true, cancelable: true })); flushSync();
    const rows = [...document.querySelectorAll('.float-menu .fm-item')].map((row) => row.textContent.trim());
    expect(rows[0]).toBe('4.000000, 2.000000');
    [...document.querySelectorAll('.float-menu .fm-item')].find((row) => row.textContent.includes('More for this point')).click(); flushSync();
    expect(onmenu).toHaveBeenCalledWith({ lat: 4, lon: 2, x: 20, y: 40, feature: 'Bridge', layer: 'Working' });
    expect(document.querySelector('.float-menu')).toBeNull();
  });
});

/**
 * What keeps a long shape smooth to reshape, held as counts rather than frames
 * per second (2026-10-24): an area of many corners dragged corner by corner
 * lagged, since every step looked at every corner of the layer again.
 */
describe('a long shape reshaped', () => {
  let frames;
  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (run) => frames.push(run));
    vi.stubGlobal('cancelAnimationFrame', (id) => { frames[id - 1] = null; });
  });
  afterEach(() => vi.unstubAllGlobals());
  const nextFrame = () => { const due = frames; frames = []; due.forEach((run) => run?.()); };
  /** An area of `count` corners round (cx, cy) in degrees, which the test map draws ten pixels to the degree. */
  const round = (key, count, cx, cy, radius) => ({ type: 'Feature', properties: { key, group: 'g' }, geometry: { type: 'Polygon',
    coordinates: [[...Array.from({ length: count }, (_, i) => [cx + radius * Math.cos((2 * Math.PI * i) / count), cy + radius * Math.sin((2 * Math.PI * i) / count)]), [cx + radius, cy]]] } });

  it('looks at the layer\'s corners once for a drag, and the shape takes the corner once let go', async () => {
    const wall = { type: 'Feature', properties: { key: 'wall', group: 'g' },
      geometry: { type: 'LineString', coordinates: Array.from({ length: 2000 }, (_, i) => [i / 40, 50]) } };
    const { controller, engine } = await setup(null, [round('zone', 400, 30, 30, 10), wall]);
    controller.select('zone'); controller.editGeometry(); flushSync();
    const before = JSON.stringify(controller.sketch.rings);
    const real = engine.latLngToContainerPoint;
    engine.latLngToContainerPoint = vi.fn(real);
    const corner = document.querySelector('.vertex[aria-label="Move vertex 1.1"]');
    corner.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 410, clientY: 320, bubbles: true }));
    for (let step = 1; step <= 30; step++) {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 410 + step, clientY: 320 + step }));
      nextFrame(); flushSync();
    }
    // drawn where the pointer has it, the shape itself untouched while it moves
    expect(document.querySelector('.vertex[aria-label="Move vertex 1.1"]').style.left).toBe('430px');
    expect(JSON.stringify(controller.sketch.rings)).toBe(before);
    // the wall's 2000 corners looked at once, not at every one of the 30 steps
    expect(engine.latLngToContainerPoint.mock.calls.length).toBeLessThan(2000 + 30 * 4);
    window.dispatchEvent(new PointerEvent('pointerup')); flushSync();
    expect(controller.sketch.rings[0][0]).toEqual([43, 33]);
  });

  it('puts a "+" only on sides long enough to take one, and no handle far off the map', async () => {
    const { controller } = await setup(null, [round('dense', 400, 30, 30, 5), round('wide', 4, 30, 30, 20)]);
    controller.select('dense'); controller.editGeometry(); flushSync();
    // corners under a pixel apart: a "+" between them would hide them under a grey band
    expect(document.querySelectorAll('.vertex')).toHaveLength(400);
    expect(document.querySelectorAll('.midpoint')).toHaveLength(0);
    controller.stop(); controller.select('wide'); controller.editGeometry(); flushSync();
    expect(document.querySelectorAll('.midpoint')).toHaveLength(4);
    controller.stop();
    const long = { type: 'Feature', properties: { key: 'long', group: 'g' },
      geometry: { type: 'LineString', coordinates: Array.from({ length: 31 }, (_, i) => [-100 + i * 10, 30]) } };
    const { controller: other } = await setup(null, [long]);
    other.select('long'); other.editGeometry(); flushSync();
    // the map is 800 pixels wide: the corners from -1000 to 2000 beyond its edges are not drawn
    const drawn = [...document.querySelectorAll('.vertex')].map((node) => parseFloat(node.style.left));
    expect(drawn.length).toBeLessThan(31);
    expect(Math.min(...drawn)).toBeGreaterThanOrEqual(-40);
    expect(Math.max(...drawn)).toBeLessThanOrEqual(840);
  });
});

describe('a pin picked', () => {
  it('is ringed round its head, as its halo is, and its dragged copy is the size the map draws it', async () => {
    const { controller, canvas } = await setup(null, [point('p', 20, 20, { symbol: 'pin' })]);
    controller.select('p'); flushSync();
    const halo = document.querySelector('circle.halo'), ring = document.querySelector('.ring circle');
    // the tip on the point (200, 200), the head 12 pixels above it
    expect([halo.getAttribute('cx'), halo.getAttribute('cy')]).toEqual(['200', '188']);
    expect([ring.getAttribute('cx'), ring.getAttribute('cy'), ring.getAttribute('r')]).toEqual(['200', '188', '26']);
    press(canvas, 210, 210);
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 240, clientY: 210 })); flushSync();
    expect(document.querySelector('.ghost-mark svg').getAttribute('width')).toBe('25.6');
    window.dispatchEvent(new PointerEvent('pointercancel'));
  });
});
