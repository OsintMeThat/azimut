<script>
  /**
   * Difference's settings, docked on the stage's right edge over map B. It lies
   * over the maps rather than narrowing them: a narrower view is a new view,
   * and a Sentinel-2 reading would fetch its bands again for a panel opening.
   *
   * It stays open while the map moves, since tuning is watching the highlights
   * answer; the gear, its close button or Escape put it away.
   */
  import { CHANGE_METHODS, CHANGE_INDICES, CHANGE_DISPLAYS, CHANGE_CLASSES,
    changeNeedsFrames, changeSettings, indexThreshold } from '../../lib/map/changeAssist.js';
  import CloudFilter from './CloudFilter.svelte';
  import Icon from '../../components/Icon.svelte';

  let {
    settings = $bindable(),
    status,
    result = null,
    /** due: Read has something to do · reading · tiles: waiting on the maps · current: nothing moved. */
    reading = 'due',
    error = '',
    onrun = () => {},
    onzone = () => {},
    /** Keep this index reading as a Detect analyzer, to sweep areas with it. */
    onanalyzer = () => {},
    onclose = () => {},
  } = $props();

  let tab = $state('detection');
  // What this reading has to fetch, and therefore whether it can follow the map.
  const frames = $derived(changeNeedsFrames(settings, status));
  const index = $derived(CHANGE_INDICES.find((entry) => entry.id === settings.index));
  const busy = $derived(reading === 'reading' || reading === 'tiles');
  const stale = $derived(!!result && reading === 'due');
  // Choosing what to read is asking for it, as the cloud switch is: the reading
  // runs then, bands included, rather than waiting on a second press of Read.
  const chosen = () => queueMicrotask(() => onrun());

  $effect(() => {
    const key = (event) => {
      if (event.key === 'Escape') onclose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
</script>

  <aside class="cmp-dock settings" aria-label="Difference settings">
    <header>
      <strong>Difference settings</strong>
      <button class="cmp-icon" onclick={() => onclose()} aria-label="Close the settings" title="Close">
        <Icon name="x" size={14} />
      </button>
    </header>
    <div class="cmp-dock-body">
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
      {#if status.notes?.length}
        <ul class="notes">{#each status.notes as note}<li>{note}</li>{/each}</ul>
      {/if}

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
        <p class="hint">Reads Sentinel-2 bands, one request a side, fetched again only past this view’s margin.</p>
      {/if}

      <div class="settings-tabs" role="tablist" aria-label="Difference parameters">
        {#each [['detection', 'Detection'], ['display', 'Display'], ['filters', 'Filters']] as [id, label]}
          <button role="tab" aria-selected={tab === id} class:on={tab === id} onclick={() => (tab = id)}>{label}</button>
        {/each}
      </div>

      {#if tab === 'detection'}
        <label title="What to compare: colour, edges or a spectral index.">Method
          <select aria-label="Method" bind:value={settings.method} onchange={chosen}>
            {#each CHANGE_METHODS as method}<option value={method.id} disabled={!status.methods.includes(method.id)}>{method.label}</option>{/each}
          </select>
        </label>
        {#if settings.method === 'index'}
          <label title="The spectral index compared between the two passes.">Index
            <select bind:value={settings.index} onchange={chosen}>{#each CHANGE_INDICES as entry}<option value={entry.id}>{entry.label} · {entry.hint}</option>{/each}</select>
          </label>
        {:else}
          <label title="Fit the threshold to this view, or set it by hand">Threshold
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
              ? 'None needed, both are surface reflectance.'
              : status.family === 'sentinel1'
                ? 'None needed, both are calibrated backscatter.'
                : 'Histogram, as two releases render differently.'}
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

<style>
  /* Inset like the chips around it, in the glass the map's floating panels
     share: near opaque so the form reads over busy imagery. It starts under
     the cards' row (8px, a 38px card, 8px), so B's card stays whole. One
     height for every tab, so switching tabs or a zone list arriving never
     moves the header under the pointer. */
  .settings.cmp-dock {
    position: absolute;
    top: 54px;
    right: 8px;
    bottom: 8px;
    z-index: 660;
    width: var(--difference-dock);
    border: 1px solid var(--border);
    border-radius: var(--r-md, 8px);
    background: color-mix(in srgb, var(--bg-1) 88%, transparent);
    backdrop-filter: blur(6px);
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
  /* What this pair can't prove, set under the reading as one quiet block. */
  .notes { display: grid; gap: 2px; margin: -8px 0 0; padding: 0; list-style: none; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.4; }
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
