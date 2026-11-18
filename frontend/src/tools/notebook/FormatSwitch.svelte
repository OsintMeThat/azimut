<script>
  /**
   * PDF | HTML: the file a note exports to, or the one the Page pane draws
   * (`lib/notes/formats.js`). `page` says it of the pane beside the note.
   */
  import { LOOK_HELP } from '../../lib/notes/lookHelp.js';
  import { HTML, PDF } from '../../lib/notes/formats.js';

  let { value = PDF, tight = false, page = false, onchange = () => {} } = $props();
</script>

<div class="formats" class:tight role="group" aria-label="Format">
  <button type="button" class:on={value !== HTML} aria-pressed={value !== HTML} title={page ? LOOK_HELP.page_pane : LOOK_HELP.pdf}
    onclick={() => onchange(PDF)}>PDF</button>
  <button type="button" class:on={value === HTML} aria-pressed={value === HTML} title={page ? LOOK_HELP.page_html : LOOK_HELP.html}
    onclick={() => onchange(HTML)}>HTML</button>
</div>

<style>
  .formats { display: inline-flex; flex: none; border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden; }
  .formats button {
    padding: 3px 10px; border: none; border-left: 1px solid var(--border); background: var(--bg-1); color: var(--text-2);
    font: inherit; font-size: var(--fs-xs); cursor: pointer;
  }
  .formats.tight button { padding: 2px 7px; }
  .formats button:first-child { border-left: none; }
  .formats button:hover:not(.on) { background: var(--bg-3); color: var(--text-1); }
  .formats button.on { background: var(--bg-3); color: var(--text-1); font-weight: 600; box-shadow: inset 0 -2px 0 var(--accent); }
  .formats button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
</style>
