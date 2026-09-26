<script>
  /**
   * Pick a case image or video to float over the map.
   *
   * A reference window is a pure scratch aid — never captured, never saved — so
   * this reads the case's media and hands one back. A short list is a plain
   * grid. Once it is long enough to need narrowing, the picker grows a search
   * box, one chip per type or source (the Media Library's facets, one click
   * each), a switch for the case's working files, and the folder browser.
   *
   * The working files start held back. The reference is almost always the shot
   * being geolocated, which the case collected, and a case that ran Detect or
   * Compare holds dozens of renders beside it. A case that collected nothing
   * shows them anyway rather than an empty grid.
   */
  import Icon from '../../components/Icon.svelte';
  import Modal from '../../components/Modal.svelte';
  import SearchInput from '../../components/SearchInput.svelte';
  import FolderBrowser from '../../components/FolderBrowser.svelte';
  import { fileUrl } from '../../lib/fileUrl.js';
  import { isMadeHere, matchesQuery, MEDIA_CATEGORIES } from '../../lib/mediaFilter.js';

  let {
    /** The case's images and videos, already loaded. */
    media = [],
    loading = false,
    caseId,
    /** The chip picked last; the caller keeps it for the session. */
    category = $bindable(null),
    /** Whether the working files are in the grid; kept the same way. */
    showWorking = $bindable(false),
    /** Take this one as a reference window. */
    onpick,
    onclose,
  } = $props();

  const SEARCH_MIN = 6; // below that, the grid is easier to scan than to search

  let query = $state('');
  let browsing = $state(false); // the folder button swaps the grid for the browser
  let path = $state('');
  let selection = $state(null);

  const narrowing = $derived(media.length > SEARCH_MIN);
  const working = $derived(media.filter(isMadeHere));
  const collectedCount = $derived(media.length - working.length);
  // Offered only when it has something to hide and something to leave.
  const canHold = $derived(narrowing && working.length > 0 && collectedCount > 0);
  const pool = $derived(canHold && !showWorking ? media.filter((item) => !isMadeHere(item)) : media);
  // A chip that would hide nothing narrows nothing, so it stays out of the row.
  const chips = $derived(
    MEDIA_CATEGORIES.map((c) => ({ ...c, count: pool.filter(c.match).length })).filter(
      (c) => c.count > 0 && c.count < pool.length
    )
  );
  // A choice the pool no longer offers (the switch hid what it picked) reads as
  // All, and comes back with the switch.
  const active = $derived(narrowing ? chips.find((c) => c.key === category) ?? null : null);
  const narrowed = $derived(active ? pool.filter(active.match) : pool);
  // Same free-text match as the Media Library (filename, title, notes, folder,
  // download source), so what works there works here.
  const visible = $derived(narrowed.filter((item) => matchesQuery(item, query)));
  const heldMatches = $derived(
    canHold && !showWorking && query.trim() && working.some((item) => matchesQuery(item, query))
  );
  const entries = $derived(
    narrowed.map((item) => ({ ...item, id: item.path, attrs: { folder: item.folder ?? '' } }))
  );
  const plural = (n) => (n > 1 ? 's' : '');

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

  function pickCategory(key) {
    category = key;
    resetBrowser();
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
    {#if narrowing}
      <div class="ref-search">
        <SearchInput
          bind:value={query}
          placeholder="Search media…"
          count={`${visible.length}/${pool.length}`}
          width="100%"
        />
        {#if canHold}
          <button
            type="button"
            class="ref-chip ref-working"
            class:active={showWorking}
            aria-pressed={showWorking}
            title={showWorking
              ? 'Show only what the case collected'
              : `Show the ${working.length} file${plural(working.length)} the case produced itself`}
            onclick={() => {
              showWorking = !showWorking;
              resetBrowser();
            }}
          >
            <Icon name="layers" size={12} />
            {showWorking
              ? 'Hide working files'
              : `Show ${working.length} working file${plural(working.length)}`}
          </button>
        {/if}
        <button
          class="btn btn-ghost btn-sm browse-btn"
          class:on={browsing}
          aria-pressed={browsing}
          title={browsing ? 'Back to the grid' : 'Browse folders'}
          onclick={toggleBrowser}
        >
          <Icon name="folder" size={15} />
        </button>
      </div>
      {#if chips.length}
        <div class="ref-chips" role="group" aria-label="Filter by type or source">
          <button
            type="button"
            class="ref-chip"
            class:active={!active}
            aria-pressed={!active}
            onclick={() => pickCategory(null)}
          >
            All <span>{pool.length}</span>
          </button>
          {#each chips as chip (chip.key)}
            <button
              type="button"
              class="ref-chip"
              class:active={active?.key === chip.key}
              aria-pressed={active?.key === chip.key}
              onclick={() => pickCategory(chip.key)}
            >
              <Icon name={chip.icon} size={12} />
              {chip.label} <span>{chip.count}</span>
            </button>
          {/each}
        </div>
      {/if}
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
      <div class="ref-empty">
        {heldMatches ? 'Only working files match this search.' : 'No media matches this search.'}
      </div>
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
    margin-bottom: 8px;
  }
  .ref-search :global(.search-box) {
    flex: 1;
  }
  .browse-btn {
    flex-shrink: 0;
    padding: 0 8px;
  }
  .browse-btn.on {
    color: var(--accent);
  }
  .ref-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-bottom: 10px;
  }
  .ref-chip {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-2);
    font-size: var(--fs-xs);
    white-space: nowrap;
    cursor: pointer;
  }
  .ref-chip:hover {
    border-color: var(--border-strong);
    color: var(--text-1);
  }
  .ref-chip.active {
    border-color: var(--accent);
    color: var(--text-1);
  }
  .ref-chip span {
    color: var(--text-3);
  }
  .ref-working {
    flex-shrink: 0;
    align-self: stretch;
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
