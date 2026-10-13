// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createFindState, WHO } from './find.svelte.js';
import { destination } from '../../../lib/measure.js';

const CAMERA = { lat: 16.9988, lon: 45.0938 };

function finder({ lens = null, panorama = false, post } = {}) {
  const api = { get: vi.fn(), post: post ?? vi.fn(async () => ({ fits: [] })) };
  const overlay = { lens, isPanorama: panorama };
  const view = { camera: { heading: 0, tilt: 0, roll: 0, fov: 60, projection: 'camera' } };
  return { find: createFindState({ api, overlay, view }), api };
}

/** The four guided clicks of an alignment: near and far on the photo, then on the map. */
function align(find, { nearU = 0.5, farU = 0.5, near, far }) {
  find.startAlignment();
  find.photoClick({ u: nearU, v: 0.6 });
  find.photoClick({ u: farU, v: 0.4 });
  find.mapClick(near);
  find.mapClick(far);
}

describe('the area', () => {
  it('is drawn corner by corner while asked, and says what keeps it from being searched', () => {
    const { find } = finder();
    find.addCorner(CAMERA);
    expect(find.area).toEqual([]); // not drawing: a click on the map is no corner
    find.drawArea();
    expect(find.drawing).toBe('area');
    find.addCorner({ lat: 16.95, lon: 45.05 });
    find.addCorner({ lat: 16.95, lon: 45.15 });
    expect(find.areaProblem).toBe('Draw at least three corners');
    find.addCorner({ lat: 17.05, lon: 45.15 });
    find.closeArea();
    expect(find.drawing).toBeNull();
    expect(find.areaProblem).toBe('');
    find.moveCorner(2, { lat: 17.06, lon: 45.15 });
    expect(find.area[2].lat).toBe(17.06);
    find.removeCorner(0);
    expect(find.area).toHaveLength(2);
    find.clearArea();
    expect(find.area).toEqual([]);
  });
});

describe('an alignment', () => {
  const near = destination(CAMERA, 40, 800);
  const far = destination(CAMERA, 40, 12_000);

  it('takes two clicks on the photo, then the same two on the map, and ignores the other side meanwhile', () => {
    const { find } = finder();
    find.startAlignment();
    expect(find.step.text).toBe('On the photo, click something near');
    expect(find.mapClick(near)).toBe(false);
    expect(find.photoClick({ u: 0.5, v: 0.6 })).toBe(true);
    expect(find.step.text).toBe('On the photo, click what stands right behind it');
    find.photoClick({ u: 0.5, v: 0.4 });
    expect(find.photoClick({ u: 0.2, v: 0.2 })).toBe(false);
    expect(find.step.text).toBe('On the map, click the near one');
    find.mapClick(near);
    find.mapClick(far);
    expect(find.pending).toBeNull();
    expect(find.drawing).toBeNull();
    const [one] = find.alignments;
    expect(one.map).toEqual({ near: { lat: near.lat, lon: near.lon }, far: { lat: far.lat, lon: far.lon } });
    expect(one).toMatchObject({ offset: 0, offsetKnown: true, tops: false });
    expect(one.colour).toMatch(/^#/);
  });

  it('reads how far apart the two stand through the lens, and takes them as lined up without one', () => {
    const { find } = finder({ lens: { fov: 60 } });
    align(find, { nearU: 0.5, farU: 1, near, far });
    expect(find.alignments[0].offset).toBeCloseTo(30, 6);
    const blind = finder().find;
    align(blind, { nearU: 0.5, farU: 0.6, near, far });
    expect(blind.alignments[0]).toMatchObject({ offset: 0, offsetKnown: false });
  });

  it('gives each a colour of its own, and meets where two cross', () => {
    const { find } = finder();
    align(find, { near, far });
    align(find, { near: destination(CAMERA, 115, 1500), far: destination(CAMERA, 115, 20_000) });
    const [a, b] = find.alignments;
    expect(a.colour).not.toBe(b.colour);
    expect(find.meeting.crossings).toBe(1);
    find.cancelAlignment();
    find.removeAlignment(a.id);
    expect(find.alignments).toHaveLength(1);
    expect(find.meeting).toBeNull();
  });

  it('asks where the tops touch once said, with who took it, and keeps only the latest answer', async () => {
    let answer;
    const post = vi.fn(() => new Promise((resolve) => (answer = resolve)));
    const { find } = finder({ post });
    align(find, { near, far });
    const id = find.alignments[0].id;
    find.setTops(id, true, { near: 30, far: 0 });
    expect(find.alignments[0].touch).toEqual({ busy: true });
    expect(post).toHaveBeenCalledWith('/api/horizon/alignment', expect.objectContaining({
      near: { lat: near.lat, lon: near.lon, height: 30 },
      far: { lat: far.lat, lon: far.lon, height: 0 },
      mode: 'ground',
      low: 1.7,
      high: 1.7,
    }));
    const first = answer;
    // a drone instead: asked again, and the first answer arrives too late to count
    find.setWho({ mode: 'drone' });
    const second = answer;
    first({ fits: [{ at: { lat: 1, lon: 1 } }] });
    await Promise.resolve();
    expect(find.alignments[0].touch).toEqual({ busy: true });
    second({ fits: [{ from: { distance: 500 }, to: { distance: 900 } }] });
    await Promise.resolve();
    await Promise.resolve();
    expect(find.alignments[0].touch.fits[0].to.distance).toBe(900);
    find.setTops(id, false);
    expect(find.alignments[0].touch).toBeNull();
  });
});

describe('who took it', () => {
  it('starts on foot, and a drone or an aircraft brings its own range', () => {
    const { find } = finder();
    expect(find.who).toEqual({ mode: 'ground', low: 1.7, high: 1.7 });
    find.setWho({ mode: 'drone' });
    expect(find.who).toEqual({ mode: 'drone', low: WHO.drone.low, high: WHO.drone.high });
    find.setWho({ low: 200, high: 50 });
    expect(find.who).toEqual({ mode: 'drone', low: 50, high: 200 });
    find.setWho({ mode: 'ground', low: 5 });
    expect(find.who).toEqual({ mode: 'ground', low: 5, high: 5 });
  });

  it('keeps the settings a search runs with to what it offers', () => {
    const { find } = finder();
    find.setSettings({ spacing: 250, tolerance: 2 });
    expect(find.settings).toEqual({ spacing: 250, tolerance: 2 });
    find.setSettings({ spacing: 333, tolerance: -1 });
    expect(find.settings).toEqual({ spacing: 250, tolerance: 2 });
  });
});

describe('the search', () => {
  const area = [
    { lat: 16.95, lon: 45.05 },
    { lat: 16.95, lon: 45.15 },
    { lat: 17.05, lon: 45.15 },
    { lat: 17.05, lon: 45.05 },
  ];
  // a ridge across the photo, as the overlay hands its trace
  const stroke = Array.from({ length: 40 }, (_, i) => ({ u: 0.05 + i * 0.0225, v: 0.4 + 0.05 * Math.sin(i / 4) }));

  function laid({ lens = null, panorama = false, get, post } = {}) {
    const api = {
      get: get ?? vi.fn(),
      post: post ?? vi.fn(async (url) => (url.endsWith('/estimate') ? { points: 469, coarse: 400, spacing: 250, step: 0.5 } : { name: 'barry search', status: 'queued', progress: { done: 0, total: 0 } })),
      del: vi.fn(async () => ({ deleted: true })),
    };
    const overlay = {
      lens,
      isPanorama: panorama,
      source: { name: 'barry', kind: 'image', path: 'media/barry.png', caseId: 'c1' },
      aspect: 16 / 9,
      strokes: [stroke],
      strokesSeen: [stroke],
      time: 0,
      hints: { picture: 'photo', zoom: 'zoomed', facing: null, reach: 'auto' },
      seenOf: (p) => p,
    };
    const view = { camera: { heading: 0, tilt: 0, roll: 0, fov: 60, projection: 'camera' } };
    return { find: createFindState({ api, overlay, view }), api, overlay };
  }

  it('says what keeps it from running, then asks the app with the trace, the area and who took it', async () => {
    const { find, api } = laid();
    expect(find.searchProblem).toBe('Draw the area on the map');
    find.setArea(area);
    expect(find.searchProblem).toBe('');
    await find.estimate();
    expect(find.estimated.points).toBe(469);
    await find.start('c1');
    const [url, body] = api.post.mock.calls.at(-1);
    expect(url).toBe('/api/cases/c1/horizon/finds');
    expect(body.trace.known).toBe(false);
    // the zoom word's lenses, its middle to start from
    expect(body.trace.within).toEqual([10, 35]);
    expect(body.trace.fov).toBeCloseTo(Math.sqrt(350), 6);
    expect(body.trace.x.length).toBeGreaterThan(20);
    expect(body.trace.half_width).toBe(600);
    expect(body.area).toHaveLength(4);
    expect(body).toMatchObject({ who: { mode: 'ground', low: 1.7, high: 1.7 }, reach: null, spacing: null });
    expect(body.photo).toMatchObject({ path: 'media/barry.png', title: 'barry' });
    expect(find.searching).toBe(true);
    find.closeSearch();
  });

  it('sends the lens the photo says and each alignment where it stands across the photo', async () => {
    const { find, api } = laid({ lens: { fov: 4.8 } });
    find.setArea(area);
    align(find, { nearU: 0.75, near: destination(CAMERA, 40, 800), far: destination(CAMERA, 40, 12_000) });
    await find.start('c1');
    const body = api.post.mock.calls.at(-1)[1];
    expect(body.trace).toMatchObject({ known: true, fov: 4.8 });
    expect(body.trace).not.toHaveProperty('within');
    expect(body.alignments[0].photo_x).toBeCloseTo(0.5, 9);
    expect(body.alignments[0].tolerance).toBe(1);
    find.closeSearch();
  });

  it('keeps its open flag a flag, beside the method that opens a kept search', () => {
    const { find } = laid();
    expect(find.open).toBe(false);
    find.show();
    expect(find.open).toBe(true);
    find.hide();
    expect(find.open).toBe(false);
  });

  it('opens a search the case keeps with its area, alignments and who took it', async () => {
    const record = {
      status: 'done',
      ask: {
        area: area.map((p) => [p.lat, p.lon]),
        who: { mode: 'drone', low: 20, high: 80 },
        spacing: 250,
        alignments: [{ near: { lat: 17, lon: 45.1 }, far: { lat: 17.1, lon: 45.1 }, bearing: 180, tolerance: 2, offset: 0, colour: '#4dd6ff' }],
      },
      result: { verdict: 'match', places: [{ lat: 17, lon: 45.1, explained: 0.9 }], points: [] },
    };
    const { find } = laid({ get: vi.fn(async () => record) });
    await find.openSearch('c1', 'barry search');
    expect(find.area).toHaveLength(4);
    expect(find.who).toEqual({ mode: 'drone', low: 20, high: 80 });
    expect(find.settings).toEqual({ spacing: 250, tolerance: 2 });
    expect(find.alignments[0].map.near).toEqual({ lat: 17, lon: 45.1 });
    expect(find.search.result.verdict).toBe('match');
    expect(find.searching).toBe(false);
  });
});
