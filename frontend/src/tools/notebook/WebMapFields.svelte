<script>
  /**
   * What *Web map* asks under the starts of the New note dialog: the layers it shows, from My
   * layers and the case's other layers, ticked in the list the Interactive map picker uses.
   * The ground is filed once, on Create, as any map's is (`lib/notes/webMap.js`).
   */
  import { onMount } from 'svelte';
  import { api } from '../../lib/api.js';
  import MapLayerList from '../../components/MapLayerList.svelte';

  let { caseId, chosen = $bindable([]), named = $bindable(''),
    load = (id) => api.get(`/api/cases/${encodeURIComponent(id)}/notes/maps/sources`) } = $props();

  let layers = $state(null);
  let failed = $state('');
  onMount(async () => {
    try {
      layers = (await load(caseId))?.layers ?? [];
    } catch (error) {
      failed = error?.message || 'The case’s layers could not be read';
    }
  });
  $effect(() => {
    named = (layers ?? []).filter((one) => chosen.includes(one.name)).map((one) => one.title).join(', ');
  });
</script>

<div class="map-fields">
  <p class="lead">A map of its own page, to publish as the note is: its layers with their icons, groups, cards and days, a search, and the address of each view.</p>
  {#if failed}
    <p class="said error">{failed}</p>
  {:else if !layers}
    <p class="said">Reading the case…</p>
  {:else}
    <MapLayerList {layers} bind:chosen label="Layers it shows" />
    <p class="said">Its ground is fetched once, on Create, and kept in the case. The map’s settings card does the rest.</p>
  {/if}
</div>

<style>
  .map-fields { display: flex; flex-direction: column; gap: 8px; }
  .lead, .said { margin: 0; font-size: var(--fs-xs); color: var(--text-3); line-height: 1.45; }
  .lead { color: var(--text-2); font-size: var(--fs-sm); }
  .said.error { color: var(--danger); }
</style>
