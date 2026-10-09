import { describe, expect, it } from 'vitest';
import { rayFor, toScreen } from './camera.js';
import {
  bendShape,
  bent,
  BEND_MAX,
  clampLoupe,
  FREE_REACH,
  FREE_ZOOM_MIN,
  loupeMoved,
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
  eraseStrokes,
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
  zoomLoupe,
  isAtPlace,
  matchRequest,
  placeToTake,
  searchedPlaces,
  searchOutcome,
  tracePlane,
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

  it('never looks past the photo’s edges nor shrinks it under the frame', () => {
    const near = zoomLoupe(NO_LOUPE, 2, { x: 0, y: 0 }, SIZE);
    expect(near).toEqual({ zoom: 2, x: 0.25, y: 0.25 });
    expect(zoomLoupe(near, 0.1, { x: 500, y: 375 }, SIZE)).toEqual(NO_LOUPE);
    expect(zoomLoupe(NO_LOUPE, 1000, { x: 500, y: 375 }, SIZE).zoom).toBe(LOUPE_MAX);
    // dragged far right, it stops with the photo's left edge on the frame's
    expect(panLoupe(near, 5000, 0, SIZE).x).toBeCloseTo(0.25, 9);
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

describe('a loupe let free over the terrain', () => {
  it('goes wider than the photo and past its edges only when free', () => {
    expect(clampLoupe({ zoom: 0.5, x: 1.4, y: 0.5 })).toEqual({ zoom: 1, x: 0.5, y: 0.5 });
    expect(clampLoupe({ zoom: 0.5, x: 1.4, y: 0.5 }, { free: true })).toEqual({ zoom: 0.5, x: 1.4, y: 0.5 });
    expect(clampLoupe({ zoom: 0.01, x: 9, y: -9 }, { free: true })).toEqual({ zoom: FREE_ZOOM_MIN, x: 0.5 + FREE_REACH, y: 0.5 - FREE_REACH });
    expect(loupeMoved({ zoom: 1, x: 0.5, y: 0.5 })).toBe(false);
    expect(loupeMoved({ zoom: 0.5, x: 0.5, y: 0.5 })).toBe(true);
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

  it('asks about the turn the view marched, and only a whole one', () => {
    const body = matchRequest(samples, TRUE, PANORAMA, { known: true });
    expect(body.skyline).toBe(PANORAMA.skyline);
    expect(body).toMatchObject({ start: 0, step: 0.1, fov: 60, known: true, tilt: 1, roll: 1.5 });
    expect(body.x).toHaveLength(samples.length);
    expect(matchRequest(samples, TRUE, { ...PANORAMA, azimuth: { ...PANORAMA.azimuth, full: false } })).toBeNull();
    expect(matchRequest(samples, TRUE, null)).toBeNull();
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

  it('turns to the best place, or to one about as good where the analyst was looking', () => {
    const view = { heading: 140, fov: 60 };
    expect(placeToTake([at(30), at(150)], view)).toBe(1);
    // too far from the view to be its hint
    expect(placeToTake([at(30), at(200)], view)).toBe(0);
    // near the view, but well behind the best
    expect(placeToTake([at(30), at(150, false)], view)).toBe(0);
    expect(placeToTake([], view)).toBe(-1);
  });

  it('knows when the view is at a place already', () => {
    expect(isAtPlace({ heading: 359.98, tilt: 1, fov: 60 }, { camera: { heading: 0.01, tilt: 1.02, fov: 60 } })).toBe(true);
    expect(isAtPlace({ heading: 10, tilt: 1, fov: 60 }, { camera: { heading: 10.2, tilt: 1, fov: 60 } })).toBe(false);
  });

  const view = { heading: 10, tilt: 0, fov: 60 };
  const before = { median: 2.4 };

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
    expect(both.text).toBe('Fitted at 299° NW, and 147° SE fits about as well');
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
