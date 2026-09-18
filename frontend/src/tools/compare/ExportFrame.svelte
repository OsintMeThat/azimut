<script>
  /**
   * The rectangle an export is framed to, drawn over the compared imagery.
   *
   * The frame is held on the ground, so it stays on the same roofs when the
   * camera moves. In Side by side, B shows the same box read-only. In an
   * overlaid mode, one stage-level frame spans whichever pixels are visible.
   */
  import { boundedRect, frameSpan } from '../../lib/map/exportFrame.js';
  import { formatDistance } from '../../lib/measure.js';

  let { engine, frame = null, drawing = false, readonly = false, units = 'metric', bearing = 0,
    onframe = () => {}, oncancel = () => {} } = $props();

  let root = $state();
  let revision = $state(0);
  let draft = $state(null); // { from: [x, y], to: [x, y] } while the pointer is down

  $effect(() => {
    if (!engine) return;
    const refresh = () => revision++;
    const release = engine.on('view-move', refresh);
    const observer = new ResizeObserver(refresh);
    if (root) observer.observe(root);
    return () => { release(); observer.disconnect(); };
  });

  const project = ([lon, lat]) => {
    revision;
    const at = engine?.latLngToContainerPoint({ lon, lat });
    return [at?.x ?? 0, at?.y ?? 0];
  };

  const box = (first, second) => ({
    x: Math.min(first[0], second[0]),
    y: Math.min(first[1], second[1]),
    w: Math.abs(second[0] - first[0]),
    h: Math.abs(second[1] - first[1]),
  });

  const rect = $derived.by(() => {
    if (draft) return box(draft.from, draft.to);
    if (!frame?.points || !engine) return null;
    return box(project(frame.points[0]), project(frame.points[1]));
  });
  const span = $derived(frame?.points && !draft ? frameSpan(frame.points, bearing) : null);

  function at(event) {
    const bounds = root?.getBoundingClientRect();
    if (!bounds?.width) return null;
    return [
      Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
      Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)),
    ];
  }

  function ground([x, y]) {
    const point = engine?.containerPointToLatLng({ x, y });
    return point ? [point.lon, point.lat] : null;
  }

  function begin(event) {
    if (!drawing || event.button > 0) return;
    const start = at(event);
    if (!start) return;
    event.preventDefault();
    event.stopPropagation();
    draft = { from: start, to: start };
    root.setPointerCapture?.(event.pointerId);
  }

  function move(event) {
    if (!draft) return;
    const now = at(event);
    if (now) draft = { ...draft, to: now };
  }

  function finish(event) {
    if (!draft) return;
    move(event);
    root.releasePointerCapture?.(event.pointerId);
    const drawn = box(draft.from, draft.to);
    draft = null;
    // A click is not a frame. A small but deliberate drawing grows around its
    // own centre here, so the rectangle kept on screen is exactly what the
    // export later cuts to.
    if (drawn.w < 24 || drawn.h < 24) return oncancel();
    const bounds = root.getBoundingClientRect();
    const cut = boundedRect(drawn, { width: bounds.width, height: bounds.height });
    const corners = [ground([cut.x, cut.y]), ground([cut.x + cut.w, cut.y + cut.h])];
    if (corners.every(Boolean)) onframe({ points: corners });
    else oncancel();
  }

  function keydown(event) {
    if (event.key !== 'Escape' || !drawing) return;
    event.stopPropagation();
    draft = null;
    oncancel();
  }
</script>

<svelte:window onkeydown={keydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="export-frame"
  class:drawing
  class:readonly
  bind:this={root}
  onpointerdown={begin}
  onpointermove={move}
  onpointerup={finish}
  onpointercancel={finish}
>
  {#if rect}
    <svg class="frame-shape" aria-hidden="true">
      {#if drawing}
        <path class="dim" fill-rule="evenodd"
          d={`M0,0 H99999 V99999 H0 Z M${rect.x},${rect.y} h${rect.w} v${rect.h} h${-rect.w} Z`} />
      {/if}
      <rect class="edge" x={rect.x + 0.5} y={rect.y + 0.5} width={Math.max(0, rect.w - 1)} height={Math.max(0, rect.h - 1)} />
    </svg>
    {#if !readonly}
      <span class="frame-tag" style:left={`${rect.x}px`} style:top={`${rect.y}px`}>
        {#if span}Export frame · {formatDistance(span.width, units)} × {formatDistance(span.height, units)}
        {:else}{Math.round(rect.w)} × {Math.round(rect.h)}{/if}
      </span>
    {/if}
  {:else if drawing}
    <div class="frame-hint">Drag over the area to export. Escape to cancel.</div>
  {/if}
</div>

<style>
  .export-frame { position: absolute; inset: 0; z-index: 530; pointer-events: none; overflow: hidden; }
  .export-frame.drawing { z-index: 600; pointer-events: auto; cursor: crosshair; touch-action: none; }
  .frame-shape { position: absolute; inset: 0; width: 100%; height: 100%; }
  .dim { fill: rgba(9, 11, 14, .55); }
  .edge { fill: none; stroke: #e8a33d; stroke-width: 2; stroke-dasharray: 7 5; }
  .readonly .edge { stroke: rgba(232, 163, 61, .6); stroke-dasharray: 4 6; }
  .frame-tag {
    position: absolute; transform: translateY(-100%); margin-top: -4px;
    padding: 3px 7px; border-radius: 5px; background: rgba(9, 11, 14, .85);
    color: #f3f4f6; font-size: 11px; font-weight: 600; white-space: nowrap;
  }
  .frame-hint {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    background: rgba(9, 11, 14, .45); color: #f3f4f6; font-size: 13px; font-weight: 600;
  }
</style>
