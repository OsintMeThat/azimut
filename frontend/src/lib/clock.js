/**
 * The clock a stated date is read on: one rule for every field that takes a date.
 *
 * A value is kept as the analyst typed it, with its clock beside it (`when_zone`). A day
 * spans that zone's day. A time is also written with the offset the zone keeps at that
 * moment, so it stays an ordinary zoned timestamp the axis can place and drag. UTC is
 * the one clock stored as no zone: a day without one spans UTC's day, and a time ends
 * in `Z`. A time with neither an offset nor a zone is on a clock nobody knows, and it
 * stays off the axis until one is given.
 */
import { isDateOnly, offsetAt } from './localZone.js';

export const UTC = 'UTC';

const TIME = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?)(Z|[+-]\d{2}:\d{2})?$/;

/** A value's parts: dates, times with what each writes after it, or null. */
function partsOf(raw) {
  const text = String(raw ?? '');
  if (!text) return null;
  if (isDateOnly(text)) return { kind: 'date' };
  const parts = text.split('/');
  if (parts.length > 2) return null;
  const times = parts.map((part) => TIME.exec(part));
  if (!times.every(Boolean)) return null;
  return { kind: 'time', walls: times.map((match) => match[1]), suffixes: times.map((match) => match[2] ?? '') };
}

/** Whether the value has a time of day, which is what lets its clock be unknown. */
export function isTimed(raw) {
  return partsOf(raw)?.kind === 'time';
}

/** Whether a time says its own clock, with `Z` or an offset typed after it. */
export function writesOwnClock(raw) {
  const parts = partsOf(raw);
  return parts?.kind === 'time' && Boolean(parts.suffixes[0]);
}

/** Whether `zone` keeps the offset `suffix` at that wall time: `Z` is `+00:00`. */
function keeps(wall, zone, suffix) {
  const offset = zone === UTC ? '+00:00' : offsetAt(wall, zone);
  return Boolean(offset) && offset === (suffix === 'Z' ? '+00:00' : suffix);
}

/**
 * The clock a stored value reads on, `{ zone, fixed }`.
 *
 * `zone` is an IANA name or `UTC`, or null when no clock is known. `fixed` is an offset
 * written in the value with no zone named for it (`+03:00`), as values typed before
 * zones existed were. `stated` is the zone stored beside the value.
 */
export function clockOf(raw, stated = null) {
  const parts = partsOf(raw);
  if (!parts) return { zone: stated || null, fixed: '' };
  if (parts.kind === 'date') return { zone: stated || UTC, fixed: '' };
  const [wall] = parts.walls;
  const [suffix] = parts.suffixes;
  if (stated && (!suffix || keeps(wall, stated, suffix))) return { zone: stated, fixed: '' };
  if (suffix === 'Z') return { zone: UTC, fixed: '' };
  return { zone: null, fixed: suffix };
}

/**
 * A value put on a clock, as it is stored: `{ raw, zone }`.
 *
 * `clock` is a zone name, `UTC`, or null for a time whose clock is unknown. A time
 * already written with an offset keeps its wall time and takes the new clock's
 * offset: picking a clock says which clock that 14:30 was read on.
 */
export function withClock(raw, clock) {
  const parts = partsOf(raw);
  const zone = clock && clock !== UTC ? clock : null;
  if (!parts) return { raw: raw ?? '', zone: null };
  if (parts.kind === 'date') return { raw, zone };
  const suffix = (wall) => (!clock ? '' : clock === UTC ? 'Z' : offsetAt(wall, clock));
  return { raw: parts.walls.map((wall) => `${wall}${suffix(wall)}`).join('/'), zone };
}

/**
 * What a date field holds, put on its clock: `{ clock, raw, zone }`.
 *
 * `picked` is the analyst's pick, `undefined` until they make one. `stated` is the zone
 * the value was saved with, and `fallback` the clock a new value opens on: a place's,
 * or UTC. A time typed with its own offset or `Z` keeps it until a clock is picked.
 */
export function settleClock(raw, { picked = undefined, stated = null, fallback = UTC } = {}) {
  if (picked !== undefined) return { clock: { zone: picked, fixed: '' }, ...withClock(raw, picked) };
  if (writesOwnClock(raw)) {
    const clock = clockOf(raw, stated);
    return { clock, raw, zone: clock.zone && clock.zone !== UTC ? clock.zone : null };
  }
  const zone = stated || fallback;
  return { clock: { zone, fixed: '' }, ...withClock(raw, zone) };
}

/** The instant a value's offsets are shown at: midday on its first day, or now. */
export function clockInstant(raw) {
  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(String(raw ?? ''));
  if (!match) return Date.now();
  return Date.UTC(Number(match[1]), Number(match[2] ?? 1) - 1, Number(match[3] ?? 1), 12);
}

// -- the clocks picked lately, per case -----------------------------------------

const RECENT = (caseId) => `azimut:clock-recent:${caseId}`;
const NAME = /^[A-Za-z0-9+\-_/]{1,64}$/;
const KEPT = 3;

/** The zones last picked in this case, newest first. A case is argued on a few
 *  clocks, and the one used a minute ago should not be searched for again. */
export function recentClocks(caseId, storage = globalThis.localStorage) {
  if (!caseId) return [];
  try {
    const held = JSON.parse(storage?.getItem(RECENT(caseId)) ?? '[]');
    return Array.isArray(held)
      ? held.filter((zone) => typeof zone === 'string' && NAME.test(zone) && zone !== UTC).slice(0, KEPT)
      : [];
  } catch {
    return [];
  }
}

/** Keep a picked zone at the head of this case's recent clocks. UTC is always offered. */
export function rememberClockPick(caseId, zone, storage = globalThis.localStorage) {
  if (!caseId || !zone || zone === UTC || !NAME.test(zone)) return;
  const kept = [zone, ...recentClocks(caseId, storage).filter((held) => held !== zone)].slice(0, KEPT);
  try {
    storage?.setItem(RECENT(caseId), JSON.stringify(kept));
  } catch {
    // A browser that keeps nothing still offers every zone by search.
  }
}
