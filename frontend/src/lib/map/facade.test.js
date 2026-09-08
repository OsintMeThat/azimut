import { describe, expect, it, vi } from 'vitest';
import {
  MAP_EVENTS,
  engineEvents,
  mapFacade,
  normalizeBearing,
  pointsExtent,
} from './facade.js';

/**
 * A map the façade can be driven against without a browser. The point of
 * keeping `facade.js` clear of Leaflet is that everything crossing the
 * boundary — wrapping, extents, point shapes, the event vocabulary — is
 * arithmetic and translation, so it is tested here rather than in an e2e run.
 */
function stubMap(overrides = {}) {
  const calls = {
    setView: [],
    setZoom: [],
    setBearing: [],
    panBy: [],
    fitBounds: [],
    on: [],
    off: [],
    invalidateSize: [],
    removed: 0,
  };
  return {
    calls,
    getCenter: () => ({ lat: 48.8584, lng: 2.2945 }),
    getZoom: () => 14,
    getBearing: () => 37,
    getBounds: () => ({
      getNorth: () => 0,
      getSouth: () => -1,
      getWest: () => 0,
      getEast: () => 1,
    }),
    containerPointToLatLng: ([x, y]) => ({ lat: 40 + y, lng: 180 + x }),
    latLngToContainerPoint: ([lat, lon]) => ({ x: lon * 10, y: lat * 10, layerPoint: 'leaflet' }),
    setView: (...args) => calls.setView.push(args),
    setZoom: (...args) => calls.setZoom.push(args),
    setBearing: (...args) => calls.setBearing.push(args),
    panBy: (...args) => calls.panBy.push(args),
    fitBounds: (...args) => calls.fitBounds.push(args),
    on: (...args) => calls.on.push(args),
    off: (...args) => calls.off.push(args),
    invalidateSize: (...args) => calls.invalidateSize.push(args),
    remove: () => (calls.removed += 1),
    ...overrides,
  };
}

describe('the map façade keeps the engine on its own side', () => {
  it('folds the map centre back inside the bounds every route enforces', () => {
    // an engine keeps counting past ±180 across the date line; the capture
    // route bounds lon to ±180, so an unwrapped centre answered 422
    const map = stubMap({ getCenter: () => ({ lat: 12, lng: 190.5 }) });
    expect(mapFacade(map).camera()).toEqual({ lat: 12, lon: -169.5, zoom: 14, bearing: 37 });
  });

  it('leaves a longitude that is already one alone, to the last decimal', () => {
    // this value is written into captures and proofs
    expect(mapFacade(stubMap()).camera().lon).toBe(2.2945);
  });

  it('hands out plain points and positions, never the engine’s own', () => {
    const facade = mapFacade(stubMap());
    expect(facade.containerPointToLatLng({ x: 4, y: 2 })).toEqual({ lat: 42, lon: -176 });
    expect(facade.latLngToContainerPoint({ lat: 3, lon: 5 })).toEqual({ x: 50, y: 30 });
  });

  it('speaks extents, and lets the engine order its own corners', () => {
    const map = stubMap();
    mapFacade(map).fitBounds({ north: 4, south: 1, east: 8, west: 2 }, { padding: [10, 10] });
    expect(map.calls.fitBounds).toEqual([
      [
        [
          [1, 2],
          [4, 8],
        ],
        { padding: [10, 10] },
      ],
    ]);
  });

  it('normalises a bearing wherever it came from', () => {
    expect(normalizeBearing(-90)).toBe(270);
    expect(normalizeBearing(450)).toBe(90);
    expect(normalizeBearing(0)).toBe(0);
    // a saved row with no bearing, a half-typed angle
    expect(normalizeBearing(undefined)).toBe(0);
    expect(normalizeBearing('')).toBe(0);
  });

  it('normalises on the way in, so no call site has to', () => {
    const map = stubMap();
    mapFacade(map).setBearing(-45);
    expect(map.calls.setBearing).toEqual([[315]]);
  });

  it('never animates a pan: it re-pins a grabbed point mid-gesture', () => {
    const map = stubMap();
    mapFacade(map).panBy(3, -7);
    expect(map.calls.panBy).toEqual([[[3, -7], { animate: false }]]);
  });
});

describe('framing a set of points', () => {
  it('holds every point handed over', () => {
    expect(
      pointsExtent([
        { lat: 1, lon: 5 },
        { lat: -3, lon: 2 },
        { lat: 4, lon: 9 },
      ])
    ).toEqual({ north: 4, south: -3, east: 9, west: 2 });
  });

  it('ignores a row whose coordinates are not numbers', () => {
    // a sheet's coordinate column is text in a CSV until it is read
    expect(pointsExtent([{ lat: 1, lon: 2 }, { lat: null, lon: 3 }, {}])).toEqual({
      north: 1,
      south: 1,
      east: 2,
      west: 2,
    });
  });

  it('says there is nothing to frame rather than framing nothing', () => {
    expect(pointsExtent([])).toBeNull();
    expect(pointsExtent(undefined)).toBeNull();
    const map = stubMap();
    expect(mapFacade(map).fitPoints([{ lat: null, lon: null }])).toBe(false);
    // a layer that landed nowhere must leave the view where the analyst left it
    expect(map.calls.fitBounds).toEqual([]);
  });

  it('frames what did arrive, and says so', () => {
    const map = stubMap();
    expect(
      mapFacade(map).fitPoints([{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }], { maxZoom: 17 })
    ).toBe(true);
    expect(map.calls.fitBounds).toEqual([
      [
        [
          [1, 2],
          [3, 4],
        ],
        { maxZoom: 17 },
      ],
    ]);
  });
});

describe('the event vocabulary', () => {
  it('names what happened to the view, not what the engine calls it', () => {
    expect(MAP_EVENTS).toEqual(['view-settled', 'view-reset', 'zoom-start', 'rotate', 'click']);
    expect(engineEvents('view-settled')).toBe('moveend zoomend');
  });

  it('refuses a name it does not know', () => {
    // a typo that quietly stopped delivering would read as a dead map
    expect(() => engineEvents('moveend')).toThrow(/unknown map event/);
    expect(() => mapFacade(stubMap()).on('zoomend', () => {})).toThrow(/unknown map event/);
  });

  it('hands a camera event the camera', () => {
    const map = stubMap();
    const seen = vi.fn();
    mapFacade(map).on('view-settled', seen);
    const [, relay] = map.calls.on[0];
    relay();
    expect(seen).toHaveBeenCalledWith({ lat: 48.8584, lon: 2.2945, zoom: 14, bearing: 37 });
  });

  it('hands a click the point clicked, wrapped like any other', () => {
    const map = stubMap();
    const seen = vi.fn();
    mapFacade(map).on('click', seen);
    map.calls.on[0][1]({ latlng: { lat: 7, lng: 200 } });
    expect(seen).toHaveBeenCalledWith({ lat: 7, lon: -160 });
  });

  it('returns the unsubscribe, so nobody can hold half the pair', () => {
    const map = stubMap();
    const off = mapFacade(map).on('rotate', () => {});
    off();
    expect(map.calls.off).toEqual([map.calls.on[0]]);
  });
});

describe('spans and teardown', () => {
  it('measures the view along its own sides, in metres', () => {
    // a degree at the equator is ~111.3 km both ways
    const { across, down } = mapFacade(stubMap()).viewSpanMeters();
    expect(across).toBeGreaterThan(110_000);
    expect(across).toBeLessThan(112_000);
    expect(down).toBeGreaterThan(110_000);
    expect(down).toBeLessThan(112_000);
  });

  it('drops the ready flag before the map goes, not after', () => {
    const container = { dataset: { mapReady: 'true' } };
    const map = stubMap();
    mapFacade(map, container).destroy();
    expect(container.dataset.mapReady).toBeUndefined();
    expect(map.calls.removed).toBe(1);
  });
});
