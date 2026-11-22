import { describe, expect, it } from 'vitest';
import { rayFor, toScreen } from './camera.js';
import { crossAt, dragLook, keepUnder, SEAM, splitFrames, throughCamera, traceRays, zoomedAbout } from './sideBySide.js';
import { looked } from './view.js';

const CAMERA = { heading: 80, tilt: 2, roll: 0, fov: 60, width: 1200, height: 800, projection: 'camera' };

describe('the two halves of Side by side', () => {
  it('fits the photo twice, one over the other, with the seam between', () => {
    const { frame, seam } = splitFrames(3 / 2, { width: 1000, height: 836 });
    // (836 - 36) / 2 = 400 tall, as wide as the photo's shape makes it
    expect(frame).toEqual({ width: 600, height: 400, left: 200, top: 0 });
    expect(seam).toEqual({ top: 400, height: SEAM });
  });

  it('centres the pair when the room is taller than two photos', () => {
    const { frame, seam } = splitFrames(2, { width: 400, height: 1000 });
    expect(frame.width).toBe(400);
    expect(frame.height).toBe(200);
    expect(frame.top).toBe(Math.round((1000 - (400 + SEAM)) / 2));
    expect(seam.top).toBe(frame.top + 200);
  });

  it('gives an empty frame to a room with no size yet', () => {
    expect(splitFrames(1.5, { width: 0, height: 0 }).frame.width).toBe(0);
  });
});

describe('turning and zooming the terrain on its own', () => {
  it('turns by the lens across the frame, as the view does', () => {
    // a frame's width of drag turns the lens's whole width
    expect(dragLook(CAMERA, -1200, 0).heading).toBeCloseTo(140, 9);
    expect(dragLook(CAMERA, 0, 0)).toEqual({ heading: 80, tilt: 2 });
    expect(dragLook(CAMERA, 0, 100).tilt).toBeGreaterThan(2);
  });

  it('turns slower through a loupe', () => {
    const near = { ...CAMERA, loupe: { zoom: 4, x: 0.5, y: 0.5 } };
    expect(dragLook(near, -1200, 0).heading).toBeCloseTo(95, 9);
  });

  it('keeps the ground under the pointer while zooming', () => {
    const at = { x: 900, y: 250 };
    const before = rayFor(CAMERA, at.x, at.y);
    const closer = zoomedAbout(CAMERA, 0.5, at);
    expect(closer.fov).toBeCloseTo(30, 9);
    const after = rayFor(closer, at.x, at.y);
    expect(after.azimuth).toBeCloseTo(before.azimuth, 2);
    expect(after.elevation).toBeCloseTo(before.elevation, 2);
  });

  it('holds the lens to the view’s own range', () => {
    expect(zoomedAbout(CAMERA, 100, { x: 600, y: 400 }).fov).toBe(150);
    expect(zoomedAbout(CAMERA, 0.0001, { x: 600, y: 400 }).fov).toBe(1);
  });

  it('brings a direction back under a pixel after the lens changed', () => {
    const at = { x: 200, y: 600 };
    const before = rayFor(CAMERA, at.x, at.y);
    const turned = { ...CAMERA, fov: 40, ...keepUnder({ ...CAMERA, fov: 40 }, before, at) };
    expect(rayFor(turned, at.x, at.y).azimuth).toBeCloseTo(before.azimuth, 2);
  });
});

describe('the lens rule the view and the terrain share', () => {
  it('takes the heading round and holds tilt, roll and width', () => {
    const next = looked(CAMERA, { heading: -30, tilt: 120, roll: 400, fov: 0.2 });
    expect(next).toMatchObject({ heading: 330, tilt: 89, roll: 180, fov: 1 });
  });

  it('lets a panorama turn all the way round', () => {
    expect(looked({ ...CAMERA, projection: 'panorama' }, { fov: 400 }).fov).toBe(360);
  });
});

describe('the trace on the terrain under the photo', () => {
  const strokes = [
    [
      { x: 500, y: 380 },
      { x: 600, y: 390 },
      { x: 700, y: 385 },
    ],
  ];

  it('lands where it was through the same camera', () => {
    const runs = throughCamera(traceRays(strokes, CAMERA), CAMERA);
    expect(runs).toHaveLength(1);
    expect(runs[0].of).toBe(0);
    runs[0].points.forEach((p, i) => {
      expect(p.x).toBeCloseTo(strokes[0][i].x, 6);
      expect(p.y).toBeCloseTo(strokes[0][i].y, 6);
    });
  });

  it('follows the ground when the terrain turned', () => {
    const turned = { ...CAMERA, heading: 90 };
    const [run] = throughCamera(traceRays(strokes, CAMERA), turned);
    const ray = rayFor(CAMERA, 600, 390);
    expect(run.points[1].x).toBeCloseTo(toScreen(turned, ray.azimuth, ray.elevation).x, 6);
    expect(run.points[1].x).toBeLessThan(600);
  });

  it('drops what lies behind the camera', () => {
    const behind = { ...CAMERA, heading: 260 };
    expect(throughCamera(traceRays(strokes, CAMERA), behind)).toEqual([]);
  });
});

describe('the line that runs down both halves', () => {
  it('stands at the direction under the pointer', () => {
    // read at the middle's height: a tilted lens leans its columns a hair
    const { azimuth } = rayFor(CAMERA, 300, 400);
    expect(crossAt(CAMERA, azimuth)).toBeCloseTo(300, 1);
  });

  it('is nowhere for a direction out of the frame', () => {
    expect(crossAt(CAMERA, 260)).toBeNull();
    expect(crossAt(CAMERA, null)).toBeNull();
    expect(crossAt({ ...CAMERA, width: 0 }, 80)).toBeNull();
  });
});
