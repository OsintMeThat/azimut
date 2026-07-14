<script>
  import { api } from '../lib/api.js';
  import { caseState, uiState, reloadCase, toast } from '../lib/state.svelte.js';
  import { TOOL_GROUPS, groupKey } from '../lib/savedGrouping.js';
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
  let section = $state({ notes: false, saved: true, mywork: true });

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
  const suggested = $derived(entities.filter((e) => e.provenance?.status === 'suggested'));
  const confirmed = $derived(entities.filter((e) => e.provenance?.status !== 'suggested'));

  const folderOf = (e) => e.attrs?.folder || null;

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

  // ── Saved work: every artifact, grouped by the tool that produced it ──────
  // The grouping is derived from provenance.by — the honest record of origin —
  // so it fills itself as you work and needs no manual upkeep. See
  // lib/savedGrouping.js for the actual bucketing rule (media/captures always
  // go under Media Library, regardless of which tool filed them).
  const savedGroups = $derived.by(() => {
    const buckets = new Map(TOOL_GROUPS.map(([k]) => [k, []]));
    for (const e of confirmed) buckets.get(groupKey(e)).push(e);
    return TOOL_GROUPS.map(([key, label, icon]) => ({
      key,
      label,
      icon,
      items: buckets.get(key),
    })).filter((g) => g.items.length > 0);
  });

  let groupOpen = $state({}); // group key -> bool (absent = collapsed)
  const isGroupOpen = (k) => groupOpen[k] === true;
  const toggleGroup = (k) => (groupOpen[k] = !isGroupOpen(k));

  // ── My work: the analyst's own nested folder tree ('/'-separated paths) ────
  let newFolder = $state(''); // top-level create input
  let addingUnder = $state(undefined); // folder path currently gaining a child
  let newSubName = $state('');
  let expanded = $state({}); // path -> bool (absent = collapsed)
  let dragEntityId = $state(null);
  let dragOverFolder = $state(undefined); // folder path being hovered

  const caseFolders = $derived(caseState.current?.folders ?? []);
  const filedCount = $derived(confirmed.filter((e) => folderOf(e)).length);

  // Build a nested tree from flat '/'-separated folder paths + filed entities.
  // Entities with no folder live only in Saved work, so they are ignored here.
  function buildTree(folders, items) {
    const root = { name: '', path: '', children: new Map(), entities: [] };
    const ensure = (path) => {
      let node = root, acc = '';
      for (const seg of path.split('/')) {
        acc = acc ? `${acc}/${seg}` : seg;
        if (!node.children.has(seg))
          node.children.set(seg, { name: seg, path: acc, children: new Map(), entities: [] });
        node = node.children.get(seg);
      }
      return node;
    };
    for (const f of folders) if (f) ensure(f);
    for (const e of items) {
      const f = folderOf(e);
      if (f) ensure(f).entities.push(e);
    }
    const sortNodes = (map) =>
      [...map.values()]
        .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
        .map((n) => ({ ...n, children: sortNodes(n.children) }));
    return sortNodes(root.children);
  }

  const tree = $derived(buildTree(caseFolders, confirmed));
  const allFolders = $derived(
    (function flatten(nodes) {
      return nodes.flatMap((n) => [n.path, ...flatten(n.children)]);
    })(tree)
  );

  function subtreeCount(node) {
    return node.entities.length + node.children.reduce((s, c) => s + subtreeCount(c), 0);
  }

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
  // Saved work (and the note modal) — irreversible, danger tone.
  function askDeleteEverywhere(entity, onDone) {
    confirmState = {
      title: 'Delete everywhere?',
      message: `“${entity.label}” will be removed from Saved work and My work.`,
      detail: FILE_BACKED.has(entity.type)
        ? 'This permanently deletes the underlying file(s) on disk — it cannot be undone.'
        : 'This permanently removes it from the case — it cannot be undone.',
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

  // Remove from My work: just clears the filing. The item stays in Saved work.
  function askRemoveFromMyWork(entity) {
    confirmState = {
      title: 'Remove from My work?',
      message: `“${entity.label}” goes back to Saved work — nothing is deleted.`,
      detail: 'It stays available under its tool in Saved work. Only your filing here is cleared.',
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
      detail: 'Items inside go back to Saved work — no files are deleted.',
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

  // ── entity info / edit modal ──────────────────────────────────────────────
  let infoEntity = $state(null);
  let infoData = $state(null); // resolved media/satellite listing item (or null)
  let infoLoading = $state(false);
  // editable fields (title + notes), like the dedicated tool's editor
  let infoTitle = $state('');
  let infoNotes = $state('');
  let infoSaving = $state(false);
  // which types can be edited straight from the sidebar
  const EDITABLE = new Set(['capture', 'place', 'media']);

  async function openInfo(entity) {
    infoEntity = entity;
    infoData = null;
    infoTitle = entity.label ?? '';
    infoNotes = entity.attrs?.notes ?? '';
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
      } else {
        // place (or any bare entity): retitle + note on the entity itself
        await api.patch(`/api/cases/${cid}/entities/${infoEntity.id}`, {
          label: infoTitle.trim() || infoEntity.label,
          attrs: { notes: infoNotes.trim() },
        });
      }
      infoEntity = null;
      await reloadCase();
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

      <!-- 2 · Saved work (auto — grouped by the tool that produced each item) -->
      <div class="section-head-row">
        <button class="section-head" onclick={() => (section.saved = !section.saved)}>
          <Icon name={section.saved ? 'chevronDown' : 'chevronRight'} size={13} />
          <span>Saved work</span>
          <span class="count">{confirmed.length}</span>
        </button>
        <button class="btn btn-ghost btn-sm new-note-btn" title="New note" onclick={openNewNote}>
          <Icon name="plus" size={13} /><Icon name="note" size={13} />
        </button>
      </div>

      {#if section.saved}
        <!-- suggested entities (pinned — confirm or dismiss) -->
        {#if suggested.length > 0}
          <div class="suggest-note">Suggested — confirm or dismiss:</div>
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

        <div class="tree">
          {#each savedGroups as g (g.key)}
            <button class="grow" onclick={() => toggleGroup(g.key)}>
              <Icon name={isGroupOpen(g.key) ? 'chevronDown' : 'chevronRight'} size={12} />
              <Icon name={g.icon} size={13} />
              <span class="fname">{g.label}</span>
              <span class="fcount">{g.items.length}</span>
            </button>
            {#if isGroupOpen(g.key)}
              {#each g.items as e (e.id)}
                {@render entityRow(e, 1, 'saved')}
              {/each}
            {/if}
          {/each}

          {#if savedGroups.length === 0 && suggested.length === 0}
            <div class="none">Tools file what you save here as you work.</div>
          {/if}
        </div>
      {/if}

      <!-- 3 · My work (manual — your own folders, filled by drag & drop) -->
      <button class="section-head" onclick={() => (section.mywork = !section.mywork)}>
        <Icon name={section.mywork ? 'chevronDown' : 'chevronRight'} size={13} />
        <span>My work</span>
        <span class="count">{filedCount}</span>
      </button>

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

          {#if tree.length === 0}
            <div class="none">
              Create a folder, then drag items from Saved work here to organize your investigation.
            </div>
          {/if}
        </div>
        {#if tree.length > 0}
          <div class="hint">Drag an item from Saved work onto a folder to file it here.</div>
        {/if}
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
      {@render entityRow(e, depth + 1, 'mywork')}
    {/each}
  {/if}
{/snippet}

<!-- one entity row. zone 'saved' → delete everywhere; 'mywork' → unfile only -->
{#snippet entityRow(e, depth, zone)}
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
    {#if zone === 'mywork'}
      <button
        class="btn btn-ghost btn-sm act del"
        title="Remove from My work"
        onclick={(ev) => { ev.stopPropagation(); askRemoveFromMyWork(e); }}
      >
        <Icon name="folderMinus" size={13} />
      </button>
    {:else}
      <button
        class="btn btn-ghost btn-sm act del"
        title="Delete everywhere"
        onclick={(ev) => { ev.stopPropagation(); askDeleteEverywhere(e); }}
      >
        <Icon name="trash" size={13} />
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
    {/if}

    <div class="info-rows">
      <div class="info-row"><span class="info-k">Type</span><span>{infoEntity.type}</span></div>
      {#if folderOf(infoEntity)}
        <div class="info-row"><span class="info-k">Folder</span><span>{folderOf(infoEntity)}</span></div>
      {/if}
      {#if infoEntity.type === 'media' && infoData}
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

    {#if EDITABLE.has(infoEntity.type)}
      <label class="modal-label" for="info-notes" style="margin-top:10px">Notes</label>
      <textarea
        id="info-notes"
        class="textarea"
        rows="4"
        bind:value={infoNotes}
        placeholder="Add observations, links, context…"
      ></textarea>
    {/if}

    {@const filePath = infoData?.path ?? (infoEntity.type === 'capture' ? infoEntity.attrs?.path : null)}
    <div class="modal-row">
      {#if filePath}
        <a class="btn btn-ghost btn-sm" href={`/files/${caseState.current.id}/${filePath}`} target="_blank" rel="noreferrer">
          <Icon name="external" size={13} /> Open file
        </a>
      {/if}
      {#if ENTITY_TOOL[infoEntity.type]}
        <button class="btn btn-ghost btn-sm" onclick={() => { openEntity(infoEntity); infoEntity = null; }}>
          <Icon name="arrowRight" size={13} /> Open in tool
        </button>
      {/if}
      {#if infoEntity.type === 'capture' && infoEntity.attrs?.lat != null}
        <button class="btn btn-ghost btn-sm" onclick={() => { gotoCapture(infoEntity); infoEntity = null; }}>
          <Icon name="crosshair" size={13} /> Go to coords
        </button>
      {/if}
      <div style="flex:1"></div>
      <button class="btn" onclick={() => (infoEntity = null)}>Close</button>
      {#if EDITABLE.has(infoEntity.type)}
        <button class="btn btn-primary" onclick={saveInfo} disabled={infoSaving}>
          {infoSaving ? 'Saving…' : 'Save'}
        </button>
      {/if}
    </div>
  </Modal>
{/if}

<!-- Confirmation dialog (delete everywhere / remove from My work / remove folder) -->
{#if confirmState}
  <ConfirmDialog
    title={confirmState.title}
    message={confirmState.message}
    detail={confirmState.detail}
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
  /* tool group header (Saved work) */
  .grow {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 6px 8px;
    border-radius: var(--r-sm);
    color: var(--text-2);
    font-size: var(--fs-sm);
    text-align: left;
  }
  .grow:hover { background: var(--bg-2); color: var(--text-1); }
  .grow > :global(svg:first-child) { color: var(--text-3); flex-shrink: 0; }
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
  .frow:hover .fact { opacity: 1; }
  .hint { font-size: var(--fs-xs); color: var(--text-3); padding: 2px 12px 8px; font-style: italic; }
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
  .none { font-size: var(--fs-xs); color: var(--text-3); padding: 4px 8px 12px; line-height: 1.45; }
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
