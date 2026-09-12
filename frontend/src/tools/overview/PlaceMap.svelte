<script>
  /**
   * The case's saved points, on the ground they were saved from.
   *
   * A reading and nothing else: satellite imagery under the points, the wheel and
   * the drag to look around them, and no act that writes. Everything a point can be
   * worked on with — the card, the capture frame, the other basemaps, the hover tie
   * to the tree — belongs to the Map tool, and the foot of this plate is the way
   * through to it.
   *
   * **One basemap, never chosen.** The free imagery (`lib/usage.js`), which needs no
   * key and counts against no meter, so a home page cannot spend anybody's quota and
   * has no picker to explain. It is the same layer stack the Map tool draws
   * (`lib/map`), through the same façade — the plate that stood here before drew its
   * own projection, and a second projection is a second thing that can disagree with
   * the map.
   *
   * It costs tiles, which is the one thing arriving on the home page did not use to
   * do. Deliberate: without a map under them the points said "one street or three
   * countries" and nothing more.
   */
  import { onMount } from 'svelte';
  import { api } from '../../lib/api.js';
  import { createMapEngine } from '../../lib/map/engine.js';
  import { createBasemaps } from '../../lib/map/basemap.js';
  import { createSurface } from '../../lib/map/surface.js';
  import { FREE_IMAGERY, layerCell } from '../../lib/usage.js';
  import Icon from '../../components/Icon.svelte';

  let { pins = [], total = 0, imperial = false, onopen } = $props();

  /** How deep the opening frame goes. A case whose points sit on one corner would
   *  otherwise open on a rooftop, which says nothing about where the case is. */
  const FRAME_ZOOM = 15;
  /** Room left around the outermost points, so an edge one is drawn whole. */
  const FRAME_PAD = 26;
  /** The dot a saved point is drawn as. Small enough that a street's worth of them
   *  stays countable, ringed so it reads over pale sand and over dark water. */
  const DOT = { radius: 5, fillOpacity: 1, stroke: '#141414', strokeWidth: 1.5 };

  let mapEl = $state();
  let refused = $state(false);
  let engine = null;
  let layer = null;
  /** The point set the camera was last framed on, so re-reading the same case on
   *  the way back to this tab does not snatch the view back from the analyst. */
  let framed = null;

  const signature = $derived(pins.map((pin) => `${pin.id}@${pin.lat},${pin.lon}`).join('|'));

  /** A token's value, since the map is painted rather than styled. */
  function themeColour(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  /**
   * One colour for every point, whatever was saved there.
   *
   * The Map tool tells a place from a capture because it is worked on there; here
   * the points are one layer saying where the case is, and a legend nobody asked
   * for would be the only thing to read.
   */
  function dots() {
    const fill = themeColour('--accent', '#e8a33d');
    return pins.map((pin) => ({
      id: pin.id,
      kind: 'dot',
      at: { lat: pin.lat, lon: pin.lon },
      // above the cursor, so the reading never covers the dot it names
      tip: pin.title ? { text: pin.title, direction: 'top', offset: [0, -10] } : undefined,
      style: { ...DOT, fill },
    }));
  }

  function draw() {
    layer?.set(dots());
  }

  function frame() {
    if (!engine?.fitPoints(pins, { padding: FRAME_PAD, maxZoom: FRAME_ZOOM })) return;
    framed = signature;
  }

  // Svelte only honours a cleanup returned from a *synchronous* onMount, and the
  // build below has to await the engine — so the teardown is handed over late.
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
    const [first] = pins;
    try {
      engine = await createMapEngine(mapEl, {
        view: { lat: first?.lat ?? 0, lon: first?.lon ?? 0, zoom: 3 },
        imperial,
      });
    } catch (error) {
      // The map draws through WebGL and a browser can refuse it. The count below
      // is still true, so the plate says what it cannot draw rather than leaving
      // an empty panel.
      console.error(error);
      refused = true;
      return null;
    }
    layer = createSurface(engine);
    draw();
    frame();
    const basemaps = createBasemaps(engine);
    await showImagery(basemaps);
    return () => {
      basemaps.dispose();
      layer.destroy();
      engine.destroy();
      layer = null;
      engine = null;
    };
  }

  async function showImagery(basemaps) {
    let provider = null;
    try {
      const catalogue = await api.get('/api/satellite/providers');
      provider = (Array.isArray(catalogue) ? catalogue : []).find(
        (entry) => entry.id === FREE_IMAGERY
      );
    } catch {
      /* the points still read on the empty plate */
    }
    // `engine` is gone when the page was left while this was in flight
    if (!provider || !engine) return;
    // This provider does not oversample, so its grid is the same at every zoom
    // and the cell is read once.
    basemaps.show(provider, provider.id, layerCell(provider, engine.getZoom()));
  }

  // A case re-read on the way back to this tab answers with the same points, and
  // redrawing those must not move a camera the analyst put where they wanted it.
  $effect(() => {
    const points = signature;
    if (!layer) return;
    draw();
    if (points !== framed) frame();
  });
</script>

<div class="plate">
  <div class="frame">
    <div class="map" bind:this={mapEl}></div>
    {#if refused}
      <p class="refused">The map needs WebGL, which this browser does not have.</p>
    {/if}
  </div>

  <button class="foot" onclick={onopen} title="Open the map">
    <Icon name="pin" size={13} />
    <span>{total} {total === 1 ? 'point' : 'points'} on the map</span>
    {#if total > pins.length}<em>{pins.length} drawn</em>{/if}
    <span class="go"><Icon name="arrowRight" size={13} /></span>
  </button>
</div>

<style>
  .plate {
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-1);
    overflow: hidden;
  }

  .frame {
    position: relative;
    aspect-ratio: 1.7;
    min-height: 210px;
    /* the engine's own controls and its credit line stay inside this box, so a
       dialog opened over the page still lands on top of them */
    isolation: isolate;
    /* nothing is stacked over this map, so the zoom buttons take the corner they
       are built for rather than the room the Map tool's cluster needs */
    --map-controls-top: 8px;
  }
  .map {
    position: absolute;
    inset: 0;
    background: var(--bg-2);
  }

  .refused {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    margin: 0;
    padding: 0 24px;
    text-align: center;
    color: var(--text-2);
  }

  .foot {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 7px;
    padding: 8px 11px;
    border-top: 1px solid var(--border);
    font-size: var(--fs-xs);
    color: var(--text-3);
    text-align: left;
    transition: color 0.14s var(--ease);
  }
  .foot:hover,
  .foot:focus-visible {
    color: var(--text-1);
    outline: none;
  }
  .foot em {
    font-style: normal;
    opacity: 0.75;
  }
  .go {
    display: flex;
    margin-left: auto;
    opacity: 0;
    transition: opacity 0.14s var(--ease);
  }
  .foot:hover .go,
  .foot:focus-visible .go {
    opacity: 1;
  }
</style>
