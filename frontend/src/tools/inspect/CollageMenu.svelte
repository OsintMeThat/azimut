<script>
  import { scaleQuad, rotateQuad, quadCentroid, rotateQuads, scaleQuads, clockTime } from '../../lib/inspect.js';
  import Icon from '../../components/Icon.svelte';

  // The foot of the panel beside the canvas: the selected piece, or the block of
  // pieces selected. It keeps its place and its height whatever is selected, so
  // nothing around it moves when a selection comes and goes. What acts on the whole
  // collage sits in the bar over the canvas (CollageToolbar).
  // `fileTitles` names a piece's file as the case names it now.
  let { collage: active, selectedIds = $bindable([]), requestCrop, fileTitles = new Map() } = $props();

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
</script>

{#snippet turnRow(shrink, grow, left, right, what)}
  <div class="scale-row">
    <span class="lbl">Scale</span>
    <button class="btn btn-sm sq" onclick={shrink} aria-label={`Shrink ${what}`} title={what === 'piece' ? 'Shrink, or drag a side handle' : 'Shrink, or drag a block corner'}>−</button>
    <button class="btn btn-sm sq" onclick={grow} aria-label={`Enlarge ${what}`} title={what === 'piece' ? 'Enlarge, or drag a side handle' : 'Enlarge, or drag a block corner'}>+</button>
    <span class="lbl gap">Rotate</span>
    <button class="btn btn-sm sq" onclick={left} aria-label={what === 'piece' ? 'Rotate left' : 'Rotate block left'} title={what === 'piece' ? 'Turn 15° left, or drag the ↻ handle' : 'Turn 15° left, or drag the ↻ knob'}>↺</button>
    <button class="btn btn-sm sq" onclick={right} aria-label={what === 'piece' ? 'Rotate right' : 'Rotate block right'} title={what === 'piece' ? 'Turn 15° right, or drag the ↻ handle' : 'Turn 15° right, or drag the ↻ knob'}>↻</button>
  </div>
{/snippet}

<div class="module">
  {#if selected}
    <div class="head">
      <div class="identity" title={source}>
        <span class="mini">
          {#if selected.url}<img src={selected.url} alt="" />{:else}<Icon name={selected.missing ? 'alert' : 'image'} size={14} />{/if}
        </span>
        <span class="source">{source}</span>
      </div>
      <button class="btn btn-ghost btn-sm danger" onclick={() => removeNode(selected.id)} title="or press Delete"><Icon name="trash" size={13} /> Remove</button>
    </div>
    {@render turnRow(() => scaleBy(selected, 1 / 1.1), () => scaleBy(selected, 1.1), () => rotateByDeg(selected, -15), () => rotateByDeg(selected, 15), 'piece')}
    <div class="actions">
      <span class="crop">
        <button class="btn btn-sm" class:joined={selected.crop} onclick={() => requestCrop?.(selected)}><Icon name="crop" size={13} /> Crop</button>
        {#if selected.crop}
          <button class="btn btn-sm clear" onclick={() => requestCrop?.(selected, true)} aria-label="Clear crop" title="Clear crop">
            <Icon name="x" size={12} />
          </button>
        {/if}
      </span>
      <button class="btn btn-sm" onclick={() => resetWarp(selected)}><Icon name="reset" size={13} /> Unwarp</button>
      <span class="rule" aria-hidden="true"></span>
      <button class="btn btn-sm" onclick={() => bringFront(selected.id)} title="Bring to the front">Front</button>
      <button class="btn btn-sm" onclick={() => sendBack(selected.id)} title="Send to the back">Back</button>
    </div>
  {:else if selectedGroup.length > 1}
    <div class="head">
      <div class="identity">
        <span class="mini"><Icon name="stack" size={15} /></span>
        <span class="source">{selectedGroup.length} pieces selected</span>
      </div>
      <button class="btn btn-ghost btn-sm danger" onclick={removeGroup} title="or press Delete">
        <Icon name="trash" size={13} /> Remove {selectedGroup.length}
      </button>
    </div>
    {@render turnRow(() => scaleGroupBy(1 / 1.1), () => scaleGroupBy(1.1), () => rotateGroupByDeg(-15), () => rotateGroupByDeg(15), 'block')}
    <p class="say">Moves as one block. Shift-click adds or drops a piece.</p>
  {:else}
    <div class="none">
      <Icon name="cursor" size={15} />
      <p class="say">Click a piece to scale, turn or crop it. Shift-click selects several.</p>
    </div>
  {/if}
</div>

<style>
  /* As tall as the selected piece's controls, whatever is selected, so the panel
     above never moves. */
  .module {
    display: flex;
    flex-direction: column;
    gap: 9px;
    min-height: 112px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 30px;
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
    align-items: center;
    gap: 6px;
  }
  .crop {
    display: flex;
  }
  .crop .joined {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
  .crop .clear {
    margin-left: -1px;
    padding-left: 5px;
    padding-right: 5px;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }
  .rule {
    width: 1px;
    height: 18px;
    margin: 0 2px;
    background: var(--border);
  }
  .danger {
    flex-shrink: 0;
    color: var(--danger, #d86a6a);
  }
  .say {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--text-3);
    line-height: 1.45;
  }
  .none {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 30px;
    padding: 0 2px;
    color: var(--text-3);
  }
  .none :global(svg) {
    flex: none;
    opacity: 0.8;
  }
</style>
