<script>
  /**
   * The manual way in, for when the Capture button's extension grab can't be
   * used or the screenshot came from somewhere else entirely.
   *
   * A pasted image is not registered to any frame: its coordinates are the map
   * view at filing time, and provenance says so (`framed: false`). That is the
   * whole reason this is a separate action rather than a fallback the Capture
   * button drops into — an unregistered picture must never inherit a registered
   * frame's provenance.
   */
  import Icon from '../../components/Icon.svelte';
  import Modal from '../../components/Modal.svelte';

  let {
    /** `{ lat, lon, zoom }` the map is on, which is what a pasted image is filed at. */
    view,
    /** Format the readout the way the analyst set it (Settings → General). */
    fmtCoords,
    /** Grab the whole map view through the extension. Returns the blob, or null. */
    grab,
    /** File `blob` as a capture at the current view. */
    file,
    onclose,
  } = $props();

  let blob = $state(null);
  let preview = $state(''); // object URL for the <img>
  let busy = $state(false);
  let grabbing = $state(false);

  function reset() {
    if (preview) URL.revokeObjectURL(preview);
    blob = null;
    preview = '';
  }

  function take(candidate) {
    if (!candidate || !candidate.type?.startsWith('image/')) return;
    reset();
    blob = candidate;
    preview = URL.createObjectURL(candidate);
  }

  function close() {
    reset();
    onclose();
  }

  function onPaste(event) {
    const item = [...(event.clipboardData?.items ?? [])].find((entry) =>
      entry.type.startsWith('image/')
    );
    if (item) {
      event.preventDefault();
      take(item.getAsFile());
    }
  }

  // paste works anywhere while the dialog is open — no need to focus a zone
  $effect(() => {
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  /**
   * One-click grab of the whole map view into the preview: the same extension
   * frame as a framed capture, minus the crop, at native resolution. The
   * preview is what lets the analyst judge it before filing.
   */
  async function onGrab() {
    if (grabbing) return;
    grabbing = true;
    try {
      const grabbed = await grab();
      if (grabbed) take(new File([grabbed], 'screenshot.png', { type: 'image/png' }));
    } finally {
      grabbing = false;
    }
  }

  async function save() {
    if (!blob || busy) return;
    busy = true;
    try {
      if (await file(blob)) close();
    } finally {
      busy = false;
    }
  }
</script>

{#if !grabbing}
  <Modal title="File a screenshot" onclose={close} width="520px">
    <p class="shot-hint">
      The <strong>Capture</strong> button already crops this basemap off the screen
      through the usual frame. Use this when it can't:
      grab the whole map view below, or paste
      (<span class="mono">Ctrl+V</span>) / drop your own OS screenshot.
      Unlike a framed capture, this is filed at the current <em>view</em>
      (<span class="mono">{fmtCoords(view.lat, view.lon)}</span>, z{view.zoom}).
      the coordinates describe the map, not a registered crop. The Google attribution
      is burned into a footer either way; keep Google's on-screen credits inside the
      frame too.
    </p>
    <div style="display:flex;justify-content:center;margin-bottom:10px">
      <button class="btn btn-primary" onclick={onGrab} disabled={grabbing}>
        {#if grabbing}<span class="spinner"></span> Grabbing…{:else}
          <Icon name="satellite" size={14} /> Capture the view{/if}
      </button>
    </div>
    <div
      class="shot-zone"
      class:has-image={!!preview}
      role="button"
      tabindex="0"
      ondrop={(event) => {
        event.preventDefault();
        take(event.dataTransfer?.files?.[0]);
      }}
      ondragover={(event) => event.preventDefault()}
    >
      {#if preview}
        <img src={preview} alt="screenshot to file" />
      {:else}
        <span>Paste (Ctrl+V) or drop the screenshot here</span>
      {/if}
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      {#if preview}
        <button class="btn" onclick={reset}>Clear</button>
      {/if}
      <button class="btn" onclick={close}>Cancel</button>
      <button class="btn btn-primary" onclick={save} disabled={!blob || busy}>
        {busy ? 'Filing…' : 'File as capture'}
      </button>
    </div>
  </Modal>
{/if}

<style>
  .shot-hint {
    font-size: var(--fs-sm);
    color: var(--text-2);
    margin: 0 0 12px;
  }
  .shot-zone {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 180px;
    border: 1px dashed var(--border);
    border-radius: 6px;
    color: var(--text-3);
    font-size: var(--fs-sm);
    overflow: hidden;
  }
  .shot-zone.has-image {
    border-style: solid;
  }
  .shot-zone img {
    max-width: 100%;
    max-height: 320px;
    display: block;
  }
</style>
