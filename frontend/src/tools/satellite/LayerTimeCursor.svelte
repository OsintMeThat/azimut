<script>
  /**
   * The moment a tracked layer is read at, in two lines of its row.
   *
   * - **the track**: one tick per day the layer changes on, and the cursor.
   *   Dragged, it moves a day at a time and catches on the nearest tick it passes
   *   near, the track read as it stood when the drag began; a double click goes back
   *   to today. Its ends say the days they stand on, with their years when the
   *   track runs over more than one;
   * - **the line under it**: the moment, pressed for a calendar (and the time,
   *   on a layer dated to the minute), the steps to the previous and the next
   *   change, Today, and what is drawn beside the layer (`LayerPastMenu`).
   *
   * Every map reads the same cursor (`addedLayers.setTime`), so moving it in the
   * Map moves the layer in Compare and Detect too.
   *
   * The cursor is always on a day of the calendar, today on the layer's clock until
   * it is moved: an edit made on it is dated that day, and never slides to the next.
   */
  import Icon from '../../components/Icon.svelte';
  import MonthGrid from '../../components/MonthGrid.svelte';
  import LayerClock from './LayerClock.svelte';
  import LayerPastMenu from './LayerPastMenu.svelte';
  import { dayNumber, isoDay } from '../../lib/map/layerDates.js';
  import { moment, momentLabel, momentNow, spanEnds, stepMoment } from '../../lib/map/layerHistory.js';

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
  // the axis runs from the first change to today, or to the day shown when that is later; never spread, a layer may change on many days
  const first = $derived((days.length ? days.reduce((low, day) => Math.min(low, day)) : today) - 1);
  const last = $derived(Math.max(days.length ? days.reduce((high, day) => Math.max(high, day)) : today, today, cursorDay) + 1);
  const span = $derived(Math.max(1, last - first));
  const place = (day) => ((day - first) / span) * 100;
  /** One tick a day, however many changes it holds, the one shown lit. */
  const ticks = $derived.by(() => {
    const byDay = new Map();
    for (const item of moments) {
      const day = dayNumber(item.slice(0, 10));
      if (day === null) continue;
      const tick = byDay.get(day) ?? { day, first: item, count: 0, on: false };
      tick.count += 1;
      tick.on ||= item === at;
      byDay.set(day, tick);
    }
    return [...byDay.values()];
  });
  let track = $state(null);
  let picking = $state(false);
  let clock = $state('');
  $effect(() => { clock = at.includes('T') ? at.slice(11) : ''; });

  const set = (patch) => onchange?.(patch);
  const go = (value) => { if (value) set({ at: value }); };

  /** A day of the axis as the cursor holds it: today is the moment it is, never a day ahead. */
  const dayOn = (day) => (day >= today ? nowOn() : isoDay(day));

  /**
   * A day dragged to, or the change nearest to it within six pixels, on the track as
   * `box` says it stood: on a crowded track the first change in reach would be days off.
   */
  function snapped(clientX, box) {
    let near = null;
    let gap = 6;
    for (const item of moments) {
      const day = dayNumber(item.slice(0, 10));
      const off = day === null ? Infinity : Math.abs(box.left + (place(day) / 100) * box.width - clientX);
      if (off < gap || (off === gap && !near)) { near = item; gap = off; }
    }
    if (near) return near;
    const day = Math.round(first + ((clientX - box.left) / Math.max(1, box.width)) * span);
    return dayOn(Math.min(last - 1, Math.max(first + 1, day)));
  }

  function grab(event) {
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
    // the track as it stands when the drag begins
    const box = track.getBoundingClientRect();
    go(snapped(event.clientX, box));
    const move = (next) => go(snapped(next.clientX, box));
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
    {#each ticks as tick (tick.day)}
      <span class="tick" class:on={tick.on} style:left="{place(tick.day)}%"
        title={tick.count > 1 ? `${momentLabel(isoDay(tick.day))}, ${tick.count} changes` : momentLabel(tick.first)}></span>
    {/each}
    <span class="handle" style:left="{place(cursorDay)}%" role="slider" tabindex="0" aria-label={label}
      aria-valuemin={first} aria-valuemax={last} aria-valuenow={cursorDay}
      aria-valuetext={momentLabel(at)} onkeydown={key}></span>
  </div>
  {#if moments.length}
    <!-- the days the ends stand on: the first change, and today or the day shown when later -->
    <div class="ends" aria-hidden="true">{#each spanEnds(isoDay(first + 1), isoDay(last - 1)) as end, index (index)}<span>{end}</span>{/each}</div>
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
    <LayerPastMenu {time} {at} onchange={set} />
  </div>
  {#if precision === 'time'}
    <LayerClock value={clock} {zone} onchange={pickClock} />
  {/if}

  {#if picking}
    <!-- a state is what was seen, so no day after today is offered -->
    <MonthGrid value={at.slice(0, 10)} max={todayIso} label="Day the layer is read at" onpick={pickDay} />
  {/if}
</div>

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
  .icon-act { display: grid; place-items: center; flex: none; width: 22px; height: 22px; color: var(--text-2); border-radius: var(--r-sm); cursor: pointer; }
  .icon-act:hover:not(:disabled) { background: var(--bg-3); color: var(--text-1); }
  .icon-act:disabled { opacity: .35; cursor: default; }
  .text-act { padding: 2px 4px; color: var(--text-3); font-size: 10px; cursor: pointer; }
  .text-act:hover { color: var(--text-1); text-decoration: underline; }
</style>
