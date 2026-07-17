/**
 * Keyed-provider usage bookkeeping (docs/IMAGERY_PROVIDERS.md).
 *
 * Billed providers (Mapbox, Google) get a per-month tile counter in
 * settings.json, maintained entirely by the backend: captures count the tiles
 * they stitch, and the live map's tiles flow through the backend proxy which
 * counts each one it serves. The frontend only reads the tally.
 */

/**
 * Default monthly free allowances, in billed requests — a yardstick for the
 * counter, not a guarantee (providers change their pricing; verify on their
 * pricing pages — links below). Verified 2026-07: Mapbox Static Tiles
 * 200k/month then $0.50 per extra 1,000 (billed to the account's card);
 * Google 2D Map Tiles 100k/month then $0.60 per extra 1,000, plus hard
 * server-side limits of 15,000 tiles/day and 6,000/min per project — a quota
 * cap set in the Cloud Console makes it stop instead of bill.
 * Sentinel Hub bills processing units, not tiles, but our 512×512 3-band 8-bit
 * tiles are 1 PU each, so the tile counter *is* the PU counter: 30,000 PU and
 * 30,000 requests/month on a free Copernicus General account (also 300/min).
 * google_js counts *map loads* (Maps JS dynamic maps — one per widget
 * instantiation, pan/zoom free): 10k/month on the 2025 Essentials tier.
 *
 * These are defaults only. A free tier belongs to the *account*, and providers
 * hand out more than they document without saying so (Copernicus still
 * documents 10k while provisioning 30k), so every function here takes the live
 * `free_tier` map from /api/settings — the user's own correction included — and
 * falls back to these. Mirror of config.FREE_TIER (which enforces the block).
 */
export const FREE_TIER = { mapbox: 200_000, google: 100_000, google_js: 10_000, sentinelhub: 30_000 };

/** This account's allowance for a meter: the served figure, else the default. */
export function freeTier(meter, tiers = null) {
  return tiers?.[meter] ?? FREE_TIER[meter];
}

/** What one metered unit is, per meter — most bill tiles, the JS widget bills
 * whole map loads, and Sentinel Hub bills requests of any kind (a tile, but
 * also a date lookup). The wrong word would make the counter read as broken. */
export function meterUnit(meter) {
  if (meter === 'google_js') return 'map load';
  // Copernicus counts requests and PU against the same 30k allowance; a tile is
  // 1 of each, a WFS date query is 1 request and ~0.01 PU. "request" is the
  // word their own dashboard uses, and the only one true of both.
  if (meter === 'sentinelhub') return 'request';
  return 'tile';
}

/** Share of the free tier past which the backend pauses a provider. */
export const BLOCK_SHARE = 0.9;

/** Eco mode default: visual zoom at or below which free imagery replaces a
 * billed basemap. The live value is the user's `eco_max_zoom` setting. */
export const ECO_MAX_ZOOM = 15;

/** Where to watch the real counters and set caps, per provider. */
export const USAGE_LINKS = {
  mapbox: 'https://console.mapbox.com/account/statistics/',
  google: 'https://console.cloud.google.com/google/maps-apis/quotas',
  google_js: 'https://console.cloud.google.com/google/maps-apis/quotas',
  sentinelhub: 'https://shapps.dataspace.copernicus.eu/dashboard/#/account/usage',
};

/** True when a metered provider is paused: past the soft block, no override. */
export function usageBlocked(count, meter, overrides = {}, tiers = null) {
  const free = freeTier(meter, tiers);
  if (!free || overrides[meter]) return false;
  return count >= free * BLOCK_SHARE;
}

/**
 * The one-word verdict a collapsed provider card shows, so the whole Imagery
 * tab reads at a glance and only the card you open spends any text on itself.
 * Worst news first: a key that can't work is more urgent than a quota, and a
 * quota is more urgent than an untested key.
 */
export function providerStatus({
  key = '',
  enabled = true,
  status = null,
  count = 0,
  meter,
  overrides = {},
  tiers = null,
} = {}) {
  if (!key.trim()) return { tone: 'idle', label: 'Not set' };
  if (status && !status.ok) return { tone: 'bad', label: 'Key failed' };
  if (!enabled) return { tone: 'idle', label: 'Off' };
  if (usageBlocked(count, meter, overrides, tiers)) return { tone: 'bad', label: 'Paused' };
  // past the pause but explicitly overridden — the provider is billing now
  if (freeTierShare(count, meter, tiers) >= BLOCK_SHARE) return { tone: 'warn', label: 'Billing' };
  if (!status) return { tone: 'idle', label: 'Untested' };
  return { tone: 'ok', label: 'Key works' };
}

/**
 * CSS grid-cell size for a provider's live tile layer at a view zoom: the
 * tile edge shrunk by its display oversample. Oversampled providers (Google)
 * get one extra 2× boost for the z17 view only — the z18 mosaic it would
 * otherwise show is often an older/hazier collection than z19+ (the sharp
 * aerial; measured 2026-07), so that single bracket pays 4× for z19 detail
 * while every other zoom keeps the cheap 2×.
 */
export function layerCell(provider, zoom) {
  const boost = provider.oversample === 2 && zoom === 17 ? 2 : 1;
  return Math.max(256, provider.tile_size / ((provider.oversample || 1) * boost));
}

/**
 * The provider the live map should actually display. Billed basemaps step
 * aside for free imagery when paused (soft block) or zoomed out (eco mode —
 * paid detail only matters up close); captures follow the display, so
 * provenance stays honest.
 *
 * A provider's own `eco_max_zoom` wins over the user's global one, which is
 * tuned for basemaps that run to z22. Sentinel-2 stops at z14, so the global
 * z15 rule would swap it away at every zoom it can serve — it carries its own
 * shallower threshold instead. The soft block ignores all of this: it's a quota
 * guard, and a paused provider has nothing to show at any zoom.
 */
export function displayProviderId(
  provider,
  zoom,
  { eco = true, blocked = false, ecoMaxZoom = ECO_MAX_ZOOM } = {}
) {
  if (!provider?.meter) return provider?.id;
  if (blocked) return 'esri-world-imagery';
  const threshold = provider.eco_max_zoom ?? ecoMaxZoom;
  if (eco && zoom <= threshold) return 'esri-world-imagery';
  return provider.id;
}

/** The usage bucket for a moment in time: "YYYY-MM" (UTC, matches backend). */
export function monthKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** This month's tally for a meter out of the settings `usage` map. */
export function monthCount(usage, meter, month = monthKey()) {
  return Number(usage?.[meter]?.[month] ?? 0);
}

/** Compact readout for the map pill: "767 tiles" / "3 map loads". */
export function tilesShort(count, meter) {
  const unit = meterUnit(meter);
  return `${count.toLocaleString('en-US')} ${unit}${count === 1 ? '' : 's'}`;
}

/** Settings readout against the free allowance: "767 / 200,000 free tiles". */
export function tilesOfFree(count, meter, tiers = null) {
  const free = freeTier(meter, tiers);
  if (!free) return tilesShort(count, meter);
  return `${count.toLocaleString('en-US')} / ${free.toLocaleString('en-US')} free ${meterUnit(meter)}s`;
}

/** Share of the free allowance used this month, 0–1 (can exceed 1). */
export function freeTierShare(count, meter, tiers = null) {
  const free = freeTier(meter, tiers);
  return free ? count / free : 0;
}
