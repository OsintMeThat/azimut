<script>
  import { prefs } from '../../lib/state.svelte.js';
  import { extensionVersion } from '../../lib/extBridge.js';
  import { UPLOAD_PAGES } from '../../lib/reverseSearch.js';
  import { copyPicture, engineRoad, filledEngines, pressEngine } from '../../lib/reverseHandoff.js';
  import { SMALL_ZONE_PX, barPlace, pictureRect, zonePixels, zoneRect } from '../../lib/searchZone.js';
  import { INSPECT_HELP } from '../../lib/inspectHelp.js';
  import Icon from '../../components/Icon.svelte';
  import CropBox from './CropBox.svelte';

  // Zone search over a viewer. A drag over the picture picks the part to search,
  // its handles adjust it, and the bar beside it hands that part to an engine by
  // the same press as Reverse Search (`lib/reverseHandoff.js`). The viewer stands
  // the picture upright while this is open, so the zone is a plain rectangle of
  // the picture as it reads; the parent renders it from the file's own pixels.
  let {
    // the element the picture is drawn in, as it stands on screen
    box,
    // whatever moves that element without resizing it (the view's zoom and pan, a
    // turn of the clip): read so the frame is measured again
    watch = null,
    // the picture's own size in pixels, for the size the engines get
    width = 0,
    height = 0,
    zone = $bindable(null),
    // the zone's picture for the engines, `{ png, name, what }` (`lib/reverseHandoff.js`)
    picture,
    onclose,
  } = $props();

  // The marker the extension stamps on <html> at document_start. Read once, as
  // Reverse Search does: installing it with the app open needs a reload anyway.
  const extInstalled = globalThis.document ? extensionVersion() : null;
  const filled = $derived(filledEngines(prefs.reversePrefill, extInstalled));
  const ROAD_ICON = { fill: 'search', paste: 'copy', drag: 'download' };
  const ROAD_HELP = { fill: INSPECT_HELP.zoneFill, paste: INSPECT_HELP.zonePaste, drag: INSPECT_HELP.zoneDrag };
  const WHOLE = { x: 0, y: 0, w: 1, h: 1 };

  let overlayEl = $state();
  let frame = $state(null); // where the picture stands in the overlay
  let view = $state({ width: 0, height: 0 });
  let barW = $state(0);
  let barH = $state(0);

  const whole = $derived(!!zone && zone.x === 0 && zone.y === 0 && zone.w === 1 && zone.h === 1);
  const size = $derived(zonePixels(zone, width, height));
  const small = $derived(!!size && Math.min(size.w, size.h) < SMALL_ZONE_PX);
  const place = $derived(
    barPlace(zone && frame ? zoneRect(zone, frame) : null, { width: barW, height: barH }, view)
  );

  function measure() {
    const el = box?.();
    if (!el || !overlayEl) return;
    const outer = overlayEl.getBoundingClientRect();
    frame = pictureRect(el.getBoundingClientRect(), outer);
    view = { width: outer.width, height: outer.height };
  }

  // A zoom, a pan or a turn moves the picture with no resize to observe.
  $effect(() => {
    watch;
    measure();
  });

  // The viewer resized, or the picture loaded at its own size.
  $effect(() => {
    const el = box?.();
    if (!overlayEl || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(overlayEl);
    if (el) observer.observe(el);
    return () => observer.disconnect();
  });
</script>

<div class="zone-overlay" bind:this={overlayEl}>
  {#if frame}
    <div
      class="zone-frame"
      style:left={`${frame.left}px`}
      style:top={`${frame.top}px`}
      style:width={`${frame.width}px`}
      style:height={`${frame.height}px`}
    >
      <CropBox bind:crop={zone} redraw min={0.01} />
    </div>
  {/if}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="zone-bar"
    role="toolbar"
    aria-label="Search a zone"
    tabindex="-1"
    bind:clientWidth={barW}
    bind:clientHeight={barH}
    style:left={`${place.left}px`}
    style:top={`${place.top}px`}
    onpointerdown={(e) => e.stopPropagation()}
  >
    {#if zone}
      {#each UPLOAD_PAGES as e (e.id)}
        {@const road = engineRoad(e, filled)}
        <a
          href={e.url}
          target="_blank"
          rel="noreferrer"
          class="btn btn-sm engine"
          title={ROAD_HELP[road]}
          onclick={(event) => pressEngine(event, e, picture(), filled)}
        ><Icon name={ROAD_ICON[road]} size={13} /> {e.label}</a>
      {/each}
      {#if size}
        <span class="size mono" class:small title={small ? INSPECT_HELP.zoneSmall : undefined}>
          {#if small}<Icon name="alert" size={12} />{/if}{size.w} × {size.h} px
        </span>
      {/if}
      <button class="btn btn-ghost btn-sm" onclick={() => copyPicture(picture(), 'Copied the zone')} title={INSPECT_HELP.zoneCopy}>
        <Icon name="copy" size={13} /> Copy
      </button>
    {:else}
      <span class="lead">Drag over what to search</span>
    {/if}
    {#if !whole}
      <button class="btn btn-ghost btn-sm" onclick={() => (zone = { ...WHOLE })} title={INSPECT_HELP.zoneWhole}>Whole picture</button>
    {/if}
    <button class="btn btn-ghost btn-sm close" onclick={() => onclose?.()} aria-label="Stop searching" title={INSPECT_HELP.zoneClose}>
      <Icon name="x" size={14} />
    </button>
  </div>
</div>

<style>
  /* Laid over the whole viewer, letting everything through but the zone and its bar. */
  .zone-overlay {
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
  }
  .zone-frame {
    position: absolute;
    pointer-events: none;
  }
  .zone-bar {
    position: absolute;
    z-index: 4;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    /* sized by its content and the viewer alone, never by where it stands: a width
       that followed its place would move it again each time it is placed */
    width: max-content;
    max-width: calc(100% - 16px);
    padding: 4px;
    border-radius: var(--r-md);
    background: var(--bg-1);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-2);
    pointer-events: auto;
    cursor: default;
    line-height: normal;
  }
  .engine {
    gap: 5px;
  }
  .lead {
    padding: 0 6px;
    font-size: var(--fs-xs);
    color: var(--text-2);
    white-space: nowrap;
  }
  .size {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0 6px;
    font-size: 11px;
    color: var(--text-3);
    white-space: nowrap;
  }
  .size.small {
    color: var(--warn);
  }
  .close {
    padding: 0 6px;
  }
</style>
