<script>
  /**
   * Horizon: stand somewhere and look.
   *
   * Satellite answers "what is this ground"; this tab answers what an eye
   * standing on it sees, which is the question a photo or a video puts to an
   * investigator: from where, looking which way, was this taken. The picture
   * is the app's own horizon march from that eye (engine/horizon.py), curved
   * Earth and refraction included, never exaggerated, and every reading taken
   * off it (a summit's name, a clicked slope's distance, whether a mast is in
   * sight) comes from that one march.
   *
   * Three layouts around one map, which is moved rather than mounted twice:
   *
   * - **Picking**, with no eye yet: the map fills the tab with a place search,
   *   and a click stands there.
   * - **Moving** the eye ("Move the viewpoint"): the same large map beside the
   *   inspector, the eye and its cone drawn; a click stands there and comes
   *   back. Cancel or Escape leaves it where it was.
   * - **Looking**: the view is the hero, the whole turn in a strip over it; the
   *   map shrinks to the top of the inspector on the right, where a click
   *   marks a point the view then shows, in sight or hidden, and the eye can
   *   be dragged. The inspector folds away for a wider view.
   *
   * A photo or a video can be laid over the view (state/overlay.svelte.js):
   * the frame then takes its shape between a band over it (which file, how
   * much shows, the traced skyline and its gap) and, for a video, a band under
   * it (its time and pins), so nothing covers the photo being matched.
   *
   * Nothing reaches the network until there is an eye: the relief around it
   * then, and summit names only once they are switched on.
   */
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { api } from '../lib/api.js';
  import { caseState, prefs, prefsReady, reloadCase, toast, uiState } from '../lib/state.svelte.js';
  import { splitHash } from '../lib/hash.js';
  import { copyText } from '../lib/clipboard.js';
  import { onBackForward, settlePlace } from '../lib/backButton.js';
  import { openMapAt } from '../lib/navigate.js';
  import { actionsFor, otherMapTools } from '../lib/map/contextMenu.js';
  import { createSurface } from '../lib/map/surface.js';
  import { bearingBetween, faceTowards, footprint, groundPoint } from '../lib/horizon/geometry.js';
  import { HZ } from '../lib/horizon/marks.js';
  import { minuteOf, skyAt, skyTracks } from '../lib/horizon/sky.js';
  import { horizonParams, readHorizonView } from '../lib/horizon/view.js';
  import { fitFrame, fitToTrace, gapDegrees, skylineBetween, traceGap, traceSamples } from '../lib/horizon/overlay.js';
  import { createImageryState } from './satellite/state/imagery.svelte.js';
  import { createHorizonState } from './horizon/state/horizon.svelte.js';
  import { createOverlayState } from './horizon/state/overlay.svelte.js';
  import MapSurface from './satellite/MapSurface.svelte';
  import MapContextMenu from './satellite/MapContextMenu.svelte';
  import PlaceSearch from './satellite/PlaceSearch.svelte';
  import HorizonView from './horizon/HorizonView.svelte';
  import HorizonStrip from './horizon/HorizonStrip.svelte';
  import HorizonPanel from './horizon/HorizonPanel.svelte';
  import OverlayBar from './horizon/OverlayBar.svelte';
  import OverlayTransport from './horizon/OverlayTransport.svelte';
  import PhotoDialog from './horizon/PhotoDialog.svelte';
  import Icon from '../components/Icon.svelte';
  import CopernicusNeeded from '../components/CopernicusNeeded.svelte';

  const view = createHorizonState({ api });
  const imagery = createImageryState({ api });
  const overlay = createOverlayState({ api, view });

  let providerId = $state('esri-world-imagery');
  let mapView = $state(null);
  let bearing = $state(0);
  let engine = $state.raw(null);
  let surface = $state(null);
  let ready = $state(false);
  let refused = $state(false);
  let frame = $state({ width: 0, height: 0 });
  /** The room the frame has between the photo's bands, which a photo's shape is fitted into. */
  let slot = $state({ width: 0, height: 0 });
  /** The dialog that picks a photo or a video to lay over the view. */
  let photoDialog = $state(false);
  let dropping = $state(false);
  /** Back on the large map to stand somewhere else, the eye kept until a click. */
  let moving = $state(false);
  /** The inspector folded away, for a wider view. */
  let folded = $state(false);
  /** How to set Copernicus up, shown over the view when its locked switch is pressed. */
  let copernicusHelp = $state(false);
  const copernicus = $derived(Boolean(imagery.providers?.length && imagery.find('sentinel2')));

  const layout = $derived(!view.observer ? 'picking' : moving ? 'moving' : 'looking');

  // -- opening ------------------------------------------------------------------

  const opening = splitHash(location.hash);
  if (opening.route === 'horizon') view.restore(readHorizonView(opening.params));

  onMount(async () => {
    await prefsReady;
    const eye = view.observer;
    const shared = uiState.mapView;
    mapView = eye
      ? { lat: eye.lat, lon: eye.lon, zoom: 12 }
      : shared
        ? { lat: shared.lat, lon: shared.lon, zoom: shared.zoom }
        : { ...prefs.homeView };
    try {
      await imagery.loadProviders();
    } catch {
      // the map says what it cannot show
    }
  });

  /** An eye handed over from another map's right-click: stand there and face where it faced. */
  $effect(() => {
    const asked = uiState.horizonAt;
    if (uiState.tool !== 'horizon' || !asked) return;
    untrack(() => {
      uiState.horizonAt = null;
      // an eye set higher than a person stands is a mast or a drone
      const eye = Number.isFinite(asked.eyeHeight)
        ? { mode: asked.eyeHeight > 100 ? 'drone' : 'ground', height: asked.eyeHeight }
        : {};
      view.standAt(asked, eye);
      if (Number.isFinite(asked.heading)) view.look({ heading: asked.heading });
      if (asked.mark) view.mark(asked.mark, { height: asked.mark.height ?? 0 });
      moving = false;
      flyToEye();
    });
  });

  /** A photo or a frame handed over from Inspect: laid over the view, a video at its moment. */
  $effect(() => {
    const asked = uiState.horizonPhoto;
    const caseId = caseState.current?.id;
    if (uiState.tool !== 'horizon' || !asked || !caseId) return;
    untrack(() => {
      uiState.horizonPhoto = null;
      overlay.openCase(caseId, asked, { time: asked.time ?? 0 });
    });
  });

  /** A photo of another case is not this one's to match: it goes when the case changes. */
  $effect(() => {
    const caseId = caseState.current?.id ?? null;
    untrack(() => {
      if (overlay.source?.caseId && overlay.source.caseId !== caseId) overlay.remove();
    });
  });

  // -- the address ----------------------------------------------------------------

  let lastEye = '';
  let addressTimer = 0;
  $effect(() => {
    if (uiState.tool !== 'horizon') return;
    const place = view.place;
    const params = horizonParams(place);
    const eye = params.ll ? `${params.ll}|${params.m ?? ''}|${params.h ?? ''}` : '';
    // moving the eye is going somewhere; turning the head is not
    const navigate = Boolean(eye && lastEye && eye !== lastEye);
    lastEye = eye;
    clearTimeout(addressTimer);
    // a playing video turns the view every frame: the address follows once it rests
    if (untrack(() => overlay.playing) && !navigate) addressTimer = setTimeout(() => settlePlace('horizon', params), 400);
    else settlePlace('horizon', params, { navigate });
  });

  onDestroy(
    onBackForward('horizon', (to) => {
      view.restore(readHorizonView(to));
      moving = false;
      flyToEye();
      return true;
    })
  );
  onDestroy(() => {
    clearTimeout(addressTimer);
    overlay.destroy();
    view.destroy();
    eyeLayer?.destroy();
    coneLayer?.destroy();
  });

  // -- one map, three places ----------------------------------------------------------

  /** The map's box changed with the layout: tell the engine once the class has landed. */
  $effect(() => {
    void layout;
    void folded;
    if (!surface) return;
    tick().then(() => surface?.resize());
  });

  function flyToEye({ zoom = 12 } = {}) {
    const eye = view.observer;
    if (!engine || !eye) return;
    tick().then(() => {
      surface?.resize();
      engine?.setView({ lat: eye.lat, lon: eye.lon }, Math.max(engine.getZoom(), zoom));
    });
  }

  function startMove() {
    moving = true;
    folded = false;
    pointMenu = null;
  }

  function cancelMove() {
    moving = false;
    flyToEye();
  }

  function standAt(at) {
    view.standAt(at);
    moving = false;
    flyToEye();
  }

  function onKey(event) {
    if (event.key === 'Escape' && moving && !pointMenu && !event.defaultPrevented) {
      event.preventDefault();
      cancelMove();
    }
  }

  // -- the marks on the map --------------------------------------------------------

  let eyeLayer = $state.raw(null);
  let coneLayer = $state.raw(null);
  // the eye's place while it is being dragged, stood on once it is dropped
  let dragAt = null;

  $effect(() => {
    if (!engine || !ready) return;
    untrack(() => {
      // the cone first, so the eye and the marks are drawn over it
      coneLayer ??= createSurface(engine);
      eyeLayer ??= createSurface(engine);
    });
  });

  /**
   * Where the heading knob sits: on the view's middle line, a fixed number of
   * screen pixels out from the eye whatever the map's zoom, so it is always
   * there to be taken.
   */
  const HANDLE_PX = 70;
  function lookHandle(eye) {
    const zoom = mapView?.zoom ?? 12;
    const metresPerPixel = (156543.03 * Math.cos((eye.lat * Math.PI) / 180)) / 2 ** zoom;
    return groundPoint(eye, view.camera.heading, HANDLE_PX * metresPerPixel);
  }
  // set while the knob is in the hand, so the view turning under it does not move it back
  let aiming = false;

  const CROSSHAIR = `<svg width="22" height="22" viewBox="-11 -11 22 22" stroke="${HZ.mark}"><circle r="5.5"/><path d="M-10 0h5M5 0h5M0 -10v5M0 5v5"/></svg>`;
  const PIN = { seen: HZ.seen, hidden: HZ.hidden, busy: HZ.pending };

  /** The eye, its heading knob, the marked point and the clicked ground: redrawn when one of them moves. */
  $effect(() => {
    const eye = view.observer;
    const target = view.target;
    const pointed = view.pointed;
    if (!eyeLayer) return;
    const state = !target ? '' : target.busy || target.error ? 'busy' : target.visible ? 'seen' : 'hidden';
    eyeLayer.set([
      eye && {
        id: 'look',
        kind: 'marker',
        at: untrack(() => lookHandle(eye)),
        className: 'horizon-look',
        html: '<span></span>',
        size: [12, 12],
        title: 'Drag to turn the view',
        draggable: true,
        zIndex: 901,
        onDragStart: () => (aiming = true),
        onDrag: (at) => {
          view.look({ heading: bearingBetween(eye, at) });
          coneLayer?.patch('aim', { points: [eye, at] });
        },
        onDragEnd: () => {
          aiming = false;
          eyeLayer?.patch('look', { at: lookHandle(eye) });
          coneLayer?.patch('aim', { points: [eye, lookHandle(eye)] });
        },
      },
      eye && {
        id: 'eye',
        kind: 'marker',
        at: eye,
        className: 'horizon-eye',
        html: `<span style="background:${HZ.lens}"></span>`,
        size: [16, 16],
        title: 'The viewpoint: drag to move it',
        draggable: true,
        zIndex: 900,
        onDrag: (at) => (dragAt = at),
        onDragEnd: () => {
          if (dragAt) view.standAt(dragAt);
          dragAt = null;
        },
      },
      target && {
        id: 'target',
        kind: 'marker',
        at: target,
        className: 'horizon-pin',
        html: `<span style="border-top-color:${PIN[state]}"></span>`,
        size: [14, 13],
        anchor: [7, 13],
        title: 'The marked point',
        zIndex: 880,
      },
      pointed && {
        id: 'pointed',
        kind: 'marker',
        at: pointed,
        className: 'horizon-crosshair',
        html: CROSSHAIR,
        size: [22, 22],
        title: 'Clicked in the view',
        zIndex: 870,
      },
    ]);
  });

  // the knob follows the view as it turns, and the map as it zooms
  $effect(() => {
    const eye = view.observer;
    void view.camera.heading;
    void mapView?.zoom;
    if (!eyeLayer || !eye || aiming) return;
    const knob = lookHandle(eye);
    eyeLayer.patch('look', { at: knob });
    coneLayer?.patch('aim', { points: [eye, knob] });
  });

  /** What the lens takes in, out to the skyline, and the line to the knob; patched as the head turns. */
  let coneDrawn = false;
  $effect(() => {
    const eye = view.observer;
    const points = footprint(eye, view.panorama, view.camera, {
      step: Math.max(0.5, Math.min(view.camera.fov, 360) / 90),
      limit: view.visibility ?? Infinity,
    });
    if (!coneLayer) return;
    if (points.length < 3 || !eye) {
      if (coneDrawn) coneLayer.clear();
      coneDrawn = false;
      return;
    }
    if (coneDrawn) {
      coneLayer.patch('cone', { points });
      return;
    }
    coneLayer.set([
      {
        id: 'cone',
        kind: 'polygon',
        points,
        style: { stroke: HZ.lens, strokeWidth: 1.5, strokeOpacity: 0.9, fill: HZ.lens, fillOpacity: 0.12, interactive: false },
      },
      {
        id: 'aim',
        kind: 'line',
        points: [eye, untrack(() => lookHandle(eye))],
        style: { stroke: '#ffffff', strokeWidth: 1.5, strokeOpacity: 0.9, interactive: false },
      },
    ]);
    coneDrawn = true;
  });

  /** The small map keeps the eye in sight as it walks: a step past its edge brings it back to the middle. */
  $effect(() => {
    const eye = view.observer;
    if (!eye || !engine || !ready || layout !== 'looking') return;
    untrack(() => {
      const at = engine.latLngToContainerPoint(eye);
      const box = mapBox?.getBoundingClientRect();
      if (!box || !at) return;
      const inside = at.x > box.width * 0.15 && at.x < box.width * 0.85 && at.y > box.height * 0.15 && at.y < box.height * 0.85;
      if (!inside) engine.setView({ lat: eye.lat, lon: eye.lon }, engine.getZoom());
    });
  });

  function onMapClick(at) {
    if (layout === 'looking') view.mark(at);
    else standAt(at);
  }

  // -- the place search and the right-click menu, on the map ------------------------------

  let searchText = $state('');
  let searching = $state(false);

  /** Coordinates stand there at once; a place name flies the map there to pick the spot. */
  async function goTo() {
    const text = searchText.trim();
    if (!text || searching) return;
    searching = true;
    try {
      try {
        const parsed = await api.post('/api/geo/parse', { text });
        standAt(parsed);
        return;
      } catch {
        // not coordinates: a place name
      }
      const place = await api.get(`/api/geo/geocode?q=${encodeURIComponent(text)}`);
      engine?.setView(place, Math.max(engine.getZoom(), 13));
    } catch {
      toast('No match. Try coordinates ("50.4501, 30.5234"), DMS, or a place name', 'danger');
    } finally {
      searching = false;
    }
  }

  function goToSuggestion(item) {
    if (!Number.isFinite(item.lat) || !Number.isFinite(item.lon)) return;
    if (item.group === 'coords') {
      standAt(item);
      return;
    }
    engine?.setView(item, item.zoom ?? Math.max(engine.getZoom(), 13));
  }

  let pointMenu = $state(null);
  const pointTools = otherMapTools('horizon');
  const pointActions = $derived(actionsFor(layout === 'looking' ? ['stand', 'mark'] : ['stand']));

  function onMapContextMenu(at) {
    pointMenu = { ...at, frame: { width: mapBox?.clientWidth ?? 0, height: mapBox?.clientHeight ?? 0 } };
  }

  async function onPointMenu(id, value) {
    const at = pointMenu;
    pointMenu = null;
    if (!at) return;
    const point = { lat: at.lat, lon: at.lon };
    if (id === 'copy') await copyText(value);
    else if (id === 'stand') standAt(point);
    else if (id === 'mark') view.mark(point);
    else if (id === 'goto') openMapAt(value, { ...point, zoom: mapView?.zoom });
  }

  let mapBox = $state(null);

  // -- reading out -------------------------------------------------------------------

  const credits = $derived.by(() => {
    const names = (view.panorama?.credits ?? []).map((credit) => credit.attribution);
    if (view.ground === 'imagery' && view.drape) names.push(...view.drape.credits.map((credit) => credit.attribution));
    if (view.peaksOn && view.peaks.length) names.push('© OpenStreetMap contributors');
    const resolution = view.panorama?.resolution ? `${view.panorama.resolution} m relief` : '';
    return [...names, resolution].filter(Boolean).join(' · ');
  });
  const aspect = $derived(overlay.aspect || (frame.width && frame.height ? frame.width / frame.height : 4 / 3));
  /** The frame in the photo's shape while one is laid, letterboxed in the room there is. */
  const boxed = $derived(overlay.source && overlay.aspect ? fitFrame(overlay.aspect, slot) : null);

  // -- the photo laid over the view ------------------------------------------------

  /** The terrain's skyline at an azimuth: the finer window's where it reaches, the turn's elsewhere. */
  const skyline = (azimuth) => skylineBetween(view.detail, azimuth) ?? skylineBetween(view.panorama, azimuth);
  const traceCamera = $derived({ ...view.camera, width: frame.width, height: frame.height });
  const samples = $derived(overlay.traceShown && frame.width ? traceSamples(overlay.strokes, frame) : []);
  const gap = $derived(samples.length && view.panorama ? traceGap(samples, traceCamera, skyline) : null);

  /**
   * Turn the view so its skyline meets the trace; the lens stays the photo's
   * when it said one. The toast says what changed and takes it back.
   */
  function fit() {
    const result = fitToTrace(samples, traceCamera, skyline, { lens: !overlay.lens });
    if (!result) {
      toast('Trace more of the skyline first', 'warn');
      return;
    }
    if (!result.improved || !gap) {
      toast('The view is already as close to the trace as a fit gets');
      return;
    }
    const { heading, tilt, roll, fov } = view.camera;
    const before = gapDegrees(gap);
    view.look(result.camera);
    toast(`Fitted to the trace: gap ${before}° to ${gapDegrees(result.gap)}°`, 'ok', 8000, {
      label: 'Undo',
      onClick: () => view.look({ heading, tilt, roll, fov }),
    });
  }

  function layCase(item) {
    photoDialog = false;
    const caseId = caseState.current?.id;
    if (caseId) overlay.openCase(caseId, item);
  }

  /** A file from this computer: added to the case when one is open, kept in this browser when not. */
  async function layFile(file) {
    photoDialog = false;
    if (!overlay.accepts(file)) {
      toast('Only a photo or a video can be laid over the view', 'danger');
      return;
    }
    const caseId = caseState.current?.id;
    if (!caseId) {
      overlay.openFile(file);
      return;
    }
    try {
      const form = new FormData();
      form.append('file', file);
      const answer = await api.post(`/api/cases/${caseId}/media/upload`, form);
      if (!answer?.item?.path) throw new Error('The case did not keep the file.');
      await overlay.openCase(caseId, answer.item);
      toast(answer.duplicate ? `Already in the case: ${file.name}` : `Added to the case: ${file.name}`);
      reloadCase();
    } catch (failure) {
      toast(failure.message, 'danger');
    }
  }

  const carriesFiles = (event) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
  function onDragOver(event) {
    if (layout !== 'looking' || !carriesFiles(event)) return;
    event.preventDefault();
    dropping = true;
  }
  function onDrop(event) {
    if (layout !== 'looking' || !carriesFiles(event)) return;
    event.preventDefault();
    dropping = false;
    const file = event.dataTransfer.files?.[0];
    if (file) layFile(file);
  }
  const title = $derived(view.observer ? `${view.observer.lat.toFixed(4)}, ${view.observer.lon.toFixed(4)}` : '');

  // The sun and the moon, and the light the ground is shaded with
  // (`view.light`): the sun or the moon of the chosen hour, the dark of the
  // night, or with no day read the north-west light a relief map is lit by.
  const skyMinute = $derived(minuteOf(view.skyTime));
  const tracks = $derived(view.skyOn && view.sky ? skyTracks(view.sky, { minute: skyMinute }) : []);
  const bodies = $derived(
    view.skyOn && view.sky ? { sun: skyAt(view.sky, 'sun', skyMinute), moon: skyAt(view.sky, 'moon', skyMinute) } : null
  );

  /** Face a direction from the inspector. */
  function turnTo(direction) {
    view.look(faceTowards({ ...view.camera, width: frame.width || 1, height: frame.height || 1 }, direction));
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="horizon-tool {layout}" class:folded>
  <div class="hz-main">
    <header class="tool-header hz-head">
      {#if layout === 'looking'}
        <h2 class="hz-title">View from <span class="mono">{title}</span></h2>
      {:else}
        <div class="hz-ask">
          <h2>{layout === 'moving' ? 'Move the viewpoint' : 'Pick a viewpoint'}</h2>
          <p class="sub">
            {layout === 'moving' ? 'Click the new spot, or search a place.' : 'Click where you want to stand, or search a place.'}
          </p>
        </div>
      {/if}
      <span class="hz-status" role="status" aria-live="polite">
        {#if layout === 'looking' && view.status}
          <span class="spinner" aria-hidden="true"></span>{view.status}
        {/if}
      </span>
      {#if layout === 'looking' && !overlay.source}
        <button
          type="button"
          class="btn btn-sm hz-act"
          onclick={() => (photoDialog = true)}
          title="Lay a photo or video over the view to match it"
          aria-label="Add a photo or video"
        >
          <Icon name="image" size={14} /><span class="hz-act-label">Add a photo or video</span>
        </button>
      {/if}
      {#if layout === 'moving'}
        <button type="button" class="btn btn-sm" onclick={cancelMove}>Cancel</button>
      {:else if layout === 'looking'}
        <button
          type="button"
          class="btn btn-ghost btn-sm fold"
          onclick={() => (folded = !folded)}
          aria-expanded={!folded}
          title={folded ? 'Show the map and settings' : 'Hide the map and settings'}
          aria-label={folded ? 'Show the map and settings' : 'Hide the map and settings'}
        >
          <Icon name={folded ? 'chevronLeft' : 'chevronRight'} size={15} />
        </button>
      {/if}
    </header>

    <div class="hz-stage dark-surface">
      <HorizonStrip {view} {frame} {bodies} />
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="view-area" ondragover={onDragOver} ondragleave={() => (dropping = false)} ondrop={onDrop}>
        {#if overlay.source && layout === 'looking'}
          <OverlayBar {overlay} {gap} onchange={() => (photoDialog = true)} onfit={fit} />
        {/if}
        <div class="frame-slot" bind:clientWidth={slot.width} bind:clientHeight={slot.height}>
          <div
            class="frame"
            class:boxed
            style:left={boxed ? `${boxed.left}px` : null}
            style:top={boxed ? `${boxed.top}px` : null}
            style:width={boxed ? `${boxed.width}px` : null}
            style:height={boxed ? `${boxed.height}px` : null}
            bind:clientWidth={frame.width}
            bind:clientHeight={frame.height}
          >
            <HorizonView
              {view}
              {overlay}
              units={prefs.units}
              sky={view.light}
              {tracks}
              clock={view.skyOn ? view.skyTime : ''}
              {credits}
              {copernicus}
              onsetup={() => (copernicusHelp = true)}
            />
          </div>
          {#if dropping}
            <div class="drop" aria-hidden="true">
              <p>Drop to lay it over the view{caseState.current ? ': it is added to the case' : ''}</p>
            </div>
          {/if}
        </div>
        {#if overlay.source?.kind === 'video' && layout === 'looking'}
          <OverlayTransport {overlay} />
        {/if}
        {#if copernicusHelp}
          <div class="setup">
            <CopernicusNeeded need="account" tool="Sentinel-2 near the eye" onclose={() => (copernicusHelp = false)} />
          </div>
        {/if}
        {#if layout === 'looking' && view.error}
          <div class="trouble" role="alert">
            <p>{view.error}</p>
            <button type="button" class="btn btn-sm" onclick={() => view.retry()}>Try again</button>
          </div>
        {:else if layout === 'looking' && !view.panorama}
          <p class="drawing"><span class="spinner" aria-hidden="true"></span>Drawing the view…</p>
        {/if}
      </div>
    </div>
  </div>

  <aside class="hz-inspector" aria-label="Map and settings">
    <div class="hz-slot"></div>
    <div class="hz-groups">
      <HorizonPanel {view} {overlay} units={prefs.units} {aspect} onmove={layout === 'looking' ? startMove : null} onturn={turnTo} />
    </div>
  </aside>

  <div class="hz-map" bind:this={mapBox}>
    {#if mapView}
      <MapSurface
        bind:this={surface}
        bind:engine
        bind:view={mapView}
        bind:bearing
        bind:ready
        bind:refused
        bind:providerId
        {imagery}
        home={mapView}
        resetToHome={false}
        chrome={false}
        imperial={prefs.units === 'imperial'}
        armed={layout === 'looking' ? 'measuring' : 'selecting'}
        controlsTop={layout === 'looking' ? 10 : 60}
        onclick={onMapClick}
        oncontextmenu={onMapContextMenu}
        onusage={() => imagery.refreshUsage()}
      >
        {#if layout !== 'looking'}
          <div class="hz-search">
            <PlaceSearch
              bind:value={searchText}
              centre={mapView ? { lat: mapView.lat, lon: mapView.lon } : null}
              units={prefs.units}
              {searching}
              listId="horizon-suggestions"
              onpick={goToSuggestion}
              onsubmit={goTo}
            />
          </div>
        {/if}
        {#if pointMenu}
          <MapContextMenu
            at={pointMenu}
            frame={pointMenu.frame}
            zoom={mapView?.zoom ?? 12}
            format={prefs.coordFormat}
            actions={pointActions}
            tools={pointTools}
            onpick={onPointMenu}
            onclose={() => (pointMenu = null)}
          />
        {/if}
      </MapSurface>
    {/if}
  </div>
</div>

{#if photoDialog}
  <PhotoDialog
    caseId={caseState.current?.id ?? null}
    current={overlay.source?.path ?? null}
    onpick={layCase}
    onfile={layFile}
    onclose={() => (photoDialog = false)}
  />
{/if}

<style>
  .horizon-tool {
    /* the view's own marks, shared with its strip; mirrored for the map in lib/horizon/marks.js */
    --hz-sun: #ffc94d;
    --hz-moon: #8ec5ff;
    --hz-mark: var(--anno-3);
    --hz-seen: var(--anno-4);
    --hz-hidden: var(--anno-1);
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 340px;
    height: 100%;
    min-height: 0;
    background: var(--bg-0);
  }
  .horizon-tool.picking,
  .horizon-tool.folded {
    grid-template-columns: minmax(0, 1fr);
  }
  .horizon-tool.picking .hz-inspector,
  .horizon-tool.folded .hz-inspector {
    display: none;
  }
  .hz-main {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .hz-act {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  /* a narrow view keeps the icon; the button says the rest to a screen reader and in its tooltip */
  @container (max-width: 1000px) {
    .hz-act-label {
      display: none;
    }
  }
  .hz-head {
    flex: 0 0 auto;
    min-height: 40px;
    padding: 0 8px 0 12px;
  }
  .hz-head h2 {
    margin: 0;
    font-size: var(--fs-md);
    white-space: nowrap;
  }
  .hz-title .mono {
    font-weight: 500;
    color: var(--text-2);
  }
  .hz-ask {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
  }
  .hz-ask .sub {
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .fold {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
  }
  .hz-status {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    margin-left: auto;
    color: var(--text-2);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }
  .hz-stage {
    /* one glass for every chip on the view, read in the stage's own dark tokens */
    --hz-glass: color-mix(in srgb, var(--bg-0) 84%, transparent);
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    background: var(--bg-0);
  }
  .view-area {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .frame-slot {
    position: relative;
    flex: 1;
    min-height: 0;
    /* the bars either side of a photo: darker than the view, so its edge reads */
    background: color-mix(in srgb, var(--bg-0) 70%, black);
  }
  .frame {
    position: absolute;
    inset: 0;
  }
  .frame.boxed {
    inset: auto;
  }
  .drop {
    position: absolute;
    inset: 8px;
    z-index: 6;
    display: grid;
    place-items: center;
    border: 2px dashed var(--accent);
    border-radius: var(--r-md);
    background: color-mix(in srgb, var(--bg-0) 60%, transparent);
    pointer-events: none;
  }
  .drop p {
    margin: 0;
    padding: 6px 12px;
    border-radius: var(--r-md);
    background: var(--hz-glass);
    color: var(--text-1);
    font-size: var(--fs-sm);
  }
  .setup {
    position: absolute;
    inset: 48px 0 32px;
    z-index: 5;
    display: grid;
    place-items: center;
    overflow: auto;
    pointer-events: none;
  }
  .setup > :global(*) {
    max-width: min(560px, calc(100% - 32px));
    pointer-events: auto;
  }
  .trouble {
    position: absolute;
    top: 50%;
    left: 50%;
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 480px;
    padding: 10px 12px;
    transform: translate(-50%, -50%);
    border-radius: var(--r-md);
    background: var(--hz-glass);
    box-shadow: 0 0 0 1px var(--border);
    color: var(--danger);
    font-size: var(--fs-sm);
  }
  .trouble p {
    margin: 0;
  }
  .drawing {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin: 0;
    color: var(--text-3);
    font-size: var(--fs-sm);
    pointer-events: none;
  }
  .spinner {
    width: 10px;
    height: 10px;
    border: 2px solid color-mix(in srgb, var(--text-1) 25%, transparent);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* -- the inspector --------------------------------------------------------- */
  .hz-inspector {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-left: 1px solid var(--border);
    background: var(--bg-1);
  }
  .hz-slot {
    flex: 0 0 250px;
  }
  .moving .hz-slot {
    flex-basis: 0;
  }
  .hz-groups {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  /* -- the one map, in the place the layout gives it ------------------------- */
  .hz-map {
    position: absolute;
    display: flex;
    z-index: 2;
  }
  .picking .hz-map {
    inset: 40px 0 0 0;
  }
  .moving .hz-map {
    inset: 40px 340px 0 0;
  }
  .looking .hz-map {
    top: 0;
    right: 0;
    width: 340px;
    height: 250px;
    border-left: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }
  .looking.folded .hz-map {
    display: none;
  }
  /* the small map zooms with the wheel: its buttons would cover the ground round the eye */
  .looking .hz-map :global(.maplibregl-ctrl-top-left) {
    display: none;
  }
  /* the small map's credit wraps beside its scale bar rather than over it */
  .looking .hz-map :global(.maplibregl-ctrl-attrib) {
    max-width: 230px;
    white-space: normal;
    text-align: right;
    line-height: 1.25;
  }
  .hz-search {
    position: absolute;
    top: 10px;
    left: 10px;
    z-index: 660;
    width: min(380px, calc(100% - 20px));
  }
</style>
