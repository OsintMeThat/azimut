<script>
  // Reverse Search Launcher — builds the reverse-image hand-off for the four
  // key-less engines. Azimut never runs the search itself (principle 4): it
  // preps the image (clipboard for paste engines, a saved file for drag ones)
  // and each button is a plain link to the engine's page.
  //
  // With the capture extension installed and the switch in Settings on, a button
  // instead opens the engine with the image already in its uploader, and the
  // engine searches. That is a press of the same button, and the clipboard road
  // is still what every refusal falls back to.
  //
  // Pick a case photo, or scrub a case video to a frame — or arrive from the Media
  // Library or Inspect already holding one (`uiState.reverseTarget`). The picking
  // is Inspect's own file list, kept on screen until a picture is chosen. Adjustments
  // (brightness, contrast, …) preview live and are baked into the exported
  // image via a same-origin canvas — nothing leaves the machine until an
  // engine tab is opened by the analyst.
  import { untrack } from 'svelte';
  import { api } from '../lib/api.js';
  import { fileUrl } from '../lib/fileUrl.js';
  import { caseState, prefs, uiState, toast } from '../lib/state.svelte.js';
  import { extensionVersion, handOffReverse } from '../lib/extBridge.js';
  import { MAX_HANDOFF_BYTES, UPLOAD_PAGES } from '../lib/reverseSearch.js';
  import Modal from '../components/Modal.svelte';
  import Icon from '../components/Icon.svelte';
  import SourcePicker from '../components/SourcePicker.svelte';

  const PASTE = UPLOAD_PAGES.filter((e) => e.paste);
  const DRAG = UPLOAD_PAGES.filter((e) => !e.paste);
  // The marker the extension stamps on <html> at document_start. Read once:
  // installing it with the app already open needs a tab reload either way, and
  // Settings is where that is said.
  const extInstalled = extensionVersion();

  let pickerOpen = $state(false);
  let mediaList = $state([]);
  let mediaFor = $state(null); // the case `mediaList` was read from, once it has been
  let loadedFor; // the case this tab last followed
  let selected = $state(null); // the chosen media item, or null
  let videoEl = $state(null); // the <video> element, when a video is selected

  const searchableMedia = $derived(mediaList.filter((m) => m.kind === 'image' || m.kind === 'video'));
  const listed = $derived(caseState.current != null && mediaFor === caseState.current.id);

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

  // A picture that exists nowhere on disk is shown from an address made for it here,
  // and revoked once it is replaced or discarded.
  const srcOf = (item) => item.src ?? fileUrl(caseState.current.id, item.path);
  // The name the list and the Media Library show it by, as a handoff already carries.
  const nameOf = (item) => (item.label || item.title || item.path).replace(/^media\//, '');
  const frameLabel = $derived(selected?.kind === 'video' ? 'frame' : 'image');
  const downloadName = () =>
    `reverse-${nameOf(selected).replace(/^.*\//, '').replace(/\.[^.]+$/, '')}.png`;

  // Which engines this press can be handed to, and which are left on the two
  // gestures. An engine the extension cannot fill keeps its old group, so the
  // headings never promise more than the buttons under them do.
  const filled = $derived(prefs.reversePrefill && extInstalled ? UPLOAD_PAGES.filter((e) => e.fill) : []);
  const pasteLeft = $derived(PASTE.filter((e) => !filled.includes(e)));
  const dragLeft = $derived(DRAG.filter((e) => !filled.includes(e)));

  // -- picker -----------------------------------------------------------------
  async function refresh(id) {
    try {
      const list = await api.get(`/api/cases/${id}/media`);
      if (id !== caseState.current?.id) return;
      mediaList = list;
      mediaFor = id;
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  // The list follows the case like Inspect's: an import, a delete or a restore
  // elsewhere bumps its revision. A picture of the case before goes with it, as
  // its handoff does, and before the page redraws, since its address names that
  // case. The handoff below runs after, so it may then show the one it was given.
  $effect.pre(() => {
    const id = caseState.current?.id;
    caseState.rev;
    if (id !== loadedFor) {
      if (loadedFor) untrack(discard);
      loadedFor = id;
      mediaList = [];
      mediaFor = null;
      pickerOpen = false;
    }
    if (id) refresh(id);
  });

  /** Put a picture in front of the engines, dropping the address of the one before. */
  function show(item) {
    if (selected?.src) URL.revokeObjectURL(selected.src);
    selected = item.blob ? { ...item, src: URL.createObjectURL(item.blob) } : item;
    resetAdjust();
  }

  function pickMedia(item) {
    show(item);
    pickerOpen = false;
  }

  // Arriving from another tool with the picture it was pressed on. Consumed once,
  // and only on this tab: the tool stays mounted after its first visit, so a
  // handoff written while it is hidden waits for the visit it was meant for.
  $effect(() => {
    const target = uiState.reverseTarget;
    if (uiState.tool !== 'reverse' || !target || !caseState.current) return;
    uiState.reverseTarget = null;
    untrack(() => {
      pickerOpen = false;
      show(target);
    });
  });

  /** A video handed over at a moment opens there, ready to be copied or nudged. */
  function seekToTarget() {
    if (!videoEl || selected?.time == null) return;
    videoEl.currentTime = Math.min(selected.time, videoEl.duration || selected.time);
  }

  function discard() {
    if (selected?.src) URL.revokeObjectURL(selected.src);
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
  //
  // Which road a press takes is decided **before** anything is awaited: the
  // button is a real link, and a preventDefault that comes back after a promise
  // comes back too late to stop it.

  /** Put the PNG on the clipboard. `note` is the toast when it lands; a refusal
   *  is always reported, since both roads lean on the clipboard. */
  async function copyPng(pending, note) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pending })]);
      if (note) toast(note, 'ok', 4500);
      return true;
    } catch (e) {
      toast(e.message || 'Could not copy the image', 'warn');
      return false;
    }
  }

  function savePng(blob, note) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = downloadName();
    a.click();
    URL.revokeObjectURL(a.href);
    toast(note, 'ok', 4500);
  }

  async function copySelection() {
    await copyPng(pngBlob(), `Copied the ${frameLabel}. Paste it in the tab with Ctrl+V`);
  }

  async function saveSelection() {
    try {
      savePng(await pngBlob(), `Saved the ${frameLabel}. Drag it into the tab`);
    } catch (e) {
      toast(e.message || 'Could not save the image', 'warn');
    }
  }

  /** Base64 of a blob: a message carries no blob, so the bytes cross as a string
   *  and the extension rebuilds the file inside the engine's page. */
  async function base64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    const CHUNK = 0x8000; // fromCharCode takes an argument list: chunk it or blow the stack
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  /**
   * Press an engine the extension can fill.
   *
   * The link was stopped, so the tab is the extension's to open and every
   * refusal has to open it here instead. The image goes on the clipboard first,
   * while this tab still has focus: it is what the extension's own notice
   * promises if the engine's page has moved on, and the encode is shared with
   * the hand-off rather than run a second time.
   */
  async function fillEngine(engine) {
    let blob;
    const pending = pngBlob();
    copyPng(pending);
    try {
      blob = await pending;
    } catch (e) {
      toast(e.message || 'Could not read the image', 'warn');
      return;
    }
    if (blob.size <= MAX_HANDOFF_BYTES) {
      try {
        await handOffReverse({
          url: engine.url,
          image: { name: downloadName(), type: 'image/png', data: await base64(blob) },
        });
        toast(`${engine.label} is opening with the ${frameLabel}.`, 'info', 4200);
        return;
      } catch {
        // Absent, switched off mid-press, not permitted on that site, silent:
        // one answer, one fallback. Nothing to explain that the toast below
        // does not say by doing the old thing.
      }
    }
    window.open(engine.url, '_blank', 'noopener,noreferrer');
    if (engine.paste) toast(`Opened ${engine.label}. Paste the ${frameLabel} with Ctrl+V`, 'info', 4500);
    else savePng(blob, `Opened ${engine.label}. Drag the saved ${frameLabel} in`);
  }

  /** The engine buttons' one handler. */
  function pressEngine(event, engine) {
    if (!filled.includes(engine)) {
      if (engine.paste) copySelection();
      else saveSelection();
      return;
    }
    event.preventDefault();
    fillEngine(engine);
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

{#snippet engineLinks()}
  <div class="direct">
    <span class="eg-head">Or open an engine and drag any file in</span>
    <div class="engine-links">
      {#each UPLOAD_PAGES as e (e.id)}
        <a href={e.url} target="_blank" rel="noreferrer" class="engine-link">
          {e.label} <Icon name="external" size={12} />
        </a>
      {/each}
    </div>
  </div>
{/snippet}

<div class="tool">
  {#if selected}
    <div class="tool-header">
      <span class="file">
        <Icon name={selected.kind === 'video' ? 'video' : 'image'} size={14} />
        <span class="name" title={selected.path}>{nameOf(selected)}</span>
      </span>
      <div class="spacer"></div>
      <button class="btn btn-sm" onclick={() => (pickerOpen = true)} title="Pick another image or video">
        <Icon name="folderOpen" size={14} /> Change file
      </button>
      <button class="btn btn-ghost btn-sm" onclick={discard} title="Back to the file list" aria-label="Close file">
        <Icon name="x" size={15} />
      </button>
    </div>
  {/if}

  {#if !selected}
    {#if !caseState.current}
      <div class="empty">
        <Icon name="search" size={40} />
        <p>Open a case to pick one of its pictures.</p>
        {@render engineLinks()}
      </div>
    {:else if listed && searchableMedia.length === 0}
      <div class="empty">
        <Icon name="search" size={40} />
        <p>Add an image or a video to the case to search it.</p>
        <button class="btn" onclick={() => (uiState.tool = 'media')}>Go to Media Library</button>
        {@render engineLinks()}
      </div>
    {:else}
      <div class="start">
        <div class="start-col">
          <div class="start-head">
            <div>
              <h3>Pick a picture</h3>
              <p>A photo, or a video to take a frame from. Nothing is sent until you press an engine.</p>
            </div>
            {@render engineLinks()}
          </div>
          {#if listed}
            <SourcePicker media={searchableMedia} caseId={caseState.current.id} onpick={pickMedia} />
          {/if}
        </div>
      </div>
    {/if}
  {:else}
    <div class="tool-body">
      <div class="work">
        <div class="preview-col">
          <div class="preview card">
            {#if selected.kind === 'video'}
              <!-- svelte-ignore a11y_media_has_caption -->
              <video
                bind:this={videoEl}
                src={srcOf(selected)}
                controls
                preload="metadata"
                style="filter: {filterCss}"
                onloadedmetadata={seekToTarget}
              ></video>
            {:else}
              <img src={srcOf(selected)} alt={nameOf(selected)} style="filter: {filterCss}" />
            {/if}
          </div>
          {#if selected.kind === 'video'}
            <p class="hint">Scrub to the moment, then copy or save the frame.</p>
          {:else if selected.blob}
            <p class="hint">This {frameLabel} is not saved in the case.</p>
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
            {#if filled.length}
              <div class="eg-group">
                <span class="eg-head">Opens with the {frameLabel} in it</span>
                <div class="eg-list">
                  {#each filled as e (e.id)}
                    <a
                      href={e.url}
                      target="_blank"
                      rel="noreferrer"
                      class="btn engine-btn"
                      onclick={(event) => pressEngine(event, e)}
                    >
                      <Icon name="search" size={14} /> {e.label}
                    </a>
                  {/each}
                </div>
              </div>
            {/if}
            {#if pasteLeft.length}
              <div class="eg-group">
                <span class="eg-head">Copy, then paste (Ctrl+V) in the tab</span>
                <div class="eg-list">
                  {#each pasteLeft as e (e.id)}
                    <a
                      href={e.url}
                      target="_blank"
                      rel="noreferrer"
                      class="btn engine-btn"
                      onclick={(event) => pressEngine(event, e)}
                    >
                      <Icon name="copy" size={14} /> {e.label}
                    </a>
                  {/each}
                </div>
              </div>
            {/if}
            {#if dragLeft.length}
              <div class="eg-group">
                <span class="eg-head">Save, then drag the file into the tab</span>
                <div class="eg-list">
                  {#each dragLeft as e (e.id)}
                    <a
                      href={e.url}
                      target="_blank"
                      rel="noreferrer"
                      class="btn engine-btn"
                      onclick={(event) => pressEngine(event, e)}
                    >
                      <Icon name="download" size={14} /> {e.label}
                    </a>
                  {/each}
                </div>
              </div>
            {/if}
          </div>

          {#if selected.kind === 'video'}
            <button class="btn btn-ghost btn-sm inspect-link" onclick={openInInspect}>
              <Icon name="crop" size={13} /> Finer control in Inspect
            </button>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

{#if pickerOpen && listed}
  <Modal title="Pick a case image or video" width="720px" onclose={() => (pickerOpen = false)}>
    <SourcePicker media={searchableMedia} caseId={caseState.current.id} current={selected?.path} onpick={pickMedia} />
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

  /* the picture's header, laid out as Inspect's */
  .file {
    display: flex;
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
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .spacer {
    flex: 1;
  }

  /* landing: Inspect's file list, with the engines' own pages beside it. The
     whole panel scrolls and the column sits centred in it, so the wheel works
     over the margins and the scrollbar stays on the edge. */
  .empty {
    flex: 1;
  }
  .start {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .start-col {
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-width: 1240px;
    margin: 0 auto;
    padding: 24px 20px;
  }
  .start-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px 24px;
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
  .direct {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .direct .eg-head {
    margin-bottom: 0;
  }
  .empty .direct {
    align-items: center;
    width: 100%;
    max-width: 360px;
    margin-top: 22px;
    padding-top: 20px;
    border-top: 1px solid var(--border);
  }
  .engine-links {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
  }
  .empty .engine-links {
    justify-content: center;
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
  .preview {
    overflow: hidden;
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
</style>
