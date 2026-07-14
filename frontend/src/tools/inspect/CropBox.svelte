<script>
  import { clampCrop, moveCrop, resizeCropByHandle } from '../../lib/inspect.js';

  // Editable crop rectangle overlaid on an image. Emits a fractional (0..1)
  // {x,y,w,h} via `bind:crop`. Eight handles resize (corners + edges), the body
  // moves, and — while `draw` is armed — dragging empty space draws a fresh box.
  // With `aspect` (pixel w/h) set the box keeps that ratio. All the geometry is
  // pure (see inspect.js), so the Frame overlay and the piece modal share it.
  let {
    crop = $bindable(null),
    draw = $bindable(false),
    aspect = null,
    natW = null,
    natH = null,
    min = 0.02,
  } = $props();

  let layerEl = $state();
  let action = null; // { type:'draw'|'move'|'resize', ... }

  // pixel aspect (w/h) → fractional aspect, since the box is stored in 0..1
  const fracAspect = $derived(
    aspect ? (natW && natH ? aspect * (natH / natW) : aspect) : null
  );

  const HANDLES = [
    { h: 'nw', x: 0, y: 0 }, { h: 'n', x: 0.5, y: 0 }, { h: 'ne', x: 1, y: 0 },
    { h: 'e', x: 1, y: 0.5 }, { h: 'se', x: 1, y: 1 }, { h: 's', x: 0.5, y: 1 },
    { h: 'sw', x: 0, y: 1 }, { h: 'w', x: 0, y: 0.5 },
  ];
  const CURSORS = {
    nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
    n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
  };

  function frac(e) {
    const r = layerEl.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }

  function begin(a) {
    action = a;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function onMove(e) {
    if (!action) return;
    const p = frac(e);
    if (action.type === 'draw') {
      let c = {
        x: Math.min(action.sx, p.x), y: Math.min(action.sy, p.y),
        w: Math.abs(p.x - action.sx), h: Math.abs(p.y - action.sy),
      };
      if (fracAspect) {
        c.h = c.w / fracAspect;
        if (p.y < action.sy) c.y = action.sy - c.h;
      }
      crop = c;
    } else if (action.type === 'move') {
      crop = moveCrop(action.orig, p.x - action.sx, p.y - action.sy);
    } else if (action.type === 'resize') {
      crop = resizeCropByHandle(action.orig, action.handle, p.x, p.y, fracAspect, min);
    }
  }

  function onUp() {
    if (action?.type === 'draw') {
      crop = crop && crop.w >= min && crop.h >= min ? clampCrop(crop, min) : action.prev;
      draw = false;
    }
    action = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  }

  function layerDown(e) {
    if (!draw || e.button !== 0) return; // middle-drag falls through (rotate)
    e.preventDefault();
    const p = frac(e);
    const prev = crop;
    crop = { x: p.x, y: p.y, w: 0, h: 0 };
    begin({ type: 'draw', sx: p.x, sy: p.y, prev });
  }

  function bodyDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const p = frac(e);
    begin({ type: 'move', sx: p.x, sy: p.y, orig: { ...crop } });
  }

  function handleDown(e, h) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    begin({ type: 'resize', handle: h, orig: { ...crop } });
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="cropbox-layer"
  class:drawing={draw}
  bind:this={layerEl}
  onpointerdown={layerDown}
>
  {#if crop}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="box"
      style:left={`${crop.x * 100}%`}
      style:top={`${crop.y * 100}%`}
      style:width={`${crop.w * 100}%`}
      style:height={`${crop.h * 100}%`}
      onpointerdown={bodyDown}
    >
      <span class="edge v" style:left="33.33%"></span>
      <span class="edge v" style:left="66.66%"></span>
      <span class="edge h" style:top="33.33%"></span>
      <span class="edge h" style:top="66.66%"></span>
      {#each HANDLES as hd (hd.h)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span
          class="handle {hd.h}"
          style:left={`${hd.x * 100}%`}
          style:top={`${hd.y * 100}%`}
          style:cursor={CURSORS[hd.h]}
          onpointerdown={(e) => handleDown(e, hd.h)}
        ></span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .cropbox-layer {
    position: absolute;
    inset: 0;
    pointer-events: none; /* empty area passes through (pan) unless drawing */
    z-index: 3;
  }
  .cropbox-layer.drawing {
    pointer-events: auto;
    cursor: crosshair;
  }
  .box {
    position: absolute;
    box-sizing: border-box;
    border: 1.5px solid var(--accent);
    box-shadow: 0 0 0 9999px rgba(6, 9, 14, 0.55);
    pointer-events: auto;
    cursor: move;
  }
  .edge {
    position: absolute;
    background: rgba(232, 163, 61, 0.35);
    pointer-events: none;
  }
  .edge.v {
    top: 0;
    bottom: 0;
    width: 1px;
  }
  .edge.h {
    left: 0;
    right: 0;
    height: 1px;
  }
  .handle {
    position: absolute;
    width: 12px;
    height: 12px;
    transform: translate(-50%, -50%);
    background: var(--accent);
    border: 2px solid #10141c;
    border-radius: 2px;
    pointer-events: auto;
    touch-action: none;
  }
  .handle.n,
  .handle.s {
    border-radius: 6px;
    width: 16px;
  }
  .handle.e,
  .handle.w {
    border-radius: 6px;
    height: 16px;
  }
</style>
