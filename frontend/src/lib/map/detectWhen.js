/**
 * The When step of a detection, the part that is not a view.
 *
 * Every area keeps its own pair of sources, because areas far apart can sit
 * under different swaths. Most detections still want one pair for all of
 * them, so the step reads and writes every area at once, and only says "per
 * area" when the areas really do differ.
 *
 * A is the picture before, B the one to look in. An empty B date is the
 * newest pass under the cloud ceiling, looked up when the run starts; a routine
 * never holds one.
 */
import { sunPosition } from './changeDetect.js';
import { zoneRing } from './analyzers.js';
import { FULL_COVER } from './acquisitions.js';
import { onTrack, sameTrack } from '../radar.js';

/** How much a 10 m building's shadow may change length between two passes,
 *  in metres, before it reads as a change: half a Sentinel-2 pixel. */
export const SHADOW_SHIFT_M = 5;

/** The cloud ceiling a new detection starts with. Above it, a pass taken on its
 *  own can be mostly cloud. */
export const ADVISED_MAXCC = 30;

/** What a ceiling above the advised one costs, or '' at or under it. */
export function ceilingWarning(maxcc) {
  if (!(maxcc > ADVISED_MAXCC)) return '';
  return `Above ${ADVISED_MAXCC}%, the pass taken can be mostly cloud, and ground under cloud is left out.`;
}

/**
 * What "the newest pass" means once the cloud ceiling is part of it, in words.
 * It is the newest pass the ceiling allows, which is not always the newest
 * there is. Radar sees through cloud, and a ceiling of 100 lets every pass
 * through, so only a real ceiling is said.
 */
export function newestLabel({ maxcc = 100, radar = false } = {}) {
  return radar || !(maxcc < 100) ? 'newest pass' : `newest pass under ${maxcc}% cloud`;
}

/**
 * The pass "newest" would take from a looked-up list, newest first, and the
 * newer ones it steps over, each with why: 'cloud' or 'cover'. The rule is the
 * one the run applies at launch (`resolve_dates`): the tile's cloud known and
 * at or under the ceiling, and the whole area covered. Radar keeps to `track`.
 */
export function newestPick(list, { maxcc = 100, radar = false, track = '' } = {}) {
  const skipped = [];
  for (const entry of radar ? onTrack(list, track) : (list ?? [])) {
    const why = !radar && !(entry.cloud != null && entry.cloud <= maxcc) ? 'cloud'
      : !((entry.coverage ?? 0) >= FULL_COVER) ? 'cover' : '';
    if (!why) return { pass: entry, skipped };
    skipped.push({ ...entry, why });
  }
  return { pass: null, skipped };
}

function skippedLabel(entry) {
  if (entry.why === 'cover') return `${entry.date} (${Math.round((entry.coverage ?? 0) * 100)}% of the area)`;
  return `${entry.date} (${entry.cloud == null ? 'cloud unknown' : `${Math.round(entry.cloud)}% cloud`})`;
}

/**
 * The line under "newest" once the passes are known: which day it takes now,
 * and the newer ones it steps over, so a clearer-looking map is not a mystery.
 */
export function newestLine(pick, { maxcc = 100, radar = false } = {}) {
  if (!pick) return '';
  const shown = pick.skipped.slice(0, 3).map(skippedLabel);
  const more = pick.skipped.length > 3 ? ` and ${pick.skipped.length - 3} more` : '';
  const newer = shown.length ? ` Newer: ${shown.join(', ')}${more}. Pick one below to read it anyway.` : '';
  if (!pick.pass) {
    const rule = radar || !(maxcc < 100) ? 'covers the whole area' : `is under ${maxcc}% cloud over the whole area`;
    return `No pass in this window ${rule}. Pick one below.`;
  }
  return newer ? `Now ${pick.pass.date}.${newer}` : `Now ${pick.pass.date}, looked up again when the run starts.`;
}

/** A side as a line: its day, and a radar pass's time. */
export function sideLine(source, radar = false) {
  if (!source?.date) return '';
  return radar && source.time ? `${source.date} ${source.time.slice(0, 5)} UTC` : source.date;
}

/** The pass every area holds on one side, or null when they differ. */
export function sharedSide(pairs, letter) {
  if (!pairs?.length) return null;
  const [first, ...rest] = pairs.map((pair) => pair[letter] ?? {});
  const same = rest.every((side) => (side.date ?? '') === (first.date ?? '') && (side.time ?? '') === (first.time ?? ''));
  return same ? { date: first.date ?? '', time: first.time ?? '' } : null;
}

/** Whether one choice stands for every area. */
export function uniform(pairs) {
  return !!sharedSide(pairs, 'a') && !!sharedSide(pairs, 'b');
}

/**
 * Every area's side set to one pass. A typed day has no time yet: the engine
 * settles which radar pass of it at launch.
 */
export function setSide(pairs, letter, date, time = '', radar = false) {
  return pairs.map((pair) => ({
    ...pair,
    [letter]: { ...pair[letter], date, time: radar ? time : '' },
    date_rule: letter === 'b' && pair.date_rule !== 'latest_previous'
      ? (date ? 'manual' : 'latest_reference') : pair.date_rule,
  }));
}

/** The rule each area follows once a routine says what it compares against. */
export function withRule(pairs, against) {
  const rule = against === 'previous' ? 'latest_previous' : 'latest_reference';
  return pairs.map((pair) => ({ ...pair, date_rule: rule }));
}

/** A dated comparison needs A before B. Radar can compare two timed passes on one day. */
export function passBefore(a, b, radar = false) {
  if (!a?.date || !b?.date) return true;
  if (a.date !== b.date) return a.date < b.date;
  return !!(radar && a.time && b.time && a.time < b.time);
}

/** A calendar choice must keep dated comparisons ordered and radar passes on one track. */
export function canPickPass(letter, pass, a, b, radar = false) {
  const other = letter === 'a' ? b : a;
  const ordered = letter === 'a' ? passBefore(pass, b, radar) : passBefore(a, pass, radar);
  return ordered && (!radar || !other?.time || sameTrack(pass.time, other.time));
}

/**
 * What still stops the step, in one sentence, or ''.
 *
 * A routine that compares with its previous pass needs A only until a run has
 * finished, which a saved routine may already have.
 */
export function whenNeed({ single, routine, against, pairs, chooseB, lastPasses = {}, radar = false }) {
  const noA = pairs.filter((pair) => !pair.a?.date && !(routine && against === 'previous' && lastPasses[pair.area_id]));
  if (!single && noA.length) {
    if (noA.length < pairs.length) return 'Choose A for every area.';
    if (!routine) return 'Choose A, the picture before.';
    return `Choose A, the picture ${against === 'previous' ? 'the first run' : 'every run'} compares with.`;
  }
  if (!routine && chooseB && pairs.some((pair) => !pair.b?.date)) {
    return single ? 'Choose the day, or take the newest pass.' : 'Choose the day of B, or take the newest pass.';
  }
  if (!single && pairs.some((pair) => !passBefore(
    routine && against === 'previous' && lastPasses[pair.area_id] || pair.a, pair.b, radar
  ))) return 'Date A must be before date B.';
  return '';
}

/** One area's days, for the list shown when the areas differ. */
export function areaLine(pair, { single, routine, radar = false }) {
  const newest = newestLabel({ maxcc: pair?.b?.maxcc, radar });
  const a = sideLine(pair?.a, radar) || 'not chosen';
  const b = sideLine(pair?.b, radar) || newest;
  if (single) return routine ? newest : b;
  return routine ? `A ${a}` : `A ${a} → B ${b}`;
}

/** The step as one line, for the recap before the start. */
export function whenSummary({ single, routine, against, pairs, radar = false, maxcc = 100 }) {
  if (pairs.length > 1 && !uniform(pairs)) return 'Its own days for each area';
  const newest = newestLabel({ maxcc, radar });
  const a = sideLine(sharedSide(pairs, 'a'), radar);
  const b = sideLine(sharedSide(pairs, 'b'), radar) || newest;
  if (routine) {
    if (single) return `Each run: the ${newest}`;
    return against === 'previous'
      ? `Each run: the ${newest} against the one before${a ? `, first against ${a}` : ''}`
      : `Each run: the ${newest} against ${a || 'A'}`;
  }
  if (single) return b.charAt(0).toUpperCase() + b.slice(1);
  return `${a || 'A not chosen'} → ${b}`;
}

/** A 10 m building's shadow when Sentinel-2 passes on `day`, in metres. */
export function shadowLength(day, lat) {
  const zenith = Math.min(85, sunPosition(day, lat).zenith);
  return 10 * Math.tan((zenith * Math.PI) / 180);
}

/**
 * A pair whose passes see the sun at very different heights, as a warning, or ''.
 *
 * Every building's shadow then changes length between A and B and reads as a
 * change: a January and a September pass over an airbase put a candidate on
 * most of its buildings. Only a picture has shadows, and only a pair of days
 * both chosen can be judged.
 */
export function shadowWarning(pairs, zones, { single = false, radar = false } = {}) {
  if (single || radar) return '';
  let worst = null;
  for (const pair of pairs ?? []) {
    const zone = (zones ?? []).find((entry) => entry.id === pair.area_id);
    if (!zone || !pair.a?.date || !pair.b?.date) continue;
    const ring = zoneRing(zone);
    const lat = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
    const a = shadowLength(pair.a.date, lat);
    const b = shadowLength(pair.b.date, lat);
    if (!worst || Math.abs(a - b) > Math.abs(worst.a - worst.b)) worst = { a, b, pair };
  }
  if (!worst || Math.abs(worst.a - worst.b) < SHADOW_SHIFT_M) return '';
  return `A 10 m building casts ${Math.round(worst.a)} m of shadow on ${worst.pair.a.date} and `
    + `${Math.round(worst.b)} m on ${worst.pair.b.date}, so most buildings will read as changed. `
    + 'Passes closer together avoid it.';
}
