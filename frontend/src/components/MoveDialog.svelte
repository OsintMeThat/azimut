<script>
  /**
   * Move to…: refile what `uiState.moving` names into one folder. Mounted once,
   * so Files, the sidebar and a toast that filed something into the work folder
   * all open the same dialog.
   */
  import { caseState, reloadCase, toast, uiState } from '../lib/state.svelte.js';
  import { assignFolderBatch } from '../lib/filing.js';
  import { folderOf } from '../lib/folderTree.js';
  import Modal from './Modal.svelte';
  import FolderSelect from './FolderSelect.svelte';

  const items = $derived(uiState.moving ?? []);
  // Where they already are, when they share one folder: the picker starts there.
  const shared = $derived.by(() => {
    const folders = new Set(items.map((e) => folderOf(e) ?? ''));
    return folders.size === 1 ? [...folders][0] : '';
  });
  let folder = $state('');
  let busy = $state(false);
  let openedOn = null;
  $effect(() => {
    if (uiState.moving !== openedOn) {
      openedOn = uiState.moving;
      folder = shared;
    }
  });

  const title = $derived(
    items.length === 1 ? `Move “${items[0].label}”` : `Move ${items.length} items`
  );

  function close() {
    if (!busy) uiState.moving = null;
  }

  async function move() {
    const caseId = caseState.current?.id;
    if (!caseId || busy) return;
    busy = true;
    try {
      await assignFolderBatch(caseId, items, folder);
      await reloadCase();
      toast(
        `Moved ${items.length === 1 ? `“${items[0].label}”` : `${items.length} items`} to ${folder || 'Unfiled'}`,
        'ok',
        2200
      );
      uiState.moving = null;
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      busy = false;
    }
  }
</script>

{#if items.length && caseState.current}
  <Modal {title} onclose={close} width="420px">
    <span class="label">Folder</span>
    <FolderSelect bind:value={folder} folders={caseState.current.folders ?? []} emptyLabel="Unfiled" />
    <div class="row">
      <div class="grow"></div>
      <button class="btn" onclick={close} disabled={busy}>Cancel</button>
      <button class="btn btn-primary" onclick={move} disabled={busy || folder === shared}>
        {busy ? 'Moving…' : 'Move'}
      </button>
    </div>
  </Modal>
{/if}

<style>
  .label { display: block; font-size: var(--fs-xs); color: var(--text-3); margin: 2px 0 6px; }
  .row { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
  .grow { flex: 1; }
</style>
