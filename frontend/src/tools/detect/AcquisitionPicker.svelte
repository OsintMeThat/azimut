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
   *
   * The calendar has its place one step up, for where to look: past the year the
   * presets reach, two days picked in it bound the lookup. The catalogue gives at
   * most 100 passes, newest first, so a list it cut short offers the older ones.
   */
  import Icon from '../../components/Icon.svelte';
  import MonthGrid from '../../components/MonthGrid.svelte';
  import {
    LOOKBACK_WINDOWS, MISSION_START, coverClass, coverLabel, lookupSpan, olderSpan, passKey, spanProblem,
  } from '../../lib/map/acquisitions.js';
  import { isoDay } from '../../lib/sentinel.js';
  import { cloudClass, cloudLabel } from '../../lib/sentinel.js';
  import { orbitMark, sameTrack } from '../../lib/radar.js';

  let {
    list = [],
    /** Days back from today, or two days picked in the calendar, `{ start, end }`. */
    lookback,
    busy = false,
    error = '',
    truncated = false,
    searched = false,
    areas = 0,
    single = false,
    wantsReference = true,
    wantsCompare = true,
    /** Sentinel-1 passes: a time and a direction instead of a cloud figure. */
    radar = false,
    /** The chosen sources, `{ date, time }` each, or null. */
    a = null,
    b = null,
    onlookback,
    onlook,
    /** Look again before the oldest pass listed, when the catalogue cut the list. */
    onolder,
    onpick,
  } = $props();

  const picked = $derived(typeof lookback === 'object' && lookback !== null);
  const problem = $derived(spanProblem(lookback));
  const older = $derived(truncated && onolder ? olderSpan(lookback, list) : null);
  const first = $derived(MISSION_START[radar ? 'sentinel1' : 'sentinel2']);
  const today = isoDay(new Date());
  /** Which picked day has its month open: 'start', 'end' or ''. */
  let calendar = $state('');

  function pickDay(day) {
    onlookback({ ...lookback, [calendar]: day });
    calendar = '';
  }

  /** Whether a row is the pass a side names: a typed radar day matches its day. */
  function names(source, entry) {
    if (!source?.date || source.date !== entry.date) return false;
    return !source.time || !entry.time || source.time === entry.time;
  }
</script>

<div class="passes" aria-label={radar ? 'Sentinel-1 passes over the areas' : 'Sentinel-2 passes over the areas'}>
  <div class="head">
    <div class="cmp-seg" aria-label="How far back to look">
      {#each LOOKBACK_WINDOWS as option (option.id)}
        <button
          type="button"
          class:on={lookback === option.id}
          disabled={busy}
          onclick={() => { calendar = ''; onlookback(option.id); }}
        >{option.label}</button>
      {/each}
      <button
        type="button"
        class:on={picked}
        disabled={busy}
        title="Pick the first and the last day in the calendar"
        onclick={() => { if (!picked) onlookback(lookupSpan(lookback)); }}
      >Dates…</button>
    </div>
    <button class="btn btn-sm" disabled={busy || !areas || !!problem} onclick={onlook}>
      {busy ? 'Looking…' : searched ? 'Look again' : 'Find passes'}
    </button>
  </div>

  {#if picked}
    <div class="span">
      <button type="button" class="day cmp-mono" class:open={calendar === 'start'} disabled={busy}
        aria-label="First day" aria-expanded={calendar === 'start'}
        onclick={() => (calendar = calendar === 'start' ? '' : 'start')}>{lookback.start || 'First day'}</button>
      <span aria-hidden="true">→</span>
      <button type="button" class="day cmp-mono" class:open={calendar === 'end'} disabled={busy}
        aria-label="Last day" aria-expanded={calendar === 'end'}
        onclick={() => (calendar = calendar === 'end' ? '' : 'end')}>{lookback.end || 'Last day'}</button>
    </div>
    {#if calendar}
      <MonthGrid value={lookback[calendar]} label={calendar === 'start' ? 'First day' : 'Last day'}
        min={calendar === 'start' ? first : lookback.start || first}
        max={calendar === 'start' ? lookback.end || today : today}
        onpick={pickDay} />
    {/if}
    {#if problem}<p class="warn">{problem}</p>{/if}
  {/if}

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
      <p class="warn">The catalogue stopped at 100 passes, so older ones are missing.
        {#if older}<button type="button" class="link" disabled={busy} onclick={onolder}>Older passes</button>{/if}</p>
    {/if}
    <ul class="list">
      {#each list as entry (passKey(entry))}
        {@const pairedA = !single && radar && a?.time && !sameTrack(entry.time, a.time)}
        {@const pairedB = !single && radar && b?.time && !sameTrack(entry.time, b.time)}
        <li class:chosen={names(a, entry) || names(b, entry)}>
          <div class="facts">
            <strong class="cmp-mono">{entry.date}</strong>
            {#if radar}
              <span class="cmp-mono time" title={entry.orbit ? `Flying ${entry.orbit === 'descending' ? 'south' : 'north'}` : undefined}>
                {entry.time?.slice(0, 5)} UTC {orbitMark(entry.orbit)}</span>
            {/if}
            <span class="badge {coverClass(entry.coverage)}">{coverLabel(entry.coverage)}</span>
            {#if !radar}
              <span class="badge {cloudClass(entry.cloud)}">{cloudLabel(entry.cloud) || 'cloud unknown'}</span>
            {/if}
          </div>
          <div class="cmp-seg" aria-label={`Use ${entry.date}`}>
            {#if wantsReference && !single}
              <button
                type="button"
                class:on={names(a, entry)}
                aria-pressed={names(a, entry)}
                disabled={pairedB}
                title={pairedB ? 'Another track than B: it sees the ground from another angle' : 'Use as A, the picture before'}
                onclick={() => onpick('a', entry)}
              >A</button>
            {/if}
            {#if wantsCompare}
              <button
                type="button"
                class:on={names(b, entry)}
                aria-pressed={names(b, entry)}
                disabled={pairedA}
                title={pairedA ? 'Another track than A: it sees the ground from another angle'
                  : single ? 'Use this pass' : 'Use as B, the picture to look in'}
                onclick={() => onpick('b', entry)}
              >{single ? 'Use' : 'B'}</button>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
    <p class="hint">
      <Icon name="info" size={11} />
      {radar ? 'A and B must share a track: the same time of day.'
        : 'A pass covers what its swath reached that day, not the whole map.'}
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
  /* Underlined: it sits in the warning's own orange. */
  .link { color: var(--accent); font-size: inherit; text-decoration: underline; }
  .link:disabled { color: var(--text-3); }
  .span {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .day {
    padding: 3px 7px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    color: var(--text-1);
    font-size: var(--fs-xs);
  }
  .day:hover:not(:disabled),
  .day.open {
    border-color: var(--accent);
    background: var(--accent-soft);
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
  .time {
    color: var(--text-2);
    font-size: 10.5px;
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
