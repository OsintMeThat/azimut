<script>
  /**
   * The moment a tracked layer is read at, in two lines of its row.
   *
   * - **the track**: one tick per moment the layer changes at, and the cursor.
   *   Dragged, it moves a day at a time and catches on a tick it passes near; a
   *   double click goes back to today;
   * - **the line under it**: the moment, pressed for a calendar (and the time,
   *   on a layer dated to the minute), the steps to the previous and the next
   *   change, Today, and what is drawn beside the layer: the state before, dashed,
   *   an area's gains and losses, hatched, and how long events stay.
   *
   * Every map reads the same cursor (`addedLayers.setTime`), so moving it in the
   * Map moves the layer in Compare and Detect too.
   *
   * The cursor is always on a day of the calendar, today on the layer's clock until
   * it is moved: an edit made on it is dated that day, and never slides to the next.
   */
  import Icon from '../../components/Icon.svelte';
  import MonthGrid from '../../components/MonthGrid.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import { dayNumber, isoDay } from '../../lib/map/layerDates.js';
  import { EVENT_DAYS, moment, momentLabel, momentNow, stepMoment } from '../../lib/map/layerHistory.js';

  let {
    /** `{ at, trail, since, window }`: null `at` is today, null `window` keeps events for good. */
    time,
    /** The moments the layer changes at, sorted. */
    moments = [],
    /** `'day'` or `'time'`. */
    precision = 'day',
    /** The clock the moments are on, named under a layer dated to the minute. */
    zone = 'UTC',
    label = 'Layer moment',
    onchange,
  } = $props();

  /** The moment it is on the layer's clock, asked when it is needed. */
  const nowOn = () => momentNow({ precision, zone });
  const todayIso = $derived(momentNow({ zone }));
  const today = $derived(dayNumber(todayIso));
  const at = $derived(time?.at ?? nowOn());
  const onToday = $derived(at.slice(0, 10) === todayIso);
  const days = $derived(moments.map((item) => dayNumber(item.slice(0, 10))).filter((day) => day !== null));
  const cursorDay = $derived(dayNumber(at.slice(0, 10)) ?? today);
  // the axis runs from the first change to today, or to the day shown when that is later
  const first = $derived((days.length ? Math.min(...days) : today) - 1);
  const last = $derived(Math.max(days.length ? Math.max(...days) : today, today, cursorDay) + 1);
  const span = $derived(Math.max(1, last - first));
  const place = (day) => ((day - first) / span) * 100;
  /** How many days an event stays after its own, null for good. */
  const stay = $derived(time?.window ?? null);

  let track = $state(null);
  let picking = $state(false);
  let clock = $state('');
  let menu = $state(false);
  let menuAnchor = $state(null);
  let sincePicking = $state(false);
  $effect(() => { clock = at.includes('T') ? at.slice(11) : ''; });

  const set = (patch) => onchange?.(patch);
  /** What the past button says is drawn now, in a few words. */
  const pastSaid = $derived([time?.trail !== false ? 'Before' : '', time?.since ? `± ${time.since === 'previous' ? 'last' : momentLabel(time.since).replace(/ \d{4}/, '')}` : '']
    .filter(Boolean).join(' · ') || 'The past');
  const go = (value) => { if (value) set({ at: value }); };

  /** A day of the axis as the cursor holds it: today is the moment it is, never a day ahead. */
  const dayOn = (day) => (day >= today ? nowOn() : isoDay(day));

  function dayAt(clientX) {
    const box = track.getBoundingClientRect();
    return Math.round(first + ((clientX - box.left) / Math.max(1, box.width)) * span);
  }

  /** A day dragged to, or the change it passed near: within six pixels it catches. */
  function snapped(clientX) {
    const box = track.getBoundingClientRect();
    const near = moments.find((item) => {
      const day = dayNumber(item.slice(0, 10));
      return day !== null && Math.abs(box.left + (place(day) / 100) * box.width - clientX) <= 6;
    });
    if (near) return near;
    return dayOn(Math.min(last - 1, Math.max(first + 1, dayAt(clientX))));
  }

  function grab(event) {
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
    go(snapped(event.clientX));
    const move = (next) => go(snapped(next.clientX));
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }

  function key(event) {
    const step = { ArrowLeft: -1, ArrowRight: 1, PageDown: -7, PageUp: 7 }[event.key];
    if (event.key === 'Home') { event.preventDefault(); go(moments[0]); return; }
    if (event.key === 'End') { event.preventDefault(); go(nowOn()); return; }
    if (step === undefined) return;
    event.preventDefault();
    go(dayOn(cursorDay + step));
  }

  function pickDay(iso) {
    picking = false;
    if (!iso) return;
    go(precision === 'time' && clock ? `${iso}T${clock}` : iso);
  }

  function pickClock(value) {
    clock = value;
    const day = at.slice(0, 10);
    const next = moment(value ? `${day}T${value}` : day);
    if (next) go(next);
  }
</script>

<div class="cursor">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="track" bind:this={track} onpointerdown={grab} ondblclick={() => go(nowOn())}
    title="Drag to read the layer at another day. Double-click goes back to today.">
    <span class="rail"></span>
    {#each moments as item (item)}
      {@const day = dayNumber(item.slice(0, 10))}
      {#if day !== null}<span class="tick" class:on={item === at} style:left="{place(day)}%" title={momentLabel(item)}></span>{/if}
    {/each}
    <span class="handle" style:left="{place(cursorDay)}%" role="slider" tabindex="0" aria-label={label}
      aria-valuemin={first} aria-valuemax={last} aria-valuenow={cursorDay}
      aria-valuetext={momentLabel(at)} onkeydown={key}></span>
  </div>
  {#if moments.length > 1}
    <div class="ends" aria-hidden="true"><span>{momentLabel(moments[0]).replace(/ \d{4}$/, '')}</span><span>{momentLabel(moments.at(-1)).replace(/ \d{4}$/, '')}</span></div>
  {/if}

  <div class="line">
    <button type="button" class="icon-act" aria-label="Previous change" title="Previous change"
      disabled={!stepMoment(moments, at, -1)} onclick={() => go(stepMoment(moments, at, -1))}><Icon name="chevronLeft" size={12} /></button>
    <button type="button" class="moment" class:open={picking} aria-expanded={picking} title="Pick the day the layer is read at"
      onclick={() => (picking = !picking)}>{momentLabel(at)}</button>
    <button type="button" class="icon-act" aria-label="Next change" title="Next change"
      disabled={!stepMoment(moments, at, 1)} onclick={() => go(stepMoment(moments, at, 1))}><Icon name="chevronRight" size={12} /></button>
    {#if !onToday}
      <button type="button" class="text-act" title="Read the layer as it is today" onclick={() => go(nowOn())}>Today</button>
    {/if}
    <span class="grow"></span>
    <!-- what the map draws of the past, said on the button that sets it: a menu nobody finds sets nothing -->
    <button type="button" class="past" class:set={time?.trail !== false || !!time?.since} aria-label="What the map shows of the past"
      title="The state before, dashed; an area's gains and losses, hatched; how long events stay"
      aria-expanded={menu} bind:this={menuAnchor} onclick={() => (menu = !menu)}>
      <span>{pastSaid}</span><Icon name="chevronDown" size={10} /></button>
  </div>
  {#if precision === 'time'}
    <label class="clock">
      <span>Time</span>
      <input type="time" aria-label="Time of day" value={clock}
        onchange={(event) => pickClock(event.currentTarget.value)} />
      <span class="zone">{zone === 'UTC' ? 'UTC' : zone.split('/').at(-1).replaceAll('_', ' ')}</span>
    </label>
  {/if}

  {#if picking}
    <!-- a state is what was seen, so no day after today is offered -->
    <MonthGrid value={at.slice(0, 10)} max={todayIso} label="Day the layer is read at" onpick={pickDay} />
  {/if}
</div>

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
      <MonthGrid value={time?.since && time.since !== 'previous' ? time.since.slice(0, 10) : at.slice(0, 10)}
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
  .cursor { padding: 4px 4px 2px 30px; }
  .track { position: relative; height: 22px; cursor: crosshair; touch-action: none; user-select: none; }
  .rail { position: absolute; left: 0; right: 0; top: 50%; height: 2px; margin-top: -1px; border-radius: 1px; background: var(--border); }
  .tick { position: absolute; top: 5px; bottom: 5px; width: 2px; margin-left: -1px; border-radius: 1px; background: var(--text-3); }
  .tick.on { background: var(--accent); }
  .handle { position: absolute; top: 1px; bottom: 1px; width: 11px; margin-left: -5px; border-radius: 3px;
    background: var(--accent); box-shadow: 0 0 0 2px var(--bg-1); cursor: ew-resize; }
  .handle:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .line { display: flex; align-items: center; gap: 2px; min-height: 24px; }
  .ends { display: flex; justify-content: space-between; margin-top: -2px; color: var(--text-3); font-size: 9.5px; font-variant-numeric: tabular-nums; }
  .moment { padding: 2px 6px; border-radius: var(--r-sm); color: var(--text-1); font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; cursor: pointer; }
  .moment:hover, .moment.open { background: var(--bg-3); }
  .grow { flex: 1; }
  .past { display: inline-flex; align-items: center; gap: 4px; flex: none; max-width: 150px; height: 22px; padding: 0 7px; border: 1px solid var(--border);
    border-radius: 999px; background: var(--bg-2); color: var(--text-2); font-size: 10.5px; cursor: pointer; white-space: nowrap; }
  .past span { overflow: hidden; text-overflow: ellipsis; }
  .past.set { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); color: var(--text-1); }
  .past:hover, .past[aria-expanded='true'] { border-color: var(--accent); color: var(--text-1); }
  .icon-act { display: grid; place-items: center; flex: none; width: 22px; height: 22px; color: var(--text-2); border-radius: var(--r-sm); cursor: pointer; }
  .icon-act:hover:not(:disabled) { background: var(--bg-3); color: var(--text-1); }
  .icon-act:disabled { opacity: .35; cursor: default; }
  .text-act { padding: 2px 4px; color: var(--text-3); font-size: 10px; cursor: pointer; }
  .text-act:hover { color: var(--text-1); text-decoration: underline; }
  .clock { display: flex; align-items: center; gap: 6px; padding: 2px 0 2px 2px; color: var(--text-3); font-size: 10px; }
  .clock input { height: 22px; padding: 1px 4px; font-size: 11px; }
  .zone { color: var(--text-3); }
  .fm-label { margin: 4px 10px 2px; color: var(--text-3); font-size: 10px; }
  .tick-room { flex: none; width: 14px; }
  .window { display: flex; align-items: center; gap: 6px; padding: 5px 10px 6px; color: var(--text-2); font-size: var(--fs-xs); }
  .window input { width: 54px; height: 24px; padding: 2px 5px; font-size: var(--fs-xs); }
</style>
