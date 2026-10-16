// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import LayerEditBar from './LayerEditBar.svelte';
import LayerGeometry from './LayerGeometry.svelte';

vi.mock('../../lib/api.js', () => ({ api: { get: vi.fn(async () => ({ colours: [] })), put: vi.fn() } }));

let held;
beforeEach(() => localStorage.clear());
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; });
const show = (component, props) => { held = mount(component, { target: document.body, props }); flushSync(); };
const groups = [{ id: 'g', name: 'Markers', mode: 'individual', colour: '#0072b2', symbol: 'pin' },
  { id: 'one', name: 'Checkpoints', mode: 'uniform', colour: '#009e73', symbol: 'star' }];
const point = (key, properties = {}, coordinates = [0.1, 0.1]) => ({ type: 'Feature', geometry: { type: 'Point', coordinates },
  properties: { key, name: key, group: 'g', symbol: 'badge-tank', ...properties } });
function editor(extra = {}) {
  return { editor: { title: 'Working map', caseId: 'case' }, features: [], groups, group: 'g', selection: [], selected: null,
    draft: { colour: '#0072b2', symbol: 'pin' }, pending: 0, loading: false, placing: false, lassoing: false, sketch: null,
    updateSelection: vi.fn(async () => ({})), updateGroup: vi.fn(async () => ({})), aim: vi.fn(async () => ({})),
    editGeometry: vi.fn(), chooseKeys: vi.fn(), removeSelection: vi.fn(), select: vi.fn(), stop: vi.fn(), addPoint: vi.fn(() => false), ...extra };
}
const button = (label) => document.querySelector(`[aria-label="${label}"]`);

describe('the layer edit bar', () => {
  it('draws circles and boxes, takes edits back and forth, and never greys out while saving', () => {
    const controller = editor({ pending: 3, canUndo: true, canRedo: false, startShape: vi.fn(), undo: vi.fn(), redo: vi.fn() });
    show(LayerEditBar, { controller, ondone: vi.fn() });
    expect(button('Add markers').disabled).toBe(false);
    button('Draw a circle').click();
    button('Draw a box').click();
    expect(controller.startShape.mock.calls).toEqual([['Circle'], ['Rectangle']]);
    button('Undo the last edit').click();
    expect(controller.undo).toHaveBeenCalledOnce();
    expect(button('Redo the last edit').disabled).toBe(true);
  });

  it('extends a line being reshaped from either end, and draws freehand while a new one is drawn', () => {
    const extendFrom = vi.fn();
    const reshaping = editor({ sketch: { type: 'LineString', key: 'l1', rings: [[[0, 0], [1, 1]]] }, extendFrom, complete: true });
    show(LayerEditBar, { controller: reshaping, ondone: vi.fn() });
    button('Extend from its start').click();
    expect(extendFrom).toHaveBeenCalledWith('start');
    unmount(held); held = null; document.body.innerHTML = '';
    const drawing = editor({ sketch: { type: 'LineString', key: null, rings: [[]] }, freehand: false });
    show(LayerEditBar, { controller: drawing, ondone: vi.fn() });
    button('Draw freehand').click();
    expect(drawing.freehand).toBe(true);
  });

  it('styles the next markers, and the group they go into, when nothing is selected', () => {
    const controller = editor();
    show(LayerEditBar, { controller, ondone: vi.fn() });
    button('Style').click(); flushSync();
    button('Style orange').click();
    expect(controller.draft.colour).toBe('#d55e00');
    button('Style Vessel icon').click();
    expect(controller.draft.symbol).toBe('badge-ship');
    const into = button('Style group');
    expect(into.closest('label').textContent).toContain('Add to');
    into.value = 'one'; into.dispatchEvent(new Event('change', { bubbles: true }));
    expect(controller.group).toBe('one');
    expect(controller.updateSelection).not.toHaveBeenCalled();
  });

  it('restyles the selection, and a one-style group as a whole', () => {
    const controller = editor({ features: [point('a'), point('b', { group: 'one' })], selection: ['a'] });
    show(LayerEditBar, { controller, ondone: vi.fn() });
    button('Style').click(); flushSync();
    button('Style Vessel icon').click();
    expect(controller.updateSelection).toHaveBeenCalledWith({ symbol: 'badge-ship' });
    unmount(held); document.body.innerHTML = '';
    const grouped = editor({ features: [point('b', { group: 'one' })], selection: ['b'] });
    show(LayerEditBar, { controller: grouped, ondone: vi.fn() });
    button('Style').click(); flushSync();
    button('Style green').click();
    expect(grouped.updateGroup).toHaveBeenCalledWith('one', { colour: '#009e73' });
    expect(grouped.updateSelection).not.toHaveBeenCalled();
  });

  it('offers Reshape for one line or area of its own, never for a marker or a followed item', () => {
    const line = { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { key: 'l', group: 'g' } };
    const controller = editor({ features: [line, point('p')], selection: ['l'] });
    show(LayerEditBar, { controller, ondone: vi.fn() });
    button('Reshape').click();
    expect(controller.editGeometry).toHaveBeenCalledOnce();
    unmount(held); document.body.innerHTML = '';
    show(LayerEditBar, { controller: editor({ features: [point('p')], selection: ['p'] }), ondone: vi.fn() });
    expect(button('Reshape')).toBeNull();
    unmount(held); document.body.innerHTML = '';
    show(LayerEditBar, { controller: editor({ features: [{ ...line, properties: { ...line.properties, entity_id: 'e' } }], selection: ['l'] }), ondone: vi.fn() });
    expect(button('Reshape')).toBeNull();
  });

  it('hides its tips on request and remembers it, and puts itself back on a double-click of its grip', () => {
    localStorage.setItem('azimut:layer-bar', JSON.stringify({ edge: 'left', x: 0, y: 0.4 }));
    show(LayerEditBar, { controller: editor(), ondone: vi.fn() });
    expect(button('Layer tools').getAttribute('aria-orientation')).toBe('vertical');
    expect(document.querySelector('.hint').textContent).toContain('Right-click for more');
    button('Tips').click(); flushSync();
    expect(document.querySelector('.hint')).toBeNull();
    expect(localStorage.getItem('azimut:layer-bar-tips')).toBe('off');
    button('Move the tool bar').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); flushSync();
    expect(button('Layer tools').getAttribute('aria-orientation')).toBe('horizontal');
    expect(JSON.parse(localStorage.getItem('azimut:layer-bar'))).toEqual({ edge: 'top', x: 0.5, y: 0 });
  });
});

/** A flat map, a thousandth of a degree a pixel, north up, its canvas filling a div. */
function fakeMap() {
  const container = document.createElement('div');
  container.append(document.createElement('canvas'));
  document.body.append(container);
  return {
    container,
    latLngToContainerPoint: ({ lat, lon }) => ({ x: lon * 1000, y: 1000 - lat * 1000 }),
    containerPointToLatLng: ({ x, y }) => ({ lon: x / 1000, lat: (1000 - y) / 1000 }),
    on: () => () => {},
  };
}

describe('the map while a layer is edited', () => {
  it('turns the one selected marker toward the pointer and saves the direction on release', async () => {
    const engine = fakeMap();
    const marker = point('a', { bearing: 0 });
    const controller = editor({ features: [marker], selection: ['a'], selected: marker });
    show(LayerGeometry, { engine, controller, bar: false });
    const knob = document.querySelector('.turn-knob');
    expect(knob.getAttribute('aria-label')).toBe('Direction 0° N');
    knob.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    // the marker is at (100, 900): a pointer to its right is east, a hair under it rounds to the step
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 300, clientY: 908 })); flushSync();
    expect(document.querySelector('.turn-label').textContent).toBe('90° E');
    window.dispatchEvent(new PointerEvent('pointerup', {})); flushSync();
    expect(controller.aim).toHaveBeenCalledExactlyOnceWith('a', 90);
    // once let go the knob reads the layer, which turns the marker at once (`aim`); this stand-in keeps 0°
    expect(document.querySelector('.turn-label')).toBeNull();
    expect(document.querySelector('.turn-knob').getAttribute('aria-label')).toBe('Direction 0° N');
    knob.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(controller.aim).toHaveBeenLastCalledWith('a', null);
    knob.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, shiftKey: true }));
    expect(controller.aim).toHaveBeenLastCalledWith('a', 15);
  });

  it('shows no ring for several features or for a line', () => {
    const engine = fakeMap();
    show(LayerGeometry, { engine, controller: editor({ features: [point('a'), point('b')], selection: ['a', 'b'] }), bar: false });
    expect(document.querySelector('.turn-knob')).toBeNull();
  });

  it('opens the feature menu on a right-click on a feature, and leaves bare ground to the map', () => {
    const engine = fakeMap();
    const controller = editor({ features: [point('a', { bearing: 45 })] });
    show(LayerGeometry, { engine, controller, bar: false });
    const canvas = engine.container.querySelector('canvas');
    const bare = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 600, clientY: 300 });
    canvas.dispatchEvent(bare); flushSync();
    expect(bare.defaultPrevented).toBe(false);
    expect(document.querySelector('[aria-label="Feature actions"]')).toBeNull();
    const onFeature = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 102, clientY: 899 });
    canvas.dispatchEvent(onFeature); flushSync();
    expect(onFeature.defaultPrevented).toBe(true);
    expect(controller.chooseKeys).toHaveBeenCalledWith(['a']);
  });
});

describe('what the bar dates an edit to', () => {
  const tracked = (extra) => editor({ editor: { title: 'Working map', caseId: 'case', track: { on: true } }, timeMode: 'new', changeOn: vi.fn(), ...extra });
  const pressed = (label) => button(label).getAttribute('aria-pressed') === 'true';

  it('greys out Reshape on a line a date holds, and says why', () => {
    const line = { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { key: 'l', name: 'Front', group: 'g' } };
    show(LayerEditBar, { controller: tracked({ cursor: null, features: [line], selection: ['l'], dateHolds: () => '2026-10-08' }), ondone: vi.fn() });
    expect(button('Reshape').disabled).toBe(true);
    expect(button('Reshape').title).toBe('Moved on 8 Oct 2026: pick a day to reshape it');
  });

  it('says nothing of time on a layer not followed over time', () => {
    show(LayerEditBar, { controller: editor({ cursor: null }), ondone: vi.fn() });
    expect(document.querySelector('[aria-label="What your edits are dated to"]')).toBeNull();
  });

  it('carries no date at now, and a day picked dates the edits from it', () => {
    const controller = tracked({ cursor: null });
    show(LayerEditBar, { controller, ondone: vi.fn() });
    expect(pressed('No date')).toBe(true);
    expect(pressed('Date your edits from a day')).toBe(false);
    // only the mode on says itself in words
    expect(button('Date your edits from a day').textContent.trim()).toBe('');
    expect(button('No date').textContent.trim()).toBe('No date');
    button('Date your edits from a day').click(); flushSync();
    const day = document.querySelector('.float-menu button.day:not(:disabled):not(.out)');
    day.click(); flushSync();
    expect(controller.changeOn).toHaveBeenCalledWith(day.title);
    expect(document.querySelector('.float-menu')).toBeNull();
  });

  it('dates from the day shown until no date is chosen, and back again in one press', () => {
    const controller = tracked({ cursor: '2026-10-12' });
    show(LayerEditBar, { controller, ondone: vi.fn() });
    expect(pressed('From 12 Oct 2026')).toBe(true);
    expect(button('From 12 Oct 2026').textContent.trim()).toBe('From 12 Oct');
    expect(button('No date').textContent.trim()).toBe('');
    button('No date').click();
    expect(controller.timeMode).toBe('fix');
    unmount(held); document.body.innerHTML = '';
    const fixing = tracked({ cursor: '2026-10-12', timeMode: 'fix' });
    show(LayerEditBar, { controller: fixing, ondone: vi.fn() });
    expect(pressed('No date')).toBe(true);
    button('From 12 Oct 2026').click(); flushSync();
    // dating again takes one press, with no calendar in the way
    expect(fixing.timeMode).toBe('new');
    expect(document.querySelector('.float-menu')).toBeNull();
  });
});
