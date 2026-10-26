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
 *
 * A wide picture, or one exported from a collage Azimut stitched on a cylinder,
 * may be read as a panorama (`hints.picture`): the view then draws its strip,
 * the same degrees per pixel all along, as wide as the stitch says or as the
 * picture's shape suggests. A stitched collage is read so unless the analyst
 * says otherwise. A panorama turns with the terrain alone: it has no loupe, no
 * roll, no curve and no corners to pull.
 *
 * A drag and the wheel move one thing at a time (`moves`): the terrain under
 * the photo, the photo over the terrain (the view turns and widens its lens
 * the other way, so the terrain stays put), or both together. Moving both
 * holds the photo to the terrain (`locked`), as once it is matched: the view
 * then moves over the terrain with the photo on it, and nothing that would
 * move one against the other is taken (the lens, the curve, the corners; the
 * view's own fields and the gestures that turn, roll or raise hold too).
 *
 * A loupe magnifies the photo and the terrain under it together, so looking
 * closer never moves the match; the terrain under it is sharpened as for a
 * narrower lens. It may go wider than the photo and past its edges, the
 * terrain round the photo then showing. A pivot, a point of the photo, is what the view turns about
 * when it is rolled: a summit already matched stays matched.
 *
 * A lens that curves straight lines (a wide one, an action camera) is undone
 * by a bend (`setBend`): the photo is drawn straightened over the terrain.
 * Its four corners can also be pulled (`warp`), as a collage's piece is, to
 * square a photo taken at a slant or squeeze a stretched one back: the view
 * is then handed the photo already drawn between them (lib/horizon/
 * warpPicture.js), lighter while a corner is in the hand. The trace stays on
 * the photo's own pixels, which its colours are read from, and is pulled and
 * straightened where it is shown and measured (`strokesSeen`); what the view
 * hands over (a stroke, a rub, a corner) is in the frame as it shows.
 *
 * Looking from a place a search found, the photo is laid as the search read it
 * (`layAsSearched`, lib/horizon/laid.js): a collage's frames or cut pieces
 * where the search put each, a selfie found mirrored flipped. The view is
 * handed it already laid, and the trace it draws and measures follows
 * (`strokesShown`); Find still reads the trace as drawn. Taking a tool out,
 * pulling a corner or bending the photo lays it flat again (`layFlat`).
 *
 * The trace can be helped by the photo's own colours (lib/horizon/skyline.js):
 * a stroke snaps onto the sky's edge near it, and the whole skyline can be
 * found at once. Both are read in this browser, off the picture on show, and
 * both are a change to the trace like a stroke, taken back the same way.
 */
import { fileUrl } from '../../../lib/fileUrl.js';
import { fovFromFocal35 } from '../../../lib/horizon/camera.js';
import { cleanHints, NO_HINTS, panoramaOffered, panoramaWidth } from '../../../lib/horizon/hints.js';
import {
  BEND_MAX,
  bendShape,
  bent,
  cameraAt,
  clampCorner,
  clampLoupe,
  erasedFrom,
  FLAT_CORNERS,
  photoGrid,
  isFlat,
  NO_LOUPE,
  panLoupe,
  pinAt,
  PIN_SLACK_S,
  straightened,
  unwarped,
  warped,
  zoomLoupe,
} from '../../../lib/horizon/overlay.js';
import {
  addBent,
  addCut,
  cleanMarks,
  clearBadges,
  cutAt,
  farBadges,
  bentIndex,
  inBent,
  innerByShape,
  keyBadges,
  lineAt,
  liesUnder,
  marksAfter,
  NO_MARKS,
  nextLine,
  pairBadges,
  pieceOf,
  removeBent,
  removeCut,
  setFar,
  setInner,
  setSea,
  toggleClear,
  toggleKey,
  togglePair,
} from '../../../lib/horizon/traceMarks.js';
import { skylineField, smoothPlanes, snapPath, traceSkyline } from '../../../lib/horizon/skyline.js';
import { paintLaid, paintWarped } from '../../../lib/horizon/warpPicture.js';

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
/** Changes to the trace Ctrl+Z can take back. */
export const UNDO_STEPS = 50;
/** How near a click must fall to a stroke or a cut to pick it, in screen pixels. */
const PICK_PX = 10;
/** How far a stroke snaps, in screen pixels either side of it. */
export const SNAP_PX = 12;
/** The long side a photo is read at to find its skyline, then to set it to the pixel. */
export const DETECT_PX = 1024;
export const REFINE_PX = 2048;

/** Part of a picture (`{ x, y, width, height }` of its pixels) as RGBA bytes, `scale` times its size. */
export function readPixels(picture, crop, scale) {
  const width = Math.max(1, Math.round(crop.width * scale));
  const height = Math.max(1, Math.round(crop.height * scale));
  const canvas =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingQuality = 'high';
  context.drawImage(picture, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
  return { width, height, data: context.getImageData(0, 0, width, height).data };
}

/** A photo file as a picture for the GPU, oriented as its EXIF says and no larger than the view needs. */
export async function openBitmap(blob, make = (...args) => createImageBitmap(...args)) {
  const whole = await make(blob);
  // read before closing: a closed bitmap says it is 0 × 0
  const { width, height } = whole;
  const side = Math.max(width, height);
  if (side <= PHOTO_MAX_PX) return whole;
  const scale = PHOTO_MAX_PX / side;
  whole.close?.();
  return make(blob, {
    resizeWidth: Math.max(1, Math.round(width * scale)),
    resizeHeight: Math.max(1, Math.round(height * scale)),
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

/** A point of the photo, 0 to 1, to a millionth. */
const unit = (value) => Math.round(Math.min(1, Math.max(0, value)) * 1e6) / 1e6;
const unitPoint = (p) => ({ u: unit(p.u), v: unit(p.v) });
const roundPoint = (p) => ({ u: Math.round(p.u * 1e6) / 1e6, v: Math.round(p.v * 1e6) / 1e6 });

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
  pixels = readPixels,
  objectUrl = (file) => URL.createObjectURL(file),
  dropUrl = (url) => URL.revokeObjectURL(url),
  later = setTimeout,
  cancel = clearTimeout,
  nextFrame = (fn) => requestAnimationFrame(fn),
  warpPicture = paintWarped,
  layPicture = paintLaid,
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
  let erasing = $state(false);
  let traceHidden = $state(false);
  let strokes = $state.raw([]);
  /** What is marked beside the skyline (lib/horizon/traceMarks.js): each stroke's id, inner edges, pairs, cuts. */
  let marks = $state.raw(NO_MARKS);
  /** The pen out: along the `sky`'s edge, or an inner `ridge` seen against farther land. */
  let pen = $state('sky');
  /** Whether a stroke drawn snaps onto the photo's nearest edge; Alt held does the other. */
  let magnet = $state(true);
  /** Whether the trace's details show while no tool is out: the terrain's margin, the cuts, the pairs' letters. */
  let details = $state(false);
  /** Pairing strokes, the one in front then the one behind it; `front` is the one picked first. */
  let linking = $state(false);
  let front = $state(null);
  /** Cutting a collage in pieces: a click lays a cut across the photo, or takes one away. */
  let cutting = $state(false);
  /** Reading the lens off the video's pan: `{ busy, error }` while asked or failed, null otherwise. */
  let measuring = $state.raw(null);
  let measuredAsk = 0;
  /** Saying how far lines stand: the distances picked (lib/horizon/traceMarks.js DISTANCE_BANDS), laid on the line clicked. */
  let distancing = $state(false);
  let farPicked = $state.raw(['b1']);
  /** Saying a skyline line has only sky above it: a click on the line, again to take it back. */
  let clearing = $state(false);
  /** Saying a skyline line matters most: a click on the line, again to take it back. */
  let keying = $state(false);
  /** Brushing over the parts of the picture that are bent; the path of the brush being drawn, on the photo. */
  let bending = $state(false);
  let brushing = $state.raw(null);
  let traceTime = $state(null);
  // the trace as it was before each change, newest last
  let history = $state.raw([]);
  let rubbing = false;
  let pins = $state.raw([]);
  let time = $state(0);
  let duration = $state(0);
  let fps = $state(DEFAULT_FPS);
  let playing = $state(false);
  let playable = $state(true);
  // bumped each time a new frame of the video is on show, so the view draws it
  let frame = $state(0);
  let loupe = $state.raw(NO_LOUPE);
  let pivot = $state.raw(null);
  let bend = $state(0);
  /** The photo's corners in the frame once pulled, or null where it lies untouched. */
  let warp = $state.raw(null);
  let warping = $state(false);
  /** A corner in the hand: the pulled photo is drawn lighter until it is let go. */
  let pulling = $state(false);
  /** The photo laid as a search read it (lib/horizon/laid.js), or null where it lies as taken. */
  let asSearched = $state.raw(null);
  /** The photo held to the terrain: nothing moves one against the other until it is let go. */
  let locked = $state(false);
  /** What a drag and the wheel move while the photo is not held to the terrain: `terrain` or `photo`. */
  let moving = $state('terrain');
  /** What the analyst knows about the photo, told to Fit (lib/horizon/hints.js). */
  let hints = $state.raw(NO_HINTS);
  /** Whether the analyst (or a saved view) said what kind of picture it is: a stitched collage is a panorama until then. */
  let pictureSaid = false;
  /** The cut of the terrain's skyline the last Fit found the trace on, metres, or null for the whole turn. */
  let reachFound = $state(null);

  let opened = 0;
  let blinkTimer = null;
  let frameTimer = null;
  let framesAsked = 0;
  let linesBefore = null;
  let ownUrl = '';

  const aspect = () => (size.width > 0 && size.height > 0 ? size.width / size.height : 0);
  const shape = () => bendShape(aspect() || 4 / 3);
  /**
   * A point of the frame as the photo's own pixel, and back. The view curves
   * the picture it is handed, and a pulled photo is handed over already
   * pulled: a point of the frame goes through the curve, then back through
   * the corners.
   */
  function toPhoto(p) {
    const curved = bend ? bent(p, bend, shape()) : p;
    const own = warp ? unwarped(curved, warp) : curved;
    return bend || warp ? unitPoint(own) : p;
  }
  function toSeen(p) {
    const pulled = warp ? warped(p, warp) : p;
    const shown = bend ? straightened(pulled, bend, shape()) : pulled;
    // a pulled corner may take the photo past the frame: a point shown there is not clamped
    if (warp) return roundPoint(shown);
    return bend ? unitPoint(shown) : p;
  }
  const seen = $derived(bend || warp ? strokes.map((stroke) => stroke.map(toSeen)) : strokes);
  /** A point of the straightened photo where it shows once laid as the search read it. */
  const shownAt = (p, cell) => (asSearched ? (asSearched.place(p.u, p.v, cell) ?? p) : p);
  /** The strokes where the view shows them: on the photo laid as the search read it, else as straightened. */
  const shown = $derived(asSearched ? seen.map((stroke) => stroke.map((p) => shownAt(p))) : seen);
  /** The skyline's strokes alone, straightened: what Fit lays on the terrain's skyline. */
  const skySeen = $derived(marks.inner.length ? seen.filter((_, i) => !marks.inner.includes(marks.lines[i])) : seen);
  /** Each cut across the straightened photo, top and bottom (`[{ u, v }, { u, v }]`). */
  const cutsSeen = $derived(marks.cuts.map((u) => [toSeen({ u, v: 0 }), toSeen({ u, v: 1 })]));
  /** Each cut where the view shows it, the side before the seam laid by its own piece. */
  const cutsShown = $derived(
    asSearched ? cutsSeen.map((cut) => cut.map((p) => shownAt(p, { u: p.u - 1e-6, v: p.v }))) : cutsSeen
  );
  /** The pairs' letters where the view shows them, on its strokes (`pairBadges`). */
  const badges = $derived(marks.pairs.length ? pairBadges(shown, marks) : []);
  /** Each line's distance where the view shows it, on its strokes (`farBadges`). */
  const farSeen = $derived(marks.far?.length ? farBadges(shown, marks) : []);
  /** Each line said to have only sky above, where the view shows it (`clearBadges`). */
  const clearSeen = $derived(marks.clear?.length ? clearBadges(shown, marks) : []);
  /** Each key line, where the view shows it (`keyBadges`). */
  const keySeen = $derived(marks.key?.length ? keyBadges(shown, marks) : []);
  /** The parts brushed as bent on the straightened photo, the one being brushed last: `{ path, r }`. */
  const bentSeen = $derived(
    [...(marks.bent ?? []), ...(brushing ? [brushing] : [])].map((zone) => ({ ...zone, path: zone.path.map(toSeen) }))
  );
  /** The same where the view shows them, on the photo laid as the search read it. */
  const bentLaid = $derived(asSearched ? bentSeen.map((zone) => ({ ...zone, path: zone.path.map((p) => shownAt(p)) })) : bentSeen);
  /** The photo's grid as it shows, while its corners are out to be pulled (`photoGrid`). */
  const grid = $derived(warping ? photoGrid(toSeen) : []);
  /** The photo drawn between its pulled corners, which the view is handed in its place. */
  const pulledPicture = $derived(warp && still && source?.kind === 'image' ? warpPicture(still, warp, { fast: pulling }) : null);
  /** The photo laid as the search read it, which the view is handed in its place. */
  const laidPicture = $derived(asSearched && still && source?.kind === 'image' ? layPicture(still, asSearched) : null);

  /** The view as the photo was taken: its lens, through the frame a photo is, with the lines over it. */
  function settleView() {
    if (linesBefore === null) linesBefore = view.lines;
    view.setLines(true);
    lookThrough();
  }

  /**
   * How many degrees the picture spans as its stitch says: a collage Azimut
   * stitched whole, or one read frame by frame (`facts.frames`); null when it says none.
   */
  function stripOf() {
    if (facts.panorama?.degrees > 0) return facts.panorama;
    return facts.frames?.span > 0 ? { degrees: facts.frames.span, collage: facts.frames.collage } : null;
  }

  /** The view through the picture's own kind: a panorama's strip, else a camera with the photo's lens. */
  function lookThrough() {
    if (hints.picture === 'panorama') {
      view.look({ projection: 'panorama', fov: panoramaWidth({ aspect: aspect(), stitched: stripOf() }), roll: 0 });
      return;
    }
    const lens = lensOf();
    if (lens) view.look({ projection: 'camera', fov: lens.fov });
    else if (view.camera.projection !== 'camera') view.look({ projection: 'camera', fov: Math.min(view.camera.fov, 120) });
  }

  /** What a panorama cannot have put away: the loupe, the hold, the curve, the corners. */
  function asPanorama() {
    locked = false;
    moving = 'terrain';
    warping = false;
    pulling = false;
    warp = null;
    bend = 0;
    pivot = null;
    if (loupe !== NO_LOUPE) setLoupe(NO_LOUPE);
  }

  /**
   * The lens the picture says: one measured on the video, `{ fov, measured, at }`;
   * a photo's from its EXIF, `{ mm, fov, workedOut }`; a panorama's from its
   * stitch, `{ fov, stitched: true }`; null when it says none.
   */
  function lensOf() {
    const ratio = aspect();
    // measured on the video's pan: the photo's own lens, as a focal would say it
    if (hints.lens?.fov > 0 && hints.picture !== 'panorama') return { fov: hints.lens.fov, measured: true, at: hints.lens.at };
    if (hints.picture === 'panorama') {
      const stitched = stripOf();
      return stitched?.degrees > 0 ? { fov: panoramaWidth({ aspect: ratio, stitched }), stitched: true } : null;
    }
    const mm = facts.focal35_mm;
    if (!(mm > 0) || !(ratio > 0)) return null;
    return { mm, fov: fovFromFocal35(mm, ratio), workedOut: Boolean(facts.focal35_worked_out) };
  }

  function offeredPanorama() {
    return panoramaOffered({ kind: source?.kind, aspect: aspect(), stitched: facts.panorama });
  }

  function setLoupe(next) {
    loupe = next;
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
    erasing = false;
    linking = false;
    cutting = false;
    distancing = false;
    clearing = false;
    keying = false;
    bending = false;
    brushing = null;
    front = null;
    pen = 'sky';
    traceHidden = false;
    strokes = [];
    marks = NO_MARKS;
    traceTime = null;
    history = [];
    rubbing = false;
    pins = [];
    time = 0;
    duration = 0;
    fps = DEFAULT_FPS;
    playing = false;
    playable = true;
    mix = 1;
    pivot = null;
    bend = 0;
    warp = null;
    warping = false;
    pulling = false;
    asSearched = null;
    locked = false;
    moving = 'terrain';
    hints = NO_HINTS;
    pictureSaid = false;
    reachFound = null;
    if (loupe !== NO_LOUPE) setLoupe(NO_LOUPE);
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
      // a collage Azimut stitched is a panorama of known width, unless the analyst said otherwise
      if (said.panorama && !pictureSaid && offeredPanorama()) {
        hints = { ...hints, picture: 'panorama' };
        asPanorama();
        lookThrough();
        return;
      }
      const lens = lensOf();
      if (lens) view.look({ projection: hints.picture === 'panorama' ? 'panorama' : 'camera', fov: lens.fov });
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
  const traceOnShow = () => strokes.length > 0 && (source?.kind !== 'video' || onFrameTime(time));

  /** The trace as it is now, kept so a change to it can be taken back. */
  function keep() {
    history = [...history.slice(1 - UNDO_STEPS), { strokes, traceTime, marks }];
  }

  /** Every tool on the photo put away but the one about to come out. */
  function toolsAway() {
    tracing = false;
    erasing = false;
    linking = false;
    cutting = false;
    distancing = false;
    clearing = false;
    keying = false;
    bending = false;
    brushing = null;
    front = null;
  }

  /** The picture on show, and its own size in pixels: a frame the app read can be smaller than the video. */
  function shownPicture() {
    const picture = video ?? still;
    if (!picture) return null;
    const width = picture.videoWidth || picture.width || size.width;
    const height = picture.videoHeight || picture.height || size.height;
    return width > 0 && height > 0 ? { picture, width, height } : null;
  }

  /**
   * A line on the photo (`[{ u, v }]`) moved onto the sky's edge near it,
   * `reach` of the picture's pixels either side, read `scale` times the
   * picture's size around the line only.
   */
  function snapLine(shown, line, reach, scale) {
    const { picture, width: w, height: h } = shown;
    const xs = line.map((p) => p.u * w);
    const ys = line.map((p) => p.v * h);
    const margin = reach + 4 / scale;
    const left = Math.max(0, Math.floor(Math.min(...xs) - margin));
    const top = Math.max(0, Math.floor(Math.min(...ys) - margin));
    const right = Math.min(w, Math.ceil(Math.max(...xs) + margin));
    const bottom = Math.min(h, Math.ceil(Math.max(...ys) + margin));
    const crop = { x: left, y: top, width: right - left, height: bottom - top };
    if (crop.width < 2 || crop.height < 2) return line;
    const image = pixels(picture, crop, scale);
    const sx = image.width / crop.width;
    const sy = image.height / crop.height;
    const points = line.map((p) => ({ x: (p.u * w - left) * sx, y: (p.v * h - top) * sy }));
    const moved = snapPath(smoothPlanes(image), points, { reach: Math.max(2, Math.round(reach * sx)) });
    return moved.map((p) => ({ u: unit((left + p.x / sx) / w), v: unit((top + p.y / sy) / h) }));
  }

  function play() {
    if (!video || !playable) return;
    toolsAway();
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
    /** The picture to draw: the photo (between its corners once they are pulled, or laid as a search read it), the video's player, or the frame the app read of it. */
    get picture() {
      return video ?? pulledPicture ?? laidPicture ?? still;
    },
    /** The photo laid as a search read it (`{ kind }`: frames, pieces or mirrored), or null where it lies as taken. */
    get asSearched() {
      return asSearched;
    },
    /** Lay the photo as a search read it (lib/horizon/laid.js); only a photo lying as taken, its curve and corners untouched, is laid. */
    layAsSearched(laid) {
      asSearched = laid?.place && source?.kind === 'image' && !bend && !warp ? laid : null;
    },
    /** The photo back as taken. */
    layFlat() {
      asSearched = null;
    },
    /** The photo as it was taken, or the video's frame on show: what a trace's points are measured on. */
    get rawPicture() {
      return video ?? still;
    },
    /** A point of the photo as it was taken (`{ u, v }`), in the frame as the view shows it: what a stroke is handed in. */
    seenOf(point) {
      return toSeen(point);
    },
    /** …and back: a point of the frame as it shows, as the photo's own pixel, where a mark on it is kept. */
    photoOf(point) {
      return toPhoto(point);
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
    /** What the analyst knows about the photo (lib/horizon/hints.js): each optional, none by default. */
    get hints() {
      return hints;
    },
    /** Reading the lens off the video's pan: `{ busy, error }`, or null when not asked. */
    get measuring() {
      return measuring;
    },
    /**
     * Read the lens off the video's pan around the moment on show
     * (`/api/horizon/lens`), kept with what is known of the photo; says why
     * when the frames do not tell it.
     */
    async measureLens() {
      if (source?.kind !== 'video' || !source.caseId) return;
      const at = time ?? 0;
      const mine = (measuredAsk += 1);
      measuring = { busy: true, error: '' };
      try {
        const read = await api.post('/api/horizon/lens', { case: source.caseId, path: source.path, time: at });
        if (mine !== measuredAsk) return;
        hints = cleanHints({ ...hints, lens: { fov: read.fov, at } });
        measuring = null;
        lookThrough();
      } catch (failure) {
        if (mine === measuredAsk) measuring = { busy: false, error: failure.message || 'The frames do not tell the lens' };
      }
    },
    /** The lens measured let go: the zoom words again. */
    forgetLens() {
      measuredAsk += 1;
      measuring = null;
      const { lens: _lens, ...rest } = hints;
      hints = cleanHints(rest);
    },
    /** Say more, or less, about the photo: only the hints named change. */
    setHints(change) {
      if (!source) return;
      const before = hints.picture;
      hints = cleanHints({ ...hints, ...change });
      if (hints.picture === 'panorama' && !offeredPanorama()) hints = { ...hints, picture: 'photo' };
      if ('picture' in (change ?? {})) pictureSaid = true;
      if (hints.picture === before) return;
      if (hints.picture === 'panorama') asPanorama();
      lookThrough();
    },
    /** Whether the picture may be read as a panorama: any image, the analyst's call. */
    get panoramaOffered() {
      return offeredPanorama();
    },
    /** Whether it is read as one now. */
    get isPanorama() {
      return Boolean(source) && hints.picture === 'panorama';
    },
    /** What the stitch says of a collage's picture: `{ degrees, stitched, by_hand, warp, collage }`, or null. */
    get stitched() {
      return facts.panorama ?? null;
    },
    /**
     * A collage of a pan Find reads frame by frame, each through its own camera
     * (api/horizon.py photo facts `frames`: `{ collage, frames, stitched, lens,
     * span }`): null for any other picture, or once a curve or pulled corners
     * lie over it, which the search then reads as one photo.
     */
    get framesRead() {
      return facts.frames && !bend && !warp ? facts.frames : null;
    },
    /**
     * How far out the terrain's skyline is read against the trace, metres, or
     * null for the whole turn: the reach the analyst set, else the one the last
     * Fit found the trace on.
     */
    get reach() {
      if (hints.reach === 'all') return null;
      if (Number.isFinite(hints.reach)) return hints.reach;
      return reachFound;
    },
    /** The reach a Fit found the trace on, read against from then on while how far the photo sees is left to Fit. */
    get reachFound() {
      return reachFound;
    },
    setReachFound(reach) {
      reachFound = Number.isFinite(reach) ? reach : null;
    },

    /** Lay the photo's own lens on the view again, after a zoom. */
    useLens() {
      if (locked) return;
      const lens = lensOf();
      if (lens) view.look({ projection: hints.picture === 'panorama' ? 'panorama' : 'camera', fov: lens.fov });
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

    // -- looking closer -----------------------------------------------------

    /** How much the photo is magnified and which point of it (0 to 1) is in the middle: `{ zoom, x, y }`. */
    get loupe() {
      return loupe;
    },
    /**
     * Magnify by a factor about a point of the screen (CSS pixels of a frame
     * this size), which stays put: wider than the photo too, the terrain
     * round it then showing.
     */
    zoomLoupe(factor, at, size) {
      if (!source || !(size?.width > 0)) return;
      setLoupe(zoomLoupe(loupe, factor, at, size));
    },
    /** Move the loupe with the hand, `dx`, `dy` CSS pixels, past the photo's own edges too. */
    panLoupe(dx, dy, size) {
      if (!source || !(size?.width > 0)) return;
      setLoupe(panLoupe(loupe, dx, dy, size));
    },
    /** Lay a loupe the view worked out (the photo moved over a terrain that stays put). */
    setLoupe(next) {
      if (!source || !next) return;
      setLoupe(clampLoupe(next));
    },
    /** The whole photo in the frame again. */
    fitLoupe() {
      if (loupe !== NO_LOUPE) setLoupe(NO_LOUPE);
    },

    /** The point of the photo a roll turns about, `{ u, v }`, or null for the middle of the screen. */
    get pivot() {
      return pivot;
    },
    setPivot(point) {
      pivot = source && point && hints.picture !== 'panorama' ? { u: Math.min(1, Math.max(0, point.u)), v: Math.min(1, Math.max(0, point.v)) } : null;
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
      const next = Boolean(on) && Boolean(source);
      if (next) toolsAway();
      if (next) asSearched = null;
      tracing = next;
      if (!tracing) return;
      warping = false;
      traceHidden = false;
      if (video && !video.paused) video.pause();
    },
    /** Whether a drag rubs the trace out where it goes. */
    get erasing() {
      return erasing;
    },
    setErasing(on) {
      const next = Boolean(on) && Boolean(source);
      if (next) toolsAway();
      if (next) asSearched = null;
      erasing = next;
      if (!erasing) return;
      warping = false;
      traceHidden = false;
      if (video && !video.paused) video.pause();
    },
    /** Whether the trace is kept out of sight; it still counts for the gap and the fit. */
    get traceHidden() {
      return traceHidden;
    },
    setTraceHidden(on) {
      traceHidden = Boolean(on);
      if (traceHidden) toolsAway();
    },
    /** The strokes drawn, each `[{ u, v }]` across and down the photo's own pixels, 0 to 1. */
    get strokes() {
      return strokes;
    },
    /** The strokes where they show on the straightened photo: what Find reads and a search is asked with. */
    get strokesSeen() {
      return seen;
    },
    /** The strokes where the view shows them, on the photo laid as a search read it: what is drawn and measured against the terrain. */
    get strokesShown() {
      return shown;
    },

    /** How much the lens's curve is undone, −BEND_MAX (barrel) to BEND_MAX (pincushion); 0 for none. */
    get bend() {
      return bend;
    },
    setBend(k) {
      const next = Number(k);
      if (!source || locked || hints.picture === 'panorama' || !Number.isFinite(next)) return;
      bend = Math.round(Math.min(BEND_MAX, Math.max(-BEND_MAX, next)) * 1000) / 1000;
      if (bend) asSearched = null;
    },
    /** The photo's shape as the curve is measured in (`bendShape`). */
    get bendShape() {
      return shape();
    },
    /** Whether the photo's corners are out to be pulled: a photo's, not a video's. */
    get warping() {
      return warping;
    },
    setWarping(on) {
      warping = Boolean(on) && source?.kind === 'image' && !locked && hints.picture !== 'panorama';
      if (!warping) return;
      toolsAway();
      asSearched = null;
    },
    /** A corner taken in the hand (`true`) or let go: the photo is drawn finely again once it is. */
    setPulling(on) {
      pulling = Boolean(on);
    },
    /** The photo's four corners in the frame, top left first and clockwise; untouched, the frame's own. */
    get corners() {
      return warp ?? FLAT_CORNERS;
    },
    /** Whether a corner has been pulled. */
    get warped() {
      return Boolean(warp);
    },
    /** The photo's grid in the frame as it shows (its corners and its curve), while the corners are out; none otherwise. */
    get grid() {
      return grid;
    },
    /** All four corners at once (`[{ u, v }]` in the frame), each kept within reach of it. */
    setCorners(next) {
      if (source?.kind !== 'image' || locked || hints.picture === 'panorama' || next?.length !== 4 || !next.every((p) => Number.isFinite(p?.u) && Number.isFinite(p?.v))) return;
      const kept = next.map((p) => roundPoint(clampCorner(p)));
      warp = isFlat(kept) ? null : kept;
      if (warp) asSearched = null;
    },
    /** One corner pulled to a point of the frame. */
    setCorner(index, point) {
      if (!(index >= 0 && index < 4)) return;
      const next = [...(warp ?? FLAT_CORNERS)];
      next[index] = point;
      this.setCorners(next);
    },
    /** The photo back in the frame, square. */
    resetWarp() {
      if (!locked) warp = null;
    },
    /** Whether the photo is held to the terrain. */
    get locked() {
      return locked;
    },
    /** Hold the photo to the terrain, or let it go; holding it puts the corners away. The photo stays where it shows. */
    setLocked(on) {
      locked = Boolean(on) && Boolean(source) && hints.picture !== 'panorama';
      if (!locked) return;
      warping = false;
      pulling = false;
    },
    /**
     * What a drag and the wheel move: `terrain` under the photo, the `photo`
     * over the terrain, or `both` together, the photo held to the terrain.
     */
    get moves() {
      return locked ? 'both' : moving;
    },
    setMoves(which) {
      if (!source || !['terrain', 'photo', 'both'].includes(which)) return;
      // a panorama turns with the terrain alone
      if (hints.picture === 'panorama' && which !== 'terrain') return;
      if (which === 'both') {
        this.setLocked(true);
        return;
      }
      moving = which;
      this.setLocked(false);
    },
    /**
     * A press on the hand beside the `photo` or the `terrain`: one hand lit
     * says that side moves, both lit move both. An unlit hand lights beside
     * the other; a lit one goes out and the other keeps moving, so the hand a
     * drag holds is never empty, and a press on the only one lit hands over.
     */
    pressHand(side) {
      if (!['terrain', 'photo'].includes(side)) return;
      const other = side === 'photo' ? 'terrain' : 'photo';
      const moves = this.moves;
      this.setMoves(moves === other ? 'both' : other);
    },
    /** The moment of the video the trace was drawn on, null for a photo. */
    get traceTime() {
      return traceTime;
    },
    /** Whether the trace belongs to what is on show: always for a photo, at its moment for a video. */
    get traceShown() {
      return traceOnShow();
    },
    /**
     * A stroke drawn along the skyline, in the straightened frame. With
     * `snap`, it is first moved onto the sky's edge within `SNAP_PX` screen
     * pixels of it, the photo being `scale` (`{ width, height }`) big on
     * screen; where no edge is clear it stays as drawn.
     */
    addStroke(drawn, { snap = false, scale = null } = {}) {
      if (!source || drawn.length < 2) return;
      let stroke = drawn.map(toPhoto);
      const shown = snap && scale?.width > 0 ? shownPicture() : null;
      if (shown) {
        // the reach is the screen's; the picture is read at twice the screen's sharpness, its own at most
        const perScreen = shown.width / scale.width;
        try {
          stroke = snapLine(shown, stroke, SNAP_PX * perScreen, Math.min(1, 2 / perScreen));
        } catch {
          // a picture the browser will not read back: the stroke as drawn
        }
      }
      keep();
      traceHidden = false;
      if (source.kind === 'video') {
        if (video && !video.paused) video.pause();
        // a stroke on another moment starts the trace of that moment
        if (!strokes.length || !onFrameTime(time)) {
          strokes = [];
          marks = cleanMarks({ cuts: marks.cuts }, 0);
          traceTime = time;
        }
      }
      const id = nextLine(marks.lines);
      let next = { ...marks, lines: [...marks.lines, id] };
      if (pen === 'ridge' || liesUnder(stroke, strokes)) {
        // drawn as a ridge, or lying under the trace there: nothing under a line is the sky's edge
        next = setInner(next, id, true);
      } else {
        if (pen === 'sea') next = setSea(next, id, true);
        // a skyline drawn over strokes takes them for the ridges in front of it
        strokes.forEach((one, i) => {
          if (!next.inner.includes(next.lines[i]) && liesUnder(one, [stroke])) next = setInner(next, next.lines[i], true);
        });
      }
      strokes = [...strokes, stroke];
      marks = next;
    },
    /**
     * Rub out what lies within `radius` screen pixels of a path drawn on the
     * straightened frame (`[{ u, v }]`), the photo shown `scale` big on
     * screen. One drag of
     * the rubber is one change to take back: `beginErase` before it,
     * `endErase` after.
     */
    beginErase() {
      if (rubbing) return;
      rubbing = true;
      keep();
    },
    eraseAlong(path, radius, scale) {
      if (!traceOnShow()) return;
      const left = erasedFrom(strokes, path.map(toPhoto), radius, scale);
      if (left.strokes === strokes) return;
      marks = marksAfter(marks, left.from);
      strokes = left.strokes;
      if (!strokes.length) traceTime = null;
    },
    endErase() {
      if (!rubbing) return;
      rubbing = false;
      // a drag that rubbed nothing out leaves nothing to take back
      const last = history.at(-1);
      if (last && last.strokes === strokes) history = history.slice(0, -1);
    },
    /**
     * The skyline found in the picture on show, from the colours either side
     * of it, laid as the trace in place of the one there (a change to take
     * back like any other). Says `{ found }`, the number of lines laid, 0 when
     * no edge stood out, or `{ error }`.
     */
    detectSkyline() {
      const shown = source ? shownPicture() : null;
      if (!shown) return { found: 0 };
      if (video && !video.paused) video.pause();
      try {
        const long = Math.max(shown.width, shown.height);
        const coarse = Math.min(1, DETECT_PX / long);
        const image = pixels(shown.picture, { x: 0, y: 0, width: shown.width, height: shown.height }, coarse);
        const lines = traceSkyline(skylineField(image)).map((line) =>
          line.map((p) => ({ u: unit(p.x / image.width), v: unit(p.y / image.height) }))
        );
        if (!lines.length) return { found: 0 };
        // found on a light read of the photo, then set to the pixel on a sharper one
        const fine = Math.min(1, REFINE_PX / long);
        const reach = 2.5 / coarse;
        const found = fine > coarse ? lines.map((line) => snapLine(shown, line, reach, fine)) : lines;
        keep();
        strokes = found;
        traceTime = source.kind === 'video' ? time : null;
        marks = cleanMarks({ cuts: marks.cuts }, found.length);
        traceHidden = false;
        toolsAway();
        return { found: found.length };
      } catch {
        return { error: 'This browser would not read the picture.' };
      }
    },

    /** Whether there is a change to the trace to take back. */
    get canUndo() {
      return history.length > 0;
    },
    /** Take the last change to the trace back: a stroke, a rub or a clear. */
    undoStroke() {
      const last = history.at(-1);
      if (!last) return;
      history = history.slice(0, -1);
      strokes = last.strokes;
      marks = last.marks ?? cleanMarks(NO_MARKS, strokes.length);
      traceTime = last.traceTime;
      front = null;
    },
    /** The trace gone; a collage's cuts stay, they belong to the photo. */
    clearTrace() {
      if (!strokes.length) return;
      keep();
      strokes = [];
      marks = cleanMarks({ cuts: marks.cuts }, 0);
      traceTime = null;
      front = null;
    },

    // -- the marks beside the skyline (lib/horizon/traceMarks.js) ------------------

    /** Each stroke's id, the inner edges, the pairs and the cuts. */
    get marks() {
      return marks;
    },
    /** The skyline's strokes alone, straightened (the inner edges left out). */
    get skySeen() {
      return skySeen;
    },
    /** The cuts across the straightened photo, each its top and bottom point. */
    get cutsSeen() {
      return cutsSeen;
    },
    /** The cuts where the view shows them, on the photo laid as a search read it. */
    get cutsShown() {
      return cutsShown;
    },
    /** The pairs' letters and colours at their strokes, straightened. */
    get pairBadges() {
      return badges;
    },
    /** Each line's distance at its stroke, straightened: `{ line, label, at }`. */
    get farBadges() {
      return farSeen;
    },
    /** Each line said to have only sky above, at its stroke, straightened: `{ line, at }`. */
    get clearBadges() {
      return clearSeen;
    },
    /** Each key line at its stroke, straightened: `{ line, at }`. */
    get keyBadges() {
      return keySeen;
    },
    /** The parts brushed as bent, straightened: `{ path, r }`, `r` a share of the photo's width. */
    get bentSeen() {
      return bentSeen;
    },
    /** The parts brushed as bent where the view shows them. */
    get bentShown() {
      return bentLaid;
    },
    /** Whether a point of the straightened photo lies in a part brushed as bent. */
    bentAt(point) {
      return marks.bent?.length ? inBent(marks.bent, toPhoto(point), aspect() || 1) : false;
    },
    /** Which piece of the collage a point of the straightened photo lies in. */
    pieceAt(point) {
      return marks.cuts.length ? pieceOf(marks.cuts, toPhoto(point).u) : 0;
    },
    /** The pen a stroke is drawn with: `sky` for the skyline, `ridge` for an inner edge, `sea` for the sea's horizon. Taking one brings it out. */
    get pen() {
      return pen;
    },
    setPen(kind) {
      if (!['sky', 'ridge', 'sea'].includes(kind)) return;
      pen = kind;
      this.setTracing(true);
    },
    /** Whether strokes snap onto the photo's edges as they are drawn. */
    get magnet() {
      return magnet;
    },
    setMagnet(on) {
      magnet = Boolean(on);
    },
    /** Whether the terrain's margin, the cuts and the pairs' letters show while no tool is out. */
    get details() {
      return details;
    },
    setDetails(on) {
      details = Boolean(on);
    },
    /**
     * A click with a pen out, on a stroke there (`point` on the straightened
     * photo, `scale` its size on screen): the stroke becomes the pen's kind.
     * Says whether a stroke was there.
     */
    markLineAt(point, scale) {
      const id = lineAt(strokes, marks.lines, toPhoto(point), PICK_PX, scale);
      if (id === null) return false;
      const inner = pen === 'ridge';
      const sea = pen === 'sea';
      if (marks.inner.includes(id) === inner && (marks.sea ?? []).includes(id) === sea) return true;
      keep();
      marks = sea ? setSea(marks, id, true) : setSea(setInner(marks, id, inner), id, false);
      return true;
    },
    /** Whether a click picks strokes to pair, the one in front first. */
    get linking() {
      return linking;
    },
    setLinking(on) {
      const next = Boolean(on) && strokes.length > 1;
      if (next) toolsAway();
      if (next) asSearched = null;
      linking = next;
      front = null;
      if (linking) traceHidden = false;
    },
    /** The stroke picked to stand in front, waiting for the one behind it; null while none is. */
    get front() {
      return front;
    },
    /**
     * A click while pairing, at `point` on the straightened photo shown
     * `scale` big: the first stroke hit stands in front, the second behind
     * it, and the pair goes in (or out, when it was there). A stroke in front
     * lying under the one behind it is an inner edge. Says what happened:
     * `{ front }`, `{ paired: [front, back] }`, `{ unpaired }` or `{ missed }`.
     */
    linkAt(point, scale) {
      const id = lineAt(strokes, marks.lines, toPhoto(point), PICK_PX, scale);
      if (id === null) {
        front = null;
        return { missed: true };
      }
      if (front === null || front === id) {
        front = front === id ? null : id;
        return { front };
      }
      keep();
      const had = marks.pairs.some(([f, b]) => f === front && b === id);
      let next = togglePair(marks, front, id);
      if (!had) {
        const ahead = strokes.filter((_, i) => marks.lines[i] === front);
        const behind = strokes.filter((_, i) => marks.lines[i] === id);
        if (ahead.every((one) => liesUnder(one, behind))) next = setInner(next, front, true);
      }
      const pair = [front, id];
      marks = next;
      front = null;
      return had ? { unpaired: pair } : { paired: pair };
    },
    /** Every pair taken away. */
    clearPairs() {
      if (!marks.pairs.length) return;
      keep();
      marks = { ...marks, pairs: [] };
      front = null;
    },
    /** Whether a click lays a cut across the collage, or takes the one there away. */
    get cutting() {
      return cutting;
    },
    setCutting(on) {
      const next = Boolean(on) && Boolean(source);
      if (next) toolsAway();
      if (next) asSearched = null;
      cutting = next;
    },
    /** A click while cutting, at `point` on the straightened photo shown `scale` big. */
    cutAt(point, scale) {
      if (!source) return;
      const u = toPhoto(point).u;
      const near = cutAt(marks.cuts, u, PICK_PX, scale.width);
      keep();
      marks = near >= 0 ? removeCut(marks, near) : addCut(marks, u);
    },
    /** Whether a click says how far the line clicked stands. */
    get distancing() {
      return distancing;
    },
    setDistancing(on) {
      const next = Boolean(on) && strokes.length > 0;
      if (next) toolsAway();
      if (next) asSearched = null;
      distancing = next;
      if (distancing) traceHidden = false;
    },
    /** The distances a click lays on a line, as ticked (ids of DISTANCE_BANDS). */
    get farPicked() {
      return farPicked;
    },
    setFarPicked(bands) {
      farPicked = Array.isArray(bands) ? [...bands] : [];
    },
    /**
     * A click while saying distances, at `point` on the straightened photo
     * shown `scale` big: the line there stands as far as picked, or says
     * nothing again when it stood so already. Says the line hit, or null.
     */
    farAt(point, scale) {
      const id = lineAt(strokes, marks.lines, toPhoto(point), PICK_PX, scale);
      if (id === null) return null;
      keep();
      marks = setFar(marks, id, farPicked);
      return id;
    },
    /** Whether a click says the skyline line clicked has only sky above it. */
    get clearing() {
      return clearing;
    },
    setClearing(on) {
      const next = Boolean(on) && strokes.length > 0;
      if (next) toolsAway();
      if (next) asSearched = null;
      clearing = next;
      if (clearing) traceHidden = false;
    },
    /**
     * A click while saying where only sky stands above, at `point` on the
     * straightened photo shown `scale` big: the skyline line there has only sky
     * above it, or no longer when it had. Says the line hit, `{ ridge }` for an
     * inner edge, which has land above it, or null.
     */
    clearAt(point, scale) {
      const id = lineAt(strokes, marks.lines, toPhoto(point), PICK_PX, scale);
      if (id === null) return null;
      if (marks.inner.includes(id)) return { ridge: id };
      keep();
      marks = toggleClear(marks, id);
      return id;
    },
    /** Whether a click says the skyline line clicked matters most. */
    get keying() {
      return keying;
    },
    setKeying(on) {
      const next = Boolean(on) && strokes.length > 0;
      if (next) toolsAway();
      if (next) asSearched = null;
      keying = next;
      if (keying) traceHidden = false;
    },
    /**
     * A click while marking key lines, at `point` on the straightened photo
     * shown `scale` big: the skyline line there is key, or no longer when it
     * was. Says the line hit, `{ ridge }` for an inner edge, which cannot be
     * key, or null.
     */
    keyAt(point, scale) {
      const id = lineAt(strokes, marks.lines, toPhoto(point), PICK_PX, scale);
      if (id === null) return null;
      if (marks.inner.includes(id)) return { ridge: id };
      keep();
      marks = toggleKey(marks, id);
      return id;
    },
    /** Whether a drag brushes a part of the picture as bent. */
    get bending() {
      return bending;
    },
    setBending(on) {
      const next = Boolean(on) && Boolean(source);
      if (next) toolsAway();
      if (next) asSearched = null;
      bending = next;
      brushing = null;
    },
    /**
     * A brush stroke over a bent part, on the straightened photo shown `scale`
     * big, `radius` screen pixels wide: `beginBend` where it starts, `bendAlong`
     * as it moves, `endBend` when let go. A click that does not move, on a part
     * brushed already, takes that part away.
     */
    beginBend(point, radius, scale) {
      if (!source || !(scale?.width > 0)) return;
      brushing = { path: [toPhoto(point)], r: radius / scale.width };
    },
    bendAlong(point) {
      if (!brushing) return;
      brushing = { ...brushing, path: [...brushing.path, toPhoto(point)] };
    },
    endBend() {
      if (!brushing) return;
      const zone = brushing;
      brushing = null;
      const [first] = zone.path;
      const still = zone.path.every((p) => Math.hypot(p.u - first.u, p.v - first.v) < zone.r / 4);
      const hit = still ? bentIndex(marks.bent, first, aspect() || 1) : -1;
      keep();
      marks = hit >= 0 ? removeBent(marks, hit) : addBent(marks, zone);
    },
    /** Every part brushed as bent taken away. */
    clearBent() {
      if (!marks.bent?.length) return;
      keep();
      marks = { ...marks, bent: [] };
    },
    /** Every cut taken away. */
    clearCuts() {
      if (!marks.cuts.length) return;
      keep();
      marks = { ...marks, cuts: [] };
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

    /**
     * The work a saved view kept on this photo, laid back once the photo is
     * open (state/views.svelte.js): how much shows, its lens curve and pulled
     * corners, the trace and its marks (lib/horizon/traceMarks.js), for a video
     * the moment it was drawn on and the pins, what was known about it and
     * the reach Fit found the trace on. Nothing to take back: it is where the
     * view starts again.
     */
    restoreWork({
      mix: share = 1,
      bend: k = 0,
      corners = null,
      strokes: drawn = [],
      marks: marked = null,
      traceTime: at = null,
      pins: pinned = [],
      hints: told = NO_HINTS,
      reach: found = null,
    } = {}) {
      if (!source) return;
      asSearched = null;
      hints = cleanHints(told);
      if (hints.picture === 'panorama' && !offeredPanorama()) hints = { ...hints, picture: 'photo' };
      pictureSaid = true;
      reachFound = Number.isFinite(found) ? found : null;
      mix = Math.min(1, Math.max(0, Number(share) || 0));
      bend = Math.round(Math.min(BEND_MAX, Math.max(-BEND_MAX, Number(k) || 0)) * 1000) / 1000;
      const pulled = source.kind === 'image' && corners?.length === 4 ? corners.map((p) => roundPoint(clampCorner(p))) : null;
      warp = pulled && !isFlat(pulled) ? pulled : null;
      const kept = drawn.map((stroke, i) => [stroke, i]).filter(([stroke]) => stroke.length);
      strokes = kept.map(([stroke]) => stroke.map(unitPoint));
      if (marked) {
        marks = marksAfter(cleanMarks(marked, drawn.length), kept.map(([, i]) => i));
      } else {
        // a trace kept before the marks: the strokes lying under others were inner edges all along
        const plain = cleanMarks(NO_MARKS, strokes.length);
        marks = { ...plain, inner: innerByShape(strokes, plain.lines) };
      }
      traceTime = source.kind === 'video' && strokes.length && Number.isFinite(at) ? at : null;
      front = null;
      history = [];
      pins = source.kind === 'video' ? [...pinned].sort((a, b) => a.time - b.time) : [];
      if (hints.picture === 'panorama') asPanorama();
    },

    destroy() {
      clear();
    },
  };
}
