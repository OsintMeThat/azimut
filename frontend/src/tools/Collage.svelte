<script>
  import { api } from '../lib/api.js';
  import { fileUrl } from '../lib/fileUrl.js';
  import { caseState, uiState, reloadCase, toast } from '../lib/state.svelte.js';
  import {
    uid, initialQuad, quadFromCropRect, collageBounds, COLLAGE_DEFAULT_SIZE,
  } from '../lib/inspect.js';
  import {
    workState, collageSpec, collageSignature, missingPieces, isFiled,
  } from '../lib/inspectWork.svelte.js';
  import { nextName } from '../lib/naming.js';
  import { createAutosave } from '../lib/autosave.svelte.js';
  import { createHistory } from '../lib/history.js';
  import { deletedToast } from '../lib/trash.js';
  import Icon from '../components/Icon.svelte';
  import Modal from '../components/Modal.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import CollageCanvas from './inspect/CollageCanvas.svelte';
  import CollageMenu from './inspect/CollageMenu.svelte';
  import PiecePicker from './inspect/PiecePicker.svelte';
  import PieceCropModal from './inspect/PieceCropModal.svelte';
  import SaveToCase from './inspect/SaveToCase.svelte';

  // A collage lays out pieces from any number of files on one canvas: frames cut
  // in Inspect, or images already in the case. It is a document of its own, saved
  // as it is made (engine/inspectwork.py), and the picture it exports is media.

  let mediaList = $state([]);
  let works = $state([]);
  let collages = $state([]);
  let filters = $state([]);
  let loadedFor = $state(null);
  let listOpen = $state(false);
  let deleting = $state(null); // the collage row a delete is being confirmed for
  let exporting = $state(false);
  let exportFolder = $state('');
  let selectedIds = $state([]);
  let cropPieceNode = $state(null);
  let opening = $state(false);

  const mediaPaths = $derived(new Set(mediaList.map((m) => m.path)));
  const images = $derived(mediaList.filter((m) => m.kind === 'image'));
  // A work is listed under its file's name as the file has it now, whatever the
  // work itself is called.
  const fileTitles = $derived(new Map(mediaList.map((m) => [m.path, m.title || m.filename])));
  const pickerWorks = $derived(works.map((w) => ({ ...w, title: fileTitles.get(w.source) ?? w.title })));

  // The open collage. `name` is the file it is saved under, absent until the
  // first piece makes it worth filing.
  const doc = $state({
    open: false,
    caseId: null,
    name: null,
    title: '',
    width: COLLAGE_DEFAULT_SIZE.width,
    height: COLLAGE_DEFAULT_SIZE.height,
    background: '#12141c',
    transparent: true,
    nodes: [],
    exported: null,
  });
  let docRun = 0;
  const blobs = new Set();

  const used = $derived.by(() => {
    const counts = new Map();
    for (const n of doc.nodes) if (n.frameId) counts.set(n.frameId, (counts.get(n.frameId) ?? 0) + 1);
    return counts;
  });
  const lost = $derived(missingPieces(doc).length);
  const exportedPath = $derived(
    isFiled(doc.exported, collageSignature(doc), mediaPaths) ? doc.exported.path : null
  );

  // -- saving as it is made -----------------------------------------------------
  let savedSignature = $state(null);
  const signature = () => JSON.stringify(collageSpec(doc));

  async function writeCollage(opts) {
    if (!doc.open || opening) return;
    const sig = signature();
    if (sig === savedSignature) return;
    // An empty new collage is not worth a file yet.
    if (!doc.name && !doc.nodes.length) return;
    const run = docRun;
    const res = await api.post(
      `/api/cases/${doc.caseId}/collages`,
      { name: doc.name, title: doc.name ?? doc.title, spec: JSON.parse(sig) },
      opts,
    );
    if (run !== docRun) return;
    const first = !doc.name;
    doc.name = res.name;
    doc.title = res.title;
    savedSignature = sig;
    if (first) reloadCase(); // the sidebar lists the collage it just filed
  }

  const autosave = createAutosave({ write: () => writeCollage() });

  $effect(() => {
    const sig = signature();
    if (!doc.open || opening || sig === savedSignature) return;
    autosave.schedule();
  });

  $effect(() => {
    if (uiState.tool !== 'collage') autosave.flush();
  });
  $effect(() => () => autosave.flush());

  function onpagehide() {
    if (autosave.pending) writeCollage({ keepalive: true }).catch(() => {});
  }

  const status = $derived.by(() => {
    if (!doc.open || (!doc.name && !doc.nodes.length)) return '';
    if (autosave.state.status === 'error') return 'error';
    if (autosave.state.status === 'pending' || autosave.state.status === 'saving') return 'saving';
    return 'saved';
  });

  // -- undo / redo ------------------------------------------------------------------
  // Snapshots of the layout. A drag moves quads continuously; the debounced
  // capture collapses it into one entry.
  const history = createHistory();
  let canUndo = $state(false);
  let canRedo = $state(false);
  let restoring = false; // plain: suppresses capture while a snapshot is put back
  let historyTimer = null;
  const layoutSnapshot = () =>
    JSON.stringify({ width: doc.width, height: doc.height, nodes: doc.nodes });

  function syncHistory() {
    canUndo = history.canUndo;
    canRedo = history.canRedo;
  }

  function anchorHistory() {
    clearTimeout(historyTimer);
    history.reset(layoutSnapshot());
    syncHistory();
  }

  $effect(() => {
    const json = layoutSnapshot();
    if (restoring || !doc.open) return;
    clearTimeout(historyTimer);
    historyTimer = setTimeout(() => {
      history.push(json);
      syncHistory();
    }, 350);
  });

  function applySnapshot(json) {
    restoring = true;
    const snap = JSON.parse(json);
    doc.width = snap.width;
    doc.height = snap.height;
    doc.nodes = snap.nodes;
    selectedIds = [];
    // outlast the capture debounce so the restore itself is not recorded
    setTimeout(() => (restoring = false), 400);
  }

  function undo() {
    const json = history.undo();
    if (json != null) applySnapshot(json);
    syncHistory();
  }

  function redo() {
    const json = history.redo();
    if (json != null) applySnapshot(json);
    syncHistory();
  }

  function onWindowKeydown(e) {
    if (uiState.tool !== 'collage' || !doc.open) return;
    const t = e.target;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (k === 'y') { e.preventDefault(); redo(); }
  }

  // -- the case ---------------------------------------------------------------------
  async function ensureOps() {
    if (filters.length) return;
    const ops = await api.get('/api/inspect/ops');
    filters = ops.filters.filter((f) => !['crop', 'rotate', 'remap'].includes(f.id));
  }

  async function refreshList(id = caseState.current?.id) {
    if (!id) return;
    try {
      collages = await api.get(`/api/cases/${id}/collages`);
    } catch {
      collages = [];
    }
  }

  async function refreshWorks(id = caseState.current?.id) {
    if (!id) return;
    try {
      works = await api.get(`/api/cases/${id}/inspect/works`);
    } catch {
      works = [];
    }
  }

  async function refresh(id = caseState.current?.id) {
    if (!id) return;
    mediaList = await api.get(`/api/cases/${id}/media`);
    await Promise.all([refreshList(id), refreshWorks(id)]);
  }

  $effect(() => {
    const id = caseState.current?.id;
    caseState.rev;
    if (id !== loadedFor) {
      loadedFor = id;
      mediaList = [];
      collages = [];
      works = [];
      autosave.flush().finally(() => {
        if (doc.caseId && doc.caseId !== caseState.current?.id) closeDoc();
      });
      if (id) {
        ensureOps();
        refresh(id);
      }
    } else if (id) {
      refresh(id).then(recheckOpenDoc);
    }
  });

  // A capture in Inspect adds frames the piece picker should offer.
  $effect(() => {
    workState.rev;
    if (caseState.current?.id) refreshWorks();
  });

  /** A delete or a rename elsewhere may concern the open collage, or a file one of its pieces uses. */
  function recheckOpenDoc() {
    if (!doc.open || opening) return;
    if (doc.name && !collages.some((c) => c.name === doc.name)) {
      autosave.cancel();
      toast(`The collage “${doc.title}” was deleted`, 'warn');
      closeDoc();
      return;
    }
    const gone = doc.nodes.filter((node) => !mediaPaths.has(node.save.path) && !node.missing);
    if (!gone.length) return;
    // A rename rewrites the saved collage to the file's new path and a delete does
    // not, so reading it back tells the two apart.
    if (doc.name && !autosave.pending) {
      openCollage(doc.name);
      return;
    }
    for (const node of gone) {
      node.missing = true;
      node.url = null;
    }
  }

  $effect(() => {
    if (uiState.tool === 'collage' && uiState.openCollage && caseState.current) {
      const name = uiState.openCollage;
      uiState.openCollage = null;
      openCollage(name);
    }
  });

  // -- opening ----------------------------------------------------------------------
  function closeDoc() {
    docRun += 1;
    for (const url of blobs) URL.revokeObjectURL(url);
    blobs.clear();
    Object.assign(doc, {
      open: false, caseId: null, name: null, title: '', ...COLLAGE_DEFAULT_SIZE,
      background: '#12141c', transparent: true, nodes: [], exported: null,
    });
    savedSignature = null;
    selectedIds = [];
    cropPieceNode = null;
  }

  async function newCollage() {
    listOpen = false;
    await autosave.flush();
    await refreshList();
    closeDoc();
    doc.open = true;
    doc.caseId = caseState.current.id;
    doc.title = nextName('collage', collages.map((c) => c.title));
    savedSignature = signature();
    anchorHistory();
  }

  async function openCollage(name) {
    listOpen = false;
    await autosave.flush();
    await ensureOps();
    closeDoc();
    const run = docRun;
    const caseId = caseState.current.id;
    opening = true;
    try {
      // Which pieces lost their file is read off the media list, so it has to be in.
      if (!mediaList.length) await refresh(caseId);
      const saved = await api.get(`/api/cases/${caseId}/collages/${encodeURIComponent(name)}`);
      if (run !== docRun) return;
      const spec = saved.spec;
      Object.assign(doc, {
        open: true,
        caseId,
        name: saved.name,
        title: saved.title,
        width: spec.width ?? COLLAGE_DEFAULT_SIZE.width,
        height: spec.height ?? COLLAGE_DEFAULT_SIZE.height,
        background: spec.background ?? '#12141c',
        transparent: spec.transparent ?? true,
        exported: spec.exported ?? null,
        nodes: (spec.nodes ?? []).map((n) => ({ ...n, url: null, baseUrl: null })),
      });
      savedSignature = signature();
      anchorHistory();
      renderPieces(run);
    } catch (e) {
      if (run === docRun) toast(e.message, 'danger');
    } finally {
      if (run === docRun) opening = false;
    }
  }

  /**
   * Pixels for every piece of a reopened collage, a few at a time so the canvas
   * fills in as they land. `baseUrl` is the piece before its collage crop, which
   * is what the crop editor draws on; a piece whose file is gone keeps its place
   * and is marked, rather than dropped.
   */
  async function renderPieces(run) {
    const queue = [];
    for (const node of doc.nodes) {
      if (mediaPaths.has(node.save.path)) queue.push(node);
      else node.missing = true;
    }
    const next = async () => {
      while (queue.length) {
        const node = queue.shift();
        try {
          const frameOps = node.frameOps ?? node.save.ops ?? [];
          const baseUrl = await pieceUrl(node.save.path, node.save.time, frameOps);
          const url = node.crop ? await pieceUrl(node.save.path, node.save.time, node.save.ops) : baseUrl;
          if (run !== docRun) return;
          Object.assign(node, { baseUrl, url, frameOps });
        } catch {
          if (run === docRun) node.missing = true;
        }
      }
    };
    await Promise.all([next(), next(), next()]);
  }

  // -- pieces -----------------------------------------------------------------------
  async function pieceUrl(path, time, ops = []) {
    if (time == null && !ops.length) return fileUrl(doc.caseId, path);
    const res = await fetch(`/api/cases/${doc.caseId}/inspect/render-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, time: time ?? null, ops }),
    });
    if (!res.ok) {
      let detail = 'render failed';
      try {
        detail = (await res.json()).detail;
      } catch {
        /* non-json */
      }
      throw new Error(detail);
    }
    const url = URL.createObjectURL(await res.blob());
    blobs.add(url);
    return url;
  }

  function imageSize(url) {
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
      im.onerror = () => resolve({ w: 320, h: 240 });
      im.src = url;
    });
  }

  async function addPiece({ frameId, save }) {
    const run = docRun;
    try {
      const url = await pieceUrl(save.path, save.time, save.ops);
      const dim = await imageSize(url);
      if (run !== docRun) return;
      const off = 30 + (doc.nodes.length % 4) * 40;
      const node = {
        id: uid('nd'), frameId, url, baseUrl: url, w: dim.w, h: dim.h,
        frameOps: save.ops, crop: null, save,
        quad: initialQuad(dim.w, dim.h, doc.width * 0.5, off, off),
      };
      doc.nodes.push(node);
      selectedIds = [node.id];
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  // Re-render a piece with (or without) its crop, applied before the warp. The
  // crop is relative to the uncropped snapshot, so re-cropping never compounds.
  async function applyNodeCrop(node, crop) {
    try {
      const frameOps = node.frameOps ?? node.save?.ops ?? [];
      const ops = crop ? [...frameOps, { op: 'crop', params: crop }] : [...frameOps];
      const url = await pieceUrl(node.save.path, node.save.time, ops);
      const dim = await imageSize(url);
      // Keep the piece in place with the right proportions: back out to the
      // full-image quad, then project the new crop rectangle onto it.
      const prev = node.crop;
      const baseQuad = prev
        ? quadFromCropRect(node.quad, { x: -prev.x / prev.w, y: -prev.y / prev.h, w: 1 / prev.w, h: 1 / prev.h })
        : node.quad;
      node.quad = crop ? quadFromCropRect(baseQuad, crop) : baseQuad.map(([x, y]) => [x, y]);
      Object.assign(node, { url, w: dim.w, h: dim.h, crop, save: { ...node.save, ops } });
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  // Auto-stitch's panorama modes bake their warp into a piece's recipe, so the
  // piece is re-derived from it, crop-free: whatever it showed is baked in now.
  async function renderPiece(node, ops) {
    const url = await pieceUrl(node.save.path, node.save.time, ops);
    const dim = await imageSize(url);
    Object.assign(node, {
      url, baseUrl: url, w: dim.w, h: dim.h, frameOps: ops, crop: null, save: { ...node.save, ops },
    });
  }

  function requestCrop(node, clear = false) {
    if (node.missing) return;
    if (clear) applyNodeCrop(node, null);
    else cropPieceNode = node;
  }

  // -- naming -----------------------------------------------------------------------
  // The field follows the collage's name, and goes back to it whenever a typed one
  // is not taken: blank, refused, or abandoned with Escape.
  let titleField = $state('');
  $effect(() => {
    titleField = doc.title;
  });

  async function commitTitle() {
    const next = titleField.trim();
    if (!next || next === doc.title) {
      titleField = doc.title;
      return;
    }
    if (!doc.name) {
      doc.title = next; // the first save files it under this, numbered if taken
      return;
    }
    await autosave.flush();
    try {
      const res = await api.post(`/api/cases/${doc.caseId}/collages`, {
        name: doc.name, title: next, spec: collageSpec(doc),
      });
      doc.name = res.name;
      doc.title = res.title;
      savedSignature = signature();
      refreshList();
      reloadCase();
    } catch (e) {
      titleField = doc.title;
      toast(e.status === 409 ? 'Another collage already uses that name' : e.message, 'warn');
    }
  }

  function titleKey(e) {
    if (e.key === 'Enter') e.currentTarget.blur();
    else if (e.key === 'Escape') {
      titleField = doc.title;
      e.currentTarget.blur();
    }
  }

  // -- export and delete ------------------------------------------------------------
  async function exportCollage({ name, folder, note }) {
    exporting = true;
    exportFolder = folder ?? '';
    const signatureNow = collageSignature(doc);
    try {
      // Always a transparent PNG of just the pieces, trimmed to their bounds: the
      // size follows the layout, not a number typed somewhere.
      const b = collageBounds(doc.nodes);
      const nodes = doc.nodes.map((n) => ({ src: n.save, quad: n.quad.map(([x, y]) => [x - b.minX, y - b.minY]) }));
      const res = await api.post(`/api/cases/${doc.caseId}/inspect/compose`, {
        width: b.width, height: b.height, background: null, nodes, folder, label: name, notes: note,
      });
      if (res?.item?.path) doc.exported = { path: res.item.path, signature: signatureNow };
      await reloadCase();
      await refresh();
      const dupe = res?.duplicate ? '. It matched media already in the case, which was renamed' : '';
      toast(`Saved “${name}” to the case${dupe}`, 'ok');
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      exporting = false;
    }
  }

  async function deleteCollage(row) {
    deleting = null;
    const caseId = caseState.current.id;
    try {
      if (doc.name === row.name) {
        autosave.cancel();
        closeDoc();
      }
      const result = await api.del(`/api/cases/${caseId}/collages/${encodeURIComponent(row.name)}`);
      await refreshList();
      await reloadCase();
      deletedToast(caseId, result, row.title);
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  function when(stamp) {
    if (!stamp) return '';
    const d = new Date(stamp);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
</script>

<svelte:window onkeydown={onWindowKeydown} {onpagehide} />

{#snippet list()}
  {#if collages.length}
    <div class="rows">
      {#each collages as row (row.name)}
        <div class="row" class:current={row.name === doc.name}>
          <button class="row-open" onclick={() => openCollage(row.name)}>
            <Icon name="grid" size={15} />
            <span class="row-title">{row.title}</span>
            <span class="row-meta">
              {row.pieces} piece{row.pieces === 1 ? '' : 's'}{when(row.updated_at) ? ` · ${when(row.updated_at)}` : ''}
            </span>
          </button>
          <button class="btn btn-ghost btn-xs" onclick={() => (deleting = row)} aria-label="Delete collage" title="Delete collage">
            <Icon name="trash" size={14} />
          </button>
        </div>
      {/each}
    </div>
  {/if}
{/snippet}

<div class="tool">
  {#if doc.open}
    <div class="tool-header">
      <input
        class="input title-input"
        bind:value={titleField}
        onblur={commitTitle}
        onkeydown={titleKey}
        maxlength="200"
        aria-label="Collage name"
      />
      {#if status === 'saving'}
        <span class="status">Saving…</span>
      {:else if status === 'saved'}
        <span class="status"><Icon name="check" size={12} /> Saved</span>
      {:else if status === 'error'}
        <span class="status error" title={autosave.state.error}><Icon name="alert" size={12} /> Not saved</span>
        <button class="btn btn-ghost btn-xs" onclick={() => autosave.flush()}>Retry</button>
      {/if}
      <div class="spacer"></div>
      <button class="btn btn-ghost btn-sm" title="Undo (Ctrl+Z)" disabled={!canUndo} onclick={undo}>
        <Icon name="undo" size={15} />
      </button>
      <button class="btn btn-ghost btn-sm" title="Redo (Ctrl+Shift+Z / Ctrl+Y)" disabled={!canRedo} onclick={redo}>
        <Icon name="redo" size={15} />
      </button>
      <button class="btn btn-sm" onclick={() => { refreshList(); listOpen = true; }} title="Open another collage">
        <Icon name="folderOpen" size={14} /> Collages
      </button>
      <button class="btn btn-sm" onclick={newCollage} title="Start an empty canvas">
        <Icon name="plus" size={14} /> New
      </button>
    </div>
  {/if}

  {#if !caseState.current}
    <div class="empty">
      <Icon name="grid" size={40} />
      <p>Open a case to lay out a collage.</p>
    </div>
  {:else if !doc.open}
    <div class="start">
      <div class="start-col">
        <div class="start-head">
          <div>
            <h3>Collages</h3>
            <p>Lay out frames and images on one canvas, then save the picture to the case.</p>
          </div>
          <button class="btn btn-primary" onclick={newCollage}><Icon name="plus" size={15} /> New collage</button>
        </div>
        {#if opening}
          <span class="spinner" aria-label="Opening"></span>
        {:else}
          {@render list()}
        {/if}
      </div>
    </div>
  {:else}
    <div class="workspace">
      <div class="viewer">
        <CollageCanvas collage={doc} bind:selectedIds {requestCrop} />
      </div>
      <aside class="panel">
        <div class="section first">
          <div class="section-head"><span><Icon name="plus" size={14} /> Add pieces</span></div>
          <PiecePicker
            caseId={doc.caseId}
            {filters}
            works={pickerWorks}
            {images}
            {used}
            rev={workState.rev}
            onadd={addPiece}
          />
        </div>
        <div class="section">
          <CollageMenu collage={doc} bind:selectedIds {requestCrop} {renderPiece} />
        </div>
        <div class="section">
          <SaveToCase
            defaultName={doc.title}
            filedPath={exportedPath}
            busy={exporting}
            blocked={!doc.nodes.length
              ? 'Add a piece first.'
              : lost
                ? `${lost} piece${lost === 1 ? '' : 's'} lost ${lost === 1 ? 'its' : 'their'} file. Remove ${lost === 1 ? 'it' : 'them'} to save.`
                : ''}
            hint="Saves only the pieces, on a transparent background, trimmed to their bounds."
            bind:folder={exportFolder}
            onsave={exportCollage}
          />
        </div>
      </aside>
    </div>
  {/if}

  {#if cropPieceNode}
    <PieceCropModal
      node={cropPieceNode}
      onapply={(crop) => { applyNodeCrop(cropPieceNode, crop); cropPieceNode = null; }}
      onclose={() => (cropPieceNode = null)}
    />
  {/if}

  {#if listOpen}
    <Modal title="Collages" width="480px" onclose={() => (listOpen = false)}>
      {#if collages.length}
        {@render list()}
      {:else}
        <p class="hint">No collage saved in this case yet.</p>
      {/if}
    </Modal>
  {/if}

  {#if deleting}
    <ConfirmDialog
      title="Delete this collage?"
      message={`“${deleting.title}” goes to the Trash.`}
      detail="A picture already saved from it stays in the Media Library."
      confirmLabel="Delete"
      tone="danger"
      icon="trash"
      onconfirm={() => deleteCollage(deleting)}
      oncancel={() => (deleting = null)}
    />
  {/if}
</div>

<style>
  .tool {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .tool-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .title-input {
    width: 260px;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .status.error {
    color: var(--danger);
  }
  .spacer {
    flex: 1;
  }
  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--text-3);
    text-align: center;
  }
  /* The whole panel scrolls and the column sits centred in it, so the wheel works
     over the margins and the scrollbar stays on the edge. */
  .start {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .start-col {
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-width: 720px;
    margin: 0 auto;
    padding: 24px 20px;
  }
  .start-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }
  .start-head h3 {
    font-size: var(--fs-md);
    font-weight: 700;
    margin: 0 0 4px;
  }
  .start-head p {
    margin: 0;
    color: var(--text-3);
    font-size: var(--fs-sm);
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .row-open {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 9px 11px;
    text-align: left;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-2);
    color: var(--text-2);
  }
  .row-open:hover,
  .row.current .row-open {
    border-color: var(--accent);
  }
  .row-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-1);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .row-meta {
    color: var(--text-3);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }
  .spinner {
    align-self: center;
    width: 24px;
    height: 24px;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .workspace {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .viewer {
    flex: 1;
    min-width: 0;
    display: flex;
    background: var(--bg-0);
    overflow: hidden;
  }
  .panel {
    width: 320px;
    flex-shrink: 0;
    border-left: 1px solid var(--border);
    background: var(--bg-1);
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    overflow: auto;
    padding: 14px;
  }
  .section {
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-top: 1px solid var(--border);
    padding-top: 12px;
  }
  .section.first {
    border-top: 0;
    padding-top: 0;
  }
  .section-head {
    display: flex;
    align-items: center;
    font-weight: 600;
    font-size: var(--fs-sm);
  }
  .section-head span {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .hint {
    color: var(--text-3);
    font-size: var(--fs-sm);
    margin: 0;
  }
</style>
