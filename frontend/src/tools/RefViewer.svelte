<script>
  // One floating reference-image window over the Satellite map. Drag the header
  // to move it, roll it up, resize from the corner, fade it with the opacity
  // slider, and wheel/drag to zoom & pan the image. Pure geometry lives in
  // lib/refViewers.js; this file is the pointer/DOM glue. Session-only: nothing
  // here is captured or saved.
  import Icon from '../components/Icon.svelte';
  import {
    clamp,
    clampWindow,
    clampSize,
    clampPan,
    zoomAt,
    MIN_SCALE,
    MAX_SCALE,
  } from '../lib/refViewers.js';

  let { viewer, caseId, zBase = 630, onfocus, onclose } = $props();

  let el; // the window root
  let headEl;
  let bodyEl;

  // the map-wrap we're positioned in — the box drags/resizes are clamped to
  const bounds = () => {
    const r = el.parentElement.getBoundingClientRect();
    return { w: r.width, h: r.height };
  };

  function focus() {
    onfocus?.(viewer.id);
  }

  // run `move` on pointer drags until release; shared by the three gestures
  function drag(move) {
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function startWindowDrag(e) {
    if (e.button !== 0 || e.target.closest('button')) return;
    focus();
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const x0 = viewer.x;
    const y0 = viewer.y;
    drag((ev) => {
      const h = viewer.collapsed ? headEl.offsetHeight : viewer.h;
      const c = clampWindow(x0 + (ev.clientX - sx), y0 + (ev.clientY - sy), viewer.w, h, bounds());
      viewer.x = c.x;
      viewer.y = c.y;
    });
  }

  function startResize(e) {
    if (e.button !== 0) return;
    focus();
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const w0 = viewer.w;
    const h0 = viewer.h;
    drag((ev) => {
      const s = clampSize(w0 + (ev.clientX - sx), h0 + (ev.clientY - sy), viewer.x, viewer.y, bounds());
      viewer.w = s.w;
      viewer.h = s.h;
      reclampPan();
    });
  }

  function startPan(e) {
    // videos keep their native controls; only the zoomed-in image pans, and at
    // fit scale a drag does nothing
    if (isVideo || e.button !== 0 || viewer.scale <= MIN_SCALE) return;
    focus();
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const ox0 = viewer.ox;
    const oy0 = viewer.oy;
    drag((ev) => {
      const p = clampPan(
        ox0 + (ev.clientX - sx),
        oy0 + (ev.clientY - sy),
        viewer.scale,
        bodyEl.clientWidth,
        bodyEl.clientHeight
      );
      viewer.ox = p.ox;
      viewer.oy = p.oy;
    });
  }

  function onWheel(e) {
    if (isVideo) return; // let the page scroll / video controls behave normally
    e.preventDefault();
    const rect = bodyEl.getBoundingClientRect();
    const cursor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    apply(zoomAt(viewer, factor, cursor, { w: rect.width, h: rect.height }));
  }

  function zoomBy(factor) {
    const size = { w: bodyEl.clientWidth, h: bodyEl.clientHeight };
    apply(zoomAt(viewer, factor, { x: size.w / 2, y: size.h / 2 }, size));
  }

  function resetZoom() {
    viewer.scale = 1;
    viewer.ox = 0;
    viewer.oy = 0;
  }

  function apply({ scale, ox, oy }) {
    viewer.scale = scale;
    viewer.ox = ox;
    viewer.oy = oy;
  }

  // keep the pan legal after the window (and so the viewport) resizes
  function reclampPan() {
    if (!bodyEl) return;
    const p = clampPan(viewer.ox, viewer.oy, viewer.scale, bodyEl.clientWidth, bodyEl.clientHeight);
    viewer.ox = p.ox;
    viewer.oy = p.oy;
  }

  const isVideo = $derived(viewer.kind === 'video');
  const pct = $derived(Math.round(viewer.scale * 100));
</script>

<div
  bind:this={el}
  class="ref-viewer card"
  class:collapsed={viewer.collapsed}
  style:left={`${viewer.x}px`}
  style:top={`${viewer.y}px`}
  style:width={`${viewer.w}px`}
  style:height={viewer.collapsed ? 'auto' : `${viewer.h}px`}
  style:z-index={zBase + viewer.z}
  onpointerdown={focus}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div bind:this={headEl} class="rv-head" onpointerdown={startWindowDrag} title="Drag to move">
    <Icon name="grip" size={14} />
    <span class="rv-title" title={viewer.title}>{viewer.title || 'Reference'}</span>
    <button
      class="rv-btn"
      onclick={() => (viewer.collapsed = !viewer.collapsed)}
      title={viewer.collapsed ? 'Expand' : 'Collapse'}
      aria-label={viewer.collapsed ? 'Expand' : 'Collapse'}
    >
      <Icon name={viewer.collapsed ? 'chevronDown' : 'chevronUp'} size={13} />
    </button>
    <button class="rv-btn" onclick={() => onclose?.(viewer.id)} title="Close" aria-label="Close">
      <Icon name="x" size={13} />
    </button>
  </div>

  {#if !viewer.collapsed}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      bind:this={bodyEl}
      class="rv-body"
      class:pannable={!isVideo && viewer.scale > MIN_SCALE}
      onpointerdown={startPan}
      onwheel={onWheel}
    >
      {#if caseId}
        {#if isVideo}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video src={`/files/${caseId}/${viewer.path}`} controls preload="metadata"></video>
        {:else}
          <img
            src={`/files/${caseId}/${viewer.path}`}
            alt={viewer.title}
            draggable="false"
            style:transform={`translate(${viewer.ox}px, ${viewer.oy}px) scale(${viewer.scale})`}
          />
        {/if}
      {/if}
    </div>

    {#if !isVideo}
      <div class="rv-foot">
        <span class="rv-gap"></span>
        <button class="rv-btn" onclick={() => zoomBy(1 / 1.25)} title="Zoom out" aria-label="Zoom out">
          <Icon name="minimize" size={12} />
        </button>
        <button class="rv-zoom" onclick={resetZoom} title="Reset zoom">{pct}%</button>
        <button class="rv-btn" onclick={() => zoomBy(1.25)} title="Zoom in" aria-label="Zoom in">
          <Icon name="plus" size={13} />
        </button>
      </div>
    {/if}

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="rv-resize" onpointerdown={startResize} title="Resize"></div>
  {/if}
</div>

<style>
  .ref-viewer {
    position: absolute;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: rgba(16, 22, 35, 0.92);
    backdrop-filter: blur(6px);
    box-shadow: var(--shadow-2);
    user-select: none;
  }
  .rv-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 6px 5px 8px;
    color: var(--text-2);
    cursor: grab;
    flex-shrink: 0;
  }
  .rv-head:active {
    cursor: grabbing;
  }
  .rv-title {
    flex: 1;
    min-width: 0;
    font-size: var(--fs-xs);
    color: var(--text-1);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rv-btn {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-1);
    color: var(--text-2);
    cursor: pointer;
    flex-shrink: 0;
  }
  .rv-btn:hover {
    color: var(--text-1);
    background: var(--bg-3);
  }
  .rv-body {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
    background:
      linear-gradient(45deg, rgba(255, 255, 255, 0.03) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.03) 75%),
      linear-gradient(45deg, rgba(255, 255, 255, 0.03) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.03) 75%);
    background-size: 16px 16px;
    background-position: 0 0, 8px 8px;
  }
  .rv-body.pannable {
    cursor: grab;
  }
  .rv-body.pannable:active {
    cursor: grabbing;
  }
  .rv-body img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    transform-origin: 0 0;
    pointer-events: none;
  }
  .rv-body video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #000;
  }
  .rv-foot {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    color: var(--text-3);
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }
  .rv-gap {
    flex: 1;
  }
  .rv-zoom {
    min-width: 42px;
    text-align: center;
    font-size: var(--fs-xs);
    color: var(--text-2);
    cursor: pointer;
    padding: 2px 4px;
    border-radius: var(--radius-1);
  }
  .rv-zoom:hover {
    color: var(--accent);
    background: var(--bg-3);
  }
  .rv-resize {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 16px;
    height: 16px;
    cursor: nwse-resize;
    background: linear-gradient(
      135deg,
      transparent 50%,
      var(--border-strong) 50%,
      var(--border-strong) 60%,
      transparent 60%,
      transparent 72%,
      var(--border-strong) 72%,
      var(--border-strong) 82%,
      transparent 82%
    );
  }
</style>
