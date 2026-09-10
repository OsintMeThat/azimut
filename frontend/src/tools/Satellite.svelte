<script>
  import { onMount, tick } from 'svelte';
  import { fileUrl } from '../lib/fileUrl.js';
  // The map is lib/map's: the engine, its layers, what is drawn on them and the
  // drag gestures. Nothing in this file knows which engine that is.
  import { createMapEngine } from '../lib/map/engine.js';
  import { createBasemaps } from '../lib/map/basemap.js';
  import { createSurface } from '../lib/map/surface.js';
  import { createSentinelState } from './satellite/state/sentinel.svelte.js';
  import { createSavedState } from './satellite/state/saved.svelte.js';
  import { api } from '../lib/api.js';
  import { setAnalysisPeriod } from '../lib/analysisSearch.svelte.js';
  import { temporalMapQuery } from '../lib/temporalMap.js';
  import { windowWords } from '../lib/timeline.js';
  import { isMode } from '../lib/geoTree.js';
  import {
    caseState, uiState, ensureCase, reloadCase, toast, prefs, fmtCoords, prefsReady,
  } from '../lib/state.svelte.js';
  import { mapLinks } from '../lib/maplinks.js';
  import * as measure from '../lib/measure.js';
  import { markerGeometry, markerSvg } from '../lib/mapMarkers.js';
  import {
    bodyReading,
    bodySvg,
    hourTicks,
    isBelow,
    markScale,
    nearestSample,
    upRuns,
  } from '../lib/skyOverlay.js';
  import * as gridSearch from '../lib/gridSearch.js';
  import { startRectDrag, startRotateDrag } from '../lib/map/gestures.js';
  import { clampSize, scaledCapture } from '../lib/captureSize.js';
  import { panelWidth } from '../lib/panelWidth.js';
  import PlaceSearch from './satellite/PlaceSearch.svelte';
  import { assignFolder } from '../lib/filing.js';
  import { saveRelation } from '../lib/relations.svelte.js';
  import { openEntity } from '../lib/navigate.js';
  import { deletedToast, RESTORABLE } from '../lib/trash.js';
  import { isRegistered, sourceRect, frameFitsView } from '../lib/screenCrop.js';
  import { extensionVersion, captureTab, onActivated } from '../lib/extBridge.js';
  import {
    monthCount,
    tilesShort,
    usageBlocked,
    displayProviderId,
    layerCell,
  } from '../lib/usage.js';
  import {
    SENTINEL_ID,
    DEFAULT_LAYER,
    DEFAULT_MAXCC,
    variantId,
    validDay,
    validMaxcc,
    maxccLabel,
    overCloudCeiling,
    latestAllowedPass,
    cloudLabel,
    cloudClass,
    isoDay,
    monthOf,
    monthLabel,
    monthBounds,
    monthGrid,
    addMonths,
    sentinelPlaceKey,
    coverageRequestPath,
    dateAfterCoverage,
  } from '../lib/sentinel.js';
  import { createViewer, nextZ, restack } from '../lib/refViewers.js';
  import { matchesQuery } from '../lib/mediaFilter.js';
  import Icon from '../components/Icon.svelte';
  import Modal from '../components/Modal.svelte';
  import SearchInput from '../components/SearchInput.svelte';
  import FolderBrowser from '../components/FolderBrowser.svelte';
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

  let mapEl;
  let toolEl; // Browser fullscreen target.
  // The map, through lib/map's façade: no engine type reaches this file's
  // camera, projection or event code.
  let engine = $state.raw(null);
  let basemaps = null; // lib/map/basemap.js: the imagery layer and the labels over it
  let providers = $state([]);
  let providerId = $state('esri-world-imagery');
  let coordsText = $state('');
  // Start at the saved home view unless case navigation supplies a position.
  // Re-read after preferences load because deep links can mount first.
  let center = $state({ ...prefs.homeView });
  let markerStyle = $state('none'); // 'crosshair' | 'pin' | 'none'
  let moveMode = $state(false); // pin decoupled from center, draggable
  let markerSurface = null; // lib/map/surface.js — holds the pin while in move mode
  let markerLatLng = $state(null); // {lat, lon} of the moved pin
  let bearing = $state(0);
  // Middle-drag rotates the map around the grabbed point.
  let rotating = $state(false);
  let rotatePivot = $state({ x: 0, y: 0 }); // grabbed point, map-wrap-local px
  let capturing = $state(false);
  let captureHover = $state(false); // previewing the crop frame (capture group hover)
  let hideOverlays = $state(false); // frame/marquee outlines must not land in a screen crop
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
  const currentProvider = $derived(providers.find((p) => p.id === providerId));
  const baseIsImagery = $derived(currentProvider?.imagery ?? true);
  // view-only basemaps (capturable=false) keep the map but not the capture
  // button (IMAGERY_PROVIDERS.md). Widget basemaps are also capturable=false —
  // there are no tiles to stitch — but they are *not* blocked: they capture the
  // same way through the same button, from screen pixels rather than tiles.
  const isWidgetBase = $derived(!!currentProvider?.widget);
  const captureBlocked = $derived(currentProvider?.capturable === false && !isWidgetBase);

  // --- Sentinel-2: which layer, and over which window ---
  // The one basemap with choices in it. What has been asked, what came back and
  // what is still in flight all live in its own store; the choices ride on the
  // provider id, which is what the map, the capture and the cache key on.
  const s2 = createSentinelState({
    place: () => ({ lat: center.lat, lon: center.lon }),
    onBilled: refreshUsage,
    notify: toast,
    api,
  });
  const isSentinel = $derived(currentProvider?.id === SENTINEL_ID);
  // A pinned day *is* the acquisition date — the one provider that can answer
  // "when was this taken?" without being asked.
  const s2PinnedDate = $derived(isSentinel && s2.window.from ? s2.window.from : null);
  let s2MenuEl = $state(); // bound to the popover wrapper — outside-click detection

  // --- keyed-provider usage (IMAGERY_PROVIDERS.md) ---
  // Metered tiles are proxied through the backend, which counts each one it
  // actually serves — this readout just mirrors settings.json.
  let usageTotals = $state({});
  let usageMonth = $state('');
  // keyed-provider prefs mirrored from Settings: overrides lift the 90% soft
  // block, eco swaps billed basemaps for free imagery when zoomed out
  // `tiers` is this account's real allowance per meter (the user's correction
  // where they made one) — a provider's free tier is not ours to hardcode
  let usagePrefs = $state({ overrides: {}, eco: true, ecoMaxZoom: 15, tiers: null });
  async function refreshUsage() {
    try {
      const s = await api.get('/api/settings');
      usageTotals = s.usage;
      usageMonth = s.month;
      usagePrefs = {
        overrides: s.usage_overrides ?? {},
        eco: s.eco_zoom_fallback !== false,
        ecoMaxZoom: s.eco_max_zoom ?? 15,
        tiers: s.free_tier ?? null,
      };
    } catch {
      /* readout only — never blocks the map */
    }
  }
  // small readout near the basemap selector, billed providers only
  const usagePill = $derived(
    currentProvider?.meter
      ? tilesShort(monthCount(usageTotals, currentProvider.meter, usageMonth), currentProvider.meter)
      : null
  );

  // What the map actually shows: a billed basemap steps aside for free imagery
  // when paused (90% soft block) or zoomed out (eco). Captures and the imagery
  // date follow the display, so provenance always matches the pixels.
  const meterBlocked = $derived(
    currentProvider?.meter
      ? usageBlocked(
          monthCount(usageTotals, currentProvider.meter, usageMonth),
          currentProvider.meter,
          usagePrefs.overrides,
          usagePrefs.tiers
        )
      : false
  );
  // the basemap on screen, before Sentinel-2's layer/window choices are folded in
  const displayedBaseId = $derived(
    displayProviderId(currentProvider, center.zoom, {
      eco: usagePrefs.eco,
      blocked: meterBlocked,
      ecoMaxZoom: usagePrefs.ecoMaxZoom,
    })
  );
  const displayedProvider = $derived(providers.find((p) => p.id === displayedBaseId));
  // What every downstream consumer asks for: the tile URL, the capture, the
  // disk cache. For Sentinel-2 the layer and window ride *on the id*
  // (lib/sentinel.js), so none of them can be rendered from one window and
  // filed as another.
  const displayedProviderId = $derived(
    variantId(displayedBaseId, s2.variant)
  );
  // memoized so the layer is only rebuilt when the cell actually changes
  // (i.e. crossing the z17 boost bracket), not on every zoom step
  const displayedCell = $derived(
    displayedProvider ? layerCell(displayedProvider, center.zoom) : 256
  );

  // Acquisition date of the imagery under the crosshair — Esri only (item 2).
  let imageryDate = $state(null); // { supported, date, source } | null
  let dateReqId = 0;
  let dateTimer;

  // Fullscreen: the tool covers the whole viewport; SAVED stays collapsible (item 4).
  let fullscreen = $state(false);

  // Editable bearing readout (item 3): click the number to type an angle.
  let editingBearing = $state(false);
  let bearingInput = $state('');

  // Measure tools (item 5): distance / area / angle drawn on the map.
  let measureMode = $state(null); // null | 'distance' | 'area' | 'angle'
  let measurePoints = $state([]);
  let measureSurface = null; // lib/map/surface.js
  let toolsOpen = $state(false);

  // External-maps quick links, in the SAVED panel (item 6).
  let linksOpen = $state(false);

  // --- Grid Search (spec §5): overlay a metric grid on an area of interest and
  // sweep it cell by cell, marking each cleared or flagged. A case can hold
  // several saved grids (files under search/, working aids, not entities); each
  // action auto-saves. Persists across basemap changes — its own layer group is
  // untouched by setLayer().
  let gridMode = $state(false); // mode armed from the tools bar
  let grid = $state(null); // the open grid spec (lib/gridSearch.js), or null
  let gridName = $state(null); // slug of the open grid's file (drives the picker)
  let gridList = $state([]); // summaries of this case's saved grids (the picker)
  let gridFor = null; // case id the list was loaded for (plain: load-dedup only)
  let gridCollapsed = $state(false); // fold the panel down to its header
  let gridCellM = $state(500); // metric cell size the next area is drawn with
  let gridDraw = $state(null); // null | 'rect' | 'polygon' — drawing an area
  let polyDraft = $state([]); // polygon vertices being placed, [{ lat, lon }]
  let editArea = $state(false); // showing the area box to resize/reshape it
  let gridHidden = $state(false); // eye toggle: keep the grid but hide it on the map
  let renamingGrid = $state(false); // editing the open grid's title inline
  let renameText = $state(''); // the title being typed while renaming
  let reviewKey = $state(null); // 'i:j' of the cell under review, or null
  let gridSaveTimer; // debounce the persist call
  let gridCells = null; // lib/map/surface.js — the lattice, on a canvas
  let gridAoi = null; // …the area outline and its drag handles
  let gridDraft = null; // …the polygon being placed
  let dragBounds = null; // live rect bounds while a corner handle is dragged
  let liveVerts = null; // live polygon vertices while a vertex handle is dragged
  const gridCov = $derived(grid ? gridSearch.coverage(grid) : null);
  const savedOthers = $derived(gridList.filter((g) => g.name !== gridName));
  const GRID_MAX_CELLS = gridSearch.MAX_CELLS;
  // status → cell paint. Unchecked is a bright thin outline so the lattice reads
  // clearly over dark imagery; cleared greys the cell out; flagged fills yellow
  // (chosen over red so it reads for colour-blind analysts too).
  const CELL_STYLE = {
    unchecked: { stroke: '#ffffff', strokeWidth: 1, strokeOpacity: 0.7, fill: '#fff', fillOpacity: 0 },
    cleared: { stroke: '#ffffff', strokeWidth: 1, strokeOpacity: 0.55, fill: '#2b3040', fillOpacity: 0.62 },
    flagged: { stroke: '#ffcf33', strokeWidth: 1.5, strokeOpacity: 1, fill: '#ffdb4d', fillOpacity: 0.6 },
  };
  const AOI_STYLE = {
    stroke: '#f5a623',
    strokeWidth: 1.5,
    strokeOpacity: 0.9,
    dash: '5 4',
    interactive: false,
  };
  const CORNERS = ['sw', 'se', 'nw', 'ne']; // rect resize handles


  // --- reference viewers: floating scratch windows over the map that hold a
  // media image (the shot to geolocate) so you can eyeball it against the
  // imagery while panning. Session-only (uiState.refViewers) — never captured,
  // never saved, dropped when the case changes (see openCase).
  let refPicker = $state(false); // the "pick an image" modal
  let refMedia = $state([]); // case images available to reference
  let refLoading = $state(false);
  let refSeq = 0; // id source for spawned windows

  async function openRefPicker() {
    refPicker = true;
    refLoading = true;
    try {
      const id = caseState.current?.id;
      const media = id ? await api.get(`/api/cases/${id}/media`) : [];
      refMedia = media.filter((m) => m.kind === 'image' || m.kind === 'video');
    } catch (e) {
      toast(`Could not load media: ${e.message}`, 'danger');
      refMedia = [];
    } finally {
      refLoading = false;
    }
  }

  function addRef(item) {
    const vs = uiState.refViewers;
    const n = vs.length;
    vs.push(
      createViewer(`ref-${++refSeq}`, item, {
        x: 60 + (n % 6) * 26,
        y: 60 + (n % 6) * 26,
        z: nextZ(vs),
      })
    );
    refPicker = false;
  }

  function focusRef(id) {
    const z = restack(uiState.refViewers, id);
    for (const v of uiState.refViewers) v.z = z.get(v.id);
  }

  function closeRef(id) {
    uiState.refViewers = uiState.refViewers.filter((v) => v.id !== id);
  }

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
    refreshUsage(); // prefs drive the eco/soft-block fallbacks from the start
    providers = await api.get('/api/satellite/providers');
    await prefsReady; // the home view has to land before the map is built
    center = { ...prefs.homeView };
    try {
      engine = await createMapEngine(mapEl, {
        view: center,
        imperial: prefs.units === 'imperial',
      });
    } catch (e) {
      // The engine draws through WebGL and a browser can refuse it: an old
      // driver, a machine with no GPU, a profile hardened to turn it off. It
      // throws on the way up, and nothing below this line means anything
      // without a map — so the tool says so instead of drawing an empty panel
      // and leaving the analyst to wonder which part broke.
      console.error(e);
      mapRefused = true;
      return null;
    }
    basemaps = createBasemaps(engine, {
      onMeteredTiles: refreshUsage,
      // one billed map load, counted where it happens (the proxy can't see it)
      onWidgetLoad: (provider) =>
        api.post(`/api/satellite/usage/${provider.meter}`).then(refreshUsage).catch(() => {}),
      onWidgetAuthFailure,
      onWidgetFailed: (provider, error) => {
        toast(`Google Maps failed to load: ${error.message}`, 'danger', 6000);
        providerId = 'esri-world-imagery';
      },
    });
    setLayer();
    basemaps.setLabels(osmOverlay);
    // the façade wraps the centre back inside ±180 for us, which is what every
    // route the capture reaches enforces
    const offSettled = engine.on('view-settled', (view) => {
      center = { lat: view.lat, lon: view.lon, zoom: view.zoom };
    });
    const offRotate = engine.on('rotate', (view) => {
      bearing = Math.round(view.bearing);
    });
    const offClick = engine.on('click', onMapClick);
    // middle-mouse or shift drag rotates the view (item 3). Capture-phase so we
    // can stop the event before the engine's own container drag handler ever
    // sees it — otherwise a turn also pans.
    mapEl.addEventListener('mousedown', onMiddleRotateStart, true);
    // left-drag draws the capture marquee when that mode is armed (capture-phase
    // so the engine's pan handler never sees the gesture)
    mapEl.addEventListener('mousedown', onSelectStart, true);
    // left-drag draws a Grid Search area when the rectangle tool is armed
    mapEl.addEventListener('mousedown', onGridRectStart, true);
    window.addEventListener('keydown', onKeydown);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    // the user clicked the extension after a refused capture — close the loop
    const offActivated = onActivated(() =>
      toast('Extension ready. Press Capture again', 'ok', 5000)
    );
    mapReady = true;
    return () => {
      window.removeEventListener('keydown', onKeydown);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      offActivated();
      offSettled();
      offRotate();
      offClick();
      basemaps.dispose();
      for (const surface of [measureSurface, sunSurface, markerSurface, gridCells, gridAoi, gridDraft]) {
        surface?.destroy();
      }
      engine.destroy();
    };
  }

  function onKeydown(e) {
    if (uiState.tool !== 'satellite') return;
    // a dialog on top owns the keyboard — it closes itself, the map keeps state
    if (notesItem || placeModal || refPicker || deleteTarget) return;
    const tag = e.target?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable;
    // Enter confirms a polygon area, same as the Confirm button
    if (gridMode && gridDraw === 'polygon' && !typing && e.key === 'Enter' && polyDraft.length >= 3) {
      e.preventDefault();
      confirmPolygon();
      return;
    }
    // Grid Search sweep: single-key marks while a cell is under review
    if (gridMode && reviewKey && !typing) {
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'c') return void (e.preventDefault(), markReview('cleared'));
      if (k === 'f') return void (e.preventDefault(), markReview('flagged'));
      if (k === 's') return void (e.preventDefault(), reviewAdvance());
      if (k === 'p') return void (e.preventDefault(), reviewToPlace());
    }
    if (e.key !== 'Escape') return;
    if (gridDraw) return cancelGridDraw();
    if (reviewKey) return stopReview();
    if (selectArmed) toggleSelect();
    else if (sizeMenuOpen) sizeMenuOpen = false;
    else if (sunPlacing) sunPlacing = false;
    else if (sunMode) toggleSunMode();
    else if (measureMode) setMeasureMode(null);
    // native fullscreen already exits on Esc (handled by onFullscreenChange);
    // only the CSS fallback needs an explicit toggle here
    else if (fullscreen && !document.fullscreenElement) toggleFullscreen();
  }

  // force the labels overlay off whenever the base isn't imagery (item 1)
  $effect(() => {
    if (!baseIsImagery && osmOverlay) osmOverlay = false;
  });

  $effect(() => {
    const on = osmOverlay; // read before the guard: `basemaps?.` short-circuits
    // away the dependency while the map is still being built, and the toggle
    // then never reaches the layers again (build() applies the opening state).
    if (basemaps) basemaps.setLabels(on);
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
    if (!mapReady || displayedBaseId !== SENTINEL_ID) return;
    center.lat;
    center.lon;
    s2.maxcc; // a new ceiling can make a different pass the most recent one
    clearTimeout(s2LatestTimer);
    // debounced: panning must not spend a request per frame
    s2LatestTimer = setTimeout(() => s2.resolveLatest().catch(() => {}), 900);
  });
  let s2LatestTimer;

  // --- imagery date under the crosshair (item 2) ---
  async function refreshImageryDate() {
    const id = ++dateReqId;
    try {
      const r = await api.get(
        `/api/satellite/imagery-date?lat=${center.lat}&lon=${center.lon}` +
          `&zoom=${center.zoom}&provider=${displayedProviderId}`
      );
      if (id === dateReqId) imageryDate = r;
    } catch {
      if (id === dateReqId) imageryDate = { supported: true, date: null, source: null };
    }
  }

  // debounce: the target moves a lot while panning — only query once it settles
  $effect(() => {
    center.lat;
    center.lon;
    center.zoom;
    displayedProviderId;
    if (!mapReady) return;
    clearTimeout(dateTimer);
    dateTimer = setTimeout(refreshImageryDate, 500);
  });

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
    const shiftDrag = e.button === 0 && e.shiftKey && !selectArmed && gridDraw !== 'rect';
    if (e.button !== 1 && !shiftDrag) return;
    startRotateDrag(engine, e, {
      onPivot: (pivot) => {
        rotatePivot = pivot;
        rotating = true;
      },
      onEnd: () => (rotating = false),
    });
  }

  function startEditBearing() {
    bearingInput = String(bearing);
    editingBearing = true;
  }

  function commitBearing() {
    const v = parseFloat(bearingInput);
    if (Number.isFinite(v)) setBearing(v);
    editingBearing = false;
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

  // --- measure tools (item 5) ---
  /** Where the analyst clicked, `{ lat, lon }` from the façade. */
  function onMapClick(at) {
    // Grid Search polygon: each click drops a vertex
    if (gridDraw === 'polygon') {
      polyDraft = [...polyDraft, at];
      renderDraft();
      return;
    }
    // Sun & moon: one click plants the anchor the day's path is drawn from
    if (sunPlacing) {
      sunAnchor = at;
      sunSky = null;
      sunPlacing = false;
      return;
    }
    if (!measureMode) return;
    // an angle is exactly three points; a fourth click starts a fresh angle
    if (measureMode === 'angle' && measurePoints.length >= 3) measurePoints = [];
    measurePoints = [...measurePoints, at];
    redrawMeasure();
  }

  function setMeasureMode(m) {
    measureMode = measureMode === m ? null : m;
    if (measureMode) selectArmed = false; // measuring and marquee can't both be armed
    measurePoints = [];
    measureSurface?.clear();
  }

  // toggling the panel shut also drops any active measure tool — otherwise the
  // ruler button stays lit (and the tool stays armed) with the panel gone
  function toggleTools() {
    toolsOpen = !toolsOpen;
    if (!toolsOpen && measureMode) setMeasureMode(null);
  }

  function clearMeasure() {
    measurePoints = [];
    measureSurface?.clear();
  }

  const MEASURE_STROKE = { stroke: '#f5a623', strokeWidth: 2.5, strokeOpacity: 0.95 };
  const MEASURE_DOT = {
    radius: 4,
    stroke: '#fff',
    strokeWidth: 2,
    fill: '#f5a623',
    fillOpacity: 1,
  };

  function redrawMeasure() {
    if (!engine) return;
    measureSurface ??= createSurface(engine);
    const path =
      measurePoints.length < 2
        ? null
        : measureMode === 'area'
          ? { kind: 'polygon', points: measurePoints, style: { ...MEASURE_STROKE, fill: '#f5a623', fillOpacity: 0.15 } }
          : { kind: 'line', points: measurePoints, style: MEASURE_STROKE };
    measureSurface.set([
      path,
      ...measurePoints.map((point) => ({ kind: 'dot', at: point, style: MEASURE_DOT })),
    ]);
  }

  const measureReadout = $derived.by(() => {
    if (!measureMode || measurePoints.length < 2) return null;
    if (measureMode === 'distance')
      return measure.formatDistance(measure.pathLength(measurePoints), prefs.units);
    if (measureMode === 'area')
      return measurePoints.length >= 3
        ? measure.formatArea(measure.polygonArea(measurePoints), prefs.units)
        : '…';
    // angle needs a middle vertex
    return measurePoints.length >= 3
      ? measure.formatAngle(measure.angleAt(measurePoints[0], measurePoints[1], measurePoints[2]))
      : '…';
  });

  const MEASURE_HINT = {
    distance: 'Click points along the path',
    area: 'Click the polygon corners',
    angle: 'Click three points (vertex second)',
  };

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

  // The layers are lib/map's (basemap.js); what reaches them from here is which
  // provider to show and what a billed one owes the usage pill and Settings.
  function setLayer() {
    if (!displayedProvider || !basemaps) return;
    basemaps.show(displayedProvider, displayedProviderId, displayedCell);
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
    providers = await api.get('/api/satellite/providers');
  }

  $effect(() => {
    displayedProviderId; // track provider changes (incl. eco/block fallbacks,
    // and Sentinel-2's layer/window — a new window is a new set of tiles)
    displayedCell; // and the z17 detail-boost bracket
    setLayer();
  });

  // a basemap disabled in Settings can leave a stale selection — fall back
  $effect(() => {
    if (providers.length && !currentProvider) providerId = 'esri-world-imagery';
  });

  // re-sync providers + prefs when returning to this tab: Settings may have
  // toggled a basemap off (it must vanish from the selector) or changed the
  // eco / override prefs meanwhile (tools stay mounted, so no fresh onMount)
  $effect(() => {
    if (uiState.tool !== 'satellite' || !mapReady) return;
    refreshUsage();
    api.get('/api/satellite/providers').then((r) => (providers = r));
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
      if (target.provider && !providers.length) return;
      uiState.gotoCoords = null;
      if (target.provider && providers.some((provider) => provider.id === target.provider)) {
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

  // --- sun and moon mode ---
  //
  // One anchored point, one date, and an hour you drag: the day's path drawn as
  // the arc the body sweeps while it is up, hour ticks along it, and the bearing
  // at the chosen moment. Everything drawn is an azimuth, which is the only
  // celestial quantity a plan view can state honestly; altitude stays in the
  // panel. Map Measures will absorb this as its general bearing layer.
  let sunMode = $state(false);
  let sunAnchor = $state.raw(null); // { lat, lon } — fixed, never the moving view
  let sunDay = $state(''); // empty: the backend's today at that point
  let sunIndex = $state(0); // sample of the day the slider is on
  let sunSky = $state(null);
  let sunLoading = $state(false);
  let sunPlacing = $state(false);
  let sunSurface = null; // lib/map/surface.js
  let sunTicket = 0;

  function toggleSunMode() {
    sunMode = !sunMode;
    if (sunMode) {
      if (selectArmed) toggleSelect(); // exclusive with the capture marquee…
      if (measureMode) setMeasureMode(null); // …the measure tools…
      if (gridMode) toggleGridMode(); // …and Grid Search
      if (!sunAnchor) sunAnchor = markerLatLng ?? { lat: center.lat, lon: center.lon };
    } else {
      sunPlacing = false;
      sunSurface?.clear();
    }
  }

  // Wall clock to land the slider on, once the day's samples are in.
  let handedClock = null;

  // Coords & Sky hands over a point, a date and a time: same mode, second way in,
  // so there is only ever one rendering of this to keep right.
  $effect(() => {
    const handed = uiState.skyAt;
    if (!mapReady || !handed) return;
    uiState.skyAt = null;
    sunAnchor = { lat: handed.lat, lon: handed.lon };
    sunDay = handed.date ?? '';
    sunSky = null;
    sunIndex = 0;
    handedClock = handed.time ?? null;
    if (!sunMode) toggleSunMode();
  });

  $effect(() => {
    if (!sunMode || !sunAnchor) return;
    const params = new URLSearchParams({ lat: sunAnchor.lat, lon: sunAnchor.lon });
    if (sunDay) params.set('date', sunDay);
    const ticket = ++sunTicket;
    sunLoading = true;
    api
      .get(`/api/geo/sky?${params}`)
      .then((result) => {
        if (ticket !== sunTicket) return;
        sunSky = result;
        sunDay = result.date;
        sunIndex = nearestSample(result.curve.clock, handedClock ?? result.moment.local.slice(11, 16));
        handedClock = null;
      })
      .catch(() => {
        if (ticket === sunTicket) toast('Could not read the sky for that point', 'danger');
      })
      .finally(() => {
        if (ticket === sunTicket) sunLoading = false;
      });
  });

  function themeColour(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  const SKY_BODY_SIZE = 20;

  function drawSun() {
    if (!engine) return;
    sunSurface ??= createSurface(engine);
    if (!sunMode || !sunSky || !sunAnchor) {
      sunSurface.clear();
      return;
    }
    const origin = sunAnchor;
    // Sized off the *shorter* side of the view, not its diagonal: the arc is a
    // circle around the anchor, so a radius set by the diagonal runs off the top
    // and bottom of a wide window.
    const { across, down } = engine.viewSpanMeters();
    const reach = Math.min(across, down) * 0.22;
    const at = (azimuth, scale = 1) => measure.destination(origin, azimuth, reach * scale);
    const curve = sunSky.curve;
    const shapes = [];

    for (const body of [
      {
        key: 'sun',
        label: 'Sun',
        colour: themeColour('--sky-sun', '#bd8721'),
        azimuth: curve.sun_azimuth,
        altitude: curve.sun_altitude,
      },
      {
        key: 'moon',
        label: 'Moon',
        colour: themeColour('--sky-moon', '#4a93cc'),
        azimuth: curve.moon_azimuth,
        altitude: curve.moon_altitude,
      },
    ]) {
      // Thin and translucent: the imagery underneath is what is being read.
      const thin = { stroke: body.colour, strokeWidth: 2.5, strokeOpacity: 0.9 };
      for (const run of upRuns(body.altitude)) {
        shapes.push({ kind: 'line', points: run.map((i) => at(body.azimuth[i])), style: thin });
      }
      for (const { index: i, long } of hourTicks(curve.minutes, body.altitude)) {
        shapes.push({
          kind: 'line',
          points: [at(body.azimuth[i], 0.94), at(body.azimuth[i], long ? 1.1 : 1.03)],
          style: thin,
          tip: `${body.label} ${curve.clock[i]} · az ${Math.round(body.azimuth[i])}°`,
        });
      }
      const altitude = body.altitude[sunIndex];
      const below = isBelow(altitude);
      const reading = bodyReading(
        body.label, curve.clock[sunIndex], body.azimuth[sunIndex], altitude
      );
      shapes.push({
        kind: 'line',
        points: [origin, at(body.azimuth[sunIndex])],
        style: {
          stroke: body.colour,
          strokeWidth: 3.5,
          strokeOpacity: below ? 0.6 : 1,
          dash: below ? '6 6' : null,
        },
        tip: { text: reading, sticky: true },
      });
      // Nothing rides the ray while the body is under the horizon: the dashed
      // ray already says where it is, and a mark on it would claim it is visible.
      //
      // The body itself is a mark on its own ray: it rides between the anchor,
      // which stands for the zenith, and the arc, which stands for the horizon,
      // so how far up it is reads as how close to you it is. The geometry and
      // the glyph are in `lib/skyOverlay.js`.
      if (!below) {
        shapes.push({
          kind: 'marker',
          at: at(body.azimuth[sunIndex], markScale(altitude)),
          className: 'sky-body', // replaces the engine's boxed default
          html: bodySvg(
            body.key,
            body.colour,
            curve.moon_illuminated[sunIndex],
            sunSky.moon.waxing,
            SKY_BODY_SIZE
          ),
          size: [SKY_BODY_SIZE, SKY_BODY_SIZE],
          anchor: [SKY_BODY_SIZE / 2, SKY_BODY_SIZE / 2],
          keyboard: false,
          tip: body.key === 'moon' ? `${reading} · ${sunSky.moon.phase}` : reading,
        });
      }
    }

    shapes.push({
      kind: 'dot',
      at: origin,
      style: {
        radius: 4,
        stroke: '#fff',
        strokeWidth: 2,
        fill: themeColour('--accent', '#e8a33d'),
        fillOpacity: 1,
      },
    });
    sunSurface.set(shapes);
  }

  // Redraw on any of: a new day, a new hour, a new anchor, the mode closing.
  $effect(() => {
    sunMode;
    sunSky;
    sunIndex;
    sunAnchor;
    if (mapReady) drawSun();
  });

  // The arc is drawn in metres, so a zoom or a pan has to restretch it.
  $effect(() => {
    if (!mapReady || !sunMode) return;
    return engine.on('view-settled', () => drawSun());
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

  function resetNorth() {
    setBearing(0);
  }

  // --- marker (crosshair / pin), optionally decoupled from center ---

  // the coordinates shown & recorded: the moved pin, else the crop center
  const displayCoords = $derived(
    moveMode && markerLatLng ? markerLatLng : { lat: center.lat, lon: center.lon }
  );

  // --- capture sizing (backend validates 256–4096 px per side; see lib/captureSize.js) ---

  // Standard output sizes for the centred Capture button, named by intent.
  const PRESETS = [
    { id: '1200x675', label: 'Tweet 16:9', w: 1200, h: 675 },
    { id: '1080x1080', label: 'Square', w: 1080, h: 1080 },
    { id: '1200x630', label: 'OG card', w: 1200, h: 630 },
    { id: '1280x800', label: 'Wide', w: 1280, h: 800 },
    { id: 'custom', label: 'Custom', w: 0, h: 0 },
  ];
  let preset = $state('1200x675');
  let customW = $state(1200);
  let customH = $state(675);
  // preset dimensions in px — the centred Capture frame + its hover preview
  const presetSize = $derived.by(() => {
    if (preset === 'custom') return [clampSize(customW), clampSize(customH)];
    const p = PRESETS.find((x) => x.id === preset);
    return [p.w, p.h];
  });

  // Marquee ratio lock (width/height); null = free-form drag.
  const RATIOS = [
    { id: 'free', label: 'Free', r: null },
    { id: '16:9', label: '16:9', r: 16 / 9 },
    { id: '4:3', label: '4:3', r: 4 / 3 },
    { id: '1:1', label: '1:1', r: 1 },
  ];
  let ratio = $state('free');
  const ratioValue = $derived(RATIOS.find((x) => x.id === ratio)?.r ?? null);

  // Output resolution: 1 = view zoom, 2 = one zoom deeper (2×), 'max' = provider max.
  let resolution = $state(1);
  const providerMaxZoom = $derived(displayedProvider?.max_zoom ?? 19);

  // Single capture button, split-style: the main part re-runs whichever mode
  // was used last (remembered here); the arrow opens mode + size/ratio/
  // resolution settings.
  let captureMode = $state('center'); // 'center' | 'select'
  let sizeMenuOpen = $state(false); // the mode/size/ratio/resolution popover
  let sizeMenuEl = $state(); // bound to the popover's wrapper — used to detect outside clicks
  let selectArmed = $state(false); // marquee mode: drag a box on the map to capture
  let selRect = $state(null); // live marquee { x0, y0, x1, y1 } in map-container px

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

  // The single capture path. `framedOn` is the `{ lat, lon }` the crop is
  // framed on; `baseW`/`baseH` are the crop size at the current view zoom, then
  // scaled to the chosen output resolution. `rectCss` is the same frame as a
  // rectangle in map-container px — only the widget path needs it, since it
  // crops screen pixels rather than stitching tiles. The recorded point is the
  // moved pin (if any), else the crop centre.
  async function doCapture(framedOn, baseW, baseH, rectCss) {
    if (capturing) return;
    // widget basemaps have no tiles to stitch: same frame, screen pixels
    if (isWidgetBase) return doWidgetCapture(framedOn, rectCss);
    capturing = true;
    const { zoom, width, height, mult } = scaledCapture(
      baseW, baseH, resolution, center.zoom, providerMaxZoom
    );
    let marker_x = 0, marker_y = 0, marker_lat = framedOn.lat, marker_lon = framedOn.lon;
    if (moveMode && markerLatLng) {
      const pin = markerLatLng; // the drag keeps it current, so it is the pin
      marker_lat = pin.lat;
      marker_lon = pin.lon;
      // pin offset from the crop centre in container px (already accounts for
      // rotation), scaled up to the output pixel size
      const c0 = engine.latLngToContainerPoint(framedOn);
      const cp = engine.latLngToContainerPoint(pin);
      marker_x = Math.round((cp.x - c0.x) * mult);
      marker_y = Math.round((cp.y - c0.y) * mult);
    }
    try {
      const c = await ensureCase();
      const result = await api.post(`/api/cases/${c.id}/satellite/capture`, {
        lat: framedOn.lat,
        lon: framedOn.lon,
        zoom,
        width,
        height,
        // capture what's on screen: the eco/soft-block fallback, if active
        provider: displayedProviderId,
        bearing,
        marker_style: markerStyle,
        marker_x,
        marker_y,
        marker_lat,
        marker_lon,
        // second date on the capture: the imagery's acquisition date, if known
        // a pinned Sentinel-2 window is the acquisition date outright; every
        // other provider's is Esri's best-effort estimate or nothing
        imagery_date: s2PinnedDate ?? imageryDate?.date ?? null,
      });
      await reloadCase();
      toast(
        result.tiles_missing
          ? `Captured with ${result.tiles_missing} missing tile(s). No imagery was available there`
          : result.tiles_upscaled
            ? `Captured. ${result.tiles_upscaled} tile(s) were upscaled from a lower zoom and recorded in provenance`
            : 'Satellite crop captured & filed',
        result.tiles_missing || result.tiles_upscaled ? 'warn' : 'ok'
      );
    } catch (e) {
      toast(`Capture failed: ${e.message}`, 'danger', 6000);
    } finally {
      capturing = false;
    }
  }

  // Centred Capture button: the standard preset size, framed on the map centre.
  function captureCentered() {
    const [w, h] = presetSize;
    const r = mapEl.getBoundingClientRect();
    doCapture(engine.camera(), w, h, {
      x: (r.width - w) / 2,
      y: (r.height - h) / 2,
      w,
      h,
    });
  }

  // The main capture button runs whichever mode is currently selected —
  // captureMode itself *is* the "last used mode" memory, so nothing else
  // needs to track it.
  async function runCapture() {
    if (captureBlocked || capturing) return; // view-only basemap
    // The widget basemap captures from screen pixels via the browser extension
    // (extBridge.js). Without it there is nothing legitimate to capture with —
    // gate here, before any frame is drawn, and explain instead of half-working.
    if (isWidgetBase && !extensionVersion()) {
      extGateOpen = true;
      return;
    }
    if (captureMode === 'select') toggleSelect();
    else captureCentered();
  }

  // --- widget capture: the same crop frame, filled with screen pixels ---
  //
  // Google's terms allow a user-taken screenshot with attribution and nothing
  // programmatic out of the widget: the cloned tiles in the DOM are off-limits,
  // so the pixels come from the capture extension — one tabs.captureVisibleTab
  // behind the user's click, the browser-blessed way to screenshot the tab.
  // No share prompt, no sharing bar, fullscreen stays. That's the only
  // difference from a tile capture: the frame, the modes (centred preset /
  // free marquee) and the filing are identical, so the widget goes through
  // doCapture() like every other basemap.
  let extGateOpen = $state(false); // "you need the extension" explainer

  // One frame of this tab as a drawable image, via the extension. The frame is
  // exactly the viewport, so registration is the viewport aspect check — a
  // mismatch means browser zoom mid-flight or a foreign frame, both refusals.
  async function extFrame() {
    const dataUrl = await captureTab();
    const img = new window.Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('unreadable frame from the extension'));
      img.src = dataUrl;
    });
    if (!isRegistered(img.naturalWidth, img.naturalHeight, window.innerWidth, window.innerHeight)) {
      throw new Error('the captured frame does not match this view. Try again');
    }
    return img;
  }

  // Map a rect in map-container CSS px onto the captured frame, and render it
  // at exactly outW × outH (default: the native source pixels). Source pixels
  // are usually denser than CSS px (devicePixelRatio, Region Capture), so a
  // requested size is a supersampled downscale rather than a blur-up.
  async function shotCropCanvas(img, rect, outW, outH) {
    const src = sourceRect(rect, {
      mapRect: mapEl.getBoundingClientRect(),
      viewportWidth: window.innerWidth,
      videoWidth: img.naturalWidth,
      videoHeight: img.naturalHeight,
    });
    if (!src) {
      throw new Error('the frame runs past the captured area. Resize the window or pick a smaller size');
    }
    const { sx, sy, sw, sh } = src;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(outW ?? sw);
    canvas.height = Math.round(outH ?? sh);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  // The widget arm of doCapture: grab the tab via the extension, crop, file.
  async function doWidgetCapture(framedOn, rect) {
    if (!extensionVersion()) {
      extGateOpen = true;
      return;
    }
    const mapRect = mapEl.getBoundingClientRect();
    if (!frameFitsView(rect, mapRect)) {
      toast(
        `The ${Math.round(rect.w)}×${Math.round(rect.h)} frame is bigger than the map view. Pick a smaller size or enlarge the window`,
        'warn', 7000
      );
      return;
    }
    capturing = true;
    // The tab frame is the whole viewport, so our own chrome painted over the
    // map (HUD, controls, reference windows, the frame outline itself) would
    // land inside the crop. Hide it for the grab — a capture must show the
    // map, not the app. Only the marker stays: the tile path burns one into
    // its crop, so dropping it here would be the odd one out.
    hideOverlays = true;
    try {
      // let the hidden chrome actually leave the composited frame
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise((r) => setTimeout(r, 60));
      const img = await extFrame();
      const canvas = await shotCropCanvas(img, rect, Math.round(rect.w), Math.round(rect.h));
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      await fileScreenshot(blob, framedOn, true);
    } catch (e) {
      if (e.needsActivation) {
        // one-time per tab: the browser only lets the extension screenshot a
        // tab it has been invoked on (activeTab) — not an error, a step
        toast(
          'One-time step: click the Azimut Capture icon in the toolbar (or press Alt+Shift+A), then press Capture again',
          'warn',
          10000
        );
      } else {
        // Never fall back to the import dialog: a capture that couldn't be
        // taken must stay untaken. Quietly offering to file some other image
        // instead is how an unregistered picture ends up wearing a capture's
        // provenance.
        toast(`Capture failed: ${e.message}`, 'danger', 7000);
      }
    } finally {
      hideOverlays = false;
      capturing = false;
    }
  }

  // File a screenshot blob as a capture. `framed` records whether the
  // coordinates are the centre of a registered crop (the frame paths) or just
  // the map view at filing time (a pasted screenshot) — the backend keeps that
  // distinction in provenance.
  async function fileScreenshot(blob, framedOn, framed) {
    const c = await ensureCase();
    const form = new FormData();
    form.append('image', blob, 'screenshot.png');
    form.append('lat', String(framedOn ? framedOn.lat : center.lat));
    form.append('lon', String(framedOn ? framedOn.lon : center.lon));
    form.append('zoom', String(center.zoom));
    form.append('bearing', String(bearing));
    form.append('provider', currentProvider.id);
    form.append('framed', String(!!framed));
    const result = await api.post(`/api/cases/${c.id}/satellite/screenshot`, form);
    await reloadCase();
    toast(
      framed
        ? 'Screen crop captured & filed (attribution burned in)'
        : 'Screenshot filed as a capture (attribution burned in)',
      'ok'
    );
    return result;
  }

  // --- manual screenshot dialog (fallback: paste / drop) ---
  // The dialog owns its own preview and paste handling; these are the two acts
  // it needs from the tool — a frame of this tab, and filing what it holds.
  let shotOpen = $state(false);

  /** The whole map view as a PNG blob, through the extension. Null if refused. */
  async function grabView() {
    try {
      const img = await extFrame();
      const rect = mapEl.getBoundingClientRect();
      const canvas = await shotCropCanvas(img, { x: 0, y: 0, w: rect.width, h: rect.height });
      return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    } catch (e) {
      // extension missing or refused — the paste path still works
      toast(`Screen capture unavailable (${e.message}). Paste a screenshot instead`, 'warn', 6000);
      return null;
    }
  }

  /** File what the dialog holds, at the map view rather than a registered frame. */
  async function fileScreenshotBlob(blob) {
    try {
      await fileScreenshot(blob, null, false);
      return true;
    } catch (e) {
      toast(`Could not file the screenshot: ${e.message}`, 'danger', 6000);
      return false;
    }
  }

  // clicking outside the open size/ratio/resolution popover closes it
  $effect(() => {
    if (!sizeMenuOpen) return;
    const onDocMousedown = (e) => {
      if (sizeMenuEl && !sizeMenuEl.contains(e.target)) sizeMenuOpen = false;
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
  function toggleSelect() {
    selectArmed = !selectArmed;
    if (selectArmed) {
      sizeMenuOpen = false;
      if (measureMode) setMeasureMode(null);
    } else {
      selRect = null;
    }
  }

  function onSelectStart(e) {
    if (!selectArmed || e.button !== 0 || !engine) return;
    startRectDrag(engine, e, {
      ratio: ratioValue,
      onChange: (rect) => (selRect = rect),
      onDone: finishSelect,
    });
  }

  function finishSelect(r) {
    selRect = null;
    if (!r) return;
    const w = Math.abs(r.x1 - r.x0);
    const h = Math.abs(r.y1 - r.y0);
    if (w < 12 || h < 12) return; // an accidental click / tiny drag: ignore
    const framedOn = engine.containerPointToLatLng({
      x: (r.x0 + r.x1) / 2,
      y: (r.y0 + r.y1) / 2,
    });
    selectArmed = false; // one box per arm — re-arm to draw another
    doCapture(framedOn, Math.round(w), Math.round(h), {
      x: Math.min(r.x0, r.x1),
      y: Math.min(r.y0, r.y1),
      w,
      h,
    });
  }

  // --- Grid Search: layers, drawing, sweeping, persistence -------------------

  function toggleGridMode() {
    gridMode = !gridMode;
    if (gridMode) {
      if (selectArmed) toggleSelect(); // exclusive with the capture marquee…
      if (measureMode) setMeasureMode(null); // …and the measure tools
      gridHidden = false;
      ensureGridLayers();
      refreshGridList();
      if (grid) {
        renderGrid();
        renderAoi();
      }
    } else {
      cancelGridDraw();
      stopReview();
      editArea = false;
      clearGridLayers();
    }
  }

  function ensureGridLayers() {
    if (!engine) return;
    gridCells ??= createSurface(engine);
    gridAoi ??= createSurface(engine);
    gridDraft ??= createSurface(engine);
    syncGridVisibility();
  }

  // the eye toggle keeps the grid but drops its layers off the map so you can
  // read the bare imagery underneath, then puts them back
  function syncGridVisibility() {
    for (const surface of [gridCells, gridAoi, gridDraft]) surface?.visible(!gridHidden);
  }

  function toggleGridHidden() {
    gridHidden = !gridHidden;
    syncGridVisibility();
  }

  function startRename() {
    if (!grid) return;
    renameText = grid.title || '';
    renamingGrid = true;
  }

  function commitRename() {
    renamingGrid = false;
    if (!grid) return;
    const t = renameText.trim();
    if (t && t !== grid.title) {
      grid.title = t;
      scheduleGridSave();
    }
  }

  function clearGridLayers() {
    gridCells?.clear();
    gridAoi?.clear();
    gridDraft?.clear();
  }

  // a handle is an empty box the CSS draws; the shape only says where it is
  const GRID_HANDLE = { className: 'grid-handle', size: [16, 16], anchor: [8, 8] };

  function cellStyle(key) {
    const base = CELL_STYLE[grid?.statuses[key] || 'unchecked'];
    // the cell under review gets a bright cyan outline — distinct from the
    // yellow flag and the grey cleared fill for colour-blind readability
    return key === reviewKey
      ? { ...base, stroke: '#33c9ff', strokeWidth: 2.5, strokeOpacity: 1 }
      : base;
  }

  function renderGrid() {
    ensureGridLayers();
    if (!grid) {
      gridCells.clear();
      return;
    }
    gridCells.set(
      [...gridSearch.cellsInAoi(grid)].map(([i, j]) => ({
        id: gridSearch.cellKey(i, j),
        kind: 'rect',
        bounds: gridSearch.cellBounds(grid, i, j),
        style: cellStyle(gridSearch.cellKey(i, j)),
        onClick: () => cycleCell(i, j),
        onContextMenu: () => flagCell(i, j),
      }))
    );
  }

  // One cell of a thousand, on every keypress of a sweep: never a rebuild.
  function restyleCell(key) {
    gridCells?.patch(key, { style: cellStyle(key) });
  }

  function setReview(key) {
    const prev = reviewKey;
    reviewKey = key;
    if (prev) restyleCell(prev);
    if (key) restyleCell(key);
  }

  function cycleCell(i, j) {
    const key = gridSearch.cellKey(i, j);
    // during a sweep, clicking the cell you're reviewing clears it and moves on
    // (same as the Clear button) — you're looking right at it
    if (reviewKey && key === reviewKey) {
      markReview('cleared');
      return;
    }
    const next = gridSearch.cycleStatus(grid.statuses[key]);
    if (next) grid.statuses[key] = next;
    else delete grid.statuses[key];
    restyleCell(key);
    scheduleGridSave();
  }

  function flagCell(i, j) {
    const key = gridSearch.cellKey(i, j);
    if (grid.statuses[key] === 'flagged') delete grid.statuses[key];
    else grid.statuses[key] = 'flagged';
    restyleCell(key);
    scheduleGridSave();
  }

  // --- editing the area of interest (rect corners / polygon vertices) ---
  // The area box + handles show only while editing the area; once a grid is
  // drawn the box is hidden and just the cells remain.
  const AOI_OUTLINE = 'outline'; // the one shape the drag handles reshape live

  function renderAoi() {
    ensureGridLayers();
    if (!grid || !editArea) {
      gridAoi.clear();
      return;
    }
    const b = gridSearch.aoiBounds(grid.aoi);
    const handle = (id, at, onDragStart, onDrag) => ({
      id,
      kind: 'marker',
      at,
      ...GRID_HANDLE,
      draggable: true,
      keyboard: false,
      zIndex: 1200,
      onDragStart,
      onDrag,
      onDragEnd: () => (grid.aoi.type === 'rect' ? commitResize() : commitVertEdit()),
    });
    if (grid.aoi.type === 'rect') {
      gridAoi.set([
        { id: AOI_OUTLINE, kind: 'rect', bounds: b, style: AOI_STYLE },
        ...CORNERS.map((corner) => {
          const [lat, lon] = gridSearch.cornerLatLng(b, corner);
          return handle(
            corner,
            { lat, lon },
            () => (dragBounds = { ...gridSearch.aoiBounds(grid.aoi) }),
            (at) => onCornerDrag(corner, at)
          );
        }),
      ]);
      return;
    }
    // reshape a confirmed polygon: a draggable handle on every vertex
    gridAoi.set([
      {
        id: AOI_OUTLINE,
        kind: 'polygon',
        points: grid.aoi.vertices.map(([lat, lon]) => ({ lat, lon })),
        style: AOI_STYLE,
      },
      ...grid.aoi.vertices.map(([lat, lon], k) =>
        handle(
          k,
          { lat, lon },
          () => (liveVerts = grid.aoi.vertices.map((vertex) => [...vertex])),
          (at) => onVertexDrag(k, at)
        )
      ),
    ]);
  }

  function onCornerDrag(corner, at) {
    if (!dragBounds) return;
    if (corner[0] === 'n') dragBounds.north = at.lat;
    else dragBounds.south = at.lat;
    if (corner[1] === 'e') dragBounds.east = at.lon;
    else dragBounds.west = at.lon;
    gridAoi.patch(AOI_OUTLINE, { bounds: gridSearch.normalizeBounds(dragBounds) });
  }

  function onVertexDrag(k, at) {
    if (!liveVerts) return;
    liveVerts[k] = [at.lat, at.lon];
    gridAoi.patch(AOI_OUTLINE, {
      points: liveVerts.map(([lat, lon]) => ({ lat, lon })),
    });
  }

  function commitResize() {
    if (!dragBounds || !grid) return;
    const b = gridSearch.normalizeBounds(dragBounds);
    dragBounds = null;
    const resized = gridSearch.resizeRect(grid, b);
    if (gridSearch.estimateCells(resized) > GRID_MAX_CELLS) {
      toast(`That area is too fine for ${grid.cell_m} m cells. Keeping the previous size`, 'warn', 5000);
      renderAoi(); // snap the handles back
      return;
    }
    grid = resized;
    renderGrid();
    renderAoi();
    scheduleGridSave();
  }

  function commitVertEdit() {
    if (!liveVerts || !grid) return;
    const verts = liveVerts;
    liveVerts = null;
    const resized = gridSearch.resizePolygon(grid, verts);
    if (gridSearch.estimateCells(resized) > GRID_MAX_CELLS) {
      toast(`That shape is too fine for ${grid.cell_m} m cells. Keeping the previous one`, 'warn', 5000);
      renderAoi();
      return;
    }
    grid = resized;
    renderGrid();
    renderAoi();
    scheduleGridSave();
  }

  // show the area box to resize (rect corners) or reshape (polygon vertices)
  function toggleEditArea() {
    if (!grid) return;
    stopReview();
    cancelGridDraw();
    editArea = !editArea;
    renderAoi();
  }

  function startDraw(type) {
    cancelGridDraw();
    stopReview();
    editArea = false;
    gridHidden = false;
    gridDraw = type;
    // hide the current cells while drawing so map clicks reach the canvas
    // (polygon vertices) instead of being swallowed by a cell underneath
    gridCells?.clear();
    if (type === 'polygon') {
      polyDraft = [];
      renderDraft();
    }
  }

  function cancelGridDraw() {
    const wasDrawing = gridDraw;
    gridDraw = null;
    polyDraft = [];
    selRect = null;
    gridDraft?.clear();
    if (wasDrawing && grid) renderGrid(); // restore the cells hidden while drawing
  }

  // rectangle area: drag a box (mirrors the capture marquee, reusing selRect for
  // the live outline). Armed while gridDraw === 'rect'.
  function onGridRectStart(e) {
    if (gridDraw !== 'rect' || e.button !== 0 || !engine) return;
    startRectDrag(engine, e, {
      onChange: (rect) => (selRect = rect),
      onDone: finishGridRect,
    });
  }

  function finishGridRect(r) {
    selRect = null;
    gridDraw = null;
    if (!r || Math.abs(r.x1 - r.x0) < 12 || Math.abs(r.y1 - r.y0) < 12) {
      if (grid) renderGrid(); // stray click: restore the cells hidden to draw
      return;
    }
    const p1 = engine.containerPointToLatLng({ x: r.x0, y: r.y0 });
    const p2 = engine.containerPointToLatLng({ x: r.x1, y: r.y1 });
    doApplyArea({
      type: 'rect',
      bounds: gridSearch.normalizeBounds({ south: p1.lat, north: p2.lat, west: p1.lon, east: p2.lon }),
    });
  }

  // polygon area: click to drop vertices (handled in onMapClick), drag the
  // handles to adjust, Confirm to build.
  const DRAFT_RING = 'ring';

  function draftRing() {
    return gridSearch.closeRing(polyDraft.map((point) => [point.lat, point.lon]))
      .map(([lat, lon]) => ({ lat, lon }));
  }

  function renderDraft() {
    ensureGridLayers();
    if (gridDraw !== 'polygon') {
      gridDraft.clear();
      return;
    }
    gridDraft.set([
      {
        id: DRAFT_RING,
        kind: 'line',
        points: draftRing(),
        style: { stroke: '#f5a623', strokeWidth: 1.5, strokeOpacity: 0.95, dash: '5 4' },
      },
      ...polyDraft.map((point, k) => ({
        id: k,
        kind: 'marker',
        at: point,
        ...GRID_HANDLE,
        draggable: true,
        keyboard: false,
        zIndex: 1200,
        onDrag: (at) => {
          polyDraft[k] = at;
          gridDraft.patch(DRAFT_RING, { points: draftRing() });
        },
        onDragEnd: renderDraft,
      })),
    ]);
  }

  function confirmPolygon() {
    if (polyDraft.length < 3) return;
    const vertices = polyDraft.map((p) => [p.lat, p.lon]);
    gridDraw = null;
    polyDraft = [];
    gridDraft?.clear();
    doApplyArea({ type: 'polygon', vertices });
  }

  // Drawing an area always makes a *new* grid (the case can hold several); the
  // one you were on stays saved. Resizing the current grid is the handles.
  async function doApplyArea(aoi) {
    const cellM = Math.max(10, Number(gridCellM) || 500); // never a NaN lattice
    const g = gridSearch.createGrid(aoi, cellM);
    if (gridSearch.estimateCells(g) > GRID_MAX_CELLS) {
      toast(`That area exceeds the ${GRID_MAX_CELLS}-cell limit. Use a larger cell size.`, 'warn', 6000);
      renderGrid(); // restore the previous grid we hid to draw
      return;
    }
    await ensureCase(); // a grid is case state; make sure there is one to hold it
    await flushGridSave(); // persist the grid we're leaving before switching
    g.title = gridTitleFor(aoi);
    grid = g;
    gridName = `grid-${Date.now().toString(36)}`;
    gridFor = caseState.current?.id;
    reviewKey = null;
    editArea = false;
    gridHidden = false;
    renderGrid();
    renderAoi();
    await saveGrid(); // create it on disk now, then refresh the picker
    refreshGridList();
  }

  function gridTitleFor(aoi) {
    const c = gridSearch.aoiCenter(aoi);
    return fmtCoords(c.lat, c.lon);
  }

  // --- sweep loop: fly to a cell, mark it, advance ---
  function flyToCell([i, j]) {
    setReview(gridSearch.cellKey(i, j));
    const b = gridSearch.cellBounds(grid, i, j);
    engine.fitBounds(b, { padding: [80, 80], maxZoom: 20, animate: true });
  }

  function startReview() {
    if (!grid) return;
    editArea = false;
    const cell = gridSearch.nextUnchecked(grid, null);
    if (!cell) {
      toast('Every cell is marked. Sweep complete', 'ok');
      return;
    }
    flyToCell(cell);
  }

  function reviewAdvance() {
    const next = gridSearch.nextUnchecked(grid, reviewKey);
    if (!next) {
      setReview(null);
      toast('Sweep complete', 'ok');
      return;
    }
    flyToCell(next);
  }

  function markReview(status) {
    if (!reviewKey) return;
    if (status) grid.statuses[reviewKey] = status;
    else delete grid.statuses[reviewKey];
    restyleCell(reviewKey);
    scheduleGridSave();
    reviewAdvance();
  }

  function stopReview() {
    if (reviewKey) setReview(null);
  }

  // flag the cell under review and file its centre as a place (spec §5 — a hit
  // the analyst promotes into the case graph)
  async function reviewToPlace() {
    if (!reviewKey || !grid) return;
    const [i, j] = gridSearch.parseKey(reviewKey);
    const c = gridSearch.cellCenter(grid, i, j);
    grid.statuses[reviewKey] = 'flagged';
    restyleCell(reviewKey);
    scheduleGridSave();
    try {
      const cs = await ensureCase();
      await api.post(`/api/cases/${cs.id}/satellite/place`, {
        lat: c.lat,
        lon: c.lon,
        zoom: Math.max(center.zoom, 16),
        bearing: 0,
      });
      await reloadCase();
      toast('Cell flagged and saved as a place', 'ok');
    } catch (e) {
      toast(`Could not save place: ${e.message}`, 'danger', 6000);
    }
  }

  // --- the case's saved grids: list, load, new, delete, persist ---
  function scheduleGridSave() {
    clearTimeout(gridSaveTimer);
    gridSaveTimer = setTimeout(saveGrid, 600);
  }

  // persist any pending change to the *current* grid before we switch away
  async function flushGridSave() {
    clearTimeout(gridSaveTimer);
    await saveGrid();
  }

  async function saveGrid() {
    const id = caseState.current?.id;
    if (!id || !grid || !gridName) return;
    try {
      const spec = JSON.parse(JSON.stringify(grid)); // strip the $state proxy
      await api.put(`/api/cases/${id}/search-grids/${gridName}`, { spec, title: grid.title });
    } catch (e) {
      toast(`Could not save the grid: ${e.message}`, 'danger', 5000);
    }
  }

  async function refreshGridList() {
    const id = caseState.current?.id;
    if (!id) {
      gridList = [];
      return;
    }
    try {
      gridList = await api.get(`/api/cases/${id}/search-grids`);
    } catch {
      gridList = [];
    }
  }

  async function loadGrid(name) {
    const id = caseState.current?.id;
    if (!id) return;
    cancelGridDraw();
    stopReview();
    editArea = false;
    gridHidden = false;
    await flushGridSave(); // persist the grid we're leaving
    try {
      const spec = await api.get(`/api/cases/${id}/search-grids/${name}`);
      grid = spec;
      gridName = name;
      reviewKey = null;
      ensureGridLayers();
      renderGrid();
      renderAoi();
      refreshGridList(); // the grid we left becomes a picker entry
    } catch (e) {
      toast(`Could not load grid: ${e.message}`, 'danger', 6000);
    }
  }

  // close the open grid (it stays saved) — the draw buttons then start a fresh one
  function closeGrid() {
    grid = null;
    gridName = null;
    reviewKey = null;
    editArea = false;
    cancelGridDraw();
    clearGridLayers();
  }

  // the Discard button: persist any pending rename/marks first, then close, then
  // refresh the picker so the just-closed grid shows its latest title
  async function discardOpenGrid() {
    await flushGridSave();
    closeGrid();
    refreshGridList();
  }

  async function deleteGrid(name) {
    const id = caseState.current?.id;
    if (id) {
      try {
        await api.del(`/api/cases/${id}/search-grids/${name}`);
      } catch {
        /* the file may already be gone — nothing left to do */
      }
    }
    if (gridName === name) closeGrid();
    refreshGridList();
  }

  // on case change: refresh the picker and close whatever grid was open
  $effect(() => {
    const id = caseState.current?.id;
    caseState.rev; // re-read after a reload elsewhere
    if (!mapReady) return;
    if (gridFor === id) return;
    gridFor = id;
    grid = null;
    gridName = null;
    reviewKey = null;
    editArea = false;
    clearGridLayers();
    refreshGridList();
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
    <div
      class="map-wrap dark-surface"
      class:measuring={measureMode}
      class:selecting={selectArmed}
      class:grid-drawing={!!gridDraw}
      class:grabbing={hideOverlays}
    >
      <div class="map" bind:this={mapEl}></div>

      {#if mapRefused}
        <p class="map-refused">The map needs WebGL, which this browser does not have.</p>
      {/if}

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
          {toolsOpen}
          {measureMode}
          {toggleTools}
          {gridMode}
          {toggleGridMode}
          bind:savedOverlay
          savedCount={savedWork.rows.length}
          referenceCount={uiState.refViewers.length}
          {openRefPicker}
          {setMeasureMode}
          {measureReadout}
          measureHint={MEASURE_HINT}
          {clearMeasure}
          {sunMode}
          {toggleSunMode}
        />

        {#if sunMode}
          <SunPanel
            sky={sunSky}
            loading={sunLoading}
            day={sunDay}
            index={sunIndex}
            anchor={sunAnchor}
            placing={sunPlacing}
            ondate={(value) => {
              sunDay = value;
              sunSky = null;
            }}
            onindex={(value) => (sunIndex = value)}
            onplace={() => (sunPlacing = !sunPlacing)}
            onclose={toggleSunMode}
          />
        {/if}

        {#if gridMode}
          <GridSearchPanel
            bind:collapsed={gridCollapsed}
            bind:renaming={renamingGrid}
            bind:renameText
            {commitRename}
            {startRename}
            {grid}
            toggleHidden={toggleGridHidden}
            hidden={gridHidden}
            coverage={gridCov}
            {reviewKey}
            {markReview}
            {reviewToPlace}
            {stopReview}
            {startReview}
            {editArea}
            {toggleEditArea}
            discard={discardOpenGrid}
            {deleteGrid}
            {gridName}
            bind:cellMetres={gridCellM}
            drawMode={gridDraw}
            {startDraw}
            polygonDraft={polyDraft}
            {confirmPolygon}
            cancelDraw={cancelGridDraw}
            savedGrids={savedOthers}
            {loadGrid}
          />
        {/if}
      </div>

      <!-- capture-frame outline: what the centred Capture will cover — only when
           a centred capture is the intent (hovering the capture button, or
           mid-capture) and not while drawing a marquee -->
      {#if captureMode === 'center' && (captureHover || capturing) && !selectArmed && !selRect}
        <div
          class="frame-overlay"
          style="width:{presetSize[0]}px;height:{presetSize[1]}px"
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

      <!-- imagery acquisition date: a compact, unobtrusive pill in the corner so
           it doesn't crowd the coordinates readout (item 2) -->
      {#if isSentinel && displayedBaseId === SENTINEL_ID}
        <!-- Sentinel-2 says what it is showing: a pinned day is the window the
             tiles were rendered from; otherwise the layer's default renders the
             most recent pass, which the calendar lookup has already named. -->
        <span
          class="date-pill mono"
          class:exact={!!s2PinnedDate}
          title={s2PinnedDate
            ? `Sentinel-2 ${s2.layerLabel} from this exact date`
            : s2.latest
              ? `Sentinel-2 ${s2.layerLabel}: most recent pass over this point`
              : `Sentinel-2 ${s2.layerLabel}: most recent pass (open the picker to date it)`}
        >
          <Icon name="clock" size={11} />
          {s2PinnedDate ?? s2.latest ?? ''}
          {#if !s2PinnedDate}
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

      <!-- lightweight compass: click the rose to reset north; middle-drag the map
           to rotate; click the number to type an exact bearing (item 3) -->
      <div class="rotate-ctl">
        <button
          class="compass"
          onclick={resetNorth}
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

      <div class="capture-bar card">
        <select class="select" bind:value={providerId} title="Imagery provider">
          {#each providers as p (p.id)}
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
        {#if currentProvider?.meter && displayedBaseId !== providerId}
          <span
            class="fallback-pill"
            class:paused={meterBlocked}
            title={meterBlocked
              ? `${currentProvider.label} passed 90% of its monthly free tier. Free imagery is shown instead. Override in Settings to keep using it (billed).`
              : `Eco mode shows free imagery at low zoom. Zoom in for ${currentProvider.label} detail. Toggle in Settings.`}
          >
            <Icon name={meterBlocked ? 'alert' : 'leaf'} size={11} />
            {meterBlocked ? `${currentProvider.label} paused · free imagery` : 'eco · free imagery'}
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
          bind:menuOpen={sizeMenuOpen}
          bind:mode={captureMode}
          bind:hover={captureHover}
          {selectArmed}
          {capturing}
          blocked={captureBlocked}
          widgetBase={isWidgetBase}
          {runCapture}
          ratios={RATIOS}
          bind:ratio
          presets={PRESETS}
          bind:preset
          bind:customWidth={customW}
          bind:customHeight={customH}
          bind:resolution
          openScreenshot={() => (shotOpen = true)}
          openExtensionGate={() => (extGateOpen = true)}
        />
      </div>
      <!-- floating reference-image windows (scratch aids over the map) -->
      {#each uiState.refViewers as v (v.id)}
        <RefViewer
          viewer={v}
          caseId={caseState.current?.id}
          onfocus={focusRef}
          onclose={closeRef}
        />
      {/each}
    </div>

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

{#if shotOpen}
  <ScreenshotDialog
    view={center}
    {fmtCoords}
    grab={grabView}
    file={fileScreenshotBlob}
    onclose={() => (shotOpen = false)}
  />
{/if}

{#if extGateOpen}
  <ExtensionGate
    onclose={() => (extGateOpen = false)}
    onsettings={() => {
      extGateOpen = false;
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

{#if refPicker}
  <RefPicker
    media={refMedia}
    loading={refLoading}
    caseId={caseState.current?.id}
    onpick={addRef}
    onclose={() => (refPicker = false)}
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
  .map-wrap.measuring :global(.map-surface),
  .map-wrap.selecting :global(.map-surface),
  .map-wrap.grid-drawing :global(.map-surface) {
    cursor: crosshair;
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
