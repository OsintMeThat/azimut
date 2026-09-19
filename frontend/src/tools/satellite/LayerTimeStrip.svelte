<script>
  /**
   * An added layer's time filter: its events over time as a strip of bars, and
   * the period kept, in two lines of the row.
   *
   * Everything is done on the strip itself, so it needs no room of its own:
   *
   * - **a handle** at each end of the period, dragged, or moved a day at a time
   *   with the arrow keys (a week with Page Up and Page Down);
   * - **the band** between them, dragged to slide the period along whole;
   * - **the bars**: dragged across to draw a new period, clicked to keep one
   *   bar's day, week or month; a double click lets everything back in;
   * - **the two dates** under it, each opening a calendar for the exact day.
   *
   * The period is shown on the map while it is dragged (`oninput`) and kept on
   * the layer when the pointer lets go (`onchange`). A bound left on the layer's
   * own first or last day stays open (`periodFrom`), so a followed layer's new
   * events are not filtered out by a period nobody narrowed.
   */
  import Icon from '../../components/Icon.svelte';
  import MonthGrid from '../../components/MonthGrid.svelte';
  import {
    active,
    bars,
    dayLabel,
    dayNumber,
    histogram,
    isoDay,
    periodFrom,
    span,
  } from '../../lib/map/layerDates.js';

  let {
    /** `indexDates` of the layer's features. */
    index,
    /** Groups the legend switched off, which the bars leave out. */
    hidden = [],
    /** `{ start, end }`, or null for every date. */
    period = null,
    /** Names the strip for a reader that cannot see the row. */
    label = 'Dates',
    oninput,
    onchange,
  } = $props();

  const first = $derived(index.first);
  const last = $derived(index.last);
  const days = $derived(last - first + 1);
  const edges = $derived(bars(first, last));
  const counts = $derived(histogram(index, hidden, edges));
  const peak = $derived(Math.max(1, ...counts));

  /** The period while a pointer is moving it, ahead of what the row holds. */
  let draft = $state(null);
  const kept = $derived.by(() => {
    const { from, to } = span(period, index);
    return { from: Math.max(first, from), to: Math.min(last, to) };
  });
  const shown = $derived(draft ?? kept);
  const on = $derived(draft ? true : active(period));

  let track = $state(null);
  /** Which date's calendar is open: 'start', 'end' or ''. */
  let picking = $state('');

  const place = (day) => ((day - first) / days) * 100;

  function dayAt(clientX) {
    const box = track.getBoundingClientRect();
    const share = (clientX - box.left) / Math.max(1, box.width);
    return first + Math.min(days - 1, Math.max(0, Math.floor(share * days)));
  }

  /** One frame's worth of map updates, however fast the pointer moves. */
  let frame = 0;
  function preview(from, to) {
    draft = { from: Math.min(from, to), to: Math.max(from, to) };
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (draft) oninput?.(periodFrom(draft.from, draft.to, index));
    });
  }

  function commit(from, to) {
    draft = null;
    onchange?.(periodFrom(from, to, index));
  }

  /**
   * A drag, whichever part of the strip it started on. `move` turns the day
   * under the pointer into the period so far; a press that never moved is a
   * click, answered by `click` when one is given.
   */
  function drag(event, move, click) {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
    const startX = event.clientX;
    let moved = false;
    const onmove = (next) => {
      if (!moved && Math.abs(next.clientX - startX) < 3) return;
      moved = true;
      const [from, to] = move(dayAt(next.clientX));
      preview(from, to);
    };
    const onup = (next) => {
      target.removeEventListener('pointermove', onmove);
      target.removeEventListener('pointerup', onup);
      target.removeEventListener('pointercancel', onup);
      if (moved && draft) commit(draft.from, draft.to);
      else {
        draft = null;
        click?.(dayAt(next.clientX));
      }
    };
    target.addEventListener('pointermove', onmove);
    target.addEventListener('pointerup', onup);
    target.addEventListener('pointercancel', onup);
  }

  function grabHandle(event, which) {
    const { from, to } = shown;
    drag(event, (day) => (which === 'start' ? [day, to] : [from, day]));
  }

  function grabBand(event) {
    const { from, to } = shown;
    const width = to - from;
    const anchor = dayAt(event.clientX);
    drag(event, (day) => {
      const start = Math.min(last - width, Math.max(first, from + day - anchor));
      return [start, start + width];
    });
  }

  function grabTrack(event) {
    const anchor = dayAt(event.clientX);
    drag(
      event,
      (day) => [anchor, day],
      (day) => {
        const bar = edges.find((edge) => day >= edge.from && day <= edge.to);
        if (bar) commit(bar.from, bar.to);
      }
    );
  }

  function nudge(event, which) {
    const step = { ArrowLeft: -1, ArrowRight: 1, PageDown: -7, PageUp: 7 }[event.key];
    const edge = { Home: first, End: last }[event.key];
    if (step === undefined && edge === undefined) return;
    event.preventDefault();
    const { from, to } = kept;
    const clamp = (day) => Math.min(last, Math.max(first, day));
    if (which === 'start') commit(clamp(edge ?? from + step), to);
    else commit(from, clamp(edge ?? to + step));
  }

  function pick(which, iso) {
    picking = '';
    const day = dayNumber(iso);
    if (day === null) return;
    if (which === 'start') commit(day, Math.max(day, kept.to));
    else commit(Math.min(day, kept.from), day);
  }
</script>

<div class="strip" class:on>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="track"
    bind:this={track}
    onpointerdown={grabTrack}
    ondblclick={() => onchange?.(null)}
    title="Drag across the bars to pick dates"
  >
    <svg viewBox="0 0 {days} 1" preserveAspectRatio="none" aria-hidden="true">
      {#each edges as edge, i (edge.from)}
        {@const height = counts[i] ? Math.max(0.1, counts[i] / peak) : 0}
        <rect
          class:inside={edge.to >= shown.from && edge.from <= shown.to}
          x={edge.from - first + (edge.to - edge.from + 1) * 0.1}
          y={1 - height}
          width={(edge.to - edge.from + 1) * 0.8}
          {height}
        />
      {/each}
    </svg>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="band"
      style:left="{place(shown.from)}%"
      style:width="{place(shown.to + 1) - place(shown.from)}%"
      onpointerdown={grabBand}
    ></div>
    {#each ['start', 'end'] as which (which)}
      {@const day = which === 'start' ? shown.from : shown.to + 1}
      <div
        class="handle"
        style:left="{place(day)}%"
        role="slider"
        tabindex="0"
        aria-label={which === 'start' ? `${label}: first day` : `${label}: last day`}
        aria-valuemin={first}
        aria-valuemax={last}
        aria-valuenow={which === 'start' ? shown.from : shown.to}
        aria-valuetext={dayLabel(isoDay(which === 'start' ? shown.from : shown.to))}
        onpointerdown={(event) => grabHandle(event, which)}
        onkeydown={(event) => nudge(event, which)}
      ></div>
    {/each}
  </div>

  <div class="dates">
    <button
      type="button"
      class="day"
      class:open={picking === 'start'}
      title="Pick the first day"
      onclick={() => (picking = picking === 'start' ? '' : 'start')}
    >{dayLabel(isoDay(shown.from))}</button>
    <span class="dash">–</span>
    <button
      type="button"
      class="day"
      class:open={picking === 'end'}
      title="Pick the last day"
      onclick={() => (picking = picking === 'end' ? '' : 'end')}
    >{dayLabel(isoDay(shown.to))}</button>
    {#if on}
      <button
        type="button"
        class="clear"
        title="Show every date"
        aria-label="Show every date"
        onclick={() => {
          picking = '';
          onchange?.(null);
        }}
      ><Icon name="x" size={10} /></button>
    {/if}
  </div>

  {#if picking}
    <MonthGrid
      value={isoDay(picking === 'start' ? kept.from : kept.to)}
      min={isoDay(first)}
      max={isoDay(last)}
      label={picking === 'start' ? 'First day' : 'Last day'}
      onpick={(iso) => pick(picking, iso)}
    />
  {/if}
</div>

<style>
  .strip {
    padding: 4px 4px 0 30px;
  }
  .track {
    position: relative;
    height: 22px;
    cursor: crosshair;
    touch-action: none;
    user-select: none;
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  rect {
    fill: var(--text-3);
    opacity: 0.35;
  }
  .on rect.inside,
  rect.inside {
    fill: var(--accent);
    opacity: 0.85;
  }
  .strip:not(.on) rect.inside {
    fill: var(--text-2);
    opacity: 0.6;
  }
  /* Only a period can be slid: with none set the band spans everything, and it
     must not swallow the drag that draws the first one. */
  .band {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: 2px;
    pointer-events: none;
  }
  .on .band {
    background: var(--accent-soft);
    pointer-events: auto;
    cursor: grab;
  }
  .handle {
    position: absolute;
    top: -2px;
    bottom: -2px;
    width: 9px;
    margin-left: -4px;
    cursor: ew-resize;
  }
  /* The grip is drawn inside a wider hit area, so it is easy to catch and thin
     to look at. */
  .handle::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 3px;
    width: 3px;
    border-radius: 2px;
    background: var(--text-3);
  }
  .on .handle::after,
  .handle:hover::after,
  .handle:focus-visible::after {
    background: var(--accent);
  }
  .handle:focus-visible {
    outline: none;
  }
  .dates {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 2px;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    color: var(--text-3);
  }
  .day {
    padding: 0 2px;
    border-radius: var(--r-sm);
    color: inherit;
    cursor: pointer;
  }
  .day:hover,
  .day.open {
    color: var(--text-1);
    background: var(--bg-3);
  }
  .on .day {
    color: var(--accent);
  }
  .clear {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    margin-left: auto;
    border-radius: var(--r-sm);
    color: var(--text-3);
    cursor: pointer;
  }
  .clear:hover {
    color: var(--text-1);
    background: var(--bg-3);
  }
</style>
