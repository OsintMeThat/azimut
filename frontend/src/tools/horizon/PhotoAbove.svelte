<script>
  /**
   * The photo alone above the terrain while Side by side is on: no terrain
   * round it, only the picture, a drag to move it and the wheel to look closer.
   *
   * It is drawn as the view draws it (the loupe, lib/horizon/overlay.js
   * `screenAt`), straightened from its lens's curve as Find's column draws it
   * (`paintStraightened`), so the trace lies on it as on the view. While the
   * two halves are locked its loupe is the view's, the terrain under it seen
   * through the same one; unlocked it has one of its own. What the hand does
   * is handed up (HorizonView) as it happens.
   */
  import { NO_LOUPE, screenAt } from '../../lib/horizon/overlay.js';
  import { paintStraightened } from '../../lib/horizon/warpPicture.js';

  let {
    /** The photo or the video's player (`overlay.picture`), the frame on show, and its lens's curve. */
    picture = null,
    frame = -1,
    bend = 0,
    bendShape = null,
    /** How it is looked at: `{ zoom, x, y }`. */
    loupe = NO_LOUPE,
    /** The frame's size in CSS pixels, the terrain's under it. */
    size,
    /** The trace on the straightened photo (`{ u, v }` strokes), and which strokes are ridges. */
    trace = [],
    ridges = [],
    /** Where the direction under the pointer over the terrain stands here, x in CSS pixels, or null. */
    cross = null,
    locked = true,
    /** "Photo" or "Video". */
    what = 'Photo',
    onmove = () => {},
    /** The wheel: how many times closer, about a point of this frame. */
    onzoom = () => {},
    onfit = () => {},
    /** The pointer over the photo, x in CSS pixels, or null once it leaves. */
    onpoint = () => {},
  } = $props();

  let canvas = $state();
  let press = $state(null);

  /** The photo as the view shows it: straightened from its lens's curve. */
  const shown = $derived.by(() => {
    void frame;
    if (!picture || !bend) return picture;
    return paintStraightened(picture, bend, bendShape, { fast: 'readyState' in picture }) ?? picture;
  });
  const zoomed = $derived(loupe.zoom !== 1 || loupe.x !== 0.5 || loupe.y !== 0.5);
  const points = (stroke) =>
    stroke
      .map((p) => screenAt(loupe, p.u, p.v, size))
      .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(' ');

  // drawn again when the photo, its frame, its curve, the size or the loupe change
  $effect(() => {
    const picture = shown;
    const { width, height } = size;
    const at = loupe;
    if (!canvas || !(width > 0 && height > 0)) return;
    const ratio = globalThis.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const pen = canvas.getContext?.('2d');
    if (!pen) return;
    pen.setTransform(ratio, 0, 0, ratio, 0, 0);
    pen.clearRect(0, 0, width, height);
    if (!picture) return;
    const corner = screenAt(at, 0, 0, size);
    pen.imageSmoothingQuality = 'high';
    try {
      pen.drawImage(picture, corner.x, corner.y, width * at.zoom, height * at.zoom);
    } catch {
      // a frame the browser cannot draw yet: the next one will be
    }
  });

  function local(event) {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  function down(event) {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.target.closest('button')) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    press = { x: event.clientX, y: event.clientY, moved: false };
  }

  function move(event) {
    if (!press) {
      onpoint(local(event).x);
      return;
    }
    const dx = event.clientX - press.x;
    const dy = event.clientY - press.y;
    if (!dx && !dy) return;
    press = { x: event.clientX, y: event.clientY, moved: true };
    onpoint(null);
    onmove(dx, dy);
  }

  function leave() {
    if (!press) onpoint(null);
  }

  function wheel(event) {
    event.preventDefault();
    // Shift turns a mouse wheel sideways in most browsers; a pinch comes as Ctrl and small steps
    const delta = event.deltaY || event.deltaX;
    const unit = event.deltaMode === 1 ? 0.05 : event.ctrlKey ? 0.01 : 0.0015;
    onzoom(Math.exp(-delta * unit), local(event));
  }
</script>

<div
  class="above"
  class:dragging={press?.moved}
  role="application"
  tabindex="-1"
  aria-label={locked
    ? `The ${what.toLowerCase()} alone, locked: drag to move it, wheel to zoom, the terrain following`
    : `The ${what.toLowerCase()} alone, unlocked: drag to move it, wheel to zoom`}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={() => (press = null)}
  onpointercancel={() => (press = null)}
  onpointerleave={leave}
  onwheel={wheel}
>
  <canvas bind:this={canvas}></canvas>
  {#if size?.width}
    <svg class="lines" viewBox="0 0 {size.width} {size.height}" aria-hidden="true">
      {#each trace as stroke, index (index)}
        <polyline class="under" points={points(stroke)} />
        <polyline class="over" class:ridge={ridges[index]} points={points(stroke)} />
      {/each}
    </svg>
  {/if}
  {#if cross != null}
    <span class="cross" style:left="{cross}px" aria-hidden="true"></span>
  {/if}
  <span class="tag">{what}</span>
  {#if zoomed}
    <div class="zoom" data-chrome="control">
      <span class="mono">×{loupe.zoom < 10 ? loupe.zoom.toFixed(1) : Math.round(loupe.zoom)}</span>
      <button type="button" onclick={onfit} title="Back to the whole {what.toLowerCase()}">Fit</button>
    </div>
  {/if}
</div>

<style>
  /* over the view's own half, which goes on drawing the terrain under it */
  .above {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: color-mix(in srgb, var(--bg-0) 70%, black);
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .above.dragging {
    cursor: grabbing;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  .lines {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }
  .lines polyline {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .lines .under {
    stroke: rgba(0, 0, 0, 0.55);
    stroke-width: 4;
  }
  .lines .over {
    stroke: var(--hz-mark);
    stroke-width: 1.75;
  }
  .lines .over.ridge {
    stroke: #4dd6ff;
  }
  .cross {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 0;
    border-left: 1px solid rgba(255, 255, 255, 0.9);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
    pointer-events: none;
  }
  .tag {
    position: absolute;
    left: 8px;
    top: 8px;
    padding: 1px 7px;
    border-radius: var(--r-sm);
    background: rgba(10, 12, 15, 0.72);
    color: var(--accent);
    font-size: var(--fs-xs);
    font-weight: 600;
    pointer-events: none;
  }
  /* how much it is magnified, and the way back to the whole picture */
  .zoom {
    position: absolute;
    top: 8px;
    right: 8px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 2px 2px 8px;
    border-radius: var(--r-sm);
    background: var(--hz-glass);
    color: var(--text-1);
    font-size: 11px;
  }
  .zoom button {
    height: 22px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-1);
    font: inherit;
    cursor: pointer;
  }
</style>
