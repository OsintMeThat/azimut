<script>
  import AddedLayers from './AddedLayers.svelte';
  import LayerEditor from './LayerEditor.svelte';
  import Icon from '../../components/Icon.svelte';

  let { rows = [], controller, places = [], onnew, onedit, onstart, ontoggle,
    ondone, onfly, onremove, onreorder, oncategory, ondeleteplace } = $props();
  const personal = $derived(rows.filter((row) => row.editable));
</script>

<section class="my-layers" aria-label="My layers">
  {#if controller.editor}
    <LayerEditor {controller} {places} {onstart} {ondone} {onfly} {ondeleteplace} />
  {:else}
    <AddedLayers rows={personal} heading="My layers" headingIcon="stack" addLabel="New layer"
      ondownload={(row) => controller.download(row)}
      {ontoggle} {onedit} {onremove} {onreorder} {oncategory} onadd={onnew} />
    <button class="my-maps" onclick={() => controller.openMaps()}><Icon name="compass" size={12} /> My maps</button>
  {/if}
</section>

<style>
  .my-layers { margin: 8px 0; border-top: 1px solid var(--border); }
  .my-maps { display: flex; align-items: center; gap: 6px; width: calc(100% - 16px); margin: 4px 8px; padding: 5px 6px; border: 1px dashed var(--border); border-radius: var(--r-sm); font-size: 11px; color: var(--text-2); cursor: pointer; }
</style>
