<script>
  import ConfirmDialog from '../../components/ConfirmDialog.svelte';
  import { RESTORABLE } from '../../lib/trash.js';
  let { controller } = $props();
  const target = $derived(controller.target);
</script>

{#if target}
  <ConfirmDialog title="Delete this case place?"
    message={`“${target.usage.place.label}” will be removed from the case.`}
    detail={target.consequences.cascade?.length
      ? 'The dependent items listed below also move to Trash.'
      : 'Proofs keep their coordinates, along with media placed by those proofs.'}
    consequences={target.consequences} restorable={RESTORABLE}
    confirmLabel="Delete case place" icon="trash" busy={controller.busy}
    onconfirm={controller.confirm} oncancel={controller.cancel}>
    {#if target.usage.related.length}
      <p>Linked to {target.usage.related.length} {target.usage.related.length === 1 ? 'item' : 'items'}</p>
      <ul>{#each target.usage.related as item (item.id)}<li>{item.label}</li>{/each}</ul>
      {#if target.usage.related.some((item) => item.type === 'media')}
        <p>Media placed only through this place lose this map position.</p>
      {/if}
    {/if}
    {#if target.usage.layers.length}
      <p>These layers keep the point as an independent marker:</p>
      <ul>{#each target.usage.layers as layer (layer.name)}<li>{layer.title}</li>{/each}</ul>
    {/if}
  </ConfirmDialog>
{/if}

<style>
  p { margin: 8px 0 4px; font-size: var(--fs-xs); color: var(--text-2); }
  ul { margin: 0; padding-left: 18px; max-height: 130px; overflow-y: auto; font-size: var(--fs-xs); color: var(--text-3); }
</style>
