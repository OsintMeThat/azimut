// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { brushFor, createFindState, durationText, estimateText, FLOOR_M, floorsOf, pacedSeconds, ROOF, ROOF_FLOORS, roofFor, TAKEN, takenOf, WHO, whoFor, widenedText } from './find.svelte.js';
import { destination } from '../../../lib/measure.js';
import { PANORAMA_WITHIN } from '../../../lib/horizon/hints.js';

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

  it('asks the map to come over a search opened from the list, not one the bench puts back', async () => {
    const { find, api } = finder();
    api.get = vi.fn(async () => ({ status: 'done', ask: { area: [[17, 45], [17, 45.1], [17.1, 45.1]] }, result: { places: [] } }));
    expect(find.opened).toBe(0);
    await find.openSearch('c1', 'kept');
    expect(find.opened).toBe(1);
    await find.restore({ search: 'kept', area: find.area }, 'c1');
    expect(find.opened).toBe(1);
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
    find.setZoneSpacing(find.zones[0].id, 20);
    expect(find.zones[0].spacing).toBe(20);
    find.setZoneSpacing(find.zones[0].id, 100);
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

describe('more areas and the brush', () => {
  const square = (lat, lon, d) => [
    { lat: lat - d, lon: lon - d },
    { lat: lat - d, lon: lon + d },
    { lat: lat + d, lon: lon + d },
    { lat: lat + d, lon: lon - d },
  ];

  it('draws another area corner by corner, one of fewer than three corners being none', () => {
    const { find } = finder();
    find.setArea(square(17, 45, 0.1));
    find.drawMore();
    expect(find.drawing).toBe('more');
    for (const corner of square(17.5, 45.5, 0.05)) find.addCorner(corner);
    expect(find.area).toHaveLength(4);
    find.closeArea();
    expect(find.drawing).toBeNull();
    expect(find.areas).toHaveLength(1);
    find.drawMore();
    find.addCorner({ lat: 17, lon: 45 });
    find.closeArea();
    expect(find.areas).toHaveLength(1);
    find.removeMore(find.areas[0].id);
    expect(find.areas).toEqual([]);
  });

  it('paints strokes as wide as the brush, each over the ones before, the last taken back', () => {
    const { find } = finder();
    // a brush about a cell of the grid either side, until a size is picked
    expect(brushFor(60)).toBe(50);
    expect(brushFor(400)).toBe(500);
    expect(brushFor(undefined)).toBe(250);
    expect(find.brush).toEqual({ out: true, radius: 250 });
    find.startBrush();
    expect(find.drawing).toBe('brush');
    find.addStroke({ path: [{ lat: 17, lon: 45 }, { lat: 17.01, lon: 45 }] });
    find.setBrush({ out: false, radius: 1000 });
    find.setBrush({ radius: 333 }); // no such size
    find.addStroke({ path: [{ lat: 17, lon: 45 }] });
    expect(find.strokes).toEqual([
      { path: [{ lat: 17, lon: 45 }, { lat: 17.01, lon: 45 }], radius: 250, out: true },
      { path: [{ lat: 17, lon: 45 }], radius: 1000, out: false },
    ]);
    find.addStroke({ path: [] });
    expect(find.strokes).toHaveLength(2);
    find.undoStroke();
    expect(find.strokes).toHaveLength(1);
    find.stopBrush();
    expect(find.drawing).toBeNull();
    find.clearStrokes();
    expect(find.strokes).toEqual([]);
  });

  it('go with the preview, the search and the bench, say the setup changed, and come back with a search reopened', async () => {
    const asked = [];
    const post = vi.fn(async (url, body) => {
      asked.push([url, body]);
      if (url.endsWith('/preview')) return { spacing: 250, total: 1, kept: 1, kinds: {}, points: [] };
      return { name: 'painted', status: 'queued', progress: { done: 0, total: 0 } };
    });
    const { find, api } = finder({ post });
    find.setArea(square(17, 45, 0.1));
    find.drawMore();
    for (const corner of square(17.5, 45.5, 0.05)) find.addCorner(corner);
    find.closeArea();
    find.addStroke({ path: [{ lat: 17.02, lon: 45.02 }], radius: 500, out: true });
    await find.preview();
    expect(asked.at(-1)[1].areas).toEqual([square(17.5, 45.5, 0.05)]);
    expect(asked.at(-1)[1].strokes).toEqual([{ path: [{ lat: 17.02, lon: 45.02 }], radius: 500, out: true }]);
    const kept = structuredClone(find.snapshot);
    expect(kept.areas).toEqual([{ points: square(17.5, 45.5, 0.05) }]);
    const { find: again } = finder();
    await again.restore(kept, 'c1');
    expect(again.areas[0].points).toEqual(square(17.5, 45.5, 0.05));
    expect(again.strokes).toEqual(find.strokes);
    // a search kept as the case keeps it: corners as pairs
    const ask = {
      area: square(17, 45, 0.1).map(({ lat, lon }) => [lat, lon]),
      areas: [square(17.5, 45.5, 0.05).map(({ lat, lon }) => [lat, lon])],
      strokes: [{ path: [[17.02, 45.02]], radius: 500, out: true }],
      who: { mode: 'ground', low: 1.7, high: 1.7 },
    };
    api.get = vi.fn(async () => ({ status: 'done', ask, result: { places: [] } }));
    await find.openSearch('c1', 'painted');
    expect(find.areas[0].points).toEqual(square(17.5, 45.5, 0.05));
    expect(find.strokes).toEqual([{ path: [{ lat: 17.02, lon: 45.02 }], radius: 500, out: true }]);
    expect(find.edited).toBe(false);
    find.undoStroke();
    expect(find.edited).toBe(true);
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

  it('takes a roof or a terrace as the ground with the eye raised, and back on foot', () => {
    const { find } = finder();
    // picked, a roof stands one floor up
    find.setWho(whoFor('roof'));
    expect(find.who).toEqual({ mode: 'ground', low: FLOOR_M, high: FLOOR_M + 2 });
    expect(takenOf(find.who)).toBe('roof');
    expect(floorsOf(find.who)).toBe(ROOF_FLOORS);
    find.setWho(whoFor('ground'));
    expect(find.who).toEqual({ mode: 'ground', low: 1.7, high: 1.7 });
    expect(takenOf(find.who)).toBe('ground');
    expect(takenOf({ mode: 'drone', low: 10, high: 120 })).toBe('drone');
    expect(TAKEN.map((one) => one.id)).toEqual(['ground', 'roof', 'drone', 'aircraft']);
  });

  it('stands a roof as many floors up as said, three metres each, the usual roof when they are not', () => {
    const { find } = finder();
    find.setWho({ mode: 'ground', ...roofFor(4) });
    expect(find.who).toEqual({ mode: 'ground', low: 4 * FLOOR_M, high: 4 * FLOOR_M + 2 });
    expect(takenOf(find.who)).toBe('roof');
    expect(floorsOf(find.who)).toBe(4);
    // left empty, or not a floor count, the roof is the usual one and its floors unsaid
    expect(roofFor('')).toEqual(ROOF);
    expect(roofFor(null)).toEqual(ROOF);
    expect(roofFor(0)).toEqual(ROOF);
    expect(floorsOf({ mode: 'ground', ...ROOF })).toBeNull();
    expect(takenOf({ mode: 'ground', ...ROOF })).toBe('roof');
    expect(floorsOf(whoFor('ground'))).toBeNull();
    expect(floorsOf({ mode: 'drone', low: 12, high: 14 })).toBeNull();
  });

  it('keeps the settings a search runs with to what it offers', () => {
    const { find } = finder();
    find.setSettings({ spacing: 250, tolerance: 2 });
    find.setSettings({ speed: 'gentle' });
    expect(find.settings.speed).toBe('gentle');
    find.setSettings({ speed: 'reckless' });
    expect(find.settings.speed).toBe('gentle');
    find.setSettings({ speed: 'fast' });
    expect(find.settings).toEqual({ spacing: 250, tolerance: 2, speed: 'fast', effort: 'normal' });
    find.setSettings({ spacing: 333, tolerance: -1 });
    expect(find.settings).toEqual({ spacing: 250, tolerance: 2, speed: 'fast', effort: 'normal' });
    // grids as fine as 20 m, for a small area or a zone
    find.setSettings({ spacing: 20 });
    expect(find.settings.spacing).toBe(20);
    find.setSettings({ spacing: 50 });
    expect(find.settings.spacing).toBe(50);
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

  it('asks for near lines rounded only where the relief is coarse', async () => {
    const elevation = { resolution_m: 30 };
    const { find, api } = laid({ get: vi.fn(async () => elevation) });
    find.setArea(area);
    find.setRound(true);
    expect(find.round).toBe(true);
    await find.readDetail();
    await find.start('c1');
    expect(api.post.mock.calls.at(-1)[1].round).toBe(true);
    expect(find.snapshot.round).toBe(true);
    // a survey's metre: the relief holds near ridges, nothing is rounded
    const fine = laid({ get: vi.fn(async () => ({ resolution_m: 1 })) });
    fine.find.setArea(area);
    fine.find.setRound(true);
    await fine.find.readDetail();
    await fine.find.start('c1');
    expect(fine.api.post.mock.calls.at(-1)[1].round).toBe(false);
  });

  it('reads off the trace which way the camera looks and how wide the picture spans', () => {
    const { find, overlay } = laid();
    expect(find.traceSays.looking).toBeNull();
    expect(find.traceSays.span).toBeGreaterThan(20);
    // a portrait frame from a wide phone lens, the skyline near its top: a camera on foot looks down past the bounds
    const high = stroke.map((p) => ({ u: p.u, v: 0.08 + (p.v - 0.4) / 4 }));
    Object.assign(overlay, { aspect: 9 / 16, strokes: [high], strokesSeen: [high], hints: { ...overlay.hints, zoom: 'wide' } });
    expect(find.traceSays.looking).toBe('down');
    // a drone may look that far down already
    find.setWho({ mode: 'drone' });
    expect(find.traceSays.looking).toBeNull();
  });

  it('runs no search on a skyline Far land hidden covers whole, and says so', () => {
    const { find, overlay } = laid();
    find.setArea(area);
    const zone = { path: [{ u: 0, v: 0.05 }, { u: 1, v: 0.05 }], r: 0.02 };
    Object.assign(overlay, { marks: { lines: [0], inner: [], pairs: [], cuts: [], far: [], sea: [], clear: [], key: [], bent: [], hazy: [zone] }, hazyAt: () => true });
    expect(find.searchProblem).toBe('Far land hidden covers the skyline: leave out a part you are sure of');
    expect(find.tryProblem).toBe('Far land hidden covers the skyline: leave out a part you are sure of');
    // the part left out of the haze is searched again
    overlay.hazyAt = ({ u }) => u > 0.5;
    expect(find.searchProblem).toBe('');
  });

  it('saves the setup without searching, then saves it again in the same search', async () => {
    const saved = { name: 'barry search', status: 'saved', progress: { done: 0, total: 0 } };
    const { find, api } = laid({ post: vi.fn(async () => saved) });
    api.put = vi.fn(async () => saved);
    // with no area the setup is not whole yet
    expect(await find.save('c1')).toBeNull();
    find.setArea(area);
    await find.save('c1');
    const [url, body] = api.post.mock.calls.at(-1);
    expect(url).toBe('/api/cases/c1/horizon/finds');
    expect(body.run).toBe(false);
    expect(body.trace.x.length).toBeGreaterThan(20);
    expect(body.area).toHaveLength(4);
    expect(find.search).toMatchObject({ name: 'barry search', status: 'saved' });
    expect(find.searching).toBe(false);
    // saved again, the same search holds it
    await find.save('c1');
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.put.mock.calls[0][0]).toBe('/api/cases/c1/horizon/finds/barry%20search');
    expect(api.put.mock.calls[0][1].run).toBe(false);
    expect(api.post.mock.calls.filter(([to]) => to === '/api/cases/c1/horizon/finds')).toHaveLength(1);
  });

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

  it('follows the points scored as it runs, adding only the new ones, and keeps a place confirmed', async () => {
    vi.useFakeTimers();
    try {
      const point = (n, explained = 0.1 * n) => ({ lat: 17 + n / 100, lon: 45.1, explained, spacing: 250, gap: 0.2 });
      const reads = [];
      const record = { status: 'running', progress: { done: 3, total: 9 } };
      const get = vi.fn(async (url) => {
        if (!url.includes('/points')) return record;
        reads.push(url);
        // the first read is the whole run so far, the next ones what was scored since
        return reads.length === 1 ? { started: 7, since: 0, points: [point(1), point(2)] } : { started: 7, since: 2, points: [point(3)] };
      });
      const post = vi.fn(async (url, body) => {
        if (!url.endsWith('/found')) return { name: 'barry search', status: 'queued', progress: { done: 0, total: 0 } };
        Object.assign(record, { status: 'stopping', found: body });
        return { ...record };
      });
      const { find, api } = laid({ get, post });
      find.setArea(area);
      await find.start('c1');
      expect(find.live).toEqual([]);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(find.live.map((p) => p.explained)).toEqual([0.1, 0.2]);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(reads.at(-1)).toBe('/api/cases/c1/horizon/finds/barry%20search/points?since=2&started=7');
      expect(find.live).toHaveLength(3);
      // looked from a point and confirmed it: kept on the search, which stops keeping what it found
      await find.confirm({ lat: 17.03, lon: 45.1, heading: 80, view: 'Barry found' });
      const [url, body] = api.post.mock.calls.at(-1);
      expect(url).toBe('/api/cases/c1/horizon/finds/barry%20search/found');
      expect(body).toEqual({ lat: 17.03, lon: 45.1, heading: 80, view: 'Barry found' });
      expect(find.search.found.view).toBe('Barry found');
      expect(find.searching).toBe(true);
      // ended, the points held go: its record holds what it found
      record.status = 'cancelled';
      record.result = { partial: true, points: [point(1), point(2), point(3)], places: [point(3)] };
      await vi.advanceTimersByTimeAsync(2_000);
      expect(find.searching).toBe(false);
      expect(find.live).toEqual([]);
      expect(find.search.found.view).toBe('Barry found');
      api.del = vi.fn(async () => ({ ...record, found: undefined }));
      await find.unconfirm();
      expect(find.search.found).toBeUndefined();
      expect(api.del).toHaveBeenCalledWith('/api/cases/c1/horizon/finds/barry%20search/found');
      find.closeSearch();
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks with what the photo shows that rules points out, and keeps it', async () => {
    const asked = [];
    const post = vi.fn(async (url, body) => {
      asked.push([url, body]);
      return url.endsWith('/preview') ? { total: 0, kept: 0, kinds: {}, points: [] } : { name: 'barry search', status: 'queued', progress: { done: 0, total: 0 } };
    });
    const { find, overlay } = laid({ post });
    find.setArea(area);
    find.setWater(true);
    find.toggleOver('below');
    find.toggleOver('above');
    expect(find.over).toBe('above');
    find.toggleOver('above');
    expect(find.over).toBeNull();
    find.toggleOver('below');
    overlay.marks = { lines: [0], inner: [], pairs: [], cuts: [], far: [], sea: [0], clear: [] };
    await find.preview();
    expect(asked.at(-1)[1]).toMatchObject({ water: true, over: 'below', sea: true });
    await find.start('c1');
    expect(asked.at(-1)[1]).toMatchObject({ water: true, over: 'below', sea: true });
    expect(find.edited).toBe(false);
    find.setWater(false);
    expect(find.edited).toBe(true);
    find.setWater(true);
    const kept = structuredClone(find.snapshot);
    expect(kept).toMatchObject({ water: 'lake', over: 'below' });
    const { find: again } = laid();
    await again.restore(kept, null);
    expect([again.water, again.over]).toEqual(['lake', 'below']);
    find.closeSearch();
  });

  it('asks for the sea alone without a line traced along it, and opens a search that said so as it was', async () => {
    const asked = [];
    const post = vi.fn(async (url, body) => {
      asked.push([url, body]);
      return url.endsWith('/preview') ? { total: 0, kept: 0, kinds: {}, points: [] } : { name: 'sea search', status: 'queued', progress: { done: 0, total: 0 } };
    });
    const { find } = laid({ post });
    find.setArea(area);
    find.setWater('sea');
    await find.preview();
    expect(asked.at(-1)[1]).toMatchObject({ sea: true, water: false });
    find.setWater('river');
    expect(find.water).toBe(false);
    await find.preview();
    expect(asked.at(-1)[1]).toMatchObject({ sea: false, water: false });
    // a search kept with the sea said and no line along it opens with the sea said, one with the line with none
    const kept = (marks) => ({ name: 'sea search', status: 'done', result: null, ask: { area: area.map((p) => [p.lat, p.lon]), sea: true, water: false, photo: { path: 'media/barry.png', marks } } });
    const { find: again } = laid({ get: vi.fn(async () => kept(null)) });
    await again.openSearch('c1', 'sea search');
    expect(again.water).toBe('sea');
    const { find: lined } = laid({ get: vi.fn(async () => kept({ sea: [0] })) });
    await lined.openSearch('c1', 'sea search');
    expect(lined.water).toBe(false);
  });

  it('times this machine’s pace once a case holds it, again only once what it depends on changes', async () => {
    const paces = [];
    const post = vi.fn(async (url, body) => {
      if (url.endsWith('/pace')) {
        paces.push(body);
        return { seconds: 0.8, timed: 3, lanes: { fastest: 8, fast: 4, gentle: 1 }, lane_min: 200, full: 8, lane_power: 0.46, top: 5 };
      }
      return { points: 469, coarse: 400, spacing: 250, step: 0.5 };
    });
    const { find } = laid({ get: vi.fn(async () => []), post });
    find.setArea(area);
    await find.timePace();
    expect(paces).toHaveLength(0); // no case holds the search yet
    await find.refreshList('c1');
    await find.timePace();
    expect(post.mock.calls.at(-1)[0]).toBe('/api/cases/c1/horizon/finds/pace');
    expect(find.pace).toMatchObject({ seconds: 0.8, lanes: 4 });
    find.setSettings({ speed: 'gentle' });
    expect(find.pace.lanes).toBe(1);
    // the grid's density or speed leaves the pace as it was; which way the photo faces does not
    find.setSettings({ effort: 'thorough' });
    await find.timePace();
    expect(paces).toHaveLength(1);
    expect(paces[0].effort).toBe('normal');
    find.toggleFacing('e');
    await find.timePace();
    expect(paces).toHaveLength(2);
    expect(find.snapshot.effort).toBe('thorough');
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

  it('bounds a squat panorama of unknown width by the frame it could span, and a long one not at all', async () => {
    const { find, api, overlay } = laid({ panorama: true });
    overlay.aspect = 1.5;
    overlay.hints = { picture: 'panorama', zoom: [], facing: null, reach: 'auto' };
    find.setArea(area);
    await find.start('c1');
    expect(api.post.mock.calls.at(-1)[1].trace).toMatchObject({ projection: 'panorama', within: [60, 360], lens_max: 165 });
    find.closeSearch();
    const long = laid({ panorama: true });
    long.overlay.aspect = 4;
    long.overlay.hints = { picture: 'panorama', zoom: [], facing: null, reach: 'auto' };
    long.find.setArea(area);
    await long.find.start('c1');
    expect(long.api.post.mock.calls.at(-1)[1].trace).not.toHaveProperty('lens_max');
    long.find.closeSearch();
  });

  it('sends a lens measured on the video a twentieth either way, not held exact', async () => {
    const { find, api } = laid({ lens: { fov: 42, measured: true, at: 72.4 } });
    find.setArea(area);
    await find.start('c1');
    const body = api.post.mock.calls.at(-1)[1];
    expect(body.trace).toMatchObject({ known: false, fov: 42 });
    expect(body.trace.within[0]).toBeCloseTo(40, 9);
    expect(body.trace.within[1]).toBeCloseTo(44.1, 9);
    find.closeSearch();
  });

  it('sends the span a stitch says a fifth either way, never past a full turn', async () => {
    const { find, api } = laid({ lens: { fov: 160, stitched: true }, panorama: true });
    find.setArea(area);
    await find.start('c1');
    const body = api.post.mock.calls.at(-1)[1];
    expect(body.trace).toMatchObject({ known: false, fov: 160, projection: 'panorama' });
    expect(body.trace.within[0]).toBeCloseTo(128, 9);
    expect(body.trace.within[1]).toBeCloseTo(192, 9);
    find.closeSearch();
    const round = laid({ lens: { fov: 340, stitched: true }, panorama: true });
    round.find.setArea(area);
    await round.find.start('c1');
    expect(round.api.post.mock.calls.at(-1)[1].trace.within[1]).toBe(PANORAMA_WITHIN[1]);
    round.find.closeSearch();
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
    expect(find.settings).toEqual({ spacing: 250, tolerance: 2, speed: 'fast', effort: 'normal' });
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
    expect(again.settings).toEqual({ spacing: 250, tolerance: 2, speed: 'fast', effort: 'normal' });
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

  it('is this machine’s own once a few points are timed, several lanes faster on a large grid', () => {
    const paced = { seconds: 0.5, lanes: 4, lane_min: 200, full: 8, lane_power: 0.46, top: 5 };
    // 995 points as timed and 5 in full, on four lanes 4^0.46 (about 1.9) times as fast
    expect(pacedSeconds(1000, paced)).toBeCloseTo((0.5 * (995 + 40)) / 4 ** 0.46, 6);
    // a grid too small for lanes runs on one
    expect(pacedSeconds(100, paced)).toBeCloseTo(0.5 * (95 + 40), 6);
    expect(estimateText({ points: 6000, step: 0.5 }, paced)).toBe('6,000 points, about 27 min on this computer.');
    expect(durationText(6000, 0.5, 1, { ...paced, lanes: 1 })).toBe('about 50 min');
  });
});

describe('a grid laid wider than picked', () => {
  it('is said, for the area and for the zones', () => {
    expect(widenedText({ asked: null, spacing: 244.1, zones_wider: null })).toEqual([]);
    expect(widenedText({ asked: 20, spacing: 244.1, zones_wider: null })).toEqual([
      'Too large for a 20 m grid, even in hours: a point every 244 m. A zone searches finer.',
    ]);
    expect(widenedText({ asked: null, spacing: 500, zones_wider: 2.44 })).toEqual(['Zones too large for their grid: points 2.4× farther apart.']);
  });

  it('leaves Auto alone: it widens as it must', () => {
    expect(widenedText({ asked: 48, spacing: 75, zones_wider: null }, 'metric', false)).toEqual([]);
  });

  it('speaks the analyst’s units', () => {
    expect(widenedText({ asked: 20, spacing: 244.1 }, 'imperial')[0]).toBe('Too large for a 66 ft grid, even in hours: a point every 801 ft. A zone searches finer.');
  });
});

describe('the Mesh step’s check of water in sight', () => {
  const square = (lat, lon, d) => [
    { lat: lat - d, lon: lon - d },
    { lat: lat - d, lon: lon + d },
    { lat: lat + d, lon: lon + d },
    { lat: lat + d, lon: lon - d },
  ];

  it('starts, follows its progress, and reads the grid again once done, greying what it hid', async () => {
    vi.useFakeTimers();
    try {
      let previews = 0;
      const post = vi.fn(async (url) => {
        if (url.endsWith('/preview')) {
          previews += 1;
          return previews === 1
            ? { spacing: 250, total: 4, kept: 4, kinds: {}, points: [], ruled: {}, sight: { pending: 4, seconds: 1 } }
            : { spacing: 250, total: 4, kept: 1, kinds: {}, points: [], ruled: { waterhidden: 3 }, sight: { pending: 0, seconds: 0 } };
        }
        if (url.endsWith('/sight')) return { id: 'c1', status: 'running', done: 0, total: 4 };
        return {};
      });
      const { find, api } = finder({ post });
      const states = [
        { id: 'c1', status: 'running', done: 2, total: 4 },
        { id: 'c1', status: 'done', done: 4, total: 4 },
      ];
      api.get.mockImplementation(async () => states.shift());
      find.setArea(square(17, 45, 0.1));
      find.setWater('lake');
      await find.preview();
      expect(find.previewed.sight.pending).toBe(4);
      const checking = find.checkSight();
      await vi.advanceTimersByTimeAsync(0);
      expect(post).toHaveBeenCalledWith('/api/horizon/finds/sight', expect.objectContaining({ water: true }));
      expect(find.sighting).toEqual({ id: 'c1', done: 0, total: 4 });
      await vi.advanceTimersByTimeAsync(400);
      expect(find.sighting).toEqual({ id: 'c1', done: 2, total: 4 });
      await vi.advanceTimersByTimeAsync(400);
      await checking;
      expect(api.get).toHaveBeenCalledWith('/api/horizon/finds/sight/c1');
      expect(find.sighting).toBeNull();
      expect(find.previewed.ruled).toEqual({ waterhidden: 3 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops when asked, and says a check that failed', async () => {
    vi.useFakeTimers();
    try {
      const post = vi.fn(async (url) => {
        if (url.endsWith('/preview')) return { spacing: 250, total: 4, kept: 4, kinds: {}, points: [], ruled: {}, sight: { pending: 4, seconds: 1 } };
        if (url.endsWith('/sight')) return { id: 'c2', status: 'running', done: 0, total: 4 };
        return { id: 'c2', status: 'running' };
      });
      const { find, api } = finder({ post });
      api.get.mockResolvedValue({ id: 'c2', status: 'failed', error: 'The terrain could not be loaded: offline' });
      find.setArea(square(17, 45, 0.1));
      find.setWater('sea');
      await find.preview();
      const checking = find.checkSight();
      await vi.advanceTimersByTimeAsync(0);
      await find.stopSight();
      expect(post).toHaveBeenCalledWith('/api/horizon/finds/sight/c2/cancel', {});
      await vi.advanceTimersByTimeAsync(400);
      await checking;
      expect(find.sighting).toBeNull();
      expect(find.sightFailed).toBe('The terrain could not be loaded: offline');
    } finally {
      vi.useRealTimers();
    }
  });
});
