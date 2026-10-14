// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMyLayersState } from './myLayers.svelte.js';

const ROW = { name: 'working', title: 'Working map', editable: true, features: 0 };
const feature = (key, properties = {}) => ({ type: 'Feature',
  geometry: { type: 'Point', coordinates: [2.35, 48.85] },
  properties: { key, name: key, colour: '#0072b2', symbol: 'pin', ...properties } });
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
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
    await editor.update('m1', { name: 'Draft title' });
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
    await editor.update('m1', { name: 'Changed' });
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
    expect(api.post).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/selection/merge-1/restore', {});
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

  it('saves only what the sheet changed, and clears a field with nothing', async () => {
    api.get.mockResolvedValueOnce({ layer: ROW, document: { features: [feature('m1', { status: 'damaged', date: '2026-01-02' })] } });
    const editor = store(); await editor.open(ROW); editor.select('m1');
    editor.form.status = ''; editor.form.links = ['  ', 'https://a.example/x '];
    expect(editor.formChanged).toBe(true);
    api.patch.mockResolvedValueOnce({ layer: ROW, marker: feature('m1') });
    await editor.saveForm();
    expect(api.patch).toHaveBeenCalledWith('/api/cases/first/map-layers/working/markers/m1',
      { status: null, links: ['https://a.example/x'] });
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
    expect(api.post).toHaveBeenCalledWith('/api/cases/first/map-layers/working/markers/m1/restore', {});
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

  it('edits plainly at now, so a feature is corrected rather than given a state', async () => {
    const editor = store(); await editor.open(TRACKED);
    expect(editor.cursor).toBeNull();
    await editor.moveFeatures(['front'], [0, 1]);
    expect(api.post).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/selection', { keys: ['front'], offset: [0, 1] });
  });

  it('dates a move to the cursor, or corrects the state in force when set to fix', async () => {
    const editor = store(); await editor.open(TRACKED);
    cursorAt = '2026-10-12';
    expect(editor.cursor).toBe('2026-10-12');
    await editor.moveFeatures(['front'], [0, 1]);
    expect(api.post).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/selection', { keys: ['front'], offset: [0, 1], at: '2026-10-12' });
    editor.timeMode = 'fix';
    api.patch.mockResolvedValue({ layer: TRACKED, marker: feature('front') });
    await editor.update('front', { name: 'kept' });
    editor.select('front'); editor.form.status = 'destroyed';
    await editor.saveForm();
    expect(api.patch).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/markers/front', { status: 'destroyed', at: '2026-10-12', fix: true });
  });

  it('adds new features at the cursor whatever the mode', async () => {
    const editor = store(); await editor.open(TRACKED);
    cursorAt = '2026-10-12T14:00'; editor.timeMode = 'fix';
    editor.start(); editor.addPoint({ lat: 50, lon: 30 });
    await editor.whenSaved();
    expect(api.post.mock.calls.at(-1)[1]).toMatchObject({ lat: 50, lon: 30, at: '2026-10-12T14:00' });
    expect(api.post.mock.calls.at(-1)[1].fix).toBeUndefined();
  });

  it('says a feature is gone from the cursor, drops one state and switches tracking', async () => {
    const editor = store(); await editor.open(TRACKED);
    api.patch.mockResolvedValue({ layer: TRACKED, marker: feature('front') });
    expect(await editor.markGone('front')).toBeNull();
    cursorAt = '2026-10-20';
    await editor.markGone('front');
    expect(api.patch).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/markers/front', { at: '2026-10-20', gone: true });
    await editor.dropState('front', '2026-10-12');
    expect(api.patch).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/markers/front', { at: '2026-10-12', drop_state: true });
    api.patch.mockResolvedValue({ layer: { ...TRACKED, track: { on: false } } });
    await editor.setTrack({ on: false });
    expect(api.patch).toHaveBeenLastCalledWith('/api/cases/first/map-layers/working/edit', { track: { on: false } });
    expect(editor.cursor).toBeNull();
  });
});

