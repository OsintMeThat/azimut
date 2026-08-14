<script>
  /**
   * What can be asked of one column of a sheet.
   *
   * Its own component because the heading of a grid is the most crowded control in
   * the app — a name to sort by, a name to rename, a width to drag, a place to
   * freeze, three ways to filter and two ways to disappear — and folding all of that
   * into the cell that draws the heading is how a grid becomes unreadable.
   *
   * It owns no rules. Every answer it gives is a call back up with the column and the
   * choice; `lib/sheet.js` is where a filter or a freeze actually means something.
   */
  import Icon from './Icon.svelte';
  import { ID_COLUMN, columnValues, normalizeFilter } from '../lib/sheet.js';

  let {
    table,
    meta,
    column,
    filter = null,
    onrename,
    ondrop,
    onhide,
    onfreeze,
    onvalue,
    onfill,
    onwithout,
    onclose,
  } = $props();

  /** Values are offered only while a column reads as a set of answers rather than as
   *  prose. Past the bound `columnValues` enforces there is nothing to list, and the
   *  other two questions are the ones that still work. */
  const values = $derived(columnValues(table, column.name));
  const current = $derived(normalizeFilter(filter) ?? { values: null, fill: null, without: '' });
  const isKey = $derived(String(column.name).toLowerCase() === ID_COLUMN);
  const frozen = $derived(meta?.frozen === column.name);

  let without = $state('');
  $effect(() => {
    without = normalizeFilter(filter)?.without ?? '';
  });
</script>

<div class="head-menu">
  <input class="input" value={column.name} aria-label="Column name"
         onkeydown={(event) => {
           if (event.key === 'Enter') { onrename(event.currentTarget.value); onclose(); }
           if (event.key === 'Escape') onclose();
         }}
         onblur={(event) => onrename(event.currentTarget.value)} />

  {#if isKey}
    <p class="menu-note">The row's handle. Colours and links hang on it.</p>
  {:else}
    <div class="menu-group">
      <button class="menu-row" class:on={current.fill === 'filled'}
              onclick={() => onfill('filled')}>
        <Icon name="check" size={12} /> Only the filled rows
      </button>
      <button class="menu-row" class:on={current.fill === 'blank'}
              onclick={() => onfill('blank')}>
        <Icon name="x" size={12} /> Only the empty ones
      </button>
    </div>

    <label class="without">
      <span>Without</span>
      <input class="input" placeholder="a word this column must not hold"
             bind:value={without}
             onkeydown={(event) => event.key === 'Enter' && onwithout(without)}
             onblur={() => onwithout(without)} />
    </label>

    {#if values}
      <div class="menu-group values">
        {#each values as entry (entry.value)}
          <button class="menu-row" onclick={() => onvalue(entry.value)}>
            <input type="checkbox" checked={current.values?.has(entry.value) ?? false} tabindex="-1" />
            <span>{entry.value || '(blank)'}</span>
            <small>{entry.count}</small>
          </button>
        {/each}
      </div>
    {:else}
      <p class="menu-note">Too many different values to list. The two above still work.</p>
    {/if}

    <div class="menu-group">
      <button class="menu-row" class:on={frozen} onclick={() => onfreeze(column.name)}>
        <Icon name="pushpin" size={12} /> {frozen ? 'Let this column scroll' : 'Keep this column in view'}
      </button>
      <button class="menu-row" onclick={onhide}>
        <Icon name="eyeOff" size={12} /> Hide this column
      </button>
      <button class="menu-row danger" onclick={ondrop}>
        <Icon name="trash" size={12} /> Delete this column
      </button>
    </div>
  {/if}
</div>

<style>
  .head-menu {
    position: absolute; z-index: 9; top: 100%; left: 0; width: 244px;
    max-height: 420px; overflow: auto; padding: 6px; font-weight: 400;
    border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-1); box-shadow: 0 12px 30px #0004;
  }
  .head-menu > :global(.input) { margin-bottom: 5px; }
  .menu-group { border-top: 1px solid var(--border); padding-top: 4px; margin-top: 4px; }
  .menu-group.values { max-height: 200px; overflow: auto; }
  .menu-row {
    display: flex; align-items: center; gap: 7px; width: 100%; padding: 6px 7px;
    border-radius: var(--r-sm); color: var(--text-2); text-align: left; font-size: var(--fs-sm);
  }
  .menu-row:hover { background: var(--bg-2); color: var(--text-1); }
  .menu-row.on { color: var(--accent); }
  .menu-row.danger:hover { background: var(--danger-soft); color: var(--danger); }
  .menu-row span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .menu-row small { color: var(--text-3); font-size: var(--fs-xs); }
  .menu-note { padding: 6px 7px; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.5; }
  .without {
    display: block; padding: 4px 7px 2px;
    border-top: 1px solid var(--border); margin-top: 4px;
  }
  .without span { display: block; color: var(--text-3); font-size: var(--fs-xs); margin-bottom: 3px; }
</style>
