<script>
  /**
   * Difference mode's own column. It reads the pixels the two maps are showing
   * right now, so everything here is about *this view*, and nothing is saved.
   * Detect mode, next to it in the dock, freezes an area and keeps what it found.
   *
   * The reading follows the camera by itself, always. What it never does on a
   * pan is spend a request: a method that reads Sentinel-2 bands — a spectral
   * index, or the cloud filter over the picture methods — runs on the frames it
   * holds, and waits for Run once the camera leaves the ground they cover.
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
    onclose = () => {},
  } = $props();

  let tab = $state('detection');
  const runnable = $derived(status.ok && status.methods.includes(settings.method));
  // What this reading has to fetch, and therefore whether it can follow the map.
  const frames = $derived(changeNeedsFrames(settings, status));
  const index = $derived(CHANGE_INDICES.find((entry) => entry.id === settings.index));
</script>

<aside class="cmp-dock" aria-label="Difference">
  <header>
    <strong>Difference</strong>
    <button
      class="cmp-icon"
      class:on={settings.blink}
      disabled={!settings.visible}
      onclick={() => (settings = { ...settings, blink: !settings.blink })}
      aria-label={settings.blink ? 'Stop blinking the highlights' : 'Blink the highlights'}
      aria-pressed={settings.blink}
      title="Blink the highlights on and off, which is easier to catch over busy imagery"
    >
      <Icon name="blink" size={15} />
    </button>
    <button
      class="cmp-icon"
      class:on={settings.visible}
      onclick={() => (settings = { ...settings, visible: !settings.visible })}
      aria-label={settings.visible ? 'Hide the difference overlay' : 'Show the difference overlay'}
      aria-pressed={settings.visible}
      title={settings.visible ? 'Hide the overlay' : 'Show the overlay'}
    >
      <Icon name={settings.visible ? 'eye' : 'eyeOff'} size={15} />
    </button>
    <button class="cmp-icon" onclick={onclose} aria-label="Leave Difference mode" title="Back to side by side">
      <Icon name="x" size={14} />
    </button>
  </header>
  <p class="cmp-dock-lead">
    Reads this view, and keeps nothing. Detect sweeps a fixed area at full resolution.
  </p>

  <div class="cmp-dock-body">
    {#if !status.ok}
      <p class="warn">{status.reason}</p>
    {/if}
    {#each status.notes ?? [] as note}<p class="hint">{note}</p>{/each}
    {#if error}<p class="warn" role="alert">{error}</p>{/if}

    {#if result}
      <div class="readout" class:stale>
        <strong>{Math.round(result.share * 100)}%</strong>
        <span>of the overlap highlighted</span>
        <small>{Math.round(result.coverage * 100)}% coverage · {Math.round(result.area)} m²</small>
        {#if stale}<small class="warn">Out of date. Run again to match this view.</small>{/if}
      </div>
    {/if}

    <div class="field">
      <span class="field-name">Highlights over</span>
      <div class="cmp-seg fill" aria-label="Image under the highlights">
        {#each CHANGE_BASES as entry}
          <button class:on={settings.base === entry.id} aria-pressed={settings.base === entry.id}
            onclick={() => (settings = { ...settings, base: entry.id })}>{entry.label}</button>
        {/each}
      </div>
      <p class="hint">
        {settings.base === 'side' ? 'Both images, the same highlights on each.'
          : `Image ${settings.base.toUpperCase()} alone, under the highlights.`}
      </p>
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
        Reads Sentinel-2 bands, one request a side. They are kept with a margin around
        this view: following the map costs nothing inside it, and waits for Run past it.
      </p>
    {/if}

    <div class="settings-tabs" role="tablist" aria-label="Difference parameters">
      {#each [['detection', 'Detection'], ['display', 'Display'], ['filters', 'Filters']] as [id, label]}
        <button role="tab" aria-selected={tab === id} class:on={tab === id} onclick={() => (tab = id)}>{label}</button>
      {/each}
    </div>

    {#if tab === 'detection'}
      <label title="Colour compares appearance; structure compares edges; index compares Sentinel-2 spectral bands.">Method
        <select aria-label="Method" bind:value={settings.method}>
          {#each CHANGE_METHODS as method}<option value={method.id} disabled={!status.methods.includes(method.id)}>{method.label}</option>{/each}
        </select>
      </label>
      {#if settings.method === 'index'}
        <label title="Select the spectral quantity to compare between the two passes.">Index
          <select bind:value={settings.index}>{#each CHANGE_INDICES as entry}<option value={entry.id}>{entry.label} · {entry.hint}</option>{/each}</select>
        </label>
      {:else}
        <label title="Automatic adapts to this view; manual keeps a sensitivity-based threshold.">Threshold
          <select bind:value={settings.threshold}><option value="auto">Automatic</option><option value="manual">Manual</option></select>
        </label>
      {/if}
      <label title="Higher values show weaker differences and more noise.">Sensitivity · {settings.sensitivity}
        <input aria-label="Change sensitivity" type="range" min="0" max="100" bind:value={settings.sensitivity} />
      </label>
      {#if settings.method === 'index'}
        <p class="hint">Highlights {index?.label} moved by {indexThreshold(settings.sensitivity).toFixed(2)} or more, the line Detect draws.</p>
      {/if}
      <button class="btn btn-sm" onclick={() => (settings = { ...settings, normalize: 'none', smoothing: 0, cleanup: 0, alignment: 0, threshold: 'manual', sensitivity: 90 })}>
        Preserve fine changes
      </button>
    {/if}

    {#if tab === 'display'}
      <label title="Show the detected pixels as classes, a signal heatmap or outlines.">Display
        <select bind:value={settings.display}>{#each CHANGE_DISPLAYS as display}<option value={display.id}>{display.label}</option>{/each}</select>
      </label>
      <label title="Change only the overlay colours; Thermal is a palette, not a thermal sensor.">Palette
        <select bind:value={settings.palette}><option value="directional">Directional</option><option value="colourblind">Colour-blind</option><option value="thermal">Thermal</option></select>
      </label>
      <div class="classes">{#each CHANGE_CLASSES as entry}<label class="check"><input type="checkbox" bind:group={settings.classes} value={entry} /> {entry}</label>{/each}</div>
      <label title="Fade the result overlay to inspect the imagery beneath it.">Overlay · {settings.opacity}%
        <input aria-label="Change overlay opacity" type="range" min="0" max="100" bind:value={settings.opacity} />
      </label>
    {/if}

    {#if tab === 'filters'}
      <label title="Reduce exposure differences; this may suppress broad real changes.">Tone matching
        <select bind:value={settings.normalize}>
          <option value="auto">Automatic</option><option value="none">None</option>
          <option value="mean">Mean brightness</option><option value="histogram">Histogram</option>
        </select>
      </label>
      {#if settings.normalize === 'auto'}
        <p class="hint">
          {status.family === 'sentinel2'
            ? 'Nothing to match: both passes are corrected to surface reflectance.'
            : 'Histogram, because two releases carry two renderings.'}
        </p>
      {/if}
      <label title="Search for a small image offset before comparing pixels.">Alignment · ±{settings.alignment}px<input type="range" min="0" max="8" bind:value={settings.alignment} /></label>
      <label title="Reduce pixel noise before thresholding; zero preserves small details.">Smoothing · {settings.smoothing}px<input type="range" min="0" max="4" bind:value={settings.smoothing} /></label>
      <label title="Remove isolated speckles; larger settings can also remove small real changes.">Cleanup · {settings.cleanup}<input type="range" min="0" max="3" bind:value={settings.cleanup} /></label>
      <label title="Discard connected regions below this ground area.">Minimum area (m²)<input type="number" min="0" max="1000000" bind:value={settings.min_area} /></label>
      {#if status.clouds}
        <label class="check" title="Exclude cloud, read from Sentinel-2's scene classification."><input type="checkbox" bind:checked={settings.ignore_clouds} /> Mask clouds</label>
        <label class="check" title="Exclude the shadow cloud casts, which moves with the sun."><input type="checkbox" bind:checked={settings.ignore_shadows} /> Mask shadows</label>
        <label title="Grow the cloud and shadow mask, to take the soft edge a mask leaves behind.">Mask margin · {settings.cloud_margin} m<input aria-label="Cloud mask margin" type="range" min="0" max="200" step="10" bind:value={settings.cloud_margin} /></label>
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

  <div class="cmp-dock-foot">
    <button class="btn btn-primary" disabled={busy || !runnable} onclick={() => onrun()}>
      {busy ? 'Reading…' : 'Read this view'}
    </button>
    {#if !runnable}
      <span class="reason">{status.ok ? 'This method needs another imagery source.' : status.reason}</span>
    {:else if stale && result}
      <span class="reason warn">These highlights are from an earlier read.</span>
    {/if}
  </div>
</aside>

<style>
  .readout {
    display: grid;
    gap: 2px;
    padding: 9px 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
  }
  .readout strong { font-size: var(--fs-lg); color: var(--accent); }
  .readout span { font-size: var(--fs-xs); color: var(--text-2); }
  .readout small { font-size: 10.5px; color: var(--text-3); }
  .readout.stale { opacity: 0.7; }
  .field { display: grid; gap: 5px; }
  .field-name { color: var(--text-2); font-size: var(--fs-xs); }
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
