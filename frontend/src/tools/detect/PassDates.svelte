<script>
  /**
   * The day of a check's passes, picked from a calendar as a routine or a one
   * pass picks its dates: one button for each side, a month of passes behind it
   * with the days that have one coloured by their cloud, and a typed date for a
   * day the calendar does not show.
   *
   * The calendar reads the passes over the middle of the map a month at a time,
   * only for the month in view, and offers only days that keep the two passes in
   * order.
   */
  import PassCalendar from './PassCalendar.svelte';
  import DateField from '../../components/DateField.svelte';
  import Icon from '../../components/Icon.svelte';

  let { bench } = $props();

  const check = $derived(bench.check);
  const sides = $derived(bench.single ? [['b', 'Pass']] : [['a', 'Before'], ['b', 'After']]);
  const open = $derived(bench.calendar.side);
  const nameOf = (side) => sides.find(([id]) => id === side)?.[1] ?? '';
  /** The day of the other side, which a calendar with none chosen opens near. */
  const otherDay = (side) => (side === 'a' ? check?.b?.date : check?.a?.date) ?? '';
</script>

<div class="dates">
  <div class="sides">
    {#each sides as [side, name] (side)}
      <div class="side">
        <strong>{name}</strong>
        <button type="button" class="date-pick" aria-label={`${name} pass`} aria-expanded={open === side}
          onclick={() => (open === side ? bench.closeCalendar() : bench.openCalendar(side))}>
          <Icon name="calendar" size={13} /><span>{check?.[side]?.date || 'Choose a pass'}</span><Icon name="chevronDown" size={12} />
        </button>
      </div>
    {/each}
  </div>
  {#if open}
    <div class="pick">
      {#key open}
        <PassCalendar list={bench.calendar.list} value={check?.[open]?.date ?? ''} near={otherDay(open)} label={nameOf(open)} radar={bench.radar}
          busy={bench.calendar.busy} error={bench.calendar.error} eligible={bench.eligible(open)}
          onmonth={(month) => bench.loadMonth(month)} onclose={() => bench.closeCalendar()}
          onpick={(pass) => bench.pickFromCalendar(open, pass)} />
      {/key}
      <details class="manual-date">
        <summary>Enter a date</summary>
        <DateField day reading={false} label={`${nameOf(open)} date`} value={check?.[open]?.date ?? ''}
          onchange={(value) => bench.typeDay(open, value ?? '')} />
      </details>
    </div>
  {/if}
</div>

<style>
  .dates { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 10px 18px; }
  .sides { display: grid; gap: 8px; }
  .side { display: grid; justify-items: start; gap: 3px; font-size: var(--fs-xs); }
  .side strong { color: var(--text-2); }
  .date-pick {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 200px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-1);
    font-size: var(--fs-xs);
    text-align: left;
  }
  .date-pick:hover, .date-pick[aria-expanded='true'] { border-color: var(--accent); }
  .date-pick span { flex: 1; }
  .pick { display: grid; gap: 6px; }
  .manual-date { color: var(--text-3); font-size: 10px; }
  .manual-date summary { cursor: pointer; }
  .pick :global(.date-field) { width: 145px; }
</style>
