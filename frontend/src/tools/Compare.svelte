<script>
  /**
   * Two maps, one piece of ground.
   *
   * Satellite explores one imagery view. Compare starts empty and lets the
   * analyst choose two views deliberately, then changes only how that pair is
   * read. The provider, Wayback release and Sentinel-2 day belong to each
   * MapSurface; the camera is the one shared fact.
   */
  import { onMount, tick, untrack } from 'svelte';
  import { api } from '../lib/api.js';
  import {
    caseState,
    ensureCase,
    fmtCoords,
    prefs,
    prefsReady,
    reloadCase,
    toast,
    uiState,
  } from '../lib/state.svelte.js';
  import { saveRelation } from '../lib/relations.svelte.js';
  import { actionsFor } from '../lib/map/contextMenu.js';
  import {
    COMPARE_LAYERS,
    COMPARE_MODES,
    FIND_MODES,
    DEFAULT_DIVIDER,
    DEFAULT_OPACITY,
    comparisonLayers,
    percentage,
    availablePresets,
    PROVIDER_KINDS,
    providerKind,
  } from '../lib/map/compare.js';
  import {
    blobBase64,
    canvasBlob,
    comparisonFilename,
    composeComparison,
  } from '../lib/map/compareExport.js';
  import {
    changeCompatibility,
    changeNeedsFrames,
    changeSettings,
  } from '../lib/map/changeAssist.js';
  import {
    ANNOTATION_COLOURS,
    canFill,
    comparisonAnnotations,
  } from '../lib/map/compareAnnotations.js';
  import { cropSources, exportFrameSpec, frameSpan } from '../lib/map/exportFrame.js';
  import { formatDistance } from '../lib/measure.js';
  import { captureTab, extensionVersion } from '../lib/extBridge.js';
  import {
    CASE_FOLDER_LABEL,
    destinationLabel,
    readDestinations,
  } from '../lib/exportDest.js';
  import { startRotateDrag } from '../lib/map/gestures.js';
  import {
    askable as firmsAskable,
    tileParams as firmsTileParams,
  } from '../lib/map/firms.js';
  import {
    askable as nightAskable,
    lastNight,
    tileParams as nightTileParams,
  } from '../lib/map/nightlights.js';
  import { isRegistered, sourceRect } from '../lib/screenCrop.js';
  import { deletedToast } from '../lib/trash.js';
  import { assignFolder } from '../lib/filing.js';
  import { SENTINEL_ID } from '../lib/sentinel.js';
  import { WAYBACK_ID } from '../lib/wayback.js';
  import Icon from '../components/Icon.svelte';
  import Compass from '../components/Compass.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import ExportFolderPicker from '../components/ExportFolderPicker.svelte';
  import Modal from '../components/Modal.svelte';
  import ModeDock from './compare/ModeDock.svelte';
  import ModeControl from './compare/ModeControl.svelte';
  import SourceCard from './compare/SourceCard.svelte';
  import ChangePanel from './compare/ChangePanel.svelte';
  import AnalyzerPanel from './compare/AnalyzerPanel.svelte';
  import AnalysisOverlay from './compare/AnalysisOverlay.svelte';
  import { zoneMarks, marksToZones, viewZone } from '../lib/map/analyzers.js';
  import './compare/compare.css';
  import { linkCameras } from '../lib/map/cameraLink.js';
  import { detectCaptures } from '../lib/map/changeCapture.js';
  import { apply, cssMatrix, frameToFrame, fromMercator, screenToMercator } from '../lib/map/groundFrame.js';
  import MapSurface from './satellite/MapSurface.svelte';
  import MapContextMenu from './satellite/MapContextMenu.svelte';
  import PlaceDialog from './satellite/PlaceDialog.svelte';
  import SavedOverlay from './satellite/SavedOverlay.svelte';
  import LayerPane from './compare/LayerPane.svelte';
  import AnnotationCanvas from './compare/AnnotationCanvas.svelte';
  import AnnotationToolbar from './compare/AnnotationToolbar.svelte';
  import ExportFrame from './compare/ExportFrame.svelte';
  import { createSavedState } from './satellite/state/saved.svelte.js';
  import PlaceSearch from './satellite/PlaceSearch.svelte';
  import { createImageryState, FALLBACK_PROVIDER } from './satellite/state/imagery.svelte.js';
  import { createSentinelState } from './satellite/state/sentinel.svelte.js';
  import { createWaybackState } from './satellite/state/wayback.svelte.js';

  const imagery = createImageryState({ api });
  let home = $state(null);
  let catalogueError = $state('');
  let firesKeyed = $state(false);
  let picking = $state(null); // 'a' | 'b' | null
  let mode = $state('side');
  let divider = $state(DEFAULT_DIVIDER);
  let opacity = $state(DEFAULT_OPACITY);
  let blinkB = $state(false);
  let blinkInterval = $state(800);
  let annotationSide = $state('both');
  let blinkPaused = $state(false);
  let coordsText = $state('');
  let searching = $state(false);
  let swiping = $state(false);
  let stageEl = $state(null);
  let rotating = $state(null); // { which, x, y } | null
  let outputBusy = $state(''); // 'capture' | 'png' | 'gif' | 'copy' | ''
  let rightPanel = $state(null); // 'export' | 'layers' | null
  let grabbing = $state(false);
  let captureSide = $state(null); // surface visible during an extension frame
  let exportKind = $state('png'); // 'png' | 'blink' | 'slide'
  // What an export is cut to, as two ground corners, and whether one is being
  // drawn right now. No frame means the whole view, which is the default.
  let exportFrame = $state(null);
  let framing = $state(false);
  let blinkPausedBeforeFraming = null;
  let exportDestination = $state(null);
  let exportPicker = $state(false);
  let sessionName = $state('Comparison');
  let openedSession = $state(null); // { name, title } | null
  let savedSignature = $state(null);
  let saveDialog = $state(false);
  let sessionDialog = $state(false);
  let sessionBusy = $state(false);
  let sessionList = $state([]);
  let discardTarget = $state(null); // { kind: 'new' | 'open' | 'revert', name? } | null
  let annotations = $state([]);
  let annotationTool = $state('select');
  let selectedAnnotationId = $state(null);
  let annotationColour = $state(ANNOTATION_COLOURS[0]);
  let annotationStroke = $state(4);
  let annotationFill = $state(0);
  let annotationUndo = $state([]);
  let annotationRedo = $state([]);
  let annotationPreviewBase = null;
  let changeOptions = $state(changeSettings());
  let analyzerPanel = $state(null);
  let analyzerZones = $state([]);
  let analyzerDrawing = $state('select');
  let analyzerSelectedZone = $state(null);
  let analyzerLayers = $state([]);
  let analyzerAreasVisible = $state(true);
  let analyzerSingle = $state(false);
  let analyzerResult = $state(null);
  let analyzerOpening = $state(null);
  const analyzerMarks = $derived(zoneMarks(analyzerZones));
  const detecting = $derived(mode === 'analysis');
  /**
   * Detect draws over an undivided pair, whatever reading mode preceded it.
   * Difference over both images is the side-by-side layout with the same mask
   * laid on each: one question, two answers, rather than a hidden background.
   */
  const stageMode = $derived(
    mode === 'analysis' || (mode === 'change' && changeOptions.base === 'side') ? 'side' : mode
  );
  /** What an export composes. A difference is a difference however it is laid
   *  out, so only Detect's borrowed layout is translated here. */
  const captureMode = $derived(mode === 'analysis' ? 'side' : mode);
  /**
   * A vessel or a hotspot is present on one date, so that analyzer reads one
   * image and the stage shows one map. Two identical maps would say the run
   * compares them, which is the kind of quiet untruth this tool cannot afford.
   */
  const soloStage = $derived(detecting && analyzerSingle);
  /** The surface actually on screen, which is what "the current view" means. */
  const primeEngine = $derived(soloStage ? (b.engine ?? a.engine) : (a.engine ?? b.engine));

  /**
   * Show, on the maps, the imagery a run would sweep.
   *
   * Outside Detect the source cards lead and the maps follow them. Inside it
   * that direction is wrong: a detection fetches its own tiles at a fixed grid,
   * so the pair on screen can quietly be imagery the run never reads, which is
   * what made the panel feel unmoored from the map under it. So Detect leads.
   * The source cards step aside while it is on, and this is how what is drawn
   * on stays what is measured.
   */
  /** Said once per absence: every date picked pushes sources again. */
  let sentinelMissingSaid = false;
  function applyAnalysisSources(next) {
    let missing = false;
    for (const [letter, target, sentinel] of [['a', a, s2a], ['b', b, s2b]]) {
      const source = next?.[letter];
      if (!source) continue;
      if (!imagery.find(source.provider)) {
        missing = true;
        continue;
      }
      target.providerId = source.provider;
      target.present = true;
      sentinel.layer = source.layer || sentinel.layer;
      sentinel.date = source.date || '';
      sentinel.setMaxcc(source.maxcc ?? 100);
    }
    if (missing && !sentinelMissingSaid) {
      toast('Copernicus Sentinel-2 is not configured, so the maps still show the previous imagery', 'warn', 6000);
    }
    sentinelMissingSaid = missing;
    invalidateChangeAssist();
  }

  /** The camera as a rectangle to sweep: the one place the map decides what a
   *  run covers, after which the area is fixed and the camera is free again. */
  function useCurrentView() {
    const bounds = primeEngine?.viewBounds?.();
    if (!bounds) return;
    analyzerZones = [...analyzerZones, viewZone(bounds, `Area ${analyzerZones.length + 1}`)];
    analyzerAreasVisible = true;
    analyzerDrawing = 'select';
  }
  function focusAnalysis([lon, lat], source) {
    const engine = primeEngine;
    if (engine) engine.setView({ lon, lat }, engine.getZoom());
    else if (source && imagery.find(source.provider)) {
      view = { lat, lon, zoom: 16 };
      applySide(a, s2a, wba, { present: true, provider: source.provider,
        sentinel: { date: source.date, layer: source.layer, maxcc: source.maxcc },
        wayback_release: source.release });
    } else toast('Choose an imagery source to show this area on the map', 'info');
  }
  function setAnalyzerMarks(marks) {
    analyzerZones = marksToZones(marks, analyzerZones);
  }
  $effect(() => {
    const requested = uiState.openAnalyzer;
    if (!requested) return;
    analyzerOpening = requested;
    uiState.openAnalyzer = null;
    mode = 'analysis';
  });
  let changeBusy = $state(false);
  let changeError = $state('');
  let changeResult = $state(null);
  let changeUrl = $state('');
  /** One transform per surface: the mask is ground, and each map frames it. */
  let changeTransform = $state({ a: '', b: '' });
  let changeBlinkOn = $state(true);
  const changeVisible = $derived(changeOptions.visible && (!changeOptions.blink || changeBlinkOn));
  const changeBase = $derived(changeOptions.base);
  const changeOpacity = $derived(changeOptions.opacity);
  const changePalette = $derived(changeOptions.palette);
  const changeCounts = $derived(changeResult?.counts);
  let changeRequest = 0;
  let previousCaseId = null;
  $effect(() => {
    const id = caseState.current?.id ?? null;
    if (previousCaseId && id !== previousCaseId) {
      untrack(() => {
        newComparison();
        sessionDialog = false;
        saveDialog = false;
        discardTarget = null;
        sessionList = [];
      });
    }
    previousCaseId = id;
  });
  // The one thing A and B share. The parent owns this camera; each surface
  // reports gestures here and receives the resulting value one way.
  let view = $state({ lat: 0, lon: 0, zoom: 2 });
  let bearing = $state(0);
  const savedWork = createSavedState({ api, notify: toast, assignFolder, reloadCase });

  function freshFirms() {
    return { sensor: 'viirs', window: '24h', first: '', last: '' };
  }

  function freshNight() {
    return { source: 'noaa20', day: lastNight() };
  }

  const a = $state({
    present: false,
    providerId: FALLBACK_PROVIDER,
    engine: null,
    element: null,
    surface: null,
    dated: null,
    ready: false,
    refused: false,
    overlays: [],
    firms: freshFirms(),
    night: freshNight(),
  });
  const b = $state({
    present: false,
    providerId: FALLBACK_PROVIDER,
    engine: null,
    element: null,
    surface: null,
    dated: null,
    ready: false,
    refused: false,
    overlays: [],
    firms: freshFirms(),
    night: freshNight(),
  });

  const s2a = createSentinelState({
    place: () => ({ lat: view.lat, lon: view.lon }),
    onBilled: () => imagery.refreshUsage(),
    notify: toast,
    api,
  });
  const s2b = createSentinelState({
    place: () => ({ lat: view.lat, lon: view.lon }),
    onBilled: () => imagery.refreshUsage(),
    notify: toast,
    api,
  });
  const wba = createWaybackState({
    api,
    place: () => ({ lat: view.lat, lon: view.lon, zoom: view.zoom }),
  });
  const wbb = createWaybackState({
    api,
    place: () => ({ lat: view.lat, lon: view.lon, zoom: view.zoom }),
  });

  $effect(() => {
    const caseId = caseState.current?.id;
    caseState.rev;
    return savedWork.load(caseId);
  });

  const both = $derived(a.present && b.present);
  const activeView = $derived(view);
  const shownA = $derived(
    imagery.displayed(a.providerId, view.zoom, { ...s2a.variant, release: wba.release })
  );
  const shownB = $derived(
    imagery.displayed(b.providerId, view.zoom, { ...s2b.variant, release: wbb.release })
  );
  const labelA = $derived(imagery.find(a.providerId)?.label ?? 'Imagery A');
  const labelB = $derived(imagery.find(b.providerId)?.label ?? 'Imagery B');
  const hasWidget = $derived(Boolean(shownA.provider?.widget || shownB.provider?.widget));
  const sessionDirty = $derived(
    (a.present || b.present) && sessionSignature() !== savedSignature
  );
  let firmsSensors = $state([]);

  function changeSide(target, sentinel, wayback, shown) {
    return {
      present: target.present,
      provider: shown.provider?.id ?? target.providerId,
      widget: Boolean(shown.provider?.widget),
      overlays: comparisonLayers(target.overlays),
      firms: { ...target.firms },
      nightlights: { ...target.night },
      sentinel: {
        layer: sentinel.layer,
        date: sentinel.date,
        effectiveDate: sentinel.date || sentinel.latest,
        maxcc: sentinel.maxcc,
      },
      waybackRelease: wayback.release,
    };
  }

  const changeStatus = $derived(
    changeCompatibility(changeSide(a, s2a, wba, shownA), changeSide(b, s2b, wbb, shownB))
  );

  function surfaceOverlays(target) {
    return target.overlays
      .map((id) => {
        if (id === 'firms') {
          if (!firesKeyed || !firmsAskable(target.firms)) return null;
          return { id, params: firmsTileParams(target.firms) };
        }
        if (id === 'nightlights') {
          if (!nightAskable(target.night)) return null;
          return { id, params: nightTileParams(target.night) };
        }
        if (id === 'saved') return null;
        return id;
      })
      .filter(Boolean);
  }

  onMount(() => {
    let gone = false;
    void (async () => {
      imagery.refreshUsage();
      await prefsReady;
      if (gone) return;
      home = { ...prefs.homeView };
      view = { ...home };
      await loadProviders();
      await loadFireCatalogue();
    })();
    return () => {
      gone = true;
    };
  });

  async function loadProviders() {
    try {
      await imagery.loadProviders();
      catalogueError = '';
    } catch (error) {
      catalogueError = error?.message ?? 'Could not read imagery providers';
    }
  }

  async function loadFireCatalogue() {
    try {
      const answer = await api.get('/api/firms/sensors');
      firmsSensors = answer.sensors ?? [];
      firesKeyed = Boolean(answer.keyed);
    } catch {
      firmsSensors = [];
      firesKeyed = false;
    }
  }

  function side(which) {
    return which === 'a' ? a : b;
  }

  function savedCoords(at) {
    return `${Number(at.lat).toFixed(5)}, ${Number(at.lon).toFixed(5)}`;
  }

  function openSaved(row) {
    if (!Number.isFinite(Number(row?.lat)) || !Number.isFinite(Number(row?.lon))) return;
    const zoom = Number.isFinite(Number(row.zoom)) ? Number(row.zoom) : Math.max(view.zoom, 13);
    (a.engine ?? b.engine)?.setView({ lat: Number(row.lat), lon: Number(row.lon) }, zoom);
  }

  let cameraLink = null;
  const zoomCeiling = $derived(both
    ? Math.min(imagery.find(a.providerId)?.max_zoom ?? 19, imagery.find(b.providerId)?.max_zoom ?? 19)
    : null);

  function surfaceFrame(target) {
    const box = target.element?.getBoundingClientRect();
    return { ...target.engine.frame(), width: box?.width || 1, height: box?.height || 1 };
  }

  /** Where the computed mask lands on each surface as it is framed right now. */
  // Highlights over busy imagery are easier to catch when they come and go, so
  // the overlay can blink in place rather than the analyst toggling the eye.
  const CHANGE_BLINK_MS = 620;
  $effect(() => {
    if (!(mode === 'change' && changeOptions.blink && changeOptions.visible && changeUrl)) {
      changeBlinkOn = true;
      return;
    }
    const timer = setInterval(() => (changeBlinkOn = !changeBlinkOn), CHANGE_BLINK_MS);
    return () => {
      clearInterval(timer);
      changeBlinkOn = true;
    };
  });

  function placeChangeMap() {
    if (!changeResult) return;
    changeTransform = {
      a: a.engine ? cssMatrix(frameToFrame(changeResult.frame, surfaceFrame(a))) : '',
      b: b.engine ? cssMatrix(frameToFrame(changeResult.frame, surfaceFrame(b))) : '',
    };
  }

  $effect(() => {
    const engines = [a.engine, b.engine].filter(Boolean);
    if (!engines.length) return;
    cameraLink = linkCameras(engines);
    untrack(() => cameraLink.align());
    const release = engines.map((engine) => engine.on('view-move', () => {
      if (engine.following()) return;
      view = engine.camera();
      bearing = view.bearing ?? bearing;
      placeChangeMap();
    }));
    return () => { cameraLink?.dispose(); cameraLink = null; release.forEach((off) => off()); };
  });

  function onSurfaceSettled(which, next) {
    view = { lat: next.lat, lon: next.lon, zoom: next.zoom };
    bearing = next.bearing ?? bearing;
    invalidateChangeAssist();
  }

  function onSurfaceBearing(which, next) {
    bearing = next.bearing;
  }

  function swapSides() {
    const left = sideSpec(a, s2a, wba);
    const right = sideSpec(b, s2b, wbb);
    applySide(a, s2a, wba, right);
    applySide(b, s2b, wbb, left);
    annotations = annotations.map((mark) => ({ ...mark, side: mark.side === 'a' ? 'b' : mark.side === 'b' ? 'a' : 'both' }));
    invalidateChangeAssist();
  }

  function startPreset(preset) {
    a.providerId = preset.a;
    b.providerId = preset.b;
    a.present = true;
    b.present = true;
  }

  function visitZone(zone) {
    if (!changeResult) return;
    const frame = changeResult.frame;
    const [lon, lat] = fromMercator(...apply(screenToMercator(frame),
      zone.centre.x * frame.width, zone.centre.y * frame.height));
    activeEngine()?.setView({ lat, lon }, view.zoom);
  }

  function chooseProvider(provider) {
    if (!picking || provider.needs_key) return;
    const target = side(picking);
    target.providerId = provider.id;
    target.refused = false;
    target.present = true;
    picking = null;
  }

  function remove(which) {
    const target = side(which);
    target.present = false;
    target.providerId = FALLBACK_PROVIDER;
    target.ready = false;
    target.refused = false;
    target.engine = null;
    target.element = null;
    target.overlays = [];
    target.firms = freshFirms();
    target.night = freshNight();
    mode = 'side';
  }

  // Compare owns the same Google-Earth style gesture as Satellite. Either map
  // can lead; its live camera is bound to the other surface immediately.
  $effect(() => {
    const pairs = [
      { which: 'a', element: a.element, engine: a.engine },
      { which: 'b', element: b.element, engine: b.engine },
    ].filter((entry) => entry.element && entry.engine);
    const listeners = pairs.map((entry) => {
      const down = (event) => {
        const shiftDrag = event.button === 0 && event.shiftKey;
        if (event.button !== 1 && !shiftDrag) return;
        startRotateDrag(entry.engine, event, {
          onPivot: ({ x, y }) => (rotating = { which: entry.which, x, y }),
          onEnd: () => (rotating = null),
        });
      };
      entry.element.addEventListener('mousedown', down, true);
      return () => entry.element.removeEventListener('mousedown', down, true);
    });
    return () => listeners.forEach((release) => release());
  });

  // A layout change changes both map containers. MapLibre must be told after
  // the browser has laid the new rectangles out, or tiles keep the old size.
  $effect(() => {
    mode;
    soloStage;
    stageMode;
    a.present;
    b.present;
    void tick().then(() => {
      a.engine?.resize();
      b.engine?.resize();
      cameraLink?.align();
      // New rectangles, so the mask has to be placed against them again before
      // the next camera move would have done it.
      placeChangeMap();
      invalidateChangeAssist();
    });
  });

  // Tools stay mounted while hidden so their work survives a tab switch.
  $effect(() => {
    if (uiState.tool !== 'compare') return;
    imagery.refreshUsage();
    loadProviders();
    void tick().then(() => {
      a.engine?.resize();
      b.engine?.resize();
    });
  });

  $effect(() => {
    if (uiState.tool !== 'compare' || !uiState.openCompare || !imagery.providers.length) return;
    const name = uiState.openCompare;
    uiState.openCompare = null;
    requestOpenSession(name);
  });

  $effect(() => {
    if (imagery.providers.length && !imagery.find(a.providerId)) a.providerId = FALLBACK_PROVIDER;
    if (imagery.providers.length && !imagery.find(b.providerId)) b.providerId = FALLBACK_PROVIDER;
  });

  // Blink is an inspection aid, not an animation assembled from in-between
  // frames: it shows A or B whole, and pauses on A whenever the mode closes.
  $effect(() => {
    if (mode !== 'blink' || !both || uiState.tool !== 'compare') {
      blinkB = false;
      return;
    }
    if (blinkPaused) return;
    const timer = setInterval(() => (blinkB = !blinkB), blinkInterval);
    return () => clearInterval(timer);
  });

  let s2aPassTimer;
  let s2bPassTimer;
  let s2aLatestTimer;
  let s2bLatestTimer;
  let wbaChangesTimer;
  let wbbChangesTimer;

  $effect(() => {
    if (!a.present || !s2a.menuOpen || shownA.provider?.id !== SENTINEL_ID) return;
    s2a.month;
    s2a.placeKey;
    clearTimeout(s2aPassTimer);
    s2aPassTimer = setTimeout(() => s2a.loadPasses(), 600);
    return () => clearTimeout(s2aPassTimer);
  });
  $effect(() => {
    if (!b.present || !s2b.menuOpen || shownB.provider?.id !== SENTINEL_ID) return;
    s2b.month;
    s2b.placeKey;
    clearTimeout(s2bPassTimer);
    s2bPassTimer = setTimeout(() => s2b.loadPasses(), 600);
    return () => clearTimeout(s2bPassTimer);
  });
  $effect(() => {
    if (!a.ready || shownA.provider?.id !== SENTINEL_ID) return;
    view.lat;
    view.lon;
    s2a.maxcc;
    clearTimeout(s2aLatestTimer);
    s2aLatestTimer = setTimeout(() => s2a.resolveLatest().catch(() => {}), 900);
    return () => clearTimeout(s2aLatestTimer);
  });
  $effect(() => {
    if (!b.ready || shownB.provider?.id !== SENTINEL_ID) return;
    view.lat;
    view.lon;
    s2b.maxcc;
    clearTimeout(s2bLatestTimer);
    s2bLatestTimer = setTimeout(() => s2b.resolveLatest().catch(() => {}), 900);
    return () => clearTimeout(s2bLatestTimer);
  });
  $effect(() => {
    if (a.ready && shownA.provider?.id === WAYBACK_ID) wba.loadReleases();
  });
  $effect(() => {
    if (b.ready && shownB.provider?.id === WAYBACK_ID) wbb.loadReleases();
  });
  // Once a side's picker has been opened, its history follows the map, picker
  // open or not: both surfaces share one view, so both walk the same tile.
  $effect(() => {
    if (!wba.watching || shownA.provider?.id !== WAYBACK_ID) return;
    wba.here;
    clearTimeout(wbaChangesTimer);
    wbaChangesTimer = setTimeout(() => wba.follow(), 900);
    return () => clearTimeout(wbaChangesTimer);
  });
  $effect(() => {
    if (!wbb.watching || shownB.provider?.id !== WAYBACK_ID) return;
    wbb.here;
    clearTimeout(wbbChangesTimer);
    wbbChangesTimer = setTimeout(() => wbb.follow(), 900);
    return () => clearTimeout(wbbChangesTimer);
  });

  function activeEngine() {
    return a.engine ?? b.engine;
  }

  async function goTo() {
    const text = coordsText.trim();
    const engine = activeEngine();
    if (!text || searching || !engine) return;
    searching = true;
    try {
      try {
        const parsed = await api.post('/api/geo/parse', { text });
        engine.setView(parsed, Math.max(engine.getZoom(), 16));
        return;
      } catch {
        /* not coordinates: ask the geocoder below */
      }
      const place = await api.get(`/api/geo/geocode?q=${encodeURIComponent(text)}`);
      engine.setView(place, Math.max(engine.getZoom(), 13));
      if (place.display_name) toast(place.display_name, 'info', 5000);
    } catch {
      toast('No match. Try coordinates, DMS, MGRS, a plus code or a place name', 'danger');
    } finally {
      searching = false;
    }
  }

  function goToSuggestion(item) {
    const engine = activeEngine();
    if (!engine || !Number.isFinite(item.lat) || !Number.isFinite(item.lon)) return;
    engine.setView(item, item.zoom ?? Math.max(engine.getZoom(), 13));
  }

  async function onWidgetAuthFailure(provider) {
    try {
      await api.post(`/api/settings/keys/${provider.meter}/status`, {
        ok: false,
        detail: 'Google rejected the Maps JavaScript key (gm_authFailure)',
      });
    } catch {
      /* the toast still gives the result */
    }
    toast('Google rejected the key. Basemap disabled; see Settings', 'danger', 8000);
    await loadProviders();
  }

  function onWidgetFailed(which, provider, error) {
    toast(`Google Maps failed to load: ${error.message}`, 'danger', 6000);
    side(which).providerId = FALLBACK_PROVIDER;
  }

  function setMode(next) {
    if (next === 'change' && !changeStatus.ok) {
      toast(changeStatus.reason, 'warn', 6000);
      return;
    }
    mode = next;
    blinkPaused = false;
    // Leaving Detect must not leave the map armed to draw an area.
    if (next !== 'analysis') analyzerDrawing = 'select';
    if (next === 'change') {
      changeOptions.visible = true;
      if (!changeStatus.methods.includes(changeOptions.method)) changeOptions.method = changeStatus.methods[0];
      void refreshChangeAssist({ fetch: false });
    }
  }

  function setDividerAt(clientX) {
    const box = stageEl?.getBoundingClientRect();
    if (!box?.width) return;
    divider = percentage(((clientX - box.left) / box.width) * 100);
  }

  function startSwipe(event) {
    swiping = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDividerAt(event.clientX);
  }

  function moveSwipe(event) {
    if (swiping) setDividerAt(event.clientX);
  }

  function stopSwipe(event) {
    swiping = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function keySwipe(event) {
    if (event.key === 'ArrowLeft') divider = percentage(divider - 2);
    else if (event.key === 'ArrowRight') divider = percentage(divider + 2);
    else if (event.key === 'Home') divider = 0;
    else if (event.key === 'End') divider = 100;
    else return;
    event.preventDefault();
  }

  function sideSpec(target, sentinel, wayback) {
    return {
      present: target.present,
      provider: target.providerId,
      overlays: comparisonLayers(target.overlays),
      firms: { ...target.firms },
      nightlights: { ...target.night },
      sentinel: {
        layer: sentinel.layer,
        // A difference is only honest over named acquisitions. Freeze a live
        // "latest" pass to the date it meant when this workspace is saved.
        date: mode === 'change' ? sentinel.date || sentinel.latest : sentinel.date,
        maxcc: sentinel.maxcc,
      },
      wayback_release: wayback.release,
    };
  }

  function sessionSpec() {
    return {
      version: 2,
      camera: { lat: view.lat, lon: view.lon, zoom: view.zoom, bearing },
      // Detect is a place to work, not a way to read the pair: a comparison
      // reopened from My work shows the imagery, and its runs live in the case.
      mode: mode === 'analysis' ? 'side' : mode,
      divider,
      opacity,
      blink: { interval: blinkInterval },
      change_assist: changeSettings(changeOptions),
      annotations: comparisonAnnotations(annotations),
      frame: exportFrame,
      a: sideSpec(a, s2a, wba),
      b: sideSpec(b, s2b, wbb),
    };
  }

  function sessionSignature() {
    return JSON.stringify([sessionName.trim(), sessionSpec()]);
  }

  function requestSaveSession() {
    if (!both) return;
    if (openedSession) void performSessionSave();
    else saveDialog = true;
  }

  async function performSessionSave() {
    const title = sessionName.trim();
    if (!title || sessionBusy || !both) return;
    sessionBusy = true;
    try {
      const owner = await ensureCase();
      const savedSpec = sessionSpec();
      const result = await api.post(`/api/cases/${owner.id}/compare/sessions`, {
        rename_from: openedSession?.name ?? null,
        title,
        spec: savedSpec,
      });
      if (caseState.current?.id !== owner.id) return;
      sessionName = result.title;
      openedSession = { name: result.name, title: result.title };
      savedSignature = JSON.stringify([result.title, savedSpec]);
      saveDialog = false;
      let previewError = null;
      try {
        await saveWorkingPreview(owner.id, result.name);
      } catch (error) {
        previewError = error;
      }
      await reloadCase();
      if (previewError) {
        toast(`Comparison saved, but its preview could not update: ${previewError.message}`, 'warn', 7000);
      } else {
        toast(mode === 'blink'
          ? 'Comparison and animated preview saved to My work'
          : 'Comparison and preview saved to My work', 'ok');
      }
    } catch (error) {
      toast(`Could not save the comparison: ${error.message}`, 'danger', 6500);
    } finally {
      sessionBusy = false;
    }
  }

  async function openSessionList() {
    sessionDialog = true;
    sessionBusy = true;
    try {
      sessionList = caseState.current
        ? await api.get(`/api/cases/${caseState.current.id}/compare/sessions`)
        : [];
    } catch (error) {
      toast(`Could not read comparisons: ${error.message}`, 'danger');
    } finally {
      sessionBusy = false;
    }
  }

  function applySide(target, sentinel, wayback, saved) {
    const provider = imagery.find(saved?.provider) ? saved.provider : FALLBACK_PROVIDER;
    if (saved?.provider && provider !== saved.provider) {
      toast(`${saved.provider} is unavailable. Using ${imagery.find(provider)?.label ?? provider}`, 'warn');
    }
    target.providerId = provider;
    target.overlays = comparisonLayers(saved?.overlays);
    target.firms = {
      ...freshFirms(),
      ...(saved?.firms ?? {}),
    };
    target.night = {
      ...freshNight(),
      ...(saved?.nightlights ?? {}),
    };
    sentinel.layer = saved?.sentinel?.layer || sentinel.layer;
    sentinel.date = saved?.sentinel?.date || '';
    sentinel.setMaxcc(saved?.sentinel?.maxcc ?? 100);
    wayback.pick(saved?.wayback_release ?? null);
    target.present = Boolean(saved?.present);
    target.refused = false;
  }

  async function openSession(name) {
    if (!caseState.current || sessionBusy) return;
    const caseId = caseState.current.id;
    sessionBusy = true;
    sessionDialog = false;
    try {
      const saved = await api.get(
        `/api/cases/${caseId}/compare/sessions/${encodeURIComponent(name)}`
      );
      if (caseState.current?.id !== caseId) return;
      const spec = saved.spec ?? saved;
      view = {
        lat: spec.camera.lat,
        lon: spec.camera.lon,
        zoom: spec.camera.zoom,
      };
      bearing = spec.camera?.bearing ?? 0;
      mode = COMPARE_MODES.some((entry) => entry.id === spec.mode) ? spec.mode : 'side';
      divider = percentage(spec.divider, DEFAULT_DIVIDER);
      opacity = percentage(spec.opacity, DEFAULT_OPACITY);
      changeOptions = changeSettings(spec.change_assist);
      blinkInterval = spec.blink?.interval ?? 800;
      annotations = comparisonAnnotations(spec.annotations);
      exportFrame = exportFrameSpec(spec.frame);
      resetAnnotationHistory();
      applySide(a, s2a, wba, spec.a);
      applySide(b, s2b, wbb, spec.b);
      sessionName = saved.title || name;
      openedSession = { name, title: sessionName };
      await tick();
      // Existing surfaces do not rebuild when a session changes the shared
      // camera, so restore the saved view explicitly. Newly mounted surfaces
      // already receive this view as their opening camera.
      for (const target of [a, b]) {
        target.engine?.setView(view, view.zoom);
        target.engine?.setBearing(bearing);
      }
      a.engine?.resize();
      b.engine?.resize();
      savedSignature = sessionSignature();
      if (mode === 'change') void refreshChangeAssist({ fetch: false });
      toast(`Opened ${sessionName}`, 'ok');
    } catch (error) {
      toast(`Could not open the comparison: ${error.message}`, 'danger');
    } finally {
      sessionBusy = false;
    }
  }

  function requestOpenSession(name) {
    if (sessionDirty) {
      discardTarget = { kind: 'open', name };
      return;
    }
    void openSession(name);
  }

  async function deleteSession(name) {
    if (!caseState.current || sessionBusy) return;
    sessionBusy = true;
    try {
      const result = await api.del(
        `/api/cases/${caseState.current.id}/compare/sessions/${encodeURIComponent(name)}`
      );
      sessionList = sessionList.filter((entry) => entry.name !== name);
      if (openedSession?.name === name) {
        openedSession = null;
        savedSignature = null;
      }
      await reloadCase();
      deletedToast(caseState.current.id, result, name);
    } catch (error) {
      toast(`Could not delete the comparison: ${error.message}`, 'danger');
    } finally {
      sessionBusy = false;
    }
  }

  function newComparison() {
    a.present = false;
    b.present = false;
    a.overlays = [];
    b.overlays = [];
    a.firms = freshFirms();
    b.firms = freshFirms();
    a.night = freshNight();
    b.night = freshNight();
    mode = 'side';
    divider = DEFAULT_DIVIDER;
    opacity = DEFAULT_OPACITY;
    changeOptions = changeSettings();
    blinkInterval = 800;
    changeResult = null;
    changeUrl = '';
    changeRequest++;
    // Detect's areas and result layers belong to the comparison that drew them.
    analyzerZones = [];
    analyzerLayers = [];
    analyzerSelectedZone = null;
    analyzerDrawing = 'select';
    analyzerOpening = null;
    annotations = [];
    annotationTool = 'select';
    resetAnnotationHistory();
    exportFrame = null;
    framing = false;
    blinkPausedBeforeFraming = null;
    sessionName = 'Comparison';
    openedSession = null;
    savedSignature = null;
    rightPanel = null;
  }

  function requestNewComparison() {
    if (sessionDirty) {
      discardTarget = { kind: 'new' };
      return;
    }
    newComparison();
  }

  /**
   * Throw the edits away and keep the work: a comparison that was saved goes
   * back to the version on disk, one that never was goes back to empty. New
   * always wipes, which is why it is not an answer to "undo what I just did".
   */
  function requestDiscardChanges() {
    if (!sessionDirty || sessionBusy) return;
    discardTarget = openedSession
      ? { kind: 'revert', name: openedSession.name }
      : { kind: 'new' };
  }

  function confirmDiscard() {
    const target = discardTarget;
    discardTarget = null;
    if (target?.kind === 'new') newComparison();
    else if (target) void openSession(target.name);
  }

  function toggleLayer(target, layer) {
    if (!target.present) return;
    if (layer === 'firms' && !firesKeyed) return;
    if (layer === 'saved' && !savedWork.rows.length) return;
    target.overlays = target.overlays.includes(layer)
      ? target.overlays.filter((id) => id !== layer)
      : comparisonLayers([...target.overlays, layer]);
    invalidateChangeAssist();
  }

  function copyLayers(source, target) {
    if (!source.present || !target.present) return;
    target.overlays = [...source.overlays];
    target.firms = { ...source.firms };
    target.night = { ...source.night };
    invalidateChangeAssist();
  }

  function patchLayer(target, key, patch) {
    target[key] = { ...target[key], ...patch };
    invalidateChangeAssist();
  }

  async function toggleRightPanel(panel) {
    rightPanel = rightPanel === panel ? null : panel;
    if (rightPanel !== 'export') return;
    try {
      exportDestination = (await readDestinations()).views;
    } catch {
      exportDestination = '';
    }
  }

  const twoPaints = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  let changeTimer;
  let changeRenderedKey = $state('');
  const detectionKey = $derived(changeKey());

  const changeFrames = $derived(changeNeedsFrames(changeSettings(changeOptions), changeStatus));

  function changeKey() {
    const { opacity, base, visible, blink, zones, ...analysis } = changeSettings(changeOptions);
    return JSON.stringify([
      changeSide(a, s2a, wba, shownA),
      changeSide(b, s2b, wbb, shownB),
      view,
      bearing,
      analysis,
    ]);
  }

  function invalidateChangeAssist() {
    changeRenderedKey = '';
    if (mode !== 'change') return;
    // A reading that follows the camera never spends a request: it runs on the
    // band frames already held, and waits for Run when they no longer reach.
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => void refreshChangeAssist({ fetch: false }), 180);
  }

  async function refreshChangeAssist({ fetch = true } = {}) {
    if (mode !== 'change' || !changeStatus.ok) return;
    if (!changeStatus.methods.includes(changeOptions.method)) { changeError = 'Choose a compatible method'; return; }
    const key = changeKey();
    if (key === changeRenderedKey && changeResult) return;
    const settings = changeSettings(changeOptions);
    const sides = [changeSide(a, s2a, wba, shownA), changeSide(b, s2b, wbb, shownB)];
    const request = ++changeRequest;
    changeBusy = true;
    changeError = '';
    try {
      await tick();
      await twoPaints();
      if (request !== changeRequest || key !== changeKey()) return;
      const sources = await sourceCanvases();
      if (request !== changeRequest || key !== changeKey()) return;
      const result = await detectCaptures(sources, settings, sides, changeStatus, fetch);
      if (request !== changeRequest || mode !== 'change' || key !== changeKey()) return;
      // Nothing held reaches this view: the last reading stays up, marked out
      // of date, until the analyst asks for the frames.
      if (result.needsFetch) return;
      changeResult = result;
      placeChangeMap();
      changeUrl = result.canvas.toDataURL('image/png');
      changeRenderedKey = key;
    } catch (error) {
      if (request !== changeRequest) return;
      changeResult = null;
      changeUrl = '';
      changeError = error?.message ?? 'Could not compare these pixels';
    } finally {
      if (request === changeRequest) changeBusy = false;
    }
  }

  $effect(() => {
    if (mode !== 'change' || uiState.tool !== 'compare') { changeRequest++; return; }
    if (!changeStatus.ok) {
      changeRequest += 1;
      changeResult = null;
      changeUrl = '';
      changeError = changeStatus.reason;
      changeBusy = false;
      return;
    }
    detectionKey;
    changeRequest++;
    changeBusy = false;
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => void refreshChangeAssist({ fetch: false }), 180);
    return () => clearTimeout(changeTimer);
  });

  const selectedAnnotation = $derived(
    annotations.find((mark) => mark.id === selectedAnnotationId) ?? null
  );

  function setAnnotations(next, commit = true) {
    if (next.length > 200) { toast('A comparison can hold up to 200 annotations', 'warn'); return; }
    const normal = comparisonAnnotations(next);
    if (!commit && annotationPreviewBase === null) {
      annotationPreviewBase = JSON.stringify(annotations);
    }
    if (commit) {
      const before = annotationPreviewBase ?? JSON.stringify(annotations);
      const after = JSON.stringify(normal);
      if (before !== after) {
        annotationUndo = [...annotationUndo.slice(-59), before];
        annotationRedo = [];
      }
      annotationPreviewBase = null;
    }
    annotations = normal;
  }

  function undoAnnotation() {
    const snapshot = annotationUndo.at(-1);
    if (snapshot == null) return;
    annotationRedo = [...annotationRedo, JSON.stringify(annotations)];
    annotationUndo = annotationUndo.slice(0, -1);
    annotations = comparisonAnnotations(JSON.parse(snapshot));
    selectedAnnotationId = null;
  }

  function redoAnnotation() {
    const snapshot = annotationRedo.at(-1);
    if (snapshot == null) return;
    annotationUndo = [...annotationUndo, JSON.stringify(annotations)];
    annotationRedo = annotationRedo.slice(0, -1);
    annotations = comparisonAnnotations(JSON.parse(snapshot));
    selectedAnnotationId = null;
  }

  function patchSelectedAnnotation(patch) {
    if (!selectedAnnotation) return;
    setAnnotations(annotations.map((mark) =>
      mark.id === selectedAnnotation.id ? { ...mark, ...patch } : mark
    ));
  }

  function setAnnotationColour(value) {
    annotationColour = value;
    if (selectedAnnotation) patchSelectedAnnotation({ colour: value });
  }

  function setAnnotationStroke(value) {
    if (selectedAnnotation?.kind === 'text') {
      patchSelectedAnnotation({ font_size: value });
    } else if (selectedAnnotation) {
      patchSelectedAnnotation({ stroke_width: value });
    } else {
      annotationStroke = value;
    }
  }

  function setAnnotationFill(value) {
    annotationFill = value;
    if (selectedAnnotation && canFill(selectedAnnotation.kind)) {
      patchSelectedAnnotation({ fill_opacity: value });
    }
  }

  function resetAnnotationHistory() {
    annotationUndo = [];
    annotationRedo = [];
    annotationPreviewBase = null;
    selectedAnnotationId = null;
  }

  $effect(() => {
    if (!both || uiState.tool !== 'compare') return;
    const shortcuts = { v: 'select', r: 'rect', e: 'ellipse', a: 'arrow', l: 'line', d: 'freehand', t: 'text', p: 'polygon', m: 'measure' };
    const onKey = (event) => {
      if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      const key = event.key.toLowerCase();
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        const reading = COMPARE_MODES.find((entry) => entry.key === key);
        if (reading) { setMode(reading.id); return; }
        if (key === ' ' && mode === 'blink') { event.preventDefault(); blinkPaused = !blinkPaused; return; }
      }
      if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoAnnotation();
        else undoAnnotation();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'y') {
        event.preventDefault();
        redoAnnotation();
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedAnnotationId) {
        event.preventDefault();
        setAnnotations(annotations.filter((mark) => mark.id !== selectedAnnotationId));
        selectedAnnotationId = null;
        return;
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey && shortcuts[key]) {
        annotationTool = shortcuts[key];
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // --- the right-click menu: acts on the point under the cursor -------------
  //
  // Satellite's menu, cut down to what Compare can honour. There is no measure
  // rail and no sun panel here, so those acts are left out rather than shown
  // dead; the measure is the annotation of the same name, started on the point
  // instead of on a drag that would have to begin somewhere else. The camera is
  // shared, so the menu belongs to the side it was opened on and nothing else.
  let pointMenu = $state(null); // { side, lat, lon, x, y, frame, lookup }
  let pointLookupSeq = 0;
  let canvasA = $state(null);
  let canvasB = $state(null);
  const pointActions = $derived(
    actionsFor(both && !detecting ? ['lookup', 'place', 'measure'] : ['lookup', 'place'])
  );

  function onMapContextMenu(side, at) {
    pointLookupSeq += 1;
    const element = (side === 'a' ? a : b).element;
    pointMenu = {
      ...at,
      side,
      frame: { width: element?.clientWidth ?? 0, height: element?.clientHeight ?? 0 },
      lookup: null,
    };
  }

  function closePointMenu() {
    pointLookupSeq += 1;
    pointMenu = null;
  }

  async function onPointMenu(id, value) {
    if (!pointMenu) return;
    const point = { lat: pointMenu.lat, lon: pointMenu.lon };
    if (id === 'lookup') return lookUpPoint(point);
    const { side } = pointMenu;
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
    } else if (id === 'measure') {
      annotationTool = 'measure';
      await tick();
      (side === 'a' ? canvasA : canvasB)?.startFrom([point.lon, point.lat]);
      toast('Click the far end of the measure', 'info', 4000);
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
    if (!pointMenu) return;
    return (pointMenu.side === 'a' ? a.engine : b.engine)?.on('view-settled', closePointMenu);
  });

  // --- saving a place from the menu ----------------------------------------
  let placeModal = $state(null);
  let placeSaving = $state(false);

  /** The same dialog Satellite opens, on the point that was right-clicked. */
  function openNewPlaceAt({ lat, lon }) {
    placeModal = {
      id: null,
      title: '',
      notes: '',
      folder: '',
      lat,
      lon,
      zoom: Math.round(view.zoom),
      bearing,
      relation: null, // collected by the dialog, filed once the place exists
    };
  }

  const placeCoordsLabel = (mark) => fmtCoords(mark.lat, mark.lon);

  async function savePlaceModal() {
    if (!placeModal || placeSaving) return;
    placeSaving = true;
    try {
      const draft = placeModal;
      const owner = await ensureCase();
      const entity = await api.post(`/api/cases/${owner.id}/satellite/place`, {
        lat: draft.lat,
        lon: draft.lon,
        zoom: draft.zoom,
        bearing: draft.bearing,
        title: draft.title,
        notes: draft.notes,
        folder: draft.folder,
      });
      // The relation is filed last: it needs a place that exists, and saving the
      // point is worth keeping even if the edge is refused.
      if (draft.relation && entity?.id) await saveRelation(owner.id, entity.id, draft.relation);
      placeModal = null;
      await reloadCase();
      await savedWork.load(owner.id);
      toast('Place saved', 'ok', 1600);
    } catch (error) {
      toast(`Could not save place: ${error.message}`, 'danger', 6000);
    } finally {
      placeSaving = false;
    }
  }

  function changeShare(counts) {
    if (!counts) return 0;
    const changed = counts.gained + counts.lost + counts.changed;
    const total = changed + counts.quiet;
    return total ? Math.round((changed / total) * 100) : 0;
  }

  async function capturedSurface(which) {
    captureSide = which;
    await twoPaints();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const dataUrl = await captureTab();
    const image = new window.Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('the extension returned an unreadable frame'));
      image.src = dataUrl;
    });
    if (!isRegistered(
      image.naturalWidth,
      image.naturalHeight,
      window.innerWidth,
      window.innerHeight
    )) {
      throw new Error('the captured frame does not match this browser view. Try again');
    }
    const rect = side(which).element?.getBoundingClientRect();
    const crop = rect && sourceRect(
      { x: 0, y: 0, w: rect.width, h: rect.height },
      {
        mapRect: rect,
        viewportWidth: window.innerWidth,
        videoWidth: image.naturalWidth,
        videoHeight: image.naturalHeight,
      }
    );
    if (!crop) throw new Error('the map runs outside the captured browser area');
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(crop.sw);
    canvas.height = Math.round(crop.sh);
    const context = canvas.getContext('2d');
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      image,
      crop.sx,
      crop.sy,
      crop.sw,
      crop.sh,
      0,
      0,
      canvas.width,
      canvas.height
    );
    return canvas;
  }

  async function sourceCanvases() {
    if (!both || !a.ready || !b.ready) {
      throw new Error('both maps must be ready before they can be exported');
    }
    if (!hasWidget) {
      const frames = [surfaceFrame(a), surfaceFrame(b)];
      const captures = await Promise.all([a.engine.snapshot(), b.engine.snapshot()]);
      if (captures.some((capture) => !capture.complete)) throw new Error('Some tiles are still loading. Try again');
      if ([a, b].some((target, index) => JSON.stringify(surfaceFrame(target)) !== JSON.stringify(frames[index]))) {
        throw new Error('The map moved during capture. Settle it and try again');
      }
      return { a: { canvas: captures[0].canvas, frame: frames[0] }, b: { canvas: captures[1].canvas, frame: frames[1] } };
    }
    if (!extensionVersion()) {
      throw new Error('Google imagery needs the Azimut Capture extension. Install it in Settings');
    }
    grabbing = true;
    try {
      return { a: { canvas: await capturedSurface('a'), frame: surfaceFrame(a) },
        b: { canvas: await capturedSurface('b'), frame: surfaceFrame(b) } };
    } finally {
      captureSide = null;
      grabbing = false;
    }
  }

  /** The captured surfaces as the export shows them: whole, or cut to the frame. */
  async function exportSources() {
    return cropSources(await sourceCanvases(), exportFrame);
  }

  /** The frame stated as the ground it covers, which no camera can change. */
  function frameLabel(value) {
    const span = frameSpan(value.points, bearing);
    return `${formatDistance(span.width, prefs.units)} × ${formatDistance(span.height, prefs.units)}`;
  }

  function startFraming() {
    rightPanel = null;
    framing = true;
    if (mode === 'blink') {
      blinkPausedBeforeFraming = blinkPaused;
      blinkPaused = true;
    }
  }

  function finishFraming() {
    framing = false;
    if (blinkPausedBeforeFraming !== null) {
      blinkPaused = blinkPausedBeforeFraming;
      blinkPausedBeforeFraming = null;
    }
    rightPanel = 'export';
  }

  function setExportFrame(next) {
    exportFrame = next;
    finishFraming();
  }

  function compose(
    sources,
    { renderMode = captureMode, renderBlinkB = blinkB, renderChangeMap = changeResult } = {}
  ) {
    const provenanceA = a.surface?.provenance?.() ?? {};
    const provenanceB = b.surface?.provenance?.() ?? {};
    const dated = (label, date) => (date ? `${label} · ${date}` : label);
    return composeComparison({
      a: sources.a,
      b: sources.b,
      mode: renderMode,
      divider,
      opacity,
      change: renderChangeMap ? { ...renderChangeMap, ...changeSettings(changeOptions) } : null,
      title: sessionName,
      units: prefs.units,
      blinkB: renderBlinkB,
      annotations,
      labelA: dated(labelA, provenanceA.imageryDate),
      labelB: dated(labelB, provenanceB.imageryDate),
      attributionA: shownA.provider?.attribution,
      attributionB: shownB.provider?.attribution,
      view,
      bearing,
    });
  }

  async function comparisonBlob() {
    if (mode === 'change' && !changeStatus.ok) throw new Error(changeStatus.reason);
    if (mode === 'change' && (changeRenderedKey !== changeKey() || !changeResult)) {
      clearTimeout(changeTimer);
      await refreshChangeAssist({ fetch: changeFrames !== '' });
    }
    const sources = await exportSources();
    if (mode === 'change' && (changeRenderedKey !== changeKey() || !changeResult)) {
      throw new Error('Run Difference for this view before exporting');
    }
    const renderChangeMap = mode === 'change' ? changeResult : null;
    return canvasBlob(compose(sources, { renderChangeMap }));
  }

  async function saveWorkingPreview(caseId, name) {
    const form = new FormData();
    if (mode === 'blink') {
      const sources = await exportSources();
      const frameA = await canvasBlob(compose(sources, { renderMode: 'blink', renderBlinkB: false }));
      const frameB = await canvasBlob(compose(sources, { renderMode: 'blink', renderBlinkB: true }));
      form.append('image_a', frameA, 'comparison-a.png');
      form.append('image_b', frameB, 'comparison-b.png');
      form.append('format', 'blink');
      form.append('interval', String(blinkInterval));
    } else {
      form.append('image_a', await comparisonBlob(), 'comparison.png');
      form.append('format', 'png');
    }
    return api.post(
      `/api/cases/${caseId}/compare/sessions/${encodeURIComponent(name)}/preview`,
      form,
    );
  }

  function outputError(action, error) {
    if (error?.needsActivation) {
      toast(
        'One-time step: click the Azimut Capture icon or press Alt+Shift+A, then try again',
        'warn',
        10000
      );
      return;
    }
    toast(`${action}: ${error.message}`, 'danger', 7000);
  }

  async function exportPng() {
    if (outputBusy) return;
    outputBusy = 'png';
    try {
      const owner = await ensureCase();
      const blob = await comparisonBlob();
      const result = await api.post(`/api/cases/${owner.id}/plates`, {
        filename: comparisonFilename(),
        format: 'png',
        png: await blobBase64(blob),
      });
      rightPanel = null;
      toast(`${result.file} written to ${destinationLabel(result.path)}`, 'ok', 5200, {
        label: 'Show',
        onClick: () => showExports(),
      });
    } catch (error) {
      outputError('PNG export failed', error);
    } finally {
      outputBusy = '';
    }
  }

  async function exportGif(animation) {
    if (outputBusy) return;
    outputBusy = 'gif';
    try {
      const owner = await ensureCase();
      const sources = await exportSources();
      const frameA = await canvasBlob(compose(sources, { renderMode: 'blink', renderBlinkB: false }));
      const frameB = await canvasBlob(compose(sources, { renderMode: 'blink', renderBlinkB: true }));
      const form = new FormData();
      form.append('image_a', frameA, 'comparison-a.png');
      form.append('image_b', frameB, 'comparison-b.png');
      form.append('animation', animation);
      form.append('interval', String(blinkInterval));
      form.append('filename', comparisonFilename());
      const result = await api.post(`/api/cases/${owner.id}/compare/gif`, form);
      rightPanel = null;
      toast(`${result.file} written to ${destinationLabel(result.path)}`, 'ok', 5200, {
        label: 'Show',
        onClick: () => showExports(),
      });
    } catch (error) {
      outputError('GIF export failed', error);
    } finally {
      outputBusy = '';
    }
  }

  async function runExport() {
    if (exportKind === 'png') await exportPng();
    else await exportGif(exportKind);
  }

  async function showExports() {
    if (!caseState.current) return;
    try {
      await api.post(`/api/cases/${caseState.current.id}/plates/reveal`);
    } catch (error) {
      toast(`Could not open the export folder: ${error.message}`, 'warn');
    }
  }

  async function copyComparison() {
    if (outputBusy) return;
    outputBusy = 'copy';
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
        throw new Error('this browser cannot copy an image');
      }
      const blob = await comparisonBlob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('Comparison copied as an image', 'ok');
    } catch (error) {
      outputError('Could not copy the comparison', error);
    } finally {
      outputBusy = '';
    }
  }
</script>

<div class="tool compare-tool" inert={sessionBusy}>
  <div class="tool-header">
    <h2>Compare</h2>
    {#if a.present || b.present}
      <input
        class="input session-title"
        bind:value={sessionName}
        maxlength="200"
        aria-label="Comparison name"
        onkeydown={(event) => event.key === 'Enter' && requestSaveSession()}
      />
      {#if sessionDirty}<span class="badge">unsaved</span>{/if}
    {:else}
      <span class="sub">Two imagery views, one shared camera</span>
    {/if}
    <div class="spacer"></div>
    {#if a.present || b.present}
      <PlaceSearch
        bind:value={coordsText}
        savedRows={[]}
        centre={activeView}
        units={prefs.units}
        {searching}
        listId="compare-suggestions"
        onpick={goToSuggestion}
        onsubmit={goTo}
      />
    {/if}
    <button class="btn btn-sm" onclick={openSessionList} disabled={!caseState.current || sessionBusy} title="Open a saved comparison">
      <Icon name="folderOpen" size={13} /> Open
    </button>
    {#if a.present || b.present}
      <button
        class="btn btn-sm"
        onclick={requestDiscardChanges}
        disabled={!sessionDirty || sessionBusy}
        title={openedSession ? 'Go back to the saved version' : 'Throw this comparison away'}
      >
        <Icon name="undo" size={13} /> Discard
      </button>
      <button class="btn btn-sm" onclick={requestNewComparison} title="Start a new comparison">
        <Icon name="plus" size={13} /> New
      </button>
    {/if}
    <button
      class="btn btn-primary btn-sm"
      onclick={requestSaveSession}
      disabled={!both || sessionBusy || !sessionDirty}
      title="Keep this editable comparison in My work"
    >
      <Icon name="save" size={13} /> {sessionBusy ? 'Saving…' : 'Save comparison'}
    </button>
  </div>

  {#if both}
    <div class="compare-bar">
      <ModeDock {mode} change={changeStatus} onmode={setMode} onswap={swapSides} />
      <div class="spacer"></div>
      <span class="camera-readout mono">z{Number(view.zoom).toFixed(1)}</span>
      <!-- One camera, so one compass: it turns both maps and resets them. -->
      <Compass {bearing} onbearing={(deg) => primeEngine?.setBearing(deg)} />
      <button class="btn btn-sm" onclick={() => toggleRightPanel('export')} disabled={!a.ready || !b.ready || !!outputBusy}>
        <Icon name="download" size={13} /> Export
      </button>
    </div>
  {/if}
  {#if !a.present && !b.present}
    <div class="presets">
      {#each availablePresets(imagery.providers) as preset}
        <button class="btn btn-sm" title={preset.hint} onclick={() => startPreset(preset)}>{preset.label}</button>
      {/each}
    </div>
  {/if}
  <div class="compare-workspace">
  {#if both && !detecting}
    <AnnotationToolbar
      bind:tool={annotationTool}
      selected={selectedAnnotation}
      canUndo={annotationUndo.length > 0}
      canRedo={annotationRedo.length > 0}
      undo={undoAnnotation}
      redo={redoAnnotation}
      palette={ANNOTATION_COLOURS}
      colour={annotationColour}
      strokeWidth={annotationStroke}
      fillOpacity={annotationFill}
      setColour={setAnnotationColour}
      setStroke={setAnnotationStroke}
      setFill={setAnnotationFill}
      bind:side={annotationSide}
      setSide={(value) => { annotationSide = value; if (selectedAnnotation) patchSelectedAnnotation({ side: value }); }}
      removeSelected={() => {
        if (selectedAnnotationId) setAnnotations(annotations.filter((mark) => mark.id !== selectedAnnotationId));
        selectedAnnotationId = null;
      }}
      clear={() => { setAnnotations([]); selectedAnnotationId = null; }}
      count={annotations.length}
    />
  {/if}

  <!-- The cards ride over the stage, not over the tool: the annotation rail on
       the left and a computing panel on the right both narrow the stage, and a
       full-width bar put the seam between the cards tens of pixels away from
       the seam between the maps.
       Detect owns the imagery while it is on, so the cards would be a second
       place to choose the same thing. One choice, one place. -->
  <div class="stage-column">
  {#if (a.present || b.present) && !detecting}
    <div class="source-bar" aria-label="Compared imagery">
      {#if a.present}
        <SourceCard letter="A" {imagery} bind:providerId={a.providerId} s2={s2a} wayback={wba}
          shown={shownA} dated={a.dated} layerCount={a.overlays.length} layersOpen={rightPanel === 'layers'}
          onlayers={() => toggleRightPanel('layers')} onremove={() => remove('a')} />
      {:else}<button class="source-add" onclick={() => (picking = 'a')}>A · Add imagery</button>{/if}
      {#if b.present}
        <SourceCard letter="B" {imagery} bind:providerId={b.providerId} s2={s2b} wayback={wbb}
          shown={shownB} dated={b.dated} align="right" layerCount={b.overlays.length} layersOpen={rightPanel === 'layers'}
          onlayers={() => toggleRightPanel('layers')} onremove={() => remove('b')} />
      {:else}<button class="source-add" onclick={() => (picking = 'b')}>B · Add imagery</button>{/if}
    </div>
  {/if}
  <div
    class="compare-stage"
    class:overlay={both && stageMode !== 'side'}
    class:swipe={both && stageMode === 'swipe'}
    class:blended={both && stageMode === 'opacity'}
    class:change={both && stageMode === 'change'}
    class:base-a={both && stageMode === 'change' && changeBase === 'a'}
    class:base-b={both && stageMode === 'change' && changeBase === 'b'}
    class:solo={soloStage}
    class:capturing={grabbing}
    class:capture-a={captureSide === 'a'}
    class:capture-b={captureSide === 'b'}
    style:--divider={`${divider}%`}
    style:--opacity={opacity / 100}
    style:--change-opacity={changeOpacity / 100}
    bind:this={stageEl}
  >
    {#if a.present && home}
      <div class="surface-shell primary">
        <div class="surface-label"><strong>A</strong></div>
        <MapSurface
          bind:this={a.surface}
          bind:engine={a.engine}
          bind:element={a.element}
          {view}
          {bearing}
          bind:ready={a.ready}
          bind:refused={a.refused}
          bind:dated={a.dated}
          bind:providerId={a.providerId}
          {imagery}
          s2={s2a}
          wayback={wba}
          {home}
          resetToHome={false}
          imperial={prefs.units === 'imperial'}
          controlsTop={54}
          chrome={false}
          {zoomCeiling}
          {grabbing}
          overlays={surfaceOverlays(a)}
          onusage={() => imagery.refreshUsage()}
          onwidgetload={(meter) => imagery.countLoad(meter)}
          onwidgetauthfailure={onWidgetAuthFailure}
          onwidgetfailed={(provider, error) => onWidgetFailed('a', provider, error)}
          onviewsettled={(next) => onSurfaceSettled('a', next)}
          onbearingchange={(next) => onSurfaceBearing('a', next)}
          oncontextmenu={(at) => onMapContextMenu('a', at)}
        >
          {#if pointMenu?.side === 'a'}
            <MapContextMenu
              at={pointMenu}
              frame={pointMenu.frame}
              zoom={view.zoom}
              format={prefs.coordFormat}
              actions={pointActions}
              lookup={pointMenu.lookup}
              onpick={onPointMenu}
              onclose={closePointMenu}
            />
          {/if}
          {#if a.overlays.includes('saved')}
            <SavedOverlay
              engine={a.engine}
              items={savedWork.rows}
              caseId={caseState.current?.id}
              coords={savedCoords}
              onopen={openSaved}
              onedit={openSaved}
              onrefresh={reloadCase}
            />
          {/if}
        </MapSurface>
        <!-- The mask is ground, not screen: it is laid on each map through that
             map's own frame, so "Both" shows one reading over two pictures. -->
        {#if both && mode === 'change' && changeUrl && changeVisible}
          <img class="change-map" src={changeUrl} alt="Pixel-change heatmap over imagery A"
            style:width={`${changeResult.frame.width}px`} style:height={`${changeResult.frame.height}px`}
            style:transform={changeTransform.a} />
        {/if}
        <!-- Side by side has two coordinate spaces, so A owns the editable
             frame and B shows the matching ground read-only. -->
        {#if both && !grabbing && !detecting && stageMode === 'side' && (framing || exportFrame)}
          <ExportFrame engine={a.engine} frame={exportFrame} drawing={framing} units={prefs.units} {bearing}
            onframe={setExportFrame} oncancel={finishFraming} />
        {/if}
        {#if both && !grabbing && !detecting}
          <AnnotationCanvas bind:this={canvasA} {annotations} engine={a.engine} letter="a" units={prefs.units}
            active={uiState.tool === 'compare'} bind:tool={annotationTool} bind:selectedId={selectedAnnotationId}
            colour={annotationColour} strokeWidth={annotationStroke} fillOpacity={annotationFill}
            editVertices={true} {annotationSide} onchange={setAnnotations} />
        {/if}
        <!-- Detect's own drawing stays in Detect: areas and candidates belong
             to the column that explains them, and the reading modes stay clean
             pictures. A kept candidate is a pin, and pins are shown by Saved. -->
        {#if detecting && !grabbing && analyzerLayers.some((layer) => layer.visible)}
          <AnalysisOverlay engine={a.engine} layers={analyzerLayers} selected={analyzerResult}
            onpick={(run, result) => analyzerPanel?.pick(run, result)} />
        {/if}
        {#if detecting && !grabbing && analyzerAreasVisible}
          <AnnotationCanvas annotations={analyzerMarks} engine={a.engine} letter="a" editVertices={true} edgeOnly={true}
            bind:tool={analyzerDrawing} bind:selectedId={analyzerSelectedZone} colour="#38bdf8"
            fillOpacity={0.08} onchange={setAnalyzerMarks} />
        {/if}
        {#if rotating?.which === 'a'}
          <div class="rotate-pivot" style:left={`${rotating.x}px`} style:top={`${rotating.y}px`} aria-hidden="true"></div>
        {/if}
      </div>
    {:else}
      <button class="empty-slot" onclick={() => (picking = 'a')} disabled={!home}>
        <span class="slot-letter">A</span>
        <Icon name="plus" size={22} />
        <strong>Add imagery</strong>
        <span>Choose a provider, then its date.</span>
      </button>
    {/if}

    {#if b.present && home}
      <div
        class="surface-shell secondary"
        class:blink-hidden={mode === 'blink' && !blinkB}
      >
        <div class="surface-label"><strong>B</strong></div>
        <MapSurface
          bind:this={b.surface}
          bind:engine={b.engine}
          bind:element={b.element}
          {view}
          {bearing}
          bind:ready={b.ready}
          bind:refused={b.refused}
          bind:dated={b.dated}
          bind:providerId={b.providerId}
          {imagery}
          s2={s2b}
          wayback={wbb}
          {home}
          resetToHome={false}
          imperial={prefs.units === 'imperial'}
          controlsTop={54}
          chrome={false}
          {zoomCeiling}
          {grabbing}
          overlays={surfaceOverlays(b)}
          onusage={() => imagery.refreshUsage()}
          onwidgetload={(meter) => imagery.countLoad(meter)}
          onwidgetauthfailure={onWidgetAuthFailure}
          onwidgetfailed={(provider, error) => onWidgetFailed('b', provider, error)}
          onviewsettled={(next) => onSurfaceSettled('b', next)}
          onbearingchange={(next) => onSurfaceBearing('b', next)}
          oncontextmenu={(at) => onMapContextMenu('b', at)}
        >
          {#if pointMenu?.side === 'b'}
            <MapContextMenu
              at={pointMenu}
              frame={pointMenu.frame}
              zoom={view.zoom}
              format={prefs.coordFormat}
              actions={pointActions}
              lookup={pointMenu.lookup}
              onpick={onPointMenu}
              onclose={closePointMenu}
            />
          {/if}
          {#if b.overlays.includes('saved')}
            <SavedOverlay
              engine={b.engine}
              items={savedWork.rows}
              caseId={caseState.current?.id}
              coords={savedCoords}
              onopen={openSaved}
              onedit={openSaved}
              onrefresh={reloadCase}
            />
          {/if}
        </MapSurface>
        {#if both && mode === 'change' && changeUrl && changeVisible}
          <img class="change-map" src={changeUrl} alt="Pixel-change heatmap over imagery B"
            style:width={`${changeResult.frame.width}px`} style:height={`${changeResult.frame.height}px`}
            style:transform={changeTransform.b} />
        {/if}
        {#if both && !grabbing && !detecting && stageMode === 'side' && exportFrame}
          <ExportFrame engine={b.engine} frame={exportFrame} readonly={true} units={prefs.units} {bearing} />
        {/if}
        {#if both && !grabbing && !detecting}
          <AnnotationCanvas bind:this={canvasB} {annotations} engine={b.engine} letter="b" units={prefs.units}
            active={uiState.tool === 'compare'} bind:tool={annotationTool} bind:selectedId={selectedAnnotationId}
            colour={annotationColour} strokeWidth={annotationStroke} fillOpacity={annotationFill}
            editVertices={true} {annotationSide} onchange={setAnnotations} />
        {/if}
        {#if detecting && !grabbing && analyzerLayers.some((layer) => layer.visible)}
          <AnalysisOverlay engine={b.engine} layers={analyzerLayers} selected={analyzerResult}
            onpick={(run, result) => analyzerPanel?.pick(run, result)} />
        {/if}
        {#if detecting && !grabbing && analyzerAreasVisible}
          <AnnotationCanvas annotations={analyzerMarks} engine={b.engine} letter="b" editVertices={true} edgeOnly={true}
            bind:tool={analyzerDrawing} bind:selectedId={analyzerSelectedZone} colour="#38bdf8"
            fillOpacity={0.08} onchange={setAnalyzerMarks} />
        {/if}
        {#if rotating?.which === 'b'}
          <div class="rotate-pivot" style:left={`${rotating.x}px`} style:top={`${rotating.y}px`} aria-hidden="true"></div>
        {/if}
      </div>
    {:else}
      <button class="empty-slot" onclick={() => (picking = 'b')} disabled={!home}>
        <span class="slot-letter">B</span>
        <Icon name="plus" size={22} />
        <strong>Add imagery</strong>
        <span>Choose a provider, then its date.</span>
      </button>
    {/if}

    {#if both && mode === 'swipe'}
      <button
        type="button"
        class="swipe-line"
        role="slider"
        aria-label="Swipe divider on imagery"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={divider}
        tabindex="0"
        onpointerdown={startSwipe}
        onpointermove={moveSwipe}
        onpointerup={stopSwipe}
        onpointercancel={stopSwipe}
        onkeydown={keySwipe}
      >
        <span class="swipe-handle" aria-hidden="true">
          <Icon name="chevronLeft" size={12} stroke={2.4} />
          <i></i>
          <Icon name="chevronRight" size={12} stroke={2.4} />
        </span>
      </button>
    {/if}

    <!-- Fade, Swipe, Blink and the single-image Difference layouts stack both
         maps in one coordinate space. Their frame therefore sits above the
         complete stage, where neither B nor the swipe clip can block it. -->
    {#if both && !grabbing && !detecting && stageMode !== 'side' && (framing || exportFrame)}
      <ExportFrame engine={a.engine} frame={exportFrame} drawing={framing} units={prefs.units} {bearing}
        onframe={setExportFrame} oncancel={finishFraming} />
    {/if}

    {#if both && mode === 'change'}
      <div class="change-legend" class:colourblind={changePalette === 'colourblind'} class:hidden={!changeOptions.visible}>
        <span><i class="gain"></i> Appeared / stronger in B</span>
        <span><i class="loss"></i> Disappeared / weaker from A</span>
        <span><i class="changed"></i> Other evolution</span>
        {#if changeBusy}<em>Analysing…</em>{:else if changeError}<em>{changeError}</em>{:else if changeCounts}<em>{changeShare(changeCounts)}% highlighted</em>{/if}
      </div>
    {/if}

 </div>
  </div>

  <!-- The two computing modes share this column, so where their settings live
       never depends on which one is on: the stage narrows, the maps stay whole
       and clickable, and the mode dock above is the only switch between them. -->
  {#if both && mode === 'change'}
    <ChangePanel bind:settings={changeOptions} status={changeStatus} result={changeResult}
      busy={changeBusy} error={changeError}
      stale={!!changeResult && changeRenderedKey !== detectionKey}
      onrun={() => refreshChangeAssist()} onzone={visitZone} onclose={() => setMode('side')} />
  {/if}
  {#if both && detecting}
    <AnalyzerPanel bind:this={analyzerPanel} caseId={caseState.current?.id}
      sources={{ a: sideSpec(a, s2a, wba), b: sideSpec(b, s2b, wbb) }}
      bind:zones={analyzerZones} bind:drawing={analyzerDrawing} bind:selectedZone={analyzerSelectedZone}
      bind:layers={analyzerLayers} bind:showZones={analyzerAreasVisible}
      bind:singleImage={analyzerSingle} bind:selectedResult={analyzerResult}
      opening={analyzerOpening} onfocus={focusAnalysis} onusecurrentview={useCurrentView}
      onsources={applyAnalysisSources} onclose={() => setMode('side')} />
  {/if}
  </div>

  {#if both && !FIND_MODES.includes(mode) && mode !== 'side'}
    <div class="mode-footer">
      <ModeControl {mode} bind:divider bind:opacity bind:blinkB bind:blinkPaused bind:blinkInterval />
    </div>
  {/if}
  {#if rightPanel === 'export'}
    <Modal title="Export a copy" onclose={() => (rightPanel = null)} width="540px">
      <div class="export-dialog">
        <div class="output-list">
          <label class="output-choice" class:selected={exportKind === 'png'}>
            <input type="radio" bind:group={exportKind} value="png" />
            <Icon name="image" size={17} />
            <span><strong>PNG</strong><small>The comparison exactly as it reads now.</small></span>
          </label>
          <label class="output-choice" class:selected={exportKind === 'blink'}>
            <input type="radio" bind:group={exportKind} value="blink" />
            <Icon name="play" size={17} />
            <span><strong>GIF · Blink</strong><small>Alternates the two complete views.</small></span>
          </label>
          <label class="output-choice" class:selected={exportKind === 'slide'}>
            <input type="radio" bind:group={exportKind} value="slide" />
            <Icon name="panelRight" size={17} />
            <span><strong>GIF · Slide</strong><small>Sweeps the divider across the image.</small></span>
          </label>
        </div>

        <div class="destination">
          <span class="field-label">Frame</span>
          <strong>{exportFrame ? frameLabel(exportFrame) : 'Full view'}</strong>
          <span class="destination-actions">
            <button type="button" class="link" onclick={startFraming}>{exportFrame ? 'Redraw…' : 'Draw…'}</button>
            {#if exportFrame}
              <button type="button" class="link muted" onclick={() => (exportFrame = null)}>Clear</button>
            {/if}
          </span>
        </div>

        <div class="destination">
          <span class="field-label">Destination</span>
          <strong title={exportDestination || CASE_FOLDER_LABEL}>
            {exportDestination === null ? 'Reading…' : destinationLabel(exportDestination)}
          </strong>
          <button class="link" onclick={() => (exportPicker = true)}>Change…</button>
        </div>

        {#if hasWidget}
          <p class="panel-note"><Icon name="info" size={13} /> Google pixels are captured through the Azimut Capture extension.</p>
        {/if}

        <div class="panel-actions">
          <button class="btn" disabled={!!outputBusy} onclick={copyComparison}>
            <Icon name="copy" size={13} /> {outputBusy === 'copy' ? 'Copying…' : 'Copy current PNG'}
          </button>
          <button class="btn btn-primary" disabled={!!outputBusy} onclick={runExport}>
            <Icon name="download" size={13} /> {outputBusy === 'png' || outputBusy === 'gif' ? 'Exporting…' : 'Export copy'}
          </button>
        </div>

        <button class="folder-open" onclick={showExports} disabled={!caseState.current}>
          <Icon name="folderOpen" size={13} /> Show export folder
        </button>
      </div>
    </Modal>
  {/if}

  {#if rightPanel === 'layers'}
    <Modal title="Layers · A / B" onclose={() => (rightPanel = null)} width="900px">
      <p class="panel-intro">Each side keeps its own layers. Use the eye to show one, or copy a complete stack across.</p>
      <div class="layer-columns">
        <LayerPane
          letter="A"
          present={a.present}
          layers={COMPARE_LAYERS}
          overlays={a.overlays}
          firms={a.firms}
          night={a.night}
          {firmsSensors}
          {firesKeyed}
          savedCount={savedWork.rows.length}
          ontoggle={(layer) => toggleLayer(a, layer)}
          onfirms={(patch) => patchLayer(a, 'firms', patch)}
          onnight={(patch) => patchLayer(a, 'night', patch)}
          oncopy={() => copyLayers(a, b)}
          onclear={() => { a.overlays = []; invalidateChangeAssist(); }}
        />
        <LayerPane
          letter="B"
          present={b.present}
          layers={COMPARE_LAYERS}
          overlays={b.overlays}
          firms={b.firms}
          night={b.night}
          {firmsSensors}
          {firesKeyed}
          savedCount={savedWork.rows.length}
          ontoggle={(layer) => toggleLayer(b, layer)}
          onfirms={(patch) => patchLayer(b, 'firms', patch)}
          onnight={(patch) => patchLayer(b, 'night', patch)}
          oncopy={() => copyLayers(b, a)}
          onclear={() => { b.overlays = []; invalidateChangeAssist(); }}
        />
      </div>
    </Modal>
  {/if}
</div>

{#if picking}
  <Modal title={`Add imagery ${picking.toUpperCase()}`} onclose={() => (picking = null)} width="520px">
    <p class="picker-lead">The first view sets the ground. Every view added after it opens on the same camera.</p>
    {#if catalogueError}
      <div class="picker-error">
        <span>{catalogueError}</span>
        <button class="btn btn-sm" onclick={loadProviders}>Retry</button>
      </div>
    {:else if !imagery.providers.length}
      <p class="picker-loading">Reading imagery providers…</p>
    {:else}
      {#each PROVIDER_KINDS as kind (kind.id)}
        {#if imagery.providers.some((entry) => providerKind(entry) === kind.id)}
          <h3 class="provider-kind">{kind.label}</h3>
      <div class="provider-grid">
        {#each imagery.providers.filter((entry) => providerKind(entry) === kind.id) as provider (provider.id)}
          <button
            class="provider-card"
            disabled={provider.needs_key}
            onclick={() => chooseProvider(provider)}
            title={provider.needs_key ? 'Add this provider’s API key in Settings' : undefined}
          >
            <Icon name={provider.imagery === false ? 'globe' : 'satellite'} size={18} />
            <span class="provider-copy">
              <strong>{provider.label}</strong>
              <small>{provider.needs_key ? 'Needs a key' : provider.imagery === false ? 'Reference map' : 'Imagery'}</small>
            </span>
          </button>
        {/each}
      </div>
        {/if}
      {/each}
    {/if}
  </Modal>
{/if}

{#if saveDialog}
  <Modal title="Save comparison" onclose={() => (saveDialog = false)} width="440px">
    <div class="save-form">
      <label>Name
        <!-- svelte-ignore a11y_autofocus -->
        <input class="input" bind:value={sessionName} maxlength="200" autofocus onkeydown={(event) => event.key === 'Enter' && performSessionSave()} />
      </label>
      <p>Saves every control needed to reopen this view.</p>
      <div class="modal-actions">
        <button class="btn" onclick={() => (saveDialog = false)}>Cancel</button>
        <button class="btn btn-primary" disabled={!sessionName.trim() || sessionBusy} onclick={performSessionSave}>
          {sessionBusy ? 'Saving…' : 'Save comparison'}
        </button>
      </div>
    </div>
  </Modal>
{/if}

{#if sessionDialog}
  <Modal title="Open comparison" onclose={() => (sessionDialog = false)} width="540px">
    {#if sessionBusy}
      <p class="picker-loading">Reading saved comparisons…</p>
    {:else if !sessionList.length}
      <div class="session-empty"><Icon name="layers" size={24} /><strong>No saved comparisons yet.</strong></div>
    {:else}
      <div class="session-list">
        {#each sessionList as saved (saved.name)}
          <div class="session-row">
            <button class="session-open" onclick={() => requestOpenSession(saved.name)}>
              <strong>{saved.title}</strong>
              <span>{imagery.find(saved.provider_a)?.label ?? saved.provider_a} / {imagery.find(saved.provider_b)?.label ?? saved.provider_b}</span>
              <small>{COMPARE_MODES.find((entry) => entry.id === saved.mode)?.label ?? saved.mode}{saved.updated_at ? ` · ${saved.updated_at.replace('T', ' ').replace('Z', '')}` : ''}</small>
            </button>
            <button class="btn btn-ghost btn-xs" onclick={() => deleteSession(saved.name)} aria-label={`Delete ${saved.title}`}><Icon name="trash" size={14} /></button>
          </div>
        {/each}
      </div>
    {/if}
  </Modal>
{/if}

{#if discardTarget}
  <ConfirmDialog
    title="Discard unsaved changes?"
    message={discardTarget.kind === 'revert'
      ? `This comparison goes back to the version saved as “${discardTarget.name}”.`
      : 'The current comparison has not been saved.'}
    detail="Saving keeps the sources, layers and camera together."
    confirmLabel="Discard changes"
    icon="compare"
    onconfirm={confirmDiscard}
    oncancel={() => (discardTarget = null)}
  />
{/if}

{#if exportPicker}
  <ExportFolderPicker
    kind="views"
    current={exportDestination ?? ''}
    confirmLabel="Export here"
    onclose={() => (exportPicker = false)}
    onchosen={(path) => (exportDestination = path)}
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
  />
{/if}

<style>
  .tool { position: relative; }
  .spacer { flex: 1; }
  .tool-header { min-height: 55px; }
  .tool-header :global(.place-search) { width: min(440px, 40vw); }
  .session-title {
    width: min(250px, 22vw);
    height: 30px;
    padding: 4px 8px;
    font-weight: 650;
  }
  .badge {
    padding: 2px 6px;
    border-radius: 99px;
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 12%, transparent);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: .05em;
  }
  .source-bar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 1px;
    padding: 1px;
    border-bottom: 1px solid var(--border);
    background: var(--border-strong);
  }
  .source-add { color: var(--text-3); background: var(--bg-1); }
  .compare-bar { display: flex; align-items: center; gap: 12px; padding: 6px 12px; background: var(--bg-1); }
  .camera-readout { color: var(--text-3); font-size: var(--fs-xs); }
  .mode-footer { display: flex; justify-content: center; padding: 6px; background: var(--bg-1); }
  .presets { display: flex; justify-content: center; gap: 8px; padding: 8px; }
  .compare-workspace { display: flex; min-height: 0; flex: 1; }
  /* The cards and the maps they describe share one width, so the split between
     A and B is one line down the whole tool. */
  .stage-column { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
  .compare-stage {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 1px;
    padding: 1px;
    background: var(--border-strong);
    overflow: hidden;
  }
  .surface-shell, .empty-slot {
    position: relative;
    flex: 1 1 50%;
    min-width: 0;
    min-height: 0;
  }
  .surface-shell { display: flex; overflow: hidden; background: var(--bg-0); }
  .surface-label {
    position: absolute;
    top: 11px;
    left: 11px;
    z-index: 520;
    display: flex;
    align-items: center;
    height: 29px;
    border: 1px solid rgba(255,255,255,.18);
    border-radius: var(--r-sm);
    color: #f2f2f2;
    background: rgba(24,24,24,.88);
    backdrop-filter: blur(6px);
    box-shadow: var(--shadow-1);
  }
  .surface-label strong { padding: 0 9px; font-size: var(--fs-xs); color: var(--accent); }
  .empty-slot {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: 1px dashed var(--border-strong);
    color: var(--text-3);
    background: var(--bg-0);
    cursor: pointer;
  }
  .empty-slot:hover:not(:disabled) { color: var(--text-1); background: var(--bg-1); border-color: var(--accent); }
  .empty-slot:disabled { cursor: wait; }
  .empty-slot strong { font-size: var(--fs-md); color: var(--text-1); }
  .empty-slot span:last-child { font-size: var(--fs-sm); }
  .slot-letter {
    position: absolute;
    top: 16px;
    left: 18px;
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--accent);
  }
  .compare-stage.overlay { display: block; padding: 0; background: var(--bg-0); }
  .compare-stage.overlay .surface-shell { position: absolute; inset: 0; }
  /* A transparent B surface must reveal A at 0%, rather than its own empty
     shell background painting a gray rectangle over the image underneath. */
  .compare-stage.overlay .surface-shell { background: transparent; }
  .compare-stage.overlay .primary { z-index: 1; }
  .compare-stage.overlay .secondary { z-index: 2; }
  .compare-stage.overlay .surface-label { display: none; }
  /* Detect with a one-date analyzer: one map, and no letter to disambiguate. */
  .compare-stage.solo .primary { display: none; }
  .compare-stage.solo .secondary { flex: 1 1 100%; }
  .compare-stage.solo .surface-label { display: none; }
  .compare-stage.swipe .secondary { clip-path: inset(0 0 0 var(--divider)); }
  /* Blend the pixels, not the provider/date controls that explain them. */
  .compare-stage.blended .secondary :global(.map),
  .compare-stage.blended .secondary :global(.map-glass) { opacity: var(--opacity); }
  .compare-stage.overlay .secondary.blink-hidden { opacity: 0; pointer-events: none; }
  .compare-stage.change.base-a .secondary { opacity: 0; pointer-events: none; }
  .compare-stage.change.base-b .secondary { opacity: 1; }
  .change-map {
    position: absolute;
    z-index: 545;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: fill;
    transform-origin: 0 0;
    opacity: var(--change-opacity);
    pointer-events: none;
  }
  .change-legend {
    position: absolute;
    z-index: 555;
    right: 12px;
    bottom: 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 9px;
    border: 1px solid rgba(255,255,255,.16);
    border-radius: var(--r-sm);
    color: #e9edf1;
    background: rgba(18,21,25,.88);
    box-shadow: var(--shadow-1);
    font-size: 10px;
    backdrop-filter: blur(6px);
  }
  .change-legend.hidden { opacity: .58; }
  .change-legend span { display: flex; align-items: center; gap: 4px; }
  .change-legend i { width: 9px; height: 9px; border-radius: 2px; }
  .change-legend .gain { background: rgb(34,197,94); }
  .change-legend .loss { background: rgb(239,68,68); }
  .change-legend .changed { background: rgb(250,204,21); }
  .change-legend.colourblind .gain { background: rgb(0,114,178); }
  .change-legend.colourblind .loss { background: rgb(230,159,0); }
  .change-legend.colourblind .changed { background: rgb(204,121,167); }
  .change-legend em { max-width: 260px; overflow: hidden; color: #c4c9cf; font-style: normal; text-overflow: ellipsis; white-space: nowrap; }
  .compare-stage.capturing .surface-label,
  .compare-stage.capturing .swipe-line { visibility: hidden; }
  .compare-stage.capture-a .secondary,
  .compare-stage.capture-b .primary { visibility: hidden; }
  .compare-stage.capturing.swipe .secondary { clip-path: none; }
  .compare-stage.capturing.blended .secondary :global(.map),
  .compare-stage.capturing.blended .secondary :global(.map-glass) { opacity: 1; }
  .compare-stage.capturing.overlay .secondary.blink-hidden { opacity: 1; pointer-events: auto; }
  .swipe-line {
    position: absolute;
    z-index: 540;
    top: 0;
    bottom: 0;
    left: var(--divider);
    width: 2px;
    padding: 0;
    border: 0;
    transform: translateX(-1px);
    background: rgba(255,255,255,.92);
    cursor: ew-resize;
    touch-action: none;
    box-shadow: 0 0 5px rgba(0,0,0,.75);
  }
  .swipe-line::before {
    content: '';
    position: absolute;
    inset: 0 -12px;
  }
  .swipe-line:focus-visible { outline: none; }
  .swipe-line:focus-visible .swipe-handle {
    box-shadow: 0 0 0 2px var(--accent), 0 4px 14px rgba(0,0,0,.45);
  }
  .swipe-handle {
    position: absolute;
    top: 50%;
    left: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    width: 40px;
    height: 30px;
    transform: translate(-50%, -50%);
    border: 1px solid rgba(255,255,255,.38);
    border-radius: 9px;
    color: #f8fafc;
    background: rgba(24,24,24,.88);
    backdrop-filter: blur(6px);
    box-shadow: 0 4px 14px rgba(0,0,0,.45);
    pointer-events: none;
    transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
  }
  .swipe-handle i {
    width: 1px;
    height: 14px;
    background: rgba(255,255,255,.28);
  }
  .swipe-line:hover .swipe-handle {
    border-color: rgba(255,255,255,.62);
    background: rgba(12,12,12,.94);
    transform: translate(-50%, -50%) scale(1.04);
  }
  .swipe-line:active .swipe-handle {
    transform: translate(-50%, -50%) scale(.98);
  }
  .rotate-pivot {
    position: absolute;
    z-index: 570;
    width: 34px;
    height: 34px;
    transform: translate(-50%, -50%);
    border: 1px solid rgba(255,255,255,.92);
    border-radius: 50%;
    pointer-events: none;
    box-shadow: 0 0 0 1px rgba(0,0,0,.7), inset 0 0 0 8px rgba(0,0,0,.25);
  }
  .rotate-pivot::before,
  .rotate-pivot::after {
    content: '';
    position: absolute;
    background: rgba(255,255,255,.92);
  }
  .rotate-pivot::before { left: 50%; top: 5px; bottom: 5px; width: 1px; }
  .rotate-pivot::after { top: 50%; left: 5px; right: 5px; height: 1px; }
  .picker-lead { margin-bottom: 13px; color: var(--text-2); font-size: var(--fs-sm); }
  .provider-kind { font-size: 12px; margin: 12px 0 6px; color: var(--text-3); }
  .provider-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; min-width: 0; }
  .provider-card {
    display: flex;
    align-items: center;
    gap: 11px;
    min-height: 58px;
    min-width: 0;
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    color: var(--text-2);
    background: var(--bg-2);
    text-align: left;
    cursor: pointer;
  }
  .provider-card:hover:not(:disabled) { color: var(--accent); border-color: var(--border-strong); background: var(--bg-3); }
  .provider-card:disabled { opacity: .52; cursor: not-allowed; }
  .provider-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .provider-copy strong { color: var(--text-1); overflow-wrap: anywhere; }
  .provider-copy small { color: var(--text-3); font-size: var(--fs-xs); }
  .picker-error { display: flex; align-items: center; justify-content: space-between; gap: 14px; color: var(--danger); }
  .picker-loading { padding: 16px 0; color: var(--text-3); text-align: center; }

  .field-label {
    color: var(--text-3);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .08em;
    text-transform: uppercase;
  }
  .export-dialog { display: grid; gap: 15px; }
  .output-list { display: grid; gap: 8px; }
  .output-choice {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr);
    align-items: flex-start;
    gap: 9px;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    color: var(--text-3);
    cursor: pointer;
  }
  .output-choice:hover,
  .output-choice.selected { border-color: var(--border-strong); color: var(--accent); background: var(--bg-2); }
  .output-choice span,
  .output-choice small { display: block; }
  .output-choice strong { color: var(--text-1); font-size: var(--fs-sm); }
  .output-choice small { margin-top: 2px; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.35; }
  .destination { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px 10px; align-items: center; padding-top: 13px; border-top: 1px solid var(--border); }
  .destination .field-label { grid-column: 1 / -1; }
  .destination strong { overflow: hidden; color: var(--text-2); font-size: var(--fs-xs); text-overflow: ellipsis; white-space: nowrap; }
  .destination-actions { display: flex; align-items: center; justify-content: flex-end; gap: 12px; }
  .link { color: var(--accent); font-size: var(--fs-xs); }
  .link.muted { color: var(--text-3); }
  .link.muted:hover { color: var(--text-1); }
  .panel-note,
  .panel-intro { margin: 0; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.45; }
  .panel-intro { padding: 0 0 12px; }
  .panel-note { display: flex; gap: 7px; align-items: flex-start; }
  .panel-actions { display: flex; gap: 8px; }
  .panel-actions .btn { flex: 1; justify-content: center; }
  .folder-open { display: flex; align-items: center; gap: 7px; color: var(--text-3); font-size: var(--fs-xs); }
  .folder-open:hover:not(:disabled) { color: var(--text-1); }
  .layer-columns {
    height: min(68vh, 690px);
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 10px;
  }
  .save-form { display: grid; gap: 13px; }
  .save-form label { display: grid; gap: 6px; color: var(--text-2); font-size: var(--fs-sm); }
  .save-form p { margin: 0; color: var(--text-3); font-size: var(--fs-xs); }
  .modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
  .session-empty { display: grid; place-items: center; gap: 8px; min-height: 150px; color: var(--text-3); }
  .session-list { display: grid; max-height: min(56vh, 480px); overflow: auto; border: 1px solid var(--border); border-radius: var(--r-md); }
  .session-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .session-row + .session-row { border-top: 1px solid var(--border); }
  .session-open { display: grid; gap: 2px; min-width: 0; flex: 1; padding: 10px 12px; text-align: left; }
  .session-open:hover { background: var(--bg-2); }
  .session-open strong,
  .session-open span,
  .session-open small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .session-open strong { color: var(--text-1); }
  .session-open span { color: var(--text-2); font-size: var(--fs-xs); }
  .session-open small { color: var(--text-3); font-size: 10px; }
  @media (max-width: 900px) {
    .tool-header .sub { display: none; }
    .compare-stage:not(.overlay) { flex-direction: column; }
    .provider-grid { grid-template-columns: 1fr; }
    .source-bar { grid-template-columns: 1fr; }
    .compare-bar { flex-wrap: wrap; }
    .session-title { width: 150px; }
    .camera-readout { display: none; }
    .layer-columns { height: min(72vh, 720px); grid-template-columns: 1fr; overflow: auto; }
  }
</style>
