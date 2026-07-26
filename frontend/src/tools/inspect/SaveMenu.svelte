<script>
  import { caseState, uiState } from '../../lib/state.svelte.js';
  import Icon from '../../components/Icon.svelte';
  import FolderSelect from '../../components/FolderSelect.svelte';

  // Right-panel menu for the Save tab: choose a destination folder and commit the
  // ticked items. This is the *only* place the Inspect session files case
  // entities — nothing before it touched the case.
  let { savables, saveUi, saving, save } = $props();

  const folders = $derived(caseState.current?.folders ?? []);
  const count = $derived(savables.filter((it) => saveUi.selected[it.key]).length);

  function selectAll() {
    for (const it of savables) saveUi.selected[it.key] = true;
  }
  function selectNone() {
    saveUi.selected = {};
  }
</script>

<div class="module">
  <p class="hint">Tick what to save. Names carry into the Media Library with the provenance.</p>

  <div class="pickers">
    <button class="btn btn-sm" onclick={selectAll} disabled={!savables.length}>Select all</button>
    <button class="btn btn-sm" onclick={selectNone} disabled={!count}>Clear</button>
  </div>

  <label class="field">
    <span><Icon name="edit" size={14} /> Base name (optional)</span>
    <input class="input" bind:value={saveUi.baseName} placeholder="Names the batch" maxlength="200" />
  </label>

  <div class="field">
    <span><Icon name="folder" size={14} /> Folder (optional)</span>
    <FolderSelect bind:value={saveUi.folder} {folders} emptyLabel="Unfiled" />
  </div>

  <label class="field">
    <span><Icon name="note" size={14} /> Note (optional)</span>
    <textarea class="input note" bind:value={saveUi.note} rows="2" placeholder="Why these matter" maxlength="2000"></textarea>
  </label>

  <button class="btn btn-primary w-full" disabled={saving || !count} onclick={save}>
    <Icon name="save" size={15} /> {saving ? 'Saving…' : `Save ${count || ''} to case`.trim()}
  </button>

  <button class="btn btn-ghost btn-sm w-full" onclick={() => (uiState.tool = 'media')}>
    <Icon name="media" size={14} /> Open Media Library
  </button>
</div>

<style>
  .module {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .hint {
    color: var(--text-3);
    font-size: var(--fs-xs);
    margin: 0;
  }
  .pickers {
    display: flex;
    gap: 6px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: var(--fs-sm);
    color: var(--text-2);
  }
  .field span {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .note {
    resize: vertical;
  }
  .w-full {
    width: 100%;
    justify-content: center;
  }
</style>
