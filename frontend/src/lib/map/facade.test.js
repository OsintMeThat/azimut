import { describe, expect, it, vi } from 'vitest';
import {
  MAP_EVENTS,
  engineEvents,
  engineZoom,
  exactViewZoom,
  framePadding,
  mapFacade,
  normalizeBearing,
  pointsExtent,
  viewZoom,
} from './facade.js';

/**
 * A map the façade can be driven against without a browser. The point of
 * keeping `facade.js` clear of the engine is that everything crossing the
 * boundary — the zoom convention, the bearing sign, wrapping, extents, point
 * shapes, the event vocabulary — is arithmetic and translation, so it is tested
 * here rather than in an e2e run.
 *
 * The numbers are the engine's own: zoom 15 on 512 px tiles is the app's z16,
 * and a MapLibre bearing of -37 is the app's 37.
 */
function stubMap(overrides = {}) {
  const calls = {
    jumpTo: [],
    setZoom: [],
    setBearing: [],
    panBy: [],
    easeTo: [],
    cameraForBounds: [],
    queryRenderedFeatures: [],
    on: [],
    off: [],
    resize: 0,
    removed: 0,
  };
  return {
    calls,
    getCenter: () => ({ lat: 48.8584, lng: 2.2945 }),
    getZoom: () => 15,
    getMinZoom: () => 0,
    getMaxZoom: () => 21,
    getBearing: () => -37,
    getBounds: () => ({
      getNorth: () => 0,
      getSouth: () => -1,
      getWest: () => 0,
      getEast: () => 1,
    }),
    getLayer: (id) => (id === 'gone' ? undefined : { id }),
    unproject: ([x, y]) => ({ lat: 40 + y, lng: 180 + x }),
    project: ([lon, lat]) => ({ x: lon * 10, y: lat * 10 }),
    jumpTo: (...args) => calls.jumpTo.push(args),
    setZoom: (...args) => calls.setZoom.push(args),
    setBearing: (...args) => calls.setBearing.push(args),
    panBy: (...args) => calls.panBy.push(args),
    easeTo: (...args) => calls.easeTo.push(args),
    cameraForBounds: (...args) => {
      calls.cameraForBounds.push(args);
      return { center: { lat: 2, lng: 5 }, zoom: 13.7, bearing: 0 };
    },
    queryRenderedFeatures: (...args) => {
      calls.queryRenderedFeatures.push(args);
      return [];
    },
    on: (...args) => calls.on.push(args),
    off: (...args) => calls.off.push(args),
    resize: () => (calls.resize += 1),
    remove: () => (calls.removed += 1),
    ...overrides,
  };
}

describe('the zoom convention', () => {
  it('counts one level deeper than the engine does', () => {
    // MapLibre's zoom is defined on 512 px tiles, XYZ zoom on 256 px ones
    expect(viewZoom(15)).toBe(16);
    expect(engineZoom(16)).toBe(15);
    expect(engineZoom(viewZoom(9))).toBe(9);
  });

  it('rounds, because every route takes a whole level', () => {
    // `zoom: int = Field(ge=1, le=22)` on the capture route; a read taken
    // mid-gesture must not reach it as 16.37
    expect(viewZoom(15.37)).toBe(16);
    expect(viewZoom(15.5)).toBe(17);
    expect(mapFacade(stubMap({ getZoom: () => 15.37 })).getZoom()).toBe(16);
    expect(mapFacade(stubMap({ getZoom: () => 15.37 })).camera().zoom).toBe(16);
  });

  it('keeps the unrounded reading for whatever follows the camera itself', () => {
    // the Google widget basemap under the map would jump a whole level
    expect(exactViewZoom(15.37)).toBeCloseTo(16.37, 10);
  });
});

describe('the bearing convention', () => {
  it('reads the engine’s turn as the app’s, which is the other way round', () => {
    // the app's bearing turns the map clockwise (engine/tiles.py rotates a
    // capture by it); MapLibre's names the compass direction that is up
    expect(mapFacade(stubMap()).camera().bearing).toBe(37);
    expect(mapFacade(stubMap({ getBearing: () => -270 })).camera().bearing).toBe(270);
    expect(mapFacade(stubMap({ getBearing: () => 90 })).camera().bearing).toBe(270);
  });

  it('negates on the way in too, so a saved bearing restores as it was saved', () => {
    const map = stubMap();
    mapFacade(map).setBearing(37);
    expect(map.calls.setBearing).toEqual([[-37]]);
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
    expect(map.calls.setBearing).toEqual([[-315]]);
  });
});

describe('the map façade keeps the engine on its own side', () => {
  it('folds the map centre back inside the bounds every route enforces', () => {
    // an engine keeps counting past ±180 across the date line; the capture
    // route bounds lon to ±180, so an unwrapped centre answered 422
    const map = stubMap({ getCenter: () => ({ lat: 12, lng: 190.5 }) });
    expect(mapFacade(map).camera()).toEqual({ lat: 12, lon: -169.5, zoom: 16, bearing: 37 });
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

  it('moves the camera without animating it', () => {
    const map = stubMap();
    const facade = mapFacade(map);
    facade.setView({ lat: 1, lon: 2 }, 16);
    facade.setZoom(18);
    expect(map.calls.jumpTo).toEqual([[{ center: [2, 1], zoom: 15 }]]);
    expect(map.calls.setZoom).toEqual([[17]]);
  });

  it('never animates a pan: it re-pins a grabbed point mid-gesture', () => {
    const map = stubMap();
    mapFacade(map).panBy(3, -7);
    expect(map.calls.panBy).toEqual([[[3, -7], { duration: 0 }]]);
  });

  it('re-reads the container on request', () => {
    const map = stubMap();
    mapFacade(map).resize();
    expect(map.calls.resize).toBe(1);
  });
});

describe('framing an extent', () => {
  it('writes padding the way callers think about it', () => {
    expect(framePadding([10, 20])).toEqual({ left: 10, right: 10, top: 20, bottom: 20 });
    expect(framePadding(12)).toBe(12);
    expect(framePadding(undefined)).toBe(0);
  });

  it('speaks extents, and lets the engine order its own corners', () => {
    const map = stubMap();
    mapFacade(map).fitBounds({ north: 4, south: 1, east: 8, west: 2 }, { padding: [10, 10] });
    expect(map.calls.cameraForBounds[0][0]).toEqual([
      [2, 1],
      [8, 4],
    ]);
  });

  it('lands on the shallower whole level, so the box still fits', () => {
    // the fitted zoom is 13.7 in engine terms; rounding up would crop the box,
    // and a raster basemap only has whole levels of pixels
    const map = stubMap();
    mapFacade(map).fitBounds({ north: 4, south: 1, east: 8, west: 2 }, { maxZoom: 20 });
    expect(map.calls.cameraForBounds[0][1].maxZoom).toBe(19);
    expect(map.calls.easeTo).toEqual([
      [{ center: { lat: 2, lng: 5 }, zoom: 13, duration: 0 }],
    ]);
  });

  it('animates only when asked', () => {
    const map = stubMap();
    mapFacade(map).fitBounds({ north: 4, south: 1, east: 8, west: 2 }, { animate: true });
    expect(map.calls.easeTo[0][0].duration).toBeGreaterThan(0);
  });

  it('clamps a box with no extent at all to the engine’s own ceiling', () => {
    // one point fits at any zoom, and cameraForBounds says so
    const map = stubMap({
      cameraForBounds: () => ({ center: { lat: 1, lng: 1 }, zoom: Infinity, bearing: 0 }),
    });
    mapFacade(map).fitBounds({ north: 1, south: 1, east: 1, west: 1 });
    expect(map.calls.easeTo[0][0].zoom).toBe(21);
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
    expect(map.calls.easeTo).toEqual([]);
  });

  it('frames what did arrive, and says so', () => {
    const map = stubMap();
    expect(
      mapFacade(map).fitPoints([{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }], { maxZoom: 17 })
    ).toBe(true);
    expect(map.calls.cameraForBounds[0][0]).toEqual([
      [2, 1],
      [4, 3],
    ]);
  });
});

describe('the event vocabulary', () => {
  it('names what happened to the view, not what the engine calls it', () => {
    expect(MAP_EVENTS).toEqual(['view-settled', 'rotate', 'click']);
    expect(engineEvents('view-settled')).toEqual(['moveend']);
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
    expect(seen).toHaveBeenCalledWith({ lat: 48.8584, lon: 2.2945, zoom: 16, bearing: 37 });
  });

  it('hands a click the point clicked, wrapped like any other', () => {
    const map = stubMap();
    const seen = vi.fn();
    mapFacade(map).on('click', seen);
    map.calls.on[0][1]({ point: { x: 1, y: 1 }, lngLat: { lat: 7, lng: 200 } });
    expect(seen).toHaveBeenCalledWith({ lat: 7, lon: -160 });
  });

  it('returns the unsubscribe, so nobody can hold half the pair', () => {
    const map = stubMap();
    const off = mapFacade(map).on('rotate', () => {});
    off();
    expect(map.calls.off).toEqual([map.calls.on[0]]);
  });
});

describe('a click a shape has already answered', () => {
  it('does not also reach the map', () => {
    // a cell of a search grid cycles its own status; the map's handler, which
    // drops a polygon vertex, must not fire behind it
    const map = stubMap({ queryRenderedFeatures: () => [{ id: 1 }] });
    const facade = mapFacade(map);
    const seen = vi.fn();
    facade.claimClicks(['cells'], ['!=', ['get', 'interactive'], false]);
    facade.on('click', seen);
    map.calls.on[0][1]({ point: { x: 5, y: 6 }, lngLat: { lat: 1, lng: 2 } });
    expect(seen).not.toHaveBeenCalled();
  });

  it('asks only about the layers still on the map, and with the claim’s filter', () => {
    const map = stubMap();
    const facade = mapFacade(map);
    facade.claimClicks(['cells', 'gone'], ['has', 'sid']);
    facade.on('click', () => {});
    map.calls.on[0][1]({ point: { x: 5, y: 6 }, lngLat: { lat: 1, lng: 2 } });
    expect(map.calls.queryRenderedFeatures).toEqual([
      [{ x: 5, y: 6 }, { layers: ['cells'], filter: ['has', 'sid'] }],
    ]);
  });

  it('lets the map hear clicks again once the surface releases them', () => {
    const map = stubMap({ queryRenderedFeatures: () => [{ id: 1 }] });
    const facade = mapFacade(map);
    const seen = vi.fn();
    const release = facade.claimClicks(['cells']);
    facade.on('click', seen);
    release();
    map.calls.on[0][1]({ point: { x: 5, y: 6 }, lngLat: { lat: 1, lng: 2 } });
    expect(seen).toHaveBeenCalledWith({ lat: 1, lon: 2 });
  });

  it('leaves the map’s own click alone when nothing claimed it', () => {
    const map = stubMap({ queryRenderedFeatures: () => [{ id: 1 }] });
    const facade = mapFacade(map);
    const seen = vi.fn();
    facade.on('click', seen);
    map.calls.on[0][1]({ point: { x: 5, y: 6 }, lngLat: { lat: 1, lng: 2 } });
    expect(seen).toHaveBeenCalledOnce();
    expect(map.calls.queryRenderedFeatures).toEqual([]);
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
