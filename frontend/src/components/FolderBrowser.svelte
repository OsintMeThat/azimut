<script>
  // The read-only folder view the modal pickers drop into when the analyst
  // presses "…": crumbs, the folders at this level, then the entries filed
  // there. Every picker (Inspect sources and sessions, Reverse Search media,
  // Proof panels and saved proofs) renders the same two-line-free rows, so the
  // markup and styling live here and each picker keeps only its own callbacks.
  //
  // `entries` are the picker's items already narrowed by its own chips/filters,
  // each carrying `id` and `attrs.folder`; `matches` then hides the ones the
  // search box excludes without collapsing the folders around them. A picker
  // with a richer flat row (Satellite's saved work) passes it as the `row`
  // snippet instead of settling for icon + label.
  import Icon from './Icon.svelte';
  import { buildTree } from '../lib/folderTree.js';
  import { browseCrumbs, browserView } from '../lib/folderBrowse.js';

  let {
    entries,
    path = '',
    rootLabel,
    selectedId = null,
    isSelected = (entry) => selectedId != null && entry.id === selectedId,
    mark = false, // tick the selected rows (the multi-select pickers)
    matches = () => true,
    emptyText = 'Nothing here.',
    icon = () => 'file',
    label = (entry) => entry.label ?? '',
    // A picker whose flat list has its own row (thumbnail, actions) passes it
    // here rather than dropping to icon+label the moment you open a folder.
    row = null,
    onnavigate,
    onselect,
    onconfirm,
  } = $props();

  const tree = $derived(buildTree(entries.map((e) => e.attrs?.folder).filter(Boolean), entries));
  const view = $derived(browserView(tree, entries, path));
  const files = $derived(view.entities.filter(matches));
  const crumbs = $derived(browseCrumbs(path));
</script>

<div class="browse-crumbs">
  <button type="button" class:active={!path} onclick={() => onnavigate('')}>{rootLabel}</button>
  {#each crumbs as crumb (crumb.path)}
    <span>/</span><button type="button" class:active={path === crumb.path} onclick={() => onnavigate(crumb.path)}>{crumb.name}</button>
  {/each}
</div>

<div class="browser-list">
  {#each view.children as folder (folder.path)}
    <button type="button" class="browser-row folder-row" onclick={() => onnavigate(folder.path)} ondblclick={() => onnavigate(folder.path)}>
      <Icon name="folder" size={18} /><span>{folder.name}</span>
    </button>
  {/each}
  {#each files as entry (entry.id)}
    {#if row}
      {@render row(entry)}
    {:else}
      <button
        type="button"
        class="browser-row"
        class:selected={isSelected(entry)}
        aria-pressed={mark ? isSelected(entry) : undefined}
        onclick={() => onselect?.(entry)}
        ondblclick={() => onconfirm?.(entry)}
      >
        <Icon name={icon(entry)} size={18} /><span>{label(entry)}</span>
        {#if mark && isSelected(entry)}<Icon name="check" size={14} />{/if}
      </button>
    {/if}
  {/each}
  {#if view.children.length === 0 && files.length === 0}
    <p class="browser-empty">{emptyText}</p>
  {/if}
</div>

<style>
  .browse-crumbs {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    overflow-x: auto;
    color: var(--text-3);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }
  .browse-crumbs button {
    padding: 2px 0;
    color: inherit;
  }
  .browse-crumbs button:hover,
  .browse-crumbs button.active {
    color: var(--text-1);
  }
  .browser-list {
    display: flex;
    flex-direction: column;
    min-height: 160px;
    max-height: min(48vh, 420px);
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
  }
  .browser-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 36px;
    padding: 7px 9px;
    border-radius: 0;
    color: var(--text-2);
    text-align: left;
  }
  .browser-row :global(svg) {
    flex-shrink: 0;
  }
  .browser-row > span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .browser-row + .browser-row {
    border-top: 1px solid var(--border);
  }
  .browser-row:hover,
  .browser-row.selected {
    background: var(--bg-3);
    color: var(--text-1);
  }
  .folder-row {
    color: var(--text-1);
  }
  .browser-empty {
    padding: 10px;
    color: var(--text-3);
    font-size: var(--fs-sm);
  }
</style>
