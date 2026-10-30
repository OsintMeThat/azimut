/**
 * One map façade over two engines: MapLibre's flat map, and while the 3D view
 * is on, the globe (globe.js).
 *
 * A tool holds one `engine` for the life of its map and asks it where the
 * camera is, turns it, frames a place, listens for it to settle. Which engine
 * draws is the surface's business, so the façade the tool holds sends each
 * camera call to the globe while one is attached and to the flat map
 * otherwise. Everything else (layers, markers, the engine's own map) stays the
 * flat map's: it is drawn under the globe and comes back as it was.
 *
 * Listeners are kept on both sides and hear only the engine that draws: the
 * flat map's camera events are dropped while the globe is attached, so a tool
 * never hears the hidden map move. The pointer's are the exception: the globe
 * hands its presses to the flat map (mirror.js), where the layers that answer
 * a click are, so a click is always heard from the flat map, claimed or not as
 * it would be there.
 */

/** The façade calls a globe answers in place of the flat map. */
export const GLOBE_CALLS = Object.freeze([
  'camera',
  'getZoom',
  'exactZoom',
  'centreElevation',
  'setCamera',
  'setView',
  'setZoom',
  'setBearing',
  'setPitch',
  'maxPitch',
  'panBy',
  'fitBounds',
  'fitPoints',
  'containerPointToLatLng',
  'latLngToContainerPoint',
  'projectAt',
  'onSurface',
  'tilesLoading',
  'drewReliefFallback',
  'idle',
  'snapshot',
  'viewBounds',
  'viewSpanMeters',
]);

/** Events heard from the flat map whichever engine draws: the globe hands its presses on to it. */
export const POINTER_EVENTS = Object.freeze(['click', 'contextmenu', 'pointer-move']);

/**
 * @param {object} flat the flat map's façade (`engine.js`)
 * @returns the façade, plus `attachGlobe(globe)`, `detachGlobe()` and `globe`
 */
export function createDualEngine(flat) {
  let globe = null;
  // name → handlers the globe's events go to while it is attached
  const handlers = new Map();
  // the globe's own subscriptions, one a name a handler set is opened for
  let offGlobe = [];

  function subscribe(name) {
    if (!globe) return;
    offGlobe.push(
      globe.on(name, (payload) => {
        for (const handler of handlers.get(name) ?? []) handler(payload);
      })
    );
  }

  function on(name, handler) {
    if (POINTER_EVENTS.includes(name)) return flat.on(name, handler);
    const offFlat = flat.on(name, (...args) => {
      if (!globe) handler(...args);
    });
    if (!handlers.has(name)) {
      handlers.set(name, new Set());
      subscribe(name);
    }
    handlers.get(name).add(handler);
    return () => {
      offFlat();
      handlers.get(name)?.delete(handler);
    };
  }

  // whether a tool reads the clicks, kept for a globe attached later
  let clicksRead = false;

  const calls = new Set(GLOBE_CALLS);
  const extra = {
    on,
    attachGlobe(next) {
      globe = next;
      offGlobe = [];
      for (const name of handlers.keys()) subscribe(name);
      globe.readClicks?.(clicksRead);
    },
    /**
     * A tool reading the map's clicks (a measure being drawn): the globe then
     * hears a double click as two clicks rather than a zoom. The flat map's
     * double click is the host's to keep from its engine.
     */
    readClicks(on) {
      clicksRead = Boolean(on);
      globe?.readClicks?.(clicksRead);
    },
    detachGlobe() {
      for (const off of offGlobe) off();
      offGlobe = [];
      globe = null;
    },
    get globe() {
      return globe;
    },
    /** The flat map's façade, whichever engine draws. */
    flat,
  };

  return new Proxy(flat, {
    get(target, key) {
      if (key in extra) return extra[key];
      if (globe && calls.has(key)) return globe[key];
      return target[key];
    },
  });
}
