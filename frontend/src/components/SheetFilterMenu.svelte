<script>
  /**
   * What is asked of one column, in a menu that hangs off its heading.
   *
   * The second of the two doors a heading has, and the one that gets used all day. It
   * was behind the same `...` as the role editor, the note, the seven actions and the
   * delete — so filtering, the gesture an analyst makes a hundred times an hour, cost
   * the same as declaring a vocabulary, which is done once per column ever.
   *
   * So the two are split by **how often they are wanted**: the funnel asks, the `...`
   * sets up. Everything here is a question about the rows; nothing here changes what
   * the column *is*.
   *
   * A menu rather than the panel, on purpose, and it does not contradict the panel's
   * own reason for existing: what did not fit in two hundred pixels was a name, three
   * filters, a list of values, a role with its vocabulary, a note and seven actions —
   * the filter *alone* fits, and it is what every spreadsheet puts here. The panel
   * also costs 340px of grid at the moment the analyst wants to watch rows disappear.
   *
   * Drawn outside the scroller and placed from the heading's own rectangle: inside it,
   * the grid's `overflow: auto` would clip it and its own scrollbars would grow to
   * account for it.
   */
  import Icon from './Icon.svelte';
  import { columnValues, isFilterActive, normalizeFilter } from '../lib/sheet.js';
  import { readable } from '../lib/sheetRoles.js';

  let {
    table,
    column,
    role = null,
    filter = null,
    at = { x: 0, y: 0 },
    onvalue,
    onfill,
    oncontains,
    onwithout,
    onrange,
    onclear,
    onclose,
  } = $props();

  const NOTHING_ASKED = { values: null, fill: null, contains: '', without: '', from: '', to: '' };

  let contains = $state('');
  let without = $state('');
  let from = $state('');
  let to = $state('');
  /** What is typed into the value search. Narrows against the whole column, which is what
   *  makes a hundred and twenty cities reachable from a list forty long. */
  let among = $state('');

  /** The values on offer, counted the way the column reads them: a list column is
   *  counted value by value, so `Buk-M2E, ZU23-2` offers two answers rather than one
   *  entry no second row will ever match. Narrowed by the box above it and cut to a
   *  page, so a column of a hundred and twenty cities is walkable rather than refused. */
  const read = $derived(columnValues(table, column.name, role, { term: among }));
  const current = $derived(normalizeFilter(filter) ?? NOTHING_ASKED);
  const active = $derived(isFilterActive(filter));
  /** How many filled cells the column's own lens cannot read. Offered as a filter rather
   *  than a warning: a role never refuses a cell, so the analyst needs the list. */
  const unread = $derived(role ? readable(table, column.index, role).unreadable : 0);
  /** Whether a bound is a question this column can answer. Only where the column says it
   *  holds quantities: two bounds on a column of names would be two boxes doing nothing. */
  const ordered = $derived(role?.kind === 'number' || role?.kind === 'when');
  const dated = $derived(role?.kind === 'when');

  // Re-seeded when the menu opens on another column, so the boxes hold that column's
  // answers rather than the previous one's.
  $effect(() => {
    contains = normalizeFilter(filter)?.contains ?? '';
  });
  $effect(() => {
    without = normalizeFilter(filter)?.without ?? '';
  });
  $effect(() => {
    from = normalizeFilter(filter)?.from ?? '';
  });
  $effect(() => {
    to = normalizeFilter(filter)?.to ?? '';
  });
  $effect(() => {
    void column.name;
    among = '';
  });

  /** Kept on screen where a column near the right edge would put it off. Read once as
   *  the menu opens: it does not follow the heading, because a grid scrolled under an
   *  open menu closes it. */
  const WIDTH = 260;
  const left = $derived(
    typeof window === 'undefined' ? at.x : Math.max(8, Math.min(at.x, window.innerWidth - WIDTH - 8)),
  );
</script>

<div class="filter-menu" style="left: {left}px; top: {at.y}px; width: {WIDTH}px"
     role="dialog" aria-label="Filter {column.name}">
  <header>
    <span class="name">{column.name}</span>
    {#if active}
      <button class="clear" onclick={onclear}>Clear</button>
    {/if}
    <button class="shut" title="Close" aria-label="Close this filter" onclick={onclose}>
      <Icon name="x" size={13} />
    </button>
  </header>

  <div class="asks">
    <button class="ask" class:on={current.fill === 'filled'} onclick={() => onfill('filled')}>
      <Icon name="check" size={12} /> Filled
    </button>
    <button class="ask" class:on={current.fill === 'blank'} onclick={() => onfill('blank')}>
      <Icon name="x" size={12} /> Empty
    </button>
  </div>
  {#if unread}
    <button class="ask wide" class:on={current.fill === 'unreadable'}
            title="Cells the type cannot read"
            onclick={() => onfill('unreadable')}>
      <Icon name="alert" size={12} /> {unread} to check
    </button>
  {/if}

  <!-- The two halves of the same question. `Without` was here on its own, which meant
       a column of prose — past the bound there is no list of values to tick — could be
       ruled out by a word and never kept by one. -->
  <label class="field">
    <span>Holding</span>
    <input class="input" placeholder="a word it must hold"
           bind:value={contains}
           onkeydown={(event) => event.key === 'Enter' && oncontains(contains)}
           onblur={() => oncontains(contains)} />
  </label>
  <label class="field">
    <span>Without</span>
    <input class="input" placeholder="a word it must not hold"
           bind:value={without}
           onkeydown={(event) => event.key === 'Enter' && onwithout(without)}
           onblur={() => onwithout(without)} />
  </label>

  {#if ordered}
    <!-- The question a list of values cannot ask: *before this date*, *under five
         kilometres*. Only on a column that says it holds quantities, and either bound
         alone is a question. -->
    <div class="bounds">
      <label class="field">
        <span>From</span>
        <input class="input" type={dated ? 'date' : 'text'} placeholder={dated ? '' : 'lowest'}
               bind:value={from}
               onkeydown={(event) => event.key === 'Enter' && onrange({ from })}
               onblur={() => onrange({ from })} />
      </label>
      <label class="field">
        <span>To</span>
        <input class="input" type={dated ? 'date' : 'text'} placeholder={dated ? '' : 'highest'}
               bind:value={to}
               onkeydown={(event) => event.key === 'Enter' && onrange({ to })}
               onblur={() => onrange({ to })} />
      </label>
    </div>
  {/if}

  {#if read}
    <!-- A column of a hundred and twenty cities used to answer nothing at all here: past
         forty distinct values the menu said "too many to list". Now it pages, and the box
         narrows against the whole column rather than against the page. -->
    {#if read.total > read.values.length || among}
      <label class="field">
        <span>Among {read.total} values</span>
        <input class="input" placeholder="narrow the list" bind:value={among} />
      </label>
    {/if}
    <div class="values">
      {#each read.values as entry (entry.value)}
        <button class="row-btn" onclick={() => onvalue(entry.value)}>
          <input type="checkbox" checked={current.values?.has(entry.value) ?? false}
                 tabindex="-1" />
          <span>{entry.value || '(blank)'}</span>
          <!-- How many rows hold it, which is what the filter will hand back. -->
          <small>{entry.rows}</small>
        </button>
      {:else}
        <p class="note">No match.</p>
      {/each}
    </div>
    {#if read.capped}
      <p class="note">
        The {read.values.length} commonest of {read.matching}. Narrow the list above.
      </p>
    {/if}
  {/if}
</div>

<style>
  .filter-menu {
    position: fixed; z-index: 20;
    display: flex; flex-direction: column; gap: 2px;
    max-height: min(440px, calc(100vh - 120px)); overflow: auto;
    padding: 6px; border: 1px solid var(--border-strong); border-radius: var(--r-sm);
    background: var(--bg-1); box-shadow: 0 12px 30px #0005;
  }
  header { display: flex; align-items: center; gap: 6px; padding: 1px 2px 5px; }
  .name {
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--text-1); font-size: var(--fs-sm); font-weight: 500;
  }
  .clear { flex: none; color: var(--text-3); font-size: var(--fs-xs); }
  .clear:hover { color: var(--accent); }
  .shut { flex: none; display: flex; color: var(--text-3); }
  .shut:hover { color: var(--text-1); }
  .asks { display: flex; gap: 4px; }
  .ask {
    flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 5px;
    padding: 5px; border: 1px solid var(--border); border-radius: var(--r-sm);
    color: var(--text-2); font-size: var(--fs-xs);
  }
  .ask.wide { width: 100%; margin-top: 4px; }
  .ask:hover { border-color: var(--border-strong); color: var(--text-1); }
  .ask.on { border-color: var(--accent); color: var(--accent); }
  .field { display: block; padding: 6px 0 0; }
  .field span { display: block; color: var(--text-3); font-size: var(--fs-xs); margin-bottom: 3px; }
  .field .input { width: 100%; }
  .bounds { display: flex; gap: 6px; }
  .bounds .field { flex: 1; min-width: 0; }
  .values { max-height: 240px; overflow: auto; margin-top: 8px; }
  .row-btn {
    display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 6px;
    border-radius: var(--r-sm); color: var(--text-2); text-align: left; font-size: var(--fs-sm);
  }
  .row-btn:hover { background: var(--bg-2); color: var(--text-1); }
  .row-btn span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row-btn small { color: var(--text-3); font-size: var(--fs-xs); }
  .note { padding: 8px 4px 2px; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.5; }
</style>
