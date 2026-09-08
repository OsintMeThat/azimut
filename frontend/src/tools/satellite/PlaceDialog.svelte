<script>
  /**
   * A place, being saved or edited: its title, folder, notes and what it
   * claims.
   *
   * The relations are here rather than only in the sidebar because this is the
   * moment the analyst still knows *why* the point is being saved — the photo it
   * geolocates, the video whose metadata pointed here. And a point that can gain
   * a relation here has to be able to lose one here too, which is why an
   * existing place shows what it already holds.
   *
   * The draft is the caller's object, edited in place: it carries the
   * coordinates, the zoom and the bearing the map was on, none of which this
   * dialog may change.
   */
  import Modal from '../../components/Modal.svelte';
  import FolderSelect from '../../components/FolderSelect.svelte';
  import RelationList from '../../components/RelationList.svelte';
  import RelationPicker from '../../components/RelationPicker.svelte';

  let {
    /** `{ id, title, notes, folder, lat, lon, zoom, bearing, relation, relations }`;
     *  a null id means this point does not exist yet. */
    draft,
    caseId,
    folders = [],
    saving = false,
    /** Format the point the way the analyst set it. */
    coords,
    onsave,
    onclose,
    /** Follow a related entity into its own tool, which closes this. */
    onwalk,
    /** A relation was corrected or taken back: re-read them. */
    onchanged,
  } = $props();
</script>

<Modal title={draft.id ? 'Edit place' : 'Save place'} {onclose} width="420px">
  <label for="place-title" style="display:block;font-size:var(--fs-xs);color:var(--text-3);margin-bottom:5px">Title</label>
  <input id="place-title" class="input" placeholder={coords(draft)} bind:value={draft.title} />
  <label for="place-folder" style="display:block;font-size:var(--fs-xs);color:var(--text-3);margin:10px 0 5px">Folder</label>
  <FolderSelect
    id="place-folder"
    bind:value={draft.folder}
    {folders}
    emptyLabel="My work (root)"
  />
  <hr style="border:none;border-top:1px solid var(--border);margin:12px 0" />
  <div class="sat-info-rows">
    <div class="sat-info-row">
      <span class="sat-info-label">Coordinates</span>
      <span class="mono">{coords(draft)}</span>
    </div>
    <div class="sat-info-row">
      <span class="sat-info-label">Zoom</span>
      <span>z{draft.zoom}{draft.bearing ? ` · ${Math.round(draft.bearing)}°` : ''}</span>
    </div>
  </div>
  <hr style="border:none;border-top:1px solid var(--border);margin:12px 0" />
  <span style="display:block;font-size:var(--fs-xs);color:var(--text-3);margin-bottom:5px">Relations</span>
  {#if draft.relations?.length}
    <RelationList
      {caseId}
      relations={draft.relations}
      subjectType="place"
      actionFilter="relation"
      {onwalk}
      {onchanged}
    />
  {/if}
  <RelationPicker subjectType="place" bind:value={draft.relation} />
  <hr style="border:none;border-top:1px solid var(--border);margin:12px 0" />
  <label for="place-notes" style="display:block;font-size:var(--fs-xs);color:var(--text-3);margin-bottom:5px">Notes</label>
  <textarea
    id="place-notes"
    class="textarea"
    rows="5"
    placeholder="Add observations, links, context…"
    bind:value={draft.notes}
  ></textarea>
  <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
    <button class="btn" onclick={onclose}>Cancel</button>
    <button class="btn btn-primary" onclick={onsave} disabled={saving}>
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
