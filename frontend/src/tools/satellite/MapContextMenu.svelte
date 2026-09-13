<script>
  /**
   * The right-click menu: what can be done with the point under the cursor.
   *
   * It lives inside the map surface and is placed against it, so it travels
   * with a detached window and is hidden with the rest of the chrome during a
   * screen grab. The list and the placement are `lib/map/contextMenu.js`; the
   * acts are the tool's, reported through `onpick`.
   */
  import { onMount } from 'svelte';
  import Icon from '../../components/Icon.svelte';
  import { ACTIONS, copyRows, nextFocus, openRows, placeMenu } from '../../lib/map/contextMenu.js';

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
    /** `(id, value)`: `copy` with the text, or an action id from `ACTIONS`. */
    onpick,
    onclose,
  } = $props();

  let menuEl = $state();
  let width = $state(0);
  let height = $state(0);
  let linksOpen = $state(false);

  const copies = $derived(copyRows(at.lat, at.lon, format));
  const links = $derived(openRows(at.lat, at.lon, zoom));
  // Measured once drawn; until then a typical size keeps the first frame inside.
  const place = $derived(
    placeMenu(at, { width: width || 236, height: height || 320 }, frame)
  );

  function items() {
    return [...(menuEl?.querySelectorAll('[role="menuitem"]') ?? [])];
  }

  function onkeydown(event) {
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
      if (menuEl && !menuEl.contains(event.target)) onclose();
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

  {#each ACTIONS as action (action.id)}
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

  <button
    class="item"
    role="menuitem"
    aria-expanded={linksOpen}
    onclick={() => (linksOpen = !linksOpen)}
  >
    <Icon name="external" size={13} />
    <span>Open in…</span>
    <Icon name={linksOpen ? 'chevronDown' : 'chevronRight'} size={12} />
  </button>
  {#if linksOpen}
    <div class="links">
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
</div>

<style>
  .ctx {
    position: absolute;
    z-index: 800;
    min-width: 220px;
    max-width: 300px;
    padding: 4px;
    display: flex;
    flex-direction: column;
    background: rgba(24, 24, 24, 0.97);
    backdrop-filter: blur(6px);
    box-shadow: var(--shadow-2);
    outline: none;
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
  .links {
    display: flex;
    flex-direction: column;
    padding-left: 21px;
  }
  .link {
    font-size: var(--fs-xs);
  }
  .link[aria-disabled='true'] {
    color: var(--text-3);
    cursor: not-allowed;
  }
</style>
