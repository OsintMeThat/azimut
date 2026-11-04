<script>
  /**
   * The steps of the plate's day, in its play bar beside the days: the day itself
   * first, then each step in the order it is played. A press shows one; what is added then
   * belongs to it. **+** adds a step after the one shown. A step is dragged to
   * another place, and its ⋯, always in sight, names it, sets how long it holds, cuts straight into it
   * when the video's transitions are on, duplicates it, or removes it with what stands on it.
   *
   * A day the play does not go through (no layer changes on it, no steps) says so, and a
   * press on it adds it to the play; its ⋯ lets a day added that way go again. A day the
   * play goes through can be hidden from the video from its ⋯: the editor still shows it
   * and its steps, dashed, and the play and every export skip them.
   *
   * Every tile says how long it holds in the video, and a press on that time sets it:
   * the day its own seconds or the plate's, a step its own, never shorter than its
   * longest clip (held longer, the clip stays on its last frame).
   *
   * The day's tile and **+** stay put while the steps scroll between them, under the
   * wheel too, the one shown kept in the middle. When they no longer fit, the tiles
   * shrink to their number and time, an arrow each side says how many are out of
   * sight, and a count says which one is shown. The strip is as tall whatever the day
   * holds, and the arrows stay put while it scrolls.
   */
  import { tick } from 'svelte';
  import Icon from '../../components/Icon.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import { fileUrl } from '../../lib/fileUrl.js';
  import { LEAST_SECONDS, MOST_SECONDS, boundSeconds, clipRange, clipsOf, leastSeconds, stepSeconds, timecode } from '../../lib/plate/clip.js';

  let {
    /** The day's steps, in order. */
    steps = [],
    /** The step shown, or null for the day itself. */
    current = null,
    /** The day as the first tile names it, and as the plate keeps it: the strip starts again on another. */
    dayLabel = 'The day',
    day = '',
    /** How long the day holds, whether that is its own time, and the plate's for every day without one. */
    daySeconds = 1,
    dayOwn = false,
    plateSeconds = 1,
    elements = [],
    caseId = '',
    onpick,
    onadd,
    onremove,
    /** `(id, index)`: the step moved to that place. */
    onmove,
    /** `(id)`: a copy of the step played right after it. */
    onduplicate = null,
    /** `(id, patch)`: the step renamed, held longer, or cut straight into. */
    onchange,
    /** `(seconds)`: the day held its own seconds, or the plate's again with null. */
    ondayhold = null,
    /** The video's transitions are on, so a step can do without its own or take its own time. */
    transitions = false,
    /** How long the plate's transitions last, which a step takes unless it says otherwise. */
    transitionSeconds = 0.8,
    /** Whether the play goes through the day shown, and whether it does because it was added to it. */
    dayPlayed = true,
    dayPicked = false,
    /** `(on)`: the day shown added to the play, or let go; null where a plate plays no days. */
    onplayday = null,
    /** Whether the video skips the day shown, and `(on)` to hide it from the video or show it again; null where a plate plays no days. */
    daySkipped = false,
    onskipday = null,
  } = $props();

  /** `{ step, index, anchor }` of the step being set, or `{ day: true, anchor }`; `at` in place of `anchor` for a right-click. */
  let menu = $state(null);
  let dragged = $state('');
  let target = $state(-1);
  let strip = $state(null);
  let lane = $state(null);
  let secondsField = $state(null);
  let width = $state(0);
  let before = $state(0);
  let after = $state(0);
  let overflowing = $state(false);

  /** A tile's width and the gap after it, the add button's and the count's, in pixels. */
  const TILE = 145;
  const ROOM = TILE + 39 + 56;
  /** Past what the strip holds whole, the tiles shrink to their number and time. */
  const compact = $derived(width > 0 && steps.length * TILE > width - ROOM);
  const shownIndex = $derived(steps.findIndex((step) => step.id === current));

  /** How many steps stand more than half out of sight, each side. */
  function measure() {
    if (!lane) return;
    const left = lane.scrollLeft;
    const right = left + lane.clientWidth;
    const out = [0, 0];
    for (const slot of lane.children) {
      const middle = slot.offsetLeft + slot.offsetWidth / 2;
      if (middle < left) out[0] += 1;
      else if (middle > right) out[1] += 1;
    }
    [before, after] = out;
    overflowing = lane.scrollWidth > lane.clientWidth + 1;
  }

  // the step shown stands in the middle of the strip; another day starts it from its first step
  let dayShown = '';
  $effect(() => {
    void steps.length; void compact;
    const shown = day || dayLabel;
    const id = current;
    if (!lane) return;
    const moved = shown !== dayShown;
    dayShown = shown;
    const tile = id ? lane.querySelector('[aria-selected="true"]')?.closest('.slot') : null;
    if (tile) {
      const left = Math.max(0, tile.offsetLeft - (lane.clientWidth - tile.offsetWidth) / 2);
      lane.scrollTo?.({ left, behavior: moved ? 'auto' : 'smooth' });
    } else if (moved) {
      lane.scrollLeft = 0;
    }
    measure();
  });

  $effect(() => {
    if (!lane || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(lane);
    return () => observer.disconnect();
  });

  /** The wheel turns the strip sideways when it runs longer than the bar; a sideways wheel scrolls it as it is. */
  function wheel(node) {
    const turn = (event) => {
      if (node.scrollWidth <= node.clientWidth || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      event.preventDefault();
      node.scrollLeft += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientWidth : 1);
    };
    node.addEventListener('wheel', turn, { passive: false });
    return () => node.removeEventListener('wheel', turn);
  }

  /** The strip moved by most of its width, toward the steps out of sight on one side. */
  function page(direction) {
    lane?.scrollBy?.({ left: direction * Math.max(TILE, lane.clientWidth * 0.8), behavior: 'smooth' });
  }

  /** The arrow keys go from the day to its steps and back, the tile shown taking the keys. */
  async function arrows(event) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (!(event.target instanceof HTMLElement) || event.target.closest('input, textarea, select')) return;
    event.preventDefault();
    event.stopPropagation();
    const order = [null, ...steps.map((step) => step.id)];
    const index = Math.min(order.length - 1, Math.max(0, order.indexOf(current) + (event.key === 'ArrowLeft' ? -1 : 1)));
    if (order[index] === current) return;
    onpick?.(order[index]);
    await tick();
    strip?.querySelector('[aria-selected="true"]')?.focus();
  }

  const name = (step, index) => step.name || `Step ${index + 1}`;
  const firstClip = (step) => clipsOf(elements, step)[0] ?? null;
  const owned = (step) => elements.filter((element) => element.step === step.id).length;

  /** The menu of a tile, its seconds field taking the keys when it is opened by the tile's time. */
  async function open(next, focusTime = false) {
    menu = next;
    if (!focusTime) return;
    await tick();
    secondsField?.focus();
    secondsField?.select();
  }
  /** A step's own transition time from its field: 0.2 to 3 seconds, or none to follow the plate's. */
  function transitionOf(value) {
    const seconds = Number.parseFloat(value);
    return Number.isFinite(seconds) ? Math.round(Math.min(3, Math.max(0.2, seconds)) * 10) / 10 : null;
  }
  /** A right-click on a tile: its menu, where the pointer is. */
  function context(event, next) {
    event.preventDefault();
    open({ ...next, at: { x: event.clientX, y: event.clientY } });
  }
  function setStepSeconds(step, value) {
    const bound = boundSeconds(value);
    if (bound !== null) onchange?.(step.id, { duration: Math.max(bound, leastSeconds(step, elements)) });
  }

  function dragOver(event, index) {
    if (!dragged) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    target = event.clientX < rect.left + rect.width / 2 ? index : index + 1;
  }
  function drop(event) {
    if (!dragged) return;
    event.preventDefault();
    if (target >= 0) onmove?.(dragged, target);
    dragged = ''; target = -1;
  }
</script>

<div class="steps" class:skipped={daySkipped} class:compact bind:this={strip} bind:clientWidth={width} role="listbox" aria-label="Steps of the day" tabindex="-1"
  ondragover={(event) => event.preventDefault()} ondrop={drop} onkeydown={arrows}>
  <div class="slot" role="presentation" oncontextmenu={(event) => context(event, { day: true })}>
    {#if !dayPlayed && onplayday}
      <button type="button" class="tile day idle" title="No layer changes on this day, so the play skips it. Press to add it"
        onclick={() => onplayday(true)}>
        <span class="thumb"><Icon name="plus" size={14} /></span>
        <span class="tile-name">{dayLabel}</span>
        <span class="tile-add">Add to the play</span>
      </button>
    {:else}
    <button type="button" class="tile day" class:on={!current} role="option" aria-selected={!current}
      title={daySkipped ? 'Hidden from the video, with its steps. Its ⋯ shows it again' : 'The day itself, under its steps'}
      onclick={() => onpick?.(null)}>
      <span class="thumb"><Icon name={daySkipped ? 'eyeOff' : 'plate'} size={14} /></span>
      <span class="tile-name">{dayLabel}</span>
    </button>
    {#if daySkipped}
      <span class="time said">Hidden</span>
    {:else}
    <button type="button" class="time" class:own={dayOwn} aria-label={`How long ${dayLabel} holds`}
      title={dayOwn ? 'How long this day holds in the video, its own time. Press to set it' : 'How long this day holds in the video, as every day does. Press to give it its own'}
      onclick={(event) => open({ day: true, anchor: event.currentTarget }, true)}>{timecode(daySeconds)}</button>
    {/if}
    {/if}
    <button type="button" class="more" aria-label={`Set ${dayLabel}`} title={!dayPlayed ? 'Add it to the play' : daySkipped ? 'Show it in the video' : 'How long it holds, or hide it'}
      onclick={(event) => open({ day: true, anchor: event.currentTarget })}><Icon name="more" size={14} stroke={2.6} /></button>
  </div>
  {#if steps.length}
  {#if overflowing}
    <button type="button" class="edge" disabled={!before} aria-label={before ? `${before} more ${before === 1 ? 'step' : 'steps'} before` : 'No step before'}
      title="Scroll to the steps before" onclick={() => page(-1)}><Icon name="chevronLeft" size={12} />{before || ''}</button>
  {/if}
  <div class="lane" role="presentation" bind:this={lane} onscroll={measure} {@attach wheel}>
  {#each steps as step, index (step.id)}
    {@const clip = firstClip(step)}
    <div class="slot" class:drop-before={target === index} class:drop-after={target === steps.length && index === steps.length - 1}
      role="presentation" ondragover={(event) => dragOver(event, index)} oncontextmenu={(event) => context(event, { step, index })}>
      <button type="button" class="tile" class:on={current === step.id} role="option" aria-selected={current === step.id}
        draggable="true" title={compact ? `${name(step, index)}. Press to show it, drag to play it elsewhere` : 'Press to show it, drag to play it elsewhere'}
        ondragstart={(event) => { dragged = step.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', step.id); }}
        ondragend={() => { dragged = ''; target = -1; }}
        onclick={() => onpick?.(step.id)}>
        <span class="thumb">
          {#if clip}
            <video src={`${fileUrl(caseId, clip.src)}#t=${clipRange(clip)[0]}`} preload="metadata" muted playsinline aria-hidden="true"></video>
            <span class="play"><Icon name="play" size={9} /></span>
            {#if compact}<span class="badge">{index + 1}</span>{/if}
          {:else}<span class="number">{index + 1}</span>{/if}
        </span>
        <span class="tile-name">{name(step, index)}</span>
      </button>
      <button type="button" class="time" aria-label={`How long ${name(step, index)} holds`}
        title={clip ? 'How long this step holds in the video, at least its clip. Press to set it' : 'How long this step holds in the video. Press to set it'}
        onclick={(event) => open({ step, index, anchor: event.currentTarget }, true)}>{timecode(stepSeconds(step, elements))}</button>
      <button type="button" class="more" aria-label={`Set ${name(step, index)}`} title="Name, length, order, remove"
        onclick={(event) => open({ step, index, anchor: event.currentTarget })}><Icon name="more" size={14} stroke={2.6} /></button>
    </div>
  {/each}
  </div>
  {#if overflowing}
    <button type="button" class="edge" disabled={!after} aria-label={after ? `${after} more ${after === 1 ? 'step' : 'steps'} after` : 'No step after'}
      title="Scroll to the steps after" onclick={() => page(1)}>{after || ''}<Icon name="chevronRight" size={12} /></button>
  {/if}
  {/if}
  <button type="button" class="add" aria-label="Add a step" title={current ? 'Add a step after this one' : 'Add a step to this day, played after it'} onclick={() => onadd?.()}>
    <Icon name="plus" size={14} /></button>
  {#if compact}
    <span class="tally" title="The step shown, of the day's steps">{shownIndex >= 0 ? `${shownIndex + 1} / ${steps.length}` : `${steps.length} steps`}</span>
  {/if}
</div>

{#if menu?.day}
  <FloatingMenu anchor={menu?.anchor} at={menu?.at} width={230} label="The day" role="dialog" onclose={() => (menu = null)}>
    {#if !dayPlayed && onplayday}
      <button type="button" class="fm-item" onclick={() => { menu = null; onplayday(true); }}>
        <Icon name="plus" size={14} /><span class="fm-grow">Add this day to the play</span></button>
    {:else}
    {#if !daySkipped}
    <div class="fields">
      <label title="Seconds this day holds in the video">Seconds<input class="input" type="number" min={LEAST_SECONDS} max={MOST_SECONDS} step="0.1"
        bind:this={secondsField} value={daySeconds} onchange={(event) => ondayhold?.(event.currentTarget.value)} /></label>
      <p class="fm-note">{dayOwn ? 'Its own time.' : `As every day: ${timecode(plateSeconds)}, set in the export.`}</p>
      {#if dayOwn}
        <button type="button" class="btn btn-xs" title="Hold this day as long as every other day" onclick={() => { ondayhold?.(null); menu = null; }}>
          As every day ({timecode(plateSeconds)})</button>
      {/if}
    </div>
    {/if}
    {#if dayPicked && !steps.length && onplayday}
      <div class="fm-sep"></div>
      <button type="button" class="fm-item" title="No layer changes on this day: the play skips it again"
        onclick={() => { menu = null; onplayday(false); }}>
        <Icon name="minus" size={14} /><span class="fm-grow">Take it out of the play</span></button>
    {:else if onskipday}
      {#if !daySkipped}<div class="fm-sep"></div>{/if}
      <button type="button" class="fm-item" title={daySkipped ? 'The play and the exports go through it again' : 'The play and the exports skip it and its steps; it stays here to edit'}
        onclick={() => { menu = null; onskipday(!daySkipped); }}>
        <Icon name={daySkipped ? 'eye' : 'eyeOff'} size={14} /><span class="fm-grow">{daySkipped ? 'Show in the video' : 'Hide from the video'}</span></button>
    {/if}
    {/if}
  </FloatingMenu>
{:else if menu}
  {@const least = menu?.step ? leastSeconds(menu.step, elements) : 0}
  <FloatingMenu anchor={menu?.anchor} at={menu?.at} width={230} label="Step" role="dialog" onclose={() => (menu = null)}>
    <div class="fields">
      <label title="What the strip and the list call it">Name<input class="input" maxlength="80" placeholder={`Step ${menu?.index + 1}`} value={menu?.step.name ?? ''}
        onchange={(event) => onchange?.(menu?.step.id, { name: event.currentTarget.value.trim() })} /></label>
      <label title={least ? 'Seconds this step holds in the video, never less than its clip' : 'Seconds this step holds in the video'}>Seconds
        <input class="input" type="number" min={Math.max(LEAST_SECONDS, least)} max={MOST_SECONDS} step="0.1" bind:this={secondsField}
          value={menu?.step ? stepSeconds(menu.step, elements) : ''} onchange={(event) => setStepSeconds(menu?.step, event.currentTarget.value)} /></label>
      {#if least}<p class="fm-note">At least {timecode(least)}, its longest clip; longer holds the clip's last frame.</p>{/if}
      {#if transitions}
        <label class="cut" title="This step comes in at once, without the plate's transition"><input type="checkbox" checked={menu?.step.transition === 'none'}
          onchange={(event) => onchange?.(menu?.step.id, { transition: event.currentTarget.checked ? 'none' : '' })} /> Cut straight in, no transition</label>
        {#if menu?.step.transition !== 'none'}
          <label title="Seconds to reach this step, the plate's transition when empty">Transition, seconds
            <input class="input" type="number" min="0.2" max="3" step="0.1" placeholder={String(transitionSeconds)} value={menu?.step.transition_seconds ?? ''}
              onchange={(event) => onchange?.(menu?.step.id, { transition_seconds: transitionOf(event.currentTarget.value) })} /></label>
        {/if}
      {/if}
    </div>
    <div class="fm-sep"></div>
    <button type="button" class="fm-item" disabled={menu?.index === 0} onclick={() => { const { step, index } = menu; menu = null; onmove?.(step.id, index - 1); }}>
      <Icon name="chevronLeft" size={14} /><span class="fm-grow">Play it earlier</span></button>
    <button type="button" class="fm-item" disabled={menu?.index === steps.length - 1} onclick={() => { const { step, index } = menu; menu = null; onmove?.(step.id, index + 2); }}>
      <Icon name="chevronRight" size={14} /><span class="fm-grow">Play it later</span></button>
    {#if onduplicate}
      <button type="button" class="fm-item" title="Copies this step, marks and framing included, to play right after it"
        onclick={() => { const { step } = menu; menu = null; onduplicate(step.id); }}><Icon name="copy" size={14} /><span class="fm-grow">Duplicate</span></button>
    {/if}
    <div class="fm-sep"></div>
    <button type="button" class="fm-item danger" onclick={() => { const { step } = menu; menu = null; onremove?.(step.id); }}>
      <Icon name="trash" size={14} /><span class="fm-grow">{menu?.step && owned(menu.step) ? `Remove it and its ${owned(menu.step) === 1 ? 'element' : `${owned(menu.step)} elements`}` : 'Remove it'}</span></button>
  </FloatingMenu>
{/if}

<style>
  .steps { display: flex; align-items: stretch; gap: 5px; min-width: 0; padding: 2px 0; }
  /* the steps scroll between the day and +, with no scrollbar, so the strip is as tall on every day */
  .lane { position: relative; display: flex; flex: 0 1 auto; align-items: stretch; gap: 5px; min-width: 0; overflow-x: auto; scrollbar-width: none; }
  .lane::-webkit-scrollbar { display: none; }
  .edge { display: flex; flex: none; align-items: center; justify-content: center; gap: 1px; width: 30px; border-radius: var(--r-sm); color: var(--text-1);
    font-size: 10.5px; font-weight: 600; font-variant-numeric: tabular-nums; cursor: pointer; }
  .edge:hover:not(:disabled) { background: var(--bg-3); color: var(--accent); }
  .edge:disabled { color: var(--text-3); opacity: .5; cursor: default; }
  .tally { align-self: center; flex: none; min-width: 44px; color: var(--text-3); font-size: 10.5px; font-variant-numeric: tabular-nums; text-align: center; white-space: nowrap; }
  .slot { position: relative; display: flex; border-radius: var(--r-sm); }
  .slot.drop-before { box-shadow: -3px 0 var(--accent); }
  .slot.drop-after { box-shadow: 3px 0 var(--accent); }
  .tile { display: grid; grid-template-columns: auto 1fr; grid-template-rows: minmax(14px, auto) 14px; align-items: center; gap: 0 6px; width: 140px; flex: none;
    padding: 4px 22px 4px 6px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-2); color: var(--text-2);
    font-size: 11px; text-align: left; cursor: pointer; }
  .tile:hover { border-color: var(--accent); color: var(--text-1); }
  .tile.on { border-color: var(--accent); background: var(--accent-soft); color: var(--text-1); }
  .tile.idle { border-style: dashed; background: none; color: var(--text-3); }
  .tile.idle:hover { color: var(--text-1); }
  .tile-add { color: var(--accent); font-size: 10px; white-space: nowrap; }
  .thumb { position: relative; grid-row: span 2; display: grid; place-items: center; width: 40px; height: 26px; border-radius: 3px; overflow: hidden;
    background: var(--bg-3); color: var(--text-3); }
  .thumb video { width: 100%; height: 100%; object-fit: cover; }
  .play { position: absolute; right: 2px; bottom: 2px; display: grid; place-items: center; width: 13px; height: 13px; border-radius: 50%;
    background: rgba(0, 0, 0, .65); color: #fff; }
  .number { font-weight: 700; font-size: 12px; }
  .badge { position: absolute; left: 2px; top: 1px; padding: 0 3px; border-radius: 2px; background: rgba(0, 0, 0, .65); color: #fff; font-size: 9px; font-weight: 700; }
  /* past what the strip holds whole: a step's number and time, its name on hover and over the page */
  .compact .lane .tile { width: 96px; }
  .compact .lane .tile-name { display: none; }
  .compact .lane .more { top: 1px; width: 16px; height: 16px; }
  .tile-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  /* the time sits in the tile's second row, a button of its own */
  .time { position: absolute; left: 53px; bottom: 4px; height: 15px; padding: 0 4px; border-radius: 3px; color: var(--text-3);
    font-size: 10px; font-variant-numeric: tabular-nums; cursor: pointer; }
  .time:hover, .time:focus-visible { background: var(--bg-3); color: var(--text-1); }
  .time.own { color: var(--accent); }
  .time.said { cursor: default; pointer-events: none; }
  /* a day hidden from the video, and its steps, stay to edit, dashed */
  .skipped .tile { border-style: dashed; }
  .skipped .tile:not(.on) { color: var(--text-3); }
  .more { position: absolute; top: 2px; right: 2px; display: grid; place-items: center; width: 18px; height: 18px; border-radius: var(--r-sm);
    color: var(--text-2); cursor: pointer; }
  .more:hover, .more:focus-visible { background: var(--bg-3); color: var(--text-1); }
  .add { display: grid; place-items: center; width: 34px; flex: none; border: 1px dashed var(--border); border-radius: var(--r-sm); color: var(--text-2); cursor: pointer; }
  .add:hover { border-color: var(--accent); color: var(--text-1); }
  .fields { display: grid; gap: 6px; padding: 6px; }
  .fields label { display: grid; gap: 3px; color: var(--text-3); font-size: 11px; }
  .fields .input { height: 26px; font-size: var(--fs-xs); }
  .fields .cut { display: flex; align-items: center; gap: 6px; color: var(--text-2); cursor: pointer; }
  .fields .btn-xs { justify-self: start; }
</style>
