<script>
  /**
   * Write | Page: the note to write in, or the PDF it prints to. The Notebook draws
   * the pages beside the note; the note on the side and the extension's panel,
   * too narrow for both, draw them in its place (`inPlace`), and set it tighter.
   */
  import { LOOK_HELP } from '../../lib/notes/lookHelp.js';

  let { page = false, inPlace = false, guide = undefined, onchange = () => {} } = $props();
</script>

<div class="modes" class:tight={inPlace} role="group" aria-label="View" data-guide={guide}>
  <button type="button" class:on={!page} aria-pressed={!page} title={LOOK_HELP.write} onclick={() => onchange(false)}>Write</button>
  <button type="button" class:on={page} aria-pressed={page} title={inPlace ? LOOK_HELP.page_in_place : LOOK_HELP.page_pane}
    onclick={() => onchange(true)}>Page</button>
</div>

<style>
  .modes { display: inline-flex; flex: none; border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden; }
  .modes button {
    padding: 3px 10px; border: none; border-left: 1px solid var(--border); background: var(--bg-1); color: var(--text-2);
    font: inherit; font-size: var(--fs-xs); cursor: pointer;
  }
  .modes.tight button { padding: 3px 7px; }
  @container (max-width: 340px) { .modes.tight button { padding: 3px 5px; } }
  .modes button:first-child { border-left: none; }
  .modes button:hover:not(.on) { background: var(--bg-3); color: var(--text-1); }
  .modes button.on { background: var(--bg-3); color: var(--text-1); font-weight: 600; box-shadow: inset 0 -2px 0 var(--accent); }
</style>
