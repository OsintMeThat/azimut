/**
 * The Saved panel's geography tree: continent › country › region › items.
 *
 * Saved work is browsed by *where it is*, not by how far you have scrolled, so
 * this turns the flat saved index (GET /satellite/index) into the tree the
 * panel renders. Pure and synchronous — the whole index is already in memory,
 * so filtering and grouping never touch the network.
 *
 * Continent is derived server-side from the country code; nothing here talks to
 * a geocoder.
 */

import { matchesTerms } from './folderBrowse.js';
import { haversine } from './measure.js';

/** The switch's three positions, in the order a case is read: the footage
 *  first, then the points dropped on it, then the imagery captured of it.
 *
 *  **Media** is a mode, not a filter — a file carries no point of its own and
 *  stands where the graph puts it, so it has an index of its own and swaps the
 *  rows the panel reads. Places and captures filter the one saved index; a
 *  screenshot is a capture with a different origin, not a thing to choose
 *  between. */
export const KINDS = [
  { id: 'media', label: 'Media' },
  { id: 'places', label: 'Places' },
  { id: 'captures', label: 'Captures' },
];

/** The kinds a list reading the saved index alone can offer, where `all` is
 *  honestly all of it — media is not in that index (`PointPicker.svelte`). */
export const SAVED_KINDS = [
  { id: 'all', label: 'All' },
  { id: 'places', label: 'Places' },
  { id: 'captures', label: 'Captures' },
];

/** True when this position swaps the row source rather than filtering it. */
export function isMode(kind) {
  return kind === 'media';
}

/** Where an item with no country goes, and what that bucket is called. */
export const UNLOCATED = 'Unlocated';

/** A located country whose code isn't in the continent table still groups by
 *  country — the country is the useful part, the continent is the shelf. */
const OTHER_CONTINENT = 'Other';

function matchesKind(row, kind) {
  if (kind === 'places') return row.kind === 'place';
  if (kind === 'captures') return row.kind === 'capture' || row.kind === 'screenshot';
  return true;
}

/**
 * The folder a row was filed under, against the one being asked for.
 *
 * `null` is every folder and `''` is the rows nobody filed, which are two
 * different questions: "show me everything" and "show me what I have not put
 * away yet".
 */
function matchesFolder(row, folder) {
  if (folder == null) return true;
  return (row.folder || '') === folder;
}

/**
 * The folders the given rows are filed under, each with how many it holds.
 *
 * Read off the rows rather than off the case: a folder holding notes and no
 * saved point would be a switch that hides nothing, and the map's own filter
 * should only offer what is on the map.
 */
export function savedFolders(rows) {
  const counts = new Map();
  for (const row of rows ?? []) {
    const key = row.folder || '';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .map(([id, count]) => ({ id, count }))
    // named folders in their own order, and the unfiled rows last: they are a
    // leftover, not a place
    .sort((a, b) => (a.id === '' ? 1 : b.id === '' ? -1 : a.id.localeCompare(b.id)));
}

/** Everything a search over saved work reads: what it is called, what was
 *  written about it, where it is, and who it came from. */
function savedText(row) {
  const geo = row.geo ?? {};
  // both spellings a pair of coordinates gets pasted in: the stored precision
  // and the rounded one the panel prints
  const coords =
    row.lat == null || row.lon == null
      ? ''
      : `${row.lat}, ${row.lon}\n${Number(row.lat).toFixed(4)}, ${Number(row.lon).toFixed(4)}`;
  return [
    row.title,
    row.notes,
    row.provider,
    row.site,
    geo.country,
    geo.region,
    // both spellings of the place, so "Russia" finds a case filed as Россия
    row.country_en,
    geo.region_en,
    row.continent,
    coords,
  ]
    .filter(Boolean)
    .join('\n');
}

/** One row per entity, keeping the first. A file recorded in one city and
 *  showing another is two marks on the map — the map is about places — but one
 *  line in a flat list, which is about things. */
export function oneEach(rows) {
  const seen = new Set();
  return (rows ?? []).filter((row) => !seen.has(row.id) && seen.add(row.id));
}

/** The rows a kind + query select, in the index's own newest-first order. */
export function filterSaved(rows, { kind = 'all', query = '', folder = null } = {}) {
  return (rows ?? []).filter(
    (row) =>
      matchesKind(row, kind) &&
      matchesFolder(row, folder) &&
      matchesTerms(savedText(row), query)
  );
}

/** How the search modal can order results. The tree has no sort control: its
 *  order *is* the geography, and inside a leaf newest-first is the only one
 *  that makes sense. */
export const SORTS = [
  { id: 'newest', label: 'Newest' },
  { id: 'title', label: 'Title' },
  { id: 'distance', label: 'Distance from map centre' },
];

/** Order a flat result list. `origin` is the map centre, and rows with no
 *  coordinates sort to the end rather than pretending to be at 0°,0°. */
export function sortSaved(rows, sort = 'newest', origin = null) {
  const out = [...(rows ?? [])];
  if (sort === 'title') {
    return out.sort((a, b) => String(a.title ?? '').localeCompare(String(b.title ?? '')));
  }
  if (sort === 'distance' && origin) {
    const far = Number.POSITIVE_INFINITY;
    const away = (row) =>
      row.lat == null || row.lon == null
        ? far
        : haversine(origin, { lat: Number(row.lat), lon: Number(row.lon) });
    return out.sort((a, b) => away(a) - away(b));
  }
  return out.sort((a, b) => String(b.fetched_at ?? '').localeCompare(String(a.fetched_at ?? '')));
}

/** True once a country is known — the only state the tree can place. */
export function isLocated(row) {
  return row.geo?.state === 'ok' && !!row.geo?.country;
}

/** How many items a Locate pass would still have something to do about:
 *  never attempted, or attempted and failed. Open sea and coordinate-less
 *  items are settled, and asking again would only waste a lookup. */
export function pendingLocate(rows) {
  return (rows ?? []).filter((row) => !row.geo || row.geo.state === 'failed').length;
}

const newestFirst = (rows) =>
  [...rows].sort((a, b) => String(b.fetched_at ?? '').localeCompare(String(a.fetched_at ?? '')));

function labelAt(row, level) {
  if (level === 'continent') return row.continent || OTHER_CONTINENT;
  if (level === 'country') return row.geo.country;
  // Nominatim has no region for every point (city-states, small islands). The
  // country is then the finest honest name, and using it keeps the tree one
  // shape deep rather than letting some branches end a level early.
  return row.geo.region || row.geo.country;
}

/** How a place reads in the tree: `English (native)`, or one name when that is
 *  all there is to say. Nominatim answers in the local language, which is right
 *  for a proof or a post and hard to scan in a panel. */
export function bilingual(english, native) {
  const en = String(english ?? '').trim();
  const local = String(native ?? '').trim();
  if (!en) return local;
  if (!local || en === local) return en || local;
  return `${en} (${local})`;
}

/** The bilingual label for a node. The native name stays the identity (see
 *  `group`); this is only what the analyst reads. */
function displayAt(row, level) {
  if (level === 'continent') return labelAt(row, level); // already English
  if (level === 'country') return bilingual(row.country_en, row.geo.country);
  if (row.geo.region) return bilingual(row.geo.region_en, row.geo.region);
  return bilingual(row.country_en, row.geo.country);
}

function group(rows, levels, prefix) {
  const [level, ...rest] = levels;
  const buckets = new Map();
  for (const row of rows) {
    // Grouped and keyed on the native name, never on the label: rows that
    // carry an English name and rows that don't belong in the same bucket,
    // and an expanded branch must survive a name gaining its translation.
    const name = labelAt(row, level);
    if (!buckets.has(name)) buckets.set(name, { rows: [], label: displayAt(row, level) });
    buckets.get(name).rows.push(row);
  }
  return [...buckets.entries()]
    .sort(([, a], [, b]) => a.label.localeCompare(b.label))
    .map(([name, bucket]) => {
      const key = prefix ? `${prefix}/${name}` : name;
      return {
        level,
        name,
        label: bucket.label,
        key,
        count: bucket.rows.length,
        children: rest.length ? group(bucket.rows, rest, key) : [],
        items: rest.length ? [] : newestFirst(bucket.rows),
      };
    });
}

/**
 * The tree for one kind + query.
 *
 * Levels are decided **globally**, over the whole filtered set, never per
 * branch: a case that sits in one continent doesn't show that continent, and
 * one that also sits in a single country opens straight on its regions. So the
 * tree has one depth at a time instead of a ragged mix, and the counts always
 * describe what the filter is showing.
 *
 * Returns `{ levels, nodes, unlocated }`. `unlocated` is a node like any other
 * and always renders last; its count is 0 when there is nothing in it.
 */
export function buildGeoTree(rows, { kind = 'all', query = '' } = {}) {
  const shown = filterSaved(rows, { kind, query });
  const placed = [];
  const stray = [];
  for (const row of shown) (isLocated(row) ? placed : stray).push(row);

  const continents = new Set(placed.map((row) => labelAt(row, 'continent')));
  const countries = new Set(placed.map((row) => row.geo.country));
  const levels = [];
  if (continents.size > 1) levels.push('continent');
  if (levels.length || countries.size > 1) levels.push('country');
  levels.push('region');

  return {
    levels,
    nodes: placed.length ? group(placed, levels, '') : [],
    unlocated: {
      level: 'unlocated',
      name: UNLOCATED,
      label: UNLOCATED,
      key: UNLOCATED,
      count: stray.length,
      children: [],
      items: newestFirst(stray),
    },
  };
}

/** Every node key on the path down to `key`, so opening a search result can
 *  expand exactly the branch it lives in and nothing else. */
export function branchKeys(key) {
  const parts = String(key ?? '').split('/');
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}

/** The leaf key holding `row` in a tree of `levels` — the address the panel
 *  expands to when something elsewhere asks to reveal one saved item. */
export function keyFor(row, levels) {
  if (!isLocated(row)) return UNLOCATED;
  return levels.map((level) => labelAt(row, level)).join('/');
}
