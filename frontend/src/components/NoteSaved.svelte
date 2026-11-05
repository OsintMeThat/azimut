<script>
  /**
   * Whether the note in a narrow bar (the note on the side, the extension's panel)
   * is written: Saved, Saving… or Not saved. In a bar under 440 px it is only its
   * mark, the words kept for hover and screen readers, and under 340 px only Not
   * saved shows, so the note's name keeps its room. The bar is the query's container.
   */
  import Icon from './Icon.svelte';

  let { doc } = $props();

  const said = $derived(!doc?.loaded ? '' : doc.saveError ? 'Not saved' : doc.saving || !doc.saved ? 'Saving…' : 'Saved');
  const mark = $derived(doc?.saveError ? 'alert' : said === 'Saved' ? 'check' : 'clock');
</script>

<span class="said" class:error={doc?.saveError} title={doc?.saveError ? `Not saved: ${doc.saveError}` : said || undefined}>
  {#if said}<Icon name={mark} size={12} /><span class="words">{said}</span>{/if}
</span>

<style>
  .said {
    flex: none; display: inline-flex; align-items: center; gap: 4px; color: var(--text-3); font-size: var(--fs-xs); white-space: nowrap;
  }
  .said.error { color: var(--danger); }
  .said :global(svg) { flex: none; }
  @container (max-width: 440px) {
    .words { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  }
  @container (max-width: 340px) { .said:not(.error) { display: none; } }
</style>
