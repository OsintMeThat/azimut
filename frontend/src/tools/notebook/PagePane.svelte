<script>
  /**
   * The Page pane: beside the note, the PDF the server would write for it, from
   * the text as typed (`lib/notes/preview.js`). Drawn again a moment after typing
   * stops and at once when the look changes; the pages shown stay until the new
   * ones are ready. A press on a page puts the note at that page's first line.
   *
   * A template has no case: `caseId` is empty and its pictures and chips print as
   * stand-ins.
   */
  import { onDestroy, untrack } from 'svelte';
  import { createPreview, pageLine } from '../../lib/notes/preview.js';
  import Icon from '../../components/Icon.svelte';
  import PagePreview from '../../components/PagePreview.svelte';

  let { caseId = '', note = 'case', title = '', text = '', look = null, onjump = () => {} } = $props();

  let data = $state(null);
  let pages = $state([]);
  let count = $state(0);
  let warnings = $state([]);
  let error = $state('');
  let busy = $state(false);

  const preview = createPreview({
    onresult: (answer) => {
      data = answer.data;
      pages = answer.pages;
      warnings = answer.warnings;
      error = '';
    },
    onerror: (message) => { error = message; },
    onbusy: (flag) => { busy = flag; },
  });
  onDestroy(() => preview.stop());

  // typing waits for a pause; a new look, a new name or another note is drawn at once
  let lastText = null;
  let lastRest = null;
  $effect(() => {
    const request = { caseId, note, title, text, look };
    const rest = JSON.stringify([caseId, note, title, look]);
    untrack(() => {
      const typed = lastText !== null && rest === lastRest && text !== lastText;
      lastText = text;
      lastRest = rest;
      if (typed) preview.ask(request);
      else void preview.now(request);
    });
  });
</script>

<aside class="page-pane" aria-label="Page" data-guide="notebook.page">
  <div class="pane-bar">
    <span class="said">
      {#if count}{count} page{count === 1 ? '' : 's'}{:else if busy}Drawing the pages…{:else}&nbsp;{/if}
    </span>
    {#if busy && count}<span class="busy" title="Drawing the pages again">Updating…</span>{/if}
    {#if warnings.length}
      <span class="warned" title={warnings.join('\n')}><Icon name="alert" size={12} /> {warnings.length} warning{warnings.length === 1 ? '' : 's'}</span>
    {/if}
  </div>
  {#if error}<p class="error" role="alert"><Icon name="alert" size={12} /> {error}</p>{/if}
  <PagePreview {data} label="Pages of the PDF" onerror={(message) => (error = message)} onpages={(n) => (count = n)}
    onpage={(index) => onjump(pageLine(pages, index))} />
</aside>

<style>
  .page-pane {
    display: flex; flex-direction: column; min-height: 0; min-width: 0; border-left: 1px solid var(--border); background: var(--bg-0);
  }
  .pane-bar {
    display: flex; align-items: center; gap: 10px; padding: 5px 12px; min-height: 31px; border-bottom: 1px solid var(--border);
    background: var(--bg-1); color: var(--text-3); font-size: var(--fs-xs);
  }
  .said { flex: 1; }
  .busy { color: var(--text-3); }
  .warned { display: inline-flex; align-items: center; gap: 4px; color: var(--warn); cursor: help; }
  .error {
    display: flex; align-items: center; gap: 6px; margin: 0; padding: 6px 12px; color: var(--danger); background: var(--danger-soft);
    font-size: var(--fs-xs); border-bottom: 1px solid var(--border);
  }
</style>
