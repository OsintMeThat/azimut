<script>
  /**
   * What a row can do, from the row.
   *
   * The gutter held one tick box and nothing else, so inserting a line where the analyst
   * was reading meant appending one four hundred rows below and dragging it back, and
   * forking a candidate into two hypotheses — the same address checked two ways — could
   * not be done at all.
   *
   * Right-click, because that is where a spreadsheet keeps this and because the gutter has
   * no room for anything more. It acts on **the batch when the row is in it**: forty ticked
   * rows and a right-click on one of them means the forty, and the heading says which it
   * is, since "delete" that turns out to mean the wrong forty is the one thing this must
   * not do.
   */
  import Icon from './Icon.svelte';
  import { ROW_COLOURS } from '../lib/sheet.js';

  let {
    at = { x: 0, y: 0 },
    count = 1,
    pinned = false,
    onread,
    oninsert,
    onduplicate,
    onpaint,
    onpin,
    onmerge,
    ondelete,
    onclose,
  } = $props();

  const many = $derived(count > 1);
  const rows = $derived(`${count} ${count === 1 ? 'row' : 'rows'}`);

  const WIDTH = 230;
  const HEIGHT = 320;
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

<div class="row-menu" style="left: {left}px; top: {top}px; width: {WIDTH}px"
     role="menu" aria-label="What to do with {rows}">
  <p class="head">{rows}</p>

  {#if !many}
    <button class="row" role="menuitem" onclick={() => run(onread)}>
      <Icon name="panelRight" size={12} /><span>Open it field by field</span>
    </button>
  {/if}
  <button class="row" role="menuitem" onclick={() => run(oninsert, 'above')}>
    <Icon name="chevronUp" size={12} /><span>Insert a row above</span>
  </button>
  <button class="row" role="menuitem" onclick={() => run(oninsert, 'below')}>
    <Icon name="chevronDown" size={12} /><span>Insert a row below</span>
  </button>
  <button class="row" role="menuitem" onclick={() => run(onduplicate)}>
    <Icon name="copy" size={12} /><span>Duplicate {many ? rows : 'it'}</span>
  </button>
  {#if many}
    <!-- The other half of "this value is said twice": the grid could find the rows and
         paint them, and then left the retyping of one row out of three by hand. -->
    <button class="row" role="menuitem" onclick={() => run(onmerge)}>
      <Icon name="layers" size={12} /><span>Merge {rows} into one</span>
    </button>
  {:else}
    <!-- The reference candidate a comparison grid is read against, which otherwise
         scrolls away at row twelve and takes the point of the grid with it. -->
    <button class="row" class:on={pinned} role="menuitem" onclick={() => run(onpin)}>
      <Icon name="pushpin" size={12} />
      <span>{pinned ? 'Let it scroll' : 'Keep it in view'}</span>
    </button>
  {/if}

  <div class="rule"></div>
  <div class="paint">
    <span class="what">Paint</span>
    {#each ROW_COLOURS as colour (colour)}
      <button class="swatch c-{colour}" title="Paint {rows} {colour}"
              aria-label="Paint {rows} {colour}" onclick={() => run(onpaint, colour)}></button>
    {/each}
    <button class="swatch none" title="Clear the colour" aria-label="Clear the colour"
            onclick={() => run(onpaint, null)}></button>
  </div>

  <div class="rule"></div>
  <button class="row danger" role="menuitem" onclick={() => run(ondelete)}>
    <Icon name="trash" size={12} /><span>Delete {many ? rows : 'it'}</span>
  </button>
</div>

<style>
  .row-menu {
    position: fixed; z-index: 21;
    display: flex; flex-direction: column; gap: 1px;
    padding: 5px; border: 1px solid var(--border-strong); border-radius: var(--r-sm);
    background: var(--bg-1); box-shadow: 0 12px 30px #0005;
  }
  .head { padding: 3px 7px 5px; color: var(--text-3); font-size: var(--fs-xs); }
  .row {
    display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 7px;
    border-radius: var(--r-sm); color: var(--text-2); text-align: left; font-size: var(--fs-sm);
  }
  .row:hover { background: var(--bg-2); color: var(--text-1); }
  .row.on { color: var(--accent); }
  .row.danger:hover { background: var(--danger-soft); color: var(--danger); }
  .row span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rule { height: 1px; margin: 4px 2px; background: var(--border); }
  .paint { display: flex; align-items: center; gap: 5px; padding: 3px 7px; }
  .what { flex: none; color: var(--text-3); font-size: var(--fs-xs); }
  /* The same swatch the bar above the grid draws, so a colour is picked the same way
     wherever it is offered. The `.c-*` classes are global (`app.css`) and set `--mark`. */
  .swatch {
    width: 16px; height: 16px; border-radius: var(--r-sm);
    border: 1px solid var(--border-strong); background: var(--mark, var(--bg-3));
  }
  .swatch.none { background: repeating-linear-gradient(45deg, var(--bg-2) 0 3px, var(--bg-3) 3px 6px); }
  .swatch:hover { outline: 2px solid var(--accent); outline-offset: 1px; }
</style>
