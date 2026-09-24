<script>
  import { fileUrl } from '../lib/fileUrl.js';
  import { matchesTerms } from '../lib/folderBrowse.js';
  import { categoryOf } from '../lib/inspectWork.svelte.js';
  import Icon from './Icon.svelte';
  import SearchInput from './SearchInput.svelte';
  import FolderBrowser from './FolderBrowser.svelte';

  // Every image and video in the case, ready to open. The files already worked on
  // lead, most recent first, because going back to one is the common move; the
  // rest follow in library order. The same list is the empty state and the
  // "change file" dialog of both Inspect and Reverse Search, so none of them drift.
  let { media, works = [], caseId, current = null, onpick } = $props();

  const FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'image', label: 'Images' },
    { id: 'video', label: 'Video' },
    { id: 'capture', label: 'Captures' },
    { id: 'frame', label: 'Frames' },
    { id: 'collage', label: 'Collages' },
  ];

  let query = $state('');
  let filter = $state('all');
  let browsing = $state(false);
  let browsePath = $state('');
  let browseSelection = $state(null);

  const framesBy = $derived(new Map(works.map((w) => [w.source, w.frames])));
  const filtered = $derived(filter === 'all' ? media : media.filter((m) => categoryOf(m) === filter));
  const matches = (m) => matchesTerms(m.title || m.filename || '', query);
  const shown = $derived(query.trim() ? filtered.filter(matches) : filtered);
  const byPath = $derived(new Map(media.map((m) => [m.path, m])));
  const recent = $derived(
    query.trim() || filter !== 'all'
      ? []
      : works.map((w) => byPath.get(w.source)).filter(Boolean).slice(0, 8)
  );
  const recentPaths = $derived(new Set(recent.map((m) => m.path)));
  const rest = $derived(shown.filter((m) => !recentPaths.has(m.path)));
  const browserEntries = $derived(filtered.map((m) => ({ ...m, id: m.path, attrs: { folder: m.folder ?? '' } })));

  function frameCount(m) {
    const n = framesBy.get(m.path);
    if (n == null) return '';
    return n === 1 ? '1 frame' : `${n} frames`;
  }

  function setFilter(id) {
    filter = id;
    browsePath = '';
    browseSelection = null;
  }

  function confirmBrowse() {
    const item = browserEntries.find((m) => m.path === browseSelection);
    if (item) onpick(item);
  }
</script>

<div class="picker">
  {#if media.length === 0}
    <p class="hint">Add an image or a video to the case first.</p>
  {:else}
    <div class="bar">
      <SearchInput bind:value={query} placeholder="Search names…" width="100%" />
      <button class="btn btn-ghost btn-sm browse" class:active={browsing} title="Browse folders" onclick={() => (browsing = !browsing)}>…</button>
    </div>
    <div class="filters" aria-label="Media type">
      {#each FILTERS as f (f.id)}
        <button class="btn btn-ghost btn-sm" class:active={filter === f.id} aria-pressed={filter === f.id} onclick={() => setFilter(f.id)}>
          {f.label}
        </button>
      {/each}
    </div>

    {#if browsing}
      <FolderBrowser
        entries={browserEntries}
        path={browsePath}
        rootLabel="Case media"
        selectedId={browseSelection}
        {matches}
        emptyText="This folder has no matching media."
        icon={(m) => (m.kind === 'video' ? 'video' : 'image')}
        label={(m) => m.title || m.filename}
        onnavigate={(path) => { browsePath = path; browseSelection = null; }}
        onselect={(m) => (browseSelection = m.path)}
        onconfirm={(m) => onpick(m)}
      />
      <div class="actions">
        <button class="btn btn-primary btn-sm" disabled={!browseSelection} onclick={confirmBrowse}>Open selected</button>
      </div>
    {:else}
      {#snippet card(m)}
        <button class="card" class:current={m.path === current} onclick={() => onpick(m)} title={m.title || m.filename}>
          <span class="thumb">
            {#if m.thumbnail}
              <img src={fileUrl(caseId, m.thumbnail)} alt="" loading="lazy" />
            {:else}
              <Icon name={m.kind === 'video' ? 'video' : 'image'} size={22} />
            {/if}
            {#if m.kind === 'video'}<span class="kind"><Icon name="video" size={11} /></span>{/if}
            {#if frameCount(m)}<span class="count">{frameCount(m)}</span>{/if}
          </span>
          <span class="title">{m.title || m.filename}</span>
          <span class="meta">{categoryOf(m)}{m.folder ? ` · ${m.folder}` : ''}</span>
        </button>
      {/snippet}

      {#if recent.length}
        <h4>Worked on</h4>
        <div class="grid">{#each recent as m (m.path)}{@render card(m)}{/each}</div>
        {#if rest.length}<h4>Everything else</h4>{/if}
      {/if}
      {#if rest.length}
        <div class="grid">{#each rest as m (m.path)}{@render card(m)}{/each}</div>
      {:else if !recent.length}
        <p class="hint">No media matches this filter.</p>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  /* The column scrolls as a whole. A row that shrank instead would collapse the
     filters first: a scrolling row has no minimum height of its own. */
  .picker > :global(*) {
    flex-shrink: 0;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .bar :global(.search-box) {
    flex: 1;
  }
  .browse {
    min-width: 30px;
    font-size: var(--fs-lg);
    line-height: 1;
  }
  .filters {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    padding-bottom: 2px;
  }
  .active {
    color: var(--text-1);
    background: var(--bg-3);
  }
  h4 {
    margin: 4px 0 0;
    font-size: var(--fs-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-3);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 10px;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px;
    text-align: left;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-2);
    min-width: 0;
  }
  .card:hover {
    border-color: var(--accent);
    background: var(--bg-3);
  }
  .card.current {
    border-color: var(--accent);
  }
  .thumb {
    position: relative;
    display: grid;
    place-items: center;
    aspect-ratio: 4 / 3;
    overflow: hidden;
    border-radius: var(--r-sm);
    background: var(--bg-0);
    color: var(--text-3);
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .kind,
  .count {
    position: absolute;
    display: flex;
    align-items: center;
    padding: 1px 5px;
    border-radius: 4px;
    background: rgba(10, 10, 10, 0.65);
    color: #fff;
    font-size: 10px;
  }
  .kind {
    top: 4px;
    left: 4px;
    padding: 2px;
  }
  .count {
    bottom: 4px;
    right: 4px;
  }
  .title,
  .meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .title {
    color: var(--text-1);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .meta {
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .hint {
    color: var(--text-3);
    font-size: var(--fs-sm);
    margin: 0;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
