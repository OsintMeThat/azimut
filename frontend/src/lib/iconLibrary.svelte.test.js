import { describe, expect, it, vi } from 'vitest';
import { createIconLibrary } from './iconLibrary.svelte.js';

const TANK = { key: 'aaaaaaaaaaaaaaaa', name: 'Tank', group: 'Armour', mode: 'disc', aliases: ['cccccccccccccccc'] };
const FLAG = { key: 'bbbbbbbbbbbbbbbb', name: 'Flag', group: 'My icons', mode: 'image' };

function library(answers = {}) {
  const api = {
    get: vi.fn(async (path) => (path === '/api/icons' ? { icons: [TANK, FLAG], max: 1000 } : answers[path] ?? [])),
    post: vi.fn(async (path, body) => answers[path] ?? { icons: [], removed: body?.keys?.length ?? 0 }),
    patch: vi.fn(async (_path, changes) => ({ ...TANK, ...changes })),
  };
  return { api, store: createIconLibrary({ api }) };
}

describe('the icon library', () => {
  it('is read once, whoever asks', async () => {
    const { api, store } = library();
    await Promise.all([store.load(), store.load()]);
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(store.icons.map((icon) => icon.name)).toEqual(['Tank', 'Flag']);
    expect(store.groups).toEqual(['Armour', 'My icons']);
  });

  it('knows a picture by its key, or by the hash a layer stored it under', async () => {
    const { store } = library();
    await store.load();
    expect(store.holds('aaaaaaaaaaaaaaaa')).toBe(true);
    expect(store.holds('dddddddddddddddd', 'cccccccccccccccc')).toBe(true);
    expect(store.holds('dddddddddddddddd', 'eeeeeeeeeeeeeeee')).toBe(false);
  });

  it("draws a preview from the library when it holds the icon, else from the layer's copy", async () => {
    const { store } = library();
    await store.load();
    expect(store.look('aaaaaaaaaaaaaaaa', { caseId: 'c', layer: 'Mine' })).toEqual(
      { key: 'aaaaaaaaaaaaaaaa', src: '/api/icons/aaaaaaaaaaaaaaaa.png', mode: 'disc', name: 'Tank' });
    expect(store.look('ffffffffffffffff', { caseId: 'c', layer: 'My map' }).src)
      .toBe('/api/cases/c/map-layers/My%20map/icons/ffffffffffffffff');
    // how the layer draws it is what the layer shows
    expect(store.look('aaaaaaaaaaaaaaaa', { meta: { aaaaaaaaaaaaaaaa: { mode: 'image' } } }).mode).toBe('image');
    expect(store.look('')).toBeNull();
  });

  it('keeps what an edit answered, and what a removal leaves', async () => {
    const { api, store } = library({ '/api/icons/remove': { icons: [FLAG], removed: 1 } });
    await store.load();
    await store.update('aaaaaaaaaaaaaaaa', { mode: 'image' });
    expect(api.patch).toHaveBeenCalledWith('/api/icons/aaaaaaaaaaaaaaaa', { mode: 'image' });
    expect(store.find('aaaaaaaaaaaaaaaa').mode).toBe('image');
    expect(await store.remove(['aaaaaaaaaaaaaaaa'])).toBe(1);
    expect(store.icons).toEqual([FLAG]);
  });

  it("reads a layer's icons when asked, and survives an answer that is not a list", async () => {
    const path = '/api/cases/c/map-layers/Mine/icons';
    const { store } = library({ [path]: [{ key: 'ffffffffffffffff', digest: 'x', mode: 'image', name: '', count: 2 }] });
    expect(store.layerIcons('c', 'Mine')).toEqual([]);
    await store.loadLayer('c', 'Mine');
    expect(store.layerIcons('c', 'Mine')).toHaveLength(1);
    const odd = library({ [path]: { detail: 'no' } }).store;
    await odd.loadLayer('c', 'Mine');
    expect(odd.layerIcons('c', 'Mine')).toEqual([]);
  });

  it("files a layer's icons and takes the library it answers with", async () => {
    const path = '/api/cases/c/map-layers/Their%20map/icons/library';
    const { api, store } = library({ [path]: { added: [FLAG], already: 0, icons: [TANK, FLAG] } });
    await store.fromLayer('c', 'Their map', ['bbbbbbbbbbbbbbbb']);
    expect(api.post).toHaveBeenCalledWith(path, { keys: ['bbbbbbbbbbbbbbbb'] });
    expect(store.icons).toHaveLength(2);
  });
});
