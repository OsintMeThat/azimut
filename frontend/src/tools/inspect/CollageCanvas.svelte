<script>
  import { quadMatrix3d, quadCentroid, scaleQuad, rotateQuad, quadRadius } from '../../lib/inspect.js';
  import Icon from '../../components/Icon.svelte';

  // Interactive collage surface. Each node is a tray frame placed as a 4-point
  // quad (canvas pixels). Drag the body to move all four corners together; drag a
  // corner handle to warp — a hand-made panorama. The same quads are sent to the
  // backend, which renders the full-res warp with PIL (see compose_perspective).
  // `collage` is the session's *active* collage (a session may hold several).
  let { collage, selectedId = $bindable() } = $props();

  let wrapEl = $state();
  let availW = $state(800);
  let availH = $state(600);

  const cw = $derived(collage.width);
  const ch = $derived(collage.height);
  const scale = $derived(Math.min(availW / cw, availH / ch, 1) || 1);

  function boxOf(node) {
    return { w: node.w || 320, h: node.h || 240, url: node.url };
  }

  // client px -> canvas px (the inner surface is scaled with transform-origin 0 0)
  function toCanvas(e) {
    const r = wrapEl.getBoundingClientRect();
    return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale];
  }

  function startMove(e, node) {
    e.preventDefault();
    selectedId = node.id;
    let [px, py] = toCanvas(e);
    const move = (ev) => {
      const [nx, ny] = toCanvas(ev);
      const dx = nx - px;
      const dy = ny - py;
      node.quad = node.quad.map(([x, y]) => [x + dx, y + dy]);
      px = nx;
      py = ny;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function startWarp(e, node, corner) {
    e.preventDefault();
    e.stopPropagation();
    selectedId = node.id;
    const move = (ev) => {
      node.quad[corner] = toCanvas(ev);
      node.quad = [...node.quad];
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // Uniformly resize the piece with a *vertical* drag (up = bigger). The factor
  // is calibrated on the piece's own radius and eased exponentially, so it feels
  // the same for small and large pieces and never snaps. Pure quad math, so it
  // composes with the per-corner warp — both just move the same points.
  function startScale(e, node) {
    e.preventDefault();
    e.stopPropagation();
    selectedId = node.id;
    const c = quadCentroid(node.quad);
    const base = node.quad.map(([x, y]) => [x, y]);
    const R = quadRadius(node.quad);
    const [, sy] = toCanvas(e);
    const move = (ev) => {
      const [, my] = toCanvas(ev);
      // drag one radius up ≈ ×2, one radius down ≈ ×0.5
      const k = Math.min(20, Math.max(0.05, Math.pow(2, (sy - my) / R)));
      node.quad = scaleQuad(base, k, c);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // Delete / Backspace removes the selected piece. This canvas is only mounted
  // on the Collage tab, so the window listener is scoped to it — but still bail
  // when typing in a field or when a modal (e.g. the crop editor) is open.
  function onKey(e) {
    if (selectedId == null) return;
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (document.querySelector('.overlay')) return;
    e.preventDefault();
    collage.nodes = collage.nodes.filter((n) => n.id !== selectedId);
    selectedId = null;
  }

  // Rotate the piece around its centroid by dragging the rotate handle around
  // the centre — the angle tracks the pointer. Pure quad math (composes w/ warp).
  function startRotate(e, node) {
    e.preventDefault();
    e.stopPropagation();
    selectedId = node.id;
    const c = quadCentroid(node.quad);
    const base = node.quad.map(([x, y]) => [x, y]);
    const [sx, sy] = toCanvas(e);
    const startAng = Math.atan2(sy - c[1], sx - c[0]);
    const move = (ev) => {
      const [mx, my] = toCanvas(ev);
      const ang = Math.atan2(my - c[1], mx - c[0]);
      node.quad = rotateQuad(base, ang - startAng, c);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="wrap"
  class:checker={collage.transparent}
  bind:this={wrapEl}
  bind:clientWidth={availW}
  bind:clientHeight={availH}
  style:background={collage.transparent ? null : collage.background}
  onpointerdown={() => (selectedId = null)}
>
  <div
    class="surface"
    style:width={`${cw}px`}
    style:height={`${ch}px`}
    style:transform={`scale(${scale})`}
  >
    {#each collage.nodes as node (node.id)}
      {@const box = boxOf(node)}
      <img
        class="node"
        class:selected={node.id === selectedId}
        src={box.url}
        alt="collage piece"
        style:width={`${box.w}px`}
        style:height={`${box.h}px`}
        style:transform={quadMatrix3d(box.w, box.h, node.quad)}
        draggable="false"
        onpointerdown={(e) => (e.stopPropagation(), startMove(e, node))}
      />
      {#if node.id === selectedId}
        {#each node.quad as pt, i (i)}
          <button
            class="handle"
            style:left={`${pt[0]}px`}
            style:top={`${pt[1]}px`}
            style:width={`${16 / scale}px`}
            style:height={`${16 / scale}px`}
            onpointerdown={(e) => startWarp(e, node, i)}
            aria-label={`Warp corner ${i + 1}`}
          ></button>
        {/each}
        {@const bx0 = Math.min(node.quad[0][0], node.quad[1][0], node.quad[2][0], node.quad[3][0])}
        {@const bx1 = Math.max(node.quad[0][0], node.quad[1][0], node.quad[2][0], node.quad[3][0])}
        {@const by0 = Math.min(node.quad[0][1], node.quad[1][1], node.quad[2][1], node.quad[3][1])}
        <!-- Controls float in a compact bar just above the piece so they never
             cover the image. Both are relative-drag gestures (see startScale /
             startRotate), so their fixed position doesn't matter. -->
        <div
          class="toolbar"
          style:left={`${(bx0 + bx1) / 2}px`}
          style:top={`${by0 - 12 / scale}px`}
          style:gap={`${5 / scale}px`}
          style:padding={`${4 / scale}px ${5 / scale}px`}
        >
          <button
            class="tbtn rot"
            style:width={`${28 / scale}px`}
            style:height={`${28 / scale}px`}
            onpointerdown={(e) => startRotate(e, node)}
            aria-label="Rotate piece"
            title="Drag to rotate"
          >
            <Icon name="reset" size={15 / scale} />
          </button>
          <button
            class="tbtn scl"
            style:width={`${28 / scale}px`}
            style:height={`${28 / scale}px`}
            onpointerdown={(e) => startScale(e, node)}
            aria-label="Resize piece"
            title="Drag up/down to resize"
          >
            <Icon name="grip" size={15 / scale} />
          </button>
        </div>
      {/if}
    {/each}
  </div>

  {#if collage.nodes.length === 0}
    <div class="empty">
      <Icon name="layers" size={34} />
      <p>Add frames from the menu, then drag to move and pull the corners to warp.</p>
    </div>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
    flex: 1;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: flex-start;
    justify-content: flex-start;
    overflow: hidden;
  }
  .surface {
    position: relative;
    transform-origin: 0 0;
    flex-shrink: 0;
  }
  /* The working area fills the whole pane (no boxed canvas): a checkerboard
     across it signals the transparent alpha that will be exported. */
  .wrap.checker {
    background-color: #2a2f3a;
    background-image:
      linear-gradient(45deg, rgba(255, 255, 255, 0.07) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.07) 75%),
      linear-gradient(45deg, rgba(255, 255, 255, 0.07) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.07) 75%);
    background-size: 24px 24px;
    background-position: 0 0, 12px 12px;
  }
  .node {
    position: absolute;
    top: 0;
    left: 0;
    /* size is driven by explicit width/height + matrix3d warp; the global
       `img { max-width: 100% }` would shrink oversized frames below their
       box and push the warp handles outside the image. */
    max-width: none;
    transform-origin: 0 0;
    cursor: move;
    user-select: none;
    outline: 1px solid transparent;
  }
  .node.selected {
    outline: 1px dashed var(--accent);
  }
  .handle {
    position: absolute;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    background: var(--accent);
    border: 2px solid #10141c;
    cursor: grab;
    padding: 0;
    touch-action: none;
  }
  .toolbar {
    position: absolute;
    transform: translate(-50%, -100%);
    display: flex;
    align-items: center;
    border-radius: 999px;
    background: rgba(16, 20, 28, 0.92);
    border: 1px solid var(--accent);
    box-shadow: var(--shadow-2);
    touch-action: none;
  }
  .tbtn {
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: transparent;
    color: var(--accent);
    border: none;
    padding: 0;
    touch-action: none;
  }
  .tbtn:hover {
    background: rgba(255, 255, 255, 0.09);
  }
  .tbtn.rot {
    cursor: grab;
  }
  .tbtn.scl {
    cursor: ns-resize;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--text-3);
    text-align: center;
    padding: 20px;
    pointer-events: none;
  }
  .empty p {
    max-width: 260px;
    font-size: var(--fs-sm);
  }
</style>
