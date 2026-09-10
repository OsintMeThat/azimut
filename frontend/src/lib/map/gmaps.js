/**
 * Google Maps JavaScript API — loader, key probe, and the basemap under glass.
 *
 * The EEA-viable Google satellite route (docs/IMAGERY_PROVIDERS.md § Google in
 * the EEA): a real google.maps.Map rendered by the official JS API. Google's
 * own map is the only thing on the page that may draw those pixels — its terms
 * forbid taking them out of it — so instead of feeding tiles into our map, this
 * puts Google's map *underneath* it and keeps the two cameras in step. The
 * engine's canvas is transparent where nothing is drawn, so the imagery shows
 * through and every overlay above it (measure tools, marks, grids, labels)
 * keeps working, untouched and unaware.
 *
 * Local-first: nothing here runs until the user actually selects the widget
 * basemap — the script load *is* the user action needing the network.
 *
 * Billing: one "dynamic map load" per google.maps.Map instantiation; pan/zoom
 * afterwards is free. The glass must therefore be created once and hidden
 * rather than destroyed when the analyst switches basemap — see `basemap.js`.
 */
import { exactViewZoom } from './facade.js';

/** Where Google's terms live, for the credit we state when Google's own is absent. */
const TERMS_URL = 'https://www.google.com/intl/en/help/terms_maps/';

let loadPromise = null;
let loadedKey = null; // the key the script was loaded with — one per page life

/** The API key the Maps JS script is already bound to, if loaded. Google's
 * script can't be re-loaded with another key without a full page reload, so
 * a key change after load can only be tested by reloading the app. */
export function googleMapsLoadedKey() {
  return loadedKey;
}

/**
 * Load the Maps JS API from the provider's loader URL (key included — a JS
 * API key is client-side by design, referrer-restricted rather than secret).
 *
 * `onAuthFailure` fires if Google rejects the key — that can happen minutes
 * after a successful load (gm_authFailure is async), so the caller must
 * handle it as a runtime event, not a load error.
 */
export function loadGoogleMaps(loaderUrl, { onAuthFailure } = {}) {
  // gm_authFailure is Google's only key-rejection signal; keep it wired even
  // when the script is already loaded (a Settings re-test swaps the handler)
  window.gm_authFailure = () => onAuthFailure?.();
  if (window.google?.maps) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadedKey = keyFromLoaderUrl(loaderUrl);
  loadPromise = new Promise((resolve, reject) => {
    const cb = '__azimutGmapsReady';
    window[cb] = () => {
      delete window[cb];
      resolve();
    };
    const script = document.createElement('script');
    script.src = `${loaderUrl}&loading=async&callback=${cb}`;
    script.async = true;
    script.onerror = () => {
      loadPromise = null; // a network failure may be transient — allow retry
      delete window[cb];
      reject(new Error('could not load the Google Maps script'));
    };
    document.head.appendChild(script);
  });
  return loadPromise;
}

/**
 * Prove a Maps JS key in the only place it can be proven: a real map in this
 * browser. Loads the script, spins up a hidden 1-tile satellite map and races
 * `tilesloaded` (key works) against `gm_authFailure` (Google rejected it) and
 * a timeout. Because Google's script binds to one key per page life, a
 * *changed* key can only be re-probed after a reload — callers should check
 * googleMapsLoadedKey() first.
 *
 * The verdict carries `billed`: the probe's own map is a real dynamic map load
 * on the user's bill, and no backend proxy can see it, so the caller must
 * report it to the usage counter or the counter drifts under Google's number.
 */
export async function probeKey(loaderUrl, { timeoutMs = 12000 } = {}) {
  let rejected = false;
  try {
    await loadGoogleMaps(loaderUrl, { onAuthFailure: () => (rejected = true) });
  } catch (e) {
    // the script never loaded, so no map was ever constructed — nothing billed
    return { ok: false, detail: e.message, billed: false };
  }
  const holder = document.createElement('div');
  // Must stay INSIDE the viewport: Chrome culls rendering for off-screen
  // fixed elements, so an off-screen map never fires `tilesloaded` and the
  // probe times out on a perfectly good key (verified headless, 2026-07).
  // Near-zero opacity keeps it invisible without suppressing rendering.
  holder.style.cssText =
    'position:fixed;left:0;bottom:0;width:128px;height:128px;opacity:0.01;pointer-events:none';
  document.body.appendChild(holder);
  try {
    const verdict = await new Promise((resolve) => {
      const timer = setTimeout(
        () => resolve({ ok: false, detail: 'no response from Google (timeout)' }),
        timeoutMs
      );
      window.gm_authFailure = () => {
        rejected = true;
        clearTimeout(timer);
        resolve({ ok: false, detail: 'Google rejected the key (gm_authFailure)' });
      };
      const map = new window.google.maps.Map(holder, {
        center: { lat: 0, lng: 0 },
        zoom: 1,
        mapTypeId: 'satellite',
        disableDefaultUI: true,
      });
      map.addListener('tilesloaded', () => {
        clearTimeout(timer);
        resolve(
          rejected
            ? { ok: false, detail: 'Google rejected the key (gm_authFailure)' }
            : { ok: true, detail: 'satellite map rendered' }
        );
      });
    });
    // A google.maps.Map was constructed above, and Google bills one dynamic map
    // load for every one it accepts — this throwaway included. Only a key it
    // rejected is free: there is no valid project to bill it to. A timeout still
    // counts, since the map was built and we cannot prove it was not served.
    return { ...verdict, billed: !rejected };
  } finally {
    holder.remove();
  }
}

function keyFromLoaderUrl(url) {
  try {
    return new URL(url).searchParams.get('key');
  } catch {
    return null;
  }
}

/**
 * Google's own credit, stated by us.
 *
 * Only reached if Google's markup stops offering the node this moves upright —
 * the imagery is never shown bare, and the terms link stays reachable.
 */
function statedCredit(attribution) {
  const holder = document.createDocumentFragment();
  const text = document.createElement('span');
  text.textContent = attribution;
  const terms = document.createElement('a');
  terms.href = TERMS_URL;
  terms.target = '_blank';
  terms.rel = 'noopener noreferrer';
  terms.textContent = 'Terms';
  holder.append(text, terms);
  return holder;
}

/**
 * Google's satellite map, under the engine's transparent canvas.
 *
 * One billed dynamic map load per call, so `basemap.js` calls it once and hides
 * the result rather than making another.
 *
 * Two things make this work at any bearing. The map div is a square of the
 * container's *diagonal*, centred on it, because a rotated W×H rectangle always
 * fits inside the circle of its own diagonal — so every bearing is covered
 * without asking Google to redraw. And it is turned by CSS rather than by
 * Google, which has no bearing of its own on a raster satellite map.
 *
 * @param {object} engine the façade from `engine.js`
 * @param {object} [opts]
 * @param {number} [opts.maxZoom] the provider's own view ceiling
 * @param {string} [opts.attribution] what to state if Google's own node is gone
 */
export function createGoogleGlass(engine, { maxZoom = 21, attribution = 'Map data © Google' } = {}) {
  const map = engine.impl;
  const glass = document.createElement('div');
  glass.className = 'map-glass';
  glass.hidden = true;
  const turn = document.createElement('div');
  turn.className = 'map-glass-turn';
  const surface = document.createElement('div');
  surface.className = 'map-glass-map';
  const credit = document.createElement('div');
  credit.className = 'map-glass-credit';
  credit.replaceChildren(statedCredit(attribution));
  turn.append(surface);
  glass.append(turn, credit);
  engine.container.append(glass);

  const centre = map.getCenter();
  const google = new window.google.maps.Map(surface, {
    center: { lat: centre.lat, lng: centre.lng },
    zoom: exactViewZoom(map.getZoom()),
    mapTypeId: 'satellite',
    maxZoom,
    // Our map owns every gesture and every control; this one only ever renders
    // what it is told to. `pointer-events: none` on the glass says the same
    // thing to the browser, and both are needed: one stops Google's own
    // handlers, the other stops the pointer ever reaching them.
    disableDefaultUI: true,
    gestureHandling: 'none',
    keyboardShortcuts: false,
    // the camera it follows is continuous, so it must be able to sit between
    // whole levels rather than snapping and drifting out of register
    isFractionalZoomEnabled: true,
    tilt: 0,
  });

  /**
   * Google's own credit line, kept upright and clickable.
   *
   * It renders inside the map div, which is oversized and turned, so at any
   * bearing it would be rotated and pushed off screen. Moving the node into an
   * upright holder is the same trick the plugin used before this did.
   */
  function homeCredit() {
    const own = surface.querySelectorAll('.gm-style-cc');
    if (!own.length) return;
    credit.replaceChildren(...own);
  }
  window.google.maps.event.addListenerOnce(google, 'tilesloaded', homeCredit);

  /** Cover the container at every bearing, centred on it. */
  function fit() {
    const width = engine.container.clientWidth;
    const height = engine.container.clientHeight;
    const side = Math.ceil(Math.hypot(width, height));
    turn.style.width = `${side}px`;
    turn.style.height = `${side}px`;
    turn.style.left = `${Math.round((width - side) / 2)}px`;
    turn.style.top = `${Math.round((height - side) / 2)}px`;
    window.google?.maps?.event?.trigger(google, 'resize');
  }

  /** Put Google's camera where ours is. */
  function follow() {
    const at = map.getCenter();
    google.moveCamera({
      center: { lat: at.lat, lng: at.lng },
      zoom: exactViewZoom(map.getZoom()),
    });
    // The app's bearing turns the map clockwise and so does CSS `rotate()`, so
    // this is the app's own number — the engine counts the same turn the other
    // way (see `facade.js`).
    turn.style.transform = `rotate(${-map.getBearing()}deg)`;
  }

  const onResize = () => {
    fit();
    follow();
  };

  let shown = false;

  function hide() {
    if (!shown) return;
    shown = false;
    glass.hidden = true;
    map.off('move', follow);
    map.off('resize', onResize);
  }

  return {
    show() {
      if (shown) return;
      shown = true;
      glass.hidden = false;
      map.on('move', follow);
      map.on('resize', onResize);
      onResize();
    },

    hide,

    destroy() {
      hide();
      glass.remove();
    },
  };
}
