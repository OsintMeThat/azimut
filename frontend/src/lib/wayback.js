/**
 * Esri World Imagery Wayback: which release of World Imagery a map is showing.
 *
 * A release rides on the provider id as a variant, `esri-wayback~64776`, the way
 * a Sentinel-2 window does (`lib/sentinel.js`), and `engine/wayback.py` reads the
 * same shape. The plain id means the newest release, which the backend names.
 *
 * Two dates must not be confused anywhere this is shown. A **release date** is
 * when Esri published the mosaic. The **acquisition date** is when the pixels
 * under a point were taken, which can be years earlier and differs from one
 * point of a release to the next. The picker lists releases; the date pill under
 * it (the imagery-date route) states the acquisition.
 */

export const WAYBACK_ID = 'esri-wayback';
const SEP = '~';

/** A release is a whole positive number, and nothing else reaches a URL. */
export function validRelease(value) {
  return Number.isInteger(value) && value > 0 && value < 1e9;
}

/** The provider id for one release, or the plain id for the newest. */
export function waybackId(baseId, release) {
  if (baseId !== WAYBACK_ID || !validRelease(release)) return baseId;
  return `${baseId}${SEP}${release}`;
}

/** …and back: the release an id names, or null for the plain basemap. */
export function releaseOf(providerId) {
  const [base, spec] = String(providerId ?? '').split(SEP);
  if (base !== WAYBACK_ID || !/^\d{1,9}$/.test(spec ?? '')) return null;
  return Number(spec);
}

/**
 * The releases the picker walks through, newest first.
 *
 * With `changesOnly`, only the releases whose pixels changed at the point; that
 * list is a subset of the whole one, so the dates always come from the list.
 */
export function visibleReleases(releases, changes, changesOnly) {
  if (!changesOnly || !changes) return releases;
  const changed = new Set(changes);
  return releases.filter((entry) => changed.has(entry.release));
}

/**
 * Where a release sits in a list, counting the plain basemap as the newest.
 *
 * A release absent from the list (the analyst narrowed it to changes, and the
 * one on screen changed nothing here) sits where its date would put it, so
 * stepping from it moves to the neighbouring change rather than to the top.
 */
export function positionOf(list, releases, current) {
  if (!list.length) return -1;
  if (current == null) return 0;
  const exact = list.findIndex((entry) => entry.release === current);
  if (exact !== -1) return exact;
  const date = releases.find((entry) => entry.release === current)?.date;
  if (!date) return 0;
  const older = list.findIndex((entry) => entry.date < date);
  return older === -1 ? list.length - 0.5 : older - 0.5;
}

/**
 * One step through the list: `-1` is newer, `+1` is older. Returns the release
 * to show, or undefined when there is nowhere further to go.
 */
export function stepRelease(list, releases, current, direction) {
  const at = positionOf(list, releases, current);
  if (at === -1) return undefined;
  const next = direction > 0 ? Math.floor(at + 1) : Math.ceil(at - 1);
  return list[next]?.release;
}

/** The publication date of a release, or '' while the list is unknown. */
export function releaseDate(releases, release) {
  if (release == null) return releases[0]?.date ?? '';
  return releases.find((entry) => entry.release === release)?.date ?? '';
}

/**
 * The question the change list answers: one tile at the view zoom. A nudge that
 * stays inside that tile has the same history, so it is not asked again.
 */
export function changesKey(lat, lon, zoom) {
  const z = Math.max(0, Math.min(19, Math.round(zoom)));
  const scale = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * scale);
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  const y = Math.floor((0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale);
  return `${z}/${x}/${y}`;
}
