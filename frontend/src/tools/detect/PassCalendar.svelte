<script>
  /** Calendar of passes over one Detect area, using Satellite's day colours. */
  import { onMount } from 'svelte';
  import Icon from '../../components/Icon.svelte';
  import { monthDays, monthOf, monthOutOfRange, shiftMonth, today } from '../../lib/calendar.js';
  import { MISSION_START } from '../../lib/map/acquisitions.js';
  import { cloudClass, cloudLabel, monthLabel } from '../../lib/sentinel.js';
  import { orbitMark } from '../../lib/radar.js';

  let { list = [], value = '', label = 'Date', radar = false, busy = false, error = '',
    /** A day to open on when none is chosen, such as the other side's: passes of a pair are close in time. */
    near = '',
    eligible = () => true, onmonth = () => {}, onpick = () => {}, onclose = () => {} } = $props();
  let cursor = $state('');
  let selectedDay = $state('');
  let root;
  const first = $derived(MISSION_START[radar ? 'sentinel1' : 'sentinel2']);
  const latest = today();
  const month = $derived(cursor || monthOf(value || near || today()));
  const days = $derived(monthDays(month));
  const entries = (day) => list.filter((pass) => pass.date === day && eligible(pass));
  const blocked = (day) => list.some((pass) => pass.date === day);
  const unavailable = (day) => blocked(day)
    ? (radar ? 'outside date order or radar track' : 'outside date order') : 'no pass';
  const stamp = (pass) => radar
    ? `${pass.time?.slice(0, 5) ?? ''} UTC ${orbitMark(pass.orbit)}`
    : cloudLabel(pass.cloud) || 'cloud unknown';

  onMount(() => {
    onmonth(month);
    root?.scrollIntoView({ block: 'nearest' });
  });
  function move(step) {
    cursor = shiftMonth(month, step);
    selectedDay = '';
    onmonth(cursor);
  }
  function choose(day) {
    const found = entries(day);
    if (found.length === 1) onpick(found[0]);
    else if (found.length > 1) selectedDay = day;
  }
</script>

<div bind:this={root} class="pass-calendar" role="group" aria-label={`${label} pass calendar`}>
  <div class="head">
    <button class="nav" aria-label="Previous month" title="Previous month"
      disabled={monthOutOfRange(shiftMonth(month, -1), first, latest)} onclick={() => move(-1)}>
      <Icon name="chevronLeft" size={12} />
    </button>
    <strong>{monthLabel(month)}</strong>
    <button class="nav" aria-label="Next month" title="Next month"
      disabled={monthOutOfRange(shiftMonth(month, 1), first, latest)} onclick={() => move(1)}>
      <Icon name="chevronRight" size={12} />
    </button>
    <button class="nav" aria-label="Close calendar" title="Close calendar" onclick={onclose}>
      <Icon name="x" size={12} />
    </button>
  </div>
  <div class="grid" class:busy>
    {#each ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as day, index (index)}
      <span class="dow" aria-hidden="true">{day}</span>
    {/each}
    {#each days as day (day.iso)}
      {@const found = day.inMonth ? entries(day.iso) : []}
      {@const pass = found[0]}
      {#if day.inMonth}
        <button class="day" class:has={!!pass} class:on={day.iso === value || day.iso === selectedDay}
          class:clear={!!pass && !radar && cloudClass(pass.cloud) === 'clear'}
          class:part={!!pass && !radar && cloudClass(pass.cloud) === 'part'}
          class:cloudy={!!pass && !radar && cloudClass(pass.cloud) === 'cloudy'}
          disabled={!pass || busy} title={pass ? `${day.iso}: ${stamp(pass)}` : `${day.iso}: ${unavailable(day.iso)}`}
          aria-label={pass ? `${day.iso}: ${stamp(pass)}` : `${day.iso}: ${unavailable(day.iso)}`}
          onclick={() => choose(day.iso)}>{day.day}</button>
      {:else}<span class="pad" aria-hidden="true"></span>{/if}
    {/each}
  </div>
  {#if busy}<p class="hint">Reading this month's passes…</p>
  {:else if error}<p class="warn" role="alert">{error}</p>
  {:else if selectedDay && entries(selectedDay).length > 1}
    <div class="times" aria-label={`Passes on ${selectedDay}`}>
      {#each entries(selectedDay) as pass (pass.time || pass.date)}
        <button onclick={() => onpick(pass)}>{stamp(pass)}</button>
      {/each}
    </div>
  {:else}<p class="hint">Only days with a pass can be chosen.</p>{/if}
</div>

<style>
  .pass-calendar { display: grid; gap: 5px; width: min(100%, 246px); padding: 8px; border: 1px solid var(--border);
    border-radius: var(--r-sm); background: var(--bg-2); }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .head strong { flex: 1; font-size: var(--fs-xs); text-align: center; }
  .nav { display: grid; place-items: center; width: 22px; height: 22px; border: 1px solid var(--border);
    border-radius: var(--r-sm); }
  .nav:hover:not(:disabled) { border-color: var(--text-3); }
  .nav:disabled { opacity: .35; }
  .grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px; }
  .grid.busy { opacity: .5; }
  .dow { text-align: center; font-size: 9px; color: var(--text-3); }
  .day { display: grid; place-items: center; height: 24px; min-width: 0; border: 1px solid transparent;
    border-radius: var(--r-sm); color: var(--text-3); font: 10px var(--font-mono); }
  .day:disabled { opacity: .3; }
  .day.has { border-color: var(--border); background: var(--bg-2); color: var(--text-1); }
  .day.clear { border-color: color-mix(in srgb, var(--ok) 65%, transparent); color: var(--ok); }
  .day.part { border-color: color-mix(in srgb, var(--warn) 55%, transparent); color: var(--warn); }
  .day.cloudy { color: var(--text-2); }
  .day.has:hover:not(:disabled) { border-color: var(--text-1); }
  .day.on { border-color: var(--accent); background: var(--accent); color: var(--accent-text); }
  .hint, .warn { margin: 0; font-size: 10px; line-height: 1.35; }
  .hint { color: var(--text-3); }
  .warn { color: var(--warn); }
  .times { display: grid; gap: 3px; }
  .times button { padding: 4px; border: 1px solid var(--border); border-radius: var(--r-sm); font-size: var(--fs-xs); text-align: left; }
</style>
