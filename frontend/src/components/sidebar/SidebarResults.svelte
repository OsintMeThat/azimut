<script>
  // Zone 2, results mode: a flat list, whatever the filing. Each row carries its
  // folder as meta, which answers "where is this filed?" without expanding a
  // single node.
  import { resultMeta } from '../../lib/sidebarSearch.js';
  import EntityRow from './EntityRow.svelte';

  let {
    rows = [],
    caseId,
    loading = false,
    hasMore = false,
    onmore = () => {},
    onactivate = () => {},
    oninfo = () => {},
    onunfile = () => {},
  } = $props();
</script>

<div class="results">
  {#each rows as e (e.id)}
    <EntityRow entity={e} {caseId} meta={resultMeta(e)} {onactivate} {oninfo} {onunfile} />
  {/each}

  {#if hasMore}
    <button class="more" onclick={onmore} disabled={loading}>Show more</button>
  {/if}

  {#if rows.length === 0 && !loading}
    <div class="none">No match in this case.</div>
  {/if}
</div>

<style>
  .results { display: flex; flex-direction: column; gap: 1px; padding: 4px; }
  .more {
    align-self: flex-start;
    margin: 2px 8px 6px;
    padding: 3px 10px;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-2);
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  .more:hover { color: var(--text-1); border-color: var(--border-strong); }
  .more:disabled { opacity: 0.5; cursor: default; }
  .none { font-size: var(--fs-xs); color: var(--text-3); padding: 8px; }
</style>
