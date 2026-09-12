// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createImageryState } from './imagery.svelte.js';
import { FREE_TIER } from '../../../lib/usage.js';
import { SENTINEL_ID } from '../../../lib/sentinel.js';

/**
 * The catalogue, and the gap between the basemap chosen and the basemap shown.
 *
 * The arithmetic has its own tests (lib/usage.js); what is asserted here is
 * that one surface's zoom and one month's tally decide what its tiles, its
 * capture and its provenance all name.
 */

const ESRI = { id: 'esri-world-imagery', label: 'Esri', imagery: true };
const MAPBOX = { id: 'mapbox-satellite', label: 'Mapbox', imagery: true, meter: 'mapbox' };
const SENTINEL = { id: SENTINEL_ID, label: 'Sentinel-2', imagery: true, meter: 'sentinelhub' };

let api;
let settings;

function store() {
  return createImageryState({ api });
}

/** A catalogue read and a month's tally in, ready to be asked about. */
async function loaded() {
  const imagery = store();
  await imagery.loadProviders();
  await imagery.refreshUsage();
  return imagery;
}

beforeEach(() => {
  settings = {
    usage: {},
    month: '2026-09',
    usage_overrides: {},
    eco_zoom_fallback: true,
    eco_max_zoom: 15,
    free_tier: null,
  };
  api = {
    get: vi.fn(async (path) => {
      if (path === '/api/satellite/providers') return [ESRI, MAPBOX, SENTINEL];
      return settings;
    }),
    post: vi.fn(async () => ({})),
  };
});

describe('the catalogue', () => {
  it('is read from the backend, not assumed', async () => {
    const imagery = await loaded();
    expect(imagery.providers).toHaveLength(3);
    expect(imagery.find('mapbox-satellite')).toEqual(MAPBOX);
  });

  it('has nothing to say about a basemap Settings has disabled', async () => {
    const imagery = await loaded();
    expect(imagery.find('nope')).toBe(undefined);
  });
});

describe('the month’s tally', () => {
  it('is a readout, and a failed read never stops the map', async () => {
    api.get = vi.fn(async (path) => {
      if (path === '/api/satellite/providers') return [ESRI, MAPBOX];
      throw new Error('offline');
    });
    const imagery = store();
    await imagery.loadProviders();
    await expect(imagery.refreshUsage()).resolves.toBeUndefined();
    expect(imagery.displayed('mapbox-satellite', 18).id).toBe('mapbox-satellite');
  });

  it('names the count for a billed provider and nothing for a free one', async () => {
    settings.usage = { mapbox: { '2026-09': 1234 } };
    const imagery = await loaded();
    expect(imagery.pill(MAPBOX)).toBe('1,234 tiles');
    expect(imagery.pill(ESRI)).toBe(null);
  });

  it('takes the account’s own allowance over the documented one', async () => {
    settings.usage = { mapbox: { '2026-09': FREE_TIER.mapbox * 0.95 } };
    const imagery = await loaded();
    expect(imagery.blocked(MAPBOX)).toBe(true);

    settings.free_tier = { mapbox: FREE_TIER.mapbox * 4 };
    await imagery.refreshUsage();
    expect(imagery.blocked(MAPBOX)).toBe(false);
  });
});

describe('a billed map load nobody else can see', () => {
  // Tiles are counted by the proxy that serves them. A widget basemap is built
  // by the provider's own script inside the page, so this is the only place
  // that knows it happened — silence here is an allowance spending itself with
  // the readout still saying zero.
  it('is counted where it happens, then the tally is re-read', async () => {
    const imagery = await loaded();
    api.get.mockClear();

    await imagery.countLoad('google_js');
    expect(api.post).toHaveBeenCalledWith('/api/satellite/usage/google_js');
    expect(api.get).toHaveBeenCalledWith('/api/settings');
  });

  it('still re-reads the tally when the count could not be posted', async () => {
    api.post = vi.fn(async () => {
      throw new Error('offline');
    });
    const imagery = await loaded();
    api.get.mockClear();

    await expect(imagery.countLoad('google_js')).resolves.not.toThrow();
    expect(api.get).toHaveBeenCalledWith('/api/settings');
  });

  it('shows the load in the readout it just re-read', async () => {
    const imagery = await loaded();
    expect(imagery.pill(MAPBOX)).toContain('0');

    settings = { ...settings, usage: { mapbox: { '2026-09': 12 } } };
    await imagery.countLoad('mapbox');
    expect(imagery.pill(MAPBOX)).toContain('12');
  });
});

describe('what a surface actually shows', () => {
  it('shows the chosen provider when nothing is in the way', async () => {
    const imagery = await loaded();
    const shown = imagery.displayed('mapbox-satellite', 18);
    expect(shown.id).toBe('mapbox-satellite');
    expect(shown.fallenBack).toBe(false);
  });

  it('steps a billed basemap aside once the month is nearly spent', async () => {
    settings.usage = { mapbox: { '2026-09': FREE_TIER.mapbox * 0.95 } };
    const imagery = await loaded();
    const shown = imagery.displayed('mapbox-satellite', 18);
    expect(shown.id).not.toBe('mapbox-satellite');
    expect(shown.blocked).toBe(true);
    expect(shown.fallenBack).toBe(true);
  });

  it('an override in Settings keeps it on the billed one', async () => {
    settings.usage = { mapbox: { '2026-09': FREE_TIER.mapbox * 0.95 } };
    settings.usage_overrides = { mapbox: true };
    const imagery = await loaded();
    expect(imagery.displayed('mapbox-satellite', 18).id).toBe('mapbox-satellite');
  });

  it('shows free imagery while zoomed out, and the billed one once you are in', async () => {
    const imagery = await loaded();
    expect(imagery.displayed('mapbox-satellite', 8).fallenBack).toBe(true);
    expect(imagery.displayed('mapbox-satellite', 18).fallenBack).toBe(false);
  });

  it('eco off keeps the billed basemap at every zoom', async () => {
    settings.eco_zoom_fallback = false;
    const imagery = await loaded();
    expect(imagery.displayed('mapbox-satellite', 8).id).toBe('mapbox-satellite');
  });

  it('never falls a free provider back — there is nothing to save', async () => {
    const imagery = await loaded();
    expect(imagery.displayed('esri-world-imagery', 3).fallenBack).toBe(false);
  });

  it('two surfaces at different zooms can show different providers', async () => {
    const imagery = await loaded();
    const wide = imagery.displayed('mapbox-satellite', 6);
    const close = imagery.displayed('mapbox-satellite', 19);
    expect(wide.id).not.toBe(close.id);
  });
});

describe('Sentinel-2’s choices ride on the id', () => {
  it('so a window cannot be rendered from one date and filed as another', async () => {
    const imagery = await loaded();
    const june = imagery.displayed(SENTINEL_ID, 16, {
      layer: 'TRUE_COLOR',
      from: '2026-06-01',
      to: '2026-06-01',
      maxcc: 100,
    });
    const july = imagery.displayed(SENTINEL_ID, 16, {
      layer: 'TRUE_COLOR',
      from: '2026-07-01',
      to: '2026-07-01',
      maxcc: 100,
    });
    expect(june.id).not.toBe(july.id);
    expect(june.id).toContain('2026-06-01');
  });

  it('a bare provider carries no variant', async () => {
    const imagery = await loaded();
    expect(imagery.displayed('esri-world-imagery', 16).id).toBe('esri-world-imagery');
  });
});

describe('the tile grid', () => {
  it('falls back to a plain cell when the chosen basemap is gone', async () => {
    const imagery = await loaded();
    expect(imagery.displayed('deleted-provider', 12).cell).toBe(256);
  });
});
