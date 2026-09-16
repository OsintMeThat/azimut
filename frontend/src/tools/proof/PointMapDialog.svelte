<script>
  /**
   * A point, moved on the map instead of typed.
   *
   * Typing a coordinate is the one act in the composer that has no picture under
   * it: six decimals is a tenth of a metre, and nobody edits a building's corner
   * by counting digits. So the row opens the ground it names — the same map the
   * rest of the app draws (`MapSurface`), the same basemaps, the same reference
   * layers — with the pin on what the row already says, and hands the point back.
   *
   * Read-only about everything else. No capture, no save, no place: the dialog
   * exists to answer one question, and the map that owns those acts is the Map
   * tool. The camera opens where the caller says (the row's own point, else the
   * one above it) so a row added with `+` starts beside the point it belongs with
   * rather than on the empty Atlantic.
   */
  import { onMount, untrack } from 'svelte';
  import Modal from '../../components/Modal.svelte';
  import Icon from '../../components/Icon.svelte';
  import MapSurface from '../satellite/MapSurface.svelte';
  import MapLayers from '../satellite/MapLayers.svelte';
  import { createImageryState, FALLBACK_PROVIDER } from '../satellite/state/imagery.svelte.js';
  import { createSurface } from '../../lib/map/surface.js';
  import { markerGeometry, markerSvg } from '../../lib/mapMarkers.js';
  // The reference layers, named where they are already named for a reader
  // (`lib/map/compare.js`): the same seven key-less overlays, the same words.
  import { COMPARE_LAYERS } from '../../lib/map/compare.js';
  import { api } from '../../lib/api.js';
  import { formatCoords } from '../../lib/coords.js';
  import { prefs } from '../../lib/state.svelte.js';

  let {
    /** Where the map opens, `{ lat, lon, zoom }`. The pin starts on it. */
    view,
    /** The point chosen, `{ lat, lon }`. The dialog closes itself after. */
    onpick,
    onclose,
  } = $props();

  const PIN = 'point';
  /** Only these two read wrongly over a street basemap, which draws its own. */
  const IMAGERY_ONLY = new Set(['labels', 'roads']);
  const REFERENCE = COMPARE_LAYERS.filter((layer) => layer.group === 'reference');

  const imagery = createImageryState({ api });
  let providerId = $state(FALLBACK_PROVIDER);
  let engine = $state(null);
  let ready = $state(false);
  // Where the pin starts: the opening camera, read once. The dialog is opened on
  // one row and closed on it, so a later view would be a different question.
  let at = $state(untrack(() => ({ lat: view.lat, lon: view.lon })));
  let on = $state(['labels']);
  let layersOpen = $state(false);
  let surface = null;

  const baseIsImagery = $derived(imagery.find(providerId)?.imagery ?? true);
  const usable = $derived(on.filter((id) => baseIsImagery || !IMAGERY_ONLY.has(id)));
  const reading = $derived(formatCoords(at.lat, at.lon, prefs.coordFormat));
  const layerRows = $derived(
    REFERENCE.map((layer) => ({
      id: layer.id,
      label: layer.label,
      title: IMAGERY_ONLY.has(layer.id) && !baseIsImagery
        ? 'Only useful over satellite imagery'
        : layer.hint,
      on: on.includes(layer.id),
      disabled: IMAGERY_ONLY.has(layer.id) && !baseIsImagery,
      toggle: () =>
        (on = on.includes(layer.id) ? on.filter((id) => id !== layer.id) : [...on, layer.id]),
    }))
  );

  onMount(() => {
    imagery.loadProviders().catch(() => {
      /* the free basemap still draws; the chip simply has nothing to offer */
    });
    imagery.refreshUsage();
  });

  // The pin is drawn once the map is up, then moved in place: rebuilt on every
  // drag frame it would be dropped and re-added mid-gesture, which is why its
  // opening position is read untracked.
  $effect(() => {
    if (!ready || !engine) return;
    const layer = createSurface(engine);
    const { size, anchor } = markerGeometry('pin');
    layer.set([
      {
        id: PIN,
        kind: 'marker',
        at: untrack(() => at),
        className: 'point-mark',
        html: markerSvg('pin'),
        size,
        anchor,
        draggable: true,
        zIndex: 1000,
        onDrag: (moved) => (at = moved),
      },
    ]);
    surface = layer;
    return () => {
      layer.destroy();
      surface = null;
    };
  });

  // Read before the guard: behind `surface?.` the position would never be read
  // at all while the map is still being built, and the pin would then stop
  // following anything.
  $effect(() => {
    const moved = at;
    surface?.patch(PIN, { at: moved });
  });
</script>

<Modal title="Move the point" {onclose} width="900px">
  <div class="stage">
    <MapSurface
      bind:engine
      bind:ready
      bind:providerId
      {imagery}
      home={view}
      overlays={usable}
      imperial={prefs.units === 'imperial'}
      controlsTop={8}
      onclick={(clicked) => (at = clicked)}
    />
    <div class="layers" class:open={layersOpen}>
      {#if layersOpen}
        <MapLayers rows={layerRows} bind:open={layersOpen} />
      {:else}
        <button type="button" class="layers-btn" onclick={() => (layersOpen = true)}>
          <Icon name="stack" size={13} />
          <span>Layers</span>
        </button>
      {/if}
    </div>
  </div>

  <div class="foot">
    <span class="hint">Click the map to move the pin.</span>
    <span class="reading mono">{reading}</span>
    <button class="btn btn-ghost btn-sm" onclick={onclose}>Cancel</button>
    <button
      class="btn btn-ok btn-sm"
      onclick={() => {
        onpick(at);
        onclose();
      }}>Use this point</button
    >
  </div>
</Modal>

<style>
  .stage {
    position: relative;
    display: flex;
    height: min(62vh, 520px);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    overflow: hidden;
  }
  /* Under the zoom buttons, aligned with them. The right-hand corner is the
     surface's own: it stacks the basemap, the imagery date and the compass
     there, and a control of ours over that column hides whichever of them the
     map happens to be showing. */
  .layers {
    position: absolute;
    top: 76px;
    left: 12px;
    z-index: 500;
    max-height: calc(100% - 92px);
    overflow: auto;
  }
  .layers.open {
    width: 208px;
    padding: 6px 8px 8px;
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
  }
  .layers-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 9px;
    font-size: var(--fs-xs);
    color: var(--text-1);
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-top: 10px;
  }
  .hint {
    font-size: var(--fs-sm);
    color: var(--text-3);
  }
  .reading {
    margin-left: auto;
    font-size: var(--fs-sm);
    color: var(--text-1);
  }
  :global(.point-mark) {
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
  }
</style>
