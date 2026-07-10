<script>
  import { api } from '../lib/api.js';
  import { caseState, uiState, ensureCase, reloadCase, toast } from '../lib/state.svelte.js';
  import Icon from '../components/Icon.svelte';
  import Modal from '../components/Modal.svelte';

  const KIND_ICONS = { image: 'image', video: 'video', audio: 'audio', file: 'file' };

  let items = $state([]);
  let loadedFor = $state(null);
  let url = $state('');
  let dragOver = $state(false);
  let jobs = $state([]); // active download jobs: {id, url, progress}
  let fileInput;

  // --- category facets (auto-derived from kind + source) ---
  // Overlapping filters (a downloaded video matches both Videos and Downloads);
  // clicking one narrows the grid to that facet. Order matches the sidebar bar.
  const CATEGORIES = [
    { key: 'image', label: 'Images', icon: 'image', match: (i) => i.kind === 'image' },
    { key: 'video', label: 'Videos', icon: 'video', match: (i) => i.kind === 'video' },
    { key: 'collage', label: 'Collages', icon: 'layers', match: (i) => i.source?.op === 'collage' },
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

  const folders = $derived(
    [...new Set(items.filter((i) => i.folder).map((i) => i.folder))].sort()
  );
  const filteredItems = $derived(
    items.filter(
      (i) => (!catMatch || catMatch(i)) && (!folderFilter || i.folder === folderFilter)
    )
  );

  // --- info/edit modal ---
  let editItem = $state(null);
  let editNotes = $state('');
  let editTitle = $state('');
  let editSaving = $state(false);

  // --- lightbox ---
  let lightboxItem = $state(null);

  // --- focus/highlight (a media clicked from the case sidebar) ---
  let focusedPath = $state(null);
  let focusScrolledFor = null;
  let focusTimer;

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
    const c = await ensureCase();
    try {
      const { job_id } = await api.post(`/api/cases/${c.id}/media/download`, { url: target });
      jobs.push({ id: job_id, url: target, progress: {} });
      poll(job_id);
    } catch (e) {
      toast(e.message, 'danger');
    }
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
      if (status.status === 'done') {
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

  async function remove(item) {
    await api.del(
      `/api/cases/${caseState.current.id}/media?path=${encodeURIComponent(item.path)}`
    );
    await Promise.all([refresh(), reloadCase()]);
    toast(`Removed ${item.filename}`, 'info');
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

  function fmtDate(iso) {
    if (!iso) return '';
    return iso.slice(0, 10);
  }

  function onDrop(e) {
    e.preventDefault();
    dragOver = false;
    importFiles(e.dataTransfer.files);
  }

  // --- info modal actions ---
  function openInfo(item) {
    editItem = item;
    editNotes = item.notes ?? '';
    editTitle = item.title ?? '';
  }

  async function saveInfo() {
    if (!editItem) return;
    editSaving = true;
    try {
      const updated = await api.patch(`/api/cases/${caseState.current.id}/media`, {
        path: editItem.path,
        notes: editNotes,
        title: editTitle,
      });
      const idx = items.findIndex((i) => i.path === editItem.path);
      if (idx !== -1) items[idx] = updated;
      editItem = null;
      // mirror the title/notes onto the case sidebar entity live
      await reloadCase();
      toast('Saved', 'ok', 1600);
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      editSaving = false;
    }
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
    <span class="sub">import files or download by URL — hashed &amp; filed in the case</span>
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
        placeholder="https://x.com/…  https://t.me/…  https://youtube.com/…"
        bind:value={url}
      />
      <button type="submit" class="btn btn-primary" disabled={!url.trim()}>
        <Icon name="download" size={15} /> Download
      </button>
    </form>
    <button class="btn" onclick={() => fileInput.click()}>
      <Icon name="upload" size={15} /> Import
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

  <!-- category + folder filter bar -->
  {#if items.length > 0}
    <div class="folder-bar">
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
      <div class="job card fade-up">
        <Icon name="download" size={15} />
        <span class="job-url mono">{job.url}</span>
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
        <p>
          Drop files anywhere on this page, or paste a URL from X, Telegram, TikTok, YouTube…
          Every file is SHA-256 hashed and its origin recorded.
        </p>
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
            class="media-card card fade-up"
            class:focused={item.path === focusedPath}
            data-path={item.path}
          >
            <!-- thumbnail — click to lightbox for images -->
            <div
              class="thumb"
              class:clickable={item.kind === 'image'}
              onclick={() => item.kind === 'image' && (lightboxItem = item)}
              role={item.kind === 'image' ? 'button' : undefined}
              tabindex={item.kind === 'image' ? 0 : undefined}
              onkeydown={(e) => e.key === 'Enter' && item.kind === 'image' && (lightboxItem = item)}
              aria-label={item.kind === 'image' ? `Preview ${item.filename}` : undefined}
            >
              {#if item.thumbnail}
                <img
                  src={`/files/${caseState.current.id}/${item.thumbnail}`}
                  alt={item.filename}
                  loading="lazy"
                />
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
                  title="Send to Proof Composer"
                  onclick={() => sendToComposer(item)}
                >
                  <Icon name="proof" size={14} />
                </button>
              {/if}
              <button class="btn btn-ghost btn-sm del" title="Delete" onclick={() => remove(item)}>
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

<!-- info / edit modal -->
{#if editItem}
  <Modal title={editItem.filename} onclose={() => (editItem = null)} width="520px">
    <!-- preview -->
    {#if editItem.kind === 'image' && editItem.thumbnail}
      <div class="modal-preview">
        <img
          src={`/files/${caseState.current.id}/${editItem.path}`}
          alt={editItem.filename}
        />
      </div>
    {:else if editItem.kind === 'video'}
      <div class="modal-preview">
        <!-- svelte-ignore a11y_media_has_caption -->
        <video
          src={`/files/${caseState.current.id}/${editItem.path}`}
          controls
          preload="metadata"
        ></video>
      </div>
    {/if}

    <!-- metadata section -->
    <div class="info-rows">
      <div class="info-row">
        <span class="info-label">Kind</span>
        <span>{editItem.kind}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Size</span>
        <span>{fmtSize(editItem.size)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Added</span>
        <span>{fmtDate(editItem.added_at)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">SHA-256</span>
        <span class="mono hash" title={editItem.sha256}>{editItem.sha256}</span>
      </div>
      {#if editItem.source?.type === 'download'}
        {#if editItem.source.title}
          <div class="info-row">
            <span class="info-label">Title</span>
            <span>{editItem.source.title}</span>
          </div>
        {/if}
        {#if editItem.source.uploader}
          <div class="info-row">
            <span class="info-label">Uploader</span>
            <span>{editItem.source.uploader}</span>
          </div>
        {/if}
        {#if editItem.source.upload_date}
          <div class="info-row">
            <span class="info-label">Published</span>
            <span class="mono">{editItem.source.upload_date}</span>
          </div>
        {/if}
        {#if editItem.source.duration}
          <div class="info-row">
            <span class="info-label">Duration</span>
            <span>{editItem.source.duration}s</span>
          </div>
        {/if}
        {#if editItem.source.webpage_url ?? editItem.source.url}
          <div class="info-row">
            <span class="info-label">Source</span>
            <a
              href={editItem.source.webpage_url ?? editItem.source.url}
              target="_blank"
              rel="noreferrer"
              class="mono source-link"
            >{editItem.source.webpage_url ?? editItem.source.url}</a>
          </div>
        {/if}
        {#if editItem.source.description}
          <div class="info-row">
            <span class="info-label">Description</span>
            <span class="description">{editItem.source.description}</span>
          </div>
        {/if}
      {/if}
    </div>

    <hr class="divider" />

    <!-- editable fields -->
    <label class="field-label" for="edit-title">Title</label>
    <input
      id="edit-title"
      class="input"
      placeholder={editItem.filename}
      bind:value={editTitle}
    />

    <label class="field-label" for="edit-notes" style="margin-top: 12px;">Notes</label>
    <textarea
      id="edit-notes"
      class="textarea"
      rows="4"
      placeholder="Add context, observations, links…"
      bind:value={editNotes}
    ></textarea>

    <div class="modal-actions">
      {#if editItem.kind === 'image'}
        <button class="btn btn-ghost btn-sm" onclick={() => { sendToComposer(editItem); editItem = null; }}>
          <Icon name="proof" size={14} /> Send to Composer
        </button>
      {/if}
      <div style="flex:1"></div>
      <button class="btn" onclick={() => (editItem = null)}>Cancel</button>
      <button class="btn btn-primary" onclick={saveInfo} disabled={editSaving}>
        {editSaving ? 'Saving…' : 'Save'}
      </button>
    </div>
  </Modal>
{/if}

<!-- lightbox -->
{#if lightboxItem}
  <div
    class="lightbox"
    onclick={() => (lightboxItem = null)}
    onkeydown={(e) => e.key === 'Escape' && (lightboxItem = null)}
    role="dialog"
    aria-label="Image preview"
    tabindex="-1"
  >
    <button class="lb-close btn btn-ghost" onclick={() => (lightboxItem = null)} aria-label="Close">
      <Icon name="x" size={20} />
    </button>
    <img
      src={`/files/${caseState.current.id}/${lightboxItem.path}`}
      alt={lightboxItem.filename}
      onclick={(e) => e.stopPropagation()}
    />
    <span class="lb-caption">{lightboxItem.filename}</span>
  </div>
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
    border-radius: 999px;
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
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
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
    transition: border-color 0.15s var(--ease), transform 0.15s var(--ease);
  }
  .media-card:hover {
    border-color: var(--border-strong);
    transform: translateY(-1px);
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
    aspect-ratio: 16 / 10;
    background: var(--bg-2);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-3);
  }
  .thumb.clickable {
    cursor: zoom-in;
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .kind {
    position: absolute;
    top: 8px;
    left: 8px;
    background: rgba(11, 15, 23, 0.75);
    backdrop-filter: blur(4px);
  }
  .folder-badge {
    position: absolute;
    bottom: 6px;
    right: 6px;
    display: flex;
    align-items: center;
    gap: 3px;
    background: rgba(11, 15, 23, 0.75);
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
    background: rgba(11, 15, 23, 0.8);
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

  /* info modal */
  .modal-preview {
    border-radius: var(--r);
    overflow: hidden;
    background: var(--bg-2);
    margin-bottom: 14px;
    max-height: 260px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .modal-preview img,
  .modal-preview video {
    max-width: 100%;
    max-height: 260px;
    object-fit: contain;
    display: block;
  }
  .info-rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 4px;
  }
  .info-row {
    display: flex;
    gap: 10px;
    font-size: var(--fs-sm);
    align-items: baseline;
    min-width: 0;
  }
  .info-label {
    color: var(--text-3);
    font-size: var(--fs-xs);
    min-width: 70px;
    flex-shrink: 0;
  }
  .hash {
    font-size: 11px;
    word-break: break-all;
    color: var(--text-2);
  }
  .source-link {
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
  .divider {
    border: none;
    border-top: 1px solid var(--border);
    margin: 14px 0 12px;
  }
  .field-label {
    display: block;
    font-size: var(--fs-xs);
    color: var(--text-3);
    margin-bottom: 5px;
  }
  .textarea {
    width: 100%;
    resize: vertical;
    min-height: 80px;
  }
  .modal-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 14px;
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
  .lb-caption {
    position: absolute;
    bottom: 18px;
    left: 50%;
    transform: translateX(-50%);
    font-size: var(--fs-xs);
    color: var(--text-2);
    background: rgba(11, 15, 23, 0.75);
    padding: 4px 12px;
    border-radius: 999px;
    white-space: nowrap;
  }
</style>
