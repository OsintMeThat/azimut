<script>
  /**
   * The selection editor for any artifact (docs/UI.md §4): preview, provenance,
   * the derivation chain, and an inline title/notes/folder editor with the
   * open/delete actions. One body, two homes — the case sidebar's Details
   * section and the Media Library's info modal both render this, so the two can
   * never drift apart again.
   *
   * Driven by an entity id: the live entity is derived from the open case, so a
   * reload after Save (or a folder move) shows the fresh object with no prop
   * juggling. Clicking a chain row walks the details to that entity in place.
   */
  import { api } from '../lib/api.js';
  import { caseState, reloadCase, toast } from '../lib/state.svelte.js';
  import { buildTree, flattenPaths, folderOf } from '../lib/folderTree.js';
  import { assignFolder as fileEntity } from '../lib/filing.js';
  import { DEPENDS_ON } from '../lib/chain.js';
  import { openEntity, gotoCapture, ENTITY_TOOL } from '../lib/navigate.js';
  import Icon from './Icon.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import FolderSelect from './FolderSelect.svelte';

  let { entityId, onclose, ondeleted } = $props();

  // Chain rows walk the details to another entity in place; that override sticks
  // until the host selects a different entity, when it clears back to the prop.
  let walkedId = $state(null);
  let lastProp; // seeded on the first effect run
  $effect(() => {
    if (entityId !== lastProp) {
      lastProp = entityId;
      walkedId = null;
    }
  });
  const currentId = $derived(walkedId ?? entityId);

  // The entity and its derivation chain come from the bounded chain endpoint
  // (Step 5), not the whole graph: fetched for the selected/walked id and
  // refetched after a reload, guarded so a stale response can't overwrite a
  // newer selection.
  let chainData = $state(null); // { entity, sources, lost, dependents, empty }
  let chainSeq = 0;
  const entity = $derived(chainData?.entity ?? null);
  const chain = $derived(chainData);

  $effect(() => {
    const id = currentId;
    const cid = caseState.current?.id;
    caseState.rev; // refetch after a save / delete / folder move
    const mySeq = ++chainSeq;
    if (!id || !cid) {
      chainData = null;
      return;
    }
    api
      .get(`/api/cases/${cid}/entities/${id}/chain`)
      .then((c) => { if (mySeq === chainSeq) chainData = c; })
      .catch(() => { if (mySeq === chainSeq) chainData = null; });
  });

  const allFolders = $derived(flattenPaths(buildTree(caseState.current?.folders ?? [], [])));

  // Entity types backed by a file on disk — deleting them drops the file.
  const FILE_BACKED = new Set(['media', 'capture', 'proof', 'post', 'inspect-session', 'note']);
  // Every artifact type gets the title/notes editor. Media/captures go through
  // their sidecar PATCH; the rest edit the entity itself.
  const EDITABLE = new Set(['capture', 'place', 'media', 'proof', 'post', 'inspect-session', 'note', 'bookmark']);
  const ENTITY_ICON = {
    media: 'media', capture: 'satellite', place: 'pin', proof: 'proof',
    post: 'post', 'inspect-session': 'inspect', note: 'note', bookmark: 'link',
  };

  // ── resolved listing item (media/satellite) + editable fields ──────────────
  let infoData = $state(null);
  let infoLoading = $state(false);
  let infoTitle = $state('');
  let infoNotes = $state('');
  let infoFolder = $state('');
  let infoSaving = $state(false);
  let seededId = null; // the id whose fields are currently loaded

  const detailsFilePath = $derived(
    infoData?.path ?? (entity?.type === 'capture' ? entity.attrs?.path : null)
  );

  $effect(() => {
    const e = entity;
    caseState.rev; // re-resolve preview/metadata after a reload…
    if (!e) {
      infoData = null;
      seededId = null;
      return;
    }
    const firstSeed = seededId !== e.id; // …but only re-seed fields on a new selection
    if (firstSeed) {
      seededId = e.id;
      infoTitle = e.label ?? '';
      infoNotes = e.attrs?.notes ?? '';
      infoFolder = folderOf(e) ?? '';
      infoData = null;
    }
    resolve(e, firstSeed);
  });

  async function resolve(e, seedFields) {
    const endpoint = e.type === 'media' ? 'media' : e.type === 'capture' ? 'satellite' : null;
    if (!endpoint || !e.attrs?.path) {
      infoData = null;
      return;
    }
    infoLoading = true;
    try {
      const list = await api.get(`/api/cases/${caseState.current.id}/${endpoint}`);
      if (seededId !== e.id) return; // selection moved on mid-fetch
      infoData = list.find((m) => m.path === e.attrs.path) ?? null;
      if (infoData && seedFields) {
        infoTitle = infoData.title ?? e.label ?? '';
        infoNotes = infoData.notes ?? infoNotes;
      }
    } catch {
      infoData = null;
    } finally {
      infoLoading = false;
    }
  }

  async function saveInfo() {
    if (!entity || infoSaving) return;
    infoSaving = true;
    const cid = caseState.current.id;
    try {
      if (entity.type === 'capture') {
        await api.patch(`/api/cases/${cid}/satellite`, {
          path: entity.attrs.path, title: infoTitle, notes: infoNotes,
        });
      } else if (entity.type === 'media') {
        await api.patch(`/api/cases/${cid}/media`, {
          path: entity.attrs.path, title: infoTitle.trim(), notes: infoNotes,
        });
      } else if (EDITABLE.has(entity.type)) {
        await api.patch(`/api/cases/${cid}/entities/${entity.id}`, {
          label: infoTitle.trim() || entity.label, attrs: { notes: infoNotes.trim() },
        });
      }
      if ((infoFolder.trim() || '') !== (folderOf(entity) ?? '')) {
        await fileEntity(cid, entity, infoFolder.trim());
      }
      await reloadCase();
      toast('Saved', 'ok', 1600);
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      infoSaving = false;
    }
  }

  // ── delete everywhere (irreversible; spells out what it touches) ───────────
  let confirmState = $state(null);
  let confirmBusy = $state(false);

  async function askDeleteEverywhere() {
    const e = entity;
    if (!e) return;
    // The authoritative plan is the backend's; the preview reads its dependents
    // endpoint rather than mirroring the whole graph client-side.
    let consequences = { cascade: [], tombstone: [] };
    try {
      consequences = await api.get(
        `/api/cases/${caseState.current.id}/entities/${e.id}/dependents`
      );
    } catch {
      /* no preview — the delete still enforces the plan server-side */
    }
    confirmState = {
      title: 'Delete everywhere?',
      message: `“${e.label}” will be removed from the case and its tool.`,
      detail: FILE_BACKED.has(e.type)
        ? 'This permanently deletes the underlying file(s) on disk. It cannot be undone.'
        : 'This permanently removes it from the case. It cannot be undone.',
      consequences,
      action: async () => {
        await api.del(`/api/cases/${caseState.current.id}/entities/${e.id}`);
        await reloadCase();
        toast(`Deleted "${e.label}"`, 'info');
        ondeleted?.();
      },
    };
  }

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

  function fmtSize(bytes) {
    if (bytes == null) return '';
    if (bytes >= 1 << 30) return (bytes / (1 << 30)).toFixed(1) + ' GB';
    if (bytes >= 1 << 20) return (bytes / (1 << 20)).toFixed(1) + ' MB';
    if (bytes >= 1 << 10) return (bytes / (1 << 10)).toFixed(0) + ' KB';
    return bytes + ' B';
  }
</script>

{#if entity}
  <div class="ed">
    {#if infoLoading}
      <div class="info-loading">Loading…</div>
    {/if}

    {#if infoData?.kind === 'image' && infoData.thumbnail}
      <div class="info-preview">
        <img src={`/files/${caseState.current.id}/${infoData.path}`} alt={entity.label} />
      </div>
    {:else if infoData?.kind === 'video'}
      <div class="info-preview">
        <!-- svelte-ignore a11y_media_has_caption -->
        <video src={`/files/${caseState.current.id}/${infoData.path}`} controls preload="metadata"></video>
      </div>
    {:else if entity.type === 'capture' && entity.attrs?.path}
      <div class="info-preview">
        <img src={`/files/${caseState.current.id}/${entity.attrs.path}`} alt={entity.label} />
      </div>
    {/if}

    {#if EDITABLE.has(entity.type)}
      <label class="modal-label" for="ed-title">Title</label>
      <input id="ed-title" class="input" bind:value={infoTitle} placeholder={entity.attrs?.coords ?? 'Title'} />
    {:else}
      <div class="details-title">{entity.label}</div>
    {/if}

    <div class="info-rows">
      <div class="info-row"><span class="info-k">Type</span><span>{entity.type}</span></div>
      {#if entity.provenance?.by}
        <div class="info-row"><span class="info-k">Created by</span><span>{entity.provenance.by}</span></div>
      {/if}
      {#if entity.provenance?.at}
        <div class="info-row"><span class="info-k">Created</span><span class="mono">{entity.provenance.at.slice(0, 10)}</span></div>
      {/if}
      {#if entity.type === 'media' && infoData}
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
        {#if infoData.source?.description}
          <div class="info-row"><span class="info-k">Description</span><span class="description">{infoData.source.description}</span></div>
        {/if}
      {:else if entity.type === 'capture'}
        {#if infoData?.provider_label}
          <div class="info-row"><span class="info-k">Provider</span><span>{infoData.provider_label}</span></div>
        {/if}
        {#if entity.attrs?.zoom != null}
          <div class="info-row"><span class="info-k">Zoom</span><span>z{entity.attrs.zoom}</span></div>
        {/if}
        {#if infoData?.fetched_at}
          <div class="info-row"><span class="info-k">Captured</span><span class="mono">{infoData.fetched_at.slice(0, 10)}</span></div>
        {/if}
        {#if infoData?.imagery_date}
          <div class="info-row"><span class="info-k">Imagery</span><span class="mono">{infoData.imagery_date}</span></div>
        {/if}
      {:else if entity.type === 'bookmark' && entity.attrs?.url}
        <div class="info-row">
          <span class="info-k">URL</span>
          <a class="mono src" href={entity.attrs.url} target="_blank" rel="noreferrer">{entity.attrs.url}</a>
        </div>
      {/if}
      {#if entity.attrs?.coords}
        <div class="info-row"><span class="info-k">Coords</span><span class="mono">{entity.attrs.coords}</span></div>
      {/if}
    </div>

    <!-- derivation chain: click a row to walk to that entity's details -->
    {#if chain && !chain.empty}
      <div class="chain">
        {#if chain.sources.length || chain.lost.length}
          <div class="chain-h">Made from</div>
          {#each chain.sources as { entity: src, type } (src.id)}
            <button class="chain-row" onclick={() => (walkedId = src.id)}>
              <Icon name={ENTITY_ICON[src.type] ?? 'file'} size={12} />
              <span class="chain-label">{src.label}</span>
              {#if type === DEPENDS_ON}
                <span class="chain-tag" title="This view cannot outlive that item">needs</span>
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
          {#each chain.dependents as { entity: dep, type } (dep.id)}
            <button class="chain-row" onclick={() => (walkedId = dep.id)}>
              <Icon name={ENTITY_ICON[dep.type] ?? 'file'} size={12} />
              <span class="chain-label">{dep.label}</span>
              {#if type === DEPENDS_ON}
                <span class="chain-tag warn" title="Deleting this item deletes that one too">goes with it</span>
              {/if}
            </button>
          {/each}
        {/if}
      </div>
    {/if}

    {#if EDITABLE.has(entity.type)}
      <label class="modal-label" for="ed-notes">Notes</label>
      <textarea id="ed-notes" class="textarea" rows="3" bind:value={infoNotes} placeholder="Add observations, links, context…"></textarea>
    {/if}

    <span class="modal-label">Folder (My work)</span>
    <FolderSelect bind:value={infoFolder} folders={allFolders} emptyLabel="None" />

    <div class="details-actions">
      {#if detailsFilePath}
        <a class="btn btn-ghost btn-sm" href={`/files/${caseState.current.id}/${detailsFilePath}`} target="_blank" rel="noreferrer">
          <Icon name="external" size={13} /> Open file
        </a>
      {/if}
      {#if entity.type === 'bookmark' && entity.attrs?.url}
        <a class="btn btn-ghost btn-sm" href={entity.attrs.url} target="_blank" rel="noreferrer">
          <Icon name="external" size={13} /> Open link
        </a>
      {/if}
      {#if ENTITY_TOOL[entity.type] || entity.type === 'note'}
        <button class="btn btn-ghost btn-sm" onclick={() => { openEntity(entity); onclose?.(); }}>
          <Icon name="arrowRight" size={13} /> {entity.type === 'note' ? 'Open note' : 'Open in tool'}
        </button>
      {/if}
      {#if entity.type === 'capture' && entity.attrs?.lat != null}
        <button class="btn btn-ghost btn-sm" onclick={() => { gotoCapture(entity); onclose?.(); }}>
          <Icon name="crosshair" size={13} /> Go to coords
        </button>
      {/if}
    </div>
    <div class="details-actions">
      <button
        class="btn btn-ghost btn-sm del"
        title="Delete this item and its case files"
        onclick={askDeleteEverywhere}
      >
        <Icon name="trash" size={13} /> Delete
      </button>
      <div style="flex:1"></div>
      <button class="btn btn-primary btn-sm" onclick={saveInfo} disabled={infoSaving}>
        {infoSaving ? 'Saving…' : 'Save'}
      </button>
    </div>
  </div>
{/if}

{#if confirmState}
  <ConfirmDialog
    title={confirmState.title}
    message={confirmState.message}
    detail={confirmState.detail}
    consequences={confirmState.consequences}
    confirmLabel="Delete everywhere"
    tone="danger"
    icon="trash"
    busy={confirmBusy}
    onconfirm={runConfirm}
    oncancel={() => (confirmState = null)}
  />
{/if}

<style>
  .ed {
    font-size: var(--fs-sm);
  }
  .modal-label {
    display: block;
    font-size: var(--fs-xs);
    color: var(--text-3);
    margin: 8px 0 4px;
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
  .details-actions .del {
    color: var(--danger);
  }
  .info-loading {
    font-size: var(--fs-sm);
    color: var(--text-3);
    padding: 6px 0;
  }
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
  .info-preview img,
  .info-preview video {
    max-width: 100%;
    max-height: 240px;
    object-fit: contain;
    display: block;
  }
  .info-rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .info-row {
    display: flex;
    gap: 10px;
    font-size: var(--fs-sm);
    align-items: baseline;
    min-width: 0;
  }
  .info-k {
    color: var(--text-3);
    font-size: var(--fs-xs);
    min-width: 68px;
    flex-shrink: 0;
  }
  .hash {
    font-size: 11px;
    word-break: break-all;
    color: var(--text-2);
  }
  .src {
    font-size: var(--fs-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .description {
    flex: 1;
    min-width: 0;
    font-size: var(--fs-xs);
    color: var(--text-2);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 8.5em;
    overflow-y: auto;
  }
  .textarea {
    width: 100%;
    resize: vertical;
  }

  /* derivation chain rows (ONTOLOGY §3) */
  .chain {
    margin-top: 14px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
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
  button.chain-row {
    cursor: pointer;
  }
  button.chain-row:hover {
    background: var(--bg-2);
    color: var(--text-1);
  }
  .chain-row.gone {
    color: var(--text-3);
  }
  .chain-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
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
