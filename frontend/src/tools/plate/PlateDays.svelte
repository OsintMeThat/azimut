<script>
  /**
   * The days a played plate goes through, in its play bar: a notch for each, side by
   * side like chapters, so close days never pile up and a dragged handle only lands
   * on a day the plate plays. A day the play skips is drawn faint, and dots under a
   * notch count the steps it holds.
   *
   * On layers dated to the minute, **Hours** plays each moment on its own: the
   * notches of a day sit together, a wider gap before the next day, and the hour
   * shown is picked from the line under them. With more moments than the track can
   * show apart, it keeps a notch a day and lands on the hour last shown on it.
   *
   * The track is as wide as its place in the bar, whatever the day holds, and a drag
   * reads it as it stood when it began, so nothing moves under the pointer.
   *
   * With more days than it can show apart, the track holds a window of them around
   * the day shown, and a thin line under it spans them all, the window lit: a press
   * or a drag there goes anywhere, the track then picks the day. The window moves a
   * whole window at a time, only when the day shown leaves it.
   */
  import { untrack } from 'svelte';
  import Icon from '../../components/Icon.svelte';
  import MonthGrid from '../../components/MonthGrid.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import LayerPastMenu from '../satellite/LayerPastMenu.svelte';
  import { momentLabel, momentNow, spanEnds, stepMoment } from '../../lib/map/layerHistory.js';
  import { dayPart, timed } from '../../lib/plate/hours.js';

  let {
    /** The days the plate plays, or its moments played hour by hour, sorted. */
    keys = [],
    /** The day or moment shown. */
    at = null,
    /** The plate's `{ trail, since, window }`, which the past menu sets. */
    time = null,
    /** The days the video skips, drawn faint. */
    faded = [],
    /** How many steps each day or moment holds. */
    steps = {},
    /** Whether the plate plays hour by hour, and whether its layers give it the choice. */
    hours = false,
    canHours = false,
    /** The clock today is read on. */
    zone = 'UTC',
    label = "The plate's day",
    /** `(key)`: the day or moment to show. */
    onpick,
    /** `(patch)`: what the map shows of the past. */
    onchange,
    /** `(on)`: play hour by hour, or day by day. */
    onhours = null,
  } = $props();

  /** Fewer pixels than this between two notches, and a day keeps one notch. */
  const LEAST_GAP = 10;

  let width = $state(0);
  let lane = $state(null);
  let picking = $state(false);
  let dayAnchor = $state(null);
  let hourMenu = $state(false);
  let hourAnchor = $state(null);

  /** The moment last shown on each day, where a press on the day lands again. */
  const lastOn = new Map();
  $effect(() => { if (at) lastOn.set(dayPart(at), at); });

  const crowded = $derived(hours && keys.length > 1 && width > 0 && (width - 14) / (keys.length - 1) < LEAST_GAP);
  const skipped = $derived(new Set(faded));
  /** `{ day, keys, first }` per notch: a day, or a moment of it played hour by hour. */
  const notches = $derived.by(() => {
    const out = [];
    for (const key of keys) {
      const day = dayPart(key);
      const last = out.at(-1);
      if (crowded && last?.day === day) last.keys.push(key);
      else out.push({ day, keys: [key], first: last?.day !== day });
    }
    return out;
  });
  const shown = $derived(notches.findIndex((notch) => notch.keys.includes(at)));
  /** The notch the day shown is on, or the first one after it when the plate does not play it. */
  const after = $derived(shown >= 0 ? shown : at ? notches.findIndex((notch) => notch.keys[0] > at) : 0);

  // -- a window of the days, when they are too many to show apart ---------------------
  /** How many notches the track shows apart. */
  const fit = $derived(width > 0 ? Math.max(2, Math.floor((width - 14) / LEAST_GAP) + 1) : notches.length);
  const windowed = $derived(notches.length > fit);
  let start = $state(0);
  let framed = '';
  // the window takes the day shown in: centred on a new set of days, else a whole window on
  $effect(() => {
    const total = notches.length;
    const size = fit;
    const focus = after < 0 ? total - 1 : after;
    untrack(() => {
      if (total <= size) { start = 0; framed = ''; return; }
      const last = total - size;
      let next = Math.min(start, last);
      if (framed !== `${total}|${size}`) next = focus - Math.floor(size / 2);
      else if (focus < next) next = focus - size + 1;
      else if (focus >= next + size) next = focus;
      framed = `${total}|${size}`;
      start = Math.max(0, Math.min(last, next));
    });
  });
  const offset = $derived(windowed ? start : 0);
  /** The notches on the track: all of them, or the window's. */
  const view = $derived(windowed ? notches.slice(start, start + fit) : notches);

  /** Where each notch on the track stands, from 0 to 1: one gap between moments of a day, two between days. */
  const places = $derived.by(() => {
    if (view.length < 2) return view.map(() => 0.5);
    const steps = view.map((notch, index) => (index && hours && !crowded && notch.first ? 2 : index ? 1 : 0));
    const total = steps.reduce((sum, step) => sum + step, 0);
    let run = 0;
    return steps.map((step) => (run += step) / total);
  });
  /** Where the handle stands: on its notch, or between the two it falls between when the day is not played. */
  const handleAt = $derived.by(() => {
    if (!at || !view.length) return 0;
    const here = shown - offset;
    if (shown >= 0 && here >= 0 && here < view.length) return places[here];
    const next = after < 0 ? view.length : after - offset;
    if (next <= 0) return 0;
    if (next >= view.length) return 1;
    return (places[next - 1] + places[next]) / 2;
  });
  const held = (notch) => notch.keys.reduce((sum, key) => sum + (steps[key] ?? 0), 0);
  const todayIso = $derived(momentNow({ zone }));
  const onToday = $derived(dayPart(at ?? '') === todayIso);
  /** The moments of the day shown, played hour by hour. */
  const dayKeys = $derived(hours && at ? keys.filter((key) => dayPart(key) === dayPart(at)) : []);
  const hourSaid = (key) => (timed(key) ? key.slice(11) : 'Start of the day');
  const stepsSaid = (count) => (count ? `${count} step${count === 1 ? '' : 's'}` : '');

  function said(notch) {
    const count = held(notch);
    const many = notch.keys.length > 1;
    return [many ? momentLabel(notch.day) : momentLabel(notch.keys[0]), many ? `${notch.keys.length} moments` : '', stepsSaid(count),
      notch.keys.every((key) => skipped.has(key)) ? 'hidden from the video' : ''].filter(Boolean).join(', ');
  }

  /** The moment a press on a day lands on: the one last shown there, else its first. */
  function landing(list) {
    const last = lastOn.get(dayPart(list[0]));
    return list.includes(last) ? last : list[0];
  }
  const go = (key) => { if (key && key !== at) onpick?.(key); };

  /** A day of the calendar: the moment of it played last shown, else its first, else the day itself. */
  function pickDay(iso) {
    picking = false;
    if (!iso) return;
    const list = keys.filter((key) => dayPart(key) === iso);
    go(list.length ? landing(list) : iso);
  }

  function grab(event) {
    if (!view.length || !lane) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
    // the track as it stands when the drag begins: what the day holds never moves it under the pointer
    const box = lane.getBoundingClientRect();
    const list = view;
    const along = places;
    const land = (clientX) => {
      const share = (clientX - box.left) / Math.max(1, box.width);
      let best = 0;
      for (let index = 1; index < along.length; index += 1) {
        if (Math.abs(along[index] - share) < Math.abs(along[best] - share)) best = index;
      }
      go(landing(list[best].keys));
    };
    land(event.clientX);
    const move = (next) => land(next.clientX);
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }

  /** A press or a drag on the line of all the days: the day there, the window centred on it. */
  function scrub(event) {
    if (!notches.length) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
    const box = target.getBoundingClientRect();
    const list = notches;
    const size = fit;
    const land = (clientX) => {
      const share = Math.min(1, Math.max(0, (clientX - box.left) / Math.max(1, box.width)));
      const index = Math.round(share * (list.length - 1));
      start = Math.max(0, Math.min(list.length - size, index - Math.floor(size / 2)));
      go(landing(list[index].keys));
    };
    land(event.clientX);
    const move = (next) => land(next.clientX);
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }

  /** The day a page away: a window of days when they are windowed, else a week of the days played. */
  function page(direction) {
    const from = shown >= 0 ? shown : Math.max(0, direction > 0 ? after - 1 : after);
    const index = Math.max(0, Math.min(notches.length - 1, from + direction * (windowed ? fit : 7)));
    return notches[index] ? landing(notches[index].keys) : null;
  }

  /** The first moment of the day after the one shown (`direction` 1), or of the day before. */
  function nextDay(direction) {
    const day = dayPart(at ?? '');
    const days = [...new Set(keys.map(dayPart))];
    const other = direction > 0 ? days.find((item) => item > day) : days.findLast((item) => item < day);
    return other ? landing(keys.filter((key) => dayPart(key) === other)) : null;
  }

  function key(event) {
    const to = { ArrowLeft: () => stepMoment(keys, at, -1), ArrowRight: () => stepMoment(keys, at, 1),
      PageDown: () => (hours ? nextDay(-1) : page(-1)), PageUp: () => (hours ? nextDay(1) : page(1)),
      Home: () => keys[0], End: () => keys.at(-1) }[event.key];
    if (!to) return;
    event.preventDefault();
    event.stopPropagation();
    go(to());
  }
</script>

<div class="days">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="track" bind:clientWidth={width} onpointerdown={grab} title="Drag to go from day to day the plate plays">
    <span class="rail"></span>
    <div class="lane" bind:this={lane}>
      {#each view as notch, index (notch.keys[0])}
        {@const count = held(notch)}
        <span class="tick" class:on={index + offset === shown} class:first={hours && !crowded && notch.first && index > 0}
          class:faded={notch.keys.every((item) => skipped.has(item))} style:left="{places[index] * 100}%" title={said(notch)}></span>
        {#if count}
          <span class="dots" style:left="{places[index] * 100}%" aria-hidden="true">
            {#each { length: Math.min(3, count) } as _, dot (dot)}<i></i>{/each}
          </span>
        {/if}
      {/each}
      <span class="handle" class:off={shown < 0 || shown < offset || shown >= offset + view.length} style:left="{handleAt * 100}%" role="slider" tabindex="0" aria-label={label}
        aria-valuemin={0} aria-valuemax={Math.max(0, notches.length - 1)} aria-valuenow={Math.max(0, shown)}
        aria-valuetext={at ? momentLabel(at) : ''} onkeydown={key}></span>
    </div>
  </div>
  {#if keys.length > 1}
    {@const ends = spanEnds(keys[0], keys.at(-1))}
    <div class="ends">
      <span aria-hidden="true">{ends[0]}</span>
      {#if windowed}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span class="overview" onpointerdown={scrub} title={`${notches.length} days: the track shows ${momentLabel(view[0].day)} to ${momentLabel(view.at(-1).day)}. Press or drag to go anywhere`}>
          <span class="seen" style:left="{(start / notches.length) * 100}%" style:width="{(fit / notches.length) * 100}%"></span>
          {#if after >= 0}<span class="here" style:left="{(Math.max(0, after) / Math.max(1, notches.length - 1)) * 100}%"></span>{/if}
        </span>
      {/if}
      <span aria-hidden="true">{ends[1]}</span>
    </div>
  {/if}

  <div class="line">
    <button type="button" class="icon-act" aria-label={hours ? 'Previous moment' : 'Previous day'} title={hours ? 'The moment before' : 'The day before'}
      disabled={!stepMoment(keys, at, -1)} onclick={() => go(stepMoment(keys, at, -1))}><Icon name="chevronLeft" size={12} /></button>
    <button type="button" class="moment" class:open={picking} aria-expanded={picking} title="Pick a day on the calendar"
      bind:this={dayAnchor} onclick={() => (picking = !picking)}>{at ? momentLabel(dayPart(at)) : 'The page'}</button>
    {#if dayKeys.length}
      <button type="button" class="hour" aria-label="Moment of the day" aria-expanded={hourMenu} bind:this={hourAnchor}
        title="Pick another moment of this day" onclick={() => (hourMenu = !hourMenu)}>
        {hourSaid(at)}<Icon name="chevronDown" size={10} /></button>
    {/if}
    <button type="button" class="icon-act" aria-label={hours ? 'Next moment' : 'Next day'} title={hours ? 'The moment after' : 'The day after'}
      disabled={!stepMoment(keys, at, 1)} onclick={() => go(stepMoment(keys, at, 1))}><Icon name="chevronRight" size={12} /></button>
    {#if !onToday}
      <button type="button" class="text-act" title="Go to today" onclick={() => pickDay(todayIso)}>Today</button>
    {/if}
    <span class="grow"></span>
    {#if canHours}
      <button type="button" class="switch" class:on={hours} aria-pressed={hours} onclick={() => onhours?.(!hours)}
        title={hours ? 'Plays each moment on its own. Press to play day by day' : 'Plays day by day, each day as it ended. Press to play hour by hour'}>
        <Icon name="clock" size={11} />Hours</button>
    {/if}
    <LayerPastMenu {time} {at} {onchange} />
  </div>

</div>

{#if picking}
  <!-- over the page, so the bar keeps its height; a state is what was seen, so no day after today is offered -->
  <FloatingMenu anchor={dayAnchor} width={260} label="Day the plate shows" role="dialog" onclose={() => (picking = false)}>
    <MonthGrid value={dayPart(at ?? todayIso)} max={todayIso} label="Day the plate shows" onpick={pickDay} />
  </FloatingMenu>
{/if}

{#if hourMenu && dayKeys.length}
  <FloatingMenu anchor={hourAnchor} width={190} label="Moments of the day" onclose={() => (hourMenu = false)}>
    {#each dayKeys as item (item)}
      <button type="button" class="fm-item" role="menuitemradio" aria-checked={item === at} onclick={() => { hourMenu = false; go(item); }}>
        {#if item === at}<Icon name="check" size={14} />{:else}<span class="tick-room"></span>{/if}
        <span class="fm-grow">{hourSaid(item)}</span><span class="fm-said">{stepsSaid(steps[item] ?? 0)}</span></button>
    {/each}
  </FloatingMenu>
{/if}

<style>
  .days { min-width: 0; padding: 4px 0 2px; }
  .track { position: relative; height: 22px; cursor: pointer; touch-action: none; user-select: none; }
  .rail { position: absolute; left: 0; right: 0; top: 50%; height: 2px; margin-top: -1px; border-radius: 1px; background: var(--border); }
  /* the notches stand inside the track's ends, so the first and the last are reached whole */
  .lane { position: absolute; inset: 0 7px; }
  .tick { position: absolute; top: 5px; bottom: 5px; width: 2px; margin-left: -1px; border-radius: 1px; background: var(--text-3); }
  .tick.first { top: 2px; bottom: 2px; }
  .tick.on { background: var(--accent); }
  .tick.faded { opacity: .35; }
  .dots { position: absolute; bottom: 0; display: flex; gap: 1px; transform: translateX(-50%); pointer-events: none; }
  .dots i { width: 3px; height: 3px; border-radius: 50%; background: var(--text-3); }
  .handle { position: absolute; top: 1px; bottom: 1px; width: 11px; margin-left: -5px; border-radius: 3px;
    background: var(--accent); box-shadow: 0 0 0 2px var(--bg-1); cursor: ew-resize; }
  /* a day the plate does not play: the handle stands between the two it falls between */
  .handle.off { background: var(--bg-1); box-shadow: inset 0 0 0 2px var(--accent), 0 0 0 2px var(--bg-1); }
  .handle:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .ends { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: -2px; color: var(--text-3); font-size: 9.5px; font-variant-numeric: tabular-nums; }
  /* all the days, the window the track shows lit, the day shown marked; tall enough to press */
  .overview { position: relative; flex: 1; height: 10px; cursor: pointer; touch-action: none; }
  .overview::before { content: ''; position: absolute; left: 0; right: 0; top: 4px; height: 2px; border-radius: 1px; background: var(--border); }
  .seen { position: absolute; top: 3px; height: 4px; border-radius: 2px; background: var(--text-3); opacity: .6; }
  .here { position: absolute; top: 1px; width: 2px; height: 8px; margin-left: -1px; border-radius: 1px; background: var(--accent); }
  .line { display: flex; align-items: center; gap: 2px; min-height: 24px; }
  .moment { padding: 2px 6px; border-radius: var(--r-sm); color: var(--text-1); font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; cursor: pointer; white-space: nowrap; }
  .moment:hover, .moment.open { background: var(--bg-3); }
  .hour { display: inline-flex; align-items: center; gap: 3px; height: 22px; padding: 0 5px; border: 1px solid var(--border); border-radius: var(--r-sm);
    color: var(--text-1); font-size: 11px; font-variant-numeric: tabular-nums; cursor: pointer; white-space: nowrap; }
  .hour:hover, .hour[aria-expanded='true'] { border-color: var(--accent); }
  .grow { flex: 1; }
  .switch { display: inline-flex; align-items: center; gap: 4px; flex: none; height: 22px; margin-right: 4px; padding: 0 7px; border: 1px solid var(--border);
    border-radius: 999px; background: var(--bg-2); color: var(--text-3); font-size: 10.5px; cursor: pointer; white-space: nowrap; }
  .switch:hover { border-color: var(--accent); color: var(--text-1); }
  .switch.on { border-color: var(--accent); background: var(--accent-soft); color: var(--text-1); }
  .icon-act { display: grid; place-items: center; flex: none; width: 22px; height: 22px; color: var(--text-2); border-radius: var(--r-sm); cursor: pointer; }
  .icon-act:hover:not(:disabled) { background: var(--bg-3); color: var(--text-1); }
  .icon-act:disabled { opacity: .35; cursor: default; }
  .text-act { padding: 2px 4px; color: var(--text-3); font-size: 10px; cursor: pointer; }
  .text-act:hover { color: var(--text-1); text-decoration: underline; }
  .tick-room { flex: none; width: 14px; }
  .fm-said { color: var(--text-3); font-size: 10.5px; }
</style>
