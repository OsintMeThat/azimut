<script>
  /**
   * A card of the hub: a title (or a heading of its own, for a badge beside it) over what it holds.
   * `know` marks a tip with an amber edge. The paragraphs inside are the parent's, so they are styled
   * here as `:global`.
   */
  let { title = '', heading = null, label = undefined, guide = undefined, know = false, children } = $props();
</script>

<section class="hub-card" class:know aria-label={label} data-guide={guide}>
  {#if heading}<h3>{@render heading()}</h3>{:else if title}<h3>{title}</h3>{/if}
  {@render children?.()}
</section>

<style>
  .hub-card { min-width: 0; border: 1px solid var(--border); background: var(--bg-1); border-radius: 8px; padding: 14px 16px; }
  .hub-card.know { border-left: 2px solid var(--accent); }
  h3 { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 0 0 4px; font-size: var(--fs-md); font-weight: 600;
    text-transform: none; letter-spacing: 0; color: var(--text-1); }
  .hub-card :global(p) { margin: 0; color: var(--text-2); font-size: var(--fs-sm); line-height: 1.5; }
  .hub-card :global(p.hint) { color: var(--text-3); font-size: var(--fs-xs); }
  .hub-card :global(p + p) { margin-top: 6px; }
  .hub-card :global(a) { color: var(--accent); }
</style>
