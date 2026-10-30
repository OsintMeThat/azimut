<script>
  /**
   * Which photo or video to lay over the view: a file on this computer,
   * dropped on the box at the top or chosen from it, or one of the case's,
   * picked from the list Inspect opens files from. With a case open a file
   * from the computer is added to the case, so the work on it can be kept;
   * with none it stays in this browser. Find, arriving, also lists the
   * searches the case keeps, to open one rather than start another.
   */
  import { onMount } from 'svelte';
  import { api } from '../../lib/api.js';
  import Modal from '../../components/Modal.svelte';
  import SourcePicker from '../../components/SourcePicker.svelte';
  import Icon from '../../components/Icon.svelte';
  import SearchCard from './SearchCard.svelte';
  import { carriesOutsideFiles } from '../../lib/drag.js';
  import { searchThumbs } from '../../lib/horizon/find.js';

  let {
    /** The open case's id, or null in one-shot mode. */
    caseId = null,
    /** The case path already laid, marked in the list. */
    current = null,
    /** A case file picked: `{ path, kind, title, … }`. */
    onpick = () => {},
    /** A file from this computer picked. */
    onfile = () => {},
    onclose = () => {},
    /** The searches the case keeps (api/horizon_finds.py rows, newest first), when Find asks; null otherwise. */
    searches = null,
    /** A kept search picked, by name. */
    onopensearch = () => {},
  } = $props();

  /** The case's kinds a photo can be matched from: captures and collages stay under All. */
  const FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'image', label: 'Photos' },
    { id: 'video', label: 'Videos' },
    { id: 'frame', label: 'Frames' },
  ];

  /** The searches shown before Show all: two rows of two. */
  const SEARCHES_SHOWN = 4;

  let media = $state([]);
  let loading = $state(false);
  let failed = $state('');
  let input = $state();
  let over = $state(false);
  let allSearches = $state(false);

  const shownSearches = $derived(allSearches ? (searches ?? []) : (searches ?? []).slice(0, SEARCHES_SHOWN));
  /** Each search's photo by its path, for its picture once the case's files are read. */
  const thumbs = $derived(searchThumbs(media));

  onMount(async () => {
    if (!caseId) return;
    loading = true;
    try {
      const all = await api.get(`/api/cases/${caseId}/media`);
      media = all.filter((item) => item.kind === 'image' || item.kind === 'video');
    } catch (failure) {
      failed = failure.message;
    } finally {
      loading = false;
    }
  });

  function chosen(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) onfile(file);
  }

  function onDrop(event) {
    if (!carriesOutsideFiles(event)) return;
    event.preventDefault();
    over = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) onfile(file);
  }
</script>

<Modal title={searches?.length ? 'Open a search or add a photo' : 'Add a photo or video'} width="720px" {onclose}>
  <div class="photo-dialog">
    {#if searches?.length}
      <h4>Searches in this case <span class="count">{searches.length}</span></h4>
      <div class="searches">
        {#each shownSearches as row (row.name)}
          <button type="button" class="search" onclick={() => onopensearch(row.name)} title="Open this search: its photo, area and map">
            <SearchCard {row} {caseId} thumb={thumbs.get(row.photo) ?? null} />
            <Icon name="chevronRight" size={13} />
          </button>
        {/each}
      </div>
      {#if searches.length > SEARCHES_SHOWN}
        <button type="button" class="more" onclick={() => (allSearches = !allSearches)}>
          {allSearches ? 'Show fewer' : `Show all ${searches.length} searches`}
        </button>
      {/if}
      <h4>New search, from a photo</h4>
    {/if}
    <div
      class="drop"
      class:over
      class:slim={searches?.length}
      role="region"
      aria-label="Drop a photo or a video here"
      ondragover={(event) => {
        if (!carriesOutsideFiles(event)) return;
        event.preventDefault();
        over = true;
      }}
      ondragleave={() => (over = false)}
      ondrop={onDrop}
    >
      <Icon name="upload" size={20} />
      <p class="say">Drop a photo or a video here</p>
      <button type="button" class="btn btn-sm" onclick={() => input?.click()}>Choose on this computer…</button>
      <p class="quiet">{caseId ? 'It is added to the case.' : 'It stays in this browser.'}</p>
      <input bind:this={input} type="file" accept="image/*,video/*" hidden onchange={chosen} />
    </div>
    {#if caseId}
      <h4>From the case</h4>
      {#if loading}
        <p class="quiet">Reading the case's files…</p>
      {:else if failed}
        <p class="quiet warn">{failed}</p>
      {:else if media.length}
        <SourcePicker {media} {caseId} {current} {onpick} filters={FILTERS} dense />
      {:else}
        <p class="quiet">This case has no photo or video yet.</p>
      {/if}
    {:else}
      <p class="quiet">Open a case to use its photos and keep the work on them.</p>
    {/if}
  </div>
</Modal>

<style>
  .photo-dialog {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .drop {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 18px 16px;
    border: 1.5px dashed var(--border-strong, var(--border));
    border-radius: var(--r-md);
    background: var(--bg-0);
    color: var(--text-2);
    text-align: center;
    transition:
      border-color 120ms ease,
      background 120ms ease;
  }
  .drop.over {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }
  .say {
    margin: 0;
    color: var(--text-1);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  h4 {
    margin: 4px 0 0;
    color: var(--text-2);
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .quiet {
    margin: 0;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  /* the drop box beside the searches: one line, the searches come first */
  .drop.slim {
    flex-direction: row;
    justify-content: center;
    flex-wrap: wrap;
    gap: 10px;
    padding: 10px 14px;
  }
  .count {
    margin-left: 4px;
    color: var(--text-3);
    font-weight: 500;
  }
  .searches {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 8px;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 6px 10px 6px 6px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-2);
    color: var(--text-3);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      border-color 120ms ease,
      background 120ms ease;
  }
  .search:hover,
  .search:focus-visible {
    outline: none;
    border-color: var(--accent);
    background: var(--bg-3);
    color: var(--text-1);
  }
  .more {
    align-self: flex-start;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .more:hover {
    text-decoration: underline;
  }
  .warn {
    color: var(--danger);
  }
</style>
