// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFindState } from './find.svelte.js';
import { createHorizonState } from './horizon.svelte.js';
import { createOverlayState } from './overlay.svelte.js';
import { createViewsState } from './views.svelte.js';
import { benchSummary, createWorkState, SAVE_MS } from './work.svelte.js';

const EYE = { lat: 46.5586, lon: 7.8353 };
const PHOTO = 'media/Ridge at dusk.jpg';
const AREA = [
  { lat: 46.5, lon: 7.8 },
  { lat: 46.5, lon: 7.9 },
  { lat: 46.6, lon: 7.9 },
];

let api;
let kept;
let photoHere;
let caseId;
let timers;
let mode;

function makeApi() {
  return {
    get: vi.fn(async (path) => {
      if (path.endsWith('/horizon/work')) return { work: kept.get(caseId) ?? null, photo_here: kept.get(caseId)?.photo ? photoHere : null };
      if (path.startsWith('/api/horizon/photo')) return { focal35_mm: 26 };
      return { peaks: [] };
    }),
    put: vi.fn(async (path, body) => {
      kept.set(decodeURIComponent(path.split('/')[3]), structuredClone(body));
      return { ok: true };
    }),
    del: vi.fn(async (path) => {
      kept.delete(decodeURIComponent(path.split('/')[3]));
      return { cleared: true };
    }),
    post: vi.fn(async (path, body) => {
      if (path === '/api/horizon/panorama') {
        return {
          observer: { lat: body.lat, lon: body.lon, ground: 2950, altitude: 2951.7 },
          far: 150000,
          refraction: 0.13,
          resolution: 9.6,
          credits: [],
          azimuth: { start: 0, step: 1, count: 360, full: true },
          elevation: { top: 12, step: 1, count: 38 },
        };
      }
      return {};
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
  const finder = createFindState({ api, overlay, view });
  const views = createViewsState({ api, view, overlay, caseId: () => caseId });
  const work = createWorkState({
    api,
    caseId: () => caseId,
    view,
    overlay,
    finder,
    views,
    mode: () => mode,
    later: (fn, ms) => timers.push({ fn, ms }),
    cancel: () => timers.splice(0),
  });
  return { view, overlay, finder, views, work };
}

/** Run what waits on the timer, as the tab's effect would have asked it. */
async function settle(work) {
  work.keep(work.current);
  for (const { fn } of timers.splice(0)) await fn();
}

beforeEach(() => {
  kept = new Map();
  photoHere = true;
  caseId = 'c1';
  timers = [];
  mode = 'view';
  api = makeApi();
});

describe('Horizon’s bench', () => {
  it('writes nothing for a case before its bench has been read', async () => {
    const { view, work } = setup();
    view.standAt(EYE);
    work.keep(work.current);
    expect(timers).toHaveLength(0);
    await work.restore();
    await settle(work);
    expect(api.put).toHaveBeenCalledTimes(1);
  });

  it('is written a moment after it changes, the same bench once, and cleared when empty', async () => {
    const { view, finder, work } = setup();
    await work.restore();
    view.standAt(EYE);
    finder.setArea(AREA);
    work.keep(work.current);
    expect(timers.at(-1).ms).toBe(SAVE_MS);
    await settle(work);
    await settle(work);
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(kept.get('c1').spec.eye).toMatchObject(EYE);
    expect(kept.get('c1').find.area).toEqual(AREA);
    view.leave();
    finder.setArea([]);
    await settle(work);
    expect(api.del).toHaveBeenCalledTimes(1);
    expect(kept.has('c1')).toBe(false);
  });

  it('lays nothing on its own: work no save keeps is offered, and Resume brings it all back', async () => {
    const first = setup();
    await first.work.restore();
    first.view.standAt(EYE);
    await first.overlay.openCase('c1', { path: PHOTO, kind: 'image', title: 'Ridge at dusk' });
    first.overlay.addStroke([{ u: 0.1, v: 0.4 }, { u: 0.4, v: 0.38 }]);
    first.finder.setArea(AREA);
    mode = 'find';
    await settle(first.work);
    expect(kept.get('c1')).toMatchObject({ mode: 'find', saved: false });

    mode = 'view';
    const again = setup();
    await again.work.restore();
    expect(again.view.observer).toBeNull();
    expect(again.overlay.source).toBeNull();
    expect(again.work.offer).toMatchObject({ caseId: 'c1', photoHere: true });
    // the empty tab under the offer writes nothing over it
    await settle(again.work);
    expect(api.del).not.toHaveBeenCalled();

    const back = await again.work.resume();
    expect(back).toEqual({ mode: 'find', photoGone: false });
    expect(again.work.offer).toBeNull();
    expect(again.view.observer).toMatchObject(EYE);
    expect(again.overlay.source.path).toBe(PHOTO);
    expect(again.overlay.strokes).toHaveLength(1);
    expect(again.finder.area).toEqual(AREA);
    // what came back is not written again
    await settle(again.work);
    expect(api.put).toHaveBeenCalledTimes(1);
  });

  it('says a photo the case lost when the work resumes', async () => {
    const first = setup();
    await first.work.restore();
    first.view.standAt(EYE);
    await first.overlay.openCase('c1', { path: PHOTO, kind: 'image', title: 'Ridge at dusk' });
    await settle(first.work);

    photoHere = false;
    const again = setup();
    await again.work.restore();
    const back = await again.work.resume();
    expect(again.view.observer).toMatchObject(EYE);
    expect(again.overlay.source).toBeNull();
    expect(back.photoGone).toBe(true);
  });

  it('offers nothing a save keeps', async () => {
    kept.set('c1', { view: 'north-ridge', spec: null, photo: null, find: null, mode: 'view', saved: true });
    const { work } = setup();
    expect(await work.restore()).toBeNull();
    expect(work.offer).toBeNull();
  });

  it('lets the work go on Discard, and anything started instead replaces it', async () => {
    kept.set('c1', { spec: null, photo: null, find: { area: AREA }, mode: 'find', saved: false });
    const { view, work } = setup();
    await work.restore();
    work.discard();
    expect(work.offer).toBeNull();
    await vi.waitFor(() => expect(kept.has('c1')).toBe(false));

    kept.set('c1', { spec: null, photo: null, find: { area: AREA }, mode: 'find', saved: false });
    await work.restore();
    expect(work.offer).not.toBeNull();
    view.standAt(EYE);
    await settle(work);
    expect(work.offer).toBeNull();
    expect(kept.get('c1')).toMatchObject({ find: null, mode: 'view', saved: false });
    expect(kept.get('c1').spec.eye).toMatchObject(EYE);
  });

  it('keeps the tab’s own work in its place when told to read quietly', async () => {
    kept.set('c1', { spec: null, photo: null, find: { area: AREA }, mode: 'find', saved: false });
    const { view, work } = setup();
    view.standAt(EYE);
    expect(await work.restore({ quiet: true })).toBeNull();
    await settle(work);
    expect(kept.get('c1').find).toBeNull();
    expect(kept.get('c1').spec.eye).toMatchObject(EYE);
  });

  it('gives way to what the analyst did while it was being read', async () => {
    kept.set('c1', { spec: null, photo: null, find: { area: AREA }, saved: false });
    const { finder, work } = setup();
    const reading = work.restore();
    work.interrupt();
    await reading;
    expect(work.offer).toBeNull();
    expect(finder.area).toEqual([]);
    // and what they do is kept from then on
    finder.setArea(AREA.slice(0, 3));
    await settle(work);
    expect(api.put).toHaveBeenCalledTimes(1);
  });

  it('writes the bench a case left behind before another case’s is read', async () => {
    const { view, work } = setup();
    await work.restore();
    view.standAt(EYE);
    work.keep(work.current);
    caseId = 'c2';
    await work.restore();
    expect(kept.get('c1').spec.eye).toMatchObject(EYE);
    expect(kept.has('c2')).toBe(false);
  });
});

describe('the work offered back, in a line', () => {
  it('names the view, the photo and its trace, and Find’s search or area', () => {
    const photo = { path: 'media/Ridge at dusk.jpg', kind: 'image', title: 'Ridge at dusk', strokes: [[], []] };
    expect(benchSummary({ view: 'north-ridge', photo }, { views: [{ name: 'north-ridge', title: 'North ridge' }] })).toBe(
      'Changes to “North ridge” · photo “Ridge at dusk”, 2 lines traced'
    );
    expect(benchSummary({ spec: { eye: EYE }, find: { area: AREA } })).toBe('A viewpoint at 46.5586, 7.8353 · an area drawn in Find');
    expect(benchSummary({ find: { search: 'f1', area: AREA } }, { searches: [{ name: 'f1', title: 'Ridge search' }] })).toBe('Search “Ridge search”');
    expect(benchSummary({ find: { area: [] } })).toBe('Find’s settings');
  });
});
