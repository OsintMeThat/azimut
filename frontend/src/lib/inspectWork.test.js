import { describe, expect, it } from 'vitest';
import {
  categoryOf, collageSignature, collageSpec, frameRecord, frameSignature, isFiled, isPristine,
  isUntouched, markRecord, missingPieces, sceneRecord, videoSignature, workSpec,
} from './inspectWork.svelte.js';

const FILTERS = [
  { id: 'brightness', params: [{ name: 'value', default: 1 }], css: 'brightness({v})' },
  { id: 'grayscale', params: [{ name: 'on', default: 0 }], css: 'grayscale({v})' },
];
const VIDEO_FILTERS = FILTERS;

const frame = (extra = {}) => ({
  id: 'fr_1', path: 'media/roof.png', time: null, adjust: { brightness: 1, grayscale: 0 },
  crop: null, sourceOps: [], rotation: 0, w: 80, h: 60, filed: null, ...extra,
});

describe('what a work save writes', () => {
  it('keeps the recipe and leaves the preview pixels behind', () => {
    const record = frameRecord(frame({ url: 'blob:x', missing: true }));
    expect(record).not.toHaveProperty('url');
    expect(record).not.toHaveProperty('missing');
    expect(record.path).toBe('media/roof.png');
  });

  it('keeps a video\'s marks with their time and a trimmed label', () => {
    expect(workSpec({ frames: [], marks: [{ id: 'mk_1', time: 4.2, label: '  convoy turns  ', focus: true }] }).marks)
      .toEqual([{ id: 'mk_1', time: 4.2, label: 'convoy turns' }]);
    expect(workSpec({ frames: [] }).marks).toEqual([]);
    expect(markRecord({ id: 'mk_2', time: 1 })).toEqual({ id: 'mk_2', time: 1, label: '' });
  });

  it('keeps a video\'s scenes as a stretch and a trimmed label', () => {
    expect(workSpec({ frames: [], scenes: [{ id: 'sc_1', start: 4, end: 9.5, label: '  bridge?  ', color: 'x' }] }).scenes)
      .toEqual([{ id: 'sc_1', start: 4, end: 9.5, label: 'bridge?' }]);
    expect(workSpec({ frames: [] }).scenes).toEqual([]);
    expect(sceneRecord({ id: 'sc_2', start: 1, end: 2 })).toEqual({ id: 'sc_2', start: 1, end: 2, label: '' });
    // an instant says it has no end rather than leaving the key out
    expect(sceneRecord({ id: 'sc_3', start: 4 })).toEqual({ id: 'sc_3', start: 4, end: null, label: '' });
  });

  it('holds a turn to the right angles the pipeline accepts', () => {
    expect(workSpec({ videoRotation: 45, frames: [frame({ rotation: 33 })] })).toMatchObject({
      videoRotation: 0,
      frames: [{ rotation: 0 }],
    });
  });
});

describe('isPristine: looking at a file files nothing', () => {
  it('holds for a video until a frame is cut or the clip is adjusted', () => {
    const video = { source: { kind: 'video' }, frames: [], videoAdjust: { brightness: 1 }, videoRotation: 0 };
    expect(isPristine(video, FILTERS, VIDEO_FILTERS)).toBe(true);
    expect(isPristine({ ...video, frames: [frame()] }, FILTERS, VIDEO_FILTERS)).toBe(false);
    expect(isPristine({ ...video, videoRotation: 90 }, FILTERS, VIDEO_FILTERS)).toBe(false);
    expect(isPristine({ ...video, videoAdjust: { brightness: 1.4 } }, FILTERS, VIDEO_FILTERS)).toBe(false);
  });

  it('counts a marked moment as work on a video', () => {
    const video = { source: { kind: 'video' }, frames: [], marks: [], videoAdjust: { brightness: 1 }, videoRotation: 0 };
    expect(isPristine(video, FILTERS, VIDEO_FILTERS)).toBe(true);
    expect(isPristine({ ...video, marks: [{ id: 'mk_1', time: 3, label: '' }] }, FILTERS, VIDEO_FILTERS)).toBe(false);
  });

  it('counts a picture marked to geolocate as work', () => {
    const image = { source: { kind: 'image' }, frames: [frame()], scenes: [] };
    expect(isPristine(image, FILTERS, VIDEO_FILTERS)).toBe(true);
    expect(isPristine({ ...image, scenes: [{ id: 'sc_1', start: null, end: null, label: '' }] }, FILTERS, VIDEO_FILTERS)).toBe(false);
  });

  it('counts a scene kept on a video as work', () => {
    const video = { source: { kind: 'video' }, frames: [], scenes: [], videoAdjust: { brightness: 1 }, videoRotation: 0 };
    expect(isPristine(video, FILTERS, VIDEO_FILTERS)).toBe(true);
    expect(isPristine({ ...video, scenes: [{ id: 'sc_1', start: 3, end: 6, label: '' }] }, FILTERS, VIDEO_FILTERS)).toBe(false);
  });

  it('holds for an image until its one frame changes or a second appears', () => {
    const image = { source: { kind: 'image' }, frames: [frame()] };
    expect(isPristine(image, FILTERS, VIDEO_FILTERS)).toBe(true);
    expect(isPristine({ ...image, frames: [frame({ crop: { x: 0, y: 0, w: 0.5, h: 0.5 } })] }, FILTERS, VIDEO_FILTERS)).toBe(false);
    expect(isPristine({ ...image, frames: [frame(), frame({ id: 'fr_2' })] }, FILTERS, VIDEO_FILTERS)).toBe(false);
    expect(isPristine({ ...image, frames: [frame({ filed: { path: 'media/x.png' } })] }, FILTERS, VIDEO_FILTERS)).toBe(false);
  });

  it('reads an untouched frame as the file itself', () => {
    expect(isUntouched(frame(), FILTERS)).toBe(true);
    expect(isUntouched(frame({ rotation: 90 }), FILTERS)).toBe(false);
    expect(isUntouched(frame({ adjust: { brightness: 1.2 } }), FILTERS)).toBe(false);
  });
});

describe('isFiled: an output in the case as it reads now', () => {
  const paths = new Set(['media/roof edit.png']);

  it('holds while the recipe is the one that was saved and the media is still there', () => {
    const f = frame({ adjust: { brightness: 1.3 } });
    const filed = { path: 'media/roof edit.png', signature: frameSignature(FILTERS, f) };
    expect(isFiled(filed, frameSignature(FILTERS, f), paths)).toBe(true);
  });

  it('lapses when the frame is edited after the save', () => {
    const f = frame({ adjust: { brightness: 1.3 } });
    const filed = { path: 'media/roof edit.png', signature: frameSignature(FILTERS, f) };
    const edited = { ...f, crop: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } };
    expect(isFiled(filed, frameSignature(FILTERS, edited), paths)).toBe(false);
  });

  it('lapses when the saved media is deleted', () => {
    const f = frame();
    const filed = { path: 'media/gone.png', signature: frameSignature(FILTERS, f) };
    expect(isFiled(filed, frameSignature(FILTERS, f), paths)).toBe(false);
    expect(isFiled(null, frameSignature(FILTERS, f), paths)).toBe(false);
  });

  it('tells an adjusted video apart from its first save', () => {
    const before = videoSignature(VIDEO_FILTERS, { brightness: 1.2 }, 0);
    expect(videoSignature(VIDEO_FILTERS, { brightness: 1.2 }, 90)).not.toBe(before);
    expect(videoSignature(VIDEO_FILTERS, { brightness: 1.2 }, 0)).toBe(before);
  });
});

describe('collages', () => {
  const piece = (extra = {}) => ({
    id: 'nd_1', frameId: 'fr_1', save: { path: 'media/roof.png', time: null, ops: [] },
    w: 80, h: 60, quad: [[0, 0], [80, 0], [80, 60], [0, 60]], url: 'blob:x', baseUrl: 'blob:y', ...extra,
  });

  it('stores recipes and corners, never the preview pixels', () => {
    const spec = collageSpec({ width: 800, height: 400, background: '#000', transparent: true, nodes: [piece()] });
    expect(spec.nodes[0]).not.toHaveProperty('url');
    expect(spec.nodes[0]).not.toHaveProperty('baseUrl');
    expect(spec.exported).toBeNull();
  });

  it('keeps the areas painted out of a piece\'s stitch, which never change what it exports', () => {
    const strokes = [{ points: [[0.5, 0.5]], radius: 0.1 }];
    const spec = collageSpec({ width: 800, height: 400, nodes: [piece({ exclude: strokes }), piece({ id: 'nd_2', exclude: [] })] });
    expect(spec.nodes[0].exclude).toEqual(strokes);
    // none painted, or all cleared: no field, as the server stores it
    expect(spec.nodes[1]).not.toHaveProperty('exclude');
    expect(collageSignature({ nodes: [piece({ exclude: strokes })] })).toBe(collageSignature({ nodes: [piece()] }));
  });

  it('moves its signature when a piece moves', () => {
    const before = collageSignature({ nodes: [piece()] });
    const moved = collageSignature({ nodes: [piece({ quad: [[5, 0], [85, 0], [85, 60], [5, 60]] })] });
    expect(moved).not.toBe(before);
  });

  it('keeps a cut, and signs it beside the pieces so a new cut is a new picture', () => {
    const clip = { x: 0, y: 0, w: 60, h: 40 };
    expect(collageSpec({ width: 800, height: 400, nodes: [piece()], clip }).clip).toEqual(clip);
    expect(collageSpec({ width: 800, height: 400, nodes: [piece()], clip: null })).not.toHaveProperty('clip');
    const plain = collageSignature({ nodes: [piece()] });
    const cut = collageSignature({ nodes: [piece()], clip });
    // as the server reads it back: the pieces alone, or the pieces and the frame
    expect(JSON.parse(plain)).toEqual([[piece().save, piece().quad]]);
    expect(JSON.parse(cut)).toEqual({ nodes: [[piece().save, piece().quad]], clip });
    expect(collageSignature({ nodes: [piece()], clip: { ...clip, h: 30 } })).not.toBe(cut);
  });

  it('finds the pieces whose file is gone', () => {
    expect(missingPieces({ nodes: [piece(), piece({ id: 'nd_2', missing: true })] }).map((n) => n.id)).toEqual(['nd_2']);
  });
});

describe('categoryOf', () => {
  it('sorts captures, frames and collages out of plain media', () => {
    expect(categoryOf({ kind: 'image', source: { type: 'satellite' } })).toBe('capture');
    expect(categoryOf({ kind: 'image', source: { type: 'screenshot' } })).toBe('capture');
    expect(categoryOf({ kind: 'image', source: { op: 'collage' } })).toBe('collage');
    expect(categoryOf({ kind: 'image', source: { op: 'frame' } })).toBe('frame');
    expect(categoryOf({ kind: 'image', source: { op: 'adjust' } })).toBe('frame');
    expect(categoryOf({ kind: 'video', source: { type: 'upload' } })).toBe('video');
  });
});
