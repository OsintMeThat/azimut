<script>
  /**
   * A window over a map, the analyst's to place: dragged by its title bar,
   * resized from its sides and lower corners, kept whole inside the map, and
   * put back where it was left the next time it opens (`lib/floatingWindow.js`).
   *
   * It floats in its parent element, which has to be positioned (the map's own
   * wrapper is). Map captures hide everything painted over the map, so a window
   * never ends up in one.
   *
   * A `foldable` window folds down to its title bar, by its chevron or a double
   * click on the bar, and opens folded again if it was left so: what the title
   * bar says stays in sight while the map gets its room back.
   */
  import { onMount, untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import { dragWindow, fitWindow, resizeWindow, savedFold, saveFold, savedWindow, saveWindow } from '../lib/floatingWindow.js';

  let {
    /** Names the window to the browser's memory of where it was left. */
    id,
    title,
    icon = null,
    /** Where it opens the first time, from the map's `{ w, h }`. */
    placement = (bounds) => ({ x: 12, y: bounds.h - 300, w: Math.min(820, bounds.w - 24), h: 240 }),
    min = { w: 360, h: 180 },
    /** Whether it folds down to its title bar. */
    foldable = false,
    onclose = () => {},
    /** What sits in the title bar beside the title. */
    header,
    children,
  } = $props();

  let element = $state();
  let rect = $state({ x: 12, y: 12, w: 400, h: 220 });
  let placed = $state(false);
  // the id names the window for good: read once, as the rectangle is
  let folded = $state(untrack(() => foldable && savedFold(id)));

  function fold() {
    folded = !folded;
    saveFold(id, folded);
  }

  function foldFromBar(event) {
    if (!foldable || event.target.closest('button, input, select, a')) return;
    fold();
  }

  function bounds() {
    const box = element?.parentElement?.getBoundingClientRect();
    return { w: box?.width ?? window.innerWidth, h: box?.height ?? window.innerHeight };
  }

  onMount(() => {
    rect = fitWindow(savedWindow(id) ?? placement(bounds()), bounds(), min);
    placed = true;
    // the map changes size with the window and the side panel: stay inside it
    const parent = element.parentElement;
    const watch = new ResizeObserver(() => (rect = fitWindow(rect, bounds(), min)));
    if (parent) watch.observe(parent);
    return () => watch.disconnect();
  });

  /** Track a pointer from a press to its release, applying each move. */
  function follow(event, apply) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const start = { ...rect };
    const from = { x: event.clientX, y: event.clientY };
    const move = (moved) => (rect = apply(start, moved.clientX - from.x, moved.clientY - from.y));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      saveWindow(id, rect);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function startMove(event) {
    // the title bar's own controls stay controls
    if (event.target.closest('button, input, select, a')) return;
    follow(event, (start, dx, dy) => dragWindow(start, dx, dy, bounds(), min));
  }

  function startResize(event, edge) {
    follow(event, (start, dx, dy) => resizeWindow(start, edge, dx, dy, bounds(), min));
  }
</script>

<section
  bind:this={element}
  class="floating card"
  class:placed
  class:folded
  style:left={`${rect.x}px`}
  style:top={`${rect.y}px`}
  style:width={`${rect.w}px`}
  style:height={folded ? 'auto' : `${rect.h}px`}
  aria-label={title}
>
  <!-- a drag handle for the pointer; the window's acts are its own buttons -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header onpointerdown={startMove} ondblclick={foldFromBar} title={foldable ? 'Drag to move, double-click to fold' : 'Drag to move'}>
    <h3>
      {#if icon}<Icon name={icon} size={13} />{/if}
      {title}
    </h3>
    {@render header?.()}
    {#if foldable}
      <button
        class="btn btn-ghost btn-icon fold"
        onclick={fold}
        title={folded ? 'Unfold' : 'Fold to the title bar'}
        aria-label={folded ? `Unfold ${title}` : `Fold ${title}`}
        aria-expanded={!folded}
      >
        <Icon name={folded ? 'chevronDown' : 'chevronUp'} size={14} />
      </button>
    {/if}
    <button class="btn btn-ghost btn-icon close" onclick={onclose} title="Close" aria-label={`Close ${title}`}>
      <Icon name="x" size={14} />
    </button>
  </header>
  {#if !folded}
    <div class="body">
      {@render children?.()}
    </div>
  {/if}
  <span class="edge e" onpointerdown={(event) => startResize(event, 'e')} aria-hidden="true"></span>
  <span class="edge s" onpointerdown={(event) => startResize(event, 's')} aria-hidden="true"></span>
  <span class="edge w" onpointerdown={(event) => startResize(event, 'w')} aria-hidden="true"></span>
  <span class="corner se" onpointerdown={(event) => startResize(event, 'se')} title="Drag to resize" aria-hidden="true"></span>
  <span class="corner sw" onpointerdown={(event) => startResize(event, 'sw')} aria-hidden="true"></span>
</section>

<style>
  .floating {
    position: absolute;
    /* over the rail and its tool panel (1100), under the search's suggestions (1150) */
    z-index: 1120;
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: 0;
    background: rgba(18, 18, 18, 0.94);
    backdrop-filter: blur(8px);
    box-shadow: var(--shadow-2), 0 0 0 1px var(--border);
    overflow: hidden;
    visibility: hidden;
  }
  /* placed once the map's size is known, so it never flashes at the corner */
  .floating.placed {
    visibility: visible;
  }
  header {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
    padding: 7px 8px 6px 12px;
    border-bottom: 1px solid var(--border);
    cursor: grab;
    user-select: none;
    touch-action: none;
  }
  header:active {
    cursor: grabbing;
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-1);
    white-space: nowrap;
  }
  .fold {
    margin-left: auto;
    cursor: pointer;
  }
  .fold + .close {
    margin-left: 0;
  }
  .close {
    margin-left: auto;
    cursor: pointer;
  }
  /* folded to its title bar: nothing to resize */
  .folded header {
    border-bottom: 0;
  }
  .folded .edge,
  .folded .corner {
    display: none;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 6px 10px 8px;
  }
  .edge,
  .corner {
    position: absolute;
    touch-action: none;
  }
  .edge.e {
    top: 0;
    right: 0;
    bottom: 12px;
    width: 6px;
    cursor: ew-resize;
  }
  .edge.w {
    top: 0;
    left: 0;
    bottom: 12px;
    width: 6px;
    cursor: ew-resize;
  }
  .edge.s {
    left: 12px;
    right: 12px;
    bottom: 0;
    height: 6px;
    cursor: ns-resize;
  }
  .corner {
    bottom: 0;
    width: 14px;
    height: 14px;
  }
  .corner.se {
    right: 0;
    cursor: nwse-resize;
    background: linear-gradient(135deg, transparent 50%, rgba(255, 255, 255, 0.28) 50%, transparent 62%,
      rgba(255, 255, 255, 0.28) 62%, transparent 74%);
  }
  .corner.sw {
    left: 0;
    cursor: nesw-resize;
  }
</style>
