<script>
  /**
   * What a map draws of a tracked layer's past, said on the button that sets it: the
   * state before, dashed, an area's gains and losses, hatched, and how long events stay.
   * The layer's cursor and a plate's days both hold it.
   */
  import Icon from '../../components/Icon.svelte';
  import MonthGrid from '../../components/MonthGrid.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import { EVENT_DAYS, momentLabel } from '../../lib/map/layerHistory.js';

  let {
    /** `{ at, trail, since, window }`. */
    time,
    /** The moment the map reads at, where a day to count from is first looked for. */
    at = null,
    onchange,
  } = $props();

  let menu = $state(false);
  let menuAnchor = $state(null);
  let sincePicking = $state(false);

  const set = (patch) => onchange?.(patch);
  /** How many days an event stays after its own, null for good. */
  const stay = $derived(time?.window ?? null);
  /** What the button says is drawn now, in a few words. */
  const pastSaid = $derived([time?.trail !== false ? 'Before' : '', time?.since ? `± ${time.since === 'previous' ? 'last' : momentLabel(time.since).replace(/ \d{4}/, '')}` : '']
    .filter(Boolean).join(' · ') || 'The past');
  const day = $derived(String(at ?? time?.at ?? '').slice(0, 10) || undefined);
</script>

<!-- a menu nobody finds sets nothing -->
<button type="button" class="past" class:set={time?.trail !== false || !!time?.since} aria-label="What the map shows of the past"
  title="Sets how the past shows: the state before, gains and losses, how long events stay"
  aria-expanded={menu} bind:this={menuAnchor} onclick={() => (menu = !menu)}>
  <span>{pastSaid}</span><Icon name="chevronDown" size={10} /></button>

{#if menu}
  <FloatingMenu anchor={menuAnchor} align="end" width={250} label="The past on the map" onclose={() => { menu = false; sincePicking = false; }}>
    <button type="button" class="fm-item" role="menuitemcheckbox" aria-checked={time?.trail !== false}
      onclick={() => set({ trail: time?.trail === false })}>
      {#if time?.trail !== false}<Icon name="check" size={14} />{:else}<span class="tick-room"></span>{/if}<span class="fm-grow">Show the state before, dashed</span></button>
    <div class="fm-sep"></div>
    <p class="fm-label">Hatch an area's gains and losses</p>
    <button type="button" class="fm-item" role="menuitemradio" aria-checked={!time?.since} onclick={() => set({ since: null })}>
      {#if !time?.since}<Icon name="check" size={14} />{:else}<span class="tick-room"></span>{/if}<span class="fm-grow">Off</span></button>
    <button type="button" class="fm-item" role="menuitemradio" aria-checked={time?.since === 'previous'} onclick={() => set({ since: 'previous' })}>
      {#if time?.since === 'previous'}<Icon name="check" size={14} />{:else}<span class="tick-room"></span>{/if}<span class="fm-grow">Since the state before</span></button>
    <button type="button" class="fm-item" role="menuitemradio" aria-checked={!!time?.since && time.since !== 'previous'}
      onclick={() => (sincePicking = !sincePicking)}>
      {#if time?.since && time.since !== 'previous'}<Icon name="check" size={14} />{:else}<span class="tick-room"></span>{/if}
      <span class="fm-grow">{time?.since && time.since !== 'previous' ? `Since ${momentLabel(time.since)}` : 'Since a day…'}</span></button>
    {#if sincePicking}
      <MonthGrid value={time?.since && time.since !== 'previous' ? time.since.slice(0, 10) : day}
        label="Count gains and losses from" onpick={(iso) => { sincePicking = false; if (iso) set({ since: iso }); }} />
    {/if}
    <div class="fm-sep"></div>
    <p class="fm-label">Events after their day</p>
    <button type="button" class="fm-item" role="menuitemradio" aria-checked={stay === null}
      title="Each event stays on the map, faded, after its day" onclick={() => set({ window: null })}>
      {#if stay === null}<Icon name="check" size={14} />{:else}<span class="tick-room"></span>{/if}<span class="fm-grow">Stay, faded</span></button>
    <button type="button" class="fm-item" role="menuitemradio" aria-checked={stay !== null}
      title="Each event leaves the map some days after its own" onclick={() => { if (stay === null) set({ window: EVENT_DAYS }); }}>
      {#if stay !== null}<Icon name="check" size={14} />{:else}<span class="tick-room"></span>{/if}<span class="fm-grow">Leave after some days</span></button>
    {#if stay !== null}
      <label class="window" title="How many days an event stays on the map after its own">
        <span>Leave after</span>
        <input type="number" min="0" max="365" step="1" aria-label="Days an event stays on the map" value={stay}
          onchange={(event) => set({ window: Math.max(0, Math.min(365, Math.round(Number(event.currentTarget.value) || 0))) })} />
        <span>days</span>
      </label>
    {/if}
  </FloatingMenu>
{/if}

<style>
  .past { display: inline-flex; align-items: center; gap: 4px; flex: none; max-width: 150px; height: 22px; padding: 0 7px; border: 1px solid var(--border);
    border-radius: 999px; background: var(--bg-2); color: var(--text-2); font-size: 10.5px; cursor: pointer; white-space: nowrap; }
  .past span { overflow: hidden; text-overflow: ellipsis; }
  .past.set { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); color: var(--text-1); }
  .past:hover, .past[aria-expanded='true'] { border-color: var(--accent); color: var(--text-1); }
  .fm-label { margin: 4px 10px 2px; color: var(--text-3); font-size: 10px; }
  .tick-room { flex: none; width: 14px; }
  .window { display: flex; align-items: center; gap: 6px; padding: 5px 10px 6px; color: var(--text-2); font-size: var(--fs-xs); }
  .window input { width: 54px; height: 24px; padding: 2px 5px; font-size: var(--fs-xs); }
</style>
