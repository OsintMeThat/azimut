/**
 * A personal layer followed over time, read at one moment.
 *
 * A tracked feature keeps its `states`, `{ at, geometry, status? }` or
 * `{ at, gone }`, sorted by `at` (`engine/layerediting.py`). Its own geometry is
 * its latest state, so a layer read with no moment (`at` null) is drawn as it is
 * now, exactly as before any of this. A moment is a day, `YYYY-MM-DD`, or a day
 * and a time, `YYYY-MM-DDTHH:MM`, on the layer's one clock, so moments compare as
 * strings and a day holds from its own start. `''` in a state means "since always".
 *
 * Three things are read off a moment, each a feature the map draws apart:
 *
 * - **the features as they stood then**: a state in force, or a plain feature
 *   between its first and last day, or always when it states none;
 * - **the trail** (`$trail`): where a feature stood in the state before, drawn
 *   dashed under it, so a front that moved shows where it moved from;
 * - **gains and losses** (`$change`): for an area, the ground it took and the
 *   ground it gave since a reference, the previous state or a chosen moment.
 *
 * Two more marks say how the moment relates to the features' own days:
 *
 * - **new** (`$new`): what appeared or changed on the moment's own day, which the
 *   map rings so a played layer shows what each day brought;
 * - **an event** (a group's `event` features: a strike, a clash) is there on its
 *   day and faded (`$fade`) after it, for good unless the layer gives it a window
 *   of days. A lasting thing (a position, a checkpoint) stays as it is. With no
 *   moment, events are read against the layer's last change.
 *
 * Nothing is interpolated. Between two states a feature is the first of them,
 * and a front that moved on the 12th did not drift there through the 11th.
 */
import polygonClipping from 'polygon-clipping';
import { dayNumber } from './layerDates.js';

/** The days an event stays when the analyst gives it a window: what the field offers first. */
export const EVENT_DAYS = 7;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MOMENT = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;

/** Whether a layer row is followed over time right now. */
export function isTracked(row) {
  return Boolean(row?.editable && row?.track?.on);
}

/** A moment checked, or null: what a typed or picked value is let through as. */
export function moment(value) {
  const text = String(value ?? '').trim();
  const match = MOMENT.exec(text);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  if (match[4] !== undefined && (hour > 23 || minute > 59)) return null;
  return text;
}

const CLOCKS = new Map();

/**
 * The moment it is on a layer's clock (`track`: `{ precision, zone }`): today, or
 * today and the minute on a layer dated to the minute. What a cursor nobody moved
 * reads, and what an edit is dated to there.
 */
export function momentNow(track, now = new Date()) {
  const zone = track?.zone || 'UTC';
  let clock = CLOCKS.get(zone);
  if (!clock) {
    try {
      clock = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric',
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch {
      // a zone this browser does not know reads on UTC, as the backend refuses it
      return momentNow({ ...track, zone: 'UTC' }, now);
    }
    CLOCKS.set(zone, clock);
  }
  const part = Object.fromEntries(clock.formatToParts(now).map(({ type, value }) => [type, value]));
  const day = `${part.year}-${part.month}-${part.day}`;
  return track?.precision === 'time' ? `${day}T${part.hour}:${part.minute}` : day;
}

/** `12 Oct 2026`, or `12 Oct 2026 · 14:00` for a moment with a time. */
export function momentLabel(at) {
  const match = MOMENT.exec(String(at ?? ''));
  if (!match) return at === '' ? 'Always' : '';
  const day = `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
  return match[4] === undefined ? day : `${day} · ${match[4]}:${match[5]}`;
}

/** The state a feature is in at `at`: the last one written at or before it. */
export function inForce(states, at) {
  let found = null;
  for (const state of states ?? []) {
    if (state.at > at) break;
    found = state;
  }
  return found;
}

/** The states a feature has, or the one it implies before it has any. */
export function statesOf(feature) {
  const properties = feature?.properties ?? {};
  if (Array.isArray(properties.states) && properties.states.length) return properties.states;
  return [{ at: String(properties.date ?? ''), geometry: feature?.geometry,
    ...(properties.status ? { status: properties.status } : {}) }];
}

/** Whether a feature has a history of its own, beyond the day it states. */
export function hasHistory(feature) {
  return Array.isArray(feature?.properties?.states) && feature.properties.states.length > 0;
}

/**
 * The feature as it stood at `at`, or null when it was not there. Undated plain
 * features are always there; dated ones from their day through their last.
 */
export function stateAt(feature, at) {
  const properties = feature?.properties ?? {};
  if (!hasHistory(feature)) {
    const start = String(properties.date ?? '');
    const end = String(properties.date_end ?? '');
    if ((start && start > at) || (end && end < at.slice(0, 10))) return null;
    return feature;
  }
  const state = inForce(properties.states, at);
  if (!state || state.gone) return null;
  const { states, status, ...rest } = properties;
  return { ...feature, geometry: state.geometry,
    properties: { ...rest, ...(state.status ? { status: state.status } : {}) } };
}

/** The live state before the one in force at `at`, the trail's shape, or null. */
export function previousState(feature, at) {
  if (!hasHistory(feature)) return null;
  const states = feature.properties.states;
  const now = inForce(states, at);
  if (!now || now.gone) return null;
  const before = states.slice(0, states.indexOf(now)).filter((state) => !state.gone);
  return before.at(-1) ?? null;
}

/**
 * Every moment the layer changes at, sorted: each state of a tracked feature,
 * and the first and last day of the plain ones. What the cursor steps through.
 */
export function moments(collection) {
  const found = new Set();
  for (const feature of collection?.features ?? []) {
    const properties = feature?.properties ?? {};
    if (hasHistory(feature)) {
      for (const state of properties.states) if (state.at) found.add(state.at);
    } else {
      if (properties.date) found.add(String(properties.date));
      if (properties.date_end) found.add(String(properties.date_end));
    }
  }
  return [...found].sort();
}

/** The next moment after `at`, or the one before it (`direction` -1), or null. */
export function stepMoment(list, at, direction) {
  if (!list.length) return null;
  if (at === null || at === undefined) return direction < 0 ? list.at(-1) : null;
  if (direction > 0) return list.find((item) => item > at) ?? null;
  return list.findLast((item) => item < at) ?? null;
}

/** The parts of a polygon or multipolygon, as polygon-clipping reads them. */
function polygonsOf(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates;
  return null;
}

/** `first` less `second`, as a MultiPolygon, or null when nothing is left. */
function difference(first, second) {
  try {
    const parts = polygonClipping.difference(first, second);
    return parts.length ? { type: 'MultiPolygon', coordinates: parts } : null;
  } catch {
    // A ring that crosses itself is the analyst's drawing, and the map keeps it.
    return null;
  }
}

/**
 * What an area took and gave between `before` and `after`, each a geometry, as
 * up to two features `$change: 'gained' | 'lost'` carrying the area's properties.
 */
export function changes(feature, before, after) {
  const was = polygonsOf(before);
  const is = polygonsOf(after);
  if (!was && !is) return [];
  const out = [];
  const gained = is ? (was ? difference(is, was) : { type: 'MultiPolygon', coordinates: is }) : null;
  const lost = was ? (is ? difference(was, is) : { type: 'MultiPolygon', coordinates: was }) : null;
  if (gained) out.push({ type: 'Feature', geometry: gained, properties: { ...feature.properties, $change: 'gained' } });
  if (lost) out.push({ type: 'Feature', geometry: lost, properties: { ...feature.properties, $change: 'lost' } });
  return out;
}

/**
 * The layer as it stood at `at`, for the map to draw.
 *
 * `trail` adds the previous state of every feature that moved, `$trail`;
 * `since` adds what each area took and gave since then: `'previous'` for its
 * own state before, or a moment. `window` is how many days an event stays after
 * its own, null for good. Null `at` is the layer as last changed, where the
 * trail and the changes still read back from the latest state.
 *
 * A moment where every feature stands as at one read lately hands back that same
 * reading, so a map can tell nothing moved; a reading is never changed in place.
 */
export function asOf(collection, at, { trail = false, since = null, window = null } = {}) {
  const cursor = at ?? '￿';
  // the day events are read against: the moment's, or the layer's last change
  const today = dayNumber((at ?? moments(collection).at(-1) ?? '').slice(0, 10));
  if (!collection || typeof collection !== 'object') return read(collection, at, cursor, today, trail, since, window);
  // two moments where every feature stands as it stood are one reading, handed back as it was
  const phase = `${trail}|${since}|${window}|${phaseOf(collection.features ?? [], at, cursor, today, window)}`;
  let kept = readings.get(collection);
  if (!kept) readings.set(collection, (kept = new Map()));
  const known = kept.get(phase);
  if (known) {
    kept.delete(phase);
    kept.set(phase, known);
    return known;
  }
  const out = read(collection, at, cursor, today, trail, since, window);
  kept.set(phase, out);
  if (kept.size > KEPT_READINGS) kept.delete(kept.keys().next().value);
  return out;
}

/** The last few readings of each layer, by phase: a played or dragged day reads each phase once. */
const readings = new WeakMap();
const KEPT_READINGS = 4;

/**
 * Where each feature stands at the moment, as one key: its state in force (or, with
 * no history, whether it is there), and whether the day marks it new, fades it or
 * lets it go. Everything `asOf` draws follows from that, so an equal key is an
 * equal reading.
 */
function phaseOf(features, at, cursor, today, window) {
  const out = [];
  for (const feature of features) {
    const properties = feature?.properties ?? {};
    let standing;
    let began;
    if (hasHistory(feature)) {
      standing = -1;
      for (const [index, state] of properties.states.entries()) {
        if (state.at > cursor) break;
        standing = index;
      }
      began = standing >= 0 ? properties.states[standing].at : undefined;
    } else {
      standing = stateAt(feature, cursor) ? 1 : 0;
      began = properties.date;
    }
    let marks = 0;
    if (today !== null) {
      const day = dayNumber(String(began ?? '').slice(0, 10));
      if (at !== null && at !== undefined && day !== null && day === today) marks |= 1;
      if (properties.event) {
        const first = dayNumber(String(properties.date ?? '').slice(0, 10));
        if (first !== null && window !== null && today - first > window) marks |= 2;
        if (first !== null && today > first) marks |= 4;
      }
    }
    out.push(standing * 8 + marks);
  }
  return out.join(',');
}

function read(collection, at, cursor, today, trail, since, window) {
  const features = collection?.features ?? [];
  const out = [];
  const extras = [];
  for (const feature of features) {
    let standing = stateAt(feature, cursor);
    if (standing && today !== null) standing = marked(feature, standing, at, today, window);
    if (standing) out.push(standing);
    if (!hasHistory(feature) || (!trail && !since)) continue;
    const previous = previousState(feature, cursor);
    if (trail && standing && previous) {
      extras.push({ type: 'Feature', geometry: previous.geometry,
        properties: { ...standing.properties, ...(previous.status ? { status: previous.status } : {}), $trail: true } });
    }
    if (since === 'previous' && previous) {
      extras.push(...changes(feature, previous.geometry, standing?.geometry ?? null));
    } else if (since && since !== 'previous') {
      // What it was at the reference, or nothing when it was not there yet.
      const then = inForce(feature.properties.states, since);
      extras.push(...changes(feature, then && !then.gone ? then.geometry : null, standing?.geometry ?? null));
    }
  }
  // The trail and the changes go under the features they belong to.
  return { ...collection, features: [...extras, ...out] };
}

/**
 * A standing feature with what the day says of it: `$new` when it appeared or
 * changed on the moment's own day, `$fade` for an event past its day, or null for
 * an event past its window.
 */
function marked(feature, standing, at, today, window) {
  const properties = feature.properties ?? {};
  const began = hasHistory(feature) ? inForce(properties.states, at ?? '￿')?.at : properties.date;
  const day = dayNumber(String(began ?? '').slice(0, 10));
  const extra = {};
  if (at !== null && at !== undefined && day !== null && day === today) extra.$new = true;
  if (properties.event) {
    const first = dayNumber(String(properties.date ?? '').slice(0, 10));
    if (first !== null && window !== null && today - first > window) return null;
    if (first !== null && today > first) extra.$fade = true;
  }
  return Object.keys(extra).length ? { ...standing, properties: { ...standing.properties, ...extra } } : standing;
}

/** What a change of status brought; back to none is said as such, not as a state seen. */
const STATUS_SAID = { '': 'No damage', damaged: 'Damaged', destroyed: 'Destroyed' };

/** What one state brought, said against the live state before it. */
function brought(state, before, point, first) {
  if (state.gone) return 'Gone';
  if (first) return [state.at ? 'Appears' : 'Shown', state.status ? STATUS_SAID[state.status] : ''].filter(Boolean).join(' · ');
  if (!before) return 'Back';
  const said = [];
  if (JSON.stringify(state.geometry) !== JSON.stringify(before.geometry)) said.push(point ? 'Moved' : 'Reshaped');
  if ((state.status ?? '') !== (before.status ?? '')) said.push(STATUS_SAID[state.status ?? ''] ?? state.status);
  return said.join(' · ') || 'No change';
}

/**
 * One feature's history, as the sheet lists it: each state, its moment, what it
 * brought (`Appears`, `Moved`, `Damaged`, `Gone`…), and whether it is the one at
 * the cursor.
 */
export function lifeline(feature, cursor) {
  if (!hasHistory(feature)) return [];
  const now = cursor === null || cursor === undefined ? null : inForce(feature.properties.states, cursor);
  const live = feature.properties.states.filter((state) => !state.gone);
  const point = String(feature.geometry?.type ?? '').includes('Point');
  let before = null;
  return feature.properties.states.map((state, index) => {
    const row = {
      at: state.at,
      gone: Boolean(state.gone),
      status: state.status ?? '',
      what: brought(state, before, point, index === 0),
      current: now ? state === now : state === live.at(-1),
    };
    before = state.gone ? null : state;
    return row;
  });
}

/**
 * The history the sheet draws for one feature, with where a dated edit goes:
 * `editing` on the state it rewrites, or a `ghost` row at the cursor when it
 * starts a new one there. A plain feature reads as its one implied state, so a
 * change about to give it a history shows before it is made. `mode` is the
 * editor's: 'new' dates an edit at the cursor; 'fix' carries no date, and an
 * edit with none changes every day alike, so no row is marked.
 */
export function lifeRows(feature, cursor, mode = 'new') {
  const dated = hasHistory(feature);
  const rows = dated ? lifeline(feature, cursor)
    : [{ at: String(feature?.properties?.date ?? ''), gone: false, status: feature?.properties?.status ?? '',
      what: feature?.properties?.date ? 'Appears' : 'Shown', current: true }];
  const at = cursor ?? null;
  if (at === null || mode === 'fix' || !stateAt(feature, at)) return rows.map((row) => ({ editing: false, ghost: false, ...row }));
  const same = rows.find((row) => row.at === at);
  if (same) {
    same.editing = true;
  } else {
    rows.push({ at, gone: false, status: '', what: 'Next edit', current: false, ghost: true });
    rows.sort((first, second) => (first.at < second.at ? -1 : first.at > second.at ? 1 : 0));
  }
  return rows.map((row) => ({ editing: false, ghost: false, ...row }));
}

/**
 * When a feature shows, as its sheet and its row in the list say it: `start`
 * ('' for always), `end` ('' while it is still there), `ends` saying whether the
 * end is the moment it is gone ('gone') or a plain feature's last day ('last'),
 * and how many changes it has between.
 */
export function spanOf(feature) {
  const properties = feature?.properties ?? {};
  if (!hasHistory(feature)) {
    const end = String(properties.date_end ?? '');
    return { start: String(properties.date ?? ''), end, ends: 'last', changes: 0, unknown: !end && !!properties.end_unknown };
  }
  const states = properties.states;
  const last = states.at(-1);
  return { start: states[0].at, end: last.gone ? last.at : '', ends: 'gone',
    changes: states.slice(1).filter((state) => !state.gone).length, unknown: !last.gone && !!properties.end_unknown };
}

/** `12 Oct`, with the year when it is not `year`, and the time on a moment that has one. */
export function shortMoment(at, year = new Date().getFullYear()) {
  const match = MOMENT.exec(String(at ?? ''));
  if (!match) return '';
  const day = `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]}${Number(match[1]) === year ? '' : ` ${match[1]}`}`;
  return match[4] === undefined ? day : `${day} ${match[4]}:${match[5]}`;
}

/**
 * A feature's days in a few words, as its row in the list says them: `Always`,
 * `From 12 Oct`, `Until 20 Oct`, `12 Oct → 20 Oct`, `12 Oct → ?` when nobody
 * knows when it left, or the day alone for an event, which fades after it.
 */
export function spanLabel(span, { event = false, year } = {}) {
  const from = shortMoment(span.start, year);
  const to = shortMoment(span.end, year);
  if (event) return from || 'No day';
  if (from && to) return `${from} → ${to}`;
  if (span.unknown) return `${from || 'Always'} → ?`;
  if (from) return `From ${from}`;
  if (to) return `Until ${to}`;
  return 'Always';
}

/**
 * What a feature changed by date: the moment its shape first differs from the
 * one it first had, and the moment its status does, each '' when never. An edit
 * with no date changes every day alike, so it can only touch what never changed.
 */
export function changedBy(feature) {
  if (!hasHistory(feature)) return { shape: '', status: '' };
  const live = feature.properties.states.filter((state) => !state.gone);
  const [first, ...later] = live;
  const shape = later.find((state) => JSON.stringify(state.geometry) !== JSON.stringify(first.geometry))?.at ?? '';
  const status = later.find((state) => (state.status ?? '') !== (first.status ?? ''))?.at ?? '';
  return { shape, status };
}

/** Whether a feature appears, changes or leaves on the day of `at`. */
export function changesOn(feature, at) {
  if (at === null || at === undefined) return false;
  const day = at.slice(0, 10);
  return statesOf(feature).some((state) => state.at && state.at.slice(0, 10) === day)
    || (!hasHistory(feature) && String(feature?.properties?.date_end ?? '') === day);
}

/**
 * The features an editor works on at `at`: each tracked one in the shape and status it
 * had then, its history kept so it can be read and edited, and any feature that was
 * not there then marked `$absent`. Null `at` hands the features back as they are.
 */
export function seenAt(features, at) {
  if (at === null || at === undefined) return features;
  return features.map((feature) => {
    const standing = stateAt(feature, at);
    if (!standing) return { ...feature, properties: { ...feature.properties, $absent: true } };
    if (!hasHistory(feature)) return feature;
    const { status, ...rest } = feature.properties;
    return { ...feature, geometry: standing.geometry,
      properties: { ...rest, ...(standing.properties.status ? { status: standing.properties.status } : {}) } };
  });
}
