<script>
  /**
   * The tag that opens the case's key (`LayerPaletteEditor`): what its colours
   * and icons stand for. It sits in the layer editor's header, beside the
   * colours of the style palette, and under a legend that counts a colour or an
   * icon with no name; `text` says it in words where the tag alone would be missed.
   * It lists the `colours` and the icons `worn` where it sits.
   */
  import Icon from '../../components/Icon.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import LayerPaletteEditor from './LayerPaletteEditor.svelte';

  let { caseId, colours = [], worn = [], look = null, text = '', disabled = false } = $props();
  let open = $state(false);
  let anchor = $state(null);
</script>

<button type="button" class="key-button" class:worded={!!text} bind:this={anchor} aria-label={text || 'Name colours and icons'}
  aria-expanded={open} title="Name what each colour and icon stands for in this case" {disabled} onclick={() => (open = !open)}>
  <Icon name="tag" size={12} />{#if text}<span>{text}</span>{/if}
</button>

{#if open}
  <FloatingMenu {anchor} align="end" width={290} role="group" label="Named colours and icons" onclose={() => (open = false)}>
    <LayerPaletteEditor {caseId} {colours} {worn} {look} onclose={() => (open = false)} />
  </FloatingMenu>
{/if}

<style>
  .key-button { display: inline-flex; align-items: center; justify-content: center; gap: 4px; flex: none; min-width: 24px; height: 24px;
    border-radius: var(--r-sm); color: var(--text-3); font-size: 10.5px; cursor: pointer; }
  .key-button.worded { padding: 0 6px; }
  .key-button:hover:not(:disabled), .key-button[aria-expanded='true'] { background: var(--bg-3); color: var(--text-1); }
  .key-button:disabled { opacity: .45; cursor: default; }
</style>
