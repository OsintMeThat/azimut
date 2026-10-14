<script>
  /**
   * The edit tools of a personal layer, on the map they work on.
   *
   * Everything done to features is here: picking, drawing, adding, styling,
   * reshaping, merging, cutting, removing. What a feature *says* stays in the
   * panel beside the map. The bar names what a press on the map does in one
   * line beside it, which the analyst can switch off.
   *
   * It moves: dragged by its grip, it docks on the edge it is let go near,
   * upright on the sides, and keeps clear of the zoom buttons and the panel
   * (`lib/map/editBarPlace.js`). Double-clicking the grip puts it back.
   */
  import Icon from '../../components/Icon.svelte';
  import LayerSelectionStyle from './LayerSelectionStyle.svelte';
  import { mergeable, splittable } from '../../lib/map/layerHit.js';
  import { DEFAULT_PLACE, barBox, loadPlace, loadTips, savePlace, saveTips, snapPlace, upright } from '../../lib/map/editBarPlace.js';
  import { momentLabel } from '../../lib/map/layerHistory.js';

  let { controller, vertex = null, ondone } = $props();
  const selection = $derived(controller.selection ?? []);
  const chosen = $derived(controller.features.filter((feature) => selection.includes(feature.properties.key)));
  const busy = $derived(controller.pending > 0 || controller.loading);
  const sketch = $derived(controller.sketch);
  const selecting = $derived(!controller.placing && !sketch && !controller.lassoing);
  /** A line being reshaped cuts at the corner last touched, never at its two ends. */
  const cut = $derived(sketch?.key && sketch.type === 'LineString' && vertex !== null
    && vertex > 0 && vertex < sketch.rings[0].length - 1 ? vertex : null);
  const canSplit = $derived(cut !== null || (chosen.length === 1 && splittable(chosen[0])));
  /** A marker is moved by dragging it; a line or an area is reshaped corner by corner. */
  const reshapable = $derived(chosen.length === 1 && !chosen[0].properties.entity_id
    && ['LineString', 'Polygon', 'MultiLineString', 'MultiPolygon'].includes(chosen[0].geometry.type));
  const onePoint = $derived(chosen.length === 1 && chosen[0].geometry.type === 'Point');
  /** A tracked layer read at a moment: what an edit does then, said and switched on the bar. */
  const tracked = $derived(!!controller.editor?.track?.on);
  const cursor = $derived(controller.cursor);
  /** `12 Oct`, or `12 Oct 14:00`: the year is in the panel. */
  const short = $derived(cursor ? momentLabel(cursor).replace(/ \d{4}/, '').replace(' · ', ' ') : '');
  const hint = $derived(controller.lassoing ? 'Draw round what to select. Shift adds to the selection.'
    : controller.placing ? 'Click the map to add markers in the style shown. Esc to stop.'
      : sketch?.type === 'Selection' ? 'Drag the handle to move the selection. Enter to save, Esc to cancel.'
        : sketch?.key ? 'Drag a corner to move it, + to add one. Enter to save, Esc to cancel.'
          : sketch ? 'Click to add points. Enter to save, Esc to cancel.'
            : onePoint ? 'Drag to move. Turn the ring to set where it faces.'
              : selection.length ? 'Drag to move. Shift-click adds. Right-click for more.'
                : 'Click a feature to select it, drag to move it. Right-click for more.');

  let place = $state(loadPlace());
  let tips = $state(loadTips());
  let dock = $state(null);
  let frameEl = $state(null);
  let frame = $state({ width: 0, height: 0 });
  let width = $state(0);
  let height = $state(0);
  let obstacles = $state.raw([]);
  /** The bar's box while its grip is held: it follows the pointer, docking only when let go. */
  let held = $state(null);
  const vertical = $derived(upright(place));
  const box = $derived(held ?? (frame.width && width ? barBox(frame, { width, height }, place, obstacles) : null));
  /** The tips go where there is room: beside an upright bar, under one in the top half. */
  const side = $derived(place.edge === 'left' ? 'right' : place.edge === 'right' ? 'left'
    : box && box.top > frame.height / 2 ? 'above' : 'below');

  async function split() {
    if (cut !== null) {
      const key = sketch.key;
      if (controller.complete && !(await controller.saveGeometry())) return;
      await controller.split(key, cut);
    } else if (chosen.length === 1) await controller.split(chosen[0].properties.key);
  }

  /** What the bar steps aside from: the map's zoom buttons and the layer's panel, which both ask for it. */
  function measure() {
    if (!frameEl) return;
    frame = { width: frameEl.clientWidth, height: frameEl.clientHeight };
    const root = frameEl.getBoundingClientRect();
    obstacles = [...document.querySelectorAll('[data-bar-obstacle]')]
      .map((node) => node.getBoundingClientRect())
      .filter((rect) => rect.width && rect.height && rect.right > root.left && rect.left < root.right
        && rect.bottom > root.top && rect.top < root.bottom)
      .map((rect) => ({ left: rect.left - root.left, top: rect.top - root.top, right: rect.right - root.left, bottom: rect.bottom - root.top }));
  }
  $effect(() => {
    frameEl = dock?.offsetParent ?? null;
    if (!frameEl) return;
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure());
    observer?.observe(frameEl);
    for (const node of document.querySelectorAll('[data-bar-obstacle]')) observer?.observe(node);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  });
  // The panel beside the map grows and shrinks with what is selected.
  $effect(() => { void selection.length; void controller.selected; void controller.loading; void vertical; requestAnimationFrame?.(measure); });

  function settle(next) {
    place = next;
    savePlace(next);
  }
  function grab(event) {
    if (event.button !== 0 || !box) return;
    event.preventDefault(); event.stopPropagation();
    const start = { x: event.clientX, y: event.clientY, left: box.left, top: box.top };
    const clamp = (value, high) => Math.max(0, Math.min(value, high));
    let moved = false;
    const move = (event) => {
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      held = { left: clamp(start.left + dx, frame.width - width), top: clamp(start.top + dy, frame.height - height), width, height };
    };
    const end = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end);
      if (moved && held) settle(snapPlace(frame, held));
      held = null;
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
  }
  /** Arrows move the bar a step at a time, docking on an edge as a drop would. */
  function nudge(event) {
    const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (!steps[event.key] || !box) return;
    event.preventDefault();
    const [dx, dy] = steps[event.key];
    settle(snapPlace(frame, { ...box, left: box.left + dx * 48, top: box.top + dy * 48 }));
  }
</script>

<div class="edit-dock" bind:this={dock} class:vertical class:placed={!!box} class:held={!!held}
  style:left={box ? `${box.left}px` : null} style:top={box ? `${box.top}px` : null}>
  <div class="edit-bar" role="toolbar" aria-label="Layer tools" aria-orientation={vertical ? 'vertical' : 'horizontal'}
    bind:offsetWidth={width} bind:offsetHeight={height}>
    <button type="button" class="grip" aria-label="Move the tool bar" title="Drag to move it. Double-click puts it back."
      onpointerdown={grab} ondblclick={() => settle({ ...DEFAULT_PLACE })} onkeydown={nudge}><Icon name="grip" size={14} stroke={2.5} /></button>
    {#if !vertical}
      <span class="layer" title={controller.editor.title}><Icon name="stack" size={12} /><span class="title">{controller.editor.title}</span></span>
    {/if}
    {#if tracked}
      <span class="rule" aria-hidden="true"></span>
      {#if cursor === null}
        <span class="when" title="Edits correct what each feature is now. Move the layer's day to date a change.">Now</span>
      {:else}
        <span class="when-mode" role="group" aria-label={`Edits on ${momentLabel(cursor)}`}>
          <button type="button" class="mode" aria-pressed={controller.timeMode === 'new'} title={`Start a state on ${momentLabel(cursor)}`}
            onclick={() => (controller.timeMode = 'new')}><Icon name="clock" size={12} />{#if !vertical}<span>{short}</span>{/if}</button>
          <button type="button" class="mode" aria-pressed={controller.timeMode === 'fix'} title="Correct the state in force then"
            onclick={() => (controller.timeMode = 'fix')}>{vertical ? 'F' : 'Fix'}</button>
        </span>
      {/if}
    {/if}
    <span class="rule" aria-hidden="true"></span>
    <button type="button" aria-label="Select" title="Select and move" aria-pressed={selecting} disabled={busy}
      onclick={() => controller.stop()}><Icon name="cursor" size={15} /></button>
    <button type="button" aria-label="Select an area" title="Select an area" aria-pressed={controller.lassoing} disabled={busy}
      onclick={() => (controller.lassoing ? controller.stop() : controller.lasso())}><Icon name="lasso" size={15} /></button>
    <span class="rule" aria-hidden="true"></span>
    <button type="button" aria-label="Add markers" title="Add markers" aria-pressed={controller.placing} disabled={busy}
      onclick={() => (controller.placing ? controller.stop() : controller.start())}><Icon name="pin" size={15} /></button>
    <button type="button" aria-label="Draw line" title="Draw a line" aria-pressed={sketch?.type === 'LineString' && !sketch.key} disabled={busy}
      onclick={() => controller.startShape('LineString')}><Icon name="line" size={15} /></button>
    <button type="button" aria-label="Draw area" title="Draw an area" aria-pressed={sketch?.type === 'Polygon' && !sketch.key} disabled={busy}
      onclick={() => controller.startShape('Polygon')}><Icon name="polygon" size={15} /></button>
    <button type="button" aria-label="Paste a position" title="Paste coordinates, a map link or a post" disabled={busy}
      onclick={() => controller.openPaste()}><Icon name="clipboard" size={15} /></button>
    <button type="button" aria-label="Add from the case" title="Add places, proofs and files of the case" disabled={busy}
      onclick={() => controller.openLinking()}><Icon name="link" size={15} /></button>
    <span class="rule" aria-hidden="true"></span>
    <LayerSelectionStyle {controller} label="Style" disabled={busy || (!!sketch && sketch.type !== 'Selection')} />
    {#if sketch}
      <span class="rule" aria-hidden="true"></span>
      {#if !sketch.key}<button type="button" aria-label="Undo last point" title="Undo last point" disabled={busy || !sketch.rings[0]?.length}
        onclick={() => controller.undoVertex()}><Icon name="undo" size={15} /></button>{/if}
      <button type="button" class="save" aria-label="Save geometry" title="Save (Enter)" disabled={busy || !controller.complete}
        onclick={() => controller.saveGeometry()}><Icon name="check" size={13} />{#if !vertical}<span>Save</span>{/if}</button>
      <button type="button" aria-label="Cancel geometry edit" title="Cancel (Esc)" onclick={() => controller.stop()}><Icon name="x" size={15} /></button>
    {/if}
    {#if selection.length || cut !== null}
      <span class="rule" aria-hidden="true"></span>
      {#if reshapable && !sketch}
        <button type="button" aria-label="Reshape" title="Move its corners (or double-click it on the map)" disabled={busy}
          onclick={() => controller.editGeometry()}><Icon name="edit" size={15} /></button>
      {/if}
      <button type="button" aria-label="Merge" title="Make the selected lines, or areas, one feature"
        disabled={busy || !mergeable(chosen)} onclick={() => controller.merge()}><Icon name="merge" size={15} /></button>
      <button type="button" aria-label={cut !== null ? 'Cut the line here' : 'Split'} title={cut !== null ? 'Cut the line at this corner' : 'Make each part its own feature'}
        disabled={busy || !canSplit} onclick={split}><Icon name="scissors" size={15} /></button>
      <button type="button" class="danger" aria-label="Remove selected" title="Remove from the layer"
        disabled={busy || !selection.length} onclick={() => controller.removeSelection()}><Icon name="trash" size={15} /></button>
    {/if}
    <span class="rule" aria-hidden="true"></span>
    <button type="button" class="tips" aria-label="Tips" title={tips ? 'Hide the tips' : 'Show the tips'} aria-pressed={tips}
      onclick={() => { tips = !tips; saveTips(tips); }}><Icon name="help" size={14} /></button>
    <!-- As the panel's Done: the press leaves the focus in a field Done saves itself. -->
    <button type="button" class="done" aria-label="Done" title="Done editing this layer" disabled={busy || (sketch && !controller.complete)}
      onmousedown={(event) => event.preventDefault()} onclick={ondone}>
      <Icon name="check" size={13} />{#if !vertical}<span>Done</span>{/if}</button>
  </div>
  {#if tips || busy}<p class={`hint ${side}`} role="status">{busy ? 'Saving…' : hint}</p>{/if}
</div>

<style>
  /* Centred at the top until the map is measured, then wherever it was put. */
  .edit-dock { position: absolute; top: 58px; left: 50%; transform: translateX(-50%); z-index: 30; display: flex; flex-direction: column;
    max-width: calc(100% - 24px); max-height: calc(100% - 24px); pointer-events: none; }
  .edit-dock.placed { transform: none; }
  /* On a map too small for it, the bar scrolls rather than spilling off the map. */
  .edit-bar { display: flex; align-items: center; gap: 2px; min-width: 0; min-height: 0; padding: 4px; overflow: auto; scrollbar-width: none;
    background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--r-sm); box-shadow: var(--shadow-2); pointer-events: auto; white-space: nowrap; }
  .vertical .edit-bar { flex-direction: column; }
  .held .edit-bar { box-shadow: 0 8px 28px #0006; opacity: .92; }
  .grip { cursor: grab; color: var(--text-3); width: 20px; }
  .vertical .grip { width: 30px; height: 20px; }
  .held .grip { cursor: grabbing; }
  .layer { display: flex; align-items: center; gap: 5px; flex: none; padding: 0 6px 0 2px; color: var(--text-2); font-size: var(--fs-xs); }
  .title { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .layer :global(svg) { flex: none; color: var(--text-3); }
  .when { flex: none; padding: 0 6px; color: var(--text-3); font-size: var(--fs-xs); }
  .when-mode { display: flex; flex: none; gap: 1px; padding: 1px; border: 1px solid var(--border); border-radius: var(--r-sm); }
  .vertical .when-mode { flex-direction: column; }
  .mode { display: flex; gap: 4px; width: auto; min-width: 26px; height: 26px; padding: 0 7px; font-size: var(--fs-xs); font-variant-numeric: tabular-nums; }
  .rule { width: 1px; height: 20px; margin: 0 3px; background: var(--border); flex: none; }
  .vertical .rule { width: 20px; height: 1px; margin: 3px 0; }
  button { display: grid; place-items: center; flex: none; width: 30px; height: 30px; border-radius: var(--r-sm); color: var(--text-2); cursor: pointer; }
  button:hover:not(:disabled) { background: var(--bg-3); color: var(--text-1); }
  button[aria-pressed='true'] { background: var(--accent-soft); color: var(--accent); }
  .tips[aria-pressed='true'] { background: none; color: var(--text-2); }
  button.danger:hover:not(:disabled) { color: var(--danger); }
  button:disabled { opacity: .4; cursor: default; }
  .save { display: flex; gap: 4px; width: auto; min-width: 30px; padding: 0 9px; border: 1px solid var(--accent); color: var(--accent); font-size: var(--fs-xs); font-weight: 600; }
  .done { display: flex; gap: 5px; width: auto; min-width: 30px; padding: 0 10px; background: var(--accent); color: var(--accent-text); font-size: var(--fs-xs); font-weight: 600; }
  .vertical .save, .vertical .done { padding: 0; justify-content: center; }
  .done:hover:not(:disabled) { background: var(--accent-hover); color: var(--accent-text); }
  .hint { position: absolute; margin: 0; padding: 3px 9px; border-radius: 999px; background: rgba(0, 0, 0, .62); color: #fff; font-size: 11px; pointer-events: none; white-space: nowrap; }
  .hint.below { top: calc(100% + 5px); left: 50%; transform: translateX(-50%); }
  .hint.above { bottom: calc(100% + 5px); left: 50%; transform: translateX(-50%); }
  .hint.right { top: 4px; left: calc(100% + 6px); }
  .hint.left { top: 4px; right: calc(100% + 6px); }
</style>
