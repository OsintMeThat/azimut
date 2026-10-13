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
  it('expands a long group explicitly and selects rows with Shift instead of checkboxes', () => {
    const features = Array.from({ length: 250 }, (_, index) => ({ properties: { key: `m${index}`, group: 'g1', name: `Point ${index}` }, geometry: { type: 'Point' } }));
    const toggleSelected = vi.fn();
    show(MyLayers, { controller: { editor: { title: 'Working' }, features, groups: [{ id: 'g1', name: 'Markers' }], toggleSelected } });
    expect(document.querySelectorAll('.features li')).toHaveLength(100);
    byText('Show 100 more (250)').click(); flushSync(); expect(document.querySelectorAll('.features li')).toHaveLength(200);
    byText('Show all 250').click(); flushSync(); expect(document.querySelectorAll('.features li')).toHaveLength(250);
    expect(document.querySelector('.features input[type="checkbox"]')).toBeNull();
    document.querySelector('[data-feature-key="m0"] .feature-row').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    expect(toggleSelected).toHaveBeenCalledWith('m0', features.toReversed().map((feature) => feature.properties.key), true);
  });
  it('drags selected features together into another group and cancels an outside drop', () => {
    const features = ['one', 'two'].map((key) => ({ properties: { key, name: key, group: 'first' }, geometry: { type: 'Point' } }));
    const reorderFeatures = vi.fn();
    show(MyLayers, { controller: { editor: { title: 'Working' }, features,
      groups: [{ id: 'first', name: 'First' }, { id: 'second', name: 'Second' }], selection: ['one', 'two'], reorderFeatures } });
    const transfer = { setData: vi.fn() };
    const drag = (name) => {
      const event = new MouseEvent(name, { bubbles: true });
      Object.defineProperty(event, 'dataTransfer', { value: transfer }); return event;
    };
    const handle = document.querySelector('[aria-label="Move one"]'), target = document.querySelector('[data-feature-group="second"] .group-head');
    handle.dispatchEvent(drag('dragstart')); target.dispatchEvent(drag('dragover')); target.dispatchEvent(drag('drop'));
    expect(reorderFeatures).toHaveBeenCalledExactlyOnceWith(['one', 'two'], 'second', null);
    handle.dispatchEvent(drag('dragstart')); target.dispatchEvent(drag('dragover')); document.body.dispatchEvent(drag('drop'));
    expect(reorderFeatures).toHaveBeenCalledOnce();
    expect(document.querySelector('[aria-label="Selected features group"]')).toBeTruthy();
  });
  it('reorders a focused feature with the keyboard without changing its geometry', () => {
    const features = ['one', 'two'].map((key) => ({ properties: { key, name: key, group: 'first' }, geometry: { type: 'LineString' } }));
    const reorderFeatures = vi.fn();
    show(MyLayers, { controller: { editor: { title: 'Working' }, features, groups: [{ id: 'first', name: 'First' }], reorderFeatures } });
    document.querySelector('[aria-label="Move one"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(reorderFeatures).toHaveBeenCalledWith(['one'], 'first', 'two');
  });
  it('saves layer details on Done and keeps an invalid name or refused save open', async () => {
    const updateDetails = vi.fn(async () => null), finish = vi.fn();
    show(MyLayers, { controller: { editor: { title: 'Working' }, features: [], updateDetails, finish } });
    document.querySelector('[aria-label="Edit layer details"]').click(); flushSync();
    const name = document.querySelector('[aria-label="Layer name"]'), description = document.querySelector('[aria-label="Layer description"]');
    name.value = ' '; name.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    expect(byText('Done').disabled).toBe(true);
    name.value = 'Renamed'; name.dispatchEvent(new Event('input', { bubbles: true }));
    description.value = 'Context'; description.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    document.body.click(); flushSync(); expect(document.querySelector('.layer-details')).toBeNull();
    byText('Done').click(); await Promise.resolve();
    expect(updateDetails).toHaveBeenCalledWith({ title: 'Renamed', description: 'Context' });
    expect(finish).not.toHaveBeenCalled();
    document.querySelector('[aria-label="Back from layer editor"]').click(); flushSync();
    expect(document.querySelector('[role="alertdialog"]')).toBeTruthy();
  });
  it('reorders groups from a native drop and cancels a drop outside the list', () => {
    const groups = [{ id: 'first', name: 'First' }, { id: 'second', name: 'Second' }];
    const reorderGroups = vi.fn();
    show(MyLayers, { controller: { editor: { title: 'Working' }, features: [], groups, reorderGroups } });
    const list = document.querySelector('.groups');
    vi.spyOn(list, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 300, top: 20, bottom: 140 });
    [...list.children].forEach((node, index) => vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({ top: 20 + index * 60, height: 60 }));
    const transfer = { setData: vi.fn() };
    const drag = (name, x, y) => {
      const event = new MouseEvent(name, { bubbles: true, clientX: x, clientY: y });
      Object.defineProperty(event, 'dataTransfer', { value: transfer }); return event;
    };
    document.querySelector('[aria-label="Move group Second"]').dispatchEvent(drag('dragstart', 0, 0));
    window.dispatchEvent(drag('dragover', 150, 22)); window.dispatchEvent(drag('drop', 150, 22));
    expect(reorderGroups).toHaveBeenCalledExactlyOnceWith(['second', 'first']);
    document.querySelector('[aria-label="Move group First"]').dispatchEvent(drag('dragstart', 0, 0));
    window.dispatchEvent(drag('dragover', 500, 22)); window.dispatchEvent(drag('drop', 500, 22));
    expect(reorderGroups).toHaveBeenCalledOnce();
  });
  it('sizes groups with a slider and reorders them from their grips', async () => {
    const groups = [{ id: 'first', name: 'First', mode: 'uniform', colour: '#0072b2', symbol: 'pin', size: 1 },
      { id: 'second', name: 'Second', mode: 'individual', colour: '#0072b2', symbol: 'pin', size: 1 }];
    const updateGroup = vi.fn(), reorderGroups = vi.fn();
    show(MyLayers, { controller: { editor: { title: 'Working' }, features: [], groups, updateGroup, reorderGroups } });
    document.querySelector('[aria-label="Edit group Second"]').click(); flushSync();
    const range = document.querySelector('[aria-label="Icon size for Second"]');
    expect(range.type).toBe('range'); range.value = '2.25';
    range.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    expect(document.querySelector('output').textContent).toBe('225%');
    range.dispatchEvent(new Event('change', { bubbles: true }));
    expect(updateGroup).toHaveBeenCalledWith('second', { size: 2.25 });
    document.querySelector('[aria-label="Move group Second"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(reorderGroups).toHaveBeenCalledWith(['second', 'first']);
  });

  it('asks before discarding saved layer edits or an unsaved feature form', async () => {
    const point = { properties: { key: 'm1', name: 'Original' }, geometry: { type: 'Point' } };
    const finish = vi.fn(async () => true), ondone = vi.fn();
    show(MyLayers, { ondone, controller: { editor: { title: 'Working' }, features: [point], selected: point, finish } });
    const name = document.querySelector('[aria-label="Selected marker name"]'); name.value = 'Unsaved name';
    name.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    document.querySelector('[aria-label="Back from layer editor"]').click(); flushSync();
    expect(document.querySelector('[role="alertdialog"]').getAttribute('aria-label')).toBe('Discard changes?');
    expect(finish).not.toHaveBeenCalled();
    byText('Cancel').click(); flushSync(); expect(name.value).toBe('Unsaved name');
    document.querySelector('[aria-label="Back from layer editor"]').click(); flushSync();
    byText('Discard changes').click(); await Promise.resolve(); await Promise.resolve(); flushSync();
    expect(finish).toHaveBeenCalledWith(true); expect(ondone).toHaveBeenCalledOnce();
  });

  it('commits an unsaved feature form on Done and stays open after a refused save', async () => {
    const point = { properties: { key: 'm1', name: 'Original' }, geometry: { type: 'Point' } };
    const update = vi.fn(async () => null), finish = vi.fn(async () => true);
    show(MyLayers, { controller: { editor: { title: 'Working' }, features: [point], selected: point, update, finish } });
    const input = document.querySelector('[aria-label="Selected marker name"]'); input.value = 'Changed';
    input.dispatchEvent(new Event('input', { bubbles: true })); flushSync(); byText('Done').click(); await Promise.resolve();
    expect(update).toHaveBeenCalledWith('m1', { name: 'Changed' });
    expect(finish).not.toHaveBeenCalled();
  });
  it('lists only editable layers and offers creation without a new tab', () => {
    const onnew = vi.fn();
    show(MyLayers, { rows: [{ title: 'Source map', name: 'source' },
      { title: 'Working map', name: 'working', editable: true, categories: [], features: 0 }], controller: {}, onnew });
    expect(document.body.textContent).toContain('My layers');
    expect(document.body.textContent).toContain('Working map');
    expect(document.body.textContent).not.toContain('Source map');
    byText('New layer').click();
    expect(onnew).toHaveBeenCalledOnce();
  });

  it('shows marker defaults and explains their destination while adding', () => {
    show(MyLayers, { rows: [], controller: { editor: { title: 'Working map' }, placing: true,
      draft: { name: '', colour: '#0072b2', symbol: 'pin' }, features: [], pending: 0 } });
    expect(document.body.textContent).toContain('Click to add markers; Esc to stop.');
    expect(document.body.textContent).toContain('Markers stay in this layer until saved as case places.');
    expect(document.querySelector('[aria-label="New marker icons"]')).toBeTruthy();
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
    expect(document.body.textContent).toContain('Saved as case place');
    expect(byText('Save as case place')).toBeUndefined();
    expect(byText('Delete case place')).toBeTruthy();
  });

  it('edits an imported line without offering a point symbol or place promotion', () => {
    const line = { properties: { key: 'line', name: 'Road' }, geometry: { type: 'LineString' } };
    show(MyLayers, { controller: { editor: { title: 'Working map' }, selected: line,
      features: [line], pending: 0 } });
    expect(document.querySelector('[aria-label="Selected marker icons"]')).toBeNull();
    expect(byText('Save as case place')).toBeUndefined();
    expect(byText('Save changes')).toBeTruthy();
  });

  it('renames an imported pictogram without silently replacing its style', () => {
    const marker = { properties: { key: 'm1', name: 'Gate', colour: '', icon: 'source-icon' },
      geometry: { type: 'Point' } };
    const update = vi.fn();
    show(MyLayers, { controller: { editor: { title: 'Working map' }, selected: marker,
      features: [marker], pending: 0, update } });
    const input = document.querySelector('[aria-label="Selected marker name"]');
    input.value = 'Reviewed gate';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    byText('Save changes').click();
    expect(update).toHaveBeenCalledWith('m1', { name: 'Reviewed gate' });
  });

  it('keeps the editor open while clicks are still being saved', () => {
    show(MyLayers, { controller: { editor: { title: 'Working map' }, features: [], pending: 2 } });
    expect(byText('Done').disabled).toBe(true);
    expect(document.querySelector('[role="status"]').textContent).toBe('Saving 2…');
  });

  it('uses the shared collapsible layer rows with edit, trash and keyboard restacking', async () => {
    const onedit = vi.fn(), onremove = vi.fn(), onreorder = vi.fn();
    const rows = ['First', 'Second'].map((title) => ({ title, name: title.toLowerCase(),
      editable: true, enabled: true, features: 0, categories: [] }));
    show(MyLayers, { rows, controller: {}, onedit, onremove, onreorder });
    document.querySelector('[aria-label="Edit First"]').click();
    document.querySelector('[aria-label="Remove Second"]').click();
    expect(onedit).toHaveBeenCalledWith(expect.objectContaining({ name: 'first' }));
    expect(onremove).toHaveBeenCalledWith(expect.objectContaining({ name: 'second' }));
    document.querySelector('[aria-label="Move Second"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(onreorder).toHaveBeenCalledWith(['second', 'first']);
    byText('My layers 2').click();
    flushSync();
    expect(document.querySelector('[aria-label="Edit First"]')).toBeNull();
  });

  it('keeps individual controls out of a uniformly styled group and offers moving the feature', () => {
    const point = { properties: { key: 'm1', group: 'g1', name: 'Gate' }, geometry: { type: 'Point' } };
    const groups = [{ id: 'g1', name: 'Checked', colour: '#009e73', symbol: 'star', mode: 'uniform' },
      { id: 'g2', name: 'Other', colour: '#0072b2', symbol: 'pin', mode: 'individual' }];
    show(MyLayers, { controller: { editor: { title: 'Working map' }, selected: point,
      features: [point], groups, group: 'g1', pending: 0 } });
    expect(document.body.textContent).toContain('Uses the style of Checked.');
    expect(document.querySelector('[aria-label="Selected marker icons"]')).toBeNull();
    expect(document.querySelector('[aria-label="Selected marker group"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="Remove from this layer"]')).toBeTruthy();
  });

  it('adds several existing case places to the active group without listing existing members', () => {
    const addPlaces = vi.fn(async () => ({}));
    show(MyLayers, { places: [{ id: 'e1', title: 'Already here' }, { id: 'e2', title: 'Gate' }, { id: 'e3', title: 'Dock' }],
      controller: { editor: { title: 'Working map' }, features: [{ properties: { place_id: 'e1' } }],
        groups: [], pending: 0, stop: vi.fn(), addPlaces } });
    byText('Add case places').click(); flushSync();
    expect(document.querySelector('.place-options').textContent).not.toContain('Already here');
    document.querySelector('input[type="checkbox"]').click(); flushSync();
    byText('Select shown').click(); flushSync();
    byText('Add selected (2)').click();
    expect(addPlaces).toHaveBeenCalledWith(['e2', 'e3']);
  });

  it('opens a large imported group list folded and lets its groups be unfolded', () => {
    const groups = Array.from({ length: 8 }, (_, index) => ({ id: `g${index}`, name: `Group ${index}`,
      colour: '#0072b2', symbol: 'pin', mode: 'individual' }));
    show(MyLayers, { controller: { editor: { title: 'Imported map', name: 'imported' },
      groups, features: [], pending: 0 } });
    const heads = [...document.querySelectorAll('.group-title')];
    expect(heads.map((head) => head.getAttribute('aria-expanded'))).toEqual(['true', ...Array(7).fill('false')]);
    heads[1].click(); flushSync();
    expect(heads[1].getAttribute('aria-expanded')).toBe('true');
  });

  it('closes group settings, the case picker and the new-group form on outside clicks', () => {
    const ondone = vi.fn();
    show(MyLayers, { controller: { editor: { name: 'working', title: 'Working map' },
      groups: [{ id: 'g1', name: 'Markers', mode: 'uniform', colour: '#0072b2', symbol: 'pin' }],
      features: [], pending: 0, stop: vi.fn() }, ondone });
    document.querySelector('[aria-label="Edit group Markers"]').click(); flushSync();
    const name = document.querySelector('[aria-label="Group name"]');
    name.click(); flushSync();
    expect(document.querySelector('.group-settings')).toBeTruthy();
    document.body.click(); flushSync();
    expect(document.querySelector('.group-settings')).toBeNull();
    byText('Add case places').click(); flushSync();
    document.querySelector('[aria-label="Find case places"]').click(); flushSync();
    expect(document.querySelector('.place-picker')).toBeTruthy();
    document.body.click(); flushSync();
    expect(document.querySelector('.place-picker')).toBeNull();
    byText('New group').click(); flushSync();
    document.body.click(); flushSync();
    expect(document.querySelector('.new-group')).toBeNull();
    byText('Done').click();
    expect(ondone).toHaveBeenCalledOnce();
  });
});

describe('new layer', () => {
  it('creates a blank layer from the visible actions', () => {
    const oncreate = vi.fn();
    show(NewLayerDialog, { oncreate, onclose: vi.fn() });
    byText('Create layer').click();
    expect(oncreate).toHaveBeenCalledWith('My layer', null, '');
    expect(byText('From a file')).toBeTruthy();
  });

  it('creates a layer with an optional description', () => {
    const oncreate = vi.fn();
    show(NewLayerDialog, { oncreate, onclose: vi.fn() });
    const description = document.querySelector('textarea'); description.value = 'Layer context';
    description.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    byText('Create layer').click(); expect(oncreate).toHaveBeenCalledWith('My layer', null, 'Layer context');
  });

  it('requires a file when starting from a file', () => {
    show(NewLayerDialog, { onclose: vi.fn() });
    byText('From a file').click();
    flushSync();
    expect(byText('Create layer').disabled).toBe(true);
    expect(document.body.textContent).toContain('Keeps the original file and its bundled icons.');
  });
});
