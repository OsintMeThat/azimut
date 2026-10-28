<script>
  /**
   * The photo column of Find: the photo on its own, no terrain behind it yet,
   * with its skyline traced on it and the alignments' points.
   *
   * The trace is the overlay's, drawn with the view's own tools
   * (lib/horizon/traceTools.js): the skyline and ridge pens, which snap onto
   * the photo's edges while the magnet is on (Alt does the other), pairs of
   * lines one in front of the other, cuts across a collage, Detect for the
   * whole skyline, the rubber, and every change can be taken back. The wheel
   * looks closer about the pointer and a drag moves the photo when no tool is
   * out. While an alignment asks for the photo, a click places its point.
   *
   * The photo shows as the search reads it: straightened from its lens's
   * curve, which Lens curve sets, and between its corners when Overlay pulled
   * them. Every mark on it (the strokes, the cuts, the pairs, the alignments'
   * points) is kept on the photo's own pixels, so it follows the photo as the
   * curve changes.
   */
  import Icon from '../../components/Icon.svelte';
  import DistanceChips from './DistanceChips.svelte';
  import { toast } from '../../lib/state.svelte.js';
  import { BEND_MAX, bendText } from '../../lib/horizon/overlay.js';
  import { paintStraightened } from '../../lib/horizon/warpPicture.js';
  import {
    editing,
    magnetTitle,
    marksSummary,
    pressTool,
    putAway,
    TRACE_TOOLS,
    toolBlocked,
    toolForKey,
    toolHint,
    toolOn,
  } from '../../lib/horizon/traceTools.js';

  let {
    /** The photo and its trace (state/overlay.svelte.js). */
    overlay,
    /** The finder (state/find.svelte.js): its alignments and the click it waits for. */
    find,
    /** Asked to choose the photo. */
    onpick = () => {},
  } = $props();

  const RUBBER_PX = 12;
  /** How wide the brush over bent parts paints, in screen pixels either side of the hand. */
  const BRUSH_PX = 22;
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
  /** Whether the lens's curve is out to be set, and whether its slider is in the hand: the photo is drawn lighter meanwhile. */
  let curveOpen = $state(false);
  let bending = $state(false);

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

  // the column shows the frame as the search reads it: a point of it, 0 to 1, on screen and back
  const toScreen = (p) => ({ x: rect.x + p.u * rect.w, y: rect.y + p.v * rect.h });
  const toFrame = (x, y) => ({ u: (x - rect.x) / rect.w, v: (y - rect.y) / rect.h });
  const inside = (p) => p.u >= 0 && p.u <= 1 && p.v >= 0 && p.v <= 1;
  const scale = () => ({ width: rect.w, height: rect.h });

  /** The photo as the search reads it: between its pulled corners, straightened from its lens's curve. */
  const shownPicture = $derived.by(() => {
    void overlay.frame;
    const picture = overlay.picture;
    if (!picture || !overlay.bend) return picture;
    return paintStraightened(picture, overlay.bend, overlay.bendShape, { fast: bending }) ?? picture;
  });
  /** Why the curve cannot be set now, or ''. */
  const curveBlocked = $derived(
    overlay.isPanorama
      ? 'A panorama has no lens curve to undo'
      : overlay.locked
        ? 'Photo and terrain are held together in Overlay: let them go there to change this'
        : ''
  );

  function setCurve(value, { done = false } = {}) {
    bending = !done;
    overlay.setBend(value);
  }

  // the photo drawn again when it, its frame, its curve, the column or the loupe change
  $effect(() => {
    void overlay.frame;
    const picture = shownPicture;
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

  /** Whether a press or the wheel lands on the photo's own controls, which take it. */
  const onControls = (event) => Boolean(event.target?.closest?.('button, input, .fp-curve, .dc'));

  function onWheel(event) {
    if (!rect || onControls(event)) return;
    event.preventDefault();
    const at = local(event);
    const before = toFrame(at.x, at.y);
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
    if (!rect || event.button > 1 || onControls(event)) return;
    // no text selection or native drag may start under the pen: the browser would cancel the stroke
    event.preventDefault();
    box.focus?.({ preventScroll: true });
    box.setPointerCapture?.(event.pointerId);
    const at = local(event);
    if ((overlay.linking || overlay.cutting || overlay.distancing || overlay.clearing || overlay.keying) && !asking) {
      press = { picking: true };
      return;
    }
    if (overlay.tracing && !asking) {
      press = { tracing: true, from: at };
      drawing = [toFrame(at.x, at.y)];
      return;
    }
    if (overlay.bending && !asking) {
      press = { bending: true };
      overlay.beginBend(toFrame(at.x, at.y), BRUSH_PX, scale());
      return;
    }
    if (overlay.erasing && !asking) {
      press = { erasing: true, last: toFrame(at.x, at.y) };
      overlay.beginErase();
      overlay.eraseAlong([press.last], RUBBER_PX, scale());
      return;
    }
    press = { pan: true, from: at, start: { ...pan }, moved: false };
  }

  function onPointerMove(event) {
    const at = local(event);
    rubberAt = (overlay.erasing || overlay.bending) && rect ? at : null;
    if (!press) return;
    if (press.bending) {
      overlay.bendAlong(toFrame(at.x, at.y));
      return;
    }
    if (press.tracing) {
      drawing = [...drawing, toFrame(at.x, at.y)];
      return;
    }
    if (press.erasing) {
      const here = toFrame(at.x, at.y);
      overlay.eraseAlong([press.last, here], RUBBER_PX, scale());
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
    if (was.picking) {
      const at = local(event);
      const point = toFrame(at.x, at.y);
      if (overlay.cutting) overlay.cutAt(point, scale());
      else if (overlay.linking) overlay.linkAt(point, scale());
      else if (overlay.distancing) overlay.farAt(point, scale());
      else if (overlay.clearing) overlay.clearAt(point, scale());
      else if (overlay.keying) overlay.keyAt(point, scale());
      return;
    }
    if (was.tracing) {
      const stroke = drawing;
      drawing = [];
      const at = local(event);
      // a click on a line makes it the pen's kind
      if (Math.hypot(at.x - was.from.x, at.y - was.from.y) < 4 && stroke.length < 3) {
        overlay.markLineAt(toFrame(at.x, at.y), scale());
        return;
      }
      // snapped onto the nearest edge while the magnet is on; Alt does the other for this stroke
      if (stroke.length > 1) overlay.addStroke(stroke, { snap: overlay.magnet !== event.altKey, scale: scale() });
      return;
    }
    if (was.erasing) {
      overlay.endErase();
      return;
    }
    if (was.bending) {
      overlay.endBend();
      return;
    }
    if (!was.moved && asking) {
      const at = local(event);
      const point = toFrame(at.x, at.y);
      // the point is kept on the photo's own pixels, as the trace is
      if (inside(point)) find.photoClick(overlay.photoOf(point));
    }
  }

  function detect() {
    const result = overlay.detectSkyline();
    if (result.error) toast(result.error, 'warn');
    else if (!result.found) toast('No clear skyline in this photo', 'warn');
    else toast('Skyline found: rub out what is not the ridge', 'ok', 8000, { label: 'Undo', onClick: () => overlay.undoStroke() });
  }

  function onKey(event) {
    // Escape folds the curve away, from its own slider too
    if (event.key === 'Escape' && curveOpen && !editing(overlay)) {
      event.stopPropagation();
      curveOpen = false;
      box?.focus?.({ preventScroll: true });
      return;
    }
    if (!overlay.source || event.target?.closest?.('input, select, textarea')) return;
    const key = event.key;
    if ((event.ctrlKey || event.metaKey) && (key === 'z' || key === 'Z')) {
      event.preventDefault();
      overlay.undoStroke();
    } else if (toolForKey(key)) pressTool(overlay, toolForKey(key));
    else if (key === 'm' || key === 'M') overlay.setMagnet(!overlay.magnet);
    else if (key === '0') fit();
    else if (key === 'Escape' && editing(overlay)) {
      event.stopPropagation();
      putAway(overlay);
    } else return;
  }

  /** Escape or a press elsewhere folds the curve away, wherever the focus is. */
  let curveBox = $state();
  let curveButton = $state();
  function onWindowKey(event) {
    if (event.key !== 'Escape' || !curveOpen) return;
    event.stopPropagation();
    curveOpen = false;
  }
  function onWindowPointer(event) {
    if (curveOpen && !curveBox?.contains(event.target) && !curveButton?.contains(event.target)) curveOpen = false;
  }

  const path = (points) => points.map((p) => toScreen(p)).map((s) => `${s.x.toFixed(1)},${s.y.toFixed(1)}`).join(' ');
  /** A point of the photo's own (an alignment's), where it shows. */
  const shownAt = (point) => toScreen(overlay.seenOf(point));
  const hint = $derived(asking ? '' : toolHint(overlay));
  const marked = $derived(marksSummary(overlay.marks));
  const pendingPhoto = $derived(find.pending?.photo ?? {});
</script>

<svelte:window onkeydown={onWindowKey} onpointerdown={onWindowPointer} />

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  bind:this={box}
  class="fp"
  class:asking
  class:pen={(overlay.tracing || overlay.linking || overlay.cutting || overlay.distancing || overlay.clearing || overlay.keying) && !asking}
  class:rubber={(overlay.erasing || overlay.bending) && !asking}
  class:grab={zoom > 1 && !overlay.tracing && !overlay.erasing && !overlay.bending && !asking}
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
          {#each overlay.cutsSeen as [top, bottom], index (index)}
            <line class="fp-cut" x1={toScreen(top).x} y1={toScreen(top).y} x2={toScreen(bottom).x} y2={toScreen(bottom).y} />
          {/each}
          {#each overlay.bentSeen ?? [] as zone, index (index)}
            <polyline class="fp-bent" points={path(zone.path.length > 1 ? zone.path : [zone.path[0], zone.path[0]])} stroke-width={Math.max(2, 2 * zone.r * rect.w)} />
          {/each}
          {#each overlay.hazySeen ?? [] as zone, index (index)}
            <polyline class="fp-hazy" points={path(zone.path.length > 1 ? zone.path : [zone.path[0], zone.path[0]])} stroke-width={Math.max(2, 2 * zone.r * rect.w)} />
          {/each}
          {#each overlay.strokesSeen as stroke, index (index)}
            {@const id = overlay.marks?.lines?.[index]}
            {#if overlay.front === id}
              <polyline class="fp-trace picked" points={path(stroke)} />
            {/if}
            <polyline class="fp-trace" class:ridge={overlay.marks?.inner?.includes(id)} class:sea={overlay.marks?.sea?.includes(id)} points={path(stroke)} />
          {/each}
          {#each overlay.pairBadges as badge (badge.label)}
            {#each [['front', badge.front], ['back', badge.back]] as [side, at] (side)}
              {@const spot = toScreen(at)}
              <g class="fp-pair {side}" transform="translate({spot.x.toFixed(1)} {(spot.y - 14).toFixed(1)})">
                <circle r="7.5" style:--pair={badge.colour} />
                <text text-anchor="middle" dy="3.5">{badge.label}</text>
              </g>
            {/each}
          {/each}
          {#each overlay.farBadges ?? [] as badge (badge.line)}
            {@const spot = toScreen(badge.at)}
            <g class="fp-far" transform="translate({spot.x.toFixed(1)} {(spot.y + 16).toFixed(1)})">
              <rect x={-badge.label.length * 3.1 - 5} y="-8" width={badge.label.length * 6.2 + 10} height="16" rx="8" />
              <text text-anchor="middle" dy="3.5">{badge.label}</text>
            </g>
          {/each}
          {#each overlay.clearBadges ?? [] as badge (badge.line)}
            {@const spot = toScreen(badge.at)}
            <g class="fp-clear" transform="translate({spot.x.toFixed(1)} {(spot.y - 16).toFixed(1)})">
              <rect x="-29" y="-8" width="58" height="16" rx="8" />
              <text text-anchor="middle" dy="3.5">Sky only</text>
            </g>
          {/each}
          {#each overlay.keyBadges ?? [] as badge (badge.line)}
            {@const spot = toScreen(badge.at)}
            <g class="fp-key" transform="translate({spot.x.toFixed(1)} {(spot.y - 16).toFixed(1)})">
              <rect x="-16" y="-8" width="32" height="16" rx="8" />
              <text text-anchor="middle" dy="3.5">Key</text>
            </g>
          {/each}
        {/if}
        {#if drawing.length > 1}
          <polyline class="fp-trace drawing" points={path(drawing)} />
        {/if}
        {#each find.alignments as one, index (one.id)}
          {@const a = shownAt(one.photo.near)}
          {@const b = shownAt(one.photo.far)}
          <line class="fp-link" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={one.colour} />
          <circle class="fp-dot" cx={a.x} cy={a.y} r="6" fill={one.colour} />
          <circle class="fp-dot far" cx={b.x} cy={b.y} r="5" stroke={one.colour} />
          <text class="fp-num" x={a.x + 9} y={a.y + 4}>{index + 1}</text>
        {/each}
        <!-- the alignment being made, in its own colour and number from the first click -->
        {#if pendingPhoto.near}
          {@const a = shownAt(pendingPhoto.near)}
          {@const colour = find.pending?.colour ?? 'var(--accent)'}
          {#if pendingPhoto.far}
            {@const b = shownAt(pendingPhoto.far)}
            <line class="fp-link" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={colour} />
            <circle class="fp-dot far" cx={b.x} cy={b.y} r="5" stroke={colour} />
          {/if}
          <circle class="fp-dot" cx={a.x} cy={a.y} r="6" fill={colour} />
          <text class="fp-num" x={a.x + 9} y={a.y + 4}>{find.alignments.length + 1}</text>
        {/if}
        {#if rubberAt}
          <circle class="fp-rubber" class:brush={overlay.bending} cx={rubberAt.x} cy={rubberAt.y} r={overlay.bending ? BRUSH_PX : RUBBER_PX} />
        {/if}
      </svg>
    {/if}
    <!-- the tools, then the curve's settings under them: they wrap rather than run past a narrow column -->
    <div class="fp-top">
      <div class="fp-tools" role="toolbar" aria-label="Trace the skyline">
        {#each TRACE_TOOLS as tool (tool.id)}
          {@const on = toolOn(overlay, tool.id)}
          {@const blocked = toolBlocked(overlay, tool.id)}
          <button
            type="button"
            class:on
            aria-pressed={on}
            disabled={Boolean(blocked) && !on}
            onclick={() => pressTool(overlay, tool.id)}
            title={blocked || tool.title}
            aria-label={tool.name}
            ><Icon name={tool.icon} size={14} />{#if tool.id === 'sky'}<span>Trace</span>{/if}</button
          >
        {/each}
        <button
          type="button"
          class:on={overlay.magnet}
          aria-pressed={overlay.magnet}
          onclick={() => overlay.setMagnet(!overlay.magnet)}
          title={magnetTitle(overlay.magnet)}
          aria-label="Snap to edges"><Icon name="magnet" size={14} /></button
        >
        <span class="fp-sep" aria-hidden="true"></span>
        <button type="button" onclick={detect} title="Find the skyline from the colours of sky and ground" aria-label="Detect the skyline"
          ><Icon name="profile" size={14} /><span>Detect</span></button
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
        <span class="fp-sep" aria-hidden="true"></span>
        <button
          bind:this={curveButton}
          type="button"
          class:on={curveOpen}
          class:set={Boolean(overlay.bend)}
          aria-expanded={curveOpen}
          aria-controls="fp-curve"
          onclick={() => (curveOpen = !curveOpen)}
          title="Straighten the curve a wide lens gives the edges"
          aria-label="Lens curve"
          ><Icon name="curve" size={14} /><span>{overlay.bend ? bendText(overlay.bend) : 'Lens curve'}</span></button
        >
      </div>
      {#if overlay.distancing}
        <DistanceChips {overlay} />
      {/if}
      {#if curveOpen}
        <div bind:this={curveBox} id="fp-curve" class="fp-curve" role="group" aria-label="Lens curve">
          <input
            type="range"
            min={-BEND_MAX}
            max={BEND_MAX}
            step="0.005"
            value={overlay.bend}
            disabled={Boolean(curveBlocked)}
            oninput={(event) => setCurve(event.currentTarget.value)}
            onchange={(event) => setCurve(event.currentTarget.value, { done: true })}
            ondblclick={() => setCurve(0, { done: true })}
            aria-label="Lens distortion"
            aria-valuetext={bendText(overlay.bend)}
            title={curveBlocked || 'Straightens the curve a wide lens gives the edges; double-click for none'}
          />
          <span class="fp-curve-value mono">{bendText(overlay.bend)}</span>
          <button type="button" disabled={!overlay.bend || Boolean(curveBlocked)} onclick={() => setCurve(0, { done: true })} title="No curve">None</button>
          <p class="fp-curve-note">{curveBlocked || 'The trace stays on the photo as it straightens.'}</p>
        </div>
      {/if}
    </div>
    {#if hint}
      <p class="fp-hint">{hint} · Esc when done</p>
    {:else if marked}
      <p class="fp-hint quiet">{marked}</p>
    {/if}
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
    /* clipped, never scrolled: a focused control at the edge must not slide the photo aside */
    overflow: clip;
    background: #0b0d10;
    outline: none;
    touch-action: none;
    user-select: none;
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
  /* an inner edge, a ridge seen against farther land: cyan, never read as the skyline */
  .fp-trace.ridge {
    stroke: #4dd6ff;
  }
  /* the sea's horizon: deep blue, dashed */
  .fp-trace.sea {
    stroke: #5b8cff;
    stroke-dasharray: 10 4;
  }
  .fp-trace.picked {
    stroke: rgba(255, 255, 255, 0.85);
    stroke-width: 7;
  }
  /* a pair: the letter filled on the line in front, ringed on the line behind it */
  .fp-pair circle {
    stroke: var(--pair);
    stroke-width: 2;
  }
  .fp-pair.front circle {
    fill: var(--pair);
  }
  .fp-pair.back circle {
    fill: rgba(0, 0, 0, 0.6);
  }
  .fp-pair text {
    font-size: 10px;
    font-weight: 700;
    fill: #fff;
  }
  .fp-pair.front text {
    fill: #111;
  }
  /* how far a line stands */
  .fp-far rect {
    fill: rgba(0, 0, 0, 0.7);
    stroke: #ffd166;
    stroke-width: 1;
  }
  .fp-far text {
    font-size: 10px;
    font-weight: 600;
    fill: #ffd166;
  }
  /* a line that matters most */
  .fp-key rect {
    fill: rgba(0, 0, 0, 0.7);
    stroke: #ffb3e6;
    stroke-width: 1;
  }
  .fp-key text {
    font-size: 10px;
    font-weight: 600;
    fill: #ffb3e6;
  }
  /* a line with only sky above it */
  .fp-clear rect {
    fill: rgba(0, 0, 0, 0.7);
    stroke: #8fd3ff;
    stroke-width: 1;
  }
  .fp-clear text {
    font-size: 10px;
    font-weight: 600;
    fill: #8fd3ff;
  }
  /* where a collage is cut */
  .fp-cut {
    stroke: #fff;
    stroke-width: 1.5;
    stroke-dasharray: 7 5;
    paint-order: stroke;
  }
  .fp-sep {
    width: 1px;
    margin: 4px 3px;
    background: var(--border);
  }
  .fp-hint {
    position: absolute;
    left: 50%;
    bottom: 12px;
    transform: translateX(-50%);
    max-width: calc(100% - 32px);
    margin: 0;
    padding: 5px 10px;
    border-radius: var(--r-md);
    background: color-mix(in srgb, var(--bg-1) 88%, transparent);
    box-shadow: 0 0 0 1px var(--border);
    color: var(--text-1);
    font-size: var(--fs-xs);
    text-align: center;
    pointer-events: none;
  }
  .fp-hint.quiet {
    color: var(--text-2);
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
  .fp-rubber.brush {
    fill: rgba(255, 179, 71, 0.18);
    stroke: #ffb347;
  }
  /* a part of the picture that may be bent: a wash the trace shows through */
  .fp-bent {
    fill: none;
    stroke: rgba(255, 179, 71, 0.3);
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  /* a part where far land may be hidden: a pale blue wash */
  .fp-hazy {
    fill: none;
    stroke: rgba(160, 200, 255, 0.3);
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .fp-top {
    position: absolute;
    top: 10px;
    left: 10px;
    right: 10px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    pointer-events: none;
  }
  .fp-top > * {
    pointer-events: auto;
  }
  .fp-tools {
    display: flex;
    flex-wrap: wrap;
    max-width: 100%;
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
  /* a curve set says its value on the button, in the accent */
  .fp-tools button.set:not(.on) {
    color: var(--accent);
  }
  .fp-curve {
    display: grid;
    grid-template-columns: minmax(110px, 220px) auto auto;
    max-width: 100%;
    align-items: center;
    gap: 6px 10px;
    padding: 8px 10px;
    border-radius: var(--r-md);
    background: color-mix(in srgb, var(--bg-1) 92%, transparent);
    box-shadow: 0 0 0 1px var(--border);
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .fp-curve input {
    width: 100%;
    accent-color: var(--accent);
  }
  .fp-curve-value {
    min-width: 92px;
    color: var(--text-1);
  }
  .fp-curve button {
    height: 24px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text-2);
    font: inherit;
    cursor: pointer;
  }
  .fp-curve button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .fp-curve-note {
    grid-column: 1 / -1;
    margin: 0;
    color: var(--text-3);
  }
  .fp-tools button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  /* bottom left: the column's own enlarge button holds the bottom right */
  .fp-zoom {
    position: absolute;
    left: 10px;
    bottom: 10px;
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
