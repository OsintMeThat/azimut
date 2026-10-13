<script>
  /**
   * The photo column of Find: the photo on its own, no terrain behind it yet,
   * with its skyline traced on it and the alignments' points.
   *
   * The trace is the overlay's, drawn with the view's own tools: the pen snaps
   * a stroke onto the sky's edge (Alt draws it as drawn), Detect finds the whole
   * skyline, the rubber rubs out, and every change can be taken back. The wheel
   * looks closer about the pointer and a drag moves the photo when no tool is
   * out. While an alignment asks for the photo, a click places its point.
   */
  import Icon from '../../components/Icon.svelte';
  import { toast } from '../../lib/state.svelte.js';

  let {
    /** The photo and its trace (state/overlay.svelte.js). */
    overlay,
    /** The finder (state/find.svelte.js): its alignments and the click it waits for. */
    find,
    /** Asked to choose the photo. */
    onpick = () => {},
  } = $props();

  const RUBBER_PX = 12;
  const ZOOM_MAX = 16;

  let box = $state();
  let canvas = $state();
  let width = $state(0);
  let height = $state(0);
  let zoom = $state(1);
  let pan = $state({ x: 0, y: 0 });
  let press = null;
  let drawing = $state([]);
  let rubberAt = $state(null);

  const aspect = $derived(overlay.aspect || 0);
  /** Where the photo lies in the column, magnified and moved. */
  const rect = $derived.by(() => {
    if (!(aspect > 0) || !(width > 0) || !(height > 0)) return null;
    const fitW = Math.min(width, height * aspect);
    const fitH = fitW / aspect;
    const w = fitW * zoom;
    const h = fitH * zoom;
    return { x: width / 2 - w / 2 + pan.x, y: height / 2 - h / 2 + pan.y, w, h };
  });
  const asking = $derived(find.step?.on === 'photo');

  const toScreen = (p) => ({ x: rect.x + p.u * rect.w, y: rect.y + p.v * rect.h });
  const toPhoto = (x, y) => ({ u: (x - rect.x) / rect.w, v: (y - rect.y) / rect.h });
  const inside = (p) => p.u >= 0 && p.u <= 1 && p.v >= 0 && p.v <= 1;
  const scale = () => ({ width: rect.w, height: rect.h });

  // the photo drawn again when it, its frame, the column or the loupe change
  $effect(() => {
    void overlay.frame;
    const picture = overlay.rawPicture;
    const r = rect;
    if (!canvas) return;
    const ratio = globalThis.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const pen = canvas.getContext?.('2d');
    if (!pen) return;
    pen.setTransform(ratio, 0, 0, ratio, 0, 0);
    pen.clearRect(0, 0, width, height);
    if (!picture || !r) return;
    try {
      pen.drawImage(picture, r.x, r.y, r.w, r.h);
    } catch {
      // a frame the browser cannot draw yet: the next one will be
    }
  });

  /** Back to the whole photo. */
  function fit() {
    zoom = 1;
    pan = { x: 0, y: 0 };
  }

  function local(event) {
    const bounds = box.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function onWheel(event) {
    if (!rect) return;
    event.preventDefault();
    const at = local(event);
    const before = toPhoto(at.x, at.y);
    const unit = event.deltaMode === 1 ? 0.05 : event.ctrlKey ? 0.01 : 0.0015;
    const next = Math.min(ZOOM_MAX, Math.max(1, zoom * Math.exp(-(event.deltaY || event.deltaX) * unit)));
    const fitW = rect.w / zoom;
    const fitH = rect.h / zoom;
    const w = fitW * next;
    const h = fitH * next;
    // the point under the pointer stays under it
    pan = { x: at.x - before.u * w - (width / 2 - w / 2), y: at.y - before.v * h - (height / 2 - h / 2) };
    zoom = next;
    if (zoom === 1) pan = { x: 0, y: 0 };
  }

  function onPointerDown(event) {
    // the toolbar's buttons take their own clicks: a capture here would take them away
    if (!rect || event.button > 1 || event.target?.closest?.('button')) return;
    box.setPointerCapture?.(event.pointerId);
    const at = local(event);
    if (overlay.tracing && !asking) {
      press = { tracing: true };
      drawing = [toPhoto(at.x, at.y)];
      return;
    }
    if (overlay.erasing && !asking) {
      press = { erasing: true, last: toPhoto(at.x, at.y) };
      overlay.beginErase();
      overlay.eraseAlong([overlay.seenOf(press.last)], RUBBER_PX, scale());
      return;
    }
    press = { pan: true, from: at, start: { ...pan }, moved: false };
  }

  function onPointerMove(event) {
    const at = local(event);
    rubberAt = overlay.erasing && rect ? at : null;
    if (!press) return;
    if (press.tracing) {
      drawing = [...drawing, toPhoto(at.x, at.y)];
      return;
    }
    if (press.erasing) {
      const here = toPhoto(at.x, at.y);
      overlay.eraseAlong([overlay.seenOf(press.last), overlay.seenOf(here)], RUBBER_PX, scale());
      press.last = here;
      return;
    }
    const dx = at.x - press.from.x;
    const dy = at.y - press.from.y;
    if (!press.moved && Math.hypot(dx, dy) < 4) return;
    press.moved = true;
    if (zoom > 1) pan = { x: press.start.x + dx, y: press.start.y + dy };
  }

  function onPointerUp(event) {
    if (!press) return;
    const was = press;
    press = null;
    if (was.tracing) {
      const stroke = drawing;
      drawing = [];
      if (stroke.length > 1) overlay.addStroke(stroke.map((p) => overlay.seenOf(p)), { snap: !event.altKey, scale: scale() });
      return;
    }
    if (was.erasing) {
      overlay.endErase();
      return;
    }
    if (!was.moved && asking) {
      const at = local(event);
      const point = toPhoto(at.x, at.y);
      if (inside(point)) find.photoClick(point);
    }
  }

  function detect() {
    const result = overlay.detectSkyline();
    if (result.error) toast(result.error, 'warn');
    else if (!result.found) toast('No clear skyline in this photo', 'warn');
    else toast('Skyline found: rub out what is not the ridge', 'ok', 8000, { label: 'Undo', onClick: () => overlay.undoStroke() });
  }

  function onKey(event) {
    if (!overlay.source || event.target?.closest?.('input, select, textarea')) return;
    const key = event.key;
    if ((event.ctrlKey || event.metaKey) && (key === 'z' || key === 'Z')) {
      event.preventDefault();
      overlay.undoStroke();
    } else if (key === 't' || key === 'T') overlay.setTracing(!overlay.tracing);
    else if (key === 'e' || key === 'E') overlay.setErasing(!overlay.erasing);
    else if (key === '0') fit();
    else if (key === 'Escape' && (overlay.tracing || overlay.erasing)) {
      event.stopPropagation();
      overlay.setTracing(false);
      overlay.setErasing(false);
    } else return;
  }

  const path = (points) => points.map((p) => toScreen(p)).map((s) => `${s.x.toFixed(1)},${s.y.toFixed(1)}`).join(' ');
  const pendingPhoto = $derived(find.pending?.photo ?? {});
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  bind:this={box}
  class="fp"
  class:asking
  class:pen={overlay.tracing && !asking}
  class:rubber={overlay.erasing && !asking}
  class:grab={zoom > 1 && !overlay.tracing && !overlay.erasing && !asking}
  bind:clientWidth={width}
  bind:clientHeight={height}
  tabindex="0"
  role="application"
  aria-label="The photo, to trace its skyline on"
  onwheel={onWheel}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointerleave={() => (rubberAt = null)}
  onkeydown={onKey}
>
  {#if !overlay.source}
    <div class="fp-empty">
      <p>Add the photo you want to place.</p>
      <button type="button" class="btn btn-primary btn-sm" onclick={onpick}>
        <Icon name="image" size={14} />Add a photo
      </button>
    </div>
  {:else}
    <canvas bind:this={canvas} class="fp-canvas" aria-hidden="true"></canvas>
    {#if rect}
      <svg class="fp-marks" width={width} height={height} aria-hidden="true">
        {#if !overlay.traceHidden}
          {#each overlay.strokes as stroke, index (index)}
            <polyline class="fp-trace" points={path(stroke)} />
          {/each}
        {/if}
        {#if drawing.length > 1}
          <polyline class="fp-trace drawing" points={path(drawing)} />
        {/if}
        {#each find.alignments as one, index (one.id)}
          {@const a = toScreen(one.photo.near)}
          {@const b = toScreen(one.photo.far)}
          <line class="fp-link" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={one.colour} />
          <circle class="fp-dot" cx={a.x} cy={a.y} r="6" fill={one.colour} />
          <circle class="fp-dot far" cx={b.x} cy={b.y} r="5" stroke={one.colour} />
          <text class="fp-num" x={a.x + 9} y={a.y + 4}>{index + 1}</text>
        {/each}
        {#if pendingPhoto.near}
          {@const a = toScreen(pendingPhoto.near)}
          <circle class="fp-dot pending" cx={a.x} cy={a.y} r="6" />
        {/if}
        {#if rubberAt}
          <circle class="fp-rubber" cx={rubberAt.x} cy={rubberAt.y} r={RUBBER_PX} />
        {/if}
      </svg>
    {/if}
    <div class="fp-tools" role="toolbar" aria-label="Trace the skyline">
      <button
        type="button"
        class:on={overlay.tracing}
        aria-pressed={overlay.tracing}
        onclick={() => overlay.setTracing(!overlay.tracing)}
        title="Draw along the skyline: it snaps to the edge, Alt draws freely (T)"
        aria-label="Trace skyline"><Icon name="freehand" size={14} /><span>Trace</span></button
      >
      <button type="button" onclick={detect} title="Find the skyline from the colours of sky and ground" aria-label="Detect the skyline"
        ><Icon name="profile" size={14} /><span>Detect</span></button
      >
      <button
        type="button"
        class:on={overlay.erasing}
        aria-pressed={overlay.erasing}
        disabled={!overlay.strokes.length && !overlay.erasing}
        onclick={() => overlay.setErasing(!overlay.erasing)}
        title="Rub out part of the trace (E)"
        aria-label="Rub out part of the trace"><Icon name="eraser" size={14} /></button
      >
      <button type="button" disabled={!overlay.canUndo} onclick={() => overlay.undoStroke()} title="Take the last change back (Ctrl+Z)" aria-label="Undo"
        ><Icon name="undo" size={14} /></button
      >
      <button
        type="button"
        disabled={!overlay.strokes.length}
        onclick={() => overlay.clearTrace()}
        title="Clear the whole trace (Ctrl+Z brings it back)"
        aria-label="Clear the whole trace"><Icon name="trash" size={14} /></button
      >
    </div>
    {#if zoom > 1}
      <button type="button" class="fp-zoom" onclick={fit} title="Show the whole photo (0)">×{zoom < 10 ? zoom.toFixed(1) : Math.round(zoom)} Fit</button>
    {/if}
    {#if overlay.busy}
      <p class="fp-note">Opening…</p>
    {:else if overlay.error}
      <p class="fp-note bad">{overlay.error}</p>
    {/if}
  {/if}
</div>

<style>
  .fp {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #0b0d10;
    outline: none;
    touch-action: none;
  }
  .fp:focus-visible {
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .fp.asking,
  .fp.pen {
    cursor: crosshair;
  }
  .fp.rubber {
    cursor: none;
  }
  .fp.grab {
    cursor: grab;
  }
  .fp-canvas,
  .fp-marks {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .fp-trace {
    fill: none;
    stroke: #ffd23f;
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .fp-trace.drawing {
    stroke-dasharray: 4 3;
  }
  .fp-link {
    stroke-width: 1.5;
    stroke-dasharray: 3 3;
  }
  .fp-dot {
    stroke: #0b0d10;
    stroke-width: 1.5;
  }
  .fp-dot.far {
    fill: #0b0d10;
    stroke-width: 2.5;
  }
  .fp-dot.pending {
    fill: var(--accent);
  }
  .fp-num {
    fill: #fff;
    font-size: 12px;
    font-weight: 600;
    paint-order: stroke;
    stroke: #0b0d10;
    stroke-width: 3px;
  }
  .fp-rubber {
    fill: none;
    stroke: #fff;
    stroke-width: 1.5;
  }
  .fp-tools {
    position: absolute;
    top: 10px;
    left: 10px;
    display: flex;
    gap: 2px;
    padding: 3px;
    border-radius: var(--r-md);
    background: color-mix(in srgb, var(--bg-1) 88%, transparent);
    box-shadow: 0 0 0 1px var(--border);
  }
  .fp-tools button,
  .fp-zoom {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 9px;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text-2);
    font: inherit;
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .fp-tools button:hover:not(:disabled),
  .fp-zoom:hover {
    color: var(--text-1);
    background: color-mix(in srgb, var(--text-1) 7%, transparent);
  }
  .fp-tools button.on {
    color: var(--accent);
    background: var(--accent-soft);
  }
  .fp-tools button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .fp-zoom {
    position: absolute;
    top: 10px;
    right: 10px;
    background: color-mix(in srgb, var(--bg-1) 88%, transparent);
    box-shadow: 0 0 0 1px var(--border);
  }
  .fp-empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 12px;
    color: var(--text-2);
  }
  .fp-empty p {
    margin: 0;
  }
  .fp-note {
    position: absolute;
    bottom: 10px;
    left: 10px;
    margin: 0;
    padding: 4px 8px;
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--bg-1) 88%, transparent);
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .fp-note.bad {
    color: var(--danger);
  }
</style>
