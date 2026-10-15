// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const made = vi.hoisted(() => []);
vi.mock('../../lib/map/addedLayer.js', () => ({
  createAddedLayer: vi.fn((engine, options) => {
    const layer = { options, set: vi.fn(async () => {}), filter: vi.fn(), destroy: vi.fn(), interactive: vi.fn(),
      floor: () => null, stackUnder: vi.fn(), hide: vi.fn(), reveal: vi.fn(), feature: vi.fn() };
    made.push(layer);
    return layer;
  }),
}));
import AddedLayersOverlay from './AddedLayersOverlay.svelte';

let held = null;
afterEach(() => { if (held) unmount(held); held = null; made.length = 0; });
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
});
