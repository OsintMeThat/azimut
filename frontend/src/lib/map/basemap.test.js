// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { rasterSource, sourceMaxZoom, tileTemplate, tileUrls } from './basemap.js';

/**
 * The provider shapes are the ones `/api/satellite/providers` really answers
 * with (api/satellite.py) — trimmed to the fields the layer reads.
 */
const ESRI = {
  id: 'esri-world-imagery',
  url: 'https://services.arcgisonline.com/.../tile/{z}/{y}/{x}',
  attribution: 'Imagery © Esri',
  max_zoom: 19,
  max_native_zoom: null,
  tile_size: 256,
  meter: null,
};
const CUSTOM_XYZ = {
  id: 'custom-1',
  url: 'https://{s}.tiles.example.org/{z}/{x}/{y}.png',
  attribution: 'Someone',
  max_zoom: 18,
  max_native_zoom: null,
  tile_size: 256,
  meter: null,
};
const SENTINEL = {
  id: 'sentinel2',
  url: 'https://sh.dataspace.copernicus.eu/ogc/wmts/{key}?...',
  attribution: '© Copernicus Sentinel data',
  max_zoom: 18,
  max_native_zoom: 14,
  tile_size: 512,
  meter: 'sentinelhub',
};
const GOOGLE_TILES = {
  id: 'google-satellite',
  url: 'https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}',
  attribution: 'Map data © Google',
  max_zoom: 22,
  max_native_zoom: null,
  tile_size: 1024,
  meter: 'google',
};
const WIDGET = {
  ...GOOGLE_TILES,
  id: 'google-js',
  widget: 'google-maps-js',
  max_zoom: 21,
  meter: 'google_js',
};

describe('where a provider’s tiles are fetched from', () => {
  it('sends every provider it can through the backend proxy', () => {
    // keys and session tokens stay server-side, and a billed tile is counted
    // exactly once — the proxy is the only place that can do either
    expect(tileTemplate(ESRI, 'esri-world-imagery')).toBe(
      '/api/tiles/esri-world-imagery/{z}/{x}/{y}'
    );
  });

  it('asks for the variant it is showing, not the bare provider', () => {
    // Sentinel-2's layer, window and ceiling ride on the id, so a tile cannot
    // be rendered from one window and filed as another
    expect(tileTemplate(SENTINEL, 'sentinel2~SWIR~2026-05-01~2026-05-01~CC20')).toBe(
      '/api/tiles/sentinel2~SWIR~2026-05-01~2026-05-01~CC20/{z}/{x}/{y}'
    );
  });

  it('leaves a subdomain template direct, because the proxy cannot expand it', () => {
    expect(tileTemplate(CUSTOM_XYZ, 'custom-1')).toBe(CUSTOM_XYZ.url);
  });

  it('expands a subdomain template itself, since the engine takes a list', () => {
    expect(tileUrls(CUSTOM_XYZ.url, undefined)).toEqual([
      'https://a.tiles.example.org/{z}/{x}/{y}.png',
      'https://b.tiles.example.org/{z}/{x}/{y}.png',
      'https://c.tiles.example.org/{z}/{x}/{y}.png',
    ]);
    expect(tileUrls(CUSTOM_XYZ.url, ['x', 'y'])).toEqual([
      'https://x.tiles.example.org/{z}/{x}/{y}.png',
      'https://y.tiles.example.org/{z}/{x}/{y}.png',
    ]);
  });

  it('leaves the proxy’s own template as itself', () => {
    expect(tileUrls('/api/tiles/esri/{z}/{x}/{y}')).toEqual(['/api/tiles/esri/{z}/{x}/{y}']);
  });
});

describe('the deepest tile a provider is asked for', () => {
  it('is its own ceiling, on a plain 256 px grid', () => {
    expect(sourceMaxZoom(ESRI, 256)).toBe(19);
  });

  it('stops at the last level with real pixels, not at the last useful view', () => {
    // Sentinel-2 stops at z14 and stays useful to z18; requesting z18 would buy
    // server-side upsampling of the same pixels, 16× the tiles, every one billed
    expect(sourceMaxZoom(SENTINEL, 512)).toBe(13);
  });

  it('shifts down a level for every doubling of the cell', () => {
    // a 512 px cell covers the ground of four 256 px tiles one zoom deeper, so
    // the URL zoom it asks for is one shallower — the same shift the old
    // engine's zoomOffset made
    expect(sourceMaxZoom(GOOGLE_TILES, 512)).toBe(21);
    // and the z17 detail boost, a 256 px cell for a 1024 px tile
    expect(sourceMaxZoom(GOOGLE_TILES, 256)).toBe(22);
  });
});

describe('the source one provider is served from', () => {
  it('is a raster grid of the cell size asked for, credited to the provider', () => {
    expect(rasterSource(ESRI, ESRI.id, 256)).toEqual({
      type: 'raster',
      tiles: ['/api/tiles/esri-world-imagery/{z}/{x}/{y}'],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 19,
      attribution: 'Imagery © Esri',
    });
  });

  it('never asks below zero, whatever the cell does to the numbering', () => {
    // a 512 px cell at world zoom would otherwise want a negative URL z
    expect(rasterSource(SENTINEL, 'sentinel2~a~~~CC100', 512).minzoom).toBe(0);
  });
});

describe('the layers on a map', () => {
  /** A MapLibre map, as far as basemap.js reaches into it. */
  function stubMap() {
    const sources = new Map();
    const layers = [];
    const calls = { setMaxZoom: [], on: [], off: [] };
    return {
      calls,
      sources,
      layers,
      addSource: (id, spec) => sources.set(id, spec),
      removeSource: (id) => sources.delete(id),
      getSource: (id) => sources.get(id),
      addLayer: (layer, beforeId) => {
        const at = beforeId ? layers.findIndex((l) => l.id === beforeId) : -1;
        if (at === -1) layers.push(layer);
        else layers.splice(at, 0, layer);
      },
      removeLayer: (id) => {
        const at = layers.findIndex((l) => l.id === id);
        if (at !== -1) layers.splice(at, 1);
      },
      getLayer: (id) => layers.find((l) => l.id === id),
      getLayersOrder: () => layers.map((l) => l.id),
      setMaxZoom: (...args) => calls.setMaxZoom.push(args),
      on: (...args) => calls.on.push(args),
      off: (...args) => calls.off.push(args),
    };
  }

  /** The façade, as far as basemap.js reaches into it. */
  function stubEngine(map = stubMap()) {
    return { impl: map, container: document.createElement('div') };
  }

  /**
   * The Google widget costs money to build, so `basemap.js` is exercised with
   * `gmaps.js` stubbed: what matters here is how many were ever made.
   */
  async function withStubbedGoogle(run, loader) {
    vi.resetModules();
    const glasses = [];
    vi.doMock('./gmaps.js', () => ({
      loadGoogleMaps: loader ?? vi.fn(async () => {}),
      createGoogleGlass: () => {
        const glass = { shown: 0, hidden: 0, destroyed: 0 };
        glass.show = () => (glass.shown += 1);
        glass.hide = () => (glass.hidden += 1);
        glass.destroy = () => (glass.destroyed += 1);
        glasses.push(glass);
        return glass;
      },
    }));
    const { createBasemaps } = await import('./basemap.js');
    try {
      await run({ createBasemaps, glasses });
    } finally {
      vi.doUnmock('./gmaps.js');
      vi.resetModules();
    }
  }

  it('takes the previous imagery off before putting the next one on', async () => {
    await withStubbedGoogle(async ({ createBasemaps }) => {
      const map = stubMap();
      const basemaps = createBasemaps(stubEngine(map));
      basemaps.show(ESRI, ESRI.id, 256);
      basemaps.show(SENTINEL, 'sentinel2~TRUE_COLOR~~~CC100', 512);
      expect(map.layers.map((l) => l.id)).toEqual(['basemap-imagery']);
      expect(map.sources.get('basemap-imagery').tiles[0]).toContain('sentinel2~TRUE_COLOR');
    });
  });

  it('caps the view at what the provider can serve', async () => {
    // capture sizing reads the view zoom against the provider maximum, and a
    // shallower provider asked past its ceiling answers with a placard
    await withStubbedGoogle(async ({ createBasemaps }) => {
      const map = stubMap();
      createBasemaps(stubEngine(map)).show({ ...ESRI, max_zoom: 17 }, 'opentopomap', 256);
      // the engine counts one level shallower than the app does
      expect(map.calls.setMaxZoom).toEqual([[16]]);
    });
  });

  it('leaves a layer alone when nothing about it changed', async () => {
    // returning to the tab refetches the providers, and the fresh objects re-run
    // the layer effect, so this is the common path rather than an edge case
    await withStubbedGoogle(async ({ createBasemaps }) => {
      const map = stubMap();
      const basemaps = createBasemaps(stubEngine(map));
      basemaps.show(ESRI, ESRI.id, 256);
      const first = map.sources.get('basemap-imagery');
      basemaps.show(ESRI, ESRI.id, 256);
      expect(map.sources.get('basemap-imagery')).toBe(first);
    });
  });

  it('rebuilds when the cell changes, because that is a different grid', async () => {
    // Google's oversample halves the cell at one zoom bracket
    await withStubbedGoogle(async ({ createBasemaps }) => {
      const map = stubMap();
      const basemaps = createBasemaps(stubEngine(map));
      basemaps.show(GOOGLE_TILES, GOOGLE_TILES.id, 512);
      basemaps.show(GOOGLE_TILES, GOOGLE_TILES.id, 256);
      expect(map.sources.get('basemap-imagery').tileSize).toBe(256);
    });
  });

  it('builds the Google widget once, however often it is shown', async () => {
    // every google.maps.Map instantiation is a billed dynamic map load
    await withStubbedGoogle(async ({ createBasemaps, glasses }) => {
      const onWidgetLoad = vi.fn();
      const basemaps = createBasemaps(stubEngine(), { onWidgetLoad });
      await basemaps.show(WIDGET, WIDGET.id, 256);
      basemaps.show(ESRI, ESRI.id, 256);
      await basemaps.show(WIDGET, WIDGET.id, 256);
      expect(glasses).toHaveLength(1);
      expect(onWidgetLoad).toHaveBeenCalledTimes(1);
    });
  });

  it('hides the widget rather than destroying it when the analyst moves on', async () => {
    await withStubbedGoogle(async ({ createBasemaps, glasses }) => {
      const basemaps = createBasemaps(stubEngine());
      await basemaps.show(WIDGET, WIDGET.id, 256);
      basemaps.show(ESRI, ESRI.id, 256);
      expect(glasses[0].hidden).toBe(1);
      expect(glasses[0].destroyed).toBe(0);
    });
  });

  it('takes the tiles off the map while the widget is showing', async () => {
    // the widget renders under a transparent canvas, so a tile layer left on
    // would sit between the analyst and Google's imagery
    await withStubbedGoogle(async ({ createBasemaps }) => {
      const map = stubMap();
      const basemaps = createBasemaps(stubEngine(map));
      basemaps.show(ESRI, ESRI.id, 256);
      await basemaps.show(WIDGET, WIDGET.id, 256);
      expect(map.getLayer('basemap-imagery')).toBeUndefined();
      expect(map.getSource('basemap-imagery')).toBeUndefined();
    });
  });

  it('reports a refused key instead of showing a dead basemap', async () => {
    const onWidgetFailed = vi.fn();
    await withStubbedGoogle(
      async ({ createBasemaps, glasses }) => {
        await createBasemaps(stubEngine(), { onWidgetFailed }).show(WIDGET, WIDGET.id, 256);
        expect(onWidgetFailed).toHaveBeenCalledWith(WIDGET, expect.any(Error));
        expect(glasses).toHaveLength(0); // nothing built, so nothing billed
      },
      vi.fn(async () => {
        throw new Error('could not load the Google Maps script');
      })
    );
  });

  it('drops a widget load the analyst has already moved on from', async () => {
    let release;
    await withStubbedGoogle(
      async ({ createBasemaps, glasses }) => {
        const basemaps = createBasemaps(stubEngine());
        const pending = basemaps.show(WIDGET, WIDGET.id, 256);
        basemaps.show(ESRI, ESRI.id, 256);
        release();
        await pending;
        expect(glasses).toHaveLength(0);
      },
      () => new Promise((resolve) => (release = resolve))
    );
  });

  it('keeps the pill honest for a billed layer, on arrival and once painted', async () => {
    await withStubbedGoogle(async ({ createBasemaps }) => {
      const map = stubMap();
      const onMeteredTiles = vi.fn();
      createBasemaps(stubEngine(map), { onMeteredTiles }).show(
        SENTINEL,
        'sentinel2~a~~~CC100',
        512
      );
      expect(onMeteredTiles).toHaveBeenCalledTimes(1);
      const painted = map.calls.on.find(([name]) => name === 'sourcedata')[1];
      painted({ sourceId: 'basemap-imagery', isSourceLoaded: true });
      expect(onMeteredTiles).toHaveBeenCalledTimes(2);
      // a tile still on its way says nothing yet
      painted({ sourceId: 'basemap-imagery', isSourceLoaded: false });
      expect(onMeteredTiles).toHaveBeenCalledTimes(2);
    });
  });

  it('says nothing about usage for a key-less layer', async () => {
    await withStubbedGoogle(async ({ createBasemaps }) => {
      const map = stubMap();
      const onMeteredTiles = vi.fn();
      createBasemaps(stubEngine(map), { onMeteredTiles }).show(ESRI, ESRI.id, 256);
      expect(onMeteredTiles).not.toHaveBeenCalled();
      const painted = map.calls.on.find(([name]) => name === 'sourcedata')[1];
      painted({ sourceId: 'basemap-imagery', isSourceLoaded: true });
      expect(onMeteredTiles).not.toHaveBeenCalled();
    });
  });

  it('stops the labels at their own last level rather than blowing them up', async () => {
    await withStubbedGoogle(async ({ createBasemaps }) => {
      const map = stubMap();
      createBasemaps(stubEngine(map)).setLabels(true);
      // the deepest tile, and the deepest view, which the engine counts one
      // shallower — the same number, two questions
      expect(map.sources.get('basemap-labels').maxzoom).toBe(20);
      expect(map.getLayer('basemap-labels').maxzoom).toBe(20);
      expect(map.sources.get('basemap-labels').tiles).toHaveLength(4);
    });
  });

  it('adds the labels layer once and takes it off when asked', async () => {
    await withStubbedGoogle(async ({ createBasemaps }) => {
      const map = stubMap();
      const basemaps = createBasemaps(stubEngine(map));
      basemaps.setLabels(true);
      basemaps.setLabels(true);
      expect(map.layers.map((l) => l.id)).toEqual(['basemap-labels']);
      basemaps.setLabels(false);
      expect(map.layers).toEqual([]);
    });
  });

  it('keeps the labels over the imagery and both under what a tool draws', async () => {
    await withStubbedGoogle(async ({ createBasemaps }) => {
      const map = stubMap();
      const basemaps = createBasemaps(stubEngine(map));
      basemaps.show(ESRI, ESRI.id, 256);
      basemaps.setLabels(true);
      // a tool's own layer, appended above both
      map.addLayer({ id: 'sfc-1-fill' });
      // and now a different provider, which must not land on top of either
      basemaps.show(SENTINEL, 'sentinel2~a~~~CC100', 512);
      expect(map.layers.map((l) => l.id)).toEqual([
        'basemap-imagery',
        'basemap-labels',
        'sfc-1-fill',
      ]);
    });
  });

  it('stops listening when the map goes, and lets the widget go with it', async () => {
    await withStubbedGoogle(async ({ createBasemaps, glasses }) => {
      const map = stubMap();
      const basemaps = createBasemaps(stubEngine(map));
      await basemaps.show(WIDGET, WIDGET.id, 256);
      basemaps.dispose();
      expect(map.calls.off).toEqual([['sourcedata', expect.any(Function)]]);
      expect(glasses[0].destroyed).toBe(1);
    });
  });
});
