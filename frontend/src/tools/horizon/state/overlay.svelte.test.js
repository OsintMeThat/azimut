// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fovFromFocal35 } from '../../../lib/horizon/camera.js';
import { BLINK_MS, createOverlayState, FRAME_DELAY, openBitmap, PHOTO_MAX_PX, SNAP_PX, UNDO_STEPS } from './overlay.svelte.js';

/** A video player that does what the test tells it, when it tells it. */
class FakeVideo {
  constructor() {
    this.listeners = {};
    this.paused = true;
    this.ended = false;
    this.currentTime = 0;
    this.duration = 0;
    this.videoWidth = 0;
    this.videoHeight = 0;
    this.style = {};
    this.src = '';
  }
  addEventListener(name, fn) {
    (this.listeners[name] ??= []).push(fn);
  }
  removeEventListener(name, fn) {
    this.listeners[name] = (this.listeners[name] ?? []).filter((f) => f !== fn);
  }
  emit(name) {
    for (const fn of [...(this.listeners[name] ?? [])]) fn();
  }
  /** The browser has read the file's head. */
  ready({ width = 1920, height = 1080, duration = 40 } = {}) {
    Object.assign(this, { videoWidth: width, videoHeight: height, duration });
    this.emit('loadedmetadata');
  }
  play() {
    this.paused = false;
    this.emit('play');
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.emit('pause');
  }
  removeAttribute() {}
  load() {}
  remove() {
    this.removed = true;
  }
}

let timers;
let api;
let reads;
let unreadable;

/** Where the skyline of the fake 4000 × 3000 photo lies, 0 to 1 down it, at a point across it. */
const ridgeAt = (u) => 0.4 + 0.05 * Math.sin(u * 12);

/** Part of the fake photo as a canvas would read it: a pale sky over dark rock. */
function render(crop, scale) {
  const width = Math.max(1, Math.round(crop.width * scale));
  const height = Math.max(1, Math.round(crop.height * scale));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = (crop.x + ((x + 0.5) * crop.width) / width) / 4000;
      const v = (crop.y + ((y + 0.5) * crop.height) / height) / 3000;
      const sky = v < ridgeAt(u);
      const i = 4 * (y * width + x);
      data.set(sky ? [150, 190, 230, 255] : [90, 80, 70, 255], i);
    }
  }
  return { width, height, data };
}
let view;
let players;
let frames;

function fakeView() {
  return {
    lines: false,
    camera: { heading: 90, tilt: 0, roll: 0, fov: 60, projection: 'camera' },
    setLines: vi.fn(function (on) {
      this.lines = on;
    }),
    look: vi.fn(function (change) {
      this.camera = { ...this.camera, ...change };
    }),
  };
}

function overlay() {
  return createOverlayState({
    api,
    view,
    bitmap: async (blob) => ({ width: blob.width ?? 4000, height: blob.height ?? 3000, close: vi.fn(), from: blob }),
    makeVideo: () => {
      const player = new FakeVideo();
      players.push(player);
      return player;
    },
    host: () => null,
    fetchBlob: async (url) => ({ url, width: 4000, height: 3000 }),
    readHead: async (file) => `head-of-${file.name}`,
    pixels: (picture, crop, scale) => {
      reads.push({ crop, scale });
      if (unreadable) throw new Error('tainted');
      return render(crop, scale);
    },
    frameAt: async (caseId, path, time) => {
      frames.push(time);
      return { width: 1280, height: 720, time };
    },
    objectUrl: (file) => `blob:${file.name}`,
    dropUrl: vi.fn(),
    later: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    cancel: (handle) => {
      timers[handle - 1] = null;
    },
    nextFrame: () => {},
    warpPicture: (picture, corners, options) => ({ pulledFrom: picture, corners, ...options }),
  });
}

/** Run the timers due, the way a clock would. */
function tick() {
  const due = timers;
  timers = [];
  for (const fn of due) fn?.();
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  reads = [];
  unreadable = false;
  timers = [];
  players = [];
  frames = [];
  view = fakeView();
  api = {
    get: vi.fn(async (url) => {
      if (url.startsWith('/api/horizon/photo')) return { kind: 'image', width: 4000, height: 3000, focal35_mm: 26 };
      if (url.includes('/inspect/probe')) return { width: 1280, height: 720, duration: 12, fps: 25 };
      throw new Error(`unexpected ${url}`);
    }),
    post: vi.fn(async () => ({ kind: 'image', focal35_mm: 50 })),
  };
});

describe('a photo of the case laid over the view', () => {
  it('takes the photo’s shape and lens, with the ridge lines over it', async () => {
    const photo = overlay();
    await photo.openCase('c1', { path: 'media/summit.jpg', kind: 'image', title: 'Summit' });
    expect(photo.source).toMatchObject({ name: 'Summit', kind: 'image', caseId: 'c1', path: 'media/summit.jpg' });
    expect(photo.picture.from.url).toBe('/files/c1/media/summit.jpg');
    expect(photo.aspect).toBeCloseTo(4 / 3);
    expect(view.lines).toBe(true);
    expect(api.get).toHaveBeenCalledWith('/api/horizon/photo?case=c1&path=media%2Fsummit.jpg');
    expect(photo.lens.mm).toBe(26);
    expect(view.camera.fov).toBeCloseTo(fovFromFocal35(26, 4 / 3), 6);
    expect(photo.shown).toBe(1);
  });

  it('keeps the lens set by hand when the photo does not say it, as a photo frame', async () => {
    api.get.mockImplementation(async () => ({ kind: 'image', width: 4000, height: 3000 }));
    view.camera = { ...view.camera, projection: 'panorama', fov: 200 };
    const photo = overlay();
    await photo.openCase('c1', { path: 'media/plain.jpg', kind: 'image' });
    expect(photo.lens).toBeNull();
    expect(view.camera).toMatchObject({ projection: 'camera', fov: 120 });
  });

  it('gives its lens back after a zoom, on request', async () => {
    const photo = overlay();
    await photo.openCase('c1', { path: 'media/summit.jpg', kind: 'image' });
    view.look({ fov: 20 });
    photo.useLens();
    expect(view.camera.fov).toBeCloseTo(photo.lens.fov, 6);
  });

  it('puts the ridge lines back as they were when taken away', async () => {
    const photo = overlay();
    await photo.openCase('c1', { path: 'media/summit.jpg', kind: 'image' });
    await photo.openCase('c1', { path: 'media/other.jpg', kind: 'image' });
    photo.remove();
    expect(view.lines).toBe(false);
    expect(photo.source).toBeNull();
    expect(photo.picture).toBeNull();
    expect(photo.shown).toBe(0);
  });

  it('refuses what is not a photo or a video', async () => {
    const photo = overlay();
    await photo.openCase('c1', { path: 'media/notes.txt', kind: 'file' });
    expect(photo.source).toBeNull();
    expect(photo.error).toMatch(/photo or a video/);
  });

  it('lets a newer photo win over one still loading', async () => {
    const photo = overlay();
    const first = photo.openCase('c1', { path: 'media/a.jpg', kind: 'image' });
    const second = photo.openCase('c1', { path: 'media/b.jpg', kind: 'image' });
    await Promise.all([first, second]);
    expect(photo.source.path).toBe('media/b.jpg');
  });
});

describe('a photo from the computer, with no case open', () => {
  it('stays in this browser: only its head is read, for the lens', async () => {
    const photo = overlay();
    const file = { name: 'IMG_2231.jpg', type: 'image/jpeg', width: 3000, height: 4000 };
    await photo.openFile(file);
    expect(photo.source).toMatchObject({ name: 'IMG_2231.jpg', kind: 'image', caseId: null });
    expect(photo.picture.from).toBe(file);
    expect(api.post).toHaveBeenCalledWith('/api/horizon/photo', { head: 'head-of-IMG_2231.jpg' });
    expect(photo.lens.mm).toBe(50);
    expect(photo.aspect).toBeCloseTo(3 / 4);
  });

  it('cannot read the frames of a video the browser does not play', async () => {
    const photo = overlay();
    const opening = photo.openFile({ name: 'clip.mkv', type: 'video/x-matroska' });
    players[0].emit('error');
    await opening;
    expect(photo.error).toMatch(/Add it to a case/);
  });
});

describe('how much of the photo shows', () => {
  it('is a share, or a blink between the photo and the terrain', async () => {
    const photo = overlay();
    await photo.openCase('c1', { path: 'media/summit.jpg', kind: 'image' });
    photo.setMix(0.4);
    expect(photo.shown).toBe(0.4);
    photo.setBlink(true);
    expect(photo.shown).toBe(0);
    tick();
    expect(photo.shown).toBe(1);
    tick();
    expect(photo.shown).toBe(0);
    // moving the share stops the blink
    photo.setMix(0.7);
    expect(photo.blink).toBe(false);
    expect(photo.shown).toBe(0.7);
    expect(BLINK_MS).toBe(800);
  });
});

describe('looking closer', () => {
  const SIZE = { width: 1000, height: 750 };

  it('magnifies about the pointer, moves with the hand and fits back', async () => {
    const photo = overlay();
    await photo.openCase('c1', { path: 'media/summit.jpg', kind: 'image' });
    expect(photo.loupe).toEqual({ zoom: 1, x: 0.5, y: 0.5 });
    photo.zoomLoupe(4, { x: 750, y: 375 }, SIZE);
    expect(photo.loupe.zoom).toBe(4);
    expect(photo.loupe.x).toBeCloseTo(0.6875, 9);
    photo.panLoupe(100, 0, SIZE);
    expect(photo.loupe.x).toBeCloseTo(0.6625, 9);
    photo.fitLoupe();
    expect(photo.loupe.zoom).toBe(1);
  });

  it('does nothing with no photo, and starts again whole for the next one', async () => {
    const photo = overlay();
    photo.zoomLoupe(4, { x: 500, y: 375 }, SIZE);
    expect(photo.loupe.zoom).toBe(1);
    await photo.openCase('c1', { path: 'media/summit.jpg', kind: 'image' });
    photo.zoomLoupe(4, { x: 500, y: 375 }, SIZE);
    photo.setPivot({ u: 0.4, v: 0.3 });
    await photo.openCase('c1', { path: 'media/other.jpg', kind: 'image' });
    expect(photo.loupe.zoom).toBe(1);
    expect(photo.pivot).toBeNull();
    photo.zoomLoupe(2, { x: 500, y: 375 }, SIZE);
    photo.remove();
    expect(photo.loupe.zoom).toBe(1);
  });

  it('keeps a pivot on the photo', async () => {
    const photo = overlay();
    photo.setPivot({ u: 0.5, v: 0.5 });
    expect(photo.pivot).toBeNull();
    await photo.openCase('c1', { path: 'media/summit.jpg', kind: 'image' });
    photo.setPivot({ u: 1.4, v: 0.25 });
    expect(photo.pivot).toEqual({ u: 1, v: 0.25 });
    photo.setPivot(null);
    expect(photo.pivot).toBeNull();
  });
});

describe('the trace', () => {
  it('is drawn stroke by stroke, undone and cleared', async () => {
    const photo = overlay();
    await photo.openCase('c1', { path: 'media/summit.jpg', kind: 'image' });
    const stroke = [
      { u: 0.1, v: 0.4 },
      { u: 0.5, v: 0.3 },
    ];
    photo.addStroke(stroke);
    photo.addStroke([{ u: 0.6, v: 0.3 }]);
    photo.addStroke(stroke);
    expect(photo.strokes).toHaveLength(2);
    expect(photo.traceShown).toBe(true);
    photo.undoStroke();
    expect(photo.strokes).toHaveLength(1);
    photo.clearTrace();
    expect(photo.traceShown).toBe(false);
    // a clear is taken back like a stroke
    photo.undoStroke();
    expect(photo.strokes).toEqual([stroke]);
    photo.undoStroke();
    expect(photo.strokes).toEqual([]);
    expect(photo.canUndo).toBe(false);
  });

  it('is rubbed out along a drag, one drag one step back', async () => {
    const photo = overlay();
    await photo.openCase('c1', { path: 'media/summit.jpg', kind: 'image' });
    const line = [{ u: 0.1, v: 0.5 }, { u: 0.9, v: 0.5 }];
    photo.addStroke(line);
    photo.setErasing(true);
    expect(photo.tracing).toBe(false);
    photo.beginErase();
    photo.eraseAlong([{ u: 0.5, v: 0.4 }, { u: 0.5, v: 0.45 }], 10, { width: 1000, height: 750 });
    photo.eraseAlong([{ u: 0.5, v: 0.45 }, { u: 0.5, v: 0.55 }], 10, { width: 1000, height: 750 });
    photo.endErase();
    expect(photo.strokes).toHaveLength(2);
    photo.undoStroke();
    expect(photo.strokes).toEqual([line]);
    // a drag that rubbed nothing leaves nothing to take back
    photo.beginErase();
    photo.eraseAlong([{ u: 0.5, v: 0.9 }], 10, { width: 1000, height: 750 });
    photo.endErase();
    photo.undoStroke();
    expect(photo.strokes).toEqual([]);
  });

  it('is hidden and shown again, still counted, and comes back to be drawn on', async () => {
    const photo = overlay();
    await photo.openCase('c1', { path: 'media/summit.jpg', kind: 'image' });
    photo.addStroke([{ u: 0.1, v: 0.5 }, { u: 0.9, v: 0.5 }]);
    photo.setTracing(true);
    photo.setTraceHidden(true);
    expect(photo.traceHidden).toBe(true);
    expect(photo.tracing).toBe(false);
    expect(photo.traceShown).toBe(true);
    photo.setErasing(true);
    expect(photo.traceHidden).toBe(false);
    photo.setTracing(true);
    expect(photo.erasing).toBe(false);
  });

  it('keeps a bounded number of steps to take back', async () => {
    const photo = overlay();
    await photo.openCase('c1', { path: 'media/summit.jpg', kind: 'image' });
    for (let i = 0; i < UNDO_STEPS + 10; i += 1) photo.addStroke([{ u: 0, v: i / 100 }, { u: 1, v: i / 100 }]);
    for (let i = 0; i < UNDO_STEPS + 10; i += 1) photo.undoStroke();
    expect(photo.strokes).toHaveLength(10);
  });
});

describe('a lens’s curve undone', () => {
  it('keeps the trace on the photo’s pixels and shows it straightened', async () => {
    const photo = overlay();
    await photo.openCase('c1', { path: 'media/summit.jpg', kind: 'image' });
    photo.setBend(-0.2);
    expect(photo.bend).toBe(-0.2);
    // drawn on the straightened photo, near its right edge
    const drawn = [{ u: 0.9, v: 0.5 }, { u: 0.95, v: 0.5 }];
    photo.addStroke(drawn);
    // kept where the curved lens put those points: nearer the middle
    expect(photo.strokes[0][0].u).toBeLessThan(0.9);
    expect(photo.strokesSeen[0][0].u).toBeCloseTo(0.9, 5);
    // undone again, the trace shows where the photo's own pixels are
    photo.setBend(0);
    expect(photo.strokesSeen).toBe(photo.strokes);
  });

  it('stays within its bounds, and starts straight for the next photo', async () => {
    const photo = overlay();
    photo.setBend(-0.1);
    expect(photo.bend).toBe(0);
    await photo.openCase('c1', { path: 'media/summit.jpg', kind: 'image' });
    photo.setBend(-2);
    expect(photo.bend).toBe(-0.3);
    await photo.openCase('c1', { path: 'media/other.jpg', kind: 'image' });
    expect(photo.bend).toBe(0);
  });

  it('rubs out where the rubber goes on the straightened photo', async () => {
    const photo = overlay();
    await photo.openCase('c1', { path: 'media/summit.jpg', kind: 'image' });
    photo.setBend(-0.25);
    photo.addStroke([{ u: 0.6, v: 0.2 }, { u: 0.98, v: 0.2 }]);
    photo.beginErase();
    photo.eraseAlong([{ u: 0.9, v: 0.15 }, { u: 0.9, v: 0.25 }], 10, { width: 1000, height: 750 });
    photo.endErase();
    expect(photo.strokesSeen).toHaveLength(2);
    expect(photo.strokesSeen[0].at(-1).u).toBeLessThan(0.9);
    expect(photo.strokesSeen[1][0].u).toBeGreaterThan(0.9);
  });
});

describe('a photo pulled by its corners', () => {
  const PULLED = [
    { u: 0.05, v: 0 },
    { u: 0.9, v: 0.1 },
    { u: 1, v: 1 },
    { u: 0, v: 0.95 },
  ];

  it('hands the view the photo drawn between its corners, lighter while one is in the hand', async () => {
    const photo = overlay();
    await photo.openCase('c1', { path: 'media/summit.jpg', kind: 'image' });
    const still = photo.picture;
    expect(photo.warped).toBe(false);
    expect(photo.corners).toEqual([
      { u: 0, v: 0 },
      { u: 1, v: 0 },
      { u: 1, v: 1 },
      { u: 0, v: 1 },
    ]);
    photo.setPulling(true);
    photo.setCorner(1, { u: 0.9, v: 0.1 });
    expect(photo.warped).toBe(true);
    expect(photo.picture).toMatchObject({ pulledFrom: still, fast: true });
    expect(photo.picture.corners[1]).toEqual({ u: 0.9, v: 0.1 });
    photo.setPulling(false);
    expect(photo.picture.fast).toBe(false);
    // put back where it was, the photo is the photo again
    photo.setCorner(1, { u: 1, v: 0 });
    expect(photo.warped).toBe(false);
    expect(photo.picture).toBe(still);
    photo.setCorners(PULLED);
    photo.resetWarp();
    expect(photo.picture).toBe(still);
  });

  it('keeps a corner within reach of the frame', async () => {
    const photo = overlay();
    await photo.openCase('c1', { path: 'media/summit.jpg', kind: 'image' });
    photo.setCorner(0, { u: -9, v: 4 });
    expect(photo.corners[0]).toEqual({ u: -1, v: 2 });
    photo.setCorners([{ u: 0, v: 0 }]);
    expect(photo.corners[0]).toEqual({ u: -1, v: 2 });
  });

  it('keeps the trace on the photo’s pixels, shown where the pulled photo puts them', async () => {
    const photo = overlay();
    await photo.openCase('c1', { path: 'media/summit.jpg', kind: 'image' });
    photo.addStroke([{ u: 0.5, v: 0.4 }, { u: 0.6, v: 0.4 }]);
    photo.setCorners(PULLED);
    const kept = photo.strokes[0][0];
    expect(kept).toEqual({ u: 0.5, v: 0.4 });
    const shown = photo.strokesSeen[0][0];
    expect(shown.u).not.toBeCloseTo(0.5, 3);
    // a stroke drawn where the pulled photo shows a point is kept on that point
    photo.addStroke([shown, photo.strokesSeen[0][1]]);
    expect(photo.strokes[1][0].u).toBeCloseTo(0.5, 5);
    expect(photo.strokes[1][0].v).toBeCloseTo(0.4, 5);
  });

  it('goes through the curve and the corners together, there and back', async () => {
    const photo = overlay();
    await photo.openCase('c1', { path: 'media/summit.jpg', kind: 'image' });
    photo.setBend(-0.2);
    photo.setCorners(PULLED);
    photo.addStroke([{ u: 0.3, v: 0.3 }, { u: 0.7, v: 0.35 }]);
    const shown = photo.strokesSeen[0];
    expect(shown[0].u).toBeCloseTo(0.3, 5);
    expect(shown[0].v).toBeCloseTo(0.3, 5);
  });

  it('puts the pen down to pull corners, and leaves a video alone', async () => {
    const photo = overlay();
    await photo.openCase('c1', { path: 'media/summit.jpg', kind: 'image' });
    photo.setTracing(true);
    photo.setWarping(true);
    expect(photo.warping).toBe(true);
    expect(photo.tracing).toBe(false);
    photo.setErasing(true);
    expect(photo.warping).toBe(false);
    const opening = photo.openCase('c1', { path: 'media/clip.mp4', kind: 'video' });
    players.at(-1).ready();
    await opening;
    photo.setWarping(true);
    expect(photo.warping).toBe(false);
    photo.setCorners(PULLED);
    expect(photo.warped).toBe(false);
  });

  it('starts square for the next photo', async () => {
    const photo = overlay();
    await photo.openCase('c1', { path: 'media/summit.jpg', kind: 'image' });
    photo.setWarping(true);
    photo.setCorners(PULLED);
    await photo.openCase('c1', { path: 'media/other.jpg', kind: 'image' });
    expect(photo.warped).toBe(false);
    expect(photo.warping).toBe(false);
  });
});

describe('a photo locked to the terrain', () => {
  it('takes nothing that would move the photo against the terrain', async () => {
    const photo = overlay();
    await photo.openCase('c1', { path: 'media/summit.jpg', kind: 'image' });
    photo.setWarping(true);
    photo.setLocked(true);
    expect(photo.locked).toBe(true);
    expect(photo.warping).toBe(false);
    photo.setWarping(true);
    expect(photo.warping).toBe(false);
    photo.setBend(-0.2);
    expect(photo.bend).toBe(0);
    photo.setCorner(1, { u: 0.8, v: 0.1 });
    expect(photo.warped).toBe(false);
    view.look.mockClear();
    photo.useLens();
    expect(view.look).not.toHaveBeenCalled();
  });

  it('moves over the terrain with the photo on it: wider than the photo and past its edges', async () => {
    const photo = overlay();
    const screen = { width: 1000, height: 750 };
    await photo.openCase('c1', { path: 'media/summit.jpg', kind: 'image' });
    // free, the view stays on the photo
    photo.zoomLoupe(0.5, { x: 500, y: 375 }, screen);
    expect(photo.loupe.zoom).toBe(1);
    photo.panLoupe(-300, 0, screen);
    expect(photo.loupe.x).toBe(0.5);
    photo.setLocked(true);
    photo.zoomLoupe(0.5, { x: 500, y: 375 }, screen);
    expect(photo.loupe.zoom).toBe(0.5);
    photo.panLoupe(-300, 0, screen);
    expect(photo.loupe.x).toBeCloseTo(1.1, 9);
    photo.zoomLoupe(0.01, { x: 500, y: 375 }, screen);
    expect(photo.loupe.zoom).toBe(0.3);
    photo.setTracing(true);
    expect(photo.tracing).toBe(true);
    // let go, it comes back onto the photo
    photo.setLocked(false);
    expect(photo.loupe).toEqual({ zoom: 1, x: 0.5, y: 0.5 });
    photo.setBend(-0.1);
    expect(photo.bend).toBe(-0.1);
  });

  it('starts free for the next photo, and is nothing without one', async () => {
    const photo = overlay();
    photo.setLocked(true);
    expect(photo.locked).toBe(false);
    await photo.openCase('c1', { path: 'media/summit.jpg', kind: 'image' });
    photo.setLocked(true);
    await photo.openCase('c1', { path: 'media/other.jpg', kind: 'image' });
    expect(photo.locked).toBe(false);
  });
});

describe('the trace helped by the photo', () => {
  const SCREEN = { width: 1000, height: 750 };
  const off = (stroke) => Math.max(...stroke.map((p) => Math.abs(p.v - ridgeAt(p.u))));

  it('snaps a stroke onto the sky’s edge near it, reading only around it', async () => {
    const photo = overlay();
    await photo.openCase('c1', { path: 'media/summit.jpg', kind: 'image' });
    // drawn 8 screen pixels low: 32 of the photo's
    const drawn = Array.from({ length: 30 }, (_, i) => ({ u: 0.2 + i * 0.01, v: ridgeAt(0.2 + i * 0.01) + 32 / 3000 }));
    photo.addStroke(drawn, { snap: true, scale: SCREEN });
    expect(off(photo.strokes[0])).toBeLessThan(2.5 / 3000);
    // read at twice the screen's sharpness, around the stroke only
    expect(reads[0].scale).toBeCloseTo(0.5, 9);
    expect(reads[0].crop.width).toBeLessThan(1400);
    photo.undoStroke();
    expect(photo.strokes).toEqual([]);
  });

  it('leaves a stroke as drawn when asked to, out of reach, or when the picture cannot be read', async () => {
    const photo = overlay();
    await photo.openCase('c1', { path: 'media/summit.jpg', kind: 'image' });
    const low = (by) => [0.3, 0.4, 0.5].map((u) => ({ u, v: ridgeAt(u) + by }));
    photo.addStroke(low(0.01), { snap: false, scale: SCREEN });
    expect(photo.strokes[0]).toEqual(low(0.01));
    // twice the reach below the edge
    const far = low((2 * SNAP_PX * 4) / 3000);
    photo.addStroke(far, { snap: true, scale: SCREEN });
    expect(off(photo.strokes[1])).toBeGreaterThan(0.02);
    unreadable = true;
    photo.addStroke(low(0.005), { snap: true, scale: SCREEN });
    expect(photo.strokes[2]).toEqual(low(0.005));
  });

  it('finds the whole skyline at once, in place of the trace, taken back as one change', async () => {
    const photo = overlay();
    await photo.openCase('c1', { path: 'media/summit.jpg', kind: 'image' });
    const mine = [{ u: 0.1, v: 0.9 }, { u: 0.2, v: 0.9 }];
    photo.addStroke(mine);
    photo.setTraceHidden(true);
    expect(photo.detectSkyline()).toEqual({ found: 1 });
    const [line] = photo.strokes;
    expect(line[0].u).toBeLessThan(0.01);
    expect(line.at(-1).u).toBeGreaterThan(0.99);
    expect(off(line)).toBeLessThan(2 / 3000);
    expect(photo.traceHidden).toBe(false);
    // a light read of the whole photo, then a sharper one along the line
    expect(reads[0].scale).toBeCloseTo(1024 / 4000, 9);
    expect(reads[1].scale).toBeCloseTo(2048 / 4000, 9);
    photo.undoStroke();
    expect(photo.strokes).toEqual([mine]);
  });

  it('says when it finds nothing, or cannot read the picture', async () => {
    const photo = overlay();
    expect(photo.detectSkyline()).toEqual({ found: 0 });
    await photo.openCase('c1', { path: 'media/summit.jpg', kind: 'image' });
    unreadable = true;
    expect(photo.detectSkyline().error).toBeTruthy();
    expect(photo.strokes).toEqual([]);
  });
});

describe('a video of the case', () => {
  async function opened(extra = {}) {
    const photo = overlay();
    const opening = photo.openCase('c1', { path: 'media/clip.mp4', kind: 'video' }, extra);
    players[0].ready();
    await opening;
    return { photo, player: players[0] };
  }

  it('plays in the browser, the frame on show drawn on the view', async () => {
    const { photo, player } = await opened({ time: 14.2 });
    expect(photo.picture).toBe(player);
    expect(player.src).toBe('/files/c1/media/clip.mp4');
    expect(player.muted).toBe(true);
    expect(photo.aspect).toBeCloseTo(16 / 9);
    expect(photo.duration).toBe(40);
    expect(player.currentTime).toBe(14.2);
    const before = photo.frame;
    player.emit('seeked');
    expect(photo.time).toBe(14.2);
    expect(photo.frame).toBe(before + 1);
    photo.togglePlay();
    expect(photo.playing).toBe(true);
    photo.togglePlay();
    expect(photo.playing).toBe(false);
  });

  it('follows the pins between two moments', async () => {
    const { photo } = await opened();
    photo.seek(2);
    view.look({ heading: 350 });
    photo.pin();
    photo.seek(12);
    view.look({ heading: 10, fov: 40 });
    photo.pin();
    expect(photo.pins.map((pin) => pin.time)).toEqual([2, 12]);
    expect(photo.pinnedHere).toBe(true);
    photo.seek(7);
    expect(view.camera.heading).toBeCloseTo(0);
    photo.unpin(12);
    photo.seek(30);
    expect(view.camera.heading).toBe(350);
    photo.clearPins();
    expect(photo.pins).toEqual([]);
  });

  it('keeps a trace with the moment it was drawn on', async () => {
    const { photo, player } = await opened();
    photo.seek(5);
    player.play();
    photo.addStroke([
      { u: 0.1, v: 0.4 },
      { u: 0.5, v: 0.3 },
    ]);
    // drawing pauses the video
    expect(player.paused).toBe(true);
    expect(photo.traceTime).toBe(5);
    photo.seek(9);
    expect(photo.traceShown).toBe(false);
    photo.seekTrace();
    expect(photo.traceShown).toBe(true);
    // a stroke at another moment starts that moment's trace
    photo.seek(20);
    photo.addStroke([
      { u: 0.2, v: 0.4 },
      { u: 0.3, v: 0.3 },
    ]);
    expect(photo.strokes).toHaveLength(1);
    expect(photo.traceTime).toBe(20);
  });

  it('steps a frame at a time', async () => {
    const { photo } = await opened();
    photo.seek(1);
    photo.step(3);
    expect(photo.time).toBeCloseTo(1.1);
  });

  it('reads its frames through the app when the browser cannot play it', async () => {
    const photo = overlay();
    const opening = photo.openCase('c1', { path: 'media/old.avi', kind: 'video' }, { time: 3 });
    players[0].emit('error');
    await opening;
    expect(players[0].removed).toBe(true);
    expect(photo.playable).toBe(false);
    expect(photo.size).toEqual({ width: 1280, height: 720 });
    expect(photo.fps).toBe(25);
    expect(frames).toEqual([3]);
    expect(photo.picture.from.time).toBe(3);
    // a scrub asks once it rests
    photo.seek(4);
    photo.seek(5);
    expect(FRAME_DELAY).toBeGreaterThan(0);
    tick();
    await flush();
    expect(frames).toEqual([3, 5]);
    expect(photo.picture.from.time).toBe(5);
    photo.play();
    expect(photo.playing).toBe(false);
  });

  it('reads the skyline off a frame the app read smaller than the video, in that frame’s pixels', async () => {
    api.get.mockImplementation(async (url) => {
      if (url.includes('/inspect/probe')) return { width: 3840, height: 2160, duration: 12, fps: 25 };
      throw new Error(`unexpected ${url}`);
    });
    const photo = overlay();
    const opening = photo.openCase('c1', { path: 'media/old.avi', kind: 'video' }, { time: 3 });
    players[0].emit('error');
    await opening;
    // the frame came back 1280 × 720 for a 4K video
    expect(photo.size).toEqual({ width: 3840, height: 2160 });
    photo.detectSkyline();
    expect(reads[0].crop).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  });
});

describe('a photo file opened as a picture', () => {
  /** A bitmap as a browser makes one: 0 × 0 once it is closed. */
  function bitmapMaker(width, height) {
    const asked = [];
    const make = async (blob, options) => {
      asked.push(options ?? null);
      const bitmap = {
        width: options?.resizeWidth ?? width,
        height: options?.resizeHeight ?? height,
        close() {
          this.width = 0;
          this.height = 0;
        },
      };
      if (!(bitmap.width > 0 && bitmap.height > 0)) throw new Error('resizeWidth or resizeHeight is 0');
      return bitmap;
    };
    return { make, asked };
  }

  it('keeps a photo no larger than the view needs as it is', async () => {
    const { make, asked } = bitmapMaker(4000, 3000);
    const bitmap = await openBitmap('blob', make);
    expect([bitmap.width, bitmap.height]).toEqual([4000, 3000]);
    expect(asked).toEqual([null]);
  });

  it('shrinks a larger one, from the size it had before it was let go', async () => {
    const { make, asked } = bitmapMaker(8000, 6000);
    const bitmap = await openBitmap('blob', make);
    expect(asked[1]).toMatchObject({ resizeWidth: PHOTO_MAX_PX, resizeHeight: 3072 });
    expect([bitmap.width, bitmap.height]).toEqual([PHOTO_MAX_PX, 3072]);
  });
});
