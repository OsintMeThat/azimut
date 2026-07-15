<script>
  import {
    quadMatrix3d, quadCentroid, rotateQuad, quadEdgeMidpoints, scaleQuad,
    quadsBounds, moveQuads, rotateQuads, scaleQuads,
  } from '../../lib/inspect.js';
  import { uiState } from '../../lib/state.svelte.js';
  import Icon from '../../components/Icon.svelte';

  // Interactive collage surface. Each node is a tray frame placed as a 4-point
  // quad (canvas pixels). Drag the body to move all four corners together; drag a
  // corner handle to warp — a hand-made panorama. The same quads are sent to the
  // backend, which renders the full-res warp with PIL (see compose_perspective).
  // `collage` is the session's *active* collage (a session may hold several).
  //
  // Selection is a *set*: shift-click adds/removes a piece. One piece gets the
  // per-piece handles (warp corners, side resize, rotate, toolbar); several get
  // a single block frame that moves/rotates/scales them as one rigid unit.
  let { collage, selectedIds = $bindable([]), requestCrop } = $props();

  let wrapEl = $state();
  let availW = $state(800);
  let availH = $state(600);
  let zoom = $state(1); // 1 = fit; wheel zooms toward the pointer
  let panX = $state(0);
  let panY = $state(0);
  let movingIds = $state([]); // pieces being dragged — semi-transparent to align

  const isSel = (id) => selectedIds.includes(id);
  const selectedNodes = $derived(collage.nodes.filter((n) => isSel(n.id)));
  const soloId = $derived(selectedNodes.length === 1 ? selectedNodes[0].id : null);
  // the block frame: only once several pieces are selected
  const groupBox = $derived(
    selectedNodes.length > 1 ? quadsBounds(selectedNodes.map((n) => n.quad)) : null
  );

  function toggleSel(id) {
    selectedIds = isSel(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
  }

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
    selectedIds = [];
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

  // Shift-click adds/removes a piece from the block without moving anything.
  // Otherwise: pressing a piece *outside* the block selects just it; pressing one
  // already *inside* the block keeps the whole selection, so the drag carries every
  // piece — and, if the pointer never really moved, collapses to that single piece
  // on release (a plain click still means "just this one").
  function startMove(e, node) {
    e.preventDefault();
    if (e.shiftKey) {
      toggleSel(node.id);
      return;
    }
    const group = isSel(node.id) ? collage.nodes.filter((n) => isSel(n.id)) : [node];
    if (!isSel(node.id)) selectedIds = [node.id];
    const base = group.map((n) => n.quad.map(([x, y]) => [x, y]));
    const [px, py] = toCanvas(e);
    let moved = false;
    const move = (ev) => {
      const [nx, ny] = toCanvas(ev);
      if (!moved) {
        // ignore the sub-pixel jitter of a click, so it can still collapse the block
        if (Math.hypot(nx - px, ny - py) * scale < 3) return;
        moved = true;
        movingIds = group.map((n) => n.id); // once, not on every move
      }
      // always re-derive from the quads captured at press: accumulating deltas
      // would drift the piece away from the pointer over a long drag
      const out = moveQuads(base, nx - px, ny - py);
      group.forEach((n, i) => (n.quad = out[i]));
    };
    const up = () => {
      if (!moved && group.length > 1) selectedIds = [node.id];
      movingIds = [];
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // Block rotate / resize share one shape: snapshot the selected quads and the
  // pivot *once* at press, then map a pure group transform over them until
  // release. Re-deriving the pivot mid-drag would chase the block's own bounding
  // box and walk it away under the pointer.
  function dragGroup(e, transform) {
    e.preventDefault();
    e.stopPropagation();
    const group = collage.nodes.filter((n) => isSel(n.id));
    const base = group.map((n) => n.quad.map(([x, y]) => [x, y]));
    const bounds = quadsBounds(base);
    if (!bounds) return;
    const c = bounds.center;
    const start = toCanvas(e);
    const move = (ev) => {
      const out = transform(base, c, toCanvas(ev), start);
      group.forEach((n, i) => (n.quad = out[i]));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // Angle the pointer has swept around the block's centre since the press.
  const startGroupRotate = (e) =>
    dragGroup(e, (base, c, [mx, my], [sx, sy]) =>
      rotateQuads(base, Math.atan2(my - c[1], mx - c[0]) - Math.atan2(sy - c[1], sx - c[0]), c));

  // Uniform scale about the block's centre, tracking the handle's distance from
  // it — the block grows as one, so the pieces spread apart instead of each
  // swelling in place (matches the per-piece side handles' feel).
  const startGroupResize = (e) =>
    dragGroup(e, (base, c, [mx, my], [sx, sy]) => {
      const d0 = Math.hypot(sx - c[0], sy - c[1]) || 1;
      const k = Math.min(20, Math.max(0.05, Math.hypot(mx - c[0], my - c[1]) / d0));
      return scaleQuads(base, k, c);
    });

  function startWarp(e, node, corner) {
    e.preventDefault();
    e.stopPropagation();
    selectedIds = [node.id];
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
    selectedIds = [node.id];
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

  // Delete / Backspace removes every selected piece. The Inspect tool stays
  // mounted when another tab is shown, so bail unless it is the visible tool —
  // and when typing in a field or when a modal (e.g. the crop editor) is open.
  function onKey(e) {
    if (uiState.tool !== 'inspect') return;
    if (!selectedIds.length) return;
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (document.querySelector('.overlay')) return;
    e.preventDefault();
    collage.nodes = collage.nodes.filter((n) => !isSel(n.id));
    selectedIds = [];
  }

  // Rotate the piece around its centroid by dragging the rotate handle around
  // the centre — the angle tracks the pointer. Pure quad math (composes w/ warp).
  function startRotate(e, node) {
    e.preventDefault();
    e.stopPropagation();
    selectedIds = [node.id];
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
        class:selected={isSel(node.id)}
        class:ghost={node.ghost || movingIds.includes(node.id)}
        src={box.url}
        alt="collage piece"
        style:width={`${box.w}px`}
        style:height={`${box.h}px`}
        style:transform={quadMatrix3d(box.w, box.h, node.quad)}
        draggable="false"
        onpointerdown={(e) => (e.stopPropagation(), startMove(e, node))}
        ondblclick={() => { selectedIds = [node.id]; requestCrop?.(node); }}
      />
      {#if node.id === soloId}
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

    <!-- Block frame for a multi-piece selection: one axis-aligned box around the
         lot, with corner handles that scale it and a knob that turns it — all
         about the box's centre, so the pieces hold their relative places. The
         box itself never listens, so the pieces under it stay clickable. -->
    {#if groupBox}
      <div
        class="group-box"
        style:left={`${groupBox.minX}px`}
        style:top={`${groupBox.minY}px`}
        style:width={`${groupBox.width}px`}
        style:height={`${groupBox.height}px`}
        style:border-width={`${1.5 / scale}px`}
      ></div>
      {#each [[groupBox.minX, groupBox.minY], [groupBox.maxX, groupBox.minY], [groupBox.maxX, groupBox.maxY], [groupBox.minX, groupBox.maxY]] as corner, i (i)}
        <button
          class="side-handle"
          style:left={`${corner[0]}px`}
          style:top={`${corner[1]}px`}
          style:width={`${14 / scale}px`}
          style:height={`${14 / scale}px`}
          onpointerdown={startGroupResize}
          aria-label="Resize the selected block"
          title="Drag to resize the whole selection"
        ></button>
      {/each}
      <!-- rotate knob on a stem off the block's right edge (mirrors the per-piece one) -->
      <div
        class="rot-stem"
        style:left={`${groupBox.maxX}px`}
        style:top={`${groupBox.center[1]}px`}
        style:width={`${24 / scale}px`}
        style:height={`${1.5 / scale}px`}
        style:transform={`translateY(${-0.75 / scale}px)`}
      ></div>
      <button
        class="rot-handle"
        style:left={`${groupBox.maxX + 24 / scale}px`}
        style:top={`${groupBox.center[1]}px`}
        style:width={`${20 / scale}px`}
        style:height={`${20 / scale}px`}
        onpointerdown={startGroupRotate}
        aria-label="Rotate the selected block"
        title="Drag to rotate the whole selection"
      >
        <Icon name="reset" size={13 / scale} />
      </button>
    {/if}
  </div>

  <div class="view-ctl">
    {#if zoom !== 1}
      <span class="zoom-val">{Math.round(zoom * 100)}%</span>
      <button class="btn btn-ghost btn-sm" onclick={resetView} title="Fit the collage back in view">
        <Icon name="eye" size={14} /> Fit
      </button>
    {:else}
      <span class="zoom-hint">scroll to zoom · drag background to pan · shift-click to select several</span>
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
  /* Frame around a multi-piece selection. Never listens — the pieces it spans
     (and their own handles) must stay clickable through it. */
  .group-box {
    position: absolute;
    border-style: dashed;
    border-color: var(--accent);
    pointer-events: none;
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
