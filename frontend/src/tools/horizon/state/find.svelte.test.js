// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createFindState, estimateText, WHO } from './find.svelte.js';
import { destination } from '../../../lib/measure.js';

const CAMERA = { lat: 16.9988, lon: 45.0938 };

function finder({ lens = null, panorama = false, post } = {}) {
  const api = { get: vi.fn(), post: post ?? vi.fn(async () => ({ fits: [] })) };
  const overlay = { lens, isPanorama: panorama, seenOf: (p) => p };
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

describe('zones beside the area', () => {
  const square = (lat, lon, d) => [
    { lat: lat - d, lon: lon - d },
    { lat: lat - d, lon: lon + d },
    { lat: lat + d, lon: lon + d },
    { lat: lat + d, lon: lon - d },
  ];

  it('are drawn corner by corner, finer or left out, and a zone of fewer than three corners is none', () => {
    const { find } = finder();
    find.setArea(square(17, 45, 0.1));
    find.drawZone({ out: false });
    expect(find.drawing).toBe('zone');
    for (const corner of square(17.02, 45.02, 0.01).slice(0, 3)) find.addCorner(corner);
    expect(find.area).toHaveLength(4); // the area is not touched
    find.closeArea();
    expect(find.drawing).toBeNull();
    expect(find.zones).toHaveLength(1);
    expect(find.zones[0]).toMatchObject({ spacing: 'auto', out: false });
    find.setZoneSpacing(find.zones[0].id, 100);
    expect(find.zones[0].spacing).toBe(100);
    find.setZoneSpacing(find.zones[0].id, 77); // no such grid
    expect(find.zones[0].spacing).toBe(100);
    find.drawZone({ out: true });
    find.addCorner({ lat: 17, lon: 45 });
    find.closeArea();
    expect(find.zones).toHaveLength(1);
    expect(find.zoneProblem({ points: [] })).toBe('Draw at least three corners');
    find.removeZone(find.zones[0].id);
    expect(find.zones).toEqual([]);
  });

  it('go with the search, the preview and the bench, and come back with a search reopened', async () => {
    const asked = [];
    const post = vi.fn(async (url, body) => {
      asked.push([url, body]);
      if (url.endsWith('/preview')) return { total: 1, kept: 1, kinds: {}, points: [] };
      return { name: 'zoned', status: 'queued', progress: { done: 0, total: 0 } };
    });
    const { find, api } = finder({ post });
    find.setArea(square(17, 45, 0.1));
    find.drawZone({ out: true });
    for (const corner of square(17.05, 45.05, 0.01)) find.addCorner(corner);
    find.closeArea();
    await find.preview();
    expect(asked.at(-1)[1].zones).toEqual([{ area: square(17.05, 45.05, 0.01), spacing: null, out: true }]);
    const kept = structuredClone(find.snapshot);
    expect(kept.zones[0]).toMatchObject({ spacing: 'auto', out: true });
    const { find: again } = finder();
    await again.restore(kept, 'c1');
    expect(again.zones).toHaveLength(1);
    expect(again.zones[0].out).toBe(true);
    api.get = vi.fn(async () => ({ status: 'done', ask: { area: [[17, 45], [17, 45.1], [17.1, 45.1]], zones: [{ area: [[17, 45], [17, 45.01], [17.01, 45.01]], spacing: 250, out: false }] }, result: { places: [] } }));
    await find.openSearch('c1', 'zoned');
    expect(find.zones).toEqual([expect.objectContaining({ spacing: 250, out: false, points: [{ lat: 17, lon: 45 }, { lat: 17, lon: 45.01 }, { lat: 17.01, lon: 45.01 }] })]);
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

  it('reads them on the photo as the search does, so a curve set afterwards moves the offset, not the points', () => {
    let curve = $state(0);
    // a stand-in for the photo straightened from its lens's curve: the edges drawn in or out
    const overlay = { lens: { fov: 60 }, isPanorama: false, seenOf: (p) => ({ u: 0.5 + (p.u - 0.5) * (1 + curve), v: p.v }) };
    const view = { camera: { heading: 0, tilt: 0, roll: 0, fov: 60, projection: 'camera' } };
    const find = createFindState({ api: { get: vi.fn(), post: vi.fn() }, overlay, view });
    align(find, { nearU: 0.5, farU: 1, near, far });
    expect(find.alignments[0].offset).toBeCloseTo(30, 6);
    curve = -0.2;
    const across = (Math.atan(0.8 * Math.tan(Math.PI / 6)) * 180) / Math.PI;
    expect(find.alignments[0].offset).toBeCloseTo(across, 6);
    // the far point stays where it was clicked on the photo's own pixels
    expect(find.alignments[0].photo.far).toEqual({ u: 1, v: 0.4 });
  });

  it('keeps its colour from the first click to the last, and reads clicks a hair apart as lined up', () => {
    const { find } = finder();
    find.startAlignment();
    const colour = find.pending.colour;
    expect(colour).toMatch(/^#/);
    find.photoClick({ u: 0.5, v: 0.6 });
    find.photoClick({ u: 0.505, v: 0.4 });
    find.mapClick(near);
    expect(find.pending.colour).toBe(colour);
    find.mapClick(far);
    expect(find.alignments[0]).toMatchObject({ colour, offset: 0, offsetKnown: true });
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
    find.setSettings({ speed: 'gentle' });
    expect(find.settings.speed).toBe('gentle');
    find.setSettings({ speed: 'reckless' });
    expect(find.settings.speed).toBe('gentle');
    find.setSettings({ speed: 'fast' });
    expect(find.settings).toEqual({ spacing: 250, tolerance: 2, speed: 'fast' });
    find.setSettings({ spacing: 333, tolerance: -1 });
    expect(find.settings).toEqual({ spacing: 250, tolerance: 2, speed: 'fast' });
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
      bend: 0,
      warped: false,
      corners: [],
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
    // the zoom word's lenses across this landscape picture, their middle to start from
    expect(body.trace.within).toEqual([20, 55]);
    expect(body.trace.fov).toBeCloseTo(Math.sqrt(20 * 55), 6);
    expect(body.trace.x.length).toBeGreaterThan(20);
    expect(body.trace.half_width).toBe(600);
    expect(body.area).toHaveLength(4);
    expect(body).toMatchObject({ who: { mode: 'ground', low: 1.7, high: 1.7 }, reach: null, spacing: null });
    expect(body.photo).toMatchObject({ path: 'media/barry.png', title: 'barry' });
    expect(body.photo).not.toHaveProperty('bend');
    expect(body.photo).not.toHaveProperty('corners');
    expect(body.facing).toEqual([]);
    expect(find.searching).toBe(true);
    find.closeSearch();
  });

  it('asks with the directions ticked, and says the setup changed when they do', async () => {
    const { find, api } = laid();
    find.setArea(area);
    find.toggleFacing('e');
    find.toggleFacing('ne');
    expect(find.facing).toEqual(['ne', 'e']);
    await find.start('c1');
    expect(api.post.mock.calls.at(-1)[1].facing).toEqual(['ne', 'e']);
    expect(find.edited).toBe(false);
    find.toggleFacing('e');
    expect(find.edited).toBe(true);
    find.clearFacing();
    expect(find.facing).toEqual([]);
    find.closeSearch();
  });

  it('reads the grid and its ground once the area is drawn, and asks with the ground ticked', async () => {
    const answers = [];
    const post = vi.fn(async (url, body) => {
      if (url.endsWith('/preview')) {
        answers.push(body);
        // all ten points on a slope
        const kept = !body.stands.length || body.stands.includes('slope') ? 10 : 0;
        return { total: 10, kept, kinds: { summit: 0, slope: 10, valley: 0, plain: 0, water: 0 }, points: [] };
      }
      if (url.endsWith('/estimate')) return { points: 469, coarse: 400, spacing: 250, step: 0.5 };
      return { name: 'barry search', status: 'queued', progress: { done: 0, total: 0 } };
    });
    const { find, api } = laid({ post });
    await find.preview();
    expect(answers).toHaveLength(0); // no area yet, nothing read
    find.setArea(area);
    await find.preview();
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ who: { mode: 'ground' }, stands: [] });
    expect(answers[0]).not.toHaveProperty('trace');
    // the same question is not asked twice
    await find.preview();
    expect(answers).toHaveLength(1);
    find.toggleStand('summit');
    await find.preview();
    expect(answers.at(-1).stands).toEqual(['summit']);
    expect(find.previewed.kept).toBe(0);
    expect(find.searchProblem).toBe('No point of the area stands on the ground ticked');
    find.toggleStand('slope');
    await find.preview();
    expect(find.searchProblem).toBe('');
    await find.start('c1');
    expect(api.post.mock.calls.at(-1)[1].stands).toEqual(['summit', 'slope']);
    find.closeSearch();
  });

  it('asks with the camera’s view, a selfie and the nearest line said, and keeps them on the bench', async () => {
    const answers = [];
    const post = vi.fn(async (url, body) => {
      if (url.endsWith('/preview')) {
        answers.push(body);
        return { total: 4, kept: 4, kinds: {}, points: [] };
      }
      return { name: 'barry search', status: 'queued', progress: { done: 0, total: 0 } };
    });
    const { find, api, overlay } = laid({ post });
    overlay.marks = { lines: [0], inner: [], pairs: [], cuts: [], far: [{ line: 0, bands: ['b1', 'b3'] }] };
    find.setArea(area);
    find.toggleView('down');
    find.setMirror(true);
    await find.preview();
    // the grid is laid for the nearest line said
    expect(answers.at(-1).near).toBe(1_000);
    await find.start('c1');
    const body = api.post.mock.calls.at(-1)[1];
    expect(body).toMatchObject({ view: ['down'], mirror: true });
    expect(body.trace.far).toEqual([[0, 1_000, 10_000]]);
    const kept = structuredClone(find.snapshot);
    expect(kept).toMatchObject({ view: ['down'], mirror: true });
    find.toggleView('down');
    expect(find.view).toEqual([]);
    expect(find.edited).toBe(true);
    const { find: again } = laid();
    await again.restore(kept, 'c1');
    expect(again.view).toEqual(['down']);
    expect(again.mirror).toBe(true);
    find.closeSearch();
  });

  it('tries the trace from a point clicked, before any area, and drops an answer overtaken', async () => {
    const answers = [];
    const post = vi.fn(async (url, body) => {
      answers.push([url, body]);
      if (url.endsWith('/try')) return { place: { lat: body.at.lat, lon: body.at.lon, explained: 0.71, heading: 92 }, frames: null };
      return [];
    });
    const get = vi.fn(async () => []);
    const { find } = laid({ post, get });
    expect(find.tryProblem).toBe('Open a case first');
    await find.refreshList('c1');
    expect(find.tryProblem).toBe('');
    find.startTrying();
    expect(find.drawing).toBe('try');
    await find.tryAt({ lat: 12.9, lon: 43.6 });
    const [url, body] = answers.at(-1);
    expect(url).toBe('/api/cases/c1/horizon/finds/try');
    expect(body.at).toEqual({ lat: 12.9, lon: 43.6 });
    expect(body).not.toHaveProperty('area');
    expect(body.trace.x.length).toBeGreaterThan(20);
    expect(find.tried).toMatchObject({ at: { lat: 12.9, lon: 43.6 }, place: { explained: 0.71 }, busy: false });
    find.clearTried();
    expect(find.tried).toBeNull();
    expect(find.drawing).toBeNull();
  });

  it('says why a point cannot be tried when the app fails', async () => {
    const post = vi.fn(async () => {
      throw new Error('The terrain could not be loaded');
    });
    const { find } = laid({ post, get: vi.fn(async () => []) });
    await find.refreshList('c1');
    await find.tryAt({ lat: 1, lon: 2 });
    expect(find.tried).toMatchObject({ place: null, busy: false, error: 'The terrain could not be loaded' });
  });

  it('asks with the sun once its day and side are said, reads the headings it leaves, and keeps it', async () => {
    const asked = [];
    const post = vi.fn(async (url, body) => {
      asked.push([url, body]);
      if (url.endsWith('/sectors')) return { sectors: body.facing.length ? [] : [[180, 45]], sun: { zone: 'Asia/Aden', from: 150, to: 210, up: true } };
      return { name: 'sun search', status: 'queued', progress: { done: 0, total: 0 } };
    });
    const { find, api } = laid({ post });
    find.setArea(area);
    find.toggleSunSide('left');
    await find.readSectors();
    expect(asked.filter(([url]) => url.endsWith('/sectors'))).toHaveLength(0); // no day yet
    find.setSun({ date: '2024-06-21', start: '13:00', end: '15:00' });
    await find.readSectors();
    expect(asked.at(-1)[1]).toMatchObject({ facing: [], sun: { date: '2024-06-21', start: '13:00', end: '15:00', sides: ['left'] } });
    expect(find.sectors.sectors).toEqual([[180, 45]]);
    find.toggleFacing('n');
    await find.readSectors();
    expect(find.searchProblem).toBe('The sun and the directions ticked leave no heading');
    find.clearFacing();
    await find.readSectors();
    await find.start('c1');
    expect(api.post.mock.calls.at(-1)[1].sun).toEqual({ date: '2024-06-21', start: '13:00', end: '15:00', sides: ['left'] });
    expect(structuredClone(find.snapshot).sun).toMatchObject({ date: '2024-06-21', sides: ['left'] });
    find.closeSearch();
  });

  it('checks the search on show against decoys and shows it as the app kept it', async () => {
    const post = vi.fn(async (url) =>
      url.endsWith('/check') ? { status: 'done', result: { checked: true, places: [{ lat: 1, lon: 2, explained: 0.8, decoy: 0.2 }] } } : []
    );
    const get = vi.fn(async () => ({ status: 'done', ask: { area: [[1, 2], [1, 3], [2, 3]] }, result: { places: [{ lat: 1, lon: 2, explained: 0.8 }] } }));
    const { find } = laid({ post, get });
    await find.openSearch('c1', 'ridge');
    await find.check();
    expect(post).toHaveBeenCalledWith('/api/cases/c1/horizon/finds/ridge/check');
    expect(find.search.result.checked).toBe(true);
    expect(find.search.result.places[0].decoy).toBe(0.2);
    expect(find.checking).toBe(false);
    find.closeSearch();
  });

  it('draws the fan as far as the search reads the turn', () => {
    const { find, overlay } = laid();
    expect(find.reach).toBe(50_000);
    overlay.hints = { ...overlay.hints, reach: 10_000 };
    expect(find.reach).toBe(20_000);
    overlay.hints = { ...overlay.hints, reach: 'all' };
    expect(find.reach).toBe(100_000);
  });

  it('says the setup is still the search’s until something in it changes', async () => {
    const { find, overlay } = laid();
    expect(find.edited).toBe(true); // no search on show
    find.setArea(area);
    await find.start('c1');
    expect(find.edited).toBe(false);
    overlay.strokes = [stroke, stroke.slice(0, 10)];
    expect(find.edited).toBe(true);
    overlay.strokes = [stroke];
    expect(find.edited).toBe(false);
    find.setWho({ mode: 'drone' });
    expect(find.edited).toBe(true);
    find.closeSearch();
  });

  it('keeps the curve and the corners the trace is read through with the search', async () => {
    const { find, api, overlay } = laid();
    overlay.bend = -0.12;
    overlay.warped = true;
    overlay.corners = [
      { u: 0.02, v: 0 },
      { u: 1, v: 0.03 },
      { u: 0.98, v: 1 },
      { u: 0, v: 0.97 },
    ];
    find.setArea(area);
    await find.start('c1');
    const body = api.post.mock.calls.at(-1)[1];
    expect(body.photo.bend).toBe(-0.12);
    expect(body.photo.corners).toEqual(overlay.corners);
    // the strokes stay on the photo's own pixels
    expect(body.photo.strokes).toBe(overlay.strokes);
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
    expect(find.settings).toEqual({ spacing: 250, tolerance: 2, speed: 'fast' });
    expect(find.alignments[0].map.near).toEqual({ lat: 17, lon: 45.1 });
    expect(find.search.result.verdict).toBe('match');
    expect(find.searching).toBe(false);
  });
});

describe('the setup kept on the bench', () => {
  const corners = [
    { lat: 16.9, lon: 45.0 },
    { lat: 16.9, lon: 45.2 },
    { lat: 17.1, lon: 45.2 },
  ];

  it('is nothing while nothing is set', () => {
    const { find } = finder();
    expect(find.snapshot).toBeNull();
    find.setWho({ mode: 'drone' });
    expect(find.snapshot).not.toBeNull();
    const { find: faced } = finder();
    faced.toggleFacing('n');
    expect(faced.snapshot).toMatchObject({ facing: ['n'] });
  });

  it('keeps the area, the alignments, who took it and the settings, and puts them back', async () => {
    const { find } = finder({ lens: { fov: 60 } });
    find.setArea(corners);
    align(find, { nearU: 0.45, farU: 0.5, near: CAMERA, far: destination(CAMERA, 5000, 300) });
    find.setWho({ mode: 'drone', low: 20, high: 80 });
    find.setSettings({ spacing: 250, tolerance: 2 });
    find.toggleFacing('sw');
    find.toggleStand('valley');
    const kept = structuredClone(find.snapshot);
    expect(kept.facing).toEqual(['sw']);
    expect(kept.stands).toEqual(['valley']);
    expect(kept.area).toEqual(corners);
    expect(kept.alignments[0]).toMatchObject({ photo: { near: { u: 0.45, v: 0.6 } }, offset_known: true, tops: false });
    expect(kept).toMatchObject({ who: { mode: 'drone', low: 20, high: 80 }, spacing: 250, tolerance: 2, search: null });

    const { find: again } = finder({ lens: { fov: 60 } });
    await again.restore(kept, 'c1');
    expect(again.area).toEqual(corners);
    expect(again.alignments).toHaveLength(1);
    expect(again.alignments[0].map).toEqual(find.alignments[0].map);
    expect(again.who).toEqual({ mode: 'drone', low: 20, high: 80 });
    expect(again.settings).toEqual({ spacing: 250, tolerance: 2, speed: 'fast' });
    expect(again.facing).toEqual(['sw']);
    expect(again.stands).toEqual(['valley']);
    expect(again.snapshot).toEqual(kept);
  });

  it('reopens the search on show, then lays what was set since over it', async () => {
    const { find, api } = finder();
    api.get.mockResolvedValue({ status: 'done', ask: { area: [[1, 2], [1, 3], [2, 3]] }, result: { places: [] } });
    await find.restore({ area: corners, search: 'Collage 1 search' }, 'c1');
    expect(api.get).toHaveBeenCalledWith('/api/cases/c1/horizon/finds/Collage%201%20search');
    expect(find.search.name).toBe('Collage 1 search');
    expect(find.area).toEqual(corners);
  });

  it('empties back to its defaults when the bench holds none', async () => {
    const { find } = finder();
    find.setArea(corners);
    await find.restore(null, 'c1');
    expect(find.area).toEqual([]);
    expect(find.who.mode).toBe('ground');
    expect(find.snapshot).toBeNull();
  });
});

describe('how fine the heights are over the area', () => {
  it('is read once the area is closed, at its middle, and once for the same place', async () => {
    const { find, api } = finder();
    api.get.mockResolvedValue({ elevation: 900, resolution_m: 30 });
    find.drawArea();
    find.addCorner({ lat: 16.9, lon: 45.0 });
    find.addCorner({ lat: 16.9, lon: 45.2 });
    find.addCorner({ lat: 17.1, lon: 45.2 });
    await find.readDetail();
    expect(api.get).not.toHaveBeenCalled();
    find.closeArea();
    await find.readDetail();
    await find.readDetail();
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get.mock.calls[0][0]).toMatch(/^\/api\/terrain\/elevation\?lat=16\.966667&lon=45\.133333$/);
    expect(find.detail).toBe(30);
  });
});

describe('the time a search takes', () => {
  it('shrinks with the share of the turn each point reads', () => {
    expect(estimateText({ points: 600, step: 0.5 })).toBe('600 points, about 3 min.');
    expect(estimateText({ points: 600, step: 0.5, turn: 0.25 })).toBe('600 points, about a minute.');
  });
});
