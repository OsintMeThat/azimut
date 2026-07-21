<script>
  // Reverse Search Launcher — builds the reverse-image hand-off for the four
  // key-less engines. Azimut never runs the search itself (principle 4): it
  // preps the image (clipboard for paste engines, a saved file for drag ones)
  // and each button is a plain link to the engine's page.
  //
  // Pick a case photo, or scrub a case video to a frame. Adjustments
  // (brightness, contrast, …) preview live and are baked into the exported
  // image via a same-origin canvas — nothing leaves the machine until an
  // engine tab is opened by the analyst.
  import { api } from '../lib/api.js';
  import { caseState, uiState, toast } from '../lib/state.svelte.js';
  import { UPLOAD_PAGES } from '../lib/reverseSearch.js';
  import Modal from '../components/Modal.svelte';
  import Icon from '../components/Icon.svelte';

  const PASTE = UPLOAD_PAGES.filter((e) => e.paste);
  const DRAG = UPLOAD_PAGES.filter((e) => !e.paste);

  let pickerOpen = $state(false);
  let mediaLibrary = $state([]);
  let selected = $state(null); // the chosen media item, or null
  let videoEl = $state(null); // the <video> element, when a video is selected

  // -- adjustments (client-side CSS filters, baked into the export) -----------
  const NEUTRAL = { brightness: 100, contrast: 100, saturate: 100, grayscale: 0 };
  let adjust = $state({ ...NEUTRAL });
  let adjustOpen = $state(false);
  const filterCss = $derived(
    `brightness(${adjust.brightness}%) contrast(${adjust.contrast}%) ` +
      `saturate(${adjust.saturate}%) grayscale(${adjust.grayscale}%)`
  );
  const adjusted = $derived(
    adjust.brightness !== 100 ||
      adjust.contrast !== 100 ||
      adjust.saturate !== 100 ||
      adjust.grayscale !== 0
  );
  const resetAdjust = () => (adjust = { ...NEUTRAL });

  const srcOf = (item) => `/files/${caseState.current.id}/${item.path}`;
  const nameOf = (item) => (item.label || item.path).replace(/^media\//, '');
  const frameLabel = $derived(selected?.kind === 'video' ? 'frame' : 'image');

  // -- picker -----------------------------------------------------------------
  async function openPicker() {
    if (!caseState.current) {
      toast('Open a case to search its media', 'warn');
      return;
    }
    try {
      mediaLibrary = await api.get(`/api/cases/${caseState.current.id}/media`);
      pickerOpen = true;
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  function pickMedia(item) {
    selected = item;
    resetAdjust();
    pickerOpen = false;
  }

  function discard() {
    selected = null;
    resetAdjust();
    adjustOpen = false;
  }

  // -- selection → PNG blob ---------------------------------------------------
  // Always drawn through a canvas so the adjustments bake in; an image gets
  // loaded, a video is sampled at its current playhead.
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not read the image'));
      img.src = src;
    });
  }

  async function pngBlob() {
    let source, w, h;
    if (selected.kind === 'video') {
      if (!videoEl || !videoEl.videoWidth) {
        throw new Error('Let the video load, then scrub to the frame you want');
      }
      source = videoEl;
      w = videoEl.videoWidth;
      h = videoEl.videoHeight;
    } else {
      source = await loadImage(srcOf(selected));
      w = source.naturalWidth;
      h = source.naturalHeight;
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.filter = filterCss;
    ctx.drawImage(source, 0, 0, w, h);
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Could not encode the image'))),
        'image/png'
      )
    );
  }

  // -- hand-off (buttons are real links, so nothing is popup-blocked) ---------
  async function copySelection() {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob() })]);
      toast(`Copied the ${frameLabel}. Paste it in the tab with Ctrl+V`, 'ok', 4500);
    } catch (e) {
      toast(e.message || 'Could not copy the image', 'warn');
    }
  }

  async function saveSelection() {
    try {
      const blob = await pngBlob();
      const base = nameOf(selected).replace(/^.*\//, '').replace(/\.[^.]+$/, '');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `reverse-${base}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast(`Saved the ${frameLabel}. Drag it into the tab`, 'ok', 4500);
    } catch (e) {
      toast(e.message || 'Could not save the image', 'warn');
    }
  }

  function openInInspect() {
    uiState.inspectPath = selected.path;
    uiState.tool = 'inspect';
  }

  const SLIDERS = [
    { id: 'brightness', label: 'Brightness', min: 0, max: 200 },
    { id: 'contrast', label: 'Contrast', min: 0, max: 200 },
    { id: 'saturate', label: 'Saturation', min: 0, max: 200 },
    { id: 'grayscale', label: 'Grayscale', min: 0, max: 100 },
  ];
</script>

<div class="tool">
  <div class="tool-header">
    <h2>Reverse Search</h2>
    {#if selected}<span class="sub">Copy or save the {frameLabel}, then hand it to an engine</span>{/if}
  </div>

  <div class="tool-body">
    {#if !selected}
      <div class="empty" style="height: 100%">
        <div class="empty-icon"><Icon name="search" size={42} /></div>
        <h3>Reverse image search</h3>
        <p>Pick a case photo, or a video to grab a frame from, then send it to the engines.</p>
        <button class="btn btn-primary" onclick={openPicker}>
          <Icon name="image" size={15} /> Pick from case
        </button>
        <div class="fallback">
          <span class="eg-head">Or open an engine and drag any file in</span>
          <div class="engine-links">
            {#each UPLOAD_PAGES as e (e.id)}
              <a href={e.url} target="_blank" rel="noreferrer" class="engine-link">
                {e.label} <Icon name="external" size={12} />
              </a>
            {/each}
          </div>
        </div>
      </div>
    {:else}
      <div class="work">
        <div class="preview-col">
          <div class="preview-panel card">
            <div class="preview-bar">
              <span class="file">
                <Icon name={selected.kind === 'video' ? 'video' : 'image'} size={13} />
                <span class="name" title={selected.path}>{nameOf(selected)}</span>
              </span>
              <span class="bar-actions">
                <button class="btn btn-ghost btn-sm" onclick={openPicker}>Change</button>
                <button class="btn btn-ghost btn-sm" onclick={discard}>
                  <Icon name="x" size={13} /> Discard
                </button>
              </span>
            </div>
            <div class="preview">
              {#if selected.kind === 'video'}
                <!-- svelte-ignore a11y_media_has_caption -->
                <video
                  bind:this={videoEl}
                  src={srcOf(selected)}
                  controls
                  preload="metadata"
                  style="filter: {filterCss}"
                ></video>
              {:else}
                <img src={srcOf(selected)} alt={nameOf(selected)} style="filter: {filterCss}" />
              {/if}
            </div>
          </div>
          {#if selected.kind === 'video'}
            <p class="hint">Scrub to the moment, then copy or save the frame.</p>
          {/if}
        </div>

        <div class="controls-col">
          <div class="adjust">
            <button
              class="adjust-toggle"
              class:on={adjustOpen}
              onclick={() => (adjustOpen = !adjustOpen)}
            >
              <Icon name="sliders" size={14} /> Adjust
              {#if adjusted && !adjustOpen}<span class="dot" title="Edited"></span>{/if}
            </button>
            {#if adjustOpen}
              <div class="sliders">
                {#each SLIDERS as s (s.id)}
                  <label class="slider">
                    <span class="lbl">{s.label}</span>
                    <input type="range" min={s.min} max={s.max} bind:value={adjust[s.id]} />
                    <span class="val mono">{adjust[s.id]}</span>
                  </label>
                {/each}
                <button class="btn btn-ghost btn-sm reset" onclick={resetAdjust} disabled={!adjusted}>
                  Reset
                </button>
              </div>
            {/if}
          </div>

          <div class="engines">
            <div class="eg-group">
              <span class="eg-head">Copy, then paste (Ctrl+V) in the tab</span>
              <div class="eg-list">
                {#each PASTE as e (e.id)}
                  <a href={e.url} target="_blank" rel="noreferrer" class="btn engine-btn" onclick={copySelection}>
                    <Icon name="copy" size={14} /> {e.label}
                  </a>
                {/each}
              </div>
            </div>
            <div class="eg-group">
              <span class="eg-head">Save, then drag the file into the tab</span>
              <div class="eg-list">
                {#each DRAG as e (e.id)}
                  <a href={e.url} target="_blank" rel="noreferrer" class="btn engine-btn" onclick={saveSelection}>
                    <Icon name="download" size={14} /> {e.label}
                  </a>
                {/each}
              </div>
            </div>
          </div>

          {#if selected.kind === 'video'}
            <button class="btn btn-ghost btn-sm inspect-link" onclick={openInInspect}>
              <Icon name="crop" size={13} /> Finer control in Inspect
            </button>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

{#if pickerOpen}
  <Modal title="Pick a case image or video" width="640px" onclose={() => (pickerOpen = false)}>
    {#if mediaLibrary.length === 0}
      <p class="picker-empty">No media in this case yet. Import or download some in the Media tab.</p>
    {:else}
      <div class="picker-grid">
        {#each mediaLibrary as item (item.path)}
          <button class="picker-item" onclick={() => pickMedia(item)} title={item.path}>
            <div class="picker-thumb">
              {#if item.thumbnail}
                <img src={`/files/${caseState.current.id}/${item.thumbnail}`} alt={item.path} />
              {:else}
                <Icon name={item.kind === 'video' ? 'video' : 'image'} size={24} />
              {/if}
              {#if item.kind === 'video'}<span class="kind-badge"><Icon name="video" size={11} /></span>{/if}
            </div>
            <span class="picker-name">{nameOf(item)}</span>
          </button>
        {/each}
      </div>
    {/if}
  </Modal>
{/if}

<style>
  .tool-body {
    padding: 20px;
  }
  .hint {
    font-size: var(--fs-sm);
    color: var(--text-3);
  }

  /* empty state — shared .empty primitive, with the engine fallback below */
  .fallback {
    margin-top: 22px;
    padding-top: 20px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    width: 100%;
    max-width: 360px;
  }
  .engine-links {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px 18px;
  }
  .engine-link {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  .engine-link:hover {
    color: var(--text-1);
    text-decoration: none;
  }
  .engine-link :global(svg) {
    color: var(--text-3);
  }

  /* working layout */
  .work {
    display: flex;
    gap: 24px;
    flex-wrap: wrap;
    align-items: flex-start;
  }
  .preview-col {
    flex: 1 1 460px;
    min-width: 320px;
    max-width: 660px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .preview-panel {
    overflow: hidden;
  }
  .preview-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 8px 6px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-2);
  }
  .file {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    color: var(--text-2);
  }
  .file :global(svg) {
    color: var(--text-3);
    flex-shrink: 0;
  }
  .name {
    font-size: var(--fs-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bar-actions {
    display: inline-flex;
    gap: 2px;
    flex-shrink: 0;
  }
  .preview {
    background: var(--bg-0);
    display: flex;
    justify-content: center;
  }
  .preview img,
  .preview video {
    display: block;
    max-width: 100%;
    max-height: 64vh;
    object-fit: contain;
  }

  .controls-col {
    flex: 1 1 300px;
    min-width: 260px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .eg-head {
    display: block;
    text-transform: uppercase;
    font-size: var(--fs-xs);
    letter-spacing: 0.06em;
    color: var(--text-3);
    margin-bottom: 8px;
  }
  .engines {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .eg-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .engine-btn {
    flex: 1 1 auto;
    justify-content: center;
    min-width: 120px;
  }
  .reset {
    align-self: flex-end;
  }
  .inspect-link {
    align-self: flex-start;
  }

  /* adjust panel */
  .adjust-toggle {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 6px 10px;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    color: var(--text-2);
    font-size: var(--fs-sm);
    cursor: pointer;
  }
  .adjust-toggle:hover,
  .adjust-toggle.on {
    border-color: var(--border-strong);
    color: var(--text-1);
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }
  .sliders {
    display: flex;
    flex-direction: column;
    gap: 9px;
    margin-top: 10px;
    padding: 12px;
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .slider {
    display: grid;
    grid-template-columns: 84px 1fr 34px;
    align-items: center;
    gap: 10px;
    font-size: var(--fs-sm);
  }
  .slider .lbl {
    color: var(--text-2);
  }
  .slider input[type='range'] {
    width: 100%;
    accent-color: var(--accent);
  }
  .slider .val {
    text-align: right;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .reset {
    align-self: flex-end;
    margin-top: 2px;
  }

  /* picker modal */
  .picker-empty {
    color: var(--text-3);
    font-size: var(--fs-sm);
    padding: 8px;
  }
  .picker-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 8px;
  }
  .picker-item {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 6px;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    text-align: left;
  }
  .picker-item:hover {
    border-color: var(--border-strong);
  }
  .picker-thumb {
    position: relative;
    aspect-ratio: 4 / 3;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-0);
    border-radius: 3px;
    overflow: hidden;
    color: var(--text-3);
  }
  .picker-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .kind-badge {
    position: absolute;
    bottom: 3px;
    right: 3px;
    display: inline-flex;
    padding: 2px;
    background: rgba(0, 0, 0, 0.6);
    border-radius: 3px;
  }
  .picker-name {
    font-size: var(--fs-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
