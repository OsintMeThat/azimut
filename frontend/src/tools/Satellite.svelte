<script>
  import { onMount, tick } from 'svelte';
  // The map is lib/map's: the engine, its layers, what is drawn on them and the
  // drag gestures. Nothing in this file knows which engine that is — and the
  // map itself is a surface (satellite/MapSurface.svelte), which is what lets a
  // second one be mounted beside this one.
  import { createSurface } from '../lib/map/surface.js';
  import MapSurface from './satellite/MapSurface.svelte';
  import { createSentinelState } from './satellite/state/sentinel.svelte.js';
  import { createWaybackState } from './satellite/state/wayback.svelte.js';
  import { createSavedState } from './satellite/state/saved.svelte.js';
  import { createImageryState, FALLBACK_PROVIDER } from './satellite/state/imagery.svelte.js';
  import { createMeasureState, HINTS as MEASURE_HINT } from './satellite/state/measure.svelte.js';
  import { createSkyState } from './satellite/state/sky.svelte.js';
  import { createGridState } from './satellite/state/grid.svelte.js';
  import { createRefsState } from './satellite/state/refs.svelte.js';
  import { createFootprintState } from './satellite/state/footprint.svelte.js';
  import {
    createCaptureState,
    PRESETS,
    RATIOS,
  } from './satellite/state/capture.svelte.js';
  import { api } from '../lib/api.js';
  import { setAnalysisPeriod } from '../lib/analysisSearch.svelte.js';
  import { temporalMapQuery } from '../lib/temporalMap.js';
  import { windowWords } from '../lib/timeline.js';
  import { isMode, KINDS } from '../lib/geoTree.js';
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
  import { extensionVersion, mapLinkRelay, onActivated } from '../lib/extBridge.js';
  import { SENTINEL_ID } from '../lib/sentinel.js';
  import { WAYBACK_ID } from '../lib/wayback.js';
  import { buildHash, readSolo, splitHash } from '../lib/hash.js';
  import { readView, readWindowLabel, viewParams } from '../lib/map/view.js';
  import { createViewLink } from '../lib/map/link.js';
  import {
    askable,
    DATED as FIRMS_DATED,
    lastDayOf,
    summary,
    tileParams,
    today,
    WINDOWS as FIRMS_WINDOWS,
  } from '../lib/map/firms.js';
  import {
    askable as nightCanAsk,
    COMPOSITE as NIGHT_COMPOSITE,
    firstNight,
    lastNight,
    SENSORS as NIGHT_SENSORS,
    summary as nightSummary,
    tileParams as nightParams,
  } from '../lib/map/nightlights.js';
  // The map's tools declare themselves once (lib/map/tools.js); the rail, the
  // panel slot, the surface's cursor and the exclusion between modes are all
  // read from that declaration rather than written out here per tool.
  import {
    arm,
    armedId,
    closeOthers,
    cursorOf,
    disarm,
    hasPanel,
    railEntries,
    railSections,
  } from '../lib/map/tools.js';
  import Icon from '../components/Icon.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import Modal from '../components/Modal.svelte';
  import EntityDetails from '../components/EntityDetails.svelte';
  import RefViewer from './RefViewer.svelte';
  import MapRail from './satellite/MapRail.svelte';
  import MapLayers from './satellite/MapLayers.svelte';
  import MapContextMenu from './satellite/MapContextMenu.svelte';
  import MapStatusBar from './satellite/MapStatusBar.svelte';
  import MarkerMenu from './satellite/MarkerMenu.svelte';
  import MeasurePanel from './satellite/MeasurePanel.svelte';
  import SunPanel from './satellite/SunPanel.svelte';
  import GridSearchPanel from './satellite/GridSearchPanel.svelte';
  import FootprintPanel from './satellite/FootprintPanel.svelte';
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

  /**
   * This window, as its own address describes it.
   *
   * A second map window is the same app on the same case with its camera
   * somewhere else, so the camera is what the address carries. Read once, at
   * build: afterwards the map moves the address, never the other way round.
   */
  const opening = splitHash(location.hash);
  const openingView = readView(opening.params);
  const windowNumber = readWindowLabel(opening.params);
  /** Whether this tab is the map on its own; `App.svelte` is what honours it,
   *  and the map is what has to keep saying so as it rewrites the address. */
  const solo = readSolo(opening.params);

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
  let temporalShown = $state(true); // …and whether its marks are drawn
  let temporalMapLoading = $state(false);
  let temporalMapError = $state('');
  let temporalMapSeq = 0;
  /** A sheet's coordinate column, handed over as points. Session-only, like the layer
   *  above it, and never part of a capture or a proof. */
  let sheetPoints = $state(null); // { points, sheet, column }
  let sheetShown = $state(true); // …and whether its marks are drawn
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
  // OpenRailwayMap over the same imagery: which of two parallel strips is a
  // railway, where a siding ends, what a yard is made of. Unlike the labels it
  // is worth having over a street base map too, which draws tracks as one
  // undifferentiated line.
  let railOverlay = $state(false);
  /**
   * The other key-less reference layers, each simply on or off: Esri's borders
   * and roads, Open Infrastructure Map's power lines, OpenSeaMap's sea marks
   * and OSM's raw GPS traces. Off by default, so none of them fetches a tile
   * until its switch is pressed.
   */
  const refLayers = $state({
    boundaries: false,
    roads: false,
    power: false,
    seamarks: false,
    gpstraces: false,
  });
  /**
   * The night lights: one night's VIIRS pass from NASA GIBS, or the 2016
   * composite. Key-less, and nothing is asked until the layer is on.
   */
  const night = $state({ on: false, source: 'noaa20', day: lastNight() });
  const nightAskable = $derived(nightCanAsk(night));
  /**
   * NASA FIRMS: what was burning, live or on a given day.
   *
   * The catalogue is read once on mount from our own backend — it is a list of
   * sensor names and whether a key is saved, and touches no network. Nothing
   * is asked of NASA until the layer is switched on.
   */
  const fires = $state({
    on: false,
    keyed: false,
    sensors: [],
    sensor: 'viirs',
    window: '24h',
    first: '',
    last: '',
  });
  const firmsAskable = $derived(askable(fires));
  const firmsSummary = $derived(summary(fires, fires.sensors));

  /**
   * Which instruments are on offer, and whether the key for them is saved.
   *
   * Our own backend, reading a catalogue and a settings file: no network, so it
   * is safe on mount. Failing quietly leaves the row disabled with its reason,
   * which is the same state as no key — and is the truth either way.
   */
  async function loadFireSensors() {
    try {
      const answer = await api.get('/api/firms/sensors');
      fires.sensors = answer.sensors ?? [];
      fires.keyed = Boolean(answer.keyed);
    } catch {
      fires.keyed = false;
    }
  }

  /** The two questions the fire layer asks, as rows under its switch. */
  const firmsControls = $derived([
    {
      label: 'Sensor',
      options: fires.sensors.map((entry) => ({
        id: entry.id,
        // "VIIRS (S-NPP + NOAA-20)" does not fit a panel this wide, and the
        // instrument is the part being chosen between
        label: entry.label.replace(/\s*\(.*\)\s*$/, ''),
        title:
          entry.id === 'modis'
            ? `${entry.label} · 1 km, back to 2000`
            : `${entry.label} · 375 m, back to 2012`,
      })),
      value: fires.sensor,
      pick: (id) => (fires.sensor = id),
    },
    {
      label: 'Showing',
      options: [
        ...FIRMS_WINDOWS.map((entry) => ({
          ...entry,
          title: `Detections from the last ${entry.label.toLowerCase()}`,
        })),
        { id: FIRMS_DATED, label: 'Dates', title: 'Detections from a past day or range' },
      ],
      value: fires.window,
      pick: (id) => {
        fires.window = id;
        if (id === FIRMS_DATED && !fires.first) fires.first = today();
      },
      dates:
        fires.window === FIRMS_DATED
          ? {
              first: fires.first,
              last: fires.last,
              today: today(),
              // FIRMS refuses a longer range, so the input says so rather than
              // the map failing on a date that was already typed
              max: lastDayOf(fires.first),
              setFirst: (value) => (fires.first = value),
              setLast: (value) => (fires.last = value),
            }
          : null,
    },
  ]);

  /** The night layer's question, asked in its row like the fires'. */
  const nightControls = $derived([
    {
      label: 'Showing',
      options: [
        ...NIGHT_SENSORS.map((sensor) => ({
          id: sensor.id,
          label: sensor.label,
          title: `${sensor.label} · one night, back to ${sensor.first}`,
        })),
        { id: NIGHT_COMPOSITE.id, label: NIGHT_COMPOSITE.label, title: 'Cloud-free composite of 2016' },
      ],
      value: night.source,
      pick: (id) => (night.source = id),
      day:
        night.source === NIGHT_COMPOSITE.id
          ? null
          : {
              label: 'Night of',
              title: 'Night of the pass, around 01:30 local time',
              value: night.day,
              min: firstNight(night.source),
              max: lastNight(),
              set: (value) => (night.day = value),
            },
    },
  ]);

  /** What the surface is asked to lay over the picture (lib/map/basemap.js). */
  const overlays = $derived(
    [
      osmOverlay && baseIsImagery && 'labels',
      refLayers.boundaries && 'boundaries',
      refLayers.roads && baseIsImagery && 'roads',
      railOverlay && 'railway',
      refLayers.power && 'power',
      refLayers.seamarks && 'seamarks',
      refLayers.gpstraces && 'gpstraces',
      fires.on && fires.keyed && firmsAskable && { id: 'firms', params: tileParams(fires) },
      night.on && nightAskable && { id: 'nightlights', params: nightParams(night) },
    ].filter(Boolean)
  );
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

  // --- Esri Wayback: which release of World Imagery ---
  // The release rides on the provider id like a Sentinel-2 window, and both
  // questions it asks (the release list, a point's history) reach Esri, so
  // neither is asked until the basemap is on screen or its picker is open.
  const wb = createWaybackState({
    api,
    place: () => ({ lat: center.lat, lon: center.lon, zoom: center.zoom }),
  });

  // --- what the map is actually showing (state/imagery.svelte.js) ---
  // A billed basemap steps aside for free imagery when paused (90% soft block)
  // or zoomed out (eco). The capture follows the display, so provenance always
  // matches the pixels.
  const shown = $derived(
    imagery.displayed(providerId, center.zoom, { ...s2.variant, release: wb.release })
  );

  // Fullscreen: the tool covers the whole viewport; SAVED stays collapsible (item 4).
  let fullscreen = $state(false);

  // Measure tools (item 5): distance / area / angle, in their own store.
  const measure = createMeasureState({
    engine: () => engine,
    units: () => prefs.units,
  });

  // External-maps quick links, in the SAVED panel (item 6).
  let linksOpen = $state(false);
  // …and the layers list above them, open by default: it is what the panel
  // says about the map itself.
  let layersOpen = $state(true);

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

  // --- tracing a place's footprint: the shape it really is, rather than the
  // circle a radius draws around it. Armed from that place's own card.
  const footprint = createFootprintState({
    api,
    notify: toast,
    caseId: () => caseState.current?.id,
    engine: () => engine,
    onSaved: reloadCase,
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
    // The address wins over the saved home view: it is what a detached window,
    // a reload and a kept link all carry. A basemap named there has to exist —
    // the catalogue depends on which keys are configured, and an address can be
    // typed by hand.
    center = { ...openingHome };
    if (openingView?.provider && imagery.find(openingView.provider)) {
      providerId = openingView.provider;
    }
    if (windowNumber) document.title = `Azimut · Map ${windowNumber}`;
    homeReady = true; // …and only now is there a view for the surface to open on
    loadFireSensors();
    // A peer moved. Applied whatever this tab was doing, because the analyst
    // asked for that by pressing the link — but only while it is pressed.
    viewLink = createViewLink(
      (view) => {
        if (!linked || !engine) return;
        engine.setView(view, view.zoom);
        setBearing(view.bearing);
      },
      {
        onPeers: (count) => {
          peerMaps = count;
          if (!count) linked = false;
        },
        // the extension's map tools, following on Google, Bing, Earth and the rest
        relay: mapLinkRelay(),
      }
    );
    window.addEventListener('keydown', onKeydown);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    // the user clicked the extension after a refused capture — close the loop
    const offActivated = onActivated(() =>
      toast('Extension ready. Press Capture again', 'ok', 5000)
    );
    return () => {
      window.removeEventListener('keydown', onKeydown);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      viewLink?.close();
      viewLink = null;
      offActivated();
      measure.destroy();
      sky.destroy();
      grid.destroy();
      footprint.destroy();
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
    if (notesItem || placeModal || detailsEntityId || refs.picking || deleteTarget) return;
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
    // A menu open over the map is the innermost thing of all.
    if (pointMenu) return closePointMenu();
    // Innermost first: what the armed mode is in the middle of, then the mode
    // itself, then the tool's own frame. A mode no longer has to be named here
    // to be closed — whatever is armed is what Escape disarms.
    if (grid.drawMode) return grid.cancelDraw();
    if (grid.reviewKey) return grid.stopReview();
    if (capture.menuOpen && !capture.armed) return void (capture.menuOpen = false);
    if (sky.placing) return sky.togglePlacing();
    if (armedMode) return disarm(modes);
    if (capture.menuOpen) return void (capture.menuOpen = false);
    // native fullscreen already exits on Esc (handled by onFullscreenChange);
    // only the CSS fallback needs an explicit toggle here
    if (fullscreen && !document.fullscreenElement) toggleFullscreen();
  }

  // force the labels overlay off whenever the base isn't imagery (item 1), and
  // the roads with it: a street map already draws both
  $effect(() => {
    if (!baseIsImagery && osmOverlay) osmOverlay = false;
    if (!baseIsImagery && refLayers.roads) refLayers.roads = false;
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

  // Wayback names its releases once it is on screen: the chip reads a date
  // rather than "Newest", and the picker opens on a list already read.
  $effect(() => {
    if (mapReady && shown.provider?.id === WAYBACK_ID) wb.loadReleases();
  });

  // While its picker is open, a pan that settles in another tile reads that
  // tile's history. Debounced, and answered from memory for a tile already read.
  $effect(() => {
    if (!wb.menuOpen || shown.provider?.id !== WAYBACK_ID) return;
    if (!wb.stale) return;
    clearTimeout(wbChangesTimer);
    wbChangesTimer = setTimeout(() => wb.loadChanges(), 900);
    return () => clearTimeout(wbChangesTimer);
  });
  let wbChangesTimer;

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

  // --- this window, and the next one ---------------------------------------
  //
  // The map is the first tool that opens in more than one window, because two
  // areas side by side on two screens is what the work actually looks like.
  // Everything that makes that possible is already here: the case is the one
  // the workspace last opened, and a point saved or a cell swept reaches every
  // window over the nudge channel. The only thing a second window needs of its
  // own is where its camera is — so that goes in the address.

  /**
   * Where the surface opens: the address when it names a place, else the saved
   * home view. The surface reads this once, at build — so it has to be the same
   * answer the tool gave `center`, or the map opens on one and reports the
   * other.
   */
  const openingHome = $derived(
    openingView?.lat != null
      ? {
          lat: openingView.lat,
          lon: openingView.lon,
          zoom: openingView.zoom ?? prefs.homeView.zoom,
        }
      : prefs.homeView
  );

  /** The bearing the address asked for, applied once the map exists to turn. */
  let bearingApplied = false;
  $effect(() => {
    if (!mapReady || bearingApplied) return;
    bearingApplied = true;
    if (openingView?.bearing) setBearing(openingView.bearing);
  });

  /**
   * This window's view, kept in its own address.
   *
   * `replaceState`, never push: panning a map is not navigating, and a back
   * button holding four hundred camera positions is worse than useless.
   */
  $effect(() => {
    if (uiState.tool !== 'satellite' || !mapReady) return;
    const params = viewParams({
      lat: center.lat,
      lon: center.lon,
      zoom: center.zoom,
      bearing,
      provider: providerId,
    });
    if (windowNumber) params.w = String(windowNumber);
    // What this tab *is* rides along with where it is pointed: rewritten
    // without it, the first pan would turn a detached map back into the whole
    // app on the next reload.
    if (solo) params.solo = '1';
    history.replaceState(null, '', buildHash('satellite', params));
  });

  /**
   * This tab following the others, and them following it.
   *
   * Off by default and per tab, which is the point: two maps are worth linking
   * when they are being compared, and in the way of each other the rest of the
   * time. Nothing here is written down and nothing reaches the network — a
   * camera is not case state (`lib/map/link.js`).
   */
  let linked = $state(false);
  let viewLink = null;
  /**
   * How many other maps are open, the app's tabs and the extension's panels on
   * other sites together, which is the whole of whether the button means
   * anything. With none, linking would be pressing a control that pans
   * nothing — so it greys out, and a link already on is dropped when the last
   * peer goes rather than left lit over an empty channel.
   */
  let peerMaps = $state(0);

  function toggleLink() {
    if (!peerMaps) return;
    linked = !linked;
    if (linked) viewLink?.send({ lat: center.lat, lon: center.lon, zoom: center.zoom, bearing });
  }

  $effect(() => {
    if (!linked || !mapReady) return;
    viewLink?.send({ lat: center.lat, lon: center.lon, zoom: center.zoom, bearing });
  });

  const WINDOWS_KEY = 'azimut:mapWindows';

  /** The number the next detached window wears. A label, not an identity. */
  function nextWindowNumber() {
    let count = 1;
    try {
      const seen = Number(localStorage.getItem(WINDOWS_KEY));
      if (Number.isInteger(seen) && seen > 0) count = seen;
      localStorage.setItem(WINDOWS_KEY, String(count + 1));
    } catch { /* a locked-down profile only loses the numbering */ }
    return count + 1;
  }

  /**
   * Open this map again in a tab of its own, on the view it is showing.
   *
   * A peer and a whole map, but not a whole app: the tab opens `solo`
   * (`lib/hash.js`), so the workspace rail, the case bar and the tab strip stay
   * in the window they belong to. What is left is the map and the map's own
   * chrome, which is what a second screen is for — the first window is still
   * where you go somewhere else.
   *
   * An ordinary tab rather than a `popup=yes` window: a tab can be torn onto
   * the second screen, put back, and is what a browser does not refuse.
   */
  function detachWindow() {
    const params = viewParams({
      lat: center.lat,
      lon: center.lon,
      zoom: center.zoom,
      bearing,
      provider: providerId,
    });
    params.w = String(nextWindowNumber());
    params.solo = '1';
    const url = `${location.pathname}${location.search}${buildHash('satellite', params)}`;
    const opened = window.open(url, '_blank');
    if (!opened) toast('The browser refused a second tab. Allow pop-ups for this page', 'warn', 8000);
  }

  // --- the right-click menu: acts on the point under the cursor -------------
  //
  // Every act here already exists for the map centre; the menu hands each one
  // the clicked point instead (lib/map/contextMenu.js). Session chrome, never
  // part of a capture.
  let pointMenu = $state(null); // { lat, lon, x, y, frame, lookup }
  let pointLookupSeq = 0;

  function onMapContextMenu(at) {
    pointLookupSeq += 1;
    pointMenu = {
      ...at,
      frame: { width: mapEl?.clientWidth ?? 0, height: mapEl?.clientHeight ?? 0 },
      lookup: null,
    };
  }

  function closePointMenu() {
    pointLookupSeq += 1;
    pointMenu = null;
  }

  async function onPointMenu(id, value) {
    const at = pointMenu;
    if (!at || !engine) return;
    const point = { lat: at.lat, lon: at.lon };
    if (id === 'lookup') return lookUpPoint(point);
    closePointMenu();
    if (id === 'copy') {
      try {
        await navigator.clipboard.writeText(value);
        toast('Coordinates copied', 'ok', 1600);
      } catch {
        toast('The browser refused the clipboard', 'warn');
      }
    } else if (id === 'place') {
      openNewPlaceAt(point);
    } else if (id === 'centre') {
      engine.setView(point, center.zoom);
    } else if (id === 'measure') {
      if (!modes.measure.isOn()) arm(modes, 'measure');
      if (measure.mode !== 'distance') setMeasureMode('distance');
      measure.addPoint(point);
    } else if (id === 'sky') {
      if (!sky.on) arm(modes, 'sky');
      sky.handOff({ ...point, date: sky.day || undefined });
    } else if (id === 'history') {
      providerId = WAYBACK_ID;
      engine.setView(point, Math.max(center.zoom, 15));
      await tick();
      if (!wb.menuOpen) wb.toggleMenu();
    }
  }

  /** "What is here?": the geocoder's name for the point, shown in the menu itself. */
  async function lookUpPoint(point) {
    const mine = ++pointLookupSeq;
    pointMenu = { ...pointMenu, lookup: { busy: true } };
    try {
      const answer = await api.get(`/api/geo/reverse?lat=${point.lat}&lon=${point.lon}`);
      if (mine !== pointLookupSeq || !pointMenu) return;
      pointMenu = {
        ...pointMenu,
        lookup: { text: answer.display_name || 'No name for this point' },
      };
    } catch (error) {
      if (mine !== pointLookupSeq || !pointMenu) return;
      pointMenu = { ...pointMenu, lookup: { error: `Lookup failed: ${error.message}` } };
    }
  }

  // The menu is pinned to a screen point, so a zoom or a pan leaves it pointing
  // at somewhere else. A drag already closes it by pressing outside; the wheel
  // does not, so the settled view does.
  $effect(() => {
    if (!mapReady || !pointMenu) return;
    return engine.on('view-settled', closePointMenu);
  });

  /** Arm tracing for one saved place, closing whatever else was armed. */
  function startTrace(row) {
    if (!footprint.start(row)) return;
    closeOthers(modes, 'footprint');
    toast('Click the corners, then Save', 'info', 4000);
  }

  // --- what a click on the map means -------------------------------------
  //
  // One router, asked in the order the modes exclude each other: a shape being
  // traced or placed owns the click, then a sky anchor waiting to be planted,
  // then the measure tools. Each mode answers whether it took it.
  /** Where the analyst clicked, `{ lat, lon }` from the façade. */
  function onMapClick(at) {
    if (footprint.addPoint(at)) return;
    if (grid.addVertex(at)) return;
    if (sky.place(at)) return;
    measure.addPoint(at);
  }

  /**
   * The map's modes, each behind the three questions the registry asks.
   *
   * The stores keep what a mode *is* in whatever shape suits it — Grid Search a
   * boolean, the measure tools a sub-mode string, the capture marquee an armed
   * flag — and this is where each one answers "are you on", "open" and "close"
   * in the same words. `lib/map/tools.js` then owns the rule that used to be
   * written four times over, once in each `toggle…` function: arming anything
   * closes everything else.
   *
   * Declared before `sky` and `capture` exist, which is safe because nothing
   * here reads a store until a rail seat is pressed.
   */
  const modes = {
    measure: {
      isOn: () => measure.panelOpen || Boolean(measure.mode),
      open: () => measure.togglePanel(),
      close: () => {
        measure.setMode(null);
        if (measure.panelOpen) measure.togglePanel();
      },
      pointing: () => Boolean(measure.mode),
    },
    grid: {
      isOn: () => grid.on,
      open: () => grid.open(),
      close: () => grid.exit(),
      pointing: () => Boolean(grid.drawMode),
    },
    sky: {
      isOn: () => sky.on,
      // the planted anchor, or where the analyst is looking
      open: () => sky.open(markerLatLng ?? { lat: center.lat, lon: center.lon }),
      close: () => sky.close(),
    },
    capture: {
      isOn: () => Boolean(capture.armed),
      open: () => capture.toggleSelect(),
      close: () => capture.disarm(),
      pointing: () => Boolean(capture.armed),
    },
    footprint: {
      isOn: () => footprint.on,
      // opened by a place's card handing it the place, never by the rail: there
      // is no such thing as tracing a footprint for nobody
      open: () => {},
      close: () => footprint.cancel(),
      pointing: () => footprint.on,
    },
  };

  /** Which mode is armed, if any — the panel slot, and the rail's amber edge. */
  const armedMode = $derived.by(() => armedId(modes));
  /**
   * The cursor the surface wears.
   *
   * Armed is not the same as *pointing*: the measure panel can be open with no
   * tool chosen in it, and Grid Search can be open on a saved grid nobody is
   * redrawing. Either would otherwise put a crosshair over a map that has
   * nothing to do with a click.
   */
  const armedCursor = $derived(modes[armedMode]?.pointing?.() ? cursorOf(armedMode) : null);
  const RAIL = railSections(railEntries());
  /** The rail's inset from the map's top-left corner, shared with the CSS. */
  const RAIL_TOP = 12;
  /** Its own height, so the engine's zoom buttons stack under it rather than
   *  behind it — and keep doing so when a tool is added to the rail. */
  let railHeight = $state(0);
  const railBottom = $derived(RAIL_TOP + railHeight + 8);

  /**
   * The saved layer's own two questions, asked where the layer is listed.
   *
   * The folder row appears only where there is a choice to make: a case whose
   * saved work all sits in one place gets a control that could only ever be
   * set back to where it already was.
   */
  const savedFilters = $derived.by(() => {
    const folders = savedWork.folders;
    const rows = [
      {
        label: 'Show',
        value: savedWork.kind,
        options: KINDS.map((entry) => ({ id: entry.id, label: entry.label })),
        pick: (id) => (savedWork.kind = id),
      },
    ];
    if (folders.length > 1) {
      rows.push({
        label: 'Folder',
        value: savedWork.folder ?? 'all',
        // folders are named by the analyst and there can be dozens, so this one
        // is a list rather than the row of chips the fixed questions get
        list: true,
        options: [
          { id: 'all', label: 'All', title: 'Every folder' },
          ...folders.map((entry) => ({
            id: entry.id,
            label: entry.id || 'Unfiled',
            title: `${entry.count} item${entry.count === 1 ? '' : 's'}`,
          })),
        ],
        pick: (id) => (savedWork.folder = id === 'all' ? null : id),
      });
    }
    return rows;
  });

  /**
   * What is drawn over the imagery, as the panel on the right lists it.
   *
   * The two that arrive from another tool — a sheet's coordinate column, a
   * Timeline window — are rows only while they are here, so the list never
   * offers a switch for something that is not on the map. Each keeps a Close
   * beside its switch, because hiding a layer and being done with it are two
   * different intentions and used to be the same button.
   */
  const layerRows = $derived([
    {
      id: 'labels',
      label: 'OSM labels',
      on: osmOverlay,
      disabled: !baseIsImagery,
      title: baseIsImagery
        ? 'Roads and place names over the imagery'
        : 'Only useful over satellite imagery',
      toggle: () => (osmOverlay = !osmOverlay),
    },
    {
      id: 'railway',
      label: 'OSM railways',
      on: railOverlay,
      title: 'Tracks, sidings and stations, from OpenRailwayMap',
      toggle: () => (railOverlay = !railOverlay),
    },
    {
      id: 'boundaries',
      label: 'Borders',
      on: refLayers.boundaries,
      title: 'Country, region and district borders, from Esri',
      toggle: () => (refLayers.boundaries = !refLayers.boundaries),
    },
    {
      id: 'roads',
      label: 'Roads',
      on: refLayers.roads,
      disabled: !baseIsImagery,
      title: baseIsImagery ? 'Road network over the imagery, from Esri' : 'Only useful over satellite imagery',
      toggle: () => (refLayers.roads = !refLayers.roads),
    },
    {
      id: 'power',
      label: 'Power lines',
      on: refLayers.power,
      title: 'Power lines by voltage, towers, substations, pipelines and masts, from Open Infrastructure Map',
      toggle: () => (refLayers.power = !refLayers.power),
      note: refLayers.power ? 'Towers appear from zoom 14.' : '',
    },
    {
      id: 'seamarks',
      label: 'Sea marks',
      on: refLayers.seamarks,
      title: 'Buoys, lights, harbours and fairways, from OpenSeaMap',
      toggle: () => (refLayers.seamarks = !refLayers.seamarks),
    },
    {
      id: 'gpstraces',
      label: 'GPS traces',
      on: refLayers.gpstraces,
      title: 'Raw GPS tracks uploaded to OpenStreetMap, mapped or not',
      toggle: () => (refLayers.gpstraces = !refLayers.gpstraces),
    },
    {
      id: 'firms',
      label: 'Active fires',
      on: fires.on,
      disabled: !fires.keyed,
      detail: fires.keyed ? firmsSummary : '',
      title: fires.keyed
        ? 'Thermal detections from NASA FIRMS, live or from the archive'
        : 'Add a NASA FIRMS key in Settings → Imagery',
      toggle: () => (fires.on = !fires.on),
      // its two questions — which instrument, and over what — are asked in the
      // row rather than in a card of its own floating somewhere
      controls: fires.on && fires.keyed ? firmsControls : null,
      note: fires.on && !firmsAskable ? 'Pick a date to draw the detections.' : '',
    },
    {
      id: 'nightlights',
      label: 'Night lights',
      on: night.on,
      detail: night.on ? nightSummary(night) : '',
      title: 'The ground at night, from NASA’s VIIRS passes',
      toggle: () => (night.on = !night.on),
      controls: night.on ? nightControls : null,
      note: !night.on
        ? ''
        : nightAskable
          ? 'Cloud hides lights too, so a dark night is not an outage on its own.'
          : 'Pick a night inside this sensor’s record.',
    },
    {
      id: 'saved',
      label: 'Saved work',
      on: savedOverlay,
      disabled: !savedWork.rows.length,
      detail: savedWork.shown.length ? String(savedWork.shown.length) : '',
      title: savedWork.rows.length
        ? "This case's saved places and captures"
        : 'Nothing is saved in this case yet',
      toggle: () => (savedOverlay = !savedOverlay),
      // Which of them are drawn. The same two answers the Saved panel is asking
      // — what kind, and which folder — so a map read here and a panel read
      // beside it can never disagree about what is on the case.
      controls: savedOverlay && savedWork.rows.length ? savedFilters : null,
    },
    ...(sheetPoints
      ? [
          {
            id: 'sheet',
            label: 'Sheet points',
            on: sheetShown,
            detail: `${sheetPoints.sheet} · ${sheetPoints.points.length}`,
            title: `${sheetPoints.sheet} · ${sheetPoints.column}`,
            toggle: () => (sheetShown = !sheetShown),
            actions: [{ label: 'Close', quiet: true, run: () => (sheetPoints = null) }],
          },
        ]
      : []),
    ...(temporalMap
      ? [
          {
            id: 'timeline',
            label: 'Timeline points',
            on: temporalShown,
            detail: temporalMapLoading
              ? 'loading…'
              : temporalMapError
                ? 'failed'
                : `${temporalMap.mapped} of ${temporalMap.matched}${temporalMap.truncated ? ', partial' : ''}`,
            title: windowWords(temporalMap.from, temporalMap.to, 'UTC'),
            toggle: () => (temporalShown = !temporalShown),
            actions: [
              { label: 'Timeline', run: () => openTemporalTimeline() },
              { label: 'Board', run: () => openTemporalCatalog('board') },
              { label: 'Graph', run: () => openTemporalCatalog('graph') },
              { label: 'Close', quiet: true, run: closeTemporalMap },
            ],
          },
        ]
      : []),
  ]);

  /** A rail seat was pressed: a mode is armed (and every other closed), an
   *  action just runs. */
  function pickTool(id) {
    if (id === 'reference') return refs.openPicker();
    arm(modes, id);
  }

  function setMeasureMode(mode) {
    // the sub-mode inside the armed measure tool; arming it is the rail's
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
  // eco / override prefs meanwhile (tools stay mounted, so no fresh onMount).
  // The fire layer's key is the same story and was the same bug — a key pasted
  // into Settings is a key the map should have on the way back, not after a
  // reload.
  $effect(() => {
    if (uiState.tool !== 'satellite' || !mapReady) return;
    imagery.refreshUsage();
    imagery.loadProviders();
    loadFireSensors();
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
      detailsEntityId = null;
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
    sheetShown = true;
    tick().then(() => {
      engine?.fitPoints(handed.points, { padding: [48, 48], maxZoom: 17 });
    });
  });

  $effect(() => {
    const handed = uiState.mapTimelineRange;
    const caseId = caseState.current?.id;
    if (!mapReady || !handed || !caseId) return;
    uiState.mapTimelineRange = null;
    temporalShown = true;
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
    arm(modes, 'sky');
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
    // The marquee is the one mode armed from outside the rail, so it reports in
    // rather than being armed through it — otherwise pressing Capture while
    // Grid Search is drawing leaves two modes waiting for the same left drag.
    onArm: () => closeOthers(modes, 'capture'),
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

  // --- marquee: drag a rectangle on the map to capture exactly that area ---
  // The frame, the ratio lock and the filing are the store's; arming it closes
  // the other modes through the registry (`onArm` above). What stays here is
  // the one thing the store cannot do: hand it a left-drag off the map element
  // it does not own.
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
    arm(modes, 'grid');
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
    else notesItem = row;
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

  // --- the full editor, reached from the place dialog ---------------------------
  // The same body the case sidebar and the Media Library open, so everything a
  // place holds is editable from the map without this tool keeping a second copy
  // of that form. Its fields wait for Save, so Escape and the backdrop ask first.
  let detailsEntityId = $state(null);
  let detailsDirty = $state(false);
  let detailsDiscarding = $state(false);

  function closeDetails() {
    if (detailsDirty) detailsDiscarding = true;
    else detailsEntityId = null;
  }

  function openPlaceDetails() {
    detailsDirty = false; // a fresh panel, whatever the last one was left holding
    detailsEntityId = placeModal?.id ?? null;
    placeModal = null;
  }

  function openNewPlace() {
    openNewPlaceAt(displayCoords);
  }

  /** The same dialog for any point, such as one right-clicked away from the centre. */
  function openNewPlaceAt({ lat, lon }) {
    placeModal = {
      id: null,
      title: '',
      notes: '',
      folder: '',
      lat,
      lon,
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
    <!-- Two identical windows on a second screen are otherwise impossible to
         tell apart; the first one needs no number and says nothing. -->
    <h2>Satellite{windowNumber ? ` · ${windowNumber}` : ''}</h2>
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
    <!-- What the window does with the tool, not what the tool does with the
         map: these sit with the title rather than among the map's own controls. -->
    <button
      class="btn btn-icon"
      class:on={linked}
      onclick={toggleLink}
      disabled={!peerMaps}
      title={!peerMaps
        ? 'Open a second map tab or the extension map tools to link the views'
        : linked
          ? 'Stop following the other maps'
          : 'Pan and zoom with the other maps'}
      aria-label="Link the view to the other maps"
    ><Icon name="link" size={15} /></button>
    <button
      class="btn btn-icon"
      onclick={detachWindow}
      title="Open this map in a tab of its own, on this view"
      aria-label="Open in a new tab"
    ><Icon name="external" size={15} /></button>
    <button
      class="btn btn-icon"
      class:on={fullscreen}
      onclick={toggleFullscreen}
      title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen map'}
      aria-label="Toggle fullscreen"
    ><Icon name={fullscreen ? 'minimize' : 'maximize'} size={15} /></button>
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
        bind:providerId
        {imagery}
        {s2}
        wayback={wb}
        home={openingHome}
        {overlays}
        imperial={prefs.units === 'imperial'}
        controlsTop={railBottom}
        armed={armedCursor}
        grabbing={capture.hiding}
        onclick={onMapClick}
        oncontextmenu={onMapContextMenu}
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
          ontrace={startTrace}
        />
      {/if}

      <!-- Both handoff layers can be on at once. Neither carries a card of its
           own any more: what they are and what to do with them is a row in the
           Layers list, with every other layer. -->
      {#if sheetPoints && sheetShown}
        <SheetPointsOverlay engine={mapReady ? engine : null} points={sheetPoints.points} />
      {/if}

      {#if temporalMap && temporalShown}
        <TemporalMapOverlay
          engine={mapReady ? engine : null}
          items={temporalMap.items}
          caseId={caseState.current?.id}
          onopen={openTemporalTimeline}
        />
      {/if}

      <!-- The map's toolbox, and the one slot the armed tool's settings open
           in. Only verbs live here; what is *drawn* over the imagery is a layer
           and is listed in the panel on the right. -->
      <div class="map-tools">
        <MapRail
          sections={RAIL}
          bind:height={railHeight}
          state={{
            measure: { on: modes.measure.isOn() },
            grid: { on: grid.on },
            sky: { on: sky.on },
            reference: {
              on: refs.open.length > 0,
              title: refs.open.length
                ? `${refs.open.length} reference window${refs.open.length === 1 ? '' : 's'} open`
                : undefined,
            },
          }}
          onpick={pickTool}
        />

        {#if hasPanel(armedMode)}
          <!-- One slot, one panel: only one mode is ever armed, so the settings
               for three tools cannot stack or cross each other any more. -->
          <div class="mode-panel">
            {#if armedMode === 'measure'}
              <MeasurePanel
                mode={measure.mode}
                setMode={setMeasureMode}
                clear={() => measure.clear()}
              />
            {:else if armedMode === 'sky'}
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
            {:else if armedMode === 'footprint'}
              <FootprintPanel
                place={footprint.place}
                points={footprint.points.length}
                complete={footprint.complete}
                covers={footprint.covers}
                saving={footprint.saving}
                undo={() => footprint.undo()}
                save={() => footprint.save()}
                cancel={() => footprint.cancel()}
              />
            {:else if armedMode === 'grid'}
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

      <!-- Where you are and what the armed tool is reading, then the two acts
           that take something off the map. The imagery provider left this bar
           for the surface's own corner: it describes the picture, not the
           tool, and two compared surfaces each show their own. -->
      <MapStatusBar
        coords={readout}
        zoom={center.zoom}
        pinned={moveMode && !!markerLatLng}
        copy={copyCoords}
        reading={measure.mode ? (measure.readout ?? '') : ''}
        hint={measure.mode && !measure.readout ? MEASURE_HINT[measure.mode] : ''}
      >
        <!-- What marks the point and whether it is the centre: one square, set
             once, beside the two acts that are pressed all day. -->
        <MarkerMenu bind:style={markerStyle} free={moveMode} toggleFree={toggleMoveMode} />
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
          bind:scaleNorth={capture.scaleNorth}
          openScreenshot={() => (capture.shotOpen = true)}
          openExtensionGate={() => (capture.extGate = true)}
        />
      </MapStatusBar>
      {#if pointMenu}
        <MapContextMenu
          at={pointMenu}
          frame={pointMenu.frame}
          zoom={center.zoom}
          format={prefs.coordFormat}
          {fullscreen}
          lookup={pointMenu.lookup}
          onpick={onPointMenu}
          onclose={closePointMenu}
        />
      {/if}
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
          <!-- What is drawn over the imagery. One list, above the case's own
               work: the labels and the saved pins used to be buttons in the
               toolbox, and the handoffs floating cards over the map. -->
          <MapLayers rows={layerRows} bind:open={layersOpen} />

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
    bind:draft={placeModal}
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
    ondetails={openPlaceDetails}
  />
{/if}

{#if detailsEntityId}
  <Modal title="Details" onclose={closeDetails} width="520px">
    <EntityDetails
      entityId={detailsEntityId}
      bind:dirty={detailsDirty}
      onclose={() => (detailsEntityId = null)}
      ondeleted={() => (detailsEntityId = null)}
    />
  </Modal>
{/if}

{#if detailsDiscarding}
  <ConfirmDialog
    title="Discard changes?"
    message="This place has edits that Save has not taken."
    confirmLabel="Discard"
    icon="alert"
    onconfirm={() => {
      detailsDiscarding = false;
      detailsDirty = false;
      detailsEntityId = null;
    }}
    oncancel={() => (detailsDiscarding = false)}
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

  /* fullscreen: the whole tool covers the viewport, above the app chrome */
  .tool.fullscreen {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: var(--bg-0);
  }

  /* The rail, and the single slot its armed tool's settings open in. Above the
     engine's own control corners, so a panel is never hidden behind the zoom
     buttons — which the rail now stacks on top of rather than beside. */
  .map-tools {
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 1100;
    /* the rail sits in flow here, so this box is exactly rail-wide — which is
       what the panel slot beside it measures its offset against */
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }
  /* The slot itself places; each panel dresses itself, because two of them
     (the sun path, Grid Search) are draggable or collapsible cards of their
     own and would have to be undressed to sit in a shared one. */
  .mode-panel {
    position: absolute;
    top: 0;
    left: calc(100% + 8px);
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
  .btn-toggle.on,
  .btn-icon.on {
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
  /* `.sub-head` is in app.css: the Layers list writes its own heading, and the
     two have to read as one panel. */
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
