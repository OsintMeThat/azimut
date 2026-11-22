<script>
  /**
   * The terrain under the photo while Side by side is on: the view's own
   * engine draws it through `camera` with no photo, and HorizonView copies
   * that frame into this canvas before it draws the photo's half. The names,
   * the ruler and the trace laid on the terrain are placed for the same camera.
   *
   * Locked to the photo, a drag or the wheel here is the loupe's, so both
   * halves move together; unlocked, they turn and zoom this half alone. What the hand does is
   * handed up (HorizonView) as it happens: this pane only reads the pointer.
   */
  import { TERRAIN_TAG } from '../../lib/horizon/viewExport.js';
  import PictureControls from './PictureControls.svelte';

  let {
    /** The camera this half is drawn through, in CSS pixels of the frame. */
    camera,
    /** The canvas the frame is copied into, bound up to the view. */
    canvas = $bindable(null),
    /** The summit names and the ruler's ticks placed for `camera` (HorizonView `layersFor`). */
    labels = [],
    ticks = [],
    /** The trace laid on the terrain, as runs in this frame (lib/horizon/sideBySide.js `throughCamera`), and which strokes are ridges. */
    trace = [],
    ridges = [],
    /** Where the direction under the pointer over the photo stands here, x in CSS pixels, or null. */
    cross = null,
    /** The direction under the pointer here, said beside its line, or ''. */
    facing = '',
    linked = true,
    /** Ink names on a day sky, as the view draws them. */
    daylight = true,
    /** What the ground says while it loads, or why it could not, or ''. */
    note = '',
    /** The tab's view state, for how the ground is drawn (PictureControls), and the Copernicus setup it may ask for. */
    view = null,
    copernicus = false,
    onsetup = () => {},
    onpress = () => {},
    /** A drag, in CSS pixels since the last move. */
    onmove = () => {},
    /** The wheel: how many times closer, about a point of this frame. */
    onzoom = () => {},
    /** The pointer over this half, x in CSS pixels, or null once it leaves. */
    onpoint = () => {},
  } = $props();

  let press = $state(null);
  let pointer = $state(null);

  const points = (run) => run.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  function local(event) {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  function down(event) {
    if (event.button !== 0 && event.button !== 1) return;
    // the ground's own buttons take their press
    if (event.target.closest?.('.controls')) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    press = { x: event.clientX, y: event.clientY, moved: false };
    onpress();
  }

  function move(event) {
    const at = local(event);
    if (!press) {
      pointer = at.x;
      onpoint(at.x);
      return;
    }
    const dx = event.clientX - press.x;
    const dy = event.clientY - press.y;
    if (!dx && !dy) return;
    press = { x: event.clientX, y: event.clientY, moved: true };
    pointer = null;
    onpoint(null);
    onmove(dx, dy);
  }

  function leave() {
    if (press) return;
    pointer = null;
    onpoint(null);
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
  class="below"
  class:daylight
  class:dragging={press?.moved}
  role="application"
  tabindex="-1"
  aria-label={linked
    ? 'The terrain under the photo, locked: drag or wheel to move and zoom both'
    : 'The terrain under the photo, unlocked: drag to turn it, wheel to zoom it'}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={() => (press = null)}
  onpointercancel={() => (press = null)}
  onpointerleave={leave}
  onwheel={wheel}
>
  <canvas bind:this={canvas}></canvas>
  {#if camera?.width}
    <svg class="lines" viewBox="0 0 {camera.width} {camera.height}" aria-hidden="true">
      {#each labels as label (`${label.peak.lat},${label.peak.lon}`)}
        {#if label.y - 4 > label.baseline + 4}
          <line class="leader" x1={label.x} x2={label.x} y1={label.baseline + 4} y2={label.y - 4} />
        {/if}
        <circle class="summit" cx={label.x} cy={label.y} r="1.6" />
        <text class="peak-name" x={label.left + label.width / 2} y={label.baseline} text-anchor="middle">{label.name}</text>
      {/each}
      {#each trace as run, index (index)}
        <polyline class="under" points={points(run.points)} />
        <polyline class="over" class:ridge={ridges[run.of]} points={points(run.points)} />
      {/each}
    </svg>
  {/if}
  {#if cross != null}
    <span class="cross" style:left="{cross}px" aria-hidden="true"></span>
  {/if}
  {#if pointer != null}
    <span class="cross" style:left="{pointer}px" aria-hidden="true">
      {#if facing}<span class="facing mono">{facing}</span>{/if}
    </span>
  {/if}
  <span class="tag">{TERRAIN_TAG}</span>
  {#if view}
    <!-- how the ground is drawn, in the terrain's corner as in the view's -->
    <div class="controls" data-chrome="control">
      <PictureControls {view} {copernicus} {onsetup} />
    </div>
  {/if}
  {#if note}
    <div class="note" role="status" aria-live="polite">{note}</div>
  {/if}
  <div class="ruler" data-chrome="control" aria-hidden="true">
    {#each ticks as tick (tick.azimuth ?? tick.x)}
      <span class="tick" class:named={tick.named} style:left="{tick.x}px">{tick.label ?? ''}</span>
    {/each}
  </div>
</div>

<style>
  /* the same size as the photo's half, a seam under it */
  .below {
    position: absolute;
    left: 0;
    top: calc(100% + var(--hz-seam, 36px));
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--bg-0);
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .below.dragging {
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
  .leader {
    stroke: color-mix(in srgb, var(--text-1) 45%, transparent);
    stroke-width: 1;
  }
  .summit {
    fill: var(--text-1);
  }
  .peak-name {
    fill: var(--text-1);
    font-size: 11.5px;
    font-weight: 600;
    paint-order: stroke;
    stroke: var(--bg-0);
    stroke-width: 3px;
    stroke-opacity: 0.8;
    stroke-linejoin: round;
  }
  .daylight .leader {
    stroke: rgba(20, 24, 29, 0.45);
  }
  .daylight .summit {
    fill: #14181d;
  }
  .daylight .peak-name {
    fill: #14181d;
    stroke: #ffffff;
    stroke-opacity: 0.6;
  }
  .cross {
    position: absolute;
    top: 0;
    bottom: 24px;
    width: 0;
    border-left: 1px solid rgba(255, 255, 255, 0.9);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
    pointer-events: none;
  }
  .facing {
    position: absolute;
    top: 6px;
    left: 6px;
    padding: 1px 5px;
    border-radius: var(--r-sm);
    background: var(--hz-glass);
    color: var(--text-1);
    font-size: 10.5px;
    white-space: nowrap;
  }
  .tag {
    position: absolute;
    left: 8px;
    top: 8px;
    padding: 1px 7px;
    border-radius: var(--r-sm);
    background: rgba(10, 12, 15, 0.72);
    color: #e3e3e3;
    font-size: var(--fs-xs);
    font-weight: 600;
    pointer-events: none;
  }
  .controls {
    position: absolute;
    top: 10px;
    right: 10px;
  }
  .note {
    position: absolute;
    left: 50%;
    bottom: 36px;
    padding: 4px 10px;
    border-radius: var(--r-sm);
    background: var(--hz-glass);
    color: var(--text-1);
    font-size: var(--fs-xs);
    transform: translateX(-50%);
    pointer-events: none;
  }
  .ruler {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 24px;
    background: var(--hz-glass);
    pointer-events: none;
  }
  .tick {
    position: absolute;
    bottom: 4px;
    transform: translateX(-50%);
    color: var(--text-2);
    font-family: var(--font-mono);
    font-size: 10.5px;
    white-space: nowrap;
  }
  .tick::before {
    content: '';
    position: absolute;
    left: 50%;
    bottom: 15px;
    width: 1px;
    height: 5px;
    background: color-mix(in srgb, var(--text-1) 50%, transparent);
  }
  .tick.named {
    color: var(--text-1);
    font-weight: 700;
  }
</style>
