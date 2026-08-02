<script>
  /**
   * The destination picker every export shares: browse the filesystem, or go
   * back to the case's own exports folder.
   *
   * A browser has no folder dialog that hands back a real path, so the walking
   * happens server-side (`/api/folders`, engine/exportdir.py) and only folder
   * names ever come back. Choosing saves the folder for that kind of export, so
   * the next export goes there without asking.
   */
  import {
    CASE_FOLDER_LABEL,
    createFolder,
    folderRoots,
    listFolder,
    saveDestination,
  } from '../lib/exportDest.js';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';

  let {
    kind,
    current = '',
    confirmLabel = 'Use this folder',
    onclose,
    onchosen,
  } = $props();

  let roots = $state([]);
  let view = $state(null); // { path, crumbs, folders, writable, truncated }
  let error = $state('');
  let busy = $state(false);
  let naming = $state(false);
  let newName = $state('');

  $effect(() => {
    start();
  });

  async function start() {
    try {
      roots = (await folderRoots()).roots;
    } catch (e) {
      error = e.message || 'Could not read your folders';
      return;
    }
    // Open where the exports already go, so "change it slightly" is one click.
    const opening = current || roots[0]?.path;
    if (opening) await open(opening);
  }

  async function open(path) {
    error = '';
    naming = false;
    try {
      view = await listFolder(path);
    } catch (e) {
      error = e.message || 'Could not open that folder';
    }
  }

  async function make() {
    if (!newName.trim()) return;
    busy = true;
    error = '';
    try {
      const made = await createFolder(view.path, newName);
      newName = '';
      naming = false;
      await open(made.path);
    } catch (e) {
      error = e.message || 'Could not create that folder';
    } finally {
      busy = false;
    }
  }

  async function choose(path) {
    busy = true;
    error = '';
    try {
      const saved = await saveDestination(kind, path);
      onchosen?.(saved[kind]);
      onclose?.();
    } catch (e) {
      error = e.message || 'Could not save that folder';
    } finally {
      busy = false;
    }
  }
</script>

<Modal title="Export destination" {onclose} width="560px">
  <div class="picker">
    <div class="roots">
      {#each roots as root (root.path)}
        <button
          class="btn btn-sm"
          class:active={view?.path === root.path}
          onclick={() => open(root.path)}
          title={root.path}
        >
          {root.label}
        </button>
      {/each}
    </div>

    {#if view}
      <div class="crumbs">
        {#each view.crumbs as crumb (crumb.path)}
          <button class="crumb" onclick={() => open(crumb.path)} title={crumb.path}>
            {crumb.name}
          </button>
        {/each}
      </div>

      <div class="folders">
        {#each view.folders as folder (folder.path)}
          <button class="row" onclick={() => open(folder.path)} ondblclick={() => open(folder.path)}>
            <Icon name="folder" size={14} />
            <span>{folder.name}</span>
          </button>
        {:else}
          <p class="empty">No folders here.</p>
        {/each}
      </div>

      {#if view.truncated}
        <p class="note">Only the first folders are listed. Open one to go deeper.</p>
      {/if}
    {/if}

    {#if error}<p class="problem">{error}</p>{/if}

    {#if naming}
      <div class="new-folder">
        <input
          class="input"
          bind:value={newName}
          placeholder="Folder name"
          aria-label="New folder name"
          onkeydown={(e) => e.key === 'Enter' && make()}
        />
        <button class="btn btn-sm" onclick={make} disabled={busy || !newName.trim()}>Create</button>
        <button class="btn btn-ghost btn-sm" onclick={() => (naming = false)}>Cancel</button>
      </div>
    {/if}

    <footer>
      <button
        class="btn btn-sm"
        onclick={() => (naming = true)}
        disabled={busy || !view?.writable || naming}
      >
        New folder
      </button>
      <span class="spacer"></span>
      <button class="btn btn-sm" onclick={() => choose('')} disabled={busy || !current}>
        Use {CASE_FOLDER_LABEL}
      </button>
      <button
        class="btn btn-sm btn-primary"
        onclick={() => choose(view.path)}
        disabled={busy || !view?.writable}
      >
        {confirmLabel}
      </button>
    </footer>

    {#if view && !view.writable}
      <p class="note">Azimut can't write in that folder. Pick another one.</p>
    {/if}
  </div>
</Modal>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .roots {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .roots .active {
    border-color: var(--accent);
    color: var(--accent);
  }
  .crumbs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
    font-size: 12px;
  }
  .crumb {
    background: none;
    border: 0;
    padding: 2px 4px;
    color: var(--muted);
    cursor: pointer;
    border-radius: 4px;
  }
  .crumb:hover {
    color: var(--text);
    background: var(--surface-2);
  }
  .crumb + .crumb::before {
    content: '/';
    margin-right: 6px;
    color: var(--muted);
  }
  .folders {
    height: 240px;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    background: none;
    border: 0;
    border-radius: 4px;
    color: var(--text);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }
  .row:hover {
    background: var(--surface-2);
  }
  .empty,
  .note {
    color: var(--muted);
    font-size: 12px;
    margin: 8px 4px;
  }
  .problem {
    color: var(--danger);
    font-size: 12px;
    margin: 0 4px;
  }
  .new-folder {
    display: flex;
    gap: 6px;
  }
  .new-folder .input {
    flex: 1;
  }
  footer {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .spacer {
    flex: 1;
  }
</style>
