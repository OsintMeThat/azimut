/**
 * The map engine's boundary.
 *
 * Tools talk to the map through this façade and never to the engine, so
 * replacing the engine (SPEC v3, "Map engine (MapLibre)") is a rewrite of
 * `engine.js` rather than of the tools above it. Two rules keep that promise:
 *
 * - **Nothing engine-shaped crosses the boundary.** A screen point is
 *   `{ x, y }`, a position is `{ lat, lon }`, an extent is
 *   `{ north, south, east, west }`. No LatLng, no Point, no layer.
 * - **Events are named for what happened to the view**, not for what the
 *   engine calls it. `view-settled` is "the camera came to rest", whichever
 *   pair of engine events that turns out to be.
 *
 * `zoom` is the XYZ view zoom the whole app speaks: provider ceilings, tile
 * requests, capture provenance and every route's `zoom: int`. An engine whose
 * camera counts zoom differently — MapLibre's is continuous and defined on
 * 512 px tiles — converts here, so that difference never reaches a request.
 *
 * Longitude is wrapped on the way out. An engine keeps counting past ±180°
 * when the analyst pans across the date line, every route bounds it to ±180,
 * and an unwrapped centre answered 422 over the Pacific. The guarantee is
 * stated once, here, rather than at each call site.
 *
 * Nothing in this file imports the engine, so the translation is exercised
 * against a stub map instead of a browser (`facade.test.js`).
 */
import { wrapLon } from '../coords.js';
import { haversine } from '../measure.js';

/** What happened to the view → the engine events that say so. */
const EVENTS = {
  'view-settled': 'moveend zoomend',
  // a reposition that leaves the zoom alone: a rotation ending, a reset
  'view-reset': 'viewreset rotateend',
  'zoom-start': 'zoomstart',
  rotate: 'rotate',
  click: 'click',
};

/** The vocabulary `on()` accepts. */
export const MAP_EVENTS = Object.keys(EVENTS);

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
 * Wrap a built map in the façade.
 *
 * @param {object} map the engine's own map object
 * @param {HTMLElement} [container] the element the map was built in
 */
export function mapFacade(map, container) {
  /** Where the camera is, in the terms the rest of the app uses. */
  function camera() {
    const centre = map.getCenter();
    return {
      lat: centre.lat,
      lon: wrapLon(centre.lng),
      zoom: map.getZoom(),
      bearing: map.getBearing(),
    };
  }

  function fitBounds({ north, south, east, west }, options) {
    map.fitBounds(
      [
        [south, west],
        [north, east],
      ],
      options
    );
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
    getZoom: () => map.getZoom(),

    setView: ({ lat, lon }, zoom) => map.setView([lat, lon], zoom),
    setZoom: (zoom) => map.setZoom(zoom),
    setBearing: (deg) => map.setBearing(normalizeBearing(deg)),
    panBy: (dx, dy) => map.panBy([dx, dy], { animate: false }),
    fitBounds,
    fitPoints,

    containerPointToLatLng({ x, y }) {
      const position = map.containerPointToLatLng([x, y]);
      return { lat: position.lat, lon: wrapLon(position.lng) };
    },

    latLngToContainerPoint({ lat, lon }) {
      const point = map.latLngToContainerPoint([lat, lon]);
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

    invalidateSize: (options) => map.invalidateSize(options),

    /**
     * Listen for something happening to the view. Returns the unsubscribe, so
     * a caller cannot hold one half of the pair.
     */
    on(name, handler) {
      const events = engineEvents(name);
      const relay =
        name === 'click'
          ? (event) => handler({ lat: event.latlng.lat, lon: wrapLon(event.latlng.lng) })
          : () => handler(camera());
      map.on(events, relay);
      return () => map.off(events, relay);
    },

    destroy() {
      if (container) delete container.dataset.mapReady;
      map.remove();
    },

    /**
     * The element the map fills. Every engine has one, and the gestures and the
     * seam fix measure and read it, so it crosses the boundary as itself.
     */
    container,

    /**
     * The engine's own map.
     *
     * Transitional: the drawn overlays and the drag gestures still speak
     * Leaflet, and step 3 of the Satellite split moves them behind this façade.
     * Inside `lib/map` it is the engine, plainly; outside, nothing new may
     * reach for it.
     */
    leaflet: map,
  };
}
