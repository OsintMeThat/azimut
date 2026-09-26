/**
 * The When step of a detection, the part that is not a view.
 *
 * Every area keeps its own pair of sources, because areas far apart can sit
 * under different swaths. Most detections still want one pair for all of
 * them, so the step reads and writes every area at once, and only says "per
 * area" when the areas really do differ.
 *
 * A is the picture before, B the one to look in. An empty B date is the
 * newest pass, looked up when the run starts; a routine never holds one.
 */
import { sunPosition } from './changeDetect.js';
import { zoneRing } from './analyzers.js';

/** How much a 10 m building's shadow may change length between two passes,
 *  in metres, before it reads as a change: half a Sentinel-2 pixel. */
export const SHADOW_SHIFT_M = 5;

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

/**
 * What still stops the step, in one sentence, or ''.
 *
 * A routine that compares with its previous pass needs A only until a run has
 * finished, which a saved routine may already have.
 */
export function whenNeed({ single, routine, against, followupId, pairs, chooseB }) {
  const waived = routine && followupId && against === 'previous';
  const noA = pairs.filter((pair) => !pair.a?.date);
  if (!single && !waived && noA.length) {
    if (noA.length < pairs.length) return 'Choose A for every area.';
    if (!routine) return 'Choose A, the picture before.';
    return `Choose A, the picture ${against === 'previous' ? 'the first run' : 'every run'} compares with.`;
  }
  if (!routine && chooseB && pairs.some((pair) => !pair.b?.date)) {
    return single ? 'Choose the day, or take the newest pass.' : 'Choose the day of B, or take the newest pass.';
  }
  return '';
}

/** One area's days, for the list shown when the areas differ. */
export function areaLine(pair, { single, routine, radar = false }) {
  const a = sideLine(pair?.a, radar) || 'not chosen';
  const b = sideLine(pair?.b, radar) || 'newest pass';
  if (single) return routine ? 'newest pass' : b;
  return routine ? `A ${a}` : `A ${a} → B ${b}`;
}

/** The step as one line, for the recap before the start. */
export function whenSummary({ single, routine, against, pairs, radar = false }) {
  if (pairs.length > 1 && !uniform(pairs)) return 'Its own days for each area';
  const a = sideLine(sharedSide(pairs, 'a'), radar);
  const b = sideLine(sharedSide(pairs, 'b'), radar) || 'newest pass';
  if (routine) {
    if (single) return 'Each run: the newest pass';
    return against === 'previous'
      ? `Each run: the newest pass against the one before${a ? `, first against ${a}` : ''}`
      : `Each run: the newest pass against ${a || 'A'}`;
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
