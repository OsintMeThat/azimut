import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTurnWarmer,
  headingOrder,
  isTerrainTemplate,
  orbitCentre,
  proxiedProvider,
  turnTiles,
  WARM_DELAY,
  WARM_MAX_TILES,
  warmRequest,
} from './warmTurn.js';

/** A camera the way the engine keeps one: cloned, then turned. */
function transform(bearing = 0) {
  return {
    bearing,
    clone() {
      return transform(this.bearing);
    },
    setBearing(next) {
      this.bearing = next;
    },
  };
}

/**
 * An engine whose covering depends only on the heading: facing `b` it covers
 * one tile `[14, b, 100]` (b folded to 0–359) and one shared far tile.
 */
function stubMap({ pitch = 60, terrain = true, imageryTemplate = '/api/tiles/esri-world-imagery/{z}/{x}/{y}' } = {}) {
  const listeners = new Map();
  const asked = [];
  const sources = {
    'basemap-imagery': { tiles: [imageryTemplate], tileSize: 256, minzoom: 0, maxzoom: 19, roundZoom: false },
    'relief-dem': { tiles: ['/api/terrain/tiles/{z}/{x}/{y}'], tileSize: 512, minzoom: 0, maxzoom: 12 },
  };
  const map = {
    _camera: { transform: transform(10) },
    terrain: terrain ? { id: 'terrain' } : null,
    getTerrain: () => (terrain ? { source: 'relief-dem' } : null),
    getPitch: () => pitch,
    getSource: (id) => sources[id],
    coveringTiles(options) {
      const facing = ((Math.round(this._camera.transform.bearing) % 360) + 360) % 360;
      asked.push({ facing, tileSize: options.tileSize });
      return [
        { canonical: { z: 14, x: facing, y: 100 } },
        { canonical: { z: 10, x: 7, y: 7 } },
      ];
    },
    on: (name, handler) => listeners.set(name, handler),
    off: (name, handler) => listeners.get(name) === handler && listeners.delete(name),
    fire: (name) => listeners.get(name)?.(),
    listeners,
    asked,
  };
  return map;
}

const SOURCES = { imagery: 'basemap-imagery', relief: 'relief-dem' };

describe('reading a turn ahead', () => {
  it('reads only the app proxy and its relief, never a billed or direct address', () => {
    expect(proxiedProvider('/api/tiles/esri-world-imagery/{z}/{x}/{y}')).toBe('esri-world-imagery');
    expect(proxiedProvider('/api/tiles/wayback%3A123/{z}/{x}/{y}')).toBe('wayback:123');
    expect(proxiedProvider('azimut-billed://m1/mapbox-satellite/{z}/{x}/{y}')).toBeNull();
    expect(proxiedProvider('https://a.tile.example/{z}/{x}/{y}.png')).toBeNull();
    expect(proxiedProvider(undefined)).toBeNull();
    expect(isTerrainTemplate('/api/terrain/tiles/{z}/{x}/{y}')).toBe(true);
    // …and as the batches a tilted map asks in (tileBatch.js)
    expect(proxiedProvider('azimut-tiles://m1/imagery/esri-world-imagery/{z}/{x}/{y}')).toBe('esri-world-imagery');
    expect(isTerrainTemplate('azimut-tiles://m1/terrain/{z}/{x}/{y}')).toBe(true);
    expect(isTerrainTemplate('azimut-tiles://m1/imagery/esri-world-imagery/{z}/{x}/{y}')).toBe(false);
    expect(isTerrainTemplate('/api/tiles/esri-world-imagery/{z}/{x}/{y}')).toBe(false);
  });

  it('turns to the nearest headings first, alternating sides', () => {
    expect(headingOrder(8)).toEqual([1, -1, 2, -2, 3, -3, 4]);
    expect(headingOrder(2)).toEqual([1]);
  });

  it('asks the engine at every heading, leaving out what the view on screen covers', () => {
    const map = stubMap();
    const tiles = turnTiles(map, 'basemap-imagery');
    // eight headings 45° apart from 10°: the screen's own first, then outward
    expect(map.asked.map((a) => a.facing)).toEqual([10, 55, 325, 100, 280, 145, 235, 190]);
    // the far tile every heading shares is on screen already: never listed
    expect(tiles).toEqual([
      [14, 55, 100], [14, 325, 100], [14, 100, 100], [14, 280, 100],
      [14, 145, 100], [14, 235, 100], [14, 190, 100],
    ]);
    // the map's own camera never moved
    expect(map._camera.transform.bearing).toBe(10);
  });

  it('covers the relief the way the engine does: twice the tile, parents too', () => {
    const map = stubMap();
    const tiles = turnTiles(map, 'relief-dem', { terrain: true, headings: 2 });
    expect(map.asked.every((a) => a.tileSize === 1024)).toBe(true);
    expect(tiles).toEqual([[14, 190, 100], [13, 95, 50]]);
  });

  it('gives nothing when the engine cannot be asked', () => {
    expect(turnTiles({ getSource: () => ({}) }, 'basemap-imagery')).toEqual([]);
    expect(turnTiles(stubMap(), 'missing')).toEqual([]);
  });

  it('reads nothing ahead on a flat or barely tilted map, or without relief', () => {
    expect(warmRequest(stubMap({ pitch: 0 }), SOURCES)).toBeNull();
    expect(warmRequest(stubMap({ pitch: 20 }), SOURCES)).toBeNull();
    expect(warmRequest(stubMap({ terrain: false }), SOURCES)).toBeNull();
  });

  it('lists free imagery and the relief, and the relief alone under billed imagery', () => {
    const free = warmRequest(stubMap(), SOURCES);
    expect(free.provider).toBe('esri-world-imagery');
    expect(free.tiles.length).toBe(7);
    expect(free.terrain.length).toBeGreaterThan(0);
    const billed = warmRequest(
      stubMap({ imageryTemplate: 'azimut-billed://m1/mapbox-satellite/{z}/{x}/{y}' }),
      SOURCES
    );
    expect(billed.provider).toBeNull();
    expect(billed.tiles).toEqual([]);
    expect(billed.terrain.length).toBeGreaterThan(0);
    expect(WARM_MAX_TILES).toBe(1200);
  });
});

describe('the orbit about the grabbed ground', () => {
  class LngLat {
    constructor(lng, lat) {
      this.lng = lng;
      this.lat = lat;
    }
  }

  it('swings the centre round the pivot, keeping its distance', () => {
    const pivot = { lng: 44, lat: 16 };
    // the centre 1 km north of the pivot: the camera faces north
    const centre = { lng: 44, lat: 16 + 1000 / 111320 };
    const same = orbitCentre(centre, pivot, 0);
    expect(same.lat).toBeCloseTo(centre.lat, 9);
    expect(same.lng).toBeCloseTo(centre.lng, 9);
    const east = orbitCentre(centre, pivot, 90);
    expect(east.lat).toBeCloseTo(16, 9);
    expect((east.lng - 44) * 111320 * Math.cos((16 * Math.PI) / 180)).toBeCloseTo(1000, 3);
    const back = orbitCentre(centre, pivot, 180);
    expect((back.lat - 16) * 111320).toBeCloseTo(-1000, 3);
  });

  it('reads a second turn about the near ground, with the centre swung round it', () => {
    const centres = [];
    const camera = (bearing, center) => ({
      bearing,
      center,
      clone() {
        return camera(this.bearing, this.center);
      },
      setBearing(next) {
        this.bearing = next;
      },
      setCenter(next) {
        this.center = next;
      },
    });
    const map = {
      _camera: { transform: camera(0, new LngLat(44, 16.01)) },
      getSource: () => ({ tileSize: 256, minzoom: 0, maxzoom: 19 }),
      getContainer: () => ({ clientWidth: 1000, clientHeight: 800 }),
      unproject: ([x, y]) => (x === 500 && y === 640 ? new LngLat(44, 16) : null),
      coveringTiles() {
        const { bearing, center } = this._camera.transform;
        centres.push({ bearing: ((bearing % 360) + 360) % 360, lat: +center.lat.toFixed(4) });
        return [{ canonical: { z: 14, x: centres.length, y: 1 } }];
      },
    };
    const tiles = turnTiles(map, 'basemap-imagery', { headings: 4 });
    // on screen, then each heading about the centre and about the pivot
    expect(centres.map((c) => c.bearing)).toEqual([0, 90, 90, 270, 270, 180, 180]);
    // a turn about the pivot to 180° puts the centre as far south of it as it was north
    expect(centres.at(-1).lat).toBeCloseTo(15.99, 3);
    expect(centres.at(-2).lat).toBeCloseTo(16.01, 3);
    expect(tiles.length).toBe(6);
  });
});

describe('the warmer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends once the view has rested, and not twice for the same view', async () => {
    const map = stubMap();
    const send = vi.fn(() => Promise.resolve());
    const warmer = createTurnWarmer(map, SOURCES, send);
    map.fire('moveend');
    vi.advanceTimersByTime(WARM_DELAY - 1);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].provider).toBe('esri-world-imagery');
    map.fire('moveend');
    vi.advanceTimersByTime(WARM_DELAY);
    expect(send).toHaveBeenCalledTimes(1);
    // turned: a new list
    map._camera.transform.bearing = 40;
    map.fire('moveend');
    vi.advanceTimersByTime(WARM_DELAY);
    expect(send).toHaveBeenCalledTimes(2);
    warmer.dispose();
    expect(map.listeners.size).toBe(0);
  });

  it('holds while the map moves again before the rest is long enough', () => {
    const map = stubMap();
    const send = vi.fn(() => Promise.resolve());
    createTurnWarmer(map, SOURCES, send);
    map.fire('moveend');
    vi.advanceTimersByTime(WARM_DELAY / 2);
    map.fire('movestart');
    vi.advanceTimersByTime(WARM_DELAY * 2);
    expect(send).not.toHaveBeenCalled();
  });

  it('tries the same view again after a failed send', async () => {
    const map = stubMap();
    const send = vi.fn(() => Promise.reject(new Error('offline')));
    createTurnWarmer(map, SOURCES, send);
    map.fire('moveend');
    vi.advanceTimersByTime(WARM_DELAY);
    await Promise.resolve();
    await Promise.resolve();
    map.fire('moveend');
    vi.advanceTimersByTime(WARM_DELAY);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
