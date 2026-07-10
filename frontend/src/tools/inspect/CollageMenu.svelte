<script>
  import { previewStyle, scaleQuad, rotateQuad, quadCentroid, cropImgStyle, styleText, uid } from '../../lib/inspect.js';
  import Icon from '../../components/Icon.svelte';

  // Right-panel menu for the Collage tab: switch/create collages, add tray frames
  // to the active one, and act on the selected piece. A session holds several
  // collages (session.collages / session.activeCollageId); each is saved as its
  // own PNG. Each added piece is a frozen snapshot of the frame (addToCollage).
  let { session, filters, selectedId = $bindable(), addToCollage, requestCrop } = $props();

  const active = $derived(
    session.collages.find((c) => c.id === session.activeCollageId) ?? session.collages[0]
  );

  const onCanvas = (id) => active?.nodes.some((n) => n.frameId === id);
  const selected = $derived(active?.nodes.find((n) => n.id === selectedId) ?? null);

  function switchCollage(id) {
    session.activeCollageId = id;
    selectedId = null;
  }

  function addCollage() {
    const nums = session.collages.map((c) => parseInt((c.name?.match(/\d+/) ?? [])[0]) || 0);
    const next = Math.max(0, ...nums) + 1;
    const c = { id: uid('cl'), name: `Collage ${next}`, width: 1600, height: 800, background: '#12141c', transparent: true, nodes: [] };
    session.collages.push(c);
    session.activeCollageId = c.id;
    selectedId = null;
  }

  function removeCollage(id) {
    if (session.collages.length <= 1) return; // always keep at least one
    session.collages = session.collages.filter((c) => c.id !== id);
    if (session.activeCollageId === id) session.activeCollageId = session.collages[0].id;
    selectedId = null;
  }

  function removeNode(id) {
    active.nodes = active.nodes.filter((n) => n.id !== id);
    if (selectedId === id) selectedId = null;
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
</script>

<div class="module">
  <div class="section">
    <div class="section-head"><span>Collages</span></div>
    <div class="collage-tabs">
      {#each session.collages as cl (cl.id)}
        <div class="ctab" class:active={cl.id === session.activeCollageId}>
          <button class="ctab-name" onclick={() => switchCollage(cl.id)} title="Switch to this collage">
            {cl.name}{#if cl.nodes.length}<span class="count">{cl.nodes.length}</span>{/if}
          </button>
          {#if session.collages.length > 1}
            <button class="ctab-x" onclick={() => removeCollage(cl.id)} aria-label="Delete collage"><Icon name="x" size={11} /></button>
          {/if}
        </div>
      {/each}
      <button class="ctab add" onclick={addCollage} title="New collage"><Icon name="plus" size={13} /></button>
    </div>
  </div>

  <p class="hint">Pieces are the frames you captured. Add them, drag to arrange, pull corners to warp into a panorama.</p>

  <div class="section">
    <div class="section-head"><span>Frames</span></div>
    <div class="grid">
      {#each session.frames as fr (fr.id)}
        {@const look = previewStyle(filters, fr.adjust)}
        <button class="tile" class:used={onCanvas(fr.id)} onclick={() => addToCollage(fr)} title={onCanvas(fr.id) ? 'Add again (fresh snapshot)' : 'Add to canvas'}>
          <img
            class:cropped={fr.crop}
            src={fr.url}
            alt="frame"
            style={styleText(cropImgStyle(fr.crop))}
            style:filter={look.filter}
            style:transform={look.transform}
          />
          <span class="add"><Icon name="plus" size={12} /></span>
        </button>
      {/each}
    </div>
    {#if session.frames.length === 0}<p class="empty">No frames captured yet.</p>{/if}
  </div>

  <p class="hint">Exported as a <strong>transparent PNG</strong> — only the pieces, trimmed to their bounds on save.</p>

  {#if selected}
    <div class="section">
      <div class="section-head"><span>Selected piece</span></div>
      <div class="scale-row">
        <span class="lbl">Scale</span>
        <button class="btn btn-sm sq" onclick={() => scaleBy(selected, 1 / 1.1)} aria-label="Shrink piece">−</button>
        <button class="btn btn-sm sq" onclick={() => scaleBy(selected, 1.1)} aria-label="Enlarge piece">+</button>
        <span class="sub">or drag the ⇕ grip above the piece</span>
      </div>
      <div class="scale-row">
        <span class="lbl">Rotate</span>
        <button class="btn btn-sm sq" onclick={() => rotateByDeg(selected, -15)} aria-label="Rotate left">↺</button>
        <button class="btn btn-sm sq" onclick={() => rotateByDeg(selected, 15)} aria-label="Rotate right">↻</button>
        <span class="sub">or drag the ↻ handle above the piece</span>
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

  <button class="btn btn-sm w-full" disabled title="Automatic stitching is coming soon">
    <Icon name="hash" size={14} /> Auto panorama (coming soon)
  </button>
</div>

<style>
  .module {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .hint,
  .empty {
    color: var(--text-3);
    font-size: var(--fs-xs);
    margin: 0;
  }
  .section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .hint + .section {
    border-top: 1px solid var(--border);
    padding-top: 12px;
  }
  .section-head {
    font-weight: 600;
    font-size: var(--fs-sm);
  }
  .collage-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .ctab {
    display: flex;
    align-items: center;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    overflow: hidden;
    background: var(--bg-1);
  }
  .ctab.active {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .ctab-name {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 8px;
    font-size: var(--fs-xs);
    color: var(--text-2);
    background: transparent;
    border: none;
  }
  .ctab.active .ctab-name {
    color: var(--accent);
  }
  .ctab-name .count {
    font-size: 9px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--bg-2);
    color: var(--text-3);
  }
  .ctab-x {
    display: flex;
    align-items: center;
    padding: 4px 5px;
    color: var(--text-3);
    background: transparent;
    border: none;
    border-left: 1px solid var(--border);
  }
  .ctab-x:hover {
    color: var(--danger, #d86a6a);
  }
  .ctab.add {
    padding: 4px 8px;
    color: var(--text-2);
    cursor: pointer;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    max-height: 200px;
    overflow: auto;
  }
  .tile {
    position: relative;
    aspect-ratio: 1;
    border-radius: var(--r-sm);
    overflow: hidden;
    border: 2px solid transparent;
    padding: 0;
  }
  .tile.used {
    border-color: var(--border-strong);
  }
  .tile img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .tile .add {
    position: absolute;
    bottom: 3px;
    right: 3px;
    background: var(--accent);
    color: #10141c;
    border-radius: 4px;
    display: flex;
    padding: 1px;
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
  .scale-row .sub {
    font-size: var(--fs-xs);
    color: var(--text-3);
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
