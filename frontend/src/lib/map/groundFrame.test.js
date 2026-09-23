import { describe, expect, it } from 'vitest';
import {
  apply,
  boxCorners,
  compassAngle,
  compose,
  frameBox,
  frameToFrame,
  fromMercator,
  groundPerPixel,
  imageToMercator,
  invert,
  screenToMercator,
  toMercator,
  turnAbout,
  turnedBox,
} from './groundFrame.js';

const frame = (patch = {}) => ({ lng: 2.2945, lat: 48.8584, zoom: 15, bearing: 0, width: 800, height: 600, ...patch });
const close = (actual, expected, digits = 6) =>
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], digits));

describe('the ground under a view', () => {
  it('round-trips Web Mercator', () => {
    close(fromMercator(...toMercator(2.2945, 48.8584)), [2.2945, 48.8584]);
  });

  it('puts the camera centre at the middle of the container', () => {
    const toGround = screenToMercator(frame());
    close(apply(toGround, 400, 300), toMercator(2.2945, 48.8584), 3);
  });

  it('reads north as up and east as right with no bearing', () => {
    const toGround = screenToMercator(frame());
    const [cx, cy] = apply(toGround, 400, 300);
    const [ux, uy] = apply(toGround, 400, 0);
    const [rx] = apply(toGround, 800, 300);
    expect(uy).toBeGreaterThan(cy);
    expect(ux).toBeCloseTo(cx, 3);
    expect(rx).toBeGreaterThan(cx);
  });

  it('turns with the engine bearing: at 90° east is up', () => {
    const toGround = screenToMercator(frame({ bearing: 90 }));
    const [cx, cy] = apply(toGround, 400, 300);
    const [ux, uy] = apply(toGround, 400, 0);
    expect(ux).toBeGreaterThan(cx);
    expect(uy).toBeCloseTo(cy, 3);
  });

  it('covers a turned view with a larger axis-aligned box', () => {
    const flat = frameBox(frame());
    const turned = frameBox(frame({ bearing: 30 }));
    expect(turned.east - turned.west).toBeGreaterThan(flat.east - flat.west);
  });

  it('measures ground metres per pixel shrinking towards the poles', () => {
    expect(groundPerPixel(frame({ lat: 0 }))).toBeGreaterThan(groundPerPixel(frame({ lat: 60 })));
  });
});

describe('affine maps between frames', () => {
  it('inverts and composes', () => {
    const m = { a: 2, b: 0.5, c: -1, d: 3, e: 10, f: -4 };
    close(apply(compose(invert(m), m), 7, -2), [7, -2]);
  });

  it('carries a point of an old view to where the same ground is now', () => {
    const before = frame();
    const panned = frame({ lng: 2.3, zoom: 16, bearing: 20 });
    const ground = apply(screenToMercator(before), 120, 80);
    const expected = apply(invert(screenToMercator(panned)), ...ground);
    close(apply(frameToFrame(before, panned), 120, 80), expected, 4);
  });

  it('lays an axis-aligned image over the view that asked for it', () => {
    const view = frame({ bearing: 25 });
    const box = frameBox(view);
    const toView = compose(invert(screenToMercator(view)), imageToMercator(box, 1000, 900));
    const ground = [box.west, box.north];
    close(apply(toView, 0, 0), apply(invert(screenToMercator(view)), ...ground), 4);
  });
});

describe('a box drawn on a turned screen', () => {
  const metres = (a, b) => Math.hypot(...toMercator(...a).map((v, i) => v - toMercator(...b)[i]));

  it('is the plain ground box of its two corners on a north-up screen', () => {
    const corners = boxCorners(turnedBox([[2, 48], [2.01, 47.99]], 0));
    close(corners[0], [2, 48], 9);
    close(corners[1], [2.01, 48], 9);
    close(corners[2], [2.01, 47.99], 9);
    close(corners[3], [2, 47.99], 9);
  });

  it('runs its sides along the screen it was drawn on', () => {
    // Drawn with east up: the screen's right points south, its down points west.
    const view = frame({ bearing: 90 });
    const toGround = screenToMercator(view);
    const drawn = [[100, 100], [300, 200]].map(([x, y]) => fromMercator(...apply(toGround, x, y)));
    const box = turnedBox(drawn, 90);
    close(box.right, [0, -1], 9);
    close(box.down, [-1, 0], 9);
    const onScreen = boxCorners(box).map((point) => apply(invert(toGround), ...toMercator(...point)));
    close(onScreen[0], [100, 100], 4);
    close(onScreen[1], [300, 100], 4);
    close(onScreen[2], [300, 200], 4);
    close(onScreen[3], [100, 200], 4);
  });

  it('keeps its sides and its right angles whatever the camera does after', () => {
    const corners = boxCorners(turnedBox([[2, 48], [2.004, 47.998]], 33));
    const [a, b, c, d] = corners;
    expect(metres(a, b)).toBeCloseTo(metres(d, c), 3);
    expect(metres(a, d)).toBeCloseTo(metres(b, c), 3);
    expect(metres(a, c)).toBeCloseTo(metres(b, d), 3);
  });

  it('turns a point clockwise, as the screen shows a turn', () => {
    const turned = turnAbout([0.01, 0], [0, 0], 90);
    close(turned, [0, -0.01], 9);
  });

  it('folds an angle into one turn', () => {
    expect(compassAngle(-30)).toBeCloseTo(330);
    expect(compassAngle(725)).toBeCloseTo(5);
    expect(compassAngle(360)).toBe(0);
    expect(compassAngle('x')).toBe(0);
    expect(compassAngle(undefined)).toBe(0);
  });
});
