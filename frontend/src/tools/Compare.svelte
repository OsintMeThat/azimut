<script>
  /**
   * Two maps, one piece of ground.
   *
   * Satellite explores one imagery view. Compare opens on a key-less pair, a
   * Wayback release a year back against today's World Imagery, and lets the
   * analyst swap either side, then changes only how that pair is read. The provider, Wayback release and Sentinel-2 day belong to each
   * MapSurface; the camera is the one shared fact.
   */
  import { onDestroy, onMount, tick, untrack } from 'svelte';
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
  import { copyText } from '../lib/clipboard.js';
  import { saveRelation } from '../lib/relations.svelte.js';
  import { actionsFor, otherMapTools } from '../lib/map/contextMenu.js';
  import { lookFrom, openMapAt } from '../lib/navigate.js';
  import { followFullscreen, toggleFullscreen } from '../lib/fullscreen.js';
  import { wrapLon } from '../lib/coords.js';
  import {
    COMPARE_LAYERS,
    COMPARE_MODES,
    DIFFERENCE_KEY,
    DEFAULT_DIVIDER,
    DEFAULT_OPACITY,
    comparisonLayers,
    compareMode,
    percentage,
    DEFAULT_PRESET,
    availablePresets,
    COMPARE_PRESETS,
    PROVIDER_KINDS,
    providerKind,
  } from '../lib/map/compare.js';
  import {
    blobBase64,
    canvasBlob,
    comparisonFilename,
    composeComparison,
    gifColours,
    pictureDateFields,
  } from '../lib/map/compareExport.js';
  import {
    DEFAULT_INTERVAL,
    GIF_EDGE,
    MAX_EVOLUTION_FRAMES,
    evolutionArchive,
    evolutionFrame,
    pictureLabel,
    pictureScale,
    pictureTiles,
    sheetCellScale,
    timelinePositions,
  } from '../lib/map/evolution.js';
  import { composeEvolutionFrame, composeEvolutionSheet, drawPictures } from '../lib/map/evolutionExport.js';
  import {
    CHANGE_PALETTES,
    changeCompatibility,
    changeNeedsFrames,
    changeSettings,
  } from '../lib/map/changeAssist.js';
  import {
    ANNOTATION_COLOURS,
    ANNOTATION_TOOLS,
    STAMPED,
    canFill,
    nextMarkNumber,
    comparisonAnnotations,
  } from '../lib/map/compareAnnotations.js';
  import { PROOF_ICONS } from '../lib/proofIcons.js';
  import { cropSources, exportFrameSpec, frameSpan } from '../lib/map/exportFrame.js';
  import { formatDistance } from '../lib/measure.js';
  import { captureTab, extensionVersion } from '../lib/extBridge.js';
  import {
    CASE_FOLDER_LABEL,
    destinationLabel,
    readDestinations,
  } from '../lib/exportDest.js';
  import { turnFromKey, turnFromPress } from '../lib/map/gestures.js';
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
  import { SENTINEL_ID, variantId } from '../lib/sentinel.js';
  import { WAYBACK_ID, releaseYearBefore, waybackId } from '../lib/wayback.js';
  import { RADAR_ID, radarId } from '../lib/radar.js';
  import { offerNote, pairOffers, withdrawNote } from '../lib/noteHere.svelte.js';
  import { holdsUnsaved } from '../lib/backButton.js';
  import { changeInterval, formatTemporalValue } from '../lib/timeline.js';
  import Icon from '../components/Icon.svelte';
  import Compass from '../components/Compass.svelte';
  import TurnGuide from '../components/TurnGuide.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import ExportFolderPicker from '../components/ExportFolderPicker.svelte';
  import Modal from '../components/Modal.svelte';
  import ModeDock from './compare/ModeDock.svelte';
  import ModeControl from './compare/ModeControl.svelte';
  import SourceCard from './compare/SourceCard.svelte';
  import DifferenceBar from './compare/DifferenceBar.svelte';
  import DifferencePanel from './compare/DifferencePanel.svelte';
  import { fromDifference } from '../lib/map/analyzerRules.js';
  import PassStrip from './compare/PassStrip.svelte';
  import EvolutionPicker from './compare/EvolutionPicker.svelte';
  import CopernicusNeeded from '../components/CopernicusNeeded.svelte';
  import { copernicusNeed } from '../lib/copernicusSetup.js';
  import { stripArchive } from '../lib/map/passStrip.js';
  import './mapdock.css';
  import { linkCameras } from '../lib/map/cameraLink.js';
  import { shareView } from '../lib/map/sharedView.js';
  import { detectCaptures } from '../lib/map/changeCapture.js';
  import { apply, compassAngle, cssMatrix, frameToFrame, fromMercator, screenToMercator } from '../lib/map/groundFrame.js';
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
  import { createRadarState } from './satellite/state/radar.svelte.js';

  const imagery = createImageryState({ api });
  let home = $state(null);
  let catalogueError = $state('');
  let firesKeyed = $state(false);
  /** Why the fire layer is not usable when it is not: 'missing' | 'off' | 'refused'. */
  let firesState = $state('missing');
  /** A spent FIRMS allowance's pause, while it lasts. */
  let firesPaused = $state(null);
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
  let toolEl = $state(null);
  let fullscreen = $state(false);
  // The drawing rail opens folded on every visit, its width given to the
  // maps, until `[` or its tab opens it.
  let railFolded = $state(true);
  let rotating = $state(null); // { which, x, y } | null
  let outputBusy = $state(''); // 'capture' | 'png' | 'gif' | 'copy' | ''
  let rightPanel = $state(null); // 'export' | 'layers' | null
  let grabbing = $state(false);
  let captureSide = $state(null); // surface visible during an extension frame
  let exportKind = $state('png'); // 'png' | 'blink' | 'slide' | 'evolution' | 'sheet'
  // Every export is signed with the Azimut lockup unless this is unticked.
  let signExport = $state(true);
  // The pictures an evolution plays, as the picker has them ticked, and how far
  // a running one has got. Aborting the controller stops it between two tiles.
  let evolutionChosen = $state([]);
  let evolutionInterval = $state(DEFAULT_INTERVAL);
  let evolutionProgress = $state(null); // { done, total } | null
  let evolutionAbort = null;
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
  // Keeping an export files it under its comparison, which needs a name first:
  // an export asked while unsaved opens the save dialog and runs once it is saved.
  let keepInCase = $state(false);
  let exportAfterSave = false;
  let sessionDialog = $state(false);
  let sessionBusy = $state(false);
  let sessionList = $state([]);
  let discardTarget = $state(null); // { kind: 'new' | 'open' | 'revert' | 'pair', name?, pair?, preset? } | null
  let newMenu = $state(false);
  let newMenuEl = $state(null);
  $effect(() => {
    if (!newMenu) return;
    const outside = (event) => {
      if (newMenuEl && !newMenuEl.contains(event.target)) newMenu = false;
    };
    document.addEventListener('mousedown', outside, true);
    return () => document.removeEventListener('mousedown', outside, true);
  });
  let annotations = $state([]);
  let annotationTool = $state('select');
  let selectedAnnotationId = $state(null);
  let annotationColour = $state(ANNOTATION_COLOURS[0]);
  let annotationStroke = $state(4);
  let annotationFill = $state(0);
  // Which symbol the stamp puts down, kept between two of them: marking six
  // vehicles is one act, and re-picking the glyph each time would make it six.
  let annotationGlyph = $state(PROOF_ICONS[0].name);
  // How big the next note or stamp is drawn. One number for all three: they are
  // the marks with no line to widen, and the rail has one slider.
  let annotationStampSize = $state(12);
  let annotationUndo = $state([]);
  let annotationRedo = $state([]);
  let annotationPreviewBase = null;
  let changeOptions = $state(changeSettings());
  // Every dated picture of the point, when A and B show the same archive.
  let stripOpen = $state(false);
  // What Copernicus still lacks for a road the analyst asked for: `{ need, tool }`.
  let copernicus = $state(null);
  // Highlights laid over whichever view mode is on, never a layout of their own.
  let difference = $state(false);
  // Its settings, docked on the stage's right edge; closed whenever Difference comes on.
  let differenceOpen = $state(false);
  const differenceDocked = $derived(both && difference && differenceOpen);
  /** The surface the shared controls act on. */
  const primeEngine = $derived(a.engine ?? b.engine);

  let changeBusy = $state(false);
  /** A reading is on its way: the settle it follows has not fired yet. */
  let changePending = $state(false);
  /** A reading waits for tiles still loading, rather than failing on them. */
  let changeTiles = $state(false);
  let changeError = $state('');
  let changeResult = $state(null);
  let changeUrl = $state('');
  /** One transform per surface: the mask is ground, and each map frames it. */
  let changeTransform = $state({ a: '', b: '' });
  let changeBlinkOn = $state(true);
  const changeVisible = $derived(!changeOptions.blink || changeBlinkOn);
  const changeOver = (letter) => changeOptions.base === 'both' || changeOptions.base === letter;
  const changeOpacity = $derived(changeOptions.opacity);
  // The legend's swatches come from the palette the overlay is drawn in.
  const changeSwatches = $derived(Object.entries(CHANGE_PALETTES[changeOptions.palette] ?? CHANGE_PALETTES.directional)
    .map(([name, [r, g, b]]) => `--${name}: rgb(${r},${g},${b})`).join('; '));
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
  // Each radar side knows the other's pass, so its picker can mark the passes
  // on the same track: only those compare like with like.
  const s1a = createRadarState({
    api,
    place: () => ({ lat: view.lat, lon: view.lon }),
    onBilled: () => imagery.refreshUsage(),
    peer: () => (b.present && b.providerId === RADAR_ID ? s1b.shownPass : null),
  });
  const s1b = createRadarState({
    api,
    place: () => ({ lat: view.lat, lon: view.lon }),
    onBilled: () => imagery.refreshUsage(),
    peer: () => (a.present && a.providerId === RADAR_ID ? s1a.shownPass : null),
  });

  $effect(() => {
    const caseId = caseState.current?.id;
    caseState.rev;
    return savedWork.load(caseId);
  });

  const both = $derived(a.present && b.present);
  const activeView = $derived(view);
  const shownA = $derived(
    imagery.displayed(a.providerId, view.zoom, { ...s2a.variant, release: wba.release, pass: s1a.shownPass })
  );
  const shownB = $derived(
    imagery.displayed(b.providerId, view.zoom, { ...s2b.variant, release: wbb.release, pass: s1b.shownPass })
  );
  const labelA = $derived(imagery.find(a.providerId)?.label ?? 'Imagery A');
  const labelB = $derived(imagery.find(b.providerId)?.label ?? 'Imagery B');
  const hasWidget = $derived(Boolean(shownA.provider?.widget || shownB.provider?.widget));
  const sessionDirty = $derived(
    (a.present || b.present) && sessionSignature() !== savedSignature
  );
  // A preset as it opened, or a comparison as it was saved, camera aside.
  // Panning is looking, not work, so leaving asks nothing; Save still takes it.
  let pristineSignature = $state(null);
  const discardable = $derived(sessionDirty && pairSignature() !== pristineSignature);
  // Leaving Azimut with them asks first, as leaving the comparison here does.
  onDestroy(holdsUnsaved('compare', () => discardable));
  let firmsSensors = $state([]);

  function changeSide(target, sentinel, wayback, shown, radar) {
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
        effectiveDate: sentinel.day,
        maxcc: sentinel.maxcc,
      },
      waybackRelease: wayback.release,
      radar: radarSpec(radar),
    };
  }

  /** A side's radar pass as a session keeps it: the pass the tiles were
   *  rendered from, so reopening the session draws the same look rather than
   *  whichever pass is newest that day. */
  function radarSpec(radar) {
    return { date: radar.shownPass?.date ?? '', time: radar.shownPass?.time ?? '' };
  }

  const archive = $derived(stripArchive(sideSpec(a, s2a, wba, s1a), sideSpec(b, s2b, wbb, s1b)));
  $effect(() => {
    if (!archive) stripOpen = false;
  });

  // The archive an evolution plays, which Then and now also has: World Imagery's
  // history is Wayback.
  const evolution = $derived(evolutionArchive(sideSpec(a, s2a, wba, s1a), sideSpec(b, s2b, wbb, s1b)));
  const evolutionKind = $derived(exportKind === 'evolution' || exportKind === 'sheet');
  $effect(() => {
    if (!evolution && (exportKind === 'evolution' || exportKind === 'sheet')) exportKind = 'png';
  });

  /** Show one of the strip's pictures on a side. */
  function assignFromStrip(letter, entry) {
    const [target, sentinel, wayback, radar] = letter === 'a' ? [a, s2a, wba, s1a] : [b, s2b, wbb, s1b];
    if (!target.present) return;
    if (archive === RADAR_ID) radar.pick(entry);
    else if (archive === WAYBACK_ID) wayback.pick(entry.release);
    else sentinel.date = entry.date;
    invalidateChangeAssist();
  }

  /** The provider id a strip picture is drawn from: B's layer, on that row's date. */
  function stripVariant(entry) {
    if (archive === RADAR_ID) return radarId(RADAR_ID, entry);
    if (archive === WAYBACK_ID) return waybackId(WAYBACK_ID, entry.release);
    return variantId(SENTINEL_ID, { layer: s2b.layer, from: entry.date, to: entry.date });
  }

  /** The provider id one picture of an evolution is drawn from: B's layer, on that row's date. */
  function evolutionVariant(entry) {
    if (evolution === WAYBACK_ID) return waybackId(WAYBACK_ID, entry.release);
    return variantId(SENTINEL_ID, { layer: s2b.layer, from: entry.date, to: entry.date });
  }

  const changeStatus = $derived(
    changeCompatibility(changeSide(a, s2a, wba, shownA, s1a), changeSide(b, s2b, wbb, shownB, s1b))
  );

  function openImagerySettings() {
    uiState.settingsTab = 'imagery';
    uiState.tool = 'settings';
  }

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
      // Where the other map tabs left the window, when they share a camera.
      const shared = share.opening();
      view = shared ? { lat: shared.lat, lon: shared.lon, zoom: shared.zoom } : { ...home };
      bearing = shared?.bearing ?? 0;
      await loadProviders();
      if (gone) return;
      // A handoff from the map brings its own pair.
      if (!a.present && !b.present && !uiState.compareAt) void newComparison();
      await loadFireCatalogue();
    })();
    return () => {
      gone = true;
      clearTimeout(firesPauseTimer);
      clearTimeout(firesTroubleTimer);
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
      firesState = answer.state ?? 'missing';
      firesPaused = answer.paused ?? null;
    } catch {
      firmsSensors = [];
      firesKeyed = false;
      firesPaused = null;
    }
    // A pause ends on its own; the panes hear it then. Our own backend, once.
    clearTimeout(firesPauseTimer);
    if (firesPaused) {
      const left = Date.parse(firesPaused.until) - Date.now();
      firesPauseTimer = setTimeout(loadFireCatalogue, Math.max(1000, left + 500));
    }
  }

  let firesPauseTimer = null;
  let firesTroubleTimer = null;
  /** A FIRMS tile failed on either side: ask our backend why, once per burst. */
  function fireTrouble() {
    clearTimeout(firesTroubleTimer);
    firesTroubleTimer = setTimeout(loadFireCatalogue, 800);
  }

  function side(which) {
    return which === 'a' ? a : b;
  }

  function savedCoords(at) {
    return `${Number(at.lat).toFixed(5)}, ${Number(at.lon).toFixed(5)}`;
  }

  /** A card's own action: a comparison reopens here, anything else is flown to. */
  function editSaved(row) {
    if (row?.kind === 'comparison' && row.session) requestOpenSession(row.session);
    else openSaved(row);
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
    if (!(difference && changeOptions.blink && changeUrl)) {
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
    // Where the map is, for Coordinates, and where the window looks: hidden
    // too, when a pan's glide ends after a switch of tab.
    uiState.mapPoint = { lat: next.lat, lon: next.lon, zoom: next.zoom };
    share.settled(next, (which === 'a' ? a : b).engine?.maxZoom());
  }

  function onSurfaceBearing(which, next) {
    bearing = next.bearing;
  }

  function swapSides() {
    const left = sideSpec(a, s2a, wba, s1a);
    const right = sideSpec(b, s2b, wbb, s1b);
    applySide(a, s2a, wba, right, s1a);
    applySide(b, s2b, wbb, left, s1b);
    annotations = annotations.map((mark) => ({ ...mark, side: mark.side === 'a' ? 'b' : mark.side === 'b' ? 'a' : 'both' }));
    invalidateChangeAssist();
  }

  let presetRequest = 0;

  /**
   * Put a preset's two views on the sides.
   *
   * A Wayback side opens a year back, so "then" is not today's mosaic twice.
   * Without a release list it stays empty rather than showing B again.
   */
  async function applyPreset(preset) {
    const request = ++presetRequest;
    const sides = [[a, wba, preset.a], [b, wbb, preset.b]];
    for (const [target, , id] of sides) {
      target.providerId = id;
      if (id !== WAYBACK_ID) target.present = true;
    }
    for (const [target, wayback, id] of sides) {
      if (id !== WAYBACK_ID) continue;
      const past = releaseYearBefore(await wayback.loadReleases());
      if (request !== presetRequest) return;
      if (past == null) continue;
      wayback.pick(past);
      target.present = true;
    }
    pristineSignature = pairSignature();
  }

  function visitZone(zone) {
    if (!changeResult) return;
    const frame = changeResult.frame;
    const [lon, lat] = fromMercator(...apply(screenToMercator(frame),
      zone.centre.x * frame.width, zone.centre.y * frame.height));
    activeEngine()?.setView({ lat, lon }, view.zoom);
  }

  /**
   * The Copernicus roads a missing key or layer closes, offered anyway.
   *
   * Compare works without Copernicus, so nothing is said until one of them is
   * asked for; then what it needs is said in the middle of the stage rather
   * than the road quietly missing from the list.
   */
  const lockedPresets = $derived(imagery.providers.length
    ? COMPARE_PRESETS.filter((preset) => ['sentinel2', 'sentinel1'].includes(preset.a)
      && !availablePresets(imagery.providers).includes(preset))
    : []);
  const lockedArchives = $derived(imagery.providers.length
    ? [['sentinel2', 'Sentinel-2 (Copernicus)'], ['sentinel1', 'Sentinel-1 radar (Copernicus)']]
      .filter(([id]) => !imagery.find(id))
    : []);

  function askCopernicus(id, tool) {
    picking = null;
    newMenu = false;
    copernicus = { need: copernicusNeed(imagery.providers, { radar: id === 'sentinel1' }), tool };
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
    difference = false;
  }

  // Compare owns the same Google-Earth style gesture as Satellite. Either map
  // can lead; its live camera is bound to the other surface immediately.
  $effect(() => {
    const pairs = [
      { which: 'a', element: a.element, engine: a.engine },
      { which: 'b', element: b.element, engine: b.engine },
    ].filter((entry) => entry.element && entry.engine);
    const listeners = pairs.map((entry) => {
      const down = (event) =>
        turnFromPress(entry.engine, event, {
          onPivot: ({ x, y }) => (rotating = { which: entry.which, x, y }),
          onEnd: () => (rotating = null),
        });
      entry.element.addEventListener('mousedown', down, true);
      return () => entry.element.removeEventListener('mousedown', down, true);
    });
    return () => listeners.forEach((release) => release());
  });

  // Shift and an arrow turn the pair, whether one map is up or both: the
  // camera is shared, so turning the first turns the other.
  $effect(() => {
    if (uiState.tool !== 'compare' || !primeEngine) return;
    const engine = primeEngine;
    const onKey = (event) => turnFromKey(engine, event);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // A layout change changes both map containers. MapLibre must be told after
  // the browser has laid the new rectangles out, or tiles keep the old size.
  $effect(() => {
    mode;
    a.present;
    b.present;
    fullscreen;
    railFolded;
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

  // The whole tool takes the screen, bars and panels with it, so Save and
  // Export stay in reach.
  $effect(() => {
    if (toolEl) return followFullscreen(toolEl, (on) => (fullscreen = on));
  });
  function switchFullscreen() {
    toggleFullscreen(toolEl).catch(() => toast('Full screen is not available', 'danger'));
  }

  // Tools stay mounted while hidden so their work survives a tab switch.
  $effect(() => {
    if (uiState.tool !== 'compare') return;
    imagery.refreshUsage();
    loadProviders();
    // a FIRMS key pasted into Settings, or tested back to life there
    loadFireCatalogue();
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
  // Each side's "most recent" is resolved to a day, which is then the window its
  // tiles are rendered from: a side is one acquisition, never a blend of the
  // archive, or the difference between the two sides would be partly a
  // difference between dates nobody chose. Unresolved, the lookup goes out at
  // once; afterwards the debounce keeps a pan from spending a request per frame.
  $effect(() => {
    if (!a.ready || shownA.provider?.id !== SENTINEL_ID) return;
    view.lat;
    view.lon;
    s2a.maxcc;
    clearTimeout(s2aLatestTimer);
    s2aLatestTimer = setTimeout(() => s2a.resolveLatest().catch(() => {}), s2a.resolved ? 900 : 0);
    return () => clearTimeout(s2aLatestTimer);
  });
  $effect(() => {
    if (!b.ready || shownB.provider?.id !== SENTINEL_ID) return;
    view.lat;
    view.lon;
    s2b.maxcc;
    clearTimeout(s2bLatestTimer);
    s2bLatestTimer = setTimeout(() => s2b.resolveLatest().catch(() => {}), s2b.resolved ? 900 : 0);
    return () => clearTimeout(s2bLatestTimer);
  });
  // Both sides' radar passes are resolved the same way: a side is one look, not
  // a blend of every pass over the point.
  $effect(() => {
    if (!a.ready || shownA.provider?.id !== RADAR_ID) return;
    view.lat;
    view.lon;
    clearTimeout(s1aLatestTimer);
    s1aLatestTimer = setTimeout(() => s1a.resolveLatest().catch(() => {}), s1a.resolved ? 900 : 0);
    return () => clearTimeout(s1aLatestTimer);
  });
  $effect(() => {
    if (!b.ready || shownB.provider?.id !== RADAR_ID) return;
    view.lat;
    view.lon;
    clearTimeout(s1bLatestTimer);
    s1bLatestTimer = setTimeout(() => s1b.resolveLatest().catch(() => {}), s1b.resolved ? 900 : 0);
    return () => clearTimeout(s1bLatestTimer);
  });
  let s1aLatestTimer;
  let s1bLatestTimer;

  $effect(() => {
    if (a.ready && shownA.provider?.id === WAYBACK_ID) wba.loadReleases();
  });
  $effect(() => {
    if (b.ready && shownB.provider?.id === WAYBACK_ID) wbb.loadReleases();
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
    mode = next;
    blinkPaused = false;
  }

  function setDifference(on) {
    if (on && !changeStatus.ok) {
      toast(changeStatus.reason, 'warn', 6000);
      return;
    }
    difference = on;
    differenceOpen = false;
    if (!on) return;
    if (!changeStatus.methods.includes(changeOptions.method)) changeOptions.method = changeStatus.methods[0];
    // Turning it on by hand asks for a reading, bands included. Queued behind
    // the flush the switch starts, so the follow-up that flush schedules is the
    // one this replaces, and not the other way round.
    queueMicrotask(() => void refreshChangeAssist());
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

  function sideSpec(target, sentinel, wayback, radar) {
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
        date: difference ? sentinel.day : sentinel.date,
        maxcc: sentinel.maxcc,
      },
      wayback_release: wayback.release,
      radar: radarSpec(radar),
    };
  }

  function sessionSpec() {
    return {
      version: 2,
      camera: { lat: view.lat, lon: view.lon, zoom: view.zoom, bearing },
      mode,
      difference,
      divider,
      opacity,
      blink: { interval: blinkInterval },
      change_assist: changeSettings(changeOptions),
      annotations: comparisonAnnotations(annotations),
      frame: exportFrame,
      a: sideSpec(a, s2a, wba, s1a),
      b: sideSpec(b, s2b, wbb, s1b),
    };
  }

  function sessionSignature() {
    return JSON.stringify([sessionName.trim(), sessionSpec()]);
  }

  function pairSignature(spec = sessionSpec(), title = sessionName.trim()) {
    const { camera, ...pair } = spec;
    return JSON.stringify([title, pair]);
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
      pristineSignature = pairSignature(savedSpec, result.title);
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
          ? 'Comparison and animated preview saved to the case'
          : 'Comparison and preview saved to the case', 'ok');
      }
      if (exportAfterSave) {
        exportAfterSave = false;
        sessionBusy = false;
        await runExport();
      }
    } catch (error) {
      toast(`Could not save the comparison: ${error.message}`, 'danger', 6500);
    } finally {
      // an export waiting on this save runs above or not at all
      exportAfterSave = false;
      sessionBusy = false;
    }
  }

  function closeSaveDialog() {
    saveDialog = false;
    exportAfterSave = false;
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

  function applySide(target, sentinel, wayback, saved, radar) {
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
    radar.pick(saved?.radar?.date ? saved.radar : null);
    target.present = Boolean(saved?.present);
    target.refused = false;
  }

  async function openSession(name) {
    if (!caseState.current || sessionBusy) return;
    const caseId = caseState.current.id;
    sessionBusy = true;
    sessionDialog = false;
    presetRequest++;
    pristineSignature = null;
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
      mode = compareMode(spec.mode);
      // Difference used to be a mode of its own, laid over the pair side by side.
      difference = spec.difference === true || spec.mode === 'change';
      differenceOpen = false;
      // A reopened session reads nothing it has not been asked to, bands included.
      changeReadScope = '';
      divider = percentage(spec.divider, DEFAULT_DIVIDER);
      opacity = percentage(spec.opacity, DEFAULT_OPACITY);
      changeOptions = changeSettings(spec.change_assist);
      blinkInterval = spec.blink?.interval ?? 800;
      annotations = comparisonAnnotations(spec.annotations);
      exportFrame = exportFrameSpec(spec.frame);
      resetAnnotationHistory();
      applySide(a, s2a, wba, spec.a, s1a);
      applySide(b, s2b, wbb, spec.b, s1b);
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
      pristineSignature = pairSignature();
      if (difference) void refreshChangeAssist({ fetch: false });
      toast(`Opened ${sessionName}`, 'ok');
    } catch (error) {
      toast(`Could not open the comparison: ${error.message}`, 'danger');
    } finally {
      sessionBusy = false;
    }
  }

  /**
   * Open on a pair the map already chose: two dated views of one point.
   *
   * The same road a saved comparison takes — `applySide` for each side, then the
   * camera — because a handoff and a session say the same thing. It arrives
   * unsaved and unnamed: nothing was filed, the analyst is being shown a pair.
   */
  async function openPair(pair) {
    presetRequest++;
    pristineSignature = null;
    view = { lat: pair.lat, lon: pair.lon, zoom: pair.zoom ?? view.zoom };
    bearing = 0;
    mode = 'side';
    difference = false;
    annotations = comparisonAnnotations(null);
    resetAnnotationHistory();
    applySide(a, s2a, wba, pair.a, s1a);
    applySide(b, s2b, wbb, pair.b, s1b);
    sessionName = pair.title ?? 'Comparison';
    openedSession = null;
    savedSignature = null;
    await tick();
    for (const target of [a, b]) {
      target.engine?.setView(view, view.zoom);
      target.engine?.setBearing(0);
    }
    a.engine?.resize();
    b.engine?.resize();
  }

  /**
   * The camera this window's map tabs share (`lib/map/sharedView.js`), taken
   * when this tab shows. One map takes it and the link brings the other along;
   * with neither built, the camera they will open on moves.
   *
   * A saved comparison follows too: its camera is not an edit (see
   * `pristineSignature`), and holding it would send the other tabs back to it.
   */
  const share = shareView('compare', { state: uiState, enabled: () => prefs.mapSync });

  $effect(() => {
    uiState.mapView;
    if (uiState.tool !== 'compare' || !home) return;
    untrack(() => {
      const engine = a.engine ?? b.engine;
      const next = share.pending(engine ? engine.camera() : { ...view, bearing });
      if (!next) return;
      if (engine) engine.setCamera(next);
      else {
        view = { lat: next.lat, lon: next.lon, zoom: next.zoom };
        bearing = next.bearing ?? 0;
      }
    });
  });

  // Another map tab asked to look here: the camera goes, the two pictures stay.
  // A surface not built yet opens on `view`; one already up is moved.
  $effect(() => {
    const asked = uiState.lookAt;
    if (uiState.tool !== 'compare' || asked?.tool !== 'compare' || !home) return;
    untrack(() => {
      uiState.lookAt = null;
      const zoom = Number.isFinite(asked.zoom) ? asked.zoom : view.zoom;
      view = { lat: asked.lat, lon: asked.lon, zoom };
      for (const target of [a, b]) target.engine?.setView(view, zoom);
    });
  });

  $effect(() => {
    if (uiState.tool !== 'compare' || !uiState.compareAt || !imagery.providers.length) return;
    const pair = uiState.compareAt;
    uiState.compareAt = null;
    if (discardable) {
      discardTarget = { kind: 'pair', pair };
      return;
    }
    void openPair(pair);
  });

  function requestOpenSession(name) {
    if (discardable) {
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

  /** Start over on a preset, the default one unless another is named. */
  function newComparison(preset = availablePresets(imagery.providers).find((entry) => entry.id === DEFAULT_PRESET)) {
    presetRequest++;
    pristineSignature = null;
    a.present = false;
    b.present = false;
    a.overlays = [];
    b.overlays = [];
    a.firms = freshFirms();
    b.firms = freshFirms();
    a.night = freshNight();
    b.night = freshNight();
    mode = 'side';
    difference = false;
    divider = DEFAULT_DIVIDER;
    opacity = DEFAULT_OPACITY;
    changeOptions = changeSettings();
    blinkInterval = 800;
    changeResult = null;
    changeUrl = '';
    changeRequest++;
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
    if (preset) return applyPreset(preset);
  }

  function requestNewComparison(preset) {
    newMenu = false;
    if (discardable) {
      discardTarget = { kind: 'new', preset };
      return;
    }
    newComparison(preset);
  }

  /**
   * Throw the edits away and keep the work: a saved comparison goes back to the
   * version on disk. One that never was has nothing to go back to, so New is
   * its way to start over.
   */
  function requestRevert() {
    if (!openedSession || !discardable || sessionBusy) return;
    discardTarget = { kind: 'revert', name: openedSession.name };
  }

  function confirmDiscard() {
    const target = discardTarget;
    discardTarget = null;
    if (target?.kind === 'new') newComparison(target.preset);
    else if (target?.kind === 'pair') void openPair(target.pair);
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
  /** A reading asked for (Read, a choice) that has not landed yet: bands are allowed until it does. */
  let changeAsked = false;
  let changeRenderedKey = $state('');
  const detectionKey = $derived(changeKey());

  const changeFrames = $derived(changeNeedsFrames(changeSettings(changeOptions), changeStatus));
  // What Read can honestly say: its move ("due"), the reading's, or nothing left to do.
  const changeState = $derived(
    changeTiles ? 'tiles'
      : changeBusy || changePending ? 'reading'
        : changeResult && !changeError && changeRenderedKey === detectionKey ? 'current'
          : 'due');

  /** What a reading reads, the camera aside: the pair and the analysis settings. */
  function changeScope() {
    const { opacity, base, blink, zones, ...analysis } = changeSettings(changeOptions);
    return JSON.stringify([changeSide(a, s2a, wba, shownA, s1a), changeSide(b, s2b, wbb, shownB, s1b), analysis]);
  }

  function changeKey() {
    return JSON.stringify([changeScope(), view, bearing]);
  }

  /** The scope the last reading landed for: once read, a pair's bands follow the camera. */
  let changeReadScope = '';
  /** How long the camera rests past the held ground before its bands are fetched again. */
  const CHANGE_REST_MS = 700;

  function invalidateChangeAssist() {
    changeRenderedKey = '';
    if (!difference) return;
    // A reading that follows the camera runs on the band frames already held;
    // past them it waits for the camera to rest (see `refreshChangeAssist`).
    clearTimeout(changeTimer);
    changePending = true;
    changeTimer = setTimeout(() => void refreshChangeAssist({ fetch: false }), 180);
  }

  /** Difference's index reading, kept as an analyzer of your own in Detect. */
  async function saveAsAnalyzer() {
    try {
      const saved = await api.post('/api/compare/analyzers', fromDifference(changeOptions));
      toast(`${saved.name} is in your Detect analyzers`, 'ok', 7000, {
        label: 'Open in Detect',
        onClick: () => { uiState.openAnalyzer = `analyzer:${saved.id}`; uiState.tool = 'detect'; },
      });
    } catch (error) {
      toast(error.message, 'danger');
    }
  }

  const tilesLoading = () => [a, b].some((side) => side.engine?.tilesLoading?.());
  // A map that can say it is loading can be waited on: its capture waits for
  // the tiles itself, so trying again is never a spin.
  const canWaitForTiles = () => [a, b].every((side) => typeof side.engine?.tilesLoading === 'function');

  async function refreshChangeAssist({ fetch = true } = {}) {
    // This reading replaces the one waiting to follow the camera, which would
    // otherwise start 180 ms in and throw away a Read still fetching its bands.
    clearTimeout(changeTimer);
    changePending = false;
    // A read that was asked for and then overtaken by a move hands its ask to
    // the reading that took over: Read reads the view the camera settles on,
    // where it once spent the request and then threw the answer away.
    const allowed = fetch || changeAsked;
    changeAsked = false;
    if (!difference || !changeStatus.ok) return;
    if (!changeStatus.methods.includes(changeOptions.method)) { changeError = 'Choose a compatible method'; return; }
    const key = changeKey();
    if (key === changeRenderedKey && changeResult) return;
    changeAsked = allowed;
    const settings = changeSettings(changeOptions);
    const sides = [changeSide(a, s2a, wba, shownA, s1a), changeSide(b, s2b, wbb, shownB, s1b)];
    const request = ++changeRequest;
    changeBusy = true;
    changeError = '';
    try {
      await tick();
      await twoPaints();
      if (request !== changeRequest || key !== changeKey()) return;
      // Tiles in flight are waited out, however long they take: a reading that
      // gave up on them left the analyst to guess that Read would now work.
      let sources = null;
      while (!sources) {
        changeTiles = tilesLoading();
        try {
          sources = await sourceCanvases();
        } catch (error) {
          if (!(error instanceof TilesLoading) || !canWaitForTiles()) throw error;
        }
        if (request !== changeRequest || key !== changeKey()) return;
      }
      changeTiles = false;
      const result = await detectCaptures(sources, settings, sides, changeStatus, allowed);
      if (request !== changeRequest || !difference || key !== changeKey()) return;
      // Nothing held reaches this view. A pair already read with its bands
      // follows the camera with them: once it rests, they are fetched again, as
      // the tiles it just drew were. A new pair, another date or a reopened
      // session waits for Read, the last reading up and marked out of date.
      if (result.needsFetch) {
        if (changeScope() === changeReadScope) {
          changePending = true;
          changeTimer = setTimeout(() => void refreshChangeAssist(), CHANGE_REST_MS);
        }
        return;
      }
      changeResult = result;
      placeChangeMap();
      changeUrl = result.canvas.toDataURL('image/png');
      changeRenderedKey = key;
      changeReadScope = changeScope();
    } catch (error) {
      if (request !== changeRequest) return;
      changeResult = null;
      changeUrl = '';
      changeError = error?.message ?? 'Could not compare these pixels';
    } finally {
      if (request === changeRequest) {
        changeBusy = false;
        changeTiles = false;
        changeAsked = false;
      }
    }
  }

  $effect(() => {
    if (!difference || uiState.tool !== 'compare') {
      changeRequest++;
      changePending = false;
      changeAsked = false;
      if (!difference) changeReadScope = '';
      return;
    }
    if (!changeStatus.ok) {
      changeRequest += 1;
      changeAsked = false;
      changeResult = null;
      changeUrl = '';
      changeError = changeStatus.reason;
      changeBusy = false;
      changeTiles = false;
      changePending = false;
      return;
    }
    detectionKey;
    changeRequest++;
    changeBusy = false;
    changeTiles = false;
    clearTimeout(changeTimer);
    changePending = true;
    changeTimer = setTimeout(() => void refreshChangeAssist({ fetch: false }), 180);
    return () => clearTimeout(changeTimer);
  });

  const selectedAnnotation = $derived(
    annotations.find((mark) => mark.id === selectedAnnotationId) ?? null
  );
  /**
   * The selection as the rail edits it: only Select edits what is already drawn.
   *
   * A stamp keeps the tool in hand and leaves the mark it put down selected, so
   * without this a colour picked for the *next* marker recoloured the last one —
   * and its series never started back at 1. The Proof Maker's rail follows the
   * same rule.
   */
  const editableAnnotation = $derived(
    annotationTool === 'select' ? selectedAnnotation : null
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
    if (!editableAnnotation) return;
    setAnnotations(annotations.map((mark) =>
      mark.id === editableAnnotation.id ? { ...mark, ...patch } : mark
    ));
  }

  function setAnnotationColour(value) {
    annotationColour = value;
    if (!editableAnnotation) return;
    // A marker belongs to its colour's series, so one recoloured takes the first
    // number free in the series it joins (`nextMarkNumber`, and the same rule the
    // Proof Maker's rail follows).
    patchSelectedAnnotation(
      editableAnnotation.kind === 'number' && editableAnnotation.colour !== value
        ? { colour: value, number: nextMarkNumber(annotations, value) }
        : { colour: value }
    );
  }

  /** How heavy a symbol's own line is. Its size is the slider beside it. */
  function setAnnotationOutline(value) {
    if (editableAnnotation) patchSelectedAnnotation({ stroke_width: value });
    else annotationStroke = value;
  }

  // A note and a stamp are sized by their own number: neither has a line to
  // widen, so the one slider on the rail sets that instead.
  const sizedByFont = (kind) => kind === 'text' || STAMPED.has(kind);

  function setAnnotationStroke(value) {
    if (editableAnnotation) {
      patchSelectedAnnotation(
        sizedByFont(editableAnnotation.kind) ? { font_size: value } : { stroke_width: value }
      );
    } else if (sizedByFont(annotationTool)) {
      annotationStampSize = value;
    } else {
      annotationStroke = value;
    }
  }

  function setAnnotationFill(value) {
    annotationFill = value;
    if (editableAnnotation && canFill(editableAnnotation.kind)) {
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
    // Read off the rail itself, so a tool added there answers to its own letter
    // without a second list to keep in step.
    const shortcuts = Object.fromEntries(
      ANNOTATION_TOOLS.map((entry) => [entry.shortcut.toLowerCase(), entry.id])
    );
    const onKey = (event) => {
      if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      const key = event.key.toLowerCase();
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        const reading = COMPARE_MODES.find((entry) => entry.key === key);
        if (reading) { setMode(reading.id); return; }
        if (key === DIFFERENCE_KEY && (difference || changeStatus.ok)) { setDifference(!difference); return; }
        if (key === ' ' && mode === 'blink') { event.preventDefault(); blinkPaused = !blinkPaused; return; }
        if (key === '[') { railFolded = !railFolded; return; }
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
    actionsFor(both ? ['lookup', 'place', 'measure', 'horizon'] : ['lookup', 'place', 'horizon'])
  );
  const pointTools = otherMapTools('compare');

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

  /**
   * A right-click on a mark opens the point menu under it, as on bare ground.
   *
   * Marks are drawn beside the map element rather than inside it, so the
   * engine never hears a press on one, and the browser's own menu opened over
   * the shape instead.
   */
  function onOverlayMenu(side, event) {
    const { engine, element } = side === 'a' ? a : b;
    if (!engine || !element || !event.target?.closest?.('.annotation-canvas')) return;
    event.preventDefault();
    const box = element.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    const at = engine.containerPointToLatLng({ x, y });
    onMapContextMenu(side, { lat: at.lat, lon: ((at.lon + 540) % 360) - 180, x, y });
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
      await copyText(value);
    } else if (id === 'place') {
      openNewPlaceAt(point);
    } else if (id === 'measure') {
      annotationTool = 'measure';
      await tick();
      (side === 'a' ? canvasA : canvasB)?.startFrom([point.lon, point.lat]);
      toast('Click the far end of the measure', 'info', 4000);
    } else if (id === 'horizon') {
      lookFrom(point);
    } else if (id === 'goto') {
      openMapAt(value, { ...point, zoom: view.zoom });
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

  /** A capture taken with tiles still in flight: a reading waits, an export says so. */
  class TilesLoading extends Error {
    constructor() {
      super('Some tiles are still loading. Try again');
    }
  }

  async function sourceCanvases() {
    if (!both || !a.ready || !b.ready) {
      throw new Error('both maps must be ready before they can be exported');
    }
    if (!hasWidget) {
      const frames = [surfaceFrame(a), surfaceFrame(b)];
      const captures = await Promise.all([a.engine.snapshot(), b.engine.snapshot()]);
      if (captures.some((capture) => !capture.complete)) throw new TilesLoading();
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
    const span = frameSpan(value.points, value.angle ?? 0);
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
    { renderMode = mode, renderBlinkB = blinkB, renderChangeMap = null, renderSigned = false } = {}
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
      signed: renderSigned,
      // A framed export comes out upright at the bearing its frame was drawn at.
      // A frame counts the compass direction that is up; the app counts the
      // map's clockwise turn, the same angle the other way.
      bearing: compassAngle(-sources.a.frame.bearing),
    });
  }

  /** The difference an export carries: none when it is off, this view's when on. */
  async function exportedChange() {
    if (!difference) return null;
    if (!changeStatus.ok) throw new Error(changeStatus.reason);
    if (changeRenderedKey !== changeKey() || !changeResult) {
      clearTimeout(changeTimer);
      await refreshChangeAssist({ fetch: changeFrames !== '' });
    }
    if (changeRenderedKey !== changeKey() || !changeResult) {
      throw new Error('Read the difference for this view before exporting');
    }
    return changeResult;
  }

  async function comparisonBlob({ signed = false } = {}) {
    const renderChangeMap = await exportedChange();
    const sources = await exportSources();
    return canvasBlob(compose(sources, { renderChangeMap, renderSigned: signed }));
  }

  /** When each picture on screen was taken, as the surfaces that drew them say. */
  function pictureDates() {
    return { a: a.surface?.provenance?.() ?? {}, b: b.surface?.provenance?.() ?? {} };
  }

  // What the topbar's Add event offers here: each picture's day, and the span
  // between them, read when the bar opens.
  offerNote('compare', null, {
    dates: () => {
      const { a: first, b: second } = pictureDates();
      const side = (picture) =>
        picture.imageryWhen ? { value: picture.imageryWhen, exact: picture.imageryExact } : null;
      return pairOffers(side(first), side(second), {
        interval: changeInterval,
        label: (value) => formatTemporalValue(value).label,
      });
    },
  });
  onDestroy(() => withdrawNote('compare'));

  /** The export's name: the comparison's, then the two pictures' dates. */
  function exportName() {
    const { a: first, b: second } = pictureDates();
    return comparisonFilename(sessionName, { a: first.imageryWhen, b: second.imageryWhen });
  }

  /** Keep the colours visible in this comparison while the GIF is quantized. */
  function gifKeepColours({ signed = false } = {}) {
    return gifColours(annotations, {
      signed,
      changePalette: difference ? changeSettings(changeOptions).palette : null,
    });
  }

  async function saveWorkingPreview(caseId, name) {
    const form = new FormData();
    // The saved image files the date of each picture it shows, as a capture does.
    for (const [field, value] of pictureDateFields(pictureDates())) form.append(field, value);
    if (mode === 'blink') {
      const renderChangeMap = await exportedChange();
      const sources = await exportSources();
      const frameA = await canvasBlob(compose(sources, { renderMode: 'blink', renderBlinkB: false, renderChangeMap }));
      const frameB = await canvasBlob(compose(sources, { renderMode: 'blink', renderBlinkB: true, renderChangeMap }));
      form.append('image_a', frameA, 'comparison-a.png');
      form.append('image_b', frameB, 'comparison-b.png');
      form.append('format', 'blink');
      form.append('interval', String(blinkInterval));
      form.append('keep', gifKeepColours());
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

  /**
   * File the export just written as an image of this comparison in the case.
   * It carries the reading on screen, not the saved one, since that is what it
   * shows. Answers what the toast adds, and says so itself when it fails: the
   * copy on disk is already written either way.
   */
  async function keepExport(caseId, format, imageA, imageB = null) {
    if (!keepInCase || !openedSession) return '';
    const form = new FormData();
    form.append('image_a', imageA, 'comparison-a.png');
    if (imageB) form.append('image_b', imageB, 'comparison-b.png');
    form.append('format', format);
    form.append('interval', String(blinkInterval));
    if (format !== 'png') form.append('keep', gifKeepColours({ signed: signExport }));
    form.append('filename', exportName());
    form.append('spec', JSON.stringify(sessionSpec()));
    for (const [field, value] of pictureDateFields(pictureDates())) form.append(field, value);
    try {
      await api.post(
        `/api/cases/${caseId}/compare/sessions/${encodeURIComponent(openedSession.name)}/images`,
        form,
      );
      await reloadCase();
      return ' and kept in the case';
    } catch (error) {
      toast(`Exported, but not kept in the case: ${error.message}`, 'warn', 7000);
      return '';
    }
  }

  async function exportPng() {
    if (outputBusy) return;
    outputBusy = 'png';
    try {
      const owner = await ensureCase();
      const blob = await comparisonBlob({ signed: signExport });
      const result = await api.post(`/api/cases/${owner.id}/plates`, {
        filename: exportName(),
        format: 'png',
        png: await blobBase64(blob),
        // Named by its pictures' dates, which another comparison of the pair shares.
        overwrite: false,
      });
      const kept = await keepExport(owner.id, 'png', blob);
      rightPanel = null;
      toast(`${result.file} written to ${destinationLabel(result.path)}${kept}`, 'ok', 5200, {
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
      const renderChangeMap = await exportedChange();
      const sources = await exportSources();
      const blink = { renderMode: 'blink', renderChangeMap, renderSigned: signExport };
      const frameA = await canvasBlob(compose(sources, { ...blink, renderBlinkB: false }));
      const frameB = await canvasBlob(compose(sources, { ...blink, renderBlinkB: true }));
      const form = new FormData();
      form.append('image_a', frameA, 'comparison-a.png');
      form.append('image_b', frameB, 'comparison-b.png');
      form.append('animation', animation);
      form.append('interval', String(blinkInterval));
      form.append('keep', gifKeepColours({ signed: signExport }));
      form.append('filename', exportName());
      const result = await api.post(`/api/cases/${owner.id}/compare/gif`, form);
      const kept = await keepExport(owner.id, animation, frameA, frameB);
      rightPanel = null;
      toast(`${result.file} written to ${destinationLabel(result.path)}${kept}`, 'ok', 5200, {
        label: 'Show',
        onClick: () => showExports(),
      });
    } catch (error) {
      outputError('GIF export failed', error);
    } finally {
      outputBusy = '';
    }
  }

  /**
   * The ground and scale an evolution is drawn at: the export frame, or A's view,
   * at the screen's density held under the GIF's edge, or shared out across a sheet.
   */
  function evolutionPlan(kind, count) {
    const target = a.engine ? a : b.engine ? b : null;
    if (!target) return null;
    const frame = evolutionFrame(surfaceFrame(target), exportFrame);
    const density = window.devicePixelRatio || 1;
    const pixelScale = kind === 'sheet'
      ? sheetCellScale(frame, count, density)
      : pictureScale(frame, GIF_EDGE, density);
    return { frame, pixelScale };
  }

  /**
   * A side as the evolution picker reads it: with its Wayback release's date, and
   * a Sentinel-2 side on its latest pass named by that pass's day.
   */
  function evolutionSide(target, sentinel, wayback, radar) {
    const spec = sideSpec(target, sentinel, wayback, radar);
    if (target.providerId === WAYBACK_ID) return { ...spec, wayback_date: wayback.date };
    return { ...spec, sentinel: { ...spec.sentinel, date: sentinel.day } };
  }

  /** The ground a picker row's picture shows: the evolution's centre, at its scale. */
  const evolutionThumbView = $derived.by(() => {
    if (!evolutionKind || rightPanel !== 'export' || !evolution) return null;
    void [view, bearing, exportFrame];
    const plan = evolutionPlan('evolution', 2);
    if (!plan) return null;
    // The frame counts the engine's zoom, one level short of the app's.
    return { lat: plan.frame.lat, lon: wrapLon(plan.frame.lng), zoom: plan.frame.zoom + 1, viewWidth: plan.frame.width };
  });

  /** Tiles one picture of the evolution takes as the export stands, for its price. */
  const evolutionTiles = $derived.by(() => {
    if (!evolutionKind || rightPanel !== 'export' || !evolution) return 0;
    void [view, bearing, exportFrame];
    const plan = evolutionPlan(exportKind, Math.max(2, evolutionChosen.length));
    return plan ? pictureTiles(plan.frame, imagery.find(evolution), plan.pixelScale).tiles.length : 0;
  });

  function closeExport() {
    evolutionAbort?.abort();
    rightPanel = null;
  }

  $effect(() => () => evolutionAbort?.abort());

  /** What was left out of an evolution, said in the toast that reports it. */
  function leftOut({ empty, repeated }) {
    const parts = [];
    if (repeated) parts.push(`${repeated} repeated ${repeated === 1 ? 'picture' : 'pictures'}`);
    if (empty) parts.push(`${empty} with no imagery here`);
    return parts.length ? ` (left out: ${parts.join(', ')})` : '';
  }

  async function exportEvolution(kind) {
    if (outputBusy || !evolution) return;
    const pictures = [...evolutionChosen];
    if (pictures.length < 2 || pictures.length > MAX_EVOLUTION_FRAMES) {
      toast(`An evolution plays 2 to ${MAX_EVOLUTION_FRAMES} pictures`, 'warn');
      return;
    }
    const plan = evolutionPlan(kind, pictures.length);
    if (!plan) {
      toast('Open a map before exporting', 'warn');
      return;
    }
    const controller = new AbortController();
    evolutionAbort = controller;
    outputBusy = 'evolution';
    evolutionProgress = { done: 0, total: pictures.length };
    const archiveId = evolution;
    const provider = imagery.find(archiveId);
    const label = provider?.label ?? (archiveId === WAYBACK_ID ? 'Esri Wayback' : 'Sentinel-2');
    const common = {
      title: sessionName,
      label,
      attribution: provider?.attribution,
      annotations,
      units: prefs.units,
      signed: signExport,
    };
    const positions = timelinePositions(pictures.map((entry) => entry.date));
    const frames = [];
    const cells = [];
    try {
      const owner = await ensureCase();
      const tally = await drawPictures({
        entries: pictures,
        frame: plan.frame,
        pixelScale: plan.pixelScale,
        provider,
        variantFor: evolutionVariant,
        signal: controller.signal,
        onprogress: (done, total) => (evolutionProgress = { done, total }),
        onpicture: async ({ entry, picture, index }) => {
          const date = pictureLabel(archiveId, entry);
          if (kind === 'sheet') cells.push({ picture, date });
          else frames.push(await canvasBlob(composeEvolutionFrame({ ...common, picture, date, current: index, positions })));
        },
      });
      if (tally.drawn < 2) throw new Error(`fewer than two distinct pictures of this ground came back${leftOut(tally)}`);
      const name = comparisonFilename(sessionName, { a: pictures[0].date, b: pictures.at(-1).date });
      let result;
      if (kind === 'sheet') {
        const span = `${pictures[0].date} to ${pictures.at(-1).date}`;
        const blob = await canvasBlob(composeEvolutionSheet({ ...common, cells, span }));
        result = await api.post(`/api/cases/${owner.id}/plates`, {
          filename: `${name} evolution`,
          format: 'png',
          png: await blobBase64(blob),
          overwrite: false,
        }, { signal: controller.signal });
      } else {
        const form = new FormData();
        frames.forEach((blob, index) => form.append('frames', blob, `evolution-${index + 1}.png`));
        form.append('interval', String(evolutionInterval));
        form.append('filename', name);
        form.append('keep', gifColours(annotations.filter((mark) => mark.side === 'both'), { signed: signExport }));
        result = await api.post(`/api/cases/${owner.id}/compare/sequence`, form, { signal: controller.signal });
      }
      rightPanel = null;
      toast(`${result.file} written to ${destinationLabel(result.path)}${leftOut(tally)}`, 'ok', 7000, {
        label: 'Show',
        onClick: () => showExports(),
      });
    } catch (error) {
      if (error?.name === 'AbortError') toast('Evolution export stopped', 'info');
      else outputError('Evolution export failed', error);
    } finally {
      if (archiveId !== WAYBACK_ID) imagery.refreshUsage();
      if (evolutionAbort === controller) evolutionAbort = null;
      outputBusy = '';
      evolutionProgress = null;
    }
  }

  async function runExport() {
    if (evolutionKind) {
      await exportEvolution(exportKind);
      return;
    }
    if (keepInCase && !openedSession) {
      exportAfterSave = true;
      saveDialog = true;
      return;
    }
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
      const blob = await comparisonBlob({ signed: signExport });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('Comparison copied as an image', 'ok');
    } catch (error) {
      outputError('Could not copy the comparison', error);
    } finally {
      outputBusy = '';
    }
  }
</script>

<div class="tool compare-tool" class:grabbing inert={sessionBusy} bind:this={toolEl}>
  <!-- One row above the maps. With a pair on screen the reading modes take the
       title's place, since the tab strip already says which tool this is. -->
  <div class="tool-header">
    {#if both}
      <ModeDock {mode} {difference} differenceable={difference || changeStatus.ok}
        onmode={setMode} ondifference={setDifference} onswap={swapSides} />
      <button class="btn btn-sm" class:active={stripOpen} disabled={!archive} aria-pressed={stripOpen}
        onclick={() => (stripOpen = !stripOpen)}
        title={archive ? 'Every dated picture of this point'
          : 'Show the same dated archive on A and B to list its pictures'}>
        <Icon name="clock" size={13} /> All dates
      </button>
    {:else}
      <h2>Compare</h2>
    {/if}
    {#if !a.present && !b.present}
      <span class="sub">Two imagery views, one shared camera</span>
    {/if}
    <div class="spacer"></div>
    <!-- The name sits with the acts that save and discard it. -->
    {#if a.present || b.present}
      {#if discardable}<span class="badge">unsaved</span>{/if}
      <input
        class="input title-input session-title"
        bind:value={sessionName}
        maxlength="200"
        aria-label="Comparison name"
        title="Rename this comparison"
        onkeydown={(event) => event.key === 'Enter' && requestSaveSession()}
      />
    {/if}
    <button class="btn btn-sm" onclick={openSessionList} disabled={!caseState.current || sessionBusy} title="Open a saved comparison">
      <Icon name="folderOpen" size={13} /> Open
    </button>
    {#if openedSession && discardable}
      <button class="btn btn-sm" onclick={requestRevert} disabled={sessionBusy} title="Go back to the saved version">
        <Icon name="undo" size={13} /> Revert
      </button>
    {/if}
    {#if a.present || b.present}
      <div class="new-wrap" bind:this={newMenuEl}>
        <button class="btn btn-sm" onclick={() => (newMenu = !newMenu)} title="Start a new comparison"
          aria-expanded={newMenu} aria-haspopup="menu">
          <Icon name="plus" size={13} /> New <Icon name="chevronDown" size={11} />
        </button>
        {#if newMenu}
          <div class="new-menu card" role="menu">
            {#each availablePresets(imagery.providers) as preset}
              <button class="new-row" role="menuitem" onclick={() => requestNewComparison(preset)}>
                <strong>{preset.label}</strong><span>{preset.hint}</span>
              </button>
            {/each}
            {#each lockedPresets as preset (preset.id)}
              <button class="new-row locked" role="menuitem" onclick={() => askCopernicus(preset.a, preset.label)}>
                <strong>{preset.label} <small>set up</small></strong><span>Needs a free Copernicus setup</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
    {#if both}
      <button class="btn btn-sm" onclick={() => toggleRightPanel('export')} disabled={!a.ready || !b.ready || !!outputBusy}>
        <Icon name="download" size={13} /> Export
      </button>
    {/if}
    <button
      class="btn btn-primary btn-sm"
      onclick={requestSaveSession}
      disabled={!both || sessionBusy || !sessionDirty}
      title="Keep this editable comparison in the case"
    >
      <Icon name="save" size={13} /> {sessionBusy ? 'Saving…' : 'Save'}
    </button>
    <button
      class="btn btn-sm btn-ghost"
      aria-pressed={fullscreen}
      onclick={switchFullscreen}
      title={fullscreen ? 'Back to the window (Esc)' : 'Compare on the whole screen'}
      aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
    ><Icon name={fullscreen ? 'minimize' : 'maximize'} size={13} /></button>
  </div>

  {#if !a.present && !b.present}
    <div class="presets">
      {#each availablePresets(imagery.providers) as preset}
        <button class="btn btn-sm" title={preset.hint} onclick={() => applyPreset(preset)}>{preset.label}</button>
      {/each}
      {#each lockedPresets as preset (preset.id)}
        <button class="btn btn-sm locked" title={`${preset.hint}. Needs a free Copernicus setup`}
          onclick={() => askCopernicus(preset.a, preset.label)}>{preset.label} <small>set up</small></button>
      {/each}
    </div>
  {/if}
  <div class="compare-workspace">
  {#if both}
    <AnnotationToolbar
      bind:collapsed={railFolded}
      bind:tool={annotationTool}
      selected={editableAnnotation}
      canUndo={annotationUndo.length > 0}
      canRedo={annotationRedo.length > 0}
      undo={undoAnnotation}
      redo={redoAnnotation}
      palette={ANNOTATION_COLOURS}
      colour={annotationColour}
      glyph={annotationGlyph}
      stampSize={annotationStampSize}
      setGlyph={(name) => { annotationGlyph = name; if (editableAnnotation?.kind === 'icon') patchSelectedAnnotation({ glyph: name }); }}
      strokeWidth={annotationStroke}
      fillOpacity={annotationFill}
      setColour={setAnnotationColour}
      setStroke={setAnnotationStroke}
      setOutline={setAnnotationOutline}
      setFill={setAnnotationFill}
      bind:side={annotationSide}
      setSide={(value) => { annotationSide = value; if (editableAnnotation) patchSelectedAnnotation({ side: value }); }}
      removeSelected={() => {
        if (selectedAnnotationId) setAnnotations(annotations.filter((mark) => mark.id !== selectedAnnotationId));
        selectedAnnotationId = null;
      }}
      clear={() => { setAnnotations([]); selectedAnnotationId = null; }}
      count={annotations.length}
    />
  {/if}

  <div class="stage-column">
  <div
    class="compare-stage"
    class:overlay={both && mode !== 'side'}
    class:swipe={both && mode === 'swipe'}
    class:blended={both && mode === 'opacity'}
    class:capturing={grabbing}
    class:capture-a={captureSide === 'a'}
    class:capture-b={captureSide === 'b'}
    class:docked={differenceDocked}
    style:--divider={`${divider}%`}
    style:--opacity={opacity / 100}
    style:--change-opacity={changeOpacity / 100}
    bind:this={stageEl}
  >
    <!-- The cards float over the maps they describe, one column per pane, so
         the seam between A and B is one line and no bar takes the maps'
         height. The view's own controls ride in B's corner. -->
    {#if a.present || b.present}
      <div class="source-bar" aria-label="Compared imagery">
        {#if a.present}
          <SourceCard letter="A" {imagery} bind:providerId={a.providerId} s2={s2a} wayback={wba} s1={s1a}
            shown={shownA} dated={a.dated} layerCount={a.overlays.length} layersOpen={rightPanel === 'layers'}
            onlayers={() => toggleRightPanel('layers')} onremove={() => remove('a')} />
        {:else}<button class="source-add cmp-glass" onclick={() => (picking = 'a')}>A · Add imagery</button>{/if}
        <div class="source-b">
          {#if b.present}
            <SourceCard letter="B" {imagery} bind:providerId={b.providerId} s2={s2b} wayback={wbb} s1={s1b}
              shown={shownB} dated={b.dated} align="right" layerCount={b.overlays.length} layersOpen={rightPanel === 'layers'}
              onlayers={() => toggleRightPanel('layers')} onremove={() => remove('b')} />
          {:else}<button class="source-add cmp-glass" onclick={() => (picking = 'b')}>B · Add imagery</button>{/if}
          <!-- Stacked in the corner as Detect's column is: where to go, then how
               the shared camera stands. -->
          <div class="view-col">
            <div class="search-chip cmp-glass">
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
            </div>
            {#if both}
              <div class="camera-chip cmp-glass">
                <span class="camera-readout mono" title="Zoom level of both maps">z{Number(view.zoom).toFixed(1)}</span>
                <!-- One camera, so one compass: it turns both maps and resets them. -->
                <Compass {bearing} onbearing={(deg) => primeEngine?.setBearing(deg)} />
              </div>
            {/if}
          </div>
        </div>
      </div>
    {/if}
    {#if a.present && home}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="surface-shell primary" oncontextmenu={(event) => onOverlayMenu('a', event)}>
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
          s1={s1a}
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
          onoverlaytrouble={(id) => id === 'firms' && fireTrouble()}
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
              tools={pointTools}
              lookup={pointMenu.lookup}
              {fullscreen}
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
              {fullscreen}
              onopen={openSaved}
              onedit={editSaved}
              onrefresh={reloadCase}
            />
          {/if}
        </MapSurface>
        <!-- The mask is ground, not screen: it is laid on each map through that
             map's own frame, so "Both" shows one reading over two pictures. -->
        {#if both && difference && changeOver('a') && changeUrl && changeVisible}
          <img class="change-map" class:stale={changeState === 'due'} src={changeUrl} alt="Pixel-change heatmap over imagery A"
            style:width={`${changeResult.frame.width}px`} style:height={`${changeResult.frame.height}px`}
            style:transform={changeTransform.a} />
        {/if}
        <!-- Side by side has two coordinate spaces, so A owns the editable
             frame and B shows the matching ground read-only. -->
        {#if both && !grabbing && mode === 'side' && (framing || exportFrame)}
          <ExportFrame engine={a.engine} frame={exportFrame} drawing={framing} units={prefs.units} {bearing}
            onframe={setExportFrame} oncancel={finishFraming} />
        {/if}
        {#if both && !grabbing}
          <AnnotationCanvas bind:this={canvasA} {annotations} engine={a.engine} letter="a" units={prefs.units}
            active={uiState.tool === 'compare'} bind:tool={annotationTool} bind:selectedId={selectedAnnotationId}
            colour={annotationColour} strokeWidth={annotationStroke} fillOpacity={annotationFill}
            glyph={annotationGlyph} stampSize={annotationStampSize}
            editVertices={true} {annotationSide} {bearing} turnable={true} onchange={setAnnotations} />
        {/if}
        {#if rotating?.which === 'a'}
          <TurnGuide x={rotating.x} y={rotating.y} />
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
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="surface-shell secondary"
        class:blink-hidden={mode === 'blink' && !blinkB}
        oncontextmenu={(event) => onOverlayMenu('b', event)}
      >
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
          s1={s1b}
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
          onoverlaytrouble={(id) => id === 'firms' && fireTrouble()}
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
              tools={pointTools}
              lookup={pointMenu.lookup}
              {fullscreen}
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
              {fullscreen}
              onopen={openSaved}
              onedit={editSaved}
              onrefresh={reloadCase}
            />
          {/if}
        </MapSurface>
        {#if both && difference && changeOver('b') && changeUrl && changeVisible}
          <img class="change-map" class:stale={changeState === 'due'} src={changeUrl} alt="Pixel-change heatmap over imagery B"
            style:width={`${changeResult.frame.width}px`} style:height={`${changeResult.frame.height}px`}
            style:transform={changeTransform.b} />
        {/if}
        {#if both && !grabbing && mode === 'side' && exportFrame}
          <ExportFrame engine={b.engine} frame={exportFrame} readonly={true} units={prefs.units} {bearing} />
        {/if}
        {#if both && !grabbing}
          <AnnotationCanvas bind:this={canvasB} {annotations} engine={b.engine} letter="b" units={prefs.units}
            active={uiState.tool === 'compare'} bind:tool={annotationTool} bind:selectedId={selectedAnnotationId}
            colour={annotationColour} strokeWidth={annotationStroke} fillOpacity={annotationFill}
            glyph={annotationGlyph} stampSize={annotationStampSize}
            editVertices={true} {annotationSide} {bearing} turnable={true} onchange={setAnnotations} />
        {/if}
        {#if rotating?.which === 'b'}
          <TurnGuide x={rotating.x} y={rotating.y} />
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

    <!-- Fade, Swipe and Blink stack both maps in one coordinate space. Their frame therefore sits above the
         complete stage, where neither B nor the swipe clip can block it. -->
    {#if both && !grabbing && mode !== 'side' && (framing || exportFrame)}
      <ExportFrame engine={a.engine} frame={exportFrame} drawing={framing} units={prefs.units} {bearing}
        onframe={setExportFrame} oncancel={finishFraming} />
    {/if}

    {#if copernicus}
      <div class="need-over">
        <CopernicusNeeded need={copernicus.need || 'account'} tool={copernicus.tool}
          onclose={() => (copernicus = null)} />
      </div>
    {/if}

    {#if both && difference}
      <div class="change-legend" style={changeSwatches}>
        <span><i class="gain"></i> Appeared / stronger in B</span>
        <span><i class="loss"></i> Disappeared / weaker from A</span>
        <span><i class="changed"></i> Other evolution</span>
        {#if changeState === 'tiles'}<em>Waiting for the tiles…</em>
        {:else if changeState === 'reading'}<em>Reading…</em>
        {:else if changeError}<em class="warn">{changeError}</em>
        {:else if changeState === 'due'}<em class="warn">{changeCounts ? `${changeShare(changeCounts)}% highlighted · out of date, press Read` : 'Not read yet, press Read'}</em>
        {:else if changeCounts}<em>{changeShare(changeCounts)}% highlighted</em>{/if}
      </div>
    {/if}
    {#if differenceDocked}
      <DifferencePanel bind:settings={changeOptions} status={changeStatus} result={changeResult}
        reading={changeState} error={changeError} onrun={() => refreshChangeAssist()} onzone={visitZone}
        onanalyzer={saveAsAnalyzer} onclose={() => (differenceOpen = false)} />
    {/if}

 </div>
  {#if both && stripOpen && archive}
    <PassStrip {archive} a={sideSpec(a, s2a, wba, s1a)} b={sideSpec(b, s2b, wbb, s1b)} {view}
      viewWidth={a.element?.clientWidth ?? 1000} provider={imagery.find(archive)} maxcc={s2b.maxcc}
      variantFor={stripVariant} onassign={assignFromStrip} onbilled={() => imagery.refreshUsage()}
      onclose={() => (stripOpen = false)} />
  {/if}
  </div>

  </div>

  {#if both && (mode !== 'side' || difference)}
    <div class="mode-footer">
      <ModeControl {mode} bind:divider bind:opacity bind:blinkB bind:blinkPaused bind:blinkInterval />
      {#if difference}
        <DifferenceBar bind:settings={changeOptions} bind:open={differenceOpen} status={changeStatus}
          reading={changeState} onrun={() => refreshChangeAssist()} />
      {/if}
    </div>
  {/if}
  {#if rightPanel === 'export'}
    <Modal title="Export a copy" onclose={closeExport} width="540px">
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
          <label class="output-choice" class:selected={exportKind === 'evolution'} class:locked={!evolution}>
            <input type="radio" bind:group={exportKind} value="evolution" disabled={!evolution || !!outputBusy} />
            <Icon name="video" size={17} />
            <span><strong>GIF · Evolution</strong><small>{evolution
              ? 'Every picture you tick, oldest to newest.'
              : 'Needs Sentinel-2 or Wayback on both sides, or Wayback against World Imagery.'}</small></span>
          </label>
          <label class="output-choice" class:selected={exportKind === 'sheet'} class:locked={!evolution}>
            <input type="radio" bind:group={exportKind} value="sheet" disabled={!evolution || !!outputBusy} />
            <Icon name="grid" size={17} />
            <span><strong>PNG · Evolution sheet</strong><small>The same pictures side by side on one page.</small></span>
          </label>
        </div>

        {#if evolutionKind && evolution}
          {#key evolution}
            <EvolutionPicker archive={evolution} a={evolutionSide(a, s2a, wba, s1a)} b={evolutionSide(b, s2b, wbb, s1b)}
              {view} maxcc={s2b.maxcc} perPicture={evolutionTiles} disabled={!!outputBusy}
              provider={imagery.find(evolution)} variantFor={evolutionVariant} thumbView={evolutionThumbView}
              onchoose={(chosen) => (evolutionChosen = chosen)} onbilled={() => imagery.refreshUsage()} />
          {/key}
          {#if exportKind === 'evolution'}
            <label class="pace">
              <span class="field-label">Pace</span>
              <input type="range" min="300" max="3000" step="100" bind:value={evolutionInterval}
                disabled={!!outputBusy} aria-label="Time each picture stays up" />
              <span class="mono">{(evolutionInterval / 1000).toFixed(1)} s a picture</span>
            </label>
          {/if}
          {#if difference}
            <p class="panel-note"><Icon name="info" size={13} /> Difference highlights stay out of an evolution; they read one pair.</p>
          {/if}
        {/if}

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

        {#if evolutionKind}
          <p class="panel-note"><Icon name="info" size={13} /> An evolution is written out only, not kept in the case.</p>
        {:else}
          <label class="keep-choice">
            <input type="checkbox" bind:checked={keepInCase} />
            <span>
              <strong>Also keep it in this case</strong>
              <small>{openedSession
                ? `Filed under ${openedSession.title}, with its dates and point.`
                : 'Saves the comparison first, then files the image under it.'}</small>
            </span>
          </label>
        {/if}

        <label class="keep-choice">
          <input type="checkbox" bind:checked={signExport} />
          <span>
            <strong>Sign it Azimut</strong>
            <small>The logo and name close the credits line, under the imagery.</small>
          </span>
        </label>

        {#if hasWidget}
          <p class="panel-note"><Icon name="info" size={13} /> Google pixels are captured through the Azimut Capture extension.</p>
        {/if}

        <div class="panel-actions">
          <button class="btn" disabled={!!outputBusy} onclick={copyComparison}>
            <Icon name="copy" size={13} /> {outputBusy === 'copy' ? 'Copying…' : 'Copy current PNG'}
          </button>
          {#if outputBusy === 'evolution'}
            <button class="btn" onclick={() => evolutionAbort?.abort()}>
              <Icon name="x" size={13} /> Stop
            </button>
          {/if}
          <button class="btn btn-primary" onclick={runExport}
            disabled={!!outputBusy || (evolutionKind && (evolutionChosen.length < 2 || evolutionChosen.length > MAX_EVOLUTION_FRAMES))}>
            <Icon name="download" size={13} />
            {#if outputBusy === 'evolution' && evolutionProgress}
              {evolutionProgress.done < evolutionProgress.total
                ? `Drawing ${evolutionProgress.done + 1} of ${evolutionProgress.total}…`
                : 'Writing…'}
            {:else}
              {outputBusy === 'png' || outputBusy === 'gif' ? 'Exporting…' : 'Export copy'}
            {/if}
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
          {firesState}
          {firesPaused}
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
          {firesState}
          {firesPaused}
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
        {#if kind.id === 'archive'}
          {#each lockedArchives as [id, label] (id)}
            <button class="provider-card locked" onclick={() => askCopernicus(id, label)}
              title="Free, from a Copernicus account">
              <Icon name="satellite" size={18} />
              <span class="provider-copy">
                <strong>{label}</strong>
                <small>{id === 'sentinel1' && imagery.find('sentinel2') ? 'Needs its layer' : 'Needs a free key'}</small>
              </span>
            </button>
          {/each}
        {/if}
      </div>
        {/if}
      {/each}
    {/if}
  </Modal>
{/if}

{#if saveDialog}
  <Modal title="Save comparison" onclose={closeSaveDialog} width="440px">
    <div class="save-form">
      <label>Name
        <!-- svelte-ignore a11y_autofocus -->
        <input class="input" bind:value={sessionName} maxlength="200" autofocus onkeydown={(event) => event.key === 'Enter' && performSessionSave()} />
      </label>
      <p>Saves every control needed to reopen this view.</p>
      <div class="modal-actions">
        <button class="btn" onclick={closeSaveDialog}>Cancel</button>
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
            <button class="btn btn-ghost btn-xs" onclick={() => deleteSession(saved.name)} aria-label={`Delete ${saved.title}`} title={`Delete ${saved.title}`}><Icon name="trash" size={14} /></button>
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
  /* The fullscreen backdrop is black, and the header draws no background of its own. */
  .tool:fullscreen { background: var(--bg-0); }
  .spacer { flex: 1; }
  .tool-header { min-height: 48px; padding-block: 6px; gap: 8px; }
  .tool-header > :global(*) { flex-shrink: 0; }
  /* The name gives way before any button does, so the row never wraps. */
  /* The shared title field of Inspect and the composers, so it reads as a name
     to type over. It gives way before any button does, so the row never wraps. */
  .tool-header .session-title {
    flex: 0 1 240px;
    width: 240px;
    min-width: 100px;
    height: 28px;
    padding: 3px 10px;
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
  /* Two columns set 8px inside the two panes (1px stage padding, 1px seam), so
     each card sits in its own map's corner. Only the cards take the pointer;
     the map stays grabbable between them. */
  .source-bar {
    position: absolute;
    top: 8px;
    left: 9px;
    right: 9px;
    z-index: 650;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    column-gap: 17px;
    align-items: start;
    pointer-events: none;
  }
  .source-bar > :global(*),
  .source-b > :global(*) { pointer-events: auto; }
  .source-bar > :global(.source-card) { justify-self: start; }
  .source-b {
    grid-column: 2;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 8px;
    min-width: 0;
    pointer-events: none;
  }
  .source-add { justify-self: start; height: 38px; padding: 0 12px; color: var(--text-2); font-size: var(--fs-sm); }
  .source-add:hover { color: var(--text-1); border-color: var(--accent); }
  /* Lifted off the imagery, which can be as dark as the chips themselves. */
  .source-bar :global(.cmp-glass) { box-shadow: var(--shadow-1); }
  .view-col { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; max-width: 100%; margin-left: auto; pointer-events: none; }
  .view-col > * { pointer-events: auto; }
  .search-chip { display: flex; width: min(280px, 24vw); max-width: 100%; padding: 4px; }
  .search-chip :global(.place-search) { flex: 1; }
  .camera-chip { display: flex; align-items: center; gap: 4px; padding: 0 0 0 8px; }
  /* one frame for the pair; a turned camera still rings the compass in amber */
  .camera-chip :global(.rotate-ctl) { background: transparent; backdrop-filter: none; }
  .camera-chip :global(.rotate-ctl:not(.turned)) { box-shadow: none; }
  .camera-readout { color: var(--text-3); font-size: var(--fs-xs); }
  /* The dock is drawn for the map; in the header row its segments stand on
     the row itself, not on a second frame. */
  .tool-header :global(.mode-dock) { padding: 0; border: 0; background: transparent; box-shadow: none; }
  /* Above the stage, which keeps its map layers to itself (see .compare-stage). */
  .mode-footer { position: relative; z-index: 1; display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 8px; padding: 6px; background: var(--bg-1); }
  .presets { display: flex; justify-content: center; gap: 8px; padding: 8px; }
  .locked small { color: var(--accent); }
  .provider-card.locked { opacity: 0.8; }
  .need-over {
    position: absolute;
    inset: 0;
    z-index: 700;
    display: grid;
    place-items: center;
    padding: 16px;
    background: rgb(0 0 0 / 0.4);
  }
  .new-wrap { position: relative; display: flex; }
  .new-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 800;
    display: flex;
    flex-direction: column;
    width: 260px;
    padding: 4px;
    background: var(--bg-1);
    box-shadow: var(--shadow-2);
  }
  .new-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    border-radius: var(--r-sm);
    text-align: left;
    cursor: pointer;
  }
  .new-row:hover { background: var(--bg-3); }
  .new-row strong { font-size: var(--fs-sm); color: var(--text-1); font-weight: 600; }
  .new-row span { font-size: var(--fs-xs); color: var(--text-3); }
  .compare-workspace { display: flex; min-height: 0; flex: 1; }
  /* The cards and the maps they describe share one width, so the split between
     A and B is one line down the whole tool. */
  .stage-column { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
  .compare-stage {
    --difference-dock: clamp(290px, 24vw, 340px);
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 1px;
    padding: 1px;
    background: var(--border-strong);
    overflow: hidden;
    /* The map panes, highlights and legend climb to z-index 800 among
       themselves; isolating them keeps that ladder from reaching the footer. */
    isolation: isolate;
  }
  .surface-shell, .empty-slot {
    position: relative;
    flex: 1 1 50%;
    min-width: 0;
    min-height: 0;
  }
  .surface-shell { display: flex; overflow: hidden; background: var(--bg-0); }
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
  .compare-stage.swipe .secondary { clip-path: inset(0 0 0 var(--divider)); }
  /* Blend the pixels, not the provider/date controls that explain them. */
  .compare-stage.blended .secondary :global(.map),
  .compare-stage.blended .secondary :global(.map-glass) { opacity: var(--opacity); }
  .compare-stage.overlay .secondary.blink-hidden { opacity: 0; pointer-events: none; }
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
  /* A reading the view has moved past stays for reference, drained of colour
     so it cannot pass for this view's. */
  .change-map.stale {
    opacity: calc(var(--change-opacity) * 0.45);
    filter: grayscale(1);
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
  /* Difference's settings dock on the right edge under the cards' row, so
     what rides that corner steps aside rather than hiding under them, leaving
     B's zoom buttons their column. */
  .compare-stage.docked .view-col {
    max-width: calc(100% - var(--difference-dock) - 48px);
    margin-right: calc(var(--difference-dock) + 8px);
  }
  .compare-stage.docked .change-legend { right: calc(var(--difference-dock) + 20px); }
  .change-legend span { display: flex; align-items: center; gap: 4px; }
  .change-legend i { width: 9px; height: 9px; border-radius: 2px; }
  .change-legend .gain { background: var(--gain); }
  .change-legend .loss { background: var(--loss); }
  .change-legend .changed { background: var(--changed); }
  .change-legend em.warn { color: var(--warn); }
  .change-legend em { max-width: 260px; overflow: hidden; color: #c4c9cf; font-style: normal; text-overflow: ellipsis; white-space: nowrap; }
  /* the rail's tab lies over map A's edge, inside the frame being grabbed */
  .compare-tool.grabbing :global(.rail-tab) { visibility: hidden; }
  .compare-stage.capturing .source-bar,
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
  .output-choice.locked { cursor: default; opacity: .6; }
  .output-choice.locked:hover { border-color: var(--border); color: inherit; background: none; }
  .pace { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px; }
  .pace .mono { color: var(--text-2); font-size: var(--fs-xs); }
  .destination { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px 10px; align-items: center; padding-top: 13px; border-top: 1px solid var(--border); }
  .destination .field-label { grid-column: 1 / -1; }
  .keep-choice { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: flex-start; gap: 9px; padding-top: 13px; border-top: 1px solid var(--border); cursor: pointer; }
  .keep-choice span,
  .keep-choice small { display: block; }
  .keep-choice strong { color: var(--text-1); font-size: var(--fs-sm); }
  .keep-choice small { margin-top: 2px; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.35; }
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
    .tool-header { flex-wrap: wrap; }
    .compare-stage:not(.overlay) { flex-direction: column; }
    .provider-grid { grid-template-columns: 1fr; }
    /* The panes stack, so the cards do too: each row is one pane's height. */
    .source-bar { grid-template-columns: minmax(0, 1fr); row-gap: 8px; }
    .compare-stage:not(.overlay) .source-bar { bottom: 8px; grid-template-rows: 1fr 1fr; row-gap: 17px; }
    .source-b { grid-column: 1; }
    .camera-readout { display: none; }
    .layer-columns { height: min(72vh, 720px); grid-template-columns: 1fr; overflow: auto; }
  }
</style>
