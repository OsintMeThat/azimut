<script>
  import { untrack } from 'svelte';
  import { api } from '../lib/api.js';
  import {
    caseState,
    uiState,
    reloadCase,
    toast,
    setSidebarWidth,
    persistSidebarWidth,
  } from '../lib/state.svelte.js';
  import { DEFAULT_W } from '../lib/sidebar.js';
  import { buildTree, subtreeCountFrom, flattenPaths, folderOf } from '../lib/folderTree.js';
  import { buildCatalogQuery, settleCatalogSummary } from '../lib/catalog.js';
  import { assignFolder as fileEntity } from '../lib/filing.js';
  import { createNote } from '../lib/notes.js';
  import { openEntity, gotoCapture, openNotebook, ENTITY_TOOL } from '../lib/navigate.js';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import EntityDetails from './EntityDetails.svelte';
  import FolderSelect from './FolderSelect.svelte';

  const ENTITY_ICONS = {
    person: 'user',
    organization: 'layers',
    alias: 'user',
    account: 'globe',
    email: 'note',
    phone: 'hash',
    place: 'pin',
    capture: 'satellite',
    event: 'clock',
    media: 'image',
    proof: 'proof',
    post: 'post',
    domain: 'globe',
    ip: 'hash',
    vehicle: 'grip',
    note: 'note',
    'inspect-session': 'inspect',
  };

  const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v']);
  // Media entities normally carry the same `kind` the Media Library uses to tell
  // video from image; fall back to the file extension for entities filed before
  // that attr existed.
  function isVideo(e) {
    if (e.attrs?.kind) return e.attrs.kind === 'video';
    const ext = e.attrs?.path?.split('.').pop()?.toLowerCase();
    return !!ext && VIDEO_EXTS.has(ext);
  }
  const entityIcon = (e) => (e.type === 'media' && isVideo(e) ? 'video' : ENTITY_ICONS[e.type] ?? 'note');

  let section = $state({ notes: false, suggestions: true, mywork: true });

  // ── bounded catalog loading (docs/STORAGE_AND_PERFORMANCE.md, Step 5) ───────
  // The sidebar no longer holds the whole graph. It builds the folder tree from
  // the (small) folder list plus the summary's folder keys, takes its badge
  // counts from the summary, and loads entities a page at a time per section:
  // Suggestions, Unfiled, and each folder on expand. `seq` guards a stale
  // response from landing after the case or a mutation moved on.
  const CATALOG_PAGE = 200;
  const emptySection = () => ({ items: [], cursor: null, done: false, loading: false, loaded: false });

  let summary = $state(null); // { total, by_type, by_status, by_folder }
  let suggestedData = $state(emptySection());
  let unfiledData = $state(emptySection());
  let folderData = $state({}); // path -> section
  let seq = 0;
  let loadedCaseId = null;

  const byFolder = $derived(summary?.by_folder ?? {});
  const suggestedCount = $derived(summary?.by_status?.suggested ?? 0);
  const confirmedCount = $derived(Math.max(0, (summary?.total ?? 0) - suggestedCount));

  async function loadSection(sec, params, { id, mySeq, more = false } = {}) {
    id ??= caseState.current?.id;
    mySeq ??= seq;
    if (!id) return;
    if (more && (sec.loading || sec.done)) return; // don't stack a "show more"
    sec.loading = true;
    try {
      const page = await api.get(
        buildCatalogQuery(id, { ...params, limit: CATALOG_PAGE, cursor: more ? sec.cursor : null })
      );
      if (mySeq !== seq) return; // a case switch or reload superseded us
      sec.items = more ? [...sec.items, ...(page.items ?? [])] : page.items ?? [];
      sec.cursor = page.next_cursor ?? null;
      sec.done = !sec.cursor;
      sec.loaded = true;
      sec.loading = false;
    } catch (e) {
      if (mySeq !== seq) return;
      sec.loading = false;
      toast(e.message, 'danger');
    }
  }

  const loadSuggested = (more = false) => loadSection(suggestedData, { status: 'suggested' }, { more });
  const loadUnfiled = (more = false) =>
    loadSection(unfiledData, { status: 'confirmed', unfiled: true }, { more });
  function loadFolder(path, more = false) {
    if (!folderData[path]) folderData[path] = emptySection();
    return loadSection(folderData[path], { status: 'confirmed', folder: path }, { more });
  }

  async function loadSummary(id, mySeq) {
    try {
      const s = await api.get(`/api/cases/${id}/catalog/summary`);
      summary = settleCatalogSummary(summary, s, mySeq === seq);
    } catch {
      summary = settleCatalogSummary(summary, null, mySeq === seq);
      /* counts are a nicety; an empty summary just shows zeroes */
    }
  }

  // Reload the summary and every open section. Runs on case change (full reset
  // first) and on every reloadCase() (caseState.rev), so a mutation anywhere is
  // reflected without re-reading the whole graph.
  function refreshAll(id) {
    seq++;
    if (id !== loadedCaseId) {
      loadedCaseId = id;
      summary = null;
      expanded = {};
      folderData = {};
      unfiledOpen = false;
      addingUnder = undefined;
      infoEntity = null;
      suggestedData = emptySection();
      unfiledData = emptySection();
    }
    if (!id) {
      summary = null;
      return;
    }
    loadSummary(id, seq);
    loadSuggested();
    loadUnfiled();
    for (const path of Object.keys(expanded)) if (expanded[path]) loadFolder(path);
  }

  $effect(() => {
    const id = caseState.current?.id;
    caseState.rev; // re-run on every reload (a mutation elsewhere or our own)
    untrack(() => refreshAll(id));
  });

  async function confirmEntity(entity) {
    await api.patch(`/api/cases/${caseState.current.id}/entities/${entity.id}`, {
      status: 'confirmed',
    });
    await reloadCase();
  }

  // Dismiss a suggestion outright (quick triage — no heavy confirmation).
  async function dismissSuggestion(entity) {
    await api.del(`/api/cases/${caseState.current.id}/entities/${entity.id}`);
    await reloadCase();
    toast(`Dismissed "${entity.label}"`, 'info');
  }

  // Clicking a row opens its owning workspace; notes share the Notebook.
  function onEntityActivate(entity) {
    if (entity.type === 'capture') return openInfo(entity);
    openEntity(entity);
  }

  // openEntity / gotoCapture live in lib/navigate.js — the case sidebar and the
  // Details editor send an analyst to the same place.

  // ── My work: the analyst's own nested folder tree ('/'-separated paths) ────
  let newFolder = $state(''); // top-level create input
  let addingUnder = $state(undefined); // folder path currently gaining a child
  let newSubName = $state('');
  let expanded = $state({}); // path -> bool (absent = collapsed)
  let dragEntityId = $state(null); // for the dragging visual
  let dragEntity = null; // the entity being dragged (no full-graph lookup on drop)
  let dragOverFolder = $state(undefined); // folder path being hovered

  const caseFolders = $derived(caseState.current?.folders ?? []);

  // Structure only: the tree is built from folders plus any folder a summary
  // count refers to (an entity filed into a path that was never an explicit
  // folder still gets a node), with no entities attached — those load per node.
  const tree = $derived(buildTree([...new Set([...caseFolders, ...Object.keys(byFolder)])], []));
  const allFolders = $derived(flattenPaths(tree));
  let unfiledOpen = $state(false);

  const isExpanded = (path) => expanded[path] === true;
  function toggle(path) {
    expanded[path] = !isExpanded(path);
    if (expanded[path]) loadFolder(path);
  }
  function focus(node) { node.focus(); }

  async function createFolder(fullName) {
    const name = (fullName ?? newFolder).trim();
    if (!name) return;
    if (fullName == null) newFolder = '';
    try {
      await api.post(`/api/cases/${caseState.current.id}/folders`, { name });
      let acc = '';
      for (const seg of name.split('/')) { acc = acc ? `${acc}/${seg}` : seg; expanded[acc] = true; }
      await reloadCase();
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  function startAddSub(path) {
    addingUnder = path;
    newSubName = '';
    expanded[path] = true;
  }
  async function submitAddSub() {
    const name = newSubName.trim();
    const parent = addingUnder;
    addingUnder = undefined;
    newSubName = '';
    if (!name || parent === undefined) return;
    await createFolder(parent ? `${parent}/${name}` : name);
  }

  // File (or unfile, with folder='') an entity into a My-work folder, then
  // refresh. Routing lives in lib/filing.js so the desktop organizer files
  // items the same way.
  async function assignFolder(entity, folder) {
    await fileEntity(caseState.current.id, entity, folder);
    await reloadCase();
  }

  // drag & drop wiring
  function onDragStart(ev, entity) {
    dragEntityId = entity.id;
    dragEntity = entity;
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', entity.id);
  }
  function onDropFolder(ev, folder) {
    ev.preventDefault();
    dragOverFolder = undefined;
    const entity = dragEntity;
    dragEntityId = null;
    dragEntity = null;
    if (entity) assignFolder(entity, folder).catch((e) => toast(e.message, 'danger'));
  }

  // ── confirmation dialog (replaces browser confirm()) ──────────────────────
  let confirmState = $state(null); // { title, message, detail, confirmLabel, tone, icon, action }
  let confirmBusy = $state(false);

  async function runConfirm() {
    const s = confirmState;
    if (!s) return;
    confirmBusy = true;
    try {
      await s.action();
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      confirmBusy = false;
      confirmState = null;
    }
  }

  // Remove from My work: just clears the filing. The item stays in its tool.
  function askRemoveFromMyWork(entity) {
    confirmState = {
      title: 'Remove from My work?',
      message: `“${entity.label}” is unfiled. Nothing is deleted.`,
      detail: 'It stays available in the case and its tool. Only your filing here is cleared.',
      confirmLabel: 'Remove from My work',
      tone: 'default',
      icon: 'folderMinus',
      action: () => assignFolder(entity, ''),
    };
  }

  function askDeleteFolder(path) {
    const prefix = path + '/';
    const subs = allFolders.filter((f) => f.startsWith(prefix)).length;
    confirmState = {
      title: 'Remove this folder?',
      message: subs
        ? `“${path}” and its ${subs} subfolder(s) will be removed from My work.`
        : `“${path}” will be removed from My work.`,
      detail: 'Items inside are unfiled. No files are deleted.',
      confirmLabel: 'Remove folder',
      tone: 'default',
      icon: 'folderMinus',
      // The backend unfiles every entity under the removed subtree, so this
      // does not enumerate the graph — it just drops the folder and refreshes.
      action: async () => {
        await api.del(
          `/api/cases/${caseState.current.id}/folders?name=${encodeURIComponent(path)}`
        );
        await reloadCase();
      },
    };
  }

  // ── details panel (docs/UI.md §4) ─────────────────────────────────────────
  // The editor body lives in EntityDetails.svelte (shared with the Media
  // Library modal). The sidebar only tracks which entity is selected and
  // scrolls it into view.
  let infoEntity = $state(null);
  let detailsEl = $state(null);

  function openInfo(entity) {
    infoEntity = entity;
    requestAnimationFrame(() => detailsEl?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  // ── note entities ─────────────────────────────────────────────────────────
  let noteModal = $state(null);
  // shape: { entity: obj|null, title: string, folder: string, content: string }
  let noteModalSaving = $state(false);

  function openNewNote() {
    noteModal = { title: '', folder: '' };
  }

  async function saveNote() {
    if (!noteModal) return;
    const { title, folder } = noteModal;
    if (!title.trim()) { toast('Title required', 'warn'); return; }
    noteModalSaving = true;
    try {
      const note = await createNote(caseState.current.id, { title, folder });
      await reloadCase();
      noteModal = null;
      openNotebook(note.id);
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      noteModalSaving = false;
    }
  }

  // --- resize: the sidebar's left edge is a drag handle ---
  let resizing = $state(false);
  const KEY_STEP = 16;

  function startResize(e) {
    if (e.button !== 0) return;
    e.preventDefault(); // don't start a text selection under the cursor
    const startX = e.clientX;
    const startW = uiState.sidebarW;
    resizing = true;
    // dragging left (a smaller clientX) widens the sidebar — it grows into the canvas
    const move = (ev) => setSidebarWidth(startW + startX - ev.clientX);
    const up = () => {
      resizing = false;
      persistSidebarWidth(); // one write per drag, not one per frame
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function onResizeKey(e) {
    const step = { ArrowLeft: KEY_STEP, ArrowRight: -KEY_STEP }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    setSidebarWidth(uiState.sidebarW + step);
    persistSidebarWidth();
  }

  function resetWidth() {
    setSidebarWidth(DEFAULT_W);
    persistSidebarWidth();
  }

  // A width dragged out on a wide screen would eat a narrower window whole, so
  // re-clamp against the viewport as it changes. The clamped-down value is not
  // written back — what the user actually chose is what a later session restores.
  $effect(() => {
    const onWindowResize = () => setSidebarWidth(uiState.sidebarW);
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  });
</script>

<aside class="sidebar" class:resizing style="width: {uiState.sidebarW}px">
  <!-- a <button> rather than a bare div: the handle must be focusable and
       keyboard-driven (arrows resize), and the element carries that for free -->
  <button
    type="button"
    class="resizer"
    aria-label="Resize sidebar"
    title="Drag to resize · double-click to reset"
    onpointerdown={startResize}
    ondblclick={resetWidth}
    onkeydown={onResizeKey}
  ></button>

  {#if !caseState.current}
    <div class="empty">
      <div class="empty-icon"><Icon name="folder" size={34} /></div>
      <h3>No case open</h3>
      <p>Tools work without one. Create a case to keep the investigation together.</p>
    </div>
  {:else}
    <div class="case-head">
      <h3>{caseState.current.name}</h3>
      <span class="path mono">{caseState.current.id}</span>
    </div>

    <div class="sections">

      <!-- 1 · Case Notes (single notes.md) -->
      <button class="section-head" onclick={() => openNotebook()}>
        <Icon name="note" size={13} />
        <span>Case Notes</span>
        <span class="open-note">Open</span>
      </button>

      <!-- 2 · Suggestions (tool-suggested entities: confirm or dismiss) -->
      {#if suggestedCount > 0}
        <button class="section-head" onclick={() => (section.suggestions = !section.suggestions)}>
          <Icon name={section.suggestions ? 'chevronDown' : 'chevronRight'} size={13} />
          <span>Suggestions</span>
          <span class="count">{suggestedCount}</span>
        </button>
        {#if section.suggestions}
          {#each suggestedData.items as e (e.id)}
            <div class="entity suggested">
              <Icon name={entityIcon(e)} size={14} />
              <div class="e-body">
                <span class="e-label">{e.label}</span>
                <span class="e-meta">{e.type} · {e.provenance?.by}</span>
              </div>
              <button class="btn btn-ghost btn-sm" title="Confirm" onclick={() => confirmEntity(e)}>
                <Icon name="check" size={13} />
              </button>
              <button class="btn btn-ghost btn-sm" title="Dismiss" onclick={() => dismissSuggestion(e)}>
                <Icon name="x" size={13} />
              </button>
            </div>
          {/each}
          {#if !suggestedData.done}
            <button class="more" onclick={() => loadSuggested(true)} disabled={suggestedData.loading}>
              Show more
            </button>
          {/if}
        {/if}
      {/if}

      <!-- 3 · My work (your own folders; file items from their details panel) -->
      <div class="section-head-row">
        <button class="section-head" onclick={() => (section.mywork = !section.mywork)}>
          <Icon name={section.mywork ? 'chevronDown' : 'chevronRight'} size={13} />
          <span>My work</span>
          <span class="count">{confirmedCount}</span>
        </button>
        <button class="btn btn-ghost btn-sm new-note-btn" title="New note" onclick={openNewNote}>
          <Icon name="plus" size={13} /><Icon name="note" size={13} />
        </button>
      </div>

      {#if section.mywork}
        <!-- create a top-level folder -->
        <form class="new-folder" onsubmit={(e) => { e.preventDefault(); createFolder(); }}>
          <input class="input" placeholder="New folder…" bind:value={newFolder} />
          <button class="btn btn-sm" type="submit" title="Create folder" disabled={!newFolder.trim()}>
            <Icon name="plus" size={13} />
          </button>
        </form>

        <div class="tree">
          {#each tree as node (node.path)}
            {@render folderNode(node, 0)}
          {/each}

          {#if unfiledData.items.length > 0}
            <div
              class="frow"
              role="button"
              tabindex="0"
              onclick={() => (unfiledOpen = !unfiledOpen)}
              onkeydown={(e) => e.key === 'Enter' && (unfiledOpen = !unfiledOpen)}
            >
              <Icon name={unfiledOpen ? 'chevronDown' : 'chevronRight'} size={12} />
              <Icon name="layers" size={13} />
              <span class="fname">Unfiled</span>
              <span class="fcount">{unfiledData.items.length}{unfiledData.done ? '' : '+'}</span>
            </div>
            {#if unfiledOpen}
              {#each unfiledData.items as e (e.id)}
                {@render entityRow(e, 1)}
              {/each}
              {#if !unfiledData.done}
                <button class="more" onclick={() => loadUnfiled(true)} disabled={unfiledData.loading}>
                  Show more
                </button>
              {/if}
            {/if}
          {/if}

          {#if tree.length === 0 && unfiledData.items.length === 0}
            <div class="none">
              Everything you save lands here; create folders to organize it.
            </div>
          {/if}
        </div>
      {/if}


      <!-- 4 · Details (selection editor — docs/UI.md §4; shared body) -->
      {#if infoEntity}
        <div bind:this={detailsEl}>
          <div class="section-head-row">
            <div class="section-head static">
              <Icon name="note" size={13} />
              <span>Details</span>
            </div>
            <button class="btn btn-ghost btn-sm" title="Close details" onclick={() => (infoEntity = null)}>
              <Icon name="x" size={13} />
            </button>
          </div>
          <div class="details">
            <EntityDetails
              entityId={infoEntity.id}
              onclose={() => (infoEntity = null)}
              ondeleted={() => (infoEntity = null)}
            />
          </div>
        </div>
      {/if}

    </div>
  {/if}
</aside>

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
    onclick={() => toggle(node.path)}
    onkeydown={(e) => e.key === 'Enter' && toggle(node.path)}
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
      onclick={(e) => { e.stopPropagation(); askDeleteFolder(node.path); }}
      onkeydown={(e) => e.key === 'Enter' && (e.stopPropagation(), askDeleteFolder(node.path))}
    >
      <Icon name="folderMinus" size={12} />
    </span>
  </div>
  {#if isExpanded(node.path)}
    {#if addingUnder === node.path}
      <form
        class="new-folder sub"
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
        {@render entityRow(e, depth + 1)}
      {/each}
      {#if !sec.done}
        <button
          class="more"
          style="margin-left: {8 + (depth + 1) * 14}px"
          onclick={() => loadFolder(node.path, true)}
          disabled={sec.loading}
        >
          Show more
        </button>
      {/if}
    {/if}
  {/if}
{/snippet}

<!-- one entity row (My work): activate, info, unfile -->
{#snippet entityRow(e, depth)}
  {@const isClickable = e.type === 'note' || e.type === 'capture' || !!ENTITY_TOOL[e.type]}
  <!-- The role and tab stop deliberately exist only for activatable entity types. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="entity"
    class:clickable={isClickable}
    class:dragging={dragEntityId === e.id}
    style="padding-left: {8 + depth * 14}px"
    draggable="true"
    ondragstart={(ev) => onDragStart(ev, e)}
    ondragend={() => { dragEntityId = null; dragEntity = null; dragOverFolder = undefined; }}
    onclick={() => onEntityActivate(e)}
    role={isClickable ? 'button' : undefined}
    tabindex={isClickable ? 0 : undefined}
    onkeydown={(ev) => ev.key === 'Enter' && onEntityActivate(e)}
  >
    <Icon name="grip" size={13} />
    <Icon name={entityIcon(e)} size={14} />
    <div class="e-body">
      <span class="e-label">{e.label}</span>
      <span class="e-meta">{e.type}</span>
    </div>
    {#if e.type === 'capture' && e.attrs?.lat != null}
      <button
        class="btn btn-ghost btn-sm act"
        title="Go to these coordinates on the map"
        onclick={(ev) => { ev.stopPropagation(); gotoCapture(e); }}
      >
        <Icon name="crosshair" size={13} />
      </button>
    {/if}
    {#if e.type === 'media' && e.attrs?.path}
      <a
        class="btn btn-ghost btn-sm act"
        title="Open in new tab"
        href={`/files/${caseState.current.id}/${e.attrs.path}`}
        target="_blank"
        rel="noreferrer"
        onclick={(ev) => ev.stopPropagation()}
      >
        <Icon name="external" size={13} />
      </a>
    {/if}
    <button
      class="btn btn-ghost btn-sm act"
      title="Info"
      onclick={(ev) => { ev.stopPropagation(); openInfo(e); }}
    >
      <Icon name="note" size={13} />
    </button>
    {#if folderOf(e)}
      <button
        class="btn btn-ghost btn-sm act del"
        title="Unfile from this folder"
        onclick={(ev) => { ev.stopPropagation(); askRemoveFromMyWork(e); }}
      >
        <Icon name="folderMinus" size={13} />
      </button>
    {/if}
  </div>
{/snippet}

<!-- Note edit / create modal -->
{#if noteModal}
  <Modal
    title="New note"
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

    <span class="modal-label" style="margin-top:10px">Folder (in My work)</span>
    <FolderSelect bind:value={noteModal.folder} folders={allFolders} emptyLabel="My work (root)" />

    <div class="modal-row">
      <div style="flex:1"></div>
      <button class="btn" onclick={() => (noteModal = null)}>Cancel</button>
      <button class="btn btn-primary" onclick={saveNote} disabled={noteModalSaving}>
        {noteModalSaving ? 'Creating…' : 'Create'}
      </button>
    </div>
  </Modal>
{/if}


<!-- Confirmation dialog (remove from My work / remove folder) -->
{#if confirmState}
  <ConfirmDialog
    title={confirmState.title}
    message={confirmState.message}
    detail={confirmState.detail}
    consequences={confirmState.consequences}
    confirmLabel={confirmState.confirmLabel}
    tone={confirmState.tone}
    icon={confirmState.icon}
    busy={confirmBusy}
    onconfirm={runConfirm}
    oncancel={() => (confirmState = null)}
  />
{/if}

<style>
  .sidebar {
    /* width is driven by uiState.sidebarW (inline style) — see lib/sidebar.js */
    position: relative;
    flex-shrink: 0;
    border-left: 1px solid var(--border);
    background: var(--bg-1);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  /* the grab strip sits just inside the left edge, over the sections' padding */
  .resizer {
    position: absolute;
    top: 0;
    left: 0;
    width: 5px;
    height: 100%;
    z-index: 2;
    cursor: col-resize;
    background: transparent;
    transition: background 0.12s;
  }
  .resizer:hover,
  .resizer:focus-visible,
  .sidebar.resizing .resizer {
    background: var(--accent);
    outline: none;
  }
  /* a drag reads as one gesture — no text selection, no cursor flicker on hover
     targets the pointer crosses on the way */
  .sidebar.resizing {
    user-select: none;
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
  .open-note { margin-left: auto; color: var(--text-3); font-weight: 600; }
  .count { margin-left: auto; color: var(--text-3); font-weight: 600; }
  /* tool group header (Saved work) */
  /* folder tree */
  .new-folder { display: flex; gap: 6px; padding: 2px 8px 8px; }
  .new-folder.sub { padding: 2px 8px 4px; }
  .new-folder .input { flex: 1; font-size: var(--fs-xs); }
  .tree { display: flex; flex-direction: column; gap: 1px; padding: 0 4px 4px; }
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
  .frow:hover .fact { opacity: 1; }
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
  .none { font-size: var(--fs-xs); color: var(--text-3); padding: 4px 8px 12px; line-height: 1.45; }
  /* note modal */
  .modal-label { display: block; font-size: var(--fs-xs); color: var(--text-3); margin: 8px 0 4px; }
  .section-head.static { cursor: default; }
  .details {
    padding: 4px 8px 10px;
    border-bottom: 1px solid var(--border);
    font-size: var(--fs-sm);
  }
  .modal-row { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
</style>
