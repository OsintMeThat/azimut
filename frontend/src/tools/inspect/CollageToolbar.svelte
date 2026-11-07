<script>
  import { onDestroy, tick, untrack } from 'svelte';
  import { pinholeOps, stitchCanvas } from '../../lib/inspect.js';
  import { BRUSH_MAX, BRUSH_MIN, excludeRequest } from '../../lib/excludeBrush.js';
  import { LEVEL_MIN_POINTS } from '../../lib/straighten.js';
  import { cutOf, cutStart } from '../../lib/collageCut.js';
  import { stitchedWords } from '../../lib/leftOut.js';
  import { api } from '../../lib/api.js';
  import { caseState, toast } from '../../lib/state.svelte.js';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import Icon from '../../components/Icon.svelte';

  // The bar over the canvas, for what acts on the whole collage: Auto-stitch places
  // the pieces by the imagery they share, Ignore areas paints what it must not match
  // on, Straighten bends the collage along a level line, Cut frames the picture it
  // saves, and Fit shows the pieces whole. The piece in hand has its own block in the panel.
  // `level` is the line the canvas draws to straighten the collage by, `straighten` what
  // bends the collage along it; `view` is the canvas's zoom and pan, `fit` what fits it
  // to the pieces and `fitted` whether it does. `brush` is the canvas's brush, `{ on,
  // size, erase }`; `unstitched` the pieces the last stitch left where they were and why,
  // `{ id, why, mode }`. `cut` is the frame being drawn over the collage, `{ editing,
  // frame }` (lib/collageCut.js). `hold` makes the stitch one undo: it answers the release.
  let {
    collage: active, selectedIds = $bindable([]), renderPiece, level = $bindable(null), straighten = null,
    view = $bindable(), brush = $bindable(null), unstitched = $bindable([]), hold = null, fit = null,
    fitted = false, cut = $bindable(null),
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

  /** Run `work` on every item, `at` a time, as the canvas fills in when a collage opens. */
  async function inTurn(items, at, work) {
    const queue = [...items];
    const next = async () => {
      while (queue.length) await work(queue.shift());
    };
    await Promise.all(Array.from({ length: Math.min(at, queue.length) }, next));
  }

  async function autoStitch() {
    if (few) return;
    stitching = true;
    if (cut) cut.editing = false;
    // the whole stitch is one undo, however many steps its pieces come back in
    const release = hold?.();
    try {
      const nodes = active.nodes;
      const asked = mode;
      const before = { nodes: nodes.map(snapshot), width: active.width, height: active.height, clip: active.clip ?? null };
      const exclude = excludeRequest(nodes);
      const res = await api.post(`/api/cases/${caseState.current.id}/inspect/auto-stitch`, {
        width: active.width,
        height: active.height,
        mode,
        // frozen snapshot recipes (path/time/ops), stripped back to pinhole pixels
        nodes: nodes.map((n) => ({ ...n.save, ops: pinholeOps(n.save) })),
        // the areas painted out of a piece's matching, sent only when a piece has some
        ...(exclude ? { exclude } : {}),
      });
      // A stitch is solved in source pixels, so the canvas follows it: the answer
      // carries the size that keeps the pieces at full resolution, and the export
      // is the pieces' bounds, so a canvas left too small *is* the lost detail.
      // Pieces the solver could not place keep their place as it grows.
      applyCanvas(res.canvas, new Set(res.nodes.map((n) => n.index)));
      // a cut frames a layout, and the stitch lays the pieces out anew
      if (res.nodes.length) active.clip = null;
      // Every piece goes to its place at once; the ones a panorama warp reshapes are
      // drawn again three at a time, as a collage's pieces are when it opens.
      const redraw = [];
      for (const { index, quad, op } of res.nodes) {
        const node = nodes[index];
        const base = pinholeOps(node.save);
        const ops = op ? [...base, op] : base;
        // Planar leaves the pixels alone; only re-derive when the recipe moved
        // (a panorama warp arriving, or dropping off on the way back to planar).
        if (JSON.stringify(ops) !== JSON.stringify(node.save.ops ?? [])) redraw.push([node, ops]);
        node.quad = quad;
      }
      await inTurn(redraw, 3, ([node, ops]) => renderPiece(node, ops));
      undoSnap = before;
      // the pieces it could not place are outlined, saying why, and in hand for the arrows or a drag
      const left = res.dropped
        .map((i, k) => ({ id: nodes[i]?.id, why: res.why?.[k] ?? 'no-overlap', mode: asked }))
        .filter((piece) => piece.id);
      unstitched = left;
      selectedIds = left.map((piece) => piece.id);
      fit?.();
      // The undo rides on the message, and stays in the arrow's menu after it goes.
      const undo = { label: 'Undo', onClick: undoStitch };
      toast(stitchedWords(res.nodes.length, left.map((piece) => piece.why), asked), left.length ? 'warn' : 'ok', null, undo);
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      stitching = false;
      release?.();
    }
  }

  function undoStitch() {
    menuOpen = false;
    if (!undoSnap) return;
    unstitched = [];
    for (const snap of undoSnap.nodes) {
      const node = active.nodes.find((n) => n.id === snap.id);
      if (node) Object.assign(node, snap);
    }
    // The canvas moved with the stitch, so it comes back with it, and the cut it held.
    active.width = undoSnap.width;
    active.height = undoSnap.height;
    active.clip = undoSnap.clip;
    undoSnap = null;
  }

  // A message's Undo outliving this collage has nothing left to put back.
  onDestroy(() => (undoSnap = null));

  // ---- straighten -------------------------------------------------------------
  // A line the analyst says is level in the world bends the collage flat along it
  // (lib/straighten.js, the Collage tool's `straighten`): every piece is bent by the
  // same column shifts, so each frame bends with the line and the seams a stitch
  // matched stay matched. Find then reads the straightened collage's picture as one.
  let bending = $state(false);
  function toggleLevel() {
    level.drawing = !level.drawing;
    if (level.drawing) {
      selectedIds = [];
      if (brush) brush.on = false;
      if (cut) cut.editing = false;
    }
  }

  // ---- cut ----------------------------------------------------------------------
  // One frame over the whole collage, like a mat (lib/collageCut.js): the saved picture
  // keeps what lies inside it, and every piece stays whole on the canvas. The canvas
  // draws the frame and its handles while it is edited.
  function startCut() {
    cut.frame = cutStart(active.nodes, active.clip);
    cut.editing = !!cut.frame;
    selectedIds = [];
    if (brush) brush.on = false;
    if (level) level.drawing = false;
  }
  function applyCut() {
    active.clip = cutOf(cut.frame, active.nodes);
    cut.editing = false;
  }
  function clearCut() {
    active.clip = null;
    cut.editing = false;
  }

  // ---- the areas a stitch must not match on ----------------------------------
  // Painted on a piece over what moves or was laid over the picture: a person, a car,
  // a watermark (lib/excludeBrush.js). They stay with the collage, never in its picture.
  const target = $derived(
    selectedIds.length === 1 ? (active?.nodes.find((n) => n.id === selectedIds[0]) ?? null) : null,
  );
  function toggleBrush() {
    brush.on = !brush.on;
    if (brush.on && level) level.drawing = false;
    if (brush.on && cut) cut.editing = false;
    if (!brush.on) brush.erase = false;
  }
  function clearPiece() {
    if (target) target.exclude = [];
  }
  const sizeTitle = `Brush size, also [ and ]`;

  async function bend() {
    bending = true;
    try {
      await straighten();
    } finally {
      bending = false;
    }
  }

  const lineReady = $derived(!!level && level.points.length >= LEVEL_MIN_POINTS);


  // The bar keeps one line, so the canvas never moves: it starts with every word and, only
  // while it would wrap, lets go of them a step at a time. Tight, the projection's name and
  // Fit's word go; compact, the other tools show their icon alone too, each named on hover
  // and to a reader. Measured, not guessed, so a longer word or a larger font still fits.
  const ONE_LINE = 50;
  let barEl = $state(null);
  let barWidth = $state(0);
  let squeeze = $state(0);
  $effect(() => {
    void [barWidth, brush?.on, cut?.editing];
    const el = barEl;
    if (!el || !barWidth) return;
    untrack(async () => {
      squeeze = 0;
      await tick();
      while (el.offsetHeight > ONE_LINE && squeeze < 2) {
        squeeze += 1;
        await tick();
      }
    });
  });
</script>

<!-- Narrower than its tools (a laptop with the case sidebar open), the bar keeps one
     line: the secondary tools show their icon alone, named on hover and to a reader. -->
<div class="bar" class:tight={squeeze >= 1} class:compact={squeeze >= 2} role="toolbar" aria-label="Collage tools" bind:this={barEl} bind:clientWidth={barWidth}>
  <div class="split" role="group" aria-label="Auto-stitch" data-guide="collage.arrange">
    <button
      class="btn btn-sm press"
      disabled={stitching || few}
      onclick={autoStitch}
      title={few ? 'Add at least two overlapping pieces' : 'Stitch the pieces on this collage'}
    >
      <Icon name={stitching ? 'clock' : 'hash'} size={14} />
      <span>{stitching ? 'Stitching…' : 'Auto-stitch'}</span>
      <span class="mode minor">{modeLabel}</span>
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

  {#if brush}
    <div class="brush" role="group" aria-label="Ignore areas">
      <button
        class="btn btn-sm paint"
        class:on={brush.on}
        aria-pressed={brush.on}
        disabled={!active?.nodes.length}
        onclick={toggleBrush}
        title={brush.on ? 'Stop painting (Esc)' : 'Paint over what auto-stitch must not match on, such as people, vehicles or a watermark'}
        aria-label={brush.on ? 'Done' : 'Ignore areas'}
      >
        <Icon name={brush.on ? 'check' : 'brush'} size={13} />
        <span class="words">{brush.on ? 'Done' : 'Ignore areas'}</span>
      </button>
      {#if brush.on}
        <input
          class="size"
          type="range"
          min={BRUSH_MIN}
          max={BRUSH_MAX}
          step="2"
          bind:value={brush.size}
          aria-label="Brush size"
          title={sizeTitle}
        />
        <button
          class="btn btn-ghost btn-sm"
          class:on={brush.erase}
          aria-pressed={brush.erase}
          onclick={() => (brush.erase = !brush.erase)}
          title="Erase what was painted, also Alt while painting"
          aria-label="Erase"
        >
          <Icon name="eraser" size={13} /> <span class="words">Erase</span>
        </button>
        <button
          class="btn btn-ghost btn-sm"
          disabled={!target?.exclude?.length}
          onclick={clearPiece}
          title={target ? 'Take every painted area off this piece' : 'Select a piece first'}
        >
          Clear piece
        </button>
      {/if}
    </div>
  {/if}

  {#if level && !brush?.on && !cut?.editing}
    <span class="sep" aria-hidden="true"></span>
    <div class="straighten" role="group" aria-label="Straighten" data-guide="collage.straighten">
      <button
        class="btn btn-sm draw"
        class:on={level.drawing}
        disabled={!active || !active.nodes.length}
        onclick={toggleLevel}
        title={level.drawing ? 'Stop drawing the line (Esc)' : 'Draw the level line on the canvas'}
        aria-label={level.drawing ? 'Done' : level.points.length ? 'Draw more' : 'Draw the line'}
      >
        <Icon name="edit" size={13} />
        <span class="words">{level.drawing ? 'Done' : level.points.length ? 'Draw more' : 'Draw the line'}</span>
      </button>
      <button
        class="btn btn-sm"
        class:btn-primary={lineReady}
        disabled={!lineReady || bending || !straighten}
        onclick={bend}
        title={lineReady ? 'Bend every piece alike so the line lies flat' : 'Click two points or more along the line first'}
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

  {#if cut && !brush?.on}
    <span class="sep" aria-hidden="true"></span>
    <div class="cut" role="group" aria-label="Cut" data-guide="collage.cut">
      {#if cut.editing}
        <button class="btn btn-sm btn-primary" onclick={applyCut} title="Keep this frame for the saved picture (Enter)">
          <Icon name="check" size={13} /> Apply
        </button>
        <button class="btn btn-ghost btn-sm" onclick={() => (cut.editing = false)} title="Leave the cut as it was (Esc)">Cancel</button>
      {:else}
        <button
          class="btn btn-sm frame"
          class:on={!!active?.clip}
          aria-pressed={!!active?.clip}
          disabled={!active?.nodes.length}
          onclick={startCut}
          title={active?.clip ? 'Move the frame the saved picture is cut to' : 'Frame what the saved picture keeps, every piece staying whole'}
          aria-label="Cut"
        >
          <Icon name="scissors" size={13} /> <span class="words">Cut</span>
        </button>
      {/if}
      {#if active?.clip}
        <button class="btn btn-ghost btn-sm" onclick={clearCut} title="Save the whole collage again">Clear</button>
      {/if}
    </div>
  {/if}

  <!-- the view's own corner, at the right of the bar however it wraps -->
  <div class="view">
    {#if view && view.zoom !== 1}
      <span class="zoom" title="Zoom against the whole canvas in view">{Math.round(view.zoom * 100)}%</span>
    {/if}
    <button class="btn btn-ghost btn-sm" disabled={fitted || !fit} onclick={() => fit?.()} title="Show every piece whole" aria-label="Fit">
      <Icon name="maximize" size={14} /> <span class="minor">Fit</span>
    </button>
  </div>
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
  .bar.tight .minor,
  .bar.compact .words {
    display: none;
  }
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
  .straighten,
  .brush,
  .cut {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  /* The press and its arrow as one button: the same height, one hairline between. */
  .split {
    display: flex;
    align-items: stretch;
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
  /* Waiting for a second piece, the press dims its words, not its box, so the arrow
     still reads as part of it. */
  .press:disabled {
    opacity: 1;
    color: var(--text-3);
  }
  .split .btn:hover:not(:disabled) {
    position: relative;
    z-index: 1;
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
  /* Painting: the brush's own colour, as on the canvas. */
  .paint.on {
    border-color: var(--danger);
    color: var(--danger);
  }
  .brush .btn-ghost.on {
    background: var(--bg-3);
    color: var(--text-1);
  }
  .size {
    width: 84px;
    accent-color: var(--danger);
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
  /* Cut and kept: the frame's own colour, as the canvas draws it. */
  .frame.on {
    border-color: var(--accent);
    color: var(--accent);
  }
  .done {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: 2px;
    color: var(--ok);
    font-size: var(--fs-xs);
  }
  .view {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
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
