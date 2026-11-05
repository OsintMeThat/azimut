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
   * Each picture of the note can be sized and captioned where it prints: hovering
   * it offers the sizes, places and caption the editor's picture offers, and a
   * picture that went to the next page marks the room it left with the width that
   * keeps it there. Both hand `onresize(picture, { width } | { align } | { caption })`
   * up, which rewrites its line.
   *
   * A picture's bar also offers the way back to the tool it was made in, and Source…
   * for a picture brought in by hand with no address yet (`lib/notes/sources.js`);
   * neither is ever printed. `entities` are the case's records the pictures are.
   *
   * What the server warns about is listed under the bar, a part no longer in the
   * case marked apart from the rest; a warning that names its line takes the note
   * there when pressed.
   *
   * A note holding an internal passage, itself or in a chapter, gets Internal |
   * Public in the bar, the same choice the export dialog keeps for it, so the
   * public pages are seen before they are written. A template keeps it for the visit.
   */
  import { onDestroy, untrack } from 'svelte';
  import { createPreview, pageLine } from '../../lib/notes/preview.js';
  import {
    CAPTION_HELP, PICTURE_ALIGNS, PICTURE_SIZES, SOURCE_HELP, captionField, pictureAt, rovingToolbar, sizeWidth, sourceField,
  } from '../../lib/notes/pictureSize.js';
  import { openerFor } from '../../lib/notes/openers.js';
  import '../../lib/notes/openersLoaded.js';
  import { canStateSourceOf, stateSourceOf } from '../../lib/notes/sources.js';
  import { INTERNAL, editionOf, keepEdition } from '../../lib/notes/editions.svelte.js';
  import Icon from '../../components/Icon.svelte';
  import PagePreview from '../../components/PagePreview.svelte';
  import EditionSwitch from './EditionSwitch.svelte';

  let { caseId = '', note = 'case', title = '', text = '', look = null, entities = [], onjump = () => {}, onresize = null } = $props();

  let data = $state(null);
  let pages = $state([]);
  let count = $state(0);
  let warnings = $state([]);
  let pictures = $state([]);
  /** How many internal passages the note holds, chapters included. */
  let internal = $state(0);
  /** A template's edition, which no note keeps. */
  let templateEdition = $state(INTERNAL);
  const edition = $derived(caseId ? editionOf(caseId, note) : templateEdition);
  function setEdition(value) {
    if (caseId) keepEdition(caseId, [note], value);
    else templateEdition = value;
  }
  let error = $state('');
  let busy = $state(false);
  let warningsFolded = $state(false);
  /** The picture whose caption is being written (`captionKey`), or null. */
  let captioning = $state(null);
  /** The picture whose source is being stated (`captionKey`), or null. */
  let stating = $state(null);
  /** Whether each picture's source is the analyst's to state, by record and address. */
  let sourceable = $state({});

  const byId = $derived(new Map(entities.map((entity) => [entity.id, entity])));
  /** The case record a printed picture shows, or null for an image read from an address. */
  function entityOf(picture) {
    const id = /^media:([A-Za-z0-9_-]+)$/.exec(picture?.ref ?? '')?.[1];
    return id ? byId.get(id) ?? null : null;
  }
  const sourceKey = (entity) => `${entity.id}:${entity.attrs?.source_url ?? ''}`;

  $effect(() => {
    const shown = pictures.map(entityOf).filter(Boolean);
    const id = caseId;
    untrack(() => {
      for (const entity of shown) {
        const key = sourceKey(entity);
        if (key in sourceable) continue;
        sourceable[key] = false;
        Promise.resolve(canStateSourceOf(id, entity)).then((yes) => { if (yes) sourceable[key] = true; });
      }
    });
  });

  /** The source field, under picture `picture`. */
  function sourceHere(node, picture) {
    const entity = entityOf(picture);
    const field = sourceField({
      write: (url) => stateSourceOf(caseId, entity, url),
      done: (by) => {
        if (by === 'keyboard') node.previousElementSibling?.querySelector('button.source')?.focus({ preventScroll: true });
        stating = null;
      },
    });
    node.append(field);
    field.focus({ preventScroll: true });
    return { destroy: () => field.remove() };
  }

  const preview = createPreview({
    onresult: (answer) => {
      data = answer.data;
      pages = answer.pages;
      warnings = answer.warnings ?? [];
      pictures = answer.pictures ?? [];
      internal = answer.internal ?? 0;
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

  const captionKey = (picture) => `${picture.line}:${picture.ref}`;

  /** The caption field, under picture `picture` where its caption prints, holding what its line says now. */
  function captionHere(node, picture) {
    const found = pictureAt(text.split('\n'), picture.line, picture.ref);
    const field = captionField({
      caption: found?.caption ?? '',
      title: found?.title ?? '',
      write: (caption) => onresize?.(picture, { caption }),
      done: (by) => {
        // Enter and Escape give the keyboard back to the picture's bar
        if (by === 'keyboard') node.previousElementSibling?.querySelector('button.caption')?.focus({ preventScroll: true });
        captioning = null;
      },
    });
    node.append(field);
    field.focus({ preventScroll: true });
    field.select();
    return { destroy: () => field.remove() };
  }

  /** A picture's bar, walked as one toolbar (`rovingToolbar`). */
  const toolbar = (node) => ({ destroy: rovingToolbar(node) });

  /** Where the field sits: under the picture, at least half the page wide, inside the page. */
  function captionPlace(box) {
    const width = Math.min(0.92, Math.max(box[2], 0.5));
    const left = Math.max(0.04, Math.min(box[0], 0.96 - width));
    return { left: percent(left), width: percent(width), top: `min(${percent(box[1] + box[3])}, calc(100% - 34px))` };
  }

  // typing waits for a pause; a new look, a new name or another note is drawn at once
  let lastText = null;
  let lastRest = null;
  $effect(() => {
    const request = { caseId, note, title, text, look, edition };
    const rest = JSON.stringify([caseId, note, title, look, edition]);
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
    {#if internal}<EditionSwitch tight value={edition} onchange={setEdition} />{/if}
    {#if warnings.length}
      <button type="button" class="warned" aria-expanded={!warningsFolded} aria-controls="page-warnings"
        title={warningsFolded ? 'Show what the PDF warns about' : 'Hide the warnings'} onclick={() => (warningsFolded = !warningsFolded)}>
        <Icon name="alert" size={12} /> {warnings.length} warning{warnings.length === 1 ? '' : 's'}
        <Icon name={warningsFolded ? 'chevronDown' : 'chevronUp'} size={11} />
      </button>
    {/if}
  </div>
  {#if warnings.length && !warningsFolded}
    <ul class="warnings" id="page-warnings" aria-label="Warnings">
      {#each warnings as warning, index (index)}
        <li>
          {#if Number.isInteger(warning.line)}
            <button type="button" class="warning go" data-kind={warning.kind} title="Go to it in the note" onclick={() => onjump(warning.line)}>
              <span class="warning-words">{warning.text}</span><Icon name="arrowRight" size={12} />
            </button>
          {:else}
            <span class="warning" data-kind={warning.kind}><span class="warning-words">{warning.text}</span></span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
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
      {@const entity = entityOf(picture)}
      {@const opener = entity ? openerFor(entity) : null}
      <div class="picture" style:left={percent(picture.box[0])} style:top={percent(picture.box[1])}
        style:width={percent(picture.box[2])} style:height={percent(picture.box[3])}>
        <button type="button" class="picture-hit" title="Go to this picture in the note" aria-label="Go to this picture in the note"
          onclick={() => onjump(picture.line)}></button>
        {#if onresize}
          <!-- on the side of the page the picture is on, so a small one's bar stays on the page -->
          <div class="picture-bar" class:from-left={picture.box[0] + picture.box[2] / 2 < 0.5} role="toolbar" aria-label="Size in the PDF"
            use:toolbar>
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
            <!-- a press while the field is open leaves it open, rather than writing it and opening it again -->
            <button type="button" class="caption" title={CAPTION_HELP.button} aria-expanded={captioning === captionKey(picture)}
              onmousedown={(event) => { if (captioning === captionKey(picture)) event.preventDefault(); }}
              onclick={() => { stating = null; captioning = captionKey(picture); }}>Caption</button>
            {#if entity && sourceable[sourceKey(entity)]}
              <button type="button" class="source" title={SOURCE_HELP.button} aria-expanded={stating === captionKey(picture)}
                onclick={() => { captioning = null; stating = captionKey(picture); }}>Source…</button>
            {/if}
            {#if opener}
              <button type="button" class="open" title={`${opener.label}, where this picture was made`} onclick={() => opener.open()}>{opener.label}</button>
            {/if}
          </div>
        {/if}
      </div>
      {#if captioning === captionKey(picture) && onresize}
        {@const place = captionPlace(picture.box)}
        <div class="caption-here" style:left={place.left} style:width={place.width} style:top={place.top} use:captionHere={picture}></div>
      {/if}
      {#if stating === captionKey(picture) && entity}
        {@const place = captionPlace(picture.box)}
        <div class="caption-here" style:left={place.left} style:width={place.width} style:top={place.top} use:sourceHere={picture}></div>
      {/if}
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
  .warned {
    display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; margin: -2px -6px -2px 0; border: none; border-radius: var(--r-sm);
    background: none; color: var(--warn); font: inherit; cursor: pointer;
  }
  .warned:hover, .warned:focus-visible { background: color-mix(in srgb, var(--warn) 12%, transparent); }
  .warnings {
    list-style: none; margin: 0; padding: 3px 0; max-height: 132px; overflow: auto; border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--warn) 7%, var(--bg-1)); font-size: var(--fs-xs);
  }
  .warning {
    display: flex; align-items: center; gap: 8px; width: 100%; padding: 3px 12px; border: none; background: none; color: var(--text-1);
    font: inherit; text-align: left;
  }
  .warning::before { content: ''; flex: none; width: 5px; height: 5px; border-radius: 50%; background: var(--warn); }
  .warning[data-kind='missing']::before { background: var(--danger); }
  .warning.go { cursor: pointer; }
  .warning.go :global(svg) { flex: none; color: var(--text-3); }
  .warning.go:hover, .warning.go:focus-visible { background: color-mix(in srgb, var(--warn) 14%, transparent); }
  .warning.go:hover :global(svg) { color: var(--text-1); }
  .warning-words { flex: 1; min-width: 0; overflow-wrap: anywhere; }
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
  .picture-bar.from-left { right: auto; left: 6px; }
  .picture-bar button.align { min-width: 24px; padding: 0; }
  .picture-bar button.align:first-of-type { margin-left: 4px; }
  .picture-bar button.caption, .picture-bar button.source { margin-left: 4px; padding: 0 8px; }
  .picture-bar button.open { margin-left: 4px; padding: 0 8px; white-space: nowrap; border-left: 1px solid var(--border); border-radius: 0 4px 4px 0; }
  .picture-bar button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .caption-here { position: absolute; margin-top: 4px; }
  .caption-here :global(.picture-source-field[aria-invalid='true']) { border-color: var(--danger); }
  .caption-here :global(.picture-caption-field), .caption-here :global(.picture-source-field) {
    display: block; box-sizing: border-box; width: 100%; height: 26px; padding: 3px 8px; border: 1px solid var(--accent); border-radius: 4px;
    background: var(--bg-1); color: var(--text-1); font: inherit; font-size: var(--fs-xs); box-shadow: var(--shadow-2); outline: none;
  }
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
