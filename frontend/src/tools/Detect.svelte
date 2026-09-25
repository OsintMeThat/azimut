<script>
  /**
   * Detect: watch an area of Copernicus Sentinel-2 or Sentinel-1 over time.
   *
   * It stands on its own rather than inside Compare, because it is a different
   * job: Compare reads two pictures side by side, while this one sweeps ground
   * and comes back to it. One map is enough for that — the evidence for a
   * candidate is the before/after picture the panel shows, not a second
   * surface — so the map here is the ground you draw on and the pass you are
   * about to read, and the column beside it holds the work.
   *
   * Nothing here fetches imagery on its own beyond the basemap the map shows.
   * Starting a run, and looking a pass up, are the acts that reach Copernicus.
   *
   * The ruler over the map is for the thing on it: how long a hull is, how far
   * a wake runs. Its measures are a scratch aid, gone with the session.
   */
  import { onMount, tick, untrack } from 'svelte';
  import { api } from '../lib/api.js';
  import { caseState, dismissToast, prefs, prefsReady, toast, uiState } from '../lib/state.svelte.js';
  import { marksToZones, sourceLabel, viewZone, zoneMarks, zoneRing } from '../lib/map/analyzers.js';
  import { blinkable } from '../lib/map/detectReview.js';
  import { DEFAULT_BLINK_INTERVAL } from '../lib/map/compare.js';
  import { createImageryState } from './satellite/state/imagery.svelte.js';
  import { createSentinelState } from './satellite/state/sentinel.svelte.js';
  import { createRadarState } from './satellite/state/radar.svelte.js';
  import { RADAR_ID, passLabel } from '../lib/radar.js';
  import { copernicusNeed } from '../lib/copernicusSetup.js';
  import { actionsFor, otherMapTools } from '../lib/map/contextMenu.js';
  import { openMapAt } from '../lib/navigate.js';
  import { shareView } from '../lib/map/sharedView.js';
  import { COMPARE_SOURCES, comparePair } from '../lib/map/comparePair.js';
  import CopernicusNeeded from '../components/CopernicusNeeded.svelte';
  import MapSurface from './satellite/MapSurface.svelte';
  import MapContextMenu from './satellite/MapContextMenu.svelte';
  import PlaceSearch from './satellite/PlaceSearch.svelte';
  import ImageryChip from './satellite/ImageryChip.svelte';
  import MapLayers from './satellite/MapLayers.svelte';
  import Compass from '../components/Compass.svelte';
  import TurnGuide from '../components/TurnGuide.svelte';
  import Icon from '../components/Icon.svelte';
  import { createWaybackState } from './satellite/state/wayback.svelte.js';
  import { turnFromKey, turnFromPress } from '../lib/map/gestures.js';
  import AnnotationCanvas from './compare/AnnotationCanvas.svelte';
  import AnalysisOverlay from './detect/AnalysisOverlay.svelte';
  import DetectAreas from './detect/DetectAreas.svelte';
  import DetectPanel from './detect/DetectPanel.svelte';
  import CheckMarks from './detect/CheckMarks.svelte';
  import RuleLayers from './detect/RuleLayers.svelte';
  import RuleProbe from './detect/RuleProbe.svelte';
  import './mapdock.css';

  const SENTINEL = 'sentinel2';
  const imagery = createImageryState({ api });

  let home = $state(null);
  let view = $state({ lat: 0, lon: 0, zoom: 2 });
  let bearing = $state(0);
  let engine = $state(null);
  let element = $state(null);
  let ready = $state(false);
  let refused = $state(false);
  let dated = $state(null);
  let providerId = $state('esri-world-imagery');
  let chosenBasemap = $state('esri-world-imagery');
  let collapsed = $state(false);
  let overlays = $state(['boundaries']);
  let savedVisible = $state(true);
  let readingPass = $state(false);
  let layersOpen = $state(false);
  let prefsLoaded = $state(false);
  const wayback = createWaybackState({ api, place: () => view });
  const s1 = createRadarState({ api, place: () => view, onBilled: () => imagery.refreshUsage() });
  const shown = $derived(imagery.displayed(providerId, view.zoom, { ...s2.variant, release: wayback.release, pass: s1.pass }));
  /** The metered archives. Any of them can be put on the map from its chip, with
   *  its Copernicus layer and day, but none is remembered as the basemap: Detect
   *  opens on free imagery every time. */
  const PASSES = [SENTINEL, RADAR_ID];
  const OVERLAY_ROWS = [['boundaries', 'Borders'], ['roads', 'Roads'], ['railway', 'Railways'],
    ['power', 'Power lines'], ['seamarks', 'Seamarks'], ['gpstraces', 'GPS traces']];
  const layerRows = $derived([
    ...OVERLAY_ROWS.map(([id, label]) => ({
      id, label, on: overlays.includes(id), toggle: () => {
        overlays = overlays.includes(id) ? overlays.filter((value) => value !== id) : [...overlays, id];
      },
    })),
    { id: 'saved', label: 'Saved work', on: savedVisible, toggle: () => (savedVisible = !savedVisible) },
    { id: 'areas', label: 'Watched areas', on: showZones, toggle: () => (showZones = !showZones) },
  ]);
  let searchText = $state('');
  let searching = $state(false);
  let panel = $state(null);
  let opening = $state(null);

  const s2 = createSentinelState({
    place: () => ({ lat: view.lat, lon: view.lon }),
    onBilled: () => imagery.refreshUsage(),
    notify: toast,
    api,
  });

  // What the column owns and the map draws.
  let zones = $state([]);
  let drawing = $state('select');
  let selectedZone = $state(null);
  let layers = $state([]);
  let showZones = $state(true);
  let selectedResult = $state(null);
  let areaGroups = $state([]);
  let highlight = $state([]);
  let manual = $state(null);
  let manualTool = $state('select');
  // An analyzer of your own being built: its preview, and what the map shows
  // of it (AnalyzerBuilder). The map is its bench while it is open, so saved
  // work and watched areas step aside.
  let builder = $state(null);
  // The builder offers the configuration's Copernicus layers by name; the list
  // is the app's own catalogue until the instance has been asked, so reading
  // it spends nothing.
  let layersAsked = false;
  $effect(() => {
    if (!builder || layersAsked || s2.layers.length) return;
    layersAsked = true;
    untrack(() => s2.loadLayers(false, true));
  });
  const previewLayer = $derived(builder?.preview?.ready ? [{
    id: 'builder-preview', visible: true,
    input: { recipe: { colour: builder.colour, style: builder.style } },
    results: builder.preview.candidates.map((row) => ({ ...row, review: 'new', phenomenon: builder.phenomenon })),
  }] : []);
  $effect(() => { manualTool = manual?.kind === 'polygon' ? 'polygon' : 'select'; });

  // The ruler: measures drawn over the map, one armed at a time.
  let measures = $state([]);
  let measureTool = $state('select');
  let selectedMeasure = $state(null);
  let measureCanvas = $state(null);
  /** A measure started from the right-click menu, which only wants its far end. */
  let trailing = $state(false);
  const measuring = $derived(measureTool === 'measure');
  $effect(() => { if (!measuring) trailing = false; });
  // One tool holds the pointer at a time: drawing an area or a candidate puts
  // the ruler down, and taking the ruler up lets go of both.
  $effect(() => {
    if (drawing !== 'select' || manual) untrack(() => { measureTool = 'select'; });
  });

  // The review's eye and blink. The eye takes what the detection draws off the
  // imagery; the blink lays pass A over pass B in the same map and flips it at
  // Compare's normal speed, both pictures loaded, so nothing reloads mid-blink.
  let bare = $state(false);
  let blinking = $state(false);
  let reviewPair = $state(null);
  let showingA = $state(false);
  const blinkPair = $derived(blinking && blinkable(reviewPair) ? reviewPair : null);
  const alternate = $derived.by(() => {
    if (!blinkPair) return null;
    const { a } = blinkPair;
    const other = a.provider === RADAR_ID
      ? imagery.displayed(RADAR_ID, view.zoom, { pass: { date: a.date, time: a.time ?? '', orbit: a.orbit ?? '' } })
      : imagery.displayed(SENTINEL, view.zoom, { ...s2.variant, from: a.date, to: a.date });
    // Zoomed out of the archive, or past the month's budget, both sides fall
    // back to the same stand-in, and blinking that against itself says nothing.
    return other.provider && other.provider.id === shown.provider?.id ? other : null;
  });
  $effect(() => {
    const pair = blinkPair;
    if (!pair) return;
    untrack(() => showDate(pair.b));
    const timer = setInterval(() => (showingA = !showingA), DEFAULT_BLINK_INTERVAL);
    return () => {
      clearInterval(timer);
      showingA = false;
    };
  });

  const marks = $derived(zoneMarks(zones));
  const mapDate = $derived(s2.date || '');
  const passChip = $derived(providerId === RADAR_ID ? passLabel(s1.pass) : mapDate);
  /**
   * What Detect needs before a run can fetch anything: a Copernicus key, which
   * Sentinel-2 lists once it is in Settings. Said in the middle of the map,
   * where the work would be. Not a lock: the panel still opens on the
   * detections already saved.
   */
  const needs = $derived(imagery.providers.length ? copernicusNeed(imagery.providers) : '');

  onMount(() => {
    let gone = false;
    void (async () => {
      imagery.refreshUsage();
      await prefsReady;
      if (gone) return;
      const saved = prefs.detectView;
      collapsed = saved?.collapsed ?? false;
      chosenBasemap = saved?.basemap && !PASSES.includes(saved.basemap) ? saved.basemap : 'esri-world-imagery';
      providerId = chosenBasemap;
      // Only the layers still offered: a retired one (Labels) would be sent back
      // with the next save and refused.
      overlays = (saved?.overlays ?? ['boundaries']).filter((id) => OVERLAY_ROWS.some(([row]) => row === id));
      savedVisible = saved?.saved ?? true;
      prefsLoaded = true;
      home = { ...prefs.homeView };
      // Where the other map tabs left the window, when they share a camera.
      const shared = share.opening();
      view = shared ? { lat: shared.lat, lon: shared.lon, zoom: shared.zoom } : { ...home };
      bearing = shared?.bearing ?? 0;
      try {
        await imagery.loadProviders();
      } catch {
        /* the panel still opens on local state; the map says what it cannot show */
      }
      if (gone) return;
      if (!imagery.find(providerId)) providerId = 'esri-world-imagery';
    })();
    return () => { gone = true; };
  });

  $effect(() => {
    if (!PASSES.includes(providerId)) chosenBasemap = providerId;
  });
  let lastPrefs = '';
  $effect(() => {
    if (!prefsLoaded) return;
    const value = { collapsed, basemap: chosenBasemap, overlays: [...overlays], saved: savedVisible };
    const key = JSON.stringify(value);
    if (!lastPrefs) { lastPrefs = key; return; }
    if (key === lastPrefs) return;
    lastPrefs = key;
    prefs.detectView = value;
    void api.put('/api/settings/prefs', { detect_view: value }).catch(() => toast('Could not save the Detect preferences', 'danger'));
  });
  $effect(() => {
    collapsed;
    void tick().then(() => engine?.resize());
  });

  // The same turn as Satellite and Compare: a middle-drag, or shift and the
  // left button, turns the map about the point that was grabbed.
  let rotating = $state(null);
  $effect(() => {
    if (!element || !engine) return;
    const surface = element;
    const down = (event) =>
      turnFromPress(engine, event, {
        onPivot: (point) => (rotating = point),
        onEnd: () => (rotating = null),
      });
    surface.addEventListener('mousedown', down, true);
    return () => surface.removeEventListener('mousedown', down, true);
  });
  function onKey(event) {
    if (uiState.tool !== 'detect') return;
    // held down, the turn keeps going
    if (turnFromKey(engine, event)) return;
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey
      || event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (event.key === ']') collapsed = !collapsed;
    else if (event.key.toLowerCase() === 'm') toggleMeasure();
    else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedMeasure) dropMeasure(selectedMeasure);
    else return;
    event.preventDefault();
  }

  function armMeasure() {
    drawing = 'select';
    manual = null;
    measureTool = 'measure';
  }
  function toggleMeasure() {
    if (measuring) measureTool = 'select';
    else armMeasure();
  }
  function dropMeasure(id) {
    measures = measures.filter((mark) => mark.id !== id);
    if (selectedMeasure === id) selectedMeasure = null;
  }
  function clearMeasures() {
    measures = [];
    selectedMeasure = null;
  }

  // --- the right-click menu: acts on the point under the cursor -------------
  //
  // Satellite's menu, cut down to what Detect can honour: there is no sun panel
  // and no imagery history here, and a place is kept by pinning a candidate. A
  // run under review adds a candidate where the point falls in one of its
  // areas, which is how a hull the detector missed joins the queue.
  let pointMenu = $state(null); // { lat, lon, x, y, frame, lookup, areaId }
  let pointLookupSeq = 0;
  const compareSources = $derived(
    COMPARE_SOURCES.filter((source) => !source.provider || imagery.find(source.provider))
  );
  const pointActions = $derived(
    actionsFor(pointMenu?.areaId ? ['lookup', 'candidate', 'measure', 'centre'] : ['lookup', 'measure', 'centre'])
  );
  const pointTools = otherMapTools('detect');

  function onMapContextMenu(at) {
    pointLookupSeq += 1;
    pointMenu = {
      ...at,
      frame: { width: element?.clientWidth ?? 0, height: element?.clientHeight ?? 0 },
      lookup: null,
      areaId: panel?.candidateAreaAt(at) ?? null,
    };
  }

  /**
   * A right-click on a candidate, an area or a measure is a right-click on the
   * ground under it. Those are drawn over the map rather than in it, so the
   * engine never hears the press, and the browser's own menu opened instead,
   * right where a hull under review sits.
   */
  function onOverlayMenu(event) {
    if (!engine || !element || !event.target?.closest?.('.analysis-overlay, .detect-areas, .annotation-canvas')) return;
    event.preventDefault();
    const box = element.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    const at = engine.containerPointToLatLng({ x, y });
    onMapContextMenu({ lat: at.lat, lon: ((at.lon + 540) % 360) - 180, x, y });
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
    } else if (id === 'candidate') {
      await panel?.addCandidate(at.areaId, { type: 'Point', coordinates: [point.lon, point.lat] });
    } else if (id === 'measure') {
      armMeasure();
      await tick();
      measureCanvas?.startFrom([point.lon, point.lat]);
      trailing = true;
    } else if (id === 'centre') {
      engine.setView(point, engine.getZoom());
    } else if (id === 'compare') {
      await comparePoint(point, value);
    } else if (id === 'goto') {
      openMapAt(value, { ...point, zoom: engine.getZoom() });
    }
  }

  /** "What is here?": the geocoder's name for the point, shown in the menu itself. */
  async function lookUpPoint(point) {
    const mine = ++pointLookupSeq;
    pointMenu = { ...pointMenu, lookup: { busy: true } };
    try {
      const answer = await api.get(`/api/geo/reverse?lat=${point.lat}&lon=${point.lon}`);
      if (mine !== pointLookupSeq || !pointMenu) return;
      pointMenu = { ...pointMenu, lookup: { text: answer.display_name || 'No name for this point' } };
    } catch (error) {
      if (mine !== pointLookupSeq || !pointMenu) return;
      pointMenu = { ...pointMenu, lookup: { error: `Lookup failed: ${error.message}` } };
    }
  }

  /** Open Compare on the last two pictures of this point, as Satellite's menu does. */
  async function comparePoint(point, source) {
    const name = COMPARE_SOURCES.find((entry) => entry.id === source)?.label ?? 'the archive';
    const waiting = toast(`Asking ${name} for the last two pictures…`, 'info', 0);
    try {
      const zoom = engine.getZoom();
      const pair = await comparePair(api, source, { ...point, zoom });
      uiState.compareAt = { ...point, zoom, ...pair };
      uiState.tool = 'compare';
    } catch (error) {
      toast(error.message, 'warn', 6000);
    } finally {
      dismissToast(waiting);
    }
  }

  // The menu is pinned to a screen point, so a zoom or a pan leaves it pointing
  // at somewhere else. A drag already closes it by pressing outside; the wheel
  // does not, so the settled view does.
  $effect(() => {
    if (!engine || !pointMenu) return;
    return engine.on('view-settled', closePointMenu);
  });
  function leavePass() {
    blinking = false;
    readingPass = false;
    providerId = chosenBasemap;
  }

  // A saved item asked for from elsewhere: the case sidebar, or the top bar
  // while a run was working (lib/detectRuns.svelte.js).
  $effect(() => {
    const requested = uiState.openAnalyzer;
    if (!requested) return;
    untrack(() => {
      opening = requested;
      uiState.openAnalyzer = null;
    });
  });

  /** The camera as a rectangle to sweep: the one place the map decides what a
   *  run covers, after which the area is fixed and the camera is free again. */
  function useCurrentView() {
    const bounds = engine?.viewBounds?.();
    if (!bounds) return;
    zones = [...zones, viewZone(bounds, `Area ${zones.length + 1}`)];
    showZones = true;
    drawing = 'select';
  }

  /** Go to a point of the work. A candidate under review asks to be close
   *  enough to read; a saved place only asks to be on screen. */
  function focus([lon, lat], closest = 13) {
    engine?.setView({ lon, lat }, Math.max(engine.getZoom(), closest));
  }

  /** A framing asked for before the map engine existed, run once it does: the
   *  case's areas usually arrive first. Likewise one asked for while another tab
   *  shows, as a new case's areas are: a hidden map has no size to fit them to,
   *  and the landing is for the analyst arriving here, so it waits for that. */
  let waitingFrame = $state(null);
  $effect(() => {
    if (!engine || !waitingFrame || uiState.tool !== 'detect') return;
    const { shapes, landing } = waitingFrame;
    untrack(() => { waitingFrame = null; frame(shapes, { landing }); });
  });

  /**
   * The camera this window's map tabs share (`lib/map/sharedView.js`), taken
   * when this tab shows. A candidate under review keeps the map on it: the
   * analyst stepping out to look at the ground around it comes back to it.
   */
  const share = shareView('detect', { state: uiState, enabled: () => prefs.mapSync });
  let reviewing = $state(false);

  $effect(() => {
    uiState.mapView;
    if (uiState.tool !== 'detect' || !ready) return;
    untrack(() => {
      if (reviewing) return;
      const next = share.pending(engine.camera());
      if (next) engine.setCamera(next);
    });
  });

  /** Where the map is, for Coordinates, and where the window looks: hidden
   *  too, when a pan's glide ends after a switch of tab. */
  function onSettled(camera) {
    uiState.mapPoint = { lat: camera.lat, lon: camera.lon, zoom: camera.zoom };
    share.settled(camera, engine?.maxZoom());
  }

  /**
   * A point another map tab asked Detect to look at. It wins over the case's
   * landing frame, which can arrive after it: the analyst came here for that
   * point, not for the areas the case happens to watch.
   */
  let pointAsked = false;
  $effect(() => {
    caseState.current?.id;
    pointAsked = false;
  });
  $effect(() => {
    const asked = uiState.lookAt;
    if (uiState.tool !== 'detect' || asked?.tool !== 'detect' || !engine) return;
    untrack(() => {
      uiState.lookAt = null;
      pointAsked = true;
      engine.setView({ lat: asked.lat, lon: asked.lon }, Number.isFinite(asked.zoom) ? asked.zoom : engine.getZoom());
    });
  });

  /** Frame a whole set of areas: opening a routine should show all of it. */
  function frame(shapes, { landing = false } = {}) {
    // The case's landing gives way to a point asked for, and to a camera another
    // map tab left the window on: arriving from there, that is the ground in hand.
    if (landing && (pointAsked || share.ledElsewhere())) return;
    if (!engine?.fitBounds || uiState.tool !== 'detect') { waitingFrame = { shapes, landing }; return; }
    const points = shapes.flatMap((zone) => zoneRing(zone));
    if (!points.length) return;
    const xs = points.map(([lon]) => lon);
    const ys = points.map(([, lat]) => lat);
    engine.fitBounds(
      { west: Math.min(...xs), east: Math.max(...xs), south: Math.min(...ys), north: Math.max(...ys) },
      { padding: 60, maxZoom: 15 }
    );
  }

  /** Put a pass on the map, so the picture is the one the work is about. */
  function showDate({ provider, date, time, layer, maxcc }) {
    if (!date) { leavePass(); return; }
    if (provider === RADAR_ID) {
      // A radar pass is shown by the radar basemap, once Settings has its layer.
      if (!imagery.find(RADAR_ID)) return;
      readingPass = true;
      providerId = RADAR_ID;
      s1.pick({ date, time });
      return;
    }
    if (!imagery.find(SENTINEL)) return;
    readingPass = true;
    providerId = SENTINEL;
    if (layer) s2.layer = layer;
    if (maxcc !== undefined && maxcc !== null) s2.setMaxcc(maxcc);
    s2.date = date ?? '';
  }

  async function goTo() {
    const text = searchText.trim();
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
</script>

<svelte:window onkeydown={onKey} />
<div class="detect-tool">
  <div class="stage">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="surface-shell" oncontextmenu={onOverlayMenu}>
    <div class="search cmp-glass">
      <PlaceSearch
        bind:value={searchText}
        centre={{ lat: view.lat, lon: view.lon }}
        units={prefs.units}
        {searching}
        listId="detect-suggestions"
        onsubmit={goTo}
        onpick={(place) => { searchText = place.label ?? searchText; goTo(); }}
      />
    </div>
    <div class="map-choices">
      <ImageryChip {imagery} bind:providerId {s2} {wayback} {s1} {shown} />
      <div class="layer-picker cmp-glass">
        <MapLayers rows={layerRows} bind:open={layersOpen} />
      </div>
      {#if builder?.pass?.b || builder?.pass?.a}
        <!-- The builder's passes under its preview: A, B or both blinking, and back to the basemap. -->
        {@const pass = builder.pass}
        {@const onScreen = pass.showing === 'blink' ? (showingA ? 'a' : 'b') : pass.showing}
        <div class="pass-chip bench-bar cmp-glass" role="group" aria-label="Passes under the preview">
          {#each [['a', 'A'], ['b', 'B']] as [id, letter] (id)}
            {#if pass[id]}
              <button class="cmp-letter {id}" class:dim={onScreen !== id} aria-pressed={pass.showing === id}
                title={`Show pass ${letter}, ${pass[id]}`} onclick={() => panel?.showPass(id)}>{letter}</button>
            {/if}
          {/each}
          {#if pass.blink}
            <button class="blink" class:on={pass.showing === 'blink'} aria-pressed={pass.showing === 'blink'}
              title="Flip between A and B" onclick={() => panel?.showPass(pass.showing === 'blink' ? 'b' : 'blink')}>Blink</button>
          {/if}
          {#if onScreen === 'a' || onScreen === 'b'}<span class="mono">{pass[onScreen]}</span>{/if}
          <button class="cmp-icon" title="Back to the basemap" aria-label="Back to the basemap"
            onclick={() => panel?.showPass('basemap')}><Icon name="x" size={12} /></button>
        </div>
      {:else if blinkPair}
        <!-- Which of the two is on screen, in Compare's letters and colours. -->
        <div class="pass-chip blink-chip cmp-glass" role="group" aria-label="Blinking A and B">
          <span class="cmp-letter" class:a={showingA} class:b={!showingA}>{showingA ? 'A' : 'B'}</span>
          <span class="mono">{sourceLabel(showingA ? blinkPair.a : blinkPair.b)}</span>
          <button class="cmp-icon" title="Stop blinking" aria-label="Stop blinking" onclick={() => (blinking = false)}><Icon name="x" size={12} /></button>
        </div>
      {:else if readingPass}
        <button class="pass-chip cmp-glass" title="Return to your basemap" aria-label="Leave pass imagery" onclick={leavePass}>{passChip} <Icon name="x" size={12} /></button>
      {/if}
      <!-- Which way is up: the same reading every other map in the app shows,
           which Detect lost when it turned the surface's own chrome off. -->
      <Compass {bearing} onbearing={(deg) => engine?.setBearing(deg)} />
      <div class="ruler cmp-glass">
        <button class="cmp-icon" class:on={measuring} aria-pressed={measuring} aria-label="Measure"
          title="Measure a length (M)" onclick={toggleMeasure}><Icon name="ruler" size={15} /></button>
        {#if measures.length}
          <button class="cmp-icon" aria-label="Clear measures" title="Clear measures" onclick={clearMeasures}><Icon name="trash" size={14} /></button>
        {/if}
      </div>
    </div>
      {#if home}
        <MapSurface
          bind:engine
          bind:element
          bind:view
          bind:bearing
          bind:ready
          bind:refused
          bind:dated
          bind:providerId
          {imagery}
          {s2}
          {wayback}
          {s1}
          {overlays}
          chrome={false}
          {home}
          resetToHome={false}
          imperial={prefs.units === 'imperial'}
          armed={measuring ? 'measuring' : drawing !== 'select' || builder?.pinning ? 'selecting' : null}
          onclick={({ lon, lat }) => {
            if (manual?.kind === 'point') void panel?.addManual({ type: 'Point', coordinates: [lon, lat] });
            else if (builder?.pinning && !measuring) panel?.pinAt({ lon, lat });
            else if (builder && !measuring) void panel?.probeAt({ lon, lat });
          }}
          controlsTop={98}
          {alternate}
          alternateOn={showingA}
          onusage={() => imagery.refreshUsage()}
          onviewsettled={onSettled}
          oncontextmenu={onMapContextMenu}
        />
        {#if builder}
          <RuleLayers {engine} {element} preview={builder.preview} shown={builder.shown} hover={builder.hover}
            colours={builder.colours} />
          {#if previewLayer.length}
            <AnalysisOverlay {engine} layers={previewLayer} onpick={(_, id) => {
              const row = builder.preview.candidates.find((candidate) => candidate.id === id);
              if (row) void panel?.probeAt({ lon: row.coordinates[0], lat: row.coordinates[1] });
            }} />
          {/if}
          {#if builder.marks.length || builder.ground}
            <CheckMarks {engine} marks={builder.marks} ground={builder.ground} />
          {/if}
          {#if builder.probe}
            <RuleProbe {engine} probe={builder.probe} rules={builder.rules} colours={builder.colours}
              width={element?.clientWidth ?? 0} height={element?.clientHeight ?? 0} onclose={() => panel?.closeProbe()}
              onmark={(expect) => panel?.markProbe(expect)} markTarget={builder.checking} canMark={builder.canMark} />
          {/if}
        {:else if savedVisible && !bare && layers.some((layer) => layer.visible)}
          <AnalysisOverlay {engine} {layers} selected={selectedResult} active={!manual}
            onpick={(run, result) => panel?.pick(run, result)} />
        {/if}
        {#if areaGroups.length && !manual && !bare && !builder}
          <DetectAreas {engine} groups={areaGroups} {highlight} onpick={(id) => panel?.openArea(id)} />
        {/if}
        {#if manual?.kind === 'polygon'}
          <AnnotationCanvas annotations={[]} {engine} letter="a" bind:tool={manualTool} colour="#ffffff"
            onchange={(next) => {
              const polygon = marksToZones(next, [])[0];
              if (polygon) {
                const ring = zoneRing(polygon);
                void panel?.addManual({ type: 'Polygon', coordinates: [[...ring, ring[0]]] });
              }
            }} />
        {:else if showZones && !manual && !bare && !builder}
          <AnnotationCanvas annotations={marks} {engine} letter="a" editVertices={true} edgeOnly={true}
            bind:tool={drawing} bind:selectedId={selectedZone} colour="#38bdf8" fillOpacity={0.08}
            onchange={(next) => (zones = marksToZones(next, zones))} />
        {/if}
        <!-- Over the areas, so a measure started inside one takes the press. -->
        <AnnotationCanvas bind:this={measureCanvas} annotations={measures} {engine} letter="a" units={prefs.units}
          editVertices={true} bind:tool={measureTool} bind:selectedId={selectedMeasure} colour="#f5a623"
          strokeWidth={2} stampSize={14} onchange={(next) => (measures = next)} />
        {#if pointMenu}
          <MapContextMenu
            at={pointMenu}
            frame={pointMenu.frame}
            zoom={view.zoom}
            format={prefs.coordFormat}
            actions={pointActions}
            tools={pointTools}
            lookup={pointMenu.lookup}
            {compareSources}
            onpick={onPointMenu}
            onclose={closePointMenu}
          />
        {/if}
      {:else}
        <div class="loading">Reading your preferences…</div>
      {/if}
      {#if rotating}
        <TurnGuide x={rotating.x} y={rotating.y} />
      {/if}
      {#if needs}
        <div class="need-over">
          <CopernicusNeeded need={needs} tool="Detect" />
        </div>
      {/if}
      {#if measuring}
        <div class="manual-chip cmp-glass">{trailing ? 'Click the far end' : 'Drag from one end to the other'}
          <button class="cmp-icon" aria-label="Stop measuring" title="Stop measuring (Esc)" onclick={() => (measureTool = 'select')}><Icon name="x" size={13} /></button>
        </div>
      {/if}
      {#if builder?.pinning}
        <div class="manual-chip cmp-glass">{builder.pinning === 'found' ? 'Click where a candidate should be found' : 'Click where none should be'}
          <button class="cmp-icon" aria-label="Stop dropping pins" title="Stop dropping pins" onclick={() => panel?.pinMode(null)}><Icon name="x" size={13} /></button>
        </div>
      {/if}
      {#if manual}
        <div class="manual-chip cmp-glass">{manual.kind === 'point' ? 'Click the candidate on the map' : 'Click corners; Enter finishes'}
          <button class="cmp-icon" aria-label="Cancel adding candidate" title="Cancel adding candidate" onclick={() => (manual = null)}><Icon name="x" size={13} /></button>
        </div>
      {/if}
    </div>

    <DetectPanel
      bind:this={panel}
      bind:collapsed
      bind:manual
      caseId={caseState.current?.id}
      bind:zones
      bind:drawing
      bind:selectedZone
      bind:layers
      bind:showZones
      bind:selectedResult
      bind:areaGroups
      bind:highlight
      bind:bare
      bind:blinking
      bind:reviewing
      onpair={(pair) => (reviewPair = pair)}
      {opening}
      onopened={() => (opening = null)}
      onfocus={focus}
      onframe={frame}
      onusecurrentview={useCurrentView}
      onshow={showDate}
      onleavepass={leavePass}
      bind:builder
      onblink={(pair) => { reviewPair = pair; blinking = !!pair; }}
      viewBounds={() => engine?.viewBounds?.() ?? null}
      mapView={view}
      passLayers={s2.layers}
      onfly={({ lon, lat, zoom, bounds }) => (bounds ? engine?.fitBounds(bounds, { padding: 40 }) : engine?.setView({ lon, lat }, zoom))}
    />
  </div>
</div>

<style>
  .detect-tool {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg-0);
  }
  .search { position: absolute; top: 12px; left: 12px; z-index: 650; display: flex; width: min(280px, 42%); padding: 4px; }
  .search :global(.place-search) { flex: 1; }
  .map-choices { position: absolute; top: 12px; right: 12px; z-index: 650; display: grid; justify-items: end; gap: 8px; }
  .layer-picker { padding: 4px 8px; min-width: 112px; max-width: 250px; max-height: 50vh; overflow: auto; }
  .layer-picker :global(.sub-head) { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 22px; font-size: var(--fs-xs); color: var(--text-2); }
  .layer-picker :global(.count) { margin-left: auto; color: var(--text-3); }
  .layer-picker :global(.layers) { min-width: 190px; margin-top: 8px; }
  .ruler { display: flex; padding: 2px; }
  .blink-chip { padding: 2px 2px 2px 4px; }
  .bench-bar { gap: 4px; padding: 2px 2px 2px 4px; }
  .bench-bar .cmp-letter { cursor: pointer; }
  .bench-bar .cmp-letter.dim { opacity: 0.4; }
  .bench-bar .blink { padding: 2px 7px; border-radius: var(--r-sm); color: var(--text-2); font-size: var(--fs-xs); }
  .bench-bar .blink.on { color: var(--accent); background: var(--accent-soft); }
  .bench-bar .cmp-icon { width: 22px; height: 22px; }
  .blink-chip .cmp-icon { width: 22px; height: 22px; }
  .pass-chip { display: flex; align-items: center; gap: 8px; padding: 4px 8px; font-size: var(--fs-xs); }
  /* Over the map and under its own controls, which stay usable around it. */
  .need-over {
    position: absolute;
    inset: 0;
    z-index: 640;
    display: grid;
    place-items: center;
    padding: 16px;
    background: rgb(0 0 0 / 0.35);
  }
  .manual-chip { position: absolute; bottom: 36px; left: 12px; z-index: 650; display: flex; align-items: center; padding: 4px 8px; font-size: var(--fs-xs); }
  /* The point a turn is happening about, drawn as Satellite and Compare draw it. */
  .stage { display: flex; flex: 1; min-height: 0; }
  /* The surface itself is a flex child (`.map-wrap`), so this has to be a flex
     container or the map lands with no height at all. */
  .surface-shell {
    position: relative;
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--bg-0);
  }
  .loading {
    display: grid;
    place-items: center;
    height: 100%;
    color: var(--text-3);
    font-size: var(--fs-sm);
  }
</style>
