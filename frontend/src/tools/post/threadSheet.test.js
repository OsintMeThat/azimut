import { describe, expect, it, vi } from 'vitest';
import { fileRecapMap, fileThreadSheet, makeRecapMap, recapSigning } from './threadSheet.js';
import { prefs, templatesState } from '../../lib/state.svelte.js';

/** A video thread's recap pictures, filed in Media through their own routes. */

const sent = (post) => {
  const [path, form] = post.mock.calls[0];
  return { path, video: form.get('video'), image: form.get('image') };
};

describe('filing a recap picture', () => {
  it('files the sheet drawn of the places, made from the video, and answers its path', async () => {
    const build = vi.fn(async () => new Blob(['sheet'], { type: 'image/jpeg' }));
    const post = vi.fn(async () => ({ path: 'media/convoy contact sheet.jpg' }));
    const slides = [{ name: 'a' }];
    expect(await fileThreadSheet('case 1', { video: 'media/convoy.mp4', slides }, { build, post })).toBe('media/convoy contact sheet.jpg');
    expect(build).toHaveBeenCalledWith(slides, { caseId: 'case 1' });
    expect(sent(post)).toMatchObject({ path: '/api/cases/case%201/scenes/sheet', video: 'media/convoy.mp4' });
  });

  it('files the map made, and says so when the case answers no path', async () => {
    const blob = new Blob(['map'], { type: 'image/jpeg' });
    const post = vi.fn(async () => ({ path: 'media/convoy recap map.jpg' }));
    expect(await fileRecapMap('case-1', { video: 'media/convoy.mp4', blob }, { post })).toBe('media/convoy recap map.jpg');
    const { path, video, image } = sent(post);
    expect([path, video, image.name, image.size]).toEqual(['/api/cases/case-1/scenes/map', 'media/convoy.mp4', 'recap-map.jpg', 3]);
    await expect(fileRecapMap('case-1', { video: 'media/convoy.mp4', blob }, { post: async () => ({}) })).rejects.toThrow('the map was not filed');
  });
});

describe('making the recap map', () => {
  const slide = (name, lat, lon) => ({ name, title: name, row: { color: 'var(--anno-1)', points: [{ lat, lon }] } });
  const SLIDES = [slide('bridge', 16.05, 44.1), slide('gate', 16.21, 44.32)];
  const OPTIONS = { background: 'map', line: true, signature: false, mark: false };
  const signed = { providers: [{ id: 'osm', attribution: 'OSM' }], logo: null, style: null, handle: '@desk' };
  const blob = new Blob(['map'], { type: 'image/jpeg' });

  it('draws it whole for the choices asked, its tiles from the app, and files it made from the video', async () => {
    const build = vi.fn(async () => ({ blob, missing: 0, asked: 12 }));
    const post = vi.fn(async () => ({ path: 'media/convoy recap map.jpg' }));
    const loadTile = vi.fn();
    const path = await makeRecapMap('case-1', { video: 'media/convoy.mp4', slides: SLIDES, options: OPTIONS }, {
      build, post, loadTile, signing: async () => signed,
    });
    expect(path).toBe('media/convoy recap map.jpg');
    const [places, fit, options, deps] = build.mock.calls[0];
    expect(places.map((one) => [one.number, one.name])).toEqual([[1, 'bridge'], [2, 'gate']]);
    expect(fit.ok).toBe(true);
    expect(options).toBe(OPTIONS);
    expect(deps).toEqual({ ...signed, loadTile });
    expect(sent(post)).toMatchObject({ path: '/api/cases/case-1/scenes/map', video: 'media/convoy.mp4' });
  });

  it('files nothing when a tile did not come, or when the places have no map, and says why', async () => {
    const post = vi.fn(async () => ({ path: 'x' }));
    const holed = vi.fn(async () => ({ blob, missing: 3, asked: 40 }));
    await expect(makeRecapMap('case-1', { video: 'media/convoy.mp4', slides: SLIDES, options: OPTIONS }, {
      build: holed, post, signing: async () => signed,
    })).rejects.toThrow('3 of its 40 tiles did not load');
    const build = vi.fn();
    await expect(makeRecapMap('case-1', { video: 'media/convoy.mp4', slides: SLIDES.slice(0, 1), options: OPTIONS }, {
      build, post, signing: async () => signed,
    })).rejects.toThrow('these places have no map');
    expect(build).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('signs as the analyst\'s default proof style does, with what can be read', async () => {
    templatesState.proof = [{ id: 'pt_1', name: 'House', data: { signatureText: { anchor: 'bl' } } }];
    prefs.proofTemplate = 'pt_1';
    prefs.signatureHandle = '@desk';
    const logo = { width: 10, height: 10 };
    const get = vi.fn(async () => [{ id: 'osm' }]);
    expect(await recapSigning({ get, logo: async () => logo })).toEqual({
      providers: [{ id: 'osm' }], logo, style: { signatureText: { anchor: 'bl' } }, handle: '@desk',
    });
    expect(get).toHaveBeenCalledWith('/api/satellite/providers');
    // no logo and no catalogue: signed with the rest
    const none = await recapSigning({ get: async () => { throw new Error('offline'); }, logo: async () => { throw new Error('404'); } });
    expect([none.providers, none.logo, none.handle]).toEqual([[], null, '@desk']);
    templatesState.proof = [];
    prefs.proofTemplate = '';
    prefs.signatureHandle = '';
  });
});
