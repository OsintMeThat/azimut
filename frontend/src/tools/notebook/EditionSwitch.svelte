<script>
  /**
   * Internal | Public: which edition of a note prints (`lib/notes/editions.svelte.js`).
   * The export dialog and the Page pane show it only when the note, or a chapter it
   * includes, holds an internal passage.
   */
  import { LOOK_HELP } from '../../lib/notes/lookHelp.js';
  import { INTERNAL, PUBLIC } from '../../lib/notes/editions.svelte.js';

  let { value = INTERNAL, tight = false, onchange = () => {} } = $props();
</script>

<div class="editions" class:tight role="group" aria-label="Edition">
  <button type="button" class:on={value !== PUBLIC} aria-pressed={value !== PUBLIC} title={LOOK_HELP.internal}
    onclick={() => onchange(INTERNAL)}>Internal</button>
  <button type="button" class:on={value === PUBLIC} aria-pressed={value === PUBLIC} title={LOOK_HELP.public}
    onclick={() => onchange(PUBLIC)}>Public</button>
</div>

<style>
  .editions { display: inline-flex; flex: none; border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden; }
  .editions button {
    padding: 3px 10px; border: none; border-left: 1px solid var(--border); background: var(--bg-1); color: var(--text-2);
    font: inherit; font-size: var(--fs-xs); cursor: pointer;
  }
  .editions.tight button { padding: 2px 7px; }
  .editions button:first-child { border-left: none; }
  .editions button:hover:not(.on) { background: var(--bg-3); color: var(--text-1); }
  .editions button.on { background: var(--bg-3); color: var(--text-1); font-weight: 600; box-shadow: inset 0 -2px 0 var(--accent); }
  .editions button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
</style>
