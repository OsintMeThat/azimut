/**
 * What a plate owes the sources it draws, written into its credits box.
 *
 * A provider's terms ask for its credit wherever its pixels are shown, and a plate
 * leaves the app as a file, so the credits are printed on the page, never left to a
 * control on the screen. Gathered from every map of the plate, each said once.
 */
import { overlayAttribution } from '../map/basemap.js';
import { attribution as layerCredit } from '../map/addedLayers.js';
import { PLAIN_ATTRIBUTION, readsHeights } from './plainBasemap.js';
import { CLOUDLESS_ID, cloudlessYear } from './cloudless.js';
import { SENTINEL_ID, passCredit } from './sentinelPass.js';

const strip = (text) => String(text ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/** The credits of one map: its ground, its relief, its overlays and the layers it draws from elsewhere. */
export function mapCredits(element, sources = {}) {
  return [...groundCredits(element, sources), ...layerCredits(element, sources.rows ?? [])];
}

/** What a map's ground, its relief and its overlays owe, which their terms ask for wherever their pixels are shown. */
function groundCredits(element, { providers = [], relief = null, releases = [], years = [] }) {
  const parts = [];
  const ground = element.basemap || 'plain';
  // the heights are read by the shading, by a ground's own relief, tints and lines, and by a map in 3D
  const heights = relief && (readsHeights(ground, element.overlays ?? []) || (element.terrain ?? 0) > 0);
  if (ground.startsWith('plain')) {
    parts.push(PLAIN_ATTRIBUTION);
    if (heights) parts.push(relief.sources?.[0]?.attribution ?? '');
  } else if (ground === CLOUDLESS_ID) {
    // the credit and licence of the year the map shows, word for word as EOX asks
    parts.push(cloudlessYear(element, years)?.attribution ?? providers.find((entry) => entry.id === ground)?.attribution ?? '');
    if (heights) parts.push(relief.sources?.[0]?.attribution ?? '');
  } else {
    const said = providers.find((entry) => entry.id === ground)?.attribution ?? '';
    // a Wayback map names the release it shows, the date a reader can check, in place of the bare name
    const release = releases.find((entry) => entry.release === element.release) ?? (ground === 'esri-wayback' ? releases[0] : null);
    const dated = ground === 'esri-wayback' && release?.date ? `World Imagery Wayback, release of ${release.date}` : '';
    parts.push(dated ? strip(said).split(' · ').filter((part) => part !== 'World Imagery Wayback').join(' · ') : said);
    if (dated) parts.push(dated);
    // a Sentinel-2 map names the day of its one pass
    if (ground === SENTINEL_ID) parts.push(passCredit(element));
    if (heights) parts.push(relief.sources?.[0]?.attribution ?? '');
  }
  for (const id of element.overlays ?? []) if (id !== 'relief') parts.push(overlayAttribution(id));
  return parts.map(strip).filter(Boolean);
}

/** Whether a layer came from somebody else: a GeoConfirmed feed, a link, a My Maps. A file of the analyst's own owes nobody. */
const fromElsewhere = (source) => source?.kind === 'geoconfirmed' || source?.kind === 'url' || Boolean(source?.my_maps);

/** What the layers a map draws owe the people who made them. */
function layerCredits(element, rows) {
  const parts = [];
  for (const entry of element.layers ?? []) {
    const row = rows.find((item) => item.name === entry.name);
    if (!row) continue;
    if (!row.editable && fromElsewhere(row.source)) parts.push(layerCredit(row));
    // an editable copy of somebody else's layer still owes them
    else if (row.editable && row.origin?.source) parts.push(layerCredit({ title: row.origin.source.name || row.title, source: row.origin.source }));
  }
  return parts.map(strip).filter(Boolean);
}

/**
 * Every map's credits, each said once, then what the features themselves owe
 * (`extra`, a copied feature's `credit`): `[{ text, owed }]`, `owed` for what a
 * ground's, a relief's or an overlay's terms ask for wherever its pixels are shown,
 * which no plate drops. What the layers and the features owe is the analyst's to keep.
 */
export function creditParts(spec, sources = {}) {
  const parts = new Map();
  for (const element of spec.elements) {
    if (element.kind !== 'map' && element.kind !== 'inset') continue;
    for (const part of groundCredits(element, sources)) parts.set(part, true);
    for (const part of layerCredits(element, sources.rows ?? [])) if (!parts.has(part)) parts.set(part, false);
  }
  for (const part of sources.extra ?? []) if (strip(part) && !parts.has(strip(part))) parts.set(strip(part), false);
  return [...parts].map(([text, owed]) => ({ text, owed }));
}

/** The plate's credits box, each part once, but those the analyst took off it (`dropped`). */
export function plateCredits(spec, sources, dropped = []) {
  return creditParts(spec, sources).filter((part) => part.owed || !dropped.includes(part.text)).map((part) => part.text).join(' · ');
}
