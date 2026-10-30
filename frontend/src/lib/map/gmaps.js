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

/**
 * Google's refusals of a map, by the name it logs them under, and what to do.
 *
 * Only a bad key calls `gm_authFailure`. Billing switched off, the API not
 * enabled or the quota spent are said in the console alone, while the map
 * goes on drawing dimmed tiles under "For development purposes only".
 */
export const GOOGLE_REFUSALS = {
  BillingNotEnabledMapError:
    "Billing is off on the key's Google Cloud project. Attach a billing account to it, then test the key in Settings",
  ApiNotActivatedMapError:
    "The Maps JavaScript API is not enabled on the key's project. Enable it, then test the key in Settings",
  ApiTargetBlockedMapError:
    "The key's API restrictions leave out the Maps JavaScript API. Add it to the key in the Cloud Console",
  OverQuotaMapError: "The project's Maps JavaScript quota is spent. Raise it in the Cloud Console or wait for the reset",
  RefererNotAllowedMapError:
    "The key's website restriction blocks this app. Allow http://127.0.0.1:*/* and http://localhost:*/* on it",
  InvalidKeyMapError: 'Google does not know this key. Check it in Settings',
  ExpiredKeyMapError: 'This key has expired. Create a new one and save it in Settings',
  MissingKeyMapError: 'No key reached Google. Save the key in Settings',
  DeletedApiProjectMapError: "The key's Cloud project was deleted. Create a key on a live project",
  ProjectDeniedMapError: "Google refused the key's Cloud project. Check it in the Cloud Console",
};

/** What a bare `gm_authFailure` says, Google having named nothing. */
const KEY_REJECTED = 'Google rejected the key. Check it in Settings';
const ERROR_LINE = /Google Maps JavaScript API error: (\w+)/;
/** How long a refusal waits for Google's other word on it, ms: a bad key gets both signals, in no set order. */
const REFUSAL_SETTLE_MS = 200;

/** Who hears the next refusal: the map on show, or a key test while it runs. */
let onRefused = null;
/** The refusal waiting out REFUSAL_SETTLE_MS, `{ reason }`, or null. */
let refusal = null;
let hearing = false;

/** Tell the one refusal of a burst, Google's own name for it winning over the bare signal. */
function refuse(reason, named) {
  if (refusal) {
    if (named) refusal.reason = reason;
    return;
  }
  refusal = { reason };
  setTimeout(() => {
    const said = refusal.reason;
    refusal = null;
    onRefused?.(said);
  }, REFUSAL_SETTLE_MS);
}

/** The refusal named in a console line Google wrote, or null. */
export function refusalCode(args) {
  for (const arg of args) {
    const text = typeof arg === 'string' ? arg : arg?.message;
    const match = typeof text === 'string' ? ERROR_LINE.exec(text) : null;
    if (match && Object.hasOwn(GOOGLE_REFUSALS, match[1])) return match[1];
  }
  return null;
}

/**
 * Read Google's console errors as they pass, since they are the only place
 * most refusals are said. Installed before the script loads, so the script
 * writes through it; every line still reaches the console unchanged.
 */
function hearGoogleErrors() {
  if (hearing) return;
  hearing = true;
  const say = console.error;
  console.error = function (...args) {
    say.apply(this, args);
    const code = refusalCode(args);
    if (code) refuse(GOOGLE_REFUSALS[code], true);
  };
}

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
 * `onRefused(reason)` fires when Google refuses the map, with what to do about
 * it. That comes after a clean load, sometimes minutes after, so the caller
 * must handle it as a runtime event, not a load error.
 */
export function loadGoogleMaps(loaderUrl, { onRefused: heard } = {}) {
  hearGoogleErrors();
  // kept wired even when the script is already loaded: a Settings re-test swaps the listener
  onRefused = heard ?? null;
  window.gm_authFailure = () => refuse(KEY_REJECTED, false);
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
 * `tilesloaded` (key works) against a refusal (see GOOGLE_REFUSALS) and a
 * timeout. A refused project still draws its tiles, dimmed, so the map
 * rendering only counts once `graceMs` has passed with no refusal. Because
 * Google's script binds to one key per page life, a *changed* key can only be
 * re-probed after a reload — callers should check googleMapsLoadedKey() first.
 *
 * The verdict carries `billed`: the probe's own map is a real dynamic map load
 * on the user's bill, and no backend proxy can see it, so the caller must
 * report it to the usage counter or the counter drifts under Google's number.
 */
export async function probeKey(loaderUrl, { timeoutMs = 12000, graceMs = 3000 } = {}) {
  let rejected = false;
  // the map on show hears its refusals again once the test is over
  const before = onRefused;
  try {
    await loadGoogleMaps(loaderUrl, { onRefused: () => (rejected = true) });
  } catch (e) {
    onRefused = before;
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
      let grace = null;
      const timer = setTimeout(
        () => resolve({ ok: false, detail: 'no response from Google (timeout)' }),
        timeoutMs
      );
      onRefused = (reason) => {
        rejected = true;
        clearTimeout(timer);
        clearTimeout(grace);
        resolve({ ok: false, detail: reason });
      };
      const map = new window.google.maps.Map(holder, {
        center: { lat: 0, lng: 0 },
        zoom: 1,
        mapTypeId: 'satellite',
        disableDefaultUI: true,
      });
      map.addListener('tilesloaded', () => {
        clearTimeout(timer);
        if (rejected) return; // its refusal is on its way
        grace = setTimeout(() => resolve({ ok: true, detail: 'satellite map rendered' }), graceMs);
      });
    });
    // A google.maps.Map was constructed above, and Google bills one dynamic map
    // load for every one it accepts — this throwaway included. Only a key it
    // rejected is free: there is no valid project to bill it to. A timeout still
    // counts, since the map was built and we cannot prove it was not served.
    return { ...verdict, billed: !rejected };
  } finally {
    onRefused = before;
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
