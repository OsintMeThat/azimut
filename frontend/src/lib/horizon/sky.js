/**
 * The sun and the moon over a Horizon view, from what `/api/horizon/sky` answers.
 *
 * The app sends each body's track over one local day, every few minutes, with
 * whether its upper limb clears this eye's ridges at each step. This turns it
 * into what the view draws (lines, hour marks, the disc at the chosen time),
 * what the panel says (when each one comes out over the ridges and goes
 * behind them), the sun's day painted along the time slider, and where the
 * light comes from for the shaded relief.
 */

/** "07:42" for minutes since local midnight. */
export function clockOf(minute) {
  const whole = Math.max(0, Math.min(24 * 60, Math.round(minute)));
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

/** Minutes since midnight from "HH:MM", or null. */
export function minuteOf(text) {
  const found = /^(\d{1,2}):(\d{2})/.exec(String(text ?? ''));
  if (!found) return null;
  const hours = Number(found[1]);
  const minutes = Number(found[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

/** "07:42" out of a local stamp the app sends (`localtime.both`). */
function stampClock(stamp) {
  return stamp?.local ? stamp.local.slice(11, 16) : null;
}

/** A body's place at a minute of the day, between the two samples around it. */
export function skyAt(answer, body, minute) {
  const track = answer?.[body];
  if (!track?.azimuth?.length || !Number.isFinite(minute)) return null;
  const at = minute / answer.step_minutes;
  const i = Math.max(0, Math.min(track.azimuth.length - 2, Math.floor(at)));
  const share = Math.max(0, Math.min(1, at - i));
  const a0 = track.azimuth[i];
  // azimuth is read the short way round north
  const turn = ((((track.azimuth[i + 1] - a0) % 360) + 540) % 360) - 180;
  return {
    azimuth: (((a0 + share * turn) % 360) + 360) % 360,
    altitude: track.altitude[i] + share * (track.altitude[i + 1] - track.altitude[i]),
    clear: share < 0.5 ? track.clear[i] : track.clear[i + 1],
  };
}

/**
 * What the view draws: each body's track while it is up, an hour mark on each
 * whole hour, and the disc at `minute`. Below the sea-level horizon a track is
 * left out; behind a ridge it is kept, so the eye sees where it goes.
 */
export function skyTracks(answer, { minute = null, below = -2 } = {}) {
  if (!answer) return [];
  return ['sun', 'moon'].map((body) => {
    const track = answer[body];
    const points = [];
    for (let i = 0; i < track.azimuth.length; i += 1) {
      if (track.altitude[i] < below) {
        if (points.length && !points.at(-1).gap) points.push({ gap: true });
        continue;
      }
      const at = i * answer.step_minutes;
      points.push({
        azimuth: track.azimuth[i],
        altitude: track.altitude[i],
        clear: track.clear[i],
        label: at % 60 === 0 ? clockOf(at).slice(0, 2) : null,
      });
    }
    const now = minute == null ? null : skyAt(answer, body, minute);
    return { id: body, body, points, now: now && now.altitude >= below ? now : null };
  });
}

/** One line per body for the panel: over the ridges, then the sea-level times. */
export function skyLines(answer) {
  if (!answer?.sun?.events || !answer?.moon?.events) return [];
  const lines = [];
  const sun = answer.sun;
  const out = sun.events.filter((event) => event.kind === 'appears').map((event) => clockOf(event.minute));
  const hidden = sun.events.filter((event) => event.kind === 'hides').map((event) => clockOf(event.minute));
  if (out.length || hidden.length) {
    const parts = [];
    if (out.length) parts.push(`out over the ridges ${out.join(', ')}`);
    if (hidden.length) parts.push(`behind them ${hidden.join(', ')}`);
    lines.push(`Sun ${parts.join(' · ')}`);
  } else {
    lines.push(sun.clear.some(Boolean) ? 'Sun over the ridges all day' : 'Sun behind the ridges all day');
  }
  const rise = stampClock(sun.sea_level?.rise);
  const set = stampClock(sun.sea_level?.set);
  if (rise || set) lines.push(`Sea-level sunrise ${rise ?? '–'}, sunset ${set ?? '–'}`);
  const moon = answer.moon;
  const moonOut = moon.events.filter((event) => event.kind === 'appears').map((event) => clockOf(event.minute));
  const moonHidden = moon.events.filter((event) => event.kind === 'hides').map((event) => clockOf(event.minute));
  const lit = `${Math.round((moon.illuminated ?? 0) * 100)}% lit`;
  if (moonOut.length || moonHidden.length) {
    const parts = [];
    if (moonOut.length) parts.push(`out ${moonOut.join(', ')}`);
    if (moonHidden.length) parts.push(`behind the ridges ${moonHidden.join(', ')}`);
    lines.push(`Moon ${parts.join(' · ')} · ${lit}`);
  } else {
    lines.push(`Moon ${moon.clear.some(Boolean) ? 'over the ridges all day' : 'not over the ridges today'} · ${lit}`);
  }
  return lines;
}

/**
 * The sun's day in stretches, for the time slider: `clear` while it stands
 * over the ridges, `hidden` while it is up but behind them, `down` while it is
 * under the horizon. Minutes from local midnight, `to` excluded.
 *
 * @returns {{ from: number, to: number, kind: 'clear'|'hidden'|'down' }[]}
 */
export function sunBands(answer) {
  const sun = answer?.sun;
  const step = answer?.step_minutes;
  if (!sun?.altitude?.length || !(step > 0)) return [];
  const bands = [];
  for (let i = 0; i < sun.altitude.length; i += 1) {
    // the ridges' answer first: from a height the sun clears them under the sea-level horizon
    const kind = sun.clear[i] ? 'clear' : sun.altitude[i] > -1 ? 'hidden' : 'down';
    const from = i * step;
    if (from >= 24 * 60) break;
    const to = Math.min(24 * 60, from + step);
    const last = bands.at(-1);
    if (last?.kind === kind) last.to = to;
    else bands.push({ from, to, kind });
  }
  return bands;
}

/** Those stretches as a CSS gradient along a 24-hour track, in these colours by kind. */
export function bandsGradient(bands, colours) {
  if (!bands.length) return 'none';
  const day = 24 * 60;
  const stops = bands.map(
    (band) => `${colours[band.kind]} ${((band.from / day) * 100).toFixed(2)}% ${((band.to / day) * 100).toFixed(2)}%`
  );
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/** How a relief map is lit when no time is set: from the north-west, at full day. */
export const MAP_LIGHT = Object.freeze({
  phase: 'map',
  body: null,
  azimuth: 315,
  altitude: 45,
  strength: 1,
  ambient: 0.22,
  tint: [1, 1, 1],
  sky: 1,
});

/** The sun under this many degrees ends civil twilight: night. */
const TWILIGHT = -6;
const mix = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.min(1, Math.max(0, t));

/**
 * The sky's own light, against the body's: low enough that a ridge's shadow
 * reads as one, and a night as a night (the map light keeps a map's 0.22).
 */
const DAY_AMBIENT = 0.1;
const NIGHT_AMBIENT = 0.025;
/**
 * How dark the shadows the ground casts are, 0 (light) to 1 (dark), and where
 * it starts. It touches only ground the light does not reach: in the open, a
 * slope keeps its light whatever it is set to.
 */
export const SHADOW_DEPTH = 0.6;

/**
 * The share of the sky's light ground in shadow keeps for a depth: 2.4 at 0
 * (the sky fills shadows as on a map), 1 at the default, 0.3 at 1 (nearly black).
 */
export function shadowKeep(depth = SHADOW_DEPTH) {
  const d = clamp01(Number.isFinite(depth) ? depth : SHADOW_DEPTH);
  return d <= SHADOW_DEPTH ? mix(2.4, 1, d / SHADOW_DEPTH) : mix(1, 0.3, (d - SHADOW_DEPTH) / (1 - SHADOW_DEPTH));
}

const COOL = [0.7, 0.8, 1];
const WARM = [1, 0.78, 0.55];

/**
 * The light over the view at `minute`: which body lights the ground and casts
 * its shadows, how strongly, in what colour, how much light the sky itself
 * gives, and how bright the sky is (1 by day, toward 0 at night).
 *
 * - **Day**, the sun up: full light, warmer as the sun sinks.
 * - **Twilight**, the sun under the horizon down to 6°: no direct sun, a sky
 *   fading to night; a moon up already lights.
 * - **Night**: the moon lights the ground while it is up, coolly and as
 *   brightly as its phase allows; without it, only a faint sky light, enough
 *   to keep the ridges readable.
 */
export function skyLight(answer, minute) {
  const sun = skyAt(answer, 'sun', minute);
  if (!sun) return MAP_LIGHT;
  if (sun.altitude > 0) {
    const low = clamp01(sun.altitude / 20);
    return {
      phase: 'day',
      body: 'sun',
      azimuth: sun.azimuth,
      altitude: sun.altitude,
      strength: 1,
      ambient: DAY_AMBIENT,
      tint: WARM.map((warm) => mix(warm, 1, low)),
      sky: mix(0.55, 1, clamp01(sun.altitude / 6)),
    };
  }
  // 0 at sunset, 1 once twilight has ended
  const dark = clamp01(sun.altitude / TWILIGHT);
  const moon = skyAt(answer, 'moon', minute);
  const lit = answer.moon?.illuminated ?? 0;
  const moonUp = moon && moon.altitude > 0 && lit > 0.02;
  const base = {
    phase: dark < 1 ? 'twilight' : 'night',
    ambient: mix(DAY_AMBIENT * 0.8, NIGHT_AMBIENT, dark),
    sky: mix(0.4, 0.02 + (moonUp ? 0.05 * lit : 0), dark),
  };
  if (!moonUp) return { ...base, body: null, azimuth: 0, altitude: -90, strength: 0, tint: COOL };
  return {
    ...base,
    body: 'moon',
    azimuth: moon.azimuth,
    altitude: moon.altitude,
    strength: 0.3 * lit * dark,
    tint: COOL,
  };
}
