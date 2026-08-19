<script>
  import { onMount, tick } from 'svelte';
  import { fileUrl } from '../lib/fileUrl.js';
  import L from 'leaflet';
  import 'leaflet/dist/leaflet.css';
  import { api } from '../lib/api.js';
  import { setAnalysisPeriod } from '../lib/analysisSearch.svelte.js';
  import { temporalMapQuery } from '../lib/temporalMap.js';
  import { windowWords } from '../lib/timeline.js';
  import { filterSaved, isMode, pendingLocate } from '../lib/geoTree.js';
  import {
    caseState, uiState, ensureCase, reloadCase, toast, prefs, fmtCoords, prefsReady,
  } from '../lib/state.svelte.js';
  import { wrapLon } from '../lib/coords.js';
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
  import { dragBearing, pivotPanOffset } from '../lib/satRotate.js';
  import { clampSize, scaledCapture } from '../lib/captureSize.js';
  import { panelWidth } from '../lib/panelWidth.js';
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
  import { loadGoogleMaps, createSatelliteMutant } from '../lib/gmaps.js';
  import { matchesQuery } from '../lib/mediaFilter.js';
  import Icon from '../components/Icon.svelte';
  import Modal from '../components/Modal.svelte';
  import SearchInput from '../components/SearchInput.svelte';
  import FolderBrowser from '../components/FolderBrowser.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import FolderSelect from '../components/FolderSelect.svelte';
  import RelationList from '../components/RelationList.svelte';
  import RelationPicker from '../components/RelationPicker.svelte';
  import RefViewer from './RefViewer.svelte';
  import MapToolCluster from './satellite/MapToolCluster.svelte';
  import SunPanel from './satellite/SunPanel.svelte';
  import GridSearchPanel from './satellite/GridSearchPanel.svelte';
  import SentinelPicker from './satellite/SentinelPicker.svelte';
  import CaptureOptions from './satellite/CaptureOptions.svelte';
  import SavedTree from './satellite/SavedTree.svelte';
  import SavedSearch from './satellite/SavedSearch.svelte';
  import SavedOverlay from './satellite/SavedOverlay.svelte';
  import SheetPointsOverlay from './satellite/SheetPointsOverlay.svelte';
  import TemporalMapOverlay from './satellite/TemporalMapOverlay.svelte';

  let mapEl;
  let toolEl; // Browser fullscreen target.
  let map = $state.raw(null);
  let tileLayer;
  let providers = $state([]);
  let providerId = $state('esri-world-imagery');
  let coordsText = $state('');
  // Start at the saved home view unless case navigation supplies a position.
  // Re-read after preferences load because deep links can mount first.
  let center = $state({ ...prefs.homeView });
  let markerStyle = $state('none'); // 'crosshair' | 'pin' | 'none'
  let moveMode = $state(false); // pin decoupled from center, draggable
  let marker = null; // Leaflet marker instance while in move mode
  let markerLatLng = $state(null); // {lat, lon} of the moved pin
  let bearing = $state(0);
  // Middle-drag rotates the map around the grabbed point.
  let rotating = $state(false);
  let rotatePivot = $state({ x: 0, y: 0 }); // grabbed point, map-wrap-local px
  let capturing = $state(false);
  let captureHover = $state(false); // previewing the crop frame (capture group hover)
  let hideOverlays = $state(false); // frame/marquee outlines must not land in a screen crop
  // One compact Saved index for places, captures and filed screenshots.
  let saved = $state([]);
  let savedKind = $state('all');
  let savedQuery = $state('');
  let savedSearchOpen = $state(false);
  let savedOverlay = $state(false); // map layer: off by default, session only
  let temporalMap = $state(null); // Timeline handoff, session-only
  let temporalMapLoading = $state(false);
  let temporalMapError = $state('');
  let temporalMapSeq = 0;
  /** A sheet's coordinate column, handed over as points. Session-only, like the layer
   *  above it, and never part of a capture or a proof. */
  let sheetPoints = $state(null); // { points, sheet, column }
  // Persist geography or My-work folder grouping across reloads.
  const GROUP_KEY = 'azimut:satelliteSavedGroup';
  let savedGroup = $state(loadSavedGroup());
  let hoveredSavedId = $state(null); // shared by the tree, the modal and the map
  // Proofs use a separate mode because they can borrow capture coordinates.
  // Fetch them only when that mode opens.
  let savedProofs = $state([]);
  let savedFor = null; // case id held by both Saved indexes
  let proofsFor = null; // the case id savedProofs was loaded for
  const savedRows = $derived(isMode(savedKind) ? savedProofs : saved);
  // The map layer follows the Saved panel filter.
  const savedShown = $derived(filterSaved(savedRows, { kind: savedKind, query: savedQuery }));
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

  // OSM labels overlay: a transparent labels-only layer laid over the imagery so
  // roads / place names are readable without hiding the satellite view (item 1).
  let osmOverlay = $state(false);
  let labelsLayer = null;
  const LABELS_URL =
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png';
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

  // --- Sentinel-2: which layer, and over which window (lib/sentinel.js) ---
  // Sentinel-2 is the one basemap with choices in it. Both live here and are
  // packed onto the provider id, which is what the map, the capture and the
  // cache all key on.
  let s2Layer = $state(DEFAULT_LAYER);
  // One date, not a range: a Sentinel-2 image *is* a pass on a day. (The WMTS
  // window underneath is a range, so we send day/day — but a range is a mosaic
  // of several passes, which is not a thing you can point at and date.)
  let s2Date = $state(''); // '' = the layer's default, i.e. the most recent pass
  // Cloud ceiling, in percent. 100 = render whatever passed overhead, which is
  // the default because the *instance* has a filter of its own (20% in the
  // standard template) and a scene above it renders as nothing at all: without
  // saying MAXCC=100 we would be hiding cloudy days without ever saying so.
  let s2Maxcc = $state(DEFAULT_MAXCC);
  let s2MenuOpen = $state(false);
  let s2MenuEl = $state(); // bound to the popover wrapper — outside-click detection
  let s2Layers = $state([]); // [{id,label,hint}] — catalogue until the instance is asked
  let s2LayersSource = $state('');
  let s2LayersAsked = false; // the instance is asked once per session, on first open
  // The month the calendar is showing, and the passes found in it:
  // { 'YYYY-MM-DD': {cloud, granules} }. A day with no entry has no imagery and
  // is not selectable — the same rule the Copernicus browser follows.
  let s2Month = $state(monthOf(''));
  let s2Passes = $state({});
  let s2PassesFor = $state(''); // the month+place s2Passes describes
  let s2PassesBusy = $state(false);
  let s2PassesNote = $state('');
  let s2VerifyingDate = $state('');
  let s2CoverageRev = $state(0);
  // The newest pass over this point — what "most recent" is actually showing.
  // The layer's default window renders the latest acquisition, so naming it is
  // the difference between a dated image and an undated one.
  let s2Latest = $state('');
  let s2LatestFor = $state(''); // the place s2Latest was resolved for
  const isSentinel = $derived(currentProvider?.id === SENTINEL_ID);
  // A half-typed date is not a date: it stays "most recent" rather than
  // becoming a request the backend would refuse.
  const s2Window = $derived(
    validDay(s2Date) ? { from: s2Date, to: s2Date } : { from: '', to: '' }
  );
  // A pinned day *is* the acquisition date — the one provider that can answer
  // "when was this taken?" without being asked.
  const s2PinnedDate = $derived(isSentinel && s2Window.from ? s2Window.from : null);
  const s2LayerHint = $derived(s2Layers.find((l) => l.id === s2Layer)?.hint ?? '');
  const s2LayerLabel = $derived(
    s2Layers.find((l) => l.id === s2Layer)?.label ?? s2Layer.replace(/_/g, ' ').toLowerCase()
  );
  // the pill is small: "false colour (infrared)" doesn't fit, "FALSE COLOR" does
  const s2LayerShort = $derived(s2Layer.replace(/_/g, ' '));

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
    variantId(displayedBaseId, { layer: s2Layer, ...s2Window, maxcc: s2Maxcc })
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
  let measureLayer = null;
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
  let gridLayer = null; // Leaflet layerGroup of the cells
  let gridAoiLayer = null; // Leaflet layerGroup of the area outline + handles
  let gridDraftLayer = null; // Leaflet layerGroup of the in-progress polygon
  let gridRenderer = null; // one shared canvas renderer for all the cells
  let cellRects = new Map(); // 'i:j' -> Leaflet rectangle (for cheap restyles)
  let aoiOutline = null; // Leaflet path: the area's dashed outline
  let dragBounds = null; // live rect bounds while a corner handle is dragged
  let liveVerts = null; // live polygon vertices while a vertex handle is dragged
  let draftLine = null; // Leaflet polyline of the in-progress polygon
  const gridCov = $derived(grid ? gridSearch.coverage(grid) : null);
  const savedOthers = $derived(gridList.filter((g) => g.name !== gridName));
  const GRID_MAX_CELLS = gridSearch.MAX_CELLS;
  // status → cell paint. Unchecked is a bright thin outline so the lattice reads
  // clearly over dark imagery; cleared greys the cell out; flagged fills yellow
  // (chosen over red so it reads for colour-blind analysts too).
  const CELL_STYLE = {
    unchecked: { color: '#ffffff', weight: 1, opacity: 0.7, fill: true, fillColor: '#fff', fillOpacity: 0 },
    cleared: { color: '#ffffff', weight: 1, opacity: 0.55, fill: true, fillColor: '#2b3040', fillOpacity: 0.62 },
    flagged: { color: '#ffcf33', weight: 1.5, opacity: 1, fill: true, fillColor: '#ffdb4d', fillOpacity: 0.6 },
  };
  const AOI_STYLE = { color: '#f5a623', weight: 1.5, opacity: 0.9, fill: false, dashArray: '5 4', interactive: false };
  const CORNERS = ['sw', 'se', 'nw', 'ne']; // rect resize handles


  // --- reference viewers: floating scratch windows over the map that hold a
  // media image (the shot to geolocate) so you can eyeball it against the
  // imagery while panning. Session-only (uiState.refViewers) — never captured,
  // never saved, dropped when the case changes (see openCase).
  let refPicker = $state(false); // the "pick an image" modal
  let refMedia = $state([]); // case images available to reference
  let refLoading = $state(false);
  let refQuery = $state('');
  let refBrowserOpen = $state(false); // "…" swaps the grid for the folder browser
  let refBrowsePath = $state('');
  let refBrowseSelection = $state(null);
  let refSeq = 0; // id source for spawned windows
  const REF_SEARCH_MIN = 6; // below that, the grid is easier to scan than to search

  // Same free-text match as the Media Library (filename, title, notes, folder,
  // download source), so what works there works here.
  const visibleRefMedia = $derived(
    caseState.current ? refMedia.filter((m) => matchesQuery(m, refQuery)) : []
  );
  const refBrowserEntries = $derived(
    refMedia.map((m) => ({ ...m, id: m.path, attrs: { folder: m.folder ?? '' } }))
  );

  async function openRefPicker() {
    refPicker = true;
    refQuery = '';
    resetRefBrowser();
    refBrowserOpen = false;
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

  function resetRefBrowser() {
    refBrowsePath = '';
    refBrowseSelection = null;
  }

  function toggleRefBrowser() {
    if (refBrowserOpen) {
      refBrowserOpen = false;
      return;
    }
    refQuery = '';
    resetRefBrowser();
    refBrowserOpen = true;
  }

  function openRefFolder(path) {
    refBrowsePath = path;
    refBrowseSelection = null;
  }

  function confirmRefBrowser() {
    const item = refBrowserEntries.find((entry) => entry.path === refBrowseSelection);
    if (item) addRef(item);
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
    // leaflet-rotate patches the global L, so expose it before importing.
    window.L = L;
    await import('leaflet-rotate');
    map = L.map(mapEl, {
      center: [center.lat, center.lon],
      zoom: center.zoom,
      zoomControl: false,
      attributionControl: true,
      rotate: true,
      rotateControl: false,
      touchRotate: true,
      shiftKeyRotate: true,
    });
    setLayer();
    setOverlay();
    // stacked below the top-left tool cluster (fullscreen/labels/measure) via
    // CSS offset below, instead of Leaflet's default corner margin
    L.control.zoom({ position: 'topleft' }).addTo(map);
    // judging feature sizes (buildings, roads) needs a scale reference
    L.control.scale({
      metric: prefs.units !== 'imperial',
      imperial: prefs.units === 'imperial',
      position: 'bottomright',
    }).addTo(map);
    map.on('moveend zoomend', () => {
      const c = map.getCenter();
      // Leaflet keeps counting past ±180° when the analyst pans across the date
      // line, and every coordinate the app sends is bounded to it — an unwrapped
      // centre made Capture answer 422 and blocked work over the Pacific.
      center = { lat: c.lat, lon: wrapLon(c.lng), zoom: map.getZoom() };
    });
    map.on('rotate', () => {
      bearing = Math.round(map.getBearing());
    });
    map.on('click', onMapClick);
    // keep tiles seam-free (see deSeamTiles): re-flatten after any reposition,
    // and un-flatten right before a zoom so the reposition doesn't double-offset
    map.on('moveend zoomend viewreset rotateend', scheduleDeSeam);
    map.on('zoomstart', reSeamTiles);
    // middle-mouse drag rotates the view (item 3). Capture-phase so we can stop
    // the event before Leaflet's own container drag handler (which treats the
    // middle button as a pan) ever sees it — otherwise a turn also pans.
    mapEl.addEventListener('mousedown', onMiddleRotateStart, true);
    // left-drag draws the capture marquee when that mode is armed (capture-phase
    // so Leaflet's pan handler never sees the gesture)
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
      map.remove();
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

  // --- OSM labels overlay (item 1) ---
  function setOverlay() {
    if (!map) return;
    if (osmOverlay && !labelsLayer) {
      labelsLayer = L.tileLayer(LABELS_URL, {
        subdomains: 'abcd',
        maxZoom: 20,
        pane: 'overlayPane', // above the imagery tiles, below markers/controls
        attribution: '© OpenStreetMap contributors © CARTO',
      }).addTo(map);
      labelsLayer.on('load tileload', scheduleDeSeam); // keep overlay seam-free too
    } else if (!osmOverlay && labelsLayer) {
      labelsLayer.remove();
      labelsLayer = null;
    }
  }

  // force the labels overlay off whenever the base isn't imagery (item 1)
  $effect(() => {
    if (!baseIsImagery && osmOverlay) osmOverlay = false;
  });

  $effect(() => {
    osmOverlay; // toggle the labels overlay
    setOverlay();
  });

  // --- Sentinel-2 layers & passes ---
  // The catalogue costs nothing and reaches no network (the backend answers it
  // from its own list); `check` asks the user's instance what it really serves,
  // which is the only authority — a configuration can rename or drop any layer.
  async function loadS2Layers(check = false, quiet = false) {
    try {
      const r = await api.get(`/api/satellite/sentinel/layers${check ? '?check=true' : ''}`);
      s2Layers = r.layers ?? [];
      s2LayersSource = r.source ?? '';
      // a layer that vanished with the list can't stay selected
      if (s2Layers.length && !s2Layers.some((l) => l.id === s2Layer)) s2Layer = s2Layers[0].id;
      if (quiet) return;
      if (check && r.detail) toast(r.detail, 'warn', 6000);
      else if (check && r.source === 'instance') {
        toast(`${r.layers.length} layers read from your instance`, 'ok');
      }
    } catch (e) {
      toast(`Sentinel-2 layers: ${e.message}`, 'danger');
    }
  }

  function toggleS2Menu() {
    s2MenuOpen = !s2MenuOpen;
    if (!s2MenuOpen) return;
    // Ask the instance what it actually serves, once per session. The built-in
    // list is only a fallback: a configuration serves whatever it was built
    // with, and offering a layer that isn't there just 400s when picked.
    if (!s2LayersAsked) {
      s2LayersAsked = true;
      loadS2Layers(true, true);
    } else if (!s2Layers.length) {
      loadS2Layers(false);
    }
    loadS2Passes();
  }

  // Passes are looked up per month *and* per place — Sentinel-2's swath means
  // the answer genuinely differs a few km away. Cached so paging back to a
  // month already seen is free; the key is the map centre rounded to ~100 m,
  // because a nudge of the map is not a new question.
  const s2PassCache = new Map();
  const s2PassPending = new Map();
  const s2CoverageCache = new Map();
  const s2PlaceKey = () => sentinelPlaceKey(center.lat, center.lon);
  // the ceiling is part of the question: the same day is available under 100%
  // and a gap under 20%, so a cached answer must not outlive the number
  const s2CoverageKey = (day, place = s2PlaceKey(), layer = s2Layer, maxcc = s2Maxcc) =>
    `${layer}@${maxcc}@${day}@${place}`;
  let s2PassRequestId = 0;
  let s2PickRequestId = 0;

  /**
   * One month's passes over one place: `{ 'YYYY-MM-DD': {cloud, granules} }`,
   * or null when the lookup failed. Cached — paging back to a month already
   * seen must not spend a second request.
   */
  async function fetchS2Month(
    month, place, force = false, lat = center.lat, lon = center.lon
  ) {
    const key = `${month}@${place}`;
    if (!force && s2PassCache.has(key)) return s2PassCache.get(key);
    if (!force && s2PassPending.has(key)) return s2PassPending.get(key);
    if (force) s2PassCache.delete(key);
    const { from, to } = monthBounds(month);
    const request = (async () => {
      try {
        const r = await api.get(
          `/api/satellite/sentinel/dates?lat=${lat}&lon=${lon}` +
          `&start=${from}&end=${to}`
        );
        const byDay = {};
        for (const d of r.dates) byDay[d.date] = { cloud: d.cloud, granules: d.granules };
        s2PassCache.set(key, byDay);
        refreshUsage(); // the lookup is billed: keep the pill honest
        return byDay;
      } catch {
        return null;
      }
    })();
    s2PassPending.set(key, request);
    try {
      return await request;
    } finally {
      if (s2PassPending.get(key) === request) s2PassPending.delete(key);
    }
  }

  /**
   * Which days Sentinel-2 actually passed over this point, and how cloudy each
   * was. This is what makes the calendar honest: a day with no pass is not
   * selectable, so you can't pick a date, pay for a tile and discover it was a
   * coverage gap. One metadata request per month (~1/100th of a tile's
   * processing units), only while the picker is open.
   */
  async function loadS2Passes(force = false) {
    const requestId = ++s2PassRequestId;
    const lat = center.lat;
    const lon = center.lon;
    const place = s2PlaceKey();
    const key = `${s2Month}@${place}`;
    s2PassesBusy = true;
    s2PassesNote = '';
    const days = await fetchS2Month(s2Month, place, force, lat, lon);
    if (requestId !== s2PassRequestId) return;
    if (days) {
      s2Passes = days;
      s2PassesFor = key;
      if (!Object.keys(days).length) s2PassesNote = 'No Sentinel-2 pass here this month.';
    } else {
      // an empty month and a failed lookup are different facts. Never blur them:
      // greying every day out because the network hiccuped would be a lie about
      // what exists.
      s2Passes = {};
      s2PassesFor = '';
      s2PassesNote = 'Could not read this month’s passes. The days below do not confirm coverage.';
    }
    s2PassesBusy = false;
  }

  function stepS2Month(delta) {
    s2Month = addMonths(s2Month, delta);
    loadS2Passes();
  }

  /**
   * Which pass "most recent" is showing. Sentinel-2 revisits every ~5 days, so
   * this month usually answers it; early in a month it may not, and one step
   * back does. Two requests at worst, once per place — the alternative is a
   * basemap that can't say what date it is showing, which for satellite
   * imagery is most of the point.
   */
  async function resolveS2Latest() {
    const place = s2PlaceKey();
    const maxcc = s2Maxcc;
    const key = `${place}@${maxcc}`;
    if (s2LatestFor === key) return;
    const today = isoDay(new Date());
    for (const month of [monthOf(today), addMonths(monthOf(today), -1)]) {
      const days = await fetchS2Month(month, place);
      if (days === null) return; // lookup failed — say nothing rather than guess
      // the ceiling drops cloudy passes from the tiles, so "most recent" is the
      // newest pass it still allows, not the newest pass there is
      const latest = latestAllowedPass(days, today, maxcc);
      if (latest) {
        s2Latest = latest;
        s2LatestFor = key;
        return;
      }
    }
    // no pass in ~2 months: real (deep polar winter, persistent gaps) — the
    // pill falls back to "most recent" rather than inventing a date
    s2Latest = '';
    s2LatestFor = key;
  }

  function clearS2Date() {
    s2PickRequestId += 1;
    s2VerifyingDate = '';
    s2Date = '';
  }

  function s2DateStatus(day) {
    s2CoverageRev;
    return s2CoverageCache.get(s2CoverageKey(day));
  }

  /** Is this day's pass above the ceiling, i.e. filtered out of the tiles? */
  function s2Filtered(day) {
    return overCloudCeiling(s2Passes[day]?.cloud, s2Maxcc);
  }

  /**
   * A new cloud ceiling. It reaches the tiles through the provider id, so the
   * only thing left to settle is a pinned date the new ceiling excludes: that
   * day renders nothing, so it goes back to most recent rather than to a blank
   * map nobody asked for.
   */
  function setS2Maxcc(value) {
    const ceiling = Math.round(Number(value));
    if (!validMaxcc(ceiling) || ceiling === s2Maxcc) return;
    s2Maxcc = ceiling;
    if (s2Date && overCloudCeiling(s2Passes[s2Date]?.cloud, ceiling)) {
      const cloud = cloudLabel(s2Passes[s2Date].cloud);
      const day = s2Date;
      clearS2Date();
      toast(`${day} is ${cloud}, over the ${ceiling}% ceiling. Back to most recent.`, 'warn');
    }
  }

  async function pickS2Date(day) {
    if (day === s2Date) {
      clearS2Date();
      return;
    }
    if (!s2Passes[day] || s2PassesStale || s2PassesBusy || s2VerifyingDate) return;
    if (s2Filtered(day)) {
      toast(`${day} is ${cloudLabel(s2Passes[day].cloud)}, over the ${s2Maxcc}% ceiling.`, 'warn');
      return;
    }

    const lat = center.lat;
    const lon = center.lon;
    const place = s2PlaceKey();
    const layer = s2Layer;
    const maxcc = s2Maxcc;
    const key = s2CoverageKey(day, place, layer, maxcc);
    const known = s2CoverageCache.get(key);
    if (known === true) {
      s2Date = day;
      return;
    }
    if (known === false) {
      toast(`No imagery at the crosshair on ${day}.`, 'warn');
      return;
    }

    const requestId = ++s2PickRequestId;
    s2VerifyingDate = day;
    try {
      const result = await api.get(coverageRequestPath({ lat, lon, layer, date: day, maxcc }));
      s2CoverageCache.set(key, result.available === true);
      s2CoverageRev += 1;
      refreshUsage();
      if (requestId !== s2PickRequestId) return;
      if (place !== s2PlaceKey() || layer !== s2Layer || maxcc !== s2Maxcc) {
        toast('The view changed. Pick the date again.', 'warn');
        return;
      }
      s2Date = dateAfterCoverage(s2Date, day, result.available);
      if (!result.available) toast(`No imagery at the crosshair on ${day}.`, 'warn');
    } catch (e) {
      if (requestId === s2PickRequestId) {
        toast(`Could not check imagery for ${day}: ${e.message}`, 'danger');
      }
    } finally {
      if (requestId === s2PickRequestId) s2VerifyingDate = '';
    }
  }

  // The passes on screen describe the place they were fetched for; once the map
  // has moved somewhere else they are stale and must not grey out real imagery.
  const s2PassesStale = $derived(
    !!s2PassesFor && s2PassesFor !== `${s2Month}@${s2PlaceKey()}`
  );

  // While the picker is open, a settled pan refreshes its dates. The stale
  // cells are disabled immediately; the debounce avoids a request per frame.
  $effect(() => {
    if (!s2MenuOpen || !isSentinel) return;
    s2Month;
    s2PlaceKey();
    clearTimeout(s2PassTimer);
    s2PassTimer = setTimeout(() => loadS2Passes(), 600);
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
    s2Maxcc; // a new ceiling can make a different pass the most recent one
    clearTimeout(s2LatestTimer);
    // debounced: panning must not spend a request per frame
    s2LatestTimer = setTimeout(() => resolveS2Latest().catch(() => {}), 900);
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
  // cursor sweeps, with a sober target marking the pivot. Leaflet only rotates
  // about the centre, so after each bearing change we pan the grabbed geographic
  // point back under the cursor — keeping it pinned exactly where you grabbed.
  const ROTATE_DEADZONE = 8; // px to leave the pivot before the spoke is fixed
  function onMiddleRotateStart(e) {
    if (e.button !== 1 || !map) return;
    // own the gesture: no Leaflet pan, no browser middle-click autoscroll
    e.stopPropagation();
    e.preventDefault();
    const rect = mapEl.getBoundingClientRect();
    const grab = L.point(e.clientX - rect.left, e.clientY - rect.top);
    const pivotLatLng = map.containerPointToLatLng(grab); // the pinned location
    const startBearing = map.getBearing();
    const startScreen = { x: e.clientX, y: e.clientY };
    rotatePivot = { x: grab.x, y: grab.y };
    rotating = true;
    let startAngle = null; // reference spoke, fixed once out of the deadzone
    const move = (ev) => {
      if (startAngle === null) {
        if (Math.hypot(ev.clientX - startScreen.x, ev.clientY - startScreen.y) < ROTATE_DEADZONE) return;
        startAngle = { x: ev.clientX, y: ev.clientY };
        return;
      }
      setBearing(dragBearing(startBearing, startScreen, startAngle, { x: ev.clientX, y: ev.clientY }));
      // re-pin: pan the grabbed location back under the grab point
      const now = map.latLngToContainerPoint(pivotLatLng);
      const [dx, dy] = pivotPanOffset(grab, now);
      if (dx || dy) map.panBy([dx, dy], { animate: false });
    };
    const up = () => {
      rotating = false;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
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
    map?.invalidateSize();
  }

  function onFullscreenChange() {
    if (document.fullscreenElement === toolEl) fullscreen = true;
    else if (!document.fullscreenElement) fullscreen = false;
    tick().then(() => map?.invalidateSize());
  }

  // --- measure tools (item 5) ---
  function onMapClick(e) {
    // Grid Search polygon: each click drops a vertex
    if (gridDraw === 'polygon') {
      polyDraft = [...polyDraft, { lat: e.latlng.lat, lon: e.latlng.lng }];
      renderDraft();
      return;
    }
    // Sun & moon: one click plants the anchor the day's path is drawn from
    if (sunPlacing) {
      sunAnchor = { lat: e.latlng.lat, lon: e.latlng.lng };
      sunSky = null;
      sunPlacing = false;
      return;
    }
    if (!measureMode) return;
    const pt = { lat: e.latlng.lat, lon: e.latlng.lng };
    // an angle is exactly three points; a fourth click starts a fresh angle
    if (measureMode === 'angle' && measurePoints.length >= 3) measurePoints = [];
    measurePoints = [...measurePoints, pt];
    redrawMeasure();
  }

  function setMeasureMode(m) {
    measureMode = measureMode === m ? null : m;
    if (measureMode) selectArmed = false; // measuring and marquee can't both be armed
    measurePoints = [];
    measureLayer?.clearLayers();
  }

  // toggling the panel shut also drops any active measure tool — otherwise the
  // ruler button stays lit (and the tool stays armed) with the panel gone
  function toggleTools() {
    toolsOpen = !toolsOpen;
    if (!toolsOpen && measureMode) setMeasureMode(null);
  }

  function clearMeasure() {
    measurePoints = [];
    measureLayer?.clearLayers();
  }

  function redrawMeasure() {
    if (!map) return;
    if (!measureLayer) measureLayer = L.layerGroup().addTo(map);
    measureLayer.clearLayers();
    const latlngs = measurePoints.map((p) => [p.lat, p.lon]);
    const stroke = { color: '#f5a623', weight: 2.5, opacity: 0.95 };
    if (measureMode === 'area' && latlngs.length >= 2) {
      L.polygon(latlngs, { ...stroke, fillColor: '#f5a623', fillOpacity: 0.15 }).addTo(
        measureLayer
      );
    } else if (latlngs.length >= 2) {
      L.polyline(latlngs, stroke).addTo(measureLayer);
    }
    for (const p of measurePoints) {
      L.circleMarker([p.lat, p.lon], {
        radius: 4,
        color: '#fff',
        weight: 2,
        fillColor: '#f5a623',
        fillOpacity: 1,
      }).addTo(measureLayer);
    }
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
    if (!map) return;
    map.setView([row.lat, row.lon], Number(row.zoom) || map.getZoom());
    setBearing(Number(row.bearing) || 0);
  }

  // --- tile seam fix ---
  // Leaflet positions each tile with a `translate3d(...)` transform, which
  // promotes it to its own GPU layer. At fractional OS display scaling (e.g.
  // 125/150%) an integer CSS position lands on a half physical pixel, so every
  // tile edge is antialiased independently and bleeds the map background as a
  // faint white grid — browser- and zoom-independent. Painting tiles with plain
  // left/top (no transform, no backface-visibility promotion — see CSS) keeps
  // them in the shared pane layer, where neighbouring edges meet on whole
  // pixels. Rotation/zoom still use their own pane transforms, so both keep
  // working. We convert after Leaflet positions the tiles, and revert to
  // transform positioning just before a zoom so the reposition is glitch-free.
  let deSeamRaf = 0;
  function deSeamTiles() {
    deSeamRaf = 0;
    if (!mapEl) return;
    for (const t of mapEl.querySelectorAll('.leaflet-tile')) {
      const m = /translate3d\((-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(t.style.transform);
      if (!m) continue; // already flat, or a rotated matrix we shouldn't touch
      t.style.left = m[1] + 'px';
      t.style.top = m[2] + 'px';
      t.style.transform = 'none';
    }
  }
  function scheduleDeSeam() {
    if (!deSeamRaf) deSeamRaf = requestAnimationFrame(deSeamTiles);
  }
  // put the translate transform back before Leaflet repositions tiles for a new
  // zoom, so a tile is never briefly offset by both left/top and translate3d
  function reSeamTiles() {
    if (!mapEl) return;
    for (const t of mapEl.querySelectorAll('.leaflet-tile')) {
      if (t.style.transform === 'none' && t.style.left) {
        t.style.transform = `translate3d(${t.style.left}, ${t.style.top}, 0)`;
        t.style.left = '';
        t.style.top = '';
      }
    }
  }

  // The Google widget layer is created ONCE and reused across basemap
  // switches: every google.maps.Map instantiation is a billed dynamic map
  // load, while re-adding the same layer costs nothing. Never destroyed
  // until the tool unmounts, for the same reason.
  let mutantLayer = null;

  async function setWidgetLayer(p) {
    try {
      await loadGoogleMaps(p.url, {
        onAuthFailure: async () => {
          // Google's only key-rejection signal — can fire minutes after a
          // clean load. Persist the verdict (benches the basemap), tell the
          // user, and let the provider refetch fall the map back to Esri.
          try {
            await api.post(`/api/settings/keys/${p.meter}/status`, {
              ok: false,
              detail: 'Google rejected the Maps JavaScript key (gm_authFailure)',
            });
          } catch { /* the toast still tells the user */ }
          toast('Google rejected the Maps JavaScript key. Basemap disabled; see Settings', 'danger', 8000);
          providers = await api.get('/api/satellite/providers');
        },
      });
    } catch (e) {
      toast(`Google Maps failed to load: ${e.message}`, 'danger', 6000);
      providerId = 'esri-world-imagery';
      return;
    }
    if (displayedProvider?.id !== p.id) return; // user moved on while loading
    if (!mutantLayer) {
      mutantLayer = createSatelliteMutant(p.max_zoom, p.attribution);
      // one billed map load, counted where it happens (the proxy can't see it)
      api.post(`/api/satellite/usage/${p.meter}`).then(refreshUsage).catch(() => {});
    }
    // Already the live layer — leave it alone. Returning to this tab refetches
    // the providers, and the fresh objects re-run the layer effect, so this is
    // the common path rather than an edge case. Re-adding costs no map load
    // (the mutant reuses its google.maps.Map), but Leaflet drops and re-clones
    // every tile in the grid, which reads on screen as a reloading map.
    if (tileLayer === mutantLayer) return;
    if (tileLayer) tileLayer.remove();
    if (map.getZoom() > p.max_zoom) map.setZoom(p.max_zoom);
    tileLayer = mutantLayer.addTo(map);
  }

  function setLayer() {
    const p = displayedProvider;
    if (!p || !map) return;
    if (p.widget) {
      setWidgetLayer(p);
      return;
    }
    // every provider goes through the backend tile proxy: keys and session
    // tokens stay server-side, every billed tile is counted exactly once
    // (browser cache hits never reach the proxy), cacheable providers share
    // the disk tile cache, and coverage gaps come back overzoomed instead of
    // as "not yet available" placards. Only {s} subdomain templates (custom
    // providers) stay direct — the proxy can't expand those.
    const url = p.url.includes('{s}') ? p.url : `/api/tiles/${displayedProviderId}/{z}/{x}/{y}`;
    // maxZoom caps the map itself (no map-level maxZoom is set), which is what
    // keeps a shallower provider (OpenTopoMap, z17) from ever being asked for
    // tiles it would answer with a "max zoom layer" placard — and keeps the
    // view zoom at or under the provider max, which capture sizing relies on.
    const opts = { attribution: p.attribution, maxZoom: p.max_zoom };
    // Where a provider's pixels stop short of its useful view (Sentinel-2:
    // native z14, view z18), Leaflet keeps requesting the native level and
    // scales those tiles up in CSS. The extra zoom therefore costs nothing —
    // asking Sentinel Hub for z18 would buy its upsampling of the same pixels,
    // 16× the tiles, every one billed.
    if (p.max_native_zoom != null) opts.maxNativeZoom = p.max_native_zoom;
    // grid cell in CSS px (lib/usage.js layerCell): bigger tiles offset the
    // URL z down (512 → -1, 1024 → -2); an oversample halves the cell so each
    // tile is shown downscaled — deeper zoom on screen. Google's mid-zoom
    // mosaics are genuinely softer than its deep ones (verified), so this is
    // what makes the paid imagery actually look paid.
    if (displayedCell !== 256 || p.tile_size > 256) {
      opts.tileSize = displayedCell;
      opts.zoomOffset = -Math.log2(displayedCell / 256);
      opts.minNativeZoom = 0; // never ask for negative URL z at world zooms
    }
    if (p.meter) {
      // billed tiles: skip the throwaway fetches Leaflet makes mid-zoom-animation
      // (intermediate zoom levels that get discarded). Deliberately NOT
      // updateWhenIdle: it delays sharp tiles until the map fully settles,
      // leaving the scaled-up previous zoom (visible blur) on screen — and it
      // saves nothing, since each visible tile is only ever fetched once.
      opts.updateWhenZooming = false;
      opts.keepBuffer = 4;
    }
    if (tileLayer) tileLayer.remove();
    // Past its maxZoom Leaflet drops a grid layer entirely rather than upscale
    // it, so switching to a shallower provider (OpenTopoMap, z17) while zoomed
    // deeper would leave a blank map. Pull the view back to what it can serve.
    if (map.getZoom() > p.max_zoom) map.setZoom(p.max_zoom);
    tileLayer = L.tileLayer(url, opts).addTo(map);
    tileLayer.on('load tileload', scheduleDeSeam);
    if (p.meter) {
      refreshUsage();
      // 'load' fires once all visible tiles are in — keep the pill current
      tileLayer.on('load', refreshUsage);
    }
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

  $effect(() => {
    const id = caseState.current?.id;
    caseState.rev; // re-fetch when the case is reloaded elsewhere (e.g. sidebar delete)
    if (savedFor !== id) {
      savedFor = id;
      saved = [];
      savedProofs = [];
      proofsFor = null;
      savedSearchOpen = false;
      hoveredSavedId = null;
      revealSavedId = null;
      deleteTarget = null;
      notesItem = null;
      placeModal = null;
      locateStopped = true;
      locateGeneration += 1;
      locating = null;
      temporalMapSeq += 1;
      temporalMap = null;
      temporalMapLoading = false;
      temporalMapError = '';
      // The points came out of another case's sheet, so they go with it.
      sheetPoints = null;
    }
    if (!id) {
      return;
    }
    let live = true;
    api
      .get(`/api/cases/${id}/satellite/index`)
      .then((rows) => { if (live) saved = rows; })
      .catch(() => { if (live) saved = []; });
    return () => { live = false; };
  });

  // The proofs index, read the first time the Proofs position is opened. Keyed
  // on the case *and its revision*: filing or saving a proof reloads the case,
  // and a stale list would still show the folder the proof just left.
  $effect(() => {
    const id = caseState.current?.id;
    const stamp = `${id}:${caseState.rev}`;
    if (!id || !isMode(savedKind) || proofsFor === stamp) return;
    proofsFor = stamp;
    let live = true;
    api
      .get(`/api/cases/${id}/proofs/index`)
      .then((rows) => { if (live) savedProofs = rows; })
      .catch(() => { if (live) { savedProofs = []; proofsFor = null; } });
    return () => { live = false; };
  });

  // another workspace asked to show one capture: clear whatever filter is on so
  // it can't be hidden, then let the tree open its branch and scroll to it
  $effect(() => {
    const path = uiState.focusCapture;
    if (!path) return;
    const row = saved.find((item) => item.path === path);
    if (!row) return;
    uiState.focusCapture = null;
    capturesCollapsed = false;
    savedKind = 'all';
    savedQuery = '';
    revealSavedId = row.id;
  });

  // the map container resizes when the sidebar toggles or is dragged wider, and
  // reappears from display:none when the tool tab is re-selected (tools stay
  // mounted) — all need Leaflet to re-measure and redraw tiles for the exposed area
  $effect(() => {
    uiState.sidebarOpen; // track the global sidebar toggle
    uiState.sidebarW; // …and its width, live through a resize drag
    if (!mapReady || uiState.tool !== 'satellite') return;
    tick().then(() => map?.invalidateSize());
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
      const zoom = Number.isFinite(target.zoom) ? target.zoom : Math.max(map.getZoom(), 16);
      map.setView([target.lat, target.lon], zoom);
      setBearing(Number.isFinite(target.bearing) ? target.bearing : 0);
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
    const bounds = L.latLngBounds(handed.points.map((point) => [point.lat, point.lon]));
    tick().then(() => {
      if (map && bounds.isValid()) map.fitBounds(bounds, { padding: [48, 48], maxZoom: 17 });
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
        const points = result.items.flatMap((item) =>
          item.place_entities.map((place) => [place.lat, place.lon])
        );
        if (!points.length) return;
        tick().then(() => {
          if (run !== temporalMapSeq || !map) return;
          map.fitBounds(L.latLngBounds(points), { padding: [54, 54], maxZoom: 14 });
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
  let sunLayer = null;
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
      sunLayer?.clearLayers();
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

  // The body itself, as a mark on its own ray: it rides between the anchor, which
  // stands for the zenith, and the arc, which stands for the horizon, so how far
  // up it is reads as how close to you it is. The geometry and the glyph are in
  // `lib/skyOverlay.js`; this only hands them to Leaflet.
  function bodyIcon(kind, colour, illuminated, waxing) {
    const size = 20;
    return L.divIcon({
      className: 'sky-body', // replaces Leaflet's boxed default
      html: bodySvg(kind, colour, illuminated, waxing, size),
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  function drawSun() {
    if (!map) return;
    if (!sunLayer) sunLayer = L.layerGroup().addTo(map);
    sunLayer.clearLayers();
    if (!sunMode || !sunSky || !sunAnchor) return;
    const origin = sunAnchor;
    const bounds = map.getBounds();
    // Sized off the *shorter* side of the view, not its diagonal: the arc is a
    // circle around the anchor, so a radius set by the diagonal runs off the top
    // and bottom of a wide window.
    const across = map.distance(bounds.getNorthWest(), bounds.getNorthEast());
    const down = map.distance(bounds.getNorthWest(), bounds.getSouthWest());
    const reach = Math.min(across, down) * 0.22;
    const at = (azimuth, scale = 1) => {
      const point = measure.destination(origin, azimuth, reach * scale);
      return [point.lat, point.lon];
    };
    const curve = sunSky.curve;

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
      for (const run of upRuns(body.altitude)) {
        L.polyline(
          run.map((i) => at(body.azimuth[i])),
          { color: body.colour, weight: 2.5, opacity: 0.9 }
        ).addTo(sunLayer);
      }
      for (const { index: i, long } of hourTicks(curve.minutes, body.altitude)) {
        L.polyline([at(body.azimuth[i], 0.94), at(body.azimuth[i], long ? 1.1 : 1.03)], {
          color: body.colour,
          weight: 2.5,
          opacity: 0.9,
        })
          .bindTooltip(`${body.label} ${curve.clock[i]} · az ${Math.round(body.azimuth[i])}°`)
          .addTo(sunLayer);
      }
      const altitude = body.altitude[sunIndex];
      const below = isBelow(altitude);
      const reading = bodyReading(
        body.label, curve.clock[sunIndex], body.azimuth[sunIndex], altitude
      );
      L.polyline([[origin.lat, origin.lon], at(body.azimuth[sunIndex])], {
        color: body.colour,
        weight: 3.5,
        opacity: below ? 0.6 : 1,
        dashArray: below ? '6 6' : null,
      })
        .bindTooltip(reading, { sticky: true })
        .addTo(sunLayer);
      // Nothing rides the ray while the body is under the horizon: the dashed
      // ray already says where it is, and a mark on it would claim it is visible.
      if (!below) {
        L.marker(at(body.azimuth[sunIndex], markScale(altitude)), {
          icon: bodyIcon(
            body.key,
            body.colour,
            curve.moon_illuminated[sunIndex],
            sunSky.moon.waxing
          ),
          keyboard: false,
        })
          .bindTooltip(body.key === 'moon' ? `${reading} · ${sunSky.moon.phase}` : reading)
          .addTo(sunLayer);
      }
    }

    L.circleMarker([origin.lat, origin.lon], {
      radius: 4,
      color: '#fff',
      weight: 2,
      fillColor: themeColour('--accent', '#e8a33d'),
      fillOpacity: 1,
    }).addTo(sunLayer);
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
    const redraw = () => drawSun();
    map.on('zoomend moveend', redraw);
    return () => map.off('zoomend moveend', redraw);
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
        map.setView([parsed.lat, parsed.lon], Math.max(map.getZoom(), 16));
        return;
      } catch {
        /* not coordinates — fall through to geocoding */
      }
      const place = await api.get(`/api/geo/geocode?q=${encodeURIComponent(text)}`);
      map.setView([place.lat, place.lon], Math.max(map.getZoom(), 13));
      if (place.display_name) toast(place.display_name, 'info', 5000);
    } catch {
      toast('No match. Try coordinates ("50.4501, 30.5234"), DMS, or a place name', 'danger');
    } finally {
      searching = false;
    }
  }

  function setBearing(deg) {
    if (!map) return;
    map.setBearing(((deg % 360) + 360) % 360);
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

  function markerIcon(style) {
    const { size, anchor } = markerGeometry(style);
    return L.divIcon({
      className: 'sat-marker',
      iconSize: size,
      iconAnchor: anchor,
      html: markerSvg(style),
    });
  }

  function removeMarker() {
    if (marker) marker.remove();
    marker = null;
    markerLatLng = null;
  }

  function toggleMoveMode() {
    if (markerStyle === 'none') return;
    moveMode = !moveMode;
    if (!moveMode) {
      removeMarker();
      return;
    }
    const c = map.getCenter();
    marker = L.marker(c, {
      draggable: true,
      icon: markerIcon(markerStyle),
      zIndexOffset: 1000,
    }).addTo(map);
    markerLatLng = { lat: c.lat, lon: c.lng };
    marker.on('drag move', () => {
      const p = marker.getLatLng();
      markerLatLng = { lat: p.lat, lon: p.lng };
    });
  }

  // keep the live marker's look in sync with the chosen style; leaving move
  // mode (or picking "none") drops the marker
  $effect(() => {
    if (markerStyle === 'none' && moveMode) {
      moveMode = false;
      removeMarker();
    } else if (marker) {
      marker.setIcon(markerIcon(markerStyle));
    }
  });

  // The single capture path. `centerLL` frames the crop (a Leaflet LatLng);
  // `baseW`/`baseH` are the crop size at the current view zoom, then scaled to
  // the chosen output resolution. `rectCss` is the same frame as a rectangle in
  // map-container px — only the widget path needs it, since it crops screen
  // pixels rather than stitching tiles. The recorded point is the moved pin (if
  // any), else the crop centre.
  async function doCapture(centerLL, baseW, baseH, rectCss) {
    if (capturing) return;
    // widget basemaps have no tiles to stitch: same frame, screen pixels
    if (isWidgetBase) return doWidgetCapture(centerLL, rectCss);
    capturing = true;
    const { zoom, width, height, mult } = scaledCapture(
      baseW, baseH, resolution, center.zoom, providerMaxZoom
    );
    let marker_x = 0, marker_y = 0, marker_lat = centerLL.lat, marker_lon = centerLL.lng;
    if (moveMode && marker) {
      const ll = marker.getLatLng();
      marker_lat = ll.lat;
      marker_lon = ll.lng;
      // pin offset from the crop centre in container px (already accounts for
      // rotation), scaled up to the output pixel size
      const c0 = map.latLngToContainerPoint(centerLL);
      const cp = map.latLngToContainerPoint(ll);
      marker_x = Math.round((cp.x - c0.x) * mult);
      marker_y = Math.round((cp.y - c0.y) * mult);
    }
    try {
      const c = await ensureCase();
      const result = await api.post(`/api/cases/${c.id}/satellite/capture`, {
        lat: centerLL.lat,
        lon: centerLL.lng,
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
    doCapture(map.getCenter(), w, h, {
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
  async function doWidgetCapture(centerLL, rect) {
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
      await fileScreenshot(blob, centerLL, true);
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
  async function fileScreenshot(blob, centerLL, framed) {
    const c = await ensureCase();
    const form = new FormData();
    form.append('image', blob, 'screenshot.png');
    form.append('lat', String(centerLL ? centerLL.lat : center.lat));
    form.append('lon', String(centerLL ? centerLL.lng : center.lon));
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
  let shotOpen = $state(false);
  let shotBlob = $state(null);
  let shotPreview = $state(''); // object URL for the <img> preview
  let shotBusy = $state(false);

  function shotReset() {
    if (shotPreview) URL.revokeObjectURL(shotPreview);
    shotBlob = null;
    shotPreview = '';
  }
  function shotClose() {
    shotReset();
    shotOpen = false;
  }
  function shotTake(file) {
    if (!file || !file.type?.startsWith('image/')) return;
    shotReset();
    shotBlob = file;
    shotPreview = URL.createObjectURL(file);
  }
  function onShotPaste(e) {
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    if (item) {
      e.preventDefault();
      shotTake(item.getAsFile());
    }
  }
  function onShotDrop(e) {
    e.preventDefault();
    shotTake(e.dataTransfer?.files?.[0]);
  }

  // One-click grab of the whole map view into the dialog's preview: the same
  // extension frame as a framed capture, minus the crop, at native resolution.
  // The preview is what lets the user judge it before filing. The dialog itself
  // is only reachable with the extension present (no extension → the gate points
  // at Settings instead), so this grab is always available here.
  let shotGrabbing = $state(false);
  async function shotGrab() {
    if (shotGrabbing) return;
    shotGrabbing = true;
    try {
      const img = await extFrame();
      const r0 = mapEl.getBoundingClientRect();
      const canvas = await shotCropCanvas(img, { x: 0, y: 0, w: r0.width, h: r0.height });
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      if (blob) shotTake(new File([blob], 'screenshot.png', { type: 'image/png' }));
    } catch (e) {
      // extension missing or refused — the paste path still works
      toast(`Screen capture unavailable (${e.message}). Paste a screenshot instead`, 'warn', 6000);
    } finally {
      shotGrabbing = false;
    }
  }
  // paste works anywhere while the dialog is open — no need to focus a zone
  $effect(() => {
    if (!shotOpen) return;
    window.addEventListener('paste', onShotPaste);
    return () => window.removeEventListener('paste', onShotPaste);
  });

  async function shotSave() {
    if (!shotBlob || shotBusy) return;
    shotBusy = true;
    try {
      // a pasted image is not registered to any frame: its coordinates are the
      // map view at filing time, and provenance says so (framed: false)
      await fileScreenshot(shotBlob, null, false);
      shotClose();
    } catch (e) {
      toast(`Could not file the screenshot: ${e.message}`, 'danger', 6000);
    } finally {
      shotBusy = false;
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
    if (!s2MenuOpen) return;
    const onDocMousedown = (e) => {
      if (s2MenuEl && !s2MenuEl.contains(e.target)) s2MenuOpen = false;
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
    if (!selectArmed || e.button !== 0 || !map) return;
    // own the gesture so Leaflet doesn't pan while we draw the box
    e.stopPropagation();
    e.preventDefault();
    const rect = mapEl.getBoundingClientRect();
    const start = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    selRect = { x0: start.x, y0: start.y, x1: start.x, y1: start.y };
    const move = (ev) => {
      let x1 = ev.clientX - rect.left;
      let y1 = ev.clientY - rect.top;
      if (ratioValue) {
        // lock the box to the chosen aspect ratio, sized from the larger delta
        const dx = x1 - start.x;
        const dy = y1 - start.y;
        let w = Math.abs(dx);
        let h = Math.abs(dy);
        if (w / h > ratioValue) h = w / ratioValue;
        else w = h * ratioValue;
        x1 = start.x + (dx < 0 ? -w : w);
        y1 = start.y + (dy < 0 ? -h : h);
      }
      selRect = { x0: start.x, y0: start.y, x1, y1 };
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      finishSelect();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  function finishSelect() {
    const r = selRect;
    selRect = null;
    if (!r) return;
    const w = Math.abs(r.x1 - r.x0);
    const h = Math.abs(r.y1 - r.y0);
    if (w < 12 || h < 12) return; // an accidental click / tiny drag: ignore
    const centerLL = map.containerPointToLatLng(
      L.point((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2)
    );
    selectArmed = false; // one box per arm — re-arm to draw another
    doCapture(centerLL, Math.round(w), Math.round(h), {
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
    if (!map) return;
    if (!gridRenderer) gridRenderer = L.canvas({ padding: 0.5 });
    if (!gridLayer) gridLayer = L.layerGroup();
    if (!gridAoiLayer) gridAoiLayer = L.layerGroup();
    if (!gridDraftLayer) gridDraftLayer = L.layerGroup();
    syncGridVisibility();
  }

  // the eye toggle keeps the grid but drops its layers off the map so you can
  // read the bare imagery underneath, then puts them back
  function syncGridVisibility() {
    if (!map) return;
    for (const lyr of [gridLayer, gridAoiLayer, gridDraftLayer]) {
      if (!lyr) continue;
      const on = map.hasLayer(lyr);
      if (gridHidden && on) map.removeLayer(lyr);
      else if (!gridHidden && !on) map.addLayer(lyr);
    }
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
    cellRects.clear();
    aoiOutline = null;
    draftLine = null;
    gridLayer?.clearLayers();
    gridAoiLayer?.clearLayers();
    gridDraftLayer?.clearLayers();
  }

  function gridHandleIcon() {
    return L.divIcon({ className: 'grid-handle', iconSize: [16, 16], iconAnchor: [8, 8] });
  }

  function cellLatLngBounds(i, j) {
    const b = gridSearch.cellBounds(grid, i, j);
    return [[b.south, b.west], [b.north, b.east]];
  }

  function cellStyle(key) {
    const base = CELL_STYLE[grid?.statuses[key] || 'unchecked'];
    // the cell under review gets a bright cyan outline — distinct from the
    // yellow flag and the grey cleared fill for colour-blind readability
    return key === reviewKey ? { ...base, color: '#33c9ff', weight: 2.5, opacity: 1 } : base;
  }

  function renderGrid() {
    ensureGridLayers();
    gridLayer.clearLayers();
    cellRects.clear();
    if (!grid) return;
    for (const [i, j] of gridSearch.cellsInAoi(grid)) {
      const key = gridSearch.cellKey(i, j);
      const rect = L.rectangle(cellLatLngBounds(i, j), {
        renderer: gridRenderer,
        bubblingMouseEvents: false,
        ...cellStyle(key),
      });
      rect.on('click', (e) => {
        L.DomEvent.stop(e);
        cycleCell(i, j);
      });
      rect.on('contextmenu', (e) => {
        L.DomEvent.stop(e);
        flagCell(i, j);
      });
      rect.addTo(gridLayer);
      cellRects.set(key, rect);
    }
  }

  function restyleCell(key) {
    cellRects.get(key)?.setStyle(cellStyle(key));
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
  function renderAoi() {
    ensureGridLayers();
    gridAoiLayer.clearLayers();
    aoiOutline = null;
    if (!grid || !editArea) return;
    const b = gridSearch.aoiBounds(grid.aoi);
    if (grid.aoi.type === 'rect') {
      aoiOutline = L.rectangle([[b.south, b.west], [b.north, b.east]], AOI_STYLE).addTo(gridAoiLayer);
      for (const corner of CORNERS) {
        const m = L.marker(gridSearch.cornerLatLng(b, corner), {
          draggable: true,
          keyboard: false,
          icon: gridHandleIcon(),
          zIndexOffset: 1200,
        });
        m.on('dragstart', () => (dragBounds = { ...gridSearch.aoiBounds(grid.aoi) }));
        m.on('drag', (e) => onCornerDrag(corner, e.target.getLatLng()));
        m.on('dragend', commitResize);
        m.addTo(gridAoiLayer);
      }
    } else {
      aoiOutline = L.polygon(grid.aoi.vertices, AOI_STYLE).addTo(gridAoiLayer);
      addVertHandles();
    }
  }

  function onCornerDrag(corner, latlng) {
    if (!dragBounds) return;
    if (corner[0] === 'n') dragBounds.north = latlng.lat;
    else dragBounds.south = latlng.lat;
    if (corner[1] === 'e') dragBounds.east = latlng.lng;
    else dragBounds.west = latlng.lng;
    const b = gridSearch.normalizeBounds(dragBounds);
    aoiOutline?.setBounds([[b.south, b.west], [b.north, b.east]]);
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

  // reshape a confirmed polygon: draggable handles on every vertex
  function addVertHandles() {
    grid.aoi.vertices.forEach((v, k) => {
      const m = L.marker([v[0], v[1]], {
        draggable: true,
        keyboard: false,
        icon: gridHandleIcon(),
        zIndexOffset: 1200,
      });
      m.on('dragstart', () => (liveVerts = grid.aoi.vertices.map((x) => [...x])));
      m.on('drag', (e) => {
        if (!liveVerts) return;
        const ll = e.target.getLatLng();
        liveVerts[k] = [ll.lat, ll.lng];
        aoiOutline?.setLatLngs(liveVerts);
      });
      m.on('dragend', commitVertEdit);
      m.addTo(gridAoiLayer);
    });
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
    gridLayer?.clearLayers();
    cellRects.clear();
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
    draftLine = null;
    gridDraftLayer?.clearLayers();
    if (wasDrawing && grid) renderGrid(); // restore the cells hidden while drawing
  }

  // rectangle area: drag a box (mirrors the capture marquee, reusing selRect for
  // the live outline). Armed while gridDraw === 'rect'.
  function onGridRectStart(e) {
    if (gridDraw !== 'rect' || e.button !== 0 || !map) return;
    e.stopPropagation();
    e.preventDefault();
    const rect = mapEl.getBoundingClientRect();
    const start = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    selRect = { x0: start.x, y0: start.y, x1: start.x, y1: start.y };
    const move = (ev) => {
      selRect = { x0: start.x, y0: start.y, x1: ev.clientX - rect.left, y1: ev.clientY - rect.top };
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      finishGridRect();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  function finishGridRect() {
    const r = selRect;
    selRect = null;
    gridDraw = null;
    if (!r || Math.abs(r.x1 - r.x0) < 12 || Math.abs(r.y1 - r.y0) < 12) {
      if (grid) renderGrid(); // stray click: restore the cells hidden to draw
      return;
    }
    const p1 = map.containerPointToLatLng(L.point(r.x0, r.y0));
    const p2 = map.containerPointToLatLng(L.point(r.x1, r.y1));
    doApplyArea({
      type: 'rect',
      bounds: gridSearch.normalizeBounds({ south: p1.lat, north: p2.lat, west: p1.lng, east: p2.lng }),
    });
  }

  // polygon area: click to drop vertices (handled in onMapClick), drag the
  // handles to adjust, Confirm to build.
  function draftLatLngs() {
    return gridSearch.closeRing(polyDraft.map((p) => [p.lat, p.lon]));
  }

  function renderDraft() {
    ensureGridLayers();
    gridDraftLayer.clearLayers();
    draftLine = null;
    if (gridDraw !== 'polygon') return;
    draftLine = L.polyline(draftLatLngs(), {
      color: '#f5a623',
      weight: 1.5,
      opacity: 0.95,
      dashArray: '5 4',
    }).addTo(gridDraftLayer);
    polyDraft.forEach((p, k) => {
      const m = L.marker([p.lat, p.lon], {
        draggable: true,
        keyboard: false,
        icon: gridHandleIcon(),
        zIndexOffset: 1200,
      });
      m.on('drag', (e) => {
        const ll = e.target.getLatLng();
        polyDraft[k] = { lat: ll.lat, lon: ll.lng };
        draftLine?.setLatLngs(draftLatLngs());
      });
      m.on('dragend', renderDraft);
      m.addTo(gridDraftLayer);
    });
  }

  function confirmPolygon() {
    if (polyDraft.length < 3) return;
    const vertices = polyDraft.map((p) => [p.lat, p.lon]);
    gridDraw = null;
    polyDraft = [];
    gridDraftLayer?.clearLayers();
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
    map.fitBounds([[b.south, b.west], [b.north, b.east]], {
      padding: [80, 80],
      maxZoom: 20,
      animate: true,
    });
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
      let result;
      if (row.kind === 'place') {
        result = await api.del(`/api/cases/${caseId}/entities/${row.id}`);
      } else {
        result = await api.del(
          `/api/cases/${caseId}/satellite?path=${encodeURIComponent(row.path)}`
        );
      }
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
  let acceptingId = $state(null);
  async function acceptSaved(row) {
    if (acceptingId) return;
    acceptingId = row.id;
    try {
      await api.patch(`/api/cases/${caseState.current.id}/entities/${row.id}`, {
        status: 'confirmed',
      });
      await reloadCase(); // re-reads the saved index and the case sidebar
      toast('Point accepted', 'ok', 1600);
    } catch (e) {
      toast(`Could not accept this point: ${e.message}`, 'danger');
    } finally {
      acceptingId = null;
    }
  }

  // --- details modal (title + notes) ---
  let notesItem = $state(null);
  let notesText = $state('');
  let notesTitle = $state('');
  let notesFolder = $state('');
  let notesSaving = $state(false);

  function openNotes(row) {
    notesItem = row;
    notesText = row.notes ?? '';
    notesTitle = row.title ?? coordsLabel(row);
    notesFolder = row.folder ?? '';
  }

  async function saveNotes() {
    if (!notesItem) return;
    notesSaving = true;
    try {
      await api.patch(
        `/api/cases/${caseState.current.id}/satellite`,
        { path: notesItem.path, notes: notesText, title: notesTitle, folder: notesFolder }
      );
      notesItem = null;
      // the mirrored place entity was retitled too — refresh the sidebar
      await reloadCase();
      toast('Saved', 'ok', 1600);
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      notesSaving = false;
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
    // the map container just resized — let Leaflet redraw tiles for the new size
    await tick();
    map?.invalidateSize();
  }

  function loadSavedGroup() {
    try {
      return localStorage.getItem(GROUP_KEY) === 'folders' ? 'folders' : 'geo';
    } catch {
      return 'geo'; // localStorage unavailable (private mode) — non-fatal
    }
  }

  $effect(() => {
    try {
      localStorage.setItem(GROUP_KEY, savedGroup);
    } catch {
      /* ignore */
    }
  });

  // File a saved item into a My-work folder, dropped onto a folder in the
  // panel. One PATCH through the shared filing route (a capture's sidecar is
  // the authority, a place carries the folder itself), then the case reload
  // every other edit here does: the index, the sidebar and the map overlay all
  // read the new filing from it.
  async function moveSaved(row, folder) {
    // the row's kind *is* its entity type, bar the screenshot that rides the
    // capture type. Filing a proof as a capture would route it to PATCH /media,
    // the sidecar of an image it is not.
    const entity = {
      id: row.id,
      type: row.kind === 'place' ? 'place' : row.kind === 'proof' ? 'proof' : 'capture',
      attrs: { path: row.path },
    };
    try {
      await assignFolder(caseState.current.id, entity, folder);
      await reloadCase();
      toast(folder ? `Filed in ${folder}` : 'Removed from My work', 'ok', 1600);
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

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
          map?.invalidateSize({ animate: false });
        });
      }
    };
    const up = () => {
      savedResizing = false;
      if (frame) cancelAnimationFrame(frame);
      map?.invalidateSize({ animate: false });
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
    map?.invalidateSize({ animate: false });
  }

  async function resetSavedWidth() {
    setSavedWidth(savedPanel.DEFAULT_W);
    savedPanel.saveWidth(savedW);
    await tick();
    map?.invalidateSize({ animate: false });
  }

  // A width dragged out on a wide screen would eat a narrower window whole, so
  // re-clamp against the viewport as it changes. The clamped-down value is not
  // written back — what the user actually chose is what a later session restores.
  $effect(() => {
    const onWindowResize = () => setSavedWidth(savedW);
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  });

  // --- Locate: fill in the country of everything that still has none ---------
  // One batch per request (Nominatim is one lookup a second), looped until the
  // backlog is empty. Progress is the stored geography itself, so cancelling
  // keeps whatever was already resolved and a later pass picks up where this
  // one stopped.
  const LOCATE_BATCH = 10;
  let locating = $state(null); // { done, total } while a pass runs
  let locateStopped = false;
  let locateGeneration = 0;

  async function runLocate() {
    if (locating || !caseState.current) return;
    const id = caseState.current.id;
    const generation = ++locateGeneration;
    locateStopped = false;
    const total = pendingLocate(saved);
    locating = { done: 0, total };
    let located = 0;
    let failed = 0;
    let throttled = false;
    try {
      let remaining = total;
      while (remaining > 0 && !locateStopped && generation === locateGeneration) {
        const batch = await api.post(
          `/api/cases/${id}/satellite/locate?limit=${LOCATE_BATCH}`
        );
        if (generation !== locateGeneration) return;
        located += batch.located;
        failed += batch.failed;
        throttled = Boolean(batch.throttled);
        // A batch that resolved nothing means the network is down, or that
        // Nominatim put us in its penalty box — not that the next one will do
        // better: stop instead of hammering it forever.
        const stalled = batch.remaining >= remaining;
        remaining = batch.remaining;
        locating = { done: total - remaining, total };
        if (stalled || throttled) break;
      }
      if (generation !== locateGeneration) return;
      const rows = await api.get(`/api/cases/${id}/satellite/index`);
      if (generation !== locateGeneration) return;
      saved = rows;
      toast(
        throttled
          ? `Located ${located} of ${total}. OpenStreetMap is rate-limiting this address; wait a minute and run Locate again`
          : failed
            ? `Located ${located} of ${total}. ${failed} lookup(s) failed; run Locate again to retry`
            : `Located ${located} of ${total}`,
        failed || throttled ? 'warn' : 'ok'
      );
    } catch (e) {
      if (generation === locateGeneration) {
        toast(`Locate stopped: ${e.message}`, 'danger', 6000);
      }
    } finally {
      if (generation === locateGeneration) locating = null;
    }
  }

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
    <form
      class="go-form"
      onsubmit={(e) => {
        e.preventDefault();
        goTo();
      }}
    >
      <input
        class="input"
        placeholder={'50.4501, 30.5234  ·  48°51\'29"N 2°17\'40"E  ·  a place name'}
        bind:value={coordsText}
        title="Coordinates (decimal, DMS, MGRS, plus code) or a place name"
      />
      <button type="submit" class="btn" disabled={!coordsText.trim() || searching}>
        <Icon name="search" size={15} /> {searching ? '…' : 'Go'}
      </button>
    </form>
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

      <!-- saved work on the map: navigation only, off by default, session-only.
           It draws the panel's current selection, not the whole index. -->
      {#if savedOverlay}
        <SavedOverlay
          map={mapReady ? map : null}
          items={savedShown}
          caseId={caseState.current?.id}
          coords={coordsLabel}
          {fullscreen}
          bind:hoveredId={hoveredSavedId}
          onopen={openSaved}
          onedit={editSaved}
          onproof={sendToComposer}
          onpost={openLinkedPost}
          onshowproofs={() => (savedKind = 'proofs')}
          onrefresh={reloadCase}
        />
      {/if}

      {#if sheetPoints}
        <SheetPointsOverlay map={mapReady ? map : null} points={sheetPoints.points} />
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
          map={mapReady ? map : null}
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
          savedCount={saved.length}
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

      <!-- fixed center marker; a draggable Leaflet marker takes over in move mode -->
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
            ? `Sentinel-2 ${s2LayerLabel} from this exact date`
            : s2Latest
              ? `Sentinel-2 ${s2LayerLabel}: most recent pass over this point`
              : `Sentinel-2 ${s2LayerLabel}: most recent pass (open the picker to date it)`}
        >
          <Icon name="clock" size={11} />
          {s2PinnedDate ?? s2Latest ?? ''}
          {#if !s2PinnedDate}
            <span class="tag">{s2Latest ? 'latest' : 'most recent'}</span>
          {/if}
          {#if s2Layer !== DEFAULT_LAYER}
            <span class="tag layer">{s2LayerShort}</span>
          {/if}
          {#if s2Maxcc !== DEFAULT_MAXCC}
            <span class="tag" title="Passes over this cloud cover are not rendered"
              >≤{s2Maxcc}% cloud</span
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
          <svg width="30" height="30" viewBox="0 0 34 34" style="transform: rotate({-bearing}deg)">
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
            menuOpen={s2MenuOpen}
            toggleMenu={toggleS2Menu}
            bind:layer={s2Layer}
            layers={s2Layers}
            layerHint={s2LayerHint}
            layersSource={s2LayersSource}
            loadLayers={loadS2Layers}
            bind:date={s2Date}
            maxcc={s2Maxcc}
            setMaxcc={setS2Maxcc}
            {maxccLabel}
            filtered={s2Filtered}
            month={s2Month}
            {monthLabel}
            stepMonth={stepS2Month}
            {monthGrid}
            passes={s2Passes}
            {cloudClass}
            {cloudLabel}
            passesBusy={s2PassesBusy}
            passesNote={s2PassesNote}
            passesStale={s2PassesStale}
            verifyingDate={s2VerifyingDate}
            dateStatus={s2DateStatus}
            pickDate={pickS2Date}
            clearDate={clearS2Date}
            loadPasses={loadS2Passes}
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
        <span class="count">{saved.length}</span>
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
            rows={savedRows}
            folders={caseState.current?.folders ?? []}
            caseId={caseState.current?.id}
            coords={coordsLabel}
            {fullscreen}
            bind:kind={savedKind}
            bind:query={savedQuery}
            bind:group={savedGroup}
            bind:hoveredId={hoveredSavedId}
            onmove={moveSaved}
            revealId={revealSavedId}
            {locating}
            onopen={openSaved}
            onedit={editSaved}
            ondelete={(row) => (deleteTarget = row)}
            onproof={sendToComposer}
            onaccept={acceptSaved}
            onbrowse={() => (savedSearchOpen = true)}
            onlocate={runLocate}
            oncancelLocate={() => (locateStopped = true)}
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

<!-- satellite notes modal -->
{#if notesItem}
  <Modal title="Capture details" onclose={() => (notesItem = null)} width="420px">
    <label for="capture-title" style="display:block;font-size:var(--fs-xs);color:var(--text-3);margin-bottom:5px">Title</label>
    <input
      id="capture-title"
      class="input"
      placeholder={coordsLabel(notesItem)}
      bind:value={notesTitle}
    />
    <label for="capture-folder" style="display:block;font-size:var(--fs-xs);color:var(--text-3);margin:10px 0 5px">Folder</label>
    <FolderSelect
      id="capture-folder"
      bind:value={notesFolder}
      folders={caseState.current?.folders ?? []}
      emptyLabel="My work (root)"
    />
    <hr style="border:none;border-top:1px solid var(--border);margin:12px 0" />
    <div class="sat-info-rows">
      <div class="sat-info-row">
        <span class="sat-info-label">Coordinates</span>
        <span class="mono">{coordsLabel(notesItem)}</span>
      </div>
      <div class="sat-info-row">
        <span class="sat-info-label">Provider</span>
        <span>{notesItem.provider ?? notesItem.site ?? '—'}</span>
      </div>
      <div class="sat-info-row">
        <span class="sat-info-label">Zoom</span>
        <span>{notesItem.zoom ?? '—'}</span>
      </div>
      <div class="sat-info-row">
        <span class="sat-info-label">Captured</span>
        <span class="mono">{notesItem.fetched_at?.slice(0, 10)}</span>
      </div>
      <div class="sat-info-row">
        <span class="sat-info-label">Imagery date</span>
        <span class="mono">{notesItem.imagery_date ?? '—'}</span>
      </div>
      <div class="sat-info-row">
        <span class="sat-info-label">Image</span>
        <a
          class="link-out"
          class:disabled={fullscreen}
          href={fullscreen ? undefined : fileUrl(caseState.current?.id, notesItem.path)}
          target="_blank"
          rel="noreferrer"
          aria-disabled={fullscreen}
          title={leavesFullscreen ?? 'Open the full image'}
        >Open the full image <Icon name="external" size={12} /></a>
      </div>
    </div>
    <hr style="border:none;border-top:1px solid var(--border);margin:12px 0" />
    <label for="capture-notes" style="display:block;font-size:var(--fs-xs);color:var(--text-3);margin-bottom:5px">Notes</label>
    <textarea
      id="capture-notes"
      class="textarea"
      rows="5"
      placeholder="Add observations, links, context…"
      bind:value={notesText}
    ></textarea>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      <button class="btn" onclick={() => (notesItem = null)}>Cancel</button>
      <button class="btn btn-primary" onclick={saveNotes} disabled={notesSaving}>
        {notesSaving ? 'Saving…' : 'Save'}
      </button>
    </div>
  </Modal>
{/if}

<!-- Search every saved item at full width: the same index the tree reads, with
     thumbnails and a sort. No fetch, no network. -->
{#if savedSearchOpen}
  <SavedSearch
    rows={savedRows}
    caseId={caseState.current?.id}
    coords={coordsLabel}
    {fullscreen}
    centre={{ lat: center.lat, lon: center.lon }}
    bind:kind={savedKind}
    bind:query={savedQuery}
    bind:hoveredId={hoveredSavedId}
    onclose={() => (savedSearchOpen = false)}
    onopen={openSaved}
    onedit={editSaved}
    ondelete={(row) => (deleteTarget = row)}
    onproof={sendToComposer}
    onaccept={acceptSaved}
  />
{/if}

<!-- The manual way in, for when the Capture button's extension grab can't be
     used or the screenshot came from somewhere else entirely. -->
{#if shotOpen && !shotGrabbing}
  <Modal title="File a screenshot" onclose={shotClose} width="520px">
    <p class="shot-hint">
      The <strong>Capture</strong> button already crops this basemap off the screen
      through the usual frame. Use this when it can't:
      grab the whole map view below, or paste
      (<span class="mono">Ctrl+V</span>) / drop your own OS screenshot.
      Unlike a framed capture, this is filed at the current <em>view</em>
      (<span class="mono">{fmtCoords(center.lat, center.lon)}</span>, z{center.zoom}).
      the coordinates describe the map, not a registered crop. The Google attribution
      is burned into a footer either way; keep Google's on-screen credits inside the
      frame too.
    </p>
    <div style="display:flex;justify-content:center;margin-bottom:10px">
      <button class="btn btn-primary" onclick={shotGrab} disabled={shotGrabbing}>
        {#if shotGrabbing}<span class="spinner"></span> Grabbing…{:else}
          <Icon name="satellite" size={14} /> Capture the view{/if}
      </button>
    </div>
    <div
      class="shot-zone"
      class:has-image={!!shotPreview}
      role="button"
      tabindex="0"
      ondrop={onShotDrop}
      ondragover={(e) => e.preventDefault()}
    >
      {#if shotPreview}
        <img src={shotPreview} alt="screenshot to file" />
      {:else}
        <span>Paste (Ctrl+V) or drop the screenshot here</span>
      {/if}
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      {#if shotPreview}
        <button class="btn" onclick={shotReset}>Clear</button>
      {/if}
      <button class="btn" onclick={shotClose}>Cancel</button>
      <button class="btn btn-primary" onclick={shotSave} disabled={!shotBlob || shotBusy}>
        {shotBusy ? 'Filing…' : 'File as capture'}
      </button>
    </div>
  </Modal>
{/if}

<!-- Google JS capture gate: this basemap can only be captured through the
     browser extension (screen pixels are the only thing Google's terms allow
     out of the widget, and the extension is the promptless way to get them).
     Explain briefly and point at Settings; never a half-working share flow. -->
{#if extGateOpen}
  <Modal title="Capture needs the browser extension" onclose={() => (extGateOpen = false)} width="460px">
    <p class="shot-hint">
      Google's terms allow nothing programmatic out of this basemap — a capture
      here is a <strong>screenshot of the tab</strong>, and the Azimut Capture
      extension is what takes it (one grab per click, no screen-share prompt,
      works in fullscreen). Other basemaps are not affected.
    </p>
    <p class="shot-hint">
      Install it from <strong>Settings → Capture extension</strong>, then reload
      this tab.
    </p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      <button class="btn" onclick={() => (extGateOpen = false)}>Cancel</button>
      <button
        class="btn btn-primary"
        onclick={() => {
          extGateOpen = false;
          uiState.settingsTab = 'extension';
          uiState.tool = 'settings';
        }}
      >
        Open Settings
      </button>
    </div>
  </Modal>
{/if}

<!-- place edit / save-with-details modal -->
{#if placeModal}
  <Modal
    title={placeModal.id ? 'Edit place' : 'Save place'}
    onclose={() => (placeModal = null)}
    width="420px"
  >
    <label for="place-title" style="display:block;font-size:var(--fs-xs);color:var(--text-3);margin-bottom:5px">Title</label>
    <input
      id="place-title"
      class="input"
      placeholder={placeCoordsLabel(placeModal)}
      bind:value={placeModal.title}
    />
    <label for="place-folder" style="display:block;font-size:var(--fs-xs);color:var(--text-3);margin:10px 0 5px">Folder</label>
    <FolderSelect
      id="place-folder"
      bind:value={placeModal.folder}
      folders={caseState.current?.folders ?? []}
      emptyLabel="My work (root)"
    />
    <hr style="border:none;border-top:1px solid var(--border);margin:12px 0" />
    <div class="sat-info-rows">
      <div class="sat-info-row">
        <span class="sat-info-label">Coordinates</span>
        <span class="mono">{placeCoordsLabel(placeModal)}</span>
      </div>
      <div class="sat-info-row">
        <span class="sat-info-label">Zoom</span>
        <span>z{placeModal.zoom}{placeModal.bearing ? ` · ${Math.round(placeModal.bearing)}°` : ''}</span>
      </div>
    </div>
    <hr style="border:none;border-top:1px solid var(--border);margin:12px 0" />
    <!-- what this point already claims, and why it is being saved — said while
         the analyst still knows: the photo it geolocates, the video whose
         metadata pointed here -->
    <span style="display:block;font-size:var(--fs-xs);color:var(--text-3);margin-bottom:5px">Relations</span>
    {#if placeModal.relations?.length}
      <RelationList
        caseId={caseState.current.id}
        relations={placeModal.relations}
        subjectType="place"
        actionFilter="relation"
        onwalk={(entity) => { placeModal = null; openEntity(entity); }}
        onchanged={async () => {
          await loadPlaceRelations(placeModal?.id);
          await reloadCase();
        }}
      />
    {/if}
    <RelationPicker subjectType="place" bind:value={placeModal.relation} />
    <hr style="border:none;border-top:1px solid var(--border);margin:12px 0" />
    <label for="place-notes" style="display:block;font-size:var(--fs-xs);color:var(--text-3);margin-bottom:5px">Notes</label>
    <textarea
      id="place-notes"
      class="textarea"
      rows="5"
      placeholder="Add observations, links, context…"
      bind:value={placeModal.notes}
    ></textarea>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      <button class="btn" onclick={() => (placeModal = null)}>Cancel</button>
      <button class="btn btn-primary" onclick={savePlaceModal} disabled={placeSaving}>
        {placeSaving ? 'Saving…' : 'Save'}
      </button>
    </div>
  </Modal>
{/if}

<!-- reference-image picker: choose a case image to float over the map. Pure
     scratch aid — the window is never captured or saved. -->
{#if refPicker}
  <Modal title="Add reference" onclose={() => (refPicker = false)} width="560px">
    <p class="ref-hint">
      Float a case image or video over the map to compare against the imagery.
      Reference windows are never captured or saved.
    </p>
    {#if refLoading}
      <div class="ref-empty">Loading…</div>
    {:else if !refMedia.length}
      <div class="ref-empty">
        No images or videos in this case yet. Import one in the Media Library first.
      </div>
    {:else}
      {#if refBrowserOpen || refMedia.length > REF_SEARCH_MIN}
        <div class="ref-search">
          <SearchInput
            bind:value={refQuery}
            placeholder="Search media…"
            count={`${visibleRefMedia.length}/${refMedia.length}`}
            width="100%"
          />
          <button
            class="btn btn-ghost btn-sm browse-btn"
            title={refBrowserOpen ? 'Show every image' : 'Browse folders'}
            onclick={toggleRefBrowser}
          >…</button>
        </div>
      {/if}
      {#if refBrowserOpen}
        <FolderBrowser
          entries={refBrowserEntries}
          path={refBrowsePath}
          rootLabel="Case media"
          selectedId={refBrowseSelection}
          matches={(entry) => matchesQuery(entry, refQuery)}
          emptyText="This folder has no matching media."
          icon={(entry) => (entry.kind === 'video' ? 'video' : 'image')}
          label={(entry) => entry.title ?? entry.filename}
          onnavigate={openRefFolder}
          onselect={(entry) => (refBrowseSelection = entry.path)}
          onconfirm={(entry) => addRef(entry)}
        />
        <div class="ref-actions">
          <button class="btn btn-primary btn-sm" disabled={!refBrowseSelection} onclick={confirmRefBrowser}>
            Add selected
          </button>
        </div>
      {:else if !visibleRefMedia.length}
        <div class="ref-empty">No media matches this search.</div>
      {:else}
        <div class="ref-grid">
          {#each visibleRefMedia as m (m.path)}
            <button class="ref-pick" onclick={() => addRef(m)} title={m.title ?? m.filename}>
              <div class="ref-thumb">
                {#if m.thumbnail}
                  <img src={fileUrl(caseState.current.id, m.thumbnail)} alt={m.filename} loading="lazy" />
                {:else}
                  <Icon name={m.kind === 'video' ? 'video' : 'image'} size={26} />
                {/if}
                {#if m.kind === 'video'}
                  <span class="ref-kind"><Icon name="video" size={11} /></span>
                {/if}
              </div>
              <span class="ref-name">{m.title ?? m.filename}</span>
            </button>
          {/each}
        </div>
      {/if}
    {/if}
  </Modal>
{/if}

<style>
  .spacer {
    flex: 1;
  }
  .go-form {
    display: flex;
    gap: 8px;
    width: min(420px, 36vw);
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
    /* keep the map's z-index range (Leaflet panes/controls up to 1000, our own
       clusters above them) to itself, so a dialog portalled into the fullscreen
       tool still lands on top of it */
    isolation: isolate;
  }
  .map {
    position: absolute;
    inset: 0;
    background: var(--bg-2);
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
    /* above Leaflet's own control corners (z-index 1000) so the measure panel
       is never hidden behind the zoom +/- buttons (item 7) */
    z-index: 1100;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
  }
  .map-wrap.measuring :global(.leaflet-container),
  .map-wrap.selecting :global(.leaflet-container) {
    cursor: crosshair;
  }
  .map-wrap.grid-drawing :global(.leaflet-container) {
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

  .sat-info-rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .sat-info-row {
    display: flex;
    gap: 10px;
    font-size: var(--fs-sm);
    align-items: baseline;
  }
  .sat-info-label {
    color: var(--text-3);
    font-size: var(--fs-xs);
    min-width: 80px;
    flex-shrink: 0;
  }

  /* Leaflet dark-theme adjustments */
  :global(.leaflet-container) {
    font-family: var(--font-sans);
    background: var(--bg-2);
    image-rendering: smooth;
  }
  /* NB: no backface-visibility / transform promotion on tiles — that forces
     each tile onto its own GPU layer and reintroduces the white seams the
     deSeamTiles() left/top positioning removes (see script). */
  :global(.leaflet-control-attribution) {
    background: rgba(24, 24, 24, 0.85) !important;
    color: var(--text-3) !important;
    font-size: 10px;
  }
  :global(.leaflet-control-attribution a) {
    color: var(--text-2) !important;
  }
  :global(.leaflet-bar a) {
    background: var(--bg-2) !important;
    color: var(--text-1) !important;
    border-color: var(--border) !important;
  }
  :global(.leaflet-bar a:hover) {
    background: var(--bg-3) !important;
  }
  /* zoom +/- (topleft) sits directly under the fullscreen/labels/measure
     cluster instead of Leaflet's default corner margin, which used to land
     it right on top of that cluster */
  :global(.leaflet-top.leaflet-left) {
    top: 58px !important;
    left: 12px !important;
  }
  :global(.leaflet-top.leaflet-left .leaflet-control) {
    margin: 0 0 8px !important;
  }
  :global(.leaflet-pane) {
    will-change: transform;
  }
  /* Slim ruler-style scale: no boxed panel, just a light bracket + label
     floating directly on the map so it stays readable over any imagery. */
  :global(.leaflet-control-scale) {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
    padding: 0 !important;
    margin: 0 10px 10px 0 !important;
  }
  :global(.leaflet-control-scale-line) {
    background: transparent !important;
    border: none !important;
    border-left: 1.5px solid rgba(255, 255, 255, 0.92) !important;
    border-right: 1.5px solid rgba(255, 255, 255, 0.92) !important;
    border-bottom: 1.5px solid rgba(255, 255, 255, 0.92) !important;
    color: #fff !important;
    font-size: 10px !important;
    font-weight: 600 !important;
    line-height: 1.3 !important;
    padding: 0 4px 1px !important;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85), 0 0 4px rgba(0, 0, 0, 0.5) !important;
  }

  /* reference-image picker */
  .ref-hint {
    font-size: var(--fs-sm);
    color: var(--text-2);
    margin: 0 0 12px;
  }
  .ref-search {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 10px;
  }
  .ref-search :global(.search-box) {
    flex: 1;
  }
  .browse-btn {
    min-width: 30px;
    font-size: var(--fs-lg);
    line-height: 1;
  }
  .ref-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 10px;
  }
  .shot-hint {
    font-size: var(--fs-sm);
    color: var(--text-2);
    margin: 0 0 12px;
  }
  .shot-zone {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 180px;
    border: 1px dashed var(--border);
    border-radius: 6px;
    color: var(--text-3);
    font-size: var(--fs-sm);
    overflow: hidden;
  }
  .shot-zone.has-image {
    border-style: solid;
  }
  .shot-zone img {
    max-width: 100%;
    max-height: 320px;
    display: block;
  }
  .ref-empty {
    padding: 24px 4px;
    text-align: center;
    font-size: var(--fs-sm);
    color: var(--text-3);
  }
  .ref-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 10px;
    max-height: 52vh;
    overflow-y: auto;
  }
  .ref-pick {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 0;
    background: none;
    border: none;
    color: var(--text-2);
    cursor: pointer;
    text-align: left;
  }
  .ref-thumb {
    position: relative;
    aspect-ratio: 4 / 3;
    border-radius: var(--radius-1);
    overflow: hidden;
    background: var(--bg-2);
    display: grid;
    place-items: center;
    color: var(--text-3);
    border: 1px solid var(--border);
  }
  .ref-kind {
    position: absolute;
    bottom: 4px;
    right: 4px;
    display: grid;
    place-items: center;
    padding: 2px;
    border-radius: var(--radius-1);
    color: #fff;
    background: rgba(16, 16, 16, 0.75);
    backdrop-filter: blur(4px);
  }
  .ref-pick:hover .ref-thumb {
    border-color: var(--accent);
  }
  .ref-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .ref-name {
    font-size: var(--fs-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ref-pick:hover .ref-name {
    color: var(--accent);
  }
</style>
