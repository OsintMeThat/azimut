import { describe, expect, it } from 'vitest';
import { rayFor, toScreen } from './camera.js';
import {
  bendShape,
  bent,
  BEND_MAX,
  clampLoupe,
  edgeMiddles,
  edgeMoved,
  grownPhoto,
  photoGrid,
  LOUPE_MIN,
  LOUPE_REACH,
  loupeMoved,
  slidPhoto,
  clampCorner,
  FLAT_CORNERS,
  insideCorners,
  invertMatrix,
  isFlat,
  throughMatrix,
  unwarped,
  WARP_REACH,
  warped,
  warpMatrix,
  warpUniform,
  cameraAt,
  erasedFrom,
  eraseStrokes,
  markedPlane,
  fitFrame,
  fitToTrace,
  gapText,
  heightStep,
  heightText,
  isZoned,
  localClock,
  LOUPE_MAX,
  NO_LOUPE,
  panLoupe,
  photoAt,
  pinAt,
  screenAt,
  skylineBetween,
  straightened,
  strokeFrom,
  traceGap,
  traceSamples,
  traceFit,
  fitRuns,
  ON_PX,
  OFF_PX,
  MARGIN_CELLS,
  terrainMargin,
  reliefWords,
  zoomLoupe,
  isAtPlace,
  matchRequest,
  searchedPlaces,
  searchOutcome,
  tracePlane,
  pieceCameras,
  terrainLine,
  traceOnTerrain,
  bendText,
} from './overlay.js';

const SIZE = { width: 1000, height: 750 };
// a wavy ridge round the whole turn, as a panorama's skyline holds it at 0.1°
const ridge = (azimuth) => 2 + 3 * Math.sin((azimuth * Math.PI) / 30) + 1.2 * Math.sin((azimuth * Math.PI) / 7);
const PANORAMA = {
  azimuth: { start: 0, step: 0.1, count: 3600, full: true },
  skyline: Array.from({ length: 3600 }, (_, i) => ridge(i * 0.1)),
};
const skyline = (azimuth) => skylineBetween(PANORAMA, azimuth);
const TRUE = { heading: 95, tilt: 1, roll: 1.5, fov: 60, projection: 'camera', ...SIZE };

/** The skyline as an analyst would trace it on a photo taken through `camera`. */
function traced(camera, { from = 0.1, to = 0.9 } = {}) {
  const stroke = [];
  for (let azimuth = camera.heading - camera.fov; azimuth <= camera.heading + camera.fov; azimuth += 0.2) {
    const at = toScreen(camera, azimuth, ridge(azimuth));
    if (!at.visible || at.x < from * SIZE.width || at.x > to * SIZE.width) continue;
    stroke.push({ u: at.x / SIZE.width, v: at.y / SIZE.height });
  }
  return [stroke];
}

describe('the frame takes the photo’s shape', () => {
  it('fits a landscape photo into a wide room with bars at the sides', () => {
    expect(fitFrame(4 / 3, { width: 1200, height: 600 })).toEqual({ width: 800, height: 600, left: 200, top: 0 });
  });
  it('fits it into a tall room with bars above and below', () => {
    expect(fitFrame(16 / 9, { width: 960, height: 900 })).toEqual({ width: 960, height: 540, left: 0, top: 180 });
  });
  it('gives nothing while there is no room', () => {
    expect(fitFrame(1.5, { width: 0, height: 400 }).width).toBe(0);
  });
});

describe('the loupe over a photo', () => {
  it('keeps the point of the photo under the pointer while it magnifies', () => {
    const at = { x: 800, y: 200 };
    const before = photoAt(NO_LOUPE, at.x, at.y, SIZE);
    const loupe = zoomLoupe(NO_LOUPE, 3, at, SIZE);
    expect(loupe.zoom).toBe(3);
    const after = photoAt(loupe, at.x, at.y, SIZE);
    expect(after.u).toBeCloseTo(before.u, 9);
    expect(after.v).toBeCloseTo(before.v, 9);
  });

  it('goes from the screen to the photo and back', () => {
    const loupe = { zoom: 4, x: 0.3, y: 0.7 };
    const point = photoAt(loupe, 123, 456, SIZE);
    const back = screenAt(loupe, point.u, point.v, SIZE);
    expect(back.x).toBeCloseTo(123, 9);
    expect(back.y).toBeCloseTo(456, 9);
    expect(screenAt(loupe, 0.3, 0.7, SIZE)).toEqual({ x: 500, y: 375 });
  });

  it('stays within reach of the photo, out and in', () => {
    const near = zoomLoupe(NO_LOUPE, 2, { x: 0, y: 0 }, SIZE);
    expect(near).toEqual({ zoom: 2, x: 0.25, y: 0.25 });
    expect(zoomLoupe(near, 0.01, { x: 500, y: 375 }, SIZE).zoom).toBe(LOUPE_MIN);
    expect(zoomLoupe(NO_LOUPE, 1000, { x: 500, y: 375 }, SIZE).zoom).toBe(LOUPE_MAX);
    // dragged far right, it stops a few photo widths off
    expect(panLoupe(near, 50000, 0, SIZE).x).toBeCloseTo(0.5 - LOUPE_REACH, 9);
  });

  it('lets the photo follow the hand', () => {
    const loupe = { zoom: 2, x: 0.5, y: 0.5 };
    const moved = panLoupe(loupe, 100, -75, SIZE);
    // the photo goes right and up with the hand: the middle looks further left and lower
    expect(moved.x).toBeCloseTo(0.45, 9);
    expect(moved.y).toBeCloseTo(0.55, 9);
  });

  it('keeps a stroke drawn through it on the photo point under the pen', () => {
    const loupe = { zoom: 4, x: 0.25, y: 0.25 };
    const [first] = strokeFrom([{ x: 500, y: 375 }, { x: 600, y: 375 }], SIZE, { loupe });
    expect(first).toEqual({ u: 0.25, v: 0.25 });
  });
});

describe('a lens’s curve', () => {
  it('is said as a number with its kind', () => {
    expect(bendText(0)).toBe('None');
    expect(bendText(-0.12)).toBe('Barrel 0.12');
    expect(bendText(0.05)).toBe('Pincushion 0.05');
  });

  const shape = bendShape(4 / 3);

  it('measures from the middle in half-diagonals: a corner is 1 away', () => {
    expect(bent({ u: 1, v: 1 }, -0.1, shape).u).toBeCloseTo(0.5 + 0.5 * 0.9, 9);
    expect(bent({ u: 0.5, v: 0.5 }, -0.3, shape)).toEqual({ u: 0.5, v: 0.5 });
    expect(bent({ u: 0.2, v: 0.7 }, 0, shape)).toEqual({ u: 0.2, v: 0.7 });
  });

  it('bows the edges in for a barrel, out for a pincushion', () => {
    const edge = { u: 1, v: 0.5 };
    expect(bent(edge, -0.2, shape).u).toBeLessThan(1);
    expect(bent(edge, 0.2, shape).u).toBeGreaterThan(1);
  });

  it('is undone exactly, out to the corners at the strongest it is set', () => {
    for (const k of [-BEND_MAX, -0.12, 0.07, BEND_MAX]) {
      for (const point of [{ u: 0, v: 0 }, { u: 1, v: 1 }, { u: 0.9, v: 0.3 }, { u: 0.51, v: 0.5 }]) {
        const back = straightened(bent(point, k, shape), k, shape);
        expect(back.u).toBeCloseTo(point.u, 9);
        expect(back.v).toBeCloseTo(point.v, 9);
      }
    }
  });
});

describe('a trace', () => {
  it('is kept in the photo’s own coordinates, close points dropped', () => {
    const stroke = strokeFrom(
      [
        { x: 0, y: 0 },
        { x: 0.5, y: 0 },
        { x: 100, y: 75 },
        { x: 2000, y: 75 },
      ],
      SIZE
    );
    expect(stroke).toEqual([
      { u: 0, v: 0 },
      { u: 0.1, v: 0.1 },
      { u: 1, v: 0.1 },
    ]);
  });

  it('is read at points evenly spaced on screen, however it was drawn', () => {
    const samples = traceSamples([[{ u: 0, v: 0.5 }, { u: 0.1, v: 0.5 }, { u: 0.4, v: 0.5 }]], SIZE, { spacing: 10 });
    const xs = samples.map((s) => Math.round(s.x));
    expect(xs.slice(0, 4)).toEqual([0, 10, 20, 30]);
    expect(xs.at(-1)).toBe(400);
    expect(samples.every((s) => s.y === 375)).toBe(true);
  });

  it('meets the terrain’s skyline with no gap through the camera that took it', () => {
    const gap = traceGap(traceSamples(traced(TRUE), SIZE), TRUE, skyline);
    expect(gap.median).toBeLessThan(0.02);
    // most of the lens's width was traced
    expect(gap.span).toBeGreaterThan(40);
    expect(gap.span).toBeLessThan(55);
  });

  it('stands above the terrain when the view looks higher than the photo did', () => {
    const gap = traceGap(traceSamples(traced(TRUE), SIZE), { ...TRUE, tilt: TRUE.tilt + 1 }, skyline);
    expect(gap.offset).toBeCloseTo(1, 1);
    expect(gap.median).toBeCloseTo(1, 1);
  });

  it('says nothing while it meets too little ground', () => {
    expect(traceGap([], TRUE, skyline)).toBeNull();
    expect(traceGap(traceSamples(traced(TRUE), SIZE), TRUE, () => null)).toBeNull();
  });

  it('reads as a gap over a span', () => {
    expect(gapText({ median: 0.4123, span: 52.25 })).toBe('Gap 0.41° median over 52° of skyline');
    expect(gapText({ median: 3.27, span: 6.5 })).toBe('Gap 3.3° median over 6.5° of skyline');
    expect(gapText(null)).toBe('');
  });
});

describe('how each traced point lies on the terrain', () => {
  it('lies on it through the camera that took the photo', () => {
    const [kinds] = traceFit(traced(TRUE), TRUE, skyline);
    expect(kinds.length).toBeGreaterThan(100);
    expect(kinds.every((kind) => kind === 'on')).toBe(true);
  });

  it('stands off it where the view looks elsewhere, and off the ground where none stands', () => {
    const [higher] = traceFit(traced(TRUE), { ...TRUE, tilt: TRUE.tilt + 2 }, skyline);
    expect(higher.every((kind) => kind === 'off')).toBe(true);
    const [none] = traceFit(traced(TRUE), TRUE, () => null);
    expect(none.every((kind) => kind === 'off')).toBe(true);
  });

  it('is near it between the two thresholds the search counts with', () => {
    // a third of a degree is about 9 px through a 60° lens 1000 px wide
    const [kinds] = traceFit(traced(TRUE), { ...TRUE, tilt: TRUE.tilt + 1 / 3 }, skyline);
    expect(ON_PX).toBeLessThan(OFF_PX);
    expect(kinds.filter((kind) => kind === 'near').length).toBeGreaterThan(kinds.length / 2);
  });

  it('cuts a stroke into runs that join where the kind changes', () => {
    const stroke = [1, 2, 3, 4, 5].map((u) => ({ u, v: 0 }));
    const runs = fitRuns(stroke, ['on', 'on', 'off', 'off', 'on']);
    expect(runs.map((run) => run.kind)).toEqual(['on', 'off', 'on']);
    expect(runs.map((run) => run.points.map((p) => p.u))).toEqual([[1, 2], [2, 3, 4], [4, 5]]);
    expect(fitRuns([], [])).toEqual([]);
  });
});

describe('rubbing a trace out', () => {
  const SCALE = { width: 1000, height: 1000 };
  const line = [{ u: 0.1, v: 0.5 }, { u: 0.9, v: 0.5 }];

  it('cuts a stroke in two where the rubber crossed it, even between its points', () => {
    const [left, right] = eraseStrokes([line], [{ u: 0.5, v: 0.4 }, { u: 0.5, v: 0.6 }], 10, SCALE);
    expect(left[0]).toEqual({ u: 0.1, v: 0.5 });
    expect(right.at(-1)).toEqual({ u: 0.9, v: 0.5 });
    // the cut is the rubber's width, about 20 px either side of the middle at most
    expect(left.at(-1).u).toBeGreaterThan(0.48);
    expect(left.at(-1).u).toBeLessThanOrEqual(0.49);
    expect(right[0].u).toBeGreaterThanOrEqual(0.51);
    expect(right[0].u).toBeLessThan(0.52);
  });

  it('measures the rubber on screen, so a loupe rubs finer', () => {
    // at 10× the photo is 10 000 px wide: 10 px is a thousandth of it
    const [left] = eraseStrokes([line], [{ u: 0.5, v: 0.5 }], 10, { width: 10000, height: 10000 });
    expect(left.at(-1).u).toBeGreaterThan(0.498);
  });

  it('drops what is left too short to be a line, and a stroke rubbed out whole', () => {
    const short = [{ u: 0.5, v: 0.1 }, { u: 0.505, v: 0.1 }];
    expect(eraseStrokes([short, line], [{ u: 0.5, v: 0.1 }], 20, SCALE)).toEqual([line]);
  });

  it('leaves the strokes as they were when it touched none', () => {
    const strokes = [line];
    expect(eraseStrokes(strokes, [{ u: 0.5, v: 0.9 }], 10, SCALE)).toBe(strokes);
  });
});

describe('a fit to the trace', () => {
  const samples = traceSamples(traced(TRUE), SIZE);

  it('brings the view back onto the photo from a rough placing', () => {
    const rough = { ...TRUE, heading: 98, tilt: 0.2, roll: 0, fov: 64 };
    const fit = fitToTrace(samples, rough, skyline);
    expect(fit.improved).toBe(true);
    expect(fit.gap.median).toBeLessThan(0.05);
    expect(fit.camera.heading).toBeCloseTo(95, 0);
    expect(fit.camera.tilt).toBeCloseTo(1, 0);
    expect(fit.camera.fov).toBeCloseTo(60, 0);
    expect(fit.camera.roll).toBeCloseTo(1.5, 0);
  });

  it('keeps the lens the photo said', () => {
    const rough = { ...TRUE, heading: 97, tilt: 0.5 };
    const fit = fitToTrace(samples, rough, skyline, { lens: false });
    expect(fit.camera.fov).toBe(60);
    expect(fit.gap.median).toBeLessThan(0.1);
  });

  it('never leaves the view worse than it found it', () => {
    const fit = fitToTrace(samples, TRUE, skyline);
    expect(fit.gap.median).toBeLessThan(0.02);
  });

  it('cannot fit a trace that meets no ground', () => {
    expect(fitToTrace([], TRUE, skyline)).toBeNull();
  });

  it('fits a panorama along its strip, with no roll to give', () => {
    const strip = { heading: 95, tilt: 1, roll: 0, fov: 120, projection: 'panorama', ...SIZE };
    const along = traceSamples(traced(strip), SIZE);
    const fit = fitToTrace(along, { ...strip, heading: 99, tilt: 0.3, fov: 126 }, skyline);
    expect(fit.improved).toBe(true);
    expect(fit.camera.heading).toBeCloseTo(95, 0);
    expect(fit.camera.fov).toBeCloseTo(120, 0);
    expect(fit.camera.roll).toBe(0);
    expect(fit.gap.median).toBeLessThan(0.05);
  });

});

describe('the skyline between two columns', () => {
  it('reads between them, and round the north', () => {
    const turn = { azimuth: { start: 0, step: 1, count: 360, full: true }, skyline: Array.from({ length: 360 }, (_, i) => i) };
    expect(skylineBetween(turn, 10.5)).toBeCloseTo(10.5);
    expect(skylineBetween(turn, 359.5)).toBeCloseTo(359 + (0 - 359) * 0.5);
  });
  it('is null where no ground stands, or off a window', () => {
    const window = { azimuth: { start: 10, step: 1, count: 5, full: false }, skyline: [1, null, null, 2, 2] };
    expect(skylineBetween(window, 10.5)).toBe(1);
    expect(skylineBetween(window, 30)).toBeNull();
    expect(skylineBetween({ ...window, skyline: [null, null, null, null, null] }, 11)).toBeNull();
  });
  it('reads a cut of the turn when asked for its reach, and the whole turn otherwise', () => {
    const cut = new Float32Array(360).fill(1);
    cut[11] = NaN;
    const turn = {
      azimuth: { start: 0, step: 1, count: 360, full: true },
      skyline: Array.from({ length: 360 }, () => 5),
      cuts: [{ reach: 20_000, skyline: cut }],
    };
    expect(skylineBetween(turn, 10.5)).toBe(5);
    expect(skylineBetween(turn, 10.5, 20_000)).toBe(1);
    // a column the cut has no ground in is read from its neighbour, as on the whole turn
    expect(skylineBetween(turn, 10.5, 20_000)).toBe(1);
    expect(skylineBetween(turn, 11.5, 20_000)).toBe(1);
    // a reach this panorama does not keep (past its far limit) is the whole turn
    expect(skylineBetween(turn, 10.5, 80_000)).toBe(5);
  });
});

describe('a video’s pins', () => {
  const camera = (heading) => ({ heading, tilt: 0, roll: 0, fov: 50 });

  it('keep one alignment per moment, in time order', () => {
    let pins = pinAt([], 4, camera(10));
    pins = pinAt(pins, 1, camera(350));
    pins = pinAt(pins, 4.02, camera(20));
    expect(pins.map((p) => [p.time, p.heading])).toEqual([
      [1, 350],
      [4.02, 20],
    ]);
  });

  it('turn the view the short way round between two pins, and hold past them', () => {
    const pins = [
      { time: 0, heading: 350, tilt: 0, roll: 0, fov: 40 },
      { time: 10, heading: 10, tilt: 2, roll: -1, fov: 90 },
    ];
    const middle = cameraAt(pins, 5);
    expect(middle.heading).toBeCloseTo(0);
    expect(middle.tilt).toBeCloseTo(1);
    expect(middle.fov).toBeCloseTo(60);
    expect(cameraAt(pins, -3).heading).toBe(350);
    expect(cameraAt(pins, 99).heading).toBe(10);
    expect(cameraAt([], 2)).toBeNull();
  });
});

describe('the eye’s height from the wheel', () => {
  it('moves by a share of the height, rounded to the eye’s grain', () => {
    expect(heightStep('ground', 1.7, 1)).toBe(1.9);
    expect(heightStep('ground', 1.7, -1)).toBe(1.5);
    expect(heightStep('drone', 120, 1)).toBe(135);
    expect(heightStep('aircraft', 3000, 2)).toBe(3810);
  });
  it('is said in the metres the inspector sets it in', () => {
    expect(heightText('ground', 1.9)).toBe('Eye height 1.9 m');
    expect(heightText('drone', 135)).toBe('Height above ground 135 m');
    expect(heightText('aircraft', 3810)).toBe('Altitude above sea 3,810 m');
  });
  it('always moves, and stays inside the eye’s limits', () => {
    expect(heightStep('ground', 0.1, 1)).toBe(0.2);
    expect(heightStep('ground', 100, 3)).toBe(100);
    expect(heightStep('drone', 1, -4)).toBe(1);
  });
});

describe('the time a photo says', () => {
  it('takes a camera clock as the local time there', () => {
    expect(localClock('2024-06-12T14:31:07')).toEqual({ date: '2024-06-12', time: '14:31', camera: true });
  });
  it('turns a zoned time to the place’s clock', () => {
    expect(localClock('2024-06-12T12:31:00.000000Z', 'Europe/Zurich')).toEqual({
      date: '2024-06-12',
      time: '14:31',
      camera: false,
    });
    expect(localClock('2024-01-01T23:30:00Z', 'Asia/Aden')).toEqual({ date: '2024-01-02', time: '02:30', camera: false });
    expect(isZoned('2024-06-12T12:31:00Z')).toBe(true);
    expect(isZoned('2024-06-12T12:31:00')).toBe(false);
  });
  it('says nothing it cannot read', () => {
    expect(localClock('2024-06-12T12:31:00Z')).toBeNull();
    expect(localClock('yesterday')).toBeNull();
    expect(localClock('2024-06-12T12:31:00Z', 'Not/AZone')).toBeNull();
  });
});

describe('the grid and the edges of a photo being reshaped', () => {
  const SKEW = [
    { u: 0.1, v: 0 },
    { u: 1, v: 0.1 },
    { u: 0.9, v: 1 },
    { u: 0, v: 0.9 },
  ];

  it('draws the edges and the lines between them as the photo shows', () => {
    const lines = photoGrid((p) => warped(p, SKEW), { lines: 4, samples: 8 });
    // five across and five down, edges included, nine points each
    expect(lines).toHaveLength(10);
    expect(lines.every((line) => line.length === 9)).toBe(true);
    // the top edge runs from corner to corner
    expect(lines[0][0].u).toBeCloseTo(0.1, 9);
    expect(lines[0][8].v).toBeCloseTo(0.1, 9);
    // a curve bends the lines; through nothing, the grid is the frame's
    const plain = photoGrid((p) => p, { lines: 2, samples: 2 });
    expect(plain[2]).toEqual([{ u: 0, v: 0.5 }, { u: 0.5, v: 0.5 }, { u: 1, v: 0.5 }]);
  });

  it('finds the middle of each edge in perspective, not halfway between its corners', () => {
    const [top, right, bottom, left] = edgeMiddles(FLAT_CORNERS);
    expect([top, right, bottom, left]).toEqual([{ u: 0.5, v: 0 }, { u: 1, v: 0.5 }, { u: 0.5, v: 1 }, { u: 0, v: 0.5 }]);
    const middle = edgeMiddles(SKEW)[0];
    const m = warped({ u: 0.5, v: 0 }, SKEW);
    expect(middle).toEqual(m);
  });

  it('moves an edge across itself, stretching the photo that way, or every way when free', () => {
    const scale = { width: 1000, height: 500 };
    // the right edge pulled right and down: only the part across the edge is taken
    const stretched = edgeMoved(FLAT_CORNERS, 1, { x: 100, y: 40 }, scale);
    expect(stretched[1]).toEqual({ u: 1.1, v: 0 });
    expect(stretched[2]).toEqual({ u: 1.1, v: 1 });
    expect(stretched[0]).toBe(FLAT_CORNERS[0]);
    // the top edge pushed down squeezes the photo from above
    const squeezed = edgeMoved(FLAT_CORNERS, 0, { x: 30, y: 50 }, scale);
    expect(squeezed[0].u).toBeCloseTo(0, 9);
    expect(squeezed[0].v).toBeCloseTo(0.1, 9);
    expect(squeezed[1].v).toBeCloseTo(0.1, 9);
    const free = edgeMoved(FLAT_CORNERS, 1, { x: 100, y: 40 }, scale, { free: true });
    expect(free[1].u).toBeCloseTo(1.1, 9);
    expect(free[1].v).toBeCloseTo(0.08, 9);
  });
});

describe('a photo pulled by its corners', () => {
  const SLANT = [
    { u: 0.1, v: 0.05 },
    { u: 0.95, v: 0.15 },
    { u: 0.85, v: 0.9 },
    { u: 0.05, v: 1.1 },
  ];

  it('lays each corner of the photo on the corner it was pulled to', () => {
    const corners = [
      { u: 0, v: 0 },
      { u: 1, v: 0 },
      { u: 1, v: 1 },
      { u: 0, v: 1 },
    ];
    SLANT.forEach((corner, index) => {
      const at = warped(corners[index], SLANT);
      expect(at.u).toBeCloseTo(corner.u, 9);
      expect(at.v).toBeCloseTo(corner.v, 9);
    });
  });

  it('reads back the point of the photo under a point of the frame', () => {
    const point = { u: 0.37, v: 0.61 };
    const back = unwarped(warped(point, SLANT), SLANT);
    expect(back.u).toBeCloseTo(point.u, 9);
    expect(back.v).toBeCloseTo(point.v, 9);
  });

  it('leaves an untouched photo alone, and the GPU reads it through the identity', () => {
    expect(isFlat(FLAT_CORNERS)).toBe(true);
    expect(isFlat(null)).toBe(true);
    expect(isFlat(SLANT)).toBe(false);
    expect(warped({ u: 0.3, v: 0.4 }, FLAT_CORNERS)).toEqual({ u: 0.3, v: 0.4 });
    expect(warpUniform(null)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it('hands the GPU the frame-to-photo matrix column by column', () => {
    const columns = warpUniform(SLANT);
    // back to rows, then through it: a corner of the frame's warp lands on the photo's corner
    const rows = [columns[0], columns[3], columns[6], columns[1], columns[4], columns[7], columns[2], columns[5], columns[8]];
    const corner = throughMatrix(rows, SLANT[2]);
    expect(corner.u).toBeCloseTo(1, 9);
    expect(corner.v).toBeCloseTo(1, 9);
    expect(invertMatrix(warpMatrix(SLANT))).not.toBeNull();
  });

  it('refuses corners folded onto a line', () => {
    const folded = [
      { u: 0, v: 0 },
      { u: 0.5, v: 0 },
      { u: 1, v: 0 },
      { u: 0.2, v: 0 },
    ];
    expect(warpMatrix(folded)).toBeNull();
    expect(warped({ u: 0.5, v: 0.5 }, folded)).toEqual({ u: 0.5, v: 0.5 });
  });

  it('keeps a corner within reach of the frame, and knows what lies inside the four', () => {
    expect(clampCorner({ u: -5, v: 3 })).toEqual({ u: -WARP_REACH, v: 1 + WARP_REACH });
    expect(insideCorners({ u: 0.5, v: 0.5 }, SLANT)).toBe(true);
    expect(insideCorners({ u: 0.02, v: 0.02 }, SLANT)).toBe(false);
  });
});

describe('a loupe over the terrain round the photo', () => {
  it('goes wider than the photo and past its edges, within reach', () => {
    expect(clampLoupe({ zoom: 0.5, x: 1.4, y: 0.5 })).toEqual({ zoom: 0.5, x: 1.4, y: 0.5 });
    expect(clampLoupe({ zoom: 0.01, x: 9, y: -9 })).toEqual({ zoom: LOUPE_MIN, x: 0.5 + LOUPE_REACH, y: 0.5 - LOUPE_REACH });
    expect(loupeMoved({ zoom: 1, x: 0.5, y: 0.5 })).toBe(false);
    expect(loupeMoved({ zoom: 0.5, x: 0.5, y: 0.5 })).toBe(true);
  });
});

describe('the photo moved over a terrain that stays put', () => {
  const LENS = { heading: 200, tilt: 2, roll: 1.5, fov: 30, projection: 'camera' };
  const seen = (camera, loupe, x, y) => rayFor({ ...camera, width: SIZE.width, height: SIZE.height, loupe }, x, y);
  const close = (a, b, digits = 6) => {
    expect(Math.abs(((a.azimuth - b.azimuth + 540) % 360) - 180)).toBeLessThan(10 ** -digits);
    expect(a.elevation).toBeCloseTo(b.elevation, digits);
  };

  it('slides the photo with the hand and leaves the ground under it where it was', () => {
    const at = { x: 640, y: 300 };
    const before = seen(LENS, NO_LOUPE, at.x, at.y);
    const slid = slidPhoto(LENS, NO_LOUPE, 120, -40, at, SIZE);
    const moved = { ...LENS, heading: slid.heading, tilt: slid.tilt };
    // the photo went with the hand…
    expect(screenAt(slid.loupe, 0.5, 0.5, SIZE)).toEqual({ x: 620, y: 335 });
    // …and the terrain stayed under the pointer
    close(seen(moved, slid.loupe, at.x, at.y), before);
    // elsewhere a lens seen off its axis draws it a little apart, which a narrow lens hardly shows
    const tele = { ...LENS, fov: 5 };
    const narrow = slidPhoto(tele, NO_LOUPE, 120, -40, at, SIZE);
    const turned = { ...tele, heading: narrow.heading, tilt: narrow.tilt };
    close(seen(turned, narrow.loupe, 100, 600), seen(tele, NO_LOUPE, 100, 600), 2);
  });

  it('grows the photo over the terrain by widening its lens, the terrain keeping its size', () => {
    const at = { x: 300, y: 500 };
    const grown = grownPhoto(LENS, NO_LOUPE, 2, at, SIZE);
    expect(grown.loupe.zoom).toBeCloseTo(2, 9);
    // twice as big on screen, so twice the tangent: the photo covers twice the terrain
    expect(Math.tan((grown.fov * Math.PI) / 360)).toBeCloseTo(2 * Math.tan((LENS.fov * Math.PI) / 360), 9);
    const moved = { ...LENS, fov: grown.fov, heading: grown.heading, tilt: grown.tilt };
    close(seen(moved, grown.loupe, at.x, at.y), seen(LENS, NO_LOUPE, at.x, at.y));
    // and the terrain keeps its size across the screen, as near as a narrow lens off its axis draws it
    const tele = { ...LENS, fov: 5 };
    const narrow = grownPhoto(tele, NO_LOUPE, 2, at, SIZE);
    const widened = { ...tele, fov: narrow.fov, heading: narrow.heading, tilt: narrow.tilt };
    close(seen(widened, narrow.loupe, 900, 100), seen(tele, NO_LOUPE, 900, 100), 2);
    // the point of the photo under the pointer stays under it
    expect(photoAt(grown.loupe, at.x, at.y, SIZE).u).toBeCloseTo(photoAt(NO_LOUPE, at.x, at.y, SIZE).u, 9);
  });

  it('stops growing where the lens can widen or narrow no more', () => {
    const wide = grownPhoto({ ...LENS, fov: 140 }, NO_LOUPE, 4, { x: 500, y: 375 }, SIZE, { min: 1, max: 150 });
    expect(wide.fov).toBeCloseTo(150, 9);
    expect(wide.loupe.zoom).toBeGreaterThan(1);
    expect(wide.loupe.zoom).toBeLessThan(4);
    const shrunk = grownPhoto({ ...LENS, fov: 1.2 }, NO_LOUPE, 0.5, { x: 500, y: 375 }, SIZE, { min: 1, max: 150 });
    expect(shrunk.fov).toBeCloseTo(1, 9);
    expect(shrunk.loupe.zoom).toBeCloseTo(Math.tan(Math.PI / 360) / Math.tan((1.2 * Math.PI) / 360), 9);
  });
});

describe('a fit searched over the whole turn', () => {
  const samples = traceSamples(traced(TRUE), SIZE);

  it('sends the trace on the picture plane, in half widths from the lens’s middle', () => {
    const plane = tracePlane([{ x: 500, y: 375 }, { x: 1000, y: 0 }, { x: 250, y: 750 }], TRUE);
    expect(plane.half_width).toBe(500);
    expect(plane.x).toEqual([0, 1, -0.5]);
    expect(plane.y).toEqual([-0, 0.75, -0.75]);
  });

  it('puts each point where the lens sees it: tangents of half the lens across', () => {
    const level = { ...TRUE, heading: 0, tilt: 0, roll: 0 };
    const [x] = tracePlane([{ x: 800, y: 375 }], level).x;
    const ray = rayFor(level, 800, 375);
    expect(Math.atan(x * Math.tan(Math.PI / 6)) * (180 / Math.PI)).toBeCloseTo(ray.azimuth, 9);
  });

  it('sends a panorama’s trace in its own degrees, and says it is one', () => {
    const strip = { heading: 95, tilt: 1, roll: 0, fov: 120, projection: 'panorama', ...SIZE };
    const plane = tracePlane([{ x: 500, y: 375 }, { x: 1000, y: 0 }, { x: 250, y: 750 }], strip);
    expect(plane.half_width).toBe(500);
    expect(plane.x).toEqual([0, 1, -0.5]);
    expect(plane.y).toEqual([-0, 0.75, -0.75]);
    // half a width is half the strip's degrees, up as across
    const ray = rayFor(strip, 1000, 0);
    expect(ray.azimuth - strip.heading).toBeCloseTo(plane.x[1] * 60, 9);
    expect(ray.elevation - strip.tilt).toBeCloseTo(plane.y[1] * 60, 9);
    expect(matchRequest(samples, strip, PANORAMA).projection).toBe('panorama');
    expect(matchRequest(samples, TRUE, PANORAMA)).not.toHaveProperty('projection');
  });

  it('gives the terrain a margin as wide as its heights seen from the ridge, shown and never sent', () => {
    const far = Float32Array.from({ length: 3600 }, (_, i) => (i < 1800 ? 300 : 30_000));
    const known = { ...PANORAMA, resolution: 30, skylineDistance: far };
    expect(terrainMargin(known, 10)).toBeCloseTo(((MARGIN_CELLS * 30) / 300) * (180 / Math.PI), 6);
    expect(terrainMargin(known, 200)).toBeLessThan(0.03);
    expect(terrainMargin(PANORAMA, 10)).toBe(0);
    // the search counts every point alike: the band is for the eye
    const body = matchRequest(samples, TRUE, known, { known: true });
    expect(body).not.toHaveProperty('distance');
    expect(body).not.toHaveProperty('detail');
  });

  it('says how fine the relief is, and to skip a near ridge’s rocks where it is coarse', () => {
    expect(reliefWords(30)).toBe('Relief here is known to 30 m: trace a near ridge’s shape, not its rocks or trees.');
    expect(reliefWords(4.8)).toBe('Relief here is known to 5 m, from a national survey.');
    expect(reliefWords(null)).toBe('');
  });

  it('asks about the turn the view marched, and only a whole one', () => {
    const body = matchRequest(samples, TRUE, PANORAMA, { known: true });
    expect(body.skyline).toBe(PANORAMA.skyline);
    expect(body).toMatchObject({ start: 0, step: 0.1, fov: 60, known: true, tilt: 1, roll: 1.5 });
    expect(body.x).toHaveLength(samples.length);
    expect(matchRequest(samples, TRUE, { ...PANORAMA, azimuth: { ...PANORAMA.azimuth, full: false } })).toBeNull();
    expect(matchRequest(samples, TRUE, null)).toBeNull();
  });

  // the same turn, as haze 20 km out leaves it, and the whole turn with a far range standing over the ridge
  const HAZED = {
    ...PANORAMA,
    skyline: PANORAMA.skyline.map((v) => Math.max(v, 6.5)),
    cuts: [
      { reach: 10_000, skyline: Float32Array.from(PANORAMA.skyline, (v) => v - 1) },
      { reach: 20_000, skyline: Float32Array.from(PANORAMA.skyline) },
    ],
  };

  it('sends the cuts of the turn Fit tries on its own, or the one the analyst chose', () => {
    const auto = matchRequest(samples, TRUE, HAZED, { reach: 'auto', within: [10, 35], facing: [90, 30] });
    // the farthest cut tried is the turn, the nearer ones go beside it; the whole turn is not searched
    expect(auto.reach).toBe(20_000);
    expect(auto.skyline).toHaveLength(3600);
    expect(auto.skyline[5]).toBeCloseTo(ridge(0.5), 3);
    expect(auto.cuts.map((cut) => cut.reach)).toEqual([10_000]);
    expect(auto).toMatchObject({ within: [10, 35], facing: [90, 30] });
    // left to itself, Fit stops at a reach: farther cuts only when asked for
    const near = matchRequest(samples, TRUE, HAZED, { reach: 'auto', autoReach: 15_000 });
    expect(near).toMatchObject({ reach: 10_000, cuts: [] });
    const chosen = matchRequest(samples, TRUE, HAZED, { reach: 20_000 });
    expect(chosen).toMatchObject({ reach: 20_000, cuts: [] });
    expect(chosen.skyline[5]).toBeCloseTo(ridge(0.5), 3);
    // clear air, a reach the panorama does not keep, or a panorama keeping none: the whole turn alone
    expect(matchRequest(samples, TRUE, HAZED, { reach: null })).toMatchObject({ skyline: HAZED.skyline, reach: null, cuts: [] });
    expect(matchRequest(samples, TRUE, HAZED, { reach: 100_000 })).toMatchObject({ skyline: HAZED.skyline, reach: null });
    expect(matchRequest(samples, TRUE, PANORAMA, { reach: 'auto' })).toMatchObject({ skyline: PANORAMA.skyline, reach: null });
    // the photo says its lens: no range of lenses goes with it
    expect(matchRequest(samples, TRUE, HAZED, { known: true, within: [10, 35] })).not.toHaveProperty('within');
  });

  it('refines and measures each place on the cut of the turn it lies on', () => {
    const along = (azimuth, reach = null) => skylineBetween(HAZED, azimuth, reach);
    const found = { fits: [{ heading: 95.4, tilt: 0.8, roll: 1.3, fov: 60, explained: 0.9, close: true, reach: 20_000 }] };
    const [place] = searchedPlaces(found, samples, { ...TRUE, heading: 200, roll: 0 }, along, { lens: false });
    expect(place.reach).toBe(20_000);
    expect(place.camera.heading).toBeCloseTo(95, 0);
    expect(place.camera.roll).toBeCloseTo(1.5, 0);
    expect(place.gap.median).toBeLessThan(0.05);
    // the same place read against the whole turn, the far range over the ridge, lies far off it
    const whole = searchedPlaces({ fits: [{ ...found.fits[0], reach: null }] }, samples, { ...TRUE, heading: 200 }, along, {
      lens: false,
    });
    expect(whole[0].reach).toBeNull();
    expect(whole[0].gap.median).toBeGreaterThan(0.5);
  });

  it('brings each place the search found onto the trace', () => {
    const found = { fits: [{ heading: 95.6, tilt: 0.6, fov: 61, explained: 0.9, close: true }] };
    const [place] = searchedPlaces(found, samples, { ...TRUE, heading: 200, roll: 0 }, skyline);
    expect(place.camera.heading).toBeCloseTo(95, 0);
    expect(place.camera.fov).toBeCloseTo(60, 0);
    expect(place.gap.median).toBeLessThan(0.05);
    expect(place).toMatchObject({ explained: 0.9, close: true });
  });

  it('keeps the photo’s lens on every place', () => {
    const found = { fits: [{ heading: 95.6, tilt: 0.6, fov: 61, explained: 0.9, close: true }] };
    const [place] = searchedPlaces(found, samples, { ...TRUE, heading: 200 }, skyline, { lens: false });
    expect(place.camera.fov).toBe(60);
  });

  const at = (heading, close = true) => ({ camera: { heading, tilt: 0, fov: 60 }, gap: { median: 0.1 }, close });
  const view = { heading: 10, tilt: 0, fov: 60 };
  const before = { median: 2.4 };

  it('turns to the best place, wherever the view happened to look', () => {
    const looking = { heading: 140, tilt: 0, fov: 60 };
    // a rival about as good where the view looks is named, not taken: only what is said decides
    const both = searchOutcome({ verdict: 'ambiguous', fits: [] }, [at(30), at(150)], looking, { before });
    expect(both).toMatchObject({ take: 0 });
    expect(both.text).toBe('Fitted at 30° NE, but 150° SE fits as well: say which way it faces');
  });

  it('knows when the view is at a place already', () => {
    expect(isAtPlace({ heading: 359.98, tilt: 1, fov: 60 }, { camera: { heading: 0.01, tilt: 1.02, fov: 60 } })).toBe(true);
    expect(isAtPlace({ heading: 10, tilt: 1, fov: 60 }, { camera: { heading: 10.2, tilt: 1, fov: 60 } })).toBe(false);
  });


  it('says where it fitted and how much closer the trace now lies', () => {
    const outcome = searchOutcome({ verdict: 'match', fits: [] }, [at(299)], view, { before });
    expect(outcome).toMatchObject({ take: 0, kind: 'ok' });
    expect(outcome.text).toBe('Fitted at 299° NW: gap 2.4° to 0.10°');
  });

  it('says a loose fit is to be checked, and names a rival about as good', () => {
    const loose = searchOutcome({ verdict: 'loose', fits: [] }, [at(299)], view, { before });
    expect(loose.text).toBe('Loose fit at 299° NW: compare the ridges with the photo');
    const both = searchOutcome({ verdict: 'ambiguous', fits: [] }, [at(299), at(147)], view, { before });
    expect(both).toMatchObject({ take: 0, kind: 'warn' });
    // the hint that would settle it is named, unless the analyst already gave it
    expect(both.text).toBe('Fitted at 299° NW, but 147° SE fits as well: say which way it faces');
    const told = searchOutcome({ verdict: 'ambiguous', fits: [] }, [at(299), at(147)], view, { before, facing: true });
    expect(told.text).toBe('Fitted at 299° NW, and 147° SE fits about as well');
  });

  it('names the place the view already stands at, whose reach still counts', () => {
    const there = { ...at(10), reach: 20_000 };
    const outcome = searchOutcome({ verdict: 'match', fits: [] }, [there], view, { before: { median: 0.1 } });
    expect(outcome).toMatchObject({ take: -1, here: 0 });
    const moved = searchOutcome({ verdict: 'match', fits: [] }, [at(299)], view, { before });
    expect(moved).toMatchObject({ take: 0, here: -1 });
  });

  it('says when the place lies on the ridges a cut of the turn keeps', () => {
    const cut = { ...at(299), reach: 20_000 };
    expect(searchOutcome({ verdict: 'match', fits: [] }, [cut], view, { before }).text).toBe(
      'Fitted at 299° NW: gap 2.4° to 0.10°, on the ridges within 20 km'
    );
    expect(searchOutcome({ verdict: 'loose', fits: [] }, [cut], view, { before }).text).toBe(
      'Loose fit at 299° NW, on the ridges within 20 km: compare the ridges with the photo'
    );
  });

  it('turns nowhere when nothing matches, offers the closest, and names the lenses tried', () => {
    const none = searchOutcome({ verdict: 'none', fits: [], lenses: [40, 90] }, [at(112)], view, { before });
    expect(none).toMatchObject({ take: -1, closest: 0, kind: 'warn' });
    expect(none.text).toBe('Nothing on this horizon matches the trace with a lens of 40° to 90°');
    const known = searchOutcome({ verdict: 'none', fits: [], lenses: [60, 60] }, [], view, { lens: false, before });
    expect(known).toMatchObject({ take: -1, closest: -1 });
    expect(known.text).toBe('Nothing on this horizon matches the trace');
  });

  it('stays put when the view is the best place already, give or take a hair', () => {
    const here = { camera: { heading: 10.3, tilt: 0.02, fov: 60.4 }, gap: { median: 2.35 }, close: true };
    const outcome = searchOutcome({ verdict: 'match', fits: [] }, [here], view, { before });
    expect(outcome).toMatchObject({ take: -1, kind: 'info' });
    expect(outcome.text).toBe('The view is already as close to the trace as a fit gets');
    // a loose fit at the place the view stands on still says it is loose, and moves nothing
    const loose = searchOutcome({ verdict: 'loose', fits: [] }, [here], view, { before });
    expect(loose).toMatchObject({ take: -1, kind: 'warn' });
    // the same place, but the fit brings the trace closer: it is taken
    const nearer = { ...here, gap: { median: 1.1 } };
    expect(searchOutcome({ verdict: 'match', fits: [] }, [nearer], view, { before }).take).toBe(0);
  });
});


describe('the marks beside the trace, as the search reads them', () => {
  const FRAME = { width: 800, height: 400, fov: 60, heading: 0, tilt: 0, roll: 0, projection: 'camera' };

  it('says which stroke each sample lies on, and which stroke each rubbed piece came from', () => {
    const samples = traceSamples([[{ u: 0, v: 0.5 }, { u: 0.2, v: 0.5 }], [{ u: 0.5, v: 0.4 }, { u: 0.7, v: 0.4 }]], { width: 100, height: 100 }, { spacing: 5 });
    expect(new Set(samples.map((s) => s.stroke))).toEqual(new Set([0, 1]));
    const strokes = [
      Array.from({ length: 11 }, (_, i) => ({ u: i / 10, v: 0.5 })),
      [{ u: 0, v: 0.2 }, { u: 1, v: 0.2 }],
    ];
    const left = erasedFrom(strokes, [{ u: 0.5, v: 0.5 }], 30, { width: 100, height: 100 });
    expect(left.strokes.length).toBe(3);
    expect(left.from).toEqual([0, 0, 1]);
    const untouched = erasedFrom(strokes, [{ u: 0.5, v: 0.9 }], 3, { width: 100, height: 100 });
    expect(untouched.strokes).toBe(strokes);
    expect(eraseStrokes(strokes, [{ u: 0.5, v: 0.5 }], 30, { width: 100, height: 100 })).toEqual(left.strokes);
  });

  it('keeps inner edges off the skyline, names the paired strokes and the pieces', () => {
    const samples = [
      { x: 100, y: 150, stroke: 0 },
      { x: 300, y: 140, stroke: 0 },
      { x: 500, y: 180, stroke: 1 },
      { x: 700, y: 130, stroke: 2 },
    ];
    const plain = markedPlane(samples, FRAME, null);
    expect(plain).toEqual(tracePlane(samples, FRAME));
    const marks = { lines: [5, 9, 2], inner: [9], pairs: [[9, 5]], cuts: [0.5] };
    const plane = markedPlane(samples, FRAME, marks);
    expect(plane.x.length).toBe(3);
    expect(plane.ridge_x.length).toBe(1);
    expect(plane.line).toEqual([0, 0, 1]);
    expect(plane.ridge_line).toEqual([2]);
    expect(plane.pairs).toEqual([[2, 0]]);
    expect(plane.piece).toEqual([0, 0, 1]);
    expect(plane.ridge_piece).toEqual([1]);
    // a piece read through the photo's own shape when the caller knows it
    expect(markedPlane(samples, FRAME, marks, () => 3).piece).toEqual([3, 3, 3]);
  });

  it('sends how far lines stand, in metres, naming each stroke as the search does', () => {
    const samples = [
      { x: 100, y: 150, stroke: 0 },
      { x: 300, y: 140, stroke: 1 },
      { x: 500, y: 180, stroke: 1 },
    ];
    const marks = { lines: [5, 9], inner: [], pairs: [], cuts: [], far: [{ line: 9, bands: ['b1', 'b3'] }] };
    const plane = markedPlane(samples, FRAME, marks);
    expect(plane.line).toEqual([0, 1, 1]);
    expect(plane.far).toEqual([[1, 1_000, 10_000]]);
    expect(plane.pairs).toEqual([]);
    // a sea line is named too, for the search to lay it on the sea's horizon
    const sea = markedPlane(samples, FRAME, { lines: [5, 9], inner: [], pairs: [], cuts: [], far: [], sea: [9] });
    expect(sea.line).toEqual([0, 1, 1]);
    expect(sea.sea).toEqual([1]);
    // and a line with only sky above, for the search to keep the terrain under it
    const clear = markedPlane(samples, FRAME, { lines: [5, 9], inner: [], pairs: [], cuts: [], far: [], sea: [], clear: [5] });
    expect(clear.line).toEqual([0, 1, 1]);
    expect(clear.clear).toEqual([0]);
  });
});

describe('a collage’s pieces as the search eased them', () => {
  // the right frame of the collage was taken half a degree higher than the left
  const RIGHT = { ...TRUE, tilt: TRUE.tilt + 0.5 };
  const PIECES = [
    { piece: 0, turn: 0, tilt: 0, roll: 0 },
    { piece: 1, turn: 0, tilt: 0.5, roll: 0 },
  ];
  const pieceAt = (p) => (p.u > 0.5 ? 1 : 0);
  const strokes = [traced(TRUE, { from: 0.1, to: 0.5 })[0], traced(RIGHT, { from: 0.5, to: 0.9 })[0]];
  const pieced = { pieces: PIECES, pieceAt };
  const band = (azimuth) => ({ top: skyline(azimuth), margin: 0 });
  /** How far a point of the frame lies from the terrain's skyline through `camera`, degrees. */
  const off = (camera, x, y) => {
    const ray = rayFor(camera, x, y);
    return Math.abs(ray.elevation - skyline(ray.azimuth));
  };

  it('sees each piece through the whole’s camera eased by its own turn, tilt and roll', () => {
    expect(pieceCameras(TRUE, null)(1)).toBe(TRUE);
    const of = pieceCameras(TRUE, [{ piece: 1, turn: 0.4, tilt: -0.25, roll: 1 }]);
    expect(of(1)).toMatchObject({ heading: TRUE.heading + 0.4, tilt: TRUE.tilt - 0.25, roll: TRUE.roll + 1, fov: TRUE.fov });
    expect(of(0)).toBe(TRUE);
  });

  it('reads each piece of the trace through its own camera: on the terrain where one camera saw it off', () => {
    const [left, right] = traceFit(strokes, TRUE, skyline);
    expect(left.every((kind) => kind === 'on')).toBe(true);
    expect(right.filter((kind) => kind === 'on').length).toBeLessThan(right.length / 4);
    const eased = traceFit(strokes, TRUE, skyline, pieced);
    expect(eased.flat().every((kind) => kind === 'on')).toBe(true);
    const samples = traceSamples([strokes[1]], SIZE);
    expect(traceGap(samples, TRUE, skyline, pieced).median).toBeLessThan(0.02);
    expect(traceGap(samples, TRUE, skyline).median).toBeGreaterThan(0.3);
  });

  it('draws the terrain’s skyline over the photo, each eased piece where the search read it', () => {
    const [whole] = terrainLine(TRUE, band);
    expect(whole.length).toBeGreaterThan(300);
    expect(whole.every((p) => off(TRUE, p.u * SIZE.width, p.v * SIZE.height) < 0.01)).toBe(true);
    const runs = terrainLine(TRUE, band, pieced);
    expect(runs.length).toBe(2);
    expect(runs[0].every((p) => p.u <= 0.5) && runs[1].every((p) => p.u > 0.5)).toBe(true);
    expect(runs[1].every((p) => off(RIGHT, p.u * SIZE.width, p.v * SIZE.height) < 0.01)).toBe(true);
    // the right piece's skyline stands lower on the photo than one camera would draw it, as the photo shows it
    const at = runs[1][10];
    const plain = whole.reduce((best, p) => (Math.abs(p.u - at.u) < Math.abs(best.u - at.u) ? p : best));
    expect(at.v).toBeGreaterThan(plain.v);
  });

  it('gives the margin up and down where it is known, and stops where no ground stands', () => {
    const [run] = terrainLine(TRUE, (azimuth) => ({ top: skyline(azimuth), margin: 0.3 }));
    expect(run.every((p) => p.high < p.v && p.v < p.low)).toBe(true);
    expect(terrainLine(TRUE, band)[0].every((p) => p.high === null && p.low === null)).toBe(true);
    const holed = terrainLine(TRUE, (azimuth) => ({ top: Math.abs(azimuth - TRUE.heading) < 3 ? null : skyline(azimuth), margin: 0 }));
    expect(holed.length).toBe(2);
    expect(terrainLine(TRUE, null)).toEqual([]);
    expect(terrainLine({ ...TRUE, width: 0 }, band)).toEqual([]);
  });

  it('lays the trace on the terrain as the whole camera draws it, each eased piece moved where it was read', () => {
    const plain = traceOnTerrain(strokes, TRUE);
    expect(plain[1][0]).toEqual({ x: strokes[1][0].u * SIZE.width, y: strokes[1][0].v * SIZE.height });
    const [left, right] = traceOnTerrain(strokes, TRUE, pieced);
    expect(left.every((p, i) => Math.hypot(p.x - plain[0][i].x, p.y - plain[0][i].y) < 1e-6)).toBe(true);
    expect(right.every((p) => off(TRUE, p.x, p.y) < 0.01)).toBe(true);
  });

  it('keeps a place the search eased as it found it, its pieces with it', () => {
    const samples = traceSamples(strokes, SIZE);
    const fit = { heading: TRUE.heading, tilt: TRUE.tilt, roll: TRUE.roll, fov: TRUE.fov, explained: 0.9, close: true, pieces: PIECES };
    const [place] = searchedPlaces({ fits: [fit] }, samples, { ...TRUE, heading: TRUE.heading + 3 }, (azimuth) => skyline(azimuth), { pieceAt });
    expect(place.camera.heading).toBe(TRUE.heading);
    expect(place.pieces).toBe(PIECES);
    expect(place.gap.median).toBeLessThan(0.02);
    const [unread] = searchedPlaces({ fits: [fit] }, samples, TRUE, (azimuth) => skyline(azimuth));
    expect(unread.pieces).toBeNull();
  });
});
