/**
 * The globe: Satellite's 3D view, drawn by the app itself.
 *
 * The flat map stays MapLibre's. Tilted over relief, MapLibre's camera is a
 * centre seated on the ground, and every height that arrives under it moved
 * the eye; years of gestures were written to hold it still. Here the eye is the
 * camera (camera.js) and nothing but the hand moves it: a drag turns the Earth
 * under the grabbed point, an orbit swings round the pressed ground, the wheel
 * slides the eye along the line to the ground under the pointer. The ground
 * sharpens where it stands as its tiles come (tree.js, pictures.js), built off
 * the page's thread (worker.js), and drawn only when something changed.
 *
 * What the rest of the app asks of a map it asks of this the same way: the
 * methods below are the façade's (lib/map/facade.js) that a tilted view uses,
 * speaking the app's view (a centre, a whole zoom, the app's bearing, a tilt),
 * read off the eye and the ground under the middle of the screen.
 *
 * What the flat map lays over its imagery is drawn here too, by whoever is
 * handed in as `laid` (mirror.js): the ground's share painted into a picture
 * per tile over the imagery (drapes.js), the rest stood on the screen once a
 * frame is drawn. The hand's presses are handed to it as they come, so the
 * flat map's own listeners hear them.
 */
import { createTileBatcher } from '../map/tileBatch.js';
import { createWheelKind, wheelLevels, wheelValue } from '../map/wheel.js';
import {
  MAX_TILT,
  aimed,
  axes,
  cameraFor,
  distanceFor,
  dolly,
  focalOf,
  lifted,
  orbit,
  project,
  rayAt,
  tiltCeiling,
  turnBetween,
  turned,
  viewOf,
} from './camera.js';
import { EARTH, add, dot, ecef, geodetic, haversine, length, localFrame, metresPerPixel, normalize, raySphere, scale, sub, wrapLon } from './earth.js';
import { createDrapes } from './drapes.js';
import { createPictures } from './pictures.js';
import { createRenderer, groundUniforms, toneUniforms } from './renderer.js';
import { createTree } from './tree.js';

/** Asks for what is out of view come after every ask for what is in it. */
const ROUND_RANK = 1e12;

/** The ground the eye keeps above, metres. */
export const CLEARANCE = 4;
/** The nearest the wheel brings the eye to the ground under the pointer, metres. */
export const NEAREST = 12;
/** Zoom levels the wheel may go past the imagery's own last one, as the flat map's overzoom does. */
const OVERZOOM = 2;
/** The app's zoom range, as the flat map and the routes that read a view take it. */
const ZOOM_MIN = 1;
const ZOOM_MAX = 22;
/** The farthest the eye goes from the Earth's centre: the whole globe in view, small. */
export const FARTHEST = EARTH * 5;
/** Pixels a press may move and still be a click. */
const CLICK_SLOP = 4;
/** A second press this soon after a click, this near it, is a double click. */
const DOUBLE_MS = 400;
const DOUBLE_SLOP = 8;
/** Degrees an orbit turns or tilts per pixel of the hand (gestures.js, the flat map's). */
const ORBIT_PER_PX = 0.25;
/**
 * How many times farther than seen square on the grabbed ground may move for a
 * pixel of the hand. Near the horizon a pixel is kilometres, and holding the
 * point exactly there would throw the view across the country: past this, the
 * grabbed point slips instead.
 */
const SLIP = 8;
/** Degrees the view turns per pixel when the sky is dragged: looking round from where the eye stands. */
const LOOK_PER_PX = 0.12;
/** ms a drag's last moves are read over for its fling, and how soon after the last one it must let go. */
const FLING_WINDOW = 100;
const FLING_GRACE = 60;
/** ms over which a fling's speed falls to a third. */
const FLING_FADE = 320;
/** ms over which the wheel's zoom is eased in. */
const WHEEL_EASE = 90;
/** The highest ground there is, at real scale: no ray meets ground above it. */
const TOP = 9000;
/** Pixels a drawing buffer may hold per CSS pixel. */
const DPR_MAX = 2;
/** Lines of sight to marks traced per frame, at most, once the view has stopped. */
const SIGHTS_PER_FRAME = 60;
/** Below the sea, metres: a point whose line to the eye dips under this sphere is past the horizon. */
const HORIZON_DIP = 1000;

const appZoom = (view) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(view.zoom)));

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} [o]
 * @param {(provider: string) => void} [o.onMetered] billed pictures came (the meter counts them)
 * @param {(provider: string, error: Error) => void} [o.onFailed] a picture could not be read
 * @returns the globe, or null when the browser has no WebGL2
 */
export function createGlobe(canvas, { onMetered = () => {}, onFailed = () => {} } = {}) {
  const renderer = createRenderer(canvas);
  if (!renderer) return null;

  let camera = cameraFor({ lat: 20, lon: 0, zoom: 2 }, { width: 800, height: 600 });
  let exaggeration = 1;
  let imagery = null;
  // how the ground is drawn: a plain ground where there is no picture, and the pictures' tone
  let look = { plain: groundUniforms(null), tone: toneUniforms() };
  let fallbackRelief = false;
  let destroyed = false;
  let lost = false;

  const listeners = new Map();
  const emit = (name, payload) => {
    for (const handler of listeners.get(name) ?? []) handler(payload);
  };

  // -- the tiles ---------------------------------------------------------------------

  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  const tree = createTree({
    request: (tiles) => worker.postMessage({ type: 'mesh', tiles }),
    release: (n) => renderer.deleteMesh(n.mesh),
  });
  worker.onmessage = ({ data }) => {
    if (destroyed || data.type !== 'mesh') return;
    if (data.failed) tree.arrived(data.key, null);
    else {
      if (data.fallback) fallbackRelief = true;
      tree.arrived(data.key, { ...data, mesh: renderer.createMesh(data.vertices) });
    }
    heightsChanged();
    schedule();
  };

  const batcher = createTileBatcher();
  const pictures = createPictures({
    fetch: async (provider, z, x, y, signal) => {
      try {
        const { status, data } = await batcher.get(`/api/tiles/batch/${provider}`, z, x, y, signal);
        if (status === 404 || status === 204) return null;
        if (status !== 200) {
          const error = new Error(`tile answered ${status}`);
          error.status = status;
          error.body = new Blob([data], { type: 'text/plain' });
          throw error;
        }
        return await createImageBitmap(new Blob([data]));
      } finally {
        // a frame to lay it in, once it is decoded: the store takes it before the frame comes
        schedule();
      }
    },
    upload: (bitmap) => renderer.createTexture(bitmap),
    release: (handle) => renderer.deleteTexture(handle),
    onMetered,
    onFailed,
  });

  // what the flat map lays on the ground, painted per tile by `laid` (mirror.js)
  let laid = null;
  // off while a capture is drawn: a tilted capture is the imagery on its relief alone
  let draping = true;
  const drapes = createDrapes({
    // a frame to lay it in once it is painted: nothing else may be asking for one
    compose: (tile, signal) => (laid ? laid.compose(tile, signal) : Promise.resolve(null)).finally(schedule),
    upload: (picture) => renderer.createOverlayTexture(picture),
    release: (handle) => renderer.deleteTexture(handle),
  });

  // -- the size ----------------------------------------------------------------------

  let css = { width: 1, height: 1 };
  function measure() {
    css = { width: Math.max(1, canvas.clientWidth), height: Math.max(1, canvas.clientHeight) };
    const dpr = Math.min(DPR_MAX, globalThis.devicePixelRatio || 1);
    const width = Math.round(css.width * dpr);
    const height = Math.round(css.height * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }
  measure();
  const resizer = new ResizeObserver(() => {
    measure();
    changed();
  });
  resizer.observe(canvas);

  // -- the ground under a ray ----------------------------------------------------------

  /** The ground's height as drawn (exaggerated) at a point, or 0 where none is held yet. */
  function groundHeight(lat, lon) {
    return (tree.groundAt(lat, wrapLon(lon))?.h ?? 0) * exaggeration;
  }

  /**
   * Where a ray from `origin` first meets the ground as drawn, or null when it
   * meets none. Marched by how far above the ground it is, a step never under
   * a hundredth of the way gone, then halved down to the crossing.
   */
  function march(origin, dir) {
    const top = EARTH + TOP * Math.max(1, exaggeration);
    let t = 0;
    if (length(origin) > top) {
      const enter = raySphere(origin, dir, top);
      if (enter == null) return null;
      t = enter;
    }
    const gapAt = (s) => {
      const g = geodetic(add(origin, scale(dir, s)));
      return g.h - groundHeight(g.lat, g.lon);
    };
    let before = null;
    for (let i = 0; i < 600; i += 1) {
      const p = add(origin, scale(dir, t));
      const g = geodetic(p);
      const gap = g.h - groundHeight(g.lat, g.lon);
      if (gap <= 0.02) {
        if (before == null) return p;
        let lo = before;
        let hi = t;
        for (let k = 0; k < 30; k += 1) {
          const mid = (lo + hi) / 2;
          if (gapAt(mid) > 0) lo = mid;
          else hi = mid;
        }
        return add(origin, scale(dir, hi));
      }
      // above every summit and climbing: nothing left to meet
      if (g.h > top - EARTH && dot(dir, normalize(p)) >= 0) return null;
      before = t;
      t += Math.max(gap * 0.5, 0.25 + t * 0.01);
    }
    return null;
  }

  /** The ground under a pixel of the view, or null on the sky. */
  const pick = (x, y) => march(camera.eye, rayAt(camera, css, x, y));

  // the ground under the middle of the screen, which the app's view is read at
  let centreCache = null;
  function centre() {
    if (centreCache) return centreCache;
    const hit = pick(css.width / 2, css.height / 2);
    // looking past the ground: the point under the eye stands in for it
    const target = hit ?? ecef(geodetic(camera.eye).lat, geodetic(camera.eye).lon, 0);
    centreCache = { target, view: viewOf(camera, css, target), onGround: Boolean(hit) };
    return centreCache;
  }
  function heightsChanged() {
    centreCache = null;
    groundMoved = true;
    groundStamp += 1;
  }

  // -- the camera, moved -----------------------------------------------------------

  let moved = false;
  // a step each time the ground's heights as drawn change, which a mark's height is kept against
  let groundStamp = 0;
  // finer heights came in: what stands on the ground stands somewhere else on screen
  let groundMoved = false;
  let lastHeading = null;
  let lastTilt = null;
  let unsettled = false;

  function changed() {
    centreCache = null;
    moved = true;
    unsettled = true;
    schedule();
  }

  /** Whether the eye of `next` stands clear of the ground, and looks at the Earth from as high as it stands. */
  function clear(next) {
    const g = geodetic(next.eye);
    // a tilt past what the height allows is refused, unless the move takes some of it back
    const tilt = next.tilt <= Math.max(tiltCeiling(g.h), camera.tilt) + 1e-6;
    return g.h - groundHeight(g.lat, g.lon) >= CLEARANCE && length(next.eye) <= FARTHEST && tilt;
  }

  /** Whether the ground leaves the line from the eye of `next` to `point` open, to within a hundredth of the way. */
  function sees(next, point) {
    const to = sub(point, next.eye);
    const distance = length(to);
    const hit = march(next.eye, scale(to, 1 / distance));
    return !hit || length(sub(hit, next.eye)) >= distance - Math.max(2, distance * 0.01);
  }

  /** Take a camera if its eye is clear of the ground; false leaves the view as it was. */
  function take(next) {
    if (!clear(next)) return false;
    camera = next;
    changed();
    return true;
  }

  /**
   * The ground came up under the eye (finer heights, or a stronger
   * exaggeration): it rises clear, and with no hand on the view it looks back
   * at the ground that was in the middle, so the view keeps its centre.
   */
  function keepClear() {
    const g = geodetic(camera.eye);
    const short = groundHeight(g.lat, g.lon) + CLEARANCE - g.h;
    if (short > 0) {
      const middle = !press && centreCache?.onGround ? centreCache.target : null;
      camera = lifted(camera, short);
      if (middle) camera = aimed(camera, css, middle, css.width / 2, css.height / 2);
      changed();
    }
  }

  // -- the hand ----------------------------------------------------------------------

  let press = null;
  // the last click, for a press that comes as the second of a double click
  let lastClick = null;
  // a tool reading the clicks (a measure being drawn) takes a double click as two clicks
  let clicksRead = false;
  let fling = null;
  let wheel = { pending: 0, delta: 0, kind: 'wheel', target: null, onGround: false, x: -1, y: -1 };
  const wheelKind = createWheelKind(() => performance.now());
  let hover = null;

  const local = (e) => {
    const box = canvas.getBoundingClientRect();
    // a page scaled to the window (a plate) shows the canvas larger or smaller than its own pixels
    const sx = box.width ? css.width / box.width : 1;
    const sy = box.height ? css.height / box.height : 1;
    return { x: (e.clientX - box.left) * sx, y: (e.clientY - box.top) * sy };
  };

  function stopMotion() {
    fling = null;
    wheel.pending = 0;
    wheel.delta = 0;
    wheel.target = null;
  }

  /** A press, a move or a release handed on as it came, with the ground under it (null on the sky). */
  function relay(type, e, at = local(e)) {
    if (!listeners.get('pointer')?.size) return;
    const hit = pick(at.x, at.y);
    const ground = hit ? geodetic(hit) : null;
    emit('pointer', { type, x: at.x, y: at.y, ground: ground && { lat: ground.lat, lon: wrapLon(ground.lon) }, event: e });
  }

  function onDown(e) {
    if (e.button > 2) return;
    relay('mousedown', e);
    stopMotion();
    pending = null;
    const at = local(e);
    // the second press of a double click, held, turns as the middle button does
    const second =
      !clicksRead &&
      e.button === 0 &&
      lastClick &&
      performance.now() - lastClick.at < DOUBLE_MS &&
      Math.hypot(at.x - lastClick.x, at.y - lastClick.y) < DOUBLE_SLOP;
    lastClick = null;
    const turning = e.button === 1 || e.button === 2 || e.shiftKey || e.ctrlKey || second;
    press = { ...at, from: at, button: e.button, moved: false, second, out: e.shiftKey, id: e.pointerId, samples: [] };
    if (turning) {
      press.kind = 'orbit';
      press.pivot = pick(at.x, at.y) ?? centre().target;
      // the eye can swing over any ground as far round the pivot as it stands from it
      const round = geodetic(press.pivot);
      tree.knowGround(round.lat, wrapLon(round.lon), length(sub(camera.eye, press.pivot)));
      // the pixel the pivot is held on through the swing
      press.pivotAt = project(camera, css, press.pivot) ?? { x: css.width / 2, y: css.height / 2 };
    } else {
      const grab = pick(at.x, at.y);
      if (grab) {
        press.kind = 'pan';
        press.grab = grab;
        press.radius = length(grab);
      } else press.kind = 'look';
    }
    canvas.setPointerCapture?.(e.pointerId);
    // a field that had the keys gives them back, so Page Up and Down tilt
    const focused = document.activeElement;
    if (focused && focused !== document.body) focused.blur?.();
  }

  function onMove(e) {
    const at = local(e);
    if (!press) {
      hover = at;
      relay('mousemove', e, at);
      if (listeners.get('pointer-move')?.size) schedule();
      return;
    }
    if (e.pointerId !== press.id) return;
    if (!press.moved && Math.hypot(at.x - press.from.x, at.y - press.from.y) < CLICK_SLOP) return;
    press.moved = true;
    const dx = at.x - press.x;
    const dy = at.y - press.y;
    press.x = at.x;
    press.y = at.y;
    if (press.kind === 'pan') panTo(at, press, Math.hypot(dx, dy));
    else if (press.kind === 'orbit') {
      // the turn and the tilt each go if their own eye is clear and still sees the pivot past
      // the ground between, so the view slides along a slope and never swings behind a ridge
      const { pivot, pivotAt } = press;
      const swing = (dHeading, dTilt) => {
        const next = aimed(orbit(camera, pivot, dHeading, dTilt), css, pivot, pivotAt.x, pivotAt.y);
        if (sees(next, pivot)) take(next);
      };
      swing(dx * ORBIT_PER_PX, 0);
      swing(0, -dy * ORBIT_PER_PX);
    } else {
      // the sky held and pulled: the view turns and tilts the other way, from where the eye stands
      const { up } = localFrame(camera.eye);
      take(turned(camera, camera.eye, up, dx * LOOK_PER_PX * (Math.PI / 180)));
      take({ ...camera, tilt: Math.min(tiltCeiling(geodetic(camera.eye).h), Math.max(0, camera.tilt + dy * LOOK_PER_PX)) });
    }
  }

  /**
   * Turn the Earth so the ground `hold.grab` comes back under the hand at `at`,
   * the hand having moved `moved` pixels, the turn noted in `hold.samples` for
   * a fling.
   *
   * The hand's ray is met on the sphere through the grabbed point, or, when
   * the eye stands lower than that point (a summit seen from its valley), on
   * the level through it: from inside the sphere the ray would only leave it
   * on the far side of the Earth.
   */
  function panTo(at, hold, moved) {
    const dir = rayAt(camera, css, at.x, at.y);
    let hit = null;
    if (length(camera.eye) > hold.radius + 1) {
      const t = raySphere(camera.eye, dir, hold.radius);
      if (t != null) hit = add(camera.eye, scale(dir, t));
    } else {
      const level = normalize(hold.grab);
      const facing = dot(dir, level);
      const t = Math.abs(facing) > 1e-9 ? dot(sub(hold.grab, camera.eye), level) / facing : -1;
      if (t > 0) hit = add(camera.eye, scale(dir, t));
    }
    // past the ground the grabbed point stands on, the hand has nothing to hold: the move waits
    if (!hit) return;
    const turn = turnBetween(hit, hold.grab);
    if (!turn) return;
    const most = (SLIP * length(sub(hold.grab, camera.eye)) * moved) / (focalOf(css.height) * EARTH);
    turn.angle = Math.min(turn.angle, most);
    camera = turned(camera, [0, 0, 0], turn.axis, turn.angle);
    keepClear();
    changed();
    const now = performance.now();
    hold.samples.push({ at: now, axis: turn.axis, angle: turn.angle });
    while (hold.samples.length && now - hold.samples[0].at > FLING_WINDOW) hold.samples.shift();
  }

  function onUp(e) {
    relay('mouseup', e);
    if (!press || e.pointerId !== press.id) return;
    const ended = press;
    press = null;
    canvas.releasePointerCapture?.(e.pointerId);
    if (!ended.moved) {
      const hit = pick(ended.from.x, ended.from.y);
      const at = hit ? geodetic(hit) : null;
      // a double click that never moved slides the eye a level toward the ground (Shift: away)
      if (ended.second) {
        if (hit) zoomToward(hit, ended.from, ended.out ? -1 : 1);
        return;
      }
      if (ended.button === 0) lastClick = { at: performance.now(), x: ended.from.x, y: ended.from.y };
      if (ended.button === 0 && at) {
        emit('click', { lat: at.lat, lon: wrapLon(at.lon) });
        relay('click', e, ended.from);
      } else if (ended.button === 2 && at) {
        emit('contextmenu', { lat: at.lat, lon: wrapLon(at.lon), x: ended.from.x, y: ended.from.y });
        relay('contextmenu', e, ended.from);
      }
      // a middle click puts north back up, as on the flat map
      else if (ended.button === 1) api.setBearing(0);
      return;
    }
    if (ended.kind === 'pan') {
      const now = performance.now();
      const recent = ended.samples.filter((s) => now - s.at <= FLING_WINDOW);
      const last = recent[recent.length - 1];
      if (last && now - last.at <= FLING_GRACE && recent.length > 1) {
        const span = Math.max(16, now - recent[0].at);
        const angle = recent.reduce((sum, s) => sum + s.angle, 0);
        // never faster than the view's width a frame
        const most = (css.width * metresAtCentre()) / (16 * EARTH);
        fling = { axis: last.axis, rate: Math.min(angle / span, most) };
      }
    }
    schedule();
  }

  function onWheel(e) {
    e.preventDefault();
    fling = null;
    pending = null;
    const at = local(e);
    const value = wheelValue(e);
    wheel.kind = wheelKind(value);
    wheel.delta -= value;
    if (!wheel.target || Math.hypot(at.x - wheel.x, at.y - wheel.y) > 2) {
      const dir = rayAt(camera, css, at.x, at.y);
      const ground = march(camera.eye, dir);
      // over the sky the eye slides along the ray, as toward ground as far away as it stands high
      wheel.target = ground ?? add(camera.eye, scale(dir, Math.max(200, 3 * geodetic(camera.eye).h)));
      wheel.onGround = Boolean(ground);
      wheel.x = at.x;
      wheel.y = at.y;
    }
    schedule();
  }

  /**
   * Slide toward the wheel's target by `levels` of zoom (negative backs off),
   * short of the ground. The eye keeps its heading and its tilt, as the flat
   * map's zoom keeps its turn and tilt, and the Earth is then turned so the
   * ground under the pointer is back under it.
   */
  function zoomBy(levels) {
    const target = wheel.target;
    if (!target) return false;
    const distance = length(sub(target, camera.eye));
    // no nearer than the imagery's last level, a little enlarged, would frame the ground from
    const ceiling = Math.min(ZOOM_MAX, (imagery ? imagery.deepest + imagery.shift : 19) + OVERZOOM);
    const nearest = Math.max(NEAREST, distanceFor(geodetic(target).lat, ceiling, css.height));
    let share = 1 - 2 ** -levels;
    if (distance * (1 - share) < nearest) share = Math.min(share, Math.max(0, 1 - nearest / distance));
    if (Math.abs(share) < 1e-9) return false;
    const slid = dolly(camera, target, share);
    // rising, the eye levels as it must to keep the Earth in view
    let next = { ...slid, heading: camera.heading, tilt: Math.min(camera.tilt, tiltCeiling(geodetic(slid.eye).h)) };
    if (wheel.onGround) {
      const dir = rayAt(next, css, wheel.x, wheel.y);
      const t = raySphere(next.eye, dir, length(target));
      const turn = t == null ? null : turnBetween(add(next.eye, scale(dir, t)), target);
      if (turn) next = turned(next, [0, 0, 0], turn.axis, turn.angle);
    }
    return take(next);
  }

  /** Slide `levels` toward the ground at `hit`, under the pixel `at`, eased as the wheel is. */
  function zoomToward(hit, at, levels) {
    wheel.target = hit;
    wheel.onGround = true;
    wheel.x = at.x;
    wheel.y = at.y;
    wheel.pending += levels;
    schedule();
  }

  const onMenu = (e) => e.preventDefault();
  const onLeave = (e) => {
    hover = null;
    relay('mouseout', e);
  };
  // The press is the map's: no text selected, no page scrolled by the middle
  // button. Said on the mouse event the press brings rather than on the pointer
  // one: cancelling a pointer press keeps the browser from sending the mouse
  // events at all, and the page hears presses by those (a menu closing on a
  // press outside it, the guard on a middle click's paste in lib/clipboardPaste.js).
  const onMouseDown = (e) => e.preventDefault();
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onMenu);
  const onLost = (e) => {
    e.preventDefault();
    lost = true;
    emit('lost');
  };
  canvas.addEventListener('webglcontextlost', onLost);

  // -- the frame ---------------------------------------------------------------------

  let raf = 0;
  let last = 0;
  let revealed = false;
  let loading = 0;
  let idleWaiters = [];

  function schedule() {
    if (!raf && !destroyed) raf = requestAnimationFrame(draw);
  }

  /** The eased parts of a movement, one frame on: the fling, the wheel. True while one goes on. */
  function step(dt) {
    let going = false;
    if (fling) {
      camera = turned(camera, [0, 0, 0], fling.axis, fling.rate * dt);
      keepClear();
      changed();
      fling.rate *= Math.exp(-dt / FLING_FADE);
      // stopped once the ground moves under a tenth of a pixel a frame
      if (fling.rate * 16 * EARTH < 0.1 * metresAtCentre()) fling = null;
      else going = true;
    }
    if (wheel.delta) {
      wheel.pending += wheelLevels(wheel.delta, wheel.kind);
      wheel.delta = 0;
    }
    if (Math.abs(wheel.pending) > 1e-4) {
      const take = wheel.pending * (1 - Math.exp(-dt / WHEEL_EASE));
      wheel.pending -= take;
      if (!zoomBy(take)) wheel.pending = 0;
      going = true;
    } else {
      wheel.pending = 0;
      // the next turn of the wheel reads the ground under the pointer afresh
      wheel.target = null;
    }
    return going;
  }

  /** Metres a pixel spans in the middle of the screen. */
  const metresAtCentre = () => length(sub(centre().target, camera.eye)) / focalOf(css.height);

  function draw(now) {
    raf = 0;
    if (destroyed || lost) return;
    const dt = last ? Math.min(64, now - last) : 16;
    last = now;
    const going = step(dt) || Boolean(press);
    keepClear();
    const view = centre().view;
    if (imagery) {
      pictures.setImagery({
        ...imagery,
        // where billed pictures stop: the flat view's reach (quotaGuard.js counts zoom on 512 px tiles)
        view: { lat: view.lat, lon: view.lon, zoom: view.zoom - 1, width: css.width, height: css.height, pitch: view.pitch },
      });
    }
    pictures.begin();
    drapes.begin();
    const limit = imagery ? Math.max(imagery.deepest + imagery.shift, 16) : 16;
    const { drawn, waiting, view: seen, round } = tree.frame(camera, css, { exaggeration, limit });
    const tiles = [];
    for (const n of drawn) {
      const distance = n.bound ? length(sub(n.bound.mid, camera.eye)) : 0;
      tiles.push({
        mesh: n.mesh,
        centre: n.centre,
        quarters: n.quarters,
        picture: pictures.pictureFor(n, n.z * 1e9 + distance),
        drape: laid && draping ? drapes.drapeFor(n, n.z * 1e9 + distance) : null,
      });
    }
    lastDrawn = drawn;
    // the pictures of the ground all round, after the frame's own, so a turn finds it dressed
    for (const n of round) {
      const distance = n.bound ? length(sub(n.bound.mid, camera.eye)) : 0;
      pictures.pictureFor(n, ROUND_RANK + n.z * 1e9 + distance);
    }
    // both stores lay their arrivals every frame, whichever has some
    const laying = [pictures.end(), drapes.end()].some(Boolean);
    // first shown once the eye stands where it was asked and every tile drawn has a picture
    if (!revealed && !pending && tiles.length && tiles.every((t) => t.picture)) {
      revealed = true;
      emit('shown');
    }
    renderer.draw({
      view: { ...seen, cssWidth: css.width, cssHeight: css.height },
      size: { width: canvas.width, height: canvas.height },
      tiles,
      exaggeration,
      look,
    });
    loading = waiting + pictures.waiting;
    const sightsDue = laid ? traceSights(going) : false;
    if (laid) {
      laid.frame({ moved: moved || groundMoved });
      groundMoved = false;
    }
    if (moved) {
      viewStamp += 1;
      moved = false;
      emit('view-move', api.camera());
      if (lastHeading !== null && Math.abs(camera.heading - lastHeading) > 1e-6) emit('rotate', api.camera());
      if (lastTilt !== null && Math.abs(camera.tilt - lastTilt) > 1e-6) emit('pitch', api.camera());
      lastHeading = camera.heading;
      lastTilt = camera.tilt;
    }
    if (hover && listeners.get('pointer-move')?.size) {
      const hit = pick(hover.x, hover.y);
      if (hit) {
        const g = geodetic(hit);
        emit('pointer-move', { lat: g.lat, lon: wrapLon(g.lon) });
      }
    }
    if (!going && unsettled) {
      unsettled = false;
      emit('view-settled', api.camera());
    }
    if (going || laying || sightsDue) schedule();
    if (!going && !press && !pending && loading === 0 && !laying) {
      const waiters = idleWaiters;
      idleWaiters = [];
      for (const resolve of waiters) resolve();
    }
  }

  // -- what stands on the ground: where it is seen, and whether --------------------

  let lastDrawn = [];
  // the camera's axes as last read, for the marks projected many a frame
  const lens = { camera: null, width: 0, height: 0, axes: null, f: 1 };
  // the view the lines of sight were traced for, a step each time it moves
  let viewStamp = 0;
  // marks' ground → { hidden, stamp }: whether the relief stands between it and the eye
  const sights = new Map();
  let sightsAsked = [];

  /** Whether the curve of the Earth hides `p` from the eye. */
  function overHorizon(p) {
    const eye = camera.eye;
    const d = sub(p, eye);
    const t = -dot(eye, d) / dot(d, d);
    if (t <= 0 || t >= 1) return false;
    return length(add(eye, scale(d, t))) < EARTH - HORIZON_DIP;
  }

  /**
   * Trace the lines of sight asked since the view stopped, a few a frame:
   * while the view moves each mark keeps what it was last found to be, so
   * nothing blinks under a ridge mid-gesture. True while some are left.
   */
  function traceSights(going) {
    if (going || press) {
      sightsAsked = [];
      return false;
    }
    let traced = 0;
    while (sightsAsked.length && traced < SIGHTS_PER_FRAME) {
      const { key, point } = sightsAsked.pop();
      const entry = sights.get(key);
      if (entry?.stamp === viewStamp) continue;
      sights.set(key, { hidden: !sees(camera, point), stamp: viewStamp });
      traced += 1;
    }
    if (traced) groundMoved = true;
    if (sights.size > 20000) sights.clear();
    return sightsAsked.length > 0;
  }

  /** Whether the relief hides a point, as last traced; asked again once the view has stopped. */
  function hiddenByRelief(key, point) {
    const entry = sights.get(key);
    if (entry?.stamp !== viewStamp) sightsAsked.push({ key, point });
    return entry?.hidden ?? false;
  }

  // -- the façade --------------------------------------------------------------------

  /**
   * A placement waiting for the height of its ground (`{ wanted, ticket }`):
   * a turn, a tilt or a zoom asked meanwhile is made to it, another placement
   * replaces it, and a hand on the view drops it.
   */
  let pending = null;
  let tickets = 0;

  /** The ground's height at a point as drawn, if a tile fine enough to say it is held; else null. */
  function groundKnown(lat, lon) {
    const ground = tree.groundAt(lat, wrapLon(lon));
    return ground && ground.z >= 10 ? ground.h * exaggeration : null;
  }

  /** The ground's height at a point, asked of the app (the readout's own route); 0 when it cannot say. */
  async function heightOf(lat, lon) {
    try {
      const answer = await fetch(`/api/terrain/elevation?lat=${lat}&lon=${wrapLon(lon)}`);
      const value = answer.ok ? (await answer.json()).elevation : null;
      return Number.isFinite(value) ? value : 0;
    } catch {
      return 0;
    }
  }

  /**
   * A whole camera of the app's. The eye stands where the view says relative
   * to the ground at its centre, so that ground's height is part of it: handed
   * in, read off a tile held there, or else asked of the app first. Until the
   * app answers, the eye is placed as if the ground were where the tiles say,
   * and it is placed again once, when the answer comes, unless the hand or
   * another placement moved it meanwhile.
   */
  function place(wanted) {
    const { lat, lon } = wanted;
    const known = Number.isFinite(wanted.elevation) ? wanted.elevation : groundKnown(lat, lon);
    if (known != null) {
      pending = null;
      put({ ...wanted, elevation: known });
      return;
    }
    const ticket = (tickets += 1);
    pending = { wanted, ticket };
    putProvisional();
    heightOf(lat, lon).then((height) => {
      if (pending?.ticket !== ticket || destroyed) return;
      const { wanted: last } = pending;
      pending = null;
      put({ ...last, elevation: height * exaggeration });
    });
  }

  /** The waiting placement, put where the tiles held say its ground is meanwhile. */
  function putProvisional() {
    const { wanted } = pending;
    put({ ...wanted, elevation: (tree.groundAt(wanted.lat, wrapLon(wanted.lon))?.h ?? 0) * exaggeration });
  }

  /** A change to the view: made to the placement still waiting for its ground, or to the view as it stands. */
  function change(changes) {
    if (pending) {
      pending.wanted = { ...pending.wanted, ...changes };
      putProvisional();
    } else place({ ...centre().view, ...changes });
  }

  /** The eye placed at once for a camera whose ground height is `elevation`. */
  function put({ lat, lon, zoom, bearing = 0, pitch, elevation: height }) {
    const now = centre().view;
    let next = cameraFor(
      { lat, lon, zoom, bearing, pitch: Number.isFinite(pitch) ? pitch : now.pitch, elevation: height },
      css
    );
    // a tilt that would put the eye in a slope stops where it is clear
    for (let tries = 0; tries < 12 && !clear(next) && next.tilt > 0; tries += 1) {
      next = cameraFor({ lat, lon, zoom, bearing, pitch: Math.max(0, next.tilt - 6), elevation: height }, css);
    }
    stopMotion();
    camera = next;
    keepClear();
    changed();
  }

  function fitBounds({ north, south, east, west }, options = {}) {
    const pad = Array.isArray(options.padding) ? options.padding : [options.padding ?? 0, options.padding ?? 0];
    const lat = (north + south) / 2;
    const lon = (east + west) / 2;
    const wide = haversine({ lat, lon: west }, { lat, lon: east });
    const tall = haversine({ lat: south, lon }, { lat: north, lon });
    const perPixel = Math.max(wide / Math.max(1, css.width - 2 * pad[0]), tall / Math.max(1, css.height - 2 * pad[1]), 0.05);
    let zoom = Math.floor(Math.log2(metresPerPixel(lat, 0) / perPixel));
    if (options.maxZoom != null) zoom = Math.min(zoom, options.maxZoom);
    const now = pending?.wanted ?? centre().view;
    place({ lat, lon, zoom: Math.max(1, zoom), bearing: now.bearing, pitch: now.pitch });
  }

  const api = {
    camera() {
      const view = centre().view;
      return { lat: view.lat, lon: view.lon, zoom: appZoom(view), bearing: view.bearing, pitch: Math.round(view.pitch) };
    },
    getZoom: () => appZoom(centre().view),
    exactZoom: () => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, centre().view.zoom)),
    centreElevation: () => (centre().onGround ? centre().view.elevation : null),
    setCamera: (wanted) => place(wanted),
    setView: ({ lat, lon }, zoom) => {
      const now = pending?.wanted ?? centre().view;
      place({ lat, lon, zoom, bearing: now.bearing, pitch: now.pitch });
    },
    setZoom: (zoom) => change({ zoom }),
    setBearing: (deg) => change({ bearing: Number(deg) || 0 }),
    setPitch: (deg) => change({ pitch: Math.min(MAX_TILT, Math.max(0, Number(deg) || 0)) }),
    maxPitch: () => MAX_TILT,
    panBy: (dx, dy) => {
      const grab = pick(css.width / 2 + dx, css.height / 2 + dy);
      if (grab) panTo({ x: css.width / 2, y: css.height / 2 }, { grab, radius: length(grab), samples: [] }, Math.hypot(dx, dy));
    },
    fitBounds,
    fitPoints(points, options) {
      const usable = (points ?? []).filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon));
      if (!usable.length) return false;
      fitBounds(
        {
          north: Math.max(...usable.map((p) => p.lat)),
          south: Math.min(...usable.map((p) => p.lat)),
          east: Math.max(...usable.map((p) => p.lon)),
          west: Math.min(...usable.map((p) => p.lon)),
        },
        options
      );
      return true;
    },
    containerPointToLatLng({ x, y }) {
      const hit = pick(x, y);
      if (!hit) return null;
      const g = geodetic(hit);
      return { lat: g.lat, lon: wrapLon(g.lon) };
    },
    latLngToContainerPoint({ lat, lon }) {
      const at = project(camera, css, ecef(lat, lon, groundHeight(lat, lon)));
      return at ? { x: at.x, y: at.y } : { x: NaN, y: NaN };
    },
    /**
     * Where a point `metres` above the sea stands on screen, raised as the
     * ground under it is (exaggeration), or null behind the eye: an eye or a
     * target standing in the air, which no ground point can place.
     */
    projectAt(lat, lon, metres) {
      const at = project(camera, css, ecef(lat, lon, metres * exaggeration));
      return at ? { x: at.x, y: at.y } : null;
    },
    /** Whether a tool reads the map's clicks: then a double click is two clicks, never a zoom. */
    readClicks(on) {
      clicksRead = Boolean(on);
      lastClick = null;
    },
    onSurface: (target) => target === canvas,
    /** A wheel over something laid on the view (a marker, a card): it zooms as over the ground under it. */
    wheel: (e) => onWheel(e),
    tilesLoading: () => loading > 0 || Boolean(press) || Boolean(fling) || wheel.pending !== 0,
    drewReliefFallback: () => fallbackRelief,
    /** Resolves once the view has stopped and every tile it wants is drawn. */
    idle() {
      return new Promise((resolve) => {
        idleWaiters.push(resolve);
        schedule();
      });
    },
    /**
     * The view as drawn, on a canvas of its own: once it is complete, or after
     * `timeout` ms with `complete` false. The imagery on its relief alone, as
     * every tilted capture is, so `keep` has nothing to choose.
     */
    async snapshot({ timeout = 12000, ratio = null, laid: withLaid = false, into = null } = {}) {
      // drawn at `ratio` device pixels per CSS pixel for a print, as far as the GPU allows
      if (ratio) {
        const most = Math.min(8192, renderer.gl.getParameter(renderer.gl.MAX_RENDERBUFFER_SIZE) || 4096);
        const scale = Math.min(ratio, most / css.width, most / css.height);
        canvas.width = Math.max(1, Math.round(css.width * scale));
        canvas.height = Math.max(1, Math.round(css.height * scale));
        changed();
      }
      const deadline = new Promise((r) => setTimeout(() => r(false), timeout));
      const settled = api.idle().then(async () => {
        // what is laid on the ground is painted tile by tile after the tiles come
        while (withLaid && laid && drapes.waiting > 0 && !destroyed) await api.idle();
        return true;
      });
      const complete = await Promise.race([settled, deadline]);
      // drawn and copied in one go: the canvas keeps no frame once it is shown.
      // A tilted capture is the imagery on its relief alone; a plate's takes
      // what is laid on the ground and what stands on it too.
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      draping = withLaid;
      draw(performance.now());
      const copy = into ?? document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      const ctx = copy.getContext('2d');
      ctx.drawImage(canvas, 0, 0);
      if (withLaid) laid?.paintMarks?.(ctx, canvas.width / css.width);
      draping = true;
      if (ratio) {
        measure();
        changed();
      }
      schedule();
      return { canvas: copy, complete };
    },
    /**
     * The ground drawn where there is no picture: `{ colour, tints, tintOpacity,
     * shade }` (renderer.js `groundUniforms`), or null for the pale stone a
     * ground waits for its picture on.
     */
    setGround(style) {
      look = { ...look, plain: groundUniforms(style) };
      schedule();
    },
    /** The pictures' tone, as the flat map paints a raster (renderer.js `toneUniforms`). */
    setTone(tone) {
      look = { ...look, tone: toneUniforms(tone ?? {}) };
      schedule();
    },
    on(name, handler) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(handler);
      return () => listeners.get(name)?.delete(handler);
    },
    /**
     * The imagery the ground is drawn in: the provider's tile id (what the
     * tiles are asked for), whether it is billed, its picture size in CSS
     * pixels and the deepest level it serves. Null leaves the ground bare.
     */
    setImagery(next) {
      imagery = next
        ? { provider: next.id, metered: Boolean(next.metered), shift: Math.round(Math.log2((next.cell ?? 256) / 256)), deepest: next.deepest, shallowest: next.shallowest ?? 0 }
        : null;
      pictures.setImagery(imagery);
      schedule();
    },
    setExaggeration(next) {
      const value = Number(next) || 1;
      if (value === exaggeration) return;
      exaggeration = value;
      groundStamp += 1;
      keepClear();
      changed();
    },
    /**
     * Who paints what the flat map lays over its imagery: `{ compose(tile,
     * signal), frame({ moved }) }` (mirror.js), or null for nothing.
     */
    setLaid(next) {
      laid = next;
      drapes.invalidate();
      schedule();
    },
    /** What is laid on the ground changed over `bounds` (degrees), or everywhere. */
    invalidate(bounds = null) {
      drapes.invalidate(bounds);
      schedule();
    },
    /** Draw again: something standing on the ground changed. */
    redraw() {
      groundMoved = true;
      schedule();
    },
    /**
     * Where a point of the ground stands on screen, how far it is, and the
     * engine zoom it is seen at; null behind the eye, past the horizon, or
     * (once the view has stopped and the line was traced) behind the relief.
     */
    standingAt(lat, lon, memo = null) {
      // a mark asked every frame keeps its point until the ground under it changes
      let point = memo?.stamp === groundStamp ? memo.point : null;
      if (!point) {
        point = ecef(lat, lon, groundHeight(lat, lon) + 1);
        if (memo) {
          memo.point = point;
          memo.stamp = groundStamp;
        }
      }
      if (lens.camera !== camera || lens.width !== css.width || lens.height !== css.height) {
        lens.camera = camera;
        lens.width = css.width;
        lens.height = css.height;
        lens.axes = axes(camera);
        lens.f = focalOf(css.height);
      }
      const { forward, right, up } = lens.axes;
      const v = sub(point, camera.eye);
      const depth = dot(v, forward);
      if (depth <= 0) return null;
      const x = css.width / 2 + (dot(v, right) / depth) * lens.f;
      const y = css.height / 2 - (dot(v, up) / depth) * lens.f;
      if (x < -css.width || y < -css.height || x > 2 * css.width || y > 2 * css.height) return null;
      if (overHorizon(point)) return null;
      if (hiddenByRelief((memo && (memo.key ??= `${lat},${lon}`)) || `${lat},${lon}`, point)) return null;
      return { x, y, distance: depth };
    },
    /** The engine zoom ground `distance` metres away is seen at, at a latitude. */
    zoomAt(lat, distance) {
      return Math.log2((focalOf(css.height) * EARTH * 2 * Math.PI * Math.cos((lat * Math.PI) / 180)) / (256 * Math.max(distance, 1))) - 1;
    },
    /** Metres a screen pixel spans at a point of the ground, seen from where the eye stands. */
    metresPerPixelAt({ lat, lon }) {
      return length(sub(ecef(lat, lon, groundHeight(lat, lon)), camera.eye)) / focalOf(css.height);
    },
    /** The tiles the last frame drew: `{ z, x, y }`. */
    drawnTiles: () => lastDrawn.map(({ z, x, y }) => ({ z, x, y })),
    /** The view's size in CSS pixels. */
    size: () => ({ ...css }),
    /** The way the eye faces, degrees clockwise from north (the engine's own bearing). */
    heading: () => camera.heading,
    /** What the pointer shows over the globe. */
    setCursor(cursor) {
      canvas.style.cursor = cursor || '';
    },
    /** Metres across and down the middle of the view, as the flat façade says them. */
    viewSpanMeters() {
      const across = metresAtCentre() * css.width;
      return { across, down: metresAtCentre() * css.height };
    },
    /** The ground the view shows, as the box that holds it: corners and edges read, the sky left out. */
    viewBounds() {
      const points = [];
      for (const fx of [0, 0.25, 0.5, 0.75, 1]) {
        for (const fy of [0, 0.25, 0.5, 0.75, 1]) {
          const hit = pick(fx * css.width, fy * css.height);
          if (hit) points.push(geodetic(hit));
        }
      }
      if (!points.length) points.push(geodetic(centre().target));
      return {
        west: wrapLon(Math.min(...points.map((p) => p.lon))),
        south: Math.min(...points.map((p) => p.lat)),
        east: wrapLon(Math.max(...points.map((p) => p.lon))),
        north: Math.max(...points.map((p) => p.lat)),
      };
    },
    /** Pictures and meshes that failed are asked again. */
    retry() {
      pictures.retry();
      tree.retry();
      schedule();
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      resizer.disconnect();
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onMenu);
      canvas.removeEventListener('webglcontextlost', onLost);
      worker.terminate();
      tree.dispose();
      pictures.dispose();
      drapes.dispose();
      renderer.dispose();
      for (const resolve of idleWaiters) resolve();
      idleWaiters = [];
      listeners.clear();
    },
  };

  schedule();
  return api;
}
