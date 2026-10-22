<script>
  /**
   * One map of a plate, live: its ground, the case's layers as the plate draws
   * them, and the hand that frames it.
   *
   * It is laid out at the size it has on the page (`PX_PER_MM`) and the page around
   * it is scaled to fit the window, so lines and marks weigh on the screen what they
   * weigh on the paper. The export draws it again at print resolution
   * (`snapshot`), raising the canvas's resolution, not its size.
   *
   * A tracked layer is drawn as it stood on the plate's day, with its trail and its
   * gains and losses when the plate asks (`layerHistory.asOf`). A plate draws a
   * layer's groups less the ones it hides, at its own weight, size, colour and dash.
   * The ground is the quiet plain one (its colours, roads, names and their language
   * the plate's own), or imagery shown faded, greyed or tinted as the plate says,
   * a Wayback release among them. A topographic ground traces its contour lines for
   * the view it shows, from the heights the relief is drawn with (`contours.js`).
   *
   * A map drawn in 3D stands on those heights, tilted, on the app's own globe
   * (`lib/globe`): the flat map stays under it, holding the ground's lines and the
   * case's layers, which the globe lays on its relief (`mirror.js`), and the globe
   * draws the picture, or the plain ground's colour, tints and shading, itself
   * (`globeView.js`). It can trace its ridges' crests (`ridges.js`), and reports how
   * it places a point of the ground, the heights included, so what the plate writes
   * over it lands where the ground is.
   *
   * A browser draws only so many maps at once, and takes the oldest one's drawing
   * back when another asks: a plate's map that loses it is built again where it
   * stood, once the plate is in sight, and says so when it keeps losing it.
   */
  import { onMount, untrack } from 'svelte';
  import { createMapEngine } from '../../lib/map/engine.js';
  import { IMAGERY_SOURCE, createBasemaps, isGround, sourceMaxZoom } from '../../lib/map/basemap.js';
  import { createGlobe } from '../../lib/globe/globe.js';
  import { createMirror } from '../../lib/globe/mirror.js';
  import { between, eased, globeCamera, globeGround, plateView } from '../../lib/plate/globeView.js';
  import { createAddedLayer } from '../../lib/map/addedLayer.js';
  import { addedLayers } from '../../lib/map/addedLayersState.svelte.js';
  import { asOf, isTracked } from '../../lib/map/layerHistory.js';
  import { groundPalette, setContours, showPlain, topographic } from '../../lib/plate/plainBasemap.js';
  import { PX_PER_MM, fontFamily } from '../../lib/plate/page.js';
  import { corners as flatCorners, sameView } from '../../lib/plate/geo.js';
  import { gridLevel, halved, heightGrid } from '../../lib/plate/heights.js';
  import { contourLines, contourStep } from '../../lib/plate/contours.js';
  import { ridgeLines } from '../../lib/plate/ridges.js';
  import { browserHeights } from '../../lib/map/reliefHeights.js';
  import { WAYBACK_ID, waybackId } from '../../lib/wayback.js';
  import { layerCell } from '../../lib/usage.js';
  import { uiState } from '../../lib/state.svelte.js';

  let {
    element,
    /** The view the map is drawn at: its own, or an inset's, worked out from the main map. */
    view,
    /** The plate's time: `{ at, trail, since }`. */
    time,
    caseId = '',
    /** The case's layer rows, by name. */
    rows = [],
    providers = [],
    relief = null,
    /** The plate's face, which the plain ground writes its names in. */
    font = 'inter',
    /** True while the hand frames this map: it pans, zooms and turns. */
    interactive = false,
    /** The map belongs to another step than the one shown: it stays up, unseen, and follows the day once the changes rest. */
    away = false,
    /** Milliseconds a new view is reached in, while the plate plays; 0 jumps there. */
    glide = 0,
    /** `(view, frame)` as the map moves, and once it is up. */
    onview = null,
    /** `(handle)` once the map is drawn: `{ snapshot(ratio), sitting(ratio) }`; a snapshot is `{ canvas, complete }`. */
    onready = null,
  } = $props();

  const width = $derived(element.box[2] * PX_PER_MM);
  const height = $derived(element.box[3] * PX_PER_MM);
  let container = $state();
  let failed = $state(false);
  /** Up and drawn once, which is what the effects below wait for. */
  let ready = $state(false);
  let engine = null;
  let basemaps = null;
  /** name → { layer, key }: a layer is redrawn when what it draws changes. */
  const drawn = new Map();
  let settingView = false;
  /** True while a transition borrows the map to draw its way (`sitting`): it reports and traces nothing. */
  let posing = false;

  /** The globe a map with relief is drawn on (lib/globe), and what lays the flat map's layers on it. */
  let globe = $state.raw(null);
  let mirror = null;
  let globeCanvas = $state();
  let marksCanvas = $state();
  /** The browser cannot draw the globe (no WebGL2): the map stays flat. */
  let globeRefused = $state(false);
  /** Takes the globe down, while it is up: before the flat map it lays the layers of. */
  let stopGlobe = null;
  /** A map standing on the heights, which the globe draws. */
  const relieved = $derived(element.kind === 'map' && (element.terrain ?? 0) > 0);
  const onGlobe = $derived(ready && relieved && !globeRefused);

  function frame() {
    return { width: container?.clientWidth || width, height: container?.clientHeight || height };
  }

  /** Whether the map stands on the heights or leans: then it places the ground itself. */
  const inThreeD = () => (untrack(() => element.terrain) ?? 0) > 0 || (engine?.impl?.getPitch?.() ?? 0) > 0.5;

  /** Where the camera stands now, as a plate keeps a view: the globe's while it draws the map. */
  function cameraOf(map = engine?.impl) {
    if (globe) return plateView(globe.camera(), globe.exactZoom());
    const centre = map.getCenter();
    return { lat: centre.lat, lon: ((centre.lng + 540) % 360) - 180, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
  }

  function report() {
    if (!engine || settingView || posing) return;
    const map = engine.impl;
    onview?.(cameraOf(map), frame(), inThreeD() ? projector(map) : null);
  }

  /** How this map places the ground on its frame, and back, through its own camera and heights. */
  function projector(map) {
    if (globe) {
      const drawn = globe;
      return {
        project: ([lon, lat]) => { const at = drawn.latLngToContainerPoint({ lat, lon }); return [at.x, at.y]; },
        // the sky has no ground under it: a point there is read as the middle of the view
        unproject: ([x, y]) => { const at = drawn.containerPointToLatLng({ x, y }) ?? drawn.camera(); return [((at.lon + 540) % 360) - 180, at.lat]; },
      };
    }
    return {
      project: ([lon, lat]) => { const point = map.project([lon, lat]); return [point.x, point.y]; },
      unproject: ([x, y]) => { const at = map.unproject([x, y]); return [((at.lng + 540) % 360) - 180, at.lat]; },
    };
  }

  let gone = false;
  let teardown = null;
  onMount(() => {
    start();
    return () => { gone = true; clearTimeout(redrawTimer); teardown?.(); teardown = null; };
  });
  function start() {
    build().then((cleanup) => { if (gone) cleanup?.(); else teardown = cleanup; });
  }

  // -- the drawing taken back ----------------------------------------------------------

  /** The browser took this map's drawing back to give it to another map. */
  let lost = $state(false);
  /** It lost it again just after being drawn again: the browser has too many maps up, and this says so. */
  let crowded = $state(false);
  let redrawnAt = 0;
  let redrawTimer = null;
  function onLost() { lost = true; }
  // drawn again where it stood, once the plate is in sight; not in a loop when the browser keeps taking it
  $effect(() => {
    if (!lost || uiState.tool !== 'plate') return;
    untrack(() => {
      clearTimeout(redrawTimer);
      if (Date.now() - redrawnAt < 5000) { crowded = true; return; }
      redrawTimer = setTimeout(redraw, 300);
    });
  });
  function redraw() {
    if (gone) return;
    redrawnAt = Date.now();
    teardown?.();
    teardown = null;
    lost = false;
    crowded = false;
    lastPlain = '';
    laid = new Set();
    traced = '';
    start();
  }

  /** The ground's own settings, as one key: a change rebuilds the plain ground, never the map. */
  const plainKey = $derived(JSON.stringify([element.basemap, element.plain ?? {}, element.relief ?? 1, (element.overlays ?? []).includes('relief'), font]));

  function showGround(map) {
    const ground = untrack(() => element.basemap) || 'plain';
    if (ground.startsWith('plain')) {
      const plain = untrack(() => element.plain) ?? {};
      const shaded = untrack(() => element.overlays ?? []).includes('relief');
      // a topographic ground reads the heights for its tints whether or not it is shaded
      showPlain(map, { palette: groundPalette(ground), relief: shaded || topographic(ground) ? untrack(() => relief) : null, shade: shaded,
        intensity: untrack(() => element.relief) ?? 1, font: fontFamily(untrack(() => font)), ...plain });
      traced = '';
      traceSoon();
      return;
    }
    const provider = untrack(() => providers).find((entry) => entry.id === ground) ?? null;
    if (!provider) return;
    const id = ground === WAYBACK_ID ? waybackId(ground, untrack(() => element.release)) : provider.id;
    basemaps.show(provider, id, layerCell(provider, Math.round(map.getZoom() + 1)));
  }

  async function build() {
    const start = untrack(() => view);
    try {
      engine = await createMapEngine(container, { view: { lat: start.lat, lon: start.lon, zoom: start.zoom + 1 },
        settle: false, controls: false, maxCanvasSize: [8192, 8192], fade: false });
    } catch (error) {
      console.error(error);
      failed = true;
      return null;
    }
    const map = engine.impl;
    map.on('webglcontextlost', onLost);
    map.on('webglcontextrestored', () => { lost = false; });
    // a plate's map may lean, which the app's other maps only do over their relief
    map.setMaxPitch?.(85);
    map.jumpTo({ center: [start.lon, start.lat], zoom: start.zoom, bearing: start.bearing ?? 0, pitch: start.pitch ?? 0 });
    map.on('move', report);
    map.on('moveend', traceSoon);
    basemaps = createBasemaps(engine);
    showGround(map);
    applyGestures(untrack(() => interactive));
    report();
    ready = true;
    onready?.({ snapshot, sitting });
    return () => {
      ready = false;
      stopGlobe?.();
      clearTimeout(traceTimer);
      clearTimeout(catchUp);
      for (const { layer } of drawn.values()) layer.destroy();
      drawn.clear();
      basemaps?.dispose();
      engine?.destroy();
      engine = null;
    };
  }

  // The plain ground's colours, roads, names or relief changed: it is laid again.
  let lastPlain = '';
  $effect(() => {
    const key = plainKey;
    if (!ready || !engine) return;
    if (!lastPlain) { lastPlain = key; return; }
    if (key === lastPlain) return;
    lastPlain = key;
    if (String(untrack(() => element.basemap)).startsWith('plain')) untrack(() => showGround(engine.impl));
  });

  // The key-less layers laid over the ground, switched one by one: the map is never built again for one,
  // which would flash and ask the browser for one more drawing context.
  let laid = new Set();
  $effect(() => {
    const wanted = new Set((element.overlays ?? []).filter((id) => id !== 'relief'));
    if (!ready || !basemaps) return;
    untrack(() => {
      for (const id of laid) if (!wanted.has(id)) basemaps.setOverlay(id, false);
      for (const id of wanted) if (!laid.has(id)) basemaps.setOverlay(id, true);
      laid = wanted;
    });
  });

  // The imagery's tone: faded, greyed, lit, contrasted, tinted, set on the ground's own layer.
  $effect(() => {
    const tone = element.tone ?? {};
    const basemap = element.basemap;
    if (!ready || !engine || String(basemap).startsWith('plain')) return;
    const map = engine.impl;
    const apply = () => {
      if (!map.getLayer(IMAGERY_SOURCE)) return false;
      map.setPaintProperty(IMAGERY_SOURCE, 'raster-opacity', tone.opacity ?? 1);
      map.setPaintProperty(IMAGERY_SOURCE, 'raster-saturation', tone.saturation ?? 0);
      map.setPaintProperty(IMAGERY_SOURCE, 'raster-brightness-max', tone.brightness ?? 1);
      map.setPaintProperty(IMAGERY_SOURCE, 'raster-contrast', tone.contrast ?? 0);
      map.setPaintProperty(IMAGERY_SOURCE, 'raster-hue-rotate', tone.hue ?? 0);
      return true;
    };
    if (!apply()) map.once('styledata', apply);
  });

  function applyGestures(on) {
    const map = engine?.impl;
    // on the globe, the globe takes the hand, and its canvas only while the map is framed
    if (!map || globe) return;
    // the hand turns a plate's map too: a right-drag or a Ctrl-drag, and two fingers
    for (const handler of [map.dragPan, map.scrollZoom, map.doubleClickZoom, map.touchZoomRotate, map.keyboard, map.dragRotate]) {
      if (on) handler?.enable?.(); else handler?.disable?.();
    }
  }
  $effect(() => { if (ready) applyGestures(interactive); });

  // A view set from outside (the inspector, an inset following its map, a drag on the page) moves the camera.
  $effect(() => {
    const next = view;
    const map = ready ? engine?.impl : null;
    void globe; // a globe come up is placed where the view says
    if (!map || !next) return;
    // the map's own move comes back rounded as the plate keeps it, its tilt included: a jump there would stop the drag
    if (sameView(cameraOf(map), next)) return;
    const camera = { center: [next.lon, next.lat], zoom: next.zoom, bearing: next.bearing ?? 0, pitch: next.pitch ?? 0 };
    // the move reports where the map went, which reads and writes the page's views: none of it is this effect's to follow
    untrack(() => {
      settingView = element.kind === 'inset';
      // played, it flies there as the video's transition does (`tween.flight`)
      if (globe) {
        if (glide > 0) flyGlobe(next, glide);
        else {
          stopFlight();
          globe.setCamera(globeCamera(next));
        }
      } else if (glide > 0) map.flyTo({ ...camera, duration: glide });
      else map.jumpTo(camera);
      settingView = false;
      if (element.kind === 'inset') report();
    });
  });

  // -- standing on the heights: the globe -------------------------------------------

  // A map with relief is drawn on the globe, laid over the flat map; flat again at 0.
  $effect(() => {
    if (!onGlobe || !globeCanvas || !marksCanvas) return;
    untrack(() => startGlobe());
    return () => stopGlobe?.();
  });

  function startGlobe() {
    const made = createGlobe(globeCanvas);
    if (!made) {
      globeRefused = true;
      return;
    }
    made.setExaggeration(element.terrain ?? 1);
    made.setCamera(globeCamera(view));
    lookOnGlobe(made);
    // the case's layers, the plain ground's lines and names, the contour lines and the
    // ridges are the flat map's; the picture is the globe's own
    mirror = createMirror(engine.impl, made, { canvas: marksCanvas, exclude: (id) => isGround(id) });
    globe = made;
    const offs = [
      made.on('view-move', report),
      made.on('view-settled', traceSoon),
      // the drawing taken back is the flat map's case too: both are built again where they stood
      made.on('lost', onLost),
    ];
    traced = '';
    report();
    traceSoon();
    stopGlobe = () => {
      stopGlobe = null;
      offs.forEach((off) => off());
      stopFlight();
      // the flat map takes the view where the globe left it, not where it stood when the globe came up
      const last = plateView(made.camera(), made.exactZoom());
      mirror?.destroy();
      mirror = null;
      globe = null;
      made.destroy();
      settingView = true;
      engine?.impl.jumpTo({ center: [last.lon, last.lat], zoom: last.zoom, bearing: last.bearing, pitch: last.pitch });
      settingView = false;
      // the mirror gave the flat map back its hand as it found it: it follows the plate's again
      applyGestures(untrack(() => interactive));
      traced = '';
      report();
      traceSoon();
    };
  }

  /** What the globe draws the ground in: the plate's picture and its tone, or its plain ground. */
  function lookOnGlobe(drawn = globe) {
    if (!drawn) return;
    const ground = untrack(() => element.basemap) || 'plain';
    drawn.setGround(globeGround(ground, { plain: untrack(() => element.plain) ?? {},
      shaded: untrack(() => element.overlays ?? []).includes('relief'), intensity: untrack(() => element.relief) ?? 1 }));
    const provider = ground.startsWith('plain') ? null : untrack(() => providers).find((entry) => entry.id === ground);
    if (!provider) {
      drawn.setImagery(null);
      drawn.setTone(null);
      return;
    }
    const id = ground === WAYBACK_ID ? waybackId(ground, untrack(() => element.release)) : provider.id;
    const cell = layerCell(provider, Math.round(cameraOf().zoom + 1));
    drawn.setImagery({ id, metered: Boolean(provider.meter), cell, deepest: sourceMaxZoom(provider, cell) });
    drawn.setTone(untrack(() => element.tone) ?? {});
  }

  // the ground, its tone or its plain look changed: the globe draws it again
  $effect(() => {
    void plainKey;
    void JSON.stringify(element.tone ?? {});
    void element.release;
    void providers;
    if (globe) untrack(() => lookOnGlobe());
  });

  // how many times as tall the heights stand
  $effect(() => {
    const height = element.terrain ?? 0;
    if (globe && height > 0) globe.setExaggeration(height);
  });

  /** A camera flight on the globe to `target` over `ms`, as the flat map's `flyTo`; stopped by the next. */
  let flight = 0;
  function stopFlight() {
    if (flight) cancelAnimationFrame(flight);
    flight = 0;
  }
  function flyGlobe(target, ms) {
    stopFlight();
    const from = cameraOf();
    // the ground's height under the way is the start's until the landing reads its own,
    // so a flight asks the app for no height at every frame
    const elevation = globe?.centreElevation();
    const started = performance.now();
    const step = (now) => {
      if (!globe) return;
      const t = Math.min(1, (now - started) / ms);
      const at = globeCamera(between(from, target, eased(t)));
      globe.setCamera(t < 1 && Number.isFinite(elevation) ? { ...at, elevation } : at);
      flight = t < 1 ? requestAnimationFrame(step) : 0;
    };
    flight = requestAnimationFrame(step);
  }

  // -- contour lines and ridges, traced for the view ----------------------------------

  const RIDGES = 'plate-ridges';
  let traceTimer = null;
  /** What was traced last: the level and tiles it read, so a small move traces nothing again. */
  let traced = '';
  /** The tracing under way, which a snapshot waits for so the export carries the lines. */
  let tracing = Promise.resolve();

  /** What this map traces from the heights: the contour lines of a topographic ground, a 3D map's crests. */
  function wanted() {
    const ground = untrack(() => element.basemap) || '';
    const plain = untrack(() => element.plain) ?? {};
    return { contours: topographic(ground) && plain.contours !== false,
      ridges: element.kind === 'map' && !!untrack(() => element.ridges) && (untrack(() => element.terrain) ?? 0) > 0 };
  }
  function traceSoon() {
    if (posing) return;
    clearTimeout(traceTimer);
    traceTimer = setTimeout(() => { tracing = trace().catch(() => {}); }, 250);
  }
  // the ridges switched on or off
  $effect(() => { void element.ridges; if (ready) untrack(() => { traced = ''; traceSoon(); }); });

  /** The part of the ground the lines are traced over: what the frame shows, held near it on a leaning map. */
  function groundBox(map) {
    const camera = cameraOf(map);
    const flat = flatCorners({ lat: camera.lat, lon: camera.lon, zoom: camera.zoom, bearing: camera.bearing }, frame());
    const lons = flat.map(([lon]) => lon);
    const lats = flat.map(([, lat]) => lat);
    const [west, east, south, north] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
    const pad = camera.pitch > 0.5 ? 1.5 : 0.1;
    const near = [west - (east - west) * pad, south - (north - south) * pad, east + (east - west) * pad, north + (north - south) * pad];
    // the globe's view reaches the horizon: the lines are traced near what the frame shows, and on the map
    if (globe) return [Math.max(near[0], -180), Math.max(near[1], -85), Math.min(near[2], 180), Math.min(near[3], 85)];
    const bounds = map.getBounds();
    return [Math.max(near[0], bounds.getWest()), Math.max(near[1], bounds.getSouth()), Math.min(near[2], bounds.getEast()), Math.min(near[3], bounds.getNorth())];
  }

  async function trace() {
    const map = engine?.impl;
    const info = untrack(() => relief);
    const want = wanted();
    if (!map) return;
    if (!want.ridges && map.getSource(RIDGES)) { map.removeLayer(RIDGES); map.removeSource(RIDGES); }
    if ((!want.contours && !want.ridges) || !info?.tiles) return;
    const box = groundBox(map);
    const zoom = cameraOf(map).zoom;
    const level = gridLevel(box, zoom - 0.5, info.max_zoom);
    const key = JSON.stringify([level, box.map((value) => Math.round(value * 1e3)), want]);
    if (key === traced) return;
    traced = key;
    const grid = await heightGrid(box, level, browserHeights(info.tiles), info.tile_size);
    if (!grid || !engine || traced !== key) return;
    if (want.contours) {
      let low = Infinity;
      let high = -Infinity;
      for (const value of grid.heights) { if (value < low) low = value; if (value > high) high = value; }
      setContours(map, contourLines(grid, contourStep(zoom, low, high), { anchors: !!globe }));
    }
    if (want.ridges) {
      const lines = ridgeLines(halved(grid));
      const dark = (untrack(() => element.basemap) || '') === 'plain-dark' || !String(untrack(() => element.basemap)).startsWith('plain');
      if (map.getSource(RIDGES)) map.getSource(RIDGES).setData(lines);
      else {
        map.addSource(RIDGES, { type: 'geojson', data: lines });
        map.addLayer({ id: RIDGES, type: 'line', source: RIDGES, layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': dark ? '#f1e6d2' : '#7a1f12', 'line-opacity': 0.9,
            'line-width': ['interpolate', ['linear'], ['get', 'strength'], 0, 0.6, 1, 2.4] } });
      }
    }
  }

  // The frame's size on the page changed: the canvas follows.
  $effect(() => { void width; void height; queueMicrotask(() => { engine?.resize(); report(); }); });

  /** What one of the plate's layers draws: its features as read on the plate's day, at the plate's weight, size, colour and dash. */
  function features(entry, data) {
    const stroke = entry.stroke ?? 1;
    const icons = entry.icons ?? stroke;
    if (stroke === 1 && icons === 1 && !entry.colour && !entry.dash) return data;
    return { ...data, features: data.features.map((feature) => ({ ...feature, properties: { ...feature.properties,
      stroke_width: (feature.properties.stroke_width ?? 2) * stroke, icon_scale: (feature.properties.icon_scale ?? 1) * icons,
      ...(entry.colour ? { colour: entry.colour } : {}), ...(entry.dash ? { line_dash: entry.dash } : {}) } })) };
  }

  /** How the layers are read: the day and how much of its past, never the step, which changes none of it. */
  const reading = $derived(JSON.stringify([time?.at ?? null, time?.trail !== false, time?.since ?? null, time?.window ?? null]));
  /** The layers being handed to the engine, which a snapshot waits for. */
  let layersDrawn = Promise.resolve();
  let catchUp = null;

  // The case's layers, as the plate draws them, the first listed on top. A map
  // waiting on another step is brought up to date once the changes rest.
  $effect(() => {
    const wanted = element.kind === 'map' ? element.layers ?? [] : [];
    void JSON.stringify(wanted);
    const [at, trail, since, days] = JSON.parse(reading);
    const available = rows;
    const resting = away;
    if (!ready || !engine) return;
    clearTimeout(catchUp);
    const draw = () => untrack(() => drawLayers(wanted, available, { at, trail, since, window: days }));
    if (resting) catchUp = setTimeout(draw, 400);
    else draw();
  });

  function drawLayers(wanted, available, read) {
    if (!engine) return;
    const names = new Set(wanted.map((entry) => entry.name));
    for (const [name, held] of drawn) if (!names.has(name)) { held.layer.destroy(); drawn.delete(name); }
    const work = [];
    for (const entry of wanted) {
      const row = available.find((item) => item.name === entry.name);
      if (!row) continue;
      const tracked = isTracked(row);
      let held = drawn.get(entry.name);
      // a layer switched to tracked, or back, needs the engine layers its past is drawn on
      if (held && held.tracked !== tracked) { held.layer.destroy(); drawn.delete(entry.name); held = null; }
      if (!held) {
        const layer = createAddedLayer(engine, { editable: !!row.editable, history: tracked,
          iconUrl: row.icons ? (icon) => `/api/cases/${caseId}/map-layers/${encodeURIComponent(row.name)}/icons/${icon}` : null });
        layer.interactive(false);
        held = { layer, tracked, data: null, look: '' };
        drawn.set(entry.name, held);
      }
      const record = held;
      const look = JSON.stringify([row.sha256, entry.stroke ?? 1, entry.icons ?? 1, entry.colour ?? '', entry.dash ?? '', entry.hidden]);
      work.push(addedLayers.drawing(caseId, row.name).then((collection) => {
        if (drawn.get(entry.name) !== record) return;
        // a day where nothing of the layer moved reads the same, and the engine is spared cutting it again
        const data = tracked ? asOf(collection, read.at, read) : collection;
        if (record.data === data && record.look === look) return;
        record.data = data;
        record.look = look;
        const set = record.layer.set(features(entry, data), { categories: row.categories, hidden: entry.hidden ?? [], period: null });
        restack(wanted);
        return set;
      }).catch(() => {}));
    }
    restack(wanted);
    layersDrawn = Promise.all(work);
  }

  /** Once what was last handed to the layers is on the map, however many changes came on the way. */
  async function layersSettled() {
    let seen;
    do {
      seen = layersDrawn;
      await seen;
    } while (seen !== layersDrawn);
    await Promise.all([...drawn.values()].map(({ layer }) => layer.drawn?.()));
  }

  function restack(wanted) {
    let above = null;
    for (const entry of wanted) {
      const layer = drawn.get(entry.name)?.layer;
      if (!layer?.floor()) continue;
      if (above) layer.stackUnder(above);
      above = layer;
    }
  }

  /**
   * The map drawn again at `ratio` times its CSS size, once every tile is in, and
   * put back: `{ canvas, complete }`, `complete` false when the wait gave up with
   * tiles still loading. The canvas keeps its size on the page; only its resolution moves.
   */
  async function snapshot(ratio = 1) {
    const map = engine?.impl;
    if (!map) return null;
    // the layers as the day asked reads them, and the lines traced for this view, go out with it
    await layersSettled();
    clearTimeout(traceTimer);
    await tracing;
    await (tracing = trace().catch(() => {}));
    // on the globe, with what the flat map lays on it and the names standing there
    if (globe) return globe.snapshot({ ratio, laid: true, timeout: 20000 });
    const before = map.getPixelRatio();
    map.setPixelRatio(ratio);
    try {
      map.resize();
      return await engine.snapshot({ timeout: 20000 });
    } finally {
      map.setPixelRatio(before);
      map.resize();
    }
  }

  /**
   * The map lent to a transition at `ratio` times its CSS size: `{ at(view), end() }`.
   * `at` draws it again at a view on the way, once its tiles are in, and resolves to
   * `{ picture, placer }`: the placer, for a map in 3D, places the ground as the camera
   * stands there, until the next `at`. `end` puts the map back where it stood.
   * Meanwhile it keeps no view and traces nothing: its lines stay as they were traced,
   * so they do not change on the way.
   */
  function sitting(ratio = 1) {
    const map = engine?.impl;
    if (!map) return null;
    const home = cameraOf(map);
    if (globe) return sittingOnGlobe(map, globe, ratio, home);
    const before = map.getPixelRatio();
    clearTimeout(traceTimer);
    posing = true;
    map.setPixelRatio(ratio);
    map.resize();
    const jump = (view) => map.jumpTo({ center: [view.lon, view.lat], zoom: view.zoom, bearing: view.bearing ?? 0, pitch: view.pitch ?? 0 });
    // each frame of the way is drawn on the picture of the one before, which is read by then
    let picture = null;
    return {
      async at(view) {
        jump(view);
        // the tiles of the new view are asked for when it is next drawn
        await new Promise((resolve) => { map.once('render', resolve); map.triggerRepaint(); });
        ({ canvas: picture } = await engine.snapshot({ timeout: 10000, into: picture }));
        return { picture, placer: inThreeD() ? projector(map) : null };
      },
      end() {
        if (picture) { picture.width = 0; picture.height = 0; picture = null; }
        if (!engine) return;
        map.setPixelRatio(before);
        jump(home);
        map.resize();
        posing = false;
      },
    };
  }

  /** `sitting` on the globe: each view of the way placed, drawn once in, and captured at `ratio`. */
  function sittingOnGlobe(map, drawn, ratio, home) {
    clearTimeout(traceTimer);
    stopFlight();
    posing = true;
    let picture = null;
    return {
      async at(next) {
        drawn.setCamera(globeCamera(next));
        ({ canvas: picture } = await drawn.snapshot({ ratio, laid: true, timeout: 10000, into: picture }));
        return { picture, placer: projector(map) };
      },
      end() {
        if (picture) { picture.width = 0; picture.height = 0; picture = null; }
        if (globe === drawn) drawn.setCamera(globeCamera(home));
        posing = false;
      },
    };
  }
</script>

<div class="plate-map" class:live={interactive} class:dim={element.hidden} bind:this={container}
  style:left="{element.box[0] * PX_PER_MM}px" style:top="{element.box[1] * PX_PER_MM}px"
  style:width="{width}px" style:height="{height}px" style:opacity={element.hidden ? 0.15 : element.opacity ?? 1}
  style:visibility={away ? 'hidden' : null}>
  {#if onGlobe}
    <canvas class="globe" style:pointer-events={interactive ? null : 'none'} bind:this={globeCanvas} aria-label="The map in 3D, on its relief"></canvas>
    <canvas class="globe-marks" bind:this={marksCanvas} aria-hidden="true"></canvas>
  {/if}
  {#if relieved && globeRefused}<p class="refused flat">This browser cannot draw the map in 3D: it needs WebGL2. It is drawn flat.</p>{/if}
  {#if failed}<p class="refused">This browser cannot draw the map.</p>
  {:else if crowded}<p class="refused">The browser has too many maps open to draw this one. Close another tab or tool with a map, then come back to the plate.</p>{/if}
</div>

<style>
  .plate-map { position: absolute; overflow: hidden; background: #e9e6df; }
  .plate-map.live { outline: 2px solid var(--accent); outline-offset: 2px; z-index: 3; }
  /* The plate prints its own credits, in its credits box. */
  .plate-map :global(.maplibregl-ctrl-attrib), .plate-map :global(.maplibregl-ctrl-logo) { display: none; }
  .refused { margin: 0; padding: 12px; color: #555; font-size: 12px; }
  .refused.flat { position: absolute; left: 0; right: 0; bottom: 0; z-index: 2; background: rgba(255, 255, 255, 0.85); }
  /* the globe over the flat map, which still holds the lines and layers it draws */
  .globe, .globe-marks { position: absolute; inset: 0; z-index: 1; display: block; width: 100%; height: 100%; }
  .globe { touch-action: none; user-select: none; cursor: grab; }
  .globe:active { cursor: grabbing; }
  .globe-marks { pointer-events: none; }
</style>
