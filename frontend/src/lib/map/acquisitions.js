/**
 * Sentinel-2 passes over the areas a sweep would cover.
 *
 * A crosshair date picker asks "is there imagery here"; a sweep has to ask "is
 * there imagery over all of this", and the two have different answers. Sentinel-2
 * flies 290 km-wide swaths on a five-day revisit, so an area can sit across two
 * of them and have no single day that covers it at all. Pinned to one date
 * anyway, half the sweep reads nodata and reports nothing found over ground it
 * never saw.
 *
 * The lookup itself is `POST /api/satellite/sentinel/acquisitions`; everything
 * here is the pure part around it, so the panel stays a view.
 */

import { daysBefore, isoDay } from '../sentinel.js';

/** How far back to look. A month is several passes; a year is a last resort. */
export const LOOKBACK_WINDOWS = Object.freeze([
  { id: 30, label: '30 days' },
  { id: 90, label: '90 days' },
  { id: 365, label: '1 year' },
]);

/**
 * Coverage at or above this counts as covering the whole area. Not 1.0 because
 * the backend measures it by sampling, and a ring's own edge lands a point or
 * two outside a granule that in truth reaches it. Mirrors `FULL_COVER` in
 * `engine/analyzers.py`.
 */
export const FULL_COVER = 0.98;

/** The request body for a lookup over the areas currently drawn. */
export function acquisitionQuery(zones, days, now = new Date(), collection = 'sentinel2') {
  return {
    zones: zones.map(({ id, name, kind, points }) => ({ id, name, kind, points })),
    start: daysBefore(days, now),
    end: isoDay(now),
    collection,
  };
}

/** One pass as a key: a radar day can hold two passes, morning and evening. */
export function passKey(entry) {
  return entry?.time ? `${entry.date}T${entry.time}` : entry?.date ?? '';
}

/**
 * What a coverage share was measured over, as a comparable key.
 *
 * A share describes one set of shapes. Redraw them and every number in the list
 * is about ground that is no longer being asked about, so the list has to go
 * rather than quietly age into a lie. Geometry only: renaming an area changes
 * nothing a satellite swath cares about, and dropping the list for it would
 * charge a request for a rename.
 */
export function areaKey(zones) {
  return JSON.stringify((zones ?? []).map((zone) => [zone.kind, zone.points]));
}

/** How much of the drawn areas a pass reaches, as a badge. */
export function coverLabel(coverage) {
  if (!Number.isFinite(coverage)) return '';
  if (coverage >= FULL_COVER) return 'Full cover';
  return `${Math.round(coverage * 100)}% of the areas`;
}

/** Whole, partial or barely there — what colours the badge. */
export function coverClass(coverage) {
  if (!Number.isFinite(coverage)) return 'unknown';
  if (coverage >= FULL_COVER) return 'full';
  return coverage >= 0.5 ? 'part' : 'thin';
}

/**
 * Passes the cloud ceiling still allows, newest first. A pass the service gave
 * no cloud figure for is kept: an unknown is not a reason to hide real imagery.
 */
export function allowed(list, maxcc) {
  return (list ?? []).filter(
    (entry) => entry.cloud == null || entry.cloud <= maxcc
  );
}

/**
 * What to warn about once a date is chosen, or '' when there is nothing to say.
 * Stated before the run, this is a row in a list; discovered after it, it is a
 * sweep paid for in tiles that found nothing.
 */
export function coverageWarning(entry) {
  if (!entry || !Number.isFinite(entry.coverage) || entry.coverage >= FULL_COVER) return '';
  return `${entry.date} reaches ${Math.round(entry.coverage * 100)}% of the areas. The rest has no imagery that day and will be reported as not swept.`;
}

/** The share of a finished run's areas that had imagery on both dates. */
export function sweptNote(swept) {
  if (!Number.isFinite(swept) || swept >= FULL_COVER) return '';
  return `Swept ${Math.round(swept * 100)}% of the areas; the rest had no imagery on these dates.`;
}
