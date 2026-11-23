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
   *
   * The same map checks a point before a save or a post (`check`). A point the
   * imagery proposed is the middle of a capture until somebody looks, so the
   * composer walks each one through here and the analyst either moves the pin or
   * says the point is right.
   *
   * The leads of the scene the proof takes up (`leads`), dropped on the map while it was
   * geolocated, are drawn and listed beside it: a press puts the point on one.
   */
  import { onMount, untrack } from 'svelte';
  import Modal from '../../components/Modal.svelte';
  import Icon from '../../components/Icon.svelte';
  import TurnGuide from '../../components/TurnGuide.svelte';
  import MapSurface from '../satellite/MapSurface.svelte';
  import MapLayers from '../satellite/MapLayers.svelte';
  import { createImageryState, FALLBACK_PROVIDER } from '../satellite/state/imagery.svelte.js';
  import { createSurface } from '../../lib/map/surface.js';
  import { turnFromKey, turnFromPress } from '../../lib/map/gestures.js';
  import { markerGeometry, markerSvg } from '../../lib/mapMarkers.js';
  import { LEAD_GEOMETRY, leadSvg } from '../satellite/state/drop.svelte.js';
  // The reference layers, named where they are already named for a reader
  // (`lib/map/compare.js`): the same seven key-less overlays, the same words.
  import { layerInfo, LAYERS } from '../../lib/map/layerCatalog.js';
  import { api } from '../../lib/api.js';
  import { formatCoords } from '../../lib/coords.js';
  import { prefs } from '../../lib/state.svelte.js';

  let {
    /** Where the map opens, `{ lat, lon, zoom }`. The pin starts on it. */
    view,
    /** The point chosen, `{ lat, lon }`. The dialog closes itself after, unless it
     *  is checking: then the caller moves on to the next point. */
    onpick,
    onclose,
    /** The leads of the scene the proof takes up, `{ id, n, lat, lon }` each, and their colour. */
    leads = [],
    leadColor = null,
    /** `{ step, label }` when checking a point before a save or a post. */
    check = null,
    /** Checking before a save only: save now, leaving the point unchecked. */
    onlater = null,
  } = $props();

  const PIN = 'point';
  /** The reference layers; the roads and the place names read wrongly over a street
   *  basemap, which draws its own (`imageryOnly`). */
  const REFERENCE = LAYERS.filter((layer) => layer.group === 'reference');

  const imagery = createImageryState({ api });
  let providerId = $state(FALLBACK_PROVIDER);
  let engine = $state(null);
  let element = $state(null);
  let ready = $state(false);
  let rotating = $state(null); // the grabbed point while the map turns
  // Where the pin starts: the opening camera, read once. The dialog is opened on
  // one row and closed on it, so a later view would be a different question.
  let at = $state(untrack(() => ({ lat: view.lat, lon: view.lon })));
  // The borders, which are what finding a spot needs first.
  let on = $state(['boundaries']);
  let layersOpen = $state(false);
  let surface = null;

  const baseIsImagery = $derived(imagery.find(providerId)?.imagery ?? true);
  const usable = $derived(on.filter((id) => baseIsImagery || !layerInfo(id)?.imageryOnly));
  const reading = $derived(formatCoords(at.lat, at.lon, prefs.coordFormat));
  const layerRows = $derived(
    REFERENCE.map((layer) => ({
      id: layer.id,
      label: layer.label,
      title: layer.imageryOnly && !baseIsImagery ? 'Only useful over satellite imagery' : layer.title,
      on: on.includes(layer.id),
      disabled: layer.imageryOnly && !baseIsImagery,
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
  /** Put the point on a lead, the map going there. */
  function takeLead(lead) {
    at = { lat: lead.lat, lon: lead.lon };
    engine?.setView?.(at, Math.max(engine.getZoom?.() ?? 16, 16));
  }
  const onLead = (lead) => Math.abs(at.lat - lead.lat) < 1e-9 && Math.abs(at.lon - lead.lon) < 1e-9;

  $effect(() => {
    if (!ready || !engine) return;
    const layer = createSurface(engine);
    const { size, anchor } = markerGeometry('pin');
    const marks = leads.map((lead) => ({
      id: `lead-${lead.id}`,
      kind: 'marker',
      at: { lat: lead.lat, lon: lead.lon },
      className: 'point-lead',
      html: leadSvg(lead.n, leadColor ?? '#e5484d'),
      size: LEAD_GEOMETRY.size,
      anchor: LEAD_GEOMETRY.anchor,
      title: `Lead ${lead.n}: put the point here`,
      zIndex: 560,
      onClick: () => takeLead(lead),
    }));
    layer.set([
      ...marks,
      {
        id: PIN,
        kind: 'marker',
        at: untrack(() => at),
        className: 'point-mark',
        html: markerSvg('pin'),
        size,
        anchor,
        draggable: true,
        zIndex: 570,
        onDrag: (moved) => (at = moved),
      },
    ]);
    surface = layer;
    return () => {
      layer.destroy();
      surface = null;
    };
  });

  // The same turn as every other map: a middle-drag, or Shift and the left
  // button, about the grabbed point; Shift and an arrow from the keyboard.
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

  // Read before the guard: behind `surface?.` the position would never be read
  // at all while the map is still being built, and the pin would then stop
  // following anything.
  $effect(() => {
    const moved = at;
    surface?.patch(PIN, { at: moved });
  });
</script>

<svelte:window onkeydown={(event) => turnFromKey(engine, event)} />

<Modal title={check ? (check.step ? `Check point ${check.step}` : 'Check the point') : 'Move the point'} {onclose} width="900px">
  {#if check}
    <p class="check">
      {#if check.label}<strong>{check.label}</strong>{/if}
      <span>Taken from the imagery. Put the pin on what the proof shows, or keep it if it is right.</span>
    </p>
  {/if}
  <div class="body">
  <div class="stage">
    <MapSurface
      bind:engine
      bind:element
      bind:ready
      bind:providerId
      {imagery}
      home={view}
      overlays={usable}
      imperial={prefs.units === 'imperial'}
      controlsTop={8}
      onclick={(clicked) => (at = clicked)}
    />
    {#if rotating}
      <TurnGuide x={rotating.x} y={rotating.y} />
    {/if}
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

  {#if leads.length}
    <aside class="leads" aria-label="Leads">
      <h4>Leads</h4>
      <p class="leads-note">Dropped while the scene was geolocated. Press one to put the point on it.</p>
      <ul>
        {#each leads as lead (lead.id)}
          <li>
            <button type="button" class:on={onLead(lead)} onclick={() => takeLead(lead)} title={`Put the point on lead ${lead.n}`}>
              <span class="num" style:--lead={leadColor ?? '#e5484d'}>{lead.n}</span>
              <span class="mono">{formatCoords(lead.lat, lead.lon, prefs.coordFormat)}</span>
            </button>
          </li>
        {/each}
      </ul>
    </aside>
  {/if}
  </div>
  <div class="foot">
    <span class="hint">Click the map to move the pin.</span>
    <span class="reading mono">{reading}</span>
    {#if onlater}
      <button class="btn btn-ghost btn-sm" title="Save now and keep the point off the case map" onclick={onlater}>Later</button>
    {/if}
    <button class="btn btn-ghost btn-sm" onclick={onclose}>Cancel</button>
    <button
      class="btn btn-ok btn-sm"
      onclick={() => {
        onpick(at);
        if (!check) onclose();
      }}>Use this point</button
    >
  </div>
</Modal>

<style>
  .check {
    display: flex;
    gap: 8px;
    margin: 0 0 10px;
    font-size: var(--fs-sm);
    color: var(--text-2);
  }
  .check strong {
    color: var(--text-1);
  }
  .body {
    display: flex;
    gap: 10px;
  }
  .stage {
    position: relative;
    flex: 1;
    min-width: 0;
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
  .leads {
    flex: 0 0 200px;
    max-height: min(62vh, 520px);
    overflow-y: auto;
    font-size: var(--fs-sm);
  }
  .leads h4 {
    margin: 2px 0 4px;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-3);
  }
  .leads-note {
    margin: 0 0 8px;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .leads ul {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .leads button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 6px;
    border-radius: var(--r-sm);
    color: var(--text-1);
    text-align: left;
  }
  .leads button:hover {
    background: var(--bg-2);
  }
  .leads button.on {
    background: var(--accent-soft);
  }
  .leads .num {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    display: inline-grid;
    place-items: center;
    border-radius: 50%;
    background: var(--lead);
    color: #fff;
    font-size: 11px;
    font-weight: 700;
  }
  :global(.point-lead) {
    cursor: pointer;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
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
