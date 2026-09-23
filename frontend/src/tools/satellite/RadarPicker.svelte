<script>
  import Icon from '../../components/Icon.svelte';
  import { monthLabel } from '../../lib/sentinel.js';
  import { orbitMark, passLabel, sameTrack } from '../../lib/radar.js';

  /**
   * Which Sentinel-1 pass this surface shows, month by month.
   *
   * `s1` is the store from `state/radar.svelte.js`. A row is one pass, named by
   * its day and its UTC time, with the way the satellite was flying: dawn
   * passes fly south, dusk passes north, and the two see a place from opposite
   * sides. Beside a second radar map the rows on that map's track are marked,
   * since only those compare like with like.
   */
  let { menuEl = $bindable(), s1 } = $props();

  const peer = $derived(s1.peer);
  const shown = $derived(s1.pass);
</script>

<div class="s1-wrap" bind:this={menuEl}>
  <button
    class="chip"
    class:on={s1.menuOpen}
    onclick={() => s1.toggleMenu()}
    title={s1.busy ? 'Reading this month’s radar passes…' : 'Sentinel-1 pass'}
    aria-label="Sentinel-1 pass"
    aria-expanded={s1.menuOpen}
    aria-busy={s1.busy}
  >
    <Icon name="clock" size={13} />
    <span class="mono">{passLabel(shown)}</span>
    {#if shown?.orbit}<span class="mark" aria-hidden="true">{orbitMark(shown.orbit)}</span>{/if}
    {#if s1.busy}<span class="spinner" aria-hidden="true"></span>{/if}
  </button>

  {#if s1.menuOpen}
    <div class="s1-menu card">
      <div class="step-row">
        <button class="nav" onclick={() => s1.stepMonth(-1)} aria-label="Previous month" title="Previous month">
          <Icon name="chevronLeft" size={13} />
        </button>
        <span class="current">{monthLabel(s1.month)}</span>
        <button class="nav" onclick={() => s1.stepMonth(1)} aria-label="Next month" title="Next month">
          <Icon name="chevronRight" size={13} />
        </button>
      </div>

      <button class="row" class:on={!shown} onclick={() => s1.pick(null)}>
        <span>Most recent pass</span>
      </button>

      {#if s1.busy}
        <div class="menu-hint waiting"><span class="spinner" aria-hidden="true"></span> Reading passes…</div>
      {:else if s1.note}
        <div class="menu-hint" class:warn={s1.note.startsWith('Could not')}>{s1.note}</div>
      {:else if s1.stale}
        <div class="menu-hint">
          <span class="warn">The map moved off this list.</span>
          <button class="linkish" onclick={() => s1.loadPasses()}>Read here</button>
        </div>
      {/if}

      {#if s1.passes.length}
        <ul class="passes" aria-label="Sentinel-1 passes">
          {#each s1.passes as entry (`${entry.date}T${entry.time}`)}
            {@const on = shown?.date === entry.date && shown?.time === entry.time}
            <li>
              <button class="row mono" class:on onclick={() => s1.pick(entry)}
                title={entry.orbit ? `Flying ${entry.orbit === 'descending' ? 'south' : 'north'}` : undefined}>
                <span>{entry.date} · {entry.time.slice(0, 5)} UTC</span>
                <span class="side">
                  {#if peer && sameTrack(entry.time, peer.time)}<span class="track">same track</span>{/if}
                  {orbitMark(entry.orbit)}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      <div class="menu-hint">One lookup a month, billed as one Copernicus request.</div>
    </div>
  {/if}
</div>

<style>
  .s1-wrap {
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
  .mark {
    color: var(--text-3);
  }
  .spinner {
    width: 11px;
    height: 11px;
    border: 2px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .s1-menu {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    width: 260px;
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
  .nav:hover {
    color: var(--text-1);
    border-color: var(--text-3);
  }
  .passes {
    margin: 0;
    padding: 0;
    list-style: none;
    max-height: 240px;
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
  .row:hover {
    background: var(--bg-3);
    color: var(--text-1);
  }
  .row.on {
    color: var(--accent);
    background: var(--accent-soft);
  }
  .side {
    display: inline-flex;
    gap: 6px;
    color: var(--text-3);
  }
  .track {
    color: var(--ok, #46a758);
  }
  .menu-hint {
    font-size: 10px;
    line-height: 1.35;
    color: var(--text-3);
  }
  .menu-hint.waiting {
    display: flex;
    align-items: center;
    gap: 6px;
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
