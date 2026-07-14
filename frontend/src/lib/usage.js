/**
 * Keyed-provider usage bookkeeping (docs/KEYED_PROVIDERS.md §6).
 *
 * Billed providers (Mapbox, Google) get a per-month tile counter in
 * settings.json, maintained entirely by the backend: captures count the tiles
 * they stitch, and the live map's tiles flow through the backend proxy which
 * counts each one it serves. The frontend only reads the tally.
 */

/**
 * Documented monthly free allowances, in tile requests — a yardstick for the
 * counter, not a guarantee (providers change their pricing; verify on their
 * pricing pages). Mapbox Static Tiles: 200k/month, then pay-as-you-go per
 * extra 1,000 (billed to the card on the account). Google 2D Map Tiles:
 * 100k/month, then billed per extra 1,000 against the Cloud project —
 * a quota cap set in the Cloud Console makes it stop instead of bill.
 */
export const FREE_TIER = { mapbox: 200_000, google: 100_000 };

/** The usage bucket for a moment in time: "YYYY-MM" (UTC, matches backend). */
export function monthKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** This month's tally for a meter out of the settings `usage` map. */
export function monthCount(usage, meter, month = monthKey()) {
  return Number(usage?.[meter]?.[month] ?? 0);
}

/** Compact readout for the map pill: "767 tiles". */
export function tilesShort(count) {
  return `${count.toLocaleString('en-US')} tile${count === 1 ? '' : 's'}`;
}

/** Settings readout against the free allowance: "767 / 200,000 free tiles". */
export function tilesOfFree(count, meter) {
  const free = FREE_TIER[meter];
  if (!free) return tilesShort(count);
  return `${count.toLocaleString('en-US')} / ${free.toLocaleString('en-US')} free tiles`;
}

/** Share of the free allowance used this month, 0–1 (can exceed 1). */
export function freeTierShare(count, meter) {
  const free = FREE_TIER[meter];
  return free ? count / free : 0;
}
