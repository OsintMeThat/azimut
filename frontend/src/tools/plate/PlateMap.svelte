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
   * a Wayback release among them.
   */
  import { onMount, untrack } from 'svelte';
  import { createMapEngine } from '../../lib/map/engine.js';
  import { IMAGERY_SOURCE, createBasemaps } from '../../lib/map/basemap.js';
  import { createAddedLayer } from '../../lib/map/addedLayer.js';
  import { addedLayers } from '../../lib/map/addedLayersState.svelte.js';
  import { asOf, isTracked } from '../../lib/map/layerHistory.js';
  import { showPlain } from '../../lib/plate/plainBasemap.js';
  import { PX_PER_MM, fontFamily } from '../../lib/plate/page.js';
  import { sameView } from '../../lib/plate/geo.js';
  import { WAYBACK_ID, waybackId } from '../../lib/wayback.js';
  import { layerCell } from '../../lib/usage.js';

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
    /** The map belongs to another step than the one shown: it stays up, unseen. */
    away = false,
    /** `(view, frame)` as the map moves, and once it is up. */
    onview = null,
    /** `(handle)` once the map is drawn: `{ snapshot(ratio) }`. */
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

  function frame() {
    return { width: container?.clientWidth || width, height: container?.clientHeight || height };
  }

  function report() {
    if (!engine || settingView) return;
    const map = engine.impl;
    const centre = map.getCenter();
    onview?.({ lat: centre.lat, lon: ((centre.lng + 540) % 360) - 180, zoom: map.getZoom(), bearing: map.getBearing() }, frame());
  }

  onMount(() => {
    let gone = false;
    let teardown = null;
    build().then((cleanup) => { if (gone) cleanup?.(); else teardown = cleanup; });
    return () => { gone = true; teardown?.(); };
  });

  /** The ground's own settings, as one key: a change rebuilds the plain ground, never the map. */
  const plainKey = $derived(JSON.stringify([element.basemap, element.plain ?? {}, element.relief ?? 1, (element.overlays ?? []).includes('relief'), font]));

  function showGround(map) {
    const ground = untrack(() => element.basemap) || 'plain';
    if (ground.startsWith('plain')) {
      const plain = untrack(() => element.plain) ?? {};
      showPlain(map, { palette: ground === 'plain-dark' ? 'dark' : 'light',
        relief: untrack(() => element.overlays ?? []).includes('relief') ? untrack(() => relief) : null,
        intensity: untrack(() => element.relief) ?? 1, font: fontFamily(untrack(() => font)), ...plain });
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
        settle: false, controls: false, maxCanvasSize: [8192, 8192] });
    } catch (error) {
      console.error(error);
      failed = true;
      return null;
    }
    const map = engine.impl;
    map.jumpTo({ center: [start.lon, start.lat], zoom: start.zoom, bearing: start.bearing ?? 0 });
    map.on('move', report);
    basemaps = createBasemaps(engine);
    showGround(map);
    for (const id of untrack(() => element.overlays) ?? []) if (id !== 'relief') basemaps.setOverlay(id, true);
    applyGestures(untrack(() => interactive));
    report();
    ready = true;
    onready?.({ snapshot });
    return () => {
      ready = false;
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
    if (!map) return;
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
    if (!map || !next) return;
    // the map's own move comes back rounded as the plate keeps it: a jump there would stop the drag
    const centre = map.getCenter();
    if (sameView({ lat: centre.lat, lon: centre.lng, zoom: map.getZoom(), bearing: map.getBearing() }, next)) return;
    settingView = element.kind === 'inset';
    map.jumpTo({ center: [next.lon, next.lat], zoom: next.zoom, bearing: next.bearing ?? 0 });
    settingView = false;
    if (element.kind === 'inset') report();
  });

  // The frame's size on the page changed: the canvas follows.
  $effect(() => { void width; void height; queueMicrotask(() => { engine?.resize(); report(); }); });

  /** What one of the plate's layers draws: its features as the plate's day, weight, size, colour and dash say. */
  function features(entry, row, collection) {
    let data = collection;
    if (isTracked(row)) data = asOf(collection, time?.at ?? null, { trail: time?.trail !== false, since: time?.since ?? null, window: time?.window ?? 7 });
    const stroke = entry.stroke ?? 1;
    const icons = entry.icons ?? stroke;
    if (stroke === 1 && icons === 1 && !entry.colour && !entry.dash) return data;
    return { ...data, features: data.features.map((feature) => ({ ...feature, properties: { ...feature.properties,
      stroke_width: (feature.properties.stroke_width ?? 2) * stroke, icon_scale: (feature.properties.icon_scale ?? 1) * icons,
      ...(entry.colour ? { colour: entry.colour } : {}), ...(entry.dash ? { line_dash: entry.dash } : {}) } })) };
  }

  // The case's layers, as the plate draws them, the first listed on top.
  $effect(() => {
    const wanted = element.kind === 'map' ? element.layers ?? [] : [];
    const moment = JSON.stringify(time ?? null);
    const available = rows;
    if (!ready || !engine) return;
    untrack(() => {
      const names = new Set(wanted.map((entry) => entry.name));
      for (const [name, entry] of drawn) if (!names.has(name)) { entry.layer.destroy(); drawn.delete(name); }
      for (const entry of wanted) {
        const row = available.find((item) => item.name === entry.name);
        if (!row) continue;
        const key = JSON.stringify([row.sha256, entry.stroke ?? 1, entry.icons ?? 1, entry.colour ?? '', entry.dash ?? '',
          isTracked(row) ? moment : '', entry.hidden]);
        let held = drawn.get(entry.name);
        if (held?.key === key) continue;
        // a layer switched to tracked, or back, needs the engine layers its past is drawn on
        if (held && held.tracked !== isTracked(row)) { held.layer.destroy(); drawn.delete(entry.name); held = null; }
        const layer = held?.layer ?? createAddedLayer(engine, { editable: !!row.editable, history: isTracked(row),
          iconUrl: row.icons ? (icon) => `/api/cases/${caseId}/map-layers/${encodeURIComponent(row.name)}/icons/${icon}` : null });
        layer.interactive(false);
        drawn.set(entry.name, { layer, key, tracked: isTracked(row) });
        addedLayers.drawing(caseId, row.name).then((collection) => {
          if (drawn.get(entry.name)?.layer !== layer) return;
          layer.set(features(entry, row, collection), { categories: row.categories, hidden: entry.hidden ?? [], period: null });
          restack(wanted);
        }).catch(() => {});
      }
      restack(wanted);
    });
  });

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
   * put back. The canvas keeps its size on the page; only its resolution moves.
   */
  async function snapshot(ratio = 1) {
    const map = engine?.impl;
    if (!map) return null;
    const before = map.getPixelRatio();
    map.setPixelRatio(ratio);
    try {
      map.resize();
      const { canvas } = await engine.snapshot({ timeout: 20000 });
      return canvas;
    } finally {
      map.setPixelRatio(before);
      map.resize();
    }
  }
</script>

<div class="plate-map" class:live={interactive} class:dim={element.hidden} bind:this={container}
  style:left="{element.box[0] * PX_PER_MM}px" style:top="{element.box[1] * PX_PER_MM}px"
  style:width="{width}px" style:height="{height}px" style:opacity={element.hidden ? 0.15 : element.opacity ?? 1}
  style:visibility={away ? 'hidden' : null}>
  {#if failed}<p class="refused">This browser cannot draw the map.</p>{/if}
</div>

<style>
  .plate-map { position: absolute; overflow: hidden; background: #e9e6df; }
  .plate-map.live { outline: 2px solid var(--accent); outline-offset: 2px; z-index: 3; }
  /* The plate prints its own credits, in its credits box. */
  .plate-map :global(.maplibregl-ctrl-attrib), .plate-map :global(.maplibregl-ctrl-logo) { display: none; }
  .refused { margin: 0; padding: 12px; color: #555; font-size: 12px; }
</style>
