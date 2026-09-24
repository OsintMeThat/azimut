<script>
  import { cropAspect, cropImgStyle, styleText } from '../../lib/inspect.js';
  import { IDENTITY, matrixCss, rotateAbout, isIdentity, matrixAngleDeg } from '../../lib/frameRotate.js';
  import { beyondGuide, sweepDelta, turnBearing } from '../../lib/turn.js';
  import TurnGuide from '../../components/TurnGuide.svelte';
  import Icon from '../../components/Icon.svelte';
  import CropBox from './CropBox.svelte';

  // One frame, to be read closely. Wheel zooms toward the pointer, left-drag pans,
  // middle-drag turns the view around the grabbed point (Google-Earth style). All
  // three are view only and never saved: turning just helps read a tilted sign.
  //
  // Crop has two modes. *Editing* shows the original with a draggable box; once
  // applied, the viewer shows the cropped result. Double-click or the panel's
  // button goes back to editing. The parent owns begin/apply/cancel, since Escape
  // has to put back the crop that editing started from.
  let {
    frame,
    preview,
    aspect = null,
    cropEditing = false,
    cropMode = $bindable(false),
    onbegincrop,
    oncommitcrop,
  } = $props();

  let zoom = $state(1);
  let pan = $state({ x: 0, y: 0 });
  let rotMatrix = $state(IDENTITY); // accumulated view rotation, in the stage's own space
  let rotating = $state(false);
  let pivot = $state({ x: 0, y: 0 }); // the turn's marker, viewport-local px
  let stageEl = $state(); // rotated stage (image + crop overlay)
  let zoomEl = $state(); // zoom/pan layer, the reference box for screen → local
  let viewportEl = $state(); // outer viewport, the reference box for the marker

  // A new frame starts from a fitted, upright view.
  $effect(() => {
    frame.id;
    zoom = 1;
    pan = { x: 0, y: 0 };
    rotMatrix = IDENTITY;
  });

  const dirty = $derived(zoom !== 1 || pan.x !== 0 || pan.y !== 0 || !isIdentity(rotMatrix));
  const angle = $derived(Math.round(matrixAngleDeg(rotMatrix)));

  function reset() {
    zoom = 1;
    pan = { x: 0, y: 0 };
    rotMatrix = IDENTITY;
  }

  // Never below the fitted size; at 1× the pan snaps back to centre so the image
  // cannot drift off.
  function onwheel(e) {
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const cX = r.width / 2;
    const cY = r.height / 2;
    const old = zoom;
    const next = Math.min(Math.max(old * (e.deltaY > 0 ? 0.9 : 1.1), 1), 8);
    if (next === 1) {
      zoom = 1;
      pan = { x: 0, y: 0 };
      return;
    }
    // keep the point under the pointer fixed (transform-origin is the centre)
    const ratio = next / old;
    pan = {
      x: px - (px - (cX + pan.x)) * ratio - cX,
      y: py - (py - (cY + pan.y)) * ratio - cY,
    };
    zoom = next;
  }

  // The turn is a wheel about the grabbed point, the same as the maps
  // (`lib/turn.js`): read outside the guide circle, upright pulls it in, Ctrl
  // lays it on whole steps. It is kept as a matrix in the stage's own space, so
  // every new grab pivots from wherever you click with no jump, whatever the
  // view already looks like. A middle click that never moved stands the frame
  // back upright.
  const CLICK_SLOP = 4; // px a middle press may wander and still be a click
  function rotateStart(e) {
    if (!stageEl || !zoomEl || !viewportEl) return;
    // The zoom/pan layer carries only translate + scale, so its box is a clean
    // screen → local map; offsetLeft/Top place the stage's origin within it.
    const layer = zoomEl.getBoundingClientRect();
    const vp = viewportEl.getBoundingClientRect();
    const px = (e.clientX - layer.left) / zoom - stageEl.offsetLeft;
    const py = (e.clientY - layer.top) / zoom - stageEl.offsetTop;
    const base = rotMatrix;
    const baseAngle = matrixAngleDeg(base);
    const grab = { x: e.clientX, y: e.clientY };
    pivot = { x: e.clientX - vp.left, y: e.clientY - vp.top };
    rotating = true;
    let moved = false;
    let last = null; // the last point outside the circle, null while inside
    let swept = 0;
    const move = (ev) => {
      const at = { x: ev.clientX, y: ev.clientY };
      if (!moved && Math.hypot(at.x - grab.x, at.y - grab.y) >= CLICK_SLOP) moved = true;
      const out = beyondGuide(grab, at);
      const delta = out && last ? sweepDelta(grab, last, at) : 0;
      last = out ? at : null;
      if (!delta) return;
      swept += delta;
      const to = turnBearing(baseAngle, swept, { stepped: ev.ctrlKey || ev.metaKey });
      rotMatrix = rotateAbout(base, px, py, to - baseAngle);
    };
    const up = () => {
      rotating = false;
      if (!moved) rotMatrix = IDENTITY;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function panStart(e) {
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = pan.x;
    const oy = pan.y;
    const move = (ev) => {
      pan = { x: ox + ev.clientX - sx, y: oy + ev.clientY - sy };
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function onpointerdown(e) {
    if (e.button === 1) {
      e.preventDefault();
      if (!cropEditing) rotateStart(e); // the crop box stays upright
      return;
    }
    if (e.button !== 0 || cropMode || cropEditing) return; // the crop box owns drags
    e.preventDefault(); // no native image-drag ghost
    panStart(e);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="viewport"
  class:cropping={cropMode}
  class:pannable={!cropMode && !cropEditing}
  class:rotating
  bind:this={viewportEl}
  {onwheel}
  onmousedown={(e) => e.button === 1 && e.preventDefault()}
  {onpointerdown}
  onauxclick={(e) => e.preventDefault()}
  ondblclick={() => onbegincrop?.()}
>
  <div class="zoom-layer" bind:this={zoomEl} style:transform={`translate(${pan.x}px, ${pan.y}px) scale(${zoom})`}>
    <div class="stage" bind:this={stageEl} style:transform={matrixCss(rotMatrix)} style:transform-origin="0 0">
      {#if frame.crop && !cropEditing}
        <div class="crop-view" style:--ar={cropAspect(frame.crop, frame.w, frame.h) ?? 1}>
          <img
            src={frame.url}
            alt="frame"
            draggable="false"
            style={styleText(cropImgStyle(frame.crop))}
            style:filter={preview.filter}
            style:transform={preview.transform}
          />
        </div>
      {:else}
        <img src={frame.url} alt="frame" draggable="false" style:filter={preview.filter} style:transform={preview.transform} />
        <CropBox bind:crop={frame.crop} bind:draw={cropMode} {aspect} natW={frame.w} natH={frame.h} />
      {/if}
    </div>
  </div>
  {#if rotating}
    <TurnGuide x={pivot.x} y={pivot.y} />
  {/if}
  <div class="view-ctl">
    {#if cropEditing}
      <span class="hint">drag to crop · Enter applies · Esc cancels</span>
      <button class="btn btn-sm" onclick={() => oncommitcrop?.()} title="Apply the crop (Enter)">
        <Icon name="check" size={14} /> Apply
      </button>
    {:else if dirty}
      {#if zoom !== 1}<span class="val">{Math.round(zoom * 100)}%</span>{/if}
      {#if angle !== 0}<span class="val">{angle}°</span>{/if}
      <button class="btn btn-ghost btn-sm" onclick={reset} title="Reset zoom, pan and turn">
        <Icon name="eye" size={14} /> Fit
      </button>
    {:else}
      <span class="hint">scroll zoom · drag pan · middle-drag turns · double-click crop</span>
    {/if}
  </div>
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
  .view-ctl {
    position: absolute;
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
</style>
