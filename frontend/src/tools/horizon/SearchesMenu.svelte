<script>
  /**
   * Open a search the case keeps: one labelled button in Find's header, as in
   * Horizon's. Each search shows as the arrival dialog shows it, its photo's
   * picture, when it was made and how it ended; opening one lays its area,
   * alignments and settings in place of the setup on screen, and one can be
   * sent to the Trash from its row. The pictures are read from the case's files
   * each time the menu opens.
   */
  import Icon from '../../components/Icon.svelte';
  import SearchCard from './SearchCard.svelte';
  import { api } from '../../lib/api.js';
  import { searchThumbs } from '../../lib/horizon/find.js';

  let {
    /** The case's searches (api/horizon_finds.py rows), newest first. */
    searches = [],
    /** The search on show, by name. */
    current = null,
    /** Whether a case is open to keep searches in. */
    ready = false,
    /** The open case's id, which the searches' pictures are read from. */
    caseId = null,
    onopen = () => {},
    onremove = () => {},
  } = $props();

  let open = $state(false);
  let root = $state(null);
  /** Each photo's thumbnail by its path, as last read. */
  let thumbs = $state.raw(new Map());

  async function readThumbs() {
    if (!caseId) return;
    const asked = caseId;
    try {
      const media = await api.get(`/api/cases/${encodeURIComponent(asked)}/media`);
      if (asked === caseId) thumbs = searchThumbs(media);
    } catch {
      // the rows show without their pictures
    }
  }
  function toggle() {
    open = !open;
    if (open) readThumbs();
  }
  function close(event) {
    if (open && root && !root.contains(event.target)) open = false;
  }
  function onKey(event) {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      open = false;
    }
  }
  function pick(run) {
    open = false;
    run();
  }
</script>

<svelte:window onpointerdown={close} onkeydown={onKey} />

<div class="sm" bind:this={root}>
  <button
    type="button"
    class="btn btn-sm"
    onclick={toggle}
    disabled={!ready}
    aria-haspopup="menu"
    aria-expanded={open}
    title={ready ? 'Open a search kept in this case' : 'Open a case to keep searches'}
    aria-label="Open a search"
  >
    <Icon name="folderOpen" size={13} /><span>Open</span>
  </button>
  {#if open}
    <div class="sm-menu card" role="menu">
      <p class="sm-head">Searches in this case <span class="sm-count">{searches.length}</span></p>
      <div class="sm-list">
        {#each searches as row (row.name)}
          <div class="sm-row" class:current={current === row.name}>
            <button type="button" role="menuitem" class="sm-open" onclick={() => pick(() => onopen(row.name))}>
              <SearchCard {row} {caseId} thumb={thumbs.get(row.photo) ?? null} />
            </button>
            <button type="button" class="sm-x" onclick={() => onremove(row.name)} title="Move this search to the Trash" aria-label="Delete {row.title}">
              <Icon name="trash" size={12} />
            </button>
          </div>
        {:else}
          <p class="sm-empty">No search yet</p>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .sm {
    position: relative;
    display: inline-flex;
    align-items: center;
  }
  .sm-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 30;
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 360px;
    max-width: calc(100vw - 32px);
    padding: 6px;
  }
  .sm-head {
    margin: 2px 6px 4px;
    color: var(--text-2);
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .sm-count {
    margin-left: 4px;
    color: var(--text-3);
    font-weight: 500;
  }
  .sm-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: min(460px, 70vh);
    overflow-y: auto;
  }
  .sm-row {
    display: flex;
    align-items: center;
    gap: 4px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-2);
    transition:
      border-color 120ms ease,
      background 120ms ease;
  }
  .sm-row:hover,
  .sm-row:focus-within {
    border-color: var(--accent);
    background: var(--bg-3);
  }
  .sm-row.current {
    border-color: color-mix(in srgb, var(--accent) 60%, var(--border));
    background: color-mix(in srgb, var(--accent) 12%, var(--bg-2));
  }
  .sm-open {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 6px;
    border: 0;
    background: none;
    color: var(--text-1);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .sm-open:focus-visible {
    outline: none;
  }
  .sm-x {
    display: grid;
    flex: none;
    place-items: center;
    width: 24px;
    height: 24px;
    margin-right: 6px;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text-3);
    cursor: pointer;
  }
  .sm-x:hover {
    color: var(--text-1);
    background: color-mix(in srgb, var(--text-1) 9%, transparent);
  }
  .sm-empty {
    margin: 4px 6px 6px;
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
</style>
