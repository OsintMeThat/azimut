<script>
  /**
   * A menu, or a small panel of settings, floating over the page: under what
   * opened it, or at the pointer for a right-click.
   *
   * Portalled out of every panel, since a menu opened inside a scrolling one is
   * cut by it, and kept whole inside the window (`lib/floatingPlace.js`). A press
   * outside it or Escape closes it; a press on its opener is left to the opener,
   * which closes it by toggling.
   *
   * Items take the `fm-*` classes styled here, so every floating menu reads the
   * same: `fm-item` (a row, `danger` for one that removes), `fm-head`, `fm-sep`
   * and `fm-note`. A `column` menu lays its parts out top to bottom and lets the
   * part that scrolls of its own give way, the rest staying in view.
   */
  import { portal } from '../lib/fullscreen.js';
  import { placeFloating } from '../lib/floatingPlace.js';

  let { anchor = null, at = null, width = 220, align = 'start', label, role = 'menu', column = false, onclose, children } = $props();
  let node = $state(null);
  let place = $state({ left: -9999, top: -9999, maxHeight: 480 });

  function reposition() {
    if (!node) return;
    place = placeFloating({ anchor: anchor?.getBoundingClientRect?.() ?? null, at, align,
      size: { width: node.offsetWidth || width, height: node.offsetHeight },
      viewport: { width: window.innerWidth, height: window.innerHeight } });
  }

  $effect(() => {
    if (!node) return;
    void at; void anchor;
    reposition();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reposition);
    observer?.observe(node);
    // A press in another floating menu is one this menu opened (the style
    // picker inside a right-click menu): it stays open under it.
    const press = (event) => {
      const target = event.target;
      if (node.contains(target) || anchor?.contains?.(target) || target?.closest?.('.float-menu')) return;
      onclose?.();
    };
    const key = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopImmediatePropagation();
      onclose?.();
      anchor?.focus?.();
    };
    // The panel under an opener scrolls: the menu goes with the opener.
    const scroll = (event) => { if (!node.contains(event.target)) reposition(); };
    window.addEventListener('pointerdown', press, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', scroll, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('pointerdown', press, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', scroll, true);
    };
  });
</script>

<div class="float-menu" class:column {role} aria-label={label} tabindex="-1" bind:this={node} use:portal
  style:left={`${place.left}px`} style:top={`${place.top}px`} style:width={`${width}px`} style:max-height={`${place.maxHeight}px`}>
  {@render children?.()}
</div>

<style>
  /* Above the map's own controls and above a modal (900), as the other floating menus. */
  .float-menu { position: fixed; z-index: 950; overflow-y: auto; padding: 5px; background: var(--bg-1); border: 1px solid var(--border);
    border-radius: var(--r-sm); box-shadow: var(--shadow-2); color: var(--text-1); font-size: var(--fs-xs); outline: none; }
  /* a flex item keeps its content's height unless it scrolls: the scrolling part is the one that gives */
  .float-menu.column { display: flex; flex-direction: column; }
  .float-menu :global(.fm-item) { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 28px; padding: 5px 8px;
    border-radius: var(--r-sm); color: var(--text-1); font-size: var(--fs-sm); text-align: left; cursor: pointer; }
  .float-menu :global(.fm-item:hover:not(:disabled)), .float-menu :global(.fm-item:focus-visible) { background: var(--bg-3); }
  .float-menu :global(.fm-item:disabled) { color: var(--text-3); cursor: default; }
  .float-menu :global(.fm-item > svg) { flex: none; color: var(--text-3); }
  .float-menu :global(.fm-item.danger) { color: var(--danger, #e5484d); }
  .float-menu :global(.fm-item.danger > svg) { color: inherit; }
  .float-menu :global(.fm-item .fm-grow) { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .float-menu :global(.fm-item .fm-tick) { flex: none; color: var(--accent); }
  .float-menu :global(.fm-head) { margin: 3px 8px 4px; color: var(--text-3); font-size: 10px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
  .float-menu :global(.fm-sep) { height: 1px; margin: 4px 2px; background: var(--border); }
  .float-menu :global(.fm-note) { margin: 4px 8px 6px; color: var(--text-3); font-size: 11px; line-height: 1.4; }
</style>
