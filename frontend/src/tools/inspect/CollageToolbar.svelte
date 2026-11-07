<script>
  import { onDestroy } from 'svelte';
  import { pinholeOps, stitchCanvas } from '../../lib/inspect.js';
  import { LEVEL_MIN_POINTS } from '../../lib/straighten.js';
  import { api } from '../../lib/api.js';
  import { caseState, toast } from '../../lib/state.svelte.js';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import Icon from '../../components/Icon.svelte';

  // The bar over the canvas, for what acts on the whole collage: Auto-stitch places
  // the pieces by the imagery they share, Straighten bends the collage along a level
  // line, and Fit puts the view back. The piece in hand has its own block in the panel.
  // `level` is the line the canvas draws to straighten the collage by, `straighten` what
  // bends the collage along it; `view` is the canvas's zoom and pan.
  let {
    collage: active, selectedIds = $bindable([]), renderPiece, level = $bindable(null), straighten = null,
    view = $bindable(),
  } = $props();

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
  // The projection picked last, kept in this browser for the next stitch.
  const MODE_KEY = 'azimut:collageStitch';
  function storedMode() {
    try {
      const kept = localStorage.getItem(MODE_KEY);
      return MODES.some((m) => m.id === kept) ? kept : 'cylindrical';
    } catch {
      return 'cylindrical';
    }
  }
  let mode = $state(storedMode());
  const modeLabel = $derived(MODES.find((m) => m.id === mode).label);
  let stitching = $state(false);
  let undoSnap = $state(null);
  let menuOpen = $state(false);
  let arrow = $state(null);
  const few = $derived(!active || active.nodes.length < 2);

  function pickMode(id) {
    mode = id;
    menuOpen = false;
    try {
      localStorage.setItem(MODE_KEY, id);
    } catch {
      /* a private window keeps it for this visit only */
    }
  }

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
    if (few) return;
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
      // The undo rides on the message, and stays in the arrow's menu after it goes.
      const undo = { label: 'Undo', onClick: undoStitch };
      if (res.dropped.length) {
        toast(`Stitched ${placed}. ${res.dropped.length} left in place because no overlap was found`, 'warn', null, undo);
      } else {
        toast(`Stitched ${placed} pieces`, 'ok', null, undo);
      }
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      stitching = false;
    }
  }

  function undoStitch() {
    menuOpen = false;
    if (!undoSnap) return;
    for (const snap of undoSnap.nodes) {
      const node = active.nodes.find((n) => n.id === snap.id);
      if (node) Object.assign(node, snap);
    }
    // The canvas moved with the stitch, so it comes back with it.
    active.width = undoSnap.width;
    active.height = undoSnap.height;
    undoSnap = null;
  }

  // A message's Undo outliving this collage has nothing left to put back.
  onDestroy(() => (undoSnap = null));

  // ---- straighten -------------------------------------------------------------
  // A line the analyst says is level in the world bends the whole collage flat along
  // it as one picture (lib/straighten.js, the Collage tool's `straighten`): every
  // column of pixels moves alike, so each frame bends with the line and the seams a
  // stitch matched stay matched. Find then reads the straightened picture as one.
  let bending = $state(false);
  function toggleLevel() {
    level.drawing = !level.drawing;
    if (level.drawing) selectedIds = [];
  }

  async function bend() {
    bending = true;
    try {
      await straighten();
    } finally {
      bending = false;
    }
  }

  const lineReady = $derived(!!level && level.points.length >= LEVEL_MIN_POINTS);

  // ---- the view ---------------------------------------------------------------
  const fitted = $derived(!view || (view.zoom === 1 && view.x === 0 && view.y === 0));
  function fit() {
    Object.assign(view, { zoom: 1, x: 0, y: 0 });
  }
</script>

<div class="bar" role="toolbar" aria-label="Collage tools">
  <div class="split" role="group" aria-label="Auto-stitch" data-guide="collage.arrange">
    <button
      class="btn btn-sm press"
      disabled={stitching || few}
      onclick={autoStitch}
      title={few ? 'Add at least two overlapping pieces' : 'Stitch the pieces on this collage'}
    >
      <Icon name={stitching ? 'clock' : 'hash'} size={14} />
      <span>{stitching ? 'Stitching…' : 'Auto-stitch'}</span>
      <span class="mode">{modeLabel}</span>
    </button>
    <button
      class="btn btn-sm more"
      bind:this={arrow}
      onclick={() => (menuOpen = !menuOpen)}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      aria-label="More ways to stitch"
      title="Pick the projection"
    >
      <Icon name="chevronDown" size={13} />
    </button>
  </div>

  <span class="sep" aria-hidden="true"></span>

  {#if level}
    <div class="straighten" role="group" aria-label="Straighten" data-guide="collage.straighten">
      <button
        class="btn btn-sm draw"
        class:on={level.drawing}
        disabled={!active || !active.nodes.length}
        onclick={toggleLevel}
        title={level.drawing ? 'Stop drawing the line (Esc)' : 'Draw the level line on the canvas'}
      >
        <Icon name="edit" size={13} />
        {level.drawing ? 'Done' : level.points.length ? 'Draw more' : 'Draw the line'}
      </button>
      <button
        class="btn btn-sm"
        class:btn-primary={lineReady}
        disabled={!lineReady || bending || !straighten}
        onclick={bend}
        title={lineReady ? 'Bend the whole collage as one picture so the line lies flat' : 'Click two points or more along the line first'}
      >
        {bending ? 'Straightening…' : 'Straighten'}
      </button>
      {#if level.points.length}
        <button class="btn btn-ghost btn-sm" onclick={() => (level.points = [])} title="Take the line away">Clear</button>
      {/if}
      {#if active?.straightened}
        <span class="done" title="Bent flat along a level line; Ctrl+Z puts the pieces back"><Icon name="check" size={12} /> straightened</span>
      {/if}
    </div>
  {/if}

  <span class="grow"></span>

  {#if view && view.zoom !== 1}
    <span class="zoom" title="Zoom against the fitted view">{Math.round(view.zoom * 100)}%</span>
  {/if}
  <button class="btn btn-ghost btn-sm" disabled={fitted} onclick={fit} title="Fit the collage back in view">
    <Icon name="eye" size={14} /> Fit
  </button>
</div>

{#if menuOpen}
  <FloatingMenu anchor={arrow} width={280} label="Auto-stitch" onclose={() => (menuOpen = false)}>
    <p class="fm-head">Projection</p>
    {#each MODES as m (m.id)}
      <button class="fm-item mode-item" role="menuitemradio" aria-checked={mode === m.id} onclick={() => pickMode(m.id)}>
        <span class="tick">{#if mode === m.id}<Icon name="check" size={13} />{/if}</span>
        <span class="mode-text">
          <span class="mode-name">{m.label}</span>
          <span class="mode-hint">{m.hint}</span>
        </span>
      </button>
    {/each}
    {#if undoSnap}
      <div class="fm-sep"></div>
      <button class="fm-item" role="menuitem" onclick={undoStitch}>
        <Icon name="reset" size={13} />
        <span class="fm-grow">Undo auto-stitch</span>
      </button>
    {/if}
  </FloatingMenu>
{/if}

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    padding: 7px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-1);
    flex-wrap: wrap;
  }
  .split,
  .straighten {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .split {
    gap: 0;
  }
  .press {
    gap: 6px;
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
  .press :global(svg) {
    color: var(--accent);
  }
  .press:disabled :global(svg) {
    color: inherit;
  }
  .mode {
    padding-left: 6px;
    border-left: 1px solid var(--border);
    color: var(--text-3);
    font-weight: 400;
  }
  .more {
    width: 26px;
    justify-content: center;
    padding-left: 0;
    padding-right: 0;
    margin-left: -1px;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }
  .more[aria-expanded='true'] {
    color: var(--accent);
  }
  .sep {
    width: 1px;
    height: 20px;
    margin: 0 6px;
    background: var(--border);
  }
  /* The line's own colour, while it is drawn, as on the canvas. */
  .draw.on {
    border-color: #ffcc00;
    color: #ffcc00;
  }
  :global([data-theme='light']) .draw.on {
    border-color: #b58f00;
    color: #8a6d00;
  }
  .done {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: 2px;
    color: var(--ok);
    font-size: var(--fs-xs);
  }
  .grow {
    flex: 1;
  }
  .zoom {
    color: var(--text-2);
    font-size: var(--fs-xs);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .mode-item {
    align-items: flex-start;
  }
  .tick {
    flex: none;
    width: 14px;
    padding-top: 2px;
    color: var(--accent);
  }
  .mode-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .mode-name {
    color: var(--text-1);
    font-size: var(--fs-sm);
  }
  .mode-hint {
    color: var(--text-3);
    font-size: 11px;
    line-height: 1.35;
    white-space: normal;
  }
</style>
