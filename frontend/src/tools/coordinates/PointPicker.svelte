<script>
  // Pick a point out of the open case instead of retyping it: the places and
  // captures already saved, searched flat or browsed by My-work folder behind the
  // "…", exactly like the media pickers elsewhere.
  //
  // Read-only on purpose. Editing or deleting saved work belongs to the Saved
  // panel on the map, which is the one place that owns it; here a row is only a
  // coordinate to borrow.
  import Modal from '../../components/Modal.svelte';
  import SearchInput from '../../components/SearchInput.svelte';
  import FolderBrowser from '../../components/FolderBrowser.svelte';
  import Icon from '../../components/Icon.svelte';
  import { KINDS, filterSaved, isLocated, oneEach, sortSaved } from '../../lib/geoTree.js';

  let { rows = [], onpick, onclose } = $props();

  // A case can hold thousands of saved items; render a bounded page of them.
  const CAP = 200;

  let query = $state('');
  let kind = $state('all');
  let browsing = $state(false);
  let path = $state('');

  // Only what carries a position: this picker exists to fill a coordinate, and a
  // row without one has nothing to give.
  const placed = $derived(oneEach(rows).filter(isLocated));
  // Proofs are a mode of the map's own panel, not a kind of point.
  const kinds = KINDS.filter((k) => !k.mode);
  const found = $derived(sortSaved(filterSaved(placed, { kind, query }), 'newest'));
  const shown = $derived(found.slice(0, CAP));
  const entries = $derived(
    filterSaved(placed, { kind }).map((row) => ({
      ...row,
      id: row.id,
      attrs: { folder: row.folder ?? '' },
    })),
  );

  const glyph = (row) => (row.kind === 'place' ? 'pin' : 'image');
  const label = (row) => row.title || `${row.lat.toFixed(5)}, ${row.lon.toFixed(5)}`;

  function pick(row) {
    onpick(row);
    onclose();
  }

  function setKind(next) {
    kind = next;
    path = '';
  }
</script>

<Modal title="Open a saved point" {onclose} width="680px">
  <div class="bar">
    <SearchInput bind:value={query} placeholder="Search title, note, place…" width="100%" />
    <div class="kinds" role="group" aria-label="What this list shows">
      {#each kinds as k (k.id)}
        <button class="kind" class:on={kind === k.id} onclick={() => setKind(k.id)}>{k.label}</button>
      {/each}
    </div>
    <button
      class="btn btn-ghost btn-sm browse-btn"
      class:on={browsing}
      title="Browse My-work folders"
      onclick={() => {
        browsing = !browsing;
        query = '';
        path = '';
      }}>…</button
    >
  </div>

  {#if browsing}
    <FolderBrowser
      {entries}
      {path}
      rootLabel="My work"
      icon={glyph}
      {label}
      emptyText="No saved point is filed here."
      onnavigate={(next) => (path = next)}
      onselect={(row) => pick(row)}
      onconfirm={(row) => pick(row)}
    />
  {:else if !shown.length}
    <p class="empty">
      {placed.length ? 'Nothing matches.' : 'This case has no saved place or capture yet.'}
    </p>
  {:else}
    <ul class="rows">
      {#each shown as row (row.key)}
        <li>
          <button onclick={() => pick(row)}>
            <Icon name={glyph(row)} size={14} />
            <span class="title">{label(row)}</span>
            <span class="coords mono">{row.lat.toFixed(5)}, {row.lon.toFixed(5)}</span>
            {#if row.folder}<span class="folder">{row.folder}</span>{/if}
          </button>
        </li>
      {/each}
    </ul>
    {#if found.length > shown.length}
      <p class="empty">Showing {shown.length} of {found.length}. Narrow the search.</p>
    {/if}
  {/if}
</Modal>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 10px;
  }
  .kinds {
    display: flex;
    flex-shrink: 0;
  }
  .kind {
    padding: 4px 9px;
    font-size: var(--fs-sm);
    color: var(--text-2);
    background: var(--bg-2);
    border: 1px solid var(--border);
    cursor: pointer;
  }
  .kind.on {
    color: var(--accent-text);
    background: var(--accent);
    border-color: var(--accent);
  }
  .browse-btn.on {
    color: var(--accent);
  }
  .rows {
    margin: 0;
    padding: 0;
    list-style: none;
    max-height: 52vh;
    overflow: auto;
  }
  .rows button {
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 7px 8px;
    text-align: left;
    background: none;
    border: 0;
    border-radius: var(--r-sm);
    color: inherit;
    cursor: pointer;
  }
  .rows button:hover {
    background: var(--bg-3);
  }
  .rows :global(svg) {
    color: var(--text-3);
  }
  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-sm);
  }
  .coords {
    font-size: var(--fs-xs);
    color: var(--text-2);
  }
  .folder {
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .empty {
    margin: 0;
    padding: 12px 8px;
    font-size: var(--fs-sm);
    color: var(--text-3);
  }
</style>
