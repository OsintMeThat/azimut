/**
 * What the Satellite search bar proposes while the analyst types.
 *
 * Four sources, in the order they can answer. The first three cost nothing —
 * the saved index is already in memory, the coordinate parse and the city
 * gazetteer are a localhost call over data on disk — so they fill the list on
 * the keystroke. Places come from a geocoder that forbids autocomplete, so they
 * are asked for only once typing stops, and they arrive last, underneath.
 *
 * Pure and synchronous: the component fetches, this decides what the list says.
 */

import { filterSaved, oneEach } from './geoTree.js';
import { haversine, formatDistance } from './measure.js';

/** How many recent picks are remembered, and where. */
export const RECENTS_KEY = 'azimut:satelliteRecents';
const RECENTS_MAX = 8;

/** Below this, a geocoder query is too vague to be worth a slot. */
export const REMOTE_MIN_CHARS = 3;

const GROUP_LABELS = {
  coords: 'Coordinates',
  saved: 'Saved in this case',
  cities: 'Cities',
  places: 'Places',
  recents: 'Recent',
};

/** Saved items this query names, nearest-first is *not* the point here — the
 *  index is newest-first and that is what the panel shows, so the head of that
 *  order is what the bar offers. */
export function matchSaved(rows, query, limit = 4) {
  if (!String(query ?? '').trim()) return [];
  return oneEach(filterSaved(rows, { query }))
    .filter((row) => row.lat != null && row.lon != null)
    .slice(0, limit)
    .map((row) => ({
      key: `saved:${row.id}`,
      group: 'saved',
      label: row.title || 'Untitled',
      detail: [row.country_en || row.geo?.country, row.geo?.region].filter(Boolean).join(', '),
      lat: Number(row.lat),
      lon: Number(row.lon),
      row,
    }));
}

/** A city from the bundled gazetteer, as a line to read. */
function cityItem(city) {
  return {
    key: `city:${city.country}:${city.name}:${city.lat},${city.lon}`,
    group: 'cities',
    label: city.name,
    detail: [city.region, city.country_name].filter(Boolean).join(', '),
    lat: Number(city.lat),
    lon: Number(city.lon),
    zoom: 12,
  };
}

/** A geocoder match. Its display name is the whole address, so the head of it
 *  is the label and the rest is the detail — one line either way. */
function placeItem(place) {
  const parts = String(place.display_name ?? '').split(',');
  return {
    key: `place:${place.lat},${place.lon}:${place.display_name}`,
    group: 'places',
    label: parts[0]?.trim() || String(place.display_name ?? ''),
    detail: parts.slice(1).join(',').trim(),
    lat: Number(place.lat),
    lon: Number(place.lon),
    zoom: 15,
  };
}

/** The rows an empty bar shows: where this analyst went last. */
export function recentItems(recents, limit = RECENTS_MAX) {
  return (recents ?? []).slice(0, limit).map((entry, at) => ({
    key: `recent:${at}:${entry.label}`,
    group: 'recents',
    label: entry.label,
    detail: entry.detail ?? '',
    lat: Number(entry.lat),
    lon: Number(entry.lon),
    zoom: entry.zoom,
  }));
}

/**
 * The grouped list under the bar. Empty groups are dropped, so nothing renders
 * a header over nothing, and a duplicate point is kept once — a city already
 * saved in the case is the saved row, not a second line under Cities.
 */
export function buildGroups({
  query = '',
  coords = null,
  saved = [],
  cities = [],
  places = [],
  recents = [],
  centre = null,
  units = 'metric',
} = {}) {
  if (!String(query).trim()) {
    const rows = recentItems(recents);
    return rows.length ? [{ id: 'recents', label: GROUP_LABELS.recents, items: rows }] : [];
  }
  const groups = [];
  if (coords) {
    groups.push({
      id: 'coords',
      label: GROUP_LABELS.coords,
      items: [
        {
          key: `coords:${coords.lat},${coords.lon}`,
          group: 'coords',
          label: `${Number(coords.lat).toFixed(5)}, ${Number(coords.lon).toFixed(5)}`,
          detail: 'Go to these coordinates',
          lat: Number(coords.lat),
          lon: Number(coords.lon),
          zoom: 16,
        },
      ],
    });
  }
  const seen = new Set();
  const fresh = (items) =>
    items.filter((item) => {
      // ~100 m: the same town from two sources, not two neighbouring things
      const at = `${item.lat.toFixed(3)},${item.lon.toFixed(3)}`;
      return !seen.has(at) && seen.add(at);
    });
  for (const [id, items] of [
    ['saved', saved],
    ['cities', cities.map(cityItem)],
    ['places', places.map(placeItem)],
  ]) {
    const rows = fresh(items);
    if (rows.length) groups.push({ id, label: GROUP_LABELS[id], items: rows });
  }
  if (!centre) return groups;
  return groups.map((group) => ({
    ...group,
    items: withDistance(group.items, centre, units),
  }));
}

/** How far each row is from the map centre, for deciding between two Springfields. */
function withDistance(items, centre, units) {
  return items.map((item) =>
    Number.isFinite(item.lat) && Number.isFinite(item.lon)
      ? {
          ...item,
          away: formatDistance(haversine(centre, { lat: item.lat, lon: item.lon }), units),
        }
      : item
  );
}

/** The groups as one list, which is what arrow keys walk. */
export function flatten(groups) {
  return (groups ?? []).flatMap((group) => group.items);
}

/** Move the highlight, wrapping at both ends. `-1` means nothing is highlighted. */
export function step(at, delta, count) {
  if (!count) return -1;
  if (at < 0) return delta > 0 ? 0 : count - 1;
  return (at + delta + count) % count;
}

export function readRecents() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((entry) => entry && entry.label) : [];
  } catch {
    return []; // absent or unreadable store (private mode) — non-fatal
  }
}

/** Remember a pick, newest first, one entry per place. */
export function pushRecent(item) {
  if (!item?.label || !Number.isFinite(item.lat) || !Number.isFinite(item.lon)) return readRecents();
  const entry = {
    label: item.label,
    detail: item.detail ?? '',
    lat: item.lat,
    lon: item.lon,
    zoom: item.zoom,
  };
  const kept = [entry, ...readRecents().filter((old) => old.label !== entry.label)].slice(
    0,
    RECENTS_MAX
  );
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(kept));
  } catch {
    /* store unavailable — the list just does not persist */
  }
  return kept;
}
