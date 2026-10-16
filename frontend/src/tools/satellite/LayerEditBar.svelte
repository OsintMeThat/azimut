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
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import MonthGrid from '../../components/MonthGrid.svelte';
  import LayerSelectionStyle from './LayerSelectionStyle.svelte';
  import { mergeable, splittable } from '../../lib/map/layerHit.js';
  import { DEFAULT_PLACE, barBox, loadPlace, loadTips, rowRoom, savePlace, saveTips, snapPlace, upright } from '../../lib/map/editBarPlace.js';
  import { momentLabel, momentNow } from '../../lib/map/layerHistory.js';

  let { controller, vertex = null, ondone } = $props();
  const selection = $derived(controller.selection ?? []);
  const chosen = $derived(controller.features.filter((feature) => selection.includes(feature.properties.key)));
  // Saves queue behind each other, so the bar never waits on one: only opening the layer holds it.
  const busy = $derived(controller.loading);
  const saving = $derived(controller.pending > 0);
  const sketch = $derived(controller.sketch);
  const selecting = $derived(!controller.placing && !sketch && !controller.lassoing);
  /** A line being reshaped cuts at the corner last touched, never at its two ends. */
  const cut = $derived(sketch?.key && sketch.type === 'LineString' && vertex !== null
    && vertex > 0 && vertex < sketch.rings[0].length - 1 ? vertex : null);
  const canSplit = $derived(cut !== null || (chosen.length === 1 && splittable(chosen[0])));
  /** A marker is moved by dragging it; a line or an area is reshaped corner by corner. */
  const reshapable = $derived(chosen.length === 1 && !chosen[0].properties.entity_id
    && ['LineString', 'Polygon', 'MultiLineString', 'MultiPolygon'].includes(chosen[0].geometry.type));
  /** While edits carry no date, the day a picked line or area moved on holds its shape. */
  const heldAt = $derived(reshapable ? controller.dateHolds?.(chosen[0].properties.key) ?? '' : '');
  /** On a layer followed over time, a picked shape not on the map on the day shown keeps its days until they are changed. */
  const away = $derived(reshapable && chosen[0].properties.$absent ? controller.cursor : null);
  const onePoint = $derived(chosen.length === 1 && chosen[0].geometry.type === 'Point');
  /**
   * A tracked layer: what the next edit is dated to, said and switched on the bar.
   * From a day, today until another is picked, what is drawn appears then and what
   * is changed changes from then; with no date, what is drawn shows on every day.
   */
  const tracked = $derived(!!controller.editor?.track?.on);
  const cursor = $derived(controller.cursor);
  const dated = $derived(cursor !== null && controller.timeMode === 'new');
  /** `12 Oct`, or `12 Oct 14:00`: the year is in the panel. */
  const short = $derived(cursor ? momentLabel(cursor).replace(/ \d{4}/, '').replace(' · ', ' ') : '');
  /** Today on the layer's clock: no change is dated after it. */
  const today = $derived(momentNow({ zone: controller.editor?.track?.zone }));
  /** The calendar a day is picked from, under the bar's day button. */
  let picking = $state(false);
  let dayButton = $state(null);
  function pickDay() {
    // a press on the day while edits carry no date dates them again; on the day itself it opens the month
    if (!dated) controller.timeMode = 'new';
    else picking = !picking;
  }
  const hint = $derived(controller.lassoing ? 'Draw round what to select. Shift adds to the selection.'
    : controller.placing ? 'Click the map to add markers in the style shown. Esc to stop.'
      : sketch?.type === 'Selection' ? 'Drag the handle to move the selection. Enter to save, Esc to cancel.'
        : sketch?.shape ? (sketch.anchor ? 'Click again where it ends, or press Enter.' : sketch.shape === 'circle' ? 'Click the centre, then how far it reaches.' : 'Click one corner, then the opposite one.')
          : sketch?.key && sketch.type === 'LineString' ? `Drag a corner, + to add one, a click on the map extends it from its ${sketch.extend === 'start' ? 'start' : 'end'}. Enter to save.`
            : sketch?.key ? 'Drag a corner to move it, + to add one. Ctrl+Z takes a step back. Enter to save, Esc to cancel.'
              : sketch && controller.freehand ? 'Drag to draw, as many strokes as it takes. Enter to save, Esc to cancel.'
                : sketch ? 'Click to add points; a corner near another lands on it, Alt lets it go. Enter or a double click saves, Ctrl+Z steps back.'
                  : onePoint ? 'Drag to move. Turn the ring to set where it faces.'
                    : selection.length ? 'Drag what is picked to move it. Shift-click adds. Ctrl+Z undoes, Ctrl+Shift+Z redoes.'
                      : 'Click to pick. A marker drags at once, a line or an area once picked. Right-click for more.');
  /** The style palette is open over the map: the tips step aside rather than hide under it. */
  let styling = $state(false);
  /**
   * Upright on a map too short for it, the bar folds into two columns rather than run
   * off the map: `rows` is how many each column holds, 0 while one column fits.
   */
  let barEl = $state(null);
  let rows = $state(0);
  /** What the bar adds round its buttons (padding, gaps), read while it stands in one column. */
  let overhead = 30;
  /** Lying along a map too narrow for it, the bar wraps onto two lines, `wrap` its width then. */
  let wrap = $state(0);
  function fold() {
    if (barEl && !upright(place) && frame.width) {
      rows = 0;
      const items = [...barEl.children];
      const long = items.reduce((sum, node) => sum + node.offsetWidth + 2, 12);
      const room = rowRoom(frame, place, obstacles, Math.max(0, ...items.map((node) => node.offsetHeight)) + 10);
      wrap = long > room ? Math.ceil(Math.min(room, long / 2 + 40)) : 0;
      return;
    }
    wrap = 0;
    if (!barEl || !upright(place) || !frame.height) { rows = 0; return; }
    const items = [...barEl.children];
    const tall = items.reduce((sum, node) => sum + node.offsetHeight, 0);
    if (!rows) overhead = Math.max(0, barEl.offsetHeight - tall);
    // the room along its edge, between what sits above it (the zoom buttons) and below it
    const column = place.edge === 'left' ? [12, 12 + width] : [frame.width - 12 - width, frame.width - 12];
    const across = obstacles.filter((other) => other.left < column[1] && other.right > column[0]);
    const top = across.filter((other) => other.top < frame.height / 2).reduce((most, other) => Math.max(most, other.bottom + 8), 12);
    const bottom = across.filter((other) => other.top >= frame.height / 2).reduce((least, other) => Math.min(least, other.top - 8), frame.height - 12);
    rows = tall + overhead > bottom - top ? Math.ceil(items.length / 2) : 0;
  }

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
  /** How wide the tips can run on the side they show, so a narrow map wraps them rather than cuts them. */
  const hintRoom = $derived(!box || !frame.width ? 420 : side === 'right' ? frame.width - box.left - width - 18
    : side === 'left' ? box.left - 18 : frame.width - 24);

  async function split() {
    if (cut !== null) {
      const key = sketch.key;
      if (controller.complete && !(await controller.saveGeometry())) return;
      await controller.split(key, cut);
    } else if (chosen.length === 1) await controller.split(chosen[0].properties.key);
  }

  /** What the bar steps aside from: the map's zoom buttons, its place search and the layer's panel, which all ask for it. */
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
  // What the bar holds changes with what is drawn and picked: it folds again.
  $effect(() => { void vertical; void frame.height; void frame.width; void obstacles; void sketch; void selection.length; void tracked; requestAnimationFrame?.(fold); });

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

<div class="edit-dock" bind:this={dock} class:vertical class:two={vertical && rows > 0} class:wrapped={!vertical && wrap > 0} class:placed={!!box} class:held={!!held}
  style:left={box ? `${box.left}px` : null} style:top={box ? `${box.top}px` : null} style:--rows={rows || null} style:--wrap={wrap ? `${wrap}px` : null}>
  <div class="edit-bar" role="toolbar" aria-label="Layer tools" aria-orientation={vertical ? 'vertical' : 'horizontal'}
    bind:this={barEl} bind:offsetWidth={width} bind:offsetHeight={height}>
    <button type="button" class="grip" aria-label="Move the tool bar" title="Drag to move it. Double-click puts it back."
      onpointerdown={grab} ondblclick={() => settle({ ...DEFAULT_PLACE })} onkeydown={nudge}><Icon name="grip" size={14} stroke={2.5} /></button>
    {#if !vertical}
      <span class="layer" title={controller.editor.title}><Icon name="stack" size={12} /><span class="title">{controller.editor.title}</span></span>
    {/if}
    {#if tracked}
      <span class="rule" aria-hidden="true"></span>
      <!-- the mode on says what it does in words; the other is its icon, named by its tip -->
      <span class="when-mode" role="group" aria-label="What your edits are dated to">
        <button type="button" class="mode" aria-pressed={dated} aria-expanded={picking} bind:this={dayButton}
          aria-label={`From ${momentLabel(cursor)}`}
          title={dated ? `What you draw appears on ${momentLabel(cursor)}, what you change changes from then. Press for another day`
            : `Date your edits from ${momentLabel(cursor)}`}
          onclick={pickDay}><Icon name="calendar" size={12} />{#if !vertical && dated}<span>From {short}</span>{/if}</button>
        <button type="button" class="mode" aria-pressed={!dated} aria-label="No date"
          title="What you draw or change counts on every day; what moved on a day moves from a day"
          onclick={() => { picking = false; controller.timeMode = 'fix'; }}><Icon name="always" size={13} />{#if !vertical && !dated}<span>No date</span>{/if}</button>
      </span>
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
      onclick={() => (sketch?.type === 'LineString' && !sketch.key ? controller.stop() : controller.startShape('LineString'))}><Icon name="line" size={15} /></button>
    <button type="button" aria-label="Draw area" title="Draw an area" aria-pressed={sketch?.type === 'Polygon' && !sketch.key && !sketch.shape} disabled={busy}
      onclick={() => (sketch?.type === 'Polygon' && !sketch.key && !sketch.shape ? controller.stop() : controller.startShape('Polygon'))}><Icon name="polygon" size={15} /></button>
    <button type="button" aria-label="Draw a circle" title="A circle: its centre, then its reach" aria-pressed={sketch?.shape === 'circle'} disabled={busy}
      onclick={() => (sketch?.shape === 'circle' ? controller.stop() : controller.startShape('Circle'))}><Icon name="circle" size={15} /></button>
    <button type="button" aria-label="Draw a box" title="A box: one corner, then the other" aria-pressed={sketch?.shape === 'rect'} disabled={busy}
      onclick={() => (sketch?.shape === 'rect' ? controller.stop() : controller.startShape('Rectangle'))}><Icon name="square" size={15} /></button>
    <button type="button" aria-label="Paste a position" title="Paste coordinates, a map link or a post" disabled={busy}
      onclick={() => controller.openPaste()}><Icon name="clipboard" size={15} /></button>
    <button type="button" aria-label="Add from the case" title="Add places, proofs and files of the case" disabled={busy}
      onclick={() => controller.openLinking()}><Icon name="link" size={15} /></button>
    <span class="rule" aria-hidden="true"></span>
    <LayerSelectionStyle {controller} label="Style" disabled={busy || (!!sketch && sketch.type !== 'Selection')} onopen={(open) => (styling = open)} />
    {#if sketch}
      <span class="rule" aria-hidden="true"></span>
      {#if !sketch.key && !sketch.shape && ['LineString', 'Polygon'].includes(sketch.type)}
        <button type="button" aria-label="Draw freehand" title="Freehand: drag to draw" aria-pressed={controller.freehand}
          onclick={() => (controller.freehand = !controller.freehand)}><Icon name="freehand" size={15} /></button>
      {/if}
      {#if sketch.key && sketch.type === 'LineString'}
        <button type="button" aria-label="Extend from its start" title="A click on the map extends it from its start" aria-pressed={sketch.extend === 'start'}
          onclick={() => controller.extendFrom('start')}><Icon name="chevronLeft" size={15} /></button>
        <button type="button" aria-label="Extend from its end" title="A click on the map extends it from its end" aria-pressed={sketch.extend !== 'start'}
          onclick={() => controller.extendFrom('end')}><Icon name="chevronRight" size={15} /></button>
      {/if}
      <button type="button" aria-label="Undo the last corner change" title="Undo the last corner added, moved or removed (Ctrl+Z)"
        disabled={busy || !controller.canUndoSketch} onclick={() => controller.undoSketch()}><Icon name="undo" size={15} /></button>
      <button type="button" aria-label="Redo the corner change" title="Redo (Ctrl+Shift+Z)"
        disabled={busy || !controller.canRedoSketch} onclick={() => controller.redoSketch()}><Icon name="redo" size={15} /></button>
      <button type="button" class="save" aria-label="Save geometry" title="Save (Enter)" disabled={busy || !controller.complete}
        onclick={() => controller.saveGeometry()}><Icon name="check" size={13} />{#if !vertical}<span>Save</span>{/if}</button>
      <button type="button" aria-label="Cancel geometry edit" title="Cancel (Esc)" onclick={() => controller.stop()}><Icon name="x" size={15} /></button>
    {/if}
    {#if selection.length || cut !== null}
      <span class="rule" aria-hidden="true"></span>
      {#if reshapable && !sketch}
        <button type="button" aria-label="Reshape" disabled={busy || !!heldAt || !!away}
          title={away ? `Not on the map on ${momentLabel(away)}: change its days first` : heldAt ? `Moved on ${momentLabel(heldAt)}: pick a day to reshape it`
            : 'Move its corners (or double-click it on the map)'}
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
    {#if !sketch}
      <button type="button" aria-label="Undo the last edit" title="Undo the last edit (Ctrl+Z)" disabled={!controller.canUndo} onclick={() => controller.undo()}><Icon name="undo" size={15} /></button>
      <button type="button" aria-label="Redo the last edit" title="Redo (Ctrl+Shift+Z)" disabled={!controller.canRedo} onclick={() => controller.redo()}><Icon name="redo" size={15} /></button>
      <span class="rule" aria-hidden="true"></span>
    {/if}
    <button type="button" class="tips" aria-label="Tips" title={tips ? 'Hide the tips' : 'Show the tips'} aria-pressed={tips}
      onclick={() => { tips = !tips; saveTips(tips); }}><Icon name="help" size={14} /></button>
    <!-- As the panel's Done: the press leaves the focus in a field Done saves itself. -->
    <button type="button" class="done" aria-label="Done" title="Done editing this layer" disabled={busy || (sketch && !controller.complete)}
      onmousedown={(event) => event.preventDefault()} onclick={ondone}>
      <Icon name="check" size={13} />{#if !vertical}<span>Done</span>{/if}</button>
  </div>
  {#if (tips || busy || saving) && !styling}<p class={`hint ${side}`} role="status" style:--hint-room={`${Math.max(160, Math.round(hintRoom))}px`}>{busy ? 'Opening…' : saving && !tips ? 'Saving…' : hint}</p>{/if}
</div>

{#if picking && tracked}
  <FloatingMenu anchor={dayButton} width={248} label="Date your edits from" onclose={() => (picking = false)}>
    <p class="fm-head">Date your edits from</p>
    <!-- a change is what was seen, so no day after today -->
    <MonthGrid value={cursor ? cursor.slice(0, 10) : ''} max={today} label="Day your edits start from"
      onpick={(iso) => { picking = false; if (iso) controller.changeOn(iso); }} />
    <p class="fm-note">The layer shows that day too.</p>
  </FloatingMenu>
{/if}

<style>
  /* Centred at the top until the map is measured, then wherever it was put. */
  .edit-dock { position: absolute; top: 58px; left: 50%; transform: translateX(-50%); z-index: 30; display: flex; flex-direction: column;
    max-width: calc(100% - 24px); max-height: calc(100% - 24px); pointer-events: none; }
  .edit-dock.placed { transform: none; }
  /* On a map too small for it, the bar scrolls rather than spilling off the map. */
  .edit-bar { display: flex; align-items: center; gap: 2px; min-width: 0; min-height: 0; padding: 4px; overflow: auto; scrollbar-width: none;
    background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--r-sm); box-shadow: var(--shadow-2); pointer-events: auto; white-space: nowrap; }
  .vertical .edit-bar { flex-direction: column; }
  .wrapped .edit-bar { flex-wrap: wrap; justify-content: center; width: var(--wrap); overflow: visible; }
  .vertical.two .edit-bar { display: grid; grid-auto-flow: column; grid-template-rows: repeat(var(--rows), auto); justify-items: center; column-gap: 2px; }
  .held .edit-bar { box-shadow: 0 8px 28px #0006; opacity: .92; }
  .grip { cursor: grab; color: var(--text-3); width: 20px; }
  .vertical .grip { width: 30px; height: 20px; }
  .held .grip { cursor: grabbing; }
  .layer { display: flex; align-items: center; gap: 5px; flex: none; padding: 0 6px 0 2px; color: var(--text-2); font-size: var(--fs-xs); }
  .title { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .layer :global(svg) { flex: none; color: var(--text-3); }
  .when-mode { display: flex; flex: none; gap: 1px; padding: 1px; border: 1px solid var(--border); border-radius: var(--r-sm); }
  .vertical .when-mode { flex-direction: column; }
  .mode { display: flex; gap: 5px; width: auto; min-width: 26px; height: 26px; padding: 0 8px; font-size: var(--fs-xs); font-variant-numeric: tabular-nums;
    transition: background-color .12s, color .12s; }
  .vertical .mode { padding: 0; justify-content: center; }
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
  /* one line where the map has room for it, wrapped on a narrow one rather than cut by its edge */
  .hint { position: absolute; width: max-content; max-width: min(420px, var(--hint-room, 420px)); margin: 0; padding: 3px 9px; border-radius: 11px; background: rgba(0, 0, 0, .62);
    color: #fff; font-size: 11px; line-height: 1.45; pointer-events: none; }
  .hint.below { top: calc(100% + 5px); left: 50%; transform: translateX(-50%); }
  .hint.above { bottom: calc(100% + 5px); left: 50%; transform: translateX(-50%); }
  .hint.right { top: 4px; left: calc(100% + 6px); }
  .hint.left { top: 4px; right: calc(100% + 6px); }
</style>
