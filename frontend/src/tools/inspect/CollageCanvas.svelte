<script>
  import { quadMatrix3d, quadCentroid, rotateQuad, quadEdgeMidpoints, scaleQuad } from '../../lib/inspect.js';
  import { uiState } from '../../lib/state.svelte.js';
  import Icon from '../../components/Icon.svelte';

  // Interactive collage surface. Each node is a tray frame placed as a 4-point
  // quad (canvas pixels). Drag the body to move all four corners together; drag a
  // corner handle to warp — a hand-made panorama. The same quads are sent to the
  // backend, which renders the full-res warp with PIL (see compose_perspective).
  // `collage` is the session's *active* collage (a session may hold several).
  let { collage, selectedId = $bindable(), requestCrop } = $props();

  let wrapEl = $state();
  let availW = $state(800);
  let availH = $state(600);
  let zoom = $state(1); // 1 = fit; wheel zooms toward the pointer
  let panX = $state(0);
  let panY = $state(0);
  let movingId = $state(null); // piece being dragged — semi-transparent to align

  const cw = $derived(collage.width);
  const ch = $derived(collage.height);
  const fitScale = $derived(Math.min(availW / cw, availH / ch, 1) || 1);
  const scale = $derived(fitScale * zoom);

  function boxOf(node) {
    return { w: node.w || 320, h: node.h || 240, url: node.url };
  }

  // client px -> canvas px (the inner surface is translated then scaled, origin 0 0)
  function toCanvas(e) {
    const r = wrapEl.getBoundingClientRect();
    return [(e.clientX - r.left - panX) / scale, (e.clientY - r.top - panY) / scale];
  }

  // Wheel zooms toward the pointer so the feature under the cursor stays put —
  // pixel-level alignment needs to get closer than the fitted view.
  function onWheel(e) {
    e.preventDefault();
    const r = wrapEl.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const old = scale;
    const next = Math.min(Math.max(zoom * (e.deltaY > 0 ? 0.9 : 1.1), 0.2), 8);
    const k = fitScale * next;
    panX = px - ((px - panX) / old) * k;
    panY = py - ((py - panY) / old) * k;
    zoom = next;
  }

  function resetView() {
    zoom = 1;
    panX = 0;
    panY = 0;
  }

  // Drag on the empty background pans the view (a plain click still deselects).
  function startPan(e) {
    selectedId = null;
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = panX;
    const oy = panY;
    const move = (ev) => {
      panX = ox + ev.clientX - sx;
      panY = oy + ev.clientY - sy;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function startMove(e, node) {
    e.preventDefault();
    selectedId = node.id;
    movingId = node.id;
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
      movingId = null;
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

  // Square side handles: uniform scale of the whole piece about its centroid
  // (not a one-axis stretch). Dragging a side out enlarges, in shrinks; the
  // factor tracks the handle's distance from the centre, so it composes with the
  // per-corner warp (round handles) and holds up on an already-warped piece.
  function startEdgeResize(e, node, side) {
    e.preventDefault();
    e.stopPropagation();
    selectedId = node.id;
    const c = quadCentroid(node.quad);
    const base = node.quad.map(([x, y]) => [x, y]);
    const mid = quadEdgeMidpoints(base)[side];
    const dl = Math.hypot(mid.x - c[0], mid.y - c[1]) || 1;
    const ux = (mid.x - c[0]) / dl;
    const uy = (mid.y - c[1]) / dl;
    const [sx, sy] = toCanvas(e);
    const d0 = (sx - c[0]) * ux + (sy - c[1]) * uy || dl; // start projection
    const move = (ev) => {
      const [mx, my] = toCanvas(ev);
      const d = (mx - c[0]) * ux + (my - c[1]) * uy;
      const k = Math.min(20, Math.max(0.05, d / d0));
      node.quad = scaleQuad(base, k, c);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // Nudge the piece one step up/down the stacking order (swap with its
  // neighbour). The right panel keeps the all-the-way Front/Back buttons.
  function stepZ(node, dir) {
    const nodes = collage.nodes;
    const i = nodes.findIndex((n) => n.id === node.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= nodes.length) return;
    [nodes[i], nodes[j]] = [nodes[j], nodes[i]];
    collage.nodes = [...nodes];
  }

  // Delete / Backspace removes the selected piece. The Inspect tool stays
  // mounted when another tab is shown, so bail unless it is the visible tool —
  // and when typing in a field or when a modal (e.g. the crop editor) is open.
  function onKey(e) {
    if (uiState.tool !== 'inspect') return;
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
  onpointerdown={startPan}
  onwheel={onWheel}
>
  <div
    class="surface"
    style:width={`${cw}px`}
    style:height={`${ch}px`}
    style:transform={`translate(${panX}px, ${panY}px) scale(${scale})`}
  >
    {#each collage.nodes as node (node.id)}
      {@const box = boxOf(node)}
      <img
        class="node"
        class:selected={node.id === selectedId}
        class:ghost={node.ghost || node.id === movingId}
        src={box.url}
        alt="collage piece"
        style:width={`${box.w}px`}
        style:height={`${box.h}px`}
        style:transform={quadMatrix3d(box.w, box.h, node.quad)}
        draggable="false"
        onpointerdown={(e) => (e.stopPropagation(), startMove(e, node))}
        ondblclick={() => { selectedId = node.id; requestCrop?.(node); }}
      />
      {#if node.id === selectedId}
        <!-- round corner handles: free perspective warp -->
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
        <!-- square side handles: resize (slide that edge, opposite edge fixed) -->
        {#each quadEdgeMidpoints(node.quad) as m (m.side)}
          <button
            class="side-handle"
            style:left={`${m.x}px`}
            style:top={`${m.y}px`}
            style:width={`${14 / scale}px`}
            style:height={`${14 / scale}px`}
            onpointerdown={(e) => startEdgeResize(e, node, m.side)}
            aria-label={`Resize side ${m.side + 1}`}
            title="Drag to resize this side"
          ></button>
        {/each}
        <!-- Anchor the knob/bar to the piece's *right edge* along its outward
             normal, so they follow the piece as it rotates and warps. -->
        {@const cen = quadCentroid(node.quad)}
        {@const rmx = (node.quad[1][0] + node.quad[2][0]) / 2}
        {@const rmy = (node.quad[1][1] + node.quad[2][1]) / 2}
        {@const dl = Math.hypot(rmx - cen[0], rmy - cen[1]) || 1}
        {@const ux = (rmx - cen[0]) / dl}
        {@const uy = (rmy - cen[1]) / dl}
        {@const stemAng = Math.atan2(uy, ux)}
        <!-- rotate bar on a short stem off the right edge, pointing outward -->
        <div
          class="rot-stem"
          style:left={`${rmx}px`}
          style:top={`${rmy}px`}
          style:width={`${24 / scale}px`}
          style:height={`${1.5 / scale}px`}
          style:transform={`translateX(${-0.75 / scale}px) rotate(${stemAng}rad)`}
        ></div>
        <button
          class="rot-handle"
          style:left={`${rmx + ux * (24 / scale)}px`}
          style:top={`${rmy + uy * (24 / scale)}px`}
          style:width={`${20 / scale}px`}
          style:height={`${20 / scale}px`}
          onpointerdown={(e) => startRotate(e, node)}
          aria-label="Rotate piece"
          title="Drag to rotate"
        >
          <Icon name="reset" size={13 / scale} />
        </button>
        <!-- ghost preview + one-step stacking order. Anchored off the *bottom*
             edge (opposite the rotate knob) so the two never overlap however the
             piece is turned. Front/Back-all live in the right panel. -->
        {@const bmx = (node.quad[2][0] + node.quad[3][0]) / 2}
        {@const bmy = (node.quad[2][1] + node.quad[3][1]) / 2}
        {@const bdl = Math.hypot(bmx - cen[0], bmy - cen[1]) || 1}
        {@const bux = (bmx - cen[0]) / bdl}
        {@const buy = (bmy - cen[1]) / bdl}
        <div
          class="toolbar"
          style:left={`${bmx + bux * (34 / scale)}px`}
          style:top={`${bmy + buy * (34 / scale)}px`}
          style:gap={`${5 / scale}px`}
          style:padding={`${4 / scale}px ${5 / scale}px`}
        >
          <button
            class="tbtn"
            class:on={node.ghost}
            style:width={`${28 / scale}px`}
            style:height={`${28 / scale}px`}
            onpointerdown={(e) => e.stopPropagation()}
            onclick={() => (node.ghost = !node.ghost)}
            aria-label="Toggle piece transparency"
            title="See through this piece to align features (view only, never exported)"
          >
            <Icon name="ghost" size={15 / scale} />
          </button>
          <button
            class="tbtn z-up"
            style:width={`${28 / scale}px`}
            style:height={`${28 / scale}px`}
            onpointerdown={(e) => e.stopPropagation()}
            onclick={() => stepZ(node, 1)}
            aria-label="Bring forward one step"
            title="Bring forward (one step)"
          >
            <Icon name="chevronDown" size={15 / scale} />
          </button>
          <button
            class="tbtn"
            style:width={`${28 / scale}px`}
            style:height={`${28 / scale}px`}
            onpointerdown={(e) => e.stopPropagation()}
            onclick={() => stepZ(node, -1)}
            aria-label="Send back one step"
            title="Send back (one step)"
          >
            <Icon name="chevronDown" size={15 / scale} />
          </button>
        </div>
      {/if}
    {/each}
  </div>

  <div class="view-ctl">
    {#if zoom !== 1}
      <span class="zoom-val">{Math.round(zoom * 100)}%</span>
      <button class="btn btn-ghost btn-sm" onclick={resetView} title="Fit the collage back in view">
        <Icon name="eye" size={14} /> Fit
      </button>
    {:else}
      <span class="zoom-hint">scroll to zoom · drag background to pan</span>
    {/if}
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
  .node.ghost {
    opacity: 0.55;
  }
  .tbtn.on {
    background: var(--accent-soft);
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
    background: rgba(16, 20, 28, 0.85);
    border: 1px solid var(--border);
  }
  .zoom-val {
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }
  .zoom-hint {
    font-size: 11px;
    color: var(--text-3);
    user-select: none;
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
    transform: translate(-50%, -50%);
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
  .tbtn.z-up :global(svg) {
    transform: rotate(180deg);
  }
  /* Square side handles resize; round corner handles warp. */
  .side-handle {
    position: absolute;
    transform: translate(-50%, -50%);
    border-radius: 2px;
    background: var(--accent);
    border: 2px solid #10141c;
    cursor: nesw-resize;
    padding: 0;
    touch-action: none;
  }
  .rot-stem {
    position: absolute;
    transform-origin: 0 0;
    background: var(--accent);
    pointer-events: none;
  }
  .rot-handle {
    position: absolute;
    transform: translate(-50%, -50%);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: rgba(16, 20, 28, 0.92);
    color: var(--accent);
    border: 1px solid var(--accent);
    cursor: grab;
    padding: 0;
    touch-action: none;
  }
  .rot-handle:hover {
    background: rgba(255, 255, 255, 0.09);
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
