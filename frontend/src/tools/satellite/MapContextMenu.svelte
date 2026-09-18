<script>
  /**
   * The right-click menu: what can be done with the point under the cursor.
   *
   * It lives inside the map surface and is placed against it, so it travels
   * with a detached window and is hidden with the rest of the chrome during a
   * screen grab. The list and the placement are `lib/map/contextMenu.js`; the
   * acts are the tool's, reported through `onpick`.
   */
  import { onMount, tick } from 'svelte';
  import Icon from '../../components/Icon.svelte';
  import {
    ACTIONS,
    copyRows,
    nextFocus,
    openRows,
    placeMenu,
    placeSubmenu,
  } from '../../lib/map/contextMenu.js';

  let {
    /** `{ lat, lon, x, y }`: the point, and where it was clicked in the map. */
    at,
    /** The map's own size, which the menu must stay inside. */
    frame = { width: 0, height: 0 },
    zoom = 17,
    /** The analyst's coordinate format, offered first. */
    format = 'dd',
    /** A link out would drop the map out of fullscreen, so links are greyed. */
    fullscreen = false,
    /** `{ busy, text, error }` once "What is here?" was asked. */
    lookup = null,
    /** The acts offered, in `ACTIONS` order; a tool passes the subset it has. */
    actions = ACTIONS,
    /** `(id, value)`: `copy` with the text, or an action id from `ACTIONS`. */
    onpick,
    onclose,
  } = $props();

  let menuEl = $state();
  let subEl = $state();
  let openRowEl = $state();
  let width = $state(0);
  let height = $state(0);
  let subWidth = $state(0);
  let subHeight = $state(0);
  let linksOpen = $state(false);

  const copies = $derived(copyRows(at.lat, at.lon, format));
  const links = $derived(openRows(at.lat, at.lon, zoom));

  /**
   * Placed once, from the real measurement, and then never again.
   *
   * Until it is measured a typical size keeps the first frame inside the map.
   * After that the answer is frozen: this used to be recomputed from the menu's
   * live height, so anything that made the menu taller — an answer coming back
   * from "What is here?", the external maps unfolding — slid the whole thing out
   * from under the cursor.
   */
  let fixed = $state(null);
  const place = $derived(
    fixed ?? placeMenu(at, { width: width || 236, height: height || 320 }, frame)
  );
  $effect(() => {
    if (!fixed && width && height) fixed = placeMenu(at, { width, height }, frame);
  });

  /**
   * The submenu's own box, in the same frame coordinates as the parent's.
   *
   * A sibling rather than a child: the parent scrolls when its content outgrows
   * the map, and an overflow that scrolls also clips, so a flyout drawn inside
   * it would be cut off at its edge. The two elements answer as one menu instead
   * — one outside-click, one arrow walk, one keyboard handler across both.
   */
  const sub = $derived(
    linksOpen
      ? placeSubmenu(
          {
            left: place.left,
            top: place.top,
            width: width || 236,
            rowTop: place.top + (openRowEl?.offsetTop ?? 0),
          },
          { width: subWidth || 168, height: subHeight || 300 },
          frame
        )
      : null
  );

  function items() {
    const rows = (element) => [...(element?.querySelectorAll('[role="menuitem"]') ?? [])];
    return [...rows(menuEl), ...rows(subEl)];
  }

  /** Open the external maps and step into them, as a submenu does. */
  async function openLinks() {
    linksOpen = true;
    await tick();
    subEl?.querySelector('[role="menuitem"]')?.focus();
  }

  function closeLinks() {
    linksOpen = false;
    openRowEl?.focus();
  }

  function onkeydown(event) {
    const inSub = Boolean(subEl?.contains(document.activeElement));
    if (event.key === 'ArrowRight' && document.activeElement === openRowEl) {
      event.preventDefault();
      openLinks();
      return;
    }
    if (event.key === 'ArrowLeft' && inSub) {
      event.preventDefault();
      closeLinks();
      return;
    }
    if (event.key === 'Escape' && linksOpen) {
      // the submenu is what Escape leaves first, as it is everywhere else
      event.preventDefault();
      event.stopPropagation();
      closeLinks();
      return;
    }
    const rows = items();
    const current = rows.indexOf(document.activeElement);
    const move = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (move) {
      event.preventDefault();
      const next = nextFocus(rows.length, current, move, (i) => rows[i].hasAttribute('disabled'));
      rows[next]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      (event.key === 'Home' ? rows[0] : rows.at(-1))?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onclose();
    } else if (event.key === 'Tab') {
      // a menu is left, not tabbed through
      onclose();
    }
  }

  onMount(() => {
    items()[0]?.focus();
    const outside = (event) => {
      const inside =
        menuEl?.contains(event.target) || subEl?.contains(event.target);
      if (menuEl && !inside) onclose();
    };
    document.addEventListener('mousedown', outside, true);
    return () => document.removeEventListener('mousedown', outside, true);
  });
</script>

<div
  class="ctx card"
  role="menu"
  tabindex="-1"
  aria-label="This point"
  bind:this={menuEl}
  bind:offsetWidth={width}
  bind:offsetHeight={height}
  style:left={`${place.left}px`}
  style:top={`${place.top}px`}
  {onkeydown}
  oncontextmenu={(event) => event.preventDefault()}
>
  {#each copies as row (row.id)}
    <button
      class="item copy"
      role="menuitem"
      title="Copy {row.format}"
      onclick={() => onpick('copy', row.text)}
    >
      <span class="fmt">{row.format}</span>
      <span class="mono coords">{row.text}</span>
      <Icon name="copy" size={12} />
    </button>
  {/each}

  <div class="rule" role="separator"></div>

  {#each actions as action (action.id)}
    <button class="item" role="menuitem" onclick={() => onpick(action.id)}>
      <Icon name={action.icon} size={13} />
      <span>{action.label}</span>
    </button>
    {#if action.id === 'lookup' && lookup}
      <p class="answer" class:dim={lookup.busy} class:warn={lookup.error} aria-live="polite">
        {lookup.busy ? 'Looking it up…' : (lookup.error ?? lookup.text)}
      </p>
    {/if}
  {/each}

  <div class="rule" role="separator"></div>

  <!-- A submenu, not a fold: the list opens beside the menu so the menu itself
       never changes size, and nothing the cursor is resting on moves. -->
  <button
    bind:this={openRowEl}
    class="item"
    class:open={linksOpen}
    role="menuitem"
    aria-haspopup="menu"
    aria-expanded={linksOpen}
    onclick={() => (linksOpen ? closeLinks() : openLinks())}
  >
    <Icon name="external" size={13} />
    <span>Open in…</span>
    <Icon name="chevronRight" size={12} />
  </button>
</div>

{#if sub}
  <div
    bind:this={subEl}
    bind:offsetWidth={subWidth}
    bind:offsetHeight={subHeight}
    class="ctx card sub"
    role="menu"
    tabindex="-1"
    aria-label="Open this point in"
    style:left={`${sub.left}px`}
    style:top={`${sub.top}px`}
    {onkeydown}
    oncontextmenu={(event) => event.preventDefault()}
  >
    {#each links as link (link.id)}
      <a
        class="item link"
        role="menuitem"
        href={fullscreen ? undefined : link.url}
        target="_blank"
        rel="noreferrer"
        aria-disabled={fullscreen}
        title={fullscreen ? 'Exit fullscreen first. This leaves the map' : link.url}
        onclick={() => !fullscreen && onclose()}
      >{link.label}</a>
    {/each}
  </div>
{/if}

<style>
  .ctx {
    position: absolute;
    z-index: 800;
    min-width: 220px;
    max-width: 300px;
    /* Bounded by the map it opens in, so content arriving late — the answer to
       "What is here?" — scrolls inside a menu that stays where it was put,
       rather than growing past the frame and having to be moved. */
    max-height: calc(100% - 16px);
    overflow-y: auto;
    padding: 4px;
    display: flex;
    flex-direction: column;
    background: rgba(24, 24, 24, 0.97);
    backdrop-filter: blur(6px);
    box-shadow: var(--shadow-2);
    outline: none;
  }
  /* A sibling of the menu, placed against the same frame. One notch above it,
     and therefore above the status bar the menu already outranks — a submenu
     hanging off a low row would otherwise have its last entries covered by the
     bar floating at the bottom of the map. */
  .sub {
    z-index: 801;
    min-width: 150px;
    max-height: none;
  }
  .item.open {
    background: var(--bg-3);
    color: var(--text-1);
  }
  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 8px;
    border-radius: var(--radius-1);
    font-size: var(--fs-sm);
    color: var(--text-2);
    text-align: left;
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
  }
  .item > span:not(.fmt) {
    flex: 1;
  }
  .item:hover,
  .item:focus-visible {
    background: var(--bg-3);
    color: var(--text-1);
    outline: none;
  }
  .fmt {
    min-width: 34px;
    font-size: 10px;
    color: var(--text-3);
  }
  .coords {
    font-size: var(--fs-xs);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rule {
    height: 1px;
    margin: 4px 6px;
    background: var(--border);
  }
  .answer {
    margin: 0 8px 4px 29px;
    font-size: var(--fs-xs);
    line-height: 1.35;
    color: var(--text-1);
    white-space: normal;
  }
  .answer.dim {
    color: var(--text-3);
  }
  .answer.warn {
    color: var(--warn, #e2a03f);
  }
  .link {
    font-size: var(--fs-xs);
  }
  .link[aria-disabled='true'] {
    color: var(--text-3);
    cursor: not-allowed;
  }
</style>
