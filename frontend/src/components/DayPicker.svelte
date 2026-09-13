<script>
  /**
   * A day, picked from a calendar drawn inside the panel it belongs to.
   *
   * `<input type="date">` was the obvious answer and the wrong one here: its
   * calendar is browser chrome, so it opens at the browser's size, in the
   * browser's locale, and *over* the page — which in a panel docked to the
   * right edge of the window means half of it outside the window, and a date
   * reading `12/09/2026` in an app that writes `2026-09-12` everywhere else.
   *
   * So the month is drawn here, in flow: it pushes the rows under it down
   * rather than floating over them, which is the whole of why it cannot be
   * clipped. The arithmetic is `lib/calendar.js`, and the extension's panel
   * draws the same grid from its own copy of it.
   */
  import Icon from './Icon.svelte';
  import {
    WEEKDAYS,
    monthDays,
    monthLabel,
    monthOf,
    monthOutOfRange,
    outOfRange,
    shiftMonth,
    today as todayOf,
  } from '../lib/calendar.js';

  let {
    /** The day being shown, `YYYY-MM-DD`, or '' for none. */
    value = '',
    /** What the field says when there is no day yet. */
    placeholder = 'Any day',
    /** Bounds, either of which may be empty for "no bound". */
    min = '',
    max = '',
    /** Names the field for a reader that cannot see the label beside it. */
    label = 'Date',
    /** Whether the day can be taken back out, for a field that means "and no
     *  further" as much as it means a date. */
    clearable = false,
    /** Called with the chosen day, or '' when it is cleared. */
    onpick,
  } = $props();

  let open = $state(false);
  let cursor = $state('');

  const today = $derived(todayOf());
  const month = $derived(cursor || monthOf(value));
  const cells = $derived(monthDays(month));
  const canGoBack = $derived(!monthOutOfRange(shiftMonth(month, -1), min, max));
  const canGoOn = $derived(!monthOutOfRange(shiftMonth(month, 1), min, max));

  function toggle() {
    open = !open;
    if (open) cursor = monthOf(value); // reopened on the day it holds, not where it was left
  }

  function pick(iso) {
    onpick?.(iso);
    open = false;
  }
</script>

<div class="day-picker">
  <button
    type="button"
    class="field"
    class:empty={!value}
    aria-expanded={open}
    aria-label={label}
    onclick={toggle}
  >
    <span>{value || placeholder}</span>
    <Icon name={open ? 'chevronUp' : 'chevronDown'} size={11} />
  </button>

  {#if open}
    <div class="cal" role="group" aria-label="{label} calendar">
      <div class="head">
        <button
          type="button"
          class="step"
          disabled={!canGoBack}
          aria-label="Previous month"
          onclick={() => (cursor = shiftMonth(month, -1))}
        >
          <Icon name="chevronLeft" size={12} />
        </button>
        <span class="month">{monthLabel(month)}</span>
        <button
          type="button"
          class="step"
          disabled={!canGoOn}
          aria-label="Next month"
          onclick={() => (cursor = shiftMonth(month, 1))}
        >
          <Icon name="chevronRight" size={12} />
        </button>
      </div>

      <div class="week">
        {#each WEEKDAYS as day, i (i)}<span>{day}</span>{/each}
      </div>

      <div class="days">
        {#each cells as cell (cell.iso)}
          <button
            type="button"
            class="day"
            class:out={!cell.inMonth}
            class:on={cell.iso === value}
            class:today={cell.iso === today}
            disabled={outOfRange(cell.iso, min, max)}
            aria-current={cell.iso === value ? 'date' : undefined}
            title={cell.iso}
            onclick={() => pick(cell.iso)}
          >{cell.day}</button>
        {/each}
      </div>

      <div class="acts">
        <button
          type="button"
          class="act"
          disabled={outOfRange(today, min, max)}
          onclick={() => pick(today)}
        >Today</button>
        {#if clearable}
          <button type="button" class="act" disabled={!value} onclick={() => pick('')}>Clear</button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .day-picker {
    display: flex;
    flex: 1;
    min-width: 0;
    flex-direction: column;
    gap: 4px;
  }
  .field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 3px 6px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-1);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }
  .field:hover {
    border-color: var(--border-strong);
  }
  .field.empty {
    color: var(--text-3);
  }
  .field[aria-expanded='true'] {
    border-color: var(--accent);
    color: var(--accent);
  }
  /* in flow, never over: the row under it moves down, and nothing can push it
     past an edge it would be cut at */
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
  .month {
    font-size: 10px;
    font-weight: 600;
    color: var(--text-1);
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
  .step:hover:not(:disabled) {
    color: var(--text-1);
    background: var(--bg-3);
  }
  .step:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .week,
  .days {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 1px;
  }
  .week span {
    text-align: center;
    font-size: 9px;
    color: var(--text-3);
  }
  .day {
    padding: 2px 0;
    border-radius: var(--r-sm);
    color: var(--text-2);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }
  .day:hover:not(:disabled) {
    background: var(--bg-3);
    color: var(--text-1);
  }
  .day.out {
    color: var(--text-3);
    opacity: 0.5;
  }
  .day.today {
    box-shadow: inset 0 0 0 1px var(--border-strong);
  }
  .day.on {
    background: var(--accent-soft);
    color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .day:disabled {
    opacity: 0.25;
    cursor: default;
  }
  .acts {
    display: flex;
    justify-content: flex-end;
    gap: 4px;
  }
  .act {
    padding: 2px 7px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-2);
    font-size: 10px;
    cursor: pointer;
  }
  .act:hover:not(:disabled) {
    border-color: var(--border-strong);
    color: var(--text-1);
  }
  .act:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
