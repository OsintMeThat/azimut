import { describe, expect, it } from 'vitest';
import {
  apply,
  compose,
  frameBox,
  frameToFrame,
  fromMercator,
  groundPerPixel,
  imageToMercator,
  invert,
  screenToMercator,
  toMercator,
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
