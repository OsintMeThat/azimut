import { describe, expect, it } from 'vitest';
import { toScreen } from './camera.js';
import {
  cameraAt,
  fitFrame,
  fitToTrace,
  gapText,
  heightStep,
  heightText,
  isZoned,
  localClock,
  pinAt,
  skylineBetween,
  strokeFrom,
  traceGap,
  traceSamples,
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
