<script>
  import { untrack } from 'svelte';
  import { caseState, uiState } from '../../lib/state.svelte.js';
  import { personalLayers, personalPlaceDeletion } from '../../lib/map/personalLayers.svelte.js';
  import { addedLayers } from '../../lib/map/addedLayersState.svelte.js';
  import LayerEditor from './LayerEditor.svelte';
  import NewLayerDialog from './NewLayerDialog.svelte';
  import PlaceDeleteDialog from './PlaceDeleteDialog.svelte';
  import LayerExportDialog from './LayerExportDialog.svelte';
  import LayerAddDialogs from './LayerAddDialogs.svelte';

  let { tool, scope, engine = null, onarm = null } = $props();
  const active = $derived(uiState.tool === tool);
  $effect(() => {
    const owner = caseState.current?.id;
    untrack(() => {
      if (personalLayers.exporting?.caseId && personalLayers.exporting.caseId !== owner) personalLayers.cancelDownload();
      if (personalLayers.editor && personalLayers.editor.caseId !== owner) {
        personalLayers.close(); personalLayers.cancelNew(); personalPlaceDeletion.cancel();
      }
    });
  });
  $effect(() => {
    if (!active || !personalLayers.editor) return;
    const row = scope.rows.find((row) => row.name === personalLayers.editor.name);
    if (row && !row.enabled) untrack(() => scope.toggle(caseState.current?.id, row));
  });
  $effect(() => { if (active && personalLayers.armed) untrack(() => onarm?.()); });

  function fly(feature) {
    if (!engine) return;
    const walk = (node) => typeof node?.[0] === 'number' ? [node] : (node ?? []).flatMap(walk);
    const points = walk(feature.geometry.coordinates);
    if (!points.length) return;
    if (points.length === 1) engine.setView({ lon: points[0][0], lat: points[0][1] }, Math.max(engine.getZoom(), 15));
    else engine.fitBounds(points.reduce((bounds, [lon, lat]) => ({ west: Math.min(bounds.west, lon), east: Math.max(bounds.east, lon),
      south: Math.min(bounds.south, lat), north: Math.max(bounds.north, lat) }),
      { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity }), { padding: 40 });
  }
</script>

{#if active}
  {#if personalLayers.editor}
    <aside class="personal-panel" aria-label="Personal map layers" data-bar-obstacle>
      <LayerEditor controller={personalLayers}
        onfly={fly} ondeleteplace={personalPlaceDeletion.open} />
    </aside>
  {/if}
  {#if personalLayers.dialog}
    <NewLayerDialog source={personalLayers.dialog.source} busy={addedLayers.saving}
      onclose={() => personalLayers.cancelNew()} oncreate={(title, file, description) => personalLayers.create(title, file, description)} />
  {/if}
  <PlaceDeleteDialog controller={personalPlaceDeletion} />
  {#if personalLayers.exporting}<LayerExportDialog target={personalLayers.exporting} onclose={() => personalLayers.cancelDownload()} />{/if}
{/if}
<LayerAddDialogs {tool} onfly={fly} />

<style>
  .personal-panel { position: absolute; top: 70px; right: 12px; z-index: 45; width: 284px; max-width: calc(100% - 24px); max-height: calc(100% - 90px); overflow-y: auto; background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--r-sm); box-shadow: var(--shadow-2); padding-bottom: 8px; }
</style>
