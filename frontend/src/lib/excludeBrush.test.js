import { describe, expect, it } from 'vitest';
import {
  MAX_POINTS, MAX_STROKES, erase, excludeRequest, paint, pieceFrame, recrop, remapModel, strokePoint,
} from './excludeBrush.js';

// Where `engine/stitch.apply_warp` (OpenCV's rotation warpers) put a dot painted on a
// 480 × 270 picture, measured once from the server's own warp: the camera of each op
// turned another way. The op stores lengths in the picture's widths.
const OP = { focal: 0.9, aspect: 1, ppx: 0.5, ppy: 0.5, scale: 0.9, gain: 1 };
const MEASURED = [
  { warp: 'cylindrical', r: [1, 0, 0, 0, 1, 0, 0, 0, 1], size: [438, 270], pin: [0.8, 0.7], warped: [0.817542, 0.689198] },
  { warp: 'cylindrical', r: [0.825336, 0.084379, 0.558302, 0, 0.988771, -0.149438, -0.564642, 0.123337, 0.816068], size: [460, 276], pin: [0.8, 0.7], warped: [0.800483, 0.723229] },
  { warp: 'cylindrical', r: [0.62161, 0.155623, -0.767713, 0, 0.980067, 0.198669, 0.783327, -0.123495, 0.609219], size: [470, 281], pin: [0.8, 0.7], warped: [0.806383, 0.644128] },
  { warp: 'spherical', r: [1, 0, 0, 0, 1, 0, 0, 0, 1], size: [438, 262], pin: [0.8, 0.7], warped: [0.817352, 0.696565] },
  { warp: 'spherical', r: [0.825336, 0.084379, 0.558302, 0, 0.988771, -0.149438, -0.564642, 0.123337, 0.816068], size: [460, 262], pin: [0.8, 0.7], warped: [0.800378, 0.710422] },
  { warp: 'spherical', r: [0.62161, 0.155623, -0.767713, 0, 0.980067, 0.198669, 0.783327, -0.123495, 0.609219], size: [470, 261], pin: [0.5, 0.1], warped: [0.497872, 0.095785] },
];
const px = ([x, y], [w, h]) => [x * w, y * h];
const apart = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('the panorama remap, mirrored from the server', () => {
  it.each(MEASURED)('lands a point of the picture where the $warp warp put it, and carries it back', ({ warp, r, size, pin, warped }) => {
    const model = remapModel({ ...OP, warp, r }, ...size);
    expect(model).not.toBeNull();
    // within two pixels of OpenCV's either way, on a picture 480 wide
    expect(apart(px(model.toWarped(pin), size), px(warped, size))).toBeLessThan(2);
    expect(apart(px(model.toPinhole(warped), [480, 270]), px(pin, [480, 270]))).toBeLessThan(2);
    expect(model.ratio).toBeCloseTo(size[0] / 480, 2);
  });

  it('reads nothing it does not know', () => {
    expect(remapModel({ ...OP, warp: 'fisheye', r: MEASURED[0].r }, 400, 200)).toBeNull();
    expect(remapModel({ ...OP, warp: 'cylindrical', r: [1, 0, 0] }, 400, 200)).toBeNull();
    expect(remapModel({ ...OP, warp: 'cylindrical', r: MEASURED[0].r }, 0, 200)).toBeNull();
  });
});

describe('a piece\'s two pictures', () => {
  const piece = (ops, w = 438, h = 270) => ({ save: { path: 'media/a.png', time: null, ops }, w, h });

  it('are one while no remap reshapes it, its crop included', () => {
    const frame = pieceFrame(piece([{ op: 'crop', params: { x: 0.1, y: 0, w: 0.5, h: 1 } }, { op: 'contrast', params: { amount: 1.2 } }]));
    expect(frame.ratio).toBe(1);
    expect(frame.toStitch([0.3, 0.4])).toEqual([0.3, 0.4]);
  });

  it('go through the remap of a panorama stitch, and a crop made after it', () => {
    const remap = { op: 'remap', params: { ...OP, warp: 'cylindrical', r: MEASURED[0].r } };
    const plain = pieceFrame(piece([remap]));
    expect(apart(plain.toShown([0.8, 0.7]), MEASURED[0].warped)).toBeLessThan(0.005);
    expect(apart(plain.toStitch(plain.toShown([0.3, 0.6])), [0.3, 0.6])).toBeLessThan(1e-6);

    // the right half of the warped picture kept: the stitched picture is cut the same way
    const half = { op: 'crop', params: { x: 0.5, y: 0, w: 0.5, h: 1 } };
    const cropped = pieceFrame(piece([remap, half], 219, 270));
    const shown = cropped.toShown([0.6, 0.7]);
    expect(apart(cropped.toStitch(shown), [0.6, 0.7])).toBeLessThan(1e-6);
    expect(cropped.ratio).toBeCloseTo(plain.ratio, 3);
  });
});

describe('painting', () => {
  it('keeps a point on the picture, the edge for a brush hanging over it', () => {
    expect(strokePoint([0.5, 0.25], 0.1)).toEqual([0.5, 0.25]);
    expect(strokePoint([1.04, 0.5], 0.05)).toEqual([1, 0.5]);
    expect(strokePoint([1.2, 0.5], 0.05)).toBeNull();
    expect(strokePoint(null, 0.05)).toBeNull();
    expect(strokePoint([0.123456, 0.5], 0.05)).toEqual([0.1235, 0.5]);
  });

  it('adds a point a third of the brush on, begins a stroke when asked, and carries a full one on', () => {
    let strokes = paint([], [0.1, 0.1], 0.09, { start: true });
    expect(strokes).toEqual([{ points: [[0.1, 0.1]], radius: 0.09 }]);
    expect(paint(strokes, [0.11, 0.1], 0.09)).toBeNull();
    strokes = paint(strokes, [0.2, 0.1], 0.09);
    expect(strokes[0].points).toHaveLength(2);
    expect(paint(strokes, [0.5, 0.5], 0.09, { start: true })).toHaveLength(2);

    const full = [{ points: Array.from({ length: MAX_POINTS }, (_, i) => [i / MAX_POINTS, 0]), radius: 0.001 }];
    const on = paint(full, [1, 0.5], 0.001);
    expect(on).toHaveLength(2);
    expect(on[1].points[0]).toEqual(full[0].points.at(-1));

    const many = Array.from({ length: MAX_STROKES }, () => ({ points: [[0, 0]], radius: 0.1 }));
    expect(paint(many, [0.5, 0.5], 0.1, { start: true })).toBeNull();
  });

  it('erases what lies under it, cutting a stroke in two', () => {
    const line = [{ points: [[0, 0.5], [0.25, 0.5], [0.5, 0.5], [0.75, 0.5], [1, 0.5]], radius: 0.02 }];
    expect(erase(line, [0.5, 0.5], 0.05)).toEqual([
      { points: [[0, 0.5], [0.25, 0.5]], radius: 0.02 },
      { points: [[0.75, 0.5], [1, 0.5]], radius: 0.02 },
    ]);
    expect(erase(line, [0.5, 0.9], 0.05)).toBeNull();
    // round on a wide picture: a point a tenth of its height away is further than it looks in 0–1
    expect(erase(line, [0.5, 0.45], 0.04, 1)).not.toBeNull();
    expect(erase(line, [0.5, 0.45], 0.04, 2)).toBeNull();
  });

  it('stays where it was on the picture when the piece is cropped again', () => {
    const strokes = [{ points: [[0.5, 0.5], [0.9, 0.5]], radius: 0.1 }];
    // the left half kept: a point at its middle is at its right edge now, one past it is gone
    expect(recrop(strokes, null, { x: 0, y: 0, w: 0.5, h: 1 })).toEqual([{ points: [[1, 0.5]], radius: 0.2 }]);
    expect(recrop(strokes, { x: 0, y: 0, w: 0.5, h: 1 }, null)).toEqual([{ points: [[0.25, 0.5], [0.45, 0.5]], radius: 0.05 }]);
    expect(recrop([{ points: [[0.9, 0.9]], radius: 0.1 }], null, { x: 0, y: 0, w: 0.5, h: 0.5 })).toEqual([]);
  });

  it('sends a stroke list a piece, and nothing when no piece has one', () => {
    const strokes = [{ points: [[0.5, 0.5]], radius: 0.1 }];
    expect(excludeRequest([{}, { exclude: [] }])).toBeNull();
    expect(excludeRequest([{}, { exclude: strokes }, { exclude: [] }])).toEqual([null, strokes, null]);
  });
});
