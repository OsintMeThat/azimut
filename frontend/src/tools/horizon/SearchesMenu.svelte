<script>
  /**
   * Open a search the case keeps: one labelled button in Find's header, as in
   * Horizon's. Each search says when it was made and how it ended; opening one
   * lays its area, alignments and settings in place of the setup on screen,
   * and one can be sent to the Trash from its row.
   */
  import Icon from '../../components/Icon.svelte';
  import { searchEnding, searchedWhen } from '../../lib/horizon/find.js';

  let {
    /** The case's searches (api/horizon_finds.py rows), newest first. */
    searches = [],
    /** The search on show, by name. */
    current = null,
    /** Whether a case is open to keep searches in. */
    ready = false,
    onopen = () => {},
    onremove = () => {},
  } = $props();

  let open = $state(false);
  let root = $state(null);

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
    onclick={() => (open = !open)}
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
      <p class="sm-head">Searches in this case</p>
      <div class="sm-list">
        {#each searches as row (row.name)}
          <div class="sm-row" class:current={current === row.name}>
            <button type="button" role="menuitem" class="sm-open" onclick={() => pick(() => onopen(row.name))}>
              <span class="sm-title">{row.title}</span>
              <small>{[searchedWhen(row.created_at), searchEnding(row)].filter(Boolean).join(' · ')}</small>
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
    width: 300px;
    padding: 6px;
  }
  .sm-head {
    margin: 2px 6px 4px;
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .sm-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 340px;
    overflow-y: auto;
  }
  .sm-row {
    display: flex;
    align-items: center;
    gap: 4px;
    border-radius: var(--r-sm);
  }
  .sm-row:hover,
  .sm-row:focus-within {
    background: var(--bg-3);
  }
  .sm-row.current {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .sm-open {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    padding: 5px 6px;
    border: 0;
    background: none;
    color: var(--text-1);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .sm-title,
  .sm-open small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sm-open small {
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .sm-x {
    display: grid;
    flex: none;
    place-items: center;
    width: 24px;
    height: 24px;
    margin-right: 4px;
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
