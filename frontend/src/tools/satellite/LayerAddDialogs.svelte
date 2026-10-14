<script>
  /**
   * The three ways into a personal layer that open a dialog — a pasted
   * position, an item of the case, a feature copied from another layer — on
   * whichever map is on screen.
   */
  import { untrack } from 'svelte';
  import { personalLayers } from '../../lib/map/personalLayers.svelte.js';
  import { caseState, uiState } from '../../lib/state.svelte.js';
  import LayerPasteDialog from './LayerPasteDialog.svelte';
  import LayerLinkDialog from './LayerLinkDialog.svelte';
  import LayerCopyDialog from './LayerCopyDialog.svelte';

  let { tool, onfly = null } = $props();
  const active = $derived(uiState.tool === tool);
  $effect(() => {
    const owner = caseState.current?.id;
    untrack(() => { if (personalLayers.copying && personalLayers.copying.caseId !== owner) personalLayers.cancelCopy(); });
  });
</script>

{#if active}
  {#if personalLayers.editor && personalLayers.pasting}<LayerPasteDialog controller={personalLayers} {onfly} />{/if}
  {#if personalLayers.editor && personalLayers.linking}<LayerLinkDialog controller={personalLayers} />{/if}
  {#key personalLayers.copying}{#if personalLayers.copying}<LayerCopyDialog controller={personalLayers} />{/if}{/key}
{/if}
