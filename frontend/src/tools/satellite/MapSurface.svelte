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
   * handed back for the acts a tool owns — flying to a saved point, and the
   * drag gestures it arms over the map.
   *
   * The catalogue and the month's tally are shared (state/imagery.svelte.js):
   * a tile counted against the month is counted once, however many surfaces
   * drew it. Which provider *this* surface shows is its own.
   */
  import { onMount, tick } from 'svelte';
  import { createMapEngine } from '../../lib/map/engine.js';
  import { createBasemaps } from '../../lib/map/basemap.js';
  import { DEFAULT_LAYER, DEFAULT_MAXCC, SENTINEL_ID } from '../../lib/sentinel.js';
  import Icon from '../../components/Icon.svelte';

  let {
    /** The shared catalogue + meter (state/imagery.svelte.js). */
    imagery,
    /** The basemap this surface is asked to show. */
    providerId,
    /** This surface's Sentinel-2 choices, when that basemap is on it. */
    s2 = null,
    /** Labels laid over the imagery. Only ever meaningful over a satellite base. */
    labels = false,
    /** Scale bar in miles rather than metres. */
    imperial = false,
    /** The view the map opens on. Read once, at build. */
    home,
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
     *  'selecting' | 'grid-drawing' | null. */
    armed = null,
    /** Hide this surface's own chrome for a screen capture. */
    grabbing = false,
    /** A click on the map, `{ lat, lon }`. */
    onclick = () => {},
    /** Metered tiles went out. The proxy counted them; the tally is just stale. */
    onusage = () => {},
    /** A widget basemap was built, which is one billed map load. Nothing but
     *  this page saw it happen, so it has to be counted here or not at all. */
    onwidgetload = () => {},
    onwidgetauthfailure = () => {},
    onwidgetfailed = () => {},
    children,
  } = $props();

  let mapEl = $state();
  let basemaps = null;
  let editingBearing = $state(false);
  let bearingInput = $state('');
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
  const shown = $derived(imagery.displayed(providerId, view.zoom, s2?.variant));

  /** A pinned Sentinel-2 day *is* the acquisition date — the one provider that
   *  can answer "when was this taken?" without being asked. */
  const pinnedDay = $derived(
    shown.provider?.id === SENTINEL_ID && s2?.window.from ? s2.window.from : null
  );

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
    view = { ...home };
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
    basemaps = createBasemaps(engine, {
      onMeteredTiles: onusage,
      // one billed map load, counted where it happens (the proxy can't see it)
      onWidgetLoad: (provider) => onwidgetload(provider.meter),
      onWidgetAuthFailure: onwidgetauthfailure,
      onWidgetFailed: onwidgetfailed,
    });
    showBasemap();
    basemaps.setLabels(labels);
    // the façade wraps the centre back inside ±180 for us, which is what every
    // route a capture reaches enforces
    const offSettled = engine.on('view-settled', (settled) => {
      view = { lat: settled.lat, lon: settled.lon, zoom: settled.zoom };
    });
    const offRotate = engine.on('rotate', (turned) => {
      bearing = Math.round(turned.bearing);
    });
    const offClick = engine.on('click', (at) => onclick(at));
    ready = true;
    return () => {
      offSettled();
      offRotate();
      offClick();
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
    shown.id; // a new provider, a new eco/block fallback, a new Sentinel window
    shown.cell; // …and the z17 detail-boost bracket
    showBasemap();
  });

  $effect(() => {
    const on = labels; // read before the guard: `basemaps?.` short-circuits away
    // the dependency while the map is still being built, and the toggle then
    // never reaches the layers again (build() applies the opening state).
    if (basemaps) basemaps.setLabels(on);
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

  function startEditBearing() {
    bearingInput = String(bearing);
    editingBearing = true;
  }

  function commitBearing() {
    const deg = parseFloat(bearingInput);
    if (Number.isFinite(deg)) setBearing(deg);
    editingBearing = false;
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
  class:grabbing
>
  <div class="map" bind:this={mapEl}></div>

  {#if refused}
    <p class="map-refused">The map needs WebGL, which this browser does not have.</p>
  {/if}

  {@render children?.()}

  <!-- imagery acquisition date: a compact, unobtrusive pill in the corner so it
       doesn't crowd the tool's own readouts -->
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

  <!-- lightweight compass: click the rose to reset north; middle-drag the map to
       rotate; click the number to type an exact bearing -->
  <div class="rotate-ctl">
    <button
      class="compass"
      onclick={() => setBearing(0)}
      title={bearing ? 'Reset to north' : 'North up · middle-drag the map to rotate'}
      aria-label="Reset to north"
    >
      <svg width="30" height="30" viewBox="0 0 34 34" style="transform: rotate({bearing}deg)">
        <polygon points="17,4 13,18 17,15 21,18" fill="#e5484d" />
        <polygon points="17,30 13,16 17,19 21,16" fill="#8a93a5" />
      </svg>
      <span class="n">N</span>
    </button>
    {#if editingBearing}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="input deg-input mono"
        type="number"
        min="0"
        max="359"
        bind:value={bearingInput}
        autofocus
        onblur={commitBearing}
        onkeydown={(e) => {
          if (e.key === 'Enter') commitBearing();
          else if (e.key === 'Escape') editingBearing = false;
        }}
        aria-label="Set bearing in degrees"
      />
    {:else}
      <button class="deg mono" onclick={startEditBearing} title="Click to type an exact angle">
        {bearing}°
      </button>
    {/if}
  </div>
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
  .map-wrap.grid-drawing :global(.map-surface) {
    cursor: crosshair;
  }
  /* imagery date: small, low-contrast pill tucked into the bottom-left corner */
  .date-pill {
    position: absolute;
    bottom: 12px;
    left: 12px;
    z-index: 600;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border-radius: var(--r-sm);
    font-size: var(--fs-xs);
    color: var(--text-3);
    background: rgba(24, 24, 24, 0.7);
    backdrop-filter: blur(6px);
    pointer-events: none;
  }
  /* a pinned date is a fact about the pixels; "latest" is an inference from the
     pass list — they must not look identical */
  .date-pill.exact {
    border-color: var(--ok, #46a758);
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
  /* lightweight compass — no heavy card, just the rose + an editable readout */
  .rotate-ctl {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 600;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .compass {
    position: relative;
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    color: var(--text-2);
    cursor: pointer;
    /* round translucent backing disc so the rose reads clearly over any
       imagery — same fill as the degree readout below (item 3) */
    border-radius: 50%;
    background: rgba(24, 24, 24, 0.88);
    backdrop-filter: blur(6px);
    box-shadow: var(--shadow-1);
  }
  .compass:hover {
    color: var(--accent);
  }
  .compass svg {
    transition: transform 0.1s linear;
  }
  .compass .n {
    position: absolute;
    top: 1px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 9px;
    font-weight: 700;
    color: var(--text-1);
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
    pointer-events: none;
  }
  .deg {
    min-width: 40px;
    text-align: center;
    padding: 2px 6px;
    border-radius: var(--radius-1);
    font-size: var(--fs-xs);
    color: var(--text-1);
    background: rgba(24, 24, 24, 0.88);
    backdrop-filter: blur(6px);
    cursor: text;
  }
  .deg:hover {
    color: var(--accent);
  }
  .deg-input {
    width: 52px;
    padding: 2px 4px;
    text-align: center;
    font-size: var(--fs-xs);
  }</style>
