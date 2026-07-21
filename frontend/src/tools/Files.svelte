<script>
  /**
   * Files — the desktop view of My work. The case sidebar's folder tree, opened
   * up into a Finder-style surface: navigate folders, rubber-band-select several
   * items at once, and drag the lot into a folder. Reads every saved artifact
   * (media, captures, notes, proofs, posts, places, sessions), not just media.
   *
   * The tree and the filing routing are the sidebar's own (lib/folderTree.js,
   * lib/filing.js); the selection math is pure and unit-tested (lib/gridSelect.js).
   */
  import { api } from '../lib/api.js';
  import { caseState, reloadCase, toast } from '../lib/state.svelte.js';
  import { buildTree, subtreeCount, folderOf, flattenPaths, isInFolderSubtree } from '../lib/folderTree.js';
  import { assignFolderBatch } from '../lib/filing.js';
  import { createNote } from '../lib/notes.js';
  import { openNotebook } from '../lib/navigate.js';
  import { createBookmark } from '../lib/bookmarks.js';
  import { marqueeRect, marqueeHits, toggleSelection } from '../lib/gridSelect.js';
  import { fetchAllEntities } from '../lib/catalog.js';
  import Icon from '../components/Icon.svelte';
  import Modal from '../components/Modal.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import EntityDetails from '../components/EntityDetails.svelte';
  import FolderSelect from '../components/FolderSelect.svelte';

  const TYPE_ICON = {
    media: 'image', capture: 'satellite', note: 'note', proof: 'proof',
    post: 'post', place: 'pin', 'inspect-session': 'inspect', bookmark: 'link',
  };
  const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v']);
  // Entity types backed by a file on disk — deleting them drops the file too.
  const FILE_BACKED = new Set(['media', 'capture', 'proof', 'post', 'inspect-session', 'note']);

  // ── case data ──────────────────────────────────────────────────────────────
  // Every filed artifact, read a page at a time off the bounded catalog rather
  // than the case-open payload. My work is inherently the whole confirmed
  // catalog, so it fetches the whole slice — but server-side, never shipped in
  // the open response, and re-read on case change or a save/delete elsewhere.
  let confirmed = $state([]);
  $effect(() => {
    const id = caseState.current?.id;
    caseState.rev;
    if (!id) {
      confirmed = [];
      return;
    }
    let live = true;
    fetchAllEntities(id, { status: 'confirmed' })
      .then((list) => { if (live) confirmed = list; })
      .catch(() => { if (live) confirmed = []; });
    return () => { live = false; };
  });
  const tree = $derived(buildTree(caseState.current?.folders ?? [], confirmed));
  const allFolders = $derived(flattenPaths(tree));
  const unfiled = $derived(confirmed.filter((e) => !folderOf(e)));

  // Thumbnails: the media + satellite shelves, indexed by path. Same lists the
  // Media Library reads — a local call to our own backend, nothing external.
  let pathInfo = $state(new Map());
  $effect(() => {
    const id = caseState.current?.id;
    caseState.rev; // refetch after a save/move elsewhere
    if (!id) {
      pathInfo = new Map();
      return;
    }
    loadThumbs(id);
  });
  async function loadThumbs(id) {
    try {
      const [media, sat] = await Promise.all([
        api.get(`/api/cases/${id}/media`),
        api.get(`/api/cases/${id}/satellite`),
      ]);
      const m = new Map();
      for (const it of [...media, ...sat]) m.set(it.path, { thumbnail: it.thumbnail, kind: it.kind });
      pathInfo = m;
    } catch {
      pathInfo = new Map();
    }
  }

  function tileIcon(e) {
    if (e.type === 'media') {
      const kind = pathInfo.get(e.attrs?.path)?.kind;
      if (kind === 'video') return 'video';
      const ext = e.attrs?.path?.split('.').pop()?.toLowerCase();
      if (ext && VIDEO_EXTS.has(ext)) return 'video';
    }
    return TYPE_ICON[e.type] ?? 'file';
  }
  const tileThumb = (e) => pathInfo.get(e.attrs?.path)?.thumbnail ?? null;

  // ── navigation ──────────────────────────────────────────────────────────────
  let cwd = $state(''); // '' = root ("All")
  let showUnfiled = $state(false);

  function nodeAt(path) {
    if (!path) return { path: '', children: tree, entities: [] };
    let nodes = tree,
      node = null;
    for (const seg of path.split('/')) {
      node = nodes.find((n) => n.name === seg);
      if (!node) return { path, children: [], entities: [] };
      nodes = node.children;
    }
    return node;
  }

  // Search stays inside the open folder and its subfolders. The root is the
  // one intentional exception: it represents all of My work.
  let query = $state('');
  const searching = $derived(!!query.trim());
  function matches(e) {
    const q = query.trim().toLowerCase();
    return (
      (e.label ?? '').toLowerCase().includes(q) ||
      e.type.toLowerCase().includes(q) ||
      (folderOf(e) ?? '').toLowerCase().includes(q)
    );
  }

  const current = $derived(showUnfiled ? { path: '', children: [], entities: unfiled } : nodeAt(cwd));
  const searchScope = $derived(
    showUnfiled ? unfiled : cwd ? confirmed.filter((e) => isInFolderSubtree(e, cwd)) : confirmed
  );
  const curFolders = $derived(searching ? [] : current.children);
  const curEntities = $derived(searching ? searchScope.filter(matches) : current.entities);
  const entityOrder = $derived(curEntities.map((e) => e.id));
  const crumbs = $derived(cwd ? cwd.split('/') : []);
  // the Unfiled bucket shows as a tile at the root, even when empty (drop here
  // to unfile). Folder to create a new folder into on empty-space right-click.
  const showRootUnfiled = $derived(cwd === '' && !showUnfiled && !searching);
  const ctxParent = $derived(showUnfiled || searching ? '' : cwd);

  function openFolder(path) {
    showUnfiled = false;
    cwd = path;
  }
  function openUnfiled() {
    showUnfiled = true;
  }

  // ── selection ────────────────────────────────────────────────────────────────
  let selected = $state([]);
  let anchor = null;
  // clear the selection whenever the view changes
  $effect(() => {
    cwd;
    showUnfiled;
    query;
    selected = [];
    anchor = null;
  });

  function onTileClick(e, id) {
    const r = toggleSelection(selected, id, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey }, entityOrder, anchor);
    selected = r.selected;
    anchor = r.anchor;
  }

  // ── marquee (rubber-band) ─────────────────────────────────────────────────────
  let gridEl = $state(null);
  let marquee = $state(null); // {left, top, width, height} in the grid's content space

  function onGridPointerDown(e) {
    if (e.button !== 0 || e.target.closest('.tile')) return;
    const rect = gridEl.getBoundingClientRect();
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const base = additive ? [...selected] : [];
    if (!additive) {
      selected = [];
      anchor = null;
    }
    const at = (ev) => ({
      x: ev.clientX - rect.left + gridEl.scrollLeft,
      y: ev.clientY - rect.top + gridEl.scrollTop,
    });
    const start = at(e);
    const move = (ev) => {
      const cur = at(ev);
      const mr = marqueeRect(start.x, start.y, cur.x, cur.y);
      marquee = { left: mr.left, top: mr.top, width: mr.right - mr.left, height: mr.bottom - mr.top };
      selected = [...new Set([...base, ...marqueeHits(tileRects(rect), mr)])];
    };
    const up = () => {
      marquee = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function tileRects(gridRect) {
    return [...gridEl.querySelectorAll('.tile.entity')].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.dataset.id,
        left: r.left - gridRect.left + gridEl.scrollLeft,
        top: r.top - gridRect.top + gridEl.scrollTop,
        right: r.right - gridRect.left + gridEl.scrollLeft,
        bottom: r.bottom - gridRect.top + gridEl.scrollTop,
      };
    });
  }

  // ── drag to move ──────────────────────────────────────────────────────────────
  let draggingIds = $state([]);
  const UNFILED = Symbol('unfiled'); // drop-target marker for the Unfiled bucket
  let dropTarget = $state(null); // a folder path, UNFILED, or '' for unfile

  function onTileDragStart(ev, id) {
    if (!selected.includes(id)) {
      selected = [id];
      anchor = id;
    }
    draggingIds = [...selected];
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', draggingIds.join(','));
  }

  async function dropInto(folder) {
    const ids = draggingIds;
    draggingIds = [];
    dropTarget = null;
    if (!ids.length) return;
    const ents = confirmed.filter((e) => ids.includes(e.id));
    // no-op when dropped on the folder they already sit in
    if (ents.every((e) => (folderOf(e) ?? '') === folder)) return;
    try {
      await assignFolderBatch(caseState.current.id, ents, folder);
      await reloadCase();
      selected = [];
      toast(`Moved ${ents.length} item${ents.length > 1 ? 's' : ''}`, 'ok', 1600);
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  // ── folders ────────────────────────────────────────────────────────────────
  let newFolder = $state('');
  // create `leaf` under `parent` ('' = top level)
  async function createFolderAt(parent, leaf) {
    const name = (parent ? `${parent}/` : '') + leaf.trim();
    try {
      await api.post(`/api/cases/${caseState.current.id}/folders`, { name });
      await reloadCase();
    } catch (e) {
      toast(e.message, 'danger');
    }
  }
  function createFolder() {
    const leaf = newFolder.trim();
    if (!leaf) return;
    newFolder = '';
    createFolderAt(searching || showUnfiled ? '' : cwd, leaf);
  }

  // deleting a folder only clears the filing: items inside land in Unfiled,
  // no files are touched. Same routing the case sidebar uses.
  function askDeleteFolder(path) {
    const prefix = path + '/';
    const inside = confirmed.filter((e) => {
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
        if (inside.length) await assignFolderBatch(caseState.current.id, inside, '');
        await api.del(`/api/cases/${caseState.current.id}/folders?name=${encodeURIComponent(path)}`);
        await reloadCase();
        if (cwd === path || cwd.startsWith(prefix)) cwd = '';
      },
    };
  }

  // ── delete (irreversible; spells out what it touches) ─────────────────────
  let confirmState = $state(null); // { title, message, detail, consequences, confirmLabel, tone, icon, action }
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

  async function askDeleteEntities(ids) {
    const ents = confirmed.filter((e) => ids.includes(e.id));
    if (!ents.length) return;
    const multi = ents.length > 1;
    // The authoritative plan is the backend's; a single delete previews its
    // dependents endpoint rather than mirroring the whole graph client-side.
    let consequences = null;
    if (!multi) {
      try {
        consequences = await api.get(
          `/api/cases/${caseState.current.id}/entities/${ents[0].id}/dependents`
        );
      } catch {
        /* no preview — the delete still enforces the plan server-side */
      }
    }
    confirmState = {
      title: multi ? `Delete ${ents.length} items?` : 'Delete everywhere?',
      message: multi
        ? `${ents.length} items will be removed from the case and their tools.`
        : `“${ents[0].label}” will be removed from the case and its tool.`,
      detail: ents.some((e) => FILE_BACKED.has(e.type))
        ? 'This permanently deletes the underlying file(s) on disk. It cannot be undone.'
        : 'This permanently removes it from the case. It cannot be undone.',
      consequences,
      confirmLabel: multi ? 'Delete all' : 'Delete everywhere',
      tone: 'danger',
      icon: 'trash',
      action: async () => {
        for (const e of ents) await api.del(`/api/cases/${caseState.current.id}/entities/${e.id}`);
        await reloadCase();
        selected = [];
        toast(multi ? `Deleted ${ents.length} items` : `Deleted “${ents[0].label}”`, 'info');
      },
    };
  }

  // right-click → a small menu offering a new folder or a new note under
  // whatever was clicked (a folder, or the open one on empty space). The menu
  // opens in 'menu' mode; picking "New folder" swaps to the inline name field.
  // Right-clicking an actual folder node (tree row or tile) also offers to
  // delete it; right-clicking a file tile opens a separate entity menu.
  let ctx = $state(null); // { x, y, parent, mode: 'menu' | 'folder', isFolder } | { x, y, kind: 'entity', ids }
  let ctxName = $state('');
  function openCtx(e, parent, isFolder = false) {
    e.preventDefault();
    e.stopPropagation();
    ctx = { x: e.clientX, y: e.clientY, parent, mode: 'menu', isFolder };
    ctxName = '';
  }
  function ctxNewFolder() {
    ctx = { ...ctx, mode: 'folder' };
    ctxName = '';
  }
  function ctxCreate() {
    const leaf = ctxName.trim();
    const parent = ctx?.parent ?? '';
    ctx = null;
    if (leaf) createFolderAt(parent, leaf);
  }
  function ctxNewNote() {
    const parent = ctx?.parent ?? '';
    ctx = null;
    openNewNote(parent);
  }

  function ctxNewBookmark() {
    const parent = ctx?.parent ?? '';
    ctx = null;
    openNewBookmark(parent);
  }

  function ctxDeleteFolder() {
    const path = ctx?.parent;
    ctx = null;
    if (path) askDeleteFolder(path);
  }

  // right-click on a file tile: select it (unless it's part of the current
  // selection already) and open the file-specific menu instead.
  function openEntityCtx(e, entity) {
    e.preventDefault();
    e.stopPropagation();
    if (!selected.includes(entity.id)) {
      selected = [entity.id];
      anchor = entity.id;
    }
    ctx = { x: e.clientX, y: e.clientY, kind: 'entity', ids: [...selected] };
  }

  function openEntityTile(entity) {
    if (entity.type === 'note') {
      openNotebook(entity.id);
      return;
    }
    infoEntityId = entity.id;
  }
  function ctxMoveToUnfiled() {
    const ids = ctx?.ids ?? [];
    ctx = null;
    if (!ids.length) return;
    draggingIds = ids;
    dropInto('');
  }
  function ctxDeleteEntities() {
    const ids = ctx?.ids ?? [];
    ctx = null;
    askDeleteEntities(ids);
  }

  // ── notes ────────────────────────────────────────────────────────────────
  let noteModal = $state(null); // { folder, title }
  let noteSaving = $state(false);
  function openNewNote(folder) {
    noteModal = { folder: folder ?? '', title: '' };
  }
  async function saveNote() {
    if (!noteModal || !noteModal.title.trim()) {
      toast('Title required', 'warn');
      return;
    }
    noteSaving = true;
    try {
      const note = await createNote(caseState.current.id, noteModal);
      await reloadCase();
      noteModal = null;
      openNotebook(note.id);
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      noteSaving = false;
    }
  }

  // ── bookmarks ────────────────────────────────────────────────────────────
  let bookmarkModal = $state(null); // { folder, title, url, notes }
  let bookmarkSaving = $state(false);
  function openNewBookmark(folder) {
    bookmarkModal = { folder: folder ?? '', title: '', url: '', notes: '' };
  }
  async function saveBookmark() {
    if (!bookmarkModal) return;
    bookmarkSaving = true;
    try {
      await createBookmark(caseState.current.id, bookmarkModal);
      await reloadCase();
      toast('Bookmark saved', 'ok', 1600);
      bookmarkModal = null;
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      bookmarkSaving = false;
    }
  }

  // ── tree rail ────────────────────────────────────────────────────────────────
  let expanded = $state({});
  const isExpanded = (p) => expanded[p] === true;
  function toggle(p) {
    expanded[p] = !isExpanded(p);
  }

  // ── details ────────────────────────────────────────────────────────────────
  let infoEntityId = $state(null);
  let dense = $state(true); // small thumbnails by default — this view's whole point
</script>

<div class="tool">
  <div class="tool-header">
    <h2>Files</h2>
    <span class="sub">Organize My work</span>
    <div class="spacer"></div>
    <div class="search-box">
      <Icon name="search" size={13} />
      <input class="search-input" placeholder={cwd ? 'Search this folder…' : 'Search My work…'} bind:value={query} />
      {#if query}
        <button class="search-clear" onclick={() => (query = '')} aria-label="Clear search">
          <Icon name="x" size={12} />
        </button>
      {/if}
    </div>
    <button
      class="btn btn-ghost btn-sm"
      title={dense ? 'Larger thumbnails' : 'Smaller thumbnails'}
      onclick={() => (dense = !dense)}
    >
      <Icon name="grip" size={15} /> {dense ? 'Small' : 'Large'}
    </button>
    <form class="new-folder" onsubmit={(e) => { e.preventDefault(); createFolder(); }}>
      <input class="input" placeholder="New folder…" bind:value={newFolder} />
      <button class="btn" type="submit" disabled={!newFolder.trim()}>
        <Icon name="folder" size={14} /> Add
      </button>
    </form>
  </div>

  {#if !caseState.current}
    <div class="empty" style="height: 100%">
      <div class="empty-icon"><Icon name="folder" size={42} /></div>
      <h3>No case open</h3>
      <p>Create or open a case to organize its files.</p>
    </div>
  {:else}
    <div class="workbench">
      <!-- left: folder tree (navigation + drop targets) -->
      <aside class="tree-rail">
        <div
          class="trow"
          class:active={cwd === '' && !showUnfiled}
          class:dropping={dropTarget === ''}
          role="button"
          tabindex="0"
          onclick={() => openFolder('')}
          onkeydown={(e) => e.key === 'Enter' && openFolder('')}
          oncontextmenu={(e) => openCtx(e, '')}
          ondragover={(e) => { e.preventDefault(); dropTarget = ''; }}
          ondragleave={() => (dropTarget = dropTarget === '' ? null : dropTarget)}
          ondrop={(e) => { e.preventDefault(); dropInto(''); }}
        >
          <Icon name="layers" size={14} />
          <span class="tname">All</span>
          <span class="tcount">{confirmed.length}</span>
        </div>

        {#each tree as node (node.path)}
          {@render treeNode(node, 0)}
        {/each}

        <!-- Unfiled stays even when empty: a place to drop files back into -->
        <div
          class="trow"
          class:active={showUnfiled}
            class:dropping={dropTarget === UNFILED}
            role="button"
            tabindex="0"
            onclick={openUnfiled}
            onkeydown={(e) => e.key === 'Enter' && openUnfiled()}
            ondragover={(e) => { e.preventDefault(); dropTarget = UNFILED; }}
            ondragleave={() => (dropTarget = dropTarget === UNFILED ? null : dropTarget)}
            ondrop={(e) => { e.preventDefault(); dropInto(''); }}
          >
            <Icon name="file" size={14} />
            <span class="tname">Unfiled</span>
            <span class="tcount">{unfiled.length}</span>
          </div>
      </aside>

      <!-- right: the desktop surface -->
      <section class="grid-pane">
        <div class="crumbs">
          <button class="crumb" onclick={() => openFolder('')}>All</button>
          {#if showUnfiled}
            <Icon name="chevronRight" size={12} />
            <span class="crumb here">Unfiled</span>
          {:else}
            {#each crumbs as seg, i (i)}
              <Icon name="chevronRight" size={12} />
              {#if i === crumbs.length - 1}
                <span class="crumb here">{seg}</span>
              {:else}
                <button class="crumb" onclick={() => openFolder(crumbs.slice(0, i + 1).join('/'))}>{seg}</button>
              {/if}
            {/each}
          {/if}
          <div class="spacer"></div>
          {#if selected.length}
            <span class="sel-count">{selected.length} selected</span>
          {/if}
        </div>

        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="grid"
          class:dense
          bind:this={gridEl}
          onpointerdown={onGridPointerDown}
          oncontextmenu={(e) => openCtx(e, ctxParent)}
        >
          {#if !showUnfiled}
            {#each curFolders as node (node.path)}
              <div
                class="tile folder"
                class:dropping={dropTarget === node.path}
                role="button"
                tabindex="0"
                title={node.name}
                ondblclick={() => openFolder(node.path)}
                onkeydown={(e) => e.key === 'Enter' && openFolder(node.path)}
                oncontextmenu={(e) => openCtx(e, node.path, true)}
                ondragover={(e) => { e.preventDefault(); dropTarget = node.path; }}
                ondragleave={() => (dropTarget = dropTarget === node.path ? null : dropTarget)}
                ondrop={(e) => { e.preventDefault(); dropInto(node.path); }}
              >
                <div class="thumb folder-thumb"><Icon name="folder" size={dense ? 26 : 38} /></div>
                <span class="tile-name">{node.name}</span>
                <span class="tile-sub">{subtreeCount(node)} item{subtreeCount(node) === 1 ? '' : 's'}</span>
              </div>
            {/each}

            {#if showRootUnfiled}
              <div
                class="tile folder"
                class:dropping={dropTarget === UNFILED}
                role="button"
                tabindex="0"
                title="Unfiled"
                ondblclick={openUnfiled}
                onkeydown={(e) => e.key === 'Enter' && openUnfiled()}
                ondragover={(e) => { e.preventDefault(); dropTarget = UNFILED; }}
                ondragleave={() => (dropTarget = dropTarget === UNFILED ? null : dropTarget)}
                ondrop={(e) => { e.preventDefault(); dropInto(''); }}
              >
                <div class="thumb folder-thumb unfiled"><Icon name="file" size={dense ? 26 : 38} /></div>
                <span class="tile-name">Unfiled</span>
                <span class="tile-sub">{unfiled.length} item{unfiled.length === 1 ? '' : 's'}</span>
              </div>
            {/if}
          {/if}

          {#each curEntities as e (e.id)}
            <div
              class="tile entity"
              class:selected={selected.includes(e.id)}
              data-id={e.id}
              draggable="true"
              role="button"
              tabindex="0"
              title={e.label}
              onclick={(ev) => onTileClick(ev, e.id)}
              ondblclick={() => openEntityTile(e)}
              onkeydown={(ev) => ev.key === 'Enter' && openEntityTile(e)}
              oncontextmenu={(ev) => openEntityCtx(ev, e)}
              ondragstart={(ev) => onTileDragStart(ev, e.id)}
              ondragend={() => { draggingIds = []; dropTarget = null; }}
            >
              <div class="thumb">
                {#if tileThumb(e)}
                  <img src={`/files/${caseState.current.id}/${tileThumb(e)}`} alt={e.label} loading="lazy" />
                {:else}
                  <Icon name={tileIcon(e)} size={dense ? 24 : 34} />
                {/if}
              </div>
              <span class="tile-name">{e.label}</span>
              <span class="tile-sub">{e.type}</span>
              <button
                class="tile-info btn btn-ghost btn-sm"
                title="Details"
                onclick={(ev) => { ev.stopPropagation(); infoEntityId = e.id; }}
              >
                <Icon name="note" size={13} />
              </button>
            </div>
          {/each}

          {#if !curFolders.length && !curEntities.length && !showRootUnfiled}
            <div class="grid-empty">
              <Icon name="folder" size={34} />
              <p>
                {#if searching}No files match “{query.trim()}”.
                {:else if showUnfiled}Nothing unfiled.
                {:else}This folder is empty. Drag items here, or right-click to add a subfolder or note.{/if}
              </p>
            </div>
          {/if}

          {#if marquee}
            <div
              class="marquee"
              style="left:{marquee.left}px; top:{marquee.top}px; width:{marquee.width}px; height:{marquee.height}px"
            ></div>
          {/if}
        </div>
      </section>
    </div>
  {/if}
</div>

<!-- one tree node + subtree (navigation + drop target) -->
{#snippet treeNode(node, depth)}
  <div
    class="trow"
    class:active={!showUnfiled && cwd === node.path}
    class:dropping={dropTarget === node.path}
    style="padding-left: {8 + depth * 14}px"
    role="button"
    tabindex="0"
    onclick={() => openFolder(node.path)}
    onkeydown={(e) => e.key === 'Enter' && openFolder(node.path)}
    oncontextmenu={(e) => openCtx(e, node.path, true)}
    ondragover={(e) => { e.preventDefault(); dropTarget = node.path; }}
    ondragleave={() => (dropTarget = dropTarget === node.path ? null : dropTarget)}
    ondrop={(e) => { e.preventDefault(); dropInto(node.path); }}
  >
    {#if node.children.length}
      <span
        class="tchevron"
        role="button"
        tabindex="0"
        title="Expand"
        onclick={(e) => { e.stopPropagation(); toggle(node.path); }}
        onkeydown={(e) => e.key === 'Enter' && (e.stopPropagation(), toggle(node.path))}
      >
        <Icon name={isExpanded(node.path) ? 'chevronDown' : 'chevronRight'} size={12} />
      </span>
    {:else}
      <span class="tchevron spacer-icon"></span>
    {/if}
    <Icon name={isExpanded(node.path) ? 'folderOpen' : 'folder'} size={14} />
    <span class="tname">{node.name}</span>
    <span class="tcount">{subtreeCount(node)}</span>
  </div>
  {#if isExpanded(node.path)}
    {#each node.children as child (child.path)}
      {@render treeNode(child, depth + 1)}
    {/each}
  {/if}
{/snippet}

<!-- right-click menu: create a folder or a note under whatever was clicked -->
{#if ctx}
  <div
    class="ctx-backdrop"
    role="presentation"
    onpointerdown={() => (ctx = null)}
    oncontextmenu={(e) => e.preventDefault()}
  ></div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="ctx-menu" style="left:{ctx.x}px; top:{ctx.y}px" onpointerdown={(e) => e.stopPropagation()}>
    {#if ctx.kind === 'entity'}
      <div class="ctx-head">{ctx.ids.length > 1 ? `${ctx.ids.length} items` : 'Item'}</div>
      {#if !showUnfiled}
        <button class="ctx-item" onclick={ctxMoveToUnfiled}>
          <Icon name="folderMinus" size={14} /> Move to Unfiled
        </button>
      {/if}
      <button class="ctx-item danger" onclick={ctxDeleteEntities}>
        <Icon name="trash" size={14} /> Delete
      </button>
    {:else if ctx.mode === 'folder'}
      <div class="ctx-head">New folder{ctx.parent ? ` in ${ctx.parent.split('/').pop()}` : ''}</div>
      <form onsubmit={(e) => { e.preventDefault(); ctxCreate(); }}>
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="input"
          placeholder="Folder name…"
          bind:value={ctxName}
          autofocus
          onkeydown={(e) => e.key === 'Escape' && (ctx = null)}
        />
        <button class="btn btn-primary btn-sm" type="submit" disabled={!ctxName.trim()}>Create</button>
      </form>
    {:else}
      <div class="ctx-head">{ctx.parent ? ctx.parent.split('/').pop() : 'All'}</div>
      <button class="ctx-item" onclick={ctxNewFolder}>
        <Icon name="folder" size={14} /> New folder
      </button>
      <button class="ctx-item" onclick={ctxNewNote}>
        <Icon name="note" size={14} /> New note
      </button>
      <button class="ctx-item" onclick={ctxNewBookmark}>
        <Icon name="link" size={14} /> New bookmark
      </button>
      {#if ctx.isFolder && ctx.parent}
        <div class="ctx-sep"></div>
        <button class="ctx-item danger" onclick={ctxDeleteFolder}>
          <Icon name="trash" size={14} /> Delete folder
        </button>
      {/if}
    {/if}
  </div>
{/if}

<!-- delete confirmation (entities or a folder) -->
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

<!-- new-note modal (same shape the case sidebar uses) -->
{#if noteModal}
  <Modal title="New note" onclose={() => (noteModal = null)} width="580px">
    <label class="modal-label" for="fnote-title">Title</label>
    <input id="fnote-title" class="input" placeholder="Note title…" bind:value={noteModal.title} />

    <span class="modal-label" style="margin-top:10px">Folder (in My work)</span>
    <FolderSelect bind:value={noteModal.folder} folders={allFolders} emptyLabel="My work (root)" />

    <div class="modal-row">
      <div style="flex:1"></div>
      <button class="btn" onclick={() => (noteModal = null)}>Cancel</button>
      <button class="btn btn-primary" onclick={saveNote} disabled={noteSaving}>
        {noteSaving ? 'Saving…' : 'Create'}
      </button>
    </div>
  </Modal>
{/if}

<!-- new-bookmark modal: save a link to a web page (no screenshot) -->
{#if bookmarkModal}
  <Modal title="New bookmark" onclose={() => (bookmarkModal = null)} width="580px">
    <label class="modal-label" for="fbm-url">URL</label>
    <input id="fbm-url" class="input" placeholder="https://…" bind:value={bookmarkModal.url} />

    <label class="modal-label" for="fbm-title" style="margin-top:10px">Title</label>
    <input id="fbm-title" class="input" placeholder="Bookmark title…" bind:value={bookmarkModal.title} />

    <span class="modal-label" style="margin-top:10px">Folder (in My work)</span>
    <FolderSelect bind:value={bookmarkModal.folder} folders={allFolders} emptyLabel="My work (root)" />

    <label class="modal-label" for="fbm-notes" style="margin-top:10px">Notes</label>
    <textarea id="fbm-notes" class="textarea" rows="3" placeholder="Why this page matters…" bind:value={bookmarkModal.notes}></textarea>

    <div class="modal-row">
      <div style="flex:1"></div>
      <button class="btn" onclick={() => (bookmarkModal = null)}>Cancel</button>
      <button class="btn btn-primary" onclick={saveBookmark} disabled={bookmarkSaving}>
        {bookmarkSaving ? 'Saving…' : 'Save'}
      </button>
    </div>
  </Modal>
{/if}

<!-- details editor: the shared body, same as the sidebar and Media modal -->
{#if infoEntityId}
  <Modal title="Details" onclose={() => (infoEntityId = null)} width="520px">
    <EntityDetails
      entityId={infoEntityId}
      onclose={() => (infoEntityId = null)}
      ondeleted={() => (infoEntityId = null)}
    />
  </Modal>
{/if}

<style>
  .spacer {
    flex: 1;
  }
  .new-folder {
    display: flex;
    gap: 6px;
  }
  .new-folder .input {
    width: 160px;
    font-size: var(--fs-sm);
  }
  .search-box {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-3);
  }
  .search-box:focus-within {
    border-color: var(--accent);
  }
  .search-input {
    width: 160px;
    border: none;
    background: none;
    outline: none;
    color: var(--text-1);
    font-size: var(--fs-xs);
  }
  .search-clear {
    display: inline-flex;
    color: var(--text-3);
    padding: 1px;
    border-radius: 50%;
  }
  .search-clear:hover {
    color: var(--text-1);
    background: var(--bg-3);
  }

  /* right-click new-folder menu */
  .ctx-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
  }
  .ctx-menu {
    position: fixed;
    z-index: 41;
    width: 220px;
    padding: 8px;
    background: var(--bg-1);
    border: 1px solid var(--border-strong);
    border-radius: var(--r);
    box-shadow: var(--shadow-2);
  }
  .ctx-head {
    font-size: var(--fs-xs);
    color: var(--text-3);
    margin: 2px 2px 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ctx-menu form {
    display: flex;
    gap: 6px;
  }
  .ctx-menu .input {
    flex: 1;
    font-size: var(--fs-sm);
  }
  .ctx-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 8px;
    border-radius: var(--r-sm);
    color: var(--text-1);
    font-size: var(--fs-sm);
    text-align: left;
  }
  .ctx-item:hover {
    background: var(--bg-2);
  }
  .ctx-item > :global(svg) {
    color: var(--text-3);
    flex-shrink: 0;
  }
  .ctx-item.danger {
    color: var(--danger, #e5484d);
  }
  .ctx-item.danger > :global(svg) {
    color: inherit;
  }
  .ctx-sep {
    height: 1px;
    margin: 6px 2px;
    background: var(--border);
  }

  /* new-note modal */
  .modal-label {
    display: block;
    font-size: var(--fs-xs);
    color: var(--text-3);
    margin: 8px 0 4px;
  }
  .modal-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 14px;
  }

  .workbench {
    flex: 1;
    min-height: 0;
    display: flex;
  }

  /* left tree rail */
  .tree-rail {
    width: 200px;
    flex-shrink: 0;
    border-right: 1px solid var(--border);
    background: var(--bg-1);
    overflow-y: auto;
    padding: 8px 6px;
  }
  .trow {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 8px;
    border-radius: var(--r-sm);
    border: 1px solid transparent;
    color: var(--text-2);
    font-size: var(--fs-sm);
    cursor: pointer;
    text-align: left;
  }
  .trow:hover {
    background: var(--bg-2);
  }
  .trow.active {
    background: var(--bg-3);
    color: var(--text-1);
  }
  .trow.dropping {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .trow > :global(svg) {
    color: var(--text-3);
    flex-shrink: 0;
  }
  .tchevron {
    display: flex;
    width: 12px;
    flex-shrink: 0;
    color: var(--text-3);
  }
  .tchevron.spacer-icon {
    width: 12px;
  }
  .tname {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tcount {
    color: var(--text-3);
    font-size: var(--fs-xs);
    font-weight: 600;
  }

  /* right desktop surface */
  .grid-pane {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .crumbs {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .crumb {
    font-size: var(--fs-sm);
    color: var(--text-3);
    padding: 2px 4px;
    border-radius: var(--r-sm);
  }
  button.crumb:hover {
    color: var(--text-1);
    background: var(--bg-2);
  }
  .crumb.here {
    color: var(--text-1);
    font-weight: 600;
  }
  .crumbs > :global(svg) {
    color: var(--text-3);
  }
  .sel-count {
    font-size: var(--fs-xs);
    color: var(--accent);
    font-weight: 600;
  }

  .grid {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 14px 16px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 12px;
    align-content: start;
    user-select: none;
  }
  .grid.dense {
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 8px;
  }

  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 8px 6px;
    border-radius: var(--r);
    border: 1px solid transparent;
    position: relative;
    cursor: pointer;
  }
  .tile:hover {
    background: var(--bg-1);
  }
  .tile.folder:hover {
    border-color: var(--border-strong);
  }
  .tile.entity.selected {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
  .tile.dropping {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .thumb {
    width: 100%;
    aspect-ratio: 1 / 1;
    border-radius: var(--r-sm);
    background: var(--bg-2);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-3);
    overflow: hidden;
  }
  .grid:not(.dense) .thumb {
    aspect-ratio: 4 / 3;
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .folder-thumb {
    background: transparent;
    color: var(--accent);
  }
  .folder-thumb.unfiled {
    color: var(--text-3);
  }
  .tile-name {
    font-size: var(--fs-xs);
    color: var(--text-1);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
  }
  .tile-sub {
    font-size: 10px;
    color: var(--text-3);
  }
  .tile-info {
    position: absolute;
    top: 4px;
    right: 4px;
    opacity: 0;
    background: rgba(16, 16, 16, 0.6);
    backdrop-filter: blur(3px);
  }
  .tile.entity:hover .tile-info {
    opacity: 1;
  }

  .marquee {
    position: absolute;
    border: 1px solid var(--accent);
    background: var(--accent-soft);
    pointer-events: none;
    z-index: 3;
  }
  .grid-empty {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 48px 0;
    color: var(--text-3);
    font-size: var(--fs-sm);
  }
</style>
