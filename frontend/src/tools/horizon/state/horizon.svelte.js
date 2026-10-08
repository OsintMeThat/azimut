/**
 * The Horizon tab's view: where the eye stands, how it looks, and what the app
 * worked out from there.
 *
 * The picture itself is drawn in the browser from terrain meshes
 * (lib/horizon/mesh/scene.js), which the view lays round the eye once it has
 * rested there (`placed`, after `LOAD_DELAY`, so a dragged eye lands once).
 * The app marches the same eye's turn as well (`/api/horizon/panorama`, a
 * tenth of a degree a cell): the skyline the summit names sit on, the strip,
 * the map's footprint and the trace's gap are read off it. A newer move drops
 * whatever an older one is still waiting for.
 *
 * Summit names come from OpenStreetMap only once the analyst switches them on,
 * the same rule every overlay keeps: the network is reached for what was asked.
 * The switch is remembered in this browser, since turning it on was that
 * analyst's own choice. So does the imagery laid over the ground (Satellite),
 * read from a free provider once that ground is picked (`imagery`, which the
 * tiles are drawn with). Sentinel-2, billed on the analyst's Copernicus
 * account, is laid only on the ground nearer than a distance and only once
 * switched on (`setNear`); how many requests that costs is worked out first,
 * for free (`nearEstimate`).
 *
 * With a day set, the sun or the moon lights the ground (`light`), and ridges
 * cast their shadows (`shaded`): both are drawn on the GPU, so they follow the
 * hour slider at once.
 */
import { decodePanorama } from '../../../lib/horizon/panorama.js';
import { MAP_LIGHT, minuteOf, SHADOW_DEPTH, skyLight } from '../../../lib/horizon/sky.js';
import { distanceBetween, groundPoint } from '../../../lib/horizon/geometry.js';
import { daysBefore, isoDay, latestAllowedPass, SENTINEL_ID, variantId } from '../../../lib/sentinel.js';
import {
  DEFAULT_HEIGHTS,
  DEFAULT_REACH,
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

/** The free imagery laid over the ground in Imagery (api/horizon.py `/tiles/imagery`). */
export const DRAPE_PROVIDER = 'esri-world-imagery';
/** A dated Wayback release of the same imagery, for the ground as it was. */
export const waybackSource = (release) => `esri-wayback~${release}`;

/** Degrees a cell of the turn the app marches for the skyline. */
export const PANORAMA_STEP = 0.1;
/** ms an eye must rest before its picture is asked for: a dragged eye asks once. */
export const LOAD_DELAY = 220;
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

/** A light weaker than this casts no shadow worth drawing (a thin moon). */
export const SHADOW_STRENGTH = 0.04;

/** Whether a light casts shadows: the sun's or the moon's, strong enough. */
export const castsShadows = (light) => Boolean(light?.body && light.strength >= SHADOW_STRENGTH);

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

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

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
  later = setTimeout,
  cancel = clearTimeout,
  storage = browserStorage(),
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
  // the eye as last placed, which the meshes and the march are both for
  let placed = $state.raw(null);
  let camera = $state({ heading: 0, tilt: 0, roll: 0, fov: FOV.start, projection: 'camera' });
  // how far the air lets the eye see, metres, null for clear air; the view reaches past the
  // eye's default only for air that sees farther
  let visibility = $state(null);
  let near = $state(0);
  let ground = $state('relief');
  let lines = $state(linesByDefault('relief'));
  let ridges = $state(2);
  let panorama = $state.raw(null);
  let busy = $state(false);
  let error = $state('');
  // how many times what failed was asked for again, which the view's tiles follow
  let retries = $state(0);

  let peaksOn = $state(remembered(PEAKS_KEY) === '1');
  let peaks = $state.raw([]);
  let peaksBusy = $state(false);
  let peaksError = $state('');
  let peaksPending = $state(0);
  let peaksFailed = $state(0);

  let target = $state(null);
  let pointed = $state(null);

  // the imagery the ground is drawn in, and what the app said when it refused it
  let drapeSource = $state(DRAPE_PROVIDER);
  let imageryError = $state('');
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

  let skyOn = $state(false);
  let skyDate = $state('');
  let skyTime = $state('12:00');
  let sky = $state.raw(null);
  let skyBusy = $state(false);
  let skyError = $state('');
  let skyAsked = 0;

  // how dark the shadows ridges cast leave the ground, kept in this browser
  const keptDepth = Number.parseFloat(remembered(SHADOWS_KEY) ?? '');
  let shadowDepth = $state(Number.isFinite(keptDepth) ? Math.min(1, Math.max(0, keptDepth)) : SHADOW_DEPTH);

  let asked = 0;
  let loadTimer = null;
  let peaksAsked = 0;
  let peaksFor = '';
  let peaksTimer = null;
  let controller = null;

  const reachOf = (eye) => reachFor(eye.mode, visibility) ?? DEFAULT_REACH[eye.mode] ?? DEFAULT_REACH.ground;

  const body = (extra) => ({
    lat: observer.lat,
    lon: observer.lon,
    mode: observer.mode,
    height: observer.height,
    ...(reachFor(observer.mode, visibility) ? { far: reachFor(observer.mode, visibility) } : {}),
    ...(near > 0 ? { near } : {}),
    ...extra,
  });

  async function load() {
    loadTimer = null;
    if (!observer) return;
    const mine = ++asked;
    controller?.abort();
    controller = typeof AbortController === 'function' ? new AbortController() : null;
    const signal = controller?.signal;
    placed = { ...observer, far: reachOf(observer) };
    busy = true;
    error = '';
    // a new place may want a newer pass: looked for before anything billed is laid there
    if (nearOn && !nearPicked && (!nearFoundAt || distanceBetween(nearFoundAt, observer) > NEAR_REFIND_M)) {
      findPass();
    }
    askSky();
    if (target) mark(target);
    try {
      const turn = await decode(await api.post('/api/horizon/panorama', body({ step: PANORAMA_STEP }), { signal }));
      if (mine !== asked) return;
      panorama = turn;
      askPeaks();
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

  /** The Sentinel-2 rendering laid near the eye, or null while it is off or no pass is known. */
  function nearProvider() {
    return nearOn && nearDate
      ? variantId(SENTINEL_ID, { from: nearDate, to: nearDate, maxcc: NEAR_MAXCC })
      : null;
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

  function askEstimate() {
    if (estimateTimer) cancel(estimateTimer);
    estimateTimer = later(fetchEstimate, ESTIMATE_DELAY);
  }

  /** How many Sentinel Hub requests laying Sentinel-2 near would cost: worked out by the app, free. */
  async function fetchEstimate() {
    estimateTimer = null;
    if (ground !== 'imagery' || !observer) return;
    const mine = ++estimateAsked;
    try {
      const answer = await api.post('/api/horizon/tiles/estimate', {
        lat: observer.lat,
        lon: observer.lon,
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
    /** The eye as last placed, with how far it sees (`far`): what the view lays its ground round. */
    get placed() {
      return placed;
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
      if (nearBusy) return 'Finding the newest Sentinel-2 pass…';
      if (releasesBusy) return 'Reading the imagery archive…';
      if (peaksOn && (peaksPending || peaksBusy)) return 'Reading summit names…';
      if (skyOn && skyBusy) return 'Reading the sky…';
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
    },
    setSkyDate(date) {
      if (!date || date === skyDate) return;
      skyDate = date;
      askSky();
    },
    setSkyTime(time) {
      if (!time || time === skyTime) return;
      skyTime = time;
    },
    /** How dark the shadows the ground casts are, 0 (light) to 1 (dark). */
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
    /** Whether ridges cast shadows now: a day is read and the sun or the moon is strong enough. */
    get shaded() {
      return skyOn && castsShadows(lightNow());
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

    /** Turn, tilt, roll or zoom: nothing asked of the app. */
    look(change) {
      const next = { ...camera, ...change };
      next.heading = headingOf(next.heading);
      next.tilt = clamp(Number(next.tilt) || 0, TILT.min, TILT.max);
      next.roll = clamp(Number(next.roll) || 0, -180, 180);
      const widest = next.projection === 'panorama' ? 360 : FOV.max;
      next.fov = clamp(Number(next.fov) || FOV.start, FOV.min, widest);
      camera = next;
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
    setNearLimit(metres) {
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
    },
    setLines(on) {
      lines = Boolean(on);
    },
    /**
     * The imagery the ground is drawn in: the free provider all round, and
     * Sentinel-2 nearer than its reach once switched on and a pass is known;
     * null while the ground is not Satellite, so nothing is read for it.
     */
    get imagery() {
      if (ground !== 'imagery') return null;
      const sentinel = nearProvider();
      return { provider: drapeSource, near: sentinel ? { provider: sentinel, reach: nearReach } : null };
    },
    /** Which imagery is laid over the ground: the latest, or a dated Wayback release. */
    get drapeSource() {
      return drapeSource;
    },
    setDrapeSource(source) {
      if (!source || source === drapeSource) return;
      drapeSource = source;
      imageryError = '';
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
        imageryError = failure.message;
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
      imageryError = '';
      if (nearOn && !nearDate) await findPass();
      askEstimate();
    },
    setNearReach(metres) {
      const next = NEAR_REACHES.includes(Number(metres)) ? Number(metres) : NEAR_REACH;
      if (next === nearReach) return;
      nearReach = next;
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
      askEstimate();
    },
    async retryNear() {
      await findPass();
    },
    /** Worked out again: the view's Satellite controls ask, only where a Copernicus key is set. */
    askEstimate,
    /** What the app said when it refused the imagery asked (a paused quota, a key gone), or ''. */
    get imageryError() {
      return imageryError;
    },
    /** The view's tiles were refused their imagery: said here, with a way to ask again. */
    imageryRefused(message) {
      imageryError = message || 'The imagery could not be loaded.';
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
      retries += 1;
      reload();
    },
    /** Counts the asks to try again, which the view's tiles answer by asking what came back empty. */
    get retries() {
      return retries;
    },
    /** Summit names again, after OpenStreetMap failed or left areas out. */
    retryPeaks() {
      peaksFor = '';
      peaksFailed = 0;
      askPeaks();
    },
    retryImagery() {
      imageryError = '';
      retries += 1;
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
    },

    destroy() {
      asked += 1;
      peaksAsked += 1;
      skyAsked += 1;
      estimateAsked += 1;
      controller?.abort();
      if (loadTimer) cancel(loadTimer);
      if (peaksTimer) cancel(peaksTimer);
      if (estimateTimer) cancel(estimateTimer);
    },
  };
}
