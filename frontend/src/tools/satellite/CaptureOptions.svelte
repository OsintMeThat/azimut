<script>
  import Icon from '../../components/Icon.svelte';
  import { SIZE_MIN, SIZE_MAX, clampSize } from '../../lib/captureSize.js';
  import { extensionVersion } from '../../lib/extBridge.js';

  let {
    menuEl = $bindable(),
    menuOpen = $bindable(),
    mode = $bindable(),
    hover = $bindable(),
    selectArmed,
    capturing,
    blocked,
    widgetBase,
    runCapture,
    ratios,
    ratio = $bindable(),
    presets,
    preset = $bindable(),
    customWidth = $bindable(),
    customHeight = $bindable(),
    resolution = $bindable(),
    scaleNorth = $bindable(),
    openScreenshot,
    openExtensionGate,
  } = $props();
</script>

<div class="capture-split" role="group">
  <button
    class="btn btn-primary capture-main"
    class:on={mode === 'select' && selectArmed}
    onmouseenter={() => (hover = mode === 'center')}
    onmouseleave={() => (hover = false)}
    onfocusin={() => (hover = mode === 'center')}
    onfocusout={() => (hover = false)}
    onclick={runCapture}
    disabled={capturing || blocked}
    title={blocked
      ? 'This basemap is view-only'
      : mode === 'select'
        ? `Draw a rectangle on the map to capture exactly that area${widgetBase ? ' (grabbed from the screen)' : ''}`
        : `Capture the centred preset size${widgetBase ? ' (grabbed from the screen)' : ''}`}
  >
    {#if capturing}
      <span class="spinner"></span> Capturing…
    {:else if mode === 'select'}
      <Icon name="crop" size={14} /> {selectArmed ? 'Draw box…' : 'Select area'}
    {:else}
      <Icon name="satellite" size={15} /> Capture
    {/if}
  </button>

  <div class="size-menu-wrap" bind:this={menuEl}>
    <button
      class="btn btn-icon capture-arrow"
      class:on={menuOpen}
      onclick={() => (menuOpen = !menuOpen)}
      title={widgetBase ? 'Capture mode, size & ratio' : 'Capture mode, size, ratio & resolution'}
      aria-label="Capture options"
    >
      <Icon name="chevronDown" size={13} />
    </button>
    {#if menuOpen}
      <div class="size-menu card">
        <div class="menu-row">
          <span class="menu-label">Mode</span>
          <div class="chips">
            <button class="chip" class:on={mode === 'center'} onclick={() => (mode = 'center')}>Capture</button>
            <button class="chip" class:on={mode === 'select'} onclick={() => (mode = 'select')}>Select area</button>
          </div>
        </div>
        <div class="menu-hint">
          {mode === 'center' ? 'Captures the centred size below.' : 'Drag a box on the map to capture exactly it.'}
        </div>

        {#if mode === 'select'}
          <div class="menu-row">
            <span class="menu-label">Ratio</span>
            <div class="chips">
              {#each ratios as entry (entry.id)}
                <button class="chip" class:on={ratio === entry.id} onclick={() => (ratio = entry.id)}>
                  {entry.label}
                </button>
              {/each}
            </div>
          </div>
          <div class="menu-hint">Locks the dragged box's shape.</div>
        {:else}
          <div class="menu-row">
            <span class="menu-label">Size</span>
            <div class="chips">
              {#each presets as entry (entry.id)}
                <button class="chip" class:on={preset === entry.id} onclick={() => (preset = entry.id)}>
                  {entry.label}
                </button>
              {/each}
            </div>
          </div>
          {#if preset === 'custom'}
            <div class="custom-size" title="Custom crop size ({SIZE_MIN}–{SIZE_MAX} px)">
              <input
                class="input size-input"
                type="number"
                min={SIZE_MIN}
                max={SIZE_MAX}
                bind:value={customWidth}
                onblur={() => (customWidth = clampSize(customWidth))}
                aria-label="Crop width"
              />
              <span>×</span>
              <input
                class="input size-input"
                type="number"
                min={SIZE_MIN}
                max={SIZE_MAX}
                bind:value={customHeight}
                onblur={() => (customHeight = clampSize(customHeight))}
                aria-label="Crop height"
              />
            </div>
          {/if}
        {/if}

        {#if widgetBase}
          <div class="menu-row">
            <span class="menu-label">Source</span>
            <div class="chips">
              {#if extensionVersion()}
                <button class="chip" onclick={() => { menuOpen = false; openScreenshot(); }}>
                  Paste a screenshot…
                </button>
              {:else}
                <button class="chip" onclick={() => { menuOpen = false; openExtensionGate(); }}>
                  Get the capture extension
                </button>
              {/if}
            </div>
          </div>
          <div class="menu-hint">
            {#if extensionVersion()}
              This basemap is captured from the screen (Google's terms allow nothing
              programmatic out of it), so the frame can't go past the map view and screen
              pixels are the ceiling.
            {:else}
              This basemap is captured from the screen, so filing it needs the capture
              extension (Google's terms allow nothing programmatic out).
            {/if}
          </div>
        {:else}
          <div class="menu-row">
            <span class="menu-label">Resolution</span>
            <div class="chips">
              <button class="chip" class:on={resolution === 1} onclick={() => (resolution = 1)}>1×</button>
              <button class="chip" class:on={resolution === 2} onclick={() => (resolution = 2)}>2×</button>
              <button class="chip" class:on={resolution === 'max'} onclick={() => (resolution = 'max')}>Max</button>
            </div>
          </div>
          <div class="menu-hint">Captures a deeper zoom for a sharper file.</div>
        {/if}

        <label class="menu-check">
          <input type="checkbox" bind:checked={scaleNorth} />
          <span>Scale bar & north arrow</span>
        </label>
        <div class="menu-hint last">Drawn into the capture, in your units.</div>
      </div>
    {/if}
  </div>
</div>

<style>
  .capture-split { display: flex; align-items: stretch; }
  .capture-main { border-top-right-radius: 0; border-bottom-right-radius: 0; }
  .capture-arrow {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    background: var(--accent);
    border-color: transparent;
    border-left: 1px solid rgba(0, 0, 0, 0.2);
    color: var(--accent-text);
  }
  .capture-arrow:hover:not(:disabled), .size-menu-wrap .capture-arrow.on { background: var(--accent-hover); }
  .capture-main.on { box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.5); }
  .spinner {
    width: 13px;
    height: 13px;
    border: 2px solid var(--accent-text);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .custom-size {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .size-input { width: 64px; padding: 5px 6px; font-size: var(--fs-xs); text-align: center; }
  .btn-icon { padding: 6px 8px; }
  .btn-icon.on { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
  .size-menu-wrap { position: relative; display: flex; }
  .size-menu {
    position: absolute;
    bottom: calc(100% + 8px);
    right: 0;
    width: max-content;
    max-width: 280px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px;
    background: rgba(24, 24, 24, 0.96);
    backdrop-filter: blur(6px);
    box-shadow: var(--shadow-2);
    z-index: 700;
  }
  .menu-row { display: flex; align-items: center; gap: 10px; justify-content: space-between; }
  .menu-label { font-size: var(--fs-xs); color: var(--text-3); font-weight: 600; }
  .chips { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
  .chip {
    padding: 4px 9px;
    border-radius: var(--r-sm);
    border: 1px solid var(--border);
    background: var(--bg-2);
    color: var(--text-2);
    font-size: var(--fs-xs);
    white-space: nowrap;
    cursor: pointer;
    transition: border-color 0.12s, color 0.12s, background 0.12s;
  }
  .chip:hover { border-color: var(--border-strong); color: var(--text-1); }
  .chip.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
  .menu-hint { font-size: 10px; color: var(--text-3); margin: -1px 0 5px; }
  .menu-hint.last { margin-bottom: 0; }
  /* The one setting here that outlives the session, so it reads as a switch
     rather than as one more chip to pick from. */
  .menu-check {
    display: flex;
    align-items: center;
    gap: 7px;
    padding-top: 7px;
    border-top: 1px solid var(--border);
    font-size: var(--fs-xs);
    color: var(--text-2);
    cursor: pointer;
  }
  .menu-check input { accent-color: var(--accent); cursor: pointer; }
  .menu-row + .custom-size { justify-content: flex-end; padding: 2px 0; }
</style>
