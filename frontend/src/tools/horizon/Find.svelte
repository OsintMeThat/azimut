<script>
  /**
   * Find where a photo was taken: Horizon's third mode, a screen of its own
   * over the tab, its header holding the same mode switch as the tab's.
   *
   * Three columns: the photo with its skyline, the map with the area and the
   * alignments, the steps. The header opens a search the case keeps, or
   * starts a new one from another photo. A column is enlarged by its own button and given
   * back by the same one or Escape; the line between photo and map is dragged
   * to share the width, and the steps fold away. How it was left is kept for
   * next time in this browser.
   */
  import Icon from '../../components/Icon.svelte';
  import ViewSwitch from '../../components/ViewSwitch.svelte';
  import FindPhoto from './FindPhoto.svelte';
  import FindMap from './FindMap.svelte';
  import FindSteps from './FindSteps.svelte';
  import SearchesMenu from './SearchesMenu.svelte';
  import { PACE_WAIT_MS } from './state/find.svelte.js';

  let {
    find,
    overlay,
    imagery,
    overlays = [],
    /** The Layers menu of the map and what it draws, as FindMap takes them. */
    layers = null,
    /** Where the map opens. */
    home,
    units = 'metric',
    /** Horizon's modes, `{ id, label, icon, hint }`, and how another is picked. */
    modes = [],
    onmode = () => {},
    /** Asked to choose the photo. */
    onpick = () => {},
    /** Asked to stand at a place found, `{ lat, lon }`. */
    onstand = () => {},
    /** Asked to start the search. */
    onsearch = () => {},
    /** Asked to look from a place the search found. */
    onplace = () => {},
    /** Asked to look again from the place the analyst confirmed (the search's `found`). */
    onfound = () => {},
    /** Whether a case is open to keep searches in, and its id (the searches' pictures are read from it). */
    caseOpen = false,
    caseId = null,
    /** Asked to open or delete a search the case keeps, by name. */
    onopensearch = () => {},
    onremovesearch = () => {},
    /** Asked to start a new search: the photo, its trace and the setup let go. */
    onnew = () => {},
  } = $props();

  /** The place of the results the panel and the map light together, or -1. */
  let lit = $state(-1);

  // What the setup reads off the app, asked here rather than in the steps, so a map with the steps folded
  // away still shows the grid it would search. How large the search would be, a moment after what it
  // depends on changes:
  let estimateTimer = null;
  $effect(() => {
    void [find.area, find.areas, find.strokes, find.zones, find.settings, find.who, find.facing, find.stands, find.water, find.over, find.view, find.mirror, find.alignments.length, overlay.strokes, overlay.marks, overlay.hints, overlay.lens];
    clearTimeout(estimateTimer);
    estimateTimer = setTimeout(() => find.estimate(), 500);
    return () => clearTimeout(estimateTimer);
  });

  // this machine's pace for the search as set up, timed a moment after the setup last changed, never while a search runs
  let paceTimer = null;
  $effect(() => {
    void [find.area, find.who, find.facing, find.stands, find.view, find.mirror, find.round, find.sun, find.alignments.length, find.searching, overlay.strokes, overlay.marks, overlay.hints, overlay.lens];
    clearTimeout(paceTimer);
    paceTimer = setTimeout(() => find.timePace?.(), PACE_WAIT_MS);
    return () => clearTimeout(paceTimer);
  });

  // how fine the heights are where the area lies, read once it is closed
  $effect(() => {
    void [find.area, find.drawing];
    find.readDetail();
  });

  // the headings the compass and the sun leave, read again a moment after either or the area changes
  let sectorsTimer = null;
  $effect(() => {
    void [find.area, find.drawing, find.facing, find.sun];
    clearTimeout(sectorsTimer);
    sectorsTimer = setTimeout(() => find.readSectors?.(), 500);
    return () => clearTimeout(sectorsTimer);
  });

  // the grid and the ground under it, read again a moment after the area, who or the ground ticked change
  let previewTimer = null;
  $effect(() => {
    void [find.area, find.areas, find.strokes, find.zones, find.drawing, find.who, find.settings, find.stands, find.water, find.over, find.alignments.length, overlay.marks];
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => find.preview?.(), 600);
    return () => clearTimeout(previewTimer);
  });

  const KEY = 'azimut.find.layout';
  const SHARE_MIN = 0.2;
  const SHARE_MAX = 0.8;

  function remembered() {
    try {
      const kept = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null');
      return {
        share: Number.isFinite(kept?.share) ? Math.min(SHARE_MAX, Math.max(SHARE_MIN, kept.share)) : 0.42,
        folded: Boolean(kept?.folded),
      };
    } catch {
      return { share: 0.42, folded: false };
    }
  }
  const start = remembered();
  let share = $state(start.share);
  let folded = $state(start.folded);
  /** The column enlarged, 'photo' or 'map', or null. */
  let big = $state(null);
  let columns = $state();

  function keep() {
    try {
      globalThis.localStorage?.setItem(KEY, JSON.stringify({ share, folded }));
    } catch {
      // the layout comes back as it starts, which is all a refused storage costs
    }
  }

  function enlarge(which) {
    big = big === which ? null : which;
  }

  function onSplitDown(event) {
    event.preventDefault();
    const bounds = columns.getBoundingClientRect();
    const move = (ev) => {
      share = Math.min(SHARE_MAX, Math.max(SHARE_MIN, (ev.clientX - bounds.left) / (bounds.width - (folded ? 0 : 340))));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      keep();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function onSplitKey(event) {
    const step = event.key === 'ArrowLeft' ? -0.05 : event.key === 'ArrowRight' ? 0.05 : 0;
    if (!step) return;
    event.preventDefault();
    share = Math.min(SHARE_MAX, Math.max(SHARE_MIN, share + step));
    keep();
  }

  function onKey(event) {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (find.pending) find.cancelAlignment();
    else if (find.drawing === 'brush') find.stopBrush();
    else if (big) big = null;
    else return;
    event.stopPropagation();
  }

  /**
   * What the next click is for, said in the column that waits for it (`on`),
   * which is outlined meanwhile: nothing moves aside, the columns stay put.
   */
  const guide = $derived.by(() => {
    if (find.pending) {
      return { on: find.step?.on, text: `${find.pending.step + 1} of 4 · ${find.step?.text}`, act: 'Cancel', run: () => find.cancelAlignment() };
    }
    if (find.drawing === 'area') return { on: 'map', text: 'Click each corner of the area on the map. Press the first one, or Enter, to close it.', act: 'Done', run: () => find.closeArea() };
    if (find.drawing === 'more') return { on: 'map', text: 'Click each corner of another area. Press the first one, or Enter, to close it.', act: 'Done', run: () => find.closeArea() };
    if (find.drawing === 'brush') {
      const text = find.brush.out ? 'Brush over points to turn them off. Alt turns them on.' : 'Brush over points to turn them back on. Alt turns them off.';
      return { on: 'map', text: `${text} Ctrl+Z undoes a stroke.`, act: 'Done', run: () => find.stopBrush() };
    }
    return null;
  });
</script>

<svelte:window onkeydown={onKey} />

<section class="find" aria-label="Find where it was taken">
  <header class="find-head">
    <ViewSwitch options={modes} value="find" label="Horizon mode" onpick={onmode} />
    <h2>Find where it was taken</h2>
    {#if overlay.source}<span class="find-file" title={overlay.source.name}>{overlay.source.name}</span>{/if}
    <span class="find-gap"></span>
    <button
      type="button"
      class="btn btn-sm"
      disabled={!overlay.source && !find.area.length && !find.alignments.length && !find.search}
      onclick={onnew}
      title="Start a new search: another photo, a new area"
      aria-label="New search"
    >
      <Icon name="plus" size={13} /><span>New</span>
    </button>
    <SearchesMenu searches={find.list} current={find.search?.name ?? null} ready={caseOpen} {caseId} onopen={onopensearch} onremove={onremovesearch} />
    <button
      type="button"
      class="btn btn-ghost btn-sm"
      onclick={() => {
        folded = !folded;
        keep();
      }}
      aria-expanded={!folded}
      title={folded ? 'Show the steps' : 'Hide the steps'}
      aria-label={folded ? 'Show the steps' : 'Hide the steps'}
    >
      <Icon name={folded ? 'chevronLeft' : 'chevronRight'} size={15} />
    </button>
  </header>

  {#snippet guideIn(column)}
    {#if guide?.on === column}
      <div class="find-await" aria-hidden="true"></div>
      <div class="find-guide" role="status">
        <span>{guide.text}</span>
        <button type="button" class="btn btn-sm btn-ghost" onclick={guide.run}>{guide.act}</button>
      </div>
    {/if}
  {/snippet}

  <div class="find-cols" bind:this={columns} style:--share={share} class:folded>
    <section class="find-col photo" class:hidden={big === 'map'} class:big={big === 'photo'} aria-label="Photo and its skyline">
      <FindPhoto {overlay} {find} {onpick} />
      {@render guideIn('photo')}
      <button
        type="button"
        class="find-big"
        onclick={() => enlarge('photo')}
        title={big === 'photo' ? 'Back to the three columns (Esc)' : 'Enlarge the photo'}
        aria-label={big === 'photo' ? 'Back to the three columns' : 'Enlarge the photo'}
      >
        <Icon name={big === 'photo' ? 'minimize' : 'maximize'} size={13} />
      </button>
    </section>
    {#if !big}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div
        class="find-split"
        role="separator"
        aria-orientation="vertical"
        aria-label="Share the width between photo and map"
        aria-valuenow={Math.round(share * 100)}
        tabindex="0"
        onpointerdown={onSplitDown}
        onkeydown={onSplitKey}
      ></div>
    {/if}
    <section class="find-col map" class:hidden={big === 'photo'} class:big={big === 'map'} aria-label="Map and the area">
      {#if home}
        <FindMap {imagery} {overlays} {layers} {find} {home} imperial={units === 'imperial'} {onstand} {onplace} {onfound} bind:lit />
      {/if}
      {@render guideIn('map')}
      <button
        type="button"
        class="find-big map"
        onclick={() => enlarge('map')}
        title={big === 'map' ? 'Back to the three columns (Esc)' : 'Enlarge the map'}
        aria-label={big === 'map' ? 'Back to the three columns' : 'Enlarge the map'}
      >
        <Icon name={big === 'map' ? 'minimize' : 'maximize'} size={13} />
      </button>
    </section>
    {#if !folded}
      <aside class="find-col steps" aria-label="Steps">
        <FindSteps
          {find}
          {overlay}
          {units}
          {onstand}
          {onsearch}
          {onplace}
          {onfound}
          bind:lit
        />
      </aside>
    {/if}
  </div>
</section>

<style>
  .find {
    position: absolute;
    inset: 0;
    z-index: 40;
    display: flex;
    flex-direction: column;
    background: var(--bg-0, var(--bg-1));
  }
  /* as tall and as padded as Horizon's own header, so the mode switch stays where it was */
  .find-head {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 40px;
    padding: 0 8px 0 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-1);
  }
  .find-head h2 {
    margin: 0;
    font-size: var(--fs-md, 15px);
    font-weight: 600;
    color: var(--text-1);
    white-space: nowrap;
  }
  .find-file {
    min-width: 0;
    overflow: hidden;
    color: var(--text-3);
    font-size: var(--fs-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .find-gap {
    flex: 1;
  }
  /* the column a click is awaited in, outlined over whatever it draws */
  .find-await {
    position: absolute;
    inset: 0;
    z-index: 4;
    box-shadow: inset 0 0 0 2px var(--accent);
    pointer-events: none;
  }
  /* what the click is for, low in that column, over its enlarge button and the map's credits */
  .find-guide {
    position: absolute;
    left: 50%;
    bottom: 76px;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 10px;
    width: max-content;
    max-width: calc(100% - 24px);
    padding: 5px 6px 5px 12px;
    border-radius: var(--r-md);
    transform: translateX(-50%);
    background: color-mix(in srgb, var(--bg-1) 92%, transparent);
    box-shadow:
      0 0 0 1px var(--accent),
      0 4px 14px rgba(0, 0, 0, 0.35);
    color: var(--text-1);
    font-size: var(--fs-sm);
  }
  /* its own stack: the map's controls (Layers, the brush's ring) stay under the header's menus */
  .find-cols {
    position: relative;
    isolation: isolate;
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .find-col {
    position: relative;
    min-width: 0;
    min-height: 0;
  }
  .find-col.photo {
    flex: 0 0 calc((100% - 340px) * var(--share));
  }
  .find-cols.folded .find-col.photo {
    flex-basis: calc(100% * var(--share));
  }
  .find-col.map {
    flex: 1;
  }
  .find-col.big {
    flex: 1 1 auto;
  }
  .find-col.hidden {
    display: none;
  }
  .find-col.steps {
    flex: 0 0 340px;
    overflow-y: auto;
    border-left: 1px solid var(--border);
    background: var(--bg-1);
  }
  .find-split {
    flex: 0 0 6px;
    margin: 0 -3px;
    z-index: 2;
    cursor: col-resize;
    background: linear-gradient(to right, transparent 2px, var(--border) 2px 4px, transparent 4px);
  }
  .find-split:hover,
  .find-split:focus-visible {
    outline: none;
    background: linear-gradient(to right, transparent 2px, var(--accent) 2px 4px, transparent 4px);
  }
  .find-big {
    position: absolute;
    bottom: 10px;
    right: 10px;
    z-index: 3;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border: none;
    border-radius: var(--r-md);
    background: color-mix(in srgb, var(--bg-1) 88%, transparent);
    box-shadow: 0 0 0 1px var(--border);
    color: var(--text-2);
    cursor: pointer;
  }
  .find-big.map {
    bottom: 34px;
  }
  .find-big:hover {
    color: var(--text-1);
  }
</style>
