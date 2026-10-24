// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMyLayersState, difference, shapeRing } from './myLayers.svelte.js';
import { circleRadius } from '../../../lib/map/sketchMeasure.js';

const ROW = { name: 'working', title: 'Working map', editable: true, features: 0 };
const feature = (key, properties = {}) => ({ type: 'Feature',
  geometry: { type: 'Point', coordinates: [2.35, 48.85] },
  properties: { key, name: key, colour: '#0072b2', symbol: 'pin', ...properties } });
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
let owner, api, layers, notify, reloadCase, sequence;
const store = () => createMyLayersState({ api, layers, caseId: () => owner, notify, reloadCase,
  beginSession: (path) => api.get(`${path}/edit`) });

beforeEach(() => {
  owner = 'first';
  sequence = 0;
  api = {
    get: vi.fn(async () => ({ layer: ROW, document: { features: [] } })),
    post: vi.fn(async () => ({ layer: { ...ROW, features: ++sequence }, marker: feature(`m${sequence}`) })),
    patch: vi.fn(),
    del: vi.fn(),
  };
  layers = { rows: [{ ...ROW, enabled: false }], toggle: vi.fn(), edited: vi.fn(),
    createEditable: vi.fn(async () => ROW), importEditable: vi.fn(async () => ROW),
    copyEditable: vi.fn(async () => ROW) };
  notify = vi.fn();
  reloadCase = vi.fn();
});

describe('personal layer editing', () => {
  it('keeps draft layer details during unrelated saves and updates the shared row on saving', async () => {
    const editor = store(); await editor.open(ROW);
    editor.details.title = 'Renamed'; editor.details.description = 'Context';
    expect(editor.changed).toBe(true);
    await editor.reorderFeatures(['one'], 'markers', 'two');
    expect(api.post).toHaveBeenCalledWith('/api/cases/first/map-layers/working/features/order', { keys: ['one'], group: 'markers', before: 'two' });
    expect(editor.details).toEqual({ title: 'Renamed', description: 'Context' });
    api.patch.mockResolvedValueOnce({ layer: { ...ROW, title: 'Renamed', description: 'Context' } });
    await editor.updateDetails({ title: 'Renamed', description: 'Context' });
    expect(api.patch).toHaveBeenCalledWith('/api/cases/first/map-layers/working/edit', { title: 'Renamed', description: 'Context' });
    expect(layers.edited).toHaveBeenLastCalledWith('first', expect.objectContaining({ name: 'working', title: 'Renamed', description: 'Context' }));
    expect(editor.changed).toBe(false);
  });
  it('selects individual checks and an inclusive Shift range, then moves the selection in one request', async () => {
    const points = ['one', 'two', 'three', 'four'].map((key) => feature(key));
    api.get.mockResolvedValue({ layer: ROW, document: { features: points } });
    const editor = store(); await editor.open(ROW);
    editor.toggleSelected('one', points.map((p) => p.properties.key));
    editor.toggleSelected('three', points.map((p) => p.properties.key), true);
    expect(editor.selection).toEqual(['one', 'two', 'three']); expect(editor.selected).toBeNull();
    editor.toggleSelected('two', []); expect(editor.selection).toEqual(['one', 'three']);
    editor.moveSelection(); editor.moveVertex(0, 0, { lon: 3.35, lat: 49.85 });
    await editor.saveGeometry();
    expect(api.post).toHaveBeenCalledWith('/api/cases/first/map-layers/working/selection', { keys: ['one', 'three'], offset: [1, 1] });
    expect(reloadCase).not.toHaveBeenCalled();
    editor.select(null); expect(editor.selection).toEqual([]);
  });
  it('keeps an unsaved feature form through refreshes and geometry saves', async () => {
    const original = feature('m1');
    api.get.mockResolvedValue({ layer: ROW, document: { features: [original] } });
    const editor = store(); await editor.open(ROW); editor.select('m1');
    editor.form.name = 'Draft title';
    await editor.refresh();
    expect(editor.form.name).toBe('Draft title'); expect(editor.changed).toBe(true);
    editor.editGeometry(); editor.moveVertex(0, 0, { lon: 3, lat: 49 });
    api.patch.mockResolvedValueOnce({ layer: ROW, marker: { ...original, geometry: { type: 'Point', coordinates: [3, 49] } } });
    await editor.saveGeometry(); expect(editor.form.name).toBe('Draft title');
    api.patch.mockResolvedValueOnce({ layer: ROW, marker: feature('m1', { name: 'Draft title' }) });
    await editor.saveForm();
    expect(api.patch).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/markers/m1', { name: 'Draft title' });
    expect(editor.changed).toBe(false);
  });
  it('keeps a draft name while accepting its new group after a direct drop', async () => {
    const original = feature('one', { group: 'first' });
    api.get.mockResolvedValueOnce({ layer: ROW, document: { features: [original] } });
    const editor = store(); await editor.open(ROW); editor.select('one'); editor.form.name = 'Draft name';
    api.post.mockResolvedValueOnce({ layer: ROW, document: { features: [feature('one', { group: 'second' })] } });
    await editor.reorderFeatures(['one'], 'second');
    expect(editor.form.name).toBe('Draft name'); expect(editor.form.group).toBe('second');
    expect(editor.selection).toEqual(['one']);
  });
  it('starts a trusted checkpoint and commits the latest queued revision on Done', async () => {
    api.post.mockResolvedValueOnce({ layer: { ...ROW, edit_revision: 'a'.repeat(64), edit_changed: false },
      checkpoint: 'c'.repeat(32), groups: [], document: { features: [] } });
    const editor = createMyLayersState({ api, layers, caseId: () => owner, notify, reloadCase });
    await editor.open(ROW);
    expect(api.post).toHaveBeenCalledWith('/api/cases/first/map-layers/working/edit', {});
    api.patch.mockResolvedValueOnce({ layer: { ...ROW, edit_revision: 'b'.repeat(64), edit_changed: true }, marker: feature('m1') });
    await editor.aim('m1', 90);
    expect(editor.changed).toBe(true);
    api.post.mockResolvedValueOnce({ layer: ROW, document: { features: [feature('m1')] } });
    expect(await editor.finish()).toBe(true);
    expect(api.post).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/edit/finish',
      { token: 'c'.repeat(32), revision: 'b'.repeat(64), discard: false });
    expect(editor.editor).toBeNull();
  });

  it('leaves a refused discard open and does not pretend it restored the layer', async () => {
    api.get.mockResolvedValueOnce({ layer: { ...ROW, edit_revision: 'a'.repeat(64), edit_changed: true },
      checkpoint: 'c'.repeat(32), document: { features: [feature('m1')] } });
    const editor = store(); await editor.open(ROW);
    api.post.mockRejectedValueOnce(new Error('Changed elsewhere'));
    expect(await editor.finish(true)).toBe(false);
    expect(editor.editor).not.toBeNull();
    expect(editor.features).toHaveLength(1);
    expect(notify).toHaveBeenCalledWith('Changed elsewhere', 'danger', 5000);
  });

  it('draws lines and polygons as drafts until Save geometry', async () => {
    const editor = store(); await editor.open(ROW);
    editor.startShape('Polygon');
    editor.addPoint({ lon: 2, lat: 48 }); editor.addPoint({ lon: 3, lat: 48 }); editor.addPoint({ lon: 3, lat: 49 });
    expect(editor.complete).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
    editor.undoVertex(); expect(editor.complete).toBe(false);
    editor.addPoint({ lon: 3, lat: 49 });
    await editor.saveGeometry();
    expect(api.post).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/shapes', expect.objectContaining({
      geometry: { type: 'Polygon', coordinates: [[[2, 48], [3, 48], [3, 49], [2, 48]]] },
    }));
    expect(editor.sketch).toBeNull();
    editor.startShape('LineString'); editor.addPoint({ lon: 2, lat: 48 }); editor.addPoint({ lon: 3, lat: 49 });
    await editor.saveGeometry();
    expect(api.post.mock.calls.at(-1)[1].geometry).toEqual({ type: 'LineString', coordinates: [[2, 48], [3, 49]] });
  });

  it('edits a marker position without updating the case place and keeps refused geometry as a draft', async () => {
    const shared = feature('m1', { entity_id: 'e1' });
    api.get.mockResolvedValueOnce({ layer: ROW, document: { features: [shared] } });
    const editor = store(); await editor.open(ROW); editor.select('m1'); editor.editGeometry();
    editor.moveVertex(0, 0, { lon: 3, lat: 49 });
    expect(api.patch).not.toHaveBeenCalled();
    api.patch.mockRejectedValueOnce(new Error('Refused'));
    await editor.saveGeometry(); expect(editor.sketch).not.toBeNull();
    api.patch.mockResolvedValueOnce({ layer: ROW, marker: { ...shared, geometry: { type: 'Point', coordinates: [3, 49] } } });
    await editor.saveGeometry();
    expect(api.patch).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/markers/m1',
      { geometry: { type: 'Point', coordinates: [3, 49] } });
    expect(reloadCase).not.toHaveBeenCalled();
    expect(editor.selected.properties.entity_id).toBe('e1');
  });

  it('draws a pin put down at once, in the style it is given, and the editor names it once saved', async () => {
    const groups = [{ id: 'g', name: 'Sides', mode: 'colour', colour: '#cc79a7', symbol: 'pin', size: 1.5, stroke: 2 }];
    api.get.mockResolvedValue({ layer: ROW, document: { features: [] }, groups });
    const gate = deferred();
    api.post.mockImplementationOnce(() => gate.promise);
    const editor = store(); await editor.open(ROW);
    editor.start(); editor.draft.symbol = 'star';
    editor.addPoint({ lat: 48, lon: 2 });
    const [landing] = editor.landings;
    // drawn on the maps before any answer, as the layer will draw it: its group's colour, its size
    expect(landing.feature.geometry.coordinates).toEqual([2, 48]);
    expect(landing.feature.properties).toMatchObject({ symbol: 'star', colour: '#cc79a7', category: 'Sides', icon_scale: 1.5, group: 'g' });
    // the editor waits for the save to give it a key of its own
    expect(editor.features).toEqual([]);
    gate.resolve({ layer: ROW, marker: feature('m1', { group: 'g' }) });
    await editor.whenSaved();
    expect(editor.landings).toEqual([]);
    expect(landing.saved).toBe(true);
    expect(editor.features.map((one) => one.properties.key)).toEqual(['m1']);
    expect(editor.selection).toEqual(['m1']);
  });

  it('ends a new shape at once on Enter, and gives it back to finish when the save is refused', async () => {
    const gate = deferred();
    api.post.mockImplementationOnce(() => gate.promise);
    const editor = store(); await editor.open(ROW);
    editor.startShape('LineString'); editor.addPoint({ lon: 2, lat: 48 }); editor.addPoint({ lon: 3, lat: 49 });
    const saving = editor.saveGeometry();
    expect(editor.sketch).toBeNull();
    expect(editor.landings[0].feature.geometry).toEqual({ type: 'LineString', coordinates: [[2, 48], [3, 49]] });
    gate.reject(new Error('Refused'));
    expect(await saving).toBeNull();
    expect(editor.landings).toEqual([]);
    expect(editor.sketch.rings[0]).toEqual([[2, 48], [3, 49]]);
  });

  it('keeps an area reshaped off the maps until they draw it where it landed', async () => {
    const area = { ...feature('area'), geometry: { type: 'Polygon', coordinates: [[[0, 0], [5, 0], [5, 5], [0, 0]]] } };
    api.get.mockResolvedValueOnce({ layer: ROW, document: { features: [area] } });
    const gate = deferred();
    api.patch.mockImplementationOnce(() => gate.promise);
    const editor = store(); await editor.open(ROW); editor.select('area'); editor.editGeometry();
    editor.moveVertex(0, 1, { lon: 6, lat: 0 });
    const saving = editor.saveGeometry();
    expect(editor.sketch).toBeNull();
    const [landing] = editor.landings;
    expect(editor.dragging).toEqual({ name: 'working', keys: ['area'], offset: null, landing });
    editor.claim(landing);
    gate.resolve({ layer: ROW, marker: area });
    await saving;
    // a map drew it: the shape it stands for can come back
    expect(editor.dragging).not.toBeNull();
    editor.landed(landing);
    expect(editor.dragging).toBeNull();
  });

  it('keeps polygon holes while moving, inserting and removing vertices', async () => {
    const polygon = { ...feature('area'), geometry: { type: 'Polygon', coordinates: [
      [[0, 0], [5, 0], [5, 5], [0, 0]], [[1, 1], [2, 1], [2, 2], [1, 1]],
    ] } };
    api.get.mockResolvedValueOnce({ layer: ROW, document: { features: [polygon] } });
    const editor = store(); await editor.open(ROW); editor.select('area'); editor.editGeometry();
    editor.insertVertex(0, 1, { lon: 3, lat: 0 }); editor.moveVertex(1, 0, { lon: 1.1, lat: 1.1 });
    editor.removeVertex(0, 1);
    api.patch.mockResolvedValueOnce({ layer: ROW, marker: polygon });
    await editor.saveGeometry();
    const geometry = api.patch.mock.calls[0][1].geometry;
    expect(geometry.coordinates[0]).toEqual(polygon.geometry.coordinates[0]);
    expect(geometry.coordinates[1][0]).toEqual([1.1, 1.1]);
    expect(geometry.coordinates[1].at(-1)).toEqual([1.1, 1.1]);
  });

  it('persists group restacking through its own bounded route', async () => {
    const editor = store(); await editor.open(ROW);
    await editor.reorderGroups(['second', 'first']);
    expect(api.post).toHaveBeenCalledWith('/api/cases/first/map-layers/working/groups/order', { ids: ['second', 'first'] });
  });
  it('reads nothing and takes no map click before editing starts', () => {
    const editor = store();
    expect(editor.addPoint({ lat: 1, lon: 2 })).toBe(false);
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('opens an editable layer from local data and switches it on', async () => {
    const editor = store();
    await editor.open(ROW);
    expect(editor.editor.title).toBe('Working map');
    expect(layers.toggle).toHaveBeenCalledWith('first', layers.rows[0]);
    expect(editor.placing).toBe(false);
  });

  it('saves rapid clicks in order using the style chosen at each click', async () => {
    const gate = deferred();
    api.post.mockImplementationOnce(() => gate.promise);
    const editor = store();
    await editor.open(ROW);
    editor.start();
    editor.draft.colour = '#d55e00';
    editor.addPoint({ lat: 1, lon: 2 });
    editor.draft.colour = '#009e73';
    editor.draft.symbol = 'star';
    editor.addPoint({ lat: 3, lon: 4 });
    await Promise.resolve();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(editor.pending).toBe(2);
    gate.resolve({ layer: ROW, marker: feature('first-marker') });
    await editor.whenSaved();
    expect(api.post.mock.calls.map(([, body]) => body.colour)).toEqual(['#d55e00', '#009e73']);
    expect(api.post.mock.calls[1][1]).toEqual({ lat: 3, lon: 4, colour: '#009e73', symbol: 'star' });
    expect(editor.features).toHaveLength(2);
    expect(editor.pending).toBe(0);
    expect(api.post.mock.calls.every(([path]) => path.endsWith('/markers'))).toBe(true);
  });

  it('saves a name still being typed before the selection moves on', async () => {
    const points = ['one', 'two'].map((key) => feature(key));
    api.get.mockResolvedValue({ layer: ROW, document: { features: points } });
    api.patch.mockImplementation(async (path, body) => ({ layer: ROW, marker: feature('one', body) }));
    const editor = store(); await editor.open(ROW);
    editor.select('one');
    editor.form.name = 'Gate';
    editor.select('two');
    await editor.whenSaved();
    expect(api.patch).toHaveBeenCalledExactlyOnceWith('/api/cases/first/map-layers/working/markers/one', { name: 'Gate' });
    expect(editor.selected.properties.key).toBe('two');
    expect(editor.form.name).toBe('two');
    expect(editor.features.find((one) => one.properties.key === 'one').properties.name).toBe('Gate');
    // nothing typed: moving on saves nothing
    editor.select('one');
    await editor.whenSaved();
    expect(api.patch).toHaveBeenCalledOnce();
  });

  it('picks each marker a click puts down, unless the analyst picked another since', async () => {
    const editor = store();
    await editor.open(ROW);
    editor.start();
    editor.addPoint({ lat: 1, lon: 2 });
    await editor.whenSaved();
    expect(editor.selected.properties.key).toBe('m1');
    expect(editor.selection).toEqual(['m1']);
    expect(editor.placing).toBe(true);
    // a name typed in the sheet is saved before the next click takes the sheet over
    editor.form.name = 'Gate';
    api.patch.mockResolvedValueOnce({ layer: ROW, marker: feature('m1', { name: 'Gate' }) });
    editor.addPoint({ lat: 3, lon: 4 });
    await editor.whenSaved();
    expect(api.patch).toHaveBeenCalledWith('/api/cases/first/map-layers/working/markers/m1', { name: 'Gate' });
    expect(editor.selected.properties.key).toBe('m2');
    // a feature picked by hand while a save is on its way keeps the sheet
    const gate = deferred();
    api.post.mockImplementationOnce(() => gate.promise);
    editor.addPoint({ lat: 5, lon: 6 });
    editor.select('m1');
    gate.resolve({ layer: ROW, marker: feature('m3') });
    await editor.whenSaved();
    expect(editor.selected.properties.key).toBe('m1');
  });

  it('stops accepting clicks without losing ones already queued', async () => {
    const editor = store();
    await editor.open(ROW);
    editor.start();
    editor.addPoint({ lat: 1, lon: 2 });
    editor.stop();
    expect(editor.addPoint({ lat: 3, lon: 4 })).toBe(false);
    await editor.whenSaved();
    expect(editor.features).toHaveLength(1);
  });

  it('keeps saving later clicks after a refused one', async () => {
    api.post.mockRejectedValueOnce(new Error('First click refused'));
    const editor = store();
    await editor.open(ROW);
    editor.start();
    editor.addPoint({ lat: 1, lon: 2 });
    editor.addPoint({ lat: 3, lon: 4 });
    await editor.whenSaved();
    expect(editor.features).toHaveLength(1);
    expect(notify).toHaveBeenCalledWith('First click refused', 'danger', 5000);
    expect(editor.pending).toBe(0);
  });

  it('does not let a late save change another case or editor', async () => {
    const gate = deferred();
    api.post.mockImplementationOnce(() => gate.promise);
    const editor = store();
    await editor.open(ROW);
    editor.start();
    editor.addPoint({ lat: 1, lon: 2 });
    owner = 'second';
    editor.close();
    await editor.open(ROW);
    gate.resolve({ layer: ROW, marker: feature('old-marker') });
    await editor.whenSaved();
    expect(editor.features).toEqual([]);
    expect(layers.edited).not.toHaveBeenCalled();
  });

  it('creates a place only on an explicit promotion and refreshes the case', async () => {
    const editor = store();
    await editor.open(ROW);
    api.post.mockResolvedValueOnce({ layer: ROW, marker: feature('kept', { entity_id: 'e1' }),
      place: { id: 'e1', label: 'Kept place' } });
    await editor.promote('kept');
    expect(api.post).toHaveBeenCalledWith('/api/cases/first/map-layers/working/markers/kept/place', {});
    expect(reloadCase).toHaveBeenCalledOnce();
    expect(editor.features[0].properties.entity_id).toBe('e1');
  });

  it('creates an editable copy through the existing layer store', async () => {
    const editor = store();
    const source = { name: 'source', title: 'Source map' };
    editor.newLayer(source);
    await editor.create('My copy');
    expect(layers.copyEditable).toHaveBeenCalledWith(expect.objectContaining(source), 'My copy', '');
    expect(editor.dialog).toBe(null);
    expect(editor.editor.name).toBe(ROW.name);
  });

  it('imports a file without asking for web icons', async () => {
    const editor = store();
    const file = new File(['kmz'], 'source.kmz');
    editor.newLayer();
    await editor.create('My copy', file);
    expect(layers.importEditable).toHaveBeenCalledWith(file, 'My copy', '');
    expect(layers.createEditable).not.toHaveBeenCalled();
  });

  it('keeps a failed creation dialog open for a retry', async () => {
    layers.createEditable.mockResolvedValue(null);
    const editor = store();
    editor.newLayer();
    await editor.create('Working map');
    expect(editor.dialog).not.toBe(null);
    expect(editor.editor).toBe(null);
  });

  it('adds case items in the chosen group, each at the point it was picked', async () => {
    const editor = store(); await editor.open(ROW);
    editor.group = 'checked';
    api.post.mockResolvedValueOnce({ layer: ROW, groups: [{ id: 'checked' }], added: 1,
      document: { features: [feature('m1', { entity_id: 'e1', group: 'checked' })] } });
    await editor.addLinks([{ id: 'e1', lat: 48.85, lon: 2.35 }]);
    expect(api.post).toHaveBeenCalledWith('/api/cases/first/map-layers/working/links',
      { items: [{ id: 'e1', lat: 48.85, lon: 2.35 }], group: 'checked' });
    expect(editor.features[0].properties.entity_id).toBe('e1');
    expect(notify).toHaveBeenCalledWith('Added 1 from the case', 'ok', 2600);
    expect(reloadCase).not.toHaveBeenCalled();
  });

  it('merges the selection into its first feature and offers the merge back', async () => {
    const lines = ['a', 'b'].map((key) => ({ ...feature(key), geometry: { type: 'LineString', coordinates: [[2, 48], [2.1, 48]] } }));
    api.get.mockResolvedValueOnce({ layer: ROW, document: { features: lines } });
    const editor = store(); await editor.open(ROW);
    editor.chooseKeys(['a', 'b']);
    api.post.mockResolvedValueOnce({ layer: ROW, document: { features: [lines[0]] }, batch: 'merge-1', key: 'a' });
    await editor.merge();
    expect(api.post).toHaveBeenCalledWith('/api/cases/first/map-layers/working/merge', { keys: ['a', 'b'] });
    expect(editor.selection).toEqual(['a']);
    const [, , , action] = notify.mock.calls.at(-1);
    api.post.mockResolvedValueOnce({ layer: ROW, document: { features: lines } });
    await action.onClick();
    // the merge taken back puts the feature it swallowed back as it was
    expect(api.post).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/revert', { put: [lines[1]], drop: [] });
  });

  it('cuts a line at a corner and selects both halves', async () => {
    const editor = store(); await editor.open(ROW);
    api.post.mockResolvedValueOnce({ layer: ROW, document: { features: [] }, batch: 'cut', keys: ['a', 'a2'] });
    await editor.split('a', 2);
    expect(api.post).toHaveBeenCalledWith('/api/cases/first/map-layers/working/split', { key: 'a', at: 2 });
    expect(editor.selection).toEqual(['a', 'a2']);
  });

  it('says when a dragged selection held only markers that follow a case item', async () => {
    const editor = store(); await editor.open(ROW);
    editor.drag(['a'], [1, 0]);
    expect(editor.dragging).toEqual({ name: 'working', keys: ['a'], offset: [1, 0] });
    api.post.mockResolvedValueOnce({ layer: ROW, document: { features: [] }, kept: 1, batch: null });
    await editor.moveFeatures(['a'], [1, 0]);
    expect(notify).toHaveBeenCalledWith('Linked markers stay on the case item they follow', 'info', 4000);
    expect(editor.dragging).toBeNull();
  });

  it('puts a marker on a typed position as one move, and leaves what cannot move there where it is', async () => {
    const line = { type: 'Feature', geometry: { type: 'LineString', coordinates: [[2, 48], [2.1, 48.1]] }, properties: { key: 'line' } };
    const held = [feature('a'), feature('linked', { entity_id: 'place-1' }), line];
    api.get.mockResolvedValue({ layer: ROW, document: { features: held } });
    const editor = store(); await editor.open(ROW);
    const moved = { ...held[0], geometry: { type: 'Point', coordinates: [2.37, 48.86] } };
    api.post.mockResolvedValueOnce({ layer: ROW, document: { features: [moved, ...held.slice(1)] }, kept: 0 });
    expect(editor.placeAt('a', { lat: 48.86, lon: 2.37 })).toBe(true);
    await editor.whenSaved();
    const [path, body] = api.post.mock.calls.at(-1);
    expect(path).toBe('/api/cases/first/map-layers/working/selection');
    expect(body.keys).toEqual(['a']);
    expect(body.offset[0]).toBeCloseTo(0.02, 9); expect(body.offset[1]).toBeCloseTo(0.01, 9);
    expect(notify).toHaveBeenLastCalledWith('Moved', 'info', 7000, expect.objectContaining({ label: 'Undo' }));
    api.post.mockClear();
    // where it already stands, a marker that follows a case item, and a line: nothing is sent
    expect(editor.placeAt('a', { lat: 48.86, lon: 2.37 })).toBe(false);
    expect(editor.placeAt('linked', { lat: 48.86, lon: 2.37 })).toBe(false);
    expect(notify).toHaveBeenLastCalledWith('It follows its case item: Unlink it to move it', 'info', 4000);
    expect(editor.placeAt('line', { lat: 48.86, lon: 2.37 })).toBe(false);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('gives a circle drawn from its centre the radius typed, and nothing before its centre is down', async () => {
    const editor = store(); await editor.open(ROW);
    editor.startShape('Circle');
    editor.radius(500);
    expect(editor.sketch.rings).toEqual([[]]);
    editor.addPoint({ lon: 2, lat: 48 });
    editor.radius(500);
    expect(circleRadius(editor.sketch)).toBeCloseTo(500, 1);
    expect(editor.complete).toBe(true);
    editor.radius(0);
    expect(circleRadius(editor.sketch)).toBeCloseTo(500, 1);
    await editor.saveGeometry();
    expect(api.post.mock.calls.at(-1)[1].geometry.coordinates[0]).toHaveLength(65);
  });

  it('saves only what the sheet changed, and clears a field with nothing', async () => {
    api.get.mockResolvedValueOnce({ layer: ROW, document: { features: [feature('m1', { status: 'damaged', date: '2026-01-02' })] } });
    const editor = store(); await editor.open(ROW); editor.select('m1');
    editor.form.date = ''; editor.form.links = ['  ', 'https://a.example/x '];
    expect(editor.formChanged).toBe(true);
    api.patch.mockResolvedValueOnce({ layer: ROW, marker: feature('m1') });
    await editor.saveForm();
    expect(api.patch).toHaveBeenCalledWith('/api/cases/first/map-layers/working/markers/m1',
      { date: null, links: ['https://a.example/x'] });
  });

  it('copies a source feature into the open layer as an external point with its day and addresses', async () => {
    const editor = store(); await editor.open(ROW);
    editor.copy({ name: 'gc', title: 'GeoConfirmed' }, { type: 'Feature', geometry: { type: 'Point', coordinates: [30, 50] },
      properties: { name: 'Strike', description: 'Seen https://x.com/a/1 and https://x.com/a/1', date: '2026-09-13', colour: '#E53935' } });
    await editor.copyTo(ROW, 'g1');
    expect(api.post).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/markers', expect.objectContaining({
      lat: 50, lon: 30, name: 'Strike', provenance: 'external', date: '2026-09-13', links: ['https://x.com/a/1'], colour: '#E53935', group: 'g1' }));
    expect(editor.copying).toBeNull();
  });

  it('copies a source line into a layer that is not open, through its own address', async () => {
    const editor = store();
    editor.copy({ name: 'gc', title: 'GeoConfirmed' }, { type: 'Feature', geometry: { type: 'LineString', coordinates: [[30, 50], [31, 50]] },
      properties: { name: 'Front' } });
    api.post.mockResolvedValueOnce({ layer: { ...ROW, name: 'other' }, key: 'new' });
    await editor.copyTo({ ...ROW, name: 'other', title: 'Other' });
    expect(api.post).toHaveBeenCalledWith('/api/cases/first/map-layers/other/shapes', expect.objectContaining({
      geometry: { type: 'LineString', coordinates: [[30, 50], [31, 50]] }, provenance: 'external' }));
    expect(layers.edited).toHaveBeenCalledWith('first', expect.objectContaining({ name: 'other' }));
  });

  it('reshapes a merged multi-line and saves it back as one', async () => {
    const multi = { ...feature('m'), geometry: { type: 'MultiPolygon', coordinates: [
      [[[2, 48], [3, 48], [3, 49], [2, 48]]], [[[5, 48], [6, 48], [6, 49], [5, 48]]]] } };
    api.get.mockResolvedValueOnce({ layer: ROW, document: { features: [multi] } });
    const editor = store(); await editor.open(ROW); editor.select('m');
    editor.editGeometry();
    expect(editor.sketch.rings).toHaveLength(2);
    editor.moveVertex(1, 0, { lon: 5.5, lat: 48 });
    api.patch.mockResolvedValueOnce({ layer: ROW, marker: multi });
    await editor.saveGeometry();
    expect(api.patch).toHaveBeenCalledWith('/api/cases/first/map-layers/working/markers/m', { geometry: { type: 'MultiPolygon',
      coordinates: [[[[2, 48], [3, 48], [3, 49], [2, 48]]], [[[5.5, 48], [6, 48], [6, 49], [5.5, 48]]]] } });
  });

  it('removes a member and restores it with the same key through Undo', async () => {
    api.get.mockResolvedValueOnce({ layer: ROW, document: { features: [feature('m1')] } });
    api.del.mockResolvedValueOnce({ layer: ROW, document: { features: [] }, removed: 'm1' });
    const editor = store(); await editor.open(ROW); editor.select('m1');
    await editor.remove('m1');
    expect(api.del).toHaveBeenCalledWith('/api/cases/first/map-layers/working/markers/m1');
    expect(editor.features).toHaveLength(0);
    expect(editor.selected).toBeNull();
    const undo = notify.mock.calls.find(([text]) => text === 'Removed from layer')[3];
    api.post.mockResolvedValueOnce({ layer: ROW, document: { features: [feature('m1')] } });
    await undo.onClick();
    expect(editor.features[0].properties.key).toBe('m1');
    expect(api.post).toHaveBeenCalledWith('/api/cases/first/map-layers/working/revert', { put: [feature('m1')], drop: [] });
  });

  it('can remove directly from a popup without opening the editor or deleting a case place', async () => {
    api.del.mockResolvedValueOnce({ layer: ROW, document: { features: [] } });
    const editor = store(); await editor.remove('m1', ROW);
    expect(editor.editor).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
    expect(layers.edited).toHaveBeenCalledWith('first', ROW);
    expect(api.del).toHaveBeenCalledExactlyOnceWith('/api/cases/first/map-layers/working/markers/m1');
  });

  it('saves group membership with each click before the destination changes', async () => {
    const editor = store(); await editor.open(ROW); editor.start();
    editor.group = 'north'; editor.addPoint({ lat: 1, lon: 2 });
    editor.group = 'south'; editor.addPoint({ lat: 3, lon: 4 });
    await editor.whenSaved();
    expect(api.post.mock.calls.map(([, body]) => body.group)).toEqual(['north', 'south']);
  });
});

describe('editing a layer followed over time', () => {
  const TRACKED = { ...ROW, track: { on: true, precision: 'day', zone: 'UTC' } };
  let cursorAt;
  beforeEach(() => {
    cursorAt = null;
    layers.time = () => ({ at: cursorAt, trail: true, since: null });
    api.get.mockResolvedValue({ layer: TRACKED, document: { features: [feature('front'), feature('base')] } });
  });

  it('dates an edit to today when nobody moved the cursor, so it never slides to the next day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T21:30:00Z'));
    const tokyo = { ...TRACKED, track: { ...TRACKED.track, zone: 'Asia/Tokyo' } };
    api.get.mockResolvedValue({ layer: tokyo, document: { features: [feature('front'), feature('base')] } });
    const editor = store(); await editor.open(tokyo);
    // past midnight in Tokyo: the layer's day is the 16th
    expect(editor.cursor).toBe('2026-10-16');
    await editor.moveFeatures(['front'], [0, 1]);
    expect(api.post).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/selection', { keys: ['front'], offset: [0, 1], at: '2026-10-16' });
    vi.useRealTimers();
  });

  it('dates a move to the cursor, or sends it with no date when none is chosen', async () => {
    const editor = store(); await editor.open(TRACKED);
    cursorAt = '2026-10-12';
    expect(editor.cursor).toBe('2026-10-12');
    await editor.moveFeatures(['front'], [0, 1]);
    expect(api.post).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/selection', { keys: ['front'], offset: [0, 1], at: '2026-10-12' });
    api.patch.mockResolvedValue({ layer: TRACKED, marker: feature('front') });
    await editor.refresh();
    editor.timeMode = 'fix';
    editor.select('front');
    await editor.setStatus('destroyed');
    expect(api.post).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/selection', { keys: ['front'], changes: { status: 'destroyed' } });
  });

  it('holds what a feature changed by date while edits carry none, and says why', async () => {
    const moved = feature('front', { name: 'Front', states: [
      { at: '2026-10-03', geometry: { type: 'Point', coordinates: [2.35, 48.85] } },
      { at: '2026-10-08', geometry: { type: 'Point', coordinates: [2.36, 48.85] } }] });
    api.get.mockResolvedValue({ layer: TRACKED, document: { features: [moved, feature('base')] } });
    const editor = store(); await editor.open(TRACKED);
    // dated, as the editor opens, nothing is held
    expect(editor.dateHolds('front')).toBe('');
    // with no date chosen edits carry none: the shape moved on the 8th is held
    editor.timeMode = 'fix';
    expect(editor.dateHolds('front')).toBe('2026-10-08');
    expect(editor.dateHolds('base')).toBe('');
    editor.heldBack(['front']);
    expect(notify).toHaveBeenLastCalledWith('Front moved on 8 Oct 2026: pick a day on the bar to move it', 'info', 5000);
    editor.select('front'); editor.editGeometry();
    expect(editor.sketch).toBeNull();
    // dated, it moves from that day
    cursorAt = '2026-10-10';
    expect(editor.dateHolds('front')).toBe('');
    editor.timeMode = 'fix';
    expect(editor.held(editor.features.find((one) => one.properties.key === 'front'))).toEqual({ shape: '2026-10-08', status: '' });
  });

  it('adds new features at the cursor, or with no date when edits carry none', async () => {
    const editor = store(); await editor.open(TRACKED);
    cursorAt = '2026-10-12T14:00';
    editor.start(); editor.addPoint({ lat: 50, lon: 30 });
    await editor.whenSaved();
    expect(api.post.mock.calls.at(-1)[1]).toMatchObject({ lat: 50, lon: 30, at: '2026-10-12T14:00' });
    editor.timeMode = 'fix';
    editor.addPoint({ lat: 51, lon: 30 });
    await editor.whenSaved();
    expect(api.post.mock.calls.at(-1)[1]).toMatchObject({ lat: 51, lon: 30 });
    expect(api.post.mock.calls.at(-1)[1].at).toBeUndefined();
    expect(api.post.mock.calls.at(-1)[1].fix).toBeUndefined();
  });

  it('keeps no date for the day it was chosen on, and dates again on the next', async () => {
    const editor = store(); await editor.open(TRACKED);
    cursorAt = '2026-10-12';
    editor.timeMode = 'fix';
    expect(editor.timeMode).toBe('fix');
    cursorAt = '2026-10-20';
    expect(editor.timeMode).toBe('new');
    cursorAt = '2026-10-12';
    expect(editor.timeMode).toBe('fix');
  });

  it('goes to a day to change a feature from it', async () => {
    const editor = store(); await editor.open(TRACKED);
    layers.setTime = vi.fn((name, patch) => { cursorAt = patch.at; });
    cursorAt = '2026-10-12'; editor.timeMode = 'fix';
    editor.changeOn('2026-10-25');
    expect(layers.setTime).toHaveBeenLastCalledWith('working', { at: '2026-10-25' });
    expect(editor.cursor).toBe('2026-10-25');
    cursorAt = '2026-10-12';
    // asked for a change, the mode is dated even back on the day no date was chosen
    expect(editor.timeMode).toBe('new');
  });

  it('says when a feature shows and leaves, drops one state and switches tracking', async () => {
    const editor = store(); await editor.open(TRACKED);
    api.patch.mockResolvedValue({ layer: TRACKED, marker: feature('front') });
    await editor.setStart('front', '');
    expect(api.patch).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/markers/front', { start: '' });
    await editor.setStart('front', '2026-10-03');
    expect(api.patch).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/markers/front', { start: '2026-10-03' });
    await editor.setEnd('front', '2026-10-20');
    expect(api.patch).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/markers/front', { end: '2026-10-20' });
    await editor.setEnd('front', '');
    expect(api.patch).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/markers/front', { end: '' });
    await editor.dropState('front', '2026-10-12');
    expect(api.patch).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/markers/front', { at: '2026-10-12', drop_state: true });
    api.patch.mockResolvedValue({ layer: { ...TRACKED, track: { on: false } } });
    await editor.setTrack({ on: false });
    expect(api.patch).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/edit', { track: { on: false } });
    expect(editor.cursor).toBeNull();
  });
});


describe('Ctrl+Z in the layer editor', () => {
  const at = (key, coordinates) => ({ ...feature(key), geometry: { type: 'Point', coordinates } });

  it('takes back any edit, one step at a time, and makes it again', async () => {
    api.get.mockResolvedValue({ layer: ROW, document: { features: [at('one', [2, 48])] } });
    api.post.mockImplementation(async (path, body) => (path.endsWith('/selection')
      ? { layer: ROW, document: { features: [at('one', [2, 49])] }, kept: 0 }
      : { layer: ROW, document: { features: body.put?.length ? body.put : [at('one', [2, 48])] } }));
    const editor = store(); await editor.open(ROW);
    expect(editor.undo()).toBe(false);
    await editor.moveFeatures(['one'], [0, 1]);
    expect(editor.canUndo).toBe(true);
    expect(editor.undo()).toBe(true);
    await editor.whenSaved(); await editor.whenSaved();
    expect(api.post).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/revert', { put: [at('one', [2, 48])], drop: [] });
    expect(notify).toHaveBeenLastCalledWith('Undone: move', 'ok', 1600);
    expect(editor.canRedo).toBe(true);
    expect(editor.redo()).toBe(true);
    await editor.whenSaved(); await editor.whenSaved();
    expect(api.post).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/revert', { put: [at('one', [2, 49])], drop: [] });
    expect(editor.features[0].geometry.coordinates).toEqual([2, 49]);
  });

  it('gives a selection one first or last day in one request, taken back in one step', async () => {
    const dated = (key, date) => ({ ...feature(key), properties: { ...feature(key).properties, date } });
    api.get.mockResolvedValue({ layer: ROW, document: { features: [dated('one', '2026-09-28'), dated('two', '2026-09-28')] } });
    api.post.mockImplementation(async (path, body) => (path.endsWith('/selection')
      ? { layer: ROW, document: { features: [dated('one', '2026-09-30'), dated('two', '2026-09-30')] } }
      : { layer: ROW, document: { features: body.put ?? [] } }));
    const editor = store(); await editor.open(ROW);
    editor.toggleSelected('one', ['one', 'two']); editor.toggleSelected('two', ['one', 'two'], true);
    await editor.setSelectionWhen({ start: '2026-09-30' });
    expect(api.post).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/selection', { keys: ['one', 'two'], changes: { start: '2026-09-30' } });
    expect(editor.undo()).toBe(true);
    await editor.whenSaved(); await editor.whenSaved();
    expect(api.post).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/revert',
      { put: [dated('one', '2026-09-28'), dated('two', '2026-09-28')], drop: [] });
    expect(editor.canUndo).toBe(false);
    await editor.setSelectionWhen({ end_unknown: true });
    expect(api.post).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/selection', { keys: ['one', 'two'], changes: { end_unknown: true } });
    api.patch.mockResolvedValueOnce({ layer: ROW, marker: dated('one', '2026-09-28') });
    await editor.setEndUnknown('one');
    expect(api.patch).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/markers/one', { end_unknown: true });
  });

  it('brings a removed marker back, and takes back a marker just added', async () => {
    api.get.mockResolvedValue({ layer: ROW, document: { features: [feature('one')] } });
    api.del.mockResolvedValue({ layer: ROW, document: { features: [] }, removed: 'one' });
    api.post.mockResolvedValue({ layer: ROW, document: { features: [feature('one')] } });
    const editor = store(); await editor.open(ROW);
    await editor.remove('one');
    expect(editor.undo()).toBe(true);
    await editor.whenSaved(); await editor.whenSaved();
    expect(api.post).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/revert', { put: [feature('one')], drop: [] });
    // a marker added is dropped by its undo
    api.post.mockResolvedValueOnce({ layer: ROW, marker: feature('two') });
    editor.start();
    editor.addPoint({ lat: 48, lon: 2 });
    await editor.whenSaved();
    expect(editor.undo()).toBe(true);
    await editor.whenSaved(); await editor.whenSaved();
    expect(api.post).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/revert', { put: [], drop: ['two'] });
  });

  it('says how many features a group with one colour recolours, and nothing for an icon it leaves to them', async () => {
    const groups = [{ id: 'g', name: 'Posts', mode: 'colour', colour: '#0072b2', symbol: 'pin' }];
    api.get.mockResolvedValue({ layer: ROW, document: { features: [feature('a'), feature('b')].map((one) => ({ ...one, properties: { ...one.properties, group: 'g' } })) }, groups });
    const editor = store(); await editor.open(ROW);
    api.patch.mockResolvedValueOnce({ layer: ROW, groups });
    notify.mockClear();
    await editor.updateGroup('g', { symbol: 'flag' });
    expect(notify.mock.calls.some(([text]) => String(text).startsWith('Restyled'))).toBe(false);
    api.patch.mockResolvedValueOnce({ layer: ROW, groups: [{ ...groups[0], colour: '#d55e00' }] });
    await editor.updateGroup('g', { colour: '#d55e00' });
    expect(notify.mock.calls.at(-1)[0]).toBe('Restyled the 2 features of Posts');
  });

  it('says how many features a group with one style restyles, and takes the style back', async () => {
    const groups = [{ id: 'g', name: 'Posts', mode: 'uniform', colour: '#0072b2', symbol: 'pin' }];
    api.get.mockResolvedValue({ layer: ROW, document: { features: [feature('a'), feature('b')].map((one) => ({ ...one, properties: { ...one.properties, group: 'g' } })) }, groups });
    api.patch.mockResolvedValueOnce({ layer: ROW, groups: [{ ...groups[0], colour: '#d55e00' }] });
    const editor = store(); await editor.open(ROW);
    await editor.updateGroup('g', { colour: '#d55e00' });
    const [text, , , action] = notify.mock.calls.at(-1);
    expect(text).toBe('Restyled the 2 features of Posts');
    api.patch.mockResolvedValueOnce({ layer: ROW, groups });
    await action.onClick();
    await editor.whenSaved();
    expect(api.patch).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/groups/g', { colour: '#0072b2' });
  });
});

describe('what an edit changed', () => {
  it('is the features to put back and the ones to drop, each way, and the group settings it moved', () => {
    const a = { properties: { key: 'a' }, geometry: { type: 'Point', coordinates: [0, 0] } };
    const moved = { ...a, geometry: { type: 'Point', coordinates: [1, 1] } };
    const b = { properties: { key: 'b' }, geometry: { type: 'Point', coordinates: [2, 2] } };
    const change = difference([a], [moved, b], [{ id: 'g', size: 1, labels: true }], [{ id: 'g', size: 2 }]);
    expect(change.undo).toEqual({ put: [a], drop: ['b'], addGroups: [], dropGroups: [] });
    expect(change.redo).toEqual({ put: [moved, b], drop: [], addGroups: [], dropGroups: [] });
    expect(change.groups).toEqual([{ id: 'g', back: { size: 1, labels: true }, forth: { size: 2, labels: false } }]);
    expect(difference([a], [a])).toBeNull();
  });

  it('draws a circle and a box from two points', () => {
    const box = shapeRing('rect', [0, 0], [1, 2]);
    expect(box).toEqual([[0, 0], [1, 0], [1, 2], [0, 2]]);
    const round = shapeRing('circle', [10, 20], [10.01, 20]);
    expect(round).toHaveLength(64);
    expect(round[0][1]).toBeCloseTo(20 + 0.0094, 3);
  });

  it('closes a circle or a box as drawn out to the pointer, never on its first spot again', async () => {
    const editor = store(); await editor.open(ROW);
    editor.startShape('Rectangle');
    editor.addPoint({ lon: 2, lat: 48 });
    expect(editor.complete).toBe(false);
    // a second press on the first spot, or a box flat as a line, encloses nothing
    editor.addPoint({ lon: 2, lat: 48 });
    expect(editor.sketch.anchor).toEqual([2, 48]);
    editor.preview({ lon: 2, lat: 49 });
    expect(editor.complete).toBe(false);
    // drawn out, it is whole: Enter or Save takes it as it stands
    editor.preview({ lon: 3, lat: 49 });
    expect(editor.complete).toBe(true);
    await editor.saveGeometry();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/shapes', expect.objectContaining({
      geometry: { type: 'Polygon', coordinates: [[[2, 48], [3, 48], [3, 49], [2, 49], [2, 48]]] },
    }));
    expect(editor.sketch).toBeNull();
    // the second press closes and saves it too
    editor.startShape('Circle');
    editor.addPoint({ lon: 2, lat: 48 }); editor.addPoint({ lon: 2.01, lat: 48 });
    await editor.whenSaved();
    expect(api.post.mock.calls.at(-1)[1].geometry.coordinates[0]).toHaveLength(65);
    expect(editor.sketch).toBeNull();
  });

  it('puts down a drawing tool with nothing drawn on Done, and keeps a half-drawn shape with a reason', async () => {
    const editor = store(); await editor.open(ROW);
    editor.startShape('Circle'); editor.addPoint({ lon: 2, lat: 48 });
    expect(await editor.done()).toBe(false);
    expect(notify).toHaveBeenCalledWith('Finish the shape, or Esc to drop it', 'danger', 4000);
    expect(editor.sketch).not.toBeNull();
    editor.startShape('Rectangle');
    expect(await editor.done()).toBe(true);
    expect(api.post).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/edit/finish', expect.anything());
    expect(editor.editor).toBeNull();
  });

  it('reads the cursor ticks from the features it holds, not from a map that drew the layer', async () => {
    const tracked = feature('m1', { states: [{ at: '2026-10-14', status: 'damaged' }, { at: '2026-08-24' }] });
    api.get.mockResolvedValueOnce({ layer: { ...ROW, track: { on: true } }, document: { features: [tracked, feature('m2', { date: '2026-09-01' })] } });
    const editor = store(); await editor.open(ROW);
    expect(editor.moments).toEqual(['2026-08-24', '2026-09-01', '2026-10-14']);
  });

  it('opens on today, wherever an earlier press left the layer cursor, and holds that moment', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-16T09:15:00Z'));
    let at = '2026-09-01';
    layers.time = () => ({ at });
    layers.setTime = vi.fn((name, patch) => { at = patch.at; });
    api.get.mockResolvedValueOnce({ layer: { ...ROW, track: { on: true, precision: 'time', zone: 'Europe/Paris' } }, document: { features: [] } });
    const editor = store(); await editor.open(ROW);
    expect(layers.setTime).toHaveBeenCalledWith('working', { at: null });
    // on a layer dated to the minute, the edits of one sitting share the minute it opened at
    expect(editor.cursor).toBe('2026-10-16T11:15');
    vi.setSystemTime(new Date('2026-10-16T09:47:00Z'));
    expect(editor.cursor).toBe('2026-10-16T11:15');
    vi.useRealTimers();
  });

  it('dates a feature copied in from elsewhere to the day its layer is on, unless it has its own', async () => {
    const editor = store();
    const target = { ...ROW, name: 'front', title: 'Front', track: { on: true, precision: 'day', zone: 'UTC' } };
    layers.time = () => ({ at: '2026-10-12' });
    api.post.mockResolvedValue({ layer: target });
    editor.copy({ name: 'other', editable: false, title: 'Other' },
      { geometry: { type: 'Point', coordinates: [30, 50] }, properties: { name: 'Seen' } });
    await editor.copyTo(target);
    expect(api.post.mock.calls.at(-1)[1]).toMatchObject({ lat: 50, lon: 30, at: '2026-10-12' });
    editor.copy({ name: 'other', editable: false, title: 'Other' },
      { geometry: { type: 'Point', coordinates: [30, 50] }, properties: { name: 'Dated', date: '2026-10-02' } });
    await editor.copyTo(target);
    expect(api.post.mock.calls.at(-1)[1]).toMatchObject({ date: '2026-10-02' });
    expect(api.post.mock.calls.at(-1)[1].at).toBeUndefined();
  });
});

describe('the history of a shape being drawn', () => {
  it('takes back corners added, moved, put in and taken out, one at a time, and makes them again', async () => {
    const editor = store(); await editor.open(ROW);
    editor.startShape('Polygon');
    editor.addPoint({ lon: 0, lat: 0 });
    editor.addPoint({ lon: 1, lat: 0 });
    editor.addPoint({ lon: 1, lat: 1 });
    // a corner dragged is one step, however many moves the drag makes
    editor.beginVertexMove();
    editor.moveVertex(0, 1, { lon: 2, lat: 0 });
    editor.moveVertex(0, 1, { lon: 3, lat: 0 });
    editor.insertVertex(0, 1, { lon: 0.5, lat: 0 });
    const corners = () => editor.sketch.rings[0].map(([lon]) => lon);
    expect(corners()).toEqual([0, 0.5, 3, 1]);
    expect(editor.undoSketch()).toBe(true);
    expect(corners()).toEqual([0, 3, 1]);
    expect(editor.undoSketch()).toBe(true);
    expect(corners()).toEqual([0, 1, 1]);
    expect(editor.undoSketch()).toBe(true);
    expect(corners()).toEqual([0, 1]);
    expect(editor.redoSketch()).toBe(true);
    expect(editor.redoSketch()).toBe(true);
    expect(corners()).toEqual([0, 3, 1]);
    // a new change drops what was taken back
    editor.removeVertex(0, 0);
    expect(editor.canRedoSketch).toBe(false);
    expect(editor.canUndoSketch).toBe(true);
    // the layer's own edits are not touched by a shape's undo
    expect(api.post).not.toHaveBeenCalledWith(expect.stringContaining('/revert'), expect.anything());
  });
});


describe('an edit made on the map', () => {
  const at = (key, lon, lat, properties = {}) => ({ ...feature(key, properties), geometry: { type: 'Point', coordinates: [lon, lat] } });
  const area = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: { key: 'zone', name: 'Zone' } };
  const line = { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { key: 'road', name: 'Road' } };
  const where = (editor, key) => editor.features.find((item) => item.properties.key === key);
  beforeEach(() => {
    api.get.mockResolvedValue({ layer: { ...ROW, sha256: 'a' }, document: { features: [at('a', 2, 48), at('b', 5, 50), area, line] } });
  });

  it('stands where it was let go before the save answers, and once saved is not moved twice', async () => {
    const editor = store(); await editor.open(ROW);
    const answer = deferred();
    api.post.mockReturnValueOnce(answer.promise);
    editor.drag(['a'], [1, 0]);
    const moving = editor.moveFeatures(['a'], [1, 0]);
    expect(where(editor, 'a').geometry.coordinates).toEqual([3, 48]);
    expect(where(editor, 'b').geometry.coordinates).toEqual([5, 50]);
    const [landing] = editor.landings;
    expect(landing).toMatchObject({ name: 'working', keys: ['a'], offset: [1, 0], saved: false });
    // the dragged copies stay over it, now standing where it landed
    expect(editor.dragging.landing).toBe(landing);
    answer.resolve({ layer: { ...ROW, sha256: 'b' }, document: { features: [at('a', 3, 48), at('b', 5, 50), area, line] }, kept: 0 });
    await moving;
    expect(where(editor, 'a').geometry.coordinates).toEqual([3, 48]);
    expect(landing).toMatchObject({ saved: true, sha: 'b' });
    expect(editor.landings).toEqual([]);
    // no map drew it, so the copies went with the answer
    expect(editor.dragging).toBeNull();
  });

  it('keeps the dragged copies until the map drawing it has, and goes back when the layer refuses', async () => {
    const editor = store(); await editor.open(ROW);
    const answer = deferred();
    api.post.mockReturnValueOnce(answer.promise);
    editor.drag(['a'], [1, 0]);
    const moving = editor.moveFeatures(['a'], [1, 0]);
    const [landing] = editor.landings;
    editor.claim(landing);
    answer.resolve({ layer: { ...ROW, sha256: 'b' }, document: { features: [at('a', 3, 48)] } });
    await moving;
    expect(editor.dragging.landing).toBe(landing);
    editor.landed(landing);
    expect(editor.dragging).toBeNull();

    api.post.mockRejectedValueOnce(new Error('keep the selection inside valid coordinates'));
    editor.drag(['a'], [500, 0]);
    await editor.moveFeatures(['a'], [500, 0]);
    expect(where(editor, 'a').geometry.coordinates).toEqual([3, 48]);
    expect(editor.landings).toEqual([]);
    expect(editor.dragging).toBeNull();
    expect(notify).toHaveBeenCalledWith('keep the selection inside valid coordinates', 'danger', 5000);
  });

  it('draws a reshaped shape as it saves, and a refused one back as it was, its outline kept', async () => {
    const editor = store(); await editor.open(ROW);
    editor.select('zone'); editor.editGeometry();
    editor.beginVertexMove(); editor.moveVertex(0, 1, { lon: 2, lat: 0 });
    api.patch.mockRejectedValueOnce(new Error('The layer is busy'));
    const saving = editor.saveGeometry();
    expect(where(editor, 'zone').geometry.coordinates).toEqual([[[0, 0], [2, 0], [1, 1], [0, 0]]]);
    await saving;
    expect(where(editor, 'zone').geometry).toEqual(area.geometry);
    expect(editor.sketch.rings[0][1]).toEqual([2, 0]);
  });

  it('moves a selection by its handle at once, leaving the markers that follow a case item on it', async () => {
    api.get.mockResolvedValue({ layer: ROW, document: { features: [at('a', 2, 48), at('kept', 4, 49, { entity_id: 'place-1' })] } });
    const editor = store(); await editor.open(ROW);
    editor.chooseKeys(['a', 'kept']); editor.moveSelection();
    editor.moveVertex(0, 0, { lon: editor.sketch.origin[0] + 1, lat: editor.sketch.origin[1] });
    const answer = deferred();
    api.post.mockReturnValueOnce(answer.promise);
    const saving = editor.saveGeometry();
    expect(editor.landings[0].keys).toEqual(['a']);
    expect(where(editor, 'a').geometry.coordinates).toEqual([3, 48]);
    expect(where(editor, 'kept').geometry.coordinates).toEqual([4, 49]);
    answer.resolve({ layer: ROW, document: { features: [at('a', 3, 48), at('kept', 4, 49, { entity_id: 'place-1' })] }, kept: 1 });
    await saving;
    expect(editor.sketch).toBeNull();
  });

  it('turns a marker at once, the sheet with it, and back when the layer refuses', async () => {
    const editor = store(); await editor.open(ROW);
    editor.select('a');
    const answer = deferred();
    api.patch.mockReturnValueOnce(answer.promise);
    const aiming = editor.aim('a', 90);
    expect(where(editor, 'a').properties.bearing).toBe(90);
    expect(editor.form.bearing).toBe(90);
    // nothing left in the sheet to save back over it
    expect(editor.formChanged).toBe(false);
    answer.reject(new Error('The layer is busy'));
    await aiming;
    expect(api.patch).toHaveBeenCalledWith('/api/cases/first/map-layers/working/markers/a', { bearing: 90 });
    expect(where(editor, 'a').properties.bearing).toBeUndefined();
    expect(editor.form.bearing).toBe('');
    expect(editor.formChanged).toBe(false);
  });

  it('adds no corner to an area being reshaped on a click, where a line being reshaped grows', async () => {
    const editor = store(); await editor.open(ROW);
    editor.select('zone'); editor.editGeometry();
    expect(editor.addPoint({ lon: 9, lat: 9 })).toBe(true);
    expect(editor.sketch.rings).toEqual([[[0, 0], [1, 0], [1, 1]]]);
    expect(editor.canUndoSketch).toBe(false);
    editor.select('road'); editor.editGeometry();
    editor.addPoint({ lon: 2, lat: 2 });
    expect(editor.sketch.rings).toEqual([[[0, 0], [1, 1], [2, 2]]]);
  });
});

describe('the edits around an undo', () => {
  const at = (key, coordinates, extra = {}) => ({ ...feature(key, extra), geometry: { type: 'Point', coordinates } });

  it('takes back the edit still saving when Ctrl+Z is pressed, not the one before it', async () => {
    let held = [at('a', [1, 48]), at('b', [2, 48])];
    const move = deferred();
    api.get.mockResolvedValue({ layer: ROW, document: { features: held } });
    api.patch.mockImplementation(async () => {
      held = [at('a', [1, 48], { name: 'Renamed' }), held[1]];
      return { layer: ROW, document: { features: held } };
    });
    api.post.mockImplementation(async (path, body) => {
      if (path.endsWith('/selection')) {
        await move.promise;
        held = [held[0], at('b', [7, 48])];
        return { layer: ROW, document: { features: held }, kept: 0 };
      }
      return { layer: ROW, document: { features: held } };
    });
    const editor = store(); await editor.open(ROW);
    editor.select('a'); editor.form.name = 'Renamed'; await editor.saveForm();
    const moving = editor.moveFeatures(['b'], [5, 0]);
    // the move is drawn where it landed and still saving: Ctrl+Z means it
    expect(editor.undo()).toBe(true);
    move.resolve(); await moving; await editor.whenSaved();
    const revert = api.post.mock.calls.find(([path]) => path.endsWith('/revert'));
    expect(revert[1].put).toEqual([at('b', [2, 48])]);
    expect(editor.canUndo).toBe(true);
    expect(editor.canRedo).toBe(true);
  });

  it('makes again an undo still saving when Ctrl+Y follows it at once', async () => {
    api.get.mockResolvedValue({ layer: ROW, document: { features: [at('one', [2, 48])] } });
    api.post.mockImplementation(async (path, body) => (path.endsWith('/selection')
      ? { layer: ROW, document: { features: [at('one', [2, 49])] }, kept: 0 }
      : { layer: ROW, document: { features: body.put?.length ? body.put : [at('one', [2, 48])] } }));
    const editor = store(); await editor.open(ROW);
    await editor.moveFeatures(['one'], [0, 1]);
    expect(editor.undo()).toBe(true);
    expect(editor.redo()).toBe(true);
    await editor.whenSaved();
    expect(api.post.mock.calls.filter(([path]) => path.endsWith('/revert')).map(([, body]) => body.put[0].geometry.coordinates))
      .toEqual([[2, 48], [2, 49]]);
    expect(editor.features[0].geometry.coordinates).toEqual([2, 49]);
  });

  it('brings a group taken out back where it stood, with its features, and takes a new group back out', async () => {
    const groups = [{ id: 'g1', name: 'Markers', mode: 'individual', colour: '#0072b2', symbol: 'pin' },
      { id: 'g2', name: 'Strikes', mode: 'uniform', colour: '#d55e00', symbol: 'badge-blast', labels: true }];
    const struck = feature('s', { group: 'g2' });
    api.get.mockResolvedValue({ layer: ROW, document: { features: [struck] }, groups });
    api.del.mockResolvedValue({ layer: ROW, document: { features: [{ ...struck, properties: { ...struck.properties, group: 'g1', colour: '#d55e00' } }] },
      groups: [groups[0]] });
    api.post.mockResolvedValue({ layer: ROW, document: { features: [struck] }, groups });
    const editor = store(); await editor.open(ROW);
    await editor.removeGroup('g2');
    expect(notify.mock.calls.at(-1)[0]).toBe('Strikes ungrouped into Markers');
    expect(editor.undo()).toBe(true);
    await editor.whenSaved();
    expect(api.post).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/revert',
      { put: [struck], drop: [], groups: [{ ...groups[1], at: 1 }], drop_groups: [] });
    expect(editor.groups.map((group) => group.name)).toEqual(['Markers', 'Strikes']);
    // a group just made goes on Undo, its redo making it again
    api.post.mockResolvedValueOnce({ layer: ROW, document: { features: [struck] }, groups: [...groups, { id: 'g3', name: 'New', mode: 'uniform' }],
      group: { id: 'g3', name: 'New' } });
    await editor.addGroup('New');
    expect(editor.undo()).toBe(true);
    await editor.whenSaved();
    expect(api.post).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/revert', { put: [], drop: [], groups: [], drop_groups: ['g3'] });
  });
});

describe('leaving a layer for another', () => {
  it('saves its sheet and ends its session before the other opens, so a later Discard goes back no further', async () => {
    const other = { ...ROW, name: 'other', title: 'Other map' };
    api.get.mockImplementation(async (path) => ({ layer: { ...(path.includes('/other/') ? other : ROW), edit_revision: 'b'.repeat(64) },
      document: { features: [feature('m1')] }, checkpoint: 'c'.repeat(32) }));
    api.patch.mockResolvedValue({ layer: ROW, marker: feature('m1', { name: 'Typed' }) });
    api.post.mockResolvedValue({ layer: ROW });
    const editor = store(); await editor.open(ROW);
    editor.select('m1'); editor.form.name = 'Typed';
    await editor.open(other);
    await editor.whenSaved();
    expect(api.patch).toHaveBeenCalledWith('/api/cases/first/map-layers/working/markers/m1', { name: 'Typed' });
    expect(api.post).toHaveBeenCalledWith('/api/cases/first/map-layers/working/edit/finish',
      { token: 'c'.repeat(32), revision: 'b'.repeat(64), discard: false });
    expect(editor.editor.name).toBe('other');
  });

  it('ends the session of a layer left for another case', async () => {
    api.get.mockResolvedValue({ layer: { ...ROW, edit_revision: 'b'.repeat(64) }, document: { features: [] }, checkpoint: 'c'.repeat(32) });
    api.post.mockResolvedValue({ layer: ROW });
    const editor = store(); await editor.open(ROW);
    owner = 'second';
    editor.leave();
    expect(editor.editor).toBeNull();
    await editor.whenSaved();
    expect(api.post).toHaveBeenCalledWith('/api/cases/first/map-layers/working/edit/finish',
      { token: 'c'.repeat(32), revision: 'b'.repeat(64), discard: false });
  });

  it('follows a new layer over time from the start when asked', async () => {
    api.get.mockResolvedValue({ layer: ROW, document: { features: [] }, checkpoint: 'c'.repeat(32) });
    api.patch.mockResolvedValue({ layer: { ...ROW, track: { on: true, zone: 'Asia/Aden' } } });
    const editor = store();
    await editor.create('Front', null, '', { on: true, zone: 'Asia/Aden' });
    expect(api.patch).toHaveBeenCalledWith('/api/cases/first/map-layers/working/edit', { track: { on: true, zone: 'Asia/Aden' } });
    expect(editor.editor.track).toEqual({ on: true, zone: 'Asia/Aden' });
  });
});
