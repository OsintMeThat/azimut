<script>
  import Modal from '../../components/Modal.svelte';
  import Icon from '../../components/Icon.svelte';

  // Crop editor for a collage piece. Draws a fractional (0..1) box over the
  // piece's *base* image (its snapshot before any collage crop), so re-cropping
  // always replaces rather than compounds. On apply, the parent re-renders the
  // node through the backend crop op (applied before the perspective warp).
  let { node, onapply, onclose } = $props();

  let imgEl = $state();
  let draw = $state(null);
  // A drag in progress. `draw` alone can't gate `move` because we keep the box
  // after release (so Apply can read it) — without this flag the box would keep
  // resizing every time the pointer moved after mouse-up.
  let dragging = false;
  const box = $derived(draw ?? node.crop ?? null);

  function frac(e) {
    const r = imgEl.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }

  function down(e) {
    e.preventDefault();
    dragging = true;
    const p = frac(e);
    draw = { sx: p.x, sy: p.y, x: p.x, y: p.y, w: 0, h: 0 };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function move(e) {
    if (!dragging) return;
    const p = frac(e);
    draw = {
      sx: draw.sx, sy: draw.sy,
      x: Math.min(draw.sx, p.x), y: Math.min(draw.sy, p.y),
      w: Math.abs(p.x - draw.sx), h: Math.abs(p.y - draw.sy),
    };
  }
  function up(e) {
    dragging = false;
    if (draw && (draw.w < 0.02 || draw.h < 0.02)) draw = null;
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* not captured */ }
  }

  function apply() {
    const c = box && box.w > 0.02 && box.h > 0.02
      ? { x: box.x, y: box.y, w: box.w, h: box.h }
      : null;
    onapply?.(c);
  }
</script>

<Modal title="Crop piece" width="560px" {onclose}>
  <p class="hint">Drag a rectangle over the region to keep. It's applied before the warp, so the collage updates in place.</p>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="stage" onpointerdown={down} onpointermove={move} onpointerup={up}>
    <img
      bind:this={imgEl}
      src={node.baseUrl || node.url}
      alt="piece"
      draggable="false"
      onerror={(e) => { if (node.url && e.currentTarget.src !== node.url) e.currentTarget.src = node.url; }}
    />
    {#if box}
      <div
        class="box"
        style:left={`${box.x * 100}%`}
        style:top={`${box.y * 100}%`}
        style:width={`${box.w * 100}%`}
        style:height={`${box.h * 100}%`}
      ></div>
    {/if}
  </div>
  <div class="foot">
    <button class="btn btn-sm" onclick={() => (draw = null)} disabled={!box}><Icon name="reset" size={13} /> Full frame</button>
    <div class="spacer"></div>
    <button class="btn btn-sm" onclick={onclose}>Cancel</button>
    <button class="btn btn-sm primary" onclick={apply}><Icon name="check" size={13} /> Apply</button>
  </div>
</Modal>

<style>
  .hint {
    color: var(--text-3);
    font-size: var(--fs-xs);
    margin: 0 0 10px;
  }
  .stage {
    position: relative;
    line-height: 0;
    touch-action: none;
    cursor: crosshair;
    display: block;
    width: fit-content;
    max-width: 100%;
    margin: 0 auto;
    background: var(--bg-0);
    border-radius: var(--r-sm);
    overflow: hidden;
  }
  .stage img {
    max-width: 100%;
    max-height: 60vh;
    display: block;
    user-select: none;
  }
  .box {
    position: absolute;
    border: 1.5px solid var(--accent);
    box-shadow: 0 0 0 9999px rgba(6, 9, 14, 0.55);
    pointer-events: none;
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
  }
  .spacer {
    flex: 1;
  }
  .primary {
    color: var(--accent);
    border-color: var(--accent);
  }
</style>
