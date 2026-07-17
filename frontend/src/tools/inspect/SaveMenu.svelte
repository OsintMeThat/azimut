<script>
  import { caseState, uiState } from '../../lib/state.svelte.js';
  import Icon from '../../components/Icon.svelte';

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
  <p class="hint">Tick what to save; it lands in the Media Library with its provenance.</p>

  <div class="pickers">
    <button class="btn btn-sm" onclick={selectAll} disabled={!savables.length}>Select all</button>
    <button class="btn btn-sm" onclick={selectNone} disabled={!count}>Clear</button>
  </div>

  <label class="folder">
    <span><Icon name="folder" size={14} /> Folder (optional)</span>
    <input list="inspect-folders" placeholder="Unfiled" bind:value={saveUi.folder} />
    <datalist id="inspect-folders">
      {#each folders as f (f)}<option value={f}></option>{/each}
    </datalist>
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
  .folder {
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: var(--fs-sm);
    color: var(--text-2);
  }
  .folder span {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .folder input {
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    padding: 6px 8px;
    color: var(--text-1);
    font-size: var(--fs-sm);
  }
  .w-full {
    width: 100%;
    justify-content: center;
  }
</style>
