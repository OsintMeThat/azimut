<script>
  /**
   * One map, complete: the engine, its basemap, and everything that describes
   * the pixels on it.
   *
   * A tool mounts one of these today and several tomorrow (SPEC v3, Compare),
   * which is the whole reason it exists as a component rather than as the top
   * of Satellite.svelte. So the line it draws is between *the map* and *the
   * work being done on it*: which imagery is showing, which way is up, when the
   * imagery was taken and how far a pixel goes all belong to the surface and
   * would be wrong shared between two of them. The capture frame, the marks,
   * the saved pins and the panels are the tool's, and arrive through `children`
   * — rendered inside this wrapper so they are positioned against this map.
   *
   * The camera reports out rather than being driven in: the engine settles a
   * pan on a whole zoom level and wraps a longitude back inside ±180, and a
   * parent that assumed otherwise would fight it. `engine` and `element` are
   * handed back for the acts a tool owns — flying to a saved point, the drag
   * gestures it arms over the map, and linking two surfaces on one camera
   * (`lib/map/cameraLink.js`).
   *
   * The catalogue and the month's tally are shared (state/imagery.svelte.js):
   * a tile counted against the month is counted once, however many surfaces
   * drew it. Which provider *this* surface shows is its own.
   */
  import { onMount, tick } from 'svelte';
  import { createMapEngine } from '../../lib/map/engine.js';
  import { createBasemaps, OVERLAY_IDS } from '../../lib/map/basemap.js';
  import { DEFAULT_LAYER, DEFAULT_MAXCC, SENTINEL_ID } from '../../lib/sentinel.js';
  import Icon from '../../components/Icon.svelte';
  import Compass from '../../components/Compass.svelte';
  import ImageryChip from './ImageryChip.svelte';

  let {
    /** The shared catalogue + meter (state/imagery.svelte.js). */
    imagery,
    /** The basemap this surface is asked to show. Changed from its own chip:
     *  which picture is on screen is the surface's, not the tool's. */
    providerId = $bindable(),
    /** This surface's Sentinel-2 choices, when that basemap is on it. */
    s2 = null,
    /** This surface's Wayback release (state/wayback.svelte.js), likewise. */
    wayback = null,
    /** What is laid over the imagery: an id (`OVERLAY_IDS`), or `{ id, params }`
     *  for one whose address is a question — FIRMS's sensor and window. The
     *  tool decides which are offered; the surface only puts them on. */
    overlays = [],
    /** Scale bar in miles rather than metres. */
    imperial = false,
    /** The view the map opens on. Read once, at build. */
    home,
    /** Satellite starts at home; linked Compare surfaces keep their bound view. */
    resetToHome = true,
    /** Where the camera is now. Reported out; the engine is what moves it. */
    view = $bindable({ lat: 0, lon: 0, zoom: 2 }),
    bearing = $bindable(0),
    /** The façade, once the map is up. Null while it is not. */
    engine = $bindable(null),
    /** The map container, for the drag gestures a tool arms over it. */
    element = $bindable(null),
    ready = $bindable(false),
    refused = $bindable(false),
    /** A mode armed above the map, which the cursor says: 'measuring' |
     *  'selecting' | 'grid-drawing' | 'tracing' | null. */
    armed = null,
    /** Hide this surface's own chrome for a screen capture. */
    grabbing = false,
    /** False hides this surface's own corner (provider, date, compass) for a
     *  tool that shows them itself, as Compare does over its two maps. */
    chrome = true,
    /** When the pixels under the crosshair were taken, reported out:
     *  `{ date, exact, source }`, or null when nothing can say. */
    dated = $bindable(null),
    /** A view zoom this surface stops at below its provider's own ceiling, so
     *  two linked surfaces stop together. Null leaves the provider in charge. */
    zoomCeiling = null,
    /** How far down the engine's zoom buttons start, so they stack under
     *  whatever the tool floats in the same corner (see `engine.css`). */
    controlsTop = 58,
    /** A click on the map, `{ lat, lon }`. */
    onclick = () => {},
    /** A right-click on the ground, `{ lat, lon, x, y }` in this surface's pixels. */
    oncontextmenu = () => {},
    /** Metered tiles went out. The proxy counted them; the tally is just stale. */
    onusage = () => {},
    /** A widget basemap was built, which is one billed map load. Nothing but
     *  this page saw it happen, so it has to be counted here or not at all. */
    onwidgetload = () => {},
    onwidgetauthfailure = () => {},
    onwidgetfailed = () => {},
    /** The settled camera and the turn, for a parent that shares them. */
    onviewsettled = () => {},
    onbearingchange = () => {},
    children,
  } = $props();

  let mapEl = $state();
  let basemaps = null;
  // Acquisition date of the imagery under the crosshair — Esri only.
  let imageryDate = $state(null); // { supported, date, source } | null
  let dateRequest = 0;
  let dateTimer;
  /**
   * What this surface actually shows, which is not always what it was asked
   * for: a billed basemap steps aside when the month is nearly spent or the
   * view is zoomed out. The capture and the imagery date follow the display,
   * so provenance always matches the pixels.
   */
  const shown = $derived(
    imagery.displayed(providerId, view.zoom, {
      ...(s2?.variant ?? {}),
      release: wayback?.release ?? null,
    })
  );

  /** A pinned Sentinel-2 day *is* the acquisition date — the one provider that
   *  can answer "when was this taken?" without being asked. */
  const pinnedDay = $derived(
    shown.provider?.id === SENTINEL_ID && s2?.window.from ? s2.window.from : null
  );

  $effect(() => {
    dated = pinnedDay
      ? { date: pinnedDay, exact: true, source: 'Sentinel-2' }
      : shown.provider?.id === SENTINEL_ID
        ? s2?.latest ? { date: s2.latest, exact: false, source: 'Sentinel-2' } : null
        : imageryDate?.supported && imageryDate.date
          ? { date: imageryDate.date, exact: false, source: imageryDate.source ?? null }
          : null;
  });

  export function resize() {
    engine?.resize();
  }

  /** What a capture of this surface must record: the pixels' own provenance. */
  export function provenance() {
    return { provider: shown.id, imageryDate: pinnedDay ?? imageryDate?.date ?? null };
  }

  // Svelte only honours a cleanup returned from a *synchronous* onMount, and the
  // build below has to await the engine. So onMount stays synchronous and hands
  // back a teardown that runs whatever the async build registered.
  onMount(() => {
    let teardown = null;
    let gone = false;
    build().then((cleanup) => {
      if (gone) cleanup?.();
      else teardown = cleanup;
    });
    return () => {
      gone = true;
      teardown?.();
    };
  });

  async function build() {
    if (resetToHome) view = { ...home };
    try {
      engine = await createMapEngine(mapEl, { view, imperial });
    } catch (e) {
      // The engine draws through WebGL and a browser can refuse it: an old
      // driver, a machine with no GPU, a profile hardened to turn it off. It
      // throws on the way up, and nothing below this line means anything
      // without a map — so the surface says so instead of drawing an empty
      // panel and leaving the analyst to wonder which part broke.
      console.error(e);
      refused = true;
      return null;
    }
    element = mapEl;
    engine.setBearing(bearing);
    basemaps = createBasemaps(engine, {
      onMeteredTiles: onusage,
      // one billed map load, counted where it happens (the proxy can't see it)
      onWidgetLoad: (provider) => onwidgetload(provider.meter),
      onWidgetAuthFailure: onwidgetauthfailure,
      onWidgetFailed: onwidgetfailed,
    });
    basemaps.setZoomCeiling(zoomCeiling);
    showBasemap();
    showOverlays();
    // the façade wraps the centre back inside ±180 for us, which is what every
    // route a capture reaches enforces
    const offSettled = engine.on('view-settled', (settled) => {
      view = { lat: settled.lat, lon: settled.lon, zoom: settled.zoom };
      onviewsettled(settled);
    });
    const offRotate = engine.on('rotate', (turned) => {
      bearing = Math.round(turned.bearing);
      onbearingchange(turned);
    });
    const offClick = engine.on('click', (at) => onclick(at));
    const offMenu = engine.on('contextmenu', (at) => oncontextmenu(at));
    ready = true;
    return () => {
      offSettled();
      offRotate();
      offClick();
      offMenu();
      basemaps.dispose();
      engine.destroy();
      engine = null;
      element = null;
      ready = false;
    };
  }

  function showBasemap() {
    if (!shown.provider || !basemaps) return;
    basemaps.show(shown.provider, shown.id, shown.cell);
  }

  $effect(() => {
    const value = zoomCeiling;
    if (ready) basemaps?.setZoomCeiling(value);
  });

  $effect(() => {
    shown.id; // a new provider, a new eco/block fallback, a new Sentinel window
    shown.cell; // …and the z17 detail-boost bracket
    showBasemap();
  });

  function showOverlays() {
    const asked = new Map(
      overlays.map((entry) =>
        typeof entry === 'string' ? [entry, null] : [entry.id, entry.params ?? null]
      )
    );
    for (const id of OVERLAY_IDS) basemaps.setOverlay(id, asked.has(id), asked.get(id));
  }

  $effect(() => {
    // Read whole, before the guard, and deeply: `basemaps?.` would short-circuit
    // the dependency away while the map is still being built, and a toggle would
    // then never reach the layers again (build() applies the opening state). A
    // layer that carries a question re-reads when the question changes.
    JSON.stringify(overlays);
    if (basemaps) showOverlays();
  });

  // debounce: the target moves a lot while panning — only ask once it settles
  $effect(() => {
    view.lat;
    view.lon;
    view.zoom;
    shown.id;
    if (!ready) return;
    clearTimeout(dateTimer);
    dateTimer = setTimeout(readImageryDate, 500);
    return () => clearTimeout(dateTimer);
  });

  async function readImageryDate() {
    const mine = ++dateRequest;
    try {
      const answer = await imagery.imageryDate(view, shown.id);
      if (mine === dateRequest) imageryDate = answer;
    } catch {
      if (mine === dateRequest) imageryDate = { supported: true, date: null, source: null };
    }
  }

  function setBearing(deg) {
    engine?.setBearing(deg); // the façade normalises whatever it is handed
  }

  // the container resizes when a panel opens or the window changes, and
  // reappears from display:none when the tool tab is re-selected
  export async function remeasure() {
    await tick();
    engine?.resize();
  }
</script>

<div
  class="map-wrap dark-surface"
  class:measuring={armed === 'measuring'}
  class:selecting={armed === 'selecting'}
  class:grid-drawing={armed === 'grid-drawing'}
  class:tracing={armed === 'tracing'}
  class:grabbing
  style:--map-controls-top={`${controlsTop}px`}
>
  <div class="map" bind:this={mapEl}></div>

  {#if refused}
    <p class="map-refused">The map needs WebGL, which this browser does not have.</p>
  {/if}

  {@render children?.()}

  <!-- The picture this surface is showing, when it was taken, and the compass
       reading how it is turned: all facts about this map and belonging to it,
       which is what lets two surfaces sit side by side each saying its own. -->
  {#if chrome}
  <div class="surface-ctl">
    <ImageryChip {imagery} bind:providerId {s2} {wayback} {shown} />

  <!-- …and when the pixels under the crosshair were taken. Under the provider
       rather than in the opposite corner: it describes that same picture, and
       the corner it used to sit in is the instrument's, where the scale bracket
       reads. -->
  {#if s2 && shown.provider?.id === SENTINEL_ID}
    <!-- Sentinel-2 says what it is showing: a pinned day is the window the tiles
         were rendered from; otherwise the layer's default renders the most
         recent pass, which the calendar lookup has already named. -->
    <span
      class="date-pill mono"
      class:exact={!!pinnedDay}
      title={pinnedDay
        ? `Sentinel-2 ${s2.layerLabel} from this exact date`
        : s2.latest
          ? `Sentinel-2 ${s2.layerLabel}: most recent pass over this point`
          : `Sentinel-2 ${s2.layerLabel}: most recent pass (open the picker to date it)`}
    >
      <Icon name="clock" size={11} />
      {pinnedDay ?? s2.latest ?? ''}
      {#if !pinnedDay}
        <span class="tag">{s2.latest ? 'latest' : 'most recent'}</span>
      {/if}
      {#if s2.layer !== DEFAULT_LAYER}
        <span class="tag layer">{s2.layerShort}</span>
      {/if}
      {#if s2.maxcc !== DEFAULT_MAXCC}
        <span class="tag" title="Passes over this cloud cover are not rendered"
          >≤{s2.maxcc}% cloud</span
        >
      {/if}
    </span>
  {:else if imageryDate?.supported}
    <span
      class="date-pill mono"
      title={imageryDate.source
        ? `Imagery acquired around this date (source: ${imageryDate.source})`
        : 'Approximate acquisition date of the imagery here'}
    >
      <Icon name="clock" size={11} />
      {imageryDate.date ?? '—'}
    </span>
  {/if}

    <!-- Which way is up. Middle-dragging the map is what turns it. -->
    <Compass {bearing} onbearing={setBearing} />
  </div>
  {/if}
</div>

<style>
  .map-wrap {
    position: relative;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    /* keep the map's z-index range (the engine's own controls, our clusters above
       them, and the widget basemap on a negative layer below) to itself, so a
       dialog portalled into the fullscreen tool still lands on top of it */
    isolation: isolate;
  }
  .map {
    position: absolute;
    inset: 0;
    background: var(--bg-2);
  }
  .map-refused {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    margin: 0;
    padding: 0 24px;
    text-align: center;
    color: var(--text-2);
  }
  /* Mid screen-grab: a widget capture crops the map element's *rectangle*, so
     everything we paint over the map (HUD, control clusters, capture bar,
     reference windows, the frame outline itself) would land in the capture.
     Hide our chrome for the grab and leave the map — Google's own credits live
     inside it and must ride along. The marker is the deliberate exception: the
     tile path burns one into its crop, so a screen crop keeps its own.
     :global is load-bearing — the reference windows are a child component, so
     a scoped selector would skip exactly the overlay the spec says must never
     be captured. */
  .map-wrap.grabbing > :global(:not(.map):not(.marker-overlay)) {
    visibility: hidden;
  }
  .map-wrap.measuring :global(.map-surface),
  .map-wrap.selecting :global(.map-surface),
  .map-wrap.grid-drawing :global(.map-surface),
  .map-wrap.tracing :global(.map-surface) {
    cursor: crosshair;
  }
  /* imagery date: small, low-contrast pill riding under the provider it dates */
  .date-pill {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border-radius: var(--r-sm);
    font-size: var(--fs-xs);
    color: var(--text-3);
    background: rgba(24, 24, 24, 0.7);
    backdrop-filter: blur(6px);
    box-shadow: 0 0 0 1px var(--border);
  }
  /* a pinned date is a fact about the pixels; "latest" is an inference from the
     pass list — they must not look identical */
  .date-pill.exact {
    color: var(--text-2);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--ok, #46a758) 55%, transparent);
  }
  .date-pill .tag {
    font-family: var(--font-sans);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-3);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 0 3px;
  }
  .date-pill .tag.layer {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  }
  /* the surface's own corner: what it is showing, then how it is turned */
  .surface-ctl {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 600;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    /* the column is only as wide as its widest control, so the map stays
       grabbable everywhere the controls are not */
    pointer-events: none;
  }
  .surface-ctl > :global(*) {
    pointer-events: auto;
  }
</style>
