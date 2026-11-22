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

/**
 * A map's ground's day as its bar says it, short: a Wayback release's day, a Sentinel-2
 * pass's, a cloudless year; "Newest" for a release or a year not picked and not read yet,
 * "No pass yet" for Sentinel-2 before its pass is known; '' for a ground with no day of
 * its own, which shows none.
 */
export function groundDay(map, { releases = [], years = [] } = {}) {
  const day = (value) => (DAY.test(String(value ?? '')) ? momentLabel(value) : String(value ?? ''));
  if (map?.basemap === WAYBACK_ID) return day(releaseOf(map, releases)?.date) || (map.release ? `Release ${map.release}` : 'Newest');
  if (map?.basemap === CLOUDLESS_ID) return String(cloudlessYear(map, years)?.year ?? map.year ?? 'Newest');
  if (map?.basemap === SENTINEL_ID) return map.acquired ? day(map.acquired) : 'No pass yet';
  return '';
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

/** A map's layers with `name` drawn one place higher (`by` -1, over the others) or lower (1), held within the list. */
export function movedLayer(layers = [], name, by) {
  const list = [...layers];
  const from = list.findIndex((entry) => entry.name === name);
  if (from < 0) return list;
  const to = Math.max(0, Math.min(list.length - 1, from + by));
  list.splice(to, 0, ...list.splice(from, 1));
  return list;
}

/** A map as the panels name it: its own name, else Map, Map 2… by its place on the page, a detail map as one. */
export function mapName(spec, map) {
  if (map?.name) return map.name;
  if (map?.of) return 'Detail map';
  const index = layeredMaps(spec).indexOf(map);
  return index > 0 ? `Map ${index + 1}` : 'Map';
}

/** What a map's own look for a layer holds, which Same on the other maps gives the others: its days and hidden features stay each map's. */
export const LOOK_FIELDS = ['role', 'colour', 'dash', 'fill', 'stroke', 'icons', 'hidden'];

/** `entry` drawn as `source` draws the same layer: its role, colours, lines, fill, weights and groups left out. */
export function withLookOf(entry, source) {
  const look = Object.fromEntries(LOOK_FIELDS.filter((field) => field in source).map((field) => [field, field === 'hidden' ? [...source.hidden] : source[field]]));
  return { ...entry, ...look };
}

/** Whether two maps draw a layer alike, their days and hidden features aside. */
export function sameLook(a, b) {
  const value = (entry, field) => (field === 'hidden' ? [...(entry?.hidden ?? [])].sort().join('\n') : entry?.[field] ?? (['stroke', 'icons'].includes(field) ? 1 : field === 'colour' ? null : ''));
  return LOOK_FIELDS.every((field) => value(a, field) === value(b, field));
}

const FILLS = { solid: 'full', hatch: 'hatched', none: 'outline only' };

/**
 * What a map does to a layer beyond drawing it as the Map does, in a few words for
 * its row: its role, its lines and fill, its weights, its groups and features left
 * out, its days. '' when it keeps the layer's own look whole. `role(id)` names a role,
 * `day(iso)` a day.
 */
export function layerSaid(entry, { role = (id) => id, day = (iso) => iso } = {}) {
  if (!entry) return '';
  const said = [];
  if (entry.role) said.push(role(entry.role));
  if (entry.dash) said.push(entry.dash);
  if (FILLS[entry.fill]) said.push(FILLS[entry.fill]);
  if ((entry.stroke ?? 1) !== 1) said.push(`lines ${entry.stroke}×`);
  if ((entry.icons ?? 1) !== 1) said.push(`marks ${entry.icons}×`);
  const groups = entry.hidden?.length ?? 0;
  if (groups) said.push(`${groups} ${groups === 1 ? 'group' : 'groups'} left out`);
  const features = entry.hidden_features?.length ?? 0;
  if (features) said.push(`${features} hidden here`);
  if (entry.start) said.push(`from ${day(entry.start)}`);
  if (entry.end) said.push(`to ${day(entry.end)}`);
  return said.join(' · ');
}

/** A map toggled on or off one of the case's layers, drawn over the others when it comes in. */
export function withLayer(map, name) {
  const list = map.layers ?? [];
  return list.some((entry) => entry.name === name)
    ? list.filter((entry) => entry.name !== name)
    : [...list, { name, hidden: [], stroke: 1, icons: 1 }];
}
