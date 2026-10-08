import { describe, expect, it } from 'vitest';
import { basis, focal, focal35FromFov, fovFromFocal35, rayFor, toScreen, turnBetween, verticalFov } from './camera.js';

const CAMERA = { heading: 80, tilt: 2, roll: 0, fov: 60, width: 1200, height: 800, projection: 'camera' };

describe('the rectilinear camera', () => {
  it('puts what it looks at in the middle of the frame', () => {
    const middle = toScreen(CAMERA, 80, 2);
    expect(middle.x).toBeCloseTo(600, 6);
    expect(middle.y).toBeCloseTo(400, 6);
  });

  it('puts the edge of its field of view on the edge of the frame', () => {
    const level = { ...CAMERA, tilt: 0 };
    expect(toScreen(level, 80 + 30, 0).x).toBeCloseTo(1200, 6);
    expect(toScreen(level, 80 - 30, 0).x).toBeCloseTo(0, 6);
  });

  it('sees nothing behind it', () => {
    expect(toScreen(CAMERA, 260, 0).visible).toBe(false);
  });

  it('takes a pixel back to the direction it came from', () => {
    for (const camera of [CAMERA, { ...CAMERA, roll: 7, tilt: -35 }, { ...CAMERA, heading: 355, fov: 20 }]) {
      for (const [x, y] of [[0, 0], [600, 400], [1111, 777], [37, 790]]) {
        const { azimuth, elevation } = rayFor(camera, x, y);
        const back = toScreen(camera, azimuth, elevation);
        expect(back.x).toBeCloseTo(x, 4);
        expect(back.y).toBeCloseTo(y, 4);
      }
    }
  });

  it('leans the horizon when the frame rolls', () => {
    const rolled = { ...CAMERA, tilt: 0, roll: 10 };
    const left = toScreen(rolled, 80 - 20, 0);
    const right = toScreen(rolled, 80 + 20, 0);
    // a frame turned clockwise sees the horizon fall to the left… and rise to the right
    expect(right.y).toBeLessThan(left.y);
  });

  it('keeps its axes square', () => {
    const { forward, right, up } = basis({ heading: 33, tilt: 21, roll: -12 });
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(dot(forward, right)).toBeCloseTo(0, 9);
    expect(dot(forward, up)).toBeCloseTo(0, 9);
    expect(dot(right, up)).toBeCloseTo(0, 9);
    expect(up[2]).toBeGreaterThan(0);
  });

  it('works out the focal length and the vertical field of view', () => {
    expect(focal({ fov: 90, width: 1000 })).toBeCloseTo(500, 9);
    expect(verticalFov({ fov: 90, width: 1000, height: 1000 })).toBeCloseTo(90, 9);
    expect(verticalFov({ fov: 60, width: 1200, height: 800, projection: 'panorama' })).toBeCloseTo(40, 9);
  });
});

describe('the panorama strip', () => {
  const STRIP = { heading: 0, tilt: 5, fov: 120, width: 1200, height: 400, projection: 'panorama' };

  it('lays azimuth along and elevation up, a tenth of a degree a pixel here', () => {
    expect(toScreen(STRIP, 30, 5)).toEqual({ x: 900, y: 200, visible: true });
    expect(toScreen(STRIP, 330, 15).x).toBeCloseTo(300, 9);
    expect(toScreen(STRIP, 330, 15).y).toBeCloseTo(100, 9);
    expect(rayFor(STRIP, 300, 100)).toEqual({ azimuth: 330, elevation: 15 });
  });

  it('turns the short way round north', () => {
    expect(turnBetween(350, 10)).toBe(20);
    expect(turnBetween(10, 350)).toBe(-20);
    expect(turnBetween(0, 180)).toBe(180);
  });
});

describe('a lens from a photo’s EXIF', () => {
  it('gives a phone’s 26 mm about 67° across a 4:3 frame', () => {
    expect(fovFromFocal35(26)).toBeCloseTo(67.3, 0);
    expect(fovFromFocal35(50, 3 / 2)).toBeCloseTo(39.6, 0);
  });
});

describe('the 35 mm equivalent', () => {
  it('turns a focal length into a field of view and back', () => {
    for (const mm of [13, 26, 50, 200]) {
      expect(focal35FromFov(fovFromFocal35(mm, 16 / 9), 16 / 9)).toBeCloseTo(mm, 6);
    }
    // a phone's main camera, 26 mm on a 4:3 frame, sees about 65° across
    expect(fovFromFocal35(26)).toBeGreaterThan(62);
    expect(fovFromFocal35(26)).toBeLessThan(68);
  });
});
