<script>
  import AddedLayers from './AddedLayers.svelte';
  import LayerEditor from './LayerEditor.svelte';
  import { addedLayers } from '../../lib/map/addedLayersState.svelte.js';
  import { caseState } from '../../lib/state.svelte.js';

  let { rows = [], controller, onnew, onedit, ontoggle,
    ondone, onfly, onremove, onreorder, oncategory, ondeleteplace } = $props();
  const personal = $derived(rows.filter((row) => row.editable));
</script>

<section class="my-layers" aria-label="My layers">
  {#if controller.editor}
    <LayerEditor {controller} {ondone} {onfly} {ondeleteplace} />
  {:else}
    <AddedLayers rows={personal} heading="My layers" headingIcon="stack" addLabel="New layer"
      ondownload={(row) => controller.download(row)}
      {ontoggle} {onedit} {onremove} {onreorder} {oncategory} onadd={onnew}
      dates={addedLayers.dates}
      onperiod={(row, period, commit) => addedLayers.setPeriod(caseState.current?.id, row, period, commit)}
      moments={(row) => addedLayers.moments(row.name)}
      ontime={(row, patch) => addedLayers.setTime(row.name, patch)} />
  {/if}
</section>

<style>
  .my-layers { margin: 8px 0; border-top: 1px solid var(--border); }
</style>
