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
   */
  import { onMount, tick, untrack } from 'svelte';
  import { api } from '../lib/api.js';
  import { caseState, prefs, prefsReady, toast, uiState } from '../lib/state.svelte.js';
  import { marksToZones, viewZone, zoneMarks, zoneRing } from '../lib/map/analyzers.js';
  import { createImageryState } from './satellite/state/imagery.svelte.js';
  import { createSentinelState } from './satellite/state/sentinel.svelte.js';
  import { createRadarState } from './satellite/state/radar.svelte.js';
  import { RADAR_ID, passLabel } from '../lib/radar.js';
  import { copernicusNeed } from '../lib/copernicusSetup.js';
  import CopernicusNeeded from '../components/CopernicusNeeded.svelte';
  import MapSurface from './satellite/MapSurface.svelte';
  import PlaceSearch from './satellite/PlaceSearch.svelte';
  import ImageryChip from './satellite/ImageryChip.svelte';
  import MapLayers from './satellite/MapLayers.svelte';
  import Compass from '../components/Compass.svelte';
  import Icon from '../components/Icon.svelte';
  import { createWaybackState } from './satellite/state/wayback.svelte.js';
  import { startRotateDrag } from '../lib/map/gestures.js';
  import AnnotationCanvas from './compare/AnnotationCanvas.svelte';
  import AnalysisOverlay from './detect/AnalysisOverlay.svelte';
  import DetectAreas from './detect/DetectAreas.svelte';
  import DetectPanel from './detect/DetectPanel.svelte';
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
  /** The metered archives are on the map only while a pass is being read. */
  const PASSES = [SENTINEL, RADAR_ID];
  const selectableImagery = $derived({ ...imagery, providers: imagery.providers.filter((p) => readingPass || !PASSES.includes(p.id)) });
  const layerRows = $derived([
    ...[['boundaries', 'Borders'], ['labels', 'Labels'], ['roads', 'Roads'], ['railway', 'Railways'],
      ['power', 'Power lines'], ['seamarks', 'Seamarks'], ['gpstraces', 'GPS traces']].map(([id, label]) => ({
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
  $effect(() => { manualTool = manual?.kind === 'polygon' ? 'polygon' : 'select'; });

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
      overlays = [...(saved?.overlays ?? ['boundaries'])];
      savedVisible = saved?.saved ?? true;
      prefsLoaded = true;
      home = { ...prefs.homeView };
      view = { ...home };
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
  // left button, turns the map about the point that was grabbed. Detect had
  // the compass without the gesture, so north could be reset and never left.
  let rotating = $state(null);
  $effect(() => {
    if (!element || !engine) return;
    const surface = element;
    const down = (event) => {
      const shiftDrag = event.button === 0 && event.shiftKey;
      if (event.button !== 1 && !shiftDrag) return;
      startRotateDrag(engine, event, {
        onPivot: (point) => (rotating = point),
        onEnd: () => (rotating = null),
      });
    };
    surface.addEventListener('mousedown', down, true);
    return () => surface.removeEventListener('mousedown', down, true);
  });
  function toggleDock(event) {
    if (uiState.tool !== 'detect' || event.repeat || event.key !== ']' || event.ctrlKey || event.metaKey || event.altKey
      || event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault();
    collapsed = !collapsed;
  }
  function leavePass() {
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
   *  case's areas usually arrive first. */
  let waitingFrame = $state(null);
  $effect(() => {
    if (!engine || !waitingFrame) return;
    const shapes = waitingFrame;
    untrack(() => { waitingFrame = null; frame(shapes); });
  });

  /** Frame a whole set of areas: opening a routine should show all of it. */
  function frame(shapes) {
    if (!engine?.fitBounds) { waitingFrame = shapes; return; }
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

<svelte:window onkeydown={toggleDock} />
<div class="detect-tool">
  <div class="stage">
    <div class="surface-shell">
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
      <ImageryChip imagery={selectableImagery} bind:providerId {s2} {wayback} {s1} {shown} />
      <div class="layer-picker cmp-glass">
        <MapLayers rows={layerRows} bind:open={layersOpen} />
      </div>
      {#if readingPass}
        <button class="pass-chip cmp-glass" title="Return to your basemap" aria-label="Leave pass imagery" onclick={leavePass}>{passChip} <Icon name="x" size={12} /></button>
      {/if}
      <!-- Which way is up: the same reading every other map in the app shows,
           which Detect lost when it turned the surface's own chrome off. -->
      <Compass {bearing} onbearing={(deg) => engine?.setBearing(deg)} />
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
          armed={drawing !== 'select' ? 'selecting' : null}
          onclick={({ lon, lat }) => {
            if (manual?.kind === 'point') void panel?.addManual({ type: 'Point', coordinates: [lon, lat] });
          }}
          controlsTop={98}
          onusage={() => imagery.refreshUsage()}
        />
        {#if savedVisible && layers.some((layer) => layer.visible)}
          <AnalysisOverlay {engine} {layers} selected={selectedResult} active={!manual}
            onpick={(run, result) => panel?.pick(run, result)} />
        {/if}
        {#if areaGroups.length && !manual}
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
        {:else if showZones && !manual}
          <AnnotationCanvas annotations={marks} {engine} letter="a" editVertices={true} edgeOnly={true}
            bind:tool={drawing} bind:selectedId={selectedZone} colour="#38bdf8" fillOpacity={0.08}
            onchange={(next) => (zones = marksToZones(next, zones))} />
        {/if}
      {:else}
        <div class="loading">Reading your preferences…</div>
      {/if}
      {#if rotating}
        <div class="rotate-pivot" style:left={`${rotating.x}px`} style:top={`${rotating.y}px`} aria-hidden="true"></div>
      {/if}
      {#if needs}
        <div class="need-over">
          <CopernicusNeeded need={needs} tool="Detect" />
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
      {opening}
      onopened={() => (opening = null)}
      onfocus={focus}
      onframe={frame}
      onusecurrentview={useCurrentView}
      onshow={showDate}
      onleavepass={leavePass}
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
  .rotate-pivot {
    position: absolute;
    z-index: 570;
    width: 34px;
    height: 34px;
    transform: translate(-50%, -50%);
    border: 1px solid rgb(255 255 255 / 0.92);
    border-radius: 50%;
    pointer-events: none;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 0.7), inset 0 0 0 8px rgb(0 0 0 / 0.25);
  }
  .rotate-pivot::before,
  .rotate-pivot::after {
    content: '';
    position: absolute;
    background: rgb(255 255 255 / 0.92);
  }
  .rotate-pivot::before { left: 50%; top: 5px; bottom: 5px; width: 1px; }
  .rotate-pivot::after { top: 50%; left: 5px; right: 5px; height: 1px; }
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
