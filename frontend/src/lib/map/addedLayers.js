/**
 * The layers the analyst added themselves, as the panel reads them.
 *
 * The curated stack in `tools.js` is what Azimut chose; this is what the analyst
 * chose — a KMZ somebody sent them, a My Maps they follow. That is the line
 * between the panel's two sections, not local versus remote: both halves of this
 * feature land in the same list, because the question a row answers is "who put
 * this on my map".
 *
 * Everything here is arithmetic over what the backend returned, so the rules the
 * row states — how fresh it is, how many of its features are drawn, what colour
 * a legend line is — are read off a test rather than off a map
 * (`addedLayers.test.js`). The MapLibre side is `addedLayer.js`; the fetching and
 * parsing are the backend's (`engine/maplayers.py`), and the browser never sees
 * a byte of KML.
 */
import { timeAgo } from '../analysisViews.js';
import { matchesTerms } from '../folderBrowse.js';

/**
 * Colours for a category whose source painted it nothing.
 *
 * A My Maps creator groups by colour far more than by icon, so an honoured
 * colour is the meaning; this is only what fills in for a source that stated
 * none. Picked to stay apart from each other and off the case's own marks, which
 * are the accent — a foreign layer must never read as this case's work.
 */
export const PALETTE = [
  '#5ac8fa',
  '#ffcc66',
  '#a0e57a',
  '#ff8fa3',
  '#c58af9',
  '#6fd3c7',
  '#f3a26d',
  '#9aa7ff',
];

/** Past this a snapshot is old enough that the row says so before it redraws. */
export const FRESH_FOR_HOURS = 24;

/**
 * The colour a category is drawn in: what the source said, else the palette.
 *
 * Keyed by position rather than by name so two layers holding a "Checkpoints"
 * each do not come out the same colour — the index is within one layer.
 */
export function categoryColour(category, index) {
  return category?.colour || PALETTE[index % PALETTE.length];
}

/** The legend, which is also the filter: one row per category, in the source's
 *  own order of weight. `on` is what the eye beside it shows. */
export function legend(layer) {
  const hidden = new Set(layer?.hidden ?? []);
  return (layer?.categories ?? []).map((category, index) => ({
    name: category.name,
    count: category.count ?? 0,
    kinds: category.kinds ?? [],
    colour: categoryColour(category, index),
    on: !hidden.has(category.name),
  }));
}

/**
 * What is loaded, and what is drawn — never the one passing for the other.
 *
 * Visible means "not filtered out here". It is deliberately *not* what is on
 * screen: the engine culls to the viewport and drops symbols that collide, so a
 * screen count would change on every pan and cost a render query per frame to
 * read. A number that moved while nobody touched anything would be worse than no
 * number at all.
 */
export function counts(layer) {
  const loaded = layer?.features ?? 0;
  const hidden = new Set(layer?.hidden ?? []);
  const dropped = (layer?.categories ?? [])
    .filter((category) => hidden.has(category.name))
    .reduce((total, category) => total + (category.count ?? 0), 0);
  return { loaded, visible: Math.max(0, loaded - dropped) };
}

/**
 * `3 200` — grouped, because five digits of features run together otherwise.
 *
 * A narrow no-break space (U+202F), so a count never wraps across two lines of a
 * panel this narrow and reads as two separate numbers.
 */
export const GROUP_SPACE = '\u202f';

export function grouped(value) {
  return String(Math.round(Number(value) || 0)).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    GROUP_SPACE
  );
}

/** The row's counter, stating both numbers whenever they differ. */
export function countLabel(layer) {
  const { loaded, visible } = counts(layer);
  const features = `${grouped(loaded)} ${loaded === 1 ? 'feature' : 'features'}`;
  return visible === loaded ? features : `${features} · ${grouped(visible)} shown`;
}

/**
 * How fresh what is drawn actually is.
 *
 * The worst thing this feature could do is draw week-old data on a map where
 * decisions get made and say nothing, so a stale subscription says so on the row
 * — before anyone reads the marks, not after. A file says when it was opened and
 * nothing more: it is exactly what the analyst dropped in, and it was never
 * going to change on its own.
 */
export function freshness(layer, now = Date.now()) {
  if (!layer) return '';
  if (layer.source?.kind !== 'url') {
    const at = timeAgo(layer.fetched_at, now);
    return at ? `opened ${at}` : '';
  }
  const at = layer.checked_at || layer.fetched_at;
  const said = timeAgo(at, now);
  if (!said) return 'never read';
  return layer.stale ? `stale — last read ${said}` : `read ${said}`;
}

/** Where a row came from, in the width a row has. */
export function sourceLabel(layer) {
  const source = layer?.source ?? {};
  if (source.kind !== 'url') return source.name || 'a file on this computer';
  if (source.my_maps) return 'Google My Maps';
  try {
    return new URL(source.url).hostname.replace(/^www\./, '');
  } catch {
    return source.url || '';
  }
}

/**
 * The credit line a layer owes its source.
 *
 * The curated overlays each declare one (`basemap.js`), and a map somebody else
 * drew is owed the same. A My Maps has an author we cannot read from the feed,
 * so the map's own title and the platform are what can honestly be stated.
 */
export function attribution(layer) {
  const title = layer?.title || 'Added layer';
  const source = layer?.source ?? {};
  if (source.my_maps) return `${title} — Google My Maps`;
  if (source.kind === 'url') return `${title} — ${sourceLabel(layer)}`;
  return `${title} — added by the analyst`;
}

/** Which layers a case open should re-read: enabled, subscribed, and asked to. */
export function refreshable(layers = []) {
  return layers.filter(
    (layer) =>
      layer.enabled && layer.source?.kind === 'url' && layer.refresh?.on_open !== false
  );
}

/** Which layers the map should actually be drawing. */
export function drawable(layers = []) {
  return layers.filter((layer) => layer.enabled);
}

/** One category switched, as the PATCH body expects it: the whole hidden list. */
export function toggleCategory(layer, name) {
  const hidden = new Set(layer?.hidden ?? []);
  if (hidden.has(name)) hidden.delete(name);
  else hidden.add(name);
  return [...hidden];
}

/** What a feature the source never named is called, wherever it is shown. */
export const UNNAMED = 'Unnamed feature';

/**
 * How many matches one search lists.
 *
 * The panel is 300px wide and a match is a line in it. Past this the list is
 * something to scroll rather than something to read, so the tally says how many
 * were found and the search is what narrows them.
 */
export const SEARCH_LIMIT = 25;

/**
 * The features of one layer whose name or group matches what was typed.
 *
 * **A finder, not a filter.** The legend beside it is the filter: it is
 * persisted on the spec and it is what `countLabel` counts. A search is
 * ephemeral and changes nothing about what the map draws — a row that said
 * "3 200 features · 412 shown" while somebody typed would be stating a filter
 * nobody set.
 *
 * **Names and groups only, never descriptions.** A description runs to
 * `MAX_DESCRIPTION` characters and a layer to `MAX_FEATURES` of them
 * (`engine/maplayers.py`), so reading them on every keystroke would make this
 * the most expensive thing in the app — for a gain an analyst rarely asks for,
 * since what anyone remembers of somebody else's map is what it called a place.
 *
 * Counted in full and listed in part: the tally is what says to narrow the
 * search rather than scroll it.
 */
export function searchFeatures(collection, query, options = {}) {
  const { categories = [], hidden = [], limit = SEARCH_LIMIT } = options;
  const terms = String(query ?? '').trim();
  if (!terms) return { total: 0, results: [] };

  const colours = new Map(
    (categories ?? []).map((category, index) => [category.name, categoryColour(category, index)])
  );
  const off = new Set(hidden ?? []);
  const results = [];
  let total = 0;

  (collection?.features ?? []).forEach((feature, position) => {
    const properties = feature?.properties ?? {};
    const category = properties.category ?? '';
    if (!matchesTerms(`${properties.name ?? ''} ${category}`, terms)) return;
    total += 1;
    if (results.length >= limit) return;
    results.push({
      // What the backend numbered this feature, so going to it is a lookup
      // rather than a second copy of the geometry in the panel.
      index: properties.index ?? position,
      name: properties.name || UNNAMED,
      category,
      // The source's own colour where it painted one, its group's where it did
      // not — the same rule the marks are drawn by (`addedLayer.js`).
      colour: properties.colour || colours.get(category) || categoryColour(null, 0),
      // A match in a group the legend switched off: it is a real feature, it is
      // simply not on the map until that group comes back.
      hidden: off.has(category),
    });
  });
  return { total, results };
}

/**
 * What the `+` accepts. A pasted address subscribes; anything else is a file.
 *
 * Said here so the button and the dialog cannot disagree about which half of the
 * feature a given input lands in.
 */
export function looksLikeUrl(value) {
  return /^https?:\/\/\S+$/i.test(String(value ?? '').trim());
}

/** The formats the file picker offers, and the parser accepts. */
export const ACCEPTS = '.geojson,.json,.kml,.kmz,.gpx';
