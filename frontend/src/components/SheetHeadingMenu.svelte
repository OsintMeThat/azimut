<script>
  /**
   * What a heading can do, in one press.
   *
   * A heading used to have two doors: the funnel, which asks something of the column, and
   * a `...` that opened the **setup panel** — a name, a role with its vocabulary, a note
   * and seven actions, 340 pixels of grid gone. That was right for declaring what a column
   * *is* and wrong for everything an analyst does to a column all day: insert one beside
   * it, copy it, sort it, split it, rename it. Those had either no door at all or the wrong
   * one, and nothing on the heading said so.
   *
   * So this is the third door and it is the one that opens first. A short list of the
   * frequent gestures, reachable two ways — the `...`, and a **right-click anywhere on the
   * heading**, which is what anyone who has used a spreadsheet tries before reading any
   * label. The rare half is still in the panel and this menu's last row is how you get
   * there, so nothing was taken away.
   *
   * It owns no rules: every row is a call back up, and the grid decides what a split or a
   * duplicate means to the table.
   */
  import Icon from './Icon.svelte';
  import { ID_COLUMN } from '../lib/sheet.js';

  let {
    column,
    meta = null,
    at = { x: 0, y: 0 },
    onsort,
    onsecondsort,
    onfilter,
    oninsert,
    onduplicate,
    onrename,
    onclean,
    onsplit,
    onfreeze,
    onhide,
    ondrop,
    onsetup,
    onclose,
  } = $props();

  const isKey = $derived(String(column?.name ?? '').toLowerCase() === ID_COLUMN);
  const sort = $derived(meta?.sort?.column === column?.name ? meta.sort : null);
  const frozen = $derived(meta?.frozen === column?.name);
  /** The column the sheet is sorted on, when it is another one: only then is "break its
   *  ties with this" a question, since a column cannot break its own. */
  const first = $derived(
    meta?.sort?.column && meta.sort.column !== column?.name ? meta.sort.column : null,
  );
  const second = $derived(meta?.sort?.then?.column === column?.name ? meta.sort.then : null);

  /** Kept on screen where a column near an edge would put it off. Read once as the menu
   *  opens, like the filter menu's: the grid scrolling under it closes it. */
  const WIDTH = 250;
  const HEIGHT = 420;
  const left = $derived(
    typeof window === 'undefined' ? at.x : Math.max(8, Math.min(at.x, window.innerWidth - WIDTH - 8)),
  );
  const top = $derived(
    typeof window === 'undefined' ? at.y : Math.max(8, Math.min(at.y, window.innerHeight - HEIGHT)),
  );

  /**
   * Every row acts, then closes.
   *
   * That order matters and it cost a bug: closing first clears the state the menu was
   * opened *about*, and the handlers read the column out of it — so an action fired after
   * the close was an action on nothing. The menu still never stays open over the change it
   * made, which is the point of closing at all.
   */
  function run(action, ...args) {
    action?.(...args);
    onclose();
  }
</script>

<div class="heading-menu" style="left: {left}px; top: {top}px; width: {WIDTH}px"
     role="menu" aria-label="What to do with {column.name}">
  <p class="head">{column.name}</p>

  {#if isKey}
    <p class="note">The row's handle. It is never renamed, moved or rewritten.</p>
    <button class="row" role="menuitem" onclick={() => run(onsetup)}>
      <Icon name="sliders" size={12} /><span>Set up this column…</span>
    </button>
  {:else}
    <button class="row" class:on={sort && !sort.desc} role="menuitem"
            onclick={() => run(onsort, false)}>
      <Icon name="chevronUp" size={12} /><span>Sort A → Z</span>
    </button>
    <button class="row" class:on={sort?.desc} role="menuitem" onclick={() => run(onsort, true)}>
      <Icon name="chevronDown" size={12} /><span>Sort Z → A</span>
    </button>
    {#if first}
      <!-- "By status, then by date" is how a worklist is read, and one key meant
           re-sorting by hand every time the first one tied. Not a fourth state on the
           heading's own click: "sort by this" and "sort by this too" one gesture apart
           would be a trap. -->
      <button class="row" class:on={Boolean(second)} role="menuitem"
              onclick={() => run(onsecondsort)}>
        <Icon name="layers" size={12} />
        <span>
          {second
            ? `Then by this, ${second.desc ? 'Z → A' : 'A → Z'}`
            : `Sort by “${first}”, then by this`}
        </span>
      </button>
    {/if}
    <button class="row" role="menuitem" onclick={() => run(onfilter)}>
      <Icon name="filter" size={12} /><span>Filter…</span>
    </button>

    <div class="rule"></div>
    <button class="row" role="menuitem" onclick={() => run(oninsert, 'left')}>
      <Icon name="chevronLeft" size={12} /><span>Insert a column left</span>
    </button>
    <button class="row" role="menuitem" onclick={() => run(oninsert, 'right')}>
      <Icon name="chevronRight" size={12} /><span>Insert a column right</span>
    </button>
    <button class="row" role="menuitem" onclick={() => run(onduplicate)}>
      <Icon name="copy" size={12} /><span>Duplicate this column</span>
    </button>
    <button class="row" role="menuitem" onclick={() => run(onrename)}>
      <Icon name="edit" size={12} /><span>Rename</span>
    </button>

    <div class="rule"></div>
    <button class="row" role="menuitem" onclick={() => run(onclean)}>
      <Icon name="wand" size={12} /><span>Find and replace…</span>
    </button>
    <button class="row" role="menuitem" onclick={() => run(onsplit)}>
      <Icon name="layers" size={12} /><span>Split, merge or tidy…</span>
    </button>

    <div class="rule"></div>
    <button class="row" class:on={frozen} role="menuitem" onclick={() => run(onfreeze)}>
      <Icon name="pushpin" size={12} />
      <span>{frozen ? 'Let it scroll' : 'Keep it in view'}</span>
    </button>
    <button class="row" role="menuitem" onclick={() => run(onhide)}>
      <Icon name="eyeOff" size={12} /><span>Hide</span>
    </button>
    <button class="row" role="menuitem" onclick={() => run(onsetup)}>
      <Icon name="sliders" size={12} /><span>Set up this column…</span>
    </button>
    <button class="row danger" role="menuitem" onclick={() => run(ondrop)}>
      <Icon name="trash" size={12} /><span>Delete this column</span>
    </button>
  {/if}
</div>

<style>
  .heading-menu {
    position: fixed; z-index: 21;
    display: flex; flex-direction: column; gap: 1px;
    max-height: min(420px, calc(100vh - 24px)); overflow: auto;
    padding: 5px; border: 1px solid var(--border-strong); border-radius: var(--r-sm);
    background: var(--bg-1); box-shadow: 0 12px 30px #0005;
  }
  .head {
    padding: 3px 7px 5px; color: var(--text-3); font-size: var(--fs-xs);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .row {
    display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 7px;
    border-radius: var(--r-sm); color: var(--text-2); text-align: left; font-size: var(--fs-sm);
  }
  .row:hover { background: var(--bg-2); color: var(--text-1); }
  .row.on { color: var(--accent); }
  .row.danger:hover { background: var(--danger-soft); color: var(--danger); }
  .row span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rule { height: 1px; margin: 4px 2px; background: var(--border); }
  .note { padding: 4px 7px 6px; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.5; }
</style>
