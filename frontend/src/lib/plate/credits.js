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
export function mapCredits(element, { providers = [], rows = [], relief = null } = {}) {
  const parts = [];
  const ground = element.basemap || 'plain';
  if (ground.startsWith('plain')) {
    parts.push(PLAIN_ATTRIBUTION);
    if (relief && element.overlays?.includes('relief')) parts.push(relief.sources?.[0]?.attribution ?? '');
  } else parts.push(providers.find((entry) => entry.id === ground)?.attribution ?? '');
  for (const id of element.overlays ?? []) if (id !== 'relief') parts.push(overlayAttribution(id));
  for (const entry of element.layers ?? []) {
    const row = rows.find((item) => item.name === entry.name);
    if (row && !row.editable) parts.push(layerCredit(row));
  }
  return parts.map(strip).filter(Boolean);
}

/** Every map's credits, each said once, for the plate's credits box. */
export function plateCredits(spec, sources) {
  const seen = new Set();
  for (const element of spec.elements) {
    if (element.kind !== 'map' && element.kind !== 'inset') continue;
    for (const part of mapCredits(element, sources)) seen.add(part);
  }
  return [...seen].join(' · ');
}
