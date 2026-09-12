/**
 * The basemap catalogue, and what a billed one owes the meter.
 *
 * One store for the whole tool, not one per map: the catalogue is the same
 * everywhere, and a tile counted against the month is counted once however many
 * surfaces are drawing from it. What is *not* shared is which provider a
 * surface shows — that is the surface's own choice, handed to `displayed()`.
 *
 * `displayed()` is the whole point of the store. A chosen provider and a shown
 * provider are not the same thing: a billed basemap steps aside for free
 * imagery when the month's allowance is nearly spent (the 90% soft block) or
 * when the view is zoomed out far enough that its detail buys nothing (eco).
 * Captures, the imagery date and the disk cache all key on what is *shown*, so
 * provenance can never name a provider the pixels did not come from.
 *
 * For Sentinel-2 the layer, window and cloud ceiling ride on the id itself
 * (lib/sentinel.js) — so a tile rendered from one window cannot be filed as
 * another.
 *
 * The arithmetic is `lib/usage.js`; this holds the catalogue, the month's
 * tally, and the preferences Settings drives both fallbacks with.
 *
 * @param {object} deps
 * @param {object} deps.api the app's fetch wrapper
 */
import {
  FREE_IMAGERY,
  displayProviderId,
  layerCell,
  monthCount,
  tilesShort,
  usageBlocked,
} from '../../../lib/usage.js';
import { variantId } from '../../../lib/sentinel.js';

export const FALLBACK_PROVIDER = FREE_IMAGERY;

export function createImageryState({ api }) {
  let providers = $state([]);
  let totals = $state({});
  let month = $state('');
  // Mirrored from Settings: overrides lift the 90% soft block, eco swaps billed
  // basemaps for free imagery when zoomed out, and `tiers` is this account's
  // real allowance per meter — a provider's free tier is not ours to hardcode.
  let prefs = $state({ overrides: {}, eco: true, ecoMaxZoom: 15, tiers: null });

  return {
    get providers() {
      return providers;
    },
    get month() {
      return month;
    },
    get totals() {
      return totals;
    },
    get prefs() {
      return prefs;
    },

    /** One entry of the catalogue, or undefined once Settings disables it. */
    find(id) {
      return providers.find((provider) => provider.id === id);
    },

    /** Read the catalogue. Settings can disable a basemap, so this is re-read
     *  on returning to the tool, not only on mount. */
    async loadProviders() {
      providers = await api.get('/api/satellite/providers');
      return providers;
    },

    /** The month's tally and the two fallback preferences. A readout only: it
     *  must never be what stops the map drawing. */
    async refreshUsage() {
      try {
        const settings = await api.get('/api/settings');
        totals = settings.usage;
        month = settings.month;
        prefs = {
          overrides: settings.usage_overrides ?? {},
          eco: settings.eco_zoom_fallback !== false,
          ecoMaxZoom: settings.eco_max_zoom ?? 15,
          tiers: settings.free_tier ?? null,
        };
      } catch {
        /* readout only — never blocks the map */
      }
    },

    /**
     * Count one billed map load, then re-read the tally.
     *
     * Tiles are counted by the proxy that serves them, but a widget basemap is
     * built by the provider's own script inside the page — the backend never
     * sees it, so the one place that knows it happened has to say so. Silence
     * here is a month's allowance quietly spending itself with the readout
     * still saying zero.
     */
    async countLoad(meter) {
      try {
        await api.post(`/api/satellite/usage/${meter}`);
      } catch {
        /* the load happened either way — the tally re-reads below */
      }
      return this.refreshUsage();
    },

    /**
     * When the imagery under a point was taken, as far as the provider will
     * say. Esri answers; every other basemap reports `supported: false` and the
     * surface shows no date rather than guessing one.
     */
    imageryDate({ lat, lon, zoom }, providerId) {
      return api.get(
        `/api/satellite/imagery-date?lat=${lat}&lon=${lon}&zoom=${zoom}&provider=${providerId}`
      );
    },

    /** Whether this billed provider has spent enough of its month to step aside. */
    blocked(provider) {
      return provider?.meter
        ? usageBlocked(
            monthCount(totals, provider.meter, month),
            provider.meter,
            prefs.overrides,
            prefs.tiers
          )
        : false;
    },

    /** The small readout beside the basemap selector. Null for a free provider. */
    pill(provider) {
      return provider?.meter
        ? tilesShort(monthCount(totals, provider.meter, month), provider.meter)
        : null;
    },

    /**
     * What one surface actually shows, given its choice and its zoom.
     *
     * @param {string} chosenId the provider the surface's selector is on
     * @param {number} zoom that surface's view zoom
     * @param {object} [variant] Sentinel-2's layer/window/ceiling, if any
     */
    displayed(chosenId, zoom, variant) {
      const chosen = this.find(chosenId);
      const blocked = this.blocked(chosen);
      const baseId = displayProviderId(chosen, zoom, {
        eco: prefs.eco,
        blocked,
        ecoMaxZoom: prefs.ecoMaxZoom,
      });
      const provider = this.find(baseId);
      return {
        chosen,
        provider,
        // what every downstream consumer asks for: the tile URL, the capture,
        // the disk cache — never the bare provider id
        id: variantId(baseId, variant),
        // memoized by the caller so the layer is only rebuilt when the cell
        // actually changes, i.e. crossing the z17 boost bracket
        cell: provider ? layerCell(provider, zoom) : 256,
        blocked,
        /** True when the surface is not showing what its selector says. */
        fallenBack: !!chosen?.meter && baseId !== chosenId,
      };
    },
  };
}
