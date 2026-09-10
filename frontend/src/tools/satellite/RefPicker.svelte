<script>
  /**
   * Pick a case image or video to float over the map.
   *
   * A reference window is a pure scratch aid — never captured, never saved — so
   * this reads the case's media and hands one back. Two ways in, because a case
   * with two hundred images is a different problem from a case with four: the
   * grid, and the folder browser behind "…". The search box only appears once
   * the grid is long enough to need it.
   */
  import Icon from '../../components/Icon.svelte';
  import Modal from '../../components/Modal.svelte';
  import SearchInput from '../../components/SearchInput.svelte';
  import FolderBrowser from '../../components/FolderBrowser.svelte';
  import { fileUrl } from '../../lib/fileUrl.js';
  import { matchesQuery } from '../../lib/mediaFilter.js';

  let {
    /** The case's images and videos, already loaded. */
    media = [],
    loading = false,
    caseId,
    /** Take this one as a reference window. */
    onpick,
    onclose,
  } = $props();

  const SEARCH_MIN = 6; // below that, the grid is easier to scan than to search

  let query = $state('');
  let browsing = $state(false); // "…" swaps the grid for the folder browser
  let path = $state('');
  let selection = $state(null);

  // Same free-text match as the Media Library (filename, title, notes, folder,
  // download source), so what works there works here.
  const visible = $derived(media.filter((item) => matchesQuery(item, query)));
  const entries = $derived(
    media.map((item) => ({ ...item, id: item.path, attrs: { folder: item.folder ?? '' } }))
  );

  function resetBrowser() {
    path = '';
    selection = null;
  }

  function toggleBrowser() {
    if (browsing) {
      browsing = false;
      return;
    }
    query = '';
    resetBrowser();
    browsing = true;
  }
</script>

<Modal title="Add reference" {onclose} width="560px">
  <p class="ref-hint">
    Float a case image or video over the map to compare against the imagery.
    Reference windows are never captured or saved.
  </p>
  {#if loading}
    <div class="ref-empty">Loading…</div>
  {:else if !media.length}
    <div class="ref-empty">
      No images or videos in this case yet. Import one in the Media Library first.
    </div>
  {:else}
    {#if browsing || media.length > SEARCH_MIN}
      <div class="ref-search">
        <SearchInput
          bind:value={query}
          placeholder="Search media…"
          count={`${visible.length}/${media.length}`}
          width="100%"
        />
        <button
          class="btn btn-ghost btn-sm browse-btn"
          title={browsing ? 'Show every image' : 'Browse folders'}
          onclick={toggleBrowser}
        >…</button>
      </div>
    {/if}
    {#if browsing}
      <FolderBrowser
        {entries}
        {path}
        rootLabel="Case media"
        selectedId={selection}
        matches={(entry) => matchesQuery(entry, query)}
        emptyText="This folder has no matching media."
        icon={(entry) => (entry.kind === 'video' ? 'video' : 'image')}
        label={(entry) => entry.title ?? entry.filename}
        onnavigate={(to) => {
          path = to;
          selection = null;
        }}
        onselect={(entry) => (selection = entry.path)}
        onconfirm={(entry) => onpick(entry)}
      />
      <div class="ref-actions">
        <button
          class="btn btn-primary btn-sm"
          disabled={!selection}
          onclick={() => {
            const item = entries.find((entry) => entry.path === selection);
            if (item) onpick(item);
          }}
        >
          Add selected
        </button>
      </div>
    {:else if !visible.length}
      <div class="ref-empty">No media matches this search.</div>
    {:else}
      <div class="ref-grid">
        {#each visible as item (item.path)}
          <button class="ref-pick" onclick={() => onpick(item)} title={item.title ?? item.filename}>
            <div class="ref-thumb">
              {#if item.thumbnail}
                <img src={fileUrl(caseId, item.thumbnail)} alt={item.filename} loading="lazy" />
              {:else}
                <Icon name={item.kind === 'video' ? 'video' : 'image'} size={26} />
              {/if}
              {#if item.kind === 'video'}
                <span class="ref-kind"><Icon name="video" size={11} /></span>
              {/if}
            </div>
            <span class="ref-name">{item.title ?? item.filename}</span>
          </button>
        {/each}
      </div>
    {/if}
  {/if}
</Modal>

<style>
  .ref-hint {
    font-size: var(--fs-sm);
    color: var(--text-2);
    margin: 0 0 12px;
  }
  .ref-search {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 10px;
  }
  .ref-search :global(.search-box) {
    flex: 1;
  }
  .browse-btn {
    flex-shrink: 0;
    padding: 0 8px;
    font-size: var(--fs-md);
    line-height: 1;
  }
  .ref-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 10px;
  }
  .ref-empty {
    padding: 24px 0;
    text-align: center;
    color: var(--text-3);
    font-size: var(--fs-sm);
  }
  .ref-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 10px;
    max-height: 60vh;
    overflow: auto;
  }
  .ref-pick {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 0;
    background: none;
    border: none;
    color: var(--text-2);
    cursor: pointer;
    text-align: left;
  }
  .ref-thumb {
    position: relative;
    aspect-ratio: 4 / 3;
    border-radius: var(--radius-1);
    overflow: hidden;
    background: var(--bg-2);
    display: grid;
    place-items: center;
    color: var(--text-3);
    border: 1px solid var(--border);
  }
  .ref-kind {
    position: absolute;
    bottom: 4px;
    right: 4px;
    display: grid;
    place-items: center;
    padding: 2px;
    border-radius: var(--radius-1);
    color: #fff;
    background: rgba(16, 16, 16, 0.75);
    backdrop-filter: blur(4px);
  }
  .ref-pick:hover .ref-thumb {
    border-color: var(--accent);
  }
  .ref-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .ref-name {
    font-size: var(--fs-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ref-pick:hover .ref-name {
    color: var(--accent);
  }
</style>
