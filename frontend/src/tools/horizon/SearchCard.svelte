<script>
  /**
   * A kept search as a card: its photo's picture, its name, when it was made
   * and how it ended as a coloured chip. Find's arrival dialog and its Open
   * menu both show it, each in its own button.
   */
  import Icon from '../../components/Icon.svelte';
  import { fileUrl } from '../../lib/fileUrl.js';
  import { searchEnding, searchedWhen, searchTone } from '../../lib/horizon/find.js';

  let {
    /** The search (api/horizon_finds.py row). */
    row,
    /** The open case's id, which the picture is read from. */
    caseId = null,
    /** Its photo's thumbnail path in the case (lib/horizon/find.js `searchThumbs`), or null. */
    thumb = null,
  } = $props();
</script>

<span class="search-thumb">
  {#if thumb && caseId}<img src={fileUrl(caseId, thumb)} alt="" loading="lazy" />{:else}<Icon name="search" size={16} />{/if}
</span>
<span class="search-text">
  <span class="search-title">{row.title}</span>
  <small>{searchedWhen(row.created_at)}</small>
  <span class="search-end {searchTone(row)}">{searchEnding(row)}</span>
</span>

<style>
  .search-thumb {
    display: grid;
    flex: none;
    place-items: center;
    width: 64px;
    height: 48px;
    overflow: hidden;
    border-radius: var(--r-sm);
    background: var(--bg-0);
    color: var(--text-3);
  }
  .search-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .search-text {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    min-width: 0;
  }
  .search-title,
  .search-text small {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .search-title {
    color: var(--text-1);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .search-text small {
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  /* how it ended, as a chip in its own colour */
  .search-end {
    margin-top: 2px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--bg-3);
    color: var(--text-2);
    font-size: 11px;
    line-height: 18px;
    white-space: nowrap;
  }
  .search-end.done {
    color: var(--text-1);
  }
  .search-end.quiet {
    color: var(--text-3);
  }
  .search-end.found {
    background: var(--ok-soft);
    color: var(--ok);
    font-weight: 600;
  }
  .search-end.running {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .search-end.failed {
    background: color-mix(in srgb, var(--danger) 14%, transparent);
    color: var(--danger);
  }
</style>
