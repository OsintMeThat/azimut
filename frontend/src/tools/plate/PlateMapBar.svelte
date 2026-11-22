<script>
  /**
   * The few things a plate's map is changed by, on the map itself while it is
   * picked: framing it by the hand, turning it, and the ground it is drawn on.
   *
   * - **Zoom**: a half step in or out, round the map's middle.
   * - **Turn**: a step to either side, or the compass dragged round; a press on the
   *   compass puts north back up. While the map is framed, a Shift-drag, a
   *   middle-drag or a double click held turns it too.
   * - **Tilt**: a map drawn in 3D leans further or less.
   * - **Ground**: the basemaps a plate offers, and what can be laid over them.
   * - **The ground's day**, on a ground that has one (a Wayback release, a Sentinel-2
   *   pass, a cloudless year): a press opens its releases, its years or Satellite's
   *   calendar, with **Layers as they stood that day** (`PlateGroundDay`, as the
   *   inspector shows them).
   * - **Same view**: a map grouped with another (a comparison's pair) takes the other's
   *   framing at a press, on the day or slide shown.
   * - **Layers**: how many of the case's layers the map draws; a press shows them in
   *   the list's Layers tab, where they are ticked on and off.
   * - **Map stays where it was**: on a played plate, a day or a slide after the
   *   first holds the framing before it until this is unticked; then the map moves
   *   for it alone.
   */
  import { flushSync } from 'svelte';
  import Icon from '../../components/Icon.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import { PLATE_OVERLAYS } from '../../lib/plate/page.js';
  import { GROUNDS } from '../../lib/plate/plainBasemap.js';
  import { SENTINEL_ID } from '../../lib/plate/sentinelPass.js';
  import { groundDay } from '../../lib/plate/source.js';
  import GroundSwatch from './GroundSwatch.svelte';
  import PlateGroundDay from './PlateGroundDay.svelte';

  let {
    element,
    /** `[id, label]` of every ground a plate offers. */
    grounds = [],
    framing = false,
    onframe,
    /** The map's view on the day or step shown (its own when none is given), and `(view)` to frame it otherwise. */
    view: given = null,
    onview = (next) => { element.view = next; },
    /** Whether the day or step shown keeps the framing before it; null on the first, which has none before it. */
    keep = null,
    /** `(keep)`: the day or step shown keeps the framing before it, or frames the map its own way. */
    onkeep = null,
    /** The case's layers this map draws, shown in the list's Layers tab; null where there is none to show. */
    onlayers = null,
    /** The map framed as the other map of its group is; null where it stands in no group with one. */
    onsameview = null,
    /** The Wayback releases, `{ release, date }`, newest first, once read. */
    releases = [],
    /** The years of Sentinel-2 cloudless, `{ year, licence, free }`, newest first. */
    years = [],
    /** The plate's Sentinel-2 choices, read from the map picked alone (`plateSentinel.svelte.js`). */
    sentinel = null,
    /** The plate is a template, which keeps no layers. */
    template = false,
    /** Picks this map alone, the one the plate's Sentinel-2 choices are read from. */
    onpick = null,
    /** The widest the bar goes, in pixels: the map's width on the screen. Its words give way first. */
    room = null,
  } = $props();

  const isMap = $derived(element.kind === 'map');
  const view = $derived(given ?? element.view);
  const bearing = $derived(view?.bearing ?? 0);
  const pitch = $derived(view?.pitch ?? 0);
  const leans = $derived((element.terrain ?? 0) > 0 || pitch > 0);
  /** The framing is held to the one before: the hand frames nothing here. */
  const held = $derived(keep === true);
  const ground = $derived(grounds.find(([id]) => id === element.basemap)?.[1] ?? 'Ground');
  let menu = $state(false);
  let anchor = $state(null);
  let dial = $state(null);
  /** The ground's day as the chip says it, '' on a ground with no day of its own. */
  const day = $derived(isMap ? groundDay(element, { releases, years }) : '');
  const looking = $derived(element.basemap === SENTINEL_ID && !element.acquired && sentinel?.map === element.id && sentinel.s2.latestBusy);
  let dayMenu = $state(false);
  let dayAnchor = $state(null);
  // another ground, from here or the inspector: its day is asked for afresh
  $effect(() => { void element.basemap; dayMenu = false; });

  /** The day's menu opened: on Sentinel-2, the map is picked alone and its calendar reads this month's passes. */
  function openDay() {
    if (dayMenu) { dayMenu = false; return; }
    if (element.basemap === SENTINEL_ID && sentinel) {
      onpick?.();
      flushSync();
      if (sentinel.map === element.id) sentinel.s2.readMenu();
    }
    dayMenu = true;
  }

  const tidy = (value) => Math.round((((value + 180) % 360 + 360) % 360 - 180) * 10) / 10;
  function turn(by) {
    onview({ ...view, bearing: tidy(bearing + by) });
  }
  function zoom(by) {
    onview({ ...view, zoom: Math.max(0, Math.min(22, Math.round(((view?.zoom ?? 10) + by) * 100) / 100)) });
  }
  function tilt(by) {
    onview({ ...view, pitch: Math.max(0, Math.min(85, Math.round(pitch + by))) });
  }

  /** The compass dragged round: north follows the pointer. */
  function grabDial(event) {
    if (event.button !== 0 || held) return;
    event.preventDefault();
    event.stopPropagation();
    const box = dial.getBoundingClientRect();
    const centre = [box.left + box.width / 2, box.top + box.height / 2];
    let moved = false;
    const move = (next) => {
      const dx = next.clientX - centre[0];
      const dy = next.clientY - centre[1];
      if (!moved && Math.hypot(dx, dy) < 6) return;
      moved = true;
      // the needle points where north is on screen; the map's bearing is the other way round
      onview({ ...view, bearing: tidy(-((Math.atan2(dx, -dy) * 180) / Math.PI)) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved) onview({ ...view, bearing: 0 });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function toggleOverlay(id) {
    const list = element.overlays ?? [];
    element.overlays = list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="map-bar" role="toolbar" aria-label="Map" tabindex="-1" style:max-width={room ? `${room}px` : null} onpointerdown={(event) => event.stopPropagation()}>
  {#if isMap}
    {#if keep !== null}
      <label class="keep" title="This day or slide shows the map as the one before it does">
        <input type="checkbox" checked={keep} onchange={(event) => onkeep?.(event.currentTarget.checked)} /> Map stays where it was</label>
      <span class="rule"></span>
    {/if}
    <button type="button" class:on={framing} aria-pressed={framing} disabled={held} title={framing ? 'Done framing (Esc)' : 'Frame by the hand: zoom with the wheel, turn with a Shift-drag'}
      aria-label="Frame the map" onclick={onframe}><Icon name="move" size={14} />{#if framing}<span>Done</span>{/if}</button>
    <button type="button" aria-label="Zoom the map out" title="Zoom out" disabled={held} onclick={() => zoom(-0.5)}><Icon name="minus" size={13} /></button>
    <button type="button" aria-label="Zoom the map in" title="Zoom in" disabled={held} onclick={() => zoom(0.5)}><Icon name="plus" size={13} /></button>
    <span class="rule"></span>
    {#if leans}
      <button type="button" aria-label="Tilt the map less" title="Lean less" disabled={held || pitch <= 0} onclick={() => tilt(-10)}><Icon name="chevronDown" size={13} /></button>
      <span class="pitch" title="How far the map leans">{Math.round(pitch)}°</span>
      <button type="button" aria-label="Tilt the map more" title="Lean more" disabled={held || pitch >= 85} onclick={() => tilt(10)}><Icon name="chevronUp" size={13} /></button>
      <span class="rule"></span>
    {/if}
    <button type="button" aria-label="Turn the map left" title="Turn 15° left" disabled={held} onclick={() => turn(15)}><Icon name="rotateLeft" size={14} /></button>
    <button type="button" class="dial" bind:this={dial} aria-label={`Compass, ${Math.round(-bearing + 360) % 360}°`} disabled={held}
      title="Drag to turn the map. A press puts north up." onpointerdown={grabDial}>
      <svg viewBox="-12 -12 24 24" width="22" height="22" aria-hidden="true">
        <circle r="10.5" class="ring" />
        <g transform="rotate({-bearing})">
          <path d="M0 -9 L3 1 L0 -1 L-3 1 Z" class="north" />
          <path d="M0 9 L3 1 L0 3 L-3 1 Z" class="south" />
        </g>
      </svg>
    </button>
    <button type="button" aria-label="Turn the map right" title="Turn 15° right" disabled={held} onclick={() => turn(-15)}><Icon name="rotateRight" size={14} /></button>
    <span class="rule"></span>
  {/if}
  <button type="button" class="ground" bind:this={anchor} aria-expanded={menu} aria-label="Ground" title={menu ? undefined : 'The ground the map is drawn on'}
    onclick={() => (menu = !menu)}><Icon name="satellite" size={13} /><span>{ground}</span><Icon name="chevronDown" size={11} /></button>
  {#if day}
    <button type="button" class="ground day" bind:this={dayAnchor} aria-expanded={dayMenu} aria-label="Ground's day" title={dayMenu ? undefined : 'The day the ground\'s picture was taken'}
      onclick={openDay}><Icon name="clock" size={13} /><span>{looking ? 'Looking…' : day}</span><Icon name="chevronDown" size={11} /></button>
  {/if}
  {#if isMap && onsameview}
    <button type="button" aria-label="Same view as the other map" title="Frames this map as the other map of its group, on the day or slide shown"
      disabled={held} onclick={onsameview}><Icon name="columns" size={14} /></button>
  {/if}
  {#if isMap && onlayers}
    {@const count = (element.layers ?? []).length}
    <button type="button" class="ground" class:none={!count} aria-label="Layers" title="The case's layers this map draws: tick them in the list's Layers tab"
      onclick={onlayers}><Icon name="layers" size={13} /><span>{count ? `${count} ${count === 1 ? 'layer' : 'layers'}` : 'No layer'}</span></button>
  {/if}
</div>

{#if dayMenu && day}
  <FloatingMenu anchor={dayAnchor} width={260} column label="Ground's day" onclose={() => (dayMenu = false)}>
    <PlateGroundDay {element} {releases} {years} {sentinel} {template} menu />
  </FloatingMenu>
{/if}

{#if menu}
  <FloatingMenu {anchor} width={260} label="Ground" onclose={() => (menu = false)}>
    {#each grounds as [id, label] (id)}
      <button type="button" class="fm-item" role="menuitemradio" aria-checked={element.basemap === id}
        onclick={() => { element.basemap = id; menu = false; }}>
        <GroundSwatch {id} width={28} height={19} /><span class="fm-grow">{label}</span>
        {#if element.basemap === id}<Icon name="check" size={13} />{/if}</button>
    {/each}
    <div class="fm-sep"></div>
    {#each PLATE_OVERLAYS as [id, label] (id)}
      {#if id !== 'relief' || !GROUNDS[element.basemap]?.shade?.own}
        <button type="button" class="fm-item" role="menuitemcheckbox" aria-checked={(element.overlays ?? []).includes(id)}
          onclick={() => toggleOverlay(id)}>
          {#if (element.overlays ?? []).includes(id)}<Icon name="check" size={14} />{:else}<span class="room"></span>{/if}
          <span class="fm-grow">{label}</span></button>
      {/if}
    {/each}
  </FloatingMenu>
{/if}

<style>
  /* on a map narrower than the bar, the bar runs on a second line rather than past its own edge */
  .map-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 1px; padding: 3px; border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-1); box-shadow: var(--shadow-2); white-space: nowrap; }
  button { display: flex; align-items: center; justify-content: center; gap: 4px; min-width: 28px; height: 28px; padding: 0 6px;
    border-radius: var(--r-sm); color: var(--text-2); font-size: var(--fs-xs); cursor: pointer; }
  button:hover:not(:disabled) { background: var(--bg-3); color: var(--text-1); }
  button:disabled { opacity: .4; cursor: default; }
  .keep { display: flex; align-items: center; gap: 5px; padding: 0 6px; color: var(--text-1); font-size: var(--fs-xs); cursor: pointer; }
  .pitch { min-width: 26px; color: var(--text-2); font-size: var(--fs-xs); text-align: center; font-variant-numeric: tabular-nums; }
  button.on { background: var(--accent); color: var(--accent-text); }
  .rule { width: 1px; height: 18px; margin: 0 3px; background: var(--border); }
  .dial { padding: 0; cursor: grab; }
  .dial:active { cursor: grabbing; }
  .ring { fill: var(--bg-2); stroke: var(--border); stroke-width: 1; }
  .north { fill: #e5484d; }
  .south { fill: var(--text-3); }
  .ground span { min-width: 0; max-width: 110px; overflow: hidden; text-overflow: ellipsis; }
  /* the buttons keep their size and a day is always said whole; only the ground's name gives way */
  .map-bar > * { flex: none; }
  .map-bar > .ground:not(.day) { flex: 0 1 auto; min-width: 0; }
  .day span { max-width: none; font-variant-numeric: tabular-nums; }
  .ground :global(svg) { flex: none; }
  /* a map that draws none of the case's layers says so where the eye is */
  .ground.none { color: var(--accent); }
  .room { flex: none; width: 14px; }
</style>
