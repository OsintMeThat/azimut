<script>
  import Icon from './Icon.svelte';
  import { buildTree, flattenPaths } from '../lib/folderTree.js';
  import { portal } from '../lib/fullscreen.js';

  // A folder picker that only lets you choose an existing My-work folder or
  // deliberately create a new one — no free-typing a stray path by accident.
  let {
    value = $bindable(''),
    folders = [],
    emptyLabel = 'No folder',
    allowCreate = true,
    id = undefined,
  } = $props();

  let open = $state(false);
  let creating = $state(false);
  let newName = $state('');
  let triggerEl = $state(null);
  // The menu is portaled to <body> (so a modal's overflow can't clip it) and
  // fixed-positioned onto the trigger. These hold the computed placement.
  let menuStyle = $state('');

  const GAP = 4; // px between trigger and menu
  const MARGIN = 12; // keep the menu this far from the viewport edge

  function openMenu() {
    const r = triggerEl?.getBoundingClientRect();
    if (r) {
      const below = window.innerHeight - r.bottom;
      // Open upward when the field sits near the bottom (e.g. a modal footer).
      const up = below < 300 && r.top > below;
      const space = (up ? r.top : below) - GAP - MARGIN;
      const vpos = up
        ? `bottom:${window.innerHeight - r.top + GAP}px`
        : `top:${r.bottom + GAP}px`;
      menuStyle = `left:${r.left}px; width:${r.width}px; ${vpos}; max-height:${Math.round(space)}px`;
    }
    open = true;
  }

  // Depth-first, so children sit under their parent; depth drives indentation.
  const options = $derived(
    flattenPaths(buildTree(folders ?? [], [])).map((p) => ({
      path: p,
      name: p.split('/').pop(),
      depth: p.split('/').length - 1,
    }))
  );

  function close() {
    open = false;
    creating = false;
    newName = '';
  }
  function pick(p) {
    value = p;
    close();
  }
  function commitNew() {
    // Trim and drop leading/trailing slashes; nested paths (a/b) are allowed.
    const name = newName.trim().replace(/^\/+|\/+$/g, '');
    if (!name) return;
    pick(name);
  }
</script>

<div class="folder-select">
  <button
    type="button"
    class="trigger"
    {id}
    bind:this={triggerEl}
    onclick={() => (open ? close() : openMenu())}
    aria-haspopup="listbox"
    aria-expanded={open}
  >
    <Icon name={value ? 'folder' : 'folderMinus'} size={14} />
    <span class="cur" class:none={!value}>{value || emptyLabel}</span>
    <Icon name="chevronDown" size={14} />
  </button>

  {#if open}
    <button class="backdrop" onclick={close} aria-label="Close folder picker" use:portal></button>
    <div class="menu card" role="listbox" use:portal style={menuStyle}>
      <button class="opt" class:active={!value} onclick={() => pick('')}>
        <Icon name="folderMinus" size={14} />
        <span class="grow">{emptyLabel}</span>
        {#if !value}<Icon name="check" size={14} />{/if}
      </button>

      {#if options.length}
        <div class="sep"></div>
        {#each options as o (o.path)}
          <button
            class="opt"
            class:active={value === o.path}
            style:padding-left={`${10 + o.depth * 14}px`}
            onclick={() => pick(o.path)}
            title={o.path}
          >
            <Icon name="folder" size={14} />
            <span class="grow">{o.name}</span>
            {#if value === o.path}<Icon name="check" size={14} />{/if}
          </button>
        {/each}
      {/if}

      {#if allowCreate}
        <div class="sep"></div>
        {#if creating}
          <form
            class="create"
            onsubmit={(e) => {
              e.preventDefault();
              commitNew();
            }}
          >
            <!-- svelte-ignore a11y_autofocus -->
            <input class="input" placeholder="New folder name…" bind:value={newName} autofocus />
            <button type="submit" class="btn btn-primary btn-sm" disabled={!newName.trim()}>
              Add
            </button>
          </form>
        {:else}
          <button class="opt new" onclick={() => (creating = true)}>
            <Icon name="plus" size={14} /> New folder…
          </button>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .folder-select {
    position: relative;
  }
  .trigger {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    color: var(--text-1);
    font-size: var(--fs-sm);
    text-align: left;
  }
  .trigger:hover {
    border-color: var(--border-strong);
  }
  .cur {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cur.none {
    color: var(--text-3);
  }
  /* Portaled to <body>, so they sit above the modal overlay (z-index 900). */
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 940;
    cursor: default;
  }
  .menu {
    position: fixed;
    min-width: 220px;
    overflow: auto;
    z-index: 950;
    box-shadow: var(--shadow-2);
    padding: 5px;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 10px;
    border-radius: var(--r-sm);
    font-size: var(--fs-sm);
    color: var(--text-1);
    text-align: left;
  }
  .opt:hover {
    background: var(--bg-2);
  }
  .opt.active {
    background: var(--bg-3);
  }
  .opt.new {
    color: var(--accent);
    font-weight: 600;
  }
  .grow {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sep {
    height: 1px;
    background: var(--border);
    margin: 5px 0;
  }
  .create {
    display: flex;
    gap: 6px;
    padding: 4px;
  }
  .create .input {
    flex: 1;
    min-width: 0;
  }
</style>
