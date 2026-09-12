// @vitest-environment happy-dom
/**
 * The map tools' state machines, and everything they copy from the app.
 *
 * The extension ships as classic scripts with no build step, so five of the
 * app's modules are written a second time over there: the lattice
 * (`gridSearch.js`), the measures (`measure.js`), the sky arc
 * (`skyOverlay.js`), the mark grouping (`savedMarkers.js`) and the reference
 * windows' geometry (`refViewers.js`). Two copies is
 * normally how two answers to one question start appearing, so each is run here
 * against the app's own and compared — a cell addressed differently is a
 * different patch of ground, and an arc that closes through the hours a body
 * spends below the horizon is a picture that lies.
 *
 * The rest is ordinary state-machine testing: what a click does, what the panel
 * reads, and the rules that carry a claim — a pin never invents a ground point,
 * a mark is a patch rather than a copy of the grid, and a tool can always be
 * put down.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as app from './gridSearch.js';
import * as appSky from './skyOverlay.js';
import * as appMarkers from './savedMarkers.js';
import * as appRefs from './refViewers.js';

const here = dirname(fileURLToPath(import.meta.url));
const load = (name) => readFileSync(join(here, `../../../extension/${name}`), 'utf8');

let ext;

beforeAll(() => {
  const scope = { window: {} };
  // each file reads the globals the ones before it left, as the browser loads them
  new Function('window', load('mapmath.js'))(scope.window);
  new Function('window', load('maptheme.js'))(scope.window);
  new Function('window', load('maptools.js'))(scope.window);
  ext = scope.window.AzimutMapTools;
});

const BOUNDS = { south: 48.85, west: 2.29, north: 48.88, east: 2.34 };
const AOI = { type: 'rect', bounds: BOUNDS };
const SHAPE = [
  [48.85, 2.29],
  [48.88, 2.3],
  [48.87, 2.34],
  [48.855, 2.33],
];

describe('the grid spec, on both sides of the boundary', () => {
  it('builds the same lattice as the app', () => {
    for (const cell of [100, 500, 2000]) {
      expect(ext.createGrid(AOI, cell)).toEqual(app.createGrid(AOI, cell));
    }
  });

  it('builds the same lattice over a drawn shape', () => {
    const aoi = { type: 'polygon', vertices: SHAPE };
    expect(ext.createGrid(aoi, 500)).toEqual(app.createGrid(aoi, 500));
    const grid = ext.createGrid(aoi, 500);
    // the cells a slanted edge keeps are the ones that decide whether water
    // gets swept, so they are compared cell by cell
    expect(ext.cellsInAoi(grid)).toEqual(app.cellsInAoi(grid));
  });

  it('stops at the same ceiling', () => {
    expect(ext.MAX_CELLS).toBe(app.MAX_CELLS);
  });

  it('addresses a cell by the same key', () => {
    expect(ext.cellKey(3, -2)).toBe(app.cellKey(3, -2));
    const grid = ext.createGrid(AOI, 500);
    expect(ext.cellRange(grid)).toEqual(app.cellRange(grid));
  });

  it('agrees about cell size at every latitude that matters', () => {
    for (const lat of [0, 23.5, 48.8584, -33.8568, 71, 89.9]) {
      expect(ext.degSteps(lat, 500)).toEqual(app.degSteps(lat, 500));
    }
  });

  it('agrees about which points and cells a shape contains', () => {
    for (const pt of [
      { lat: 48.86, lon: 2.31 },
      { lat: 48.9, lon: 2.31 },
      { lat: 48.85, lon: 2.29 },
    ]) {
      expect(ext.pointInPolygon(pt, SHAPE), JSON.stringify(pt)).toBe(app.pointInPolygon(pt, SHAPE));
    }
    const grid = ext.createGrid({ type: 'polygon', vertices: SHAPE }, 500);
    for (const [i, j] of ext.cellRangeCells ?? [[0, 0], [2, 3], [5, 1]]) {
      const b = ext.cellBounds(grid, i, j);
      expect(ext.rectIntersectsPolygon(b, SHAPE)).toBe(app.rectIntersectsPolygon(b, SHAPE));
    }
  });

  it('closes a ring the same way, and only once it is a shape', () => {
    const points = SHAPE.map(([lat, lon]) => ({ lat, lon }));
    expect(ext.closeRing(points.slice(0, 2))).toHaveLength(2);
    expect(ext.closeRing(points)).toHaveLength(points.length + 1);
    expect(ext.closeRing(points).at(-1)).toEqual(points[0]);
  });

  it('addresses the same ground with the same indices', () => {
    const grid = ext.createGrid(AOI, 500);
    for (const [i, j] of [[0, 0], [3, 5], [-2, 1]]) {
      expect(ext.cellBounds(grid, i, j)).toEqual(app.cellBounds(grid, i, j));
    }
    expect(ext.cellsInAoi(grid)).toEqual(app.cellsInAoi(grid));
    expect(ext.estimateCells(grid)).toBe(app.estimateCells(grid));
  });

  it('tallies coverage the same way', () => {
    const grid = ext.createGrid(AOI, 500);
    grid.statuses = { '0:0': 'cleared', '1:1': 'flagged', '2:2': 'cleared' };
    expect(ext.coverage(grid)).toEqual(app.coverage(grid));
  });

  it('cycles a cell through the same three states', () => {
    let status;
    for (let n = 0; n < 4; n += 1) {
      const mine = ext.cycleStatus(status);
      expect(mine).toBe(app.cycleStatus(status));
      status = mine;
    }
  });

  it('pins the lattice to the corner, so resizing cannot shift a mark', () => {
    const grid = ext.createGrid(AOI, 500);
    const wider = ext.createGrid({ type: 'rect', bounds: { ...BOUNDS, east: 2.4 } }, 500);
    expect(wider.anchor).toEqual(grid.anchor);
    expect(ext.cellBounds(wider, 2, 3)).toEqual(ext.cellBounds(grid, 2, 3));
  });
});

describe('the sky arc, on both sides', () => {
  const ALTITUDES = [-5, -1, 3, 20, 45, 12, -2, -30, 4, 9];
  const MINUTES = ALTITUDES.map((_, i) => i * 60);

  it('draws the same runs of daylight', () => {
    expect(ext.upRuns(ALTITUDES)).toEqual(appSky.upRuns(ALTITUDES));
  });

  it('ticks the same hours', () => {
    expect(ext.hourTicks(MINUTES, ALTITUDES)).toEqual(appSky.hourTicks(MINUTES, ALTITUDES));
  });

  it('rides the mark up the ray by the same fraction', () => {
    for (const altitude of [0, 12.5, 45, 89.9]) {
      expect(ext.markScale(altitude)).toBe(appSky.markScale(altitude));
    }
  });
});

describe('grouping saved work into marks, on both sides', () => {
  const ROWS = [
    { id: 'a', kind: 'place', title: 'Gate', lat: 48.8584, lon: 2.2945 },
    { id: 'b', kind: 'capture', title: 'Roof', lat: 48.85841, lon: 2.29451 },
    { id: 'c', kind: 'place', title: 'Far', lat: 48.9, lon: 2.4 },
    { id: 'd', kind: 'place', title: 'Nowhere', lat: null, lon: null },
  ];

  it('coarsens the key at the same zooms', () => {
    for (const zoom of [null, 3, 6, 9, 12, 15, 18]) {
      expect(ext.markerPrecision(zoom), String(zoom)).toBe(appMarkers.markerPrecision(zoom));
    }
  });

  it('merges the same rows into the same marks', () => {
    for (const precision of [0, 3, 5]) {
      expect(ext.groupSavedMarkers(ROWS, precision)).toEqual(
        appMarkers.groupSavedMarkers(ROWS, precision)
      );
    }
  });
});

describe('the geometry verdict', () => {
  /** The line a view with no stated scale shows until a drag measures it.
   *  Read from the panel rather than spelled again, so the assertions below say
   *  which branch was taken; what it says is pinned once, on its own. Read
   *  through a function because the panel is loaded in `beforeAll`, after this
   *  block has been walked. */
  const measureMe = () => ext.MEASURE_ME;

  const MAP = {
    site: 'google-maps',
    lat: 48.8584,
    lon: 2.2945,
    zoom: 17,
    view_kind: 'map',
    projection: 'webmercator',
    globe_below: 4,
    scale_source: 'zoom',
    geometry: true,
  };

  it('asks for the drag that would measure it, in terms of what makes one count', () => {
    // "Pan once" was true and useless: a scale is two numbers, so a sideways
    // drag gives half of one, and a drag let go of mid-flight is a landing the
    // pointer never made. Neither condition was on screen, so a drag that did
    // not count looked exactly like one that did.
    expect(measureMe()).toBe('Drag the map across and down, pausing before you let go');
  });

  it('lets a straight-down map through', () => {
    expect(ext.verdict(MAP, null)).toEqual({ ok: true, why: '', far: false });
  });

  it('draws on Apple from the span its address bar states', () => {
    // Apple states no usable zoom, but it does state the span its view covers,
    // which is a scale next to the height it was drawn in — no pan needed.
    const apple = { ...MAP, site: 'apple-maps', scale_source: 'span' };
    expect(ext.verdict(apple, null, false)).toEqual({ ok: true, why: '', far: false });
  });

  it('waits for a measurement where the URL states no scale at all', () => {
    const mute = { ...MAP, scale_source: null };
    expect(ext.verdict(mute, null, false).why).toBe(measureMe());
    expect(ext.verdict(mute, null, true)).toEqual({ ok: true, why: '', far: false });
  });

  it('refuses a page that is not a map at all', () => {
    expect(ext.verdict({ site: null }, null).why).toMatch(/not a map Azimut can read/);
    expect(ext.verdict(null, null).ok).toBe(false);
  });

  it('waits for the address bar to carry a position', () => {
    expect(ext.verdict({ ...MAP, lat: null, lon: null }, null).why).toMatch(/move the map once/);
  });

  it('names the way out of every view it refuses', () => {
    // each of these is a setting the analyst can change, so the line says which
    for (const [kind, why] of [
      ['streetview', 'These tools work on the map, not in Street View'],
      ['tilted', 'These tools work in 2D only, so turn 3D off'],
    ]) {
      expect(ext.verdict({ ...MAP, view_kind: kind, geometry: false }, null).why).toBe(why);
    }
    expect(ext.verdict({ ...MAP, view_kind: 'hologram', geometry: false }, null).why)
      .toBe('This view is not a map to measure on');
  });

  it('refuses a pitched camera in the viewer\'s own words, not in degrees', () => {
    // The pitch the URL states is the app's reading of the camera, and an angle
    // is not something anyone can go and switch off. Whether the view is 40° or
    // 3° past level, the way out is the same button, so the sentence is too.
    const tilted = { ...MAP, view_kind: 'tilted', geometry: false, tilt: 39.6 };
    expect(ext.verdict(tilted, null).why).toBe('These tools work in 2D only, so turn 3D off');
    expect(ext.verdict({ ...tilted, tilt: null }, null).why)
      .toBe('These tools work in 2D only, so turn 3D off');
  });

  it('draws on a satellite view from the height in metres it quotes', () => {
    // Google drops the zoom in satellite and quotes the viewport's own height
    // in metres. Next to the number of pixels it was drawn in, that is a zoom,
    // and the app hands one back (scale_source: height_m).
    const satellite = { ...MAP, zoom: 15.0015, scale_source: 'height_m' };
    expect(ext.verdict(satellite, null, false)).toEqual({ ok: true, why: '', far: false });

    // …and without a height to divide by, there is no zoom and no scale
    const blind = { ...MAP, zoom: null, geometry: false, scale_source: null };
    expect(ext.verdict(blind, null, false).why).toBe(measureMe());
    expect(ext.verdict(blind, null, true)).toEqual({ ok: true, why: '', far: false });
  });

  it('measures its way onto a level Earth view, which names no projection', () => {
    // a camera pointed straight down is a uniform scaling of the ground, and a
    // measured scale needs neither a zoom nor a named flattening
    const earth = { site: 'google-earth', lat: 48.8, lon: 2.3, zoom: null,
      view_kind: 'map', projection: null, globe_below: null, scale_source: null,
      geometry: false };
    expect(ext.verdict(earth, null, false).why).toBe(measureMe());
    expect(ext.verdict(earth, null, true)).toEqual({ ok: true, why: '', far: false });
  });

  it('keeps drawing when the site has gone to a globe, and says it drifts', () => {
    // A whole region's worth of marks is worth seeing at a glance. The middle
    // of the screen is still right out here; the edges are not, and the panel
    // dims what it draws rather than refusing to draw it.
    const wide = ext.verdict({ ...MAP, zoom: 3, far: true }, null);
    expect(wide.ok).toBe(true);
    expect(wide.far).toBe(true);
    expect(wide.why).toBe('Zoomed out: marks drift from the middle of the screen');

    // …and in close, nothing is said at all
    expect(ext.verdict({ ...MAP, far: false }, null)).toEqual({ ok: true, why: '', far: false });
  });

  it('still refuses a globe camera whose scale nothing has measured', () => {
    // Earth far out: no flattening named, no zoom quoted, nothing measured yet
    const earth = { site: 'google-earth', lat: 48.8, lon: 2.3, zoom: null, view_kind: 'globe',
      projection: null, globe_below: null, scale_source: null, geometry: false, far: true };
    expect(ext.verdict(earth, null, false).why).toBe(measureMe());
    expect(ext.verdict(earth, null, true)).toEqual({
      ok: true, why: 'Zoomed out: marks drift from the middle of the screen', far: true,
    });
  });

  it('falls back to the general refusal when the view names no camera at all', () => {
    expect(ext.verdict({ ...MAP, view_kind: null, geometry: false, globe_below: null }, null).why)
      .toBe('This view is not one Azimut can compute on');
  });

  it('stops drawing when the map stops going where it was predicted', () => {
    // the overlay only passes a residual once a run of pans has missed — one
    // overshoot is these maps gliding on after the finger leaves
    expect(ext.verdict(MAP, ext.RESIDUAL_LIMIT).ok).toBe(true);
    const drifted = ext.verdict(MAP, ext.RESIDUAL_LIMIT + 40);
    expect(drifted.ok).toBe(false);
    expect(drifted.why).toMatch(/^The map landed \d+ px from where it was predicted/);
    expect(drifted.why).toMatch(/Pan once to measure it again$/);
  });
});

describe('measure', () => {
  it('holds one mode and one path at a time', () => {
    const tool = ext.createMeasure();
    expect(tool.armed).toBe(false);
    tool.setMode('distance');
    expect(tool.armed).toBe(true);
    tool.click({ lat: 48.85, lon: 2.29 });
    tool.click({ lat: 48.86, lon: 2.29 });
    expect(tool.points).toHaveLength(2);
    tool.setMode('area');
    expect(tool.points).toHaveLength(0);
  });

  it('presses the same mode twice to disarm', () => {
    const tool = ext.createMeasure();
    tool.setMode('area');
    expect(tool.setMode('area')).toBe(null);
    expect(tool.armed).toBe(false);
  });

  it('lets go of the click when the view stops carrying it', () => {
    const tool = ext.createMeasure();
    tool.setMode('distance');
    tool.click({ lat: 48.85, lon: 2.29 });
    tool.click({ lat: 48.86, lon: 2.29 });
    tool.disarm();
    expect(tool.armed).toBe(false);
    expect(tool.points).toHaveLength(2);
  });

  it('reads a distance in the units it was asked for', () => {
    const tool = ext.createMeasure();
    tool.setMode('distance');
    tool.click({ lat: 48.85, lon: 2.29 });
    tool.click({ lat: 48.86, lon: 2.29 });
    expect(tool.readout('metric')).toMatch(/^1\.1\d km$/);
    expect(tool.readout('imperial')).toMatch(/^\d+ ft$/);
    tool.click({ lat: 48.95, lon: 2.29 });
    expect(tool.readout('imperial')).toMatch(/^\d+\.\d+ mi$/);
  });

  it('undoes one point rather than the path', () => {
    const tool = ext.createMeasure();
    tool.setMode('distance');
    tool.click({ lat: 48.85, lon: 2.29 });
    tool.click({ lat: 48.86, lon: 2.3 });
    tool.undo();
    expect(tool.points).toHaveLength(1);
  });

  it('needs three points before it claims an area', () => {
    const tool = ext.createMeasure();
    tool.setMode('area');
    tool.click({ lat: 48.85, lon: 2.29 });
    tool.click({ lat: 48.86, lon: 2.29 });
    expect(tool.readout('metric')).toBe('…');
    tool.click({ lat: 48.86, lon: 2.3 });
    expect(tool.readout('metric')).toMatch(/(m²|ha|km²)$/);
  });

  it('paints the line the app paints', () => {
    const tool = ext.createMeasure();
    tool.setMode('distance');
    tool.click({ lat: 48.85, lon: 2.29 });
    tool.click({ lat: 48.86, lon: 2.29 });
    const line = tool.shapes().find((s) => s.kind === 'line');
    expect(line.stroke).toBe('#f5a623');
    expect(line.strokeWidth).toBe(2.5);
  });
});

describe('saved points', () => {
  const VIEW = { lat: 48.8, lon: 2.3 };
  const ROWS = [
    { id: 'a', key: 'a', kind: 'place', title: 'Gate', lat: 48.8584, lon: 2.2945 },
    { id: 'b', key: 'b', kind: 'capture', title: 'Roof', lat: 48.8584, lon: 2.2945 },
    { id: 'c', key: 'c', kind: 'place', title: 'Far', lat: 48.9, lon: 2.4 },
  ];

  const loaded = (zoom = 18) => {
    const tool = ext.createPins();
    tool.load(ROWS);
    tool.atZoom(zoom);
    return tool;
  };

  it('files the clicked pixel when the view can be inverted', () => {
    const tool = ext.createPins();
    tool.toggleDrop();
    tool.click({ lat: 48.9, lon: 2.4 }, VIEW);
    expect(tool.draft).toEqual({ lat: 48.9, lon: 2.4, anchoredOn: 'pixel' });
    expect(tool.readout()).toBe('Filing the point you clicked');
  });

  it('falls back to the point the URL names, and says so', () => {
    const tool = ext.createPins();
    tool.toggleDrop();
    tool.click(null, VIEW);
    expect(tool.draft).toEqual({ lat: 48.8, lon: 2.3, anchoredOn: 'view' });
    expect(tool.readout()).toBe('Filing the point this view is centred on');
  });

  it('ignores a click when it is not dropping', () => {
    const tool = ext.createPins();
    expect(tool.click({ lat: 1, lon: 2 }, VIEW)).toBe(false);
    expect(tool.draft).toBe(null);
  });

  it('draws nothing but marks — no names until one is pointed at', () => {
    // fifty saved points drew fifty names across the map, which is a screenshot
    // of nothing
    const tool = loaded();
    const shapes = tool.shapes();
    expect(shapes.every((s) => s.kind === 'mark')).toBe(true);
    expect(shapes.every((s) => s.label === '')).toBe(true);
  });

  it('names the mark under the pointer, and the one held open', () => {
    const tool = loaded();
    const stacked = tool.marks.find((m) => m.items.length > 1);
    tool.hover(stacked.key);
    expect(tool.shapes().find((s) => s.label)).toMatchObject({ label: '2 saved here', lit: true });
    tool.hover(null);
    tool.hold(stacked.key);
    expect(tool.shapes().find((s) => s.label)).toMatchObject({ label: '2 saved here' });
    // clicking it again puts it away
    tool.hold(stacked.key);
    expect(tool.shapes().some((s) => s.label)).toBe(false);
  });

  it('merges points at one spot into a counted mark', () => {
    const tool = loaded();
    expect(tool.marks).toHaveLength(2);
    const stacked = tool.shapes().find((s) => s.count === 2);
    expect(stacked).toBeTruthy();
    // a stack of two kinds is drawn with the shared place glyph
    expect(stacked.glyph).toBe('pin');
    expect(tool.readout()).toBe('3 here, in 2 marks');
  });

  it('regroups when the zoom coarsens the key, and not otherwise', () => {
    const tool = loaded(18);
    expect(tool.atZoom(17)).toBe(false); // same precision
    expect(tool.atZoom(3)).toBe(true);
    expect(tool.marks).toHaveLength(1); // whole degrees: a country is one mark
  });

  it('draws a lone place outlined and a capture filled, like the app', () => {
    const tool = ext.createPins();
    tool.load([ROWS[2], { id: 'd', key: 'd', kind: 'capture', title: 'Shot', lat: 40, lon: 3 }]);
    tool.atZoom(18);
    const [place, capture] = tool.shapes();
    expect(place.place).toBe(true);
    expect(place.glyph).toBe('pin');
    expect(capture.place).toBe(false);
    expect(capture.glyph).toBe('satellite');
  });

  it('finds the mark under a pointer, and nothing when there is none', () => {
    const tool = loaded();
    // far enough apart on screen that "nearest" is not a coin toss
    const project = (point) => ({ x: point.lat * 1000, y: point.lon * 1000 });
    const target = tool.marks[0];
    const at = project(target);
    expect(tool.markAt({ x: at.x + 4, y: at.y + 4 }, project)?.key).toBe(target.key);
    expect(tool.markAt({ x: at.x + 400, y: at.y }, project)).toBe(null);
  });

  it('drops the draft it was holding when it is disarmed', () => {
    const tool = ext.createPins();
    tool.toggleDrop();
    tool.click({ lat: 1, lon: 2 }, VIEW);
    tool.disarm();
    expect(tool.armed).toBe(false);
    expect(tool.draft).toBe(null);
  });

  it('works on a view without geometry', () => {
    expect(ext.createPins().needsGeometry).toBe(false);
  });
});

describe('sun and moon', () => {
  const DAY = {
    moment: { local: '2026-09-10T12:00:00+02:00' },
    moon: { waxing: true },
    curve: {
      minutes: [0, 360, 720, 1080],
      clock: ['00:00', '06:00', '12:00', '18:00'],
      sun_altitude: [-30, 5, 45, -2],
      sun_azimuth: [0, 90, 180, 270],
      moon_altitude: [20, -10, -30, 15],
      moon_azimuth: [10, 100, 190, 280],
      moon_illuminated: [0.5, 0.5, 0.5, 0.5],
    },
  };

  const planted = () => {
    const tool = ext.createSky();
    tool.togglePlacing();
    tool.click({ lat: 48.85, lon: 2.29 });
    tool.fit(1000);
    tool.accept(DAY);
    return tool;
  };

  it('opens on the moment the answer was computed for', () => {
    expect(ext.nowIndex(DAY)).toBe(2);
  });

  it('opens on the middle of the day when the moment is unreadable', () => {
    expect(ext.nowIndex({ ...DAY, moment: {} })).toBe(2);
  });

  it('stays inside the day when the slider is pushed past its end', () => {
    const tool = planted();
    tool.index = 99;
    expect(tool.index).toBe(3);
    tool.index = -5;
    expect(tool.index).toBe(0);
  });

  it('plants the point and stops waiting for a click', () => {
    const tool = ext.createSky();
    tool.togglePlacing();
    expect(tool.armed).toBe(true);
    tool.click({ lat: 48.85, lon: 2.29 });
    expect(tool.armed).toBe(false);
    expect(tool.anchor).toEqual({ lat: 48.85, lon: 2.29 });
  });

  it('draws the arc each body sweeps, not the whole circle', () => {
    const tool = planted();
    const lines = tool.shapes().filter((s) => s.kind === 'line');
    // one run of daylight for the sun and one for the moon, plus hour ticks and
    // the two current rays
    expect(lines.length).toBeGreaterThan(4);
    expect(lines.some((l) => l.stroke === '#bd8721')).toBe(true);
    expect(lines.some((l) => l.stroke === '#4a93cc')).toBe(true);
  });

  it('dashes the ray of a body under the horizon and puts nothing on it', () => {
    const tool = planted(); // noon: sun up at 45°, moon down at -30°
    const rays = tool.shapes().filter((s) => s.kind === 'line' && s.strokeWidth === 3.5);
    expect(rays).toHaveLength(2);
    expect(rays[0].dash).toBe(null);
    expect(rays[1].dash).toEqual([6, 6]);
    const bodies = tool.shapes().filter((s) => s.kind === 'body');
    expect(bodies).toHaveLength(1);
    expect(bodies[0].bodyKind).toBe('sun');
  });

  it('carries the moon’s phase to the drawing', () => {
    const tool = planted();
    tool.index = 3; // the moon is up
    const moon = tool.shapes().find((s) => s.kind === 'body' && s.bodyKind === 'moon');
    expect(moon.illuminated).toBe(0.5);
    expect(moon.waxing).toBe(true);
  });

  it('reads the clock of the sample it is showing', () => {
    const tool = ext.createSky();
    expect(tool.readout()).toBe('Plant a point to read its sky');
    tool.togglePlacing();
    tool.click({ lat: 48.85, lon: 2.29 });
    expect(tool.readout()).toBe('Reading…');
    tool.accept(DAY);
    expect(tool.readout()).toBe('12:00');
  });

  it('keeps the arc inside the window', () => {
    const tool = ext.createSky();
    tool.togglePlacing();
    tool.click({ lat: 0, lon: 0 });
    tool.fit(1000);
    tool.accept(DAY);
    const ray = tool.shapes().find((s) => s.strokeWidth === 3.5);
    const reach = ext.destination({ lat: 0, lon: 0 }, 180, 220);
    expect(ray.points[1].lat).toBeCloseTo(reach.lat, 6);
  });
});

describe('search grid', () => {
  const SMALL = { south: 48.85, west: 2.29, north: 48.86, east: 2.3 };

  const drawn = (bounds = SMALL, cell = 500) => {
    const tool = ext.createGridTool();
    tool.cellM = cell;
    tool.draw('rect');
    const answer = tool.finishBox(bounds);
    return { tool, answer };
  };

  it('closes a dragged box into a grid the app can open', () => {
    const { tool, answer } = drawn();
    expect(answer.error).toBeUndefined();
    expect(tool.grid.azimut_grid).toBe(1);
    expect(tool.grid.aoi.type).toBe('rect');
    expect(tool.drawing).toBe(null);
  });

  it('shows the ring only while the shape is being drawn', () => {
    const tool = ext.createGridTool();
    tool.draw('polygon');
    for (const [lat, lon] of SHAPE) tool.addVertex({ lat, lon });
    expect(tool.shapes().some((s) => s.kind === 'line' && s.dash)).toBe(true);
    tool.finishPolygon();
    expect(tool.shapes().some((s) => s.dash)).toBe(false);
  });

  it('closes a clicked shape into one too', () => {
    const tool = ext.createGridTool();
    tool.draw('polygon');
    for (const [lat, lon] of SHAPE) tool.addVertex({ lat, lon });
    expect(tool.readout()).toMatch(/4 corners/);
    const { grid } = tool.finishPolygon();
    expect(grid.aoi).toEqual({ type: 'polygon', vertices: SHAPE });
    // and the app reads that spec as its own
    expect(app.coverage(grid)).toEqual(ext.coverage(grid));
  });

  it('refuses a shape that encloses nothing', () => {
    const tool = ext.createGridTool();
    tool.draw('polygon');
    tool.addVertex({ lat: 48.85, lon: 2.29 });
    tool.addVertex({ lat: 48.86, lon: 2.3 });
    expect(tool.finishPolygon().error).toMatch(/three corners/);
  });

  it('undoes one corner rather than the shape', () => {
    const tool = ext.createGridTool();
    tool.draw('polygon');
    for (const [lat, lon] of SHAPE) tool.addVertex({ lat, lon });
    tool.undoVertex();
    expect(tool.vertices).toHaveLength(SHAPE.length - 1);
  });

  it('reads a box dragged in any direction', () => {
    const { tool } = drawn({ south: 48.86, west: 2.3, north: 48.85, east: 2.29 });
    expect(tool.grid.aoi.bounds).toEqual(SMALL);
  });

  it('refuses an area nobody would sweep, with the count', () => {
    const { tool, answer } = drawn({ south: 0, west: 0, north: 10, east: 10 }, 100);
    expect(answer.error).toMatch(/past the 20,000 limit/);
    expect(tool.grid).toBe(null);
  });

  it('covers a box smaller than one cell with one cell', () => {
    const { tool, answer } = drawn({ south: 48.85, west: 2.29, north: 48.8501, east: 2.2901 }, 500);
    expect(answer.error).toBeUndefined();
    expect(ext.estimateCells(tool.grid)).toBe(1);
  });

  it('marks the cell a coordinate falls in, and only inside the area', () => {
    const { tool } = drawn();
    expect(tool.click({ lat: 48.855, lon: 2.295 })).toBe(true);
    expect(Object.values(tool.grid.statuses)).toEqual(['cleared']);
    expect(tool.click({ lat: 10, lon: 10 })).toBe(false);
  });

  it('will not mark a cell the drawn shape does not reach', () => {
    const tool = ext.createGridTool();
    tool.draw('polygon');
    for (const [lat, lon] of SHAPE) tool.addVertex({ lat, lon });
    tool.finishPolygon();
    // the bounding box holds this corner; the shape does not
    expect(tool.cellAt({ lat: 48.8505, lon: 2.3395 })).toBe(null);
  });

  it('hands over the marks it made, once', () => {
    const { tool } = drawn();
    tool.click({ lat: 48.855, lon: 2.295 });
    expect(Object.values(tool.takeMarks())).toEqual(['cleared']);
    expect(tool.takeMarks()).toEqual({});
    expect(tool.dirty).toBe(false);
  });

  it('records an unmark as a null rather than as an absence', () => {
    const { tool } = drawn();
    const at = { lat: 48.855, lon: 2.295 };
    tool.click(at);
    tool.takeMarks();
    tool.click(at);
    tool.click(at);
    expect(Object.values(tool.takeMarks())).toEqual([null]);
  });

  it('puts unsent marks back without stepping on newer ones', () => {
    const { tool } = drawn();
    tool.click({ lat: 48.855, lon: 2.295 });
    const failed = tool.takeMarks();
    const key = Object.keys(failed)[0];
    tool.click({ lat: 48.855, lon: 2.295 });
    tool.restoreMarks(failed);
    expect(tool.takeMarks()[key]).toBe('flagged');
  });

  it('is armed while drawing or marking, and never both at once', () => {
    const tool = ext.createGridTool();
    tool.draw('rect');
    expect(tool.armed).toBe(true);
    tool.toggleMark();
    expect(tool.drawing).toBe(null);
    expect(tool.marking).toBe(true);
    tool.toggleMark();
    expect(tool.armed).toBe(false);
  });

  it('puts a shape down when its own button is pressed again', () => {
    const tool = ext.createGridTool();
    expect(tool.draw('polygon')).toBe('polygon');
    expect(tool.draw('polygon')).toBe(null);
    expect(tool.armed).toBe(false);
  });

  it('paints its cells the way Grid Search paints them', () => {
    const { tool } = drawn();
    tool.click({ lat: 48.855, lon: 2.295 });
    const cells = tool.shapes().filter((s) => s.kind === 'cell');
    expect(cells).toHaveLength(ext.estimateCells(tool.grid));
    expect(cells.some((c) => c.fill === '#2b3040' && c.fillOpacity === 0.62)).toBe(true);
    expect(cells.some((c) => c.stroke === '#ffffff' && c.fillOpacity === 0)).toBe(true);
    // nothing else: the lattice is the area, and a dashed ring around it is a
    // second line saying so over imagery that has to stay readable
    expect(tool.shapes().every((s) => s.kind === 'cell')).toBe(true);
  });

  it('draws nothing while hidden', () => {
    const { tool } = drawn();
    tool.toggleHidden();
    expect(tool.shapes()).toEqual([]);
  });

  it('reports coverage as the panel states it', () => {
    const { tool } = drawn();
    tool.click({ lat: 48.855, lon: 2.295 });
    expect(tool.readout()).toMatch(/^\d+% swept · 1 cleared · 0 flagged$/);
  });

  it('takes the case’s copy back, keeping what it has not sent', () => {
    // the same sweep is worked from the app at the same time: its marks are the
    // truth, and the ones made here that never left are the only copy of
    // themselves
    const { tool } = drawn();
    tool.open({ ...ext.createGrid({ type: 'rect', bounds: SMALL }, 500), statuses: {} }, 'Sweep');
    tool.click({ lat: 48.855, lon: 2.295 }); // marked here, not sent yet
    const mine = Object.keys(tool.takeMarks())[0];
    tool.restoreMarks({ [mine]: 'cleared' });

    tool.sync({
      ...ext.createGrid({ type: 'rect', bounds: SMALL }, 500),
      statuses: { '3:7': 'flagged' },
    });
    expect(tool.grid.statuses['3:7']).toBe('flagged'); // the app's mark arrived
    expect(tool.grid.statuses[mine]).toBe('cleared'); // and ours survived it
  });

  it('drops a cell the case says is unchecked once ours has been sent', () => {
    const { tool } = drawn();
    tool.open({ ...ext.createGrid({ type: 'rect', bounds: SMALL }, 500), statuses: { '0:0': 'cleared' } }, 'Sweep');
    tool.sync({ ...ext.createGrid({ type: 'rect', bounds: SMALL }, 500), statuses: {} });
    expect(tool.grid.statuses).toEqual({});
  });

  it('has nothing to sync when no grid is open', () => {
    const tool = ext.createGridTool();
    expect(tool.sync({ statuses: { '0:0': 'cleared' } })).toBe(false);
  });

  it('opening a saved grid starts with nothing unsent', () => {
    const { tool } = drawn();
    tool.click({ lat: 48.855, lon: 2.295 });
    tool.open(app.createGrid(AOI, 500), 'North sweep');
    expect(tool.dirty).toBe(false);
    expect(tool.name).toBe('North sweep');
  });
});

describe('the reference windows', () => {
  const SCREEN = { w: 1200, h: 800 };
  const PICTURE = { path: 'media/roof.jpg', filename: 'roof.jpg', title: 'The roof', kind: 'image' };
  const CLIP = { path: 'media/walk.mp4', filename: 'walk.mp4', kind: 'video' };

  it('places and resizes a window exactly as the app does', () => {
    const cases = [
      [10, 10, 320, 260],
      [-40, -40, 320, 260], // dragged off the top-left corner
      [1150, 780, 320, 260], // and off the bottom-right one
    ];
    for (const [x, y, w, h] of cases) {
      expect(ext.clampWindow(x, y, w, h, SCREEN)).toEqual(appRefs.clampWindow(x, y, w, h, SCREEN));
    }
    for (const [w, h] of [[400, 300], [40, 40], [4000, 4000]]) {
      expect(ext.clampSize(w, h, 900, 600, SCREEN)).toEqual(appRefs.clampSize(w, h, 900, 600, SCREEN));
    }
  });

  it('zooms and pans the picture exactly as the app does', () => {
    const pane = { w: 320, h: 260 };
    let ours = ext.createViewer('ref-1', PICTURE);
    let theirs = appRefs.createViewer('ref-1', PICTURE);
    // in on the cursor, in again, then all the way back out past the fit
    for (const [factor, cursor] of [
      [1.15, { x: 40, y: 30 }],
      [2, { x: 300, y: 240 }],
      [1 / 64, { x: 10, y: 10 }],
    ]) {
      ours = { ...ours, ...ext.zoomAt(ours, factor, cursor, pane) };
      theirs = { ...theirs, ...appRefs.zoomAt(theirs, factor, cursor, pane) };
      expect(ours.scale).toBe(theirs.scale);
      expect([ours.ox, ours.oy]).toEqual([theirs.ox, theirs.oy]);
    }
    // and the pan that follows one cannot open a gap at an edge
    for (const [ox, oy] of [[200, 200], [-9000, -9000]]) {
      expect(ext.clampPan(ox, oy, 4, pane.w, pane.h)).toEqual(appRefs.clampPan(ox, oy, 4, pane.w, pane.h));
    }
  });

  it('opens a window on the same state the app would', () => {
    const spawn = { x: 86, y: 86, z: 3 };
    for (const item of [PICTURE, CLIP]) {
      expect(ext.createViewer('ref-2', item, spawn)).toEqual(appRefs.createViewer('ref-2', item, spawn));
    }
    // the kind decides how the window shows it: a picture is decoded and
    // painted, a clip is handed to a <video> (mapref.js)
    expect(ext.createViewer('ref-3', CLIP).kind).toBe('video');
  });

  it('keeps the stack small and gap-free, so nothing climbs over the panel', () => {
    const refs = ext.createRefs();
    for (let i = 0; i < 4; i += 1) refs.add(PICTURE);
    expect(refs.open.map((v) => v.z)).toEqual([1, 2, 3, 4]);
    refs.focus(refs.open[0].id);
    expect(refs.open.map((v) => v.z)).toEqual([4, 1, 2, 3]);
    expect(ext.nextZ(refs.open)).toBe(appRefs.nextZ(refs.open));
    expect([...ext.restack(refs.open, 'ref-2')]).toEqual([...appRefs.restack(refs.open, 'ref-2')]);
  });

  it('staggers new windows and wraps before they walk off the screen', () => {
    const refs = ext.createRefs();
    for (let i = 0; i < 7; i += 1) refs.add(PICTURE);
    expect(refs.open.map((v) => v.x)).toEqual([60, 86, 112, 138, 164, 190, 60]);
    // two windows on one picture are two windows, not one reopened
    expect(new Set(refs.open.map((v) => v.id)).size).toBe(7);
  });

  it('is a tool that never takes the map', () => {
    const refs = ext.createRefs();
    refs.add(PICTURE);
    // nothing is projected, nothing is armed, and no view is refused: a
    // photograph is worth holding over Street View and a globe too
    expect(refs.needsGeometry).toBe(false);
    expect(refs.armed).toBe(false);
    expect(refs.shapes()).toEqual([]);
    refs.disarm();
    expect(refs.open).toHaveLength(1);
  });

  it('folds one window away without touching the others', () => {
    const refs = ext.createRefs();
    const first = refs.add(PICTURE);
    refs.add(CLIP);
    refs.fold(first.id);
    expect(refs.open.map((v) => v.collapsed)).toEqual([true, false]);
    refs.fold(first.id);
    expect(refs.open.map((v) => v.collapsed)).toEqual([false, false]);
    expect(refs.fold('ref-nope')).toBe(undefined); // a window that has gone
  });

  it('says what is held over the map', () => {
    const refs = ext.createRefs();
    expect(refs.readout()).toBe('Nothing held over the map');
    refs.add(PICTURE);
    expect(refs.readout()).toBe('1 reference open');
    refs.add(PICTURE);
    expect(refs.readout()).toBe('2 references open');
  });

  it('closes one window, and every window when the case changes', () => {
    const refs = ext.createRefs();
    const first = refs.add(PICTURE);
    refs.add(PICTURE);
    refs.close(first.id);
    expect(refs.open.map((v) => v.id)).toEqual(['ref-2']);
    refs.clear();
    expect(refs.open).toEqual([]);
  });
});
