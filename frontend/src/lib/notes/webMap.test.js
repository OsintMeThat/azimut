import { describe, expect, it, vi } from 'vitest';

vi.mock('../api.js', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn(), patch: vi.fn() } }));
vi.mock('../state.svelte.js', () => ({ reloadCase: vi.fn(), toast: vi.fn() }));

const { WEB_MAP_LOOK, isWebMap, makeWebMap, webMapBody } = await import('./webMap.js');
const { counterCode } = await import('../goatcounterSetup.js');
const { normaliseLook, WEBS } = await import('./look.js');

/** A web map: one note, one map, laid out as a map page; made in one press. */
describe('a web map', () => {
  it('is a note whose map comes after a line for its subtitle', () => {
    const body = webMapBody('::: map\nlayer: Vehicles\nground: e_1\n:::\n');
    expect(body.startsWith('<!--? ')).toBe(true);
    expect(body.endsWith('::: map\nlayer: Vehicles\nground: e_1\n:::\n')).toBe(true);
    expect(isWebMap({ look: { web: 'map' } })).toBe(true);
    expect(isWebMap({ look: { web: 'story' } })).toBe(false);
  });

  it('is made by putting its map, then writing the note with its look, and nothing when the map cannot be', async () => {
    const put = vi.fn(async () => ({ text: '::: map\nlayer: Vehicles\n:::', filed: ['e_1'] }));
    const create = vi.fn(async () => ({ id: 'n1' }));
    const look = vi.fn(async () => ({}));
    const reload = vi.fn(async () => {});
    const note = await makeWebMap('c1', { title: 'Vehicles', layers: ['Vehicles'] }, { put, create, look, reload });
    expect(note).toEqual({ id: 'n1' });
    expect(put).toHaveBeenCalledWith('c1', { title: 'Vehicles', layers: ['Vehicles'] }, { signal: undefined });
    expect(create).toHaveBeenCalledWith('c1', { title: 'Vehicles', folder: '', content: webMapBody('::: map\nlayer: Vehicles\n:::') });
    expect(look).toHaveBeenCalledWith('c1', 'n1', WEB_MAP_LOOK);
    expect(reload).toHaveBeenCalled();
    const nothing = vi.fn(async () => ({ text: '' }));
    await expect(makeWebMap('c1', { title: 'V', layers: ['V'] }, { put: nothing, create, look, reload })).rejects.toThrow('could not be made');
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('the map page in the look', () => {
  it('is a third web layout, and keeps a GoatCounter code only once one is set', () => {
    expect(WEBS.map((one) => one.id)).toEqual(['', 'story', 'map']);
    expect(normaliseLook({ web: 'map' }).web).toBe('map');
    expect('counter' in normaliseLook({ web: 'map' })).toBe(false);
    expect(normaliseLook({ web: 'map', counter: 'https://Desk.goatcounter.com/' }).counter).toBe('desk');
    expect('counter' in normaliseLook({ counter: 'not a code' })).toBe(false);
  });

  it('reads a code from what is pasted: the code, or the site’s address', () => {
    expect(counterCode('')).toBe('');
    expect(counterCode(' my-desk ')).toBe('my-desk');
    expect(counterCode('https://my-desk.goatcounter.com/settings')).toBe('my-desk');
    expect(counterCode('my-desk.goatcounter.com')).toBe('my-desk');
    expect(counterCode('my desk')).toBeNull();
    expect(counterCode('-desk')).toBeNull();
  });
});
