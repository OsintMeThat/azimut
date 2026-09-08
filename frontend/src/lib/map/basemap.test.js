// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { tileLayerOptions, tileTemplate } from './basemap.js';

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
});

describe('the grid options one provider is shown with', () => {
  it('caps the view at what the provider can serve', () => {
    // a shallower provider asked past its ceiling answers with a placard, and
    // capture sizing relies on the view zoom being at or under that ceiling
    expect(tileLayerOptions(ESRI, 256)).toEqual({
      attribution: 'Imagery © Esri',
      maxZoom: 19,
    });
  });

  it('lets the view run deeper than the pixels, without asking for them', () => {
    // Sentinel-2 stops at z14 and stays useful to z18; requesting z18 would buy
    // server-side upsampling of the same pixels, 16× the tiles, every one billed
    const options = tileLayerOptions(SENTINEL, 512);
    expect(options.maxZoom).toBe(18);
    expect(options.maxNativeZoom).toBe(14);
  });

  it('offsets the URL zoom for a bigger tile, and never asks for a negative one', () => {
    expect(tileLayerOptions(SENTINEL, 512)).toMatchObject({
      tileSize: 512,
      zoomOffset: -1,
      minNativeZoom: 0,
    });
    // Google's 1024 px tiles, oversampled 2× into 512 px cells: one zoom deeper
    // on screen at a quarter of the request cost of plain 256 px tiles
    expect(tileLayerOptions(GOOGLE_TILES, 512)).toMatchObject({ tileSize: 512, zoomOffset: -1 });
    // and the z17 detail boost, 4× — a 256 px cell for a 1024 px tile
    expect(tileLayerOptions(GOOGLE_TILES, 256)).toMatchObject({ tileSize: 256, zoomOffset: -0 });
  });

  it('leaves a plain 256 provider without a grid override at all', () => {
    // an override here is not free: it re-numbers every tile request
    const options = tileLayerOptions(ESRI, 256);
    expect(options).not.toHaveProperty('tileSize');
    expect(options).not.toHaveProperty('zoomOffset');
    expect(options).not.toHaveProperty('minNativeZoom');
  });

  it('spends no billed tile on a zoom animation that is thrown away', () => {
    expect(tileLayerOptions(GOOGLE_TILES, 512)).toMatchObject({
      updateWhenZooming: false,
      keepBuffer: 4,
    });
    // …and never trades sharpness for nothing: updateWhenIdle would leave the
    // previous zoom blurred on screen and save no request
    expect(tileLayerOptions(GOOGLE_TILES, 512)).not.toHaveProperty('updateWhenIdle');
  });

  it('leaves a key-less provider on the engine’s own fetching', () => {
    const options = tileLayerOptions(ESRI, 256);
    expect(options).not.toHaveProperty('updateWhenZooming');
    expect(options).not.toHaveProperty('keepBuffer');
  });
});

describe('the layers on a map', () => {
  /** The façade, as far as basemap.js reaches into it. */
  function stubEngine(zoom = 16) {
    const container = document.createElement('div');
    const added = [];
    const events = {};
    return {
      container,
      added,
      events,
      zoom,
      leaflet: {},
      getZoom: () => zoom,
      setZoom: vi.fn((z) => (zoom = z)),
      on: (name, handler) => {
        events[name] = handler;
        return () => delete events[name];
      },
    };
  }

  /**
   * Leaflet's own layers are what basemap.js builds, so the module is exercised
   * with `L.tileLayer` stubbed: what matters here is which layer is on the map,
   * which was taken off, and what was never rebuilt.
   */
  async function withStubbedLeaflet(run) {
    vi.resetModules();
    const built = [];
    const layer = () => {
      const it = {
        added: 0,
        removed: 0,
        on: vi.fn(),
        addTo() {
          this.added += 1;
          return this;
        },
        remove() {
          this.removed += 1;
        },
      };
      built.push(it);
      return it;
    };
    vi.doMock('leaflet', () => ({ default: { tileLayer: () => layer() } }));
    const mutants = [];
    vi.doMock('./gmaps.js', () => ({
      loadGoogleMaps: vi.fn(async () => {}),
      createSatelliteMutant: () => {
        const it = layer();
        mutants.push(it);
        return it;
      },
    }));
    const { createBasemaps } = await import('./basemap.js');
    try {
      await run({ createBasemaps, built, mutants });
    } finally {
      vi.doUnmock('leaflet');
      vi.doUnmock('./gmaps.js');
      vi.resetModules();
    }
  }

  it('takes the previous imagery off before putting the next one on', async () => {
    await withStubbedLeaflet(async ({ createBasemaps, built }) => {
      const engine = stubEngine();
      const basemaps = createBasemaps(engine);
      basemaps.show(ESRI, ESRI.id, 256);
      basemaps.show(SENTINEL, 'sentinel2~TRUE_COLOR~~~CC100', 512);
      expect(built).toHaveLength(2);
      expect(built[0].removed).toBe(1);
      expect(built[1].added).toBe(1);
      expect(built[1].removed).toBe(0);
    });
  });

  it('pulls the view back to what a shallower provider can serve', async () => {
    await withStubbedLeaflet(async ({ createBasemaps }) => {
      const engine = stubEngine(20); // deeper than OpenTopoMap's z17
      createBasemaps(engine).show({ ...ESRI, max_zoom: 17 }, 'opentopomap', 256);
      expect(engine.setZoom).toHaveBeenCalledWith(17);
    });
  });

  it('leaves the view alone when the provider can serve it', async () => {
    await withStubbedLeaflet(async ({ createBasemaps }) => {
      const engine = stubEngine(16);
      createBasemaps(engine).show(ESRI, ESRI.id, 256);
      expect(engine.setZoom).not.toHaveBeenCalled();
    });
  });

  it('builds the Google widget once, however often it is shown', async () => {
    // every google.maps.Map instantiation is a billed dynamic map load
    await withStubbedLeaflet(async ({ createBasemaps, mutants }) => {
      const widget = { ...GOOGLE_TILES, id: 'google-js', widget: true, meter: 'googlejs' };
      const onWidgetLoad = vi.fn();
      const basemaps = createBasemaps(stubEngine(), { onWidgetLoad });
      await basemaps.show(widget, widget.id, 256);
      await basemaps.show(ESRI, ESRI.id, 256);
      await basemaps.show(widget, widget.id, 256);
      expect(mutants).toHaveLength(1);
      expect(onWidgetLoad).toHaveBeenCalledTimes(1);
    });
  });

  it('leaves the widget where it is rather than re-cloning its grid', async () => {
    // returning to the tab refetches the providers, so this is the common path
    await withStubbedLeaflet(async ({ createBasemaps, mutants }) => {
      const widget = { ...GOOGLE_TILES, id: 'google-js', widget: true, meter: 'googlejs' };
      const basemaps = createBasemaps(stubEngine());
      await basemaps.show(widget, widget.id, 256);
      await basemaps.show(widget, widget.id, 256);
      expect(mutants[0].added).toBe(1);
      expect(mutants[0].removed).toBe(0);
    });
  });

  it('reports a refused key instead of showing a dead basemap', async () => {
    vi.resetModules();
    const onWidgetFailed = vi.fn();
    vi.doMock('leaflet', () => ({ default: { tileLayer: () => ({ addTo: () => ({}), on() {} }) } }));
    vi.doMock('./gmaps.js', () => ({
      loadGoogleMaps: vi.fn(async () => {
        throw new Error('could not load the Google Maps script');
      }),
      createSatelliteMutant: vi.fn(),
    }));
    const { createBasemaps } = await import('./basemap.js');
    const widget = { ...GOOGLE_TILES, id: 'google-js', widget: true };
    await createBasemaps(stubEngine(), { onWidgetFailed }).show(widget, widget.id, 256);
    expect(onWidgetFailed).toHaveBeenCalledWith(widget, expect.any(Error));
    vi.doUnmock('leaflet');
    vi.doUnmock('./gmaps.js');
    vi.resetModules();
  });

  it('keeps the pill honest for a billed layer, on arrival and on paint', async () => {
    await withStubbedLeaflet(async ({ createBasemaps, built }) => {
      const onMeteredTiles = vi.fn();
      createBasemaps(stubEngine(), { onMeteredTiles }).show(SENTINEL, 'sentinel2~a~~~CC100', 512);
      expect(onMeteredTiles).toHaveBeenCalledTimes(1);
      const painted = built[0].on.mock.calls.find(([name]) => name === 'load')?.[1];
      painted();
      expect(onMeteredTiles).toHaveBeenCalledTimes(2);
    });
  });

  it('says nothing about usage for a key-less layer', async () => {
    await withStubbedLeaflet(async ({ createBasemaps }) => {
      const onMeteredTiles = vi.fn();
      createBasemaps(stubEngine(), { onMeteredTiles }).show(ESRI, ESRI.id, 256);
      expect(onMeteredTiles).not.toHaveBeenCalled();
    });
  });

  it('adds the labels layer once and takes it off when asked', async () => {
    await withStubbedLeaflet(async ({ createBasemaps, built }) => {
      const basemaps = createBasemaps(stubEngine());
      basemaps.setLabels(true);
      basemaps.setLabels(true);
      expect(built).toHaveLength(1);
      basemaps.setLabels(false);
      expect(built[0].removed).toBe(1);
    });
  });

  it('flattens the tiles after a reposition and un-flattens before a zoom', async () => {
    // the seam is a DOM grid's problem: an engine that paints its tiles into one
    // canvas has neither the seam nor these hooks
    await withStubbedLeaflet(async ({ createBasemaps }) => {
      const engine = stubEngine();
      const tile = document.createElement('div');
      tile.className = 'leaflet-tile';
      tile.style.transform = 'translate3d(128px, -64px, 0)';
      engine.container.appendChild(tile);
      createBasemaps(engine);

      const frames = [];
      vi.stubGlobal('requestAnimationFrame', (fn) => {
        frames.push(fn);
        return frames.length;
      });
      engine.events['view-settled']();
      frames.forEach((fn) => fn());
      expect(tile.style.transform).toBe('none');
      expect(tile.style.left).toBe('128px');
      expect(tile.style.top).toBe('-64px');

      engine.events['zoom-start']();
      expect(tile.style.transform).toBe('translate3d(128px, -64px, 0)');
      expect(tile.style.left).toBe('');
      vi.unstubAllGlobals();
    });
  });

  it('stops listening when the map goes', async () => {
    await withStubbedLeaflet(async ({ createBasemaps }) => {
      const engine = stubEngine();
      createBasemaps(engine).dispose();
      expect(Object.keys(engine.events)).toEqual([]);
    });
  });
});
