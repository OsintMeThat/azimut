// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const made = vi.hoisted(() => []);
vi.mock('../../lib/map/addedLayer.js', () => ({
  createAddedLayer: vi.fn((engine, options) => {
    const layer = { options, set: vi.fn(async () => {}), filter: vi.fn(), destroy: vi.fn(), interactive: vi.fn(),
      floor: () => null, stackUnder: vi.fn(), hide: vi.fn(), reveal: vi.fn(), feature: vi.fn(), drawn: vi.fn(async () => {}) };
    made.push(layer);
    return layer;
  }),
}));
// the editor every map shares, reduced to what a map reads off it and tells it
const editor = vi.hoisted(() => ({ claim: null, landed: null }));
vi.mock('../../lib/map/personalLayers.svelte.js', () => ({ personalLayers: editor }));
import AddedLayersOverlay from './AddedLayersOverlay.svelte';

let landings = $state.raw([]);
let dragging = $state.raw(null);
let edited = $state.raw(null);
Object.defineProperties(editor, { landings: { get: () => landings }, dragging: { get: () => dragging }, editor: { get: () => edited } });
editor.claim = vi.fn((landing) => { landing.claimed = true; });
editor.landed = vi.fn();

let held = null;
afterEach(() => { if (held) unmount(held); held = null; made.length = 0; landings = []; dragging = null; edited = null; vi.clearAllMocks(); });
const settle = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); flushSync(); };

describe('the layers drawn on a map', () => {
  it('redraws an edited layer in place, and builds it again only when what it is built for changes', async () => {
    const props = $state({ layers: [{ name: 'front', title: 'Front', editable: true, sha256: 'a', hidden: [], categories: [] }] });
    const engine = { impl: { once: (event, run) => run() } };
    const drawing = vi.fn(async () => ({ type: 'FeatureCollection', features: [] }));
    held = mount(AddedLayersOverlay, { target: document.body, props: {
      engine, caseId: 'case', drawing, get layers() { return props.layers; } } });
    await settle();
    expect(made).toHaveLength(1);
    expect(made[0].options.history).toBe(false);
    // an edit: new bytes, same layer
    props.layers = [{ ...props.layers[0], sha256: 'b' }];
    await settle();
    expect(made).toHaveLength(1);
    expect(made[0].destroy).not.toHaveBeenCalled();
    expect(made[0].set).toHaveBeenCalledTimes(2);
    expect(drawing).toHaveBeenCalledTimes(2);
    // switched to tracked: the past needs engine layers of its own
    props.layers = [{ ...props.layers[0], sha256: 'c', track: { on: true } }];
    await settle();
    expect(made).toHaveLength(2);
    expect(made[0].destroy).toHaveBeenCalled();
    expect(made[1].options.history).toBe(true);
  });

  it('opens no card on the layer being edited, whose clicks pick in the editor, and gives them back after', async () => {
    const rows = [{ name: 'front', title: 'Front', editable: true, sha256: 'a', hidden: [], categories: [] },
      { name: 'other', title: 'Other', editable: true, sha256: 'b', hidden: [], categories: [] }];
    held = mount(AddedLayersOverlay, { target: document.body, props: {
      engine: { impl: { once: (event, run) => run() } }, caseId: 'case', drawing: vi.fn(async () => ({ type: 'FeatureCollection', features: [] })), layers: rows } });
    await settle();
    const [front, other] = made;
    expect(front.interactive).toHaveBeenLastCalledWith(true);
    edited = { name: 'front' }; await settle();
    expect(front.interactive).toHaveBeenLastCalledWith(false);
    expect(other.interactive).toHaveBeenLastCalledWith(true);
    edited = null; await settle();
    expect(front.interactive).toHaveBeenLastCalledWith(true);
  });

  describe('an edit let go on the map', () => {
    const pin = (lon) => ({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, 48] }, properties: { key: 'k', index: 0 } }] });
    const where = (call) => call[0].features[0].geometry.coordinates;
    async function drawn(read = pin(2)) {
      const props = $state({ layers: [{ name: 'front', title: 'Front', editable: true, sha256: 'a', hidden: [], categories: [] }] });
      const drawing = vi.fn(async () => read);
      held = mount(AddedLayersOverlay, { target: document.body, props: {
        engine: { impl: { once: (event, run) => run() } }, caseId: 'case', drawing, get layers() { return props.layers; } } });
      await settle();
      return { props, drawing, layer: made[0] };
    }

    it('is drawn where it landed at once, the dragged copies going once it is on screen', async () => {
      const { layer } = await drawn();
      dragging = { name: 'front', keys: ['k'], offset: [1, 0] };
      await settle();
      expect(layer.hide).toHaveBeenLastCalledWith(['k']);
      const landing = { name: 'front', keys: ['k'], offset: [1, 0], saved: false, sha: null };
      landings = [landing]; dragging = { ...dragging, landing };
      await settle();
      expect(where(layer.set.mock.calls.at(-1))).toEqual([3, 48]);
      // let back with the data that puts it there, never before it
      expect(layer.set.mock.calls.at(-1)[1].held).toEqual([]);
      expect(layer.hide).toHaveBeenLastCalledWith(['k']);
      expect(editor.claim).toHaveBeenCalledWith(landing);
      expect(layer.drawn).toHaveBeenCalled();
      expect(editor.landed).toHaveBeenCalledWith(landing);
    });

    it('stops drawing a saved one once a read of the layer holds it, never moving it twice', async () => {
      const { props, drawing, layer } = await drawn();
      const landing = { name: 'front', keys: ['k'], offset: [1, 0], saved: false, sha: null };
      landings = [landing];
      await settle();
      drawing.mockResolvedValue(pin(3));
      landing.saved = true; landing.sha = 'b';
      props.layers = [{ ...props.layers[0], sha256: 'b' }];
      await settle();
      landings = [];
      await settle();
      expect(where(layer.set.mock.calls.at(-1))).toEqual([3, 48]);
    });

    it('goes back when the layer refuses it, or saves it without changing anything', async () => {
      const { layer } = await drawn();
      const refused = { name: 'front', keys: ['k'], offset: [1, 0], saved: false, sha: null };
      landings = [refused];
      await settle();
      landings = [];
      await settle();
      expect(where(layer.set.mock.calls.at(-1))).toEqual([2, 48]);
      const same = { name: 'front', keys: ['k'], offset: [0, 0], properties: { bearing: 90 }, saved: false, sha: null };
      landings = [same];
      await settle();
      expect(layer.set.mock.calls.at(-1)[0].features[0].properties.bearing).toBe(90);
      // the layer as this map read it: the save changed nothing it does not already draw
      same.saved = true; same.sha = 'a';
      landings = [];
      await settle();
      expect(layer.set.mock.calls.at(-1)[0].features[0].properties.bearing).toBeUndefined();
    });

    it('lets the dragged copies go when the map goes', async () => {
      await drawn();
      const landing = { name: 'front', keys: ['k'], offset: [1, 0], saved: false, sha: null };
      landings = [landing];
      await settle();
      editor.landed.mockClear();
      unmount(held); held = null;
      expect(editor.landed).toHaveBeenCalledWith(landing);
    });
  });
});
