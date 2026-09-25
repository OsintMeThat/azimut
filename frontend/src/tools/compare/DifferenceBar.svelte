<script>
  /**
   * Difference's controls, in the stage footer beside the view's own. The
   * highlights lie over whichever view is on, so nothing here moves the maps;
   * the full settings open above the strip only when asked for.
   *
   * The strip keeps one width whatever the reading is doing, since the panel
   * hangs from its edge: a label that grew on every read moved the panel under
   * the pointer. What a read is doing is said in the panel and the map legend.
   *
   * The reading follows the camera by itself. What it never does on a pan is
   * spend a request: a method that reads Sentinel-2 bands runs on the frames it
   * holds, and waits for Read once the camera leaves the ground they cover.
   */
  import { CHANGE_BASES, CHANGE_METHODS, CHANGE_INDICES, CHANGE_DISPLAYS, CHANGE_CLASSES,
    changeNeedsFrames, changeSettings, indexThreshold } from '../../lib/map/changeAssist.js';
  import CloudFilter from './CloudFilter.svelte';
  import Icon from '../../components/Icon.svelte';

  let {
    settings = $bindable(),
    status,
    result = null,
    busy = false,
    error = '',
    stale = false,
    onrun = () => {},
    onzone = () => {},
    /** Keep this index reading as a Detect analyzer, to sweep areas with it. */
    onanalyzer = () => {},
  } = $props();

  let open = $state(false);
  let tab = $state('detection');
  const runnable = $derived(status.ok && status.methods.includes(settings.method));
  // What this reading has to fetch, and therefore whether it can follow the map.
  const frames = $derived(changeNeedsFrames(settings, status));
  const index = $derived(CHANGE_INDICES.find((entry) => entry.id === settings.index));

  // A press anywhere off the strip and its panel closes the panel. The strip
  // counts as inside: Read or a base pressed with the settings open is tuning
  // them, and the gear would otherwise close it on the way down and reopen it.
  let barEl = $state();
  $effect(() => {
    if (!open) return;
    const key = (event) => {
      if (event.key === 'Escape') open = false;
    };
    const outside = (event) => {
      if (barEl?.contains(event.target)) return;
      open = false;
    };
    window.addEventListener('keydown', key);
    document.addEventListener('pointerdown', outside, true);
    return () => {
      window.removeEventListener('keydown', key);
      document.removeEventListener('pointerdown', outside, true);
    };
  });
</script>

<div class="difference-bar cmp-glass" aria-label="Difference" bind:this={barEl}>
  <span class="name">Difference</span>
  <div class="cmp-seg" aria-label="Image under the highlights">
    {#each CHANGE_BASES as entry}
      <button class:on={settings.base === entry.id} aria-pressed={settings.base === entry.id}
        title={entry.id === 'both' ? 'Highlights on both images' : `Highlights on image ${entry.label} only`}
        onclick={() => (settings = { ...settings, base: entry.id })}>{entry.label}</button>
    {/each}
  </div>
  <button
    class="cmp-icon"
    class:on={settings.blink}
    onclick={() => (settings = { ...settings, blink: !settings.blink })}
    aria-label={settings.blink ? 'Stop blinking the highlights' : 'Blink the highlights'}
    aria-pressed={settings.blink}
    title="Blink the highlights, easier to catch over busy imagery"
  >
    <Icon name="blink" size={15} />
  </button>
  <button class="text-btn read" class:busy disabled={busy || !runnable} onclick={() => onrun()}
    title={runnable ? 'Read the pixels in this view again' : (status.ok ? 'This method needs another imagery source' : status.reason)}>
    {busy ? 'Reading…' : 'Read'}
  </button>
  <button
    class="cmp-icon"
    class:on={open}
    aria-expanded={open}
    aria-label="Difference settings"
    title="Difference settings"
    onclick={() => (open = !open)}
  >
    <Icon name="settings" size={15} />
  </button>

  {#if open}
    <aside class="cmp-dock settings" aria-label="Difference settings">
      <header>
        <strong>Difference settings</strong>
        <button class="cmp-icon" onclick={() => (open = false)} aria-label="Close the settings" title="Close">
          <Icon name="x" size={14} />
        </button>
      </header>
      <div class="cmp-dock-body">
        {#each status.notes ?? [] as note}<p class="hint">{note}</p>{/each}

        <!-- One box whatever the reading is doing, so a read never reflows the panel. -->
        <div class="readout" class:stale={stale || busy} aria-live="polite">
          {#if error}
            <strong class="warn">No reading</strong>
            <span role="alert">{error}</span>
          {:else if result}
            <strong>{Math.round(result.share * 100)}%</strong>
            <span>of the overlap highlighted</span>
          {:else}
            <strong class="dim">–</strong>
            <span>{busy ? 'Reading this view' : 'Not read yet'}</span>
          {/if}
          <small>
            {#if busy}Reading…{:else if stale && result}From an earlier read{:else if result}{Math.round(result.coverage * 100)}% coverage · {Math.round(result.area)} m²{:else}&nbsp;{/if}
          </small>
        </div>

        {#if status.clouds}
          <CloudFilter
            clouds={settings.ignore_clouds}
            shadows={settings.ignore_shadows}
            ontoggle={(on) => {
              settings = { ...settings, ignore_clouds: on, ignore_shadows: on };
              // The click is the act that asks for the sky, so the reading follows
              // it rather than leaving an unfiltered mask up behind an "on" switch.
              queueMicrotask(() => onrun());
            }}
          />
        {/if}

        {#if frames}
          <p class="hint">
            Reads Sentinel-2 bands, one request a side, kept with a margin around this view.
            Panning inside it costs nothing; past it, press Read.
          </p>
        {/if}

        <div class="settings-tabs" role="tablist" aria-label="Difference parameters">
          {#each [['detection', 'Detection'], ['display', 'Display'], ['filters', 'Filters']] as [id, label]}
            <button role="tab" aria-selected={tab === id} class:on={tab === id} onclick={() => (tab = id)}>{label}</button>
          {/each}
        </div>

        {#if tab === 'detection'}
          <label title="What to compare: colour, edges or a spectral index.">Method
            <select aria-label="Method" bind:value={settings.method}>
              {#each CHANGE_METHODS as method}<option value={method.id} disabled={!status.methods.includes(method.id)}>{method.label}</option>{/each}
            </select>
          </label>
          {#if settings.method === 'index'}
            <label title="The spectral index compared between the two passes.">Index
              <select bind:value={settings.index}>{#each CHANGE_INDICES as entry}<option value={entry.id}>{entry.label} · {entry.hint}</option>{/each}</select>
            </label>
          {:else}
            <label title="Adapt the threshold to this view, or follow the sensitivity.">Threshold
              <select bind:value={settings.threshold}><option value="auto">Automatic</option><option value="manual">Manual</option></select>
            </label>
          {/if}
          <label title="Higher values show weaker differences and more noise.">Sensitivity · {settings.sensitivity}
            <input aria-label="Change sensitivity" type="range" min="0" max="100" bind:value={settings.sensitivity} />
          </label>
          {#if settings.method === 'index'}
            <p class="hint">Highlights {index?.label} moved by {indexThreshold(settings.sensitivity).toFixed(2)} or more.</p>
            <button class="btn btn-sm" title="Sweep areas or run a routine with this reading in Detect"
              onclick={() => onanalyzer()}>Save as a Detect analyzer</button>
          {/if}
          <button class="btn btn-sm" onclick={() => (settings = { ...settings, normalize: 'none', smoothing: 0, cleanup: 0, alignment: 0, threshold: 'manual', sensitivity: 90 })}>
            Preserve fine changes
          </button>
        {/if}

        {#if tab === 'display'}
          <label title="Draw the change as classes, a signal heatmap or outlines.">Display
            <select bind:value={settings.display}>{#each CHANGE_DISPLAYS as display}<option value={display.id}>{display.label}</option>{/each}</select>
          </label>
          <label title="Overlay colours only, none of them a sensor reading.">Palette
            <select bind:value={settings.palette}><option value="directional">Directional</option><option value="colourblind">Colour-blind</option><option value="thermal">Thermal</option></select>
          </label>
          <div class="classes">{#each CHANGE_CLASSES as entry}<label class="check"><input type="checkbox" bind:group={settings.classes} value={entry} /> {entry}</label>{/each}</div>
          <label title="Fade the highlights to inspect the imagery beneath them.">Overlay · {settings.opacity}%
            <input aria-label="Change overlay opacity" type="range" min="0" max="100" bind:value={settings.opacity} />
          </label>
        {/if}

        {#if tab === 'filters'}
          <label title="Even out exposure, at the risk of hiding a broad change.">Tone matching
            <select bind:value={settings.normalize}>
              <option value="auto">Automatic</option><option value="none">None</option>
              <option value="mean">Mean brightness</option><option value="histogram">Histogram</option>
            </select>
          </label>
          {#if settings.normalize === 'auto'}
            <p class="hint">
              {status.family === 'sentinel2'
                ? 'Nothing to match: both passes are corrected to surface reflectance.'
                : status.family === 'sentinel1'
                  ? 'Nothing to match: both passes are calibrated backscatter.'
                  : 'Histogram, because two releases carry two renderings.'}
            </p>
          {/if}
          <label title="Search for a small image offset before comparing pixels.">Alignment · ±{settings.alignment}px<input type="range" min="0" max="8" bind:value={settings.alignment} /></label>
          <label title="Reduce pixel noise before thresholding.">Smoothing · {settings.smoothing}px<input type="range" min="0" max="4" bind:value={settings.smoothing} /></label>
          <label title="Remove isolated speckles.">Cleanup · {settings.cleanup}<input type="range" min="0" max="3" bind:value={settings.cleanup} /></label>
          <label title="Discard connected regions below this ground area.">Minimum area (m²)<input type="number" min="0" max="1000000" bind:value={settings.min_area} /></label>
          {#if status.clouds}
            <label class="check" title="Exclude cloud, read from Sentinel-2's scene classification."><input type="checkbox" bind:checked={settings.ignore_clouds} /> Mask clouds</label>
            <label class="check" title="Exclude the shadow cloud casts, which moves with the sun."><input type="checkbox" bind:checked={settings.ignore_shadows} /> Mask shadows</label>
            <label title="Grow the mask over the soft edge a cloud leaves.">Mask margin · {settings.cloud_margin} m<input aria-label="Cloud mask margin" type="range" min="0" max="200" step="10" bind:value={settings.cloud_margin} /></label>
          {/if}
          <label class="check"><input type="checkbox" bind:checked={settings.zones} /> List change zones</label>
          <button class="link" onclick={() => (settings = changeSettings())}>Reset settings</button>
        {/if}

        {#if result && settings.zones}
          <section>
            <strong>{result.zoneCount} change zones{result.zoneCount > result.zones.length ? ` · largest ${result.zones.length}` : ''}</strong>
            <div class="zone-list">
              {#each result.zones as zone (zone.id)}
                <button onclick={() => onzone(zone)}>
                  <span class="zone-strength {zone.strength}">{zone.strength}</span>
                  Zone {zone.id} · {zone.kind} · {Math.round(zone.area)} m²
                </button>
              {/each}
            </div>
          </section>
        {/if}
      </div>
    </aside>
  {/if}
</div>

<style>
  .difference-bar {
    position: relative;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 42px;
    padding: 5px 6px 5px 10px;
  }
  .text-btn {
    padding: 4px 8px;
    border-radius: 6px;
    color: var(--glass-muted);
    font-size: 11.5px;
    font-weight: 600;
  }
  .text-btn:hover:not(:disabled) {
    color: var(--glass-ink);
    background: var(--glass-hover);
  }
  .text-btn:disabled { opacity: 0.4; }
  /* Wide enough for "Reading…", so the strip keeps its width through a read. */
  .text-btn.read { min-width: 70px; text-align: center; }
  .text-btn.read.busy:disabled { opacity: 0.75; }
  .name {
    font-size: var(--fs-xs);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--glass-dim);
  }
  /* Opened on request, over the stage: the maps keep their width. One height
     for every tab, so switching tabs or a zone list arriving never moves the
     header under the pointer. */
  .settings.cmp-dock {
    position: absolute;
    right: 0;
    bottom: calc(100% + 8px);
    z-index: 30;
    width: clamp(290px, 24vw, 360px);
    height: min(540px, 62vh);
    border: 1px solid var(--border);
    border-radius: var(--r-md, 8px);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
    overflow: hidden;
  }
  .readout {
    display: grid;
    gap: 2px;
    padding: 9px 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
  }
  .readout strong { font-size: var(--fs-lg); color: var(--accent); font-variant-numeric: tabular-nums; }
  .readout strong.warn { color: var(--warn); }
  .readout strong.dim { color: var(--text-3); }
  .readout span { overflow: hidden; font-size: var(--fs-xs); color: var(--text-2); text-overflow: ellipsis; white-space: nowrap; }
  .readout small { font-size: 10.5px; color: var(--text-3); }
  .readout.stale strong { opacity: 0.6; }
  .settings-tabs { display: flex; gap: 3px; border-bottom: 1px solid var(--border); }
  .settings-tabs button { flex: 1; padding: 7px 4px; color: var(--text-2); font-size: var(--fs-xs); }
  .settings-tabs button.on { color: var(--accent); border-bottom: 2px solid var(--accent); }
  .classes { display: flex; flex-wrap: wrap; gap: 10px; }
  section { display: grid; gap: 6px; border-top: 1px solid var(--border); padding-top: 10px; font-size: var(--fs-xs); }
  .zone-list { display: grid; gap: 4px; max-height: 170px; overflow: auto; }
  .zone-list button { padding: 5px; text-align: left; background: var(--bg-2); border-radius: var(--r-sm); font-size: 11px; }
  .zone-list button:hover { background: var(--bg-3); }
  .zone-strength { font-weight: 600; text-transform: capitalize; color: var(--text-2); }
  .zone-strength.strong { color: var(--accent); }
  .link { color: var(--accent); font-size: var(--fs-xs); text-align: left; }
</style>
