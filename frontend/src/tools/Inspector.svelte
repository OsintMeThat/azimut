<script>
  import { api } from '../lib/api.js';
  import { caseState, uiState, reloadCase, toast } from '../lib/state.svelte.js';
  import { INSPECT_MODULES } from '../lib/inspectModules.js';
  import Icon from '../components/Icon.svelte';

  let mediaList = $state([]);
  let loadedFor = $state(null);
  let source = $state(null);
  let probeInfo = $state(null);
  let moduleId = $state(null);
  let produced = $state(null);

  // reactive bridge between the modules and the viewer
  const shared = $state({
    filter: '',
    transform: '',
    crop: null, // { x, y, w, h } fractional
    cropMode: false,
    currentTime: 0,
    seekTo: null,
  });

  let videoEl = $state();
  let cropDraw = $state(null); // in-progress crop rectangle

  const modules = $derived(
    source ? INSPECT_MODULES.filter((m) => m.kinds.includes(source.kind)) : []
  );
  const ActiveModule = $derived(modules.find((m) => m.id === moduleId)?.component ?? null);

  // load case media; react to case switches
  $effect(() => {
    const id = caseState.current?.id;
    if (id !== loadedFor) {
      loadedFor = id;
      mediaList = [];
      source = null;
      if (id) refresh(id);
    }
  });

  // deep-link from the Media Library ("Inspect")
  $effect(() => {
    if (uiState.tool === 'inspect' && uiState.inspectPath && mediaList.length) {
      const target = mediaList.find((m) => m.path === uiState.inspectPath);
      uiState.inspectPath = null;
      if (target) select(target);
    }
  });

  // apply a requested video seek coming from a module
  $effect(() => {
    if (shared.seekTo != null && videoEl) {
      videoEl.currentTime = shared.seekTo;
      shared.seekTo = null;
    }
  });

  async function refresh(id = caseState.current?.id) {
    if (!id) return;
    mediaList = await api.get(`/api/cases/${id}/media`);
    if (source) {
      const still = mediaList.find((m) => m.path === source.path);
      if (!still) source = null;
    }
  }

  async function select(item) {
    resetViewer();
    source = item;
    produced = null;
    try {
      probeInfo = await api.get(
        `/api/cases/${caseState.current.id}/inspect/probe?path=${encodeURIComponent(item.path)}`
      );
    } catch {
      probeInfo = { kind: item.kind };
    }
    const applicable = INSPECT_MODULES.filter((m) => m.kinds.includes(item.kind));
    moduleId = applicable[0]?.id ?? null;
  }

  function resetViewer() {
    shared.filter = '';
    shared.transform = '';
    shared.crop = null;
    shared.cropMode = false;
    shared.currentTime = 0;
  }

  function onProduced(res) {
    produced = res.item;
    refresh();
  }

  function inspectProduced() {
    const item = mediaList.find((m) => m.path === produced.path) ?? produced;
    select({ ...item, kind: 'image' });
  }

  function sendToComposer(item) {
    if (!uiState.composeQueue.includes(item.path)) uiState.composeQueue.push(item.path);
    uiState.tool = 'proof';
  }

  // -- crop overlay ---------------------------------------------------------
  function frac(e, el) {
    const r = el.getBoundingClientRect();
    return {
      x: Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1),
      y: Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1),
    };
  }

  function cropDown(e) {
    if (!shared.cropMode) return;
    e.preventDefault();
    const p = frac(e, e.currentTarget);
    cropDraw = { sx: p.x, sy: p.y, x: p.x, y: p.y, w: 0, h: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function cropMove(e) {
    if (!cropDraw) return;
    const p = frac(e, e.currentTarget);
    cropDraw = {
      sx: cropDraw.sx,
      sy: cropDraw.sy,
      x: Math.min(cropDraw.sx, p.x),
      y: Math.min(cropDraw.sy, p.y),
      w: Math.abs(p.x - cropDraw.sx),
      h: Math.abs(p.y - cropDraw.sy),
    };
  }

  function cropUp() {
    if (cropDraw && cropDraw.w > 0.02 && cropDraw.h > 0.02) {
      shared.crop = { x: cropDraw.x, y: cropDraw.y, w: cropDraw.w, h: cropDraw.h };
      shared.cropMode = false;
    }
    cropDraw = null;
  }

  const cropBox = $derived(cropDraw ?? shared.crop);
</script>

<div class="tool">
  <div class="tool-header">
    <h2>Inspect</h2>
    <span class="sub">open a photo or video — grab frames, adjust, collage &amp; analyse</span>
    <div class="spacer"></div>
    <select
      class="input source-select"
      value={source?.path ?? ''}
      onchange={(e) => {
        const m = mediaList.find((x) => x.path === e.target.value);
        if (m) select(m);
      }}
    >
      <option value="" disabled>Choose a media…</option>
      {#each mediaList as m (m.path)}
        <option value={m.path}>{m.label || m.filename}</option>
      {/each}
    </select>
  </div>

  {#if !caseState.current}
    <div class="empty">
      <Icon name="inspect" size={40} />
      <p>Open a case and add media to start inspecting.</p>
      <button class="btn btn-primary" onclick={() => (uiState.tool = 'media')}>Go to Media Library</button>
    </div>
  {:else if !source}
    <div class="empty">
      <Icon name="inspect" size={40} />
      <p>Choose a media above to open it.</p>
      {#if mediaList.length === 0}
        <button class="btn" onclick={() => (uiState.tool = 'media')}>Add media first</button>
      {/if}
    </div>
  {:else}
    <div class="workspace">
      <div class="viewer">
        <div
          class="frame"
          class:cropping={shared.cropMode}
          onpointerdown={cropDown}
          onpointermove={cropMove}
          onpointerup={cropUp}
        >
          {#if source.kind === 'video'}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video
              bind:this={videoEl}
              src={`/files/${caseState.current.id}/${source.path}`}
              controls
              ontimeupdate={() => (shared.currentTime = videoEl?.currentTime ?? 0)}
              style:filter={shared.filter}
              style:transform={shared.transform}
            ></video>
          {:else}
            <img
              src={`/files/${caseState.current.id}/${source.path}`}
              alt={source.filename}
              style:filter={shared.filter}
              style:transform={shared.transform}
            />
          {/if}

          {#if cropBox}
            <div
              class="crop-box"
              style:left={`${cropBox.x * 100}%`}
              style:top={`${cropBox.y * 100}%`}
              style:width={`${cropBox.w * 100}%`}
              style:height={`${cropBox.h * 100}%`}
            ></div>
          {/if}
        </div>
      </div>

      <aside class="panel">
        <div class="module-tabs">
          {#each modules as m (m.id)}
            <button class="mtab" class:active={moduleId === m.id} onclick={() => (moduleId = m.id)}>
              <Icon name={m.icon} size={15} /> {m.label}
            </button>
          {/each}
        </div>

        {#if produced}
          <div class="produced fade-up">
            <img src={`/files/${caseState.current.id}/${produced.thumbnail ?? produced.path}`} alt="result" />
            <div class="produced-body">
              <span class="produced-name">{produced.filename}</span>
              <div class="produced-actions">
                <button class="btn btn-xs" onclick={inspectProduced}><Icon name="inspect" size={12} /> Inspect</button>
                <button class="btn btn-xs" onclick={() => sendToComposer(produced)}>
                  <Icon name="proof" size={12} /> Composer
                </button>
              </div>
            </div>
            <button class="btn btn-ghost btn-xs" onclick={() => (produced = null)} aria-label="Dismiss">
              <Icon name="x" size={13} />
            </button>
          </div>
        {/if}

        <div class="module-body">
          {#if ActiveModule}
            <ActiveModule {source} {probeInfo} {shared} {mediaList} {onProduced} />
          {/if}
        </div>
      </aside>
    </div>
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
    align-items: baseline;
    gap: 10px;
    padding: 14px 16px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  h2 {
    font-size: var(--fs-lg);
    font-weight: 700;
  }
  .sub {
    color: var(--text-3);
    font-size: var(--fs-sm);
  }
  .spacer {
    flex: 1;
  }
  .source-select {
    max-width: 280px;
  }
  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--text-3);
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
    align-items: center;
    justify-content: center;
    padding: 18px;
    background: var(--bg-0);
    overflow: auto;
  }
  .frame {
    position: relative;
    display: inline-block;
    line-height: 0;
    touch-action: none;
    box-shadow: var(--shadow-2);
  }
  .frame.cropping {
    cursor: crosshair;
  }
  .frame img,
  .frame video {
    max-width: 100%;
    max-height: calc(100vh - var(--topbar-h) - 120px);
    display: block;
  }
  .crop-box {
    position: absolute;
    border: 1.5px solid var(--accent);
    box-shadow: 0 0 0 9999px rgba(6, 9, 14, 0.55);
    pointer-events: none;
  }
  .panel {
    width: 320px;
    flex-shrink: 0;
    border-left: 1px solid var(--border);
    background: var(--bg-1);
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .module-tabs {
    display: flex;
    gap: 4px;
    padding: 10px;
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
  }
  .mtab {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 6px 9px;
    border-radius: var(--r-md);
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-3);
  }
  .mtab:hover {
    color: var(--text-1);
    background: var(--bg-2);
  }
  .mtab.active {
    color: var(--accent);
    background: var(--accent-soft);
  }
  .module-body {
    padding: 14px;
    overflow: auto;
    flex: 1;
  }
  .produced {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 10px;
    padding: 8px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    background: var(--bg-2);
  }
  .produced img {
    width: 46px;
    height: 46px;
    object-fit: cover;
    border-radius: var(--r-sm);
  }
  .produced-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .produced-name {
    font-size: var(--fs-xs);
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .produced-actions {
    display: flex;
    gap: 5px;
  }
</style>
