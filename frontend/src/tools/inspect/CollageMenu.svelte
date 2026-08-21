<script>
  import {
    previewStyle, scaleQuad, rotateQuad, quadCentroid, cropImgStyle, styleText, uid,
    rotateQuads, scaleQuads, pinholeOps,
  } from '../../lib/inspect.js';
  import { api } from '../../lib/api.js';
  import { caseState, toast } from '../../lib/state.svelte.js';
  import Icon from '../../components/Icon.svelte';

  // Right-panel menu for the Collage tab: switch/create collages, add tray frames
  // to the active one, and act on the selected piece. A session holds several
  // collages (session.collages / session.activeCollageId); each is saved as its
  // own PNG. Each added piece is a frozen snapshot of the frame (addToCollage).
  let {
    session, filters, selectedIds = $bindable([]), addToCollage, requestCrop, renderPiece,
    onRename,
  } = $props();

  const active = $derived(
    session.collages.find((c) => c.id === session.activeCollageId) ?? session.collages[0]
  );

  // How many pieces on this collage came from that tray frame — a tile can be
  // added several times, and with a long tray that count is the only way to see
  // what is already placed.
  const usedCount = (id) => active?.nodes.filter((n) => n.frameId === id).length ?? 0;

  // Same wording as the Frame tab tray, so a frame keeps one name across tabs.
  const frameLabel = (fr, i) =>
    fr.time != null ? `Image ${i + 1} · t=${fr.time.toFixed(2)}s` : `Image ${i + 1}`;
  // These controls act on one piece; a multi-piece block is transformed as a
  // whole on the canvas, so the section simply steps aside for it.
  const selected = $derived(
    selectedIds.length === 1 ? (active?.nodes.find((n) => n.id === selectedIds[0]) ?? null) : null
  );

  function switchCollage(id) {
    session.activeCollageId = id;
    selectedIds = [];
  }

  // Renaming rides on the tab itself: a click switches, a click on the tab you
  // are already in opens it for editing. The name follows the collage into the
  // Save tab, so it is worth setting here while the layout is in front of you.
  let renamingId = $state(null);
  let draftName = $state('');

  function tabClick(cl) {
    if (cl.id === session.activeCollageId) {
      renamingId = cl.id;
      draftName = cl.name ?? '';
    } else {
      switchCollage(cl.id);
    }
  }

  function commitRename(cl) {
    const next = draftName.trim();
    if (next && next !== cl.name) {
      cl.name = next;
      // The Save tab shows this same name; tell it the name is now the user's,
      // so a base name typed there stops refilling it.
      onRename?.(cl);
    }
    renamingId = null;
  }

  function renameKey(event, cl) {
    if (event.key === 'Enter') commitRename(cl);
    else if (event.key === 'Escape') renamingId = null;
  }

  function addCollage() {
    const nums = session.collages.map((c) => parseInt((c.name?.match(/\d+/) ?? [])[0]) || 0);
    const next = Math.max(0, ...nums) + 1;
    const c = { id: uid('cl'), name: `Collage ${next}`, width: 1600, height: 800, background: '#12141c', transparent: true, nodes: [] };
    session.collages.push(c);
    session.activeCollageId = c.id;
    selectedIds = [];
  }

  function removeCollage(id) {
    if (session.collages.length <= 1) return; // always keep at least one
    session.collages = session.collages.filter((c) => c.id !== id);
    if (session.activeCollageId === id) session.activeCollageId = session.collages[0].id;
    selectedIds = [];
  }

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
    { id: 'planar', label: 'Planar', hint: 'One flat surface such as a facade, the ground or a map. Pieces stay warpable.' },
    { id: 'cylindrical', label: 'Cylindrical', hint: 'A camera panning sideways. Bounded and even end to end.' },
    { id: 'spherical', label: 'Spherical', hint: 'A camera that pans *and* tilts. Same, over both axes.' },
  ];
  let mode = $state('cylindrical');
  let stitching = $state(false);
  let undoSnap = $state(null);

  const snapshot = (n) => ({
    id: n.id, quad: n.quad.map(([x, y]) => [x, y]), url: n.url, baseUrl: n.baseUrl,
    w: n.w, h: n.h, frameOps: n.frameOps, crop: n.crop, save: n.save,
  });

  async function autoStitch() {
    if (!active || active.nodes.length < 2) return;
    stitching = true;
    try {
      const nodes = active.nodes;
      const before = nodes.map(snapshot);
      const res = await api.post(`/api/cases/${caseState.current.id}/inspect/auto-stitch`, {
        width: active.width,
        height: active.height,
        mode,
        // frozen snapshot recipes (path/time/ops), stripped back to pinhole pixels
        nodes: nodes.map((n) => ({ ...n.save, ops: pinholeOps(n.save) })),
      });
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
    for (const snap of undoSnap) {
      const node = active.nodes.find((n) => n.id === snap.id);
      if (node) Object.assign(node, snap);
    }
    undoSnap = null;
  }
</script>

<div class="module">
  <div class="section">
    <div class="section-head"><span>Collages</span></div>
    <div class="collage-tabs">
      {#each session.collages as cl (cl.id)}
        <div class="ctab" class:active={cl.id === session.activeCollageId}>
          {#if renamingId === cl.id}
            <!-- svelte-ignore a11y_autofocus -->
            <input
              class="ctab-input"
              bind:value={draftName}
              onblur={() => commitRename(cl)}
              onkeydown={(e) => renameKey(e, cl)}
              aria-label="Collage name"
              maxlength="200"
              autofocus
            />
          {:else}
            <button
              class="ctab-name"
              onclick={() => tabClick(cl)}
              title={cl.id === session.activeCollageId ? 'Rename this collage' : 'Switch to this collage'}
            >
              {cl.name}{#if cl.nodes.length}<span class="count">{cl.nodes.length}</span>{/if}
            </button>
          {/if}
          {#if session.collages.length > 1}
            <button class="ctab-x" onclick={() => removeCollage(cl.id)} aria-label="Delete collage"><Icon name="x" size={11} /></button>
          {/if}
        </div>
      {/each}
      <button class="ctab add" onclick={addCollage} title="New collage"><Icon name="plus" size={13} /></button>
    </div>
  </div>

  <p class="hint">Drag pieces to arrange them, pull corners to warp; shift-click selects several.</p>

  <div class="section">
    <div class="section-head"><span>Frames</span></div>
    <div class="tray">
      {#each session.frames as fr, i (fr.id)}
        {@const look = previewStyle(filters, fr.adjust)}
        {@const used = usedCount(fr.id)}
        <button
          class="thumb"
          class:used={used > 0}
          onclick={() => addToCollage(fr)}
          title={used ? `${frameLabel(fr, i)} · added ${used}×` : frameLabel(fr, i)}
        >
          <img
            src={fr.url}
            alt={frameLabel(fr, i)}
            style={styleText(cropImgStyle(fr.crop))}
            style:filter={look.filter}
            style:transform={look.transform}
          />
          <span class="num">{i + 1}</span>
          {#if used}
            <span class="tag count">×{used}</span>
          {:else}
            <span class="tag"><Icon name="plus" size={11} /></span>
          {/if}
        </button>
      {/each}
    </div>
    {#if session.frames.length === 0}<p class="empty">No frames captured yet.</p>{/if}
  </div>

  <p class="hint">Exports only the pieces as a <strong>transparent PNG</strong>, trimmed to their bounds.</p>

  {#if selected}
    <div class="section">
      <div class="section-head"><span>Selected piece</span></div>
      <div class="scale-row">
        <span class="lbl">Scale</span>
        <button class="btn btn-sm sq" onclick={() => scaleBy(selected, 1 / 1.1)} aria-label="Shrink piece">−</button>
        <button class="btn btn-sm sq" onclick={() => scaleBy(selected, 1.1)} aria-label="Enlarge piece">+</button>
        <span class="sub">or drag a square side handle</span>
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

  {#if selectedGroup.length > 1}
    <div class="section">
      <div class="section-head"><span>Selected block <span class="count">{selectedGroup.length}</span></span></div>
      <p class="hint">Moves as one block; shift-click a piece to add or drop it.</p>
      <div class="scale-row">
        <span class="lbl">Scale</span>
        <button class="btn btn-sm sq" onclick={() => scaleGroupBy(1 / 1.1)} aria-label="Shrink block">−</button>
        <button class="btn btn-sm sq" onclick={() => scaleGroupBy(1.1)} aria-label="Enlarge block">+</button>
        <span class="sub">or drag a block corner</span>
      </div>
      <div class="scale-row">
        <span class="lbl">Rotate</span>
        <button class="btn btn-sm sq" onclick={() => rotateGroupByDeg(-15)} aria-label="Rotate block left">↺</button>
        <button class="btn btn-sm sq" onclick={() => rotateGroupByDeg(15)} aria-label="Rotate block right">↻</button>
        <span class="sub">or drag the ↻ knob</span>
      </div>
      <div class="actions">
        <button class="btn btn-sm danger" onclick={removeGroup} title="or press Delete">
          <Icon name="trash" size={13} /> Remove {selectedGroup.length}
        </button>
      </div>
    </div>
  {/if}

  <div class="section">
    <div class="section-head"><span>Auto panorama</span></div>
    <p class="hint">
      Solves the layout from the overlapping imagery itself, then drops the pieces back on the
      canvas. You can still drag pieces to correct the result.
    </p>
    <div class="modes">
      {#each MODES as m (m.id)}
        <button class="mode" class:on={mode === m.id} onclick={() => (mode = m.id)} title={m.hint}>
          {m.label}
        </button>
      {/each}
    </div>
    <p class="hint sub-hint">{MODES.find((m) => m.id === mode).hint}</p>
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
    border-color: var(--border-strong);
    background: var(--bg-3);
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
  .ctab-input {
    width: 9em;
    font: inherit;
    font-size: var(--fs-xs);
    color: var(--text-1);
    background: var(--bg-0);
    border: none;
    padding: 4px 8px;
  }
  .ctab-input:focus {
    outline: none;
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
  .tray {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .thumb {
    position: relative;
    width: 60px;
    height: 60px;
    border-radius: var(--r-sm);
    overflow: hidden;
    border: 2px solid transparent;
    padding: 0;
  }
  .thumb.used {
    border-color: var(--border-strong);
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .num {
    position: absolute;
    top: 2px;
    left: 2px;
    min-width: 15px;
    height: 15px;
    padding: 0 3px;
    border-radius: 4px;
    background: rgba(10, 10, 10, 0.7);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    line-height: 15px;
    text-align: center;
  }
  .tag {
    position: absolute;
    bottom: 2px;
    right: 2px;
    background: var(--accent);
    color: var(--accent-text);
    border-radius: 4px;
    display: flex;
    padding: 1px;
  }
  .tag.count {
    padding: 0 4px;
    font-size: 10px;
    font-weight: 700;
    line-height: 15px;
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
  .sub-hint {
    margin-top: -2px;
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
