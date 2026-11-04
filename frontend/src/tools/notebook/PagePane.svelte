<script>
  /**
   * The Page pane: beside the note, the PDF the server would write for it, from
   * the text as typed (`lib/notes/preview.js`). Drawn again a moment after typing
   * stops and at once when the look changes; the pages shown stay until the new
   * ones are ready. A press on a page puts the note at that page's first line.
   *
   * A template has no case: `caseId` is empty and its pictures and chips print as
   * stand-ins.
   *
   * Each picture of the note can be sized where it prints: hovering it offers the
   * sizes and places the editor's picture offers, and a picture that went to the
   * next page marks the room it left with the width that keeps it there. Both
   * hand `onresize(picture, { width } | { align })` up, which rewrites its line.
   */
  import { onDestroy, untrack } from 'svelte';
  import { createPreview, pageLine } from '../../lib/notes/preview.js';
  import { PICTURE_ALIGNS, PICTURE_SIZES, sizeWidth } from '../../lib/notes/pictureSize.js';
  import Icon from '../../components/Icon.svelte';
  import PagePreview from '../../components/PagePreview.svelte';

  let { caseId = '', note = 'case', title = '', text = '', look = null, onjump = () => {}, onresize = null } = $props();

  let data = $state(null);
  let pages = $state([]);
  let count = $state(0);
  let warnings = $state([]);
  let pictures = $state([]);
  let error = $state('');
  let busy = $state(false);

  const preview = createPreview({
    onresult: (answer) => {
      data = answer.data;
      pages = answer.pages;
      warnings = answer.warnings;
      pictures = answer.pictures ?? [];
      error = '';
    },
    onerror: (message) => { error = message; },
    onbusy: (flag) => { busy = flag; },
  });
  onDestroy(() => preview.stop());

  const ALIGN_ICONS = { left: ['alignLeft', 'Left'], center: ['alignCentreH', 'Centre'], right: ['alignRight', 'Right'] };
  const percent = (value) => `${(value * 100).toFixed(3)}%`;
  /** How much taller than wide a picture prints, from its box and its page's size. */
  const ratioOf = (picture, size) => (picture.box[2] && size.w ? (picture.box[3] * size.h) / (picture.box[2] * size.w) : 0);

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
    onpage={(index) => onjump(pageLine(pages, index))} overlay={pictures.length ? marks : null} />
</aside>

{#snippet marks(index, size)}
  {#each pictures as picture, at (at)}
    {#if picture.gap && picture.gap[0] === index && onresize}
      {@const [, top, bottom, left, right] = picture.gap}
      <div class="gap" style:top={percent(top)} style:height={percent(bottom - top)} style:left={percent(left)} style:width={percent(right - left)}>
        <button type="button" class="btn btn-xs fit" title={`The next picture moved to the next page. At ${picture.fit}% wide it stays here`}
          onclick={() => onresize(picture, { width: `${picture.fit}%` })}>Fit the picture here</button>
      </div>
    {/if}
    {#if picture.page === index}
      {@const ratio = ratioOf(picture, size)}
      <div class="picture" style:left={percent(picture.box[0])} style:top={percent(picture.box[1])}
        style:width={percent(picture.box[2])} style:height={percent(picture.box[3])}>
        <button type="button" class="picture-hit" title="Go to this picture in the note" aria-label="Go to this picture in the note"
          onclick={() => onjump(picture.line)}></button>
        {#if onresize}
          <div class="picture-bar" role="toolbar" aria-label="Size in the PDF">
            {#each PICTURE_SIZES as choice (choice.id)}
              <button type="button" title={choice.title} aria-pressed={picture.width === sizeWidth(choice.share, ratio)}
                onclick={() => onresize(picture, { width: sizeWidth(choice.share, ratio) })}>{choice.label}</button>
            {/each}
            {#each PICTURE_ALIGNS as align (align)}
              <button type="button" class="align" title={ALIGN_ICONS[align][1]} aria-label={ALIGN_ICONS[align][1]}
                aria-pressed={(picture.align || 'left') === align} onclick={() => onresize(picture, { align })}>
                <Icon name={ALIGN_ICONS[align][0]} size={13} />
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  {/each}
{/snippet}

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
  .picture { position: absolute; }
  .picture-hit {
    position: absolute; inset: 0; padding: 0; border: none; background: transparent; cursor: pointer; border-radius: 1px;
  }
  .picture:hover .picture-hit, .picture-hit:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .picture-bar {
    position: absolute; top: 6px; right: 6px; display: none; gap: 2px; padding: 3px; border-radius: 6px;
    background: var(--bg-1); border: 1px solid var(--border-strong); box-shadow: var(--shadow-2); font-size: 11px; line-height: 1;
  }
  .picture:hover .picture-bar, .picture-bar:focus-within, .picture:has(.picture-hit:focus-visible) .picture-bar { display: flex; }
  .picture-bar button {
    display: inline-flex; align-items: center; justify-content: center; min-width: 28px; height: 22px; padding: 0 6px;
    border: none; border-radius: 4px; background: transparent; color: var(--text-2); cursor: pointer; font: inherit;
  }
  .picture-bar button.align { min-width: 24px; padding: 0; }
  .picture-bar button.align:first-of-type { margin-left: 4px; }
  .picture-bar button:hover { background: var(--bg-3); color: var(--text-1); }
  .picture-bar button[aria-pressed='true'] { background: var(--accent-soft); color: var(--accent); }
  .gap {
    position: absolute; display: flex; align-items: center; justify-content: center; border: 1px dashed var(--accent);
    border-radius: 3px; background: color-mix(in srgb, var(--accent) 7%, transparent); pointer-events: none;
  }
  .fit { pointer-events: auto; box-shadow: var(--shadow-2); }
  .error {
    display: flex; align-items: center; gap: 6px; margin: 0; padding: 6px 12px; color: var(--danger); background: var(--danger-soft);
    font-size: var(--fs-xs); border-bottom: 1px solid var(--border);
  }
</style>
