<script>
  /**
   * The file a note exports to, or the one the Page pane draws (`lib/notes/formats.js`):
   * PDF · HTML page · Web folder · WordPress draft in the export dialog, PDF | HTML in
   * the pane, which `page` says.
   */
  import { LOOK_HELP } from '../../lib/notes/lookHelp.js';
  import { FORMATS, FORMAT_LABELS, HTML, PAGE_FORMATS, PAGE_LABELS, PDF, WEB, WORDPRESS } from '../../lib/notes/formats.js';

  let { value = PDF, tight = false, page = false, onchange = () => {} } = $props();

  const offered = $derived(page ? PAGE_FORMATS : FORMATS);
  const shown = $derived(offered.includes(value) ? value : PDF);
  const labels = $derived(page ? PAGE_LABELS : FORMAT_LABELS);
  const titles = $derived({
    [PDF]: page ? LOOK_HELP.page_pane : LOOK_HELP.pdf,
    [HTML]: page ? LOOK_HELP.page_html : LOOK_HELP.html,
    [WEB]: LOOK_HELP.web_folder,
    [WORDPRESS]: LOOK_HELP.wordpress,
  });
</script>

<div class="formats" class:tight role="group" aria-label="Format">
  {#each offered as format (format)}
    <button type="button" class:on={shown === format} aria-pressed={shown === format} title={titles[format]}
      onclick={() => onchange(format)}>{labels[format]}</button>
  {/each}
</div>

<style>
  .formats { display: inline-flex; flex: none; border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden; }
  .formats button {
    padding: 3px 10px; border: none; border-left: 1px solid var(--border); background: var(--bg-1); color: var(--text-2);
    font: inherit; font-size: var(--fs-xs); cursor: pointer; white-space: nowrap;
  }
  .formats.tight button { padding: 2px 7px; }
  .formats button:first-child { border-left: none; }
  .formats button:hover:not(.on) { background: var(--bg-3); color: var(--text-1); }
  .formats button.on { background: var(--bg-3); color: var(--text-1); font-weight: 600; box-shadow: inset 0 -2px 0 var(--accent); }
  .formats button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
</style>
