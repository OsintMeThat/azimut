/**
 * Saved work as map markers.
 *
 * Two items saved at the same spot must read as one mark on the map, not as a
 * pin stacked invisibly on another — the question the overlay answers is "what
 * do I already have here?", and the answer is a list, not a pile. Grouping by
 * rounded coordinates does both jobs: at full precision it collapses re-visits
 * of the same point, and at a coarser one it is the clustering that keeps a
 * zoomed-out world map readable.
 */

import { CAPTURE_KINDS } from './geoTree.js';

/**
 * The kind a mark is drawn as, from the kinds it holds.
 *
 * One kind draws as itself. A stack of imagery (captures, screenshots, saved
 * comparisons, which the Saved panel files together under Captures) draws as a
 * capture, so zooming out never turns three captures into a pin. A stack holding
 * a place draws as the place.
 */
export function markKind(kinds) {
  const list = [...(kinds ?? [])];
  if (list.length === 1) return list[0];
  return list.length && list.every((kind) => CAPTURE_KINDS.has(kind)) ? 'capture' : 'place';
}

/** Decimal places to key on at a given map zoom.
 *
 * 5 decimals is about a metre: at street zoom only items at genuinely the same
 * spot merge. Zoom out and the key coarsens, so a country's worth of pins
 * becomes a handful of counted marks instead of a smear. */
export function markerPrecision(zoom) {
  const z = Number(zoom);
  if (!Number.isFinite(z)) return 5;
  if (z < 5) return 0; // whole degrees — continents
  if (z < 8) return 1;
  if (z < 11) return 2;
  if (z < 14) return 3;
  if (z < 16) return 4;
  return 5; // ~1 m — same spot only
}

/**
 * Group rows into marks. Rows with no coordinates are left out — a point with
 * no position has nowhere to be drawn — and each mark reports which kinds it
 * holds so the icon can say whether it is a place, a capture, or a mix.
 *
 * Marks come back in the order their first item appears (the index's newest
 * first), and each mark's items keep that order.
 */
export function groupSavedMarkers(rows, precision = 5) {
  const marks = new Map();
  for (const row of rows ?? []) {
    if (row.lat == null || row.lon == null) continue;
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const key = `${lat.toFixed(precision)},${lon.toFixed(precision)}`;
    const mark = marks.get(key);
    if (mark) {
      mark.items.push(row);
      mark.kinds.add(row.kind);
    } else {
      marks.set(key, { key, lat, lon, items: [row], kinds: new Set([row.kind]) });
    }
  }
  return [...marks.values()].map((mark) => ({
    key: mark.key,
    // the mark sits on its first item, not on the rounded key: a lone pin must
    // land exactly where it was saved, however coarse the grouping was
    lat: mark.lat,
    lon: mark.lon,
    items: mark.items,
    kinds: [...mark.kinds],
  }));
}

/** When an item's imagery was taken: a comparison is read by its later picture,
 *  and an estimate's `~` does not move it. */
const imageryOf = (row) => String(row.imagery_date ?? row.imagery_b ?? '').replace(/~$/, '');

/** A stack's items ordered for the popup: by imagery date, newest first, so
 *  "what do I already have here?" reads as a timeline of the ground. Items
 *  with no imagery date fall to the end, ordered by when they were saved. */
export function stackOrder(items) {
  return [...(items ?? [])].sort((a, b) => {
    const left = imageryOf(a);
    const right = imageryOf(b);
    if (!left !== !right) return left ? -1 : 1; // dated imagery first
    if (left !== right) return right.localeCompare(left);
    return String(b.fetched_at ?? '').localeCompare(String(a.fetched_at ?? ''));
  });
}

/** A comparison's two pictures as a row writes them, an estimate keeping its `~`. */
export function pairLabel(row) {
  if (!row?.imagery_a && !row?.imagery_b) return '';
  return `${row.imagery_a ?? 'undated'} → ${row.imagery_b ?? 'undated'}`;
}

/** How many images were kept in the case from a comparison, or '' for none. */
export function keptLabel(row) {
  const count = row?.kept?.length ?? 0;
  return count ? `${count} image${count > 1 ? 's' : ''} kept` : '';
}
