/**
 * A photo or a video laid over the Horizon view, and what the analyst draws on it.
 *
 * The photo is fixed on screen and the terrain moves under it: the view's
 * frame takes the photo's shape, its lens is the photo's (prefilled from the
 * EXIF when the photo says it), and the ridge lines are drawn over it, which
 * is the picture a photo is aligned on. How much of the photo shows is a
 * share (`mix`), or a blink between photo and terrain.
 *
 * A photo comes from the case (its file is read where it lies), or from the
 * analyst's computer: with a case open it is added to the case first, so the
 * work on it can be kept; with none it stays in this browser, and only the
 * head of the file reaches the app, to read its lens.
 *
 * A video plays in the browser when the browser can decode it; otherwise the
 * app reads the frame at each moment scrubbed to (ffmpeg, Inspect's own
 * route), which needs the video in a case. A paused video is the frame: a
 * trace drawn on it belongs to that moment, and pins keep the view's alignment
 * at moments of it, which the view then follows between them.
 *
 * What the photo says about its place and time is offered, never applied:
 * the analyst decides (`facts`).
 */
import { fileUrl } from '../../../lib/fileUrl.js';
import { fovFromFocal35 } from '../../../lib/horizon/camera.js';
import { cameraAt, pinAt, PIN_SLACK_S } from '../../../lib/horizon/overlay.js';

/** ms each side shows while blinking (Compare's Normal speed). */
export const BLINK_MS = 800;
/** ms a scrub must rest before the app is asked for the frame there, for a video the browser cannot play. */
export const FRAME_DELAY = 150;
/** Bytes of a file on the computer sent to read its lens: the EXIF block is at its head (api/horizon.py). */
export const HEAD_BYTES = 256 * 1024;
/** The largest side a photo is drawn at: past it, it is shrunk once on opening. */
export const PHOTO_MAX_PX = 4096;
/** Frames a second assumed when a video does not say. */
export const DEFAULT_FPS = 30;

/** A photo file as a picture for the GPU, oriented as its EXIF says and no larger than the view needs. */
export async function openBitmap(blob) {
  const whole = await createImageBitmap(blob);
  const side = Math.max(whole.width, whole.height);
  if (side <= PHOTO_MAX_PX) return whole;
  const scale = PHOTO_MAX_PX / side;
  whole.close?.();
  return createImageBitmap(blob, {
    resizeWidth: Math.round(whole.width * scale),
    resizeHeight: Math.round(whole.height * scale),
    resizeQuality: 'high',
  });
}

/** The head of a file as base64, for the app to read its lens. */
export async function headOf(file, bytes = HEAD_BYTES) {
  const head = new Uint8Array(await file.slice(0, bytes).arrayBuffer());
  let text = '';
  for (let i = 0; i < head.length; i += 0x8000) text += String.fromCharCode(...head.subarray(i, i + 0x8000));
  return btoa(text);
}

/** A frame of a case's video read by the app (Inspect's route), as a PNG blob. */
export async function renderFrame(caseId, path, time) {
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/inspect/render-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, time, ops: [] }),
  });
  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.json()).detail;
    } catch {
      // not a JSON answer
    }
    throw new Error(typeof detail === 'string' && detail ? detail : 'The app could not read this frame.');
  }
  return response.blob();
}

const kindOf = (name, type = '') => {
  if (type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|tiff?|avif)$/i.test(name)) return 'image';
  if (type.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv|avi|ogv|3gp)$/i.test(name)) return 'video';
  return '';
};

/**
 * @param {object} deps
 * @param {object} deps.api the app's fetch wrapper
 * @param {object} deps.view the Horizon view (state/horizon.svelte.js)
 */
export function createOverlayState({
  api,
  view,
  bitmap = openBitmap,
  makeVideo = () => document.createElement('video'),
  host = () => globalThis.document?.body ?? null,
  fetchBlob = async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`The file could not be read (${response.status}).`);
    return response.blob();
  },
  readHead = headOf,
  frameAt = renderFrame,
  objectUrl = (file) => URL.createObjectURL(file),
  dropUrl = (url) => URL.revokeObjectURL(url),
  later = setTimeout,
  cancel = clearTimeout,
  nextFrame = (fn) => requestAnimationFrame(fn),
}) {
  let source = $state.raw(null);
  let still = $state.raw(null);
  let video = $state.raw(null);
  let size = $state({ width: 0, height: 0 });
  let facts = $state.raw({});
  let busy = $state(false);
  let error = $state('');
  let mix = $state(1);
  let blink = $state(false);
  let blinkPhoto = $state(true);
  let tracing = $state(false);
  let strokes = $state.raw([]);
  let traceTime = $state(null);
  let pins = $state.raw([]);
  let time = $state(0);
  let duration = $state(0);
  let fps = $state(DEFAULT_FPS);
  let playing = $state(false);
  let playable = $state(true);
  // bumped each time a new frame of the video is on show, so the view draws it
  let frame = $state(0);

  let opened = 0;
  let blinkTimer = null;
  let frameTimer = null;
  let framesAsked = 0;
  let linesBefore = null;
  let ownUrl = '';

  const aspect = () => (size.width > 0 && size.height > 0 ? size.width / size.height : 0);

  /** The view as the photo was taken: its lens, through the frame a photo is, with the lines over it. */
  function settleView() {
    if (linesBefore === null) linesBefore = view.lines;
    view.setLines(true);
    const lens = lensOf();
    if (lens) view.look({ projection: 'camera', fov: lens.fov });
    else if (view.camera.projection !== 'camera') view.look({ projection: 'camera', fov: Math.min(view.camera.fov, 120) });
  }

  function lensOf() {
    const mm = facts.focal35_mm;
    const ratio = aspect();
    if (!(mm > 0) || !(ratio > 0)) return null;
    return { mm, fov: fovFromFocal35(mm, ratio), workedOut: Boolean(facts.focal35_worked_out) };
  }

  function clear() {
    opened += 1;
    framesAsked += 1;
    if (frameTimer) cancel(frameTimer);
    frameTimer = null;
    stopBlink();
    if (video) {
      video.pause?.();
      video.removeAttribute?.('src');
      video.load?.();
      video.remove?.();
    }
    still?.close?.();
    if (ownUrl) dropUrl(ownUrl);
    ownUrl = '';
    source = null;
    still = null;
    video = null;
    size = { width: 0, height: 0 };
    facts = {};
    busy = false;
    error = '';
    tracing = false;
    strokes = [];
    traceTime = null;
    pins = [];
    time = 0;
    duration = 0;
    fps = DEFAULT_FPS;
    playing = false;
    playable = true;
    mix = 1;
  }

  /** A picture laid as the photo, once it is known what it is. */
  function showStill(picture) {
    still?.close?.();
    still = picture;
    frame += 1;
  }

  // -- a video ----------------------------------------------------------------

  /** The view follows the pins, when there are some, to the moment on show. */
  function follow() {
    const camera = cameraAt(pins, time);
    if (camera) view.look(camera);
  }

  function onFrame(el) {
    if (el !== video) return;
    time = el.currentTime || 0;
    frame += 1;
    follow();
  }

  function watch(el) {
    const loop = () => {
      if (el !== video) return;
      onFrame(el);
      if (!el.paused && !el.ended) schedule();
    };
    const schedule = () => (el.requestVideoFrameCallback ? el.requestVideoFrameCallback(loop) : nextFrame(loop));
    el.addEventListener('play', () => {
      if (el !== video) return;
      playing = true;
      schedule();
    });
    el.addEventListener('pause', () => {
      if (el !== video) return;
      playing = false;
      onFrame(el);
    });
    el.addEventListener('ended', () => {
      if (el === video) playing = false;
    });
    el.addEventListener('seeked', () => onFrame(el));
    el.addEventListener('loadeddata', () => onFrame(el));
  }

  /** A video into a player the page holds out of sight: the frames it shows are drawn on the view. */
  function playerFor(url) {
    const el = makeVideo();
    el.muted = true;
    el.playsInline = true;
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    // laid in the page, out of sight, so the browser keeps presenting its frames
    if (el.style) {
      Object.assign(el.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none' });
    }
    host()?.appendChild?.(el);
    el.src = url;
    return el;
  }

  /** Wait for a player to say its size, or that it cannot play the file. */
  function metadataOf(el) {
    return new Promise((resolve) => {
      const done = (ok) => {
        el.removeEventListener('loadedmetadata', yes);
        el.removeEventListener('error', no);
        resolve(ok);
      };
      const yes = () => done(true);
      const no = () => done(false);
      el.addEventListener('loadedmetadata', yes);
      el.addEventListener('error', no);
    });
  }

  /** For a video the browser cannot decode: the app reads the frame at a moment. */
  async function readFrame(at) {
    frameTimer = null;
    if (!source?.caseId || playable) return;
    const mine = ++framesAsked;
    try {
      const picture = await bitmap(await frameAt(source.caseId, source.path, at));
      if (mine !== framesAsked) {
        picture.close?.();
        return;
      }
      showStill(picture);
      time = at;
      follow();
    } catch (failure) {
      if (mine === framesAsked) error = failure.message;
    }
  }

  async function openVideo(url, mine, { caseId, path, at }) {
    const el = playerFor(url);
    video = el;
    watch(el);
    const ok = await metadataOf(el);
    if (mine !== opened) return;
    if (ok && el.videoWidth > 0) {
      size = { width: el.videoWidth, height: el.videoHeight };
      duration = Number.isFinite(el.duration) ? el.duration : 0;
      if (at > 0) el.currentTime = Math.min(at, duration || at);
      return;
    }
    // the browser cannot play it: the app reads its frames, when it is in a case
    el.remove?.();
    video = null;
    playable = false;
    if (!caseId) throw new Error('This browser cannot play this video. Add it to a case so the app can read its frames.');
    const probe = await api.get(`/api/cases/${caseId}/inspect/probe?path=${encodeURIComponent(path)}`);
    if (mine !== opened) return;
    size = { width: probe.width || 0, height: probe.height || 0 };
    duration = probe.duration || 0;
    fps = probe.fps || DEFAULT_FPS;
    await readFrame(Math.max(0, at || 0));
  }

  // -- opening ----------------------------------------------------------------

  async function open(next, { url, file = null, at = 0 }) {
    clear();
    const mine = opened;
    source = next;
    busy = true;
    try {
      if (next.kind === 'image') {
        const picture = await bitmap(file ?? (await fetchBlob(url)));
        if (mine !== opened) {
          picture.close?.();
          return;
        }
        size = { width: picture.width, height: picture.height };
        showStill(picture);
      } else {
        await openVideo(url, mine, { caseId: next.caseId, path: next.path, at });
        if (mine !== opened) return;
      }
      if (!(size.width > 0)) throw new Error('This file has no picture to lay over the view.');
      settleView();
      busy = false;
      // what the file says of its lens, place and time: it can come after the picture
      const said = await readFacts(next, file);
      if (mine !== opened || !said) return;
      facts = said;
      const lens = lensOf();
      if (lens) view.look({ projection: 'camera', fov: lens.fov });
    } catch (failure) {
      if (mine === opened) error = failure.message;
    } finally {
      if (mine === opened) busy = false;
    }
  }

  async function readFacts(next, file) {
    try {
      if (next.caseId) {
        return await api.get(`/api/horizon/photo?case=${encodeURIComponent(next.caseId)}&path=${encodeURIComponent(next.path)}`);
      }
      if (file && next.kind === 'image') return await api.post('/api/horizon/photo', { head: await readHead(file) });
    } catch {
      // the lens is then set by hand, as for a photo that does not say it
    }
    return null;
  }

  function stopBlink() {
    if (blinkTimer) cancel(blinkTimer);
    blinkTimer = null;
    blink = false;
    blinkPhoto = true;
  }

  function blinkStep() {
    blinkPhoto = !blinkPhoto;
    blinkTimer = later(blinkStep, BLINK_MS);
  }

  const onFrameTime = (at) => Math.abs(at - (traceTime ?? at)) <= Math.max(PIN_SLACK_S, 0.5 / fps);

  function play() {
    if (!video || !playable) return;
    tracing = false;
    if (video.ended || (duration && time >= duration - 0.01)) video.currentTime = 0;
    video.play()?.catch?.(() => {});
  }

  function pause() {
    video?.pause();
  }

  function seek(at) {
    if (!source || source.kind !== 'video') return;
    const next = Math.min(Math.max(0, Number(at) || 0), duration || Number(at) || 0);
    time = next;
    if (video) {
      video.currentTime = next;
    } else if (!playable) {
      if (frameTimer) cancel(frameTimer);
      frameTimer = later(() => readFrame(next), FRAME_DELAY);
    }
    follow();
  }

  return {
    /** `{ name, kind, caseId, path }` of what is laid over the view, or null. */
    get source() {
      return source;
    },
    get busy() {
      return busy;
    },
    get error() {
      return error;
    },
    /** The picture to draw: the photo, the video's player, or the frame the app read of it. */
    get picture() {
      return video ?? still;
    },
    /** Bumped each time a new frame is on show. */
    get frame() {
      return frame;
    },
    /** Width over height of the photo, which the view's frame takes; 0 before it is known. */
    get aspect() {
      return aspect();
    },
    get size() {
      return size;
    },
    /** What the file says: `{ focal_mm, focal35_mm, focal35_worked_out, gps, taken_at }`, each when it says it. */
    get facts() {
      return facts;
    },
    /** The lens the photo says, `{ mm, fov, workedOut }`, or null. */
    get lens() {
      return lensOf();
    },
    /** Lay the photo's own lens on the view again, after a zoom. */
    useLens() {
      const lens = lensOf();
      if (lens) view.look({ projection: 'camera', fov: lens.fov });
    },

    /** How much of the photo shows over the terrain, 0 to 1. */
    get mix() {
      return mix;
    },
    setMix(share) {
      const next = Number(share);
      if (!Number.isFinite(next)) return;
      mix = Math.min(1, Math.max(0, next));
      if (blink) stopBlink();
    },
    /** What the view draws of the photo now: the share, or the blink's side. */
    get shown() {
      if (!source) return 0;
      if (blink) return blinkPhoto ? 1 : 0;
      return mix;
    },
    get blink() {
      return blink;
    },
    setBlink(on) {
      if (!on || !source) {
        stopBlink();
        return;
      }
      if (blink) return;
      blink = true;
      blinkPhoto = false;
      blinkTimer = later(blinkStep, BLINK_MS);
    },

    /** A photo or a video of the case: `{ path, kind, title?, filename? }`; a video can open at a moment. */
    openCase(caseId, item, { time: at = 0 } = {}) {
      const kind = item.kind === 'video' ? 'video' : item.kind === 'image' ? 'image' : kindOf(item.path ?? '');
      if (!kind) {
        error = 'Only a photo or a video can be laid over the view.';
        return Promise.resolve();
      }
      const name = item.title || item.filename || String(item.path).split('/').pop();
      return open({ name, kind, caseId, path: item.path }, { url: fileUrl(caseId, item.path), at });
    },

    /** A file from the analyst's computer, kept in this browser only (no case open). */
    openFile(file) {
      const kind = kindOf(file.name ?? '', file.type ?? '');
      if (!kind) {
        error = 'Only a photo or a video can be laid over the view.';
        return Promise.resolve();
      }
      const url = objectUrl(file);
      const opening = open({ name: file.name, kind, caseId: null, path: null }, { url, file: kind === 'image' ? file : null });
      ownUrl = url;
      return opening;
    },

    /** Whether a dropped or picked file is something that can be laid over the view. */
    accepts(file) {
      return Boolean(kindOf(file?.name ?? '', file?.type ?? ''));
    },

    /** Take the photo away; the ridge lines go back to how they were. */
    remove() {
      const lines = linesBefore;
      linesBefore = null;
      clear();
      if (lines !== null) view.setLines(lines);
    },

    // -- the trace ----------------------------------------------------------

    /** Whether a drag draws along the photo's skyline rather than turning the view. */
    get tracing() {
      return tracing;
    },
    setTracing(on) {
      tracing = Boolean(on) && Boolean(source);
      if (tracing && video && !video.paused) video.pause();
    },
    /** The strokes drawn, each `[{ u, v }]` across and down the photo, 0 to 1. */
    get strokes() {
      return strokes;
    },
    /** The moment of the video the trace was drawn on, null for a photo. */
    get traceTime() {
      return traceTime;
    },
    /** Whether the trace belongs to what is on show: always for a photo, at its moment for a video. */
    get traceShown() {
      return strokes.length > 0 && (source?.kind !== 'video' || onFrameTime(time));
    },
    addStroke(stroke) {
      if (!source || stroke.length < 2) return;
      if (source.kind === 'video') {
        if (video && !video.paused) video.pause();
        // a stroke on another moment starts the trace of that moment
        if (!strokes.length || !onFrameTime(time)) {
          strokes = [];
          traceTime = time;
        }
      }
      strokes = [...strokes, stroke];
    },
    undoStroke() {
      strokes = strokes.slice(0, -1);
      if (!strokes.length) traceTime = null;
    },
    clearTrace() {
      strokes = [];
      traceTime = null;
    },

    // -- a video's time -----------------------------------------------------

    /** Seconds into the video on show, its length, and how many frames a second it has. */
    get time() {
      return time;
    },
    get duration() {
      return duration;
    },
    get fps() {
      return fps;
    },
    get playing() {
      return playing;
    },
    /** Whether the browser plays the video itself; if not, the app reads the frame at each moment. */
    get playable() {
      return playable;
    },
    play,
    pause,
    togglePlay() {
      if (playing) pause();
      else play();
    },
    /** Go to a moment, seconds from the start. */
    seek,
    /** A frame on or back. */
    step(frames) {
      pause();
      seek(time + frames / (fps || DEFAULT_FPS));
    },
    /** Back to the moment the trace was drawn on. */
    seekTrace() {
      if (traceTime != null) seek(traceTime);
    },

    /** The view's alignment kept at each moment pinned: `[{ time, heading, tilt, roll, fov }]`. */
    get pins() {
      return pins;
    },
    /** Keep the view's alignment at the moment on show. */
    pin() {
      if (source?.kind !== 'video') return;
      pins = pinAt(pins, time, view.camera);
    },
    unpin(at) {
      pins = pins.filter((pin) => Math.abs(pin.time - at) > PIN_SLACK_S);
    },
    clearPins() {
      pins = [];
    },
    /** Whether a pin stands at the moment on show. */
    get pinnedHere() {
      return pins.some((pin) => Math.abs(pin.time - time) <= PIN_SLACK_S);
    },

    destroy() {
      clear();
    },
  };
}
