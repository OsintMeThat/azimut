<script>
  import { api } from '../lib/api.js';
  import { caseState, uiState, reloadCase, toast } from '../lib/state.svelte.js';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';

  const ENTITY_ICONS = {
    person: 'user',
    organization: 'layers',
    alias: 'user',
    account: 'globe',
    email: 'note',
    phone: 'hash',
    place: 'pin',
    event: 'clock',
    media: 'image',
    proof: 'proof',
    post: 'post',
    domain: 'globe',
    ip: 'hash',
    vehicle: 'grip',
    note: 'note',
  };

  // Tool to open when clicking a given entity type
  const ENTITY_TOOL = { media: 'media', proof: 'proof', place: 'satellite', post: 'post' };

  // ── case notes (single notes.md) ─────────────────────────────────────────
  let caseNotes = $state('');
  let caseNotesLoadedFor = $state(null);
  let saveTimer;
  let saved = $state(true);
  let section = $state({ notes: false, folders: true, entities: true });

  $effect(() => {
    const id = caseState.current?.id;
    if (id && id !== caseNotesLoadedFor) {
      caseNotesLoadedFor = id;
      api.get(`/api/cases/${id}/notes`).then((r) => (caseNotes = r.text));
    } else if (!id) {
      caseNotesLoadedFor = null;
      caseNotes = '';
    }
  });

  function onCaseNotesInput() {
    saved = false;
    clearTimeout(saveTimer);
    const id = caseState.current?.id;
    saveTimer = setTimeout(async () => {
      if (!id) return;
      try {
        await api.put(`/api/cases/${id}/notes`, { text: caseNotes });
        saved = true;
      } catch (e) {
        toast(`Notes not saved: ${e.message}`, 'danger');
      }
    }, 700);
  }

  // ── entities ─────────────────────────────────────────────────────────────
  async function confirmEntity(entity) {
    await api.patch(`/api/cases/${caseState.current.id}/entities/${entity.id}`, {
      status: 'confirmed',
    });
    await reloadCase();
  }

  async function removeEntity(entity) {
    if (!confirm(`Delete "${entity.label}"?`)) return;
    await api.del(`/api/cases/${caseState.current.id}/entities/${entity.id}`);
    await reloadCase();
    toast(`Removed "${entity.label}"`, 'info');
  }

  function openEntity(entity) {
    if (entity.type === 'proof') {
      // load the proof spec into the composer, then switch tab
      const spec = entity.attrs?.spec ?? '';
      const name = spec.replace(/^proofs\//, '').replace(/\.json$/, '');
      if (name) uiState.openProof = name;
      uiState.tool = 'proof';
      return;
    }
    if (entity.type === 'post') {
      // load the draft into the Post Composer, then switch tab
      const draft = entity.attrs?.draft ?? '';
      const name = draft.replace(/^exports\//, '').replace(/\.json$/, '');
      if (name) uiState.openDraft = name;
      uiState.tool = 'post';
      return;
    }
    if (entity.type === 'place') {
      // fly the Satellite map to the point, then switch tab
      const lat = Number(entity.attrs?.lat);
      const lon = Number(entity.attrs?.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        uiState.gotoCoords = { lat, lon };
      }
      uiState.tool = 'satellite';
      return;
    }
    const tool = ENTITY_TOOL[entity.type];
    if (tool) uiState.tool = tool;
  }

  const entities = $derived(caseState.current?.entities ?? []);
  const suggested = $derived(entities.filter((e) => e.provenance?.status === 'suggested'));
  const confirmed = $derived(entities.filter((e) => e.provenance?.status !== 'suggested'));

  const folderOf = (e) => e.attrs?.folder || null;

  // ── folders (managed here, drag & drop assignment) ────────────────────────
  let folderFilter = $state(null); // null = all, '' = unfiled sentinel
  let newFolder = $state('');
  let dragEntityId = $state(null);
  let dragOverFolder = $state(undefined); // folder name or '' (unfiled) being hovered

  // known folders = persisted case folders ∪ folders in use on entities
  const caseFolders = $derived(caseState.current?.folders ?? []);
  const usedFolders = $derived(
    [...new Set(entities.map(folderOf).filter(Boolean))]
  );
  const allFolders = $derived(
    [...new Set([...caseFolders, ...usedFolders])].sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    )
  );

  const filteredConfirmed = $derived(
    folderFilter === null
      ? confirmed
      : confirmed.filter((e) => (folderOf(e) ?? '') === folderFilter)
  );
  const filteredSuggested = $derived(
    folderFilter === null || folderFilter === ''
      ? suggested
      : []
  );

  function countInFolder(f) {
    return entities.filter((e) => (folderOf(e) ?? '') === f).length;
  }

  async function createFolder() {
    const name = newFolder.trim();
    if (!name) return;
    newFolder = '';
    try {
      await api.post(`/api/cases/${caseState.current.id}/folders`, { name });
      await reloadCase();
      folderFilter = name;
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  async function assignFolder(entity, folder) {
    const val = folder || '';
    try {
      if (entity.type === 'media' && entity.attrs?.path) {
        await api.patch(`/api/cases/${caseState.current.id}/media`, {
          path: entity.attrs.path,
          folder: val,
        });
      } else {
        await api.patch(`/api/cases/${caseState.current.id}/entities/${entity.id}`, {
          attrs: { folder: val },
        });
      }
      await reloadCase();
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  async function deleteFolder(f) {
    if (!confirm(`Delete folder "${f}"? Items inside become unfiled.`)) return;
    const inside = entities.filter((e) => folderOf(e) === f);
    for (const e of inside) {
      // clear each entity's folder (keeps media sidecars in sync)
      if (e.type === 'media' && e.attrs?.path) {
        await api.patch(`/api/cases/${caseState.current.id}/media`, {
          path: e.attrs.path, folder: '',
        });
      } else {
        await api.patch(`/api/cases/${caseState.current.id}/entities/${e.id}`, {
          attrs: { folder: '' },
        });
      }
    }
    await api.del(`/api/cases/${caseState.current.id}/folders?name=${encodeURIComponent(f)}`);
    await reloadCase();
    if (folderFilter === f) folderFilter = null;
  }

  // drag & drop wiring
  function onDragStart(ev, entity) {
    dragEntityId = entity.id;
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', entity.id);
  }
  function onDropFolder(ev, folder) {
    ev.preventDefault();
    dragOverFolder = undefined;
    const entity = entities.find((e) => e.id === dragEntityId);
    dragEntityId = null;
    if (entity) assignFolder(entity, folder);
  }

  // ── entity info modal (media details) ─────────────────────────────────────
  let infoEntity = $state(null);
  let infoData = $state(null); // resolved media listing item (or null)
  let infoLoading = $state(false);

  async function openInfo(entity) {
    infoEntity = entity;
    infoData = null;
    if (entity.type === 'media' && entity.attrs?.path) {
      infoLoading = true;
      try {
        const list = await api.get(`/api/cases/${caseState.current.id}/media`);
        infoData = list.find((m) => m.path === entity.attrs.path) ?? null;
      } catch {
        infoData = null;
      } finally {
        infoLoading = false;
      }
    }
  }

  function fmtSize(bytes) {
    if (bytes == null) return '';
    if (bytes >= 1 << 30) return (bytes / (1 << 30)).toFixed(1) + ' GB';
    if (bytes >= 1 << 20) return (bytes / (1 << 20)).toFixed(1) + ' MB';
    if (bytes >= 1 << 10) return (bytes / (1 << 10)).toFixed(0) + ' KB';
    return bytes + ' B';
  }

  // ── note entities ─────────────────────────────────────────────────────────
  let noteModal = $state(null);
  // shape: { entity: obj|null, title: string, folder: string, content: string }
  let noteModalSaving = $state(false);

  function openNewNote() {
    noteModal = { entity: null, title: '', folder: folderFilter || '', content: '' };
  }

  function openEditNote(entity) {
    noteModal = {
      entity,
      title: entity.label,
      folder: entity.attrs?.folder ?? '',
      content: entity.attrs?.content ?? '',
    };
  }

  async function saveNote() {
    if (!noteModal) return;
    const { entity, title, folder, content } = noteModal;
    if (!title.trim()) { toast('Title required', 'warn'); return; }
    noteModalSaving = true;
    try {
      const attrs = { content, folder: folder.trim() };
      if (!entity) {
        await api.post(`/api/cases/${caseState.current.id}/entities`, {
          type: 'note', label: title.trim(), attrs,
        });
        toast('Note created', 'ok', 1600);
      } else {
        await api.patch(`/api/cases/${caseState.current.id}/entities/${entity.id}`, {
          label: title.trim(), attrs,
        });
        toast('Note saved', 'ok', 1600);
      }
      await reloadCase();
      noteModal = null;
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      noteModalSaving = false;
    }
  }

</script>

<aside class="sidebar">
  {#if !caseState.current}
    <div class="empty">
      <div class="empty-icon"><Icon name="folder" size={34} /></div>
      <h3>No case open</h3>
      <p>
        Use any tool right away — a scratch session is created when needed. Open or create a case
        to keep an investigation together.
      </p>
    </div>
  {:else}
    <div class="case-head">
      <h3>{caseState.current.name}</h3>
      <span class="path mono">{caseState.current.id}</span>
    </div>

    <div class="sections">

      <!-- Case Notes (single notes.md) -->
      <button class="section-head" onclick={() => (section.notes = !section.notes)}>
        <Icon name={section.notes ? 'chevronDown' : 'chevronRight'} size={13} />
        <span>Case Notes</span>
        {#if !saved}<span class="badge">saving…</span>{/if}
      </button>
      {#if section.notes}
        <textarea
          class="textarea notes mono"
          bind:value={caseNotes}
          oninput={onCaseNotesInput}
          placeholder="Case notes (markdown)…"
        ></textarea>
      {/if}

      <!-- Folders -->
      <button class="section-head" onclick={() => (section.folders = !section.folders)}>
        <Icon name={section.folders ? 'chevronDown' : 'chevronRight'} size={13} />
        <span>Folders</span>
        <span class="count">{allFolders.length}</span>
      </button>
      {#if section.folders}
        <form class="new-folder" onsubmit={(e) => { e.preventDefault(); createFolder(); }}>
          <input class="input" placeholder="New folder…" bind:value={newFolder} />
          <button class="btn btn-sm" type="submit" title="Create folder" disabled={!newFolder.trim()}>
            <Icon name="plus" size={13} />
          </button>
        </form>

        <div class="folder-list">
          <!-- All -->
          <button
            class="frow"
            class:active={folderFilter === null}
            class:dropping={dragOverFolder === 'ALL_SENTINEL'}
            onclick={() => (folderFilter = null)}
          >
            <Icon name="layers" size={13} />
            <span class="fname">All items</span>
            <span class="fcount">{entities.length}</span>
          </button>

          <!-- Unfiled (drop target to clear folder) -->
          <button
            class="frow"
            class:active={folderFilter === ''}
            class:dropping={dragOverFolder === ''}
            ondragover={(e) => { e.preventDefault(); dragOverFolder = ''; }}
            ondragleave={() => (dragOverFolder = undefined)}
            ondrop={(e) => onDropFolder(e, '')}
            onclick={() => (folderFilter = '')}
          >
            <Icon name="folder" size={13} />
            <span class="fname">Unfiled</span>
            <span class="fcount">{countInFolder('')}</span>
          </button>

          {#each allFolders as f (f)}
            <button
              class="frow"
              class:active={folderFilter === f}
              class:dropping={dragOverFolder === f}
              ondragover={(e) => { e.preventDefault(); dragOverFolder = f; }}
              ondragleave={() => (dragOverFolder = undefined)}
              ondrop={(e) => onDropFolder(e, f)}
              onclick={() => (folderFilter = f)}
            >
              <Icon name="folderOpen" size={13} />
              <span class="fname">{f}</span>
              <span class="fcount">{countInFolder(f)}</span>
              <span
                class="fdel"
                role="button"
                tabindex="0"
                title="Delete folder"
                onclick={(e) => { e.stopPropagation(); deleteFolder(f); }}
                onkeydown={(e) => e.key === 'Enter' && (e.stopPropagation(), deleteFolder(f))}
              >
                <Icon name="trash" size={12} />
              </span>
            </button>
          {/each}
        </div>
        <div class="hint">Drag an entity onto a folder to file it.</div>
      {/if}

      <!-- Entities -->
      <div class="section-head-row">
        <button class="section-head" onclick={() => (section.entities = !section.entities)}>
          <Icon name={section.entities ? 'chevronDown' : 'chevronRight'} size={13} />
          <span>Entities</span>
          <span class="count">{entities.length}</span>
        </button>
        <button class="btn btn-ghost btn-sm new-note-btn" title="New note" onclick={openNewNote}>
          <Icon name="plus" size={13} /><Icon name="note" size={13} />
        </button>
      </div>

      {#if section.entities}
        {#if folderFilter !== null}
          <div class="active-folder">
            <Icon name={folderFilter === '' ? 'folder' : 'folderOpen'} size={12} />
            <span>{folderFilter === '' ? 'Unfiled' : folderFilter}</span>
            <button class="clear-filter" onclick={() => (folderFilter = null)} title="Clear filter">
              <Icon name="x" size={12} />
            </button>
          </div>
        {/if}

        <!-- suggested entities -->
        {#if filteredSuggested.length > 0}
          <div class="suggest-note">Suggested — confirm or dismiss:</div>
          {#each filteredSuggested as e (e.id)}
            <div class="entity suggested">
              <Icon name={ENTITY_ICONS[e.type] ?? 'note'} size={14} />
              <div class="e-body">
                <span class="e-label">{e.label}</span>
                <span class="e-meta">{e.type} · {e.provenance?.by}</span>
              </div>
              <button class="btn btn-ghost btn-sm" title="Confirm" onclick={() => confirmEntity(e)}>
                <Icon name="check" size={13} />
              </button>
              <button class="btn btn-ghost btn-sm" title="Dismiss" onclick={() => removeEntity(e)}>
                <Icon name="x" size={13} />
              </button>
            </div>
          {/each}
        {/if}

        <!-- confirmed entities -->
        {#each filteredConfirmed as e (e.id)}
          {@const isClickable = e.type === 'note' || !!ENTITY_TOOL[e.type]}
          <div
            class="entity"
            class:clickable={isClickable}
            class:dragging={dragEntityId === e.id}
            draggable="true"
            ondragstart={(ev) => onDragStart(ev, e)}
            ondragend={() => { dragEntityId = null; dragOverFolder = undefined; }}
            onclick={() => (e.type === 'note' ? openEditNote(e) : openEntity(e))}
            role={isClickable ? 'button' : undefined}
            tabindex={isClickable ? 0 : undefined}
            onkeydown={(ev) => ev.key === 'Enter' && (e.type === 'note' ? openEditNote(e) : openEntity(e))}
          >
            <Icon name="grip" size={13} />
            <Icon name={ENTITY_ICONS[e.type] ?? 'note'} size={14} />
            <div class="e-body">
              <span class="e-label">{e.label}</span>
              <span class="e-meta">
                {e.type}
                {#if folderOf(e)}· <Icon name="folder" size={10} />{folderOf(e)}{/if}
              </span>
            </div>
            <button
              class="btn btn-ghost btn-sm act"
              title="Info"
              onclick={(ev) => { ev.stopPropagation(); openInfo(e); }}
            >
              <Icon name="note" size={13} />
            </button>
            <button
              class="btn btn-ghost btn-sm act del"
              title="Delete"
              onclick={(ev) => { ev.stopPropagation(); removeEntity(e); }}
            >
              <Icon name="trash" size={13} />
            </button>
          </div>
        {:else}
          {#if !filteredSuggested.length}
            <div class="none">
              {folderFilter !== null ? 'No items in this folder.' : 'Tools file entities here as you work.'}
            </div>
          {/if}
        {/each}
      {/if}


    </div>
  {/if}
</aside>

<!-- Note edit / create modal -->
{#if noteModal}
  <Modal
    title={noteModal.entity ? 'Edit note' : 'New note'}
    onclose={() => (noteModal = null)}
    width="580px"
  >
    <label class="modal-label" for="note-title">Title</label>
    <input
      id="note-title"
      class="input"
      placeholder="Note title…"
      bind:value={noteModal.title}
    />

    <label class="modal-label" for="note-folder" style="margin-top:10px">Folder</label>
    <input
      id="note-folder"
      class="input"
      placeholder="e.g. research, timeline, sources…"
      bind:value={noteModal.folder}
      list="note-folder-suggestions"
    />
    <datalist id="note-folder-suggestions">
      {#each allFolders as f (f)}<option value={f}></option>{/each}
    </datalist>

    <label class="modal-label" for="note-content" style="margin-top:10px">Content</label>
    <textarea
      id="note-content"
      class="textarea note-content"
      rows="14"
      placeholder="Write your notes in markdown…"
      bind:value={noteModal.content}
    ></textarea>

    <div class="modal-row">
      {#if noteModal.entity}
        <button
          class="btn btn-ghost btn-sm"
          style="color:var(--danger,#e55)"
          onclick={async () => { await removeEntity(noteModal.entity); noteModal = null; }}
        >
          <Icon name="trash" size={13} /> Delete note
        </button>
      {/if}
      <div style="flex:1"></div>
      <button class="btn" onclick={() => (noteModal = null)}>Cancel</button>
      <button class="btn btn-primary" onclick={saveNote} disabled={noteModalSaving}>
        {noteModalSaving ? 'Saving…' : noteModal.entity ? 'Save' : 'Create'}
      </button>
    </div>
  </Modal>
{/if}

<!-- Entity info modal (rich details, esp. media) -->
{#if infoEntity}
  <Modal title={infoEntity.label} onclose={() => (infoEntity = null)} width="520px">
    {#if infoLoading}
      <div class="info-loading">Loading…</div>
    {/if}

    {#if infoData?.kind === 'image' && infoData.thumbnail}
      <div class="info-preview">
        <img src={`/files/${caseState.current.id}/${infoData.path}`} alt={infoEntity.label} />
      </div>
    {:else if infoData?.kind === 'video'}
      <div class="info-preview">
        <!-- svelte-ignore a11y_media_has_caption -->
        <video src={`/files/${caseState.current.id}/${infoData.path}`} controls preload="metadata"></video>
      </div>
    {/if}

    <div class="info-rows">
      <div class="info-row"><span class="info-k">Type</span><span>{infoEntity.type}</span></div>
      {#if folderOf(infoEntity)}
        <div class="info-row"><span class="info-k">Folder</span><span>{folderOf(infoEntity)}</span></div>
      {/if}
      {#if infoData}
        <div class="info-row"><span class="info-k">Kind</span><span>{infoData.kind}</span></div>
        <div class="info-row"><span class="info-k">Size</span><span>{fmtSize(infoData.size)}</span></div>
        {#if infoData.added_at}
          <div class="info-row"><span class="info-k">Added</span><span>{infoData.added_at.slice(0, 10)}</span></div>
        {/if}
        {#if infoData.sha256}
          <div class="info-row"><span class="info-k">SHA-256</span><span class="mono hash" title={infoData.sha256}>{infoData.sha256}</span></div>
        {/if}
        {#if infoData.source?.title}
          <div class="info-row"><span class="info-k">Title</span><span>{infoData.source.title}</span></div>
        {/if}
        {#if infoData.source?.uploader}
          <div class="info-row"><span class="info-k">Uploader</span><span>{infoData.source.uploader}</span></div>
        {/if}
        {#if infoData.source?.upload_date}
          <div class="info-row"><span class="info-k">Published</span><span class="mono">{infoData.source.upload_date}</span></div>
        {/if}
        {#if infoData.source?.duration}
          <div class="info-row"><span class="info-k">Duration</span><span>{infoData.source.duration}s</span></div>
        {/if}
        {#if infoData.source?.webpage_url ?? infoData.source?.url}
          <div class="info-row">
            <span class="info-k">Source</span>
            <a class="mono src" href={infoData.source.webpage_url ?? infoData.source.url} target="_blank" rel="noreferrer">
              {infoData.source.webpage_url ?? infoData.source.url}
            </a>
          </div>
        {/if}
        {#if infoData.notes}
          <div class="info-row"><span class="info-k">Notes</span><span>{infoData.notes}</span></div>
        {/if}
      {:else if infoEntity.attrs?.content}
        <div class="info-note-body">{infoEntity.attrs.content}</div>
      {/if}
      {#if infoEntity.attrs?.coords}
        <div class="info-row"><span class="info-k">Coords</span><span class="mono">{infoEntity.attrs.coords}</span></div>
      {/if}
    </div>

    <div class="modal-row">
      {#if infoData?.path}
        <a class="btn btn-ghost btn-sm" href={`/files/${caseState.current.id}/${infoData.path}`} target="_blank" rel="noreferrer">
          <Icon name="external" size={13} /> Open file
        </a>
      {/if}
      {#if ENTITY_TOOL[infoEntity.type]}
        <button class="btn btn-ghost btn-sm" onclick={() => { openEntity(infoEntity); infoEntity = null; }}>
          <Icon name="arrowRight" size={13} /> Open in tool
        </button>
      {/if}
      <div style="flex:1"></div>
      <button class="btn" onclick={() => (infoEntity = null)}>Close</button>
    </div>
  </Modal>
{/if}

<style>
  .sidebar {
    width: var(--sidebar-w);
    flex-shrink: 0;
    border-left: 1px solid var(--border);
    background: var(--bg-1);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .case-head {
    padding: 16px 16px 12px;
    border-bottom: 1px solid var(--border);
  }
  .case-head h3 {
    font-size: var(--fs-md);
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .path { font-size: var(--fs-xs); color: var(--text-3); }
  .sections { flex: 1; overflow-y: auto; padding: 8px; }
  .section-head {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 8px 8px 6px;
    font-size: var(--fs-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--text-2);
  }
  .section-head:hover { color: var(--text-1); }
  .section-head-row { display: flex; align-items: center; }
  .section-head-row .section-head { flex: 1; }
  .new-note-btn {
    color: var(--text-3);
    padding: 4px 6px;
    margin-right: 4px;
    display: flex;
    gap: 2px;
  }
  .new-note-btn:hover { color: var(--accent); }
  .count { margin-left: auto; color: var(--text-3); font-weight: 600; }
  .notes {
    min-height: 130px;
    font-size: var(--fs-xs);
    margin: 0 4px 10px;
    width: calc(100% - 8px);
  }
  /* folder management */
  .new-folder { display: flex; gap: 6px; padding: 2px 8px 8px; }
  .new-folder .input { flex: 1; font-size: var(--fs-xs); }
  .folder-list { display: flex; flex-direction: column; gap: 2px; padding: 0 4px 4px; }
  .frow {
    display: flex;
    align-items: center;
    gap: 8px;
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
  .frow.active { background: var(--accent-soft); color: var(--accent); }
  .frow.dropping { border-color: var(--accent); background: var(--accent-soft); }
  .fname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fcount { color: var(--text-3); font-size: var(--fs-xs); font-weight: 600; }
  .fdel { opacity: 0; color: var(--text-3); display: flex; padding: 2px; border-radius: 4px; }
  .fdel:hover { color: var(--danger, #e55); }
  .frow:hover .fdel { opacity: 1; }
  .hint { font-size: var(--fs-xs); color: var(--text-3); padding: 2px 12px 8px; font-style: italic; }
  .active-folder {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    margin: 2px 4px 6px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: var(--fs-xs);
    width: fit-content;
  }
  .clear-filter { display: flex; color: var(--accent); padding: 0; }
  /* entities */
  .entity {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 6px 8px;
    border-radius: var(--r-sm);
    color: var(--text-2);
  }
  .entity:hover { background: var(--bg-2); }
  .entity.clickable { cursor: pointer; }
  .entity.dragging { opacity: 0.5; }
  .entity > :global(svg:first-child) { color: var(--text-3); cursor: grab; flex-shrink: 0; }
  .entity.suggested {
    background: var(--accent-soft);
    border: 1px dashed var(--accent);
    margin-bottom: 4px;
  }
  .e-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .e-label {
    font-size: var(--fs-sm);
    color: var(--text-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .e-meta {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .act { opacity: 0; flex-shrink: 0; }
  .entity:hover .act { opacity: 1; }
  .del:hover { color: var(--danger, #e55); }
  .suggest-note { font-size: var(--fs-xs); color: var(--accent); padding: 2px 8px 6px; }
  .none { font-size: var(--fs-xs); color: var(--text-3); padding: 4px 8px 12px; }
  /* note modal */
  .modal-label { display: block; font-size: var(--fs-xs); color: var(--text-3); margin-bottom: 5px; }
  .note-content { width: 100%; resize: vertical; font-family: var(--font-mono); font-size: var(--fs-xs); }
  .modal-row { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
  /* info modal */
  .info-loading { font-size: var(--fs-sm); color: var(--text-3); padding: 6px 0; }
  .info-preview {
    border-radius: var(--r);
    overflow: hidden;
    background: var(--bg-2);
    margin-bottom: 14px;
    max-height: 240px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .info-preview img, .info-preview video { max-width: 100%; max-height: 240px; object-fit: contain; display: block; }
  .info-rows { display: flex; flex-direction: column; gap: 6px; }
  .info-row { display: flex; gap: 10px; font-size: var(--fs-sm); align-items: baseline; min-width: 0; }
  .info-k { color: var(--text-3); font-size: var(--fs-xs); min-width: 68px; flex-shrink: 0; }
  .hash { font-size: 11px; word-break: break-all; color: var(--text-2); }
  .src { font-size: var(--fs-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .info-note-body { white-space: pre-wrap; font-size: var(--fs-sm); color: var(--text-2); }
</style>

