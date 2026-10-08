// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fovFromFocal35 } from '../../../lib/horizon/camera.js';
import { BLINK_MS, createOverlayState, FRAME_DELAY } from './overlay.svelte.js';

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
});
