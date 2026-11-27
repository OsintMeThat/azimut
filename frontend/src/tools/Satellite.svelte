<script>
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  // The map is lib/map's: the engine, its layers, what is drawn on them and the
  // drag gestures. Nothing in this file knows which engine that is — and the
  // map itself is a surface (satellite/MapSurface.svelte), which is what lets a
  // second one be mounted beside this one.
  import { createSurface } from '../lib/map/surface.js';
  import MapSurface from './satellite/MapSurface.svelte';
  import { createSentinelState } from './satellite/state/sentinel.svelte.js';
  import { createRadarState } from './satellite/state/radar.svelte.js';
  import { createWaybackState } from './satellite/state/wayback.svelte.js';
  import { addedLayers } from '../lib/map/addedLayersState.svelte.js';
  import { createMapLayerMemory } from '../lib/map/layerMemory.js';
  import { createSavedState } from './satellite/state/saved.svelte.js';
  import { createImageryState, FALLBACK_PROVIDER } from './satellite/state/imagery.svelte.js';
  import { createMeasureState, createUnitsChoice } from './satellite/state/measure.svelte.js';
  import { createSkyState } from './satellite/state/sky.svelte.js';
  import { createGridState } from './satellite/state/grid.svelte.js';
  import { createRefsState } from './satellite/state/refs.svelte.js';
  import { createFootprintState } from './satellite/state/footprint.svelte.js';
  import { createPlaceMove } from './satellite/state/placeMove.svelte.js';
  import { createDropState, DROP_HELP } from './satellite/state/drop.svelte.js';
  import { dropLead, geolocating, moveLead, removeLead } from '../lib/geolocating.svelte.js';
  import { sceneColorAt } from '../lib/scenes.js';
  import {
    createCaptureState,
    PRESETS,
    RATIOS,
  } from './satellite/state/capture.svelte.js';
  import { api } from '../lib/api.js';
  import { setAnalysisPeriod } from '../lib/analysisSearch.svelte.js';
  import { temporalMapQuery } from '../lib/temporalMap.js';
  import { windowWords } from '../lib/timeline.js';
  import { casePointRows, casePoints } from '../lib/geoTree.js';
  import { stackOf } from '../lib/mediaViewer.js';
  import {
    caseState, uiState, ensureCase, reloadCase, toast, dismissToast, prefs, fmtCoords, prefsReady,
  } from '../lib/state.svelte.js';
  import { copyText } from '../lib/clipboard.js';
  import { sendToGeoProof } from '../lib/toGeoProof.js';
  import { formatHeight } from '../lib/measure.js';
  import { FREE_FAR_PROVIDER } from '../lib/map/quotaGuard.js';
  import { bearingBetween } from '../lib/horizon/geometry.js';
  import { markerGeometry, markerSvg } from '../lib/mapMarkers.js';
  import { startRectDrag, tiltFromKey, turnFromKey, turnFromPress } from '../lib/map/gestures.js';
  import { exaggerationOf } from '../lib/map/relief.js';
  import { panelWidth } from '../lib/panelWidth.js';
  import PlaceSearch from './satellite/PlaceSearch.svelte';
  import { assignFolder } from '../lib/filing.js';
  import { filedToast } from '../lib/folders.js';
  import { saveRelation } from '../lib/relations.svelte.js';
  import { lookFrom, openComparison, openEntity, openHorizonView, openMapAt } from '../lib/navigate.js';
  import { headingUp } from '../lib/map/facade.js';
  import { offerNote, offerPuts, withdrawNote } from '../lib/noteHere.svelte.js';
  import { measureOffer, pointOffer, viewOffer } from './satellite/mapNote.js';
  import { deletedToast, RESTORABLE } from '../lib/trash.js';
  import { extensionVersion, mapLinkRelay, onActivated } from '../lib/extBridge.js';
  import { SENTINEL_ID } from '../lib/sentinel.js';
  import { RADAR_ID } from '../lib/radar.js';
  import { WAYBACK_ID } from '../lib/wayback.js';
  import { COMPARE_SOURCES, comparePair } from '../lib/map/comparePair.js';
  import { actionsFor, otherMapTools } from '../lib/map/contextMenu.js';
  import { buildHash, readSolo, splitHash } from '../lib/hash.js';
  import { settlePlace } from '../lib/backButton.js';
  import { readView, readWindowLabel, viewParams } from '../lib/map/view.js';
  import { createViewLink } from '../lib/map/link.js';
  import { shareView } from '../lib/map/sharedView.js';
  import { askable, firmsNote, keyState, summary, tileParams } from '../lib/map/firms.js';
  import {
    askable as nightCanAsk,
    lastNight,
    summary as nightSummary,
    tileParams as nightParams,
  } from '../lib/map/nightlights.js';
  import { fireControls, nightControls as nightQuestions } from '../lib/map/eventControls.js';
  import { layerInfo } from '../lib/map/layerCatalog.js';
  import { overlayAttribution } from '../lib/map/basemap.js';
  import { owedCredit } from '../lib/map/addedLayers.js';
  import { paintCaseMarks } from '../lib/map/paintMarks.js';
  import { SHOWN_WITH } from '../lib/map/layerSet.svelte.js';
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
  import TurnGuide from '../components/TurnGuide.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import Modal from '../components/Modal.svelte';
  import EntityDetails from '../components/EntityDetails.svelte';
  import RefViewer from './RefViewer.svelte';
  import MapRail from './satellite/MapRail.svelte';
  import AddedLayers from './satellite/AddedLayers.svelte';
  import MyLayers from './satellite/MyLayers.svelte';
  import NewLayerDialog from './satellite/NewLayerDialog.svelte';
  import { personalLayers as myLayers, personalPlaceDeletion as placeDeletion } from '../lib/map/personalLayers.svelte.js';
  import LayerGeometry from './satellite/LayerGeometry.svelte';
  import LayerAddDialogs from './satellite/LayerAddDialogs.svelte';
  import PlaceDeleteDialog from './satellite/PlaceDeleteDialog.svelte';
  import LayerExportDialog from './satellite/LayerExportDialog.svelte';
  import AddedLayersOverlay from './satellite/AddedLayersOverlay.svelte';
  import AddLayerDialog from './satellite/AddLayerDialog.svelte';
  import GeoConfirmedDialog from './satellite/GeoConfirmedDialog.svelte';
  import MapLayers from './satellite/MapLayers.svelte';
  import MapContextMenu from './satellite/MapContextMenu.svelte';
  import MapStatusBar from './satellite/MapStatusBar.svelte';
  import MeasureGround from './satellite/MeasureGround.svelte';
  import MeasureOverlay from './satellite/MeasureOverlay.svelte';
  import MeasureKeepMenu from './satellite/MeasureKeepMenu.svelte';
  import SightVerdict from './satellite/SightVerdict.svelte';
  import FloatingWindow from '../components/FloatingWindow.svelte';
  import MarkerMenu from './satellite/MarkerMenu.svelte';
  import MeasurePanel from './satellite/MeasurePanel.svelte';
  import SunPanel from './satellite/SunPanel.svelte';
  import GridSearchPanel from './satellite/GridSearchPanel.svelte';
  import FootprintPanel from './satellite/FootprintPanel.svelte';
  import FloatingMenu from '../components/FloatingMenu.svelte';
  import ScreenshotDialog from './satellite/ScreenshotDialog.svelte';
  import ExtensionGate from './satellite/ExtensionGate.svelte';
  import RefPicker from './satellite/RefPicker.svelte';
  import RefDock from './satellite/RefDock.svelte';
  import CaptureDetails from './satellite/CaptureDetails.svelte';
  import PlaceDialog from './satellite/PlaceDialog.svelte';
  import PlaceNamer from './satellite/PlaceNamer.svelte';
  import CaptureOptions from './satellite/CaptureOptions.svelte';
  import FigureDialog from './satellite/FigureDialog.svelte';
  import SavedTree from './satellite/SavedTree.svelte';
  import SavedSearch from './satellite/SavedSearch.svelte';
  import SavedOverlay from './satellite/SavedOverlay.svelte';
  import MediaViewer from './satellite/MediaViewer.svelte';
  import { createItemLayers } from './satellite/itemLayers.svelte.js';
  import SheetPointsOverlay from './satellite/SheetPointsOverlay.svelte';
  import HorizonEyeOverlay from './satellite/HorizonEyeOverlay.svelte';
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
  // …and the view it actually opens on, settled in `build`: the address, else
  // where the other map tabs left the window, else home.
  let opensOn = $state(null);
  let center = $state({ ...prefs.homeView });
  let markerStyle = $state('none'); // 'crosshair' | 'pin' | 'none'
  let moveMode = $state(false); // pin decoupled from center, draggable
  let markerSurface = null; // lib/map/surface.js — holds the pin while in move mode
  let markerLatLng = $state(null); // {lat, lon} of the moved pin
  let bearing = $state(0);
  // The relief under the imagery (lib/map/relief.js): off until asked for, and
  // only then does the map tilt, by a middle- or Shift+drag, Page Up and Down,
  // or from its control.
  let reliefOn = $state(false);
  let reliefReady = $state(false);
  // the globe draws the map: the layers it cannot draw are left out meanwhile
  let onGlobe = $state(false);
  let exaggeration = $state(1);
  let pitch = $state(0);
  // A tilted camera the address or a saved capture asked for, held until the
  // relief is there to lean over: `{ lat, lon, zoom, bearing, pitch }`, where
  // what is left out stays as the map has it.
  let pendingCamera = $state(null);
  // The ground height at the point the readout names, from the relief drawn.
  let groundHeight = $state(null);
  // Middle-drag rotates the map around the grabbed point.
  let rotating = $state(false);
  let rotatePivot = $state({ x: 0, y: 0 }); // grabbed point, map-wrap-local px
  let captureHover = $state(false); // previewing the crop frame (capture group hover)
  // A figure is several renderings of *one* Copernicus acquisition, so it needs
  // a dated pass and more than one layer to render it through.
  let figureOpen = $state(false);
  // The case's saved work — both indexes, the panel's filter and the Locate
  // pass — is its own store (state/saved.svelte.js).
  const savedWork = createSavedState({ api, notify: toast, assignFolder, reloadCase });
  // The file played beside the map, put in one of the analyst's layers.
  const mediaLayers = createItemLayers({ api, layers: addedLayers, notify: toast,
    refreshEditor: (name) => { if (myLayers.editor?.name === name) myLayers.refresh(); } });
  /** One of the file's markers, in its layer opened for editing. */
  async function openMediaInLayer(place) {
    const row = addedLayers.rows.find((one) => one.name === place.layer.name && one.editable)
      ?? { name: place.layer.name, title: place.layer.title, editable: true };
    if (myLayers.editor?.name !== row.name) await myLayers.open(row);
    myLayers.select(place.marker.key);
  }
  // The layers the analyst added themselves (a file they opened, a map they
  // follow) live in the one store every map reads (lib/map/addedLayersState),
  // because it owns the one network rule this feature has: a feed is read when
  // first switched on in a session, on Refresh, and never otherwise. This is
  // where they are added and worked; the other maps only switch them on.
  let savedSearchOpen = $state(false);
  // The case's own two layers, the places saved in it and its footage where it was
  // placed: both on from the start, so a place saved is seen and a case opens on its
  // footage. Kept per case with the other layers (`openLayers`).
  let placesOn = $state(true);
  let mediaOn = $state(true);
  // each place's name under its mark (the Names switch under Places), off until asked for
  let namesOn = $state(false);
  /**
   * The located files the panel is playing, or null for the saved-work list.
   *
   * `items` is the stack one mark holds, `index` the file on screen. It takes the
   * panel rather than a window over the map, because the footage is read beside
   * the imagery it is being matched against.
   */
  let mediaView = $state(null);
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

  // OpenRailwayMap over the imagery: which of two parallel strips is a
  // railway, where a siding ends, what a yard is made of. Unlike the roads it
  // is worth having over a street base map too, which draws tracks as one
  // undifferentiated line.
  let railOverlay = $state(false);
  /**
   * The other key-less reference layers, each simply on or off: OpenFreeMap's
   * borders and place names, Esri's roads, Open Infrastructure Map's power
   * lines, OpenSeaMap's sea marks and OSM's raw GPS traces. Borders start on,
   * because every read of imagery starts with which side of a line it is on;
   * they are map tiles, the network a map is opened to use. The rest fetch no
   * tile until their switch is pressed.
   */
  const refLayers = $state({
    boundaries: true,
    placenames: false,
    roads: false,
    power: false,
    seamarks: false,
    gpstraces: false,
  });
  /**
   * The catalogue layers each case was left on, kept in this browser
   * (`lib/map/layerMemory.js`): borders and the saved work for a case that
   * never said otherwise. The fire and night layers are not among them.
   */
  const switchMemory = createMapLayerMemory('satellite', ['boundaries', 'places', 'media']);
  /** The case the switches were last set for, which is the case they are kept under. */
  let layersFor = null;
  const switchedOn = $derived(
    [
      ...Object.keys(refLayers).filter((id) => refLayers[id]),
      railOverlay && 'railway',
      placesOn && 'places',
      namesOn && 'places-names',
      mediaOn && 'media',
    ].filter(Boolean)
  );
  function openLayers(id) {
    layersFor = id ?? null;
    const ids = switchMemory.recall(layersFor);
    untrack(() => {
      for (const key of Object.keys(refLayers)) refLayers[key] = ids.includes(key);
    });
    railOverlay = ids.includes('railway');
    placesOn = ids.includes('places');
    namesOn = ids.includes('places-names');
    mediaOn = ids.includes('media');
  }
  $effect(() => switchMemory.keep(layersFor, switchedOn));
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
    /** Why it is not usable when it is not: 'missing' | 'off' | 'refused'. */
    state: 'missing',
    /** A spent allowance's pause, `{ until, used, of }`, while it lasts. */
    paused: null,
    sensors: [],
    sensor: 'viirs',
    window: '24h',
    first: '',
    last: '',
  });
  const firmsAskable = $derived(askable(fires));
  const firmsSummary = $derived(summary(fires, fires.sensors));
  const firmsKey = $derived(keyState(fires));

  /** The archives a right-click can build a pair from. A keyed provider that is
   *  not configured is left out rather than offered and refused. */
  const compareSources = $derived(
    COMPARE_SOURCES.filter((source) => !source.provider || imagery.find(source.provider))
  );

  /** Where a FIRMS key is entered, reached from the layer that needs it. */
  function openImagerySettings() {
    uiState.settingsTab = 'imagery';
    uiState.tool = 'settings';
  }

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
      fires.state = answer.state ?? 'missing';
      fires.paused = answer.paused ?? null;
    } catch {
      fires.keyed = false;
      fires.paused = null;
    }
    // A pause ends on its own; the row hears it then rather than on the next
    // failed tile. Our own backend, once, so nothing is polled.
    clearTimeout(pauseTimer);
    if (fires.paused) {
      const left = Date.parse(fires.paused.until) - Date.now();
      pauseTimer = setTimeout(loadFireSensors, Math.max(1000, left + 500));
    }
  }

  let pauseTimer = null;
  let troubleTimer = null;
  /** A FIRMS tile failed: ask our backend why, once for the burst a screen makes. */
  function fireTrouble() {
    clearTimeout(troubleTimer);
    troubleTimer = setTimeout(loadFireSensors, 800);
  }

  /** The two questions the fire layer asks, as rows under its switch. */
  const firmsControls = $derived(fireControls(fires, fires.sensors, (patch) => Object.assign(fires, patch)));

  /** The night layer's question, asked in its row like the fires'. */
  const nightControls = $derived(nightQuestions(night, (patch) => Object.assign(night, patch)));

  /** What the surface is asked to lay over the picture (lib/map/basemap.js). */
  const overlays = $derived(
    [
      refLayers.boundaries && 'boundaries',
      refLayers.placenames && baseIsImagery && 'placenames',
      refLayers.roads && baseIsImagery && 'roads',
      railOverlay && 'railway',
      refLayers.power && 'power',
      refLayers.seamarks && 'seamarks',
      refLayers.gpstraces && 'gpstraces',
      // a view to the horizon would spend the fires' allowance on every tile out to it
      fires.on && fires.keyed && firmsAskable && !onGlobe && { id: 'firms', params: tileParams(fires) },
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

  /**
   * Open the figure with the layers it is made of.
   *
   * The list is read when the date chip is first opened, and a figure can be
   * the first thing asked of a session: without this it opens offering nothing
   * and says the configuration is empty, which is a lie about the instance.
   * Asked the way the chip asks it, so whichever comes first pays for it and
   * the other finds it read (`state/sentinel.svelte.js`).
   */
  async function openFigure() {
    if (!s2.layers.length) await s2.loadLayers(true, true);
    figureOpen = true;
  }

  // --- Esri Wayback: which release of World Imagery ---
  // The release rides on the provider id like a Sentinel-2 window, and both
  // questions it asks reach Esri: the release list once the basemap is on
  // screen, a point's history only when the analyst asks for it.
  const wb = createWaybackState({
    api,
    place: () => ({ lat: center.lat, lon: center.lon, zoom: center.zoom }),
  });

  // --- Sentinel-1: which radar pass ---
  // Passes are read by the month while its picker is open; the pass rides on
  // the provider id like the others.
  const s1 = createRadarState({
    api,
    place: () => ({ lat: center.lat, lon: center.lon }),
    onBilled: () => imagery.refreshUsage(),
  });

  // --- what the map is actually showing (state/imagery.svelte.js) ---
  // A billed basemap steps aside for free imagery when paused (90% soft block)
  // or zoomed out (eco). The capture follows the display, so provenance always
  // matches the pixels.
  const shown = $derived(
    imagery.displayed(providerId, center.zoom, { ...s2.variant, release: wb.release, pass: s1.shownPass })
  );

  // Fullscreen: the tool covers the whole viewport; SAVED stays collapsible (item 4).
  let fullscreen = $state(false);

  // The Measure tool (state/measure.svelte.js): lines and areas, what a line of
  // two points is used as, and the ground under a line. Align is the same store
  // in a seat of its own: lines through two things lined up in a picture, run on
  // to where they meet. Both read in the units set in either panel.
  const measureUnits = createUnitsChoice();
  const measure = createMeasureState({
    engine: () => engine,
    api,
    units: () => prefs.units,
    coords: (lat, lon) => fmtCoords(lat, lon),
    relief: () => reliefOn,
    snapTargets: () => measureTargets(),
    copy: (text) => copyText(text, { said: 'Coordinates copied' }),
    choice: measureUnits,
  });
  const align = createMeasureState({
    engine: () => engine,
    api,
    units: () => prefs.units,
    coords: (lat, lon) => fmtCoords(lat, lon),
    snapTargets: () => measureTargets(),
    copy: (text) => copyText(text, { said: 'Coordinates copied' }),
    align: true,
    choice: measureUnits,
  });
  /** The seat whose lines the map's clicks, keys and pointer go to, while Measure or Align is open. */
  const lines = $derived(measure.on ? measure : align.on ? align : null);
  // Alt held keeps a click off what is already there
  let altHeld = $state(false);
  // the measure or alignment kept in a layer, while its menu is open: { tool, id, feature, anchor }
  let keeping = $state(null);

  /**
   * What a measure's click lands on: the case's places and the analyst's pins in
   * view, and the dropped pin. Read once the map stops, not at every move.
   */
  let targetsMemo = { at: -1, list: [] };
  let viewStamp = 0;
  function measureTargets() {
    if (targetsMemo.at === viewStamp) return targetsMemo.list;
    const box = engine?.viewBounds?.();
    const inView = (lat, lon) =>
      !box || (lat <= box.north && lat >= box.south && (box.west <= box.east ? lon >= box.west && lon <= box.east : lon >= box.west || lon <= box.east));
    const list = [];
    for (const row of savedWork.rows) {
      if (row.lat != null && row.lon != null && inView(row.lat, row.lon)) list.push({ lat: row.lat, lon: row.lon, label: row.title || 'Saved place' });
    }
    for (const row of addedLayers.rows ?? []) {
      for (const feature of addedLayers.collection(row.name)?.features ?? []) {
        if (feature.geometry?.type !== 'Point') continue;
        const [lon, lat] = feature.geometry.coordinates;
        if (inView(lat, lon)) list.push({ lat, lon, label: feature.properties?.name || row.title });
      }
    }
    if (markerLatLng) list.push({ ...markerLatLng, label: 'The pin' });
    targetsMemo = { at: viewStamp, list };
    return list;
  }

  /**
   * Where the ground window first opens: a wide band low on the map, or high,
   * clear of the tool's panel, if the line lies low.
   */
  function groundWindowPlace(box) {
    const w = Math.min(980, box.w - 24);
    const low = { x: Math.max(12, (box.w - w) / 2), y: box.h - 420, w, h: 330 };
    // right of the rail and its open panel, which also clears the search above them
    const beside = Math.min(12 + toolsWidth + 12, Math.max(12, box.w - 572));
    // the line as drawn on screen, a point every few pixels' worth of each leg
    const corners = engine && measure.selected ? measure.selected.points.map((point) => engine.latLngToContainerPoint(point)) : [];
    const drawn = corners.flatMap((at, i) =>
      i ? Array.from({ length: 12 }, (_, k) => ({ x: corners[i - 1].x + ((at.x - corners[i - 1].x) * k) / 11, y: corners[i - 1].y + ((at.y - corners[i - 1].y) * k) / 11 })) : []
    );
    const covered = (rect) => drawn.filter((at) => at.x >= rect.x && at.x <= rect.x + rect.w && at.y >= rect.y && at.y <= rect.y + rect.h).length;
    const high = { x: beside, y: 12, w: Math.min(w, box.w - beside - 12), h: 330 };
    return covered(high) < covered(low) ? high : low;
  }

  // the pointer over the map: the stretch being drawn follows it, the chart reads the line under it
  $effect(() => {
    const tool = lines;
    if (!engine || !tool) return;
    return engine.on('pointer-move', (at) => tool.follow(at, { free: altHeld }));
  });

  // a map come to rest: the words that fit are placed again, and what a click lands on read again
  $effect(() => {
    if (!engine) return;
    return engine.on('view-settled', () => {
      viewStamp += 1;
      measure.viewChanged();
      align.viewChanged();
    });
  });

  // the flat map zooms on a double click, which ends a measure here: kept from it while the tool is open
  $effect(() => {
    if (!lines || !mapEl) return;
    const swallow = (event) => {
      if (!mapEl?.contains(event.target)) return;
      event.stopPropagation();
      event.preventDefault();
    };
    window.addEventListener('dblclick', swallow, true);
    return () => window.removeEventListener('dblclick', swallow, true);
  });

  // the 3D view switched on reads the ground of the line in hand, as it reads the relief anyway
  $effect(() => {
    if (reliefOn) untrack(() => measure.readAgain());
  });

  /** A line's question asked in Horizon: standing at A, facing B, B marked. */
  function lookAlong(id) {
    const m = measure.measures.find((one) => one.id === id);
    const a = m?.points[0];
    const b = m?.points.at(-1);
    if (!a || !b) return;
    lookFrom({
      lat: a.lat,
      lon: a.lon,
      heading: bearingBetween(a, b),
      eyeHeight: measure.eyeHeight,
      mark: { lat: b.lat, lon: b.lon, height: measure.targetHeight },
    });
  }

  function keepMeasure(tool, id, anchor) {
    const feature = tool.feature(id);
    if (feature) keeping = { tool, id, feature, anchor };
  }

  /** The selected line's sight, stood in the air over the 3D view. */
  const measureAir = $derived.by(() => {
    const m = measure.selected;
    const ground = measure.ground?.answer;
    if (!onGlobe || !m || m.closed || m.points.length !== 2 || !ground?.sight || !ground.corners) return null;
    return {
      a: m.points[0],
      b: m.points[1],
      eye: ground.sight.eye_m,
      target: ground.sight.target_m,
      blockedAt: ground.sight.blocked_at_m,
    };
  });

  /**
   * Which half of the panel is showing.
   *
   * The panel used to stack three unrelated things in one scroll — what is drawn
   * over the imagery, a list of external maps, and the case's own work — under a
   * header that named only the last of them and counted only its rows. Two tabs
   * because there are two questions: *what am I looking at* and *what have I
   * got*. The external maps went entirely: the right-click menu already offers
   * them, and it offers them on the point that was clicked rather than on the
   * map's centre.
   *
   * Opens on Layers, because that is what the panel is *for* on the surface it
   * is docked to: the map is read first and browsed second, and the case's own
   * work is also reachable from the sidebar and the Board while what is drawn
   * over the imagery is reachable from nowhere else.
   */
  let panelTab = $state('layers');
  const PANEL_TABS = { layers: 'Layers', saved: 'Saved' };
  // The layers list, open by default: it is what the tab says about the map.
  let layersOpen = $state(true);
  // The added layer a Remove is asking about. Its snapshot goes with it, and for
  // a subscription that is the only copy of what was last served.
  let removingLayer = $state(null);

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
  // Horizon draws the same windows: each tab draws them only while it is on
  // screen, so a clip never plays in two places (state/refs.svelte.js).
  const refsHere = $derived(uiState.tool === 'satellite');
  // A scene being geolocated (Inspect's Geolocate, the To-do, the pill): its video
  // in a reference window, the scene marked on its bar (`lib/geolocating.svelte.js`).
  $effect(() => {
    if (uiState.tool !== 'satellite' || !uiState.geolocateRef || !caseState.current) return;
    const ref = uiState.geolocateRef;
    uiState.geolocateRef = null;
    untrack(() => {
      refs.openScene(ref);
      // a collage cut from the video, its picture opened beside it (the Collage tool's Geolocate)
      if (ref.picture) refs.openScene({ ...ref, video: ref.picture, kind: 'image' });
    });
  });
  // A docked reference narrows the map beside it, so the engine remeasures
  // whenever a column opens, closes or changes width.
  $effect(() => {
    void refsHere;
    for (const side of ['left', 'right']) {
      void refs.dockedOn(side).length;
      void refs.dockWidth(side);
    }
    tick().then(() => engine?.resize());
  });

  // --- tracing a place's footprint: the shape it really is, rather than the
  // circle a radius draws around it. Armed from that place's own card.
  const footprint = createFootprintState({
    api,
    notify: toast,
    caseId: () => caseState.current?.id,
    engine: () => engine,
    onSaved: async (ownerCaseId) => {
      if (caseState.current?.id === ownerCaseId) await reloadCase();
    },
    // a new zone (Save place's arrow): a place of the case with its area, its pin inside
    createZone: async ({ title, at, footprint: shape }) => {
      const c = await ensureCase();
      await api.post(`/api/cases/${c.id}/satellite/place`, { lat: at.lat, lon: at.lon, zoom: center.zoom, bearing, title, footprint: shape });
      // a zone saved is seen: its layer comes back on if it was off
      placesOn = true;
    },
  });

  // Save place's arrow: a pin, or a zone drawn corner by corner
  let placeMenu = $state(false);
  let placeMenuAnchor = $state(null);
  async function startZone() {
    placeMenu = false;
    await ensureCase();
    if (!footprint.startNew()) return;
    closeOthers(modes, 'footprint');
    toast('Click the corners of the zone, then name it', 'info', 4000);
  }

  // --- moving a saved place: picked up from its card, put down with a click ---
  const placeMove = createPlaceMove({
    engine: () => engine,
    move: async (row, at) => {
      const cid = caseState.current?.id;
      const from = { lat: Number(row.lat), lon: Number(row.lon) };
      await api.post(`/api/cases/${cid}/satellite/places/${row.id}/move`, at);
      if (caseState.current?.id === cid) await reloadCase();
      toast('Place moved', 'ok', 8000, { label: 'Undo', onClick: () => putBack(cid, row.id, from) });
    },
    notify: toast,
  });

  async function putBack(cid, id, from) {
    try {
      await api.post(`/api/cases/${cid}/satellite/places/${id}/move`, from);
      if (caseState.current?.id === cid) await reloadCase();
    } catch (e) {
      toast(`Could not put the place back: ${e.message}`, 'danger', 6000);
    }
  }

  /**
   * The Move press on a place's card. A place a proof states is moved in the proof,
   * which keeps its coordinates and prints them: the card opens it instead.
   */
  async function pickUpPlace(row, pointer) {
    if (row.proofs > 0) return openProofOf(row);
    const box = mapEl?.getBoundingClientRect();
    const at = box && pointer ? { x: pointer.x - box.left, y: pointer.y - box.top } : null;
    if (!placeMove.start(row, at)) return;
    closeOthers(modes, 'move');
    toast('Click where it goes. Esc leaves it where it was', 'info', 4000);
  }

  /** Open the proof concluding on a place, saying why the map did not pick it up. */
  async function openProofOf(row) {
    const cid = caseState.current?.id;
    try {
      const chain = await api.get(`/api/cases/${cid}/entities/${row.id}/chain`);
      const proof = (chain?.relations ?? []).find(
        (one) => one.direction === 'in' && one.link?.type === 'depicts' && one.entity?.type === 'proof'
      )?.entity;
      if (!proof || caseState.current?.id !== cid) return;
      toast('A proof states this point: move it there and save the proof', 'info', 6000);
      openEntity(proof);
    } catch (e) {
      toast(`Could not open the proof: ${e.message}`, 'danger', 5000);
    }
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
    imagery.refreshUsage(); // prefs drive the eco/soft-block fallbacks from the start
    await imagery.loadProviders();
    await prefsReady; // the home view has to land before the map is built
    // The address wins over the saved home view: it is what a detached window,
    // a reload and a kept link all carry. A basemap named there has to exist —
    // the catalogue depends on which keys are configured, and an address can be
    // typed by hand. An address with no view leaves the map where the other map
    // tabs left the window, when they share one.
    const shared = openingView?.lat == null ? share.opening() : null;
    center = shared ? { lat: shared.lat, lon: shared.lon, zoom: shared.zoom } : { ...openingHome };
    if (shared) bearing = shared.bearing ?? 0;
    opensOn = { ...center };
    if (openingView?.provider && imagery.find(openingView.provider)) {
      providerId = openingView.provider;
    }
    if (windowNumber) document.title = `Azimut · Map ${windowNumber}`;
    homeReady = true; // …and only now is there a view for the surface to open on
    loadFireSensors();
    // A peer moved. Applied whatever this tab was doing, because the analyst
    // asked for that by pressing the link — but only while it is pressed.
    // With the map tabs sharing a camera it is the window's camera that moves,
    // so the tab on screen follows, whichever it is.
    viewLink = createViewLink(
      (view) => {
        if (!linked || !engine) return;
        if (prefs.mapSync) {
          uiState.mapView = { ...view, by: 'link' };
          return;
        }
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
    window.addEventListener('keyup', onKeyup);
    window.addEventListener('blur', onKeyup);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    // the user clicked the extension after a refused capture — close the loop
    const offActivated = onActivated(() =>
      toast('Extension ready. Press Capture again', 'ok', 5000)
    );
    return () => {
      window.removeEventListener('keydown', onKeydown);
      window.removeEventListener('keyup', onKeyup);
      window.removeEventListener('blur', onKeyup);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      viewLink?.close();
      viewLink = null;
      offActivated();
      measure.destroy();
      align.destroy();
      sky.destroy();
      grid.destroy();
      footprint.destroy();
      placeMove.destroy();
      markerSurface?.destroy();
      clearTimeout(pauseTimer);
      clearTimeout(troubleTimer);
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
    // middle-mouse or shift drag rotates the view (the 3D view's own gestures are the globe's)
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

  /**
   * The marquee over the 3D view. The globe's canvas stands beside the flat
   * map, not in it, and starts its own pan on the pointer's press: an armed
   * marquee is heard on the window and claims that press first, so the globe
   * never hears it and the mouse press that follows draws the box.
   */
  $effect(() => {
    if (!capture.armed) return;
    const onGlobe = (e) => e.button === 0 && Boolean(engine?.globe?.onSurface(e.target));
    const claim = (e) => {
      if (onGlobe(e)) e.stopPropagation();
    };
    const draw = (e) => {
      if (onGlobe(e)) onSelectDrag(e);
    };
    window.addEventListener('pointerdown', claim, true);
    window.addEventListener('mousedown', draw, true);
    return () => {
      window.removeEventListener('pointerdown', claim, true);
      window.removeEventListener('mousedown', draw, true);
    };
  });

  /** Alt let go, or the window left with it held: clicks land on what is there again. */
  function onKeyup(e) {
    if (e.type === 'blur' || e.key === 'Alt') altHeld = false;
  }

  function onKeydown(e) {
    if (uiState.tool !== 'satellite') return;
    // a dialog on top owns the keyboard — it closes itself, the map keeps state
    if (notesItem || placeModal || detailsEntityId || refs.picking || deleteTarget) return;
    const tag = e.target?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable;
    // Shift and an arrow turn the map, as on every map in the app
    if (!typing && turnFromKey(engine, e)) return;
    // Page Up and Down tilt it over relief, unless they are scrolling a panel
    const onMap = e.target === document.body || Boolean(mapEl?.contains(e.target));
    if (!typing && reliefReady && onMap && tiltFromKey(engine, e)) return;
    if (e.key === 'Alt') altHeld = true;
    // Enter finishes a measure: its points become handles, and a line reads its ground
    if (!typing && e.key === 'Enter' && lines?.finish()) {
      e.preventDefault();
      return;
    }
    // a lead picked on the map goes with Delete (or Backspace)
    if (!typing && (e.key === 'Delete' || e.key === 'Backspace') && drop.removeSelected()) {
      e.preventDefault();
      return;
    }
    // a zone's corner picked goes with Delete; Backspace takes the last one back
    if (!typing && footprint.on && (e.key === 'Delete' || e.key === 'Backspace')) {
      if (footprint.removeSelected() || (e.key === 'Backspace' && footprint.undo())) {
        e.preventDefault();
        return;
      }
    }
    // Backspace takes the last point back while a measure is drawn; Delete, or
    // Backspace once it is finished, takes the selected one off the map
    if (!typing && lines && (e.key === 'Backspace' || e.key === 'Delete')) {
      if ((e.key === 'Backspace' && lines.undo()) || lines.removeSelected()) {
        e.preventDefault();
        return;
      }
    }
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
    // a shadow half put down is let go of before Sun and moon closes
    if (sky.stopTracing()) return;
    // a measure being drawn is finished, then let go of, before the tool closes
    if (lines?.escape()) return;
    // a pin waiting for its name is let go of before the mode ends
    if (drop.cancel()) return;
    // a lead picked is let go of before anything closes
    if (drop.deselect()) return;
    // a place in the hand stays where it was
    if (placeMove.cancel()) return;
    if (armedMode) return disarm(modes);
    if (capture.menuOpen) return void (capture.menuOpen = false);
    // native fullscreen already exits on Esc (handled by onFullscreenChange);
    // only the CSS fallback needs an explicit toggle here
    if (fullscreen && !document.fullscreenElement) toggleFullscreen();
  }

  // force the roads and the place names off whenever the base isn't imagery: a
  // street map already draws them
  $effect(() => {
    if (!baseIsImagery && refLayers.roads) refLayers.roads = false;
    if (!baseIsImagery && refLayers.placenames) refLayers.placenames = false;
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

  // The date of what's on screen is why you'd pick this basemap, and it is also
  // what the tiles are rendered from: "most recent" is resolved to a day and
  // that day becomes the mosaicking window, so the picture is one acquisition
  // instead of a per-pixel blend of the archive. One metadata request, on the
  // user's own action (choosing the basemap), and only once per place and
  // ceiling. Not on mount: no tab may phone out by being opened.
  $effect(() => {
    if (!mapReady || shown.provider?.id !== SENTINEL_ID) return;
    center.lat;
    center.lon;
    s2.maxcc; // a new ceiling can make a different pass the most recent one
    clearTimeout(s2LatestTimer);
    // With nothing resolved yet the tiles have no window and blend dates, so
    // that lookup goes out at once; afterwards the resolved day holds while a
    // new one is found, and the debounce keeps a pan from spending a request
    // per frame.
    const wait = s2.resolved ? 900 : 0;
    s2LatestTimer = setTimeout(() => s2.resolveLatest().catch(() => {}), wait);
  });
  let s2LatestTimer;

  // The radar basemap carries the same rule: no window blends every pass in the
  // archive, which mixes looks from opposite sides of the track. One lookup, on
  // the user's own action, once per place.
  $effect(() => {
    if (!mapReady || shown.provider?.id !== RADAR_ID) return;
    center.lat;
    center.lon;
    clearTimeout(s1LatestTimer);
    s1LatestTimer = setTimeout(() => s1.resolveLatest().catch(() => {}), s1.resolved ? 900 : 0);
    return () => clearTimeout(s1LatestTimer);
  });
  let s1LatestTimer;

  // Wayback names its releases once it is on screen: the chip reads a date
  // rather than "Newest", and the picker opens on a list already read.
  $effect(() => {
    if (mapReady && shown.provider?.id === WAYBACK_ID) wb.loadReleases();
  });

  // --- middle-drag rotate, Google-Earth style ---
  // Grab a point and drag sideways: the map turns around *that* point (not the
  // centre), with a sober target marking the pivot. A middle click alone puts
  // north back up (lib/map/gestures.js).
  function onMiddleRotateStart(e) {
    if (!engine) return;
    // Shift and the left button turns too, as it did on the old map. Never over
    // a mode already waiting for a left drag, though: those own the button.
    turnFromPress(engine, e, {
      shift: !capture.armed && grid.drawMode !== 'rect',
      double: doubleTurns(),
      onPivot: (pivot) => {
        rotatePivot = pivot;
        rotating = true;
      },
      onEnd: () => (rotating = false),
    });
  }

  /** Whether a double click held turns the map: unless a mode is reading the clicks, or owns the left drag. */
  const doubleTurns = () => !armedCursor && !capture.armed && grid.drawMode !== 'rect';

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
    // A tilt in the address is a view of the relief, so the relief comes back
    // with it and the whole camera is set at once over the terrain: turned
    // first on the flat map, the zoom would settle on a whole level and the
    // view come back from another height.
    if (openingView?.pitch != null) {
      const { lat, lon, zoom, bearing: turned, pitch: tilt, elevation } = openingView;
      leanTo({ lat, lon, zoom, bearing: turned, pitch: tilt, elevation });
      return;
    }
    if (openingView?.bearing) setBearing(openingView.bearing);
  });

  /** Switch the relief on and set this camera over it once it is there (`pendingCamera`). */
  function leanTo(camera) {
    reliefOn = true;
    pendingCamera = camera;
  }

  $effect(() => {
    const wanted = pendingCamera;
    if (!reliefReady || !wanted || !engine) return;
    // once the relief under the centre is in, or the centre is seated at sea
    // level; in one jump, so the camera settles once and where it was asked.
    // Held until then, so the address never names the view on its way there.
    surface.settledUntouched().then((untouched) => {
      // a camera asked for meanwhile is the one that lands
      if (!engine || pendingCamera !== wanted) return;
      // the hand moved the map meanwhile: the view it left is the one kept
      if (!untouched) {
        pendingCamera = null;
        return;
      }
      const now = engine.camera();
      engine.setCamera({
        lat: wanted.lat ?? now.lat,
        lon: wanted.lon ?? now.lon,
        zoom: wanted.zoom ?? engine.exactZoom(),
        bearing: wanted.bearing ?? now.bearing,
        pitch: wanted.pitch ?? now.pitch,
        // with it, the eye stands exactly where it stood (`facade.js` setCamera)
        elevation: wanted.elevation,
      });
      pendingCamera = null;
    });
  });
  // a camera the relief never came up for (switched off, or a widget basemap) is dropped
  $effect(() => {
    if (!reliefOn) pendingCamera = null;
  });

  /**
   * The ground height under the readout's point, asked of the app once the
   * point stops moving. Only with the relief on: a flat map asks no terrain
   * server anything.
   */
  let heightAsked = 0;
  $effect(() => {
    const { lat, lon } = displayCoords;
    groundHeight = null;
    if (!reliefOn || !mapReady || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const mine = ++heightAsked;
    const timer = setTimeout(async () => {
      try {
        const answer = await api.get(`/api/terrain/elevation?lat=${lat}&lon=${lon}`);
        if (mine === heightAsked) groundHeight = answer.elevation;
      } catch {
        // no relief reachable: the readout simply goes without a height
      }
    }, 350);
    return () => clearTimeout(timer);
  });

  /**
   * The zoom the view is written down at: over relief with its fraction, which
   * there is part of the camera (`writtenZoom`), as the centre's height is.
   * Handed the settled view, so a caller that tracks it re-reads both as the
   * camera comes to rest.
   */
  function zoomNow(settled) {
    return reliefOn && engine ? engine.exactZoom() : settled.zoom;
  }

  /**
   * This window's view, kept in its own address.
   *
   * Settled, never navigated to: panning a map is not going somewhere, and a
   * back button holding four hundred camera positions is worse than useless.
   * Not while a tilted camera waits for its relief: the address still holds it.
   * Nor while a turn is dragged, and the turn and the tilt are read as the view
   * settles rather than at each step: every move ends settled, so the address
   * is written once a move, not once a degree.
   */
  $effect(() => {
    if (uiState.tool !== 'satellite' || !mapReady || pendingCamera || rotating) return;
    const [turn, lean] = untrack(() => [bearing, pitch]);
    const params = viewParams({
      lat: center.lat,
      lon: center.lon,
      zoom: zoomNow(center),
      bearing: turn,
      pitch: reliefOn ? lean : null,
      elevation: reliefOn ? engine?.centreElevation() : null,
      provider: providerId,
    });
    if (windowNumber) params.w = String(windowNumber);
    // What this tab *is* rides along with where it is pointed: rewritten
    // without it, the first pan would turn a detached map back into the whole
    // app on the next reload.
    if (solo) params.solo = '1';
    settlePlace('satellite', params);
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

  /** What the link sends: the window's camera while the map tabs share one, so
   *  a pan in Compare or Detect reaches the other maps too; else this map's. */
  function linkedView() {
    if (prefs.mapSync && uiState.mapView) return uiState.mapView;
    return { lat: center.lat, lon: center.lon, zoom: center.zoom, bearing };
  }

  function toggleLink() {
    if (!peerMaps) return;
    linked = !linked;
    if (linked) viewLink?.send(linkedView());
  }

  $effect(() => {
    if (!linked || !mapReady) return;
    viewLink?.send(linkedView());
  });

  /**
   * The camera this window's map tabs share (`lib/map/sharedView.js`).
   *
   * Written when this map comes to rest on screen, and taken when this tab
   * shows, or when the link moves it while it does.
   */
  const share = shareView('satellite', { state: uiState, enabled: () => prefs.mapSync });

  $effect(() => {
    uiState.mapView;
    if (uiState.tool !== 'satellite' || !mapReady) return;
    untrack(() => {
      const next = share.pending(engine.camera());
      if (next) engine.setCamera(next);
    });
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
      zoom: zoomNow(center),
      bearing,
      pitch: reliefOn ? pitch : null,
      elevation: reliefOn ? engine?.centreElevation() : null,
      provider: providerId,
    });
    params.w = String(nextWindowNumber());
    params.solo = '1';
    if (caseState.current?.id) params.case = caseState.current.id;
    const url = `${location.pathname}${location.search}${buildHash('satellite', params)}`;
    const opened = window.open(url, '_blank');
    if (!opened) toast('The browser refused a second tab. Allow pop-ups for this page', 'warn', 8000);
  }

  // --- the right-click menu: acts on the point under the cursor -------------
  //
  // Every act here already exists for the map centre; the menu hands each one
  // the clicked point instead (lib/map/contextMenu.js). On a pin of an added
  // layer the point is the pin's, and `feature` and `layer` name it. Session
  // chrome, never part of a capture.
  let pointMenu = $state(null); // { lat, lon, x, y, frame, lookup, feature?, layer? }
  let pointLookupSeq = 0;
  // while a layer is edited the rail is put away, so the acts that arm one of its tools are left out
  // while a scene is geolocated the point is dropped as one of its leads, else saved as a named place
  const pointActions = $derived.by(() => {
    const keep = heldScene ? 'lead' : 'place';
    return actionsFor(myLayers.editor ? ['lookup', keep, 'horizon', 'history', 'centre']
      : ['lookup', keep, 'measure', 'sky', 'horizon', 'history', 'centre']);
  });
  const pointTools = otherMapTools('satellite');

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
      await copyText(value);
    } else if (id === 'place' || id === 'lead') {
      drop.at(point);
    } else if (id === 'centre') {
      engine.setView(point, center.zoom);
    } else if (id === 'measure') {
      if (!modes.measure.isOn()) arm(modes, 'measure');
      measure.addPoint(point);
    } else if (id === 'sky') {
      if (!sky.on) arm(modes, 'sky');
      sky.handOff({ ...point, date: sky.day || undefined });
    } else if (id === 'horizon') {
      // a turned map faces somewhere: the eye faces the way up the screen
      lookFrom({ ...point, heading: headingUp(bearing) });
    } else if (id === 'history') {
      const zoom = Math.max(center.zoom, 15);
      providerId = WAYBACK_ID;
      engine.setView(point, zoom);
      await tick();
      wb.historyAt({ lat: point.lat, lon: point.lon, zoom });
    } else if (id === 'compare') {
      await comparePoint(point, value);
    } else if (id === 'goto') {
      openMapAt(value, { ...point, zoom: center.zoom });
    }
  }

  /**
   * Open Compare on the last two pictures of this point.
   *
   * The lookup happens here, before the tab changes: a Compare that opened and
   * *then* said the archive holds nothing would have thrown away the map view
   * for an error message. The dates travel with the pair, so the tool applies
   * them the way it applies a saved comparison.
   */
  async function comparePoint(point, source) {
    const name = COMPARE_SOURCES.find((entry) => entry.id === source)?.label ?? 'the archive';
    // Held up until the answer lands rather than for a guessed few seconds: the
    // walk through Esri's releases takes as long as it takes, and a message that
    // went out halfway through left the map looking like nothing was happening.
    const waiting = toast(`Asking ${name} for the last two pictures…`, 'info', 0);
    try {
      const pair = await comparePair(api, source, { ...point, zoom: center.zoom });
      uiState.compareAt = { ...point, zoom: center.zoom, ...pair };
      uiState.tool = 'compare';
    } catch (error) {
      toast(error.message, 'warn', 6000);
    } finally {
      dismissToast(waiting);
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
    // a click on the map lets go of the lead picked, whatever it does next
    drop.deselect();
    if (myLayers.armed) return;
    if (placeMove.place(at)) return;
    if (drop.place(at)) return;
    if (footprint.addPoint(at)) return;
    if (grid.addVertex(at)) return;
    if (sky.place(at)) return;
    if (lines) lines.addPoint(lines.snap(at, { free: altHeld }).point);
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
    layer: {
      isOn: () => myLayers.armed,
      open: () => myLayers.start(),
      close: () => myLayers.stop(),
      pointing: () => myLayers.armed,
    },
    measure: {
      isOn: () => measure.on,
      open: () => measure.open(),
      close: () => measure.close(),
      // every click is a point while the tool is open; a finished one moves by its handles
      pointing: () => measure.on,
    },
    align: {
      isOn: () => align.on,
      open: () => align.open(),
      close: () => align.close(),
      pointing: () => align.on,
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
      // a click plants the anchor or puts a shadow down
      pointing: () => sky.placing || Boolean(sky.tracing),
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
    drop: {
      isOn: () => drop.armed,
      open: () => drop.start(),
      close: () => drop.stop(),
      pointing: () => drop.armed,
    },
    move: {
      isOn: () => placeMove.on,
      // picked up from a place's own card, never from the rail
      open: () => {},
      close: () => placeMove.cancel(),
      pointing: () => placeMove.on,
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
  /** The search sits in the map's top-left corner and the rail under it, so
   *  the rail's inset follows the search's own height. */
  let searchHeight = $state(0);
  const railTop = $derived(12 + searchHeight + 8);
  /** …and the imagery corner stops short of its width, wrapping rather than
   *  sliding under it on a narrow map. */
  let searchWidth = $state(0);
  // the rail and its open panel, which the ground window opens beside
  let toolsWidth = $state(0);
  /** Its own height, so the engine's zoom buttons stack under it rather than
   *  behind it — and keep doing so when a tool is added to the rail. */
  let railHeight = $state(0);
  // A layer being edited puts its own bar on the map, and the rail steps aside for it.
  const railBottom = $derived(railTop + (myLayers.editor ? 0 : railHeight + 8));

  /** What the case's two layers draw, and their rows in the menu (`lib/geoTree.js`). */
  const mapPoints = $derived(casePoints(savedWork, { places: placesOn, media: mediaOn }));
  const pointRows = $derived(casePointRows(savedWork, { places: placesOn }));

  /**
   * What is drawn over the imagery, as the panel on the right lists it.
   *
   * The two that arrive from another tool — a sheet's coordinate column, a
   * Timeline window — are rows only while they are here, so the list never
   * offers a switch for something that is not on the map. Each keeps a Close
   * beside its switch, because hiding a layer and being done with it are two
   * different intentions and used to be the same button.
   */
  /** Why the fires' switch rests while the globe draws: its allowance counts every tile out to the horizon. */
  const FIRES_FLAT_ONLY = 'Active fires are drawn on the flat map only. Turn 3D off to see them';

  /** A layer's name and what it is, as every map states them (lib/map/layerCatalog.js). */
  const catalogued = (id) => ({ id, label: layerInfo(id).label, title: layerInfo(id).title });

  const layerRows = $derived([
    {
      ...catalogued('boundaries'),
      on: refLayers.boundaries,
      toggle: () => (refLayers.boundaries = !refLayers.boundaries),
    },
    {
      ...catalogued('placenames'),
      on: refLayers.placenames,
      disabled: !baseIsImagery,
      detail: baseIsImagery ? '' : 'imagery only',
      ...(baseIsImagery ? {} : { title: 'Only useful over satellite imagery' }),
      toggle: () => (refLayers.placenames = !refLayers.placenames),
    },
    {
      ...catalogued('roads'),
      on: refLayers.roads,
      disabled: !baseIsImagery,
      detail: baseIsImagery ? '' : 'imagery only',
      ...(baseIsImagery ? {} : { title: 'Only useful over satellite imagery' }),
      toggle: () => (refLayers.roads = !refLayers.roads),
    },
    {
      ...catalogued('railway'),
      on: railOverlay,
      toggle: () => (railOverlay = !railOverlay),
    },
    {
      ...catalogued('power'),
      on: refLayers.power,
      toggle: () => (refLayers.power = !refLayers.power),
      note: refLayers.power ? 'Towers appear from zoom 14.' : '',
    },
    {
      ...catalogued('seamarks'),
      on: refLayers.seamarks,
      toggle: () => (refLayers.seamarks = !refLayers.seamarks),
    },
    {
      ...catalogued('gpstraces'),
      on: refLayers.gpstraces,
      toggle: () => (refLayers.gpstraces = !refLayers.gpstraces),
    },
    {
      ...catalogued('firms'),
      on: fires.on,
      disabled: !fires.keyed || onGlobe,
      detail: !fires.keyed ? firmsKey.detail : onGlobe ? 'flat map only' : firmsSummary,
      ...(!fires.keyed ? { title: firmsKey.title } : onGlobe ? { title: FIRES_FLAT_ONLY } : {}),
      toggle: () => (fires.on = !fires.on),
      // A switch that cannot be pressed says why and where to go, on the row
      // itself rather than only on a greyed-out eye nobody hovers.
      actions: fires.keyed ? null : [{ label: firmsKey.action, quiet: true, run: openImagerySettings }],
      // its two questions — which instrument, and over what — are asked in the
      // row rather than in a card of its own floating somewhere
      controls: fires.on && fires.keyed && !onGlobe ? firmsControls : null,
      note: fires.on && fires.keyed && !onGlobe ? firmsNote(fires, fires.paused) : '',
    },
    {
      ...catalogued('nightlights'),
      on: night.on,
      detail: night.on ? nightSummary(night) : '',
      toggle: () => (night.on = !night.on),
      controls: night.on ? nightControls : null,
      note: !night.on
        ? ''
        : nightAskable
          ? 'Cloud hides lights too, so a dark night is not an outage on its own.'
          : 'Pick a night inside this sensor’s record.',
    },
    {
      ...catalogued('places'),
      on: placesOn,
      toggle: () => (placesOn = !placesOn),
      ...pointRows.places,
    },
    {
      ...catalogued('places-names'),
      of: 'places',
      on: namesOn,
      toggle: () => (namesOn = !namesOn),
      ...(placesOn ? {} : { disabled: true, title: SHOWN_WITH('places') }),
      ...pointRows['places-names'],
    },
    {
      ...catalogued('media'),
      on: mediaOn,
      toggle: () => (mediaOn = !mediaOn),
      ...pointRows.media,
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

  /**
   * The number beside the active tab's name, which is that tab's own.
   *
   * Everything switched on for Layers — the curated stack and the analyst's own
   * together, since the tab is one question — and the rows on screen for Saved.
   */
  const panelCount = $derived(
    panelTab === 'layers'
      ? layerRows.filter((row) => row.on && !row.disabled).length + addedLayers.drawn.length
      : savedWork.shownRows.length
  );

  /** A rail seat was pressed: a mode is armed (and every other closed), an
   *  action just runs. */
  function pickTool(id) {
    if (id === 'reference') return refs.openPicker();
    arm(modes, id);
  }

  // fly the map to a capture's recorded point (item 7)
  /** Open one saved item: fly the map to it, or — for a screenshot of a site we
   *  cannot embed, filed without coordinates — reopen the page it came from. */
  /** Play a stack of located files in the panel, opening the panel if it is shut. */
  async function openMedia(items, index = 0, start = null) {
    if (!items?.length) return;
    // `start`: where a card's video was, so the panel goes on from there
    mediaView = { items, index, start };
    // a file plays in the case's own half of the panel, whichever half was up
    panelTab = 'saved';
    if (capturesCollapsed) {
      capturesCollapsed = false;
      await tick();
      engine?.resize();
    }
  }

  function openSaved(row) {
    // a file flies the map to where it stands and plays beside it, with every
    // other file on that metre a press of the arrows away
    if (row.kind === 'media') {
      const { items, index } = stackOf(savedWork.media, row);
      openMedia(items, index);
    }
    if (row.lat == null || row.lon == null) {
      if (row.source_url && !fullscreen) window.open(row.source_url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (!engine) return;
    // A tilted capture opens as it was drawn, leaning over its relief; a flat
    // one straight down, whatever the map was doing. A place is a point, not a
    // view, and keeps the camera's tilt.
    if (row.pitch > 0 && !shown.provider?.widget) {
      exaggeration = exaggerationOf(row.exaggeration);
      leanTo({
        lat: row.lat,
        lon: row.lon,
        zoom: Number(row.zoom) || engine.exactZoom(),
        bearing: row.bearing ?? 0,
        pitch: row.pitch,
        elevation: row.elevation ?? undefined,
      });
      return;
    }
    if (row.kind === 'capture' && pitch > 0) engine.setPitch(0);
    engine.setView(row, Number(row.zoom) || engine.getZoom());
    setBearing(row.bearing);
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
      openLayers(id);
      savedSearchOpen = false;
      hoveredSavedId = null;
      revealSavedId = null;
      deleteTarget = null;
      placeDeletion.cancel();
      notesItem = null;
      placeModal = null;
      detailsEntityId = null;
      temporalMapSeq += 1;
      temporalMap = null;
      temporalMapLoading = false;
      temporalMapError = '';
      // The points came out of another case's sheet, so they go with it.
      sheetPoints = null;
      mediaView = null;
      footprint.cancel();
      if (myLayers.editor && myLayers.editor.caseId !== id) { myLayers.leave(); myLayers.cancelNew(); }
      if (myLayers.exporting?.caseId !== id) myLayers.cancelDownload();
    }
    const stopSaved = savedWork.load(id);
    // Reads what is on disk, once per reload however many maps ask. The only
    // thing that then reaches out is a subscription switched on and asked to be
    // re-read on open.
    addedLayers.load(id, caseState.rev);
    untrack(() => {
      if (myLayers.editor?.caseId === id) myLayers.refresh().catch((error) => toast(error.message, 'danger'));
    });
    return () => stopSaved?.();
  });

  $effect(() => {
    if (uiState.tool === 'satellite' && (panelTab !== 'layers' || capturesCollapsed)) myLayers.stop();
  });

  $effect(() => { if (uiState.tool === 'satellite' && myLayers.armed) untrack(() => closeOthers(modes, 'layer')); });

  async function editMyLayer(row, key = null) {
    closeOthers(modes, 'layer');
    panelTab = 'layers';
    capturesCollapsed = false;
    if (myLayers.editor?.name !== row.name) await myLayers.open(row);
    if (key) myLayers.select(key);
    await tick();
    engine?.resize();
  }

  // A plate made a layer to draw in (`uiState.editLayer`): it opens here for editing,
  // the map looking where the plate's map does.
  $effect(() => {
    const asked = uiState.editLayer;
    if (uiState.tool !== 'satellite' || !asked || !engine) return;
    uiState.editLayer = null;
    untrack(() => {
      if (asked.view) engine.setView({ lat: asked.view.lat, lon: asked.view.lon }, asked.view.zoom);
      const row = addedLayers.rows.find((one) => one.name === asked.name) ?? { name: asked.name, title: asked.title, editable: true };
      editMyLayer(row).catch((error) => toast(error.message, 'danger'));
    });
  });

  function flyToLayerFeature(feature) {
    if (!engine || !feature.geometry) return;
    const walk = (node) => typeof node?.[0] === 'number' ? [node] : (node ?? []).flatMap(walk);
    const points = walk(feature.geometry.coordinates);
    if (!points.length) return;
    if (points.length === 1) engine.setView({ lon: points[0][0], lat: points[0][1] }, Math.max(center.zoom, 15));
    else engine.fitBounds(points.reduce((bounds, [lon, lat]) => ({ west: Math.min(bounds.west, lon), east: Math.max(bounds.east, lon),
      south: Math.min(bounds.south, lat), north: Math.max(bounds.north, lat) }),
      { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity }), { padding: 40 });
  }

  // The media index, read the first time the Media layer or that position is opened.
  $effect(() => savedWork.loadMode(caseState.current?.id, caseState.rev));
  $effect(() => {
    if (mediaOn) savedWork.loadMedia(caseState.current?.id, caseState.rev);
  });

  // A reloaded media index re-reads the stack being played: a file deleted or
  // unplaced elsewhere leaves it, and the viewer closes once nothing is left.
  $effect(() => {
    const fresh = savedWork.media;
    const open = untrack(() => mediaView);
    if (!open) return;
    const byKey = new Map(fresh.map((row) => [row.key, row]));
    const current = open.items[open.index]?.key;
    const items = open.items.map((row) => byKey.get(row.key)).filter(Boolean);
    if (!items.length) {
      mediaView = null;
      return;
    }
    mediaView = { items, index: Math.max(0, items.findIndex((row) => row.key === current)) };
  });

  // another workspace asked to show one capture: put the panel on the position
  // that lists it, then let the tree open its branch and scroll to it
  $effect(() => {
    const path = uiState.focusCapture;
    if (!path) return;
    const row = savedWork.rows.find((item) => item.path === path);
    if (!row) return;
    uiState.focusCapture = null;
    capturesCollapsed = false;
    panelTab = 'saved';
    savedWork.kind = 'captures';
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

  // A layer made from a sheet says whether its sheet moved on: asked each time the Map is shown.
  $effect(() => {
    const id = caseState.current?.id;
    if (uiState.tool === 'satellite' && id) untrack(() => addedLayers.recheckSheets(id));
  });

  // A layer made from a sheet: its row in sight in Layers, the map framed on its points.
  $effect(() => {
    const asked = uiState.mapLayerFit;
    if (!mapReady || !asked || !engine) return;
    uiState.mapLayerFit = null;
    untrack(() => {
      // a layer just made elsewhere: listed, and switched on here
      if (asked.row) void addedLayers.adopt(caseState.current?.id, asked.row);
      panelTab = 'layers';
      capturesCollapsed = false;
      const [west, south, east, north] = asked.bbox ?? [];
      if (![west, south, east, north].every(Number.isFinite)) return;
      if (west === east && south === north) engine.setView({ lon: west, lat: south }, Math.max(center.zoom, 15));
      else engine.fitBounds({ west, south, east, north }, { padding: 48 });
    });
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
    placesOn = false;
    mediaOn = false;
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
  const sky = createSkyState({
    engine: () => engine,
    api,
    notify: toast,
    pictureDate: () => surface?.provenance?.()?.imageryDate ?? null,
    units: () => prefs.units,
    coords: (lat, lon) => fmtCoords(lat, lon),
  });

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

  // while a shadow's tip is aimed, the line from its foot follows the pointer
  $effect(() => {
    if (!mapReady || sky.tracing !== 'tip') return;
    return engine.on('pointer-move', (at) => sky.follow(at));
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

  /** Hand that same point to the tools that open on a coordinate. Held back
   *  only while the map still sits on the saved home view nobody has moved: that
   *  is a setting, not a point somebody is looking at. A view the address named
   *  is a point — it came from a link, or from case work opening the map. */
  $effect(() => {
    const home = openingHome;
    const asked = openingView?.lat != null;
    if (!asked && center.lat === home.lat && center.lon === home.lon && center.zoom === home.zoom) return;
    uiState.mapPoint = { lat: displayCoords.lat, lon: displayCoords.lon, zoom: center.zoom };
  });

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
    tilt: () => (reliefOn ? pitch : 0),
    reliefScale: () => exaggeration,
    farProvider: () => (reliefOn && pitch > 0 && shown.provider?.meter ? FREE_FAR_PROVIDER : null),
    layered: laidOnMap,
  });

  /**
   * What is laid over the imagery now, for a capture that carries it: the
   * overlays drawn, the analyst's own layers, and the case's marks, each by its
   * layer's id (`lib/map/layerCatalog.js`, `added` for the analyst's, `leads` for
   * the scene's), the analyst's layers by name, the credits they owe, and the
   * marks painted where the screen shows them (`lib/map/paintMarks.js`).
   */
  function laidOnMap() {
    const drawnOverlays = overlays.map((entry) => (typeof entry === 'string' ? entry : entry.id));
    const added = uiState.tool === 'satellite' ? addedLayers.drawn : [];
    const shownPoints = placesOn || mediaOn ? mapPoints : [];
    const places = shownPoints.some((row) => row.kind === 'place');
    const leads = heldScene?.leads ?? [];
    const ids = [
      ...drawnOverlays,
      added.length && 'added',
      places && 'places',
      places && namesOn && 'places-names',
      shownPoints.some((row) => row.kind === 'media') && 'media',
      leads.length && 'leads',
    ].filter(Boolean);
    const credits = [...new Set([...drawnOverlays.map(overlayAttribution), ...added.map(owedCredit)].filter(Boolean))];
    return {
      ids,
      // as many as a capture names (`api/satellite.MAX_LAYER_NAMES`)
      names: added.map((row) => row.title || row.name).filter(Boolean).slice(0, 40),
      credits: credits.join(' · '),
      paint: (ctx, { rect, scale }) =>
        paintCaseMarks(ctx, {
          saved: shownPoints,
          zoom: engine.getZoom(),
          names: namesOn,
          leads,
          leadColour: sceneColorAt(heldScene?.order),
          // where the page lays a mark: the globe stands it on its ground, hidden behind the relief
          project: (at) => (engine.globe ? engine.globe.standingAt(at.lat, at.lon) : engine.latLngToContainerPoint(at)),
          rect,
          scale,
        }),
    };
  }
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
        zIndex: 570,
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

  // A grid is a flat lattice of cells, swept straight down one cell at a time,
  // which a map leaning over relief cannot lay out: switching the 3D map on
  // closes it, and its rail seat stays shut while the relief is on.
  const GRID_FLAT_ONLY = 'Grid Search works on the flat map. Turn 3D off to use it';
  $effect(() => {
    if (reliefOn && grid.on) modes.grid.close();
  });

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

  // --- dropping a pin where the analyst clicks (state/drop.svelte.js) ---
  // While the case geolocates a scene, a click drops one of its leads, in its colour
  // and numbered; otherwise the pin asks for a name and is saved as a place of the case.
  const heldScene = $derived(
    geolocating.caseId && geolocating.caseId === caseState.current?.id ? geolocating.scene : null,
  );
  const drop = createDropState({
    engine: () => engine,
    held: () => heldScene,
    dropLead: (at) => dropLead(caseState.current.id, at),
    moveLead: (id, at) => moveLead(caseState.current.id, id, at),
    removeLead: (id) => removeLead(caseState.current.id, id),
    savePlace: async ({ lat, lon, title }) => {
      const c = await ensureCase();
      const place = await api.post(`/api/cases/${c.id}/satellite/place`, { lat, lon, zoom: center.zoom, bearing, title });
      await reloadCase();
      // a place saved is seen: its layer comes back on if it was off
      placesOn = true;
      filedToast('Place saved', [place], { fallback: 'Place saved. Find it in the case sidebar' });
    },
    centre: (at) => engine?.setView(at, center.zoom),
    notify: toast,
  });
  // the scene's leads and the pin waiting for its name, drawn again when they move
  const leadsKey = $derived(JSON.stringify([heldScene?.order ?? null, heldScene?.leads ?? []]));
  const namingAt = $derived(drop.naming ? `${drop.naming.lat},${drop.naming.lon}` : '');
  $effect(() => {
    void leadsKey;
    void namingAt;
    if (mapReady) untrack(() => drop.draw());
  });
  // a place in the hand follows the pointer, and is let go of with the case it was in
  $effect(() => {
    if (!mapReady || !placeMove.on || !engine) return;
    const element = mapEl;
    const leave = () => placeMove.hide();
    const stopMoving = engine.on('pointer-move', (at) => placeMove.follow(at));
    element?.addEventListener('pointerleave', leave);
    return () => {
      stopMoving();
      element?.removeEventListener('pointerleave', leave);
    };
  });
  const movingIn = $derived(caseState.current?.id ?? null);
  $effect(() => {
    void movingIn;
    untrack(() => placeMove.cancel());
  });

  // while the drop is armed, a pale pin follows the pointer to show where a click lands
  $effect(() => {
    if (!mapReady || !drop.armed || !engine) return;
    const element = mapEl;
    const leave = () => drop.hideGhost();
    const stopMoving = engine.on('pointer-move', (at) => drop.ghost(at));
    element?.addEventListener('pointerleave', leave);
    return () => {
      stopMoving();
      element?.removeEventListener('pointerleave', leave);
      drop.hideGhost();
    };
  });

  // Deletions drop a file / an entity — always behind a confirm. The target is
  // a saved-index row; its kind says which of the two it is.
  let deleteTarget = $state(null);
  const DELETE_WORDS = {
    place: { title: 'Delete this place?', detail: 'Moves the saved point to the case trash.' },
    comparison: {
      title: 'Delete this comparison?',
      detail: 'Moves the saved comparison to the case trash. Its images stay in Media.',
    },
    view: {
      title: 'Delete this view?',
      detail: 'Moves the saved Horizon view to the case trash. Its images stay in Media.',
    },
  };
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

  /** The edit action, for whichever kind of row it was pressed on. A comparison
   *  or a view is edited where it was made. */
  function editSaved(row) {
    if (row.kind === 'place') openEditPlace(row);
    else if (row.kind === 'comparison') openComparison(row);
    else if (row.kind === 'view') openHorizonView(row);
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

  /**
   * A capture or a place, queued for the composer to build a proof on: the proof of the
   * scene the case geolocates when that scene gathered it (`lib/toGeoProof.js`).
   */
  function sendToComposer(item) {
    sendToGeoProof(caseState.current?.id ?? null, [{ path: item.path }]);
  }

  /** A proof already built on the file being played: open it where it lives. */
  function openProofByName(proof) {
    if (!proof?.name) return;
    uiState.openProof = proof.name;
    uiState.tool = 'proof';
  }

  // the HUD readout and everything copied out of it follow the user's
  // coordinate format (Settings → General); captures keep decimal degrees
  const readout = $derived(fmtCoords(displayCoords.lat, displayCoords.lon));

  async function copyCoords() {
    await copyText(readout);
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

  // --- place edit modal (title + notes) for a saved place ---
  // { id, title, notes, folder, lat, lon, zoom, bearing }
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

  let detailsTitle = '';

  // The saved place open here, in its dialog or its Details, is what the topbar's
  // Add event seats.
  $effect(() => {
    const id = placeModal?.id ?? detailsEntityId;
    offerNote(
      'satellite',
      id
        ? { id, label: placeModal?.title ?? detailsTitle, type: 'place', attrs: {} }
        : null,
    );
  });
  onDestroy(() => withdrawNote('satellite'));

  // -- into the note pinned beside ----------------------------------------------
  // The view (filed as a capture, once for the same view), the point, and the
  // measure in hand. The saved place open here names the view and leads the point.
  function seatedPlace() {
    if (placeModal?.id) return { id: placeModal.id, label: placeModal.title, type: 'place', lat: placeModal.lat, lon: placeModal.lon };
    if (!detailsEntityId) return null;
    const row = savedWork.rows.find((item) => item.id === detailsEntityId);
    return row ? { id: row.id, label: detailsTitle || row.title, type: 'place', lat: row.lat, lon: row.lon } : null;
  }

  /** The line selected in a seat, as `mapNote.measureNoteText` reads it, or null. */
  function lineForNote(tool) {
    const m = tool.drawing ? null : tool.selected;
    if (!m || m.points.length < 2) return null;
    return {
      text: tool.text(m.id),
      use: m.closed ? '' : m.use,
      ground: !m.closed && tool.groundOn,
    };
  }
  const measureForNote = () => lineForNote(measure);
  const alignmentForNote = () => lineForNote(align);
  /** The shadow read in Sun and moon, once it says something. */
  function shadowForNote() {
    const text = sky.shadowText();
    return text ? { text, use: 'shadow' } : null;
  }

  const noteView = viewOffer({ take: (options) => capture.takeForNote(options), label: () => seatedPlace()?.label ?? '' });
  const notePoint = pointOffer({
    point: () => ({ place: seatedPlace(), lat: displayCoords.lat, lon: displayCoords.lon }),
  });
  const noteMeasure = measureOffer({ measure: measureForNote });
  const noteAlignment = measureOffer({
    measure: alignmentForNote,
    id: 'alignment',
    label: 'This alignment',
    icon: 'alignment',
    missing: 'Draw an alignment first',
  });
  const noteShadow = measureOffer({ measure: shadowForNote, id: 'shadow', label: 'This shadow', icon: 'sun', missing: 'Read a shadow first' });
  offerPuts('satellite', () => [
    ...(capture.blocked ? [] : [noteView]),
    notePoint,
    ...(measureForNote() ? [noteMeasure] : []),
    ...(alignmentForNote() ? [noteAlignment] : []),
    ...(shadowForNote() ? [noteShadow] : []),
  ]);

  // The point right-clicked, held as it was: the menu closes before the put runs.
  const clickedPoint = $derived.by(() => {
    const at = pointMenu;
    return at ? pointOffer({ point: () => ({ lat: at.lat, lon: at.lon }) }) : null;
  });

  function openPlaceDetails() {
    detailsDirty = false; // a fresh panel, whatever the last one was left holding
    detailsEntityId = placeModal?.id ?? null;
    detailsTitle = placeModal?.title ?? '';
    placeModal = null;
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

  /** An edit of a saved place: a new place is dropped and named on the map (`state/drop.svelte.js`). */
  async function savePlaceModal() {
    if (!placeModal?.id || placeSaving) return;
    placeSaving = true;
    try {
      const m = placeModal;
      const caseId = caseState.current.id;
      // retitle + set/clear the note
      const title = m.title.trim() || placeCoordsLabel(m);
      await api.patch(`/api/cases/${caseId}/entities/${m.id}`, {
        label: title,
        attrs: { notes: m.notes.trim(), folder: m.folder ?? '' },
      });
      if (m.relation) await saveRelation(caseId, m.id, m.relation);
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

<!-- the window back from a spreadsheet: a layer made from a sheet says whether the sheet moved on -->
<svelte:window onfocus={() => { if (uiState.tool === 'satellite') addedLayers.recheckSheets(caseState.current?.id); }} />

{#snippet refWindow(pane)}
  <RefViewer
    viewer={pane}
    caseId={caseState.current?.id}
    onfocus={(id) => refs.focus(id)}
    onclose={(id) => refs.close(id)}
    onplace={(id, where) => refs.place(id, where)}
    onkeep={(id, still, at) => refs.keepFrame(id, still, at)}
  />
{/snippet}

{#snippet refColumn(side)}
  {#if refsHere && refs.dockedOn(side).length}
    <RefDock {side} width={refs.dockWidth(side)} onwidth={(w, total) => refs.setDockWidth(side, w, total)}>
      {#each refs.dockedOn(side) as pane (pane.id)}
        {@render refWindow(pane)}
      {/each}
    </RefDock>
  {/if}
{/snippet}

<div class="tool" class:fullscreen bind:this={toolEl}>
  <div class="body" style:--surface-ctl-reserve={`${12 + searchWidth + 8}px`}>
    {@render refColumn('left')}
    {#if homeReady}
      <MapSurface
        bind:this={surface}
        bind:engine
        bind:element={mapEl}
        bind:view={center}
        bind:bearing
        reliefOffered
        bind:reliefOn
        bind:exaggeration
        bind:pitch
        bind:reliefReady
        bind:onGlobe
        bind:ready={mapReady}
        bind:refused={mapRefused}
        bind:providerId
        {imagery}
        {s2}
        wayback={wb}
        {s1}
        home={opensOn}
        {overlays}
        imperial={prefs.units === 'imperial'}
        controlsTop={railBottom}
        armed={armedCursor}
        grabbing={capture.hiding}
        onclick={onMapClick}
        oncontextmenu={onMapContextMenu}
        onusage={() => imagery.refreshUsage()}
        onoverlaytrouble={(id) => id === 'firms' && fireTrouble()}
        onviewsettled={(camera) => share.settled(camera, engine?.maxZoom())}
      >
      <!-- the case's places and placed footage, its two layers: navigation only -->
      {#if placesOn || mediaOn}
        <SavedOverlay
          engine={mapReady ? engine : null}
          items={mapPoints}
          caseId={caseState.current?.id}
          coords={coordsLabel}
          {fullscreen}
          bind:hoveredId={hoveredSavedId}
          activeKey={mediaView ? mediaView.items[mediaView.index]?.key : null}
          movingKey={placeMove.row ? (placeMove.row.key ?? placeMove.row.id) : null}
          names={namesOn}
          areas={!armedMode}
          onopen={openSaved}
          onedit={editSaved}
          ondelete={(row) => placeDeletion.open(row.id)}
          onrefresh={reloadCase}
          ontrace={startTrace}
          onexpand={openMedia}
          onmove={pickUpPlace}
        />
      {/if}

      <!-- Both handoff layers can be on at once. Neither carries a card of its
           own any more: what they are and what to do with them is a row in the
           Layers list, with every other layer. -->
      <!-- Somebody else's map over this one. GL sources rather than the DOM
           markers the case's own pins use: a foreign layer can hold tens of
           thousands of features, which is an order of magnitude past what a
           `div` each can carry. Drawn only while this tab is on screen, so a
           hidden map holds no copy of them; the features stay in the store. -->
      <LayerGeometry engine={mapReady ? engine : null} controller={myLayers} active={uiState.tool === 'satellite'} onmenu={onMapContextMenu} />
      <AddedLayersOverlay
        engine={mapReady ? engine : null}
        caseId={caseState.current?.id ?? ''}
        layers={uiState.tool === 'satellite' ? addedLayers.drawn : []}
        drawing={addedLayers.drawing}
        watch={addedLayers.watch}
        picked={addedLayers.picked}
        onmenu={onMapContextMenu}
        interactive={!armedCursor}
        onedit={editMyLayer}
        onremovefeature={(row, key) => myLayers.remove(key, row)}
        ondeleteplace={placeDeletion.open}
        oncopyfeature={(row, feature, anchor) => myLayers.copy(row, feature, anchor)}
      />

      {#if sheetPoints && sheetShown}
        <SheetPointsOverlay engine={mapReady ? engine : null} points={sheetPoints.points} />
      {/if}

      <!-- where Horizon stands now, dashed: no save has kept it yet -->
      <HorizonEyeOverlay
        engine={mapReady ? engine : null}
        eye={uiState.horizonEye}
        onopen={() => (uiState.tool = 'horizon')}
      />

      {#if temporalMap && temporalShown}
        <TemporalMapOverlay
          engine={mapReady ? engine : null}
          items={temporalMap.items}
          caseId={caseState.current?.id}
          onopen={openTemporalTimeline}
        />
      {/if}

      <!-- What the window does with the tool, beside the imagery it shows. -->
      {#snippet beside()}
        <div class="window-ctl" data-guide="sat.window">
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
      {/snippet}

      <!-- The search floats over the map as Detect's does, above the rail: the
           tab strip already says which tool this is. -->
      <div class="map-bar" bind:clientHeight={searchHeight} bind:clientWidth={searchWidth} data-bar-obstacle data-guide="sat.search">
        <!-- Two identical windows on a second screen are otherwise impossible to
             tell apart; the first one needs no number and says nothing. -->
        {#if windowNumber}<span class="window-no mono" title="This map's window">Map {windowNumber}</span>{/if}
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

      <!-- The map's toolbox, and the one slot the armed tool's settings open
           in. Only verbs live here; what is *drawn* over the imagery is a layer
           and is listed in the panel on the right. -->
      {#if !myLayers.editor}
      <div class="map-tools" style:top={`${railTop}px`} bind:clientWidth={toolsWidth} data-guide="sat.tools">
        <MapRail
          sections={RAIL}
          bind:height={railHeight}
          state={{
            measure: { on: modes.measure.isOn() },
            align: { on: modes.align.isOn() },
            grid: { on: grid.on, disabled: reliefOn, title: reliefOn ? GRID_FLAT_ONLY : undefined },
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
                tool={measure}
                onkeep={(id, anchor) => keepMeasure(measure, id, anchor)}
                oncopy={(id) => copyText(measure.text(id))}
                onlook={lookAlong}
              />
            {:else if armedMode === 'align'}
              <MeasurePanel
                tool={align}
                onkeep={(id, anchor) => keepMeasure(align, id, anchor)}
                oncopy={(id) => copyText(align.text(id))}
              />
            {:else if armedMode === 'sky'}
              <SunPanel
                sky={sky.sky}
                loading={sky.loading}
                day={sky.day}
                index={sky.index}
                anchor={sky.anchor}
                placing={sky.placing}
                shadow={sky.shadow}
                ondate={(value) => sky.setDay(value)}
                onindex={(value) => sky.setIndex(value)}
                onplace={() => sky.togglePlacing()}
                onclose={toggleSunMode}
                ontraceshadow={() => sky.traceShadow()}
                onclearshadow={() => sky.clearShadow()}
                onmoment={(i) => sky.showMoment(i)}
                oncopyshadow={() => copyText(sky.shadowText())}
                onswapshadow={() => sky.swapShadow()}
              />
            {:else if armedMode === 'footprint'}
              <FootprintPanel
                place={footprint.place}
                points={footprint.points.length}
                complete={footprint.complete}
                covers={footprint.covers}
                ready={footprint.ready}
                bind:title={footprint.title}
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
      {/if}

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

      <!-- middle-drag rotation: the wheel about the grabbed point, pinned on
           screen while the map turns around it -->
      {#if rotating}
        <TurnGuide x={rotatePivot.x} y={rotatePivot.y} />
      {/if}

      <!-- What Measure and Align draw on the screen: the stretch to come while a
           line is drawn, and in 3D a measure's line of sight standing in the air. -->
      {#if lines}
        <MeasureOverlay engine={mapReady ? engine : null} live={lines.live} air={measure.on ? measureAir : null} />
      {/if}

      <!-- A measured line's ground, in a window the analyst moves and sizes, read
           both ways with the line on the map. -->
      {#if measure.on && measure.selected && !measure.drawing && !measure.selected.closed && measure.groundOn && measure.ground && measure.chartShown}
        <FloatingWindow
          id="measure-ground"
          title={`Ground along measure ${measure.selectedId}`}
          icon="profile"
          foldable
          min={{ w: 560, h: 290 }}
          placement={groundWindowPlace}
          onclose={() => measure.showChart(false)}
        >
          {#snippet header()}
            <SightVerdict
              sight={measure.selected.points.length === 2 ? (measure.ground.answer?.sight ?? null) : null}
              corners={measure.selected.points.length === 2 ? (measure.ground.answer?.corners ?? null) : null}
              busy={measure.ground.busy}
              units={measure.units}
            />
          {/snippet}
          <MeasureGround
            tool={measure}
            onlook={() => lookAlong(measure.selectedId)}
            onpick={(index) => {
              const answer = measure.ground.answer;
              if (answer) engine?.setView({ lat: answer.lat[index], lon: answer.lon[index] }, center.zoom);
            }}
          />
        </FloatingWindow>
      {/if}

      {#if keeping && caseState.current}
        <MeasureKeepMenu
          caseId={caseState.current.id}
          feature={keeping.feature}
          anchor={keeping.anchor}
          onclose={() => (keeping = null)}
          ondone={() => {
            keeping.tool.remove(keeping.id);
            keeping = null;
          }}
        />
      {/if}

      <!-- Where you are, then the two acts that take something off the map. The imagery provider left this bar
           for the surface's own corner: it describes the picture, not the
           tool, and two compared surfaces each show their own. -->
      <MapStatusBar
        coords={readout}
        height={groundHeight == null ? '' : formatHeight(groundHeight, prefs.units)}
        zoom={center.zoom}
        pinned={moveMode && !!markerLatLng}
        copy={copyCoords}
      >
        <!-- What marks the point and whether it is the centre: one square, set
             once, beside the two acts that are pressed all day. -->
        {#if !myLayers.editor}
        <MarkerMenu bind:style={markerStyle} free={moveMode} toggleFree={toggleMoveMode} />
        <!-- One button arms the drop: each click on the map drops a lead of the scene
             being geolocated, or a pin to name and save as a place. Escape ends it. -->
        <span class="place-split" data-guide="sat.place">
          <button
            class="btn place-drop"
            class:on={drop.armed}
            aria-pressed={drop.armed}
            onclick={() => arm(modes, 'drop')}
            title={drop.armed ? DROP_HELP.stop : heldScene ? DROP_HELP.lead : DROP_HELP.place}
          >
            {#if heldScene}
              <span class="drop-dot" style:--scene={sceneColorAt(heldScene.order)} aria-hidden="true"></span>
              <Icon name="pin" size={15} /> Drop a lead
            {:else}
              <Icon name="pin" size={15} /> Save place
            {/if}
          </button>
          <button
            class="btn place-more"
            class:on={footprint.on && footprint.place?.fresh}
            bind:this={placeMenuAnchor}
            aria-haspopup="menu"
            aria-expanded={placeMenu}
            aria-label="Save a place or a zone"
            title="Save a place or a zone"
            onclick={() => (placeMenu = !placeMenu)}
          ><Icon name="chevronDown" size={13} /></button>
        </span>
        {#if placeMenu}
          <FloatingMenu anchor={placeMenuAnchor} width={200} label="Save a place or a zone" onclose={() => (placeMenu = false)}>
            <button class="fm-item" role="menuitem" onclick={() => { placeMenu = false; arm(modes, 'drop'); }}
              title="Drop a pin where you click, then name it">
              <Icon name="pin" size={13} /> Save place
            </button>
            <button class="fm-item" role="menuitem" onclick={startZone}
              title="Click the corners of an area, then name it">
              <Icon name="polygon" size={13} /> Save zone
            </button>
          </FloatingMenu>
        {/if}
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
          bind:layers={capture.layers}
          tilted={reliefOn && pitch > 0}
          openScreenshot={() => (capture.shotOpen = true)}
          openExtensionGate={() => (capture.extGate = true)}
          openFigure={isSentinel ? openFigure : null}
          openPlate={caseState.current ? () => { uiState.newPlate = true; uiState.tool = 'plate'; } : null}
          noteOffer={noteView}
        />
        {/if}
      </MapStatusBar>
      {#if figureOpen && caseState.current}
        <FigureDialog
          caseId={caseState.current.id}
          day={s2.day}
          maxcc={s2.maxcc}
          view={{ lat: center.lat, lon: center.lon, zoom: center.zoom, bearing }}
          width={capture.size[0]}
          height={capture.size[1]}
          layers={s2.layers}
          scaleNorth={capture.scaleNorth}
          onclose={() => (figureOpen = false)}
          onbuilt={(built) => {
            figureOpen = false;
            // Straight into the composer: a figure is made to be annotated, and
            // its panels are already filed whether or not it is opened now.
            uiState.openProof = built.proof.name;
            uiState.tool = 'proof';
          }}
        />
      {/if}
      {#if pointMenu}
        <MapContextMenu
          at={pointMenu}
          frame={pointMenu.frame}
          zoom={center.zoom}
          format={prefs.coordFormat}
          {fullscreen}
          actions={pointActions}
          tools={pointTools}
          lookup={pointMenu.lookup}
          {compareSources}
          notePoint={clickedPoint}
          onpick={onPointMenu}
          onclose={closePointMenu}
        />
      {/if}
      <!-- a dropped pin asks for its name before it is a place of the case -->
      {#if drop.naming && engine}
        <PlaceNamer
          {engine}
          pin={drop.naming}
          saving={drop.saving}
          coords={fmtCoords(drop.naming.lat, drop.naming.lon)}
          ontitle={(title) => drop.setTitle(title)}
          onsave={() => drop.save()}
          oncancel={() => drop.cancel()}
        />
      {/if}
      <!-- floating reference-image windows (scratch aids over the map) -->
      {#each refsHere ? refs.floating : [] as pane (pane.id)}
        {@render refWindow(pane)}
      {/each}
      </MapSurface>
    {/if}

    {@render refColumn('right')}

    <aside
      class="captures"
      data-guide="sat.panel"
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
      {#if capturesCollapsed}
        <!-- collapsed: the header is the way back, and names what it will open on -->
        <button
          type="button"
          class="cap-head"
          onclick={toggleCaptures}
          title="Show the panel"
        >
          <span class="cap-open" data-guide="sat.panel-open"><Icon name="chevronLeft" size={15} /></span>
          <span class="label" style="margin:0">{PANEL_TABS[panelTab]}</span>
          <span class="count">{panelCount}</span>
        </button>
      {:else}
        <!-- Two tabs, because the panel answers two questions: what is drawn
             over the imagery, and what this case holds. They used to be one
             scroll under a header that named only the second of them. -->
        <div class="cap-head">
          <button
            type="button"
            class="cap-collapse"
            onclick={toggleCaptures}
            title="Hide the panel"
            aria-label="Hide the panel"
          >
            <Icon name="chevronRight" size={15} />
          </button>
          <!-- The two halves share the width evenly, and carry no count: each
               section under them states its own, and a header repeating
               "LAYERS 2" thirty pixels above "LAYERS 2" says nothing twice. -->
          <div class="tabs" role="tablist" aria-label="Map panel">
            {#each Object.entries(PANEL_TABS) as [id, label] (id)}
              <button
                type="button"
                class="tab"
                class:on={panelTab === id}
                role="tab"
                aria-selected={panelTab === id}
                onclick={() => (panelTab = id)}
              >{label}</button>
            {/each}
          </div>
        </div>

        <div class="panel-scroll">
          {#if panelTab === 'layers'}
          <!-- What is drawn over the imagery. One list: the labels and the saved
               pins used to be buttons in the toolbox, and the handoffs floating
               cards over the map. -->
          {#if !myLayers.editor}
            <MapLayers rows={layerRows} bind:open={layersOpen} />
          {/if}

          {#if uiState.tool === 'satellite'}<MyLayers
            rows={addedLayers.rows}
            controller={myLayers}
            onnew={() => myLayers.newLayer()}
            onedit={editMyLayer}
            ontoggle={(row) => addedLayers.toggle(caseState.current?.id, row)}
            onfly={flyToLayerFeature}
            onremove={(row) => (removingLayer = row)}
            onreorder={(names) => addedLayers.reorder(caseState.current?.id, names)}
            oncategory={(row, name) => addedLayers.toggleCategory(caseState.current?.id, row, name)}
            ondeleteplace={placeDeletion.open}
          />{/if}

          <!-- …and under it, what the analyst put there themselves. Two
               sections rather than one list: the line is who chose the layer,
               and an added one carries a source, a freshness and a Remove that
               a curated one has no use for. -->
          {#if !myLayers.editor}
          <AddedLayers
            rows={addedLayers.rows.filter((row) => !row.editable)}
            busy={addedLayers.busy}
            refreshing={addedLayers.refreshing}
            opened={addedLayers.justAdded}
            bind:open={addedLayers.open}
            search={addedLayers.search}
            ontoggle={(row) => addedLayers.toggle(caseState.current?.id, row)}
            oncategory={(row, name) =>
              addedLayers.toggleCategory(caseState.current?.id, row, name)}
            onrefresh={(row) => addedLayers.refresh(caseState.current?.id, row)}
            onrefreshall={() => addedLayers.refreshAll(caseState.current?.id)}
            onreorder={(names) => addedLayers.reorder(caseState.current?.id, names)}
            onremove={(row) => (removingLayer = row)}
            onpick={(row, hit) => addedLayers.pick(caseState.current?.id, row, hit)}
            dates={addedLayers.dates}
            onperiod={(row, period, commit) =>
              addedLayers.setPeriod(caseState.current?.id, row, period, commit)}
            onadd={() => (addedLayers.adding = true)}
            oncopy={(row) => myLayers.newLayer(row)}
          />
          {/if}
          {:else if mediaView}
          <!-- A located file, played in place of the list rather than over the
               map it is being compared with. Closing it brings the list back as
               it was left. -->
          <MediaViewer
            items={mediaView.items}
            bind:index={mediaView.index}
            start={mediaView.start}
            caseId={caseState.current?.id}
            coords={coordsLabel}
            {fullscreen}
            onclose={() => (mediaView = null)}
            onmedia={(row) => openEntity({ id: row.id, type: 'media', attrs: { path: row.path } })}
            onproof={openProofByName}
            layerItems={mediaLayers}
            onopenlayer={openMediaInLayer}
          />
          {:else}
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
            ondelete={(row) => row.kind === 'place' ? placeDeletion.open(row.id) : (deleteTarget = row)}
            onproof={sendToComposer}
            onaccept={acceptSaved}
            onbrowse={() => (savedSearchOpen = true)}
            onlocate={runLocate}
            oncancelLocate={savedWork.stopLocate}
          />
          {/if}
        </div>
      {/if}
    </aside>
  </div>
</div>

{#if myLayers.dialog && uiState.tool === 'satellite'}
  <NewLayerDialog
    source={myLayers.dialog.source}
    busy={addedLayers.saving}
    onclose={() => myLayers.cancelNew()}
    oncreate={async (title, start, description, track) => {
      await myLayers.create(title, start, description, track);
      if (myLayers.editor) await editMyLayer(myLayers.editor);
    }}
  />
{/if}

{#if addedLayers.adding}
  <AddLayerDialog
    busy={addedLayers.saving}
    onclose={() => (addedLayers.adding = false)}
    onfile={(file, icons) => addedLayers.addFile(file, icons)}
    onurl={(url, icons) => addedLayers.subscribe(url, icons)}
    ongeoconfirmed={() => {
      addedLayers.adding = false;
      addedLayers.geoconfirmed = true;
    }}
  />
{/if}

{#if addedLayers.geoconfirmed}
  <GeoConfirmedDialog
    busy={addedLayers.saving}
    load={addedLayers.conflicts}
    view={() => engine?.viewBounds?.() ?? null}
    onclose={() => (addedLayers.geoconfirmed = false)}
    onadd={(body) => addedLayers.addGeoConfirmed(body)}
  />
{/if}

<!-- Removing a layer takes the snapshot with it, which for a subscription is
     the only copy of what was last served. -->
{#if removingLayer}
  <ConfirmDialog
    title="Remove this layer?"
    message={`“${removingLayer.title}” will be taken off the map and out of the case.`}
    detail="Moves the layer and the copy it was drawn from to the case trash."
    impact={{ caseId: caseState.current?.id, paths: [removingLayer.spec] }}
    restorable={RESTORABLE}
    confirmLabel="Remove"
    tone="default"
    busy={addedLayers.busy === removingLayer.name}
    onconfirm={async () => {
      const owner = caseState.current?.id;
      const row = removingLayer;
      const result = await addedLayers.remove(owner, row);
      if (result) {
        removingLayer = null;
        deletedToast(owner, result, row.title);
      }
    }}
    oncancel={() => (removingLayer = null)}
  />
{/if}

{#if uiState.tool === 'satellite'}
  <PlaceDeleteDialog controller={placeDeletion} />
  {#if myLayers.exporting}<LayerExportDialog target={myLayers.exporting} onclose={() => myLayers.cancelDownload()} />{/if}
  <LayerAddDialogs tool="satellite" onfly={flyToLayerFeature} />
{/if}

<!-- delete confirm: a capture drops its image file, a place or a comparison its entity -->
{#if deleteTarget}
  <ConfirmDialog
    title={DELETE_WORDS[deleteTarget.kind]?.title ?? 'Delete this capture?'}
    message={`“${deleteTarget.title || coordsLabel(deleteTarget)}” will be removed from the case.`}
    detail={DELETE_WORDS[deleteTarget.kind]?.detail ?? 'Moves the capture and its image to the case trash.'}
    impact={{ caseId: caseState.current?.id, ...savedWork.target(deleteTarget) }}
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
    ondelete={(row) => row.kind === 'place' ? placeDeletion.open(row.id) : (deleteTarget = row)}
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
    bind:category={refs.category}
    bind:showWorking={refs.showWorking}
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
  /* a lead of the scene geolocated: grabbed to move it, pressed to centre on it */
  :global(.sat-lead) {
    cursor: grab;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
  }
  /* the lead picked, which Delete removes: ringed in white, a size up, its tip kept */
  :global(.sat-lead.is-selected > svg) {
    transform: scale(1.2);
    transform-origin: 13px 35px;
    filter: drop-shadow(0 0 0 #fff) drop-shadow(0 0 1.5px #fff) drop-shadow(0 0 1.5px #fff);
  }
  /* the pin waiting for its name, the place's own drop: grabbed to move it */
  :global(.sat-naming) {
    cursor: grab;
  }
  /* the pin following the pointer while the drop is armed: the click goes through it.
     Pale on its content: the engine writes the mark's own opacity inline */
  :global(.sat-ghost) {
    pointer-events: none;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4));
  }
  :global(.sat-ghost > *) {
    opacity: 0.6;
  }
  .map-bar {
    position: absolute;
    top: 12px;
    left: 12px;
    /* over the rail (1100), which its suggestions list drops across */
    z-index: 1150;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px;
    border-radius: var(--radius-1);
    background: rgba(24, 24, 24, 0.88);
    backdrop-filter: blur(6px);
    box-shadow: 0 0 0 1px var(--border);
  }
  .map-bar :global(.place-search) {
    width: min(360px, 30vw);
  }
  /* no frame of its own: it shares the imagery card (MapSurface's .ctl-row),
     after a rule, as Compare's source card ends on its own two buttons */
  .window-ctl {
    display: flex;
    align-items: center;
    gap: 2px;
    padding-left: 5px;
    margin-left: 1px;
    border-left: 1px solid var(--border);
  }
  .window-ctl .btn-icon {
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    color: var(--text-2);
    background: transparent;
    border-color: transparent;
  }
  .window-ctl .btn-icon:hover:not(:disabled) {
    color: var(--text-1);
    background: var(--bg-2);
    border-color: transparent;
  }
  .window-ctl .btn-icon.on {
    color: var(--accent);
    background: var(--accent-soft);
  }
  .window-no {
    padding: 0 6px;
    font-size: var(--fs-xs);
    color: var(--text-2);
    white-space: nowrap;
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
  .place-drop {
    white-space: nowrap;
  }
  /* Save place and its arrow, one button in two parts as Capture's is */
  .place-split {
    display: inline-flex;
  }
  .place-split > .place-drop {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
  .place-more {
    padding-inline: 6px;
    border-left: 1px solid var(--border);
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }
  .place-more.on {
    border-color: var(--accent);
    color: var(--text-1);
  }
  /* armed: the accent edge says each click on the map now drops one */
  .place-drop.on {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
    color: var(--text-1);
  }
  .drop-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--scene);
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
  /* the arrow alone, so the guide can point at it */
  .cap-open {
    display: grid;
    place-items: center;
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
  /* `.sub-head` is in app.css: each section writes its own heading, and they
     have to read as one panel. */

  /* The two halves of the panel, in its header: one track split evenly, so the
     pair reads as one control rather than as two buttons that happen to be
     adjacent. Full width because there are exactly two and they are the whole
     of what this panel can be showing. */
  .tabs {
    display: flex;
    flex: 1;
    gap: 3px;
    padding: 3px;
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    background: var(--bg-0);
  }
  .tab {
    flex: 1;
    padding: 5px 10px;
    border: none;
    border-radius: var(--r-md);
    background: none;
    color: var(--text-3);
    font: inherit;
    font-size: var(--fs-sm);
    font-weight: 500;
    line-height: 1.2;
    cursor: pointer;
    transition: background 0.12s var(--ease), color 0.12s var(--ease);
  }
  .tab:hover:not(.on) {
    color: var(--text-1);
    background: var(--bg-3);
  }
  .tab.on {
    background: var(--bg-3);
    color: var(--text-1);
    box-shadow: var(--shadow-1);
  }
  /* The collapse is a window control, not a third tab: sized down and kept in
     the gutter the section chevrons below it already occupy. */
  .cap-collapse {
    display: grid;
    place-items: center;
    flex: none;
    width: 22px;
    height: 22px;
    border: none;
    border-radius: var(--r-md);
    background: none;
    color: var(--text-3);
    cursor: pointer;
  }
  .cap-collapse:hover {
    color: var(--text-1);
    background: var(--bg-3);
  }


</style>
