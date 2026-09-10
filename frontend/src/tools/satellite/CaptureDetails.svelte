<script>
  /**
   * One capture's title, folder and notes, over what the case knows about it.
   *
   * The read-only rows are the provenance an analyst checks before writing
   * anything: which provider served the pixels, at what zoom, when it was
   * taken, and the imagery's own acquisition date when the provider could say
   * it. "—" is a real answer here — no provider is asked twice to fill a gap.
   */
  import Icon from '../../components/Icon.svelte';
  import Modal from '../../components/Modal.svelte';
  import FolderSelect from '../../components/FolderSelect.svelte';
  import { fileUrl } from '../../lib/fileUrl.js';

  let {
    /** The saved-index row being edited. */
    row,
    caseId,
    folders = [],
    /** Format a row's coordinates the way the analyst set it. */
    coords,
    /** Set while the map owns the whole screen, so a new tab would go unseen. */
    leavesFullscreen = null,
    onsave,
    onclose,
  } = $props();

  // The dialog opens on the row it was given and edits copies: it is mounted
  // per row and dropped on close, so the initial value is the whole intent.
  // svelte-ignore state_referenced_locally
  let title = $state(row.title ?? coords(row));
  // svelte-ignore state_referenced_locally
  let folder = $state(row.folder ?? '');
  // svelte-ignore state_referenced_locally
  let notes = $state(row.notes ?? '');
  let saving = $state(false);

  async function save() {
    saving = true;
    try {
      await onsave({ title, folder, notes });
    } finally {
      saving = false;
    }
  }
</script>

<Modal title="Capture details" {onclose} width="420px">
  <label for="capture-title" style="display:block;font-size:var(--fs-xs);color:var(--text-3);margin-bottom:5px">Title</label>
  <input id="capture-title" class="input" placeholder={coords(row)} bind:value={title} />
  <label for="capture-folder" style="display:block;font-size:var(--fs-xs);color:var(--text-3);margin:10px 0 5px">Folder</label>
  <FolderSelect
    id="capture-folder"
    bind:value={folder}
    {folders}
    emptyLabel="My work (root)"
  />
  <hr style="border:none;border-top:1px solid var(--border);margin:12px 0" />
  <div class="sat-info-rows">
    <div class="sat-info-row">
      <span class="sat-info-label">Coordinates</span>
      <span class="mono">{coords(row)}</span>
    </div>
    <div class="sat-info-row">
      <span class="sat-info-label">Provider</span>
      <span>{row.provider ?? row.site ?? '—'}</span>
    </div>
    <div class="sat-info-row">
      <span class="sat-info-label">Zoom</span>
      <span>{row.zoom ?? '—'}</span>
    </div>
    <div class="sat-info-row">
      <span class="sat-info-label">Captured</span>
      <span class="mono">{row.fetched_at?.slice(0, 10)}</span>
    </div>
    <div class="sat-info-row">
      <span class="sat-info-label">Imagery date</span>
      <span class="mono">{row.imagery_date ?? '—'}</span>
    </div>
    <div class="sat-info-row">
      <span class="sat-info-label">Image</span>
      <a
        class="link-out"
        class:disabled={!!leavesFullscreen}
        href={leavesFullscreen ? undefined : fileUrl(caseId, row.path)}
        target="_blank"
        rel="noreferrer"
        aria-disabled={!!leavesFullscreen}
        title={leavesFullscreen ?? 'Open the full image'}
      >Open the full image <Icon name="external" size={12} /></a>
    </div>
  </div>
  <hr style="border:none;border-top:1px solid var(--border);margin:12px 0" />
  <label for="capture-notes" style="display:block;font-size:var(--fs-xs);color:var(--text-3);margin-bottom:5px">Notes</label>
  <textarea
    id="capture-notes"
    class="textarea"
    rows="5"
    placeholder="Add observations, links, context…"
    bind:value={notes}
  ></textarea>
  <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
    <button class="btn" onclick={onclose}>Cancel</button>
    <button class="btn btn-primary" onclick={save} disabled={saving}>
      {saving ? 'Saving…' : 'Save'}
    </button>
  </div>
</Modal>

<style>
  .sat-info-rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .sat-info-row {
    display: flex;
    gap: 10px;
    font-size: var(--fs-sm);
    align-items: baseline;
  }
  .sat-info-label {
    color: var(--text-3);
    font-size: var(--fs-xs);
    min-width: 80px;
    flex-shrink: 0;
  }
</style>
