<script>
  import Icon from '../../components/Icon.svelte';

  /** `s2` is the store from `state/sentinel.svelte.js`: what has been asked,
   *  what came back, and what is still in flight. The label helpers are pure
   *  (`lib/sentinel.js`) and are handed over so this stays a view. */
  let { menuEl = $bindable(), s2, maxccLabel, monthLabel, monthGrid, cloudClass, cloudLabel } =
    $props();

  // The readout tracks the drag; the ceiling only moves on release. Every step
  // in between would be a provider id of its own, and Sentinel-2 tiles are
  // billed — you pay for the number you stopped on, not the ones you passed.
  let dragging = $state(null);
  const shown = $derived(dragging ?? s2.maxcc);
</script>

<div class="s2-wrap" bind:this={menuEl}>
  <button
    class="btn btn-icon"
    class:on={s2.menuOpen}
    onclick={s2.toggleMenu}
    title="Sentinel-2 layer and date"
    aria-label="Sentinel-2 layer and date"
  ><Icon name="layers" size={14} /></button>
  {#if s2.menuOpen}
    <div class="s2-menu card">
      <div class="menu-row">
        <span class="menu-label">Layer</span>
        <select class="select" bind:value={s2.layer}>
          {#each s2.layers as entry (entry.id)}
            <option value={entry.id}>{entry.label}</option>
          {/each}
        </select>
      </div>
      {#if s2.layerHint}<div class="menu-hint">{s2.layerHint}</div>{/if}
      <div class="menu-hint dim">
        {s2.layersSource === 'instance'
          ? 'These layers come from your configuration.'
          : 'Could not read your configuration; showing the standard layers.'}
        <button class="linkish" onclick={() => s2.loadLayers(true)}>Refresh</button>
      </div>

      <div class="menu-sep" aria-hidden="true"></div>

      <div class="menu-row">
        <span class="menu-label">Cloud</span>
        <div class="cc">
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={shown}
            oninput={(e) => (dragging = Number(e.currentTarget.value))}
            onchange={(e) => {
              dragging = null;
              s2.setMaxcc(Number(e.currentTarget.value));
            }}
            aria-label="Maximum cloud cover"
          />
          <span class="cc-value mono">{maxccLabel(shown)}</span>
        </div>
      </div>
      <div class="menu-hint dim">
        Passes cloudier than this are not rendered, and drop out of the calendar.
      </div>

      <div class="menu-sep" aria-hidden="true"></div>

      <div class="menu-row">
        <span class="menu-label">Date</span>
        <div class="chips">
          <button class="chip" class:on={!s2.date} onclick={s2.clearDate}>Most recent</button>
        </div>
      </div>

      <div class="cal">
        <div class="cal-head">
          <button class="cal-nav" onclick={() => s2.stepMonth(-1)} aria-label="Previous month">
            <Icon name="chevronLeft" size={13} />
          </button>
          <span class="cal-month">{monthLabel(s2.month)}</span>
          <button class="cal-nav" onclick={() => s2.stepMonth(1)} aria-label="Next month">
            <Icon name="chevronRight" size={13} />
          </button>
        </div>
        <div class="cal-grid" class:busy={s2.passesBusy}>
          {#each ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as entry, index (index)}
            <span class="cal-dow" aria-hidden="true">{entry}</span>
          {/each}
          {#each monthGrid(s2.month) as day, index (day ?? `pad${index}`)}
            {#if !day}
              <span class="cal-pad" aria-hidden="true"></span>
            {:else}
              {@const pass = s2.passes[day]}
              {@const status = s2.dateStatus(day)}
              {@const overCeiling = s2.filtered(day)}
              {@const unavailable = status === false || overCeiling}
              {@const verifying = s2.verifyingDate === day}
              <button
                class="cal-day {pass ? cloudClass(pass.cloud) : ''}"
                class:has={!!pass}
                class:on={s2.date === day}
                class:unavailable
                class:verifying
                disabled={s2.date !== day &&
                  (!pass || s2.stale || s2.passesBusy || unavailable || !!s2.verifyingDate)}
                onclick={() => s2.pickDate(day)}
                title={overCeiling
                  ? `${day}: ${cloudLabel(pass.cloud)}, over the ${s2.maxcc}% ceiling`
                  : unavailable
                    ? `No imagery at the crosshair on ${day}`
                    : verifying
                      ? `Checking imagery for ${day}`
                      : s2.stale
                        ? `Refreshing dates for this location`
                        : pass
                          ? `${day}: ${cloudLabel(pass.cloud) || 'cloud cover unknown'}`
                          : `${day}: no Sentinel-2 pass`}
              >{Number(day.slice(8))}</button>
            {/if}
          {/each}
        </div>
      </div>

      {#if s2.passesBusy}
        <div class="menu-hint dim">Reading this month's passes…</div>
      {:else if s2.passesNote}
        <div class="menu-hint warn">{s2.passesNote}</div>
      {:else if s2.stale}
        <div class="menu-hint">
          <span class="warn">Refreshing dates for this location.</span>
          <button class="linkish" onclick={() => s2.loadPasses(true)}>Refresh</button>
        </div>
      {:else}
        <div class="menu-hint dim">
          Dates with a pass are checked at the crosshair before the map changes.
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .s2-wrap { position: relative; display: flex; }
  .s2-menu {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 0;
    width: max-content;
    max-width: 320px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px;
    background: rgba(24, 24, 24, 0.96);
    backdrop-filter: blur(6px);
    box-shadow: var(--shadow-2);
    z-index: 700;
  }
  .s2-menu .select { max-width: 190px; }
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
  .chip:hover { color: var(--text-1); border-color: var(--border-strong); }
  .chip.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
  .cc { display: flex; align-items: center; gap: 8px; }
  .cc input[type='range'] { width: 120px; accent-color: var(--accent); cursor: pointer; }
  .cc-value { font-size: 10px; color: var(--text-2); min-width: 58px; text-align: right; }
  .menu-hint { font-size: 10px; color: var(--text-3); margin: -1px 0 5px; }
  .menu-hint.dim { opacity: 0.75; }
  .menu-hint .warn, .menu-hint.warn { color: var(--warn, #e2a03f); }
  .menu-sep { height: 1px; background: var(--border); margin: 4px 0 6px; }
  .linkish {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    font-size: 10px;
    cursor: pointer;
    text-decoration: underline;
  }
  .cal { display: flex; flex-direction: column; gap: 6px; margin: 2px 0 6px; }
  .cal-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .cal-month { font-size: var(--fs-xs); font-weight: 600; color: var(--text-1); }
  .cal-nav {
    display: flex;
    padding: 3px 5px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-2);
    cursor: pointer;
  }
  .cal-nav:hover { color: var(--text-1); border-color: var(--text-3); }
  .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
  .cal-grid.busy { opacity: 0.5; pointer-events: none; }
  .cal-dow { text-align: center; font-size: 9px; color: var(--text-3); padding-bottom: 2px; }
  .cal-day {
    aspect-ratio: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text-3);
    font-size: 10px;
    font-family: var(--font-mono);
    cursor: pointer;
  }
  .cal-day:disabled { opacity: 0.28; cursor: default; }
  .cal-day.has { color: var(--text-1); background: var(--bg-2); border-color: var(--border); }
  .cal-day.clear { border-color: color-mix(in srgb, var(--ok, #46a758) 65%, transparent); color: var(--ok, #46a758); }
  .cal-day.part { border-color: color-mix(in srgb, var(--warn, #e2a03f) 55%, transparent); color: var(--warn, #e2a03f); }
  .cal-day.cloudy, .cal-day.unknown { border-color: var(--border); color: var(--text-2); }
  .cal-day.unavailable { text-decoration: line-through; }
  .cal-day.verifying { opacity: 0.55; animation: pulse 0.8s ease-in-out infinite alternate; }
  .cal-day.has:hover { border-color: var(--text-1); }
  .cal-day.on { background: var(--accent); border-color: var(--accent); color: var(--accent-text); font-weight: 700; }
  @keyframes pulse { to { opacity: 1; } }
</style>
