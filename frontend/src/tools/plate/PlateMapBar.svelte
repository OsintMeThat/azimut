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
   * - **Keep the previous framing**: on a played plate, a day or a step after the
   *   first holds the framing before it until this is unticked; then the map moves
   *   for it alone.
   */
  import Icon from '../../components/Icon.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import { PLATE_OVERLAYS } from '../../lib/plate/page.js';
  import { GROUNDS } from '../../lib/plate/plainBasemap.js';
  import GroundSwatch from './GroundSwatch.svelte';

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
<div class="map-bar" role="toolbar" aria-label="Map" tabindex="-1" onpointerdown={(event) => event.stopPropagation()}>
  {#if isMap}
    {#if keep !== null}
      <label class="keep" title="On, this day or step shows the map as the one before it does. Off, you frame it here on its own.">
        <input type="checkbox" checked={keep} onchange={(event) => onkeep?.(event.currentTarget.checked)} /> Keep the previous framing</label>
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
  <button type="button" class="ground" bind:this={anchor} aria-expanded={menu} aria-label="Ground" title="The ground the map is drawn on"
    onclick={() => (menu = !menu)}><Icon name="satellite" size={13} /><span>{ground}</span><Icon name="chevronDown" size={11} /></button>
</div>

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
  .map-bar { display: flex; align-items: center; gap: 1px; padding: 3px; border: 1px solid var(--border); border-radius: var(--r-sm);
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
  .ground span { max-width: 110px; overflow: hidden; text-overflow: ellipsis; }
  .room { flex: none; width: 14px; }
</style>
