/**
 * What a plate owes the sources it draws, written into its credits box.
 *
 * A provider's terms ask for its credit wherever its pixels are shown, and a plate
 * leaves the app as a file, so the credits are printed on the page, never left to a
 * control on the screen. Gathered from every map of the plate, each said once.
 */
import { overlayAttribution } from '../map/basemap.js';
import { attribution as layerCredit } from '../map/addedLayers.js';
import { PLAIN_ATTRIBUTION } from './plainBasemap.js';

const strip = (text) => String(text ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/** The credits of one map: its ground, its relief, its overlays and the layers it draws from elsewhere. */
export function mapCredits(element, { providers = [], rows = [], relief = null, releases = [] } = {}) {
  const parts = [];
  const ground = element.basemap || 'plain';
  if (ground.startsWith('plain')) {
    parts.push(PLAIN_ATTRIBUTION);
    if (relief && element.overlays?.includes('relief')) parts.push(relief.sources?.[0]?.attribution ?? '');
  } else {
    parts.push(providers.find((entry) => entry.id === ground)?.attribution ?? '');
    // a Wayback map names the release it shows, the date a reader can check
    const release = releases.find((entry) => entry.release === element.release) ?? (ground === 'esri-wayback' ? releases[0] : null);
    if (ground === 'esri-wayback' && release?.date) parts.push(`World Imagery Wayback, release of ${release.date}`);
  }
  for (const id of element.overlays ?? []) if (id !== 'relief') parts.push(overlayAttribution(id));
  for (const entry of element.layers ?? []) {
    const row = rows.find((item) => item.name === entry.name);
    if (!row) continue;
    if (!row.editable) parts.push(layerCredit(row));
    // an editable copy of somebody else's layer still owes them
    else if (row.origin?.source) parts.push(layerCredit({ title: row.origin.source.name || row.title, source: row.origin.source }));
  }
  return parts.map(strip).filter(Boolean);
}

/**
 * Every map's credits, each said once, for the plate's credits box, then what the
 * features themselves owe (`extra`, a copied feature's `credit`).
 */
export function plateCredits(spec, sources) {
  const seen = new Set();
  for (const element of spec.elements) {
    if (element.kind !== 'map' && element.kind !== 'inset') continue;
    for (const part of mapCredits(element, sources)) seen.add(part);
  }
  for (const part of sources?.extra ?? []) if (strip(part)) seen.add(strip(part));
  return [...seen].join(' · ');
}
