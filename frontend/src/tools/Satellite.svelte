<script>
  import { onMount, tick } from 'svelte';
  // The map is lib/map's: the engine, its layers, what is drawn on them and the
  // drag gestures. Nothing in this file knows which engine that is — and the
  // map itself is a surface (satellite/MapSurface.svelte), which is what lets a
  // second one be mounted beside this one.
  import { createSurface } from '../lib/map/surface.js';
  import MapSurface from './satellite/MapSurface.svelte';
  import { createSentinelState } from './satellite/state/sentinel.svelte.js';
  import { createSavedState } from './satellite/state/saved.svelte.js';
  import { createImageryState, FALLBACK_PROVIDER } from './satellite/state/imagery.svelte.js';
  import { createMeasureState, HINTS as MEASURE_HINT } from './satellite/state/measure.svelte.js';
  import { createSkyState } from './satellite/state/sky.svelte.js';
  import { createGridState } from './satellite/state/grid.svelte.js';
  import { createRefsState } from './satellite/state/refs.svelte.js';
  import {
    createCaptureState,
    PRESETS,
    RATIOS,
  } from './satellite/state/capture.svelte.js';
  import { api } from '../lib/api.js';
  import { setAnalysisPeriod } from '../lib/analysisSearch.svelte.js';
  import { temporalMapQuery } from '../lib/temporalMap.js';
  import { windowWords } from '../lib/timeline.js';
  import { isMode } from '../lib/geoTree.js';
  import {
    caseState, uiState, ensureCase, reloadCase, toast, prefs, fmtCoords, prefsReady,
  } from '../lib/state.svelte.js';
  import { mapLinks } from '../lib/maplinks.js';
  import { markerGeometry, markerSvg } from '../lib/mapMarkers.js';
  import { startRectDrag, startRotateDrag } from '../lib/map/gestures.js';
  import { panelWidth } from '../lib/panelWidth.js';
  import PlaceSearch from './satellite/PlaceSearch.svelte';
  import { assignFolder } from '../lib/filing.js';
  import { saveRelation } from '../lib/relations.svelte.js';
  import { openEntity } from '../lib/navigate.js';
  import { deletedToast, RESTORABLE } from '../lib/trash.js';
  import { extensionVersion, onActivated } from '../lib/extBridge.js';
  import {
    SENTINEL_ID,
    maxccLabel,
    cloudLabel,
    cloudClass,
    monthLabel,
    monthGrid,
  } from '../lib/sentinel.js';
  import Icon from '../components/Icon.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import RefViewer from './RefViewer.svelte';
  import MapToolCluster from './satellite/MapToolCluster.svelte';
  import SunPanel from './satellite/SunPanel.svelte';
  import GridSearchPanel from './satellite/GridSearchPanel.svelte';
  import SentinelPicker from './satellite/SentinelPicker.svelte';
  import ScreenshotDialog from './satellite/ScreenshotDialog.svelte';
  import ExtensionGate from './satellite/ExtensionGate.svelte';
  import RefPicker from './satellite/RefPicker.svelte';
  import CaptureDetails from './satellite/CaptureDetails.svelte';
  import PlaceDialog from './satellite/PlaceDialog.svelte';
  import CaptureOptions from './satellite/CaptureOptions.svelte';
  import SavedTree from './satellite/SavedTree.svelte';
  import SavedSearch from './satellite/SavedSearch.svelte';
  import SavedOverlay from './satellite/SavedOverlay.svelte';
  import SheetPointsOverlay from './satellite/SheetPointsOverlay.svelte';
  import TemporalMapOverlay from './satellite/TemporalMapOverlay.svelte';

  let toolEl; // Browser fullscreen target.
  // The map surface: it owns the engine, the basemap and everything that
  // describes the pixels, and hands back the façade and its own container for
  // the acts this tool owns — flying to a saved point, and the drag gestures it
  // arms over the map.
  let surface = $state(null);
  let mapEl = $state(null);
  let engine = $state.raw(null);
  // The catalogue and the month's tally are the tool's, not one map's: a tile
  // counted against the month is counted once however many surfaces drew it.
  const imagery = createImageryState({ api });
  let providerId = $state(FALLBACK_PROVIDER);
  let coordsText = $state('');
  // The map opens on the saved home view, so it is not built until preferences
  // have landed — a deep link can mount this tool first.
  let homeReady = $state(false);
  let center = $state({ ...prefs.homeView });
  let markerStyle = $state('none'); // 'crosshair' | 'pin' | 'none'
  let moveMode = $state(false); // pin decoupled from center, draggable
  let markerSurface = null; // lib/map/surface.js — holds the pin while in move mode
  let markerLatLng = $state(null); // {lat, lon} of the moved pin
  let bearing = $state(0);
  // Middle-drag rotates the map around the grabbed point.
  let rotating = $state(false);
  let rotatePivot = $state({ x: 0, y: 0 }); // grabbed point, map-wrap-local px
  let captureHover = $state(false); // previewing the crop frame (capture group hover)
  // The case's saved work — both indexes, the panel's filter and the Locate
  // pass — is its own store (state/saved.svelte.js).
  const savedWork = createSavedState({ api, notify: toast, assignFolder, reloadCase });
  let savedSearchOpen = $state(false);
  let savedOverlay = $state(false); // map layer: off by default, session only
  let temporalMap = $state(null); // Timeline handoff, session-only
  let temporalMapLoading = $state(false);
  let temporalMapError = $state('');
  let temporalMapSeq = 0;
  /** A sheet's coordinate column, handed over as points. Session-only, like the layer
   *  above it, and never part of a capture or a proof. */
  let sheetPoints = $state(null); // { points, sheet, column }
  let hoveredSavedId = $state(null); // shared by the tree, the modal and the map
  let revealSavedId = $state(null);
  let capturesCollapsed = $state(false);
  // the Saved panel's left edge is a drag handle; the width sticks across reloads
  const savedPanel = panelWidth({
    key: 'azimut:satelliteSavedW',
    min: 260,
    max: 560,
    def: 300,
    fraction: 0.4,
  });
  let savedW = $state(savedPanel.loadWidth());
  let savedResizing = $state(false);
  let mapReady = $state(false);
  let mapRefused = $state(false);

  // OSM labels overlay: a transparent labels-only layer laid over the imagery so
  // roads / place names are readable without hiding the satellite view (item 1).
  let osmOverlay = $state(false);
  // The labels overlay only makes sense over satellite imagery — over a street
  // base map (OSM) it just doubles the road/place labels, so it's disabled then
  // and force-off if the provider changes to a non-imagery one (item 1).
  const currentProvider = $derived(imagery.find(providerId));
  const baseIsImagery = $derived(currentProvider?.imagery ?? true);
  // view-only basemaps (capturable=false) keep the map but not the capture
  // button (IMAGERY_PROVIDERS.md). Widget basemaps are also capturable=false —
  // there are no tiles to stitch — but they are *not* blocked: they capture the
  // same way through the same button, from screen pixels rather than tiles.

  // --- Sentinel-2: which layer, and over which window ---
  // The one basemap with choices in it. What has been asked, what came back and
  // what is still in flight all live in its own store; the choices ride on the
  // provider id, which is what the map, the capture and the cache key on.
  const s2 = createSentinelState({
    place: () => ({ lat: center.lat, lon: center.lon }),
    onBilled: () => imagery.refreshUsage(),
    notify: toast,
    api,
  });
  const isSentinel = $derived(currentProvider?.id === SENTINEL_ID);
  let s2MenuEl = $state(); // bound to the popover wrapper — outside-click detection

  // --- what the map is actually showing (state/imagery.svelte.js) ---
  // A billed basemap steps aside for free imagery when paused (90% soft block)
  // or zoomed out (eco). The capture follows the display, so provenance always
  // matches the pixels.
  const shown = $derived(imagery.displayed(providerId, center.zoom, s2.variant));
  // small readout near the basemap selector, billed providers only
  const usagePill = $derived(imagery.pill(currentProvider));

  // Fullscreen: the tool covers the whole viewport; SAVED stays collapsible (item 4).
  let fullscreen = $state(false);

  // Measure tools (item 5): distance / area / angle, in their own store.
  const measure = createMeasureState({
    engine: () => engine,
    units: () => prefs.units,
  });

  // External-maps quick links, in the SAVED panel (item 6).
  let linksOpen = $state(false);

  // --- Grid Search (spec §5): overlay a metric grid on an area of interest and
  // sweep it cell by cell, marking each cleared or flagged. The grids a case
  // holds, which one is open and where the sweep is are its own store; it keeps
  // its layers across basemap changes.
  const grid = createGridState({
    engine: () => engine,
    api,
    notify: toast,
    caseId: () => caseState.current?.id,
    ensureCase,
    reloadCase,
    coords: fmtCoords,
    zoom: () => center.zoom,
  });

  // --- reference windows: floating scratch panes over the map holding a media
  // image (the shot to geolocate), to eyeball against the imagery while panning.
  // Session-only (uiState.refViewers) — never captured, never saved, dropped
  // when the case changes (see openCase). Their own store: state/refs.svelte.js.
  const refs = createRefsState({
    api,
    notify: toast,
    caseId: () => caseState.current?.id,
    viewers: () => uiState.refViewers,
    setViewers: (windows) => (uiState.refViewers = windows),
  });

  // Svelte only honours a cleanup returned from a *synchronous* onMount, and the
  // setup below has to await the providers and the saved home view. So onMount
  // stays synchronous and hands back a teardown that runs whatever the async
  // build registered. Tools are never unmounted today, which is exactly why an
  // async onMount would have gone on quietly returning a promise nobody calls.
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
    imagery.refreshUsage(); // prefs drive the eco/soft-block fallbacks from the start
    await imagery.loadProviders();
    await prefsReady; // the home view has to land before the map is built
    center = { ...prefs.homeView };
    homeReady = true; // …and only now is there a view for the surface to open on
    window.addEventListener('keydown', onKeydown);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    // the user clicked the extension after a refused capture — close the loop
    const offActivated = onActivated(() =>
      toast('Extension ready. Press Capture again', 'ok', 5000)
    );
    return () => {
      window.removeEventListener('keydown', onKeydown);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      offActivated();
      measure.destroy();
      sky.destroy();
      grid.destroy();
      markerSurface?.destroy();
    };
  }

  /**
   * The gestures this tool arms over the map, once the surface has one.
   *
   * Capture-phase, all three: the engine's own container drag handler must not
   * see the event first, or a turn also pans and a marquee also drags the map.
   */
  $effect(() => {
    const element = mapEl;
    if (!element) return;
    // middle-mouse or shift drag rotates the view
    element.addEventListener('mousedown', onMiddleRotateStart, true);
    // left-drag draws the capture marquee when that mode is armed
    element.addEventListener('mousedown', onSelectDrag, true);
    // …and a Grid Search area when the rectangle tool is armed
    element.addEventListener('mousedown', onGridRectStart, true);
    return () => {
      element.removeEventListener('mousedown', onMiddleRotateStart, true);
      element.removeEventListener('mousedown', onSelectDrag, true);
      element.removeEventListener('mousedown', onGridRectStart, true);
    };
  });

  function onKeydown(e) {
    if (uiState.tool !== 'satellite') return;
    // a dialog on top owns the keyboard — it closes itself, the map keeps state
    if (notesItem || placeModal || refs.picking || deleteTarget) return;
    const tag = e.target?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable;
    // Enter confirms a polygon area, same as the Confirm button
    if (grid.on && grid.drawMode === 'polygon' && !typing && e.key === 'Enter') {
      e.preventDefault();
      grid.confirmPolygon();
      return;
    }
    // Grid Search sweep: single-key marks while a cell is under review
    if (grid.on && grid.reviewKey && !typing) {
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'c') return void (e.preventDefault(), grid.markReview('cleared'));
      if (k === 'f') return void (e.preventDefault(), grid.markReview('flagged'));
      if (k === 's') return void (e.preventDefault(), grid.advance());
      if (k === 'p') return void (e.preventDefault(), grid.reviewToPlace());
    }
    if (e.key !== 'Escape') return;
    if (grid.drawMode) return grid.cancelDraw();
    if (grid.reviewKey) return grid.stopReview();
    if (capture.armed) toggleSelect();
    else if (capture.menuOpen) capture.menuOpen = false;
    else if (sky.placing) sky.togglePlacing();
    else if (sky.on) toggleSunMode();
    else if (measure.mode) setMeasureMode(null);
    // native fullscreen already exits on Esc (handled by onFullscreenChange);
    // only the CSS fallback needs an explicit toggle here
    else if (fullscreen && !document.fullscreenElement) toggleFullscreen();
  }

  // force the labels overlay off whenever the base isn't imagery (item 1)
  $effect(() => {
    if (!baseIsImagery && osmOverlay) osmOverlay = false;
  });

  // While the picker is open, a settled pan refreshes its dates. The stale
  // cells are disabled immediately; the debounce avoids a request per frame.
  $effect(() => {
    if (!s2.menuOpen || !isSentinel) return;
    s2.month;
    s2.placeKey;
    clearTimeout(s2PassTimer);
    s2PassTimer = setTimeout(() => s2.loadPasses(), 600);
    return () => clearTimeout(s2PassTimer);
  });
  let s2PassTimer;

  // Naming the date of what's on screen is why you'd pick this basemap, so the
  // latest pass is resolved as soon as Sentinel-2 is actually being displayed —
  // one metadata request, on the user's own action (choosing the basemap), and
  // only once per place. Not on mount: no tab may phone out by being opened.
  $effect(() => {
    if (!mapReady || shown.provider?.id !== SENTINEL_ID) return;
    center.lat;
    center.lon;
    s2.maxcc; // a new ceiling can make a different pass the most recent one
    clearTimeout(s2LatestTimer);
    // debounced: panning must not spend a request per frame
    s2LatestTimer = setTimeout(() => s2.resolveLatest().catch(() => {}), 900);
  });
  let s2LatestTimer;

  // --- middle-drag rotate (item 3), Google-Earth style ---
  // Grab a point → the map turns around *that* point (not the centre) as the
  // cursor sweeps, with a sober target marking the pivot. A map only rotates
  // about the centre, so after each bearing change we pan the grabbed geographic
  // point back under the cursor — keeping it pinned exactly where you grabbed.
  function onMiddleRotateStart(e) {
    if (!engine) return;
    // Middle button, or shift and the left one — the second was the old map's
    // own gesture, kept rather than quietly dropped. Never shift over a mode
    // already waiting for a left drag, though: those own the button.
    const shiftDrag =
      e.button === 0 && e.shiftKey && !capture.armed && grid.drawMode !== 'rect';
    if (e.button !== 1 && !shiftDrag) return;
    startRotateDrag(engine, e, {
      onPivot: (pivot) => {
        rotatePivot = pivot;
        rotating = true;
      },
      onEnd: () => (rotating = false),
    });
  }

  // Actions that leave the tool — switching to another tool, opening a browser
  // tab — can't do anything visible while the map owns the whole screen, so
  // they're greyed out rather than silently dropping the user out of it.
  const leavesFullscreen = $derived(
    fullscreen ? 'Exit fullscreen first. This leaves the map' : null
  );

  // --- fullscreen (item 5) ---
  // Prefer the real Fullscreen API — it covers the OS/browser chrome too, unlike
  // the old fixed-overlay hack. Fall back to a CSS overlay where it's blocked
  // (e.g. an iframe without allow="fullscreen"). onFullscreenChange keeps the
  // `fullscreen` flag in sync when the browser enters/exits (Esc, F11, etc.).
  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
      return;
    }
    if (toolEl?.requestFullscreen) {
      try {
        await toolEl.requestFullscreen();
        return; // state + resize handled by onFullscreenChange
      } catch (e) {
        // The CSS fallback only fills the *window* — the browser's tabs and
        // toolbar stay visible — so degrading into it silently reads as a
        // broken fullscreen button rather than a refusal. Name the reason.
        toast(
          `Real fullscreen refused (${e.name}: ${e.message}). Filling the window instead`,
          'warn',
          8000
        );
      }
    }
    fullscreen = !fullscreen;
    await tick();
    engine?.resize();
  }

  function onFullscreenChange() {
    if (document.fullscreenElement === toolEl) fullscreen = true;
    else if (!document.fullscreenElement) fullscreen = false;
    tick().then(() => engine?.resize());
  }

  // --- what a click on the map means -------------------------------------
  //
  // One router, asked in the order the modes exclude each other: a polygon
  // being placed owns the click, then a sky anchor waiting to be planted, then
  // the measure tools. Each mode answers whether it took it.
  /** Where the analyst clicked, `{ lat, lon }` from the façade. */
  function onMapClick(at) {
    if (grid.addVertex(at)) return;
    if (sky.place(at)) return;
    measure.addPoint(at);
  }

  function setMeasureMode(mode) {
    // measuring and the capture marquee can't both be armed
    if (measure.setMode(mode)) capture.disarm();
  }

  // --- external map links (item 6) ---
  const externalLinks = $derived(mapLinks(displayCoords.lat, displayCoords.lon, center.zoom));

  // fly the map to a capture's recorded point (item 7)
  /** Open one saved item: fly the map to it, or — for a screenshot of a site we
   *  cannot embed, filed without coordinates — reopen the page it came from. */
  function openSaved(row) {
    if (row.lat == null || row.lon == null) {
      if (row.source_url && !fullscreen) window.open(row.source_url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (!engine) return;
    engine.setView(row, Number(row.zoom) || engine.getZoom());
    setBearing(row.bearing);
  }

  // Google rejected the Maps JavaScript key. Persist the verdict (which benches
  // the basemap), tell the user, and let the provider refetch fall the map back
  // to Esri.
  async function onWidgetAuthFailure(provider) {
    try {
      await api.post(`/api/settings/keys/${provider.meter}/status`, {
        ok: false,
        detail: 'Google rejected the Maps JavaScript key (gm_authFailure)',
      });
    } catch { /* the toast still tells the user */ }
    toast('Google rejected the Maps JavaScript key. Basemap disabled; see Settings', 'danger', 8000);
    await imagery.loadProviders();
  }

  function onWidgetFailed(provider, error) {
    toast(`Google Maps failed to load: ${error.message}`, 'danger', 6000);
    providerId = FALLBACK_PROVIDER;
  }

  // a basemap disabled in Settings can leave a stale selection — fall back
  $effect(() => {
    if (imagery.providers.length && !currentProvider) providerId = FALLBACK_PROVIDER;
  });

  // re-sync providers + prefs when returning to this tab: Settings may have
  // toggled a basemap off (it must vanish from the selector) or changed the
  // eco / override prefs meanwhile (tools stay mounted, so no fresh onMount)
  $effect(() => {
    if (uiState.tool !== 'satellite' || !mapReady) return;
    imagery.refreshUsage();
    imagery.loadProviders();
  });

  // A different case drops everything this one was holding: both indexes, the
  // dialogs open over them, and the two session layers.
  let openFor = null;
  $effect(() => {
    const id = caseState.current?.id;
    caseState.rev; // re-fetch when the case is reloaded elsewhere (e.g. sidebar delete)
    if (openFor !== id) {
      openFor = id;
      savedSearchOpen = false;
      hoveredSavedId = null;
      revealSavedId = null;
      deleteTarget = null;
      notesItem = null;
      placeModal = null;
      temporalMapSeq += 1;
      temporalMap = null;
      temporalMapLoading = false;
      temporalMapError = '';
      // The points came out of another case's sheet, so they go with it.
      sheetPoints = null;
    }
    return savedWork.load(id);
  });

  // The proofs index, read the first time the Proofs position is opened.
  $effect(() => savedWork.loadProofs(caseState.current?.id, caseState.rev));

  // another workspace asked to show one capture: clear whatever filter is on so
  // it can't be hidden, then let the tree open its branch and scroll to it
  $effect(() => {
    const path = uiState.focusCapture;
    if (!path) return;
    const row = savedWork.rows.find((item) => item.path === path);
    if (!row) return;
    uiState.focusCapture = null;
    capturesCollapsed = false;
    savedWork.kind = 'all';
    savedWork.query = '';
    revealSavedId = row.id;
  });

  // the map container resizes when the sidebar toggles or is dragged wider, and
  // reappears from display:none when the tool tab is re-selected (tools stay
  // mounted) — all need the map to re-measure and redraw for the exposed area
  $effect(() => {
    uiState.sidebarOpen; // track the global sidebar toggle
    uiState.sidebarW; // …and its width, live through a resize drag
    if (!mapReady || uiState.tool !== 'satellite') return;
    tick().then(() => engine?.resize());
  });

  // fly to coordinates handed off from the sidebar (place entity click) —
  // match the capture's own zoom/bearing, like clicking its card
  $effect(() => {
    const target = uiState.gotoCoords;
    if (mapReady && target && Number.isFinite(target.lat) && Number.isFinite(target.lon)) {
      if (target.provider && !imagery.providers.length) return;
      uiState.gotoCoords = null;
      if (target.provider && imagery.find(target.provider)) {
        providerId = target.provider;
      }
      const zoom = Number.isFinite(target.zoom) ? target.zoom : Math.max(engine.getZoom(), 16);
      engine.setView(target, zoom);
      setBearing(target.bearing);
    }
  });

  /**
   * A sheet's column of coordinates, taken as it was handed over.
   *
   * No request, unlike the layer below: a sheet's coordinates are text in a CSV, not
   * entities the case can be asked about, so there is nothing to re-ask and the points
   * themselves travel. Framed on what arrived, because a layer that lands off screen
   * reads as a layer that did not land.
   */
  $effect(() => {
    const handed = uiState.mapSheetPoints;
    if (!mapReady || !handed?.points?.length) return;
    uiState.mapSheetPoints = null;
    sheetPoints = handed;
    tick().then(() => {
      engine?.fitPoints(handed.points, { padding: [48, 48], maxZoom: 17 });
    });
  });

  $effect(() => {
    const handed = uiState.mapTimelineRange;
    const caseId = caseState.current?.id;
    if (!mapReady || !handed || !caseId) return;
    uiState.mapTimelineRange = null;
    const run = ++temporalMapSeq;
    temporalMap = {
      from: handed.from,
      to: handed.to,
      items: [],
      matched: 0,
      mapped: 0,
      marks: 0,
      truncated: false,
    };
    temporalMapLoading = true;
    temporalMapError = '';
    // The case's own saved pins go off, rather than being assumed off. They are the
    // whole index and take no notice of the window, so left on they answer a period
    // with every place the case has ever held — the layer then reads as showing
    // everything. The pin button is right there for anyone who wants that comparison.
    savedOverlay = false;
    api.get(temporalMapQuery(caseId, handed.from, handed.to, handed.categories ?? []))
      .then((result) => {
        if (run !== temporalMapSeq || caseState.current?.id !== caseId) return;
        temporalMap = { ...temporalMap, ...result, from: handed.from, to: handed.to };
        // Framed on what the window holds, and on nothing else. Fitting the case's own
        // pins as well was a way to see none of them: a window with nothing placed in
        // it pulled the view out to whatever continents the case has saved work on,
        // which reads as the layer showing everything rather than showing nothing.
        // With nothing to frame, the map stays where the analyst left it.
        const points = result.items.flatMap((item) => item.place_entities);
        if (!points.length) return;
        tick().then(() => {
          if (run !== temporalMapSeq) return;
          engine?.fitPoints(points, { padding: [54, 54], maxZoom: 14 });
        });
      })
      .catch((error) => {
        if (run === temporalMapSeq) {
          temporalMapError = error.message || 'The Timeline layer could not be loaded.';
        }
      })
      .finally(() => {
        if (run === temporalMapSeq) temporalMapLoading = false;
      });
  });

  function openTemporalTimeline(item = null) {
    if (!temporalMap) return;
    uiState.timelineRange = {
      from: temporalMap.from,
      to: temporalMap.to,
      itemId: item?.id ?? null,
    };
    uiState.tool = 'timeline';
  }

  function openTemporalCatalog(tool) {
    if (!temporalMap || !caseState.current?.id) return;
    setAnalysisPeriod(caseState.current.id, {
      from: temporalMap.from,
      to: temporalMap.to,
      categories: ['statement'],
    });
    if (tool === 'graph') {
      uiState.drawInGraph = {
        label: `Fact time · ${windowWords(temporalMap.from, temporalMap.to, 'UTC')}`,
      };
    }
    uiState.tool = tool;
  }

  function closeTemporalMap() {
    temporalMapSeq += 1;
    temporalMap = null;
    temporalMapLoading = false;
    temporalMapError = '';
  }

  // --- sun and moon ---
  //
  // One anchored point, one date, and an hour you drag, in its own store
  // (state/sky.svelte.js). The tool keeps only what the mode means *here*:
  // which other modes it turns off, and where it opens when nothing is planted.
  const sky = createSkyState({ engine: () => engine, api, notify: toast });

  function toggleSunMode() {
    if (sky.on) {
      sky.close();
      return;
    }
    if (capture.armed) toggleSelect(); // exclusive with the capture marquee…
    setMeasureMode(null); // …the measure tools…
    if (grid.on) toggleGridMode(); // …and Grid Search
    sky.open(markerLatLng ?? { lat: center.lat, lon: center.lon });
  }

  // Coords & Sky hands over a point, a date and a time: same mode, second way
  // in, so there is only ever one rendering of this to keep right.
  $effect(() => {
    const handed = uiState.skyAt;
    if (!mapReady || !handed) return;
    uiState.skyAt = null;
    if (!sky.on) toggleSunMode();
    sky.handOff(handed);
  });

  $effect(() => {
    sky.on;
    sky.anchor;
    sky.day;
    sky.load();
  });

  // Redraw on any of: a new day, a new hour, a new anchor, the mode closing.
  $effect(() => {
    sky.on;
    sky.sky;
    sky.index;
    sky.anchor;
    if (mapReady) sky.draw();
  });

  // The arc is drawn in metres, so a zoom or a pan has to restretch it.
  $effect(() => {
    if (!mapReady || !sky.on) return;
    return engine.on('view-settled', () => sky.draw());
  });

  let searching = $state(false);
  async function goTo() {
    const text = coordsText.trim();
    if (!text || searching) return;
    searching = true;
    try {
      // coordinates first (decimal or DMS); anything else is a place name
      try {
        const parsed = await api.post('/api/geo/parse', { text });
        engine.setView(parsed, Math.max(engine.getZoom(), 16));
        return;
      } catch {
        /* not coordinates — fall through to geocoding */
      }
      const place = await api.get(`/api/geo/geocode?q=${encodeURIComponent(text)}`);
      engine.setView(place, Math.max(engine.getZoom(), 13));
      if (place.display_name) toast(place.display_name, 'info', 5000);
    } catch {
      toast('No match. Try coordinates ("50.4501, 30.5234"), DMS, or a place name', 'danger');
    } finally {
      searching = false;
    }
  }

  /** Fly to a row the search bar proposed. A saved item is opened the way the
   *  panel opens it — same view, same bearing — and anything else is a point
   *  with a sensible zoom for what it is: a city, a street, a coordinate. */
  function goToSuggestion(item) {
    if (item.row) {
      openSaved(item.row);
      return;
    }
    if (!engine || !Number.isFinite(item.lat) || !Number.isFinite(item.lon)) return;
    engine.setView(item, item.zoom ?? Math.max(engine.getZoom(), 13));
  }

  function setBearing(deg) {
    engine?.setBearing(deg); // the façade normalises whatever it is handed
  }

  // --- marker (crosshair / pin), optionally decoupled from center ---

  // the coordinates shown & recorded: the moved pin, else the crop center
  const displayCoords = $derived(
    moveMode && markerLatLng ? markerLatLng : { lat: center.lat, lon: center.lon }
  );

  // --- capture: what shape the crop is, and filing what is inside it ---
  // The output size, the marquee's ratio lock, the resolution, which mode the
  // button re-runs and both roads to a filed crop are its own store
  // (state/capture.svelte.js). The pixels' provenance is asked of the surface
  // that drew them, never of the provider that was chosen.
  const capture = createCaptureState({
    api,
    notify: toast,
    ensureCase,
    reloadCase,
    engine: () => engine,
    element: () => mapEl,
    view: () => center,
    bearing: () => bearing,
    marker: () => ({ style: markerStyle, at: moveMode ? markerLatLng : null }),
    basemap: () => currentProvider,
    maxZoom: () => shown.provider?.max_zoom ?? 19,
    provenance: () => surface.provenance(),
    onRect: (rect) => (selRect = rect),
    onArm: () => setMeasureMode(null),
  });
  let sizeMenuEl = $state(); // bound to the popover wrapper — outside-click detection
  // The live drag outline, in map-container px. Shared chrome: the capture
  // marquee and the Grid Search rectangle are the same gesture and cannot both
  // be armed, so one outline serves both.
  let selRect = $state(null);

  const PIN = 'pin'; // the one shape on the move-mode surface

  function markerIcon(style) {
    const { size, anchor } = markerGeometry(style);
    return { className: 'sat-marker', html: markerSvg(style), size, anchor };
  }

  function removeMarker() {
    markerSurface?.clear();
    markerLatLng = null;
  }

  function toggleMoveMode() {
    if (markerStyle === 'none') return;
    moveMode = !moveMode;
    if (!moveMode) {
      removeMarker();
      return;
    }
    const c = engine.camera();
    markerSurface ??= createSurface(engine);
    markerLatLng = { lat: c.lat, lon: c.lon };
    markerSurface.set([
      {
        id: PIN,
        kind: 'marker',
        at: markerLatLng,
        ...markerIcon(markerStyle),
        draggable: true,
        zIndex: 1000,
        onDrag: (at) => (markerLatLng = at),
      },
    ]);
  }

  // keep the live marker's look in sync with the chosen style; leaving move
  // mode (or picking "none") drops the marker
  $effect(() => {
    if (markerStyle === 'none' && moveMode) {
      moveMode = false;
      removeMarker();
    } else if (markerSurface?.has(PIN)) {
      markerSurface.patch(PIN, { icon: markerIcon(markerStyle) });
    }
  });

  // Both roads to a filed crop — the backend stitching tiles, and the extension
  // grabbing screen pixels for a widget basemap — are state/capture.svelte.js.

  // clicking outside the open size/ratio/resolution popover closes it
  $effect(() => {
    if (!capture.menuOpen) return;
    const onDocMousedown = (e) => {
      if (sizeMenuEl && !sizeMenuEl.contains(e.target)) capture.menuOpen = false;
    };
    document.addEventListener('mousedown', onDocMousedown, true);
    return () => document.removeEventListener('mousedown', onDocMousedown, true);
  });

  // …and the Sentinel-2 layer/date popover
  $effect(() => {
    if (!s2.menuOpen) return;
    const onDocMousedown = (e) => {
      if (s2MenuEl && !s2MenuEl.contains(e.target)) s2.menuOpen = false;
    };
    document.addEventListener('mousedown', onDocMousedown, true);
    return () => document.removeEventListener('mousedown', onDocMousedown, true);
  });

  // --- marquee: drag a rectangle on the map to capture exactly that area ---
  // The frame, the ratio lock and the filing are the store's. What stays here
  // is the wiring only this file can do: the mode exclusivity, and handing the
  // store a left-drag off the map element it does not own.
  function toggleSelect() {
    capture.toggleSelect();
  }

  function onSelectDrag(e) {
    capture.startSelect(e);
  }

  // --- Grid Search: the mode, and the gesture that draws a rectangle --------
  //
  // The lattice, the sweep and the case's saved grids are the store's
  // (state/grid.svelte.js). What stays here is what Grid Search means *in this
  // tool*: which other modes it turns off, and the left-drag that draws an area
  // — the same gesture as the capture marquee, sharing its live outline.

  function toggleGridMode() {
    if (grid.on) {
      grid.exit();
      return;
    }
    if (capture.armed) toggleSelect(); // exclusive with the capture marquee…
    setMeasureMode(null); // …and the measure tools
    grid.open();
  }

  // rectangle area: drag a box, mirroring the capture marquee and reusing
  // selRect for the live outline. Armed while the rectangle tool is chosen.
  function onGridRectStart(e) {
    if (grid.drawMode !== 'rect' || e.button !== 0 || !engine) return;
    startRectDrag(engine, e, {
      onChange: (rect) => (selRect = rect),
      onDone: finishGridRect,
    });
  }

  function finishGridRect(r) {
    selRect = null;
    grid.finishRect(
      r && {
        p1: engine.containerPointToLatLng({ x: r.x0, y: r.y0 }),
        p2: engine.containerPointToLatLng({ x: r.x1, y: r.y1 }),
        widthPx: Math.abs(r.x1 - r.x0),
        heightPx: Math.abs(r.y1 - r.y0),
      }
    );
  }

  // A different case: the grids on disk are its own, and whatever was open
  // belonged to the last one.
  $effect(() => {
    const id = caseState.current?.id;
    caseState.rev; // re-read after a reload elsewhere
    if (mapReady) grid.forCase(id);
  });

  // save just the point (pin if moved, else center) as a navigable place — no image
  let savingPlace = $state(false);
  async function savePlace() {
    if (savingPlace) return;
    savingPlace = true;
    try {
      const c = await ensureCase();
      await api.post(`/api/cases/${c.id}/satellite/place`, {
        lat: displayCoords.lat,
        lon: displayCoords.lon,
        zoom: center.zoom,
        bearing,
      });
      await reloadCase();
      toast('Place saved. Find it in the case sidebar', 'ok');
    } catch (e) {
      toast(`Could not save place: ${e.message}`, 'danger', 6000);
    } finally {
      savingPlace = false;
    }
  }

  // Deletions drop a file / an entity — always behind a confirm. The target is
  // a saved-index row; its kind says which of the two it is.
  let deleteTarget = $state(null);
  let deleteBusy = $state(false);

  async function confirmDelete() {
    if (!deleteTarget || deleteBusy) return;
    deleteBusy = true;
    const row = deleteTarget;
    try {
      const caseId = caseState.current.id;
      const result = await savedWork.remove(caseId, row);
      deleteTarget = null;
      await reloadCase(); // re-reads the saved index and the case sidebar
      deletedToast(caseId, result, row.title || coordsLabel(row));
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      deleteBusy = false;
    }
  }

  /** The edit action, for whichever kind of row it was pressed on. */
  function editSaved(row) {
    if (row.kind === 'place') openEditPlace(row);
    else openNotes(row);
  }

  /** Accept a point a tool proposed, from the panel the analyst is reading it in.
   *
   *  The same PATCH the sidebar sends, so the far end of the point's suggested
   *  relations is accepted with it — the API keeps that invariant, and a point
   *  confirmed here while the edge tying it to its capture stayed proposed would
   *  be the two surfaces disagreeing about one click. */
  const acceptSaved = (row) => savedWork.accept(caseState.current.id, row);

  // --- details modal (title + notes) ---
  // The dialog owns the fields; this owns the PATCH and what it means for the
  // rest of the case.
  let notesItem = $state(null);

  async function saveNotes({ title, folder, notes }) {
    if (!notesItem) return;
    try {
      await api.patch(
        `/api/cases/${caseState.current.id}/satellite`,
        { path: notesItem.path, notes, title, folder }
      );
      notesItem = null;
      // the mirrored place entity was retitled too — refresh the sidebar
      await reloadCase();
      toast('Saved', 'ok', 1600);
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  function coordsLabel(item) {
    return fmtCoords(item.lat, item.lon);
  }

  // One action, two directions: a capture goes *into* a new proof, a proof row
  // opens the proof it already is.
  function sendToComposer(item) {
    if (item.kind === 'proof') {
      uiState.openProof = item.name;
    } else if (!uiState.composeQueue.includes(item.path)) {
      uiState.composeQueue.push(item.path);
    }
    uiState.tool = 'proof';
  }

  function openLinkedPost(post) {
    if (!post.name) return;
    uiState.openDraft = post.name;
    uiState.tool = 'post';
  }

  // the HUD readout and everything copied out of it follow the user's
  // coordinate format (Settings → General); captures keep decimal degrees
  const readout = $derived(fmtCoords(displayCoords.lat, displayCoords.lon));

  async function copyCoords() {
    await navigator.clipboard.writeText(readout);
    toast('Coordinates copied', 'ok', 1600);
  }

  async function toggleCaptures() {
    capturesCollapsed = !capturesCollapsed;
    // the map container just resized — let the map redraw for the new size
    await tick();
    engine?.resize();
  }

  // Dropped onto a folder in the panel: the index, the sidebar and the map
  // overlay all read the new filing from the case reload that follows.
  const moveSaved = (row, folder) => savedWork.move(caseState.current.id, row, folder);

  // --- resize: the Saved panel's left edge is a drag handle ---
  const SAVED_KEY_STEP = 16;

  function setSavedWidth(w) {
    savedW = savedPanel.clampWidth(w, window.innerWidth);
  }

  function startSavedResize(e) {
    if (e.button !== 0) return;
    e.preventDefault(); // don't start a text selection under the cursor
    const startX = e.clientX;
    const startW = savedW;
    savedResizing = true;
    let frame = 0;
    // dragging left (a smaller clientX) widens the panel — it grows into the map
    const move = (ev) => {
      setSavedWidth(startW + startX - ev.clientX);
      // the map container shrank with it; one redraw per frame, not per event
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          engine?.resize();
        });
      }
    };
    const up = () => {
      savedResizing = false;
      if (frame) cancelAnimationFrame(frame);
      engine?.resize();
      savedPanel.saveWidth(savedW); // one write per drag, not one per frame
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  async function onSavedResizeKey(e) {
    const step = { ArrowLeft: SAVED_KEY_STEP, ArrowRight: -SAVED_KEY_STEP }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    setSavedWidth(savedW + step);
    savedPanel.saveWidth(savedW);
    await tick();
    engine?.resize();
  }

  async function resetSavedWidth() {
    setSavedWidth(savedPanel.DEFAULT_W);
    savedPanel.saveWidth(savedW);
    await tick();
    engine?.resize();
  }

  // A width dragged out on a wide screen would eat a narrower window whole, so
  // re-clamp against the viewport as it changes. The clamped-down value is not
  // written back — what the user actually chose is what a later session restores.
  $effect(() => {
    const onWindowResize = () => setSavedWidth(savedW);
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  });

  // Locate fills in the country of everything that still has none, one bounded
  // batch at a time (state/saved.svelte.js).
  const runLocate = () => savedWork.runLocate(caseState.current?.id);

  // --- place edit modal (title + notes), used for both save & later edits ---
  // { id: string|null, title, notes, folder, lat, lon, zoom, bearing }; id null = new
  let placeModal = $state(null);
  let placeSaving = $state(false);

  function openNewPlace() {
    placeModal = {
      id: null,
      title: '',
      notes: '',
      folder: '',
      lat: displayCoords.lat,
      lon: displayCoords.lon,
      zoom: center.zoom,
      bearing,
      relation: null, // collected by the gate, filed once the place exists
    };
  }

  function openEditPlace(row) {
    placeModal = {
      id: row.id,
      title: row.title ?? '',
      notes: row.notes ?? '',
      folder: row.folder ?? '',
      lat: Number(row.lat),
      lon: Number(row.lon),
      zoom: row.zoom,
      bearing: row.bearing,
      relation: null,
      relations: [],
    };
    loadPlaceRelations(row.id);
  }

  /** The relations a place already holds, from the bounded chain endpoint. The
   *  dialog edits everything else about the point, so hiding them here would make
   *  it the one surface where a relation can be added but never taken back. */
  async function loadPlaceRelations(placeId) {
    if (!placeId) return;
    try {
      const chain = await api.get(`/api/cases/${caseState.current.id}/entities/${placeId}/chain`);
      if (placeModal?.id === placeId) placeModal.relations = chain?.relations ?? [];
    } catch {
      if (placeModal?.id === placeId) placeModal.relations = [];
    }
  }

  function placeCoordsLabel(m) {
    return fmtCoords(m.lat, m.lon);
  }

  async function savePlaceModal() {
    if (!placeModal || placeSaving) return;
    placeSaving = true;
    try {
      const m = placeModal;
      let caseId = caseState.current.id;
      let placeId = m.id;
      if (m.id) {
        // edit existing place: retitle + set/clear the note
        const title = m.title.trim() || placeCoordsLabel(m);
        await api.patch(`/api/cases/${caseId}/entities/${m.id}`, {
          label: title,
          attrs: { notes: m.notes.trim(), folder: m.folder ?? '' },
        });
      } else {
        const c = await ensureCase();
        caseId = c.id;
        const entity = await api.post(`/api/cases/${c.id}/satellite/place`, {
          lat: m.lat,
          lon: m.lon,
          zoom: m.zoom,
          bearing: m.bearing,
          title: m.title,
          notes: m.notes,
          folder: m.folder,
        });
        placeId = entity.id;
      }
      // The relation is filed last: it needs a place that exists, and saving the
      // point is worth keeping even if the edge is refused.
      if (m.relation && placeId) await saveRelation(caseId, placeId, m.relation);
      placeModal = null;
      await reloadCase();
      toast('Place saved', 'ok', 1600);
    } catch (e) {
      toast(`Could not save place: ${e.message}`, 'danger', 6000);
    } finally {
      placeSaving = false;
    }
  }
</script>

<div class="tool" class:fullscreen bind:this={toolEl}>
  <div class="tool-header">
    <h2>Satellite</h2>
    <div class="spacer"></div>
    <PlaceSearch
      bind:value={coordsText}
      savedRows={savedWork.rows}
      centre={{ lat: center.lat, lon: center.lon }}
      units={prefs.units}
      {searching}
      onpick={goToSuggestion}
      onsubmit={goTo}
    />
  </div>

  <div class="body">
    {#if homeReady}
      <MapSurface
        bind:this={surface}
        bind:engine
        bind:element={mapEl}
        bind:view={center}
        bind:bearing
        bind:ready={mapReady}
        bind:refused={mapRefused}
        {imagery}
        {providerId}
        {s2}
        home={prefs.homeView}
        labels={osmOverlay}
        imperial={prefs.units === 'imperial'}
        armed={measure.mode
          ? 'measuring'
          : capture.armed
            ? 'selecting'
            : grid.drawMode
              ? 'grid-drawing'
              : null}
        grabbing={capture.hiding}
        onclick={onMapClick}
        onusage={() => imagery.refreshUsage()}
        onwidgetload={(meter) => imagery.countLoad(meter)}
        onwidgetauthfailure={onWidgetAuthFailure}
        onwidgetfailed={onWidgetFailed}
      >
      <!-- saved work on the map: navigation only, off by default, session-only.
           It draws the panel's current selection, not the whole index. -->
      {#if savedOverlay}
        <SavedOverlay
          engine={mapReady ? engine : null}
          items={savedWork.shown}
          caseId={caseState.current?.id}
          coords={coordsLabel}
          {fullscreen}
          bind:hoveredId={hoveredSavedId}
          onopen={openSaved}
          onedit={editSaved}
          onproof={sendToComposer}
          onpost={openLinkedPost}
          onshowproofs={() => (savedWork.kind = 'proofs')}
          onrefresh={reloadCase}
        />
      {/if}

      {#if sheetPoints}
        <SheetPointsOverlay engine={mapReady ? engine : null} points={sheetPoints.points} />
        <!-- Both temporary layers can be on at once, so this one sits under the other
             rather than on top of it. -->
        <div class="temporal-layer-card" class:stacked={temporalMap} aria-label="Sheet map layer">
          <div>
            <strong>Sheet</strong>
            <span>{sheetPoints.sheet} · {sheetPoints.column}</span>
          </div>
          <p>{sheetPoints.points.length} point{sheetPoints.points.length === 1 ? '' : 's'} read from the column</p>
          <nav aria-label="Close the sheet layer">
            <button class="quiet" onclick={() => (sheetPoints = null)}>Close</button>
          </nav>
        </div>
      {/if}

      {#if temporalMap}
        <TemporalMapOverlay
          engine={mapReady ? engine : null}
          items={temporalMap.items}
          caseId={caseState.current?.id}
          onopen={openTemporalTimeline}
        />
        <div class="temporal-layer-card" aria-label="Timeline map layer">
          <div>
            <strong>Timeline</strong>
            <span>{windowWords(temporalMap.from, temporalMap.to, 'UTC')}</span>
          </div>
          {#if temporalMapLoading}
            <p>Loading placed statements…</p>
          {:else if temporalMapError}
            <p class="error">{temporalMapError}</p>
          {:else if !temporalMap.matched}
            <p>Nothing is dated in this window.</p>
          {:else if !temporalMap.mapped}
            <p>None of the {temporalMap.matched} dated here carries a place.</p>
          {:else}
            <p>{temporalMap.mapped} placed of {temporalMap.matched} dated{temporalMap.truncated ? ', partial' : ''}</p>
          {/if}
          <nav aria-label="Open Timeline range">
            <button onclick={() => openTemporalTimeline()}>Timeline</button>
            <button onclick={() => openTemporalCatalog('board')}>Board</button>
            <button onclick={() => openTemporalCatalog('graph')}>Graph</button>
            <button class="quiet" onclick={closeTemporalMap}>Close</button>
          </nav>
        </div>
      {/if}

      <!-- top-left control cluster: fullscreen, OSM labels overlay, measure tools -->
      <div class="map-tools">
        <MapToolCluster
          {fullscreen}
          {toggleFullscreen}
          bind:osmOverlay
          {baseIsImagery}
          toolsOpen={measure.panelOpen}
          measureMode={measure.mode}
          toggleTools={() => measure.togglePanel()}
          gridMode={grid.on}
          {toggleGridMode}
          bind:savedOverlay
          savedCount={savedWork.rows.length}
          referenceCount={refs.open.length}
          openRefPicker={() => refs.openPicker()}
          {setMeasureMode}
          measureReadout={measure.readout}
          measureHint={MEASURE_HINT}
          clearMeasure={() => measure.clear()}
          sunMode={sky.on}
          {toggleSunMode}
        />

        {#if sky.on}
          <SunPanel
            sky={sky.sky}
            loading={sky.loading}
            day={sky.day}
            index={sky.index}
            anchor={sky.anchor}
            placing={sky.placing}
            ondate={(value) => sky.setDay(value)}
            onindex={(value) => sky.setIndex(value)}
            onplace={() => sky.togglePlacing()}
            onclose={toggleSunMode}
          />
        {/if}

        {#if grid.on}
          <GridSearchPanel
            bind:collapsed={grid.collapsed}
            bind:renaming={grid.renaming}
            bind:renameText={grid.renameText}
            commitRename={() => grid.commitRename()}
            startRename={() => grid.startRename()}
            grid={grid.grid}
            toggleHidden={() => grid.toggleHidden()}
            hidden={grid.hidden}
            coverage={grid.coverage}
            reviewKey={grid.reviewKey}
            markReview={grid.markReview}
            reviewToPlace={grid.reviewToPlace}
            stopReview={grid.stopReview}
            startReview={() => grid.startReview()}
            editArea={grid.editArea}
            toggleEditArea={() => grid.toggleEditArea()}
            discard={() => grid.discard()}
            deleteGrid={(slug) => grid.remove(slug)}
            gridName={grid.name}
            bind:cellMetres={grid.cellMetres}
            drawMode={grid.drawMode}
            startDraw={(type) => grid.startDraw(type)}
            polygonDraft={grid.draft}
            confirmPolygon={() => grid.confirmPolygon()}
            cancelDraw={() => grid.cancelDraw()}
            savedGrids={grid.others}
            loadGrid={(slug) => grid.load(slug)}
          />
        {/if}
      </div>

      <!-- capture-frame outline: what the centred Capture will cover — only when
           a centred capture is the intent (hovering the capture button, or
           mid-capture) and not while drawing a marquee -->
      {#if capture.mode === 'center' && (captureHover || capture.busy) && !capture.armed && !selRect}
        <div
          class="frame-overlay"
          style="width:{capture.size[0]}px;height:{capture.size[1]}px"
          aria-hidden="true"
        ></div>
      {/if}

      <!-- live marquee: the rectangle being dragged to define a custom crop -->
      {#if selRect}
        <div
          class="sel-rect"
          style="left:{Math.min(selRect.x0, selRect.x1)}px;top:{Math.min(selRect.y0, selRect.y1)}px;width:{Math.abs(selRect.x1 - selRect.x0)}px;height:{Math.abs(selRect.y1 - selRect.y0)}px"
          aria-hidden="true"
        >
          <span class="sel-dim mono">
            {Math.round(Math.abs(selRect.x1 - selRect.x0))} × {Math.round(Math.abs(selRect.y1 - selRect.y0))}
          </span>
        </div>
      {/if}

      <!-- fixed center marker; a draggable map marker takes over in move mode -->
      {#if markerStyle !== 'none' && !moveMode}
        <div class="marker-overlay marker-{markerStyle}" aria-hidden="true">
          {#if markerStyle === 'pin'}
            <svg width="30" height="42" viewBox="0 0 30 42">
              <path
                d="M15 41 C15 41 27 24 27 14 A12 12 0 1 0 3 14 C3 24 15 41 15 41 Z"
                fill="#e5484d" stroke="#3c0c0e" stroke-width="1.5"
              />
              <circle cx="15" cy="14" r="4.5" fill="#fff" stroke="#3c0c0e" stroke-width="1" />
            </svg>
          {:else}
            <svg width="46" height="46" viewBox="0 0 46 46">
              <g stroke="#000" stroke-width="4" opacity="0.55">
                <line x1="1" y1="23" x2="16" y2="23" /><line x1="30" y1="23" x2="45" y2="23" />
                <line x1="23" y1="1" x2="23" y2="16" /><line x1="23" y1="30" x2="23" y2="45" />
              </g>
              <g stroke="#fff" stroke-width="2">
                <line x1="1" y1="23" x2="16" y2="23" /><line x1="30" y1="23" x2="45" y2="23" />
                <line x1="23" y1="1" x2="23" y2="16" /><line x1="23" y1="30" x2="23" y2="45" />
                <circle cx="23" cy="23" r="2.5" fill="none" />
              </g>
            </svg>
          {/if}
        </div>
      {/if}

      <!-- middle-drag rotation pivot: sober target at the grabbed point, pinned
           on screen while the map turns around it -->
      {#if rotating}
        <div class="rotate-pivot" style:left={`${rotatePivot.x}px`} style:top={`${rotatePivot.y}px`} aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 40 40">
            <circle class="ring" cx="20" cy="20" r="15" />
            <circle class="dot" cx="20" cy="20" r="1.5" />
          </svg>
        </div>
      {/if}

      <div class="hud card">
        <button class="hud-coords mono" onclick={copyCoords} title="Copy coordinates">
          <Icon name="crosshair" size={13} />
          {readout}
          <span class="z">z{center.zoom}</span>
          {#if moveMode && markerLatLng}<span class="pin-tag">pin</span>{/if}
          <Icon name="copy" size={12} />
        </button>
      </div>

      <div class="capture-bar card">
        <select class="select" bind:value={providerId} title="Imagery provider">
          {#each imagery.providers as p (p.id)}
            <option value={p.id} disabled={p.needs_key}>
              {p.label}{p.needs_key ? ' (needs API key)' : ''}
            </option>
          {/each}
        </select>
        {#if isSentinel}
          <SentinelPicker
            bind:menuEl={s2MenuEl}
            {s2}
            {maxccLabel}
            {monthLabel}
            {monthGrid}
            {cloudClass}
            {cloudLabel}
          />
        {/if}
        {#if usagePill}
          <span
            class="usage-pill mono"
            title="Requests to this billed provider this month"
          >{usagePill}</span>
        {/if}
        {#if shown.fallenBack}
          <span
            class="fallback-pill"
            class:paused={shown.blocked}
            title={shown.blocked
              ? `${currentProvider.label} passed 90% of its monthly free tier. Free imagery is shown instead. Override in Settings to keep using it (billed).`
              : `Eco mode shows free imagery at low zoom. Zoom in for ${currentProvider.label} detail. Toggle in Settings.`}
          >
            <Icon name={shown.blocked ? 'alert' : 'leaf'} size={11} />
            {shown.blocked ? `${currentProvider.label} paused · free imagery` : 'eco · free imagery'}
          </span>
        {/if}
        <select class="select" bind:value={markerStyle} title="Marker style">
          <option value="crosshair">✛ crosshair</option>
          <option value="pin">📍 pin</option>
          <option value="none">no marker</option>
        </select>
        <button
          class="btn btn-toggle"
          class:on={moveMode}
          onclick={toggleMoveMode}
          disabled={markerStyle === 'none'}
          title="Move the marker (coordinates follow it)"
        >
          <Icon name="crosshair" size={14} /> {moveMode ? 'Moving' : 'Move pin'}
        </button>
        <span class="bar-sep" aria-hidden="true"></span>
        <div class="place-save">
          <button
            class="btn place-save-main"
            onclick={savePlace}
            disabled={savingPlace}
            title="Save this point as a place (no image)"
          >
            <Icon name="pin" size={15} /> {savingPlace ? 'Saving…' : 'Save place'}
          </button>
          <button
            class="btn place-save-edit"
            onclick={openNewPlace}
            title="Save place with a title and note…"
            aria-label="Save place with a title and note"
          >
            <Icon name="note" size={14} />
          </button>
        </div>
        <!-- capture controls: one split button. The main part re-runs whichever
             mode was used last — a centred capture at the chosen size, or
             arming a marquee to drag a custom area — and the arrow opens the
             mode + size/ratio/resolution settings. Hovering/focusing the main
             button previews the centred crop frame, only while that's the
             active mode. -->
        <CaptureOptions
          bind:menuEl={sizeMenuEl}
          bind:menuOpen={capture.menuOpen}
          bind:mode={capture.mode}
          bind:hover={captureHover}
          selectArmed={capture.armed}
          capturing={capture.busy}
          blocked={capture.blocked}
          widgetBase={capture.widget}
          runCapture={() => capture.run()}
          ratios={RATIOS}
          bind:ratio={capture.ratio}
          presets={PRESETS}
          bind:preset={capture.preset}
          bind:customWidth={capture.customW}
          bind:customHeight={capture.customH}
          bind:resolution={capture.resolution}
          openScreenshot={() => (capture.shotOpen = true)}
          openExtensionGate={() => (capture.extGate = true)}
        />
      </div>
      <!-- floating reference-image windows (scratch aids over the map) -->
      {#each refs.open as pane (pane.id)}
        <RefViewer
          viewer={pane}
          caseId={caseState.current?.id}
          onfocus={(id) => refs.focus(id)}
          onclose={(id) => refs.close(id)}
        />
      {/each}
      </MapSurface>
    {/if}

    <aside
      class="captures"
      class:collapsed={capturesCollapsed}
      class:resizing={savedResizing}
      style={capturesCollapsed ? undefined : `width: ${savedW}px`}
    >
      {#if !capturesCollapsed}
        <!-- a <button> rather than a bare div: the handle must be focusable and
             keyboard-driven (arrows resize), and the element carries that for free -->
        <button
          type="button"
          class="resizer"
          aria-label="Resize the saved panel"
          title="Drag to resize · double-click to reset"
          onpointerdown={startSavedResize}
          ondblclick={resetSavedWidth}
          onkeydown={onSavedResizeKey}
        ></button>
      {/if}
      <button
        type="button"
        class="cap-head"
        onclick={toggleCaptures}
        title={capturesCollapsed ? 'Show saved work' : 'Hide saved work'}
      >
        <Icon name={capturesCollapsed ? 'chevronLeft' : 'chevronRight'} size={15} />
        <span class="label" style="margin:0">Saved</span>
        <span class="count">{savedWork.rows.length}</span>
      </button>
      {#if capturesCollapsed}
        <!-- collapsed: header acts as the toggle back to the list -->
      {:else}
        <div class="panel-scroll">
          <!-- External maps: quick jumps to maps we can't embed in-tool, at the
               current target coordinates (item 6) -->
          <button type="button" class="sub-head" onclick={() => (linksOpen = !linksOpen)}>
            <Icon name={linksOpen ? 'chevronDown' : 'chevronRight'} size={12} />
            <Icon name="external" size={13} />
            <span>Open in…</span>
            <span class="count">{externalLinks.length}</span>
          </button>
          {#if linksOpen}
            <div class="links-grid">
              {#each externalLinks as l (l.id)}
                <a
                  class="ext-link"
                  class:disabled={fullscreen}
                  href={fullscreen ? undefined : l.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-disabled={fullscreen}
                  title={leavesFullscreen ?? l.url}
                >
                  <Icon name="globe" size={13} />
                  <span>{l.label}</span>
                  <Icon name="external" size={12} />
                </a>
              {/each}
            </div>
            <div class="links-note mono">{readout}</div>
            <!-- the way back: the capture extension files what you find over
                 there straight into the case, coordinates parsed from the URL -->
            <button type="button" class="links-advert" onclick={() => {
              uiState.settingsTab = 'extension';
              uiState.tool = 'settings';
            }}>
              <Icon name="crop" size={12} />
              <span>
                {extensionVersion()
                  ? 'Capture these sites into the case with the browser extension'
                  : 'Get the capture extension to file these sites into the case'}
              </span>
            </button>
          {/if}

          <SavedTree
            rows={savedWork.shownRows}
            folders={caseState.current?.folders ?? []}
            caseId={caseState.current?.id}
            coords={coordsLabel}
            {fullscreen}
            bind:kind={savedWork.kind}
            bind:query={savedWork.query}
            bind:group={savedWork.group}
            bind:hoveredId={hoveredSavedId}
            onmove={moveSaved}
            revealId={revealSavedId}
            locating={savedWork.locating}
            onopen={openSaved}
            onedit={editSaved}
            ondelete={(row) => (deleteTarget = row)}
            onproof={sendToComposer}
            onaccept={acceptSaved}
            onbrowse={() => (savedSearchOpen = true)}
            onlocate={runLocate}
            oncancelLocate={savedWork.stopLocate}
          />
        </div>
      {/if}
    </aside>
  </div>
</div>

<!-- delete confirm: a capture drops its image file, a place its entity -->
{#if deleteTarget}
  <ConfirmDialog
    title={deleteTarget.kind === 'place' ? 'Delete this place?' : 'Delete this capture?'}
    message={`“${deleteTarget.title || coordsLabel(deleteTarget)}” will be removed from the case.`}
    detail={deleteTarget.kind === 'place'
      ? 'Moves the saved point to the case trash.'
      : 'Moves the capture and its image to the case trash.'}
    restorable={RESTORABLE}
    confirmLabel="Delete"
    tone="default"
    busy={deleteBusy}
    onconfirm={confirmDelete}
    oncancel={() => (deleteTarget = null)}
  />
{/if}

{#if notesItem}
  <CaptureDetails
    row={notesItem}
    caseId={caseState.current?.id}
    folders={caseState.current?.folders ?? []}
    coords={coordsLabel}
    {leavesFullscreen}
    onsave={saveNotes}
    onclose={() => (notesItem = null)}
  />
{/if}

<!-- Search every saved item at full width: the same index the tree reads, with
     thumbnails and a sort. No fetch, no network. -->
{#if savedSearchOpen}
  <SavedSearch
    rows={savedWork.shownRows}
    caseId={caseState.current?.id}
    coords={coordsLabel}
    {fullscreen}
    centre={{ lat: center.lat, lon: center.lon }}
    bind:kind={savedWork.kind}
    bind:query={savedWork.query}
    bind:hoveredId={hoveredSavedId}
    onclose={() => (savedSearchOpen = false)}
    onopen={openSaved}
    onedit={editSaved}
    ondelete={(row) => (deleteTarget = row)}
    onproof={sendToComposer}
    onaccept={acceptSaved}
  />
{/if}

{#if capture.shotOpen}
  <ScreenshotDialog
    view={center}
    {fmtCoords}
    grab={() => capture.grabView()}
    file={(blob) => capture.fileBlob(blob)}
    onclose={() => (capture.shotOpen = false)}
  />
{/if}

{#if capture.extGate}
  <ExtensionGate
    onclose={() => (capture.extGate = false)}
    onsettings={() => {
      capture.extGate = false;
      uiState.settingsTab = 'extension';
      uiState.tool = 'settings';
    }}
  />
{/if}

{#if placeModal}
  <PlaceDialog
    draft={placeModal}
    caseId={caseState.current?.id}
    folders={caseState.current?.folders ?? []}
    saving={placeSaving}
    coords={placeCoordsLabel}
    onsave={savePlaceModal}
    onclose={() => (placeModal = null)}
    onwalk={(entity) => {
      placeModal = null;
      openEntity(entity);
    }}
    onchanged={async () => {
      await loadPlaceRelations(placeModal?.id);
      await reloadCase();
    }}
  />
{/if}

{#if refs.picking}
  <RefPicker
    media={refs.media}
    loading={refs.loading}
    caseId={caseState.current?.id}
    onpick={(item) => refs.add(item)}
    onclose={() => (refs.picking = false)}
  />
{/if}

<style>
  .spacer {
    flex: 1;
  }
  .body {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .temporal-layer-card.stacked { top: 150px; }
  .temporal-layer-card {
    position: absolute;
    z-index: 720;
    top: 12px;
    right: 12px;
    width: min(330px, calc(100% - 90px));
    padding: 10px 12px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    background: color-mix(in srgb, var(--bg-1) 94%, transparent);
    box-shadow: var(--shadow-2);
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .temporal-layer-card > div {
    display: flex;
    gap: 7px;
    min-width: 0;
  }
  .temporal-layer-card strong { color: var(--text-1); }
  .temporal-layer-card span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .temporal-layer-card p { margin: 6px 0 8px; color: var(--text-3); }
  .temporal-layer-card .error { color: var(--danger); }
  .temporal-layer-card nav { display: flex; gap: 9px; }
  .temporal-layer-card button {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }
  .temporal-layer-card button:hover { text-decoration: underline; }
  .temporal-layer-card .quiet { margin-left: auto; color: var(--text-3); }
  .frame-overlay {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    border: 1px dashed rgba(255, 255, 255, 0.55);
    box-shadow: 0 0 0 100vmax rgba(12, 12, 12, 0.28);
    pointer-events: none;
    z-index: 450;
  }
  .marker-overlay {
    position: absolute;
    top: 50%;
    left: 50%;
    pointer-events: none;
    z-index: 500;
  }
  .marker-crosshair {
    transform: translate(-50%, -50%);
  }
  .marker-pin {
    /* tip of the pin sits on the point */
    transform: translate(-50%, -100%);
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
  }
  :global(.sat-marker) {
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
  }
  /* Sober rotation pivot (Google-Earth style): faint translucent ring + dot. */
  .rotate-pivot {
    position: absolute;
    transform: translate(-50%, -50%);
    pointer-events: none;
    z-index: 650;
    color: #fff;
  }
  .rotate-pivot svg {
    display: block;
    overflow: visible;
    filter: drop-shadow(0 0 1.5px rgba(0, 0, 0, 0.55));
  }
  .rotate-pivot .ring {
    fill: none;
    stroke: currentColor;
    stroke-width: 1;
    opacity: 0.5;
  }
  .rotate-pivot .dot {
    fill: currentColor;
    opacity: 0.8;
  }
  .pin-tag {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--accent-text, #fff);
    background: var(--accent);
    border-radius: 3px;
    padding: 1px 4px;
  }
  .hud {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 600;
    display: flex;
    background: rgba(24, 24, 24, 0.88);
    backdrop-filter: blur(6px);
  }
  .hud-coords {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 13px;
    font-size: var(--fs-sm);
    color: var(--text-1);
  }
  .hud-coords:hover {
    color: var(--accent);
  }
  .z {
    color: var(--text-3);
    font-size: var(--fs-xs);
  }

  /* fullscreen: the whole tool covers the viewport, above the app chrome */
  .tool.fullscreen {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: var(--bg-0);
  }

  /* top-left control cluster (fullscreen · OSM labels · measure) */
  .map-tools {
    position: absolute;
    top: 12px;
    left: 12px;
    /* above the engine's own control corners so the measure panel is never
       hidden behind the zoom +/- buttons (item 7) */
    z-index: 1100;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
  }

  /* draggable square handle for the area corners / polygon vertices */
  :global(.grid-handle) {
    background: var(--accent, #f5a623);
    border: 2px solid #14161d;
    border-radius: 3px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.55);
    cursor: grab;
  }
  :global(.grid-handle:active) {
    cursor: grabbing;
  }

  /* live capture marquee: a dashed box with a dark scrim over the rest of the
     map, mirroring the centred frame-overlay look */
  .sel-rect {
    position: absolute;
    border: 1.5px dashed var(--accent);
    box-shadow: 0 0 0 100vmax rgba(12, 12, 12, 0.28);
    pointer-events: none;
    z-index: 460;
  }
  .sel-dim {
    position: absolute;
    top: -22px;
    left: 0;
    padding: 2px 6px;
    border-radius: var(--radius-1);
    font-size: var(--fs-xs);
    color: var(--text-1);
    background: var(--accent);
    color: var(--accent-text);
    white-space: nowrap;
  }

  .capture-bar {
    position: absolute;
    bottom: 34px;
    /* Centred by auto margins across the full width, NOT by left:50% +
       translateX: an absolutely positioned box with `left: 50%` may only be as
       wide as the half it starts at, so the bar was being squeezed to half the
       map and cut off (or, once it could wrap, folded into a stack of rows).
       Spanning left:0/right:0 gives it the whole width to size against, and
       fit-content keeps it hugging its controls. */
    left: 0;
    right: 0;
    margin: 0 auto;
    width: fit-content;
    max-width: calc(100% - 20px);
    z-index: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    /* only ever reached on a genuinely narrow map — a second row beats
       controls that are off-screen */
    flex-wrap: wrap;
    gap: 8px 10px;
    padding: 10px 12px;
    background: rgba(24, 24, 24, 0.92);
    backdrop-filter: blur(6px);
    box-shadow: var(--shadow-2);
  }
  .capture-bar .select {
    width: auto;
    /* "OpenTopoMap (topographic · contour lines)" is not worth a row of bar */
    max-width: 190px;
  }
  /* billed-provider tile counter (IMAGERY_PROVIDERS.md) — full readout in Settings */
  .usage-pill {
    font-size: var(--fs-xs);
    color: var(--text-3);
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    padding: 3px 9px;
    white-space: nowrap;
  }
  .bar-sep {
    width: 1px;
    align-self: stretch;
    background: var(--border);
    margin: 0 2px;
  }
  /* eco / soft-block fallback: the billed basemap stepped aside for free imagery */
  .fallback-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: var(--fs-xs);
    color: var(--ok);
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    padding: 3px 9px;
    white-space: nowrap;
  }
  .fallback-pill.paused {
    color: var(--danger);
  }
  .prov.dates {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 1px;
  }
  .prov.dates :global(svg) {
    vertical-align: -1px;
    opacity: 0.8;
  }
  .img-date {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .place-save {
    display: flex;
    align-items: stretch;
  }
  .place-save-main {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
  .place-save-edit {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    border-left: none;
    padding-left: 8px;
    padding-right: 8px;
  }
  .btn-toggle {
    white-space: nowrap;
  }
  .btn-toggle.on {
    background: var(--accent);
    color: var(--accent-text);
    border-color: var(--accent);
  }
  .spinner {
    width: 13px;
    height: 13px;
    border: 2px solid var(--accent-text);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .captures {
    position: relative;
    width: 300px; /* the inline style carries the dragged width */
    flex-shrink: 0;
    border-left: 1px solid var(--border);
    background: var(--bg-1);
    display: flex;
    flex-direction: column;
  }
  .captures.collapsed {
    width: 42px;
  }
  /* the grab strip sits just inside the left edge, over the panel's padding */
  .resizer {
    position: absolute;
    top: 0;
    left: 0;
    width: 5px;
    height: 100%;
    z-index: 2;
    cursor: col-resize;
    background: transparent;
    border: none;
    padding: 0;
    transition: background 0.12s;
  }
  .resizer:hover,
  .resizer:focus-visible,
  .captures.resizing .resizer {
    background: var(--accent);
    outline: none;
  }
  /* a drag reads as one gesture — no text selection on the way */
  .captures.resizing {
    user-select: none;
  }
  .cap-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 14px 14px 8px;
    width: 100%;
    background: none;
    border: none;
    color: var(--text-1);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .cap-head:hover {
    color: var(--accent);
  }
  .captures.collapsed .cap-head {
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 10px;
    padding: 14px 0;
    height: 100%;
  }
  .captures.collapsed .cap-head .label {
    writing-mode: vertical-rl;
  }
  .count {
    font-size: var(--fs-xs);
    color: var(--text-3);
    font-weight: 600;
  }
  .panel-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 4px 12px 12px;
    display: flex;
    flex-direction: column;
  }
  .sub-head {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 12px 2px 6px;
    background: none;
    border: none;
    font: inherit;
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-2);
    text-align: left;
    cursor: pointer;
  }
  .sub-head:hover {
    color: var(--accent);
  }
  .sub-head .count {
    margin-left: auto;
    text-transform: none;
  }
  .links-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    padding: 4px 2px 6px;
  }
  .ext-link {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-1);
    background: var(--bg-2);
    color: var(--text-2);
    font-size: var(--fs-xs);
    text-decoration: none;
    overflow: hidden;
  }
  .ext-link span {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ext-link:hover:not(.disabled) {
    color: var(--accent);
    border-color: var(--accent);
  }
  /* fullscreen: leaving for another tab would drop the map anyway (see
     leavesFullscreen) */
  .ext-link.disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .ext-link :global(svg:last-child) {
    color: var(--text-3);
    flex-shrink: 0;
  }
  .links-note {
    padding: 0 4px 6px;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  /* the capture-extension pointer under the external links — quiet, one line */
  .links-advert {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 4px;
    margin: 0 0 6px;
    border: none;
    background: none;
    font-size: var(--fs-xs);
    color: var(--text-3);
    text-align: left;
    cursor: pointer;
  }
  .links-advert:hover {
    color: var(--accent);
  }


</style>
