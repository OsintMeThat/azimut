/**
 * The Horizon tab's view: where the eye stands, how it looks, and the picture
 * the app drew from there.
 *
 * Moving the eye is the only thing that asks the app for a new picture
 * (`/api/horizon/panorama`); turning, tilting, zooming and relighting all
 * happen in the browser over the one it has. So a move is made to feel quick
 * in two steps: a coarse picture first (half a degree a cell, back in well
 * under a second over cached ground), then the full one at a tenth of a degree,
 * which replaces it. A newer move drops whatever an older one is still
 * waiting for.
 *
 * A narrow lens wants finer cells than a full turn can afford, so once the
 * camera rests on a telephoto view the window it shows is asked for again at
 * the step its pixels need (`detailRequest`), and drawn over the turn.
 *
 * Full detail, switched on, first asks for what the lens shows, whatever its
 * width, at a cell a pixel over the finest terrain out to 20 km, so the view
 * sharpens where it looks within seconds; then the whole turn on the full
 * picture's grid, which replaces it when it comes, for turning around.
 *
 * Summit names come from OpenStreetMap only once the analyst switches them on,
 * the same rule every overlay keeps: the network is reached for what was asked.
 * The switch is remembered in this browser, since turning it on was that
 * analyst's own choice. So does the imagery laid over the ground (Satellite),
 * read from a free provider once that ground is picked. Sentinel-2, billed on
 * the analyst's Copernicus account, is laid only on the ground nearer than a
 * distance and only once switched on (`setNear`); how many requests that
 * costs is worked out first, for free (`nearEstimate`).
 *
 * With a day set, the sun or the moon lights the ground (`light`), and the
 * shadows ridges cast are marched by the app once the hour rests (`shadow`):
 * the light moves with the slider at once, its shadows follow.
 */
import { decodePanorama, inflate } from '../../../lib/horizon/panorama.js';
import { turnBetween, verticalFov } from '../../../lib/horizon/camera.js';
import { MAP_LIGHT, minuteOf, SHADOW_DEPTH, skyLight } from '../../../lib/horizon/sky.js';
import { distanceBetween, groundPoint } from '../../../lib/horizon/geometry.js';
import { daysBefore, isoDay, latestAllowedPass, SENTINEL_ID, variantId } from '../../../lib/sentinel.js';
import {
  DEFAULT_HEIGHTS,
  FOV,
  GROUNDS,
  headingOf,
  heightFor,
  linesByDefault,
  MODES,
  reachFor,
  TILT,
  VISIBILITY_KM,
} from '../../../lib/horizon/view.js';

/** The free imagery laid over the ground in Imagery (api/horizon.py `/drape`). */
export const DRAPE_PROVIDER = 'esri-world-imagery';
/** A dated Wayback release of the same imagery, for the ground as it was. */
export const waybackSource = (release) => `esri-wayback~${release}`;

/** An image the app sent in base64, ready for the GPU. */
export async function decodeImage(base64, type = 'image/webp') {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return createImageBitmap(new Blob([bytes], { type }));
}

/** Degrees a cell of the quick first picture, and of the full one. */
export const COARSE_STEP = 0.5;
export const FINE_STEP = 0.1;
/** ms an eye must rest before its picture is asked for: a dragged eye asks once. */
export const LOAD_DELAY = 220;
/** ms a camera must rest before a finer window is asked for. */
export const DETAIL_DELAY = 300;
/**
 * How many ridges the Lines picture draws, fewest to most: the step in distance
 * between two neighbouring pixels that counts as an edge.
 */
export const RIDGE_STEPS = [0.4, 0.2, 0.12, 0.06, 0.03];
/** ms between two readings of the summit names while areas are still coming in. */
export const PEAKS_POLL = 1500;
/**
 * Sentinel-2 near the eye: the cloud ceiling its newest pass is picked under,
 * how far back that pass is looked for, how far out it is laid by default and
 * the distances offered (api/horizon.py `NEAR_REACH_MAX`), and how far the eye
 * may move before the newest pass is looked for again.
 */
export const NEAR_MAXCC = 30;
export const NEAR_LOOKBACK_DAYS = 90;
export const NEAR_REACH = 5_000;
export const NEAR_REACHES = [2_000, 5_000, 10_000, 20_000, 30_000];
export const NEAR_REFIND_M = 10_000;
/** ms a setting must rest before the cost of Sentinel-2 is worked out again. */
export const ESTIMATE_DELAY = 300;

/** How far one step takes each eye, in metres: a few paces, a drone's hop, an aircraft's glide. */
export const STEP_M = { ground: 50, drone: 100, aircraft: 500 };

/** ms the light must rest before its shadows are asked for: a dragged hour asks once. */
export const SHADOW_DELAY = 250;
/** A light weaker than this casts no shadow worth a march (a thin moon). */
export const SHADOW_STRENGTH = 0.04;
/** Degrees the light may move before the shadows held stop matching it. */
export const SHADOW_SLACK = 0.6;

/** Whether the shadows held were cast by this light, near enough to be drawn with it. */
export function shadowFits(shadow, light) {
  if (!shadow || !light?.body || light.strength < SHADOW_STRENGTH) return false;
  return (
    Math.abs(turnBetween(shadow.lightAzimuth, light.azimuth)) < SHADOW_SLACK &&
    Math.abs(shadow.lightAltitude - light.altitude) < SHADOW_SLACK
  );
}

/** Where this browser remembers that summit names were switched on, and how dark shadows are. */
export const PEAKS_KEY = 'azimut.horizon.peaks';
export const SHADOWS_KEY = 'azimut.horizon.shadows';

/** The browser's storage, or null where it is refused (a private window, a sandbox). */
function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
/** A window is worth asking for once a cell of the turn spans this many pixels. */
export const DETAIL_ABOVE_PX = 1.6;
/** The finest step the app draws, and the most cells one window may hold. */
export const DETAIL_MIN_STEP = 0.005;
export const DETAIL_MAX_CELLS = 3_000_000;
const NICE_STEPS = [0.005, 0.01, 0.02, 0.025, 0.05];

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/**
 * The finer window a camera wants, or null when the turn is fine enough.
 * `always` asks for one at about a cell a pixel even through a wide lens, as
 * full detail does.
 *
 * `body` is what the app is asked: the view and a margin each side, so a small
 * turn stays inside it, at the step that gives about one cell a pixel, inside
 * the turn's own band of elevation. `need` is the part the view shows now,
 * which is what a window already held has to cover (`detailCovers`).
 *
 * @param {object} camera `{ heading, tilt, roll, fov, projection }`
 * @param {{ width: number, height: number }} frame CSS pixels
 * @param {object} panorama the turn's grid (`azimuth`, `elevation`)
 */
export function detailRequest(camera, frame, panorama, { always = false } = {}) {
  if (!panorama || !(frame.width > 0 && frame.height > 0)) return null;
  const perPixel = camera.fov / frame.width;
  if (!always && panorama.azimuth.step <= perPixel * DETAIL_ABOVE_PX) return null;
  let step = NICE_STEPS.find((candidate) => candidate >= perPixel) ?? NICE_STEPS.at(-1);
  if (step >= panorama.azimuth.step) return null;
  const tall = verticalFov({ ...camera, width: frame.width, height: frame.height });
  const reach = Math.abs(camera.roll ?? 0) > 1 ? Math.max(tall, camera.fov) : tall;
  const panoTop = panorama.elevation.top;
  const panoBottom = panoTop - panorama.elevation.step * (panorama.elevation.count - 1);
  const window = (across, up) => {
    const span = Math.min(360, across);
    const top = Math.min(panoTop, camera.tilt + up);
    const bottom = Math.max(panoBottom, camera.tilt - up);
    return { start: (((camera.heading - span / 2) % 360) + 360) % 360, span, top, bottom };
  };
  const asked = window(camera.fov * 1.6 + 2, reach * 0.8 + 0.5);
  if (asked.top <= asked.bottom) return null;
  while ((asked.span / step) * ((asked.top - asked.bottom) / step) > DETAIL_MAX_CELLS) step *= 1.5;
  if (step >= panorama.azimuth.step) return null;
  const shown = window(camera.fov + 0.5, reach / 2 + 0.25);
  return {
    body: {
      azimuth_start: Number(asked.start.toFixed(4)),
      azimuth_span: Number(asked.span.toFixed(4)),
      step: Number(step.toFixed(4)),
      top: Number(asked.top.toFixed(3)),
      bottom: Number(asked.bottom.toFixed(3)),
    },
    need: { ...shown, step },
  };
}

/** Whether a window already held shows what a camera needs now, as finely. */
export function detailCovers(held, wanted) {
  if (!held || !wanted) return false;
  const { need } = wanted;
  if (held.step > need.step * 1.01) return false;
  const off = (((need.start - held.azimuth_start) % 360) + 360) % 360;
  return off + need.span <= held.azimuth_span + 1e-6 && need.top <= held.top + 1e-6
    && need.bottom >= held.bottom - 1e-6;
}

/**
 * @param {object} deps
 * @param {object} deps.api the app's fetch wrapper
 * @param {(answer: object) => Promise<object>} [deps.decode] opens an answer's rasters
 * @param {(fn: Function, ms: number) => any} [deps.later] a timer, for tests
 * @param {(handle: any) => void} [deps.cancel]
 * @param {Storage|null} [deps.storage] where the summit names switch is remembered
 */
export function createHorizonState({
  api,
  decode = decodePanorama,
  image = decodeImage,
  later = setTimeout,
  cancel = clearTimeout,
  storage = browserStorage(),
  open = inflate,
}) {
  const remembered = (key) => {
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const remember = (key, value) => {
    try {
      storage?.setItem(key, value);
    } catch {
      // a refused storage only means the choice is not kept
    }
  };
  let observer = $state(null);
  let camera = $state({ heading: 0, tilt: 0, roll: 0, fov: FOV.start, projection: 'camera' });
  // how far the air lets the eye see, metres, null for clear air; the march reaches past the
  // eye's default only for air that sees farther
  let visibility = $state(null);
  let near = $state(0);
  let ground = $state('relief');
  let lines = $state(linesByDefault('relief'));
  let ridges = $state(2);
  let panorama = $state.raw(null);
  let detail = $state.raw(null);
  let quality = $state('none');
  // the finest terrain all round, asked for: on for the next eyes too, held for this one
  let fullDetail = $state(false);
  let fullHeld = false;
  let fullBusy = $state(false);
  let detailBusy = $state(false);
  let fullError = $state('');
  let busy = $state(false);
  let error = $state('');
  let frame = { width: 0, height: 0 };

  let peaksOn = $state(remembered(PEAKS_KEY) === '1');
  let peaks = $state.raw([]);
  let peaksBusy = $state(false);
  let peaksError = $state('');
  let peaksPending = $state(0);
  let peaksFailed = $state(0);

  let target = $state(null);
  let pointed = $state(null);

  // the ground's colours for Imagery, over the full picture's grid
  let drape = $state.raw(null);
  let drapeBusy = $state(false);
  let drapeError = $state('');
  let drapeAsked = 0;
  let drapeFor = '';
  let fineBody = null;
  let drapeSource = $state(DRAPE_PROVIDER);
  let releases = $state.raw([]);
  let releasesBusy = $state(false);
  // Sentinel-2 on the near ground: switched on, how far, which pass (the one picked, or the
  // newest under the ceiling), the passes found and where, and what it would cost
  let nearOn = $state(false);
  let nearReach = $state(NEAR_REACH);
  let nearDate = $state('');
  let nearPicked = false;
  let nearPasses = $state.raw([]);
  let nearFoundAt = null;
  let nearBusy = $state(false);
  let nearError = $state('');
  let nearEstimate = $state.raw(null);
  let estimateAsked = 0;
  let estimateTimer = null;
  // …and over the finer window, on its own grid
  let detailDrape = $state.raw(null);
  let detailDrapeAsked = 0;
  let detailBody = null;

  let skyOn = $state(false);
  let skyDate = $state('');
  let skyTime = $state('12:00');
  let sky = $state.raw(null);
  let skyBusy = $state(false);
  let skyError = $state('');
  let skyAsked = 0;

  // the light a ridge hides, marched by the app for the light of the hour, and how dark it leaves it
  const keptDepth = Number.parseFloat(remembered(SHADOWS_KEY) ?? '');
  let shadowDepth = $state(Number.isFinite(keptDepth) ? Math.min(1, Math.max(0, keptDepth)) : SHADOW_DEPTH);
  let shadow = $state.raw(null);
  let shadowBusy = $state(false);
  let shadowError = $state('');
  let shadowAsked = 0;
  let shadowTimer = null;
  let shadowFor = '';

  let asked = 0;
  let loadTimer = null;
  let detailTimer = null;
  let detailAsked = 0;
  let detailHeld = null;
  let detailWanted = null;
  let peaksAsked = 0;
  let peaksFor = '';
  let peaksTimer = null;
  let controller = null;

  const body = (extra) => ({
    lat: observer.lat,
    lon: observer.lon,
    mode: observer.mode,
    height: observer.height,
    ...(reachFor(observer.mode, visibility) ? { far: reachFor(observer.mode, visibility) } : {}),
    ...(near > 0 ? { near } : {}),
    ...extra,
  });

  function bottomOf(picture) {
    return picture.elevation.top - picture.elevation.step * (picture.elevation.count - 1);
  }

  async function load() {
    loadTimer = null;
    if (!observer) return;
    const mine = ++asked;
    controller?.abort();
    controller = typeof AbortController === 'function' ? new AbortController() : null;
    const signal = controller?.signal;
    detailAsked += 1;
    detailHeld = null;
    detailBusy = false;
    detail = null;
    detailBody = null;
    detailDrapeAsked += 1;
    detailDrape = null;
    drapeAsked += 1;
    drape = null;
    drapeFor = '';
    shadowAsked += 1;
    shadow = null;
    shadowFor = '';
    shadowBusy = false;
    fullHeld = false;
    fullBusy = false;
    fullError = '';
    fineBody = null;
    busy = true;
    error = '';
    try {
      const coarse = await decode(await api.post('/api/horizon/panorama', body({ step: COARSE_STEP }), { signal }));
      if (mine !== asked) return;
      panorama = coarse;
      quality = 'coarse';
      const asking = body({ step: FINE_STEP, top: coarse.elevation.top, bottom: bottomOf(coarse) });
      const fine = await decode(await api.post('/api/horizon/panorama', asking, { signal }));
      if (mine !== asked) return;
      panorama = fine;
      quality = 'fine';
      fineBody = asking;
      askDetail();
      // a new place may want a newer pass: only the drape waits for it, so nothing
      // billed is laid from the last place's pass first
      if (nearOn && !nearPicked && (!nearFoundAt || distanceBetween(nearFoundAt, observer) > NEAR_REFIND_M)) {
        findPass().then(() => mine === asked && askDrape());
      } else askDrape();
      askEstimate();
      askPeaks();
      askSky();
      if (target) mark(target);
    } catch (failure) {
      if (mine === asked && failure?.name !== 'AbortError') error = failure.message;
    } finally {
      if (mine === asked) busy = false;
    }
  }

  function reload() {
    pointed = null;
    if (loadTimer) cancel(loadTimer);
    loadTimer = later(load, LOAD_DELAY);
  }

  /** The turn again over the finest terrain, once the full picture is in, when asked for. */
  async function fetchFull() {
    if (!fullDetail || fullHeld || fullBusy || quality !== 'fine' || !fineBody) return;
    const mine = asked;
    fullBusy = true;
    fullError = '';
    try {
      const answer = await decode(
        await api.post('/api/horizon/panorama', { ...fineBody, full_detail: true }, { signal: controller?.signal })
      );
      if (mine !== asked) return;
      panorama = answer;
      fullHeld = true;
    } catch (failure) {
      if (mine === asked && failure?.name !== 'AbortError') fullError = failure.message;
    } finally {
      if (mine === asked) fullBusy = false;
    }
  }

  async function fetchDetail() {
    detailTimer = null;
    if (quality !== 'fine') return;
    const wanted = detailRequest(camera, frame, panorama, { always: fullDetail });
    detailWanted = wanted;
    // with full detail, the whole turn follows the window the lens wanted
    if (!wanted || detailCovers(detailHeld, wanted)) {
      fetchFull();
      return;
    }
    const mine = ++detailAsked;
    detailBusy = fullDetail;
    try {
      const asking = body({ ...wanted.body, ...(fullDetail ? { full_detail: true } : {}) });
      const answer = await decode(await api.post('/api/horizon/panorama', asking));
      if (mine !== detailAsked) return;
      detail = answer;
      detailHeld = wanted.body;
      detailBody = asking;
      detailDrape = null;
      askDetailDrape();
    } catch {
      // the turn is still on screen: a window that failed is only a coarser view
    } finally {
      if (mine === detailAsked) {
        detailBusy = false;
        fetchFull();
      }
    }
  }

  function askDetail() {
    if (detailTimer) cancel(detailTimer);
    detailTimer = later(fetchDetail, DETAIL_DELAY);
  }

  /**
   * The names known around the eye. The app answers at once with what it has
   * and says how many areas are still coming from OpenStreetMap; while some
   * are, it is asked again a moment later, so names appear nearest first.
   */
  async function askPeaks() {
    if (peaksTimer) cancel(peaksTimer);
    peaksTimer = null;
    if (!peaksOn || !observer || !panorama) return;
    const altitude = panorama.observer?.altitude;
    if (!Number.isFinite(altitude)) return;
    const key = `${observer.lat},${observer.lon},${altitude},${panorama.far}`;
    if (key === peaksFor) return;
    const mine = ++peaksAsked;
    peaksBusy = true;
    peaksError = '';
    try {
      const answer = await api.get(
        `/api/horizon/peaks?lat=${observer.lat}&lon=${observer.lon}&altitude=${altitude}&far=${panorama.far}`
      );
      if (mine !== peaksAsked) return;
      peaks = answer.peaks;
      peaksPending = answer.pending ?? 0;
      peaksFailed = answer.failed ?? 0;
      if (peaksPending) peaksTimer = later(askPeaks, PEAKS_POLL);
      else peaksFor = key;
    } catch (failure) {
      if (mine === peaksAsked) peaksError = failure.message;
    } finally {
      if (mine === peaksAsked) peaksBusy = peaksPending > 0;
    }
  }

  /**
   * The ground's colours, laid by the app over the very grid of the full
   * picture, which it still holds, so nothing is marched twice.
   */
  /** The Sentinel-2 rendering laid near the eye, or null while it is off or no pass is known. */
  function nearProvider() {
    return nearOn && nearDate
      ? variantId(SENTINEL_ID, { from: nearDate, to: nearDate, maxcc: NEAR_MAXCC })
      : null;
  }

  /** What a drape asks for beyond the picture's grid: the free imagery, and Sentinel-2 near. */
  function drapeAsk() {
    const near = nearProvider();
    return { provider: drapeSource, ...(near ? { near_provider: near, near_reach: nearReach } : {}) };
  }

  async function askDrape() {
    if (ground !== 'imagery' || quality !== 'fine' || !fineBody) return;
    const key = `${JSON.stringify(drapeAsk())}|${JSON.stringify(fineBody)}`;
    if (key === drapeFor) return;
    const mine = ++drapeAsked;
    drapeBusy = true;
    drapeError = '';
    try {
      const answer = await api.post('/api/horizon/drape', { ...fineBody, ...drapeAsk() });
      const picture = await image(answer.image);
      if (mine !== drapeAsked) return;
      drape = { image: picture, credits: answer.credits ?? [] };
      drapeFor = key;
    } catch (failure) {
      if (mine === drapeAsked) drapeError = failure.message;
    } finally {
      if (mine === drapeAsked) drapeBusy = false;
    }
  }

  /** The imagery over the finer window, once it and Imagery are both there. */
  async function askDetailDrape() {
    if (ground !== 'imagery' || !detailBody) return;
    const source = JSON.stringify(drapeAsk());
    if (detailDrape?.body === detailBody && detailDrape.source === source) return;
    const mine = ++detailDrapeAsked;
    const asking = detailBody;
    try {
      const answer = await api.post('/api/horizon/drape', { ...asking, ...drapeAsk() });
      const picture = await image(answer.image);
      if (mine !== detailDrapeAsked || asking !== detailBody) return;
      detailDrape = { image: picture, body: asking, source };
    } catch {
      // the turn's own imagery is still there, only coarser
    }
  }

  /**
   * The Sentinel-2 passes over the eye in the last months, and the newest one
   * under the cloud ceiling unless one was picked: a catalogue request on the
   * analyst's Copernicus account, made only once Sentinel-2 is switched on.
   */
  async function findPass() {
    if (!observer) return;
    nearBusy = true;
    nearError = '';
    const at = { lat: observer.lat, lon: observer.lon };
    try {
      const today = isoDay(new Date());
      const answer = await api.get(
        `/api/satellite/sentinel/dates?lat=${at.lat}&lon=${at.lon}&start=${daysBefore(NEAR_LOOKBACK_DAYS)}&end=${today}`
      );
      nearPasses = answer.dates ?? [];
      nearFoundAt = at;
      if (!nearPicked) {
        const days = Object.fromEntries(nearPasses.map((pass) => [pass.date, pass]));
        nearDate = latestAllowedPass(days, today, NEAR_MAXCC);
        if (!nearDate) nearError = `No Sentinel-2 pass under ${NEAR_MAXCC}% cloud here in the last ${NEAR_LOOKBACK_DAYS} days.`;
      }
    } catch (failure) {
      nearError = failure.message;
    } finally {
      nearBusy = false;
    }
  }

  /** Lay the imagery again, Sentinel-2 near or not. */
  function redrape() {
    drapeFor = '';
    askDrape();
    askDetailDrape();
  }

  function askEstimate() {
    if (estimateTimer) cancel(estimateTimer);
    estimateTimer = later(fetchEstimate, ESTIMATE_DELAY);
  }

  /** How many Sentinel Hub requests laying Sentinel-2 near would cost: worked out by the app, free. */
  async function fetchEstimate() {
    estimateTimer = null;
    if (ground !== 'imagery' || quality !== 'fine' || !fineBody) return;
    const mine = ++estimateAsked;
    try {
      const answer = await api.post('/api/horizon/drape/estimate', {
        ...fineBody,
        provider: drapeSource,
        near_provider: nearProvider() ?? SENTINEL_ID,
        near_reach: nearReach,
      });
      if (mine === estimateAsked) nearEstimate = answer;
    } catch {
      // the switch still works; it only cannot say its cost
      if (mine === estimateAsked) nearEstimate = null;
    }
  }

  /** The sun and the moon over one local day, against this eye's ridges. */
  async function askSky() {
    if (!skyOn || !observer) return;
    const mine = ++skyAsked;
    skyBusy = true;
    skyError = '';
    try {
      const answer = await api.post('/api/horizon/sky', {
        lat: observer.lat,
        lon: observer.lon,
        mode: observer.mode,
        height: observer.height,
        ...(reachFor(observer.mode, visibility) ? { far: reachFor(observer.mode, visibility) } : {}),
        ...(skyDate ? { date: skyDate } : {}),
      });
      if (mine !== skyAsked) return;
      sky = answer;
      // an unset day is today on the place's own clock, which the app knows
      if (!skyDate) skyDate = answer.date;
      askShadow();
    } catch (failure) {
      if (mine === skyAsked) skyError = failure.message;
    } finally {
      if (mine === skyAsked) skyBusy = false;
    }
  }

  /** The light of the chosen hour, or the map's north-west light while no day is read. */
  function lightNow() {
    return skyOn && sky ? skyLight(sky, minuteOf(skyTime) ?? 720) : MAP_LIGHT;
  }

  function askShadow() {
    if (shadowTimer) cancel(shadowTimer);
    shadowTimer = later(fetchShadow, SHADOW_DELAY);
  }

  /** The shadows of the light of the hour over the full picture, once both are there. */
  async function fetchShadow() {
    shadowTimer = null;
    const light = lightNow();
    if (!light.body || light.strength < SHADOW_STRENGTH || quality !== 'fine' || !fineBody) return;
    const lightAzimuth = Number((((light.azimuth % 360) + 360) % 360).toFixed(2)) % 360;
    const lightAltitude = Number(Math.min(90, Math.max(-10, light.altitude)).toFixed(2));
    const key = `${JSON.stringify(fineBody)}|${lightAzimuth}|${lightAltitude}`;
    if (key === shadowFor) return;
    const mine = ++shadowAsked;
    shadowBusy = true;
    shadowError = '';
    try {
      const answer = await api.post('/api/horizon/shadow', {
        ...fineBody,
        light_azimuth: lightAzimuth,
        light_altitude: lightAltitude,
      });
      const bytes = await open(answer.light);
      if (mine !== shadowAsked) return;
      shadow = {
        light: bytes,
        azimuth: answer.azimuth,
        elevation: answer.elevation,
        lightAzimuth: answer.light_azimuth,
        lightAltitude: answer.light_altitude,
      };
      shadowFor = key;
    } catch (failure) {
      if (mine === shadowAsked) shadowError = failure.message;
    } finally {
      if (mine === shadowAsked) shadowBusy = false;
    }
  }

  /** Stand somewhere. The eye keeps its kind and height unless told otherwise. */
  function standAt({ lat, lon }, { mode, height } = {}) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const kind = MODES.includes(mode) ? mode : observer?.mode ?? 'ground';
    const same = kind === observer?.mode;
    observer = {
      lat,
      lon,
      mode: kind,
      height: heightFor(kind, height ?? (same ? observer.height : DEFAULT_HEIGHTS[kind])),
    };
    reload();
  }

  async function mark(at, { height = 0 } = {}) {
    if (!observer || !at) return;
    target = { lat: at.lat, lon: at.lon, height, busy: true };
    try {
      const answer = await api.post('/api/horizon/target', {
        lat: observer.lat,
        lon: observer.lon,
        mode: observer.mode,
        height: observer.height,
        target_lat: at.lat,
        target_lon: at.lon,
        target_height: height,
      });
      if (target?.lat !== at.lat || target?.lon !== at.lon) return;
      target = { lat: at.lat, lon: at.lon, height, ...answer, busy: false };
    } catch (failure) {
      if (target?.lat === at.lat && target?.lon === at.lon) {
        target = { lat: at.lat, lon: at.lon, height, busy: false, error: failure.message };
      }
    }
  }

  return {
    get observer() {
      return observer;
    },
    get camera() {
      return camera;
    },
    /** How far the air lets the eye see, in metres, or null for clear air. */
    get visibility() {
      return visibility;
    },
    get near() {
      return near;
    },
    /** How the ground is drawn: 'relief', 'imagery' or 'plain' (`GROUNDS`). */
    get ground() {
      return ground;
    },
    /** Whether the ridge lines are drawn over it. */
    get lines() {
      return lines;
    },
    /**
     * What a person following the view is told it is doing, or '' when it is
     * finished: one line for the header, the most pressing first.
     */
    get status() {
      if (busy) return quality === 'none' ? 'Drawing the view…' : 'Sharpening…';
      if (fullBusy || detailBusy) return 'Loading full detail…';
      if (nearBusy) return 'Finding the newest Sentinel-2 pass…';
      if (drapeBusy) return 'Laying the imagery over the ground…';
      if (releasesBusy) return 'Reading the imagery archive…';
      if (peaksOn && (peaksPending || peaksBusy)) return 'Reading summit names…';
      if (skyOn && skyBusy) return 'Reading the sky…';
      if (skyOn && shadowBusy) return 'Casting shadows…';
      return '';
    },
    /** 0 (fewest) to 4 (most): how many ridges Lines draws (`RIDGE_STEPS`). */
    get ridges() {
      return ridges;
    },
    setRidges(level) {
      ridges = Math.max(0, Math.min(RIDGE_STEPS.length - 1, Math.round(Number(level) || 0)));
    },
    get panorama() {
      return panorama;
    },
    get detail() {
      return detail;
    },
    /** Whether the finest terrain is asked for, all round out to 20 km. */
    get fullDetail() {
      return fullDetail;
    },
    /** Whether the picture on screen is the full-detail one. */
    get fullHeld() {
      return fullHeld && Boolean(panorama);
    },
    get fullError() {
      return fullError;
    },
    setFullDetail(on) {
      fullDetail = Boolean(on);
      if (!fullDetail) return;
      // windows held were marched over the usual terrain: the lens's first, then the turn
      detailHeld = null;
      askDetail();
    },
    retryFull() {
      fullError = '';
      fetchFull();
    },
    /** 'none' | 'coarse' | 'fine': how finished the picture on screen is. */
    get quality() {
      return quality;
    },
    get busy() {
      return busy;
    },
    get error() {
      return error;
    },
    get peaksOn() {
      return peaksOn;
    },
    get peaks() {
      return peaks;
    },
    get peaksBusy() {
      return peaksBusy;
    },
    get peaksError() {
      return peaksError;
    },
    /** Areas still being read from OpenStreetMap, and areas no server would answer. */
    get peaksPending() {
      return peaksPending;
    },
    get peaksFailed() {
      return peaksFailed;
    },
    /** A point on the map, placed in the view: `{ lat, lon, azimuth, angle, distance, visible, margin_deg }`. */
    get target() {
      return target;
    },
    get skyOn() {
      return skyOn;
    },
    /** The local day and time the sun and moon are read for, on the place's clock. */
    get skyDate() {
      return skyDate;
    },
    get skyTime() {
      return skyTime;
    },
    /** What `/api/horizon/sky` answered for that day. */
    get sky() {
      return sky;
    },
    get skyBusy() {
      return skyBusy;
    },
    get skyError() {
      return skyError;
    },
    showSky(on) {
      skyOn = on;
      if (on) askSky();
      else {
        if (shadowTimer) cancel(shadowTimer);
        shadowTimer = null;
        shadowAsked += 1;
        shadowBusy = false;
      }
    },
    setSkyDate(date) {
      if (!date || date === skyDate) return;
      skyDate = date;
      askSky();
    },
    setSkyTime(time) {
      if (!time || time === skyTime) return;
      skyTime = time;
      askShadow();
    },
    /** How dark the shadows the ground casts are, 0 (light) to 1 (dark); drawn, not marched. */
    get shadowDepth() {
      return shadowDepth;
    },
    setShadowDepth(depth) {
      const next = Number(depth);
      if (!Number.isFinite(next)) return;
      shadowDepth = Math.min(1, Math.max(0, next));
      remember(SHADOWS_KEY, String(shadowDepth));
    },
    /** The light over the view (lib/horizon/sky.js `skyLight`). */
    get light() {
      return lightNow();
    },
    /** The shadows the app marched, `{ light, azimuth, elevation, lightAzimuth, lightAltitude }`. */
    get shadow() {
      return shadow;
    },
    get shadowBusy() {
      return shadowBusy;
    },
    get shadowError() {
      return shadowError;
    },
    retryShadow() {
      shadowFor = '';
      shadowError = '';
      askShadow();
    },
    /** A point picked in the view: `{ lat, lon, azimuth, elevation, distance }`. */
    get pointed() {
      return pointed;
    },

    standAt,

    /**
     * A step along the heading (`1` forward, `-1` back) or across it (`side`:
     * `1` to the right, `-1` to the left), `scale` steps long. The eye keeps
     * its kind, its height above the ground and the way it faces.
     */
    walk({ forward = 0, side = 0, scale = 1 } = {}) {
      if (!observer || (!forward && !side)) return;
      const heading = camera.heading + Math.atan2(side, forward) * (180 / Math.PI);
      const metres = (STEP_M[observer.mode] ?? STEP_M.ground) * scale * Math.hypot(forward, side);
      standAt(groundPoint(observer, heading, metres));
    },

    /** Ground, Drone or Aircraft, each at its usual height. */
    setMode(mode) {
      if (!observer || !MODES.includes(mode) || mode === observer.mode) return;
      observer = { ...observer, mode, height: DEFAULT_HEIGHTS[mode] };
      reload();
    },

    setHeight(height) {
      if (!observer) return;
      const next = heightFor(observer.mode, height);
      if (next === observer.height) return;
      observer = { ...observer, height: next };
      reload();
    },

    /** Turn, tilt, roll or zoom: never a new picture, only a window when one is due. */
    look(change) {
      const next = { ...camera, ...change };
      next.heading = headingOf(next.heading);
      next.tilt = clamp(Number(next.tilt) || 0, TILT.min, TILT.max);
      next.roll = clamp(Number(next.roll) || 0, -180, 180);
      const widest = next.projection === 'panorama' ? 360 : FOV.max;
      next.fov = clamp(Number(next.fov) || FOV.start, FOV.min, widest);
      camera = next;
      if (quality === 'fine') askDetail();
    },

    /**
     * How far the air lets the eye see (metres, null for clear air). Only the
     * haze changes, unless the air sees past what was marched.
     */
    setVisibility(metres) {
      const next =
        Number.isFinite(metres) && metres > 0
          ? Math.min(VISIBILITY_KM.max * 1000, Math.max(VISIBILITY_KM.min * 1000, metres))
          : null;
      if (next === visibility) return;
      const before = observer && reachFor(observer.mode, visibility);
      visibility = next;
      if (observer && reachFor(observer.mode, visibility) !== before) reload();
    },
    /** Ground closer than this many metres is taken away: a hill in front. */
    setNear(metres) {
      const next = Math.max(0, Number(metres) || 0);
      if (next === near) return;
      near = next;
      reload();
    },

    /** Plain ground shows nothing but its lines, so picking it turns them on. */
    setGround(next) {
      if (!GROUNDS.includes(next) || next === ground) return;
      ground = next;
      if (next === 'plain') lines = true;
      askDrape();
      askDetailDrape();
    },
    setLines(on) {
      lines = Boolean(on);
    },
    /** The imagery laid over the ground, `{ image, credits }`, once Imagery asked for it. */
    get drape() {
      return drape;
    },
    /** Which imagery is laid over the ground: the latest, or a dated Wayback release. */
    get drapeSource() {
      return drapeSource;
    },
    setDrapeSource(source) {
      if (!source || source === drapeSource) return;
      drapeSource = source;
      askDrape();
      askDetailDrape();
    },
    /** Wayback's releases, newest first, once asked for (a request to Esri). */
    get releases() {
      return releases;
    },
    get releasesBusy() {
      return releasesBusy;
    },
    async loadReleases() {
      if (releases.length || releasesBusy) return releases;
      releasesBusy = true;
      try {
        releases = (await api.get('/api/satellite/wayback/releases')).releases ?? [];
      } catch (failure) {
        drapeError = failure.message;
      } finally {
        releasesBusy = false;
      }
      return releases;
    },
    /** Whether Sentinel-2 is laid on the near ground, and how far out, in metres. */
    get nearOn() {
      return nearOn;
    },
    get nearReach() {
      return nearReach;
    },
    /** The pass laid (`YYYY-MM-DD`), the passes found (`[{ date, cloud }]`, newest first). */
    get nearDate() {
      return nearDate;
    },
    get nearPasses() {
      return nearPasses;
    },
    get nearBusy() {
      return nearBusy;
    },
    get nearError() {
      return nearError;
    },
    /** `{ requests, tiles }`: what laying Sentinel-2 would ask Sentinel Hub for, not on disk yet. */
    get nearEstimate() {
      return nearEstimate;
    },
    /** Sentinel-2 on the near ground, on or off: on finds the newest pass first, unless one was picked. */
    async setNear(on) {
      nearOn = Boolean(on);
      if (nearOn && !nearDate) await findPass();
      redrape();
      askEstimate();
    },
    setNearReach(metres) {
      const next = NEAR_REACHES.includes(Number(metres)) ? Number(metres) : NEAR_REACH;
      if (next === nearReach) return;
      nearReach = next;
      if (nearOn) redrape();
      askEstimate();
    },
    /** A pass picked from those found; '' goes back to the newest under the ceiling. */
    async setNearDate(day) {
      nearPicked = Boolean(day);
      if (day) nearDate = day;
      else {
        nearDate = '';
        await findPass();
      }
      if (nearOn) redrape();
      askEstimate();
    },
    async retryNear() {
      await findPass();
      if (nearOn) redrape();
    },
    /** Worked out again: the view's Satellite controls ask when they show the switch. */
    askEstimate,
    /** The imagery over the finer window, `{ image }`, when there is one. */
    get detailDrape() {
      return detailDrape;
    },
    get drapeBusy() {
      return drapeBusy;
    },
    get drapeError() {
      return drapeError;
    },

    /** The size of the frame the view draws into, which decides when a window is worth it. */
    setFrame(next) {
      frame = { width: next.width, height: next.height };
      if (quality === 'fine') askDetail();
    },

    showPeaks(on) {
      peaksOn = Boolean(on);
      remember(PEAKS_KEY, peaksOn ? '1' : '0');
      if (on) {
        peaksFor = '';
        askPeaks();
      } else if (peaksTimer) {
        cancel(peaksTimer);
        peaksTimer = null;
        peaksBusy = false;
      }
    },

    mark,
    point(at) {
      pointed = at;
    },
    clearTarget() {
      target = null;
    },

    /** The picture again, from the same eye: after a failure, or to try the network once more. */
    retry() {
      reload();
    },
    /** Summit names again, after OpenStreetMap failed or left areas out. */
    retryPeaks() {
      peaksFor = '';
      peaksFailed = 0;
      askPeaks();
    },
    retryDrape() {
      drapeFor = '';
      drapeError = '';
      askDrape();
      askDetailDrape();
    },
    retrySky() {
      askSky();
    },
    /** The marked point's line of sight again, after it failed. */
    retryTarget() {
      if (target) mark(target, { height: target.height ?? 0 });
    },

    /** What the address should say about this view; `lib/horizon/view.js` writes it. */
    get place() {
      return { observer, camera, visibility, near, ground, lines };
    },

    /** Take a view from the address or a Back, as one move. */
    restore(view) {
      const nextVisibility = view.visibility ?? null;
      const nextNear = view.near ?? 0;
      const mode = view.observer?.mode ?? observer?.mode;
      let moved = reachFor(mode, nextVisibility) !== reachFor(observer?.mode, visibility) || nextNear !== near;
      visibility = nextVisibility;
      near = nextNear;
      if (view.camera) camera = { ...camera, ...view.camera };
      ground = GROUNDS.includes(view.ground) ? view.ground : 'relief';
      lines = view.lines ?? linesByDefault(ground);
      if (view.observer) {
        moved ||=
          !observer ||
          observer.lat !== view.observer.lat ||
          observer.lon !== view.observer.lon ||
          observer.mode !== view.observer.mode ||
          observer.height !== view.observer.height;
        observer = { ...view.observer };
      }
      if (moved && observer) reload();
      else {
        askDrape();
        askDetailDrape();
      }
    },

    destroy() {
      asked += 1;
      detailAsked += 1;
      peaksAsked += 1;
      skyAsked += 1;
      drapeAsked += 1;
      detailDrapeAsked += 1;
      shadowAsked += 1;
      estimateAsked += 1;
      controller?.abort();
      if (loadTimer) cancel(loadTimer);
      if (detailTimer) cancel(detailTimer);
      if (peaksTimer) cancel(peaksTimer);
      if (shadowTimer) cancel(shadowTimer);
      if (estimateTimer) cancel(estimateTimer);
    },

    /** For tests: the window a camera asked for last. */
    get detailWanted() {
      return detailWanted;
    },
  };
}
