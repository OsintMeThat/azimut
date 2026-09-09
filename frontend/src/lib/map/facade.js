/**
 * The map engine's boundary.
 *
 * Tools talk to the map through this façade and never to the engine, so
 * replacing the engine is a rewrite of `engine.js` rather than of the tools
 * above it. Two rules keep that promise:
 *
 * - **Nothing engine-shaped crosses the boundary.** A screen point is
 *   `{ x, y }`, a position is `{ lat, lon }`, an extent is
 *   `{ north, south, east, west }`. No LngLat, no Point, no layer.
 * - **Events are named for what happened to the view**, not for what the
 *   engine calls it. `view-settled` is "the camera came to rest", whichever
 *   engine event that turns out to be.
 *
 * Three translations are the whole reason this file exists, and each one is a
 * number that would otherwise be wrong in a request or on disk:
 *
 * - **Zoom.** MapLibre counts zoom on 512 px tiles and counts it continuously.
 *   The app speaks the XYZ view zoom — one level deeper — in whole levels:
 *   `zoom: int` on every route, one level of pixels per raster basemap, one
 *   number recorded on a capture.
 * - **Bearing.** The app's bearing turns the map *clockwise*. MapLibre's is the
 *   compass direction that is up, which is the same turn counted the other way.
 * - **Longitude.** An engine keeps counting past ±180° when the analyst pans
 *   across the date line, every route bounds it to ±180, and an unwrapped
 *   centre answered 422 over the Pacific.
 *
 * Nothing in this file imports the engine, so the translations are exercised
 * against a stub map instead of a browser (`facade.test.js`).
 */
import { wrapLon } from '../coords.js';
import { haversine } from '../measure.js';

/** What happened to the view → the engine events that say so. */
const EVENTS = {
  // MapLibre fires move events for any camera change, a zoom included, so one
  // name covers what used to take two.
  'view-settled': ['moveend'],
  rotate: ['rotate'],
  click: ['click'],
};

/** The vocabulary `on()` accepts. */
export const MAP_EVENTS = Object.keys(EVENTS);

/**
 * How much deeper the app's zoom counts than the engine's.
 *
 * MapLibre's zoom is defined on 512 px tiles, XYZ zoom on 256 px ones, so the
 * same view is one number apart. Everything the app says about zoom — provider
 * ceilings, tile URLs, capture provenance, a saved place's view — is XYZ.
 */
const ZOOM_OFFSET = 1;

/**
 * The engine's zoom as the app says it: whole levels.
 *
 * The engine settles on a level (`engine.js`) so this rounds nothing the
 * analyst can see; what it protects against is a read taken mid-gesture
 * reaching a route as 16.37.
 */
export function viewZoom(engineZoom) {
  return Math.round(engineZoom + ZOOM_OFFSET);
}

/** …and back, for anything handed to the camera. */
export function engineZoom(zoom) {
  return zoom - ZOOM_OFFSET;
}

/**
 * The same reading unrounded, for whatever has to follow the camera itself
 * rather than say a number about it — the Google widget basemap under the map,
 * which would visibly jump a whole level otherwise.
 */
export function exactViewZoom(zoom) {
  return zoom + ZOOM_OFFSET;
}

/** 0–360, whatever the caller typed, dragged or read off a saved row. */
export function normalizeBearing(deg) {
  const value = Number(deg);
  if (!Number.isFinite(value)) return 0;
  return ((value % 360) + 360) % 360;
}

/**
 * The engine events one neutral name stands for.
 *
 * Throws on anything else: a typo that silently stopped delivering would read
 * as a map that quietly went dead.
 */
export function engineEvents(name) {
  const events = EVENTS[name];
  if (!events) throw new Error(`unknown map event: ${name}`);
  return events;
}

/** The smallest box holding every point, or null if there is nothing to hold. */
export function pointsExtent(points) {
  const usable = (points ?? []).filter(
    (point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lon)
  );
  if (!usable.length) return null;
  const lats = usable.map((point) => point.lat);
  const lons = usable.map((point) => point.lon);
  return {
    north: Math.max(...lats),
    south: Math.min(...lats),
    east: Math.max(...lons),
    west: Math.min(...lons),
  };
}

/**
 * Frame padding as the engine wants it, from the `[x, y]` pair callers write.
 *
 * A number is the same on all four sides; a pair is horizontal then vertical,
 * which is how a caller thinks about leaving room beside a box.
 */
export function framePadding(padding) {
  if (padding == null) return 0;
  if (typeof padding === 'number') return padding;
  const [x, y] = padding;
  return { left: x, right: x, top: y, bottom: y };
}

/**
 * Wrap a built map in the façade.
 *
 * @param {object} map the engine's own map object
 * @param {HTMLElement} [container] the element the map was built in
 */
export function mapFacade(map, container) {
  /**
   * Layers that answer their own click.
   *
   * A click on a shape is not also a click on the map underneath: a cell of a
   * search grid cycles its own status, and the map's click handler — which
   * drops a polygon vertex or plants the sky anchor — must not fire behind it.
   * The engine delivers both, so the map's own relay asks first whether a
   * claiming layer was hit. Which layers claim is asked here rather than left
   * to listener order, so the answer does not depend on who registered first.
   */
  const claimed = new Set();

  function shapeUnder(point) {
    for (const claim of claimed) {
      const layers = claim.layers.filter((id) => map.getLayer(id));
      if (!layers.length) continue;
      if (map.queryRenderedFeatures(point, { layers, filter: claim.filter }).length) return true;
    }
    return false;
  }

  /** Where the camera is, in the terms the rest of the app uses. */
  function camera() {
    const centre = map.getCenter();
    return {
      lat: centre.lat,
      lon: wrapLon(centre.lng),
      zoom: viewZoom(map.getZoom()),
      bearing: normalizeBearing(-map.getBearing()),
    };
  }

  function fitBounds({ north, south, east, west }, options = {}) {
    const ceiling = options.maxZoom == null ? map.getMaxZoom() : engineZoom(options.maxZoom);
    const fitted = map.cameraForBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: framePadding(options.padding), maxZoom: ceiling }
    );
    if (!fitted) return;
    // The shallower whole level, not the nearest: the box has to still fit
    // inside the frame, and a raster basemap only has whole levels of pixels.
    // A box with no extent at all (one point) fits at any zoom, so clamp — the
    // engine's own ceiling is the answer there, never Infinity.
    const zoom = Math.min(ceiling, Math.floor(fitted.zoom));
    map.easeTo({
      center: fitted.center,
      zoom: Math.max(map.getMinZoom(), zoom),
      duration: options.animate ? 420 : 0,
    });
  }

  /** Frame every point handed over. False when none of them was usable. */
  function fitPoints(points, options) {
    const extent = pointsExtent(points);
    if (!extent) return false;
    fitBounds(extent, options);
    return true;
  }

  return {
    camera,
    getZoom: () => viewZoom(map.getZoom()),

    setView: ({ lat, lon }, zoom) => map.jumpTo({ center: [lon, lat], zoom: engineZoom(zoom) }),
    setZoom: (zoom) => map.setZoom(engineZoom(zoom)),
    setBearing: (deg) => map.setBearing(-normalizeBearing(deg)),
    /** Never animated: a rotation pans the map once per pointer move. */
    panBy: (dx, dy) => map.panBy([dx, dy], { duration: 0 }),
    fitBounds,
    fitPoints,

    containerPointToLatLng({ x, y }) {
      const position = map.unproject([x, y]);
      return { lat: position.lat, lon: wrapLon(position.lng) };
    },

    latLngToContainerPoint({ lat, lon }) {
      const point = map.project([lon, lat]);
      return { x: point.x, y: point.y };
    },

    /**
     * How far the view reaches on the ground, along each of its own sides.
     * What sizes anything drawn in metres — the sky arc is a circle around its
     * anchor, so a radius taken off the diagonal runs off a wide window.
     */
    viewSpanMeters() {
      const bounds = map.getBounds();
      const north = bounds.getNorth();
      const west = bounds.getWest();
      return {
        across: haversine({ lat: north, lon: west }, { lat: north, lon: bounds.getEast() }),
        down: haversine({ lat: north, lon: west }, { lat: bounds.getSouth(), lon: west }),
      };
    },

    /** The container changed size; re-read it. */
    resize: () => map.resize(),

    /**
     * Listen for something happening to the view. Returns the unsubscribe, so
     * a caller cannot hold one half of the pair.
     */
    on(name, handler) {
      const events = engineEvents(name);
      const relay =
        name === 'click'
          ? (event) => {
              if (shapeUnder(event.point)) return;
              handler({ lat: event.lngLat.lat, lon: wrapLon(event.lngLat.lng) });
            }
          : () => handler(camera());
      for (const event of events) map.on(event, relay);
      return () => {
        for (const event of events) map.off(event, relay);
      };
    },

    /**
     * These layers answer their own clicks; keep the map's relay off them.
     * The filter narrows that to the features that really do — a shape drawn
     * under a mark to say how loosely it is placed answers nothing, and must
     * not swallow the click meant for the map. Returns the release, for a
     * surface that is torn down.
     */
    claimClicks(layers, filter) {
      const claim = { layers: [...layers], filter };
      claimed.add(claim);
      return () => claimed.delete(claim);
    },

    destroy() {
      if (container) delete container.dataset.mapReady;
      map.remove();
    },

    /**
     * The element the map fills. Every engine has one, and the gestures measure
     * and read it, so it crosses the boundary as itself.
     */
    container,

    /**
     * The engine's own map.
     *
     * The modules in `lib/map` are the engine, plainly: layers, sources and
     * markers are its vocabulary and there is no neutral way to say them.
     * Nothing above the façade may reach for this.
     */
    impl: map,
  };
}
