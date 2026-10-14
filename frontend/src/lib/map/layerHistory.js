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
 *   day, faded (`$fade`) after it, and gone `window` days later. A lasting thing
 *   (a position, a checkpoint) stays as it is. With no moment, "now" is the
 *   layer's last change, so a layer nobody touched for a fortnight keeps its events.
 *
 * Nothing is interpolated. Between two states a feature is the first of them,
 * and a front that moved on the 12th did not drift there through the 11th.
 */
import polygonClipping from 'polygon-clipping';
import { dayNumber } from './layerDates.js';

/** How many days an event stays on the map after its own, unless the analyst says. */
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

/** The moment an edit at the cursor is written at: a new state there, or the one it corrects. */
export function editMoment(feature, cursor, mode = 'new') {
  if (cursor === null || cursor === undefined) return null;
  if (mode === 'new') return cursor;
  if (!hasHistory(feature)) return null;
  return inForce(feature.properties.states, cursor)?.at ?? cursor;
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
 * own state before, or a moment. Null `at` is the layer as it is now, where the
 * trail and the changes still read back from the latest state.
 */
export function asOf(collection, at, { trail = false, since = null, window = EVENT_DAYS } = {}) {
  const features = collection?.features ?? [];
  const cursor = at ?? '￿';
  // the day events are read against: the moment's, or the layer's last change
  const today = dayNumber((at ?? moments(collection).at(-1) ?? '').slice(0, 10));
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
    if (first !== null && today - first > window) return null;
    if (first !== null && today > first) extra.$fade = true;
  }
  return Object.keys(extra).length ? { ...standing, properties: { ...standing.properties, ...extra } } : standing;
}

/** One feature's history, as the sheet lists it: each state, its moment, and whether it is the one at the cursor. */
export function lifeline(feature, cursor) {
  if (!hasHistory(feature)) return [];
  const now = cursor === null || cursor === undefined ? null : inForce(feature.properties.states, cursor);
  const live = feature.properties.states.filter((state) => !state.gone);
  return feature.properties.states.map((state) => ({
    at: state.at,
    gone: Boolean(state.gone),
    status: state.status ?? '',
    current: now ? state === now : state === live.at(-1),
  }));
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
