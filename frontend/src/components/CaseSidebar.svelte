<script>
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
  import { buildTree, subtreeCount, flattenPaths, folderOf } from '../lib/folderTree.js';
  import { chainOf, deletePlan, DEPENDS_ON } from '../lib/chain.js';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';

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

  // Tool to open when clicking a given entity type
  const ENTITY_TOOL = {
    media: 'media', proof: 'proof', place: 'satellite', post: 'post', 'inspect-session': 'inspect',
  };

  // Entity types backed by a file on disk — deleting them everywhere drops the file.
  const FILE_BACKED = new Set(['media', 'capture', 'proof', 'post', 'inspect-session']);

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

  // ── case notes (single notes.md) ─────────────────────────────────────────
  let caseNotes = $state('');
  let caseNotesLoadedFor = $state(null);
  let saveTimer;
  let saved = $state(true);
  let section = $state({ notes: false, suggestions: true, mywork: true });

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
  const entities = $derived(caseState.current?.entities ?? []);
  const links = $derived(caseState.current?.links ?? []);
  const suggested = $derived(entities.filter((e) => e.provenance?.status === 'suggested'));
  const confirmed = $derived(entities.filter((e) => e.provenance?.status !== 'suggested'));

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

  // clicking a row: notes open the editor, captures open their image, places
  // navigate the map — everything else opens its tool
  function onEntityActivate(entity) {
    if (entity.type === 'note') return openEditNote(entity);
    if (entity.type === 'capture') return openInfo(entity);
    openEntity(entity);
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
    if (entity.type === 'inspect-session') {
      // reopen the whole Inspect workspace (frames, adjustments, collage)
      const spec = entity.attrs?.spec ?? '';
      const name = spec.replace(/^inspect\//, '').replace(/\.json$/, '');
      if (name) uiState.openInspect = name;
      uiState.tool = 'inspect';
      return;
    }
    if (entity.type === 'place') {
      // fly the Satellite map to the point at the capture's own zoom/bearing
      const lat = Number(entity.attrs?.lat);
      const lon = Number(entity.attrs?.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        uiState.gotoCoords = {
          lat,
          lon,
          zoom: Number(entity.attrs?.zoom),
          bearing: Number(entity.attrs?.bearing),
        };
      }
      uiState.tool = 'satellite';
      return;
    }
    if (entity.type === 'media') {
      // switch to the Media Library and flag the item so it's highlighted there
      if (entity.attrs?.path) uiState.focusMedia = entity.attrs.path;
      uiState.tool = 'media';
      return;
    }
    const tool = ENTITY_TOOL[entity.type];
    if (tool) uiState.tool = tool;
  }

  // Fly the Satellite map to a capture's recorded coordinates (its marker),
  // matching its own zoom/bearing — the capture stays an image, this just
  // navigates. Mirrors the "Go to" button in the Satellite panel.
  function gotoCapture(entity) {
    const lat = Number(entity.attrs?.lat);
    const lon = Number(entity.attrs?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    uiState.gotoCoords = {
      lat,
      lon,
      zoom: Number(entity.attrs?.zoom),
      bearing: Number(entity.attrs?.bearing),
    };
    uiState.tool = 'satellite';
  }

  // ── My work: the analyst's own nested folder tree ('/'-separated paths) ────
  let newFolder = $state(''); // top-level create input
  let addingUnder = $state(undefined); // folder path currently gaining a child
  let newSubName = $state('');
  let expanded = $state({}); // path -> bool (absent = collapsed)
  let dragEntityId = $state(null);
  let dragOverFolder = $state(undefined); // folder path being hovered

  const caseFolders = $derived(caseState.current?.folders ?? []);

  const tree = $derived(buildTree(caseFolders, confirmed));
  const allFolders = $derived(flattenPaths(tree));
  // everything not yet filed — the inbox you file (or inspect) items from
  const unfiled = $derived(confirmed.filter((e) => !folderOf(e)));
  let unfiledOpen = $state(false);
  let unfiledTypeFilter = $state(null);
  const TYPE_LABEL = {
    media: 'Media', capture: 'Satellite', note: 'Notes', proof: 'Proofs',
    post: 'Posts', place: 'Places', 'inspect-session': 'Inspect',
  };
  // chip counts, in a stable order (declaration order of TYPE_LABEL, then anything unmapped)
  const unfiledTypes = $derived.by(() => {
    const counts = new Map();
    for (const e of unfiled) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    return Object.keys(TYPE_LABEL)
      .filter((t) => counts.has(t))
      .concat([...counts.keys()].filter((t) => !(t in TYPE_LABEL)))
      .map((t) => ({ type: t, label: TYPE_LABEL[t] ?? t, count: counts.get(t) }));
  });
  const unfiledFiltered = $derived(
    unfiledTypeFilter ? unfiled.filter((e) => e.type === unfiledTypeFilter) : unfiled
  );
  $effect(() => {
    // drop a stale filter when its type disappears from Unfiled (e.g. filed away)
    if (unfiledTypeFilter && !unfiled.some((e) => e.type === unfiledTypeFilter)) unfiledTypeFilter = null;
  });

  const isExpanded = (path) => expanded[path] === true;
  function toggle(path) { expanded[path] = !isExpanded(path); }
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

  // File (or unfile, with folder='') an entity into a My-work folder. Media
  // keeps its sidecar in sync via its own endpoint.
  async function assignFolder(entity, folder) {
    const val = folder || '';
    if ((entity.type === 'media' || entity.type === 'capture') && entity.attrs?.path) {
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

  // Delete everywhere: removes the entity and its underlying file(s). Used from
  // the details panel (and the note modal) — irreversible, danger tone.
  //
  // Whatever hangs off the entity is spelled out before the click: sessions that
  // cannot outlive it go too, outputs made from it stay and keep a record of
  // what they lost. Nothing cascades into an output — ever (ONTOLOGY §3).
  function askDeleteEverywhere(entity, onDone) {
    confirmState = {
      title: 'Delete everywhere?',
      message: `“${entity.label}” will be removed from the case and its tool.`,
      detail: FILE_BACKED.has(entity.type)
        ? 'This permanently deletes the underlying file(s) on disk — it cannot be undone.'
        : 'This permanently removes it from the case — it cannot be undone.',
      consequences: deletePlan(entities, links, entity.id),
      confirmLabel: 'Delete everywhere',
      tone: 'danger',
      icon: 'trash',
      action: async () => {
        await api.del(`/api/cases/${caseState.current.id}/entities/${entity.id}`);
        await reloadCase();
        toast(`Deleted "${entity.label}"`, 'info');
        onDone?.();
      },
    };
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
    const inside = entities.filter((e) => {
      const f = folderOf(e);
      return f === path || (f && f.startsWith(prefix));
    });
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
      action: async () => {
        for (const e of inside) await assignFolder(e, '');
        await api.del(
          `/api/cases/${caseState.current.id}/folders?name=${encodeURIComponent(path)}`
        );
        await reloadCase();
      },
    };
  }

  // ── details panel (selection info + editor, docs/UI.md §4) ────────────────
  let infoEntity = $state(null);
  let infoData = $state(null); // resolved media/satellite listing item (or null)
  let infoLoading = $state(false);
  // editable fields (title + notes), like the dedicated tool's editor
  let infoTitle = $state('');
  let infoNotes = $state('');
  let infoFolder = $state('');
  let infoSaving = $state(false);
  let detailsEl = $state(null);
  const detailsFilePath = $derived(
    infoData?.path ?? (infoEntity?.type === 'capture' ? infoEntity.attrs?.path : null)
  );
  // which types get title/notes editors straight from the sidebar
  const EDITABLE = new Set(['capture', 'place', 'media']);

  // The derivation chain around the selection: what it was made from, what was
  // made from it, and the sources it has outlived (ONTOLOGY §3). An entity with
  // no chain at all hides the section rather than showing an empty shell.
  const chain = $derived(infoEntity ? chainOf(entities, links, infoEntity.id) : null);
  const ENTITY_ICON = {
    media: 'media',
    capture: 'satellite',
    place: 'pin',
    proof: 'proof',
    post: 'post',
    'inspect-session': 'inspect',
    note: 'note',
  };

  async function openInfo(entity) {
    infoEntity = entity;
    infoData = null;
    infoTitle = entity.label ?? '';
    infoNotes = entity.attrs?.notes ?? '';
    infoFolder = folderOf(entity) ?? '';
    requestAnimationFrame(() => detailsEl?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    const endpoint =
      entity.type === 'media' ? 'media' : entity.type === 'capture' ? 'satellite' : null;
    if (endpoint && entity.attrs?.path) {
      infoLoading = true;
      try {
        const list = await api.get(`/api/cases/${caseState.current.id}/${endpoint}`);
        infoData = list.find((m) => m.path === entity.attrs.path) ?? null;
        if (infoData) {
          infoTitle = infoData.title ?? entity.label ?? '';
          infoNotes = infoData.notes ?? infoNotes;
        }
      } catch {
        infoData = null;
      } finally {
        infoLoading = false;
      }
    }
  }

  async function saveInfo() {
    if (!infoEntity || infoSaving) return;
    infoSaving = true;
    const cid = caseState.current.id;
    try {
      if (infoEntity.type === 'capture') {
        // the satellite PATCH keeps the sidecar (title/notes) and the mirrored
        // entity label in sync — the same path the Satellite tool uses
        await api.patch(`/api/cases/${cid}/satellite`, {
          path: infoEntity.attrs.path,
          title: infoTitle,
          notes: infoNotes,
        });
      } else if (infoEntity.type === 'media') {
        // the media PATCH writes the sidecar (title/notes) and mirrors the
        // title onto the entity label, so the Media tab reflects it too
        await api.patch(`/api/cases/${cid}/media`, {
          path: infoEntity.attrs.path,
          title: infoTitle.trim(),
          notes: infoNotes,
        });
      } else if (EDITABLE.has(infoEntity.type)) {
        // place (or any bare entity): retitle + note on the entity itself
        await api.patch(`/api/cases/${cid}/entities/${infoEntity.id}`, {
          label: infoTitle.trim() || infoEntity.label,
          attrs: { notes: infoNotes.trim() },
        });
      }
      // filing is part of the same Save: My work folder from the picker
      if ((infoFolder.trim() || '') !== (folderOf(infoEntity) ?? '')) {
        await assignFolder(infoEntity, infoFolder.trim());
      }
      await reloadCase();
      // the panel stays open on the fresh entity (reload replaced the objects)
      infoEntity = (caseState.current?.entities ?? []).find((x) => x.id === infoEntity.id) ?? null;
      toast('Saved', 'ok', 1600);
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      infoSaving = false;
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
    noteModal = { entity: null, title: '', folder: '', content: '' };
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

      <!-- 2 · Suggestions (tool-suggested entities: confirm or dismiss) -->
      {#if suggested.length > 0}
        <button class="section-head" onclick={() => (section.suggestions = !section.suggestions)}>
          <Icon name={section.suggestions ? 'chevronDown' : 'chevronRight'} size={13} />
          <span>Suggestions</span>
          <span class="count">{suggested.length}</span>
        </button>
        {#if section.suggestions}
          {#each suggested as e (e.id)}
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
        {/if}
      {/if}

      <!-- 3 · My work (your own folders; file items from their details panel) -->
      <div class="section-head-row">
        <button class="section-head" onclick={() => (section.mywork = !section.mywork)}>
          <Icon name={section.mywork ? 'chevronDown' : 'chevronRight'} size={13} />
          <span>My work</span>
          <span class="count">{confirmed.length}</span>
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

          {#if unfiled.length > 0}
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
              <span class="fcount">{unfiled.length}</span>
            </div>
            {#if unfiledOpen}
              {#if unfiledTypes.length > 1}
                <div class="chip-row">
                  {#each unfiledTypes as t (t.type)}
                    <button
                      class="chip"
                      class:active={unfiledTypeFilter === t.type}
                      onclick={() => (unfiledTypeFilter = unfiledTypeFilter === t.type ? null : t.type)}
                    >
                      {t.label}<span class="chip-count">{t.count}</span>
                    </button>
                  {/each}
                </div>
              {/if}
              {#each unfiledFiltered as e (e.id)}
                {@render entityRow(e, 1)}
              {/each}
            {/if}
          {/if}

          {#if tree.length === 0 && unfiled.length === 0}
            <div class="none">
              Everything you save lands here; create folders to organize it.
            </div>
          {/if}
        </div>
      {/if}


      <!-- 4 · Details (selection info + editor — docs/UI.md §4) -->
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
          {:else if infoEntity.type === 'capture' && infoEntity.attrs?.path}
            <div class="info-preview">
              <img src={`/files/${caseState.current.id}/${infoEntity.attrs.path}`} alt={infoEntity.label} />
            </div>
          {/if}

          {#if EDITABLE.has(infoEntity.type)}
            <label class="modal-label" for="info-title">Title</label>
            <input
              id="info-title"
              class="input"
              bind:value={infoTitle}
              placeholder={infoEntity.attrs?.coords ?? 'Title'}
            />
          {:else}
            <div class="details-title">{infoEntity.label}</div>
          {/if}

          <div class="info-rows">
            <div class="info-row"><span class="info-k">Type</span><span>{infoEntity.type}</span></div>
            {#if infoEntity.provenance?.by}
              <div class="info-row"><span class="info-k">Created by</span><span>{infoEntity.provenance.by}</span></div>
            {/if}
            {#if infoEntity.provenance?.at}
              <div class="info-row"><span class="info-k">Created</span><span class="mono">{infoEntity.provenance.at.slice(0, 10)}</span></div>
            {/if}
            {#if infoEntity.type === 'media' && infoData}
              <div class="info-row"><span class="info-k">Kind</span><span>{infoData.kind}</span></div>
              <div class="info-row"><span class="info-k">Size</span><span>{fmtSize(infoData.size)}</span></div>
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
              {#if infoData.source?.webpage_url ?? infoData.source?.url}
                <div class="info-row">
                  <span class="info-k">Source</span>
                  <a class="mono src" href={infoData.source.webpage_url ?? infoData.source.url} target="_blank" rel="noreferrer">
                    {infoData.source.webpage_url ?? infoData.source.url}
                  </a>
                </div>
              {/if}
            {:else if infoEntity.type === 'capture'}
              {#if infoData?.provider_label}
                <div class="info-row"><span class="info-k">Provider</span><span>{infoData.provider_label}</span></div>
              {/if}
              {#if infoEntity.attrs?.zoom != null}
                <div class="info-row"><span class="info-k">Zoom</span><span>z{infoEntity.attrs.zoom}</span></div>
              {/if}
              {#if infoData?.fetched_at}
                <div class="info-row"><span class="info-k">Captured</span><span class="mono">{infoData.fetched_at.slice(0, 10)}</span></div>
              {/if}
              {#if infoData?.imagery_date}
                <div class="info-row"><span class="info-k">Imagery</span><span class="mono">{infoData.imagery_date}</span></div>
              {/if}
            {:else if infoEntity.attrs?.content}
              <div class="info-note-body">{infoEntity.attrs.content}</div>
            {/if}
            {#if infoEntity.attrs?.coords}
              <div class="info-row"><span class="info-k">Coords</span><span class="mono">{infoEntity.attrs.coords}</span></div>
            {/if}
          </div>

          <!-- derivation chain: click a row to walk to that entity's details -->
          {#if chain && !chain.empty}
            <div class="chain">
              {#if chain.sources.length || chain.lost.length}
                <div class="chain-h">Made from</div>
                {#each chain.sources as { entity, type } (entity.id)}
                  <button class="chain-row" onclick={() => openInfo(entity)}>
                    <Icon name={ENTITY_ICON[entity.type] ?? 'file'} size={12} />
                    <span class="chain-label">{entity.label}</span>
                    {#if type === DEPENDS_ON}
                      <span class="chain-tag" title="This is a view over that item — it cannot outlive it">needs</span>
                    {/if}
                  </button>
                {/each}
                {#each chain.lost as lost (lost.path)}
                  <div class="chain-row gone" title={`Deleted on ${lost.at?.slice(0, 10) ?? 'an unknown date'}${lost.sha256 ? ` · sha256 ${lost.sha256}` : ''}`}>
                    <Icon name="alert" size={12} />
                    <span class="chain-label">{lost.label ?? lost.path}</span>
                    <span class="chain-tag">deleted</span>
                  </div>
                {/each}
                {#each chain.lost as lost (lost.path + '-src')}
                  {#if lost.source_url}
                    <a class="chain-src mono" href={lost.source_url} target="_blank" rel="noreferrer">{lost.source_url}</a>
                  {/if}
                {/each}
              {/if}
              {#if chain.dependents.length}
                <div class="chain-h">Used by</div>
                {#each chain.dependents as { entity, type } (entity.id)}
                  <button class="chain-row" onclick={() => openInfo(entity)}>
                    <Icon name={ENTITY_ICON[entity.type] ?? 'file'} size={12} />
                    <span class="chain-label">{entity.label}</span>
                    {#if type === DEPENDS_ON}
                      <span class="chain-tag warn" title="Deleting this item deletes that one too">goes with it</span>
                    {/if}
                  </button>
                {/each}
              {/if}
            </div>
          {/if}

          {#if EDITABLE.has(infoEntity.type)}
            <label class="modal-label" for="info-notes">Notes</label>
            <textarea
              id="info-notes"
              class="textarea"
              rows="3"
              bind:value={infoNotes}
              placeholder="Add observations, links, context…"
            ></textarea>
          {/if}

          <label class="modal-label" for="info-folder">Folder (My work)</label>
          <input
            id="info-folder"
            class="input"
            bind:value={infoFolder}
            placeholder="none"
            list="info-folder-suggestions"
          />
          <datalist id="info-folder-suggestions">
            {#each allFolders as f (f)}<option value={f}></option>{/each}
          </datalist>

          <div class="details-actions">
            {#if detailsFilePath}
              <a class="btn btn-ghost btn-sm" href={`/files/${caseState.current.id}/${detailsFilePath}`} target="_blank" rel="noreferrer">
                <Icon name="external" size={13} /> Open file
              </a>
            {/if}
            {#if ENTITY_TOOL[infoEntity.type]}
              <button class="btn btn-ghost btn-sm" onclick={() => openEntity(infoEntity)}>
                <Icon name="arrowRight" size={13} /> Open in tool
              </button>
            {/if}
            {#if infoEntity.type === 'capture' && infoEntity.attrs?.lat != null}
              <button class="btn btn-ghost btn-sm" onclick={() => gotoCapture(infoEntity)}>
                <Icon name="crosshair" size={13} /> Go to coords
              </button>
            {/if}
          </div>
          <div class="details-actions">
            <button
              class="btn btn-ghost btn-sm del"
              title="Delete everywhere: removes the item and its file(s) from the case"
              onclick={() => askDeleteEverywhere(infoEntity, () => (infoEntity = null))}
            >
              <Icon name="trash" size={13} /> Delete
            </button>
            <div style="flex:1"></div>
            <button class="btn btn-primary btn-sm" onclick={saveInfo} disabled={infoSaving}>
              {infoSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
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
    <span class="fcount">{subtreeCount(node)}</span>
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
    {#each node.entities as e (e.id)}
      {@render entityRow(e, depth + 1)}
    {/each}
  {/if}
{/snippet}

<!-- one entity row (My work): activate, info, unfile -->
{#snippet entityRow(e, depth)}
  {@const isClickable = e.type === 'note' || e.type === 'capture' || !!ENTITY_TOOL[e.type]}
  <div
    class="entity"
    class:clickable={isClickable}
    class:dragging={dragEntityId === e.id}
    style="padding-left: {8 + depth * 14}px"
    draggable="true"
    ondragstart={(ev) => onDragStart(ev, e)}
    ondragend={() => { dragEntityId = null; dragOverFolder = undefined; }}
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

    <label class="modal-label" for="note-folder" style="margin-top:10px">Folder (in My work)</label>
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
          onclick={() => askDeleteEverywhere(noteModal.entity, () => (noteModal = null))}
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


<!-- Confirmation dialog (delete everywhere / remove from My work / remove folder) -->
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
  .count { margin-left: auto; color: var(--text-3); font-weight: 600; }
  .notes {
    min-height: 130px;
    font-size: var(--fs-xs);
    margin: 0 4px 10px;
    width: calc(100% - 8px);
  }
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
  .chip-row { display: flex; flex-wrap: wrap; gap: 4px; padding: 2px 8px 6px 22px; }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 7px;
    border-radius: var(--r-sm);
    font-size: var(--fs-xs);
    font-weight: 500;
    background: var(--bg-2);
    color: var(--text-2);
    border: 1px solid transparent;
  }
  .chip:hover { color: var(--text-1); }
  .chip.active { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
  .chip-count { color: inherit; opacity: 0.65; font-weight: 600; }
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
  .details-title {
    font-weight: 600;
    margin-bottom: 6px;
    overflow-wrap: anywhere;
  }
  .details-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
    margin-top: 8px;
  }
  .details-actions .del { color: var(--danger); }
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

  /* derivation chain rows (ONTOLOGY §3) */
  .chain { margin-top: 14px; display: flex; flex-direction: column; gap: 2px; }
  .chain-h {
    font-size: var(--fs-xs);
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 6px 0 3px;
  }
  .chain-row {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 5px 6px;
    border: 0;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text-2);
    font-size: var(--fs-sm);
    text-align: left;
    min-width: 0;
  }
  button.chain-row { cursor: pointer; }
  button.chain-row:hover { background: var(--bg-2); color: var(--text-1); }
  .chain-row.gone { color: var(--text-3); }
  .chain-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chain-tag {
    flex-shrink: 0;
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 999px;
    background: var(--bg-2);
    color: var(--text-3);
  }
  .chain-tag.warn {
    background: color-mix(in srgb, var(--danger, #e5484d) 14%, transparent);
    color: color-mix(in srgb, var(--danger, #e5484d) 80%, var(--text-2));
  }
  .chain-src {
    font-size: 10px;
    color: var(--text-3);
    padding: 0 6px 4px 25px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
