<script>
  // Zone 2, browse mode: one grammar — chevron, icon, name, count — for every
  // foldable row. Suggestions is a node here, not a section above the tree, so
  // nothing below it shifts when its count crosses zero.
  import { subtreeCountFrom } from '../../lib/folderTree.js';
  import { formatSize } from '../../lib/trash.js';
  import { dragPayload, rangeSelected, toggleSelected } from '../../lib/rowSelect.js';
  import Icon from '../Icon.svelte';
  import EntityRow from './EntityRow.svelte';

  let {
    tree = [],
    byFolder = {},
    expanded = {},
    folderData = {},
    unfiled,
    unfiledOpen = false,
    suggested,
    suggestedCount = 0,
    suggestedOpen = false,
    caseId,
    ontoggle = () => {},
    onmorefolder = () => {},
    ontoggleunfiled = () => {},
    onmoreunfiled = () => {},
    ontogglesuggested = () => {},
    onmoresuggested = () => {},
    oncreatefolder = () => {},
    onremovefolder = () => {},
    onfile = () => {},
    onactivate = () => {},
    oninfo = () => {},
    onunfile = () => {},
    onconfirm = () => {},
    ondismiss = () => {},
    ondragactive = () => {},
    trash = { groups: [], items: 0, size_bytes: 0 },
    trashOpen = false,
    ontoggletrash = () => {},
    onrestore = () => {},
    onpurge = () => {},
    onempty = () => {},
  } = $props();

  let addingUnder = $state(undefined); // folder path currently gaining a child
  let newSubName = $state('');
  let dragEntityId = $state(null); // for the dragging visual
  let dragRows = null; // the entities being dragged (no full-graph lookup on drop)
  let dragOverFolder = $state(undefined); // folder path being hovered

  // ── multi-select (lib/rowSelect.js) ───────────────────────────────────────
  // Ctrl/cmd-click picks rows one by one, shift-click takes a run of them, and
  // the drag moves the lot. The range needs the rows in display order, so this
  // walks the tree exactly as the markup renders it: an expanded node's
  // children first, then its own entities, with Unfiled last.
  let selected = $state(new Set());
  let anchorId = null;

  const visibleRows = $derived.by(() => {
    const out = [];
    const walk = (nodes) => {
      for (const node of nodes) {
        if (expanded[node.path] !== true) continue;
        walk(node.children);
        const sec = folderData[node.path];
        if (sec) out.push(...sec.items);
      }
    };
    walk(tree);
    if (unfiledOpen) out.push(...unfiled.items);
    return out;
  });

  // A row that scrolled out of the tree (folder collapsed, case reloaded) must
  // not keep a selection nobody can see or drop.
  $effect(() => {
    const live = new Set(visibleRows.map((r) => r.id));
    const stale = [...selected].filter((id) => !live.has(id));
    if (stale.length) selected = new Set([...selected].filter((id) => live.has(id)));
  });

  function onRowClick(entity, ev) {
    if (ev?.shiftKey) {
      selected = rangeSelected(visibleRows.map((r) => r.id), anchorId ?? entity.id, entity.id);
      return;
    }
    if (ev?.ctrlKey || ev?.metaKey) {
      selected = toggleSelected(selected, entity.id);
      anchorId = entity.id;
      return;
    }
    selected = new Set();
    anchorId = entity.id;
    onactivate(entity);
  }

  const isExpanded = (path) => expanded[path] === true;
  function focus(node) { node.focus(); }

  function startAddSub(path) {
    addingUnder = path;
    newSubName = '';
    if (!isExpanded(path)) ontoggle(path);
  }
  function submitAddSub() {
    const name = newSubName.trim();
    const parent = addingUnder;
    addingUnder = undefined;
    newSubName = '';
    if (!name || parent === undefined) return;
    oncreatefolder(parent ? `${parent}/${name}` : name);
  }

  function onDragStart(ev, entity) {
    dragRows = dragPayload(visibleRows, selected, entity);
    dragEntityId = entity.id;
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', dragRows.map((r) => r.id).join(' '));
    ondragactive(true);
  }
  function onDragEnd() {
    dragEntityId = null;
    dragRows = null;
    dragOverFolder = undefined;
    ondragactive(false);
  }
  function onDropFolder(ev, folder) {
    ev.preventDefault();
    const rows = dragRows;
    onDragEnd();
    if (!rows?.length) return;
    selected = new Set();
    onfile(rows, folder);
  }
  // The whole selection dims, not just the row under the cursor. Keyed on
  // `dragEntityId` because `dragRows` is deliberately non-reactive.
  const isDragging = (id) => dragEntityId === id || (dragEntityId !== null && selected.has(id));
</script>

<div class="tree">
  {#if suggestedCount > 0}
    <div
      class="frow"
      role="button"
      tabindex="0"
      onclick={ontogglesuggested}
      onkeydown={(e) => e.key === 'Enter' && ontogglesuggested()}
    >
      <Icon name={suggestedOpen ? 'chevronDown' : 'chevronRight'} size={12} />
      <Icon name="wand" size={13} />
      <span class="fname">Suggestions</span>
      <span class="fcount">{suggestedCount}</span>
    </div>
    {#if suggestedOpen}
      {#each suggested.items as e (e.id)}
        <EntityRow entity={e} {caseId} depth={1} suggested {onconfirm} {ondismiss} />
      {/each}
      {#if !suggested.done}
        <button class="more" onclick={onmoresuggested} disabled={suggested.loading}>Show more</button>
      {/if}
    {/if}
  {/if}

  {#each tree as node (node.path)}
    {@render folderNode(node, 0)}
  {/each}

  {#if unfiled.items.length > 0}
    <div
      class="frow"
      role="button"
      tabindex="0"
      ondragover={(e) => { e.preventDefault(); dragOverFolder = ''; }}
      ondragleave={() => (dragOverFolder = undefined)}
      ondrop={(e) => onDropFolder(e, '')}
      class:dropping={dragOverFolder === ''}
      onclick={ontoggleunfiled}
      onkeydown={(e) => e.key === 'Enter' && ontoggleunfiled()}
    >
      <Icon name={unfiledOpen ? 'chevronDown' : 'chevronRight'} size={12} />
      <Icon name="layers" size={13} />
      <span class="fname">Unfiled</span>
      <span class="fcount">{unfiled.items.length}{unfiled.done ? '' : '+'}</span>
    </div>
    {#if unfiledOpen}
      {#each unfiled.items as e (e.id)}
        <EntityRow
          entity={e}
          {caseId}
          depth={1}
          dragging={isDragging(e.id)}
          selected={selected.has(e.id)}
          ondragstart={onDragStart}
          ondragend={onDragEnd}
          onactivate={onRowClick}
          {oninfo}
          {onunfile}
        />
      {/each}
      {#if !unfiled.done}
        <button class="more" onclick={onmoreunfiled} disabled={unfiled.loading}>Show more</button>
      {/if}
    {/if}
  {/if}

  <!-- Deleted work waits here until it is restored or the trash is emptied.
       Rendered only when it holds something, so an untouched case shows nothing
       about deletion. -->
  {#if trash.groups.length > 0}
    <div class="trash-head">
      <button
        class="frow trash-toggle"
        type="button"
        onclick={ontoggletrash}
        aria-expanded={trashOpen}
      >
        <Icon name={trashOpen ? 'chevronDown' : 'chevronRight'} size={12} />
        <Icon name="trash" size={13} />
        <span class="fname">Trash</span>
        <span class="fcount">{trash.items} · {formatSize(trash.size_bytes)}</span>
      </button>
      <button
        class="fact fdel trash-empty"
        type="button"
        title="Empty the trash"
        aria-label="Empty the trash"
        onclick={onempty}
      >
        <Icon name="trash" size={12} />
      </button>
    </div>
    {#if trashOpen}
      {#each trash.groups as group (group.id)}
        <div class="trow">
          <span class="tname" title={group.label}>{group.label}</span>
          {#if group.item_count > 1}
            <span class="tcount">+{group.item_count - 1}</span>
          {/if}
          <button
            class="tact"
            type="button"
            title="Restore"
            aria-label={`Restore ${group.label}`}
            onclick={() => onrestore(group)}
          >
            <Icon name="undo" size={12} />
          </button>
          <button
            class="tact tdel"
            type="button"
            title="Delete permanently"
            aria-label={`Delete ${group.label} permanently`}
            onclick={() => onpurge(group)}
          >
            <Icon name="trash" size={12} />
          </button>
        </div>
      {/each}
    {/if}
  {/if}

  {#if tree.length === 0 && unfiled.items.length === 0 && suggestedCount === 0 && trash.groups.length === 0}
    <div class="none">Everything you save lands here; create folders to organize it.</div>
  {/if}
</div>

<!-- one folder node + its subtree (recursive) -->
{#snippet folderNode(node, depth)}
  <div
    class="frow"
    class:dropping={dragOverFolder === node.path}
    style="padding-left: {8 + depth * 14}px"
    role="button"
    tabindex="0"
    ondragover={(e) => { e.preventDefault(); dragOverFolder = node.path; }}
    ondragleave={() => (dragOverFolder = undefined)}
    ondrop={(e) => onDropFolder(e, node.path)}
    onclick={() => ontoggle(node.path)}
    onkeydown={(e) => e.key === 'Enter' && ontoggle(node.path)}
  >
    <Icon name={isExpanded(node.path) ? 'chevronDown' : 'chevronRight'} size={12} />
    <Icon name={isExpanded(node.path) ? 'folderOpen' : 'folder'} size={13} />
    <span class="fname">{node.name}</span>
    <span class="fcount">{subtreeCountFrom(node, byFolder)}</span>
    <span
      class="fact"
      role="button"
      tabindex="0"
      title="Add subfolder"
      onclick={(e) => { e.stopPropagation(); startAddSub(node.path); }}
      onkeydown={(e) => e.key === 'Enter' && (e.stopPropagation(), startAddSub(node.path))}
    >
      <Icon name="plus" size={12} />
    </span>
    <span
      class="fact fdel"
      role="button"
      tabindex="0"
      title="Remove folder"
      onclick={(e) => { e.stopPropagation(); onremovefolder(node.path); }}
      onkeydown={(e) => e.key === 'Enter' && (e.stopPropagation(), onremovefolder(node.path))}
    >
      <Icon name="folderMinus" size={12} />
    </span>
  </div>
  {#if isExpanded(node.path)}
    {#if addingUnder === node.path}
      <form
        class="new-folder"
        style="padding-left: {8 + (depth + 1) * 14}px"
        onsubmit={(e) => { e.preventDefault(); submitAddSub(); }}
      >
        <input
          class="input"
          placeholder="Subfolder…"
          bind:value={newSubName}
          use:focus
          onkeydown={(e) => e.key === 'Escape' && (addingUnder = undefined)}
        />
        <button class="btn btn-sm" type="submit" title="Create" disabled={!newSubName.trim()}>
          <Icon name="plus" size={13} />
        </button>
      </form>
    {/if}
    {#each node.children as child (child.path)}
      {@render folderNode(child, depth + 1)}
    {/each}
    {@const sec = folderData[node.path]}
    {#if sec}
      {#each sec.items as e (e.id)}
        <EntityRow
          entity={e}
          {caseId}
          depth={depth + 1}
          dragging={isDragging(e.id)}
          selected={selected.has(e.id)}
          ondragstart={onDragStart}
          ondragend={onDragEnd}
          onactivate={onRowClick}
          {oninfo}
          {onunfile}
        />
      {/each}
      {#if !sec.done}
        <button
          class="more"
          style="margin-left: {8 + (depth + 1) * 14}px"
          onclick={() => onmorefolder(node.path)}
          disabled={sec.loading}
        >
          Show more
        </button>
      {/if}
    {/if}
  {/if}
{/snippet}

<style>
  .tree { display: flex; flex-direction: column; gap: 1px; padding: 0 4px 8px; }
  .frow {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 6px 8px;
    border-radius: var(--r-sm);
    color: var(--text-2);
    font-size: var(--fs-sm);
    border: 1px solid transparent;
    cursor: pointer;
    text-align: left;
  }
  .frow:hover { background: var(--bg-2); }
  .frow.dropping { border-color: var(--accent); background: var(--accent-soft); }
  .frow > :global(svg:first-child) { color: var(--text-3); flex-shrink: 0; }
  .fname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fcount { color: var(--text-3); font-size: var(--fs-xs); font-weight: 600; }
  .fact { opacity: 0; color: var(--text-3); display: flex; padding: 2px; border-radius: 4px; flex-shrink: 0; }
  .fact:hover { color: var(--text-1); }
  .fdel:hover { color: var(--danger, #e55); }
  .frow:hover .fact { opacity: 1; }
  .trash-head { display: flex; align-items: center; position: relative; }
  .trash-toggle { padding-right: 34px; }
  .trash-empty { position: absolute; right: 12px; }
  .trash-head:hover .trash-empty,
  .trash-head:focus-within .trash-empty,
  .trash-empty:focus-visible { opacity: 1; }
  .new-folder { display: flex; gap: 6px; padding: 2px 8px 4px; }
  .new-folder .input { flex: 1; font-size: var(--fs-xs); }
  .more {
    align-self: flex-start;
    margin: 2px 8px 6px;
    padding: 3px 10px;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-2);
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  .more:hover { color: var(--text-1); border-color: var(--border-strong); }
  .more:disabled { opacity: 0.5; cursor: default; }
  .none { font-size: var(--fs-xs); color: var(--text-3); padding: 4px 8px 12px; line-height: 1.45; }
  .trow {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px 5px 30px;
    border-radius: var(--r-sm);
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .trow:hover { background: var(--bg-2); }
  .tname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tcount { font-weight: 600; }
  .tact { opacity: 0; color: var(--text-3); display: flex; padding: 2px; border-radius: 4px; cursor: pointer; }
  .trow:hover .tact,
  .trow:focus-within .tact,
  .tact:focus-visible { opacity: 1; }
  .tact:hover { color: var(--text-1); }
  .tdel:hover { color: var(--danger, #e55); }
</style>
