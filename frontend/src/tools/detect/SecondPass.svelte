<script>
  /**
   * The second pass of a check with two, on its own map laid over the first and
   * cut at a line the analyst drags: the before pass shows on the left of it
   * and the after pass on the right, the same ground in the same frame.
   *
   * It is a second surface, as Compare's swipe is, because two dates cannot be
   * on one map at once. The two cameras are held together (`cameraLink`), so
   * whichever one the hand is on, the other follows; the pins, the painted
   * rules and the reading card are drawn over both by Detect.
   */
  import { untrack } from 'svelte';
  import { api } from '../../lib/api.js';
  import { linkCameras } from '../../lib/map/cameraLink.js';
  import { RADAR_ID } from '../../lib/radar.js';
  import { DEFAULT_MAXCC, SENTINEL_ID } from '../../lib/sentinel.js';
  import { toast } from '../../lib/state.svelte.js';
  import MapSurface from '../satellite/MapSurface.svelte';
  import { createRadarState } from '../satellite/state/radar.svelte.js';
  import { createSentinelState } from '../satellite/state/sentinel.svelte.js';
  import Icon from '../../components/Icon.svelte';

  let {
    imagery,
    /** The engine of the map underneath, whose camera this one follows. */
    primary,
    /** The pass to show: `{ provider, date, time, layer }`. */
    source,
    view,
    bearing = 0,
    home,
    overlays = [],
    imperial = false,
    armed = null,
    /** Where the cut sits, as a percentage of the map from its left edge. */
    divider = 50,
    engine = $bindable(null),
    element = $bindable(null),
    onsplit = () => {},
    onclick = () => {},
    oncontextmenu = () => {},
    onusage = () => {},
    onimageryfallback = () => {},
  } = $props();

  const place = () => ({ lat: view.lat, lon: view.lon });
  const s2 = createSentinelState({ place, onBilled: () => onusage(), notify: toast, api });
  const s1 = createRadarState({ api, place, onBilled: () => onusage() });
  let providerId = $state(SENTINEL_ID);
  let stage = $state(null);
  let ready = $state(false);
  let dragging = $state(false);

  // The pass asked for, put on this map the way Detect puts one on its own.
  $effect(() => {
    const { provider, date, time, layer } = source;
    untrack(() => {
      if (provider === 'sentinel1') {
        providerId = RADAR_ID;
        s1.pick({ date, time: time ?? '' });
      } else {
        providerId = SENTINEL_ID;
        if (layer) s2.layer = layer;
        s2.setMaxcc(DEFAULT_MAXCC);
        s2.date = date;
      }
    });
  });

  // Held on one camera with the map underneath, which leads.
  $effect(() => {
    if (!primary || !engine || !ready) return;
    const link = linkCameras([primary, engine]);
    untrack(() => link.align());
    return () => link.dispose();
  });

  // The column can be dragged wider or narrower; this map has to be told.
  $effect(() => {
    if (!stage || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(() => engine?.resize());
    watch.observe(stage);
    return () => watch.disconnect();
  });

  function setAt(clientX) {
    const box = stage?.getBoundingClientRect();
    if (box?.width) onsplit(((clientX - box.left) / box.width) * 100);
  }
  function press(event) {
    dragging = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setAt(event.clientX);
  }
  function drag(event) {
    if (dragging) setAt(event.clientX);
  }
  function release(event) {
    dragging = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }
  function key(event) {
    if (event.key === 'ArrowLeft') onsplit(divider - 2);
    else if (event.key === 'ArrowRight') onsplit(divider + 2);
    else if (event.key === 'Home') onsplit(0);
    else if (event.key === 'End') onsplit(100);
    else return;
    event.preventDefault();
  }
</script>

<div class="second" bind:this={stage} style:--divider={`${divider}%`}>
  <div class="clip">
    <MapSurface bind:engine bind:element bind:ready bind:providerId {imagery} s2={s2} s1={s1} {view} {bearing} {home}
      resetToHome={false} {imperial} {overlays} {armed} chrome={false} controlsTop={108} {onclick} {oncontextmenu} {onusage}
      {onimageryfallback} errorSide="right" />
  </div>
  <button type="button" class="line" class:dragging class:armed={!!armed} role="slider" aria-label="Split between the before and after passes"
    aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(divider)} tabindex="0"
    onpointerdown={press} onpointermove={drag} onpointerup={release} onpointercancel={release} onkeydown={key}>
    <span class="handle" aria-hidden="true">
      <Icon name="chevronLeft" size={12} stroke={2.4} /><i></i><Icon name="chevronRight" size={12} stroke={2.4} />
    </span>
  </button>
</div>

<style>
  /* Over the first map and under everything the tool draws on the ground. */
  .second { position: absolute; inset: 0; z-index: 1; pointer-events: none; }
  .clip { position: absolute; inset: 0; display: flex; clip-path: inset(0 0 0 var(--divider)); pointer-events: none; }
  .clip :global(.map-wrap) { pointer-events: auto; }
  .line {
    position: absolute;
    top: 0;
    bottom: 0;
    left: var(--divider);
    z-index: 2;
    width: 2px;
    padding: 0;
    border: 0;
    transform: translateX(-1px);
    background: rgb(255 255 255 / 0.92);
    box-shadow: 0 0 5px rgb(0 0 0 / 0.75);
    cursor: ew-resize;
    pointer-events: auto;
    touch-action: none;
  }
  .line::before { position: absolute; inset: 0 -6px; content: ''; }
  /* With a pin armed the line lets the click through, so a pin can be dropped on the ground it runs
     over, which is the middle of the map when the map is centred on what is being checked. The
     handle still takes the drag. */
  .line.armed { pointer-events: none; }
  .line:focus-visible { outline: none; }
  .line:focus-visible .handle { box-shadow: 0 0 0 2px var(--accent), 0 4px 14px rgb(0 0 0 / 0.45); }
  /* Off the middle of the map, where a click aimed at the place being checked would land on it. */
  .handle {
    position: absolute;
    top: 26%;
    left: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    width: 40px;
    height: 30px;
    transform: translate(-50%, -50%);
    border: 1px solid rgb(255 255 255 / 0.38);
    border-radius: 9px;
    background: rgb(24 24 24 / 0.88);
    backdrop-filter: blur(6px);
    box-shadow: 0 4px 14px rgb(0 0 0 / 0.45);
    color: #f8fafc;
    pointer-events: auto;
    transition: background 0.12s var(--ease), border-color 0.12s var(--ease), transform 0.12s var(--ease);
  }
  .handle i { width: 1px; height: 14px; background: rgb(255 255 255 / 0.28); }
  .line:hover .handle, .line.dragging .handle {
    border-color: rgb(255 255 255 / 0.62);
    background: rgb(12 12 12 / 0.94);
    transform: translate(-50%, -50%) scale(1.04);
  }
</style>
