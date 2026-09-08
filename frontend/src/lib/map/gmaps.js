/**
 * Google Maps JavaScript API — loader + GoogleMutant layer factory.
 *
 * The EEA-viable Google satellite route (docs/IMAGERY_PROVIDERS.md § Google in
 * the EEA): a real google.maps.Map rendered by the official JS API, synced
 * under Leaflet by the GoogleMutant plugin so every Leaflet overlay (measure
 * tools, markers, reference windows, labels) keeps working on top.
 *
 * Local-first: nothing here runs until the user actually selects the widget
 * basemap — the script load *is* the user action needing the network.
 *
 * Billing: one "dynamic map load" per google.maps.Map instantiation; pan/zoom
 * afterwards is free. The mutant layer must therefore be created once and
 * reused across basemap switches — see the layer cache in Satellite.svelte.
 */
// Import the plugin's ESM source and use its exported class directly. Both of
// its other integration surfaces are broken under a bundler (verified 2026-07):
// the bare specifier resolves to the "browser" IIFE build, which reads `this.L`
// and crashes the whole app at load (`this` is undefined in strict ESM), and
// the .mjs's own `L.gridLayer.googleMutant` factory binds to a global `L` it
// never imports, so `new L.GridLayer.GoogleMutant` is "not a constructor".
import GoogleMutant from 'leaflet.gridlayer.googlemutant/src/Leaflet.GoogleMutant.mjs';

/**
 * GoogleMutant, but able to survive a rotated map.
 *
 * The mutant works by running a hidden google.maps.Map and cloning its <img>
 * tile nodes into a plain Leaflet GridLayer — so the visible tiles rotate with
 * the tile pane like any other layer. What breaks is coverage: the hidden map
 * is sized to the Leaflet container, so Google only ever renders the tiles of
 * an unrotated viewport, while leaflet-rotate asks the grid for the rotated
 * bounding box. The corner tiles are never cloned and the view has holes.
 *
 * Sizing the hidden map to a square of the container's diagonal, centred on it,
 * covers every bearing at once — a rotated W×H rect always fits inside the
 * circle of its own diagonal — so no rotation handler is needed here. It costs
 * extra tile renders inside the hidden map, but not extra billing: the dynamic
 * map load is charged per google.maps.Map, and panning/rendering after it is
 * free.
 */
class RotatableGoogleMutant extends GoogleMutant {
  _initMutantContainer() {
    super._initMutantContainer();
    this._fitMutantToDiagonal();
    this._map.on('resize', this._fitMutantToDiagonal, this);
  }

  onRemove(map) {
    map.off('resize', this._fitMutantToDiagonal, this);
    return super.onRemove(map);
  }

  _fitMutantToDiagonal() {
    if (!this._map || !this._mutantContainer) return;
    const size = this._map.getSize();
    const side = Math.ceil(Math.sqrt(size.x * size.x + size.y * size.y));
    const style = this._mutantContainer.style;
    style.width = `${side}px`;
    style.height = `${side}px`;
    // the container is .leaflet-top.leaflet-left (pinned at 0,0) — pull it back
    // by half the overflow so the hidden map stays concentric with Leaflet's,
    // which is what makes the coverage symmetric on all four sides
    style.marginLeft = `${Math.round((size.x - side) / 2)}px`;
    style.marginTop = `${Math.round((size.y - side) / 2)}px`;
    if (this._mutant) window.google?.maps?.event?.trigger(this._mutant, 'resize');
  }
}

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

/** A GoogleMutant satellite layer — one billed map load per creation. */
export function createSatelliteMutant(maxZoom = 21, attribution = 'Map data © Google') {
  return new RotatableGoogleMutant({ type: 'satellite', maxZoom, attribution });
}
