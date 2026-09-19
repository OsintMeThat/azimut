<script>
  /**
   * A date built by pointing at it, for the analyst who would rather not spell
   * one out.
   *
   * It says the same things the field's own text says (`lib/looseDate.js`) and
   * nothing more: how deep the answer goes — a day, a month, a year — whether it
   * is one date or a period, and the two marks of doubt the case's profile
   * carries, `~` for about and `?` for unsure. A timestamp is not offered: an
   * hour is typed, and a builder of hours would be the three-list form this whole
   * field replaced.
   *
   * Three rows and no more, in that order, because that is the order the answer
   * is decided in: how precise, which date, and how sure.
   */
  import { untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import MonthGrid from './MonthGrid.svelte';
  import { shiftMonth, today, yearMonths, yearPage } from '../lib/calendar.js';
  import { composeLooseDate, decomposeLooseDate } from '../lib/looseDate.js';

  let {
    /** The stored value the builder opens on. */
    value = '',
    /** Names the group for a reader that cannot see the field above it. */
    label = 'Date',
    /** Called with the stored value every time the answer changes. */
    onbuild,
  } = $props();

  const DEPTHS = [
    { id: 'day', label: 'Day' },
    { id: 'month', label: 'Month' },
    { id: 'year', label: 'Year' },
  ];

  /** How deep a `YYYY[-MM[-DD]]` token goes. */
  const depthOf = (token) => (token?.length >= 10 ? 'day' : token?.length >= 7 ? 'month' : token ? 'year' : '');
  /** …and that token cut back to a depth, so changing your mind keeps the answer. */
  const cut = (token, depth) =>
    token.slice(0, depth === 'day' ? 10 : depth === 'month' ? 7 : 4);

  // What the field held when the builder opened, and only that: it is mounted by
  // the press that opens it, so from here on the pieces below are the answer and
  // the field is what they write into.
  const opened = untrack(() => decomposeLooseDate(value)) ?? {};
  let start = $state(opened.start ?? '');
  let end = $state(opened.end ?? '');
  let approximate = $state(opened.approximate ?? false);
  let uncertain = $state(opened.uncertain ?? false);
  let period = $state(Boolean(opened.end));
  let depth = $state(depthOf(opened.start) || 'day');
  // Which end the next press fills. A period is picked start-first, which is the
  // way it is read, and the line under the grid says which one is being waited for.
  let picking = $state('start');
  // The year the month and year grids are showing, kept here because neither is
  // a calendar month and `MonthGrid` owns its own cursor.
  let year = $state(Number((opened.start || today()).slice(0, 4)));

  const shown = $derived(picking === 'end' ? end || start : start);
  const months = $derived(yearMonths(year));
  const years = $derived(yearPage(year));

  /**
   * Hand the answer up, once there is one to hand up.
   *
   * Nothing is written until a date has been picked: the builder opens blank on a
   * value it cannot draw — a timestamp, say — and a press on *How precise* would
   * otherwise have written that blank over what was typed.
   */
  function send() {
    if (!start) return;
    onbuild?.(composeLooseDate({ start, end: period ? end : '', approximate, uncertain }));
  }

  /** Take a pick. A period picked backwards is a period all the same: the two
   *  ends swap rather than being refused. */
  function take(token) {
    if (period && picking === 'end') {
      const pair = [start, token].sort();
      [start, end] = pair;
    } else if (period) {
      start = token;
      if (end && end < token) end = '';
      picking = 'end';
    } else {
      start = token;
      end = '';
    }
    year = Number(token.slice(0, 4));
    send();
  }

  function setDepth(next) {
    depth = next;
    start = cut(start, next);
    end = cut(end, next);
    send();
  }

  function setPeriod(on) {
    period = on;
    picking = on && start ? 'end' : 'start';
    if (!on) end = '';
    send();
  }

  /** Take the date back out. The one press that writes an empty field on purpose. */
  function clear() {
    start = '';
    end = '';
    picking = 'start';
    onbuild?.('');
  }
</script>

<div class="builder" role="group" aria-label="{label} builder">
  <div class="row">
    <div class="seg" role="group" aria-label="How precise">
      {#each DEPTHS as entry (entry.id)}
        <button
          type="button"
          class="chip"
          class:on={depth === entry.id}
          aria-pressed={depth === entry.id}
          onclick={() => setDepth(entry.id)}
        >{entry.label}</button>
      {/each}
    </div>
    <span class="gap"></span>
    <button
      type="button"
      class="chip mark"
      class:on={approximate}
      aria-pressed={approximate}
      title="About this date"
      onclick={() => { approximate = !approximate; send(); }}
    >~</button>
    <button
      type="button"
      class="chip mark"
      class:on={uncertain}
      aria-pressed={uncertain}
      title="Not sure of this date"
      onclick={() => { uncertain = !uncertain; send(); }}
    >?</button>
  </div>

  {#if depth === 'day'}
    <MonthGrid value={shown} {label} onpick={(iso) => iso && take(iso)} />
  {:else}
    <div class="cal">
      <div class="head">
        <button
          type="button"
          class="step"
          aria-label={depth === 'month' ? 'Previous year' : 'Earlier years'}
          title={depth === 'month' ? 'Previous year' : 'Earlier years'}
          onclick={() => (year -= depth === 'month' ? 1 : 12)}
        ><Icon name="chevronLeft" size={12} /></button>
        <span class="title">{depth === 'month' ? year : `${years[0]}–${years[years.length - 1]}`}</span>
        <button
          type="button"
          class="step"
          aria-label={depth === 'month' ? 'Next year' : 'Later years'}
          title={depth === 'month' ? 'Next year' : 'Later years'}
          onclick={() => (year += depth === 'month' ? 1 : 12)}
        ><Icon name="chevronRight" size={12} /></button>
      </div>
      <div class="cells">
        {#if depth === 'month'}
          {#each months as entry (entry.iso)}
            <button
              type="button"
              class="cell"
              class:on={entry.iso === shown}
              title={entry.iso}
              onclick={() => take(entry.iso)}
            >{entry.label}</button>
          {/each}
        {:else}
          {#each years as entry (entry)}
            <button
              type="button"
              class="cell"
              class:on={entry === shown}
              title={entry}
              onclick={() => take(entry)}
            >{entry}</button>
          {/each}
        {/if}
      </div>
    </div>
  {/if}

  <div class="row foot">
    <button
      type="button"
      class="chip"
      class:on={period}
      aria-pressed={period}
      title="From one date to another"
      onclick={() => setPeriod(!period)}
    >Period</button>
    {#if period}
      <span class="said">
        {#if picking === 'end'}Pick the end{:else}Pick the start{/if}
      </span>
    {/if}
    <span class="gap"></span>
    <button type="button" class="chip" disabled={!start} onclick={clear}>Clear</button>
  </div>
</div>

<style>
  /* In flow like the month it holds: the field above is often in a column with
     an edge close by, and nothing here may be cut by it. */
  .builder {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .gap {
    flex: 1;
  }
  .seg {
    display: flex;
    gap: 3px;
  }
  .chip {
    padding: 2px 7px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-2);
    font-size: 10px;
    white-space: nowrap;
    cursor: pointer;
  }
  .chip:hover:not(:disabled) {
    border-color: var(--border-strong);
    color: var(--text-1);
  }
  .chip.on {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }
  .chip:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .mark {
    width: 22px;
    padding: 2px 0;
    text-align: center;
    font-weight: 700;
  }
  .said {
    font-size: 10px;
    color: var(--text-3);
  }
  /* The month and year pages are the same box the calendar draws, so the three
     precisions read as one control rather than three. */
  .cal {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 5px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .title {
    font-size: 10px;
    font-weight: 600;
    color: var(--text-1);
    font-variant-numeric: tabular-nums;
  }
  .step {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: var(--r-sm);
    color: var(--text-2);
    cursor: pointer;
  }
  .step:hover {
    color: var(--text-1);
    background: var(--bg-3);
  }
  .cells {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 2px;
  }
  .cell {
    padding: 4px 0;
    border-radius: var(--r-sm);
    color: var(--text-2);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }
  .cell:hover {
    background: var(--bg-3);
    color: var(--text-1);
  }
  .cell.on {
    background: var(--accent-soft);
    color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
</style>
