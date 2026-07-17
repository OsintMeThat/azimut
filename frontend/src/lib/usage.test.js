import { describe, it, expect } from 'vitest';
import {
  monthKey,
  monthCount,
  tilesShort,
  tilesOfFree,
  freeTierShare,
  freeTier,
  usageBlocked,
  displayProviderId,
  providerStatus,
  layerCell,
  FREE_TIER,
  BLOCK_SHARE,
  ECO_MAX_ZOOM,
  USAGE_LINKS,
} from './usage.js';

describe('monthKey', () => {
  it('formats a UTC year-month bucket', () => {
    expect(monthKey(new Date(Date.UTC(2026, 6, 14)))).toBe('2026-07');
    expect(monthKey(new Date(Date.UTC(2026, 11, 31)))).toBe('2026-12');
  });
});

describe('monthCount', () => {
  const usage = { google: { '2026-07': 1234 }, mapbox: { '2026-07': 87 } };

  it('reads the month bucket for a meter', () => {
    expect(monthCount(usage, 'google', '2026-07')).toBe(1234);
  });

  it('is zero for unknown meters or empty usage', () => {
    expect(monthCount(usage, 'bing', '2026-07')).toBe(0);
    expect(monthCount(undefined, 'google', '2026-07')).toBe(0);
    expect(monthCount(usage, 'google', '2026-01')).toBe(0);
  });
});

describe('tilesShort', () => {
  it('is a compact map-pill readout', () => {
    expect(tilesShort(767)).toBe('767 tiles');
    expect(tilesShort(12430)).toBe('12,430 tiles');
    expect(tilesShort(1)).toBe('1 tile');
  });

  it('the Maps JS meter counts map loads, not tiles', () => {
    expect(tilesShort(3, 'google_js')).toBe('3 map loads');
    expect(tilesShort(1, 'google_js')).toBe('1 map load');
  });

  it('the Sentinel Hub meter counts requests — a tile is one, so is a date lookup', () => {
    expect(tilesShort(767, 'sentinelhub')).toBe('767 requests');
    expect(tilesShort(1, 'sentinelhub')).toBe('1 request');
  });
});

describe('tilesOfFree', () => {
  it('shows the count against the documented free allowance', () => {
    expect(tilesOfFree(767, 'mapbox')).toBe('767 / 200,000 free tiles');
    expect(tilesOfFree(12430, 'google')).toBe('12,430 / 100,000 free tiles');
    expect(tilesOfFree(42, 'google_js')).toBe('42 / 10,000 free map loads');
  });

  it('falls back to the plain count for meters without a known allowance', () => {
    expect(tilesOfFree(42, 'bing')).toBe('42 tiles');
  });
});

describe('freeTierShare', () => {
  it('is the fraction of the free allowance used', () => {
    expect(freeTierShare(100_000, 'mapbox')).toBe(0.5);
    expect(freeTierShare(150_000, 'google')).toBe(1.5); // over — UI can warn
    expect(freeTierShare(500, 'unknown')).toBe(0);
  });

  it('free tiers stay in sync with the label helper', () => {
    expect(FREE_TIER.mapbox).toBe(200_000);
    expect(FREE_TIER.google).toBe(100_000);
    // Copernicus documents 10k but provisions 30k to a General account
    // (observed 2026-07) — the default follows the account, not the doc
    expect(FREE_TIER.sentinelhub).toBe(30_000);
  });
});

describe("the account's own free tier", () => {
  // a free tier belongs to the account: providers grant more than they document
  // and change it silently, so the served figure always wins over our default
  const served = { sentinelhub: 50_000 };

  it('resolves to the served figure, falling back to the default', () => {
    expect(freeTier('sentinelhub', served)).toBe(50_000);
    expect(freeTier('mapbox', served)).toBe(200_000); // not overridden
    expect(freeTier('sentinelhub', null)).toBe(30_000);
    expect(freeTier('bing', served)).toBe(undefined);
  });

  it('moves the readout, the gauge and the block together', () => {
    expect(tilesOfFree(100, 'sentinelhub', served)).toBe('100 / 50,000 free requests');
    expect(freeTierShare(25_000, 'sentinelhub', served)).toBe(0.5);
    // 28k is past 90% of the shipped 30k default but nowhere near 90% of the
    // 50k this account really has: the correction is what keeps the block from
    // pausing a provider that is still well inside its allowance
    expect(usageBlocked(28_000, 'sentinelhub', {}, served)).toBe(false);
    expect(usageBlocked(28_000, 'sentinelhub', {}, null)).toBe(true);
    expect(usageBlocked(45_000, 'sentinelhub', {}, served)).toBe(true);
  });
});

describe('usageBlocked', () => {
  it('pauses a meter at the block share of its free tier', () => {
    expect(usageBlocked(FREE_TIER.google * BLOCK_SHARE, 'google')).toBe(true);
    expect(usageBlocked(FREE_TIER.google * BLOCK_SHARE - 1, 'google')).toBe(false);
  });

  it('the per-provider override lifts the pause', () => {
    expect(usageBlocked(FREE_TIER.mapbox, 'mapbox', { mapbox: true })).toBe(false);
    expect(usageBlocked(FREE_TIER.mapbox, 'mapbox', { google: true })).toBe(true);
  });

  it('unmetered providers never block', () => {
    expect(usageBlocked(10_000_000, 'bing')).toBe(false);
  });
});

describe('displayProviderId', () => {
  const google = { id: 'google-satellite', meter: 'google' };
  const esri = { id: 'esri-world-imagery', meter: null };

  it('keeps free providers as-is at any zoom', () => {
    expect(displayProviderId(esri, 3)).toBe('esri-world-imagery');
    expect(displayProviderId(esri, 19)).toBe('esri-world-imagery');
  });

  it('eco mode swaps billed basemaps for free imagery when zoomed out', () => {
    expect(displayProviderId(google, ECO_MAX_ZOOM)).toBe('esri-world-imagery');
    expect(displayProviderId(google, ECO_MAX_ZOOM + 1)).toBe('google-satellite');
    expect(displayProviderId(google, ECO_MAX_ZOOM, { eco: false })).toBe('google-satellite');
  });

  it('the eco threshold is configurable (default z15)', () => {
    expect(ECO_MAX_ZOOM).toBe(15);
    expect(displayProviderId(google, 17, { ecoMaxZoom: 17 })).toBe('esri-world-imagery');
    expect(displayProviderId(google, 15, { ecoMaxZoom: 12 })).toBe('google-satellite');
  });

  it('the Maps JS widget never eco-swaps (a swap re-bills a map load)', () => {
    const widget = { id: 'google-js', meter: 'google_js', widget: 'google-maps-js', eco_max_zoom: 0 };
    expect(displayProviderId(widget, 3)).toBe('google-js');
    expect(displayProviderId(widget, 15, { ecoMaxZoom: 21 })).toBe('google-js');
    // the soft block still protects the quota, eco or not
    expect(displayProviderId(widget, 18, { blocked: true })).toBe('esri-world-imagery');
  });

  it("a provider's own eco threshold wins over the global one", () => {
    // Sentinel-2 caps at z14, so the global z15 would hide it at every zoom it
    // can serve; its own z11 keeps the useful z12-14 band alive.
    const s2 = { id: 'sentinel2', meter: 'sentinelhub', eco_max_zoom: 11 };
    expect(displayProviderId(s2, 11)).toBe('esri-world-imagery');
    expect(displayProviderId(s2, 12)).toBe('sentinel2');
    expect(displayProviderId(s2, 14)).toBe('sentinel2');
    // the user's global setting doesn't drag it back under
    expect(displayProviderId(s2, 14, { ecoMaxZoom: 15 })).toBe('sentinel2');
    // and eco off still means off
    expect(displayProviderId(s2, 3, { eco: false })).toBe('sentinel2');
  });

  it('a paused meter always falls back, even zoomed in', () => {
    expect(displayProviderId(google, 19, { blocked: true })).toBe('esri-world-imagery');
  });

  it('handles the pre-load undefined provider', () => {
    expect(displayProviderId(undefined, 10)).toBe(undefined);
  });
});

describe('layerCell', () => {
  const google = { id: 'google-satellite', tile_size: 1024, oversample: 2 };
  const mapbox = { id: 'mapbox-satellite', tile_size: 512, oversample: 1 };
  const esri = { id: 'esri-world-imagery', tile_size: 256, oversample: 1 };

  it('shrinks the cell by the display oversample', () => {
    expect(layerCell(google, 16)).toBe(512); // 1024px tile shown 2× down = z+1 detail
    expect(layerCell(mapbox, 16)).toBe(512); // no oversample — native cell
    expect(layerCell(esri, 16)).toBe(256);
  });

  it('boosts only the z17 bracket for oversampled providers (soft z18 mosaic)', () => {
    expect(layerCell(google, 17)).toBe(256); // z19 detail for the z17 view
    expect(layerCell(google, 18)).toBe(512); // back to the cheap 2×
    expect(layerCell(mapbox, 17)).toBe(512); // non-oversampled providers unaffected
  });

  it('never goes below the 256px minimum cell', () => {
    expect(layerCell({ tile_size: 256, oversample: 2 }, 17)).toBe(256);
  });
});

describe('providerStatus', () => {
  const ok = { ok: true };
  const bad = { ok: false, detail: 'HTTP 403' };

  it('an unconfigured provider is idle, whatever else is true of it', () => {
    expect(providerStatus({ meter: 'mapbox' })).toEqual({ tone: 'idle', label: 'Not set' });
    // a stale verdict from a key that has since been cleared can't shout
    expect(providerStatus({ key: '  ', meter: 'mapbox', status: bad }).label).toBe('Not set');
  });

  it('reports a working key, and an untested one as untested', () => {
    expect(providerStatus({ key: 'pk.x', meter: 'mapbox', status: ok })).toEqual({
      tone: 'ok',
      label: 'Key works',
    });
    expect(providerStatus({ key: 'pk.x', meter: 'mapbox' })).toEqual({
      tone: 'idle',
      label: 'Untested',
    });
  });

  it('a failed key outranks every other state — it is why the basemap is benched', () => {
    expect(providerStatus({ key: 'pk.x', meter: 'mapbox', status: bad })).toEqual({
      tone: 'bad',
      label: 'Key failed',
    });
    // even switched off, and even at a quota that would otherwise pause it
    expect(providerStatus({ key: 'pk.x', meter: 'mapbox', status: bad, enabled: false }).label).toBe(
      'Key failed'
    );
    expect(
      providerStatus({ key: 'pk.x', meter: 'mapbox', status: bad, count: 199_000 }).label
    ).toBe('Key failed');
  });

  it('a disabled provider reads as off rather than as a quota state', () => {
    expect(
      providerStatus({ key: 'pk.x', meter: 'mapbox', status: ok, enabled: false, count: 199_000 })
    ).toEqual({ tone: 'idle', label: 'Off' });
  });

  it('separates the pause from a deliberate overrun', () => {
    const at90 = { key: 'pk.x', meter: 'mapbox', status: ok, count: 180_000 };
    expect(providerStatus(at90)).toEqual({ tone: 'bad', label: 'Paused' });
    expect(providerStatus({ ...at90, overrides: { mapbox: true } })).toEqual({
      tone: 'warn',
      label: 'Billing',
    });
  });

  it("measures against this account's corrected allowance, not the default", () => {
    const half = { key: 'x', meter: 'sentinelhub', status: ok, count: 9_500 };
    expect(providerStatus(half).label).toBe('Key works'); // 9.5k of the 30k default
    // the account Copernicus only documents 10k for: the same count is a pause
    expect(providerStatus({ ...half, tiers: { sentinelhub: 10_000 } }).label).toBe('Paused');
  });
});

describe('USAGE_LINKS', () => {
  it('points each billed meter at its provider dashboard', () => {
    expect(Object.keys(USAGE_LINKS).sort()).toEqual(Object.keys(FREE_TIER).sort());
    for (const url of Object.values(USAGE_LINKS)) expect(url).toMatch(/^https:\/\//);
  });
});
