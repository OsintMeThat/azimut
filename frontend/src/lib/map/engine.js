/**
 * Builds the map Leaflet renders, and hands back the neutral façade.
 *
 * The only file in the tools' reach that imports Leaflet — the engine swap
 * (SPEC v3, "Map engine (MapLibre)") replaces this one and leaves
 * `facade.js` and its callers alone. What the map opens on, and the two
 * controls it always carries, are settled here rather than at the call site:
 * a second map surface must not be able to ship without a scale bar.
 */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './engine.css';
import { mapFacade } from './facade.js';

/**
 * @param {HTMLElement} container the element the map fills
 * @param {object} opts
 * @param {object} opts.view `{ lat, lon, zoom }` the map opens on
 * @param {boolean} [opts.imperial] scale bar in miles rather than metres
 */
export async function createMapEngine(container, { view, imperial = false } = {}) {
  // leaflet-rotate patches the global L, so expose it before importing.
  window.L = L;
  await import('leaflet-rotate');
  const map = L.map(container, {
    center: [view.lat, view.lon],
    zoom: view.zoom,
    zoomControl: false,
    attributionControl: true,
    rotate: true,
    rotateControl: false,
    touchRotate: true,
    shiftKeyRotate: true,
  });
  // stacked below the top-left tool cluster (fullscreen/labels/measure) via a
  // CSS offset, instead of Leaflet's default corner margin
  L.control.zoom({ position: 'topleft' }).addTo(map);
  // judging feature sizes (buildings, roads) needs a scale reference
  L.control.scale({ metric: !imperial, imperial, position: 'bottomright' }).addTo(map);
  // A stable class for the tool's own cursor rules: a mode armed above the map
  // says so on the surface, whichever engine drew it.
  container.classList.add('map-surface');
  // The one thing outside code waits on. A browser test cannot ask the façade
  // whether the map is up, and asking it to recognise the engine's own class
  // names is how a suite ends up pinned to the engine it was written against.
  container.dataset.mapReady = 'true';
  return mapFacade(map, container);
}
