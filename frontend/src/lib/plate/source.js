/**
 * Where a plate's maps get what they draw, said plainly. The plate holds none of it:
 * each map looks at a ground and at the case's layers as the Map keeps them, so an edit
 * made in the Map shows on every plate. The Layers tab and `{imagery}` both read these.
 */
import { WAYBACK_ID } from '../wayback.js';
import { momentLabel } from '../map/layerHistory.js';
import { CLOUDLESS_ID, cloudlessSaid, cloudlessYear } from './cloudless.js';
import { SENTINEL_ID, passCredit } from './sentinelPass.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Grounds drawn from map data rather than a picture of the ground, so they have no day of their own. */
const DRAWN = ['osm', 'opentopomap'];

/** The Wayback release a map is drawn on, else the newest, as the releases list gives it. */
const releaseOf = (map, releases) => releases.find((entry) => entry.release === map?.release) ?? releases[0] ?? null;

/** What `{imagery}` writes for a map: a cloudless year, a Sentinel-2 pass, a Wayback release's day; nothing for a ground with no day of its own. */
export function imagerySaid(map, { releases = [], years = [] } = {}) {
  if (map?.basemap === CLOUDLESS_ID) return cloudlessSaid(cloudlessYear(map, years));
  if (map?.basemap === SENTINEL_ID) return passCredit(map);
  if (map?.basemap !== WAYBACK_ID) return '';
  return releaseOf(map, releases)?.date ?? '';
}

/**
 * A map's ground for the Layers tab: the name the Ground menu gives it, and `when` its
 * picture was taken, a day or a year; `undated` for imagery stitched from several days,
 * and `drawn` for a ground drawn from map data, which has no day to say.
 */
export function groundSaid(map, { grounds = [], releases = [], years = [] } = {}) {
  const id = map?.basemap || 'plain';
  const name = grounds.find(([key]) => key === id)?.[1] ?? id;
  const day = (value) => (DAY.test(String(value ?? '')) ? momentLabel(value) : String(value ?? ''));
  if (id.startsWith('plain') || DRAWN.includes(id)) return { name, when: '', drawn: true, undated: false };
  if (id === WAYBACK_ID) return { name, when: day(releaseOf(map, releases)?.date), drawn: false, undated: false };
  if (id === CLOUDLESS_ID) return { name, when: String(cloudlessYear(map, years)?.year ?? ''), drawn: false, undated: false };
  if (id === SENTINEL_ID) return { name, when: map?.acquired ? day(map.acquired) : 'no pass picked yet', drawn: false, undated: false };
  return { name, when: '', drawn: false, undated: true };
}

/** The day a map's picture was taken, `YYYY-MM-DD`: a Wayback release's or a Sentinel-2 pass's; '' for a ground with no single day. */
export function imageryDay(map, { releases = [] } = {}) {
  const day = map?.basemap === WAYBACK_ID ? releaseOf(map, releases)?.date : map?.basemap === SENTINEL_ID ? map.acquired : '';
  return DAY.test(String(day ?? '')) ? day : '';
}

/**
 * The day a map draws its dated layers on, when it is not the plate's: the day of its
 * imagery, once the map is told to (`layers_on`) and that day is known; else null, and
 * the map reads the plate's day as every map does.
 */
export const layersDayOf = (map, { releases = [] } = {}) => (map?.layers_on === 'imagery' ? imageryDay(map, { releases }) || null : null);

/** The maps that draw the case's layers, in the page's order: insets draw none. */
export const layeredMaps = (spec) => (spec?.elements ?? []).filter((element) => element.kind === 'map');

/** A map toggled on or off one of the case's layers, drawn over the others when it comes in. */
export function withLayer(map, name) {
  const list = map.layers ?? [];
  return list.some((entry) => entry.name === name)
    ? list.filter((entry) => entry.name !== name)
    : [...list, { name, hidden: [], stroke: 1, icons: 1 }];
}
