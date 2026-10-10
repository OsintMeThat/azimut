<script>
  /**
   * Horizon: stand somewhere and look.
   *
   * Satellite answers "what is this ground"; this tab answers what an eye
   * standing on it sees, which is the question a photo or a video puts to an
   * investigator: from where, looking which way, was this taken. The picture
   * is the terrain round that eye drawn on the GPU, on the same curved Earth
   * and refraction as the app's horizon march (engine/horizon.py), never
   * exaggerated: a summit's name sits on the march's skyline, a clicked slope's
   * distance is read off the very ground drawn, and whether a mast is in sight
   * is the march's line of sight.
   *
   * Three layouts around one map, which is moved rather than mounted twice:
   *
   * - **Picking**, with no eye yet: the map fills the tab with a place search,
   *   and a click stands there.
   * - **Moving** the eye ("Move the viewpoint"): the same large map beside the
   *   inspector, the eye and its cone drawn; a click stands there and comes
   *   back. Cancel or Escape leaves it where it was.
   * - **Looking**: the view is the hero, the whole turn in a strip under it,
   *   beside its heading; the map shrinks to the top of the inspector on the
   *   right, where a click marks a point the view then shows, in sight or
   *   hidden, and the eye can be dragged. The inspector folds away for a wider
   *   view, or its left edge is dragged to widen it, the map growing with it.
   *   The small map can trade places with the view, as a street-level
   *   viewer's does: the map then fills the main area and the view waits,
   *   live, in the map's corner, a click away from coming back.
   *
   * The map lays the borders, the place names and the case's saved work over
   * its picture from the start, in every layout and before any eye, the three
   * a read of the ground begins with;
   * its own Layers menu turns each off and picks the base map (satellite,
   * topographic, streets), all key-less.
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
  import { caseState, ensureCase, fmtCoords, prefs, prefsReady, reloadCase, toast, uiState } from '../lib/state.svelte.js';
  import { assignFolder } from '../lib/filing.js';
  import { splitHash } from '../lib/hash.js';
  import { copyText } from '../lib/clipboard.js';
  import { holdsUnsaved, onBackForward, settlePlace } from '../lib/backButton.js';
  import { openMapAt } from '../lib/navigate.js';
  import { actionsFor, otherMapTools } from '../lib/map/contextMenu.js';
  import { createSurface } from '../lib/map/surface.js';
  import { shareView } from '../lib/map/sharedView.js';
  import { formatDistance } from '../lib/measure.js';
  import { seenLens } from '../lib/horizon/camera.js';
  import { bearingBetween, elsewhere, faceTowards, footprint, groundPoint } from '../lib/horizon/geometry.js';
  import { inspectorWidth, mapHeightFor } from '../lib/horizon/inspector.js';
  import { HZ } from '../lib/horizon/marks.js';
  import { minuteOf, skyAt, skyTracks } from '../lib/horizon/sky.js';
  import { horizonParams, readHorizonView } from '../lib/horizon/view.js';
  import { photoKept } from '../lib/horizon/savedView.js';
  import { AUTO_REACH, searchHints } from '../lib/horizon/hints.js';
  import { blinkColours, composePair, composeView, photoTag, standingText, viewFilename } from '../lib/horizon/viewExport.js';
  import { canvasBlob, blobBase64 } from '../lib/map/compareExport.js';
  import { destinationLabel } from '../lib/exportDest.js';
  import { earthCameraLink } from '../lib/maplinks.js';
  import { verticalFov } from '../lib/horizon/camera.js';
  import {
    fitFrame,
    fitToTrace,
    gapDegrees,
    loupeMoved,
    matchRequest,
    searchedPlaces,
    searchOutcome,
    skylineBetween,
    traceGap,
    traceSamples,
  } from '../lib/horizon/overlay.js';
  import { createImageryState } from './satellite/state/imagery.svelte.js';
  import { createSavedState } from './satellite/state/saved.svelte.js';
  import { createHorizonState } from './horizon/state/horizon.svelte.js';
  import { createOverlayState } from './horizon/state/overlay.svelte.js';
  import { createViewsState } from './horizon/state/views.svelte.js';
  import MapSurface from './satellite/MapSurface.svelte';
  import MapContextMenu from './satellite/MapContextMenu.svelte';
  import MapLayers from './satellite/MapLayers.svelte';
  import SavedOverlay from './satellite/SavedOverlay.svelte';
  import PlaceSearch from './satellite/PlaceSearch.svelte';
  import HorizonView from './horizon/HorizonView.svelte';
  import HorizonStrip from './horizon/HorizonStrip.svelte';
  import HorizonPanel from './horizon/HorizonPanel.svelte';
  import OverlayBar from './horizon/OverlayBar.svelte';
  import OverlayTransport from './horizon/OverlayTransport.svelte';
  import PhotoDialog from './horizon/PhotoDialog.svelte';
  import ViewsMenu from './horizon/ViewsMenu.svelte';
  import ExportMenu from './horizon/ExportMenu.svelte';
  import CaptureMenu from './horizon/CaptureMenu.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import Icon from '../components/Icon.svelte';
  import CopernicusNeeded from '../components/CopernicusNeeded.svelte';

  const view = createHorizonState({ api });
  const imagery = createImageryState({ api });
  const overlay = createOverlayState({ api, view });
  /** The view on screen, which draws the saved work's preview. */
  let viewPane = $state(null);
  const views = createViewsState({
    api,
    view,
    overlay,
    caseId: () => caseState.current?.id ?? null,
    snapshot: () => viewPane?.snapshot() ?? Promise.resolve(null),
    footprint: () => footprint(view.observer, view.panorama, view.camera, {
      step: Math.max(0.5, Math.min(view.camera.fov, 360) / 90),
      limit: view.visibility ?? Infinity,
    }),
  });

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
  // the inspector's left edge is a drag handle; the width sticks across reloads
  let sideW = $state(inspectorWidth.clampWidth(inspectorWidth.loadWidth(), window.innerWidth));
  let sideResizing = $state(false);
  const mapH = $derived(mapHeightFor(sideW));
  /** The map and the view traded places: the map large, the view waiting in its corner. */
  let mapLarge = $state(false);
  /** The small map's Layers menu, open. */
  let layersOpen = $state(false);
  /** How to set Copernicus up, shown over the view when its locked switch is pressed. */
  let copernicusHelp = $state(false);
  const copernicus = $derived(Boolean(imagery.providers?.length && imagery.find('sentinel2')));

  const layout = $derived(!view.observer ? 'picking' : moving ? 'moving' : 'looking');
  /** The loupe the view is seen through while a photo lies on it, or null. */
  const seenLoupe = $derived(
    overlay.source && view.camera.projection === 'camera' && loupeMoved(overlay.loupe) ? overlay.loupe : null
  );
  /** What the view shows, through that loupe: the heading and width the map's cone and knob follow. */
  const shownLens = $derived(
    seenLoupe ? { ...view.camera, ...seenLens({ ...view.camera, width: frame.width, height: frame.height, loupe: seenLoupe }) } : view.camera
  );
  const swapped = $derived(mapLarge && layout === 'looking');

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

  // -- saved views ------------------------------------------------------------------

  /** The case's views, read when a case opens or its work moves; the one open is let go with its case. */
  let viewsCase = null;
  $effect(() => {
    const caseId = caseState.current?.id ?? null;
    void caseState.rev;
    untrack(() => {
      if (viewsCase !== null && caseId !== viewsCase) views.fresh();
      viewsCase = caseId;
      views.load(caseId);
    });
  });

  /** The name in the header: the open view's, or what was typed for a new one. */
  let viewTitle = $state('');
  $effect(() => {
    const current = views.current;
    untrack(() => (viewTitle = current?.title ?? ''));
  });
  const renamed = $derived(Boolean(views.current && viewTitle.trim() && viewTitle.trim() !== views.current.title));
  /** Whether Save has something to keep: the view changed, or its name did. */
  const unsaved = $derived(views.dirty || renamed);
  const saveBlocked = $derived(!caseState.current ? 'Open a case to keep this view' : '');

  async function saveView() {
    if (saveBlocked || views.busy || !unsaved || !view.observer) return;
    // a photo of this computer, laid before a case was open, cannot be kept with the view
    const local = !photoKept(overlay);
    const answer = await views.save(viewTitle);
    if (!answer) return;
    if (local) toast(`Saved ${answer.title}, without the photo: it is a file of this computer, not of the case`, 'warn', 6500);
    else toast(`Saved ${answer.title}`);
  }

  /** What waits on the analyst's word before the view on screen is let go: `{ revert, name }`. */
  let discarding = $state(null);
  /** Work a switch would lose: a saved view's changes, or a photo laid and matched but never saved. */
  const keepsWork = () => views.dirty && Boolean(views.current || overlay.source);

  function openView(name) {
    const same = views.current?.name === name;
    if (same && !views.dirty) return;
    if (keepsWork()) {
      discarding = { revert: same, name };
      return;
    }
    showView(name);
  }

  async function showView(name) {
    discarding = null;
    moving = false;
    mapLarge = false;
    if (await views.open(name)) flyToEye();
  }

  function newView() {
    views.fresh();
    viewTitle = '';
  }

  /** Back to the map with no eye, to pick another viewpoint; a word first when unsaved work would go. */
  function closeView() {
    if (keepsWork()) {
      discarding = { close: true };
      return;
    }
    leaveView();
  }

  function leaveView() {
    discarding = null;
    overlay.remove();
    views.fresh();
    viewTitle = '';
    search = null;
    view.leave();
    uiState.horizonEye = null;
    moving = false;
    mapLarge = false;
    folded = false;
  }

  /** A view handed over from the saved work (Satellite, Files): opened here. */
  $effect(() => {
    const asked = uiState.openHorizonView;
    if (uiState.tool !== 'horizon' || !asked || !caseState.current) return;
    untrack(() => {
      uiState.openHorizonView = null;
      openView(asked);
    });
  });

  // what went wrong opening or saving a view, or what a view opened without
  $effect(() => {
    const message = views.error;
    if (!message) return;
    untrack(() => {
      toast(message, 'warn', 6500);
      views.clearError();
    });
  });

  onDestroy(holdsUnsaved('horizon', () => Boolean(views.current && unsaved)));

  // -- exporting ---------------------------------------------------------------------

  /** The kind of picture being drawn, or ''. */
  let exportBusy = $state('');

  /** Google Earth standing at the eye, looking where the view looks. */
  const earthLink = $derived.by(() => {
    const eye = view.observer;
    const altitude = view.panorama?.observer?.altitude;
    if (!eye || !Number.isFinite(altitude) || view.camera.projection === 'panorama') return '';
    const { heading, tilt, roll } = view.camera;
    const vfov = verticalFov({ ...view.camera, width: frame.width || 16, height: frame.height || 9 });
    return earthCameraLink({ lat: eye.lat, lon: eye.lon, altitude, heading, tilt, roll, vfov });
  });

  /**
   * Write the view out as a picture (lib/horizon/viewExport.js): drawn by the
   * view at the export's size, composed with its names, ruler and credits,
   * and written to the export folder; with `keep`, a copy is kept in the case
   * under the saved view. The pair kinds and the blink draw the photo and the
   * terrain through the same frame. `trace` draws the skyline traced on the
   * photo over it, and `signed` closes the credits with the Azimut lockup.
   */
  async function exportView(kind, { keep = false, trace = false, signed = true } = {}) {
    if (exportBusy || !viewPane || !view.observer) return;
    const pair = kind === 'row' || kind === 'column' || kind === 'blink';
    if (pair && !overlay.source) return;
    exportBusy = kind;
    try {
      const owner = await ensureCase();
      const drawn = await viewPane.exportPicture({
        kind: kind === 'turn' ? 'turn' : 'view',
        variants: pair ? [{ photo: 1 }, { photo: 0 }] : [{}],
      });
      if (!drawn) throw new Error('the view has not finished landing');
      const title = viewTitle.trim() || views.suggested;
      const common = {
        layers: drawn.layers,
        scale: drawn.scale,
        title,
        standing: standingText({ observer: view.observer, camera: drawn.camera, sky: { on: view.skyOn, date: view.skyDate, time: view.skyTime }, kind }),
        credits,
        daylight: view.ground !== 'plain' || Boolean(overlay.source),
        trace,
        signed,
      };
      const filename = viewFilename(title, kind);
      let result;
      if (kind === 'blink') {
        const [photoFrame, terrainFrame] = drawn.frames;
        const form = new FormData();
        form.append('image_a', await canvasBlob(composeView({ ...common, picture: photoFrame, tag: photoTag(overlay.warped) })), 'photo.png');
        form.append('image_b', await canvasBlob(composeView({ ...common, picture: terrainFrame, tag: 'Terrain, simulated' })), 'terrain.png');
        form.append('animation', 'blink');
        form.append('interval', '800');
        form.append('keep', blinkColours());
        form.append('filename', filename);
        result = await api.post(`/api/cases/${owner.id}/compare/gif`, form);
      } else {
        const picture = pair
          ? composePair({ ...common, photo: drawn.frames[0], terrain: drawn.frames[1], layout: kind, reshaped: overlay.warped })
          : composeView({ ...common, picture: drawn.frames[0], tag: reshapedShown() ? photoTag(true) : '' });
        const blob = await canvasBlob(picture);
        result = await api.post(`/api/cases/${owner.id}/plates`, { filename, format: 'png', png: await blobBase64(blob), overwrite: false });
        if (keep && views.current) await keepPicture(owner.id, blob, kind, filename);
      }
      toast(`${result.file} written to ${destinationLabel(result.path)}${keep && views.current && kind !== 'blink' ? ', and kept in the case' : ''}`, 'ok', 5200, {
        label: 'Show',
        onClick: () => api.post(`/api/cases/${owner.id}/plates/reveal`).catch(() => {}),
      });
    } catch (failure) {
      toast(`Export failed: ${failure.message}`, 'danger');
    } finally {
      exportBusy = '';
    }
  }

  /** A picture of the saved view kept in the case, listed under it. */
  async function keepPicture(caseId, blob, kind, filename) {
    const form = new FormData();
    form.append('image', blob, 'view.png');
    form.append('kind', kind);
    form.append('filename', filename);
    if (credits) form.append('attribution', credits);
    const answer = await api.post(`/api/cases/${encodeURIComponent(caseId)}/horizon/views/${encodeURIComponent(views.current.name)}/images`, form);
    reloadCase();
    return answer.path;
  }

  let captureBusy = $state(false);

  /** Whether the picture shows a photo pulled by hand, which its tag then says. */
  const reshapedShown = () => Boolean(overlay.source && overlay.warped && overlay.shown > 0);

  /**
   * File the view in the case as it shows, or an `area` of it dragged over the
   * view: Satellite's capture, for this tab. It is drawn through the screen's
   * own camera, the loupe kept, with the names, the ruler and the credits an
   * export has, and says what the picture faces rather than the view's lens.
   * No saved view is needed, nor an open case (one is made); a saved view and
   * the photo laid are named on it.
   */
  async function captureView(area = false) {
    if (captureBusy || exportBusy || !viewPane || !view.observer) return;
    const box = area ? await viewPane.chooseArea() : null;
    if (area && !box) return;
    captureBusy = true;
    try {
      const owner = await ensureCase();
      const drawn = await viewPane.exportPicture({ kind: 'screen', area: box });
      if (!drawn) throw new Error('the view has not finished landing');
      const title = viewTitle.trim() || views.suggested;
      const faced = { ...view.camera, ...(drawn.lens ? { heading: drawn.lens.heading, fov: drawn.lens.fov } : {}) };
      const picture = composeView({
        picture: drawn.frames[0],
        layers: drawn.layers,
        scale: drawn.scale,
        title,
        standing: standingText({ observer: view.observer, camera: faced, sky: { on: view.skyOn, date: view.skyDate, time: view.skyTime } }),
        credits,
        daylight: view.ground !== 'plain' || Boolean(overlay.source),
        tag: reshapedShown() ? photoTag(true) : '',
      });
      const form = new FormData();
      form.append('image', await canvasBlob(picture), 'capture.png');
      form.append('filename', viewFilename(title, 'capture'));
      form.append('lat', String(view.observer.lat));
      form.append('lon', String(view.observer.lon));
      form.append('heading', String(((faced.heading % 360) + 360) % 360));
      form.append('fov', String(faced.fov));
      form.append('area', box ? 'true' : 'false');
      if (views.current) form.append('view', views.current.name);
      const photo = overlay.source;
      if (photo?.path && photo.caseId === owner.id) form.append('photo', photo.path);
      if (credits) form.append('attribution', credits);
      await api.post(`/api/cases/${encodeURIComponent(owner.id)}/horizon/captures`, form);
      reloadCase();
      toast(box ? 'Area of the view captured & filed' : 'View captured & filed', 'ok');
    } catch (failure) {
      toast(`Capture failed: ${failure.message}`, 'danger', 6000);
    } finally {
      captureBusy = false;
    }
  }

  /**
   * The photo and the terrain through the same frame, the ridge lines on both,
   * kept under the view and laid as two panels of a new Geo Proof. A view never
   * saved is saved first: the panels say which view they came from.
   */
  async function sendToProof() {
    if (exportBusy || !viewPane || !overlay.source) return;
    if (!caseState.current) {
      toast('Open a case to send the view to Geo Proof', 'warn');
      return;
    }
    exportBusy = 'proof';
    try {
      if (!views.current || unsaved) {
        const saved = await views.save(viewTitle);
        if (!saved) return;
      }
      const drawn = await viewPane.exportPicture({ kind: 'view', variants: [{ photo: 1 }, { photo: 0 }] });
      if (!drawn) throw new Error('the view has not finished landing');
      const caseId = caseState.current.id;
      const name = views.current.title;
      const paths = [];
      const photoPart = overlay.warped ? 'photo reshaped, with the ridge lines' : 'photo with the ridge lines';
      for (const [index, part] of [['photo', photoPart], ['terrain', 'terrain, simulated']].entries()) {
        const blob = await canvasBlob(drawn.frames[index]);
        paths.push(await keepPicture(caseId, blob, part[0], `${name} ${part[1]}`));
      }
      for (const path of paths) if (!uiState.composeQueue.includes(path)) uiState.composeQueue.push(path);
      uiState.tool = 'proof';
    } catch (failure) {
      toast(`Could not send the view to Geo Proof: ${failure.message}`, 'danger');
    } finally {
      exportBusy = '';
    }
  }

  // -- one camera with the other map tabs -------------------------------------------

  /**
   * The window's camera (lib/map/sharedView.js). Once the eye and its look
   * rest, the other maps look from the eye, turned to its heading; Coords &
   * Sky reads the eye; Satellite draws its cone. While no eye stands, this
   * tab's map follows the others as any map tab does. A standing eye never
   * moves for them: when they look elsewhere, the map offers to move there.
   */
  const share = shareView('horizon', { state: uiState, enabled: () => prefs.mapSync });
  let standTimer = 0;
  $effect(() => {
    const eye = view.observer;
    const { heading, fov, projection } = shownLens;
    if (!eye) return;
    clearTimeout(standTimer);
    // a turn in the hand, or a video playing, is said once it rests
    standTimer = setTimeout(() => {
      untrack(() => {
        uiState.horizonEye = { lat: eye.lat, lon: eye.lon, heading, fov, projection };
        // a hidden tab moved nothing the analyst is looking at
        if (uiState.tool !== 'horizon') return;
        share.stood({ lat: eye.lat, lon: eye.lon, heading }, mapView?.zoom ?? 13);
        uiState.mapPoint = { lat: eye.lat, lon: eye.lon, zoom: uiState.mapView?.zoom ?? 13 };
      });
    }, 400);
  });
  onDestroy(() => clearTimeout(standTimer));

  /** With no eye yet, the map is a map tab like the others: it goes where they left the window. */
  $effect(() => {
    void uiState.mapView;
    if (uiState.tool !== 'horizon' || !ready || !engine || layout !== 'picking') return;
    untrack(() => {
      const next = share.pending(engine.camera());
      if (next) engine.setCamera(next);
    });
  });

  /** Where the other maps look, once they left the eye behind: offered, never followed. */
  const away = $derived(view.observer ? elsewhere(uiState.mapView, view.observer) : null);

  function moveThere() {
    const there = away;
    if (!there) return;
    startMove();
    tick().then(() => {
      surface?.resize();
      engine?.setView({ lat: there.lat, lon: there.lon }, Math.max(12, Math.min(there.zoom ?? 14, 16)));
    });
  }

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
    void swapped;
    void sideW;
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
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && uiState.tool === 'horizon' && layout === 'looking') {
      event.preventDefault();
      saveView();
      return;
    }
    if (event.key !== 'Escape' || pointMenu || event.defaultPrevented) return;
    if (layersOpen) {
      event.preventDefault();
      layersOpen = false;
    } else if (moving) {
      event.preventDefault();
      cancelMove();
    } else if (swapped) {
      event.preventDefault();
      mapLarge = false;
    }
  }

  // -- the map's layers ----------------------------------------------------------------

  /** The key-less base maps the small map offers, in the order they are read. */
  const MAP_BASES = [
    { id: 'esri-world-imagery', label: 'Satellite', title: 'Esri satellite imagery' },
    { id: 'opentopomap', label: 'Topographic', title: 'OpenTopoMap: contour lines and summit names' },
    { id: 'osm', label: 'Streets', title: 'OpenStreetMap' },
  ];
  const bases = $derived(MAP_BASES.filter((base) => imagery.find(base.id)));
  const baseIsImagery = $derived(imagery.find(providerId)?.imagery ?? true);
  /** Borders, place names and the case's saved work, on from the start. */
  const mapLayers = $state({ boundaries: true, placenames: true, saved: true });
  const overlays = $derived(
    [mapLayers.boundaries && 'boundaries', mapLayers.placenames && baseIsImagery && 'placenames'].filter(Boolean)
  );

  // the case's saved work: places, captures and located photos and videos, read as Satellite reads them
  const savedWork = createSavedState({ api, notify: toast, assignFolder, reloadCase });
  $effect(() => savedWork.load(caseState.current?.id ?? null));
  $effect(() => savedWork.loadMode(caseState.current?.id, caseState.rev));
  // the view open here is the eye the map already draws: its saved row would sit on it twice
  const savedItems = $derived(
    [...savedWork.rows, ...savedWork.media].filter((row) => row.kind !== 'view' || row.view !== views.current?.name)
  );

  const layerRows = $derived([
    {
      id: 'boundaries',
      label: 'Borders',
      on: mapLayers.boundaries,
      title: 'Country, region and district borders, from Esri',
      toggle: () => (mapLayers.boundaries = !mapLayers.boundaries),
    },
    {
      id: 'placenames',
      label: 'Place names',
      on: mapLayers.placenames,
      disabled: !baseIsImagery,
      detail: baseIsImagery ? '' : 'imagery only',
      title: baseIsImagery ? 'Towns, villages and hamlets, from OpenStreetMap via OpenFreeMap' : 'Only useful over satellite imagery',
      toggle: () => (mapLayers.placenames = !mapLayers.placenames),
    },
    {
      id: 'saved',
      label: 'Saved work',
      on: mapLayers.saved,
      disabled: !savedItems.length,
      detail: savedItems.length ? String(savedItems.length) : '',
      title: savedItems.length ? "This case's saved places and captures, and its located photos and videos" : 'Nothing is saved or placed in this case yet',
      toggle: () => (mapLayers.saved = !mapLayers.saved),
    },
  ]);

  /** A saved item picked on the map: the map goes to it. */
  function flyToSaved(row) {
    if (row.lat == null || row.lon == null || !engine) return;
    engine.setView({ lat: Number(row.lat), lon: Number(row.lon) }, Math.max(engine.getZoom(), Number(row.zoom) || 13));
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
    return groundPoint(eye, shownLens.heading, HANDLE_PX * metresPerPixel);
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
    // a photo held to the terrain: neither the eye nor its heading may be dragged away from it
    const held = Boolean(overlay.source && overlay.locked);
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
        title: held ? 'The photo is locked to the terrain' : 'Drag to turn the view',
        draggable: !held,
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
        title: held ? 'The viewpoint, held while the photo is locked' : 'The viewpoint: drag to move it',
        draggable: !held,
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
    void shownLens.heading;
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
    const points = footprint(eye, view.panorama, shownLens, {
      step: Math.max(0.5, Math.min(shownLens.fov, 360) / 90),
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
    if (view.imagery) {
      // a dated release is credited as its archive is
      const provider = imagery.find(view.imagery.provider) ?? imagery.find(view.imagery.provider.split('~')[0]);
      if (view.imagery.near) names.push(imagery.find('sentinel2')?.attribution);
      names.push(provider?.attribution);
    }
    if (view.peaksOn && view.peaks.length) names.push(...view.peaksCredits.map((credit) => credit.attribution));
    const resolution = view.panorama?.resolution ? `${view.panorama.resolution} m relief` : '';
    return [...names, resolution].filter(Boolean).join(' · ');
  });
  const aspect = $derived(overlay.aspect || (frame.width && frame.height ? frame.width / frame.height : 4 / 3));
  /** The frame in the photo's shape while one is laid, letterboxed in the room there is. */
  const boxed = $derived(overlay.source && overlay.aspect ? fitFrame(overlay.aspect, slot) : null);

  // -- the photo laid over the view ------------------------------------------------

  /**
   * The terrain's skyline at an azimuth, from the turn the app marched: as it
   * stands within the reach the trace is read against, unless told another.
   */
  const skyline = (azimuth, reach = overlay.reach) => skylineBetween(view.panorama, azimuth, reach);
  const traceCamera = $derived({ ...view.camera, width: frame.width, height: frame.height });
  // the trace as it shows on the straightened photo, which is what meets the terrain
  const samples = $derived(overlay.traceShown && frame.width ? traceSamples(overlay.strokesSeen, frame) : []);
  const gap = $derived(samples.length && view.panorama ? traceGap(samples, traceCamera, skyline) : null);

  /** The places the last whole-turn search found, while the eye and the trace are the ones it read. */
  let search = $state.raw(null);
  const searched = $derived(
    search && search.panorama === view.panorama && search.strokes === overlay.strokesSeen ? search : null
  );
  let fitting = $state(false);

  /**
   * Find the trace on the whole turn and turn the view onto it; the lens stays
   * the photo's when it said one. A trace too flat to search, a turn that is
   * not whole or an app that does not answer is fitted from where the analyst
   * left it. The toast says what changed and takes it back.
   */
  async function fit() {
    if (overlay.locked || fitting) return;
    if (!gap) {
      toast('Trace more of the skyline first', 'warn');
      return;
    }
    const lens = !overlay.lens;
    const camera = traceCamera;
    const looked = view.camera;
    const traced = samples;
    const panorama = view.panorama;
    const strokes = overlay.strokesSeen;
    const before = gap;
    const told = overlay.hints;
    // how far the photo sees: left to Fit, every cut is tried; set, that cut alone is the turn
    const reach = told.reach === 'auto' ? 'auto' : overlay.reach;
    const body = matchRequest(traced, camera, panorama, {
      known: !lens,
      reach,
      autoReach: AUTO_REACH,
      ...searchHints(told, { lensKnown: !lens }),
    });
    let found = null;
    if (body) {
      fitting = true;
      try {
        found = await api.post('/api/horizon/match', body);
      } catch {
        found = null;
      } finally {
        fitting = false;
      }
      // the view, the eye or the trace moved meanwhile: the answer is for another view
      if (view.camera !== looked || view.panorama !== panorama || overlay.strokesSeen !== strokes) return;
    }
    if (!found || found.verdict === 'flat') {
      fitFromHere(traced, camera, before, { lens, flat: found?.verdict === 'flat' });
      return;
    }
    const places = searchedPlaces(found, traced, camera, skyline, { lens });
    search = { panorama, strokes, verdict: found.verdict, places };
    const outcome = searchOutcome(found, places, camera, { lens, before, facing: Boolean(told.facing) });
    // staying put, the view still reads the trace against the reach the place lies on
    if (outcome.here >= 0) takeReach(places[outcome.here]);
    if (outcome.take >= 0) lookAtPlace(places[outcome.take], outcome.text, outcome.kind);
    else if (outcome.closest >= 0) {
      toast(outcome.text, outcome.kind, 8000, { label: 'Show the closest', onClick: () => takePlace(outcome.closest) });
    } else toast(outcome.text, outcome.kind);
  }

  /** The fit from where the analyst left the view, alone: what Fit did before it searched the turn. */
  function fitFromHere(traced, camera, before, { lens, flat }) {
    const result = fitToTrace(traced, camera, skyline, { lens });
    if (!result) {
      toast('Trace more of the skyline first', 'warn');
      return;
    }
    if (!result.improved) {
      if (flat) toast('The trace is too flat to search the whole turn', 'warn');
      else toast('The view is already as close to the trace as a fit gets');
      return;
    }
    const gaps = `gap ${gapDegrees(before)}° to ${gapDegrees(result.gap)}°`;
    if (flat) lookAtPlace(result, `Fitted near where you left it, ${gaps}. The trace is too flat to search the whole turn`, 'warn');
    else lookAtPlace(result, `Fitted to the trace: ${gaps}`);
  }

  /**
   * Turn the view to a place, with a toast that takes it back. A place found on
   * a cut of the turn is read against that cut from then on, while how far the
   * photo sees is left to Fit.
   */
  function lookAtPlace(place, text, kind = 'ok') {
    const { heading, tilt, roll, fov } = view.camera;
    const reachBefore = overlay.reachFound;
    takeReach(place);
    view.look(lensOf(place.camera));
    toast(text, kind, 8000, {
      label: 'Undo',
      onClick: () => {
        overlay.setReachFound(reachBefore);
        view.look({ heading, tilt, roll, fov });
      },
    });
  }

  function takeReach(place) {
    if (overlay.hints.reach === 'auto' && 'reach' in place) overlay.setReachFound(place.reach);
  }

  /** One of the places the search found, from the band's buttons or a toast. */
  function takePlace(index) {
    const place = searched?.places[index];
    if (!place || overlay.locked) return;
    takeReach(place);
    view.look(lensOf(place.camera));
  }

  const lensOf = ({ heading, tilt, roll, fov }) => ({ heading, tilt, roll, fov });

  /** The skyline found in the photo, laid as the trace; the toast takes it back. */
  function detect() {
    const result = overlay.detectSkyline();
    if (result.error) toast(result.error, 'warn');
    else if (!result.found) toast('No clear skyline in this photo', 'warn');
    else toast('Skyline found: rub out what is not the ridge', 'ok', 8000, { label: 'Undo', onClick: () => overlay.undoStroke() });
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

  // -- the inspector's width ------------------------------------------------------

  const SIDE_KEY_STEP = 16;

  function setSideWidth(w) {
    sideW = inspectorWidth.clampWidth(w, window.innerWidth);
  }

  function startSideResize(event) {
    if (event.button !== 0) return;
    event.preventDefault(); // don't start a text selection under the cursor
    // held by the handle, so the view under the pointer reads no hover on the way
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startW = sideW;
    let wanted = startW;
    let pending = 0;
    sideResizing = true;
    // dragging left (a smaller clientX) widens the inspector: it grows into the view
    const move = (ev) => {
      wanted = startW + startX - ev.clientX;
      // the view and the small map redraw for the new size once a frame, not once an event
      if (!pending) {
        pending = requestAnimationFrame(() => {
          pending = 0;
          setSideWidth(wanted);
        });
      }
    };
    const up = () => {
      if (pending) cancelAnimationFrame(pending);
      setSideWidth(wanted);
      sideResizing = false;
      inspectorWidth.saveWidth(sideW); // one write per drag, not one per frame
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function onSideResizeKey(event) {
    const step = { ArrowLeft: SIDE_KEY_STEP, ArrowRight: -SIDE_KEY_STEP }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    event.stopPropagation(); // the arrows walk the view otherwise
    setSideWidth(sideW + step);
    inspectorWidth.saveWidth(sideW);
  }

  function resetSideWidth() {
    setSideWidth(inspectorWidth.DEFAULT_W);
    inspectorWidth.saveWidth(sideW);
  }

  // A width dragged out on a wide screen would eat a narrower window whole, so
  // re-clamp against the viewport as it changes. The clamped-down value is not
  // written back: what the user chose is what a later session restores.
  $effect(() => {
    const onWindowResize = () => setSideWidth(sideW);
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  });
</script>

<svelte:window onkeydown={onKey} />

<div
  class="horizon-tool {layout}"
  class:folded
  class:swapped
  class:resizing={sideResizing}
  style:--hz-side="{sideW}px"
  style:--hz-map-h="{mapH}px"
>
  <div class="hz-main">
    <header class="tool-header hz-head">
      {#if layout === 'looking'}
        <!-- the view's name, read as a title until it is clicked; where the eye stands is in its tooltip -->
        <div class="hz-title">
          <span class="hz-eye" aria-hidden="true"></span>
          <input
            class="hz-name"
            bind:value={viewTitle}
            placeholder={views.suggested}
            maxlength="200"
            spellcheck="false"
            style:width="{Math.min(36, Math.max(10, (viewTitle || views.suggested).length + 1))}ch"
            aria-label="View name"
            title="{views.current ? 'Rename this view: Save keeps the new name' : 'Name this view'} · stands at {title}"
            onkeydown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
                saveView();
              } else if (event.key === 'Escape') {
                event.stopPropagation();
                viewTitle = views.current?.title ?? '';
                event.currentTarget.blur();
              }
            }}
          />
          {#if views.current && unsaved}
            <span class="hz-unsaved" role="img" aria-label="Unsaved changes" title="Changes not saved yet"></span>
          {/if}
          <button
            type="button"
            class="btn btn-ghost btn-sm hz-close"
            onclick={closeView}
            title="Close this view and pick another viewpoint"
            aria-label="Close the view"
          >
            <Icon name="x" size={13} />
          </button>
        </div>
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
          class="btn btn-primary btn-sm hz-act"
          onclick={() => (photoDialog = true)}
          title="Lay a photo or video over the view to match it"
          aria-label="Add a photo or video"
        >
          <Icon name="image" size={14} /><span class="hz-act-label">Add a photo or video</span>
        </button>
      {/if}
      {#if caseState.current && layout !== 'moving'}
        <ViewsMenu
          {views}
          caseId={caseState.current.id}
          {unsaved}
          onopen={openView}
          onnew={layout === 'looking' ? newView : null}
          onrevert={layout === 'looking' ? () => openView(views.current?.name) : null}
        />
      {/if}
      {#if layout === 'looking'}
        <CaptureMenu busy={captureBusy} oncapture={captureView} />
        <ExportMenu
          photo={Boolean(overlay.source)}
          saved={Boolean(views.current)}
          traced={Boolean(overlay.source && overlay.strokes.length)}
          busy={exportBusy}
          earth={earthLink}
          onexport={exportView}
          onproof={sendToProof}
        />
        <button
          type="button"
          class="btn btn-sm hz-act"
          onclick={saveView}
          disabled={Boolean(saveBlocked) || views.busy || !unsaved}
          title={saveBlocked || (unsaved ? 'Keep this view in the case (Ctrl+S)' : 'Saved')}
          aria-label="Save the view"
        >
          <Icon name="save" size={13} /><span class="hz-act-label">Save</span>
        </button>
      {/if}
      {#if layout === 'moving'}
        <button type="button" class="btn btn-sm" onclick={cancelMove}>Cancel</button>
      {:else if layout === 'looking'}
        <button
          type="button"
          class="btn btn-ghost btn-sm fold"
          onclick={() => {
            folded = !folded;
            mapLarge = false;
          }}
          aria-expanded={!folded}
          title={folded ? 'Show the map and settings' : 'Hide the map and settings'}
          aria-label={folded ? 'Show the map and settings' : 'Hide the map and settings'}
        >
          <Icon name={folded ? 'chevronLeft' : 'chevronRight'} size={15} />
        </button>
      {/if}
    </header>

    <div class="hz-stage dark-surface">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="view-area" ondragover={onDragOver} ondragleave={() => (dropping = false)} ondrop={onDrop}>
        {#if overlay.source && layout === 'looking' && !swapped}
          <OverlayBar
            {overlay}
            {gap}
            {view}
            {copernicus}
            onsetup={() => (copernicusHelp = true)}
            onchange={() => (photoDialog = true)}
            onfit={fit}
            {fitting}
            heading={view.camera.heading}
            places={searched && searched.verdict !== 'match' ? searched.places : []}
            onplace={takePlace}
            ondetect={detect}
          />
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
              bind:this={viewPane}
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
        {#if overlay.source?.kind === 'video' && layout === 'looking' && !swapped}
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
        {/if}
      </div>
      <!-- under the view, by its heading: the strip's lit field is the span the ruler above it reads -->
      {#if !swapped}
        <HorizonStrip {view} {frame} {bodies} locked={Boolean(overlay.source && overlay.locked)} loupe={seenLoupe} />
      {/if}
      {#if swapped}
        <!-- the view waits in the map's corner, live: a click brings it back -->
        <button type="button" class="hz-back" onclick={() => (mapLarge = false)} title="Back to the view (Esc)">
          <span class="hz-back-tag"><Icon name="maximize" size={12} />Back to the view</span>
        </button>
      {/if}
    </div>
  </div>

  {#if layout !== 'picking' && !folded}
    <!-- a <button> rather than a bare div: the handle must be focusable and
         keyboard-driven (arrows resize), and the element carries that for free -->
    <button
      type="button"
      class="hz-resizer"
      aria-label="Resize the map and settings"
      title="Drag to resize · double-click to reset"
      onpointerdown={startSideResize}
      ondblclick={resetSideWidth}
      onkeydown={onSideResizeKey}
    ></button>
  {/if}

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
        {overlays}
        home={mapView}
        resetToHome={false}
        chrome={false}
        imperial={prefs.units === 'imperial'}
        armed={layout === 'looking' ? 'measuring' : 'selecting'}
        controlsTop={layout === 'looking' ? 10 : 60}
        onclick={onMapClick}
        oncontextmenu={onMapContextMenu}
        onusage={() => imagery.refreshUsage()}
        onviewsettled={(camera) => {
          if (layout === 'picking') share.settled(camera, engine?.maxZoom());
        }}
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
        {#if mapLayers.saved && caseState.current}
          <SavedOverlay
            engine={ready ? engine : null}
            items={savedItems}
            caseId={caseState.current.id}
            coords={(item) => fmtCoords(item.lat, item.lon)}
            onopen={flyToSaved}
            onrefresh={reloadCase}
          />
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
      <!-- the layers from the first look at the map, before any eye: they say where one is -->
      <div class="hz-map-tools">
        <button
          type="button"
          class="hz-map-btn"
          class:on={layersOpen}
          aria-expanded={layersOpen}
          aria-controls="hz-map-layers"
          onclick={() => (layersOpen = !layersOpen)}
          title="Base map and layers"
          aria-label="Map layers"
        >
          <Icon name="layers" size={14} />
        </button>
        {#if layout === 'looking'}
          <button
            type="button"
            class="hz-map-btn"
            onclick={() => {
              mapLarge = !mapLarge;
              layersOpen = false;
            }}
            title={swapped ? 'Back to the view (Esc)' : 'Enlarge the map, the view in its corner'}
            aria-label={swapped ? 'Back to the view' : 'Enlarge the map'}
          >
            <Icon name={swapped ? 'minimize' : 'maximize'} size={14} />
          </button>
        {/if}
      </div>
      {#if away && layout === 'looking'}
        <button
          type="button"
          class="hz-away"
          onclick={moveThere}
          title="Open the large map there, then click where to stand"
        >
          <span>Other maps: {formatDistance(away.metres, prefs.units)} away</span><strong>Move there</strong>
        </button>
      {/if}
      {#if layersOpen}
        <div class="hz-layers" id="hz-map-layers" role="dialog" aria-label="Base map and layers">
          <div class="hz-bases" role="group" aria-label="Base map">
            {#each bases as base (base.id)}
              <button
                type="button"
                class:on={providerId === base.id}
                aria-pressed={providerId === base.id}
                title={base.title}
                onclick={() => (providerId = base.id)}>{base.label}</button
              >
            {/each}
          </div>
          <MapLayers rows={layerRows} />
        </div>
      {/if}
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

{#if discarding}
  <ConfirmDialog
    title="Discard unsaved changes?"
    message={discarding.revert
      ? `This view goes back to the version saved as “${discarding.name}”.`
      : views.current
        ? `The changes to “${views.current.title}” have not been saved.`
        : 'The view on screen and the work on its photo have not been saved.'}
    confirmLabel="Discard changes"
    icon="horizon"
    onconfirm={() => (discarding.close ? leaveView() : showView(discarding.name))}
    oncancel={() => (discarding = null)}
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
    grid-template-columns: minmax(0, 1fr) var(--hz-side);
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
  .hz-title {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .hz-name {
    min-width: 0;
    max-width: 100%;
    padding: 3px 6px;
    margin-left: -6px;
    border: 1px solid transparent;
    border-radius: var(--r-sm);
    background: none;
    color: var(--text-1);
    font: inherit;
    font-size: var(--fs-md);
    font-weight: 600;
    text-overflow: ellipsis;
  }
  .hz-name::placeholder {
    color: var(--text-1);
    font-weight: 500;
  }
  .hz-name:hover {
    border-color: var(--border);
  }
  .hz-name:focus {
    outline: none;
    border-color: var(--border-strong);
    background: var(--bg-2);
  }
  .hz-name:focus::placeholder {
    color: var(--text-3);
  }
  .hz-close {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
  }
  /* the open view has changes Save would keep */
  .hz-unsaved {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
  }
  /* the eye as the map draws it: an amber dot in a light ring */
  .hz-eye {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--text-1) 85%, transparent);
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
  /* the grab strip on the inspector's left edge, over the map as well as the settings */
  .hz-resizer {
    position: absolute;
    top: 0;
    right: calc(var(--hz-side) - 3px);
    bottom: 0;
    z-index: 4;
    width: 5px;
    padding: 0;
    border: none;
    background: transparent;
    cursor: col-resize;
    transition: background 0.12s;
  }
  .hz-resizer:hover,
  .hz-resizer:focus-visible,
  .resizing .hz-resizer {
    background: var(--accent);
    outline: none;
  }
  /* a drag reads as one gesture: no text selection on the way */
  .horizon-tool.resizing {
    cursor: col-resize;
    user-select: none;
  }
  .hz-inspector {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-left: 1px solid var(--border);
    background: var(--bg-1);
  }
  .hz-slot {
    flex: 0 0 var(--hz-map-h);
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
    inset: 40px var(--hz-side) 0 0;
  }
  .looking .hz-map {
    top: 0;
    right: 0;
    width: var(--hz-side);
    height: var(--hz-map-h);
    border-left: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }
  .looking.folded .hz-map {
    display: none;
  }
  /* the small map zooms with the wheel: its buttons would cover the ground round the eye */
  .looking:not(.swapped) .hz-map :global(.maplibregl-ctrl-top-left) {
    display: none;
  }
  /* traded places: the map fills the main area under the header, the view waits in its corner */
  .looking.swapped .hz-map {
    top: 40px;
    right: var(--hz-side);
    bottom: 0;
    left: 0;
    width: auto;
    height: auto;
    border-left: none;
    border-bottom: none;
  }
  /* placed against the tool itself: the inspector's top, where the small map was */
  .looking.swapped .hz-stage {
    position: absolute;
    top: 0;
    right: 0;
    z-index: 3;
    width: var(--hz-side);
    height: var(--hz-map-h);
    border-left: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }
  .looking.swapped .hz-stage :global(:is(.controls, .hint, .scale, .credits, .loupe, .away, .warp-corner, .caret-row)) {
    display: none;
  }
  .hz-back {
    position: absolute;
    inset: 0;
    z-index: 10;
    display: flex;
    align-items: flex-end;
    padding: 8px;
    border: none;
    background: transparent;
    cursor: pointer;
  }
  .hz-back-tag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    border-radius: var(--r-md);
    background: var(--hz-glass);
    box-shadow: 0 0 0 1px var(--border);
    color: var(--text-1);
    font-size: var(--fs-xs);
  }
  .hz-back:hover .hz-back-tag,
  .hz-back:focus-visible .hz-back-tag {
    background: var(--accent);
    color: var(--accent-text);
  }
  .hz-back:focus-visible {
    outline: none;
  }
  .hz-map-tools {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 700;
    display: flex;
    gap: 4px;
  }
  /* the other maps look elsewhere: a quiet offer at the foot of the map */
  .hz-away {
    position: absolute;
    left: 8px;
    bottom: 8px;
    z-index: 700;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: calc(100% - 16px);
    padding: 4px 9px;
    border: none;
    border-radius: var(--r-md);
    background: color-mix(in srgb, var(--bg-1) 90%, transparent);
    box-shadow: 0 0 0 1px var(--border);
    color: var(--text-2);
    font-size: var(--fs-xs);
    white-space: nowrap;
    cursor: pointer;
  }
  .hz-away span {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hz-away strong {
    color: var(--accent);
    font-weight: 600;
  }
  .hz-away:hover strong {
    text-decoration: underline;
  }
  .hz-map-btn {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--r-md);
    background: color-mix(in srgb, var(--bg-1) 88%, transparent);
    box-shadow: 0 0 0 1px var(--border);
    color: var(--text-1);
    cursor: pointer;
  }
  .hz-map-btn:hover,
  .hz-map-btn.on {
    color: var(--accent);
  }
  .hz-map-btn:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .hz-layers {
    position: absolute;
    top: 42px;
    right: 8px;
    z-index: 701;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 236px;
    padding: 10px;
    border-radius: var(--r-md);
    background: var(--bg-1);
    box-shadow:
      0 0 0 1px var(--border),
      0 8px 24px rgba(0, 0, 0, 0.35);
    font-size: var(--fs-xs);
  }
  .hz-bases {
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: var(--r-md);
    background: var(--bg-0);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .hz-bases button {
    flex: 1;
    min-height: 24px;
    padding: 0 6px;
    border-radius: var(--r-sm);
    color: var(--text-2);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .hz-bases button:hover {
    color: var(--text-1);
  }
  .hz-bases button.on {
    color: var(--accent);
    background: var(--accent-soft);
  }
  /* the small map's credits hold one line beside its scale bar, the whole of them under the pointer */
  .looking:not(.swapped) .hz-map :global(.maplibregl-ctrl-attrib) {
    max-width: 210px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    text-align: right;
    line-height: 1.25;
  }
  .looking:not(.swapped) .hz-map :global(.maplibregl-ctrl-attrib:hover) {
    max-width: 320px;
    white-space: normal;
  }
  .hz-search {
    position: absolute;
    top: 10px;
    left: 10px;
    z-index: 660;
    width: min(380px, calc(100% - 20px));
  }
</style>
