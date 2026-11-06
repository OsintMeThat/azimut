/**
 * What a plate's map keeps of one of its layers: every feature but those the analyst
 * hid on that map one by one (`hidden_features`), those that began before the day the
 * map starts the layer on (`start`) and those that began after the day it ends it on
 * (`end`). The layer itself is never touched, so the Map and the other plates still
 * draw them.
 *
 * A feature is named by its `key`, which every feature of a layer drawn in the case
 * carries through all its dates. A source's feature has none, so it is named by its
 * name and where it stands: a refreshed source that moved it shows it again rather
 * than hiding another.
 *
 * The map, its legend, its counts and the days the plate plays all read the layer
 * through here, so what one leaves out none of the others shows.
 */
import { hasHistory, moments as momentsOf } from '../map/layerHistory.js';

/** How a plate names one feature, or '' for one it cannot name. */
export function featureId(feature) {
  const properties = feature?.properties ?? {};
  if (typeof properties.key === 'string' && properties.key) return properties.key;
  const point = firstPoint(feature?.geometry);
  if (!point) return '';
  return `~${String(properties.name ?? '').trim().slice(0, 80)}@${point[0].toFixed(5)},${point[1].toFixed(5)}`;
}

function firstPoint(geometry) {
  if (geometry?.type === 'GeometryCollection') return firstPoint(geometry.geometries?.[0]);
  let coordinates = geometry?.coordinates;
  while (Array.isArray(coordinates) && Array.isArray(coordinates[0])) coordinates = coordinates[0];
  const [lon, lat] = Array.isArray(coordinates) ? coordinates : [];
  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
}

/** The day a feature began, or '' for one that is always there. */
export function firstDay(feature) {
  const properties = feature?.properties ?? {};
  const began = hasHistory(feature) ? properties.states[0].at : properties.date;
  return String(began ?? '').slice(0, 10);
}

/** The few filters each layer was last read through, so a reading the map has drawn is handed back as it was. */
const readings = new WeakMap();
const KEPT_READINGS = 4;

/** The layer as the map entry keeps it; the collection itself when it leaves nothing out. */
export function keptOf(collection, entry) {
  const hidden = entry?.hidden_features ?? [];
  const start = entry?.start ?? '';
  const end = entry?.end ?? '';
  if (!collection || typeof collection !== 'object' || (!hidden.length && !start && !end)) return collection;
  const filter = `${start}|${end}|${hidden.join('|')}`;
  let kept = readings.get(collection);
  if (!kept) readings.set(collection, (kept = new Map()));
  const known = kept.get(filter);
  if (known) return known;
  const off = new Set(hidden);
  const out = { ...collection, features: (collection.features ?? []).filter((feature) => {
    if (start || end) {
      const day = firstDay(feature);
      if (day && ((start && day < start) || (end && day > end))) return false;
    }
    return !off.size || !off.has(featureId(feature));
  }) };
  kept.set(filter, out);
  if (kept.size > KEPT_READINGS) kept.delete(kept.keys().next().value);
  return out;
}

/**
 * The layer's days on a map once one end of them is set (`which`, 'start' or 'end'),
 * the other pulled along when it would cross. No day: from its first, or to its last.
 */
export function spanTo(entry, which, day) {
  const value = day || null;
  let start = entry?.start ?? null;
  let end = entry?.end ?? null;
  if (which === 'start') {
    start = value;
    if (value && end && end < value) end = value;
  } else {
    end = value;
    if (value && start && start > value) start = value;
  }
  return { start, end };
}

const momentLists = new WeakMap();

/** The moments the layer changes at, as the map entry keeps it: what it hides moves no day. */
export function keptMoments(collection, entry) {
  const kept = keptOf(collection, entry);
  if (!kept || typeof kept !== 'object') return [];
  let list = momentLists.get(kept);
  if (!list) momentLists.set(kept, (list = momentsOf(kept)));
  return list;
}

/** Whether any feature of the layer is dated, so a first day would leave something out. */
export const isDated = (collection) => keptMoments(collection, null).length > 0;

/** The map's layers with one feature of one of them hidden on it (`on`) or shown again. */
export function withHidden(layers, name, id, on) {
  return (layers ?? []).map((entry) => {
    if (entry.name !== name) return entry;
    const kept = (entry.hidden_features ?? []).filter((item) => item !== id);
    return { ...entry, hidden_features: on ? [...kept, id] : kept };
  });
}

/** What a hidden feature is called: its name in the layer, or in its id for a source's; '' when nothing says. */
export function hiddenName(collection, id) {
  const feature = collection?.features?.find((item) => featureId(item) === id);
  const name = String(feature?.properties?.name ?? '').trim();
  if (name) return name;
  return id.startsWith('~') ? id.slice(1, id.lastIndexOf('@')) : '';
}
