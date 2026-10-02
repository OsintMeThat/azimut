<script>
  import {
    scaleQuad, rotateQuad, quadCentroid, rotateQuads, scaleQuads, pinholeOps, stitchCanvas, clockTime,
  } from '../../lib/inspect.js';
  import { api } from '../../lib/api.js';
  import { caseState, toast } from '../../lib/state.svelte.js';
  import Icon from '../../components/Icon.svelte';

  // The panel beside the canvas: the selected piece or block, and the auto
  // panorama. Adding pieces and exporting live in the Collage tool around it.
  // `fileTitles` names a piece's file as the case names it now.
  let { collage: active, selectedIds = $bindable([]), requestCrop, renderPiece, fileTitles = new Map() } = $props();

  // These controls act on one piece; a multi-piece block is transformed as a
  // whole on the canvas, so the section simply steps aside for it.
  const selected = $derived(
    selectedIds.length === 1 ? (active?.nodes.find((n) => n.id === selectedIds[0]) ?? null) : null
  );

  // Which file the selected piece was cut from, and where in it.
  const source = $derived.by(() => {
    if (!selected) return null;
    const path = selected.save?.path ?? '';
    const name = fileTitles.get(path) ?? path.split('/').pop();
    const time = selected.save?.time;
    return time == null ? name : `${name} · ${clockTime(time)}`;
  });

  function removeNode(id) {
    active.nodes = active.nodes.filter((n) => n.id !== id);
    selectedIds = selectedIds.filter((x) => x !== id);
  }

  function bringFront(id) {
    const i = active.nodes.findIndex((n) => n.id === id);
    if (i !== -1) active.nodes.push(active.nodes.splice(i, 1)[0]);
  }

  function sendBack(id) {
    const i = active.nodes.findIndex((n) => n.id === id);
    if (i > 0) active.nodes.unshift(active.nodes.splice(i, 1)[0]);
  }

  function resetWarp(node) {
    const xs = node.quad.map((p) => p[0]);
    const ys = node.quad.map((p) => p[1]);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const x1 = Math.max(...xs);
    const y1 = Math.max(...ys);
    node.quad = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  }

  // Uniform resize around the centroid — precise counterpart to the on-canvas
  // scale handle (both just move the quad, so they compose with the warp).
  function scaleBy(node, k) {
    node.quad = scaleQuad(node.quad, k, quadCentroid(node.quad));
  }

  // Rotate around the centroid by a fixed step (degrees) — precise counterpart
  // to the on-canvas rotate handle.
  function rotateByDeg(node, deg) {
    node.quad = rotateQuad(node.quad, (deg * Math.PI) / 180, quadCentroid(node.quad));
  }

  // ---- multi-piece block ----------------------------------------------------
  // Same precise steps as the single-piece section, but about the block's shared
  // centre — the exact counterpart of the on-canvas block handles.
  const selectedGroup = $derived(
    selectedIds.length > 1 ? (active?.nodes.filter((n) => selectedIds.includes(n.id)) ?? []) : []
  );

  function applyToGroup(out) {
    selectedGroup.forEach((n, i) => (n.quad = out[i]));
  }

  const scaleGroupBy = (k) => applyToGroup(scaleQuads(selectedGroup.map((n) => n.quad), k));

  const rotateGroupByDeg = (deg) =>
    applyToGroup(rotateQuads(selectedGroup.map((n) => n.quad), (deg * Math.PI) / 180));

  function removeGroup() {
    active.nodes = active.nodes.filter((n) => !selectedIds.includes(n.id));
    selectedIds = [];
  }

  // ---- auto-stitch ----------------------------------------------------------
  // The backend solves each piece's placement from the imagery itself and hands
  // back a recipe, never pixels (spec § v2 Panorama: machine stitch first,
  // hand-tune after). Pieces it can't place are left exactly where they were, for
  // the analyst to place by hand.
  //
  // The mode picks the projection, and the two are genuinely different bargains:
  // `planar` returns a quad per piece and they stay corner-warpable, but it models
  // the scene as one flat surface, so a wide pan blows the end pieces up. The
  // panorama modes solve the camera's rotation instead and bake the resulting warp
  // into each piece's recipe — bounded and undistorted however far you panned, at
  // the cost of the corner handles.
  const MODES = [
    { id: 'planar', label: 'Planar', hint: 'One flat surface, such as a facade or the ground. Pieces stay warpable.' },
    { id: 'cylindrical', label: 'Cylindrical', hint: 'A camera panning sideways.' },
    { id: 'spherical', label: 'Spherical', hint: 'A camera that pans and tilts.' },
  ];
  let mode = $state('cylindrical');
  let stitching = $state(false);
  let undoSnap = $state(null);

  const snapshot = (n) => ({
    id: n.id, quad: n.quad.map(([x, y]) => [x, y]), url: n.url, baseUrl: n.baseUrl,
    w: n.w, h: n.h, frameOps: n.frameOps, crop: n.crop, save: n.save,
  });

  /**
   * Resize the canvas to what the solver asked for, carrying the pieces it did
   * not place along with it. They are scaled uniformly, by the smaller of the two
   * ratios, so a piece left in place keeps its shape and stays on the canvas.
   */
  function applyCanvas(canvas, placed) {
    if (!canvas) return;
    const { width, height, scale } = stitchCanvas(canvas, active);
    if (width === active.width && height === active.height) return;
    if (scale !== 1) {
      active.nodes.forEach((n, i) => {
        if (!placed.has(i)) n.quad = n.quad.map(([x, y]) => [x * scale, y * scale]);
      });
    }
    active.width = width;
    active.height = height;
  }

  async function autoStitch() {
    if (!active || active.nodes.length < 2) return;
    stitching = true;
    try {
      const nodes = active.nodes;
      const before = { nodes: nodes.map(snapshot), width: active.width, height: active.height };
      const res = await api.post(`/api/cases/${caseState.current.id}/inspect/auto-stitch`, {
        width: active.width,
        height: active.height,
        mode,
        // frozen snapshot recipes (path/time/ops), stripped back to pinhole pixels
        nodes: nodes.map((n) => ({ ...n.save, ops: pinholeOps(n.save) })),
      });
      // A stitch is solved in source pixels, so the canvas follows it: the answer
      // carries the size that keeps the pieces at full resolution, and the export
      // is the pieces' bounds, so a canvas left too small *is* the lost detail.
      // Pieces the solver could not place keep their place as it grows.
      applyCanvas(res.canvas, new Set(res.nodes.map((n) => n.index)));
      for (const { index, quad, op } of res.nodes) {
        const node = nodes[index];
        const base = pinholeOps(node.save);
        const ops = op ? [...base, op] : base;
        // Planar leaves the pixels alone; only re-derive when the recipe moved
        // (a panorama warp arriving, or dropping off on the way back to planar).
        if (JSON.stringify(ops) !== JSON.stringify(node.save.ops ?? [])) {
          await renderPiece(node, ops);
        }
        node.quad = quad;
      }
      undoSnap = before;
      selectedIds = [];
      const placed = res.nodes.length;
      if (res.dropped.length) {
        toast(`Stitched ${placed}. ${res.dropped.length} left in place because no overlap was found`, 'warn');
      } else {
        toast(`Stitched ${placed} pieces`, 'ok');
      }
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      stitching = false;
    }
  }

  function undoStitch() {
    for (const snap of undoSnap.nodes) {
      const node = active.nodes.find((n) => n.id === snap.id);
      if (node) Object.assign(node, snap);
    }
    // The canvas moved with the stitch, so it comes back with it.
    active.width = undoSnap.width;
    active.height = undoSnap.height;
    undoSnap = null;
  }
</script>

<div class="module">
  {#if selected}
    <div class="section">
      <div class="identity" title={source}>
        <span class="mini">
          {#if selected.url}<img src={selected.url} alt="" />{:else}<Icon name={selected.missing ? 'alert' : 'image'} size={14} />{/if}
        </span>
        <span class="source">{source}</span>
      </div>
      <div class="scale-row">
        <span class="lbl">Scale</span>
        <button class="btn btn-sm sq" onclick={() => scaleBy(selected, 1 / 1.1)} aria-label="Shrink piece" title="Shrink, or drag a side handle">−</button>
        <button class="btn btn-sm sq" onclick={() => scaleBy(selected, 1.1)} aria-label="Enlarge piece" title="Enlarge, or drag a side handle">+</button>
        <span class="lbl gap">Rotate</span>
        <button class="btn btn-sm sq" onclick={() => rotateByDeg(selected, -15)} aria-label="Rotate left" title="Turn 15° left, or drag the ↻ handle">↺</button>
        <button class="btn btn-sm sq" onclick={() => rotateByDeg(selected, 15)} aria-label="Rotate right" title="Turn 15° right, or drag the ↻ handle">↻</button>
      </div>
      <div class="actions">
        <button class="btn btn-sm" onclick={() => requestCrop?.(selected)}><Icon name="crop" size={13} /> Crop</button>
        <button class="btn btn-sm" onclick={() => bringFront(selected.id)}><Icon name="layers" size={13} /> Front</button>
        <button class="btn btn-sm" onclick={() => sendBack(selected.id)}><Icon name="layers" size={13} /> Back</button>
        <button class="btn btn-sm" onclick={() => resetWarp(selected)}><Icon name="reset" size={13} /> Unwarp</button>
        <button class="btn btn-sm danger" onclick={() => removeNode(selected.id)} title="or press Delete"><Icon name="trash" size={13} /> Remove</button>
      </div>
      {#if selected.crop}
        <button class="btn btn-ghost btn-xs" onclick={() => requestCrop?.(selected, true)}><Icon name="reset" size={12} /> Clear crop</button>
      {/if}
    </div>
  {/if}

  {#if selectedGroup.length > 1}
    <div class="section">
      <div class="section-head" title="Moves as one block; shift-click a piece to add or drop it">
        <span>{selectedGroup.length} pieces selected</span>
      </div>
      <div class="scale-row">
        <span class="lbl">Scale</span>
        <button class="btn btn-sm sq" onclick={() => scaleGroupBy(1 / 1.1)} aria-label="Shrink block" title="Shrink, or drag a block corner">−</button>
        <button class="btn btn-sm sq" onclick={() => scaleGroupBy(1.1)} aria-label="Enlarge block" title="Enlarge, or drag a block corner">+</button>
        <span class="lbl gap">Rotate</span>
        <button class="btn btn-sm sq" onclick={() => rotateGroupByDeg(-15)} aria-label="Rotate block left" title="Turn 15° left, or drag the ↻ knob">↺</button>
        <button class="btn btn-sm sq" onclick={() => rotateGroupByDeg(15)} aria-label="Rotate block right" title="Turn 15° right, or drag the ↻ knob">↻</button>
      </div>
      <div class="actions">
        <button class="btn btn-sm danger" onclick={removeGroup} title="or press Delete">
          <Icon name="trash" size={13} /> Remove {selectedGroup.length}
        </button>
      </div>
    </div>
  {/if}

  <div class="section">
    <div class="section-head" title="Place the pieces by the imagery they share">
      <span>Auto panorama</span>
    </div>
    <div class="modes">
      {#each MODES as m (m.id)}
        <button class="mode" class:on={mode === m.id} onclick={() => (mode = m.id)} title={m.hint}>
          {m.label}
        </button>
      {/each}
    </div>
    <button
      class="btn btn-sm w-full"
      disabled={stitching || !active || active.nodes.length < 2}
      onclick={autoStitch}
      title={active && active.nodes.length < 2
        ? 'Add at least two overlapping pieces'
        : 'Stitch the pieces on this collage'}
    >
      <Icon name={stitching ? 'clock' : 'hash'} size={14} />
      {stitching ? 'Stitching…' : 'Auto-stitch pieces'}
    </button>
    {#if undoSnap}
      <button class="btn btn-ghost btn-xs w-full" onclick={undoStitch}>
        <Icon name="reset" size={12} /> Undo auto-stitch
      </button>
    {/if}
  </div>
</div>

<style>
  .module {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .section + .section {
    border-top: 1px solid var(--border);
    padding-top: 12px;
  }
  .identity {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .mini {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 30px;
    border-radius: var(--r-sm);
    overflow: hidden;
    background: var(--bg-0);
    color: var(--text-3);
  }
  .mini img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .source {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-1);
  }
  .section-head {
    font-weight: 600;
    font-size: var(--fs-sm);
  }
  .modes {
    display: flex;
    gap: 0;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    overflow: hidden;
    background: var(--bg-1);
  }
  .mode {
    flex: 1;
    padding: 5px 4px;
    font-size: var(--fs-xs);
    color: var(--text-2);
    background: transparent;
    border: none;
    border-left: 1px solid var(--border);
  }
  .mode:first-child {
    border-left: none;
  }
  .mode.on {
    background: var(--bg-3);
    color: var(--accent);
  }
  .scale-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .scale-row .lbl {
    font-size: var(--fs-sm);
    color: var(--text-2);
  }
  .scale-row .gap {
    margin-left: 10px;
  }
  .btn.sq {
    min-width: 30px;
    justify-content: center;
    font-size: var(--fs-md);
    line-height: 1;
  }
  .actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .danger {
    color: var(--danger, #d86a6a);
  }
  .w-full {
    width: 100%;
    justify-content: center;
  }
</style>
