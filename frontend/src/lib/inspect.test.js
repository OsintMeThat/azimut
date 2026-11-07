import { describe, it, expect } from 'vitest';
import {
  clampCrop, moveCrop, resizeCropByHandle,
  QUAD_SIDES, quadEdgeMidpoints, quadCentroid,
  quadsBounds, translateQuad, moveQuads, rotateQuads, scaleQuads, pinholeOps,
  buildFrameOps, hasVideoEdits, normalizeRightAngleRotation, rotationOps,
  sourceStem, timecode, frameSaveName, frameSaveNames, saveNameOf,
  newCollage, clampCollageDim, stitchCanvas, COLLAGE_MIN_DIM, COLLAGE_MAX_DIM,
  exportFrame, cutBounds, COLLAGE_MAX_EXPORT_PIXELS, clockTime, collageVideo, mediaOrigin, quadUnitAt, quadMapUnit, fitView,
  COLLAGE_DEFAULT_SIZE, ADJUST_ORDER, ADJUST_PRESETS, activePreset, buildOps, needsRender,
  presetValues, previewOps, previewStyle, sliderTravel,
} from './inspect.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

describe('video orientation', () => {
  const filters = [{ id: 'brightness', params: [{ name: 'amount', default: 1 }] }];

  it('accepts only the supported right-angle orientations', () => {
    expect([-180, -90, 0, 90, 180].map(normalizeRightAngleRotation)).toEqual([-180, -90, 0, 90, 180]);
    expect(normalizeRightAngleRotation(45)).toBe(0);
    expect(normalizeRightAngleRotation('bad')).toBe(0);
  });

  it('makes a rotation-only video saveable', () => {
    expect(hasVideoEdits(filters, { brightness: 1 }, 90)).toBe(true);
    expect(hasVideoEdits(filters, { brightness: 1 }, 0)).toBe(false);
    expect(hasVideoEdits(filters, { brightness: 1.2 }, 0)).toBe(true);
  });

  it('carries the video orientation into captured-frame recipes', () => {
    const frame = {
      sourceOps: rotationOps(-90),
      rotation: 180,
      adjust: { brightness: 1.2 },
      crop: null,
    };
    expect(buildFrameOps(filters, frame)).toEqual([
      { op: 'rotate', params: { angle: -90 } },
      { op: 'rotate', params: { angle: 180 } },
      { op: 'brightness', params: { amount: 1.2 } },
    ]);
  });
});

describe('pinholeOps', () => {
  const remap = { op: 'remap', params: { warp: 'cylindrical' } };
  const bright = { op: 'brightness', params: { amount: 1.2 } };

  it('leaves a piece that was never stitched alone', () => {
    expect(pinholeOps({ ops: [bright] })).toEqual([bright]);
  });
  it('drops a solved warp so a re-stitch never compounds two projections', () => {
    expect(pinholeOps({ ops: [bright, remap] })).toEqual([bright]);
  });
  it('drops every warp, however many stitches a piece has been through', () => {
    expect(pinholeOps({ ops: [remap, bright, remap] })).toEqual([bright]);
  });
  it('handles a recipe with no ops at all', () => {
    expect(pinholeOps({})).toEqual([]);
    expect(pinholeOps(null)).toEqual([]);
  });
});

describe('clampCrop', () => {
  it('keeps a valid crop untouched', () => {
    expect(clampCrop({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 })).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 });
  });
  it('clamps size and pushes the box back inside the image', () => {
    const c = clampCrop({ x: 0.8, y: 0.9, w: 0.5, h: 0.4 });
    expect(c.x + c.w).toBeLessThanOrEqual(1 + 1e-9);
    expect(c.y + c.h).toBeLessThanOrEqual(1 + 1e-9);
  });
  it('enforces a minimum size', () => {
    expect(clampCrop({ x: 0, y: 0, w: 0.001, h: 0.001 }, 0.02)).toMatchObject({ w: 0.02, h: 0.02 });
  });
});

describe('moveCrop', () => {
  it('translates within bounds', () => {
    const c = moveCrop({ x: 0.2, y: 0.2, w: 0.3, h: 0.3 }, 0.1, -0.1);
    expect(near(c.x, 0.3)).toBe(true);
    expect(near(c.y, 0.1)).toBe(true);
    expect(c.w).toBe(0.3);
    expect(c.h).toBe(0.3);
  });
  it('stops the box at the image edge instead of overflowing', () => {
    const c = moveCrop({ x: 0.6, y: 0.6, w: 0.3, h: 0.3 }, 0.5, 0.5);
    expect(near(c.x, 0.7)).toBe(true);
    expect(near(c.y, 0.7)).toBe(true);
  });
});

describe('resizeCropByHandle', () => {
  const base = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 }; // corners at 0.2 and 0.6

  it('drags the SE corner, keeping the NW corner fixed', () => {
    const c = resizeCropByHandle(base, 'se', 0.8, 0.9);
    expect(c.x).toBe(0.2);
    expect(c.y).toBe(0.2);
    expect(near(c.w, 0.6)).toBe(true);
    expect(near(c.h, 0.7)).toBe(true);
  });

  it('drags the N edge, moving only the top', () => {
    const c = resizeCropByHandle(base, 'n', 0.5, 0.1);
    expect(near(c.y, 0.1)).toBe(true);
    expect(near(c.h, 0.5)).toBe(true);
    expect(c.x).toBe(0.2);
    expect(near(c.w, 0.4)).toBe(true);
  });

  it('drags the W edge, moving only the left', () => {
    const c = resizeCropByHandle(base, 'w', 0.35, 0.5);
    expect(near(c.x, 0.35)).toBe(true);
    expect(near(c.w, 0.25)).toBe(true);
  });

  it('never lets an edge cross past the opposite one', () => {
    const c = resizeCropByHandle(base, 'e', 0.0, 0.5, null, 0.05);
    expect(c.w).toBeGreaterThanOrEqual(0.05 - 1e-9);
    expect(c.x).toBe(0.2);
  });

  it('keeps the aspect ratio on a corner drag', () => {
    // fracAspect 2 → width twice the height
    const c = resizeCropByHandle(base, 'se', 0.8, 0.65, 2);
    expect(near(c.w / c.h, 2)).toBe(true);
    expect(c.x).toBe(0.2);
    expect(c.y).toBe(0.2);
  });

  it('keeps aspect on a vertical edge by growing height about the centre', () => {
    const c = resizeCropByHandle(base, 'e', 0.7, 0.5, 1); // square lock
    // width becomes 0.5, height follows to 0.5, recentred on old centre (0.4)
    expect(near(c.w, c.h)).toBe(true);
    expect(near(c.y + c.h / 2, 0.4, 1e-6)).toBe(true);
  });
});

describe('quad side handles', () => {
  const rect = [[0, 0], [100, 0], [100, 80], [0, 80]]; // TL,TR,BR,BL

  it('exposes an edge midpoint per side', () => {
    expect(QUAD_SIDES.length).toBe(4);
    const mids = quadEdgeMidpoints(rect);
    expect(mids[0]).toMatchObject({ side: 0, x: 50, y: 0 }); // top
    expect(mids[2]).toMatchObject({ side: 2, x: 50, y: 80 }); // bottom
  });
});

// ---------------------------------------------------------------------------
// Multi-select group transforms: the block moves/turns/grows as one rigid unit
// about a shared pivot, so an off-centre piece is carried around the block's
// centre rather than spinning about its own.
// ---------------------------------------------------------------------------

// two 10x10 squares side by side: group box 0..30 x 0..10, centre [15, 5]
const sqA = [[0, 0], [10, 0], [10, 10], [0, 10]];
const sqB = [[20, 0], [30, 0], [30, 10], [20, 10]];

describe('quadsBounds', () => {
  it('spans every quad of the group and centres between them', () => {
    expect(quadsBounds([sqA, sqB])).toMatchObject({
      minX: 0, minY: 0, maxX: 30, maxY: 10, width: 30, height: 10, center: [15, 5],
    });
  });

  it('is the quad itself for a single-piece selection', () => {
    expect(quadsBounds([sqA])).toMatchObject({ minX: 0, maxX: 10, center: [5, 5] });
  });

  it('covers a rotated/warped quad by its extreme corners', () => {
    const warped = [[10, 5], [110, 0], [120, 90], [0, 85]];
    expect(quadsBounds([warped])).toMatchObject({ minX: 0, minY: 0, maxX: 120, maxY: 90 });
  });

  it('returns null for an empty selection', () => {
    expect(quadsBounds([])).toBe(null);
  });
});

describe('translateQuad + moveQuads', () => {
  it('shifts a single quad by the delta', () => {
    expect(translateQuad(sqA, 5, -3)).toEqual([[5, -3], [15, -3], [15, 7], [5, 7]]);
  });

  it('shifts every quad of the group by the same delta (block keeps its shape)', () => {
    const [a, b] = moveQuads([sqA, sqB], 100, 50);
    expect(a).toEqual([[100, 50], [110, 50], [110, 60], [100, 60]]);
    expect(b).toEqual([[120, 50], [130, 50], [130, 60], [120, 60]]);
    // the gap between the two pieces is untouched
    expect(quadsBounds([a, b]).width).toBe(quadsBounds([sqA, sqB]).width);
  });

  it('does not mutate the input quads', () => {
    moveQuads([sqA], 10, 10);
    expect(sqA).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]);
  });
});

describe('rotateQuads — the block turns as one', () => {
  it('half-turns the group about its centre, swapping the two pieces over', () => {
    const [a, b] = rotateQuads([sqA, sqB], Math.PI);
    // A lands on B's box and vice versa — proof the pivot is the *group* centre
    expect(quadsBounds([a]).minX).toBeCloseTo(20);
    expect(quadsBounds([a]).maxX).toBeCloseTo(30);
    expect(quadsBounds([b]).minX).toBeCloseTo(0);
    expect(quadsBounds([b]).maxX).toBeCloseTo(10);
  });

  it('carries an off-centre piece around instead of spinning it in place', () => {
    const [a] = rotateQuads([sqA, sqB], Math.PI / 2);
    // a per-piece rotation would have left A's centroid at (5, 5)
    expect(quadCentroid(a)).not.toEqual([5, 5]);
  });

  it('is rigid — the distance between the pieces is preserved', () => {
    const d0 = Math.hypot(...quadCentroid(sqA).map((v, i) => v - quadCentroid(sqB)[i]));
    const [a, b] = rotateQuads([sqA, sqB], 0.7);
    const d1 = Math.hypot(...quadCentroid(a).map((v, i) => v - quadCentroid(b)[i]));
    expect(d1).toBeCloseTo(d0);
  });

  it('leaves the group centre fixed', () => {
    const out = rotateQuads([sqA, sqB], 0.4);
    const c = quadsBounds(out).center;
    expect(c[0]).toBeCloseTo(15);
    expect(c[1]).toBeCloseTo(5);
  });

  it('rotating out and back returns to the start', () => {
    const out = rotateQuads(rotateQuads([sqA, sqB], 0.9, [15, 5]), -0.9, [15, 5]);
    expect(out[0][0][0]).toBeCloseTo(0);
    expect(out[0][0][1]).toBeCloseTo(0);
    expect(out[1][2][0]).toBeCloseTo(30);
  });

  it('honours an explicit pivot over the group centre', () => {
    const [a] = rotateQuads([sqA], Math.PI, [0, 0]); // pivot at A's own corner
    const b = quadsBounds([a]);
    expect(b.minX).toBeCloseTo(-10);
    expect(b.minY).toBeCloseTo(-10);
    expect(b.maxX).toBeCloseTo(0);
    expect(b.maxY).toBeCloseTo(0);
  });

  it('returns an empty array for an empty selection', () => {
    expect(rotateQuads([], 1)).toEqual([]);
  });
});

describe('scaleQuads — the block grows as one', () => {
  it('scales the whole group box about its centre', () => {
    const out = scaleQuads([sqA, sqB], 2);
    const b = quadsBounds(out);
    expect(b.width).toBeCloseTo(60); // 2x the original 30
    expect(b.center[0]).toBeCloseTo(15); // centre pinned
    expect(b.center[1]).toBeCloseTo(5);
  });

  it('pushes the pieces apart, not just enlarges each in place', () => {
    const [a, b] = scaleQuads([sqA, sqB], 2);
    const gap = quadsBounds([b]).minX - quadsBounds([a]).maxX;
    const gap0 = sqB[0][0] - sqA[1][0]; // 10
    expect(gap).toBeCloseTo(gap0 * 2);
  });

  it('shrinking then growing back returns to the start', () => {
    const out = scaleQuads(scaleQuads([sqA, sqB], 0.25, [15, 5]), 4, [15, 5]);
    expect(out[0][0][0]).toBeCloseTo(0);
    expect(out[1][2][0]).toBeCloseTo(30);
  });

  it('returns an empty array for an empty selection', () => {
    expect(scaleQuads([], 2)).toEqual([]);
  });
});


describe('sourceStem', () => {
  it('prefers the title, then the filename, then the path', () => {
    expect(sourceStem({ title: 'Hangar clip', filename: 'dsc_1.mp4' })).toBe('Hangar clip');
    expect(sourceStem({ filename: 'dsc_1.mp4', path: 'media/dsc_1.mp4' })).toBe('dsc_1');
    expect(sourceStem({ path: 'media/sub/roof.png' })).toBe('roof');
  });

  it('reads the title the analyst gave a download, not what the site called the file', () => {
    expect(sourceStem({ title: 'Convoy dashcam', filename: 'convoy_dashcam_20240612-181455.mp4' }))
      .toBe('Convoy dashcam');
  });

  it('takes a title whole, since free text has no extension to strip', () => {
    expect(sourceStem({ title: 'Convoy no. 3', filename: 'x.mp4' })).toBe('Convoy no. 3');
  });

  it('ignores a blank title rather than naming the frame Capture', () => {
    expect(sourceStem({ title: '   ', filename: 'dsc_1.mp4' })).toBe('dsc_1');
  });

  it('strips only the extension, keeping dots inside the name', () => {
    expect(sourceStem({ filename: 'v1.2 roof.png' })).toBe('v1.2 roof');
  });

  it('falls back to Capture when there is nothing to read', () => {
    expect(sourceStem(null)).toBe('Capture');
    expect(sourceStem({})).toBe('Capture');
  });

  it('reads Windows paths too', () => {
    expect(sourceStem({ path: 'media\\sub\\roof.png' })).toBe('roof');
  });
});

describe('timecode', () => {
  it('formats seconds as hh-mm-ss', () => {
    expect(timecode(0)).toBe('00-00-00');
    expect(timecode(750)).toBe('00-12-30');
    expect(timecode(3725)).toBe('01-02-05');
  });

  it('rounds and floors at zero rather than producing a negative name', () => {
    expect(timecode(12.6)).toBe('00-00-13');
    expect(timecode(-5)).toBe('00-00-00');
    expect(timecode(undefined)).toBe('00-00-00');
  });
});

describe('frameSaveName', () => {
  it('leads with the timecode so a folder of frames sorts in playback order', () => {
    expect(frameSaveName('roof', 19)).toBe('00-00-19 roof');
    expect(frameSaveName('roof', 3725)).toBe('01-02-05 roof');
  });

  it('sorts a video in playback order rather than by however the frames were taken', () => {
    const taken = [90, 12, 3600];
    const names = taken.map((t) => frameSaveName('roof', t));
    expect([...names].sort()).toEqual(['00-00-12 roof', '00-01-30 roof', '01-00-00 roof']);
  });

  it('keeps the source name up front for an edited still, which has no timecode', () => {
    expect(frameSaveName('roof', null)).toBe('roof (edited)');
    expect(frameSaveName('roof', undefined)).toBe('roof (edited)');
  });

  it('names the first frame of a video rather than dropping a zero timecode', () => {
    expect(frameSaveName('roof', 0)).toBe('00-00-00 roof');
  });
});

describe('frameSaveNames', () => {
  const names = (frames) => frameSaveNames(frames);

  it('names by the second while no two frames share one', () => {
    expect(names([{ stem: 'roof', time: 12 }, { stem: 'roof', time: 90 }]))
      .toEqual(['00-00-12 roof', '00-01-30 roof']);
  });

  it('numbers the frames that would collide, and only those', () => {
    expect(names([
      { stem: 'Convoy dashcam', time: 0 },
      { stem: 'Convoy dashcam', time: 1.1 },
      { stem: 'Convoy dashcam', time: 1.4 },
      { stem: 'Convoy dashcam', time: 21 },
    ])).toEqual([
      '00-00-00 Convoy dashcam',
      '00-00-01 Convoy dashcam 1',
      '00-00-01 Convoy dashcam 2',
      '00-00-21 Convoy dashcam',
    ]);
  });

  it('numbers a shared second in playback order, not tray order', () => {
    expect(names([{ stem: 'roof', time: 19.4 }, { stem: 'roof', time: 19.1 }]))
      .toEqual(['00-00-19 roof 2', '00-00-19 roof 1']);
  });

  it('keeps a name sort walking the video forward', () => {
    const out = names([
      { stem: 'roof', time: 19.4 },
      { stem: 'roof', time: 12 },
      { stem: 'roof', time: 19.1 },
    ]);
    expect([...out].sort()).toEqual(['00-00-12 roof', '00-00-19 roof 1', '00-00-19 roof 2']);
  });

  it('reads the same second across two sources as two different names', () => {
    expect(names([{ stem: 'roof', time: 19.1 }, { stem: 'street', time: 19.4 }]))
      .toEqual(['00-00-19 roof', '00-00-19 street']);
  });

  it('numbers two edits of one still, which carry no timecode at all', () => {
    expect(names([{ stem: 'roof', time: null }, { stem: 'roof', time: null }]))
      .toEqual(['roof (edited) 1', 'roof (edited) 2']);
  });

  it('numbers frames that sit in the same thousandth rather than naming both alike', () => {
    const out = names([{ stem: 'roof', time: 19.001 }, { stem: 'roof', time: 19.004 }]);
    expect(out).toEqual(['00-00-19 roof 1', '00-00-19 roof 2']);
    expect(new Set(out).size).toBe(2);
  });

  it('holds a tray of one frame to the plain second', () => {
    expect(names([{ stem: 'roof', time: 19.4 }])).toEqual(['00-00-19 roof']);
  });
});

describe('saveNameOf', () => {
  const item = { key: 'a', defaultName: '00-01-00 roof' };

  it('files under what stands in the field', () => {
    expect(saveNameOf(item, 'Front door')).toBe('Front door');
  });

  it('trims what the user typed', () => {
    expect(saveNameOf(item, '  Front door  ')).toBe('Front door');
  });

  it('falls back to the default rather than filing something nameless', () => {
    expect(saveNameOf(item, '   ')).toBe('00-01-00 roof');
    expect(saveNameOf(item, '')).toBe('00-01-00 roof');
    expect(saveNameOf(item)).toBe('00-01-00 roof');
  });
});

describe('newCollage', () => {
  it('starts every collage the same way, whoever creates it', () => {
    const a = newCollage('Collage 1');
    expect(a.name).toBe('Collage 1');
    expect([a.width, a.height]).toEqual([COLLAGE_DEFAULT_SIZE.width, COLLAGE_DEFAULT_SIZE.height]);
    expect(a.nodes).toEqual([]);
    expect(a.transparent).toBe(true);
  });

  it('gives each one its own id and its own node list', () => {
    const a = newCollage('Collage 1');
    const b = newCollage('Collage 2');
    a.nodes.push({});
    expect(a.id).not.toBe(b.id);
    expect(b.nodes).toEqual([]);
  });
});

describe('clampCollageDim', () => {
  it('keeps a side the compose route accepts', () => {
    expect(clampCollageDim(4000, 800)).toBe(4000);
    expect(clampCollageDim(COLLAGE_MAX_DIM, 800)).toBe(COLLAGE_MAX_DIM);
  });

  it('holds a number typed past either bound', () => {
    expect(clampCollageDim(99999, 800)).toBe(COLLAGE_MAX_DIM);
    expect(clampCollageDim(0, 800)).toBe(COLLAGE_MIN_DIM);
    expect(clampCollageDim(-40, 800)).toBe(COLLAGE_MIN_DIM);
  });

  it('rounds a fractional one rather than sizing a canvas in half pixels', () => {
    expect(clampCollageDim('1600.6', 800)).toBe(1601);
  });

  it('falls back to the size in place when the field says nothing', () => {
    expect(clampCollageDim('', 800)).toBe(800);
    expect(clampCollageDim('wide', 800)).toBe(800);
    expect(clampCollageDim(null, 800)).toBe(800);
  });
});

describe('stitchCanvas', () => {
  const current = { width: 1600, height: 800 };

  it('takes the canvas the solver asked for', () => {
    expect(stitchCanvas({ width: 4800, height: 2400 }, current))
      .toEqual({ width: 4800, height: 2400, scale: 3 });
  });

  it('scales an unplaced piece by the smaller ratio, so it keeps its shape', () => {
    const { scale } = stitchCanvas({ width: 6400, height: 1600 }, current);
    expect(scale).toBe(2); // 4x wider, 2x taller — the piece grows twice
  });

  it('holds the answer inside the bounds compose accepts', () => {
    const { width, height } = stitchCanvas({ width: 20000, height: 90000 }, current);
    expect(width).toBe(COLLAGE_MAX_DIM);
    expect(height).toBe(COLLAGE_MAX_DIM);
  });

  it('leaves the canvas alone when the answer says nothing about it', () => {
    expect(stitchCanvas(undefined, current)).toEqual({ ...current, scale: 1 });
    expect(stitchCanvas({}, current)).toEqual({ ...current, scale: 1 });
  });
});

describe('collageVideo', () => {
  const piece = (path, time = null) => ({ save: { path, time, ops: [] } });

  it('names the one video every piece is cut from, and the stretch they span', () => {
    const nodes = [piece('media/pan.mp4', 3.6), piece('media/pan.mp4', 1.2), piece('media/pan.mp4', 2.4)];
    expect(collageVideo(nodes)).toEqual({ path: 'media/pan.mp4', from: 1.2, to: 3.6, times: [1.2, 2.4, 3.6] });
  });

  it('reads a single piece as one instant', () => {
    expect(collageVideo([piece('media/pan.mp4', 0)])).toMatchObject({ path: 'media/pan.mp4', from: 0, to: 0 });
  });

  it('reads a frame saved from the video back to it', () => {
    const cutFrom = (path) => (path === 'media/00-00-05 pan.png' ? { video: 'media/pan.mp4', time: 5 } : null);
    expect(collageVideo([piece('media/pan.mp4', 1), piece('media/00-00-05 pan.png')], cutFrom))
      .toEqual({ path: 'media/pan.mp4', from: 1, to: 5, times: [1, 5] });
  });

  it('follows a picture composed from the video\'s frames, as a straightened collage is, back to them', () => {
    const origins = {
      'media/00-00-05 pan.png': { video: 'media/pan.mp4', time: 5 },
      'media/Pan straightened.png': { pieces: [{ path: 'media/pan.mp4', time: 1 }, { path: 'media/00-00-05 pan.png', time: null }] },
      'media/Mixed.png': { pieces: [{ path: 'media/pan.mp4', time: 1 }, { path: 'media/roof.png', time: null }] },
      'media/Loop.png': { pieces: [{ path: 'media/Loop.png', time: null }] },
    };
    const origin = (path) => origins[path] ?? null;
    expect(collageVideo([piece('media/Pan straightened.png')], origin)).toEqual({ path: 'media/pan.mp4', from: 1, to: 5, times: [1, 5] });
    expect(collageVideo([piece('media/Pan straightened.png'), piece('media/pan.mp4', 3)], origin).times).toEqual([1, 3, 5]);
    // a picture of its own inside, another video beside, or a picture made of itself
    expect(collageVideo([piece('media/Mixed.png')], origin)).toBeNull();
    expect(collageVideo([piece('media/Pan straightened.png'), piece('media/other.mp4', 2)], origin)).toBeNull();
    expect(collageVideo([piece('media/Loop.png')], origin)).toBeNull();
  });

  it('says nothing of a collage with a picture of its own, another file or no piece', () => {
    expect(collageVideo([piece('media/pan.mp4', 1), piece('media/roof.png')])).toBeNull();
    expect(collageVideo([piece('media/pan.mp4', 1), piece('media/other.mp4', 2)])).toBeNull();
    expect(collageVideo([])).toBeNull();
    expect(collageVideo(undefined)).toBeNull();
  });
});

describe('mediaOrigin', () => {
  it('reads a frame back to its video and a composed picture back to its pieces', () => {
    expect(mediaOrigin({ source: { type: 'inspect', op: 'frame', from: 'media/pan.mp4', time: 5 } })).toEqual({ video: 'media/pan.mp4', time: 5 });
    expect(mediaOrigin({ source: { type: 'inspect', op: 'collage', sources: ['media/pan.mp4', 'media/a.png'], times: [2, null], straightened: true } }))
      .toEqual({ pieces: [{ path: 'media/pan.mp4', time: 2 }, { path: 'media/a.png', time: null }] });
  });

  it('reads nothing else', () => {
    expect(mediaOrigin({ source: { type: 'inspect', op: 'collage', sources: ['media/a.png'], times: [] } })).toBeNull();
    expect(mediaOrigin({ source: { type: 'download', op: 'frame', from: 'x', time: 1 } })).toBeNull();
    expect(mediaOrigin({})).toBeNull();
  });
});

describe('quadUnitAt', () => {
  it('finds a canvas point in a warped piece\'s own square, the inverse of quadMapUnit', () => {
    const quad = [[10, 20], [210, 5], [230, 160], [0, 140]];
    for (const unit of [[0, 0], [1, 1], [0.25, 0.75], [0.6, 0.1], [1.2, -0.1]]) {
      const [[x, y]] = quadMapUnit(quad, [unit]);
      const back = quadUnitAt(quad, [x, y]);
      expect(near(back[0], unit[0], 1e-9) && near(back[1], unit[1], 1e-9)).toBe(true);
    }
  });
});

describe('fitView', () => {
  const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const pane = { width: 1000, height: 500 };
  const canvas = { width: 2000, height: 1000 }; // fitted at half scale

  it('frames the pieces whole, centred, a margin from the edges', () => {
    const view = fitView([rect(100, 100, 400, 100), rect(500, 150, 300, 100)], pane, canvas, 20);
    // 700 × 150 canvas pixels into 960 × 460: the width rules, at 960 / 700
    const scale = 0.5 * view.zoom;
    expect(scale).toBeCloseTo(960 / 700);
    expect(100 * scale + view.x).toBeCloseTo(20);
    expect(100 * scale + view.y + (150 * scale) / 2).toBeCloseTo(250);
  });

  it('stays within the view\'s zoom, and fits the canvas with nothing to frame', () => {
    expect(fitView([rect(0, 0, 2, 2)], pane, canvas).zoom).toBe(8);
    expect(fitView([rect(-20000, 0, 40000, 10)], pane, canvas).zoom).toBe(0.2);
    expect(fitView([], pane, canvas)).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(fitView([rect(0, 0, 5, 5)], { width: 0, height: 0 }, canvas)).toEqual({ zoom: 1, x: 0, y: 0 });
  });
});

describe('exportFrame', () => {
  const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

  it('brings a piece placed small back to its own pixels', () => {
    // a 1920×1080 frame shown at 800×450 on the canvas
    const frame = exportFrame([{ w: 1920, h: 1080, quad: rect(100, 50, 800, 450) }]);
    expect(frame).toMatchObject({ minX: 100, minY: 50, scale: 2.4, width: 1920, height: 1080, capped: false });
  });

  it('follows the sharpest piece, and never shrinks one placed larger than it is', () => {
    const frame = exportFrame([
      { w: 400, h: 300, quad: rect(0, 0, 800, 600) }, // blown up: would take 0.5
      { w: 1200, h: 900, quad: rect(800, 0, 400, 300) }, // shown at a third
    ]);
    expect(frame.scale).toBe(3);
    expect(frame.width).toBe(3600);
  });

  it('reads a turned piece by its sides, not by its bounding box', () => {
    const c = Math.SQRT1_2 * 100;
    const turned = [[c, 0], [2 * c, c], [c, 2 * c], [0, c]]; // a 100×100 square turned 45°
    expect(exportFrame([{ w: 200, h: 200, quad: turned }]).scale).toBeCloseTo(2);
  });

  it('holds a wide panorama inside the side limit and says the limit set it', () => {
    const frame = exportFrame([{ w: 20000, h: 2000, quad: rect(0, 0, 2000, 200) }]);
    expect(frame.width).toBe(COLLAGE_MAX_DIM);
    expect(frame.capped).toBe(true);
  });

  it('holds a large square inside the pixel budget', () => {
    const frame = exportFrame([{ w: 9000, h: 9000, quad: rect(0, 0, 1000, 1000) }]);
    expect(frame.width * frame.height).toBeLessThanOrEqual(COLLAGE_MAX_EXPORT_PIXELS + 2 * frame.width);
    expect(frame.capped).toBe(true);
  });

  it('shrinks a layout already past what compose accepts', () => {
    const frame = exportFrame([{ w: 100, h: 100, quad: rect(0, 0, 10000, 500) }]);
    expect(frame.width).toBe(COLLAGE_MAX_DIM);
    expect(frame.scale).toBeLessThan(1);
  });

  it('keeps what lies in a cut, at the same sharpness, and nothing when the cut holds no piece', () => {
    const pieces = [{ w: 1920, h: 1080, quad: rect(100, 50, 800, 450) }];
    // the ground cut off and the frame running past the left: the picture is the pieces within it
    const frame = exportFrame(pieces, { x: 0, y: 0, w: 600, h: 350 });
    expect(frame).toMatchObject({ minX: 100, minY: 50, scale: 2.4, width: 1200, height: 720 });
    expect(exportFrame(pieces, { x: 1000, y: 0, w: 50, h: 50 })).toBeNull();
    expect(cutBounds(pieces, { x: 0, y: 0, w: 600, h: 350 })).toEqual({ minX: 100, minY: 50, width: 500, height: 300 });
  });

  it('lifts the cap a cut makes room for', () => {
    const wide = [{ w: 20000, h: 2000, quad: rect(0, 0, 2000, 200) }];
    expect(exportFrame(wide).capped).toBe(true);
    expect(exportFrame(wide, { x: 0, y: 0, w: 500, h: 200 })).toMatchObject({ width: 5000, scale: 10, capped: false });
  });
});

describe('clockTime', () => {
  it('reads as a player shows it', () => {
    expect(clockTime(64.5)).toBe('1:04.5');
    expect(clockTime(0)).toBe('0:00.0');
    expect(clockTime(-3)).toBe('0:00.0');
  });
});

describe('adjusting a frame', () => {
  const FILTERS = [
    { id: 'brightness', params: [{ name: 'amount', default: 1 }], css: 'brightness({v})' },
    { id: 'contrast', params: [{ name: 'amount', default: 1 }], css: 'contrast({v})' },
    { id: 'sharpness', params: [{ name: 'amount', default: 1 }] },
    { id: 'clahe', params: [{ name: 'amount', default: 0 }] },
    { id: 'grayscale', params: [{ name: 'on', type: 'toggle', default: 0 }], css: 'grayscale({v})' },
    { id: 'channel', params: [{ name: 'pick', type: 'choice', default: 0, options: [] }] },
  ];
  const neutral = { brightness: 1, contrast: 1, sharpness: 1, clahe: 0, grayscale: 0, channel: 0 };

  it('keeps the filters that came first in their order, so a filed frame stays filed', () => {
    const before = ['brightness', 'contrast', 'saturation', 'gamma', 'sharpness', 'rotate', 'grayscale', 'invert'];
    expect(ADJUST_ORDER.filter((id) => before.includes(id))).toEqual(before);
    for (const id of ['denoise', 'autolevels', 'clahe', 'channel']) expect(ADJUST_ORDER).toContain(id);
  });

  it('sends a channel and local contrast with the rest of the pipeline', () => {
    const ops = buildOps(FILTERS, { ...neutral, clahe: 2, channel: 1, brightness: 1.2 });
    expect(ops.map((o) => o.op)).toEqual(['clahe', 'brightness', 'channel']);
    expect(ops.find((o) => o.op === 'channel').params).toEqual({ pick: 1 });
  });

  it('asks the server for the picture only when a filter has no CSS twin', () => {
    expect(needsRender(FILTERS, { ...neutral, brightness: 1.3 })).toBe(false);
    expect(needsRender(FILTERS, { ...neutral, sharpness: 2 })).toBe(true);
    expect(needsRender(FILTERS, { ...neutral, channel: 2 })).toBe(true);
  });

  it('renders the preview turned and adjusted but leaves the crop to the viewer', () => {
    const frame = { sourceOps: [{ op: 'rotate', params: { angle: 90 } }], rotation: 0, adjust: { ...neutral, clahe: 1 }, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } };
    expect(previewOps(FILTERS, frame).map((o) => o.op)).toEqual(['rotate', 'clahe']);
  });

  it('sets a preset over the defaults, skipping a slider this server lacks', () => {
    const text = ADJUST_PRESETS.find((p) => p.id === 'text');
    const values = presetValues(FILTERS, text);
    expect(values).toMatchObject({ grayscale: 1, contrast: 1.5, sharpness: 2.2, clahe: 1.2, brightness: 1 });
    expect(values).not.toHaveProperty('saturation');
    expect(activePreset(FILTERS, values)).toBe('text');
    expect(activePreset(FILTERS, { ...values, brightness: 1.1 })).toBe(null);
    expect(activePreset(FILTERS, neutral)).toBe(null);
  });
});

describe('a slider\'s travel', () => {
  // The brightness param as /api/inspect/ops serves it.
  const BRIGHTNESS = { name: 'amount', type: 'range', min: 0, max: 4, step: 0.01, default: 1, unit: '', travel: 'centred' };
  const t = sliderTravel(BRIGHTNESS);
  const notches = Array.from({ length: 201 }, (_, i) => t.toValue(i));

  it('runs brightness from black to ×4 with neutral mid-travel and ×2 at three quarters', () => {
    expect([t.min, t.max, t.step]).toEqual([0, 200, 1]);
    expect(t.toValue(0)).toBe(0);
    expect(t.toValue(100)).toBe(1);
    expect(t.toValue(150)).toBe(2);
    expect(t.toValue(200)).toBe(4);
  });

  it('keeps the old slider\'s 0.01 a notch on both sides of neutral', () => {
    expect(notches.slice(95, 106)).toEqual([0.95, 0.96, 0.97, 0.98, 0.99, 1, 1.01, 1.02, 1.03, 1.04, 1.06]);
    expect(notches.slice(0, 100).every((v, i) => v === i / 100)).toBe(true);
  });

  it('never steps back or stands still, and the steps only grow past neutral', () => {
    const steps = notches.slice(1).map((v, i) => +(v - notches[i]).toFixed(2));
    expect(steps.every((d) => d > 0)).toBe(true);
    expect(steps[199]).toBeGreaterThan(steps[100]);
    expect(steps[199]).toBeLessThanOrEqual(0.05);
  });

  it('stores the real factor, rounded to the step', () => {
    for (const v of notches) expect(v).toBe(Number(v.toFixed(2)));
    expect(t.toValue('175')).toBe(2.88);
  });

  it('puts a saved value back under its own notch, old ones from the 0–2 slider included', () => {
    notches.forEach((v, i) => expect(t.toPosition(v)).toBe(i));
    expect(t.toPosition(1.5)).toBe(131);
    expect(t.toPosition(0.25)).toBe(25);
    expect(t.toPosition(7)).toBe(200);
    expect(t.toPosition(undefined)).toBe(100);
  });

  it('leaves every other slider linear on its own bounds', () => {
    const contrast = { name: 'amount', type: 'range', min: 0, max: 2, step: 0.01, default: 1 };
    const linear = sliderTravel(contrast);
    expect([linear.min, linear.max, linear.step]).toEqual([0, 2, 0.01]);
    expect(linear.toPosition(1.37)).toBe(1.37);
    expect(linear.toValue('1.37')).toBe(1.37);
  });

  it('previews ×4 as the factor itself', () => {
    const filters = [{ id: 'brightness', params: [BRIGHTNESS], css: 'brightness({v})' }];
    expect(previewStyle(filters, { brightness: 4 }).filter).toBe('brightness(4)');
    expect(previewStyle(filters, { brightness: 1.5 }).filter).toBe('brightness(1.5)');
  });
});
