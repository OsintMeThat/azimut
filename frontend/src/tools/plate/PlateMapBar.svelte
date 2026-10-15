<script>
  /**
   * The few things a plate's map is changed by, on the map itself while it is
   * picked: framing it by the hand, turning it, and the ground it is drawn on.
   *
   * - **Zoom**: a half step in or out, round the map's middle.
   * - **Turn**: a step to either side, or the compass dragged round; a press on the
   *   compass puts north back up. While the map is framed, a right-drag or a
   *   Ctrl-drag turns it too.
   * - **Ground**: the basemaps a plate offers, and what can be laid over them.
   */
  import Icon from '../../components/Icon.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';

  let {
    element,
    /** `[id, label]` of every ground a plate offers. */
    grounds = [],
    framing = false,
    onframe,
  } = $props();

  const OVERLAYS = [['relief', 'Relief shading'], ['boundaries', 'Borders and big names'], ['placenames', 'Town and village names']];
  const isMap = $derived(element.kind === 'map');
  const bearing = $derived(element.view?.bearing ?? 0);
  const ground = $derived(grounds.find(([id]) => id === element.basemap)?.[1] ?? 'Ground');
  let menu = $state(false);
  let anchor = $state(null);
  let dial = $state(null);

  const tidy = (value) => Math.round((((value + 180) % 360 + 360) % 360 - 180) * 10) / 10;
  function turn(by) {
    element.view = { ...element.view, bearing: tidy(bearing + by) };
  }
  function zoom(by) {
    element.view = { ...element.view, zoom: Math.max(0, Math.min(22, Math.round(((element.view?.zoom ?? 10) + by) * 100) / 100)) };
  }

  /** The compass dragged round: north follows the pointer. */
  function grabDial(event) {
    if (event.button !== 0) return;
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
      element.view = { ...element.view, bearing: tidy(-((Math.atan2(dx, -dy) * 180) / Math.PI)) };
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved) element.view = { ...element.view, bearing: 0 };
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
    <button type="button" class:on={framing} aria-pressed={framing} title={framing ? 'Done framing (Esc)' : 'Frame by the hand: zoom with the wheel, turn with a right-drag'}
      aria-label="Frame the map" onclick={onframe}><Icon name="move" size={14} />{#if framing}<span>Done</span>{/if}</button>
    <button type="button" aria-label="Zoom the map out" title="Zoom out" onclick={() => zoom(-0.5)}><Icon name="minus" size={13} /></button>
    <button type="button" aria-label="Zoom the map in" title="Zoom in" onclick={() => zoom(0.5)}><Icon name="plus" size={13} /></button>
    <span class="rule"></span>
    <button type="button" aria-label="Turn the map left" title="Turn 15° left" onclick={() => turn(15)}><Icon name="rotateLeft" size={14} /></button>
    <button type="button" class="dial" bind:this={dial} aria-label={`Compass, ${Math.round(-bearing + 360) % 360}°`}
      title="Drag to turn the map. A press puts north up." onpointerdown={grabDial}>
      <svg viewBox="-12 -12 24 24" width="22" height="22" aria-hidden="true">
        <circle r="10.5" class="ring" />
        <g transform="rotate({-bearing})">
          <path d="M0 -9 L3 1 L0 -1 L-3 1 Z" class="north" />
          <path d="M0 9 L3 1 L0 3 L-3 1 Z" class="south" />
        </g>
      </svg>
    </button>
    <button type="button" aria-label="Turn the map right" title="Turn 15° right" onclick={() => turn(-15)}><Icon name="rotateRight" size={14} /></button>
    <span class="rule"></span>
  {/if}
  <button type="button" class="ground" bind:this={anchor} aria-expanded={menu} aria-label="Ground" title="The ground the map is drawn on"
    onclick={() => (menu = !menu)}><Icon name="satellite" size={13} /><span>{ground}</span><Icon name="chevronDown" size={11} /></button>
</div>

{#if menu}
  <FloatingMenu {anchor} width={230} label="Ground" onclose={() => (menu = false)}>
    {#each grounds as [id, label] (id)}
      <button type="button" class="fm-item" role="menuitemradio" aria-checked={element.basemap === id}
        onclick={() => { element.basemap = id; menu = false; }}>
        <span class="swatch {id}"></span><span class="fm-grow">{label}</span>
        {#if element.basemap === id}<Icon name="check" size={13} />{/if}</button>
    {/each}
    <div class="fm-sep"></div>
    {#each OVERLAYS as [id, label] (id)}
      {#if id !== 'relief' || element.basemap?.startsWith('plain')}
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
  button:hover { background: var(--bg-3); color: var(--text-1); }
  button.on { background: var(--accent); color: var(--accent-text); }
  .rule { width: 1px; height: 18px; margin: 0 3px; background: var(--border); }
  .dial { padding: 0; cursor: grab; }
  .dial:active { cursor: grabbing; }
  .ring { fill: var(--bg-2); stroke: var(--border); stroke-width: 1; }
  .north { fill: #e5484d; }
  .south { fill: var(--text-3); }
  .ground span { max-width: 110px; overflow: hidden; text-overflow: ellipsis; }
  .swatch { flex: none; width: 16px; height: 16px; border: 1px solid var(--border); border-radius: 3px; background: #888; }
  .swatch.plain { background: linear-gradient(135deg, #f3f1ec 60%, #c6d4de 60%); }
  .swatch.plain-dark { background: linear-gradient(135deg, #1d2126 60%, #2b3a47 60%); }
  .swatch.esri-world-imagery { background: linear-gradient(135deg, #4a5a33, #8b7d5a); }
  .swatch.osm { background: linear-gradient(135deg, #f2efe9 55%, #f7c46c 55%); }
  .swatch.opentopomap { background: linear-gradient(135deg, #d7e3b8, #b9a27a); }
  .room { flex: none; width: 14px; }
</style>
