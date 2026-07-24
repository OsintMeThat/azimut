<script>
  import Icon from './Icon.svelte';

  let {
    value = $bindable(''),
    placeholder = 'Search…',
    count = null,
    width = '180px',
    onclear = () => {},
  } = $props();

  function clear() {
    value = '';
    onclear();
  }
</script>

<div class="search-box">
  <Icon name="search" size={13} />
  <input
    class="search-input"
    style:width
    {placeholder}
    bind:value
    aria-label={placeholder}
  />
  {#if count != null}<span class="search-count">{count}</span>{/if}
  {#if value}
    <button class="search-clear" onclick={clear} aria-label="Clear search">
      <Icon name="x" size={12} />
    </button>
  {/if}
</div>

<style>
  .search-box {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-3);
    flex-shrink: 0;
  }
  .search-box:focus-within {
    border-color: var(--accent);
  }
  .search-input {
    border: none;
    background: none;
    outline: none;
    color: var(--text-1);
    font-size: var(--fs-xs);
  }
  .search-count {
    font-size: var(--fs-xs);
    color: var(--text-3);
    white-space: nowrap;
  }
  .search-clear {
    display: inline-flex;
    color: var(--text-3);
    padding: 1px;
    border-radius: 50%;
  }
  .search-clear:hover {
    color: var(--text-1);
    background: var(--bg-3);
  }
</style>
