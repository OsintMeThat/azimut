import { describe, expect, it } from 'vitest';
import { rayFor } from './camera.js';
import {
  areaLens,
  areaWithin,
  blinkColours,
  composePair,
  composeView,
  EXPORT_KINDS,
  EXPORT_MAX_PX,
  exportScale,
  layersIn,
  photoTag,
  standingText,
  turnCamera,
  viewFilename,
} from './viewExport.js';

function fakeCanvas() {
  const calls = [];
  const record = (name) => (...args) => calls.push([name, ...args]);
  const context = {
    calls,
    fillStyle: '',
    strokeStyle: '',
    font: '',
    lineWidth: 1,
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillRect: record('fillRect'),
    drawImage: record('drawImage'),
    fillText: record('fillText'),
    strokeText: record('strokeText'),
    measureText: (text) => ({ width: String(text).length * 6 }),
    save: record('save'),
    restore: record('restore'),
    beginPath: record('beginPath'),
    roundRect: record('roundRect'),
    rect: record('rect'),
    arc: record('arc'),
    fill: record('fill'),
    stroke: record('stroke'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    translate: record('translate'),
    scale: record('scale'),
  };
  return { width: 0, height: 0, context, getContext: () => context };
}

const picture = (name, width = 1600, height = 1000) => ({ name, width, height });
const LAYERS = {
  labels: [{ name: 'Eiger', x: 300, y: 260, left: 280, width: 40, baseline: 230 }],
  ticks: [{ x: 100, label: '90°', named: false }, { x: 400, label: 'E', named: true }],
  trace: [[{ x: 10, y: 300 }, { x: 600, y: 280 }]],
  target: { x: 500, y: 320, visible: true },
};
const texts = (canvas) => canvas.context.calls.filter(([name]) => name === 'fillText').map(([, text]) => text);
/** The strokes that reach the trace's last point, under the header, at a scale. */
const traced = (canvas, s) =>
  canvas.context.calls.filter(([name, x, y]) => name === 'lineTo' && x === 600 * s && y === 48 * s + 280 * s);

describe('the size of an export', () => {
  it('doubles the screen, short of what a GPU draws', () => {
    expect(exportScale(800)).toBe(2);
    expect(exportScale(4000)).toBeCloseTo(EXPORT_MAX_PX / 4000);
    expect(exportScale(0)).toBe(1);
  });

  it('draws the whole turn north to north, over the highest ridge and down to the ground in front', () => {
    const panorama = {
      azimuth: { start: 0, step: 1, count: 360, full: true },
      skyline: Array.from({ length: 360 }, (_, i) => (i === 90 ? 6 : 1)),
    };
    const camera = turnCamera(panorama, { width: 2400 });
    expect(camera).toMatchObject({ projection: 'panorama', heading: 180, fov: 360, width: 2400 });
    // from 10° (6 + 4) down to -8°: 18° tall, one scale across and down
    expect(camera.tilt).toBeCloseTo(1);
    expect(camera.height).toBe(Math.round((2400 * 18) / 360));
    expect(turnCamera(panorama, { mode: 'drone' }).tilt).toBeLessThan(camera.tilt);
  });
});

describe('what an export says', () => {
  const observer = { lat: 46.5586, lon: 7.8353, mode: 'ground', height: 1.7 };
  const camera = { heading: 106.6, tilt: 0, fov: 60.6, projection: 'camera' };

  it('says where the eye stood, the way it faced, its lens and its hour', () => {
    expect(standingText({ observer, camera, sky: { on: true, date: '2024-07-14', time: '17:30' } })).toBe(
      '46.55860, 7.83530  ·  on foot, 1.7 m  ·  facing 107° E  ·  lens 60.6°  ·  14 Jul 2024 17:30'
    );
    expect(standingText({ observer: { ...observer, mode: 'aircraft', height: 3000 }, camera, kind: 'turn' })).toBe(
      '46.55860, 7.83530  ·  aircraft, 3000 m above the sea'
    );
  });

  it('is named after the view and what kind of picture it is', () => {
    expect(viewFilename('North ridge', 'view')).toBe('North ridge');
    expect(viewFilename('North ridge', 'turn')).toBe('North ridge 360');
    expect(viewFilename('North: ridge?', 'row')).toBe('North ridge photo beside terrain');
    expect(viewFilename('North ridge', 'column')).toBe('North ridge photo above terrain');
    expect(viewFilename('', 'view')).toBe('horizon');
    expect(viewFilename('North ridge', 'capture')).toBe('North ridge capture');
  });

  it('offers the side-by-side kinds and the blink only with a photo', () => {
    expect(EXPORT_KINDS.filter((k) => k.photo).map((k) => k.id)).toEqual(['row', 'column', 'blink']);
  });

  it('keeps its inks exactly in a GIF', () => {
    expect(blinkColours()).toMatch(/^(#[0-9a-f]{6})(,#[0-9a-f]{6})*$/);
    expect(blinkColours().split(',')).toContain('#ffd740');
  });
});

describe('an area of the view', () => {
  const SCREEN = { width: 1000, height: 600 };
  const LENS = { heading: 120, tilt: 1, roll: 0, fov: 40, projection: 'camera', ...SCREEN };

  it('is a box of whole pixels inside the screen, dragged either way, or nothing too small', () => {
    expect(areaWithin({ x: 900, y: 500, width: -300.4, height: -200.2 }, SCREEN)).toEqual({ x: 600, y: 300, width: 300, height: 200 });
    expect(areaWithin({ x: -50, y: 100, width: 200, height: 900 }, SCREEN)).toEqual({ x: 0, y: 100, width: 150, height: 500 });
    expect(areaWithin({ x: 10, y: 10, width: 5, height: 300 }, SCREEN)).toBeNull();
    expect(areaWithin(null, SCREEN)).toBeNull();
  });

  it('faces the ground under its middle, as wide as its edges are apart', () => {
    const whole = areaLens(LENS, { x: 0, y: 0, ...SCREEN });
    expect(whole.heading).toBeCloseTo(120, 6);
    // read along the middle row, tilted a degree: as wide as the lens to a hundredth
    expect(whole.fov).toBeCloseTo(40, 1);
    const right = areaLens(LENS, { x: 750, y: 200, width: 250, height: 200 });
    expect(right.heading).toBeCloseTo(rayFor(LENS, 875, 300).azimuth, 6);
    expect(right.fov).toBeLessThan(11);
    expect(right.fov).toBeGreaterThan(9);
  });

  it('keeps what the view wrote inside it, moved to its corner', () => {
    const layers = {
      labels: [
        { name: 'Inside', x: 420, y: 260, left: 390, width: 60, baseline: 240 },
        { name: 'Outside', x: 900, y: 260, left: 870, width: 60, baseline: 240 },
      ],
      ticks: [{ x: 410, label: '90°' }],
      trace: [[{ x: 410, y: 210 }]],
      target: { x: 950, y: 50, visible: true },
    };
    const kept = layersIn(layers, { x: 400, y: 200, width: 200, height: 100 });
    expect(kept.labels).toEqual([{ name: 'Inside', x: 20, y: 60, left: -10, width: 60, baseline: 40 }]);
    expect(kept.ticks).toEqual([{ x: 10, label: '90°' }]);
    expect(kept.trace).toEqual([[{ x: 10, y: 10 }]]);
    expect(kept.target).toBeNull();
  });
});

describe('composing', () => {
  it('lays the view between its header and its ruler, with the names, the trace and the credits', () => {
    const canvas = composeView({
      picture: picture('view'),
      layers: LAYERS,
      scale: 2,
      title: 'North ridge',
      standing: '46.55860, 7.83530',
      credits: '© Mapterhorn',
      signed: false,
      makeCanvas: fakeCanvas,
    });
    expect(canvas.width).toBe(1600);
    // header 48, ruler 24 and footer 26, twice
    expect(canvas.height).toBe(1000 + (48 + 24 + 26) * 2);
    const drawn = canvas.context.calls.find(([name]) => name === 'drawImage');
    expect(drawn.slice(1)).toEqual([picture('view'), 0, 96]);
    expect(texts(canvas)).toEqual(expect.arrayContaining(['North ridge', '46.55860, 7.83530', 'Eiger', '90°', 'E', '© Mapterhorn']));
    // the trace is working material: left out unless asked
    expect(traced(canvas, 2)).toHaveLength(0);
  });

  it('draws the skyline traced on the photo when asked, its dark edge then its yellow', () => {
    const canvas = composeView({ picture: picture('view'), layers: LAYERS, scale: 1, trace: true, signed: false, makeCanvas: fakeCanvas });
    expect(traced(canvas, 1)).toHaveLength(2);
  });

  it('sets the photo beside the terrain, or above it, each tagged and with its ruler', () => {
    const photo = picture('photo', 800, 600);
    const terrain = picture('terrain', 800, 600);
    const row = composePair({ photo, terrain, layers: LAYERS, scale: 1, layout: 'row', signed: false, makeCanvas: fakeCanvas });
    expect(row.width).toBe(800 * 2 + 6);
    expect(row.height).toBe(48 + 600 + 24 + 26);
    const images = row.context.calls.filter(([name]) => name === 'drawImage').map(([, image, x, y]) => [image.name, x, y]);
    expect(images).toEqual([['photo', 0, 48], ['terrain', 806, 48]]);
    expect(texts(row)).toEqual(expect.arrayContaining(['Photo', 'Terrain, simulated']));

    const column = composePair({ photo, terrain, layers: LAYERS, scale: 1, layout: 'column', signed: false, makeCanvas: fakeCanvas });
    expect(column.width).toBe(800);
    expect(column.height).toBe(48 + (600 + 24) * 2 + 6 + 26);
    const stacked = column.context.calls.filter(([name]) => name === 'drawImage').map(([, image, x, y]) => [image.name, x, y]);
    expect(stacked).toEqual([['photo', 0, 48], ['terrain', 0, 48 + 624 + 6]]);

    // a photo pulled by hand says so on its panel
    const pulled = composePair({ photo, terrain, layers: LAYERS, scale: 1, reshaped: true, signed: false, makeCanvas: fakeCanvas });
    expect(texts(pulled)).toEqual(expect.arrayContaining(['Photo, reshaped', 'Terrain, simulated']));
    expect(photoTag(false)).toBe('Photo');
  });

  it('refuses a view not drawn yet', () => {
    expect(() => composeView({ picture: null, scale: 1, makeCanvas: fakeCanvas })).toThrow(/drawn/);
    expect(() => composePair({ photo: picture('p'), terrain: null, scale: 1, makeCanvas: fakeCanvas })).toThrow(/drawn/);
  });
});
