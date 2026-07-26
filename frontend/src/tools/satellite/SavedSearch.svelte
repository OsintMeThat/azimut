<script>
  /**
   * Search across every saved item at full width — the same index the tree
   * reads, laid out flat with thumbnails and a sort. Nothing is fetched here:
   * the whole set is already in memory, so typing costs no network.
   *
   * Browsing the same set by My-work folder is the panel's job (its globe /
   * folder switch), not this modal's — one road to a folder, not two.
   *
   * It is a Modal, which portals itself into whatever element is fullscreen, so
   * this works over a fullscreen map — the one place the 300px panel does not.
   */
  import Modal from '../../components/Modal.svelte';
  import SearchInput from '../../components/SearchInput.svelte';
  import SavedRow from './SavedRow.svelte';
  import { KINDS, SORTS, filterSaved, oneEach, sortSaved } from '../../lib/geoTree.js';

  let {
    rows = [],
    caseId,
    coords,
    fullscreen = false,
    centre = null,
    kind = $bindable('all'),
    query = $bindable(''),
    hoveredId = $bindable(null),
    onclose,
    onopen,
    onedit,
    ondelete,
    onproof,
  } = $props();

  // A case can hold thousands of saved items; a modal that renders all of them
  // stalls on every keystroke. Narrow the search instead of scrolling forever.
  const CAP = 200;

  let sort = $state('newest');
  // one line per thing: a proof that touches two places is two marks on the
  // map, but repeating it here would read as two proofs
  const found = $derived(sortSaved(oneEach(filterSaved(rows, { kind, query })), sort, centre));
  const shown = $derived(found.slice(0, CAP));

  function open(row) {
    onopen(row);
    onclose();
  }
</script>

<Modal title="Saved work" {onclose} width="760px">
  <div class="bar">
    <SearchInput bind:value={query} placeholder="Search title, note, place, provider…" width="100%" />
    <div class="kinds" role="group" aria-label="What this list shows">
      {#each KINDS as k (k.id)}
        <button
          class="kind"
          class:mode={k.mode}
          class:on={kind === k.id}
          onclick={() => (kind = k.id)}
        >{k.label}</button>
      {/each}
    </div>
    <select class="select sort" bind:value={sort} aria-label="Sort results">
      {#each SORTS as s (s.id)}
        <option value={s.id} disabled={s.id === 'distance' && !centre}>{s.label}</option>
      {/each}
    </select>
  </div>

  {#snippet savedRow(entry)}
    <SavedRow
      row={entry}
      {caseId}
      {coords}
      {fullscreen}
      dense
      hovered={hoveredId === (entry.key ?? entry.id)}
      onhover={(id) => (hoveredId = id)}
      onopen={open}
      {onedit}
      {ondelete}
      {onproof}
    />
  {/snippet}

  <div class="results">
    {#if !rows.length}
      <p class="none">Nothing is saved in this case yet.</p>
    {:else if !found.length}
      <p class="none">No saved item matches that.</p>
    {:else}
      {#each shown as row (row.key ?? row.id)}
        {@render savedRow(row)}
      {/each}
    {/if}
  </div>

  {#if found.length > CAP}
    <p class="tally">Showing the first {CAP} of {found.length}. Narrow the search to see the rest.</p>
  {:else if found.length}
    <p class="tally">{found.length} of {rows.length} saved.</p>
  {/if}
</Modal>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 10px;
  }
  .bar :global(.search-box) {
    flex: 1;
    min-width: 0;
  }
  .kinds {
    display: flex;
    flex-shrink: 0;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
  }
  .kind {
    padding: 3px 10px;
    border-radius: 2px;
    font-size: var(--fs-xs);
    color: var(--text-3);
    cursor: pointer;
  }
  .kind:hover {
    color: var(--text-1);
  }
  /* Proofs is a mode, not a refinement of the three to its left */
  .kind.mode {
    margin-left: 5px;
    border-left: 1px solid var(--border);
    padding-left: 12px;
    border-radius: 0 2px 2px 0;
  }
  .kind.on {
    background: var(--bg-3);
    color: var(--text-1);
    font-weight: 600;
  }
  /* the global .select is width:100% — a sort control that fills the bar
     leaves nothing for the search box */
  .sort {
    width: auto;
    flex-shrink: 0;
    font-size: var(--fs-xs);
  }
  .results {
    display: flex;
    flex-direction: column;
    min-height: 120px;
    max-height: min(58vh, 520px);
    overflow-y: auto;
    border-top: 1px solid var(--border);
    padding-top: 6px;
  }
  .none {
    padding: 24px 4px;
    font-size: var(--fs-sm);
    color: var(--text-3);
    text-align: center;
  }
  .tally {
    padding-top: 8px;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
</style>
