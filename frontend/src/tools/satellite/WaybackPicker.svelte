<script>
  import Icon from '../../components/Icon.svelte';

  /**
   * Which Wayback release this surface shows, as a slider through time.
   *
   * `wb` is the store from `state/wayback.svelte.js`. The slider runs oldest on
   * the left to newest on the right, the way a timeline reads, while the list
   * under it runs newest first, the way the releases are published.
   */
  let { menuEl = $bindable(), wb } = $props();

  // The label follows the drag; the map only moves on release, since every
  // step in between would be a whole screen of tiles nobody stopped on.
  let dragging = $state(null);

  const list = $derived(wb.visible);
  const last = $derived(Math.max(0, list.length - 1));
  const sliderValue = $derived(
    dragging ?? (wb.position < 0 ? last : Math.round(last - wb.position))
  );
  const sliderDate = $derived(list[last - sliderValue]?.date ?? wb.date);
  // By position rather than by number: the newest release is not in a list
  // narrowed to changes, yet it shows the latest change's pixels, and a
  // release between two changes is highlighted as neither.
  const onScreen = $derived(Number.isInteger(wb.position) ? wb.position : -1);
</script>

<div class="wb-wrap" bind:this={menuEl}>
  <button
    class="chip"
    class:on={wb.menuOpen}
    onclick={() => wb.toggleMenu()}
    title="Wayback release"
    aria-label="Wayback release"
    aria-expanded={wb.menuOpen}
  >
    <Icon name="clock" size={13} />
    <span class="mono">{wb.date || 'Newest'}</span>
  </button>

  {#if wb.menuOpen}
    <div class="wb-menu card">
      {#if wb.listNote}
        <div class="menu-hint warn">{wb.listNote}</div>
      {:else if !wb.releases.length}
        <div class="menu-hint dim">Reading the release list…</div>
      {:else}
        {#if !wb.reading}
          <div class="step-row">
            <button
              class="nav"
              onclick={() => wb.step(1)}
              disabled={wb.position >= list.length - 1}
              aria-label="Older release"
              title="Older release"
            ><Icon name="chevronLeft" size={13} /></button>
            <span class="current mono">{sliderDate}</span>
            <button
              class="nav"
              onclick={() => wb.step(-1)}
              disabled={wb.position <= 0}
              aria-label="Newer release"
              title="Newer release"
            ><Icon name="chevronRight" size={13} /></button>
          </div>
          <input
            class="slider"
            type="range"
            min="0"
            max={last}
            step="1"
            value={sliderValue}
            disabled={list.length < 2}
            oninput={(event) => (dragging = Number(event.currentTarget.value))}
            onchange={(event) => {
              const picked = list[last - Number(event.currentTarget.value)];
              dragging = null;
              if (picked) wb.pick(picked.release);
            }}
            aria-label={wb.changesOnly ? 'Change' : 'Release'}
          />
        {/if}

        <div class="chips">
          <button
            class="chip-opt"
            class:on={wb.changesOnly}
            onclick={() => wb.setChangesOnly(true)}
            title="Only releases showing a different picture at the crosshair"
          >Changes here</button>
          <button
            class="chip-opt"
            class:on={!wb.changesOnly}
            onclick={() => wb.setChangesOnly(false)}
          >Every release</button>
        </div>

        {#if wb.changesOnly}
          {#if wb.changesBusy}
            <div class="menu-hint dim">Reading this point's history…</div>
          {:else if wb.changesNote}
            <div class="menu-hint warn">{wb.changesNote}</div>
          {:else if wb.stale}
            <div class="menu-hint">
              <span class="warn">The map moved off this history.</span>
              <button class="linkish" onclick={() => wb.loadChanges()}>Refresh</button>
            </div>
          {:else if wb.changes}
            <div class="menu-hint dim">
              {wb.changes.length} change{wb.changes.length === 1 ? '' : 's'} at the crosshair
            </div>
          {/if}
        {/if}

        {#if !wb.reading}
          <ul class="releases" aria-label="Releases">
            {#each list as entry, index (entry.release)}
              {@const shot = wb.picture(entry.release)}
              <li>
                <button
                  class="row mono"
                  class:on={index === onScreen}
                  onclick={() => wb.pick(entry.release)}
                  title={shot?.source ? `Taken by ${shot.source}` : undefined}
                >
                  <span>{entry.date}</span>
                  {#if shot?.acquired}<span class="taken">taken {shot.acquired}</span>{/if}
                </button>
              </li>
            {/each}
          </ul>

          <div class="menu-hint dim">
            Release dates are Esri's; “taken” and the pill under the chip date the pixels.
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .wb-wrap {
    position: relative;
    display: flex;
  }
  .chip {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 8px;
    border-radius: var(--radius-1);
    font-size: var(--fs-xs);
    color: var(--text-1);
    background: rgba(24, 24, 24, 0.88);
    backdrop-filter: blur(6px);
    box-shadow: 0 0 0 1px var(--border);
    cursor: pointer;
  }
  .chip:hover,
  .chip.on {
    color: var(--accent);
  }
  /* down and left of the chip, like the Sentinel-2 picker beside it: the
     surface's own corner clips anything opening upwards */
  .wb-menu {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    width: 248px;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
    background: rgba(24, 24, 24, 0.96);
    backdrop-filter: blur(6px);
    box-shadow: var(--shadow-2);
    z-index: 700;
  }
  .step-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .current {
    font-size: var(--fs-sm);
    color: var(--text-1);
  }
  .nav {
    display: flex;
    padding: 2px 4px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-2);
    cursor: pointer;
  }
  .nav:hover:not(:disabled) {
    color: var(--text-1);
    border-color: var(--text-3);
  }
  .nav:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .slider {
    width: 100%;
    accent-color: var(--accent);
    cursor: pointer;
  }
  .chips {
    display: flex;
    gap: 4px;
  }
  .chip-opt {
    padding: 4px 9px;
    border-radius: var(--r-sm);
    border: 1px solid var(--border);
    background: var(--bg-2);
    color: var(--text-2);
    font-size: var(--fs-xs);
    white-space: nowrap;
    cursor: pointer;
  }
  .chip-opt:hover {
    color: var(--text-1);
  }
  .chip-opt.on {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }
  .releases {
    margin: 0;
    padding: 0;
    list-style: none;
    max-height: 220px;
    overflow-y: auto;
  }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    padding: 3px 8px;
    border-radius: var(--r-sm);
    font-size: var(--fs-xs);
    color: var(--text-2);
    text-align: left;
    cursor: pointer;
  }
  .taken {
    color: var(--text-3);
  }
  .row:hover {
    background: var(--bg-3);
    color: var(--text-1);
  }
  .row.on {
    color: var(--accent);
    background: var(--accent-soft);
  }
  .menu-hint {
    font-size: 10px;
    line-height: 1.35;
    color: var(--text-3);
  }
  .menu-hint.dim {
    opacity: 0.8;
  }
  .menu-hint .warn,
  .menu-hint.warn {
    color: var(--warn, #e2a03f);
  }
  .linkish {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    font-size: 10px;
    cursor: pointer;
    text-decoration: underline;
  }
</style>
