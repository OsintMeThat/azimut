<script>
  import { api } from '../lib/api.js';
  import { lookupEntity } from '../lib/catalog.js';
  import { caseState, uiState, ensureCase, reloadCase, toast } from '../lib/state.svelte.js';
  import { visibleMedia, SORTS } from '../lib/mediaFilter.js';
  import Icon from '../components/Icon.svelte';
  import Modal from '../components/Modal.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import EntityDetails from '../components/EntityDetails.svelte';

  const KIND_ICONS = { image: 'image', video: 'video', audio: 'audio', file: 'file' };

  let items = $state([]);
  let loadedFor = $state(null);
  let url = $state('');
  let picker = $state(null); // multi-item picker: {url, items: [{index, title, thumbnail, kind, selected}]}
  let dragOver = $state(false);
  let jobs = $state([]); // active download jobs: {id, url, label, progress}
  let fileInput;

  // --- category facets (auto-derived from kind + source) ---
  // Overlapping filters (a downloaded video matches both Videos and Downloads);
  // clicking one narrows the grid to that facet. Order matches the sidebar bar.
  const CATEGORIES = [
    { key: 'image', label: 'Images', icon: 'image', match: (i) => i.kind === 'image' },
    { key: 'video', label: 'Videos', icon: 'video', match: (i) => i.kind === 'video' },
    { key: 'collage', label: 'Collages', icon: 'layers', match: (i) => i.source?.op === 'collage' },
    { key: 'satellite', label: 'Satellite', icon: 'satellite', match: (i) => i.source?.type === 'satellite' },
    { key: 'upload', label: 'Imports', icon: 'upload', match: (i) => i.source?.type === 'upload' },
    { key: 'download', label: 'Downloads', icon: 'download', match: (i) => i.source?.type === 'download' },
    { key: 'other', label: 'Other files', icon: 'file', match: (i) => i.kind !== 'image' && i.kind !== 'video' },
  ];

  let catFilter = $state(null); // null = All types

  const activeCats = $derived(
    CATEGORIES.map((c) => ({ ...c, count: items.filter(c.match).length })).filter(
      (c) => c.count > 0
    )
  );
  const catMatch = $derived(CATEGORIES.find((c) => c.key === catFilter)?.match ?? null);

  // --- folder filter (user-defined folders) ---
  let folderFilter = $state(null); // null = All

  // --- free-text search + sort ---
  let query = $state('');
  let sort = $state('newest');

  const folders = $derived(
    [...new Set(items.filter((i) => i.folder).map((i) => i.folder))].sort()
  );
  // Empty when no case is open — the grid cards build file URLs from
  // `caseState.current.id`, so a stale render during case-close (current is
  // briefly null before `items` clears) must not reach them. See visibleMedia.
  const filteredItems = $derived(
    visibleMedia(items, {
      hasCase: !!caseState.current,
      catMatch,
      folderFilter,
      query,
      sort,
    })
  );

  // --- details modal (shared EntityDetails, keyed by the file's entity id) ---
  let infoEntityId = $state(null);

  // --- lightbox (←/→ flips through the filtered images) ---
  let lightboxItem = $state(null);
  const lightboxImages = $derived(filteredItems.filter((i) => i.kind === 'image'));

  function lightboxStep(delta) {
    if (!lightboxItem || !lightboxImages.length) return;
    const idx = lightboxImages.findIndex((i) => i.path === lightboxItem.path);
    const next = ((idx < 0 ? 0 : idx) + delta + lightboxImages.length) % lightboxImages.length;
    lightboxItem = lightboxImages[next];
  }

  function onLightboxKey(e) {
    if (!lightboxItem || uiState.tool !== 'media') return;
    if (e.key === 'Escape') lightboxItem = null;
    else if (e.key === 'ArrowLeft') lightboxStep(-1);
    else if (e.key === 'ArrowRight') lightboxStep(1);
  }

  // --- focus/highlight (a media clicked from the case sidebar) ---
  let focusedPath = $state(null);
  let focusScrolledFor = null;
  let focusTimer;

  // --- thumbnails still generating in the background ---
  // A broken <img> (a thumbnail evicted by the cache budget between list and
  // render) falls back to the type icon, reported once by dropping the path in
  // here — it does not retry on every render.
  let brokenThumbs = $state(new Set());
  const thumbsPending = $derived(
    items.some((i) => i.thumb_state === 'queued' || i.thumb_state === 'running')
  );

  $effect(() => {
    const id = caseState.current?.id;
    caseState.rev; // also refetch when the case is reloaded elsewhere (e.g. sidebar edit)
    if (id !== loadedFor) {
      loadedFor = id;
      items = [];
    }
    if (id) refresh(id);
  });

  // Pick up a "focus this media" handoff from the sidebar: clear filters that
  // might hide it, flag it for the highlight ring, then let it fade on its own.
  $effect(() => {
    if (!uiState.focusMedia) return;
    catFilter = null;
    folderFilter = null;
    focusedPath = uiState.focusMedia;
    uiState.focusMedia = null;
    clearTimeout(focusTimer);
    focusTimer = setTimeout(() => (focusedPath = null), 3000);
  });

  // Scroll the focused card into view once it's actually in the rendered grid
  // (items may still be loading when the handoff arrives).
  $effect(() => {
    const p = focusedPath;
    if (!p) {
      focusScrolledFor = null;
      return;
    }
    if (focusScrolledFor === p || !filteredItems.some((i) => i.path === p)) return;
    focusScrolledFor = p;
    requestAnimationFrame(() => {
      document
        .querySelector(`.media-card[data-path="${CSS.escape(p)}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });

  async function refresh(id = caseState.current?.id) {
    if (id) items = await api.get(`/api/cases/${id}/media`);
  }

  // While the single worker is still generating thumbnails (video frames, or a
  // regenerate), re-list to pick up readiness — only while the tool is visible,
  // and the poll stops on its own once nothing is pending.
  $effect(() => {
    if (!thumbsPending || uiState.tool !== 'media' || !caseState.current) return;
    const t = setTimeout(() => refresh(), 1500);
    return () => clearTimeout(t);
  });

  // Queue (re)generation: a single failed thumbnail (path given) or every
  // missing/failed one across the case. The worker drains the queue; the poll
  // above reflects each result as it lands.
  async function regenerateThumbs(path = null) {
    const id = caseState.current?.id;
    if (!id) return;
    try {
      const { queued } = await api.post(
        `/api/cases/${id}/media/thumbnails/regenerate`,
        path ? { path } : {}
      );
      if (path) {
        const next = new Set(brokenThumbs);
        next.delete(path);
        brokenThumbs = next;
      }
      await refresh();
      if (!path) {
        toast(
          queued ? `Regenerating ${queued} thumbnail${queued > 1 ? 's' : ''}` : 'Thumbnails are up to date',
          queued ? 'info' : 'ok'
        );
      }
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  async function importFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    const c = await ensureCase();
    let added = 0;
    let dups = 0;
    for (const file of files) {
      const form = new FormData();
      form.append('file', file);
      try {
        const res = await api.post(`/api/cases/${c.id}/media/upload`, form);
        res.duplicate ? dups++ : added++;
      } catch (e) {
        toast(`${file.name}: ${e.message}`, 'danger');
      }
    }
    await Promise.all([refresh(), reloadCase()]);
    if (added) toast(`${added} file${added > 1 ? 's' : ''} added to the case`, 'ok');
    if (dups) toast(`${dups} duplicate${dups > 1 ? 's' : ''} skipped (same SHA-256)`, 'warn');
  }

  async function download() {
    const target = url.trim();
    if (!target) return;
    url = '';
    startDownload(target);
  }

  async function startDownload(target, index = null, title = null) {
    try {
      const c = await ensureCase();
      const { job_id } = await api.post(`/api/cases/${c.id}/media/download`, {
        url: target,
        index,
        title,
      });
      jobs.push({ id: job_id, url: target, label: title || target, progress: {} });
      poll(job_id);
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  function selectAllPicker(value) {
    picker.items.forEach((i) => (i.selected = value));
  }

  function confirmPicker() {
    const chosen = picker.items.filter((i) => i.selected);
    for (const item of chosen) {
      startDownload(picker.url, item.index, item.title.trim() || undefined);
    }
    picker = null;
  }

  async function poll(jobId) {
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;
    try {
      const status = await api.get(`/api/jobs/${jobId}`);
      job.progress = status.progress ?? {};
      if (status.status === 'running') {
        setTimeout(() => poll(jobId), 700);
        return;
      }
      jobs = jobs.filter((j) => j.id !== jobId);
      if (status.status === 'done' && status.result?.multi) {
        // several attachments — nothing was downloaded yet, let the analyst pick
        picker = { url: job.url, items: status.result.items.map((i) => ({ ...i, selected: true })) };
      } else if (status.status === 'done') {
        toast(
          status.result?.duplicate
            ? 'Already in the case (same SHA-256)'
            : `Downloaded: ${status.result?.item?.filename}`,
          status.result?.duplicate ? 'warn' : 'ok'
        );
        await Promise.all([refresh(), reloadCase()]);
      } else {
        toast(`Download failed: ${status.error}`, 'danger', 6000);
      }
    } catch (e) {
      jobs = jobs.filter((j) => j.id !== jobId);
      toast(e.message, 'danger');
    }
  }

  // Deleting media drops the file (evidence!) — always behind a confirm.
  let deleteTarget = $state(null);
  let deleteBusy = $state(false);

  async function confirmDelete() {
    if (!deleteTarget || deleteBusy) return;
    deleteBusy = true;
    try {
      await api.del(
        `/api/cases/${caseState.current.id}/media?path=${encodeURIComponent(deleteTarget.path)}`
      );
      await Promise.all([refresh(), reloadCase()]);
      toast(`Removed ${deleteTarget.filename}`, 'info');
      deleteTarget = null;
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      deleteBusy = false;
    }
  }

  function sendToComposer(item) {
    if (!uiState.composeQueue.includes(item.path)) {
      uiState.composeQueue.push(item.path);
    }
    uiState.tool = 'proof';
  }

  function inspect(item) {
    uiState.inspectPath = item.path;
    uiState.tool = 'inspect';
  }

  function fmtSize(bytes) {
    if (bytes >= 1 << 30) return (bytes / (1 << 30)).toFixed(1) + ' GB';
    if (bytes >= 1 << 20) return (bytes / (1 << 20)).toFixed(1) + ' MB';
    if (bytes >= 1 << 10) return (bytes / (1 << 10)).toFixed(0) + ' KB';
    return bytes + ' B';
  }

  function onDrop(e) {
    e.preventDefault();
    dragOver = false;
    importFiles(e.dataTransfer.files);
  }

  // Open the shared details editor (same body as the case sidebar) for this
  // file's case entity — full provenance, derivation chain, title/notes/folder.
  async function openInfo(item) {
    const ent = await lookupEntity(caseState.current?.id, 'path', item.path);
    if (ent) infoEntityId = ent.id;
    else toast('This file has no case entity yet', 'warn');
  }
</script>

<div
  class="tool"
  role="region"
  aria-label="Media Library"
  ondragover={(e) => {
    e.preventDefault();
    dragOver = true;
  }}
  ondragleave={(e) => {
    if (e.currentTarget === e.target) dragOver = false;
  }}
  ondrop={onDrop}
>
  <div class="tool-header">
    <h2>Media Library</h2>
    <div class="spacer"></div>
    <form
      class="dl-form"
      onsubmit={(e) => {
        e.preventDefault();
        download();
      }}
    >
      <input
        class="input"
        placeholder="Paste a link (X, Telegram, YouTube…)"
        bind:value={url}
      />
      <button type="submit" class="btn btn-primary" disabled={!url.trim()}>
        <Icon name="download" size={15} /> Download
      </button>
    </form>
    <button class="btn" onclick={() => fileInput.click()}>
      <Icon name="upload" size={15} /> Import
    </button>
    <button
      class="btn"
      onclick={() => regenerateThumbs()}
      title="Regenerate missing or failed thumbnails"
      disabled={!items.length}
    >
      <Icon name="reset" size={15} /> Thumbnails
    </button>
    <input
      type="file"
      multiple
      hidden
      bind:this={fileInput}
      onchange={(e) => {
        importFiles(e.target.files);
        e.target.value = '';
      }}
    />
  </div>

  <!-- search + sort + category + folder filter bar -->
  {#if items.length > 0}
    <div class="folder-bar">
      <div class="search-box">
        <Icon name="search" size={13} />
        <input
          class="search-input"
          placeholder="Search name, notes, source…"
          bind:value={query}
        />
        {#if query}
          <button class="search-clear" onclick={() => (query = '')} aria-label="Clear search">
            <Icon name="x" size={12} />
          </button>
        {/if}
      </div>
      <select class="select sort-select" bind:value={sort} title="Sort order">
        {#each SORTS as s (s.id)}
          <option value={s.id}>{s.label}</option>
        {/each}
      </select>
      <span class="bar-sep"></span>
      <!-- type / source facets -->
      <button
        class="folder-chip"
        class:active={catFilter === null}
        onclick={() => (catFilter = null)}
      >
        <Icon name="media" size={13} /> All
        <span class="chip-count">{items.length}</span>
      </button>
      {#each activeCats as c (c.key)}
        <button
          class="folder-chip"
          class:active={catFilter === c.key}
          onclick={() => (catFilter = catFilter === c.key ? null : c.key)}
        >
          <Icon name={c.icon} size={13} />{c.label}
          <span class="chip-count">{c.count}</span>
        </button>
      {/each}

      <!-- user-defined folders (independent facet) -->
      {#if folders.length}
        <span class="bar-sep"></span>
        {#each folders as f (f)}
          <button
            class="folder-chip"
            class:active={folderFilter === f}
            onclick={() => (folderFilter = folderFilter === f ? null : f)}
          >
            <Icon name="folder" size={13} />{f}
            <span class="chip-count">{items.filter((i) => i.folder === f).length}</span>
          </button>
        {/each}
      {/if}
    </div>
  {/if}

  <div class="tool-body">
    {#each jobs as job (job.id)}
      <div class="job card">
        <Icon name="download" size={15} />
        <span class="job-url mono" title={job.url}>{job.label ?? job.url}</span>
        <div class="bar">
          <div
            class="fill"
            class:indeterminate={job.progress.percent == null}
            style:width={job.progress.percent != null ? job.progress.percent + '%' : '40%'}
          ></div>
        </div>
        <span class="job-meta">
          {#if job.progress.stage === 'processing'}processing…{:else if job.progress.percent != null}{job.progress.percent}%
            {job.progress.speed ?? ''}{:else}starting…{/if}
        </span>
      </div>
    {/each}

    {#if !items.length && !jobs.length}
      <div class="empty" style="height: 100%">
        <div class="empty-icon"><Icon name="media" size={42} /></div>
        <h3>No media yet</h3>
        <p>Drop files here, or paste a URL above.</p>
      </div>
    {:else if filteredItems.length === 0}
      <div class="empty" style="height: 100%">
        <div class="empty-icon"><Icon name="folder" size={38} /></div>
        <h3>Nothing here</h3>
        <p>No media matches this filter.</p>
      </div>
    {:else}
      <div class="grid">
        {#each filteredItems as item (item.path)}
          <div
            class="media-card card"
            class:focused={item.path === focusedPath}
            data-path={item.path}
          >
            <!-- thumbnail — click to lightbox for images -->
            <!-- The role and tab stop deliberately exist only for image previews. -->
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <div
              class="thumb"
              class:clickable={item.kind === 'image'}
              onclick={() => item.kind === 'image' && (lightboxItem = item)}
              role={item.kind === 'image' ? 'button' : undefined}
              tabindex={item.kind === 'image' ? 0 : undefined}
              onkeydown={(e) => e.key === 'Enter' && item.kind === 'image' && (lightboxItem = item)}
              aria-label={item.kind === 'image' ? `Preview ${item.filename}` : undefined}
            >
              {#if item.thumbnail && item.thumb_state === 'ready' && !brokenThumbs.has(item.path)}
                <img
                  src={`/files/${caseState.current.id}/${item.thumbnail}`}
                  alt={item.filename}
                  loading="lazy"
                  decoding="async"
                  onerror={() => (brokenThumbs = new Set(brokenThumbs).add(item.path))}
                />
              {:else if item.thumb_state === 'queued' || item.thumb_state === 'running'}
                <div class="thumb-status">
                  <Icon name="clock" size={22} />
                  <span>Generating…</span>
                </div>
              {:else if item.thumb_state === 'failed'}
                <button
                  class="thumb-status thumb-retry"
                  title="Retry thumbnail"
                  onclick={(e) => {
                    e.stopPropagation();
                    regenerateThumbs(item.path);
                  }}
                >
                  <Icon name="reset" size={20} />
                  <span>Retry</span>
                </button>
              {:else}
                <Icon name={KIND_ICONS[item.kind] ?? 'file'} size={34} />
              {/if}
              <span class="kind badge">{item.kind}</span>
              {#if item.folder}
                <span class="folder-badge badge">
                  <Icon name="folder" size={10} />{item.folder}
                </span>
              {/if}
            </div>
            <div class="body">
              <span class="name" title={item.filename}>{item.title ?? item.filename}</span>
              <span class="meta">
                {fmtSize(item.size)} ·
                <span class="mono" title={item.sha256}>{item.sha256.slice(0, 8)}</span>
                {#if item.source?.type === 'download'}
                  · <a href={item.source.webpage_url ?? item.source.url} target="_blank" rel="noreferrer">source</a>
                {/if}
              </span>
              {#if item.notes}
                <span class="notes-preview" title={item.notes}>{item.notes}</span>
              {/if}
            </div>
            <div class="actions">
              <button
                class="btn btn-ghost btn-sm"
                title="Info / Edit notes"
                onclick={() => openInfo(item)}
              >
                <Icon name="note" size={14} />
              </button>
              <a
                class="btn btn-ghost btn-sm"
                href={`/files/${caseState.current.id}/${item.path}`}
                target="_blank"
                rel="noreferrer"
                title="Open file"
              >
                <Icon name="external" size={14} />
              </a>
              {#if item.kind === 'image' || item.kind === 'video'}
                <button
                  class="btn btn-ghost btn-sm"
                  title="Open in Inspect"
                  onclick={() => inspect(item)}
                >
                  <Icon name="inspect" size={14} />
                </button>
              {/if}
              {#if item.kind === 'image'}
                <button
                  class="btn btn-ghost btn-sm"
                  title="Send to Geo Proof"
                  onclick={() => sendToComposer(item)}
                >
                  <Icon name="proof" size={14} />
                </button>
              {/if}
              <button class="btn btn-ghost btn-sm del" title="Delete" onclick={() => (deleteTarget = item)}>
                <Icon name="trash" size={14} />
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  {#if dragOver}
    <div class="drop-overlay">
      <div class="drop-box">
        <Icon name="upload" size={40} />
        <span>Drop to add to the case</span>
      </div>
    </div>
  {/if}
</div>

<!-- multi-item picker: shown when a URL has several attachments (e.g. a tweet
     with several photos) — pick which ones to download, before anything is fetched -->
{#if picker}
  <Modal title="Choose media to download" onclose={() => (picker = null)} width="560px">
    <p class="picker-hint">This link has {picker.items.length} attachments. Pick which to fetch.</p>
    <div class="picker-toolbar">
      <button class="btn btn-ghost btn-sm" onclick={() => selectAllPicker(true)}>Select all</button>
      <button class="btn btn-ghost btn-sm" onclick={() => selectAllPicker(false)}>Select none</button>
    </div>
    <div class="picker-list">
      {#each picker.items as item (item.index)}
        <label class="picker-row" class:selected={item.selected}>
          <input type="checkbox" bind:checked={item.selected} />
          <div class="picker-thumb">
            {#if item.thumbnail}
              <img src={item.thumbnail} alt="" loading="lazy" />
            {:else}
              <Icon name={KIND_ICONS[item.kind] ?? 'file'} size={20} />
            {/if}
          </div>
          <input class="input picker-title" placeholder="Title" bind:value={item.title} />
        </label>
      {/each}
    </div>
    <div class="modal-actions">
      <div style="flex:1"></div>
      <button class="btn" onclick={() => (picker = null)}>Cancel</button>
      <button
        class="btn btn-primary"
        disabled={!picker.items.some((i) => i.selected)}
        onclick={confirmPicker}
      >
        <Icon name="download" size={14} />
        Download {picker.items.filter((i) => i.selected).length} selected
      </button>
    </div>
  </Modal>
{/if}

<!-- details modal: the same editor body as the case sidebar (provenance,
     derivation chain, title/notes/folder) so both stay in step -->
{#if infoEntityId}
  <Modal title="Details" onclose={() => (infoEntityId = null)} width="520px">
    <EntityDetails
      entityId={infoEntityId}
      onclose={() => (infoEntityId = null)}
      ondeleted={() => (infoEntityId = null)}
    />
  </Modal>
{/if}

<!-- lightbox -->
<svelte:window onkeydown={onLightboxKey} />
{#if lightboxItem}
  <div
    class="lightbox"
    onclick={(e) => e.target === e.currentTarget && (lightboxItem = null)}
    onkeydown={(e) => e.key === 'Escape' && (lightboxItem = null)}
    role="dialog"
    aria-label="Image preview"
    tabindex="-1"
  >
    <button class="lb-close btn btn-ghost" onclick={() => (lightboxItem = null)} aria-label="Close">
      <Icon name="x" size={20} />
    </button>
    {#if lightboxImages.length > 1}
      <button
        class="lb-nav prev btn btn-ghost"
        onclick={(e) => (e.stopPropagation(), lightboxStep(-1))}
        aria-label="Previous image"
        title="Previous (←)"
      >
        <Icon name="chevronLeft" size={26} />
      </button>
      <button
        class="lb-nav next btn btn-ghost"
        onclick={(e) => (e.stopPropagation(), lightboxStep(1))}
        aria-label="Next image"
        title="Next (→)"
      >
        <Icon name="chevronRight" size={26} />
      </button>
    {/if}
    <img
      src={`/files/${caseState.current.id}/${lightboxItem.path}`}
      alt={lightboxItem.filename}
    />
    <span class="lb-caption">
      {lightboxItem.title ?? lightboxItem.filename}
      {#if lightboxImages.length > 1}
        · {lightboxImages.findIndex((i) => i.path === lightboxItem.path) + 1}/{lightboxImages.length}
      {/if}
    </span>
  </div>
{/if}

<!-- delete confirm: the file on disk goes with the entity -->
{#if deleteTarget}
  <ConfirmDialog
    title="Delete this media?"
    message={`“${deleteTarget.title ?? deleteTarget.filename}” and its entity will be removed from the case.`}
    detail="This permanently deletes the file on disk. It cannot be undone."
    confirmLabel="Delete"
    tone="danger"
    busy={deleteBusy}
    onconfirm={confirmDelete}
    oncancel={() => (deleteTarget = null)}
  />
{/if}

<style>
  .tool {
    position: relative;
  }
  .spacer {
    flex: 1;
  }
  .dl-form {
    display: flex;
    gap: 8px;
    width: min(480px, 40vw);
  }

  /* folder filter bar */
  .folder-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 20px;
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    flex-shrink: 0;
  }
  .folder-chip {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    border-radius: var(--r-sm);
    border: 1px solid var(--border);
    background: var(--bg-2);
    color: var(--text-2);
    font-size: var(--fs-xs);
    white-space: nowrap;
    cursor: pointer;
    transition: border-color 0.12s, color 0.12s, background 0.12s;
  }
  .folder-chip:hover {
    border-color: var(--border-strong);
    color: var(--text-1);
  }
  .folder-chip.active {
    border-color: var(--border-strong);
    background: var(--bg-3);
    color: var(--text-1);
  }
  .chip-count {
    font-size: var(--fs-xs);
    color: var(--text-3);
    margin-left: 2px;
  }
  .bar-sep {
    width: 1px;
    align-self: stretch;
    margin: 2px 4px;
    background: var(--border);
    flex-shrink: 0;
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
    flex-shrink: 0;
  }
  .search-box:focus-within {
    border-color: var(--accent);
  }
  .search-input {
    width: 180px;
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
  .sort-select {
    width: auto;
    font-size: var(--fs-xs);
    padding: 4px 8px;
    flex-shrink: 0;
  }

  .job {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 14px 20px 0;
    padding: 10px 14px;
    color: var(--text-2);
  }
  .job-url {
    font-size: var(--fs-xs);
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bar {
    flex: 1;
    height: 6px;
    border-radius: 3px;
    background: var(--bg-3);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--accent);
    border-radius: 3px;
    transition: width 0.4s var(--ease);
  }
  .fill.indeterminate {
    animation: slide 1.2s infinite var(--ease);
  }
  @keyframes slide {
    from { transform: translateX(-100%); }
    to { transform: translateX(350%); }
  }
  .job-meta {
    font-size: var(--fs-xs);
    color: var(--text-3);
    min-width: 90px;
    text-align: right;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    gap: 14px;
    padding: 18px 20px;
  }
  .media-card {
    overflow: hidden;
    display: flex;
    flex-direction: column;
    transition: border-color 0.15s var(--ease);
  }
  .media-card:hover {
    border-color: var(--border-strong);
  }
  .media-card.focused {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-soft);
    animation: focus-flash 0.9s var(--ease) 2;
  }
  @keyframes focus-flash {
    0%, 100% { box-shadow: 0 0 0 2px var(--accent-soft); }
    50% { box-shadow: 0 0 0 4px var(--accent-soft); }
  }
  .thumb {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 10;
    min-width: 0;
    min-height: 0;
    background: var(--bg-2);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-3);
    overflow: hidden;
    flex: 0 0 auto;
  }
  .thumb.clickable {
    cursor: zoom-in;
  }
  .thumb-status {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    color: var(--text-3);
    font-size: var(--fs-xs);
    background: none;
    border: none;
  }
  .thumb-status :global(svg) {
    opacity: 0.85;
    animation: thumb-pulse 1.6s ease-in-out infinite;
  }
  @keyframes thumb-pulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 0.9; }
  }
  .thumb-retry {
    cursor: pointer;
  }
  .thumb-retry:hover {
    color: var(--text-1);
  }
  .thumb-retry :global(svg) {
    animation: none;
  }
  .thumb img {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    object-fit: cover;
  }
  .kind {
    position: absolute;
    top: 8px;
    left: 8px;
    background: rgba(16, 16, 16, 0.75);
    backdrop-filter: blur(4px);
  }
  .folder-badge {
    position: absolute;
    bottom: 6px;
    right: 6px;
    display: flex;
    align-items: center;
    gap: 3px;
    background: rgba(16, 16, 16, 0.75);
    backdrop-filter: blur(4px);
    font-size: 10px;
    max-width: 90px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .body {
    padding: 10px 12px 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .name {
    font-size: var(--fs-sm);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .notes-preview {
    font-size: var(--fs-xs);
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-style: italic;
  }
  .actions {
    display: flex;
    gap: 2px;
    padding: 4px 8px 8px;
  }
  .del {
    margin-left: auto;
  }
  .drop-overlay {
    position: absolute;
    inset: 0;
    background: rgba(16, 16, 16, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
    pointer-events: none;
  }
  .drop-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 44px 64px;
    border: 2px dashed var(--accent);
    border-radius: var(--r-lg);
    color: var(--accent);
    font-weight: 700;
    background: var(--accent-soft);
  }

  /* shared across picker + details modals */
  .modal-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 14px;
  }

  /* multi-item picker */
  .picker-hint {
    font-size: var(--fs-sm);
    color: var(--text-2);
    margin: 0 0 10px;
  }
  .picker-toolbar {
    display: flex;
    gap: 6px;
    margin-bottom: 8px;
  }
  .picker-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 46vh;
    overflow-y: auto;
  }
  .picker-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: var(--r);
    cursor: pointer;
  }
  .picker-row.selected {
    border-color: var(--accent);
    background: var(--bg-3);
  }
  .picker-thumb {
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    border-radius: var(--r-sm, 6px);
    overflow: hidden;
    background: var(--bg-2);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-3);
  }
  .picker-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .picker-title {
    flex: 1;
    min-width: 0;
  }

  /* lightbox */
  .lightbox {
    position: fixed;
    inset: 0;
    background: rgba(4, 7, 12, 0.92);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 950;
    cursor: zoom-out;
  }
  .lightbox img {
    max-width: calc(100vw - 40px);
    max-height: calc(100vh - 80px);
    object-fit: contain;
    border-radius: var(--r);
    box-shadow: var(--shadow-2);
    cursor: default;
  }
  .lb-close {
    position: absolute;
    top: 14px;
    right: 14px;
  }
  .lb-nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    padding: 14px 8px;
    color: var(--text-1);
    background: rgba(16, 16, 16, 0.55);
    border-radius: var(--r-md);
  }
  .lb-nav:hover {
    background: rgba(16, 16, 16, 0.85);
  }
  .lb-nav.prev {
    left: 14px;
  }
  .lb-nav.next {
    right: 14px;
  }
  .lb-caption {
    position: absolute;
    bottom: 18px;
    left: 50%;
    transform: translateX(-50%);
    font-size: var(--fs-xs);
    color: var(--text-2);
    background: rgba(16, 16, 16, 0.75);
    padding: 4px 12px;
    border-radius: var(--r-sm);
    white-space: nowrap;
  }
</style>
