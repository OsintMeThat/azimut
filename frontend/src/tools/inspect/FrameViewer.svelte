<script>
  import { untrack } from 'svelte';
  import { cropAspect, cropImgStyle, styleText } from '../../lib/inspect.js';
  import { ViewTransform } from '../../lib/viewTransform.svelte.js';
  import { INSPECT_HELP } from '../../lib/inspectHelp.js';
  import TurnGuide from '../../components/TurnGuide.svelte';
  import Icon from '../../components/Icon.svelte';
  import CropBox from './CropBox.svelte';
  import ZoneSearch from './ZoneSearch.svelte';

  // One frame, to be read closely, with the zoom, pan and turn of
  // `lib/viewTransform.svelte.js`.
  //
  // Crop has two modes. *Editing* shows the original with a draggable box; once
  // applied, the viewer shows the cropped result. Double-click or the panel's
  // button goes back to editing. The parent owns begin/apply/cancel, since Escape
  // has to put back the crop that editing started from.
  //
  // `src` is the picture as the adjustments make it when the server had to render
  // them (a filter CSS cannot preview); otherwise the frame's own pixels take the
  // CSS preview. `original` drops both while the analyst holds the compare key.
  // `overlay` is an analysis laid over the frame, Error Level Analysis today.
  //
  // Zone search (`ZoneSearch`) is offered when the parent gives the zone's picture.
  // Open, it stands the frame upright, the left button draws the zone and the
  // middle one pans; it is not offered while a crop is drawn.
  let {
    frame,
    preview,
    src = null,
    original = false,
    overlay = null,
    aspect = null,
    cropEditing = false,
    cropMode = $bindable(false),
    onbegincrop,
    oncommitcrop,
    zonePicture = null,
    zoning = $bindable(false),
    zone = $bindable(null),
  } = $props();

  const view = new ViewTransform();
  let stageEl = $state(); // turned stage (image + crop overlay)
  let zoomEl = $state(); // zoom/pan layer, the reference box for screen → local
  let viewportEl = $state(); // outer viewport, the reference box for the marker
  let pictureEl = $state(); // the picture as drawn, cropped or whole, which a zone is read on

  // A new frame starts from a fitted, upright view.
  $effect(() => {
    frame.id;
    view.reset();
  });

  const shown = $derived(original || !src ? frame.url : src);
  const filter = $derived(original || src ? '' : preview.filter);
  const transform = $derived(original || src ? '' : preview.transform);
  const laid = $derived(overlay && !original && !cropEditing ? overlay : null);
  // the picture's own pixels as shown: after the crop, when there is one
  const shownW = $derived(frame.crop ? frame.w * frame.crop.w : frame.w);
  const shownH = $derived(frame.crop ? frame.h * frame.crop.h : frame.h);

  $effect(() => {
    if (zoning) untrack(() => view.upright());
  });

  function toggleZone() {
    zoning = !zoning;
    zone = null;
  }

  function onwheel(e) {
    e.preventDefault();
    view.wheel(e, e.currentTarget.getBoundingClientRect());
  }

  function onpointerdown(e) {
    if (e.button === 1) {
      e.preventDefault();
      if (zoning) view.panFrom(e); // the zone stays upright, so the middle button pans
      else if (!cropEditing) view.turnFrom(e, { viewport: viewportEl, layer: zoomEl, stage: stageEl }); // the crop box stays upright
      return;
    }
    if (e.button !== 0 || cropMode || cropEditing || zoning) return; // the crop box or the zone owns drags
    e.preventDefault(); // no native image-drag ghost
    view.panFrom(e);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="viewport"
  class:cropping={cropMode}
  class:pannable={!cropMode && !cropEditing && !zoning}
  class:rotating={view.turning}
  bind:this={viewportEl}
  {onwheel}
  onmousedown={(e) => e.button === 1 && e.preventDefault()}
  {onpointerdown}
  onauxclick={(e) => e.preventDefault()}
  ondblclick={() => !zoning && onbegincrop?.()}
>
  <div class="zoom-layer" bind:this={zoomEl} style:transform={view.layerCss}>
    <div class="stage" bind:this={stageEl} style:transform={view.stageCss} style:transform-origin="0 0">
      {#if frame.crop && !cropEditing}
        <div class="crop-view" bind:this={pictureEl} style:--ar={cropAspect(frame.crop, frame.w, frame.h) ?? 1}>
          <img
            src={shown}
            alt="frame"
            draggable="false"
            style={styleText(cropImgStyle(frame.crop))}
            style:filter
            style:transform
          />
          {#if laid}
            <img class="overlay" src={laid.url} alt="" draggable="false" style:opacity={laid.opacity} />
          {/if}
        </div>
      {:else}
        <img bind:this={pictureEl} src={shown} alt="frame" draggable="false" style:filter style:transform />
        {#if laid}
          <img class="overlay" src={laid.url} alt="" draggable="false" style:opacity={laid.opacity} />
        {/if}
        <CropBox bind:crop={frame.crop} bind:draw={cropMode} {aspect} natW={frame.w} natH={frame.h} />
      {/if}
    </div>
  </div>
  {#if view.turning}
    <TurnGuide x={view.pivot.x} y={view.pivot.y} />
  {/if}
  {#if original}
    <span class="original-tag">Without adjustments</span>
  {/if}
  <div class="view-ctl">
    {#if cropEditing}
      <span class="hint">drag to crop · Enter applies · Esc cancels</span>
      <button class="btn btn-sm" onclick={() => oncommitcrop?.()} title="Apply the crop (Enter)">
        <Icon name="check" size={14} /> Apply
      </button>
    {:else if view.dirty}
      {#if view.zoom !== 1}<span class="val">{Math.round(view.zoom * 100)}%</span>{/if}
      {#if view.angle !== 0}<span class="val">{view.angle}°</span>{/if}
      <button class="btn btn-ghost btn-sm" onclick={() => view.reset()} title={INSPECT_HELP.fit}>
        <Icon name="eye" size={14} /> Fit
      </button>
    {:else if zoning}
      <span class="hint">scroll zoom · middle-drag pans · Esc closes</span>
    {:else}
      <span class="hint">scroll zoom · drag pan · middle-drag turns · double-click crop</span>
    {/if}
    {#if zonePicture && !cropEditing}
      <button
        class="btn btn-ghost btn-sm zone-btn"
        class:on={zoning}
        onclick={toggleZone}
        aria-label="Search a zone"
        aria-pressed={zoning}
        title={INSPECT_HELP.zoneIcon}
      >
        <Icon name="zoneSearch" size={14} />
      </button>
    {/if}
  </div>
  {#if zoning && zonePicture && !cropEditing}
    <ZoneSearch
      box={() => pictureEl}
      watch={view.layerCss}
      width={shownW}
      height={shownH}
      bind:zone
      picture={zonePicture}
      onclose={toggleZone}
    />
  {/if}
</div>

<style>
  .viewport {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    touch-action: none;
  }
  .viewport.pannable {
    cursor: grab;
  }
  .viewport.cropping {
    cursor: crosshair;
  }
  .viewport.rotating {
    cursor: grabbing;
  }
  .zoom-layer {
    position: relative;
    transform-origin: center center;
    display: inline-block;
    line-height: 0;
  }
  .stage {
    position: relative;
    display: inline-block;
    line-height: 0;
  }
  .stage > img {
    max-width: 100%;
    max-height: calc(100vh - var(--topbar-h) - 260px);
    display: block;
  }
  .crop-view {
    position: relative;
    overflow: hidden;
    aspect-ratio: var(--ar);
    height: calc(100vh - var(--topbar-h) - 280px);
    max-width: 100%;
    line-height: 0;
  }
  .crop-view img {
    display: block;
  }
  /* An analysis drawn over the picture, at the picture's own size. */
  .overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    max-width: none;
    max-height: none;
    pointer-events: none;
    mix-blend-mode: normal;
  }
  .original-tag {
    position: absolute;
    left: 10px;
    top: 10px;
    padding: 2px 8px;
    border-radius: var(--r-sm);
    background: rgba(22, 22, 22, 0.85);
    border: 1px solid var(--border);
    color: var(--text-2);
    font-size: var(--fs-xs);
    pointer-events: none;
  }
  .view-ctl {
    position: absolute;
    z-index: 3;
    right: 10px;
    bottom: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 6px;
    border-radius: var(--r-md);
    background: rgba(22, 22, 22, 0.85);
    border: 1px solid var(--border);
  }
  .val {
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }
  .hint {
    font-size: 11px;
    color: var(--text-3);
    user-select: none;
  }
  .zone-btn.on {
    color: var(--accent);
  }
</style>
