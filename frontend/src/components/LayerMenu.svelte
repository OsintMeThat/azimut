<script>
  /**
   * One Layers button over a map, and the chips under it.
   *
   * A menu rather than a panel or a modal: it opens beside the map and leaves it
   * in view, so a layer switched on is seen arriving. A click outside, Escape or
   * the browser's Back closes it, as they close any overlay.
   */
  import Icon from './Icon.svelte';
  import LayerChips from './LayerChips.svelte';
  import { isTopOverlay, joinOverlays } from '../lib/overlayStack.js';

  let {
    /** What `LayerChips` lists: the catalogue's rows and the case's own layers. */
    rows = [],
    added = [],
    ontoggleadded = () => {},
    onmanage = null,
    /** The trigger's look, from the tool it sits in. */
    buttonClass = 'btn btn-sm',
    /** Which edge of the button the menu lines up with. */
    align = 'left',
    open = $bindable(false),
  } = $props();

  let root = $state(null);
  const count = $derived(
    rows.filter((row) => row.on && !row.disabled).length + added.filter((layer) => layer.enabled).length
  );

  const self = {};
  const close = () => (open = false);
  $effect(() => (open ? joinOverlays(self, close) : undefined));

  function onkeydown(event) {
    if (!open || event.key !== 'Escape' || event.defaultPrevented || !isTopOverlay(self)) return;
    event.preventDefault();
    close();
  }

  /** A press anywhere else closes it; one inside the menu or on the button does not. */
  function onpointerdown(event) {
    if (open && root && !root.contains(event.target)) close();
  }
</script>

<svelte:window {onkeydown} {onpointerdown} />

<div class="layer-menu" bind:this={root}>
  <button
    type="button"
    class={buttonClass}
    class:active={open}
    aria-expanded={open}
    aria-haspopup="dialog"
    title="Layers over the map"
    onclick={() => (open = !open)}
  >
    <Icon name="layers" size={13} />
    <span>Layers</span>
    {#if count}<span class="count">{count}</span>{/if}
  </button>
  {#if open}
    <div class="menu card" class:right={align === 'right'} role="dialog" aria-label="Layers">
      <LayerChips {rows} {added} {ontoggleadded} {onmanage} />
    </div>
  {/if}
</div>

<style>
  .layer-menu {
    position: relative;
  }
  .count {
    min-width: 16px;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 10px;
    text-align: center;
  }
  .menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 40;
    width: 300px;
    max-width: calc(100vw - 32px);
    max-height: min(70vh, 560px);
    overflow-y: auto;
    padding: 12px;
    box-shadow: var(--shadow-2);
  }
  .menu.right {
    left: auto;
    right: 0;
  }
</style>
