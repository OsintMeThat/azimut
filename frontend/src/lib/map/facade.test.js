import { describe, expect, it, vi } from 'vitest';
import {
  createMoveFold,
  engineEvents,
  engineZoom,
  exactViewZoom,
  framePadding,
  mapFacade,
  normalizeBearing,
  pointsExtent,
  viewZoom,
} from './facade.js';
import { HAND, PLACED } from './groundHold.js';

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
    getPitch: () => 0,
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
    setPitch: (...args) => (calls.setPitch ??= []).push(args),
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
    expect(mapFacade(map).camera()).toEqual({ lat: 12, lon: -169.5, zoom: 16, bearing: 37, pitch: 0 });
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
    // a camera the app puts somewhere says so, for the 3D map's seating (groundHold.js)
    expect(map.calls.jumpTo).toEqual([[{ center: [2, 1], zoom: 15 }, PLACED]]);
    expect(map.calls.setZoom).toEqual([[17]]);
  });

  it('takes a whole camera in one jump, the turn in the engine’s sign', () => {
    const map = stubMap();
    const facade = mapFacade(map);
    facade.setCamera({ lat: 1, lon: 2, zoom: 16, bearing: 37 });
    facade.setCamera({ lat: 3, lon: 4, zoom: 12 });
    expect(map.calls.jumpTo).toEqual([
      [{ center: [2, 1], zoom: 15, bearing: -37 }, PLACED],
      [{ center: [4, 3], zoom: 11, bearing: -0 }, PLACED],
    ]);
  });

  it('carries a tilt only when one is named, and never below flat', () => {
    const map = stubMap({ getPitch: () => 61.6 });
    const facade = mapFacade(map);
    expect(facade.camera().pitch).toBe(62);
    facade.setCamera({ lat: 1, lon: 2, zoom: 16, bearing: 0, pitch: 45 });
    expect(map.calls.jumpTo[0][0].pitch).toBe(45);
    facade.setPitch(-10);
    facade.setPitch(30);
    expect(map.calls.setPitch).toEqual([[0], [30]]);
  });

  it('waits for the map to rest with its tiles in', async () => {
    let idle;
    let moving = true;
    const map = stubMap({
      isMoving: () => moving,
      areTilesLoaded: () => false,
      once: (name, handler) => name === 'idle' && (idle = handler),
    });
    let done = false;
    mapFacade(map).idle().then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    moving = false;
    idle();
    await Promise.resolve();
    expect(done).toBe(true);
    const ready = stubMap({ isMoving: () => false, areTilesLoaded: () => true });
    await expect(mapFacade(ready).idle()).resolves.toBeUndefined();
  });

  it('holds the centre’s height through a gesture, and re-seats it after with the camera kept', () => {
    const recalculated = [];
    const camera = {
      elevationFreeze: false,
      transform: { recalculateZoomAndCenter: (terrain) => recalculated.push(terrain) },
    };
    const map = stubMap({ getCenterElevation: () => 2930, _update: () => recalculated.push('drawn') });
    map._camera = camera;
    map.terrain = 'relief';
    const facade = mapFacade(map);
    const release = facade.holdElevation();
    expect(camera.elevationFreeze).toBe(true);
    facade.setPitch(40);
    facade.setBearing(10);
    facade.shiftBy({ lat: 0, lon: 0.001 });
    facade.setZoom(14.5);
    expect(map.calls.jumpTo.map(([jump]) => jump.elevation)).toEqual([2930, 2930, 2930, 2930]);
    expect(map.calls.jumpTo.at(-1)[0].zoom).toBe(13.5);
    // the moves are the hand's, so the eye stays where they leave it (groundHold.js)
    expect(map.calls.jumpTo.map(([, data]) => data)).toEqual([HAND, HAND, HAND, HAND]);
    expect(facade.exactZoom()).toBe(16);
    expect(recalculated).toEqual([]);
    release();
    expect(camera.elevationFreeze).toBe(false);
    expect(recalculated).toEqual(['relief', 'drawn']);
    facade.setPitch(41);
    expect(map.calls.setPitch).toEqual([[41]]);
  });

  it('tells a press on the drawn map from one on a marker, and gives the map the keyboard', () => {
    const canvas = { focus: vi.fn() };
    const facade = mapFacade(stubMap({ getCanvas: () => canvas }));
    expect(facade.onSurface(canvas)).toBe(true);
    expect(facade.onSurface({ tagName: 'DIV' })).toBe(false);
    expect(facade.onSurface(null)).toBe(false);
    facade.focus();
    expect(canvas.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('holds what it can on an engine with no freeze of its own', () => {
    const map = stubMap({ getCenterElevation: () => 120 });
    const release = mapFacade(map).holdElevation();
    expect(() => release()).not.toThrow();
  });

  /** The stub with the engine's own `fire`, on its prototype as the engine has it, recording what is heard. */
  function firingMap(overrides = {}) {
    const heard = [];
    class Evented {
      fire(event) {
        heard.push(typeof event === 'string' ? event : event.type);
        return this;
      }
    }
    return { map: Object.assign(new Evented(), stubMap(overrides)), heard };
  }

  /** One jump as the engine reports it: a whole movement, start to end. */
  function jump(map) {
    for (const type of ['movestart', 'move', 'rotatestart', 'rotate', 'rotateend', 'moveend']) map.fire({ type });
  }

  it('makes a held gesture one movement: it starts once, moves at every jump, and ends when let go', () => {
    const { map, heard } = firingMap({ getCenterElevation: () => 2930, _update: () => heard.push('re-seated') });
    map._camera = { elevationFreeze: false, transform: { recalculateZoomAndCenter: () => {} } };
    map.terrain = 'relief';
    const release = mapFacade(map).holdElevation();
    jump(map);
    jump(map);
    jump(map);
    expect(heard).toEqual(['movestart', 'move', 'rotatestart', 'rotate', 'move', 'rotate', 'move', 'rotate']);
    heard.length = 0;
    release();
    // the end is heard after the re-seat, so the settled view says where the centre landed
    expect(heard).toEqual(['re-seated', 'rotateend', 'moveend']);
    release();
    expect(heard).toHaveLength(3);
    // and the map is the engine's own again: a jump is a whole movement
    expect(Object.hasOwn(map, 'fire')).toBe(false);
    heard.length = 0;
    jump(map);
    expect(heard).toEqual(['movestart', 'move', 'rotatestart', 'rotate', 'rotateend', 'moveend']);
  });

  it('keeps overlapping holds one movement until the last is let go, whichever goes first', () => {
    const { map, heard } = firingMap();
    const fold = createMoveFold(map);
    const wheel = fold();
    jump(map);
    const drag = fold();
    jump(map);
    wheel();
    jump(map);
    expect(heard.filter((type) => type === 'movestart')).toHaveLength(1);
    expect(heard).not.toContain('moveend');
    drag();
    expect(heard.filter((type) => type === 'moveend')).toHaveLength(1);
    expect(Object.hasOwn(map, 'fire')).toBe(false);
  });

  it('works out where a point would be drawn after a shift on a copy of the camera, not the camera', () => {
    const live = { clone: () => copy };
    const copy = {
      setCenter: vi.fn(),
      setElevation: vi.fn(),
      locationToScreenPoint: vi.fn((at, terrain) => ({ x: at.lng * 10, y: at.lat * 10, terrain })),
    };
    // the engine's position objects are fresh on every read
    const map = stubMap({ getCenter: () => ({ lat: 10, lng: 20 }), getCenterElevation: () => 2930 });
    map._camera = { elevationFreeze: false, transform: live };
    map.style = {};
    map.terrain = 'relief';
    const facade = mapFacade(map);
    const release = facade.holdElevation();
    expect(facade.pointAfterShift({ lat: 1, lon: 2 }, { lat: 0.5, lon: -0.25 })).toEqual({ x: 20, y: 10 });
    expect(copy.setCenter).toHaveBeenCalledWith({ lat: 10.5, lng: 19.75 });
    expect(copy.setElevation).toHaveBeenCalledWith(2930);
    expect(copy.locationToScreenPoint.mock.calls[0][1]).toBe('relief');
    expect(map.calls.jumpTo).toEqual([]);
    release();
    expect(mapFacade(stubMap()).pointAfterShift({ lat: 1, lon: 2 }, { lat: 0, lon: 0 })).toBeNull();
  });

  it('shifts the camera over the ground by degrees, keeping the rest of it', () => {
    const map = stubMap();
    mapFacade(map).shiftBy({ lat: 0.5, lon: -0.25 });
    const [jump] = map.calls.jumpTo.at(-1);
    expect(jump.center[0]).toBeCloseTo(2.2945 - 0.25, 9);
    expect(jump.center[1]).toBeCloseTo(48.8584 + 0.5, 9);
    expect(Object.keys(jump)).toEqual(['center']);
  });

  it('hands a linked map the tilt with the rest of the frame', () => {
    const leader = mapFacade(stubMap({ getPitch: () => 50 }));
    const peerMap = stubMap();
    mapFacade(peerMap).follow(leader.frame());
    expect(peerMap.calls.jumpTo[0][0].pitch).toBe(50);
    expect(engineEvents('pitch')).toEqual(['pitch']);
  });

  it('reports the ceiling in app zoom', () => {
    expect(mapFacade(stubMap({ getMaxZoom: () => 17 })).maxZoom()).toBe(18);
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

  it('reports the ground rectangle in view, wrapped back inside ±180', () => {
    expect(mapFacade(stubMap()).viewBounds()).toEqual({ west: 0, south: -1, east: 1, north: 0 });
    const wrapped = stubMap({
      getBounds: () => ({ getNorth: () => 10, getSouth: () => 9, getWest: () => 179, getEast: () => 181 }),
    });
    expect(mapFacade(wrapped).viewBounds()).toMatchObject({ west: 179, east: -179 });
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
      [{ center: { lat: 2, lng: 5 }, zoom: 13, duration: 0 }, PLACED],
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
    expect(engineEvents('view-settled')).toEqual(['moveend']);
    expect(engineEvents('view-move')).toEqual(['move']);
    for (const name of ['rotate', 'click', 'contextmenu']) expect(engineEvents(name)).toEqual([name]);
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
    expect(seen).toHaveBeenCalledWith({ lat: 48.8584, lon: 2.2945, zoom: 16, bearing: 37, pitch: 0 });
  });

  it('hands a click the point clicked, wrapped like any other', () => {
    const map = stubMap();
    const seen = vi.fn();
    mapFacade(map).on('click', seen);
    map.calls.on[0][1]({ point: { x: 1, y: 1 }, lngLat: { lat: 7, lng: 200 } });
    expect(seen).toHaveBeenCalledWith({ lat: 7, lon: -160 });
  });

  it('hands a right-click the point and where it was pressed, for a menu to open there', () => {
    const map = stubMap();
    const seen = vi.fn();
    mapFacade(map).on('contextmenu', seen);
    expect(map.calls.on[0][0]).toBe('contextmenu');
    map.calls.on[0][1]({ point: { x: 120, y: 48 }, lngLat: { lat: 7, lng: 200 } });
    expect(seen).toHaveBeenCalledWith({ lat: 7, lon: -160, x: 120, y: 48 });
  });

  it('leaves a right-click on a shape that claims its clicks to that shape', () => {
    // right-click flags a search-grid cell; a menu opening over it too would be two answers
    const map = stubMap({ queryRenderedFeatures: () => [{ id: 1 }] });
    const facade = mapFacade(map);
    const seen = vi.fn();
    facade.claimClicks(['cells']);
    facade.on('contextmenu', seen);
    map.calls.on[0][1]({ point: { x: 5, y: 6 }, lngLat: { lat: 1, lng: 2 } });
    expect(seen).not.toHaveBeenCalled();
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

describe('capturing the drawn pixels', () => {
  function capturable({ loaded = true } = {}) {
    const once = new Map();
    const copy = { width: 0, height: 0, drawn: null };
    copy.getContext = () => ({ drawImage: (source) => (copy.drawn = source) });
    const map = stubMap({
      isMoving: () => false,
      areTilesLoaded: () => loaded,
      getCanvas: () => ({ width: 800, height: 600 }),
      once: (name, handler) => once.set(name, handler),
      off: (name) => once.delete(name),
      triggerRepaint: () => once.get('render')?.(),
    });
    vi.stubGlobal('document', { createElement: () => copy });
    return { map, once, copy };
  }

  it('reads the canvas inside the frame that drew it, once the tiles are in', async () => {
    const { map, copy } = capturable();
    try {
      const shot = await mapFacade(map).snapshot();
      expect(shot.complete).toBe(true);
      expect(shot.canvas).toBe(copy);
      expect([copy.width, copy.height]).toEqual([800, 600]);
      expect(copy.drawn).toEqual({ width: 800, height: 600 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('says whether a capture now would be partial', () => {
    let moving = false;
    let loaded = true;
    const facade = mapFacade(stubMap({ isMoving: () => moving, areTilesLoaded: () => loaded }));
    expect(facade.tilesLoading()).toBe(false);
    loaded = false;
    expect(facade.tilesLoading()).toBe(true);
    loaded = true;
    moving = true;
    expect(facade.tilesLoading()).toBe(true);
  });

  it('waits for the map to go idle, and says so when it gave up', async () => {
    vi.useFakeTimers();
    const { map, once } = capturable({ loaded: false });
    try {
      const waiting = mapFacade(map).snapshot({ timeout: 50 });
      expect(once.has('idle')).toBe(true);
      await vi.advanceTimersByTimeAsync(60);
      const shot = await waiting;
      expect(shot.complete).toBe(false);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
