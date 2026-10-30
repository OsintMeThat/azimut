/**
 * A Horizon view as its address says it (`#horizon?ll=…`), and back.
 *
 * Where the eye stands, how high, which way it looks and through how wide a
 * lens: enough to reload the tab, reopen it from a link or step back to it,
 * nothing that belongs to the case. Everything read back is validated, since
 * an address is something an analyst may have typed.
 */

export const MODES = ['ground', 'drone', 'aircraft'];
export const MODE_LABELS = { ground: 'On foot', drone: 'Drone', aircraft: 'Aircraft' };
/** A person's eyes, a drone at a common working height, a light aircraft. */
export const DEFAULT_HEIGHTS = { ground: 1.7, drone: 120, aircraft: 3000 };
/**
 * What each eye may be given, in metres: above the ground for a person or a
 * drone, above the sea for an aircraft (api/horizon.py `HEIGHT_LIMITS`).
 */
export const HEIGHT_LIMITS = { ground: [0, 100], drone: [1, 3000], aircraft: [1, 15000] };
/** The lens, as a horizontal field of view in degrees. */
export const FOV = { min: 1, max: 150, start: 60 };
/** Rectilinear like a photo, or the whole turn as a strip. */
export const PROJECTIONS = ['camera', 'panorama'];
/**
 * How the ground is drawn: shaded by its slope, in satellite imagery, or flat
 * so that only the ridge lines read. The lines are a layer of their own over
 * any of the three (Phase 5 lays them alone over a photo).
 */
export const GROUNDS = ['relief', 'imagery', 'plain'];
/** Ridge lines are on by default only over the plain ground, which shows nothing else. */
export const linesByDefault = (ground) => ground === 'plain';
/**
 * How far the air lets the eye see, in km: farther ground fades into haze
 * (none set is clear air), and ground from how near, in metres.
 */
export const VISIBILITY_KM = { min: 1, max: 500 };
export const NEAR_M = { min: 0, max: 50000 };
/** How far each eye's march reaches by default, in metres (engine/horizon.py `default_far`). */
export const DEFAULT_REACH = { ground: 150_000, drone: 150_000, aircraft: 300_000 };
/** The visibility slider: its last step is clear air, the others run 1 to 300 km on a log scale. */
export const VISIBILITY_STEPS = 100;
const SLIDER_TOP_KM = 300;

/**
 * How far the march must reach, in metres, for a visibility: farther than the
 * eye's default only when the air lets it see farther; null for the default.
 */
export function reachFor(mode, visibility) {
  const usual = DEFAULT_REACH[mode] ?? DEFAULT_REACH.ground;
  return visibility > usual ? Math.min(VISIBILITY_KM.max * 1000, visibility) : null;
}

/** The visibility a slider step stands for, in metres, or null for clear air. */
export function visibilityAt(step) {
  const top = VISIBILITY_STEPS;
  if (!(step < top)) return null;
  const share = Math.max(0, step) / (top - 1);
  return Math.round(1000 * SLIDER_TOP_KM ** share);
}

/** …and back: the slider step nearest a visibility. */
export function visibilityStep(visibility) {
  if (!(visibility > 0)) return VISIBILITY_STEPS;
  const km = Math.min(SLIDER_TOP_KM, Math.max(1, visibility / 1000));
  return Math.round((Math.log(km) / Math.log(SLIDER_TOP_KM)) * (VISIBILITY_STEPS - 1));
}
/** How far up and down the camera may look, in degrees. */
export const TILT = { min: -89, max: 89 };

const clamp = (value, [low, high]) => Math.min(high, Math.max(low, value));
const finite = (value) => value !== null && value !== '' && Number.isFinite(Number(value));
const round = (value, places) => Number(Number(value).toFixed(places));

/** A height this eye may stand at. */
export function heightFor(mode, height) {
  const limits = HEIGHT_LIMITS[mode] ?? HEIGHT_LIMITS.ground;
  return clamp(finite(height) ? Number(height) : DEFAULT_HEIGHTS[mode] ?? DEFAULT_HEIGHTS.ground, limits);
}

/** 0–360 from anything a hand or an address gives. */
export function headingOf(value) {
  const n = Number(value);
  return Number.isFinite(n) ? ((n % 360) + 360) % 360 : 0;
}

/**
 * The view as address parameters.
 *
 * @param {object} view
 * @param {{lat:number, lon:number, mode:string, height:number}|null} view.observer
 * @param {{heading:number, tilt:number, roll:number, fov:number, projection:string}} view.camera
 * @param {number|null} [view.visibility] metres, null for clear air
 * @param {number} [view.near] metres
 * @param {string} [view.ground] one of `GROUNDS`
 * @param {boolean} [view.lines] whether the ridge lines are drawn over it
 */
export function horizonParams({ observer, camera, visibility = null, near = 0, ground = 'relief', lines = linesByDefault(ground) }) {
  const params = {};
  if (observer && Number.isFinite(observer.lat) && Number.isFinite(observer.lon)) {
    params.ll = `${round(observer.lat, 6)},${round(observer.lon, 6)}`;
    if (observer.mode && observer.mode !== 'ground') params.m = observer.mode;
    if (observer.height !== DEFAULT_HEIGHTS[observer.mode ?? 'ground']) params.h = String(round(observer.height, 1));
  }
  if (camera) {
    params.hd = String(round(headingOf(camera.heading), 1));
    if (camera.tilt) params.tl = String(round(camera.tilt, 1));
    if (camera.roll) params.rl = String(round(camera.roll, 1));
    params.fov = String(round(camera.fov, 1));
    if (camera.projection === 'panorama') params.p = 'panorama';
  }
  if (Number.isFinite(visibility) && visibility > 0) params.f = String(round(visibility / 1000, 1));
  if (near > 0) params.n = String(Math.round(near));
  if (ground !== 'relief') params.r = ground;
  if (Boolean(lines) !== linesByDefault(ground)) params.l = lines ? '1' : '0';
  return params;
}

/** …and back: whatever of a view an address holds, checked. */
export function readHorizonView(params) {
  const get = (name) => (params instanceof URLSearchParams ? params.get(name) : params?.[name] ?? null);
  const view = {};
  const ll = String(get('ll') ?? '').split(',');
  if (ll.length === 2 && finite(ll[0]) && finite(ll[1])) {
    const lat = Number(ll[0]);
    const lon = Number(ll[1]);
    if (Math.abs(lat) <= 85 && Math.abs(lon) <= 180) {
      const mode = MODES.includes(get('m')) ? get('m') : 'ground';
      view.observer = { lat, lon, mode, height: heightFor(mode, get('h')) };
    }
  }
  const camera = {};
  if (finite(get('hd'))) camera.heading = headingOf(get('hd'));
  if (finite(get('tl'))) camera.tilt = clamp(Number(get('tl')), [TILT.min, TILT.max]);
  if (finite(get('rl'))) camera.roll = clamp(Number(get('rl')), [-180, 180]);
  if (finite(get('fov'))) camera.fov = clamp(Number(get('fov')), [FOV.min, get('p') === 'panorama' ? 360 : FOV.max]);
  if (PROJECTIONS.includes(get('p'))) camera.projection = get('p');
  if (Object.keys(camera).length) view.camera = camera;
  if (finite(get('f'))) view.visibility = clamp(Number(get('f')), [VISIBILITY_KM.min, VISIBILITY_KM.max]) * 1000;
  if (finite(get('n'))) view.near = clamp(Number(get('n')), [NEAR_M.min, NEAR_M.max]);
  if (GROUNDS.includes(get('r'))) view.ground = get('r');
  if (get('l') === '1' || get('l') === '0') view.lines = get('l') === '1';
  return view;
}
