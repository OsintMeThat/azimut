<script>
  /**
   * A category of analyzers that opens on demand, so a long list reads as a
   * handful of headings. A folded one names the analyzer picked inside it,
   * which keeps the choice in sight with every category shut.
   */
  import Icon from '../../components/Icon.svelte';

  let { label, count = 0, note = '', open = false, ontoggle = () => {}, children } = $props();
</script>

<div class="fold-group">
  <button type="button" class="fold" aria-expanded={open} onclick={ontoggle}>
    <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
    <span class="label">{label}</span>
    {#if note && !open}<span class="note">{note}</span>{/if}
    {#if count}<small>{count}</small>{/if}
  </button>
  {#if open}<div class="fold-body">{@render children()}</div>{/if}
</div>

<style>
  .fold-group { border-bottom: 1px solid var(--border); }
  .fold {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    min-height: 36px;
    padding: 6px 4px;
    color: var(--text-1);
    font-size: var(--fs-sm);
    font-weight: 600;
    text-align: left;
  }
  .fold:hover { background: var(--bg-2); }
  .fold :global(svg) { flex: 0 0 auto; color: var(--text-3); }
  .label { flex: 0 1 auto; min-width: 0; }
  .note {
    overflow: hidden;
    min-width: 0;
    color: var(--accent);
    font-size: var(--fs-xs);
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  small {
    margin-left: auto;
    color: var(--text-3);
    font-size: var(--fs-xs);
    font-weight: 400;
  }
  .fold-body { display: grid; padding: 0 0 6px 19px; }
</style>
