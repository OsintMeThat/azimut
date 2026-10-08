import { describe, expect, it } from 'vitest';
import {
  basis,
  focal,
  focal35FromFov,
  fovFromFocal35,
  principal,
  rayFor,
  seenLens,
  toScreen,
  turnAbout,
  turnBetween,
  verticalFov,
} from './camera.js';

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

describe('the loupe', () => {
  const loupe = { zoom: 4, x: 0.25, y: 0.6 };
  const rolled = { ...CAMERA, roll: 3 };
  const seen = { ...rolled, loupe };

  it('sets the point it looks at in the middle of the screen, magnified', () => {
    const at = rayFor(rolled, 0.25 * 1200, 0.6 * 800);
    const shown = toScreen(seen, at.azimuth, at.elevation);
    expect(shown.x).toBeCloseTo(600, 4);
    expect(shown.y).toBeCloseTo(400, 4);
    // a direction 10 px off in the frame is 40 px off through the loupe
    const near = rayFor(rolled, 0.25 * 1200 + 10, 0.6 * 800);
    expect(toScreen(seen, near.azimuth, near.elevation).x).toBeCloseTo(640, 2);
  });

  it('takes a pixel back to the direction it came from', () => {
    for (const [x, y] of [[0, 0], [600, 400], [1111, 777]]) {
      const { azimuth, elevation } = rayFor(seen, x, y);
      const back = toScreen(seen, azimuth, elevation);
      expect(back.x).toBeCloseTo(x, 4);
      expect(back.y).toBeCloseTo(y, 4);
    }
  });

  it('changes nothing at 1× on the middle', () => {
    const plain = { ...CAMERA, loupe: { zoom: 1, x: 0.5, y: 0.5 } };
    expect(principal(plain)).toEqual({ x: 600, y: 400 });
    expect(focal(plain)).toBeCloseTo(focal(CAMERA), 9);
    expect(toScreen(plain, 95, 5).x).toBeCloseTo(toScreen(CAMERA, 95, 5).x, 9);
  });

  it('shows a narrower lens facing the point it looks at', () => {
    const lens = seenLens(seen);
    const middle = rayFor(rolled, 0.25 * 1200, 0.6 * 800);
    expect(lens.heading).toBeCloseTo(middle.azimuth, 6);
    expect(lens.tilt).toBeCloseTo(middle.elevation, 6);
    // a quarter of the width, as tangents go
    expect(Math.tan((lens.fov * Math.PI) / 360)).toBeCloseTo(Math.tan((60 * Math.PI) / 360) / 4, 9);
    expect(seenLens(CAMERA)).toEqual({ heading: 80, tilt: 2, fov: 60 });
  });

  it('keeps every lens a loupe on the frame shows as it was', () => {
    // no loupe, the whole frame, and a loupe magnifying a point of it: the same three answers as ever
    expect(seenLens({ ...CAMERA, loupe: { zoom: 1, x: 0.5, y: 0.5 } })).toEqual({ heading: 80, tilt: 2, fov: 60 });
    const off = { ...CAMERA, loupe: { zoom: 3, x: 0.7, y: 0.4 } };
    const middle = rayFor(off, 600, 400);
    expect(seenLens(off)).toEqual({ heading: middle.azimuth, tilt: middle.elevation, fov: (2 * Math.atan(Math.tan(Math.PI / 6) / 3) * 180) / Math.PI });
  });

  it('widens to the whole screen for a loupe let free past the frame', () => {
    const wide = seenLens({ ...CAMERA, loupe: { zoom: 0.5, x: 0.5, y: 0.5 } });
    expect(wide.heading).toBeCloseTo(80, 6);
    expect(wide.fov).toBeGreaterThan(60);
    const free = { ...CAMERA, loupe: { zoom: 1, x: 1.6, y: 0.5 } };
    const lens = seenLens(free);
    for (const x of [0, 1200]) {
      const edge = rayFor(free, x, 400).azimuth;
      expect(Math.abs(((edge - lens.heading + 540) % 360) - 180)).toBeLessThanOrEqual(lens.fov / 2 + 1e-6);
    }
    // the farther top or bottom of the screen is covered too
    const low = { ...CAMERA, loupe: { zoom: 1, x: 0.5, y: 2.2 } };
    const under = seenLens(low);
    const tall = (Math.atan((Math.tan((under.fov * Math.PI) / 360) * 800) / 1200) * 180) / Math.PI;
    expect(Math.abs(rayFor(low, 600, 800).elevation - under.tilt)).toBeLessThanOrEqual(tall + 1e-6);
  });

  it('narrows the vertical field it shows', () => {
    expect(verticalFov({ fov: 90, width: 1000, height: 1000, loupe: { zoom: 2, x: 0.5, y: 0.5 } })).toBeCloseTo(53.13, 2);
  });
});

describe('turning about a point', () => {
  const where = (camera, direction) => toScreen(camera, direction.azimuth, direction.elevation);

  it('keeps the point turned about where it is', () => {
    for (const camera of [CAMERA, { ...CAMERA, roll: -6, tilt: 12 }, { ...CAMERA, loupe: { zoom: 3, x: 0.7, y: 0.3 } }]) {
      const pivot = rayFor(camera, 900, 250);
      const turned = { ...camera, ...turnAbout(camera, 900, 250, 15) };
      const at = where(turned, pivot);
      expect(at.x).toBeCloseTo(900, 3);
      expect(at.y).toBeCloseTo(250, 3);
    }
  });

  it('turns the picture clockwise on screen for a positive angle', () => {
    const right = rayFor(CAMERA, 700, 400);
    const turned = { ...CAMERA, ...turnAbout(CAMERA, 600, 400, 10) };
    const at = where(turned, right);
    // a point right of the pivot goes down on a clockwise turn, by about the angle
    expect(at.y).toBeGreaterThan(400);
    expect(Math.atan2(at.y - 400, at.x - 600) * (180 / Math.PI)).toBeCloseTo(10, 0);
  });

  it('is a plain roll about the middle of the lens', () => {
    const turned = turnAbout(CAMERA, 600, 400, 10);
    expect(turned.heading).toBeCloseTo(80, 6);
    expect(turned.tilt).toBeCloseTo(2, 6);
    expect(Math.abs(turned.roll)).toBeCloseTo(10, 6);
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
