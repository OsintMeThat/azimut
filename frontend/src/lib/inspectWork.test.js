import { describe, expect, it } from 'vitest';
import {
  categoryOf, collageSignature, collageSpec, frameRecord, frameSignature, isFiled, isPristine,
  isUntouched, missingPieces, videoSignature, workSpec,
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

  it('moves its signature when a piece moves', () => {
    const before = collageSignature({ nodes: [piece()] });
    const moved = collageSignature({ nodes: [piece({ quad: [[5, 0], [85, 0], [85, 60], [5, 60]] })] });
    expect(moved).not.toBe(before);
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
