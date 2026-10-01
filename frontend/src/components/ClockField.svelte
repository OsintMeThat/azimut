<script>
  /**
   * Which clock a stated date was read on: the one control every date field uses.
   *
   * A day in Kharkiv is not UTC's day, and a 14:30 read off a caption is nobody's
   * instant until its clock is known. So the field says the clock it reads on, and one
   * press opens every answer in a single searchable list:
   *
   * - **Here**, the zones of the places the entry is tied to;
   * - **The case's clock**, the one its Timeline axis reads on (`lib/caseAxis.svelte.js`);
   * - **Lately**, the zones picked in this case, since a case is argued on a few clocks;
   * - **UTC**, and **this computer**;
   * - **Clock unknown**, for a time only: it stays off the axis until one is known;
   * - **Anywhere in the world**, by search.
   *
   * The pick goes to the parent, which stores it through `lib/clock.js`.
   */
  import { caseState } from '../lib/state.svelte.js';
  import { UTC, clockInstant, recentClocks, rememberClockPick } from '../lib/clock.js';
  import { axisZone } from '../lib/caseAxis.svelte.js';
  import { machineZone, offsetLabel, worldZones, zoneMatches, zoneWords } from '../lib/timeline.js';
  import { anchoredPanel } from '../lib/anchoredPanel.js';
  import Icon from './Icon.svelte';
  import SearchInput from './SearchInput.svelte';

  let {
    /** The value the clock is for, which sets the day the offsets are shown on. */
    value = '',
    /** What it reads on now, `{ zone, fixed }` (see `clockOf`). */
    clock = { zone: UTC, fixed: '' },
    /** The zones of the places the entry is tied to, `{ zone, place }`. */
    here = [],
    /** Whether the value has a time of day, so its clock can be left unknown. */
    timed = false,
    disabled = false,
    /** Told the pick: a zone name, `UTC`, or null for an unknown clock. The second
     *  argument says whether it was one of the entry's own places. */
    onpick,
  } = $props();

  const uid = $props.id();
  /** How many zones the list shows before it asks for a narrower term. */
  const ROWS = 40;

  let open = $state(false);
  let query = $state('');
  let trigger = $state();
  let menu = $state();

  const at = $derived(clockInstant(value));
  const local = machineZone();
  const zones = worldZones();
  const axis = $derived(axisZone(caseState.current?.id));
  const caseRow = $derived(axis !== UTC && !here.some((entry) => entry.zone === axis));
  const recent = $derived(
    open
      ? recentClocks(caseState.current?.id).filter((zone) => zone !== axis && !here.some((entry) => entry.zone === zone))
      : [],
  );
  const matching = $derived(zones.filter((zone) => zoneMatches(zone, query, at)));
  const shown = $derived(matching.slice(0, ROWS));
  const term = $derived(query.trim().toLowerCase());
  const hereShown = $derived(
    here.filter((entry) => zoneMatches(entry.zone, query, at) || entry.place.toLowerCase().includes(term)),
  );

  const place = $derived(here.find((entry) => entry.zone === clock.zone)?.place ?? '');
  /** What the button says: the place's name, the zone's, or the offset the value carries. */
  const label = $derived(
    clock.fixed ? `UTC${clock.fixed}`
      : !clock.zone ? 'Clock unknown'
        : clock.zone === UTC ? UTC
          : place || zoneWords(clock.zone).place,
  );
  const offset = $derived(clock.zone && clock.zone !== UTC && !clock.fixed ? offsetLabel(clock.zone, at) : '');
  const title = $derived(
    clock.fixed ? 'An offset written in the date, with no zone named'
      : !clock.zone ? 'No clock yet, so the time stays off the axis'
        : place ? `Local time at ${place} (${clock.zone})`
          : clock.zone === UTC ? 'Read on UTC' : `Read on ${clock.zone}`,
  );

  $effect(() => {
    if (!open || typeof document === 'undefined') return;
    const closeOutside = (event) => {
      if (!trigger?.contains(event.target) && !menu?.contains(event.target)) open = false;
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  });

  function pick(zone, { isHere = false } = {}) {
    open = false;
    query = '';
    rememberClockPick(caseState.current?.id, zone);
    onpick?.(zone, { here: isHere });
  }

  function onKey(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      open = false;
      trigger?.focus();
    }
  }
</script>

<button
  bind:this={trigger}
  type="button"
  class="clock-trigger"
  {disabled}
  aria-expanded={open}
  aria-controls="{uid}-clock"
  aria-label="Clock: {label}{offset ? ` ${offset}` : ''}"
  {title}
  onclick={() => (open = !open)}
>
  <Icon name="clock" size={12} />
  <span>{label}</span>
  {#if offset}<small>{offset}</small>{/if}
</button>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={menu}
    id="{uid}-clock"
    class="clock-menu"
    popover="manual"
    use:anchoredPanel={{ anchor: () => trigger, width: 280 }}
    onkeydown={onKey}
  >
    <SearchInput bind:value={query} placeholder="Search a zone or a city…" width="100%" />
    <div class="rows">
      {#each hereShown as entry (entry.zone)}
        <button class:on={clock.zone === entry.zone && !clock.fixed} onclick={() => pick(entry.zone, { isHere: true })}>
          <span>Local at {entry.place}</span><small>{entry.zone} · {offsetLabel(entry.zone, at)}</small>
        </button>
      {/each}
      {#if caseRow && (zoneMatches(axis, query, at) || "the case's clock".includes(term))}
        <button class:on={clock.zone === axis && !clock.fixed && !place} onclick={() => pick(axis)}>
          <span>{zoneWords(axis).place}</span><small>the case's clock · {offsetLabel(axis, at)}</small>
        </button>
      {/if}
      {#each recent.filter((zone) => zoneMatches(zone, query, at)) as zone (zone)}
        <button class:on={clock.zone === zone && !clock.fixed} onclick={() => pick(zone)}>
          <span>{zoneWords(zone).place}</span><small>used lately · {offsetLabel(zone, at)}</small>
        </button>
      {/each}
      {#if zoneMatches(UTC, query, at)}
        <button class:on={clock.zone === UTC} onclick={() => pick(UTC)}>
          <span>UTC</span><small>the same everywhere</small>
        </button>
      {/if}
      {#if local !== UTC && local !== axis && zoneMatches(local, query, at)}
        <button class:on={clock.zone === local && !place} onclick={() => pick(local)}>
          <span>{zoneWords(local).place}</span><small>this computer · {offsetLabel(local, at)}</small>
        </button>
      {/if}
      {#if timed && (!term || 'clock unknown'.includes(term))}
        <button class:on={!clock.zone && !clock.fixed} onclick={() => pick(null)}>
          <span>Clock unknown</span><small>stays off the axis</small>
        </button>
      {/if}

      {#if zones.length}
        <p class="heading">Anywhere in the world</p>
        {#each shown as zone (zone)}
          {@const words = zoneWords(zone)}
          <button class:on={clock.zone === zone && !clock.fixed && !place} onclick={() => pick(zone)}>
            <span>{words.place}</span><small>{words.region} · {offsetLabel(zone, at)}</small>
          </button>
        {/each}
        {#if matching.length > shown.length}
          <p class="more">{matching.length - shown.length} more. Keep typing.</p>
        {:else if !matching.length && !hereShown.length}
          <p class="more">No zone matches that.</p>
        {/if}
      {:else}
        <p class="more">This browser cannot list world zones. UTC and this computer still work.</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .clock-trigger {
    display: inline-flex; align-items: center; justify-self: start; gap: 5px; height: 24px; max-width: 100%;
    padding: 0 7px; border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-2); color: var(--text-2); font-size: var(--fs-xs); cursor: pointer;
  }
  .clock-trigger:hover:not(:disabled) { border-color: var(--border-strong); color: var(--text-1); }
  .clock-trigger:disabled { opacity: .5; cursor: default; }
  .clock-trigger span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .clock-trigger small { color: var(--text-3); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .clock-menu {
    position: fixed; inset: auto; margin: 0; z-index: 60;
    display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 5px; padding: 7px;
    border: 1px solid var(--border-strong); border-radius: var(--r-md);
    background: var(--bg-1); color: var(--text-1); box-shadow: var(--shadow-2);
  }
  .rows { max-height: 260px; overflow: auto; }
  .rows > button {
    width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) auto;
    align-items: baseline; gap: 8px; padding: 5px 6px; border: 0; border-radius: var(--r-sm);
    background: none; color: var(--text-2); font-size: var(--fs-xs); text-align: left;
    cursor: pointer;
  }
  .rows > button:hover { background: var(--bg-2); color: var(--text-1); }
  .rows > button.on { background: var(--accent-soft); color: var(--text-1); }
  .rows > button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rows > button small { color: var(--text-3); font-size: 10px; white-space: nowrap; }
  .heading { margin: 7px 0 3px; padding: 0 6px; color: var(--text-3); font-size: 10px; }
  .more { margin: 5px 0 2px; padding: 0 6px; color: var(--text-3); font-size: 10px; }
</style>
