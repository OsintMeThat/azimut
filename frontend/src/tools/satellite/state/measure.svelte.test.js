// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMeasureState, EYE_HEIGHT, PROFILE_SAMPLES, usableDate, VIEWSHED_REACH } from './measure.svelte.js';

/**
 * The Measure tool's own rules, apart from the map it draws on.
 *
 * The arithmetic has its own tests (lib/measure.js, lib/measures.js); what is
 * asserted here is which points a click makes, what is read and when, and what
 * reaches the drawing layers. The map is a flat sheet a thousand pixels to the
 * degree unless a test says otherwise, so "near" on screen is easy to place.
 */

const A = { lat: 46, lon: 7 };
const B = { lat: 46, lon: 7.02 };
const C = { lat: 46.02, lon: 7.02 };
const D = { lat: 46.02, lon: 7 };
let px;

let layers;
let engine;
let api;
let relief;
let picture;
let targets;
const copy = vi.fn();

function fakeLayer() {
  const layer = {
    sets: [],
    patches: [],
    shown: true,
    set: vi.fn((shapes) => layer.sets.push(shapes.filter(Boolean))),
    patch: vi.fn((id, patch) => layer.patches.push([id, patch])),
    visible: vi.fn((on) => (layer.shown = on)),
    clear: vi.fn(),
    destroy: vi.fn(),
    get last() {
      return layer.sets.at(-1) ?? [];
    },
  };
  return layer;
}

function store() {
  return createMeasureState({
    engine: () => engine,
    api,
    units: () => 'metric',
    coords: (lat, lon) => `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
    relief: () => relief,
    snapTargets: () => targets,
    pictureDate: () => picture,
    copy,
    surface: () => {
      const layer = fakeLayer();
      layers.push(layer);
      return layer;
    },
  });
}

/** The three layers, in the order the store asks for them. */
const fills = () => layers[0];
const shapes = () => layers[1];
const words = () => layers[2];

const PROFILE = {
  distance_m: [0, 800, 1550],
  lat: [46, 46, 46],
  lon: [7, 7.01, 7.02],
  elevation: [800, 900, 850],
  corners: [800, 850],
  sight: { visible: false, blocked_at_m: 800, seen: [true, true, false], eye_m: 801.7, target_m: 850, angle_deg: 1.8 },
};

beforeEach(() => {
  localStorage.clear();
  px = 1000;
  layers = [];
  relief = false;
  picture = null;
  targets = [];
  engine = {
    latLngToContainerPoint: ({ lat, lon }) => ({ x: lon * px, y: -lat * px }),
    readClicks: vi.fn(),
  };
  api = {
    post: vi.fn(async (url) => (url.endsWith('/profile') ? PROFILE : { lat: 46, lon: 7, step_deg: 90, runs: [[0, 500], [], [], []], share: 0.31, radius_m: 1550 })),
    get: vi.fn(async () => ({ date: '2024-06-21', moments: [{ local: '2024-06-21T14:12:00+02:00', abbreviation: 'CEST', height_m: 23.4, sun_azimuth: 270, sun_altitude: 41.2 }] })),
  };
});

/** A measure drawn through the points, finished with a double click on the last one. */
function drawn(tool, ...points) {
  for (const point of points) tool.addPoint(point);
  tool.addPoint(points.at(-1));
  return tool.measures.at(-1);
}

describe('drawing a measure', () => {
  it('takes no click while it is closed', () => {
    const tool = store();
    expect(tool.addPoint(A)).toBe(false);
    expect(tool.measures).toEqual([]);
  });

  it('starts at a click, adds a point at each one, and finishes on a double click', () => {
    const tool = store();
    tool.open();
    expect(tool.hint).toBe('Click to start a measure');
    tool.addPoint(A);
    expect(tool.drawing).toBe(true);
    expect(tool.hint).toBe('Click the next point');
    tool.addPoint(B);
    expect(tool.hint).toBe('Double-click or Enter to finish');
    // the second click of the double click lands on the last point
    tool.addPoint({ lat: B.lat, lon: B.lon + 0.002 });
    expect(tool.drawing).toBe(false);
    expect(tool.measures[0].points).toEqual([A, B]);
    expect(tool.selectedId).toBe(tool.measures[0].id);
    expect(tool.readout).toMatch(/^1\.55 km · 090°$/);
  });

  it('closes into an area at a click on its first point', () => {
    const tool = store();
    tool.open();
    for (const point of [A, B, C]) tool.addPoint(point);
    expect(tool.hint).toBe('Double-click to finish, or click the first point for an area');
    tool.addPoint({ lat: A.lat + 0.005, lon: A.lon });
    const [area] = tool.measures;
    expect(area.closed).toBe(true);
    expect(area.points).toHaveLength(3);
    expect(tool.readout).toMatch(/^1\.7\d km²$/);
  });

  it('ignores the second click of a double click on a lone point', () => {
    const tool = store();
    tool.open();
    tool.addPoint(A);
    tool.addPoint(A);
    expect(tool.measures[0].points).toEqual([A]);
    expect(tool.drawing).toBe(true);
  });

  it('finishes on Enter, and drops a measure of one point', () => {
    const tool = store();
    tool.open();
    expect(tool.finish()).toBe(false);
    tool.addPoint(A);
    expect(tool.finish()).toBe(true);
    expect(tool.measures).toEqual([]);
  });

  it('takes the last point back on Backspace, and the measure with its only one', () => {
    const tool = store();
    tool.open();
    tool.addPoint(A);
    tool.addPoint(B);
    expect(tool.undo()).toBe(true);
    expect(tool.measures[0].points).toEqual([A]);
    tool.undo();
    expect(tool.measures).toEqual([]);
    expect(tool.undo()).toBe(false);
  });

  it('finishes on Escape, then lets go of the selection, then has nothing left', () => {
    const tool = store();
    tool.open();
    tool.addPoint(A);
    tool.addPoint(B);
    expect(tool.escape()).toBe(true);
    expect(tool.measures).toHaveLength(1);
    expect(tool.selectedId).not.toBe(null);
    expect(tool.escape()).toBe(true);
    expect(tool.selectedId).toBe(null);
    expect(tool.escape()).toBe(false);
  });

  it('keeps a finished measure and starts another at the next click', () => {
    const tool = store();
    tool.open();
    drawn(tool, A, C);
    drawn(tool, B, D);
    expect(tool.measures).toHaveLength(2);
    // two lines crossing: the point they meet at is marked, and copied when pressed
    const crossing = shapes().last.find((shape) => shape.className === 'measure-crossing');
    expect(crossing.at.lat).toBeCloseTo(46.01, 3);
    crossing.onClick();
    expect(copy).toHaveBeenCalledWith(expect.stringMatching(/^46\.0100, 7\.0100$/));
  });

  it('removes the selected measure on Delete, never one being drawn', () => {
    const tool = store();
    tool.open();
    drawn(tool, A, B);
    tool.addPoint(C);
    expect(tool.removeSelected()).toBe(false);
    tool.escape(); // a lone point finished is no measure
    tool.select(tool.measures[0].id);
    expect(tool.removeSelected()).toBe(true);
    expect(tool.measures).toEqual([]);
  });

  it('writes a corner its angle outside it, on the measure in hand only', () => {
    px = 100_000;
    const tool = store();
    tool.open();
    drawn(tool, A, B, C);
    const angle = words().last.find((word) => word.id.endsWith('angle-1'));
    // the corner at B opens west and north: its outside is east and south, down and right on screen
    const [dx, dy] = angle.html.match(/translate\((-?[\d.]+)px,(-?[\d.]+)px\)/).slice(1).map(Number);
    expect(dx).toBeGreaterThan(0);
    expect(dy).toBeGreaterThan(0);
    drawn(tool, D, { lat: D.lat + 0.01, lon: D.lon }, { lat: D.lat + 0.01, lon: D.lon + 0.01 });
    expect(words().last.filter((word) => word.id.includes('angle'))).toHaveLength(1);
  });

  it('lets a corner go only while the shape keeps enough of them', () => {
    const tool = store();
    tool.open();
    const line = drawn(tool, A, B);
    const corner = shapes().last.find((shape) => shape.id === `m${line.id}-corner-0`);
    corner.onContextMenu();
    expect(tool.measures[0].points).toHaveLength(2);
    const bent = drawn(tool, A, B, C);
    tool.select(bent.id);
    shapes().last.find((shape) => shape.id === `m${bent.id}-corner-1`).onContextMenu();
    expect(tool.measures[1].points).toEqual([A, C]);
  });
});

describe('the map while the tool is open', () => {
  it('reads clicks as clicks, so a double click on the globe is two', () => {
    const tool = store();
    tool.open();
    expect(engine.readClicks).toHaveBeenLastCalledWith(true);
    tool.close();
    expect(engine.readClicks).toHaveBeenLastCalledWith(false);
  });

  it('finishes what is drawn and takes its layers off the map when closed, and puts them back', () => {
    const tool = store();
    tool.open();
    tool.addPoint(A);
    tool.addPoint(B);
    tool.close();
    expect(tool.drawing).toBe(false);
    expect(tool.measures).toHaveLength(1);
    expect(layers.every((layer) => layer.shown === false)).toBe(true);
    tool.open();
    expect(layers.every((layer) => layer.shown === true)).toBe(true);
  });

  it('writes each leg its words, unless the leg is too short on screen to hold them', () => {
    px = 100_000;
    const tool = store();
    tool.open();
    drawn(tool, A, B);
    // set off above a level leg, clear of the dot that bends it
    expect(words().last.map((word) => word.html)).toEqual(['<span style="transform:translate(0.0px,-13.0px)">1.55 km · 090°</span>']);
    drawn(tool, C, { lat: C.lat, lon: C.lon + 0.00005 });
    expect(words().last).toHaveLength(1);
  });

  it('puts a click on a place or another measure within a few pixels, unless Alt is held', () => {
    targets = [{ lat: 46.5, lon: 7.5, label: 'Checkpoint' }];
    const tool = store();
    tool.open();
    const near = { lat: 46.505, lon: 7.5 };
    expect(tool.snap(near).point).toEqual({ lat: 46.5, lon: 7.5 });
    expect(tool.snap(near, { free: true }).point).toEqual(near);
    expect(tool.snap({ lat: 46.6, lon: 7.5 }).target).toBe(null);
    drawn(tool, A, B);
    expect(tool.snap({ lat: 46.004, lon: 7.02 }).point).toEqual(B);
  });

  it('follows the pointer with the stretch to come and what it adds', () => {
    targets = [{ lat: 46, lon: 7.04, label: 'Bridge' }];
    const tool = store();
    tool.open();
    tool.addPoint(A);
    tool.addPoint(B);
    tool.follow({ lat: 46.003, lon: 7.04 });
    expect(tool.live.to).toEqual({ lat: 46, lon: 7.04 });
    expect(tool.live.label).toBe('Bridge');
    expect(tool.live.text).toMatch(/^1\.55 km · 090° · total 3\.09 km$/);
    tool.addPoint(C);
    tool.follow({ lat: A.lat, lon: A.lon + 0.004 });
    expect(tool.live.closing).toBe(true);
    expect(tool.live.text).toBe('Click to close the area');
  });
});

describe('the ground under a line', () => {
  it('asks the terrain server nothing until the Ground switch or the 3D view says so', async () => {
    const tool = store();
    tool.open();
    drawn(tool, A, B);
    expect(api.post).not.toHaveBeenCalled();
    tool.setGround(true);
    await vi.waitFor(() => expect(tool.ground?.answer).toEqual(PROFILE));
    expect(api.post).toHaveBeenCalledWith('/api/terrain/profile', {
      points: [[46, 7], [46, 7.02]],
      samples: PROFILE_SAMPLES,
      sight: true,
      eye_height: EYE_HEIGHT,
      target_height: 0,
    });
    expect(localStorage.getItem('azimut:measureGround')).toBe('on');
  });

  it('reads it at once in 3D, where the relief is read anyway', async () => {
    relief = true;
    const tool = store();
    tool.open();
    drawn(tool, A, B);
    expect(tool.groundForced).toBe(true);
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  });

  it('reads the line in hand once the 3D view comes up', async () => {
    const tool = store();
    tool.open();
    drawn(tool, A, B);
    tool.readAgain();
    expect(api.post).not.toHaveBeenCalled();
    relief = true;
    tool.readAgain();
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  });

  it('draws what the eye at A sees of the line in two colours, and where the ground is in the way', async () => {
    relief = true;
    const tool = store();
    tool.open();
    const line = drawn(tool, A, B);
    await vi.waitFor(() => expect(tool.ground?.answer).toBeTruthy());
    const sight = shapes().last.filter((shape) => shape.id?.startsWith(`m${line.id}-sight-`));
    expect(sight.map((shape) => shape.style.stroke)).toEqual(['#66b578', '#d97070']);
    expect(shapes().last.some((shape) => shape.id === `m${line.id}-blocked`)).toBe(true);
  });

  it('asks again for new heights, and again after a corner is dropped somewhere else', async () => {
    relief = true;
    const tool = store();
    tool.open();
    const line = drawn(tool, A, B);
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    tool.setHeights({ eye: 10 });
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(api.post.mock.calls[1][1].eye_height).toBe(10);
    const corner = shapes().last.find((shape) => shape.id === `m${line.id}-corner-1`);
    corner.onDrag(C);
    expect(shapes().patches.some(([id]) => id === `m${line.id}`)).toBe(true);
    corner.onDragEnd();
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledTimes(3));
  });

  it('starts nothing at the click a dropped corner brings, then starts a measure again', () => {
    vi.useFakeTimers();
    try {
      const tool = store();
      tool.open();
      const line = drawn(tool, A, B);
      const corner = shapes().last.find((shape) => shape.id === `m${line.id}-corner-1`);
      corner.onDrag(C);
      corner.onDragEnd();
      expect(tool.addPoint(C)).toBe(true);
      expect(tool.measures).toHaveLength(1);
      expect(tool.drawing).toBe(false);
      expect(tool.selectedId).toBe(line.id);
      vi.advanceTimersByTime(500);
      tool.addPoint(D);
      expect(tool.measures).toHaveLength(2);
      expect(tool.drawing).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('puts the heights chart away and shows it again, and the Ground switch brings it back', () => {
    const tool = store();
    expect(tool.chartShown).toBe(true);
    tool.showChart(false);
    expect(tool.chartShown).toBe(false);
    tool.showChart(true);
    expect(tool.chartShown).toBe(true);
    tool.showChart(false);
    tool.setGround(true);
    expect(tool.chartShown).toBe(true);
  });

  it('keeps only the answer to the last question asked', async () => {
    relief = true;
    let release;
    api.post = vi.fn(() => new Promise((resolve) => (release = resolve)));
    const tool = store();
    tool.open();
    drawn(tool, A, B);
    const first = release;
    tool.setHeights({ eye: 5 });
    const second = release;
    second({ ...PROFILE, corners: [1, 2] });
    first(PROFILE);
    await vi.waitFor(() => expect(tool.ground?.answer?.corners).toEqual([1, 2]));
  });

  it('reads the chart where the pointer is over the line, and marks it there', async () => {
    relief = true;
    const tool = store();
    tool.open();
    drawn(tool, A, B);
    await vi.waitFor(() => expect(tool.ground?.answer).toBeTruthy());
    tool.follow({ lat: 46.0005, lon: 7.0099 });
    expect(tool.readIndex).toBe(1);
    expect(shapes().last.some((shape) => shape.kind === 'dot' && shape.style.stroke === '#4cc3ff')).toBe(true);
    tool.follow({ lat: 46.5, lon: 7.5 });
    expect(tool.readIndex).toBe(null);
  });
});

describe('what a line of two points is used as', () => {
  it('draws rings round A and gives them back with the same press', () => {
    const tool = store();
    tool.open();
    const line = drawn(tool, A, B);
    tool.setUse(line.id, 'ring');
    tool.setRings(line.id, 3);
    // each ring on its dark casing, in a colour of its own
    const rings = shapes().last.filter((shape) => shape.kind === 'circle');
    expect(rings).toHaveLength(6);
    expect(rings.filter((ring) => ring.id.endsWith('-casing'))).toHaveLength(3);
    expect(new Set(rings.filter((ring) => !ring.id.endsWith('-casing')).map((ring) => ring.style.stroke))).toEqual(new Set(['#2de0ff']));
    expect(tool.readout).toBe('Radius 1.55 km');
    expect(tool.readingOf(line.id)).toBe('Radius 1.55 km');
    tool.setUse(line.id, 'ring');
    expect(shapes().last.some((shape) => shape.kind === 'circle')).toBe(false);
  });

  it('offers nothing to a line of three points', () => {
    const tool = store();
    tool.open();
    const line = drawn(tool, A, B, C);
    tool.setUse(line.id, 'ring');
    expect(tool.measures[0].use).toBe(null);
  });

  it('reads the ground in sight from A out to B, as far as a viewshed reaches', async () => {
    const tool = store();
    tool.open();
    const line = drawn(tool, A, { lat: 46, lon: 7.6 }); // about 46 km
    tool.setUse(line.id, 'viewshed');
    await vi.waitFor(() => expect(fills().last).toHaveLength(1));
    expect(api.post).toHaveBeenCalledWith('/api/terrain/viewshed', {
      lat: 46,
      lon: 7,
      radius_m: VIEWSHED_REACH,
      eye_height: EYE_HEIGHT,
      target_height: 0,
    });
    expect(fills().last[0].geometry.type).toBe('MultiPolygon');
    expect(tool.readout).toMatch(/31% in sight$/);
  });

  it('reads a shadow on the picture’s own day, and asks for a day when the picture has none', async () => {
    picture = '2021';
    const tool = store();
    tool.open();
    const line = drawn(tool, A, B);
    tool.setUse(line.id, 'shadow');
    expect(api.get).not.toHaveBeenCalled();
    expect(tool.shadowDate(line.id)).toBe(null);
    tool.setShadowDate(line.id, '2024-06-21');
    await vi.waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    const asked = new URLSearchParams(api.get.mock.calls[0][0].split('?')[1]);
    expect(asked.get('date')).toBe('2024-06-21');
    expect(Number(asked.get('bearing'))).toBeCloseTo(90, 1);
    expect(Number(asked.get('length'))).toBeCloseTo(1545, -1);
    await vi.waitFor(() => expect(tool.readout).toBe('About 23 m tall (sun at 270°, 41.2° up at 14:12 CEST)'));
    expect(words().last.some((word) => word.html.includes('≈ 23 m tall'))).toBe(true);
  });

  it('gives a line an exact length or bearing by moving B', () => {
    const tool = store();
    tool.open();
    const line = drawn(tool, A, B);
    tool.setLength(line.id, 5000);
    expect(tool.readout).toMatch(/^5\.00 km · 090°$/);
    tool.setBearing(line.id, 0);
    expect(tool.readout).toMatch(/^5\.00 km · 000°$/);
    expect(tool.measures[0].points[1].lat).toBeGreaterThan(46.04);
  });

  it('turns a line round to look from B', () => {
    const tool = store();
    tool.open();
    const line = drawn(tool, A, B);
    tool.swap(line.id);
    expect(tool.measures[0].points).toEqual([B, A]);
  });
});

describe('keeping and saying a measure', () => {
  it('reads in the units the tool was set to, and remembers them', () => {
    const tool = store();
    tool.open();
    drawn(tool, A, B);
    tool.setUnits('nautical');
    expect(tool.readout).toMatch(/NM/);
    expect(store().unitsChoice).toBe('nautical');
    tool.setUnits(null);
    expect(tool.readout).toMatch(/km/);
  });

  it('makes a layer feature named by what it reads: a line, an area, a ring', () => {
    const tool = store();
    tool.open();
    const line = drawn(tool, A, B);
    expect(tool.feature(line.id).geometry.type).toBe('LineString');
    expect(tool.feature(line.id).name).toMatch(/^1\.55 km · 090°$/);
    expect(tool.feature(line.id).description).toContain('bearing 090.0°');
    tool.setUse(line.id, 'ring');
    expect(tool.feature(line.id).geometry.type).toBe('Polygon');
    tool.addPoint(A);
    tool.addPoint(B);
    tool.addPoint(C);
    tool.addPoint({ lat: A.lat, lon: A.lon });
    const area = tool.feature(tool.measures.at(-1).id);
    expect(area.geometry.type).toBe('Polygon');
    expect(area.geometry.coordinates[0][0]).toEqual(area.geometry.coordinates[0].at(-1));
  });
});

describe('the picture’s date', () => {
  it('is a day, or nothing a shadow can be read on', () => {
    expect(usableDate('2024-06-21')).toBe('2024-06-21');
    expect(usableDate('2021')).toBe(null);
    expect(usableDate(null)).toBe(null);
  });
});
