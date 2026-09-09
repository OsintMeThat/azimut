/**
 * Builds the map MapLibre renders, and hands back the neutral façade.
 *
 * The only file in the tools' reach that imports MapLibre — the pitch and
 * terrain of the 3D map (SPEC v3) are options on this map object, and the tools
 * above the façade never learn about either. What the map opens on, and the two
 * controls it always carries, are settled here rather than at the call site: a
 * second map surface must not be able to ship without a scale bar.
 *
 * Three of the engine's own defaults are turned off on purpose, and each one is
 * a gesture the tool already owns: right-drag flags a grid cell, shift-drag and
 * middle-drag turn the map, and the view is flat until the 3D map earns a pitch.
 */
// `MapLibreMap` rather than the `Map` alias: shadowing the global here is
// exactly the sort of thing that reads fine until someone needs a Map.
import { MapLibreMap, NavigationControl, ScaleControl, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// The engine's worker, bundled and given a URL by our own build rather than by
// the engine's runtime guess — see the note in `vite.config.js`. Without this
// the worker never starts and the map draws imagery and nothing else: no
// shapes, no marks, no grid, and not one error in the console.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import './engine.css';
import { mapFacade, engineZoom } from './facade.js';

setWorkerUrl(workerUrl);

/**
 * The style the map opens with: nothing.
 *
 * `basemap.js` adds the imagery and the labels, and `surface.js` the drawn
 * shapes. An empty style also leaves the canvas transparent, which is what lets
 * the Google widget basemap show through from underneath it.
 *
 * Written here rather than fetched, which is the whole of this engine's network
 * behaviour: no style URL, no glyphs, no sprite, no token and no telemetry. The
 * only thing it ever asks for is a tile the analyst's own basemap choice named.
 */
const EMPTY_STYLE = { version: 8, sources: {}, layers: [] };

/**
 * One notch of the wheel is one zoom level, as it was on the map this replaced.
 *
 * The engine's own rate asymptotes at a level per notch and only reaches about
 * 0.18 of one, which `settleOnLevel` then rounds straight back to where the
 * gesture started: the map twitched and stayed put, and the wheel did nothing
 * at all. At this rate a notch lands within a thousandth of a level, so the
 * settle has nothing left to correct that anyone could see — which matters,
 * because the settle zooms about the centre while the wheel zoomed about the
 * cursor, and a visible correction would slide the ground under it.
 *
 * A trackpad's small deltas are the engine's other rate and are left alone:
 * they accumulate through a gesture and settle once at the end, and a flick too
 * small to make a level snaps back to the one it started on — which is what the
 * old map did with them too.
 */
const WHEEL_ZOOM_RATE = 1 / 15;

/**
 * The camera comes to rest on a whole zoom level.
 *
 * A raster basemap holds one level of pixels per zoom, and every tile request,
 * capture and saved view records one whole number. The gesture itself stays
 * continuous — this only decides where it stops.
 */
function settleOnLevel(map) {
  let settling = false;
  map.on('moveend', () => {
    // the settling ease ends in a moveend of its own; that one is already level
    if (settling) {
      settling = false;
      return;
    }
    const zoom = map.getZoom();
    const level = Math.round(zoom);
    const off = Math.abs(zoom - level);
    if (off < 1e-6) return;
    settling = true;
    // A hair off — what a wheel notch leaves — is put right with no animation
    // at all: it is under a pixel, and the correction turns about the centre
    // while the gesture turned about the cursor, so anything visible would
    // slide the ground the analyst was aiming at. A genuine fractional rest
    // (a trackpad flick) eases, so the snap reads as something the map did.
    map.easeTo({ zoom: level, duration: off < 0.01 ? 0 : 160 });
  });
}

/**
 * @param {HTMLElement} container the element the map fills
 * @param {object} opts
 * @param {object} opts.view `{ lat, lon, zoom }` the map opens on
 * @param {boolean} [opts.imperial] scale bar in miles rather than metres
 */
export async function createMapEngine(container, { view, imperial = false } = {}) {
  const map = new MapLibreMap({
    container,
    style: EMPTY_STYLE,
    center: [view.lon, view.lat],
    zoom: engineZoom(view.zoom),
    // flat: an oblique view is the 3D map's, and it records a pitch of its own
    maxPitch: 0,
    pitchWithRotate: false,
    // the tool turns the map itself, from a middle- or shift-drag, around the
    // point that was grabbed rather than around the centre (lib/map/gestures.js)
    dragRotate: false,
    boxZoom: false,
    // the full credit line, as the tile providers' terms ask for it, rather
    // than the engine's ⓘ button on a narrow window
    attributionControl: { compact: false },
  });
  // stacked below the top-left tool cluster (fullscreen/labels/measure) via a
  // CSS offset, instead of the engine's default corner margin
  map.addControl(new NavigationControl({ showCompass: false }), 'top-left');
  // judging feature sizes (buildings, roads) needs a scale reference
  map.addControl(
    new ScaleControl({ unit: imperial ? 'imperial' : 'metric' }),
    'bottom-right'
  );
  map.scrollZoom.setWheelZoomRate(WHEEL_ZOOM_RATE);
  // A source cannot be added before the style is up, and `basemap.js` adds one
  // as soon as this returns.
  await map.once('load');
  settleOnLevel(map);
  // A stable class for the tool's own cursor rules: a mode armed above the map
  // says so on the surface, whichever engine drew it.
  container.classList.add('map-surface');
  // The one thing outside code waits on. A browser test cannot ask the façade
  // whether the map is up, and asking it to recognise the engine's own class
  // names is how a suite ends up pinned to the engine it was written against.
  container.dataset.mapReady = 'true';
  return mapFacade(map, container);
}
