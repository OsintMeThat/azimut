// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHorizonState } from './horizon.svelte.js';
import { createOverlayState } from './overlay.svelte.js';
import { createViewsState } from './views.svelte.js';

const EYE = { lat: 46.5586, lon: 7.8353 };
const PHOTO = 'media/Ridge at dusk.jpg';

let api;
let requests;
let stored;
let photoHere;
let caseId;
let snapshot;

function saved(name, spec) {
  return { azimut_horizon: 1, name, title: name, spec, made: {}, photo_here: photoHere, thumb: null };
}

function makeApi() {
  return {
    post: vi.fn(async (path, body) => {
      requests.push({ method: 'POST', path, body });
      if (path === '/api/horizon/target') return { azimuth: 90, angle: 1, distance: 5000, visible: true };
      if (path === '/api/horizon/sky') return { date: body.date ?? '2026-10-09', step_minutes: 2, sun: {}, moon: {} };
      if (path === '/api/horizon/panorama') {
        return {
          observer: { lat: body.lat, lon: body.lon, ground: 2950, altitude: 2951.7 },
          far: 150000,
          refraction: 0.13,
          resolution: 9.6,
          credits: [{ label: 'Mapterhorn', attribution: '© Mapterhorn' }],
          azimuth: { start: 0, step: 1, count: 360, full: true },
          elevation: { top: 12, step: 1, count: 38 },
        };
      }
      if (path.endsWith('/horizon/views')) {
        const name = body.title;
        stored.set(name, body.spec);
        if (body.rename_from) stored.delete(body.rename_from);
        return { name, title: name, spec_path: `.horizon/${name}.json` };
      }
      return {};
    }),
    put: vi.fn(async (path, body) => {
      requests.push({ method: 'PUT', path, body });
      return { thumb: '.horizon/x.webp' };
    }),
    delete: vi.fn(async (path) => {
      requests.push({ method: 'DELETE', path });
      stored.delete(decodeURIComponent(path.split('/').pop()));
      return { deleted: true };
    }),
    get: vi.fn(async (path) => {
      requests.push({ method: 'GET', path });
      if (path.startsWith('/api/horizon/photo')) return { focal35_mm: 26 };
      if (path.endsWith('/horizon/views')) return [...stored.keys()].map((name) => ({ name, title: name }));
      const name = decodeURIComponent(path.split('/').pop());
      if (path.includes('/horizon/views/') && stored.has(name)) return saved(name, structuredClone(stored.get(name)));
      return { peaks: [] };
    }),
  };
}

function setup() {
  const view = createHorizonState({ api, decode: async (answer) => answer, later: () => 0, cancel: () => {}, storage: null });
  const overlay = createOverlayState({
    api,
    view,
    bitmap: async () => ({ width: 4000, height: 3000, close: vi.fn() }),
    fetchBlob: async (url) => ({ url }),
    host: () => null,
    later: () => 0,
    cancel: () => {},
    nextFrame: () => {},
  });
  const views = createViewsState({
    api,
    view,
    overlay,
    caseId: () => caseId,
    snapshot: () => snapshot(),
    footprint: () => [EYE, { lat: 46.6, lon: 7.95 }, { lat: 46.5, lon: 7.96 }],
  });
  return { view, overlay, views };
}

const posted = () => requests.filter((r) => r.method === 'POST' && r.path.endsWith('/horizon/views'));

beforeEach(() => {
  requests = [];
  stored = new Map();
  photoHere = true;
  caseId = 'c1';
  snapshot = async () => new Blob(['png'], { type: 'image/png' });
  api = makeApi();
});

describe('saving a view', () => {
  it('has nothing to keep until the eye stands somewhere, and a view never saved always has', () => {
    const { view, views } = setup();
    expect(views.dirty).toBe(false);
    view.standAt(EYE);
    expect(views.dirty).toBe(true);
    expect(views.suggested).toBe('View from 46.5586, 7.8353');
  });

  it('keeps the reading, what the terrain was and the ground it took in, then its preview', async () => {
    const { view, views } = setup();
    view.standAt(EYE);
    await view.restore({ observer: { ...EYE, mode: 'ground', height: 1.7 } });
    const answer = await views.save('North ridge');
    expect(answer.name).toBe('North ridge');
    const body = posted()[0].body;
    expect(body.title).toBe('North ridge');
    expect(body.spec.eye).toEqual({ ...EYE, mode: 'ground', height: 1.7 });
    expect(body.footprint).toEqual([[7.8353, 46.5586], [7.95, 46.6], [7.96, 46.5]]);
    expect(body).not.toHaveProperty('rename_from');
    expect(body).not.toHaveProperty('overwrite');
    const preview = requests.find((r) => r.method === 'PUT');
    expect(preview.path).toBe('/api/cases/c1/horizon/views/North%20ridge/thumb');
    expect(views.current).toEqual({ name: 'North ridge', title: 'North ridge' });
    expect(views.list.map((v) => v.name)).toEqual(['North ridge']);
    expect(views.dirty).toBe(false);
  });

  it('is kept without its preview when the view cannot be drawn', async () => {
    snapshot = async () => {
      throw new Error('lost context');
    };
    const { view, views } = setup();
    view.standAt(EYE);
    expect(await views.save('North ridge')).toBeTruthy();
    expect(views.error).toBe('');
  });

  it('keeps one view: the same name saves over it, another renames it, fresh starts another', async () => {
    const { view, views } = setup();
    view.standAt(EYE);
    await views.save('North ridge');
    view.setGround('plain');
    await views.save('North ridge');
    expect(posted()[1].body.overwrite).toBe(true);
    await views.save('Eiger from the west');
    expect(posted()[2].body.rename_from).toBe('North ridge');
    views.fresh();
    expect(views.current).toBeNull();
    await views.save('Second look');
    expect(posted()[3].body).not.toHaveProperty('rename_from');
  });

  it('is not changed by looking round with no photo, and is by how the picture is drawn', async () => {
    const { view, views } = setup();
    view.standAt(EYE);
    await views.save('North ridge');
    view.look({ heading: 200, fov: 30 });
    expect(views.dirty).toBe(false);
    view.setLines(true);
    expect(views.dirty).toBe(true);
  });

  it('is changed by the alignment and the trace once a photo is laid', async () => {
    const { view, overlay, views } = setup();
    view.standAt(EYE);
    await overlay.openCase('c1', { path: PHOTO, kind: 'image', title: 'Ridge at dusk' });
    await views.save('North ridge');
    expect(posted()[0].body.spec.photo).toMatchObject({ path: PHOTO, kind: 'image', title: 'Ridge at dusk' });
    view.look({ heading: 120 });
    expect(views.dirty).toBe(true);
    await views.save('North ridge');
    overlay.addStroke([{ u: 0.1, v: 0.4 }, { u: 0.4, v: 0.38 }]);
    expect(views.dirty).toBe(true);
    overlay.undoStroke();
    expect(views.dirty).toBe(false);
  });

  it('cannot be saved with no case open', async () => {
    caseId = null;
    const { view, views } = setup();
    view.standAt(EYE);
    expect(await views.save('North ridge')).toBeNull();
    expect(posted()).toHaveLength(0);
  });

  it('says why a save was refused', async () => {
    const { view, views } = setup();
    view.standAt(EYE);
    api.post.mockRejectedValueOnce(new Error('a view already uses that name'));
    expect(await views.save('North ridge')).toBeNull();
    expect(views.error).toBe('a view already uses that name');
  });
});

describe('opening a view', () => {
  async function savedView({ photo = true, locked = false } = {}) {
    const first = setup();
    first.view.standAt(EYE);
    first.view.setGround('imagery');
    first.view.setDrapeSource('esri-wayback~31144');
    first.view.setNearReach(10000);
    await first.view.setNear(true);
    first.view.setRidges(4);
    first.view.showSky(true);
    first.view.setSkyDate('2026-07-14');
    first.view.setSkyTime('17:30');
    await first.view.mark({ lat: 46.5775, lon: 7.9853 }, { height: 10 });
    if (photo) {
      await first.overlay.openCase('c1', { path: PHOTO, kind: 'image', title: 'Ridge at dusk' });
      first.overlay.setMix(0.4);
      first.overlay.setBend(-0.1);
      first.overlay.addStroke([{ u: 0.1, v: 0.4 }, { u: 0.4, v: 0.38 }]);
    }
    first.view.look({ heading: 97.25, tilt: 1.5, fov: 41 });
    if (locked) first.overlay.setLocked(true);
    await first.views.save('North ridge');
    return posted()[0].body.spec;
  }

  it('stands the eye, draws the picture as it was, and never switches billed imagery back on', async () => {
    const spec = await savedView({ photo: false });
    expect(spec.picture.sentinel).toEqual({ reach: 10000, date: '' });
    const { view, views } = setup();
    expect(await views.open('North ridge')).toBe(true);
    expect(view.observer).toEqual(spec.eye);
    expect(view.camera).toMatchObject({ heading: 97.25, tilt: 1.5, fov: 41 });
    expect(view.ground).toBe('imagery');
    expect(view.drapeSource).toBe('esri-wayback~31144');
    expect(view.ridges).toBe(4);
    expect(view.nearOn).toBe(false);
    expect(view.nearReach).toBe(10000);
    expect(view.skyOn).toBe(true);
    expect(view.skyDate).toBe('2026-07-14');
    expect(view.skyTime).toBe('17:30');
    expect(view.target).toMatchObject({ lat: 46.5775, lon: 7.9853, height: 10 });
    expect(views.current).toEqual({ name: 'North ridge', title: 'North ridge' });
    expect(views.dirty).toBe(false);
  });

  it('lays the photo again with its work, and the saved lens over the one the photo says', async () => {
    const spec = await savedView();
    const { view, overlay, views } = setup();
    await views.open('North ridge');
    expect(overlay.source).toMatchObject({ path: PHOTO, kind: 'image', caseId: 'c1' });
    expect(overlay.mix).toBe(0.4);
    expect(overlay.bend).toBe(-0.1);
    expect(overlay.strokes).toEqual(spec.photo.strokes);
    // the photo says 26 mm; the view was saved through 41°
    expect(view.camera.fov).toBe(41);
    expect(views.dirty).toBe(false);
    overlay.setMix(1);
    expect(views.dirty).toBe(true);
    await views.revert();
    expect(overlay.mix).toBe(0.4);
    expect(views.dirty).toBe(false);
  });

  it('holds the photo to the terrain again when it was held at the save', async () => {
    const spec = await savedView({ locked: true });
    expect(spec.photo.locked).toBe(true);
    const { overlay, views } = setup();
    await views.open('North ridge');
    expect(overlay.locked).toBe(true);
    expect(views.dirty).toBe(false);
    overlay.setLocked(false);
    expect(views.dirty).toBe(true);
  });

  it('leaves a photo free when it was saved free', async () => {
    await savedView();
    const { overlay, views } = setup();
    await views.open('North ridge');
    expect(overlay.locked).toBe(false);
  });

  it('opens without a photo the case no longer holds, and says so', async () => {
    await savedView();
    photoHere = false;
    const { overlay, views } = setup();
    expect(await views.open('North ridge')).toBe(true);
    expect(overlay.source).toBeNull();
    expect(views.error).toMatch(/no longer in the case \(Ridge at dusk\)/);
  });

  it('forgets the view deleted while it was open', async () => {
    await savedView({ photo: false });
    const { views } = setup();
    await views.open('North ridge');
    expect(await views.remove('North ridge')).toBe(true);
    expect(views.current).toBeNull();
    expect(views.list).toEqual([]);
  });
});
