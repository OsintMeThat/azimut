/**
 * Below the North Pole.
 *
 * Past 85.05° the imagery stops, where the Mercator grid ends, and the globe
 * draws nothing there: through the round hole at each pole it shows its own
 * inside, the far side's imagery and the other hole. The globe is hollow, and
 * someone lives at its centre. This module only reads the view: how wide the
 * northern hole stands on the screen, where the centre of the Earth shows
 * through it, and so what the overlay (tools/satellite/NorthPole.svelte) shows.
 * Nothing here moves the camera, writes to the case or reaches the network.
 */
import { EARTH, MERC_LAT } from './earth.js';

/** Points round the hole's rim measured to know how wide it stands on screen. */
export const RIM_SAMPLES = 32;
/** The hole's radius over half the screen's shorter side when the eyes at the centre start to show, and when they show plainly. */
export const HINT_FROM = 0.3;
export const HINT_FULL = 0.6;
/** Filled past this, with the centre of the Earth near the middle, the view falls in; and always once the rim is behind the eye. */
export const DIVE_AT = 1;
/** How far from the middle the centre of the Earth may show for the view to fall in, in half the shorter side. */
export const DIVE_AIM = 0.45;
/** Kilometres from the surface to the centre of the Earth. */
export const DEPTH_KM = 6371;

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * The northern hole as the screen shows it, or null when the centre of the Earth
 * stands behind the eye.
 *
 * `engine` is the globe's façade: `projectAt(lat, lon, metres)`, whose metres the
 * relief's `exaggeration` multiplies, and `surfaceAt({ x, y })`. `core` is where the
 * centre of the Earth falls on the screen, `radius` the rim's half-width in pixels
 * and `reach` that over half the shorter side (Infinity once the eye is so close the
 * rim leaves the screen behind it), `aim` how far the core stands from the middle on
 * the same scale, and `seen` whether the core shows through the hole rather than
 * behind the ground: true only from above the hole.
 */
export function holeOnScreen(engine, width, height, exaggeration = 1) {
  const core = engine.projectAt(90, 0, -EARTH / Math.max(1e-3, exaggeration));
  if (!core || !Number.isFinite(core.x) || !Number.isFinite(core.y) || !(width > 0) || !(height > 0)) return null;
  const half = Math.min(width, height) / 2;
  const rim = [];
  for (let i = 0; i < RIM_SAMPLES; i += 1) {
    const at = engine.projectAt(MERC_LAT, -180 + (360 * i) / RIM_SAMPLES, 0);
    if (!at || !Number.isFinite(at.x)) {
      rim.length = 0;
      break;
    }
    rim.push(at);
  }
  let radius = Infinity;
  if (rim.length) {
    const cx = rim.reduce((s, p) => s + p.x, 0) / rim.length;
    const cy = rim.reduce((s, p) => s + p.y, 0) / rim.length;
    radius = Math.max(...rim.map((p) => Math.hypot(p.x - cx, p.y - cy)));
  }
  const onScreen = core.x >= 0 && core.y >= 0 && core.x <= width && core.y <= height;
  const through = onScreen ? engine.surfaceAt({ x: core.x, y: core.y }) : null;
  return {
    core: { x: core.x, y: core.y },
    radius,
    reach: radius / half,
    aim: Math.hypot(core.x - width / 2, core.y - height / 2) / half,
    seen: Boolean(through) && through.lat > MERC_LAT,
  };
}

/** What the hole calls for: nothing, the eyes at its bottom, or the fall. */
export function poleStage(hole) {
  if (!hole?.seen) return 'none';
  if (hole.reach === Infinity || (hole.reach >= DIVE_AT && hole.aim <= DIVE_AIM)) return 'dive';
  if (hole.reach >= HINT_FROM) return 'hint';
  return 'none';
}

/** How plainly the eyes show, 0 to 1, as the hole grows on screen. */
export function hintStrength(reach) {
  return clamp01((reach - HINT_FROM) / (HINT_FULL - HINT_FROM));
}

/** Whether the hole may take the view again: the view has left it, down to no eyes at all. */
export function rearmed(hole) {
  return poleStage(hole) === 'none';
}

/** The dive's pace, `t` from 0 to 1: a slow lean in, then faster and faster, as a fall. */
export function diveEase(t) {
  const k = clamp01(t);
  return k ** 2.4;
}

/** The depth read during the fall, km below the surface, `t` from 0 to 1: slow away, fast through, slow to the bottom. */
export function fallDepth(t) {
  const k = clamp01(t);
  return DEPTH_KM * k * k * (3 - 2 * k);
}

/** The fall's speed, 0 to 1, `t` from 0 to 1: it gathers, rushes, and comes to rest at the bottom. */
export function fallSpeed(t) {
  const k = clamp01(t);
  return Math.sin(Math.PI * k) ** 0.7;
}
