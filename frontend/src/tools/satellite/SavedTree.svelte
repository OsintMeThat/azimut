<script>
  /**
   * The Saved panel: every place, capture and filed screenshot in the case,
   * browsed by geography instead of by scroll position.
   *
   * Two groupings over one set. **Geography** (lib/geoTree.js) is the default:
   * a case that sits in one country opens straight on its regions, one that
   * spans the world opens on continents. **Folders** (lib/folderView.js) shows
   * the same items through My work, and only there can a row be dragged onto a
   * folder to file it. Typing filters before grouping, so the counts always
   * describe what is on screen, and every branch opens while a search is
   * running — a filter that hides its own matches behind chevrons is no filter.
   */
  import Icon from '../../components/Icon.svelte';
  import SearchInput from '../../components/SearchInput.svelte';
  import SavedRow from './SavedRow.svelte';
  import {
    KINDS,
    branchKeys,
    buildGeoTree,
    isMode,
    keyFor,
    pendingLocate,
  } from '../../lib/geoTree.js';
  import { buildFolderTree, keyForFolder } from '../../lib/folderView.js';

  let {
    rows = [],
    folders = [],
    caseId,
    coords,
    fullscreen = false,
    kind = $bindable('all'),
    query = $bindable(''),
    group = $bindable('geo'), // 'geo' | 'folders'
    hoveredId = $bindable(null),
    revealId = null,
    locating = null,
    onopen,
    onedit,
    ondelete,
    onproof,
    onbrowse,
    onlocate,
    oncancelLocate,
    onmove,
  } = $props();

  const byFolder = $derived(group === 'folders');
  const geoTree = $derived(buildGeoTree(rows, { kind, query }));
  const folderTree = $derived(buildFolderTree(rows, folders, { kind, query }));
  // one shape for both, so the branch snippet below never asks which it is
  const tree = $derived(
    byFolder
      ? { levels: [], nodes: folderTree.nodes, trailing: folderTree.unfiled }
      : { levels: geoTree.levels, nodes: geoTree.nodes, trailing: geoTree.unlocated }
  );
  // Locate resolves saved entities. A proof states its own point or borrows one,
  // so the pass has nothing to look up there and the errand must not be offered.
  const pending = $derived(isMode(kind) ? 0 : pendingLocate(rows));
  const searching = $derived(!!query.trim());
  const shown = $derived(
    tree.nodes.reduce((sum, node) => sum + node.count, 0) + tree.trailing.count
  );

  let expanded = $state(new Set());
  const isOpen = (key) => searching || expanded.has(key);

  function toggle(key) {
    const next = new Set(expanded);
    if (!next.delete(key)) next.add(key);
    expanded = next;
  }

  // A case with a single root has nothing to choose between — open it rather
  // than making the analyst click through one node to reach their work.
  let seededRoots = null;
  $effect(() => {
    const roots = tree.nodes.map((node) => node.key).join('|');
    if (roots === seededRoots) return;
    seededRoots = roots;
    if (tree.nodes.length === 1) expanded = new Set([...expanded, tree.nodes[0].key]);
  });

  // Something elsewhere (the case sidebar, a search result) asked to show one
  // saved item: open the branch it lives in and scroll it into view.
  let revealed = null;
  $effect(() => {
    if (!revealId || revealId === revealed) return;
    const row = rows.find((r) => r.id === revealId);
    if (!row) return;
    revealed = revealId;
    const key = byFolder ? keyForFolder(row) : keyFor(row, tree.levels);
    expanded = new Set([...expanded, ...branchKeys(key)]);
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-saved-id="${CSS.escape(row.key ?? row.id)}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    );
  });

  // --- filing by drag (folder view only) ------------------------------------
  // The dragged row is held here rather than read back out of the drop event:
  // the id travels in dataTransfer for the platform's sake, the object travels
  // in memory so the drop needs no lookup. Same shape the case sidebar uses.
  let dragRow = null;
  let dropTarget = $state(undefined);

  function startDrag(event, row) {
    dragRow = row;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', row.id);
  }

  function drop(event, folder) {
    event.preventDefault();
    dropTarget = undefined;
    const row = dragRow;
    dragRow = null;
    // dropping an item where it already lives is a no-op, not a round-trip
    if (row && (row.folder || '') !== folder) onmove?.(row, folder);
  }
</script>

<div class="controls">
  <div class="head">
    <SearchInput bind:value={query} placeholder="Filter saved…" width="100%" />
    <!-- the same set, seen through where it is or through how you filed it -->
    <div class="group" role="group" aria-label="Group saved work by">
      <button
        class="sq"
        class:on={!byFolder}
        aria-pressed={!byFolder}
        title="Group by place"
        onclick={() => (group = 'geo')}
      ><Icon name="globe" size={13} /></button>
      <button
        class="sq"
        class:on={byFolder}
        aria-pressed={byFolder}
        title="Group by My-work folder · drag rows to file them"
        onclick={() => (group = 'folders')}
      ><Icon name="folder" size={13} /></button>
    </div>
    <button class="sq browse" onclick={onbrowse} title="Search saved work with previews">…</button>
  </div>

  <div class="kinds" role="group" aria-label="What this panel lists">
    {#each KINDS as k (k.id)}
      <button
        class="kind"
        class:mode={k.mode}
        class:on={kind === k.id}
        onclick={() => (kind = k.id)}
      >{k.label}</button>
    {/each}
  </div>
</div>

{#snippet leaves(items, depth)}
  <div class="leaves" style:padding-left={`${6 + depth * 13}px`}>
    {#each items as item (item.key ?? item.id)}
      <SavedRow
        row={item}
        {caseId}
        {coords}
        {fullscreen}
        draggable={byFolder}
        hovered={hoveredId === (item.key ?? item.id)}
        onhover={(id) => (hoveredId = id)}
        ondragstart={(event) => startDrag(event, item)}
        {onopen}
        {onedit}
        {ondelete}
        {onproof}
      />
    {/each}
  </div>
{/snippet}

{#snippet branch(nodes, depth)}
  {#each nodes as node (node.key)}
    <button
      type="button"
      class="node"
      class:root={depth === 0}
      class:target={dropTarget === node.key}
      style:padding-left={`${4 + depth * 13}px`}
      onclick={() => toggle(node.key)}
      aria-expanded={isOpen(node.key)}
      ondragover={byFolder
        ? (event) => {
            event.preventDefault();
            dropTarget = node.key;
          }
        : undefined}
      ondragleave={byFolder ? () => (dropTarget = undefined) : undefined}
      ondrop={byFolder ? (event) => drop(event, node.key) : undefined}
    >
      <Icon name={isOpen(node.key) ? 'chevronDown' : 'chevronRight'} size={12} />
      <span class="name">{node.label ?? node.name}</span>
      <span class="n">{node.count}</span>
    </button>
    {#if isOpen(node.key)}
      <!-- a folder holds subfolders and items at once; a geography node never
           does, so this renders one or the other there -->
      {#if node.children.length}
        {@render branch(node.children, depth + 1)}
      {/if}
      {#if node.items.length}
        {@render leaves(node.items, depth + 1)}
      {/if}
    {/if}
  {/each}
{/snippet}

<div class="tree">
  {#if !rows.length}
    <p class="none">Save a place or capture a crop. Both land here, grouped by where they are.</p>
  {:else if !shown}
    <p class="none">Nothing saved matches that.</p>
  {:else}
    {@render branch(tree.nodes, 0)}

    <!-- the bucket that always closes the list: items with no country in the
         geography view, items you have not filed in the folder view -->
    {#if tree.trailing.count}
      <div
        class="node trailing"
        class:target={dropTarget === tree.trailing.key}
        ondragover={byFolder
          ? (event) => {
              event.preventDefault();
              dropTarget = tree.trailing.key;
            }
          : undefined}
        ondragleave={byFolder ? () => (dropTarget = undefined) : undefined}
        ondrop={byFolder ? (event) => drop(event, '') : undefined}
        role="presentation"
      >
        <button
          type="button"
          class="node-main"
          onclick={() => toggle(tree.trailing.key)}
          aria-expanded={isOpen(tree.trailing.key)}
        >
          <Icon name={isOpen(tree.trailing.key) ? 'chevronDown' : 'chevronRight'} size={12} />
          <span class="name">{tree.trailing.label}</span>
          <span class="n">{tree.trailing.count}</span>
        </button>
        {#if !byFolder}
          {#if locating}
            <span class="locating">
              {locating.done}/{locating.total}
              <button class="link" onclick={oncancelLocate}>Cancel</button>
            </span>
          {:else if pending}
            <button class="link" onclick={onlocate} title="Look up the country of {pending} item(s)">
              Locate
            </button>
          {/if}
        {/if}
      </div>
      {#if isOpen(tree.trailing.key)}
        {@render leaves(tree.trailing.items, 1)}
      {/if}
    {/if}
  {/if}
</div>

<style>
  /* the filter follows the list down: a tree hundreds of rows deep must never
     make you scroll back up to change what it is showing */
  .controls {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--bg-1);
    border-bottom: 1px solid var(--border);
    margin-bottom: 4px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 0 8px;
  }
  .head :global(.search-box) {
    flex: 1;
    min-width: 0;
  }
  .sq {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    flex-shrink: 0;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-2);
    font-size: var(--fs-md);
    line-height: 1;
    cursor: pointer;
  }
  .sq:hover {
    color: var(--accent);
    border-color: var(--accent);
  }
  /* the two groupings share a frame, so they read as one switch */
  .group {
    display: flex;
    flex-shrink: 0;
  }
  .group .sq:first-child {
    border-radius: var(--r-sm) 0 0 var(--r-sm);
  }
  .group .sq:last-child {
    border-left: none;
    border-radius: 0 var(--r-sm) var(--r-sm) 0;
  }
  .sq.on {
    background: var(--bg-3);
    color: var(--accent);
  }
  /* one control — the segments share a frame so they read as a single switch
     rather than four buttons that happen to be adjacent */
  .kinds {
    display: flex;
    padding: 2px;
    margin-bottom: 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
  }
  .kind {
    flex: 1;
    padding: 3px 0;
    border-radius: 2px;
    font-size: var(--fs-xs);
    color: var(--text-3);
    cursor: pointer;
  }
  .kind:hover {
    color: var(--text-1);
  }
  /* Proofs is a mode, not a refinement of the three to its left: the rule says
     so without spending a word on it */
  .kind.mode {
    margin-left: 5px;
    border-left: 1px solid var(--border);
    padding-left: 5px;
    border-radius: 0 2px 2px 0;
  }
  .kind.on {
    background: var(--bg-3);
    color: var(--text-1);
    font-weight: 600;
  }
  .tree {
    display: flex;
    flex-direction: column;
  }
  .node {
    display: flex;
    align-items: center;
    gap: 5px;
    width: 100%;
    padding: 5px 6px 5px 4px;
    border-radius: var(--r-sm);
    background: none;
    border: none;
    font: inherit;
    font-size: var(--fs-sm);
    color: var(--text-2);
    text-align: left;
    cursor: pointer;
  }
  .node.root {
    color: var(--text-1);
    font-weight: 600;
  }
  .node:hover {
    background: var(--bg-2);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .n {
    font-size: var(--fs-xs);
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
  }
  .leaves {
    display: flex;
    flex-direction: column;
  }
  /* the trailing bucket can carry an errand (Locate), so its label and its
     action sit side by side instead of the whole row being one button */
  .trailing {
    padding-right: 4px;
    cursor: default;
    color: var(--text-3);
  }
  .trailing:hover {
    background: none;
  }
  /* the folder currently under a dragged row */
  .node.target {
    background: var(--bg-3);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .node-main {
    display: flex;
    align-items: center;
    gap: 5px;
    flex: 1;
    min-width: 0;
    padding: 0;
    background: none;
    border: none;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .node-main:hover .name {
    color: var(--text-1);
  }
  .locating {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-xs);
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }
  .link {
    font-size: var(--fs-xs);
    color: var(--accent);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
  .none {
    padding: 10px 4px;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
</style>
