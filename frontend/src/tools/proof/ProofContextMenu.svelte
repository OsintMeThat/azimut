<script>
  /**
   * The canvas's own right-click menu. The composer is a drawing surface, not a
   * web page, so a right-click answers with what can be done to what is under
   * the pointer — its stacking, a copy, its removal — instead of the browser's
   * Back, Reload and Inspect.
   *
   * `menu` is `{ x, y, title, items }`; an item is `{ label, icon, keys, run,
   * disabled, danger }`, or the string `'sep'` for a rule between groups.
   */
  import Icon from '../../components/Icon.svelte';

  let { menu = null, onclose = () => {} } = $props();

  let el = $state();

  // Kept on screen: a menu opened near the right or bottom edge flips back in.
  const place = $derived.by(() => {
    if (!menu) return { left: 0, top: 0 };
    const width = 232;
    const height = 12 + menu.items.reduce((h, item) => h + (item === 'sep' ? 11 : 30), 0) + (menu.title ? 24 : 0);
    const left = Math.min(menu.x, window.innerWidth - width - 8);
    const top = Math.min(menu.y, window.innerHeight - height - 8);
    return { left: Math.max(8, left), top: Math.max(8, top) };
  });

  $effect(() => {
    if (menu && el) el.focus();
  });

  function run(item) {
    if (item.disabled) return;
    onclose();
    item.run();
  }
</script>

{#if menu}
  <div
    class="menu-backdrop"
    role="presentation"
    onpointerdown={onclose}
    oncontextmenu={(e) => { e.preventDefault(); onclose(); }}
  ></div>
  <div
    class="menu card"
    role="menu"
    tabindex="-1"
    bind:this={el}
    style:left={`${place.left}px`}
    style:top={`${place.top}px`}
    oncontextmenu={(e) => e.preventDefault()}
    onkeydown={(e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onclose(); }
    }}
  >
    {#if menu.title}<div class="menu-head">{menu.title}</div>{/if}
    {#each menu.items as item, i (i)}
      {#if item === 'sep'}
        <div class="menu-sep"></div>
      {:else}
        <button
          class="menu-item"
          class:danger={item.danger}
          role="menuitem"
          disabled={item.disabled}
          onclick={() => run(item)}
        >
          {#if item.icon}<Icon name={item.icon} size={14} />{:else}<span class="no-icon"></span>{/if}
          <span class="menu-label">{item.label}</span>
          {#if item.keys}<span class="menu-keys">{item.keys}</span>{/if}
        </button>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .menu-backdrop { position: fixed; inset: 0; z-index: 940; }
  .menu {
    position: fixed;
    z-index: 950;
    width: 232px;
    padding: 6px;
    box-shadow: var(--shadow-2);
    outline: none;
  }
  .menu-head {
    margin: 2px 4px 6px;
    color: var(--text-3);
    font-size: var(--fs-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text-1);
    font: inherit;
    font-size: var(--fs-sm);
    text-align: left;
    cursor: pointer;
  }
  .menu-item:hover:not(:disabled) { background: var(--bg-2); }
  .menu-item:disabled { color: var(--text-3); cursor: default; }
  .menu-item > :global(svg) { color: var(--text-3); flex-shrink: 0; }
  .menu-item.danger { color: var(--danger, #e5484d); }
  .menu-item.danger > :global(svg) { color: inherit; }
  .no-icon { width: 14px; flex-shrink: 0; }
  .menu-label { flex: 1; }
  .menu-keys { color: var(--text-3); font-size: var(--fs-xs); white-space: nowrap; }
  .menu-sep { height: 1px; margin: 5px 2px; background: var(--border); }
</style>
