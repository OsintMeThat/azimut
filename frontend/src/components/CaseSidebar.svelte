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
  import { buildTree, flattenPaths } from '../lib/folderTree.js';
  import { buildCatalogQuery, settleCatalogSummary } from '../lib/catalog.js';
  import { createPagedList } from '../lib/pagedList.svelte.js';
  import { filterEntities, isFiltering, typeChips } from '../lib/sidebarSearch.js';
  import { assignFolder as fileEntity, assignFolderBatch } from '../lib/filing.js';
  import { createNote } from '../lib/notes.js';
  import { openEntity, openNotebook } from '../lib/navigate.js';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import FolderSelect from './FolderSelect.svelte';
  import SidebarHeader from './sidebar/SidebarHeader.svelte';
  import SidebarTree from './sidebar/SidebarTree.svelte';
  import SidebarResults from './sidebar/SidebarResults.svelte';
  import DetailsDrawer from './sidebar/DetailsDrawer.svelte';

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
      suggestedOpen = false;
      infoEntity = null;
      query = '';
      typeFilter = null;
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

  // ── search: one rule, browse or results (lib/sidebarSearch.js) ─────────────
  // No filter shows the tree; a text query or a type chip shows a flat list.
  // The list is only fetched once something is actually filtered — opening a
  // case still costs the same bounded pages it did before.
  let query = $state('');
  let typeFilter = $state(null);
  const filtering = $derived(isFiltering({ query, type: typeFilter }));
  const chips = $derived(typeChips(summary));

  const results = createPagedList({
    fetchPage: ({ query: q, cursor }) =>
      api.get(
        buildCatalogQuery(caseState.current?.id, {
          query: q,
          types: typeFilter ? [typeFilter] : null,
          limit: CATALOG_PAGE,
          cursor,
        })
      ),
  });
  // In client mode the fetched page is the whole case, so the term filters in
  // memory; in server mode the request already carries it.
  const resultRows = $derived(
    results.serverMode ? results.items : filterEntities(results.items, { query, type: typeFilter })
  );

  let resultsKey = null; // non-reactive: only the load effect reads/writes it
  $effect(() => {
    const id = caseState.current?.id;
    const rev = caseState.rev; // a filing elsewhere changes a row's folder meta
    const key = filtering && id ? `${id}|${typeFilter ?? ''}|${rev}` : null;
    if (key === resultsKey) return;
    resultsKey = key;
    if (!key) results.clear();
    else results.reload();
  });
  $effect(() => {
    results.setQuery(query);
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
  // openEntity / gotoCapture live in lib/navigate.js — the case sidebar and the
  // Details editor send an analyst to the same place.
  function onEntityActivate(entity) {
    if (entity.type === 'capture') return openInfo(entity);
    openEntity(entity);
  }

  // ── My work: the analyst's own nested folder tree ('/'-separated paths) ────
  let newFolderOpen = $state(false);
  let newFolder = $state('');
  let expanded = $state({}); // path -> bool (absent = collapsed)

  const caseFolders = $derived(caseState.current?.folders ?? []);

  // Structure only: the tree is built from folders plus any folder a summary
  // count refers to (an entity filed into a path that was never an explicit
  // folder still gets a node), with no entities attached — those load per node.
  const tree = $derived(buildTree([...new Set([...caseFolders, ...Object.keys(byFolder)])], []));
  const allFolders = $derived(flattenPaths(tree));
  let unfiledOpen = $state(false);
  let suggestedOpen = $state(false);

  function toggle(path) {
    expanded[path] = expanded[path] !== true;
    if (expanded[path]) loadFolder(path);
  }
  function focusInput(node) { node.focus(); }

  async function createFolder(name) {
    const clean = (name ?? '').trim();
    if (!clean) return;
    try {
      await api.post(`/api/cases/${caseState.current.id}/folders`, { name: clean });
      let acc = '';
      for (const seg of clean.split('/')) { acc = acc ? `${acc}/${seg}` : seg; expanded[acc] = true; }
      await reloadCase();
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  function submitNewFolder() {
    const name = newFolder;
    newFolder = '';
    newFolderOpen = false;
    createFolder(name);
  }

  // File (or unfile, with folder='') an entity into a My-work folder, then
  // refresh. Routing lives in lib/filing.js so the desktop organizer files
  // items the same way.
  async function assignFolder(entity, folder) {
    await fileEntity(caseState.current.id, entity, folder);
    await reloadCase();
  }

  // A drop carries whatever was selected — one row, or a ctrl/shift-picked run.
  // Filed in order, then one refresh for the batch.
  async function onFileDrop(entities, folder) {
    try {
      await assignFolderBatch(caseState.current.id, entities, folder);
      await reloadCase();
      if (entities.length > 1)
        toast(folder ? `Filed ${entities.length} items in ${folder}` : `Unfiled ${entities.length} items`, 'ok', 1600);
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  // ── scrolling while a drag is in flight ───────────────────────────────────
  // A native drag swallows the wheel in Chromium, so the tree scrolls itself
  // when the pointer nears an edge. Firefox does deliver the wheel, and the
  // handler below uses it when it arrives.
  let bodyEl = $state(null);
  let dragActive = $state(false);
  const EDGE = 44;
  const EDGE_SPEED = 12;
  let edgeDir = 0;
  let edgeRaf = 0;

  function stepEdgeScroll() {
    if (!edgeDir || !bodyEl) { edgeRaf = 0; return; }
    bodyEl.scrollTop += edgeDir * EDGE_SPEED;
    edgeRaf = requestAnimationFrame(stepEdgeScroll);
  }
  function setEdgeScroll(dir) {
    edgeDir = dir;
    if (dir && !edgeRaf) edgeRaf = requestAnimationFrame(stepEdgeScroll);
  }
  function onBodyDragOver(ev) {
    if (!bodyEl) return;
    const box = bodyEl.getBoundingClientRect();
    if (ev.clientY < box.top + EDGE) setEdgeScroll(-1);
    else if (ev.clientY > box.bottom - EDGE) setEdgeScroll(1);
    else setEdgeScroll(0);
  }
  function onBodyWheel(ev) {
    if (!dragActive || !bodyEl) return; // otherwise the browser scrolls it itself
    ev.preventDefault();
    bodyEl.scrollTop += ev.deltaY;
  }
  function onDragActive(active) {
    dragActive = active;
    if (!active) setEdgeScroll(0);
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

  // ── details drawer (docs/UI.md §Case sidebar) ─────────────────────────────
  // The editor body lives in EntityDetails.svelte (shared with the Media
  // Library modal). It opens over the sidebar instead of growing under the
  // tree, so selecting a row never pushes the case out of the viewport.
  let infoEntity = $state(null);
  let returnFocusEl = null;

  function openInfo(entity) {
    returnFocusEl = document.activeElement;
    infoEntity = entity;
  }

  function closeInfo() {
    infoEntity = null;
    returnFocusEl?.focus?.();
    returnFocusEl = null;
  }

  // ── note entities ─────────────────────────────────────────────────────────
  let noteModal = $state(null); // { title, folder }
  let noteModalSaving = $state(false);

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
    return () => {
      window.removeEventListener('resize', onWindowResize);
      cancelAnimationFrame(edgeRaf);
    };
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
    <SidebarHeader
      caseName={caseState.current.name}
      caseId={caseState.current.id}
      bind:query
      type={typeFilter}
      {chips}
      total={summary?.total ?? 0}
      resultCount={filtering ? resultRows.length : null}
      onnotes={() => openNotebook()}
      onselecttype={(t) => (typeFilter = t)}
    />

    <!-- the drag handlers here only auto-scroll; the drop targets are the
         folder rows inside, which carry their own roles -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="body"
      bind:this={bodyEl}
      ondragover={onBodyDragOver}
      ondragleave={() => setEdgeScroll(0)}
      ondrop={() => setEdgeScroll(0)}
      onwheel={onBodyWheel}
    >
      {#if filtering}
        <SidebarResults
          rows={resultRows}
          caseId={caseState.current.id}
          loading={results.loading}
          hasMore={results.serverMode && results.hasMore}
          onmore={() => results.loadMore()}
          onactivate={onEntityActivate}
          oninfo={openInfo}
          onunfile={askRemoveFromMyWork}
        />
      {:else}
        <div class="actions">
          <button class="act-btn" onclick={() => (newFolderOpen = !newFolderOpen)}>
            <Icon name="plus" size={12} /><Icon name="folder" size={13} /><span>Folder</span>
          </button>
          <button class="act-btn" onclick={() => (noteModal = { title: '', folder: '' })}>
            <Icon name="plus" size={12} /><Icon name="note" size={13} /><span>Note</span>
          </button>
        </div>
        {#if newFolderOpen}
          <form class="new-folder" onsubmit={(e) => { e.preventDefault(); submitNewFolder(); }}>
            <input
              class="input"
              placeholder="New folder…"
              bind:value={newFolder}
              use:focusInput
              onkeydown={(e) => e.key === 'Escape' && (newFolderOpen = false)}
            />
            <button class="btn btn-sm" type="submit" title="Create folder" disabled={!newFolder.trim()}>
              <Icon name="plus" size={13} />
            </button>
          </form>
        {/if}

        <SidebarTree
          {tree}
          {byFolder}
          {expanded}
          {folderData}
          unfiled={unfiledData}
          {unfiledOpen}
          suggested={suggestedData}
          {suggestedCount}
          {suggestedOpen}
          caseId={caseState.current.id}
          ontoggle={toggle}
          onmorefolder={(path) => loadFolder(path, true)}
          ontoggleunfiled={() => (unfiledOpen = !unfiledOpen)}
          onmoreunfiled={() => loadUnfiled(true)}
          ontogglesuggested={() => (suggestedOpen = !suggestedOpen)}
          onmoresuggested={() => loadSuggested(true)}
          oncreatefolder={createFolder}
          onremovefolder={askDeleteFolder}
          onfile={onFileDrop}
          onactivate={onEntityActivate}
          oninfo={openInfo}
          onunfile={askRemoveFromMyWork}
          onconfirm={confirmEntity}
          ondismiss={dismissSuggestion}
          ondragactive={onDragActive}
        />
      {/if}
    </div>

    {#if infoEntity}
      <DetailsDrawer entity={infoEntity} onclose={closeInfo} ondeleted={closeInfo} />
    {/if}
  {/if}
</aside>

<!-- Note create modal -->
{#if noteModal}
  <Modal title="New note" onclose={() => (noteModal = null)} width="580px">
    <label class="modal-label" for="note-title">Title</label>
    <input id="note-title" class="input" placeholder="Note title…" bind:value={noteModal.title} />

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
  /* one scroll region: the header stays put, the drawer covers this */
  .body { flex: 1; min-height: 0; overflow-y: auto; padding: 6px 4px; }
  .actions { display: flex; gap: 4px; padding: 2px 8px 6px; }
  .act-btn {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 3px 8px;
    border-radius: var(--r-sm);
    color: var(--text-3);
    font-size: var(--fs-xs);
    font-weight: 600;
    cursor: pointer;
  }
  .act-btn:hover { color: var(--text-1); background: var(--bg-2); }
  .new-folder { display: flex; gap: 6px; padding: 2px 8px 8px; }
  .new-folder .input { flex: 1; font-size: var(--fs-xs); }
  .modal-label { display: block; font-size: var(--fs-xs); color: var(--text-3); margin: 8px 0 4px; }
  .modal-row { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
</style>
