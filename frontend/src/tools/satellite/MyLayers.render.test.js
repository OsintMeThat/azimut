// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import MyLayers from './MyLayers.svelte';
import LayerFeatureSheet from './LayerFeatureSheet.svelte';
import NewLayerDialog from './NewLayerDialog.svelte';
import { createMyLayersState } from './state/myLayers.svelte.js';
import { shortMoment } from '../../lib/map/layerHistory.js';

// the case palette is read from the server; here, a case that names no colours
vi.mock('../../lib/api.js', () => ({ api: { get: vi.fn(async () => ({ colours: [] })), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() } }));
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let held;
const byText = (label) => [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === label);
function show(component, props) {
  held = mount(component, { target: document.body, props });
  flushSync();
}
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; });
const ROW = { name: 'work', title: 'Working', editable: true, edit_revision: 'r'.repeat(64) };
/** A real editor over a mocked API, for the flows that save. */
async function editing({ features = [], refuse = null } = {}) {
  const groups = [{ id: 'g', name: 'Markers', mode: 'individual', colour: '#0072b2', symbol: 'pin', size: 1 }];
  // A marker's edit answers with the marker as saved, as the server does.
  const api = {
    post: vi.fn(async (path) => path.endsWith('/edit') ? { layer: ROW, document: { features }, groups, checkpoint: 'c'.repeat(32) } : { layer: ROW }),
    patch: vi.fn(async (path, body) => {
      if (refuse && path.endsWith(refuse)) throw new Error('Refused');
      const key = path.match(/\/markers\/([^/]+)$/)?.[1];
      const at = features.findIndex((feature) => feature.properties.key === key);
      if (at < 0) return { layer: ROW, document: { features } };
      const properties = { ...features[at].properties, ...body };
      for (const [field, value] of Object.entries(body)) if (value === null) delete properties[field];
      features[at] = { ...features[at], properties };
      return { layer: ROW, marker: features[at] };
    }),
    get: vi.fn(),
  };
  const controller = createMyLayersState({ api, layers: { rows: [], edited: vi.fn() }, caseId: () => 'case', notify: vi.fn(), reloadCase: vi.fn() });
  await controller.open(ROW);
  return { controller, api };
}
const finished = (api) => api.post.mock.calls.some(([path]) => path.endsWith('/edit/finish'));
/** A stand-in editor with one feature selected, its sheet filled as the real one fills it. */
function picked(feature, extra = {}) {
  const props = feature.properties;
  return { editor: { title: 'Working map' }, features: [feature], selected: feature, selection: [props.key], pending: 0,
    form: { name: props.name ?? '', description: '', colour: props.colour || '#0072b2', symbol: props.symbol || 'pin', group: props.group ?? '',
      date: '', status: '', bearing: props.bearing ?? '', links: [], provenance: '' }, ...extra };
}
const type = (node, value) => { node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })); flushSync(); };
const leave = (node) => { node.dispatchEvent(new Event('change', { bubbles: true })); flushSync(); };
/** Open the sheet's Look rows, which stay as the last sheet left them. */
function openLook() {
  const look = document.querySelector('button.look');
  if (look?.getAttribute('aria-expanded') === 'false') { look.click(); flushSync(); }
}
const menuItem = (label) => [...document.querySelectorAll('.float-menu .fm-item')].find((node) => node.textContent.trim() === label);

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
    // two selected: one sheet for both
    expect(document.querySelector('[aria-label="Selected features"]').textContent).toContain('2 selected');
    expect(document.querySelector('[aria-label="Feature group"]')).toBeTruthy();
  });
  it('reorders a focused feature with the keyboard without changing its geometry', () => {
    const features = ['one', 'two'].map((key) => ({ properties: { key, name: key, group: 'first' }, geometry: { type: 'LineString' } }));
    const reorderFeatures = vi.fn();
    show(MyLayers, { controller: { editor: { title: 'Working' }, features, groups: [{ id: 'first', name: 'First' }], reorderFeatures } });
    document.querySelector('[aria-label="Move one"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(reorderFeatures).toHaveBeenCalledWith(['one'], 'first', 'two');
  });
  it('renames the layer in its header, describes it from its menu, and stays open after a refused save', async () => {
    const { controller, api } = await editing({ refuse: '/edit' });
    show(MyLayers, { controller });
    const name = document.querySelector('[aria-label="Layer name"]');
    expect(name.value).toBe('Working');
    expect(document.querySelector('[aria-label="Layer description"]')).toBeNull();
    type(name, ' ');
    expect(byText('Done').disabled).toBe(true);
    // an empty name is not saved: leaving the field puts the name back
    leave(name); expect(name.value).toBe('Working'); expect(api.patch).not.toHaveBeenCalled();
    type(name, 'Renamed');
    document.querySelector('[aria-label="Layer actions"]').click(); flushSync();
    menuItem('Add a description').click(); flushSync();
    type(document.querySelector('[aria-label="Layer description"]'), 'Context');
    byText('Done').click(); await controller.whenSaved(); await Promise.resolve();
    expect(api.patch).toHaveBeenCalledWith('/api/cases/case/map-layers/work/edit', { title: 'Renamed', description: 'Context' });
    expect(finished(api)).toBe(false);
    document.querySelector('[aria-label="Layer actions"]').click(); flushSync();
    menuItem('Discard changes…').click(); flushSync();
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
    document.querySelector('[aria-label="Settings of group Second"]').click(); flushSync();
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
    const point = { type: 'Feature', properties: { key: 'm1', name: 'Original', group: 'g' }, geometry: { type: 'Point', coordinates: [2, 48] } };
    const { controller, api } = await editing({ features: [point] });
    const ondone = vi.fn();
    controller.select('m1');
    show(MyLayers, { ondone, controller });
    const name = document.querySelector('[aria-label="Feature name"]');
    type(name, 'Unsaved name');
    const discard = () => { document.querySelector('[aria-label="Layer actions"]').click(); flushSync(); menuItem('Discard changes…').click(); flushSync(); };
    discard();
    expect(document.querySelector('[role="alertdialog"]').getAttribute('aria-label')).toBe('Discard changes?');
    expect(finished(api)).toBe(false);
    byText('Cancel').click(); flushSync(); expect(name.value).toBe('Unsaved name');
    discard();
    byText('Discard changes').click(); await controller.whenSaved(); await settle(); flushSync();
    expect(api.post).toHaveBeenCalledWith('/api/cases/case/map-layers/work/edit/finish', expect.objectContaining({ discard: true }));
    expect(ondone).toHaveBeenCalledOnce();
  });

  it('commits an unsaved feature form on Done and stays open after a refused save', async () => {
    const point = { type: 'Feature', properties: { key: 'm1', name: 'Original', group: 'g' }, geometry: { type: 'Point', coordinates: [2, 48] } };
    const { controller, api } = await editing({ features: [point], refuse: '/markers/m1' });
    controller.select('m1');
    show(MyLayers, { controller });
    type(document.querySelector('[aria-label="Feature name"]'), 'Changed');
    byText('Done').click(); await controller.whenSaved(); await Promise.resolve();
    expect(api.patch).toHaveBeenCalledWith('/api/cases/case/map-layers/work/markers/m1', { name: 'Changed' });
    expect(finished(api)).toBe(false);
  });

  it('saves the status, the sources and who geolocated it as each is set, and clears a direction', async () => {
    const point = { type: 'Feature', properties: { key: 'm1', name: 'Depot', group: 'g', symbol: 'badge-tank', bearing: 90 }, geometry: { type: 'Point', coordinates: [2, 48] } };
    const { controller, api } = await editing({ features: [point] });
    controller.select('m1');
    show(MyLayers, { controller });
    const path = '/api/cases/case/map-layers/work/markers/m1';
    byText('Destroyed').click(); await controller.whenSaved(); flushSync();
    // a status is the day shown's: it goes for what is picked, never from the sheet's form
    expect(api.post).toHaveBeenLastCalledWith('/api/cases/case/map-layers/work/selection', { keys: ['m1'], changes: { status: 'destroyed' } });
    // the direction is set on the map; the sheet says it and clears it
    expect(document.querySelector('[aria-label="Feature"]').textContent).toContain('90° E');
    document.querySelector('[aria-label="Clear the direction"]').click(); await controller.whenSaved(); flushSync();
    expect(api.patch).toHaveBeenLastCalledWith(path, { bearing: null });
    expect(document.querySelector('[aria-label="Feature"]').textContent).toContain('Turn the ring on the map');
    document.querySelector('[aria-label="Add a source"]').click(); flushSync();
    const source = document.querySelector('[aria-label="New source"]');
    type(source, 'x.com/a/1');
    source.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); flushSync();
    expect(document.querySelector('[role="alert"]').textContent).toBe('Start the address with http:// or https://');
    type(source, 'https://x.com/a/1');
    source.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await controller.whenSaved(); flushSync();
    expect(api.patch).toHaveBeenLastCalledWith(path, { links: ['https://x.com/a/1'] });
    expect(document.querySelector('.chip a').textContent).toBe('x.com');
    byText('Others').click(); await controller.whenSaved(); flushSync();
    expect(api.patch).toHaveBeenLastCalledWith(path, { provenance: 'external' });
    expect(api.patch).toHaveBeenCalledTimes(3);
    expect(byText('Save changes')).toBeUndefined();
  });

  it('changes several selected features together and says where they differ', () => {
    const features = [{ properties: { key: 'a', name: 'A', group: 'g', date: '2026-03-01', status: 'damaged' }, geometry: { type: 'Point' } },
      { properties: { key: 'b', name: 'B', group: 'g', date: '2026-03-02', status: 'damaged' }, geometry: { type: 'Point' } }];
    const updateSelection = vi.fn(), setStatus = vi.fn();
    show(MyLayers, { controller: { editor: { title: 'Working map' }, features, groups: [{ id: 'g', name: 'Markers' }],
      selection: ['a', 'b'], pending: 0, updateSelection, setStatus } });
    const sheet = document.querySelector('[aria-label="Selected features"]');
    expect(sheet.querySelector('[aria-pressed="true"]').textContent).toBe('Damaged');
    expect(sheet.textContent).toContain('Several days');
    // nothing said is the first choice, not "Intact": most markers are no building
    expect(byText('Intact')).toBeUndefined();
    sheet.querySelector('[aria-label="No damage said, drawn plain"]').click();
    expect(setStatus).toHaveBeenCalledWith('');
    byText('Others').click();
    expect(updateSelection).toHaveBeenCalledWith({ provenance: 'external' });
  });

  it('finds features by name and opens the groups that hold them', async () => {
    const features = ['Depot', 'Bridge', 'Depot west'].map((name, index) => ({ type: 'Feature',
      properties: { key: `k${index}`, name, group: 'g' }, geometry: { type: 'Point', coordinates: [2, 48] } }));
    const { controller } = await editing({ features });
    show(MyLayers, { controller });
    const find = document.querySelector('[aria-label="Find in this layer"]'); find.value = 'depot';
    find.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    expect([...document.querySelectorAll('.features .name')].map((node) => node.textContent)).toEqual(['Depot west', 'Depot']);
    expect(document.body.textContent).toContain('2 found');
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

  it('offers place promotion for a selected point from its menu', () => {
    const marker = { properties: { key: 'm1', name: 'Gate' }, geometry: { type: 'Point', coordinates: [2, 48] } };
    const promote = vi.fn();
    show(MyLayers, { controller: picked(marker, { promote }) });
    document.querySelector('[aria-label="Feature actions"]').click(); flushSync();
    menuItem('Save as case place').click(); flushSync();
    expect(promote).toHaveBeenCalledWith('m1');
    expect(document.querySelector('[aria-label="Feature actions"][aria-expanded="true"]')).toBeNull();
  });

  it('shows the case item a point follows, without offering another promotion', () => {
    const marker = { properties: { key: 'm1', name: 'Gate', entity_id: 'e1', entity_type: 'place', entity_label: 'Gate' }, geometry: { type: 'Point' } };
    const ondeleteplace = vi.fn();
    show(MyLayers, { controller: picked(marker), ondeleteplace });
    expect(document.body.textContent).toContain('Follows the place “Gate”');
    expect(byText('Unlink')).toBeTruthy();
    document.querySelector('[aria-label="Feature actions"]').click(); flushSync();
    expect(menuItem('Save as case place')).toBeUndefined();
    menuItem('Delete case place').click();
    expect(ondeleteplace).toHaveBeenCalledWith('e1');
  });

  it('shows the proof a point follows first, its plate opening it', () => {
    const marker = { properties: { key: 'm1', name: 'Strike', entity_id: 'p1', entity_type: 'proof', entity_label: 'Strike',
      entity_picture: 'proofs/strike.png', date: '2024-05-10', links: ['https://example.org/post/1'] }, geometry: { type: 'Point' } };
    show(MyLayers, { controller: picked(marker) });
    const sheet = document.querySelector('[aria-label="Feature"]');
    const plate = sheet.querySelector('.follows .follow-picture');
    expect(plate.title).toBe('Open the proof');
    expect(plate.querySelector('img').getAttribute('src')).toContain('proofs/strike.png');
    // above the rows the proof filled in
    expect(plate.compareDocumentPosition(sheet.querySelector('.rows')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    plate.querySelector('img').dispatchEvent(new Event('error')); flushSync();
    expect(sheet.querySelector('.follow-picture')).toBeNull();
    expect(sheet.textContent).toContain('Follows the proof “Strike”');
  });

  it('shows the footage before the proof that geolocates it, each opening its own', () => {
    const marker = { properties: { key: 'm1', name: 'Strike', entity_id: 'p1', entity_type: 'proof', entity_label: 'Strike',
      entity_picture: 'proofs/strike.png', source_id: 'v1', source_label: 'rooftop', source_picture: 'thumbs/v.webp' }, geometry: { type: 'Point' } };
    const onfollowed = vi.fn();
    show(LayerFeatureSheet, { controller: picked(marker), onfollowed });
    const shown = [...document.querySelectorAll('.follows .follow-picture')];
    expect(shown.map((one) => one.textContent.trim())).toEqual(['Source', 'Proof']);
    shown[0].click();
    shown[1].click();
    expect(onfollowed.mock.calls).toEqual([['v1'], ['p1']]);
  });

  it('edits a line by its colour, with no icon, direction or place promotion', () => {
    const line = { properties: { key: 'line', name: 'Road' }, geometry: { type: 'LineString', coordinates: [[2, 48], [2.01, 48]] } };
    show(MyLayers, { controller: picked(line) });
    expect(document.querySelector('[aria-label="Feature style"] .dot')).toBeTruthy();
    expect(document.querySelector('[aria-label="Feature"]').textContent).not.toContain('Facing');
    expect(document.querySelector('[aria-label="Feature"]').textContent).toContain('Length');
    document.querySelector('[aria-label="Feature actions"]').click(); flushSync();
    expect(menuItem('Save as case place')).toBeUndefined();
    expect(menuItem('Remove from the layer')).toBeTruthy();
  });

  it('renames an imported pictogram when the name is left, without replacing its style', async () => {
    const marker = { type: 'Feature', properties: { key: 'm1', name: 'Gate', colour: '', icon: 'source-icon', group: 'g' },
      geometry: { type: 'Point', coordinates: [2, 48] } };
    const { controller, api } = await editing({ features: [marker] });
    controller.select('m1');
    show(MyLayers, { controller });
    const input = document.querySelector('[aria-label="Feature name"]');
    type(input, 'Reviewed gate');
    expect(api.patch).not.toHaveBeenCalled();
    leave(input); await controller.whenSaved();
    expect(api.patch).toHaveBeenCalledExactlyOnceWith('/api/cases/case/map-layers/work/markers/m1', { name: 'Reviewed gate' });
  });

  it('keeps the editor open while clicks are still being saved', () => {
    show(MyLayers, { controller: { editor: { title: 'Working map' }, features: [], pending: 2 } });
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

  it('restyles a one-style group from its feature, and moves the feature to another group', () => {
    const point = { properties: { key: 'm1', group: 'g1', name: 'Gate' }, geometry: { type: 'Point' } };
    const groups = [{ id: 'g1', name: 'Checked', colour: '#009e73', symbol: 'star', mode: 'uniform' },
      { id: 'g2', name: 'Other', colour: '#0072b2', symbol: 'pin', mode: 'individual' }];
    const updateGroup = vi.fn(), saveForm = vi.fn();
    show(MyLayers, { controller: picked(point, { groups, group: 'g1', updateGroup, saveForm }) });
    document.querySelector('[aria-label="Feature style"]').click(); flushSync();
    expect(document.body.textContent).toContain('Checked has one style for all its features. A pick here restyles the whole group.');
    document.querySelector('[aria-label="Feature style orange"]').click();
    expect(updateGroup).toHaveBeenCalledWith('g1', { colour: '#d55e00' });
    // the sheet's own Group row moves it; the picker leaves that to the row
    expect(document.querySelector('[aria-label="Feature style group"]')).toBeNull();
    const select = document.querySelector('[aria-label="Feature group"]');
    select.value = 'g2'; select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(saveForm).toHaveBeenCalledOnce();
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

  it('closes group settings and the new-group form on outside presses', async () => {
    const ondone = vi.fn();
    show(MyLayers, { controller: { editor: { name: 'working', title: 'Working map' },
      groups: [{ id: 'g1', name: 'Markers', mode: 'uniform', colour: '#0072b2', symbol: 'pin' }],
      features: [], pending: 0, stop: vi.fn(), done: vi.fn(async () => true) }, ondone });
    document.querySelector('[aria-label="Settings of group Markers"]').click(); flushSync();
    const name = document.querySelector('[aria-label="Group name"]');
    name.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); flushSync();
    expect(document.querySelector('[aria-label="Settings of group Markers"][role="group"]')).toBeTruthy();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); flushSync();
    expect(document.querySelector('[aria-label="Settings of group Markers"][role="group"]')).toBeNull();
    byText('New group').click(); flushSync();
    document.body.click(); flushSync();
    expect(document.querySelector('.new-group')).toBeNull();
    byText('Done').click(); await settle();
    expect(ondone).toHaveBeenCalledOnce();
  });

  it('sets a group to one style and restyles it from its settings', () => {
    const updateGroup = vi.fn();
    const group = { id: 'g1', name: 'Markers', mode: 'individual', colour: '#0072b2', symbol: 'pin' };
    show(MyLayers, { controller: { editor: { title: 'Working map' }, groups: [group], features: [], pending: 0, updateGroup } });
    document.querySelector('[aria-label="Settings of group Markers"]').click(); flushSync();
    expect(document.querySelector('[aria-label="Group style"]')).toBeNull();
    document.querySelector('[aria-label="One style for the whole group"]').click();
    expect(updateGroup).toHaveBeenCalledWith('g1', { mode: 'uniform' });
  });
});

describe('new layer', () => {
  it('creates a blank layer from the visible actions', () => {
    const oncreate = vi.fn();
    show(NewLayerDialog, { oncreate, onclose: vi.fn() });
    byText('Create layer').click();
    expect(oncreate).toHaveBeenCalledWith('My layer', null, '', null);
    expect(byText('From a file')).toBeTruthy();
  });

  it('creates a layer with an optional description', () => {
    const oncreate = vi.fn();
    show(NewLayerDialog, { oncreate, onclose: vi.fn() });
    const description = document.querySelector('textarea'); description.value = 'Layer context';
    description.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    byText('Create layer').click(); expect(oncreate).toHaveBeenCalledWith('My layer', null, 'Layer context', null);
  });

  it('requires a file when starting from a file', () => {
    show(NewLayerDialog, { onclose: vi.fn() });
    byText('From a file').click();
    flushSync();
    expect(byText('Create layer').disabled).toBe(true);
    expect(document.body.textContent).toContain('Keeps the original file and its bundled icons.');
  });
});

describe('a feature with a history', () => {
  const line = (y) => ({ type: 'LineString', coordinates: [[30, y], [31, y]] });
  const front = { type: 'Feature', geometry: line(1), properties: { key: 'f', name: 'Front line', states: [
    { at: '2026-10-03', geometry: line(0) }, { at: '2026-10-12', geometry: line(1), status: 'damaged' }] } };

  const TRACKED = { name: 'work', title: 'Working map', track: { on: true } };
  const rows = () => [...document.querySelectorAll('[aria-label="Feature history"] li')];
  const said = (row) => [...row.querySelectorAll('.at, .what')].map((node) => node.textContent.trim());

  it('says when it shows under its name, lists what each date brought, and shows the layer on a date pressed', async () => {
    const { addedLayers } = await import('../../lib/map/addedLayersState.svelte.js');
    const dropState = vi.fn();
    show(MyLayers, { controller: picked(front, { editor: TRACKED, cursor: null, timeMode: 'new', dropState }) });
    expect(document.querySelector('[aria-label="When it first shows"]').textContent.trim()).toBe(`From ${shortMoment('2026-10-03')}`);
    expect(document.querySelector('[aria-label="When it leaves the map"]').textContent.trim()).toBe('Still there');
    expect(rows().map(said)).toEqual([[shortMoment('2026-10-03'), 'Appears'], [shortMoment('2026-10-12'), 'Reshaped · Damaged']]);
    // at now the latest date is shown, and an edit carries no date: no row is its own
    expect(rows()[1].classList.contains('current')).toBe(true);
    expect(document.querySelector('[aria-label="Feature history"] .pen')).toBeNull();
    expect(document.querySelector('[aria-label="Feature day"]')).toBeNull();
    rows()[0].querySelector('.moment').click();
    expect(addedLayers.time('work').at).toBe('2026-10-03');
    document.querySelector('[aria-label="Remove the change of 12 Oct 2026"]').click();
    expect(dropState).toHaveBeenCalledWith('f', '2026-10-12');
    addedLayers.setTime('work', { at: null });
  });

  it('says what a date holds while edits carry none, and locks a status that changed on a day', () => {
    const marker = { type: 'Feature', geometry: { type: 'Point', coordinates: [30, 1] }, properties: { key: 'm', name: 'Depot', states: [
      { at: '2026-10-03', geometry: { type: 'Point', coordinates: [30, 1] } },
      { at: '2026-10-12', geometry: { type: 'Point', coordinates: [30, 1] }, status: 'destroyed' }] } };
    const held = () => ({ shape: '', status: '2026-10-12' });
    show(MyLayers, { controller: picked(marker, { editor: TRACKED, cursor: null, timeMode: 'new', held }) });
    expect(document.querySelector('.held').textContent.trim()).toBe(`Status changes on ${shortMoment('2026-10-12')}: pick a day to set it.`);
    const statuses = [...document.querySelectorAll('[aria-label="Feature status"] button')];
    expect(statuses.every((button) => button.disabled)).toBe(true);
    expect(statuses[0].title).toBe('Changes on 12 Oct 2026: pick a day to set it');
  });

  it('shows where a dated edit goes before it is made', () => {
    show(MyLayers, { controller: picked(front, { editor: TRACKED, cursor: '2026-10-15', timeMode: 'new' }) });
    expect(rows().map(said)).toEqual([[shortMoment('2026-10-03'), 'Appears'], [shortMoment('2026-10-12'), 'Reshaped · Damaged'],
      [shortMoment('2026-10-15'), 'Next edit']]);
    expect(rows()[2].classList.contains('ghost')).toBe(true);
  });

  it('gives an undated feature no history until a dated edit is about to', () => {
    const always = { type: 'Feature', geometry: line(1), properties: { key: 'a', name: 'Checkpoint' } };
    show(MyLayers, { controller: picked(always, { editor: TRACKED, cursor: null, timeMode: 'new' }) });
    expect(document.querySelector('[aria-label="When it first shows"]').textContent.trim()).toBe('Always');
    expect(document.querySelector('[aria-label="When it first shows"]').classList.contains('open-ended')).toBe(true);
    expect(document.querySelector('[aria-label="Feature history"]')).toBeNull();
  });

  it('sets when it first shows and when it leaves, from the calendar or the day shown', () => {
    const setStart = vi.fn(), setEnd = vi.fn();
    show(MyLayers, { controller: picked(front, { editor: TRACKED, cursor: '2026-10-15', timeMode: 'new', setStart, setEnd }) });
    document.querySelector('[aria-label="When it first shows"]').click(); flushSync();
    menuItem('Always').click(); flushSync();
    expect(setStart).toHaveBeenCalledWith('f', '');
    document.querySelector('[aria-label="When it first shows"]').click(); flushSync();
    // a start stays before the next change, so the 12th is the last day offered
    expect(document.querySelector('.float-menu button.day[title="2026-10-11"]').disabled).toBe(false);
    expect(document.querySelector('.float-menu button.day[title="2026-10-12"]').disabled).toBe(true);
    document.querySelector('.float-menu button.day[title="2026-10-05"]').click(); flushSync();
    expect(setStart).toHaveBeenLastCalledWith('f', '2026-10-05');
    document.querySelector('[aria-label="When it leaves the map"]').click(); flushSync();
    [...document.querySelectorAll('.float-menu .fm-item')].find((node) => node.textContent.includes('day shown')).click(); flushSync();
    expect(setEnd).toHaveBeenCalledWith('f', '2026-10-15');
  });

  it('goes to a day picked to change it from', () => {
    const changeOn = vi.fn();
    show(MyLayers, { controller: picked(front, { editor: TRACKED, cursor: '2026-10-15', timeMode: 'new', changeOn }) });
    document.querySelector('[aria-label="Change it from a day"]').click(); flushSync();
    expect(document.querySelector('.float-menu button.day[title="2026-10-03"]').disabled).toBe(true);
    document.querySelector('.float-menu button.day[title="2026-10-08"]').click(); flushSync();
    expect(changeOn).toHaveBeenCalledWith('2026-10-08');
  });

  /** Several features picked on a tracked layer, the sheet shared by all of them. */
  const several = (features, extra = {}) => ({ editor: TRACKED, features, groups: [], selection: features.map((one) => one.properties.key),
    selected: null, pending: 0, cursor: null, timeMode: 'new', ...extra });
  const candidate = (key, properties = {}) => ({ type: 'Feature', geometry: line(2), properties: { key, name: 'Candidate', date: '2026-09-28', date_end: '2026-10-03', ...properties } });

  it('says the days a selection shares and gives a day picked to all of them', () => {
    const setSelectionWhen = vi.fn();
    show(MyLayers, { controller: several([candidate('a'), candidate('b')], { setSelectionWhen }) });
    expect(document.querySelector('[aria-label="When it first shows"]').textContent.trim()).toBe(`From ${shortMoment('2026-09-28')}`);
    expect(document.querySelector('[aria-label="When it leaves the map"]').textContent.trim()).toBe(`Until ${shortMoment('2026-10-03')}`);
    // the history and the changes from a day stay with one feature
    expect(document.querySelector('[aria-label="Feature history"]')).toBeNull();
    expect(document.querySelector('[aria-label="Change it from a day"]')).toBeNull();
    document.querySelector('[aria-label="When it first shows"]').click(); flushSync();
    document.querySelector('.float-menu button.day[title="2026-09-30"]').click(); flushSync();
    expect(setSelectionWhen).toHaveBeenCalledWith({ start: '2026-09-30' });
    document.querySelector('[aria-label="When it leaves the map"]').click(); flushSync();
    menuItem('Still there').click(); flushSync();
    expect(setSelectionWhen).toHaveBeenLastCalledWith({ end: '' });
  });

  it('says Mixed where the selection differs and offers only the days all of them can take', () => {
    const setSelectionWhen = vi.fn();
    show(MyLayers, { controller: several([candidate('a', { date: '2026-10-01', date_end: '' }), front], { cursor: '2026-10-15', setSelectionWhen }) });
    const first = document.querySelector('[aria-label="When it first shows"]');
    expect(first.textContent.trim()).toBe('Mixed');
    expect(first.classList.contains('mixed')).toBe(true);
    first.click(); flushSync();
    expect(menuItem('Always').getAttribute('aria-checked')).toBe('false');
    // the front line changes on the 12th, so no start reaches it
    expect(document.querySelector('.float-menu button.day[title="2026-10-11"]').disabled).toBe(false);
    expect(document.querySelector('.float-menu button.day[title="2026-10-12"]').disabled).toBe(true);
    document.querySelector('[aria-label="When it leaves the map"]').click(); flushSync();
    expect(document.querySelector('.float-menu button.day[title="2026-10-12"]').disabled).toBe(true);
    expect(document.querySelector('.float-menu button.day[title="2026-10-13"]').disabled).toBe(false);
    [...document.querySelectorAll('.float-menu .fm-item')].find((node) => node.textContent.includes('day shown')).click(); flushSync();
    expect(setSelectionWhen).toHaveBeenCalledWith({ end: '2026-10-15' });
  });

  it('says an unknown end only when it is pressed, beside Today, for one feature or a selection', () => {
    const setEndUnknown = vi.fn(), setSelectionWhen = vi.fn();
    show(MyLayers, { controller: picked(candidate('a', { date_end: '' }), { editor: TRACKED, cursor: null, timeMode: 'new', setEndUnknown }) });
    const leaves = () => document.querySelector('[aria-label="When it leaves the map"]');
    // never by default: a feature with no end is still there
    expect(leaves().textContent.trim()).toBe('Still there');
    leaves().click(); flushSync();
    const unknown = document.querySelector('.float-menu .acts button[aria-pressed]');
    expect(unknown.textContent.trim()).toBe('Unknown');
    expect(unknown.nextElementSibling.textContent.trim()).toBe('Today');
    expect(unknown.getAttribute('aria-pressed')).toBe('false');
    unknown.click(); flushSync();
    expect(setEndUnknown).toHaveBeenCalledWith('a');
    unmount(held);
    show(MyLayers, { controller: several([candidate('a', { date_end: '', end_unknown: true }), candidate('b', { date_end: '', end_unknown: true })], { setSelectionWhen }) });
    expect(leaves().textContent.trim()).toBe('Unknown');
    leaves().click(); flushSync();
    expect(menuItem('Still there').getAttribute('aria-checked')).toBe('false');
    expect(document.querySelector('.float-menu .acts button[aria-pressed]').getAttribute('aria-pressed')).toBe('true');
    menuItem('Still there').click(); flushSync();
    expect(setSelectionWhen).toHaveBeenCalledWith({ end: '' });
  });

  it('gives a selection an unknown end in one edit', () => {
    const setSelectionWhen = vi.fn();
    show(MyLayers, { controller: several([candidate('a'), candidate('b')], { setSelectionWhen }) });
    document.querySelector('[aria-label="When it leaves the map"]').click(); flushSync();
    document.querySelector('.float-menu .acts button[aria-pressed]').click(); flushSync();
    expect(setSelectionWhen).toHaveBeenCalledWith({ end_unknown: true });
  });

  it('tags each row of the list with when it shows, and dots what changes on the day shown', () => {
    const point = (key, group, properties = {}) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [2, 48] },
      properties: { key, name: key, group, ...properties } });
    const features = [point('checkpoint', 'g'), point('position', 'g', { date: '2026-10-03' }), point('strike', 'e', { date: '2026-10-10' })];
    const groups = [{ id: 'g', name: 'Markers', mode: 'individual', colour: '#0072b2' }, { id: 'e', name: 'Strikes', mode: 'individual', colour: '#d55e00', events: true }];
    show(MyLayers, { controller: { ...picked(features[0], { editor: TRACKED, cursor: '2026-10-10', timeMode: 'new' }), features, groups, selection: [], selected: null } });
    const tags = Object.fromEntries([...document.querySelectorAll('.features li')].map((row) =>
      [row.dataset.featureKey, [row.querySelector('.day').textContent.trim(), !!row.querySelector('.today')]]));
    expect(tags).toEqual({ checkpoint: ['Always', false], position: [`From ${shortMoment('2026-10-03')}`, false], strike: [shortMoment('2026-10-10'), true] });
  });

  it('keeps a switched-off history read-only', () => {
    show(MyLayers, { controller: picked(front, { editor: { name: 'work', title: 'Working map', track: { on: false } }, cursor: null }) });
    expect(document.querySelector('[aria-label="When it shows"]')).toBeNull();
    expect(document.querySelector('[aria-label="Feature day"]')).toBeNull();
    expect(document.querySelector('[aria-label="Feature"]').textContent).toContain(`From ${shortMoment('2026-10-03')}`);
  });

  it('draws a line or an area as the analyst says, says how sure it is, and keeps status to markers', async () => {
    const line = { type: 'Feature', properties: { key: 'l1', name: 'Front', group: 'g' }, geometry: { type: 'LineString', coordinates: [[2, 48], [2.1, 48]] } };
    const area = { type: 'Feature', properties: { key: 'a1', name: 'Pocket', group: 'g' }, geometry: { type: 'Polygon', coordinates: [[[2, 48], [2.1, 48], [2, 48.1], [2, 48]]] } };
    const { controller, api } = await editing({ features: [line, area] });
    controller.select('l1');
    show(MyLayers, { controller });
    const sheet = () => document.querySelector('[aria-label="Feature"]');
    // a line has no status: it is not damaged or destroyed
    expect(sheet().querySelector('[aria-label="Feature status"]')).toBeNull();
    openLook();
    sheet().querySelector('[aria-label="Line dash"] button:nth-child(2)').click(); await controller.whenSaved(); flushSync();
    expect(api.patch).toHaveBeenLastCalledWith('/api/cases/case/map-layers/work/markers/l1', { line_dash: 'dashed' });
    sheet().querySelector('[aria-label="Line arrow"] button:nth-child(2)').click(); await controller.whenSaved(); flushSync();
    expect(api.patch).toHaveBeenLastCalledWith('/api/cases/case/map-layers/work/markers/l1', { line_arrow: 'end' });
    sheet().querySelector('[aria-label="Feature confidence"] button:nth-child(4)').click(); await controller.whenSaved(); flushSync();
    expect(api.patch).toHaveBeenLastCalledWith('/api/cases/case/map-layers/work/markers/l1', { confidence: 'claimed' });
    controller.select('a1'); flushSync();
    expect(sheet().querySelector('[aria-label="Line arrow"]')).toBeNull();
    sheet().querySelector('[aria-label="Area fill"] button:nth-child(2)').click(); await controller.whenSaved(); flushSync();
    expect(api.patch).toHaveBeenLastCalledWith('/api/cases/case/map-layers/work/markers/a1', { area_fill: 'hatch' });
  });

  it('finds a feature by its note and writes its day as a reader would', async () => {
    const features = [{ type: 'Feature', properties: { key: 'k1', name: 'Point 12', group: 'g', date: '2026-10-14', description: 'Burnt hangar by the runway' },
      geometry: { type: 'Point', coordinates: [2, 48] } }];
    const { controller } = await editing({ features });
    show(MyLayers, { controller });
    expect(document.querySelector('.features .day').textContent).toBe('14 Oct 2026');
    expect(document.querySelector('.features .name').textContent).toContain('Burnt hangar');
    const find = document.querySelector('[aria-label="Find in this layer"]'); find.value = 'hangar';
    find.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    expect(document.body.textContent).toContain('1 found');
  });
});

describe('what the sheet says on hover', () => {
  const line = { type: 'Feature', properties: { key: 'l1', name: 'Front', group: 'g', line_width: 4, line_dash: 'dashed' },
    geometry: { type: 'LineString', coordinates: [[2, 48], [2.1, 48]] } };
  const looks = { line_width: 4, line_dash: 'dashed', line_arrow: '', area_fill: '', fill_opacity: '', marker_size: '', label: '', label_size: '', confidence: '' };

  it('explains every row, and folds how a feature is drawn under Look, saying what it sets', () => {
    const controller = picked(line, { groups: [{ id: 'g', name: 'Markers', stroke: 2 }, { id: 'h', name: 'Posts' }] });
    controller.form = { ...controller.form, ...looks };
    show(LayerFeatureSheet, { controller });
    const look = document.querySelector('button.look');
    if (look.getAttribute('aria-expanded') === 'true') { look.click(); flushSync(); }
    // what it says comes first, each row named on hover
    const keys = [...document.querySelectorAll('.rows .key')].filter((key) => key.textContent !== 'Length');
    expect(keys.map((key) => key.textContent)).toEqual(['Group', 'How sure', 'Day', 'Sources', 'Geolocated by', 'Note']);
    expect(keys.every((key) => key.title)).toBe(true);
    expect(document.querySelector('[aria-label="Line dash"]')).toBeNull();
    expect(look.title).toBe('How it is drawn: its size, line, fill and name');
    expect(look.textContent).toContain('Width · Dash');
    look.click(); flushSync();
    const drawn = [...document.querySelectorAll('.look-rows .key')];
    expect(drawn.map((key) => key.textContent)).toEqual(['Width', 'Dash', 'Arrow', 'Name']);
    expect(drawn.every((key) => key.title)).toBe(true);
    // a slider says its value, and goes back to its group's with Reset
    const width = document.querySelector('[aria-label="Line width"]').closest('.slider');
    expect(width.textContent).toContain('4 px');
    expect(width.querySelector('button').textContent).toBe('Reset');
  });

  it('says a marker\'s status by what it draws, nothing said first', () => {
    const marker = { type: 'Feature', properties: { key: 'm1', name: 'Depot', group: 'g' }, geometry: { type: 'Point', coordinates: [2, 48] } };
    const setStatus = vi.fn();
    show(LayerFeatureSheet, { controller: picked(marker, { groups: [{ id: 'g', name: 'Markers' }], setStatus }) });
    const buttons = [...document.querySelectorAll('[aria-label="Feature status"] button')];
    expect(buttons.map((button) => [button.textContent, button.title])).toEqual([
      ['–', 'No damage said, drawn plain'], ['Damaged', 'Drawn with a stroke across it'], ['Destroyed', 'Drawn with a cross over it']]);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    buttons[2].click();
    expect(setStatus).toHaveBeenCalledWith('destroyed');
  });

  it('says a feature is not on the map on the day shown, and keeps its status there', () => {
    const away = { type: 'Feature', properties: { key: 's', name: 'Store', group: 'g', $absent: true,
      states: [{ at: '2026-10-10', geometry: { type: 'Point', coordinates: [2, 48] } }] }, geometry: { type: 'Point', coordinates: [2, 48] } };
    show(LayerFeatureSheet, { controller: picked(away, { editor: { name: 'work', title: 'Working', track: { on: true } }, cursor: '2026-10-05',
      timeMode: 'new', groups: [{ id: 'g', name: 'Markers' }] }) });
    expect(document.querySelector('.away').textContent.trim()).toBe('Not on the map on 5 Oct 2026: set when it shows to change it there.');
    expect([...document.querySelectorAll('[aria-label="Feature status"] button')].every((button) => button.disabled)).toBe(true);
  });
});
