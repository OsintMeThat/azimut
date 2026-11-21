<script>
  /**
   * A card of the hub: a title, with what stands beside it (`aside`, a pill), over what it holds.
   * `tip` marks a tip with an amber edge. Each card is a container of its own, so a field inside
   * lays itself out by the card's width (`HubField.svelte`).
   */
  let { title = '', aside = null, label = undefined, guide = undefined, tip = false, children } = $props();
</script>

<section class="hub-card" class:tip aria-label={label} data-guide={guide}>
  {#if title}<h3>{title}{@render aside?.()}</h3>{/if}
  {@render children?.()}
</section>

<style>
  .hub-card { container: card / inline-size; min-width: 0; padding: 14px 16px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-1); }
  .hub-card.tip { border-left: 2px solid var(--accent); }
  h3 { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 0 0 4px; color: var(--text-1); font-size: var(--fs-md); font-weight: 600;
    line-height: 1.35; letter-spacing: 0; text-transform: none; }
  /* the card's own paragraphs, weak enough for a class of the panel to restyle one */
  :where(.hub-card) > :global(p) { margin: 0; color: var(--text-2); font-size: var(--fs-sm); line-height: 1.5; }
  :where(.hub-card) > :global(p + p) { margin-top: 6px; }
</style>
