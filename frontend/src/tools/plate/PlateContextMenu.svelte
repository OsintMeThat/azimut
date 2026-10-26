<script>
  /**
   * The plate's right-click menu: what can be done to what is under the pointer, an
   * element of the page or of the list, or the page itself, instead of the browser's
   * Back and Reload. Every item is a shortcut to something the inspector, the list or
   * a key already does.
   *
   * `menu` is `{ at: { x, y }, title, items }`; an item is `{ label, icon, keys, title,
   * run, disabled, danger }`, or `'sep'` for a rule between groups.
   */
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import Icon from '../../components/Icon.svelte';

  let { menu = null, onclose = () => {} } = $props();

  function run(item) {
    if (item.disabled) return;
    onclose();
    item.run();
  }
</script>

{#if menu}
  <FloatingMenu at={menu.at} width={236} label={menu.title || 'The plate'} onclose={onclose}>
    {#if menu.title}<div class="fm-head">{menu.title}</div>{/if}
    {#each menu.items as item, index (index)}
      {#if item === 'sep'}
        <div class="fm-sep" role="separator"></div>
      {:else}
        <button type="button" class="fm-item" class:danger={item.danger} role="menuitem" disabled={item.disabled} title={item.title}
          onclick={() => run(item)}>
          <Icon name={item.icon ?? 'square'} size={14} /><span class="fm-grow">{item.label}</span>
          {#if item.keys}<span class="keys">{item.keys}</span>{/if}
        </button>
      {/if}
    {/each}
  </FloatingMenu>
{/if}

<style>
  .keys { flex: none; color: var(--text-3); font-size: 11px; }
</style>
