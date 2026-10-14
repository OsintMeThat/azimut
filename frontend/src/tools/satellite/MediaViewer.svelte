<script>
  /**
   * One located photo or video, read in the Saved panel beside the map.
   *
   * It takes the panel rather than a card over the map: the gesture it serves is
   * holding the footage next to the imagery, and a window over the map would
   * hide the half being compared. A mark holding several files opens all of them,
   * and the arrows walk the stack.
   *
   * It plays the file, says why the file stands on this point, opens it in
   * Media or in the proofs built on it, and puts it in one of the analyst's
   * layers with the menu Geo Proof's points use (`LayerTargetSteps`). The marker
   * follows the file and starts with its notes and address.
   */
  import { tick, untrack } from 'svelte';
  import Icon from '../../components/Icon.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import LayerTargetSteps from './LayerTargetSteps.svelte';
  import LayerPlaces from './LayerPlaces.svelte';
  import { orderedTargets, placesAt } from './itemLayers.svelte.js';
  import { fileUrl } from '../../lib/fileUrl.js';
  import { roadWords, step } from '../../lib/mediaViewer.js';

  let {
    items = [],
    index = $bindable(0),
    caseId,
    coords,
    fullscreen = false,
    /** The item-layers store (`createItemLayers`); without one, no file joins a layer here. */
    layerItems = null,
    onclose,
    onmedia,
    onproof,
    onopenlayer = null,
  } = $props();

  const row = $derived(items[Math.min(index, items.length - 1)] ?? null);
  const why = $derived(roadWords(row));
  const proposed = $derived(row?.status === 'suggested');
  const blocked = $derived(fullscreen ? 'Exit fullscreen first. This leaves the map' : null);

  let el = $state();
  let layerMenu = $state(false);
  let layerAnchor = $state(null);
  /** Where the layer menu stands: the layers (null), a layer's groups, or a group's icon. */
  let layerStep = $state(null);
  /** The markers on this file's point, whichever layer they are in. */
  const places = $derived(layerItems && row ? placesAt(row, layerItems.entity === row.id ? layerItems.targets : []) : []);
  const held = $derived(new Set(places.map((place) => `${place.layer.name}|${place.marker.group ?? ''}`)));

  // the layers are read for the file shown, and again whenever the menu opens
  $effect(() => {
    const id = row?.id;
    if (layerItems && caseId && id) untrack(() => layerItems.refresh(caseId, id));
  });
  function toggleLayers() {
    if (layerMenu) { closeLayers(); return; }
    layerMenu = true;
    layerItems.refresh(caseId, row.id);
  }
  function closeLayers() { layerMenu = false; layerStep = null; }
  function addToLayer({ layer, group, style, status }) {
    const id = row.id, at = { lat: row.lat, lon: row.lon };
    closeLayers();
    layerItems.add(caseId, id, at, layer, group, style, status);
  }

  function go(delta) {
    index = step(index, delta, items.length);
  }

  // A stack opened from the map takes the keyboard, so the arrows walk it straight
  // away without a click into the panel first.
  $effect(() => {
    void items; // a second mark pressed while the viewer is open takes it again
    if (!el) return;
    tick().then(() => el?.focus({ preventScroll: true }));
  });

  function onkeydown(event) {
    // a focused video seeks with the arrows, and that is what the key means there
    if (event.target instanceof HTMLMediaElement) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onclose();
    } else if (event.key === 'ArrowLeft' && items.length > 1) {
      event.preventDefault();
      go(-1);
    } else if (event.key === 'ArrowRight' && items.length > 1) {
      event.preventDefault();
      go(1);
    }
  }
</script>

{#if row}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <section class="viewer" bind:this={el} tabindex="-1" aria-label="Media viewer" {onkeydown}>
    <header class="bar">
      {#if items.length > 1}
        <button class="btn btn-icon" title="Previous (←)" aria-label="Previous" onclick={() => go(-1)}>
          <Icon name="chevronLeft" size={14} />
        </button>
        <span class="count">{index + 1} / {items.length}</span>
        <button class="btn btn-icon" title="Next (→)" aria-label="Next" onclick={() => go(1)}>
          <Icon name="chevronRight" size={14} />
        </button>
      {/if}
      <button class="btn btn-icon close" title="Back to saved work (Esc)" aria-label="Close" onclick={onclose}>
        <Icon name="x" size={14} />
      </button>
    </header>

    <!-- keyed on the row, so stepping away stops the video that was playing -->
    {#key row.key ?? row.id}
      <div class="stage">
        {#if row.media_kind === 'video'}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video src={fileUrl(caseId, row.path)} controls preload="metadata"></video>
        {:else}
          <img src={fileUrl(caseId, row.path)} alt={row.title} />
        {/if}
      </div>
    {/key}

    <div class="about">
      <h3 class="title" title={row.title}>{row.title || 'Untitled'}</h3>
      <p class="sub">
        <span class="mono">{coords(row)}</span>
        {#if proposed}
          <span class="proposed" title="Proposed by a tool, waiting for you">suggested</span>
        {/if}
      </p>
      {#if why}<p class="why">{why}</p>{/if}
    </div>

    <nav class="acts" aria-label="Open elsewhere">
      <button
        class="btn btn-sm"
        disabled={fullscreen}
        title={blocked ?? 'Open this file in Media'}
        onclick={() => onmedia(row)}
      >
        <Icon name={row.media_kind === 'video' ? 'video' : 'image'} size={13} />
        <span>Open in Media</span>
      </button>
      {#each row.linked_proofs ?? [] as proof (proof.id)}
        <button
          class="btn btn-sm"
          disabled={fullscreen}
          title={blocked ?? 'Open this proof in Geo Proof'}
          onclick={() => onproof(proof)}
        >
          <Icon name="proof" size={13} />
          <span class="label">{proof.title || proof.name}</span>
        </button>
      {/each}
      {#if layerItems}
        <button class="btn btn-sm" bind:this={layerAnchor} aria-expanded={layerMenu} title="Put this file in one of your layers"
          onclick={toggleLayers}>
          <Icon name="layers" size={13} />
          <span>Add to a layer</span>
        </button>
      {/if}
    </nav>
    {#if layerItems}
      <LayerPlaces {places} busy={layerItems.busy} onopen={(place) => onopenlayer?.(place)}
        onremove={(place) => layerItems.remove(caseId, row.id, place)} />
    {/if}

    {#if layerMenu && layerItems}
      <FloatingMenu anchor={layerAnchor} width={layerStep?.group ? 264 : 248} label="Add to a layer" onclose={closeLayers}>
        {#if !layerStep}<p class="fm-head">Add to a layer</p>{/if}
        {#if proposed}
          <p class="fm-note">This point is only suggested. Confirm it in Media first.</p>
        {:else}
          <LayerTargetSteps bind:step={layerStep} targets={orderedTargets(layerItems.targets, layerItems.last(caseId))} {held}
            busy={layerItems.busy} {caseId} oncreate={(title) => layerItems.create(caseId, row.id, title)} onadd={addToLayer} />
        {/if}
      </FloatingMenu>
    {/if}
  </section>
{/if}

<style>
  .viewer {
    display: flex;
    flex-direction: column;
    gap: 8px;
    outline: none;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .count {
    font-size: var(--fs-xs);
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }
  .close {
    margin-left: auto;
  }
  /* black behind the picture, so a portrait clip reads as a frame in the panel
     rather than as a gap in it */
  .stage {
    display: grid;
    place-items: center;
    background: #000;
    border-radius: var(--r-sm);
    overflow: hidden;
  }
  .stage img,
  .stage video {
    display: block;
    width: 100%;
    max-height: 60vh;
    object-fit: contain;
  }
  .about {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .title {
    margin: 0;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .why {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--text-2);
  }
  .proposed {
    padding: 0 4px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: color-mix(in srgb, var(--accent) 85%, var(--text-2));
    font-size: 9px;
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .acts .btn {
    max-width: 100%;
  }
  .acts .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
