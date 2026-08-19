<script>
  /**
   * What the grid can do, said once, where it can be found.
   *
   * The tool grew three doors on a heading, a menu in the gutter, a menu on a cell, a
   * dozen keys and six cleaning passes, and **announced none of them**. Every one of those
   * was the right call on its own — a spreadsheet keeps its power under a right-click too —
   * but a right-click nobody tries is a feature nobody has. The measured outcome of that
   * silence is an analyst concluding the grid cannot filter.
   *
   * So: one list, opened with `?`, that names the gestures rather than describing the
   * screen. It is deliberately not a tour and it blocks nothing; there is no "next".
   *
   * It holds no logic and no state — if a row here goes out of date, the row is wrong,
   * which is the honest failure mode for a legend.
   */
  import Icon from './Icon.svelte';

  let { onclose } = $props();

  const KEYS = [
    ['Enter', 'Edit the cell, and commit and step down'],
    ['Tab / Shift+Tab', 'Commit and step across; on the last cell, a new row'],
    ['Any character', 'Start editing on that character'],
    ['Arrows', 'Walk the cursor, Shift to pull a selection'],
    ['Home / End', 'The first and last column of the row'],
    ['PageUp / PageDown', 'A screenful of rows'],
    ['Ctrl+A', 'Select every row on screen'],
    ['Escape', 'Close what is open, or drop the selection'],
    ['Ctrl+C / Ctrl+V', 'Copy the rectangle, paste a block from the cursor'],
    ['Ctrl+D', 'Copy the top of the selection down'],
    ['Delete', 'Empty the selected cells'],
    ['Ctrl+Z / Ctrl+Shift+Z', 'Undo, redo'],
    ['Ctrl+Enter', 'Add a row'],
    ['Ctrl+F', 'Reach the search'],
    ['Ctrl+S', 'Save now instead of waiting for the autosave'],
    ['?', 'This list'],
  ];

  const GESTURES = [
    ['Right-click a heading', 'Sort, filter, insert, duplicate, rename, split, hide, delete'],
    ['Right-click a cell', 'Keep only this value'],
    ['Right-click the gutter', 'Insert, duplicate, paint, merge, pin, delete a row'],
    ['Double-click a heading', 'Rename it in place'],
    ['Drag a heading', 'Move the column, in the file'],
    ['Drag its right edge', 'Resize it'],
    ['Press and pull over cells', 'Select a rectangle; Shift-click a far corner does the same'],
    ['Shift-click in the gutter', 'Tick every row between'],
    ['Click a chip in a cell', 'Filter on that value; on a yes/no column, flip it'],
    ['Drop a CSV on the grid', 'File it as a new sheet'],
    ['Drop an image on a row', 'Bring it into the case and cite it in that cell'],
    ['The last, empty row', 'Type in it and the row exists'],
  ];
</script>

<div class="help">
  <p class="lead">
    The grid keeps its gestures where a spreadsheet keeps them.
  </p>
  <div class="two">
    <section>
      <p class="what">Keys</p>
      {#each KEYS as [key, what] (key)}
        <p class="line"><kbd>{key}</kbd><span>{what}</span></p>
      {/each}
    </section>
    <section>
      <p class="what">Pointer</p>
      {#each GESTURES as [gesture, what] (gesture)}
        <p class="line"><b>{gesture}</b><span>{what}</span></p>
      {/each}
    </section>
  </div>
  <p class="foot">
    <Icon name="info" size={12} />
    The sheet is the CSV in the case folder, and it autosaves. A save that would overwrite a
    change made outside the app is refused.
  </p>
  <div class="modal-row">
    <div class="spacer"></div>
    <button class="btn btn-primary" onclick={onclose}>Got it</button>
  </div>
</div>

<style>
  .help { display: flex; flex-direction: column; min-height: 0; }
  .lead { color: var(--text-2); font-size: var(--fs-sm); line-height: 1.5; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 12px; }
  @media (max-width: 700px) { .two { grid-template-columns: 1fr; } }
  .what { color: var(--text-3); font-size: var(--fs-xs); margin-bottom: 6px; }
  .line { display: flex; align-items: baseline; gap: 8px; padding: 2px 0; font-size: var(--fs-xs); }
  .line kbd {
    flex: none; min-width: 132px; color: var(--text-1); font-family: var(--font-mono);
  }
  .line b { flex: none; min-width: 132px; color: var(--text-1); font-weight: 500; }
  .line span { color: var(--text-3); line-height: 1.5; }
  .foot {
    display: flex; align-items: center; gap: 6px; margin-top: 14px; padding-top: 10px;
    border-top: 1px solid var(--border); color: var(--text-3); font-size: var(--fs-xs);
  }
  .modal-row { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
  .spacer { flex: 1; }
</style>
