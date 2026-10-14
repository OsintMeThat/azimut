<script>
  /**
   * The three ways into a personal layer that open over the map: a pasted
   * position, an item of the case, a feature taken from another layer's card,
   * on whichever map is on screen.
   */
  import { untrack } from 'svelte';
  import { personalLayers } from '../../lib/map/personalLayers.svelte.js';
  import { caseState, uiState } from '../../lib/state.svelte.js';
  import LayerPasteDialog from './LayerPasteDialog.svelte';
  import LayerLinkDialog from './LayerLinkDialog.svelte';
  import LayerCopyMenu from './LayerCopyMenu.svelte';

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
  {#key personalLayers.copying}{#if personalLayers.copying}<LayerCopyMenu controller={personalLayers} />{/if}{/key}
{/if}
