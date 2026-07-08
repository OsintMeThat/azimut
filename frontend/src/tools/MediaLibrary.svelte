<script>
  import { api } from '../lib/api.js';
  import { caseState, uiState, ensureCase, reloadCase, toast } from '../lib/state.svelte.js';
  import Icon from '../components/Icon.svelte';

  const KIND_ICONS = { image: 'image', video: 'video', audio: 'audio', file: 'file' };

  let items = $state([]);
  let loadedFor = $state(null);
  let url = $state('');
  let dragOver = $state(false);
  let jobs = $state([]); // active download jobs: {id, url, progress}
  let fileInput;

  $effect(() => {
    const id = caseState.current?.id;
    if (id !== loadedFor) {
      loadedFor = id;
      items = [];
      if (id) refresh(id);
    }
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
    {:else}
      <div class="grid">
        {#each items as item (item.path)}
          <div class="media-card card fade-up">
            <div class="thumb">
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
            </div>
            <div class="body">
              <span class="name" title={item.filename}>{item.filename}</span>
              <span class="meta">
                {fmtSize(item.size)} ·
                <span class="mono" title={item.sha256}>{item.sha256.slice(0, 8)}</span>
                {#if item.source?.type === 'download'}
                  · <a href={item.source.webpage_url ?? item.source.url} target="_blank" rel="noreferrer">source</a>
                {/if}
              </span>
            </div>
            <div class="actions">
              <a
                class="btn btn-ghost btn-sm"
                href={`/files/${caseState.current.id}/${item.path}`}
                target="_blank"
                rel="noreferrer"
                title="Open file"
              >
                <Icon name="external" size={14} />
              </a>
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
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(350%);
    }
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
  .thumb {
    position: relative;
    aspect-ratio: 16 / 10;
    background: var(--bg-2);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-3);
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
</style>
