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
  import { createRelief, steadyZoom } from '../../lib/map/relief.js';
  import { api } from '../../lib/api.js';
  import { toast } from '../../lib/state.svelte.js';
  import { createBasemaps, imageryError, IMAGERY_SOURCE, OVERLAY_IDS } from '../../lib/map/basemap.js';
  import { DEFAULT_LAYER, DEFAULT_MAXCC, SENTINEL_ID } from '../../lib/sentinel.js';
  import { RADAR_ID, orbitMark } from '../../lib/radar.js';
  import { pictureDate } from '../../lib/map/pictureDate.js';
  import Icon from '../../components/Icon.svelte';
  import Compass from '../../components/Compass.svelte';
  import ImageryChip from './ImageryChip.svelte';
  import ReliefControl from './ReliefControl.svelte';

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
    /** This surface's Sentinel-1 pass (state/radar.svelte.js), likewise. */
    s1 = null,
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
    /** Whether this surface offers the relief at all. Compare and Detect read
     *  flat pictures side by side and stay flat. */
    reliefOffered = false,
    /** The relief on this surface, and how much its heights are exaggerated. */
    reliefOn = $bindable(false),
    exaggeration = $bindable(1),
    /** The camera's tilt in degrees, reported out; only relief allows one. */
    pitch = $bindable(0),
    /** True once the relief is on the map and the camera may lean over it. */
    reliefReady = $bindable(false),
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
    /** A second picture of the same ground, `{ provider, id, cell }` as
     *  `imagery.displayed()` answers, laid over the first and kept loaded. */
    alternate = null,
    /** Whether that second picture is the one on screen. */
    alternateOn = false,
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
    /** A tile of an overlay failed, by overlay id, for the tool that offers it. */
    onoverlaytrouble = () => {},
    onimageryfallback = null,
    errorSide = 'left',
    /** The settled camera and the turn, for a parent that shares them. */
    onviewsettled = () => {},
    onbearingchange = () => {},
    /** Controls the tool puts beside the imagery chip, on its right. */
    beside,
    children,
  } = $props();

  let mapEl = $state();
  let basemaps = null;
  let relief = null;
  let tileFailure = $state(null);
  let failureProvider = '';
  // Acquisition date of the imagery under the crosshair — Esri only.
  let imageryDate = $state(null); // { supported, date, source } | null
  let dateRequest = 0;
  let dateTimer;
  /**
   * The zoom the imagery is chosen at: the view's own, or over relief the one
   * it last chose at until the view has really moved (lib/map/relief.js
   * `steadyZoom`). Remembered across readings, so it is kept beside the
   * derivation rather than in state; the first reading takes the view's.
   */
  let chosenAt = null;
  const layerZoom = $derived.by(() => {
    const next = view.zoom;
    chosenAt = reliefOffered && reliefOn ? steadyZoom(chosenAt, next) : next;
    return chosenAt;
  });
  /**
   * What this surface actually shows, which is not always what it was asked
   * for: a billed basemap steps aside when the month is nearly spent or the
   * view is zoomed out. The capture and the imagery date follow the display,
   * so provenance always matches the pixels.
   */
  const shown = $derived(
    imagery.displayed(providerId, layerZoom, {
      ...(s2?.variant ?? {}),
      release: wayback?.release ?? null,
      pass: s1?.shownPass ?? null,
    })
  );
  const radarPass = $derived(shown.provider?.id === RADAR_ID ? s1?.shownPass ?? null : null);
  const tileProblem = $derived(tileFailure?.id === shown.id ? tileFailure : null);

  /** The Sentinel-2 day the tiles were rendered from — the window is one
   *  acquisition, whether the analyst pinned it or "most recent" resolved it,
   *  so the pixels carry that date exactly. Null while no day is known, which
   *  is the one case the tiles blend dates and nothing may be claimed. */
  const renderedDay = $derived(
    shown.provider?.id === SENTINEL_ID && s2?.window.from ? s2.window.from : null
  );

  $effect(() => {
    dated = radarPass
      ? { date: radarPass.date, exact: true, source: 'Sentinel-1' }
      : renderedDay
      ? { date: renderedDay, exact: true, source: 'Sentinel-2' }
      : shown.provider?.id === SENTINEL_ID
        // an undated blend has no date to give, and the newest pass over the
        // crosshair is not it: most of the tile may be older
        ? null
        : imageryDate?.supported && imageryDate.date
          ? { date: imageryDate.date, exact: false, source: imageryDate.source ?? null }
          : null;
  });

  export function resize() {
    engine?.resize();
  }

  /**
   * What a capture of this surface must record: the pixels' own provenance.
   * `imageryExact` is false for a date the provider only estimated, and
   * `imageryWhen` is the same date with a radar pass's UTC time when it has one.
   */
  export function provenance() {
    return { provider: shown.id, ...pictureDate({ radarPass, day: renderedDay, estimated: imageryDate?.date }) };
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
      onOverlayTrouble: (id) => onoverlaytrouble(id),
      // One report per settle: tiles that came through clear the panel the
      // ones before them raised, so it never outlives the trouble it named.
      onImageryTrouble: (failure) => {
        tileFailure = failure.failed
          ? {
              id: failure.id,
              message: imageryError(failure.error, failure.failed, failure.reason),
            }
          : null;
      },
    });
    basemaps.setZoomCeiling(zoomCeiling);
    showBasemap();
    showOverlays();
    // Only a surface that offers relief has one: Compare and Detect stay flat.
    // Built before anything listens for a settled view, so a move over relief is
    // reported once its centre sits on the ground (lib/map/groundHold.js).
    relief = reliefOffered
      ? createRelief(
          engine.impl,
          () => api.get('/api/terrain/sources'),
          {
            imagery: IMAGERY_SOURCE,
            // a tilted view's turn is fetched ahead into the app's caches (lib/map/warmTurn.js)
            send: (body) => api.post('/api/tiles/warm', body),
          },
          { mapId: engine.mapId }
        )
      : null;
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
    const offPitch = engine.on('pitch', (tilted) => (pitch = tilted.pitch));
    const offClick = engine.on('click', (at) => onclick(at));
    const offMenu = engine.on('contextmenu', (at) => oncontextmenu(at));
    ready = true;
    return () => {
      offSettled();
      offRotate();
      offPitch();
      relief?.dispose();
      relief = null;
      reliefReady = false;
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

  function retryImagery() {
    tileFailure = null;
    basemaps?.retry(shown.provider, shown.id, shown.cell);
  }

  function useBasemap() {
    tileFailure = null;
    if (onimageryfallback) onimageryfallback();
    else providerId = 'esri-world-imagery';
  }

  $effect(() => {
    const id = shown.id;
    if (failureProvider !== id) { failureProvider = id; tileFailure = null; }
  });

  $effect(() => {
    const value = zoomCeiling;
    if (ready) basemaps?.setZoomCeiling(value);
  });

  /** A widget basemap is a page under the map, not a picture the map drapes. */
  const reliefPossible = $derived(reliefOffered && !shown.provider?.widget);

  // Relief asks for its sources and tiles only once it is switched on.
  $effect(() => {
    const on = reliefPossible && reliefOn;
    const scale = exaggeration;
    if (!ready || !relief) return;
    const shown = relief;
    shown
      .show(on, { exaggeration: scale })
      .then(() => (reliefReady = shown.on))
      .catch((error) => {
        console.error(error);
        reliefOn = false;
        reliefReady = false;
      });
  });

  // Only a tool that lays a second picture pays for one: the rest never ask.
  let laidAlternate = false;
  $effect(() => {
    const { provider = null, id = '', cell = 256 } = alternate ?? {};
    if (!ready || !basemaps || (!provider && !laidAlternate)) return;
    basemaps.setAlternate(provider, id, cell);
    laidAlternate = Boolean(provider);
  });
  $effect(() => {
    const on = alternateOn;
    if (ready && alternate) basemaps?.showAlternate(on);
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
  <div class="map" class:hazed={reliefPossible && reliefOn} bind:this={mapEl}></div>

  {#if refused}
    <p class="map-refused">The map needs WebGL, which this browser does not have.</p>
  {/if}

  {#if tileProblem && !grabbing}
    <div class="tile-trouble" class:right={errorSide === 'right'} role="status" aria-label="Imagery loading error">
      <strong>Could not load imagery</strong>
      <span>{shown.provider?.label}{shown.provider?.id === SENTINEL_ID ? ` · ${s2?.layer ?? DEFAULT_LAYER}` : ''}{renderedDay ? ` · ${renderedDay}` : radarPass?.date ? ` · ${radarPass.date}` : ''}</span>
      <p>{tileProblem.message}</p>
      <div class="error-actions">
        <button class="btn btn-sm" onclick={retryImagery}>Retry imagery</button>
        {#if shown.provider?.id !== 'esri-world-imagery' && imagery.find('esri-world-imagery')}
          <button class="btn btn-sm" onclick={useBasemap}>Use basemap</button>
        {/if}
      </div>
    </div>
  {/if}

  {@render children?.()}

  <!-- The picture this surface is showing, when it was taken, and the compass
       reading how it is turned: all facts about this map and belonging to it,
       which is what lets two surfaces sit side by side each saying its own. -->
  {#if chrome}
  <div class="surface-ctl">
    {#if beside}
      <div class="ctl-row">
        <ImageryChip {imagery} bind:providerId {s2} {wayback} {s1} {shown} />
        {@render beside()}
      </div>
    {:else}
      <ImageryChip {imagery} bind:providerId {s2} {wayback} {s1} {shown} />
    {/if}

  <!-- …and when the pixels under the crosshair were taken. Under the provider
       rather than in the opposite corner: it describes that same picture, and
       the corner it used to sit in is the instrument's, where the scale bracket
       reads. -->
  {#if s2 && shown.provider?.id === SENTINEL_ID}
    <!-- The date is the picker's chip too, and it is said again here, as the
         radar's pass is: one line reading the day the window named and whether
         the analyst chose it. Without a day the tiles blend the archive, and
         the pill says that rather than naming the newest pass. -->
    <span
      class="date-pill mono"
      class:exact={!!renderedDay}
      class:undated={!renderedDay && s2.undated}
      title={renderedDay
        ? s2.date
          ? `Sentinel-2 ${s2.layerLabel} from this pass`
          : `The newest Sentinel-2 ${s2.layerLabel} pass over this point`
        : s2.undated
          ? 'No pass could be dated here, so these tiles blend several dates'
          : 'Finding the newest pass over this point'}
    >
      <Icon name="clock" size={11} />
      {renderedDay ?? (s2.undated ? 'several dates' : 'finding…')}
      {#if renderedDay && !s2.date}
        <span class="tag">latest</span>
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
  {:else if s1 && shown.provider?.id === RADAR_ID}
    <!-- The pass is the picker's own chip; this says what it means. Without one
         the tiles blend every pass over the point, which for radar mixes looks
         from opposite sides of the track, so the pill says so. -->
    <span class="date-pill mono" class:exact={!!radarPass} class:undated={!radarPass && s1.undated}
      title={radarPass ? `Sentinel-1 pass flying ${radarPass.orbit === 'descending' ? 'south' : 'north'}`
        : s1.undated
          ? 'No pass could be dated here, so these tiles blend several passes'
          : 'Finding the newest pass over this point'}>
      <Icon name="clock" size={11} />
      {radarPass
        ? `${radarPass.date} ${radarPass.time.slice(0, 5)} UTC ${orbitMark(radarPass.orbit)}`
        : s1.undated ? 'several passes' : 'finding…'}
      {#if radarPass && !s1.pass}<span class="tag">latest</span>{/if}
      <span class="tag layer">radar</span>
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
    {#if reliefPossible}
      <ReliefControl bind:on={reliefOn} bind:exaggeration {pitch} ontilt={(deg) => engine?.setPitch(deg)}
        onhint={(text) => toast(text, 'info', 6000)} />
      {#if reliefOn && pitch > 0 && shown.provider?.meter}
        <!-- lib/map/quotaGuard.js: past a flat view's reach the ground is Esri's -->
        <span
          class="date-pill"
          title="A tilted view would spend billed tiles all the way to the horizon, so past what a flat view shows the ground is Esri's, which is free"
        >
          Far ground: Esri
        </span>
      {/if}
    {/if}
  </div>
  {/if}
</div>

<style>
  /* Clear of the left column, not over it and not under it: the zoom buttons
     (12px in, 29px wide) and a tool's own rail live there, and whichever wins
     the stack the analyst loses — either the panel is unreadable or the
     buttons are unpressable. Reading why the imagery failed and zooming out of
     it are the same gesture, so both stay available. */
  .tile-trouble {
    position: absolute; top: 154px; left: 53px; z-index: 600;
    display: grid; gap: 6px; max-width: min(330px, calc(100% - 65px));
    padding: 12px; border: 1px solid var(--warn); border-radius: var(--r-sm);
    background: var(--bg-1); color: var(--text-1); font-size: var(--fs-xs);
  }
  .tile-trouble.right {
    left: auto; right: 12px; max-width: min(330px, calc(100% - 24px));
  }
  .tile-trouble span, .tile-trouble p { margin: 0; color: var(--text-2); }
  .error-actions { display: flex; flex-wrap: wrap; gap: 7px; }
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
  /* Over relief, ground the engine has not drawn yet (far tiles still on their
     way toward the horizon) shows through the canvas: in the haze of the sky's
     horizon (lib/map/relief.js SKY) it reads as distance, in black as a hole. */
  .map.hazed {
    background: #c9d6e3;
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
  /* a day the window named is a fact about the pixels, pinned or resolved; a
     blend of the archive is the one case there is no date to give, and the two
     must not look identical */
  .date-pill.exact {
    color: var(--text-2);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--ok, #46a758) 55%, transparent);
  }
  .date-pill.undated {
    color: var(--warn);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--warn) 45%, transparent);
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
    /* stops short of whatever the tool floats in the opposite corner (Satellite's
       search), so a narrow map wraps the chips instead of hiding them under it */
    max-width: calc(100% - 12px - var(--surface-ctl-reserve, 12px));
    /* the column is only as wide as its widest control, so the map stays
       grabbable everywhere the controls are not */
    pointer-events: none;
  }
  .surface-ctl > :global(*) {
    pointer-events: auto;
  }
  /* One card for the picture and what the window does with it, as Compare's
     source card holds its side: the chips inside lose their own boxes. */
  .ctl-row {
    /* its blur is a stacking context that shuts its menus in, so the card
       itself has to sit over the date pill and the compass below it */
    position: relative;
    z-index: 1;
    display: flex;
    align-items: flex-start;
    gap: 2px;
    max-width: 100%;
    padding: 3px;
    border-radius: var(--radius-1);
    background: rgba(24, 24, 24, 0.88);
    backdrop-filter: blur(6px);
    box-shadow: 0 0 0 1px var(--border);
  }
  .ctl-row > :global(.chip-row) {
    min-width: 0;
    gap: 2px;
  }
  .ctl-row :global(.chip) {
    height: 28px;
    background: transparent;
    box-shadow: none;
    backdrop-filter: none;
  }
  .ctl-row :global(.chip:hover),
  .ctl-row :global(.chip.on) {
    color: var(--text-1);
    background: var(--bg-2);
  }
  .ctl-row :global(.pill) {
    margin: 0 2px;
    background: rgba(255, 255, 255, 0.06);
    box-shadow: none;
    backdrop-filter: none;
  }
</style>
