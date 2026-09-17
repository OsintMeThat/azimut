<script>
  /**
   * The Sentinel-2 passes the drawn areas actually have, to pick a run's dates from.
   *
   * It replaces two bare date fields, which offered every day since 2015 and
   * knew nothing: a sweep pinned to a day without a pass reads nodata, and the
   * user finds that out after paying for the tiles. A calendar is the wrong
   * shape for the answer, too — Sentinel-2 revisits every five days, so four
   * cells in five are dead. So this lists what exists, newest first, with the
   * two facts that decide between them: how much of the areas the pass reaches,
   * and how much of it was cloud.
   */
  import Icon from '../../components/Icon.svelte';
  import { LOOKBACK_WINDOWS, coverClass, coverLabel } from '../../lib/map/acquisitions.js';
  import { cloudClass, cloudLabel } from '../../lib/sentinel.js';

  let {
    list = [],
    days,
    busy = false,
    error = '',
    truncated = false,
    searched = false,
    areas = 0,
    single = false,
    wantsReference = true,
    wantsCompare = true,
    a = '',
    b = '',
    ondays,
    onlook,
    onpick,
  } = $props();
</script>

<div class="passes" aria-label="Sentinel-2 passes over the areas">
  <div class="head">
    <div class="cmp-seg" aria-label="How far back to look">
      {#each LOOKBACK_WINDOWS as option (option.id)}
        <button
          type="button"
          class:on={days === option.id}
          disabled={busy}
          onclick={() => ondays(option.id)}
        >{option.label}</button>
      {/each}
    </div>
    <button class="btn btn-sm" disabled={busy || !areas} onclick={onlook}>
      {busy ? 'Looking…' : searched ? 'Look again' : 'Find passes'}
    </button>
  </div>

  {#if !areas}
    <p class="hint">Draw an area in step 1, then look up the passes it has.</p>
  {:else if error}
    <p class="warn" role="alert">{error}</p>
  {:else if busy}
    <p class="hint">Reading the catalogue over your areas…</p>
  {:else if !searched}
    <p class="hint">One lookup, billed as one Copernicus request.</p>
  {:else if !list.length}
    <p class="warn">No pass reaches these areas in this window. Try a longer one.</p>
  {:else}
    {#if truncated}
      <p class="warn">The catalogue stopped at 100 passes, so older ones are missing. Shorten the window for a complete list.</p>
    {/if}
    <ul class="list">
      {#each list as entry (entry.date)}
        <li class:chosen={entry.date === a || entry.date === b}>
          <div class="facts">
            <strong class="cmp-mono">{entry.date}</strong>
            <span class="badge {coverClass(entry.coverage)}">{coverLabel(entry.coverage)}</span>
            <span class="badge {cloudClass(entry.cloud)}">{cloudLabel(entry.cloud) || 'cloud unknown'}</span>
          </div>
          <div class="cmp-seg" aria-label={`Use ${entry.date}`}>
            {#if wantsReference && !single}
              <button
                type="button"
                class:on={a === entry.date}
                aria-pressed={a === entry.date}
                title="Use as the reference image"
                onclick={() => onpick('a', entry)}
              >A</button>
            {/if}
            {#if wantsCompare}
              <button
                type="button"
                class:on={b === entry.date}
                aria-pressed={b === entry.date}
                title={single ? 'Use as the image to inspect' : 'Use as the image to compare'}
                onclick={() => onpick('b', entry)}
              >{single ? 'Use' : 'B'}</button>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
    <p class="hint">
      <Icon name="info" size={11} />
      A pass covers what its swath reached that day, not the whole map.
    </p>
  {/if}
</div>

<style>
  .passes {
    display: grid;
    gap: 7px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }
  .hint {
    display: flex;
    align-items: center;
    gap: 5px;
    margin: 0;
    color: var(--text-3);
    font-size: 10px;
    line-height: 1.35;
  }
  .warn {
    margin: 0;
    color: var(--warn, #e2a03f);
    font-size: 10.5px;
    line-height: 1.35;
  }
  .list {
    display: grid;
    gap: 3px;
    max-height: 208px;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 5px 6px;
    border: 1px solid transparent;
    border-radius: var(--r-sm);
  }
  li:hover {
    background: var(--bg-3);
  }
  li.chosen {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .facts {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .facts strong {
    color: var(--text-1);
    font-size: var(--fs-xs);
  }
  .badge {
    padding: 1px 5px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    color: var(--text-3);
    font-size: 9.5px;
    white-space: nowrap;
  }
  .badge.full,
  .badge.clear {
    border-color: color-mix(in srgb, var(--ok, #46a758) 60%, transparent);
    color: var(--ok, #46a758);
  }
  .badge.part {
    border-color: color-mix(in srgb, var(--warn, #e2a03f) 55%, transparent);
    color: var(--warn, #e2a03f);
  }
  .badge.thin,
  .badge.cloudy {
    border-color: color-mix(in srgb, var(--danger, #e5484d) 50%, transparent);
    color: var(--danger, #e5484d);
  }
</style>
