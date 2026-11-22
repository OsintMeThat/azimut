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
   *
   * A note also gets PDF | HTML: the pages, or the one HTML page an export would
   * write (`notes/html/preview`), drawn the same way and shown as a browser reads it
   * (`HtmlPage.svelte`). The choice is kept for this browser (`lib/notes/formats.js`).
   * A template, which belongs to no case, shows its pages.
   *
   * **Full screen** hands the preview's own box the screen (`lib/fullscreen.js`), or
   * covers the window with it where the browser refuses: the same preview, still drawn
   * again as the note changes, the HTML page laid out at the screen's width, a
   * tablet's or a phone's. Esc, Exit or the browser's own exit give the pane back
   * where it was read to.
   */
  import { onDestroy, tick, untrack } from 'svelte';
  import { prefs } from '../../lib/state.svelte.js';
  import { createPreview, htmlPreview, pageLine } from '../../lib/notes/preview.js';
  import { blockWords, spotLine } from '../../lib/notes/spots.js';
  import { copyText } from '../../lib/clipboard.js';
  import ContextMenu from '../../components/ContextMenu.svelte';
  import { HTML, PDF, keepFormat, readFormat } from '../../lib/notes/formats.js';
  import {
    CAPTION_HELP, PICTURE_ALIGNS, PICTURE_SIZES, POSTED_HELP, SOURCE_HELP, blockAlignAt, captionField, pictureAt, pictureLine, postedAddress,
    rovingToolbar, sizeWidth, sourceField,
  } from '../../lib/notes/pictureSize.js';
  import { openerFor } from '../../lib/notes/openers.js';
  import { jumpFor } from '../../lib/notes/warnings.js';
  import '../../lib/notes/openersLoaded.js';
  import { canStateSourceOf, statePostedOf, stateSourceOf } from '../../lib/notes/sources.js';
  import { INTERNAL, editionOf, keepEdition } from '../../lib/notes/editions.svelte.js';
  import { mapsChanged } from '../../lib/notes/mapSettings.svelte.js';
  import { holdScreen } from '../../lib/fullscreen.js';
  import Icon from '../../components/Icon.svelte';
  import PagePreview from '../../components/PagePreview.svelte';
  import EditionSwitch from './EditionSwitch.svelte';
  import FormatSwitch from './FormatSwitch.svelte';
  import HtmlPage from './HtmlPage.svelte';

  let { caseId = '', note = 'case', title = '', text = '', look = null, entities = [], onjump = () => {}, onresize = null } = $props();

  let data = $state(null);
  let pages = $state([]);
  /** Where each block of the PDF starts and its line (`lib/notes/spots.js`). */
  let spots = $state([]);

  /** The preview's right-click menu, `{ at, items }` (`components/ContextMenu`), or null. */
  let menu = $state(null);
  /**
   * The right-click menu over the preview, for what is under the pointer (`said`: the
   * note's `line` it comes from, the `word` under it, the block's `words` or the words
   * selected, a link's `href`, the pointer `at`): every item a shortcut to a double-click,
   * a copy, a link or the whole-screen button.
   */
  function openMenu(said) {
    const items = [
      { label: 'Go to it in the note', icon: 'enter', keys: 'Double-click', disabled: !(said.line >= 0),
        title: 'Write, at the line it comes from, on the word', run: () => onjump(said.line, said.word ? { word: said.word } : undefined) },
      { label: 'Copy the words', icon: 'copy', disabled: !said.words, title: 'The words selected, else the paragraph',
        run: () => void copyText(said.words) },
    ];
    if (said.href) {
      items.push('sep',
        { label: 'Open the link', icon: 'external', title: said.href, run: () => window.open(said.href, '_blank', 'noopener,noreferrer') },
        { label: 'Copy the address', icon: 'link', run: () => void copyText(said.href, { said: 'Address copied' }) });
    }
    items.push('sep', full
      ? { label: 'Back beside the note', icon: 'minimize', keys: 'Esc', run: () => void wholeScreen(false) }
      : { label: 'See it on the whole screen', icon: 'maximize', run: () => void wholeScreen(true) });
    menu = { at: said.at, items };
  }
  /** What a right-click on a PDF page found, read against the blocks the PDF says it holds. */
  function pdfMenu({ index, top, word, lines, href, at }) {
    openMenu({ line: spotLine(spots, pages, index, top), word, words: blockWords(spots, index, top, lines), href, at });
  }
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
  /** PDF or HTML, for a note; a template shows its pages. */
  let format = $state(readFormat('page'));
  const shows = $derived(caseId && format === HTML ? HTML : PDF);
  function setFormat(value) {
    format = value;
    keepFormat('page', value);
  }
  /** The widths the HTML page is read at on the whole screen; Desktop is the screen's own. */
  const WIDTHS = [
    { id: 'desktop', label: 'Desktop', title: 'As wide as the screen' },
    { id: 'tablet', label: 'Tablet', title: '820 px wide, as on a tablet' },
    { id: 'phone', label: 'Phone', title: '390 px wide, as on a phone' },
  ];
  /** The preview's own box, which takes the screen, and whether it holds it (`holdScreen`). */
  let stage = $state(null);
  let full = $state(false);
  /** Which of `WIDTHS` the HTML page is read at there, kept for the visit. */
  let width = $state('desktop');
  let screen = null;
  let screenButton = $state(null);
  let exitButton = $state(null);
  let htmlView = $state(null);
  let pdfView = $state(null);
  /** Where the preview was read to as it took the screen, given back as it leaves. */
  let before = null;
  const viewOf = (format) => (format === HTML ? htmlView : pdfView);

  /** The preview on the whole screen, back in the pane (`on` false), or the other of the two. */
  function wholeScreen(on) {
    if (!stage) return Promise.resolve();
    screen ??= holdScreen(stage, screened, { covered: 'covering' });
    const wanted = on ?? !screen.full;
    if (wanted && !screen.full) before = { format: shows, at: viewOf(shows)?.readTo() };
    return screen.toggle(wanted);
  }

  function screened(on) {
    full = on;
    if (on) {
      void tick().then(() => exitButton?.focus({ preventScroll: true }));
      return;
    }
    const spot = before;
    before = null;
    screenButton?.focus({ preventScroll: true });
    // once the pane has its own size back
    void tick().then(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      if (spot && spot.format === shows) viewOf(shows)?.backTo(spot.at);
    })));
  }
  onDestroy(() => screen?.destroy());

  /** The HTML page drawn last, kept while the next is drawn. */
  let html = $state('');
  let error = $state('');
  /** Whether the PDF, or the HTML page, is being drawn. */
  let drawing = $state({ [PDF]: false, [HTML]: false });
  const busy = $derived(drawing[shows]);
  let warningsFolded = $state(false);
  /** The picture whose caption is being written (`captionKey`), or null. */
  let captioning = $state(null);
  /** The picture whose source is being stated (`captionKey`), or null. */
  let stating = $state(null);
  /** The proof whose address it was posted at is being written (`captionKey`), or null. */
  let posting = $state(null);
  /** Whether each picture's source is the analyst's to state, by record and address. */
  let sourceable = $state({});

  /** The fields of a bookmark or a book its entry in the list of sources reads. */
  const ENTRY_FIELDS = ['author', 'published_at', 'page_title', 'archive_url', 'url', 'publisher', 'year', 'medium'];
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

  /** The field under proof `picture` for where it was posted, holding the address kept. */
  function postedHere(node, picture) {
    const entity = entityOf(picture);
    const field = sourceField({
      help: POSTED_HELP,
      value: postedAddress(entity),
      write: (url) => statePostedOf(caseId, entity, url),
      done: (by) => {
        if (by === 'keyboard') node.previousElementSibling?.querySelector('button.posted')?.focus({ preventScroll: true });
        posting = null;
      },
    });
    node.append(field);
    field.focus({ preventScroll: true });
    field.select();
    return { destroy: () => field.remove() };
  }

  // the PDF and the HTML page each have their own preview; only the one shown speaks in the bar
  const preview = createPreview({
    onresult: (answer) => {
      data = answer.data;
      pages = answer.pages;
      spots = answer.spots ?? [];
      pictures = answer.pictures ?? [];
      if (shows !== PDF) return;
      warnings = answer.warnings ?? [];
      internal = answer.internal ?? 0;
      error = '';
    },
    onerror: (message) => { if (shows === PDF) error = message; },
    onbusy: (flag) => { drawing[PDF] = flag; },
  });
  const page = htmlPreview({
    onresult: (answer) => {
      html = answer.html;
      if (shows !== HTML) return;
      warnings = answer.warnings ?? [];
      internal = answer.internal ?? 0;
      error = '';
    },
    onerror: (message) => { if (shows === HTML) error = message; },
    onbusy: (flag) => { drawing[HTML] = flag; },
  });
  onDestroy(() => {
    preview.stop();
    page.stop();
  });

  const ALIGN_ICONS = { left: ['alignLeft', 'Left'], center: ['alignCentreH', 'Centre'], right: ['alignRight', 'Right'] };
  const percent = (value) => `${(value * 100).toFixed(3)}%`;
  /** How much taller than wide a picture prints, from its box and its page's size. */
  const ratioOf = (picture, size) => (picture.box[2] && size.w ? (picture.box[3] * size.h) / (picture.box[2] * size.w) : 0);

  const captionKey = (picture) => `${picture.line}:${picture.ref}`;

  /**
   * Where a picture prints, read off its line: the place written there, else the
   * place of the `::: center` or `::: right` block it stands in, else left. The
   * server's own word is kept for a picture the text no longer holds.
   */
  function placeOf(picture) {
    const lines = text.split('\n');
    const at = pictureLine(lines, picture.line, picture.ref);
    if (at < 0) return picture.align || 'left';
    return pictureAt(lines, at, picture.ref)?.align || blockAlignAt(lines, at) || 'left';
  }

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
  let lastRequest = null;

  // What the case says of a picture, which prints under it: where it comes from and
  // where it was posted. Stated here, in the note, in Details or by Post, the pages are
  // drawn again at once, as no text changed to ask for them.
  // Who signs prints too: a logo, a signature or a name changed in Settings is drawn
  // again at once, the note beside it untouched; and so is a map, once what is drawn on
  // its card changed the layer it names (`lib/notes/mapSettings.svelte.js`).
  // So is what a source's entry says (who posted a bookmarked page and when, its own title
  // and copy, a book's fields): written in the Link field, read by Archive every link or
  // typed in Details, the list of sources and its cards change with no word of the note.
  const stated = $derived([
    entities
      .filter((entity) => entity.attrs?.source_url || postedAddress(entity))
      .map((entity) => `${entity.id}=${entity.attrs.source_url ?? ''}|${postedAddress(entity)}`)
      .join(','),
    entities
      .filter((entity) => entity.type === 'bookmark' || entity.type === 'publication')
      .map((entity) => `${entity.id}=${entity.label}|${ENTRY_FIELDS.map((key) => entity.attrs?.[key] ?? '').join('|')}`)
      .join(','),
    prefs.picturesRev, prefs.logoRev, prefs.reportName, prefs.reportRole, prefs.reportOrganisation, mapsChanged.rev,
  ].join('\n'));
  let lastStated = null;
  const drawer = () => (shows === HTML ? page : preview);
  $effect(() => {
    const key = stated;
    untrack(() => {
      if (lastStated !== null && key !== lastStated && lastRequest) void drawer().now(lastRequest);
      lastStated = key;
    });
  });
  $effect(() => {
    const request = { caseId, note, title, text, look, edition };
    lastRequest = request;
    const rest = JSON.stringify([caseId, note, title, look, edition, shows]);
    untrack(() => {
      const typed = lastText !== null && rest === lastRest && text !== lastText;
      lastText = text;
      lastRest = rest;
      if (typed) drawer().ask(request);
      else void drawer().now(request);
    });
  });
</script>

<aside class="page-pane" aria-label="Page" data-guide="notebook.page">
  <div class="pane-bar">
    <span class="said">
      {#if shows === HTML}{#if html}As the file reads in a browser{:else if busy}Drawing the page…{:else}&nbsp;{/if}
      {:else if count}{count} page{count === 1 ? '' : 's'}{:else if busy}Drawing the pages…{:else}&nbsp;{/if}
    </span>
    {#if busy && (shows === HTML ? html : count)}<span class="busy" title="Drawing it again">Updating…</span>{/if}
    {#if caseId}<FormatSwitch tight page value={shows} onchange={setFormat} />{/if}
    {#if internal}<EditionSwitch tight value={edition} onchange={setEdition} />{/if}
    {#if warnings.length}
      <button type="button" class="warned" aria-expanded={!warningsFolded} aria-controls="page-warnings"
        title={warningsFolded ? `Show what the ${shows === HTML ? 'HTML page' : 'PDF'} warns about` : 'Hide the warnings'} onclick={() => (warningsFolded = !warningsFolded)}>
        <Icon name="alert" size={12} /> {warnings.length} warning{warnings.length === 1 ? '' : 's'}
        <Icon name={warningsFolded ? 'chevronDown' : 'chevronUp'} size={11} />
      </button>
    {/if}
    <button type="button" class="whole" bind:this={screenButton} aria-label="Full screen" title="Show the preview on the whole screen"
      onclick={() => void wholeScreen(true)}><Icon name="maximize" size={13} /></button>
  </div>
  {#if warnings.length && !warningsFolded}
    <ul class="warnings" id="page-warnings" aria-label="Warnings">
      {#each warnings as warning, index (index)}
        <li>
          {#if Number.isInteger(warning.line)}
            <button type="button" class="warning go" data-kind={warning.kind} title="Go to it in the note" onclick={() => onjump(warning.line, jumpFor(warning))}>
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
  <div class="stage" class:full bind:this={stage} data-width={full && shows === HTML ? width : 'desktop'}>
    {#if full}
      <div class="screen-bar">
        <span class="screen-said">{#if title}<strong>{title}</strong>{/if}
          <span>{#if shows === HTML}As the file reads in a browser{:else if count}{count} page{count === 1 ? '' : 's'}{/if}</span></span>
        <div class="screen-tools">
          {#if caseId}<FormatSwitch tight page value={shows} onchange={setFormat} />{/if}
          {#if shows === HTML}
            <div class="widths" role="group" aria-label="Width">
              {#each WIDTHS as choice (choice.id)}
                <button type="button" class:on={width === choice.id} aria-pressed={width === choice.id} title={choice.title}
                  onclick={() => (width = choice.id)}>{choice.label}</button>
              {/each}
            </div>
          {/if}
        </div>
        <div class="screen-end">
          {#if busy}<span class="busy">Updating…</span>{/if}
          <button type="button" class="exit" bind:this={exitButton} title="Back to the note (Esc)" onclick={() => void wholeScreen(false)}>
            <Icon name="minimize" size={13} /> Exit <kbd>Esc</kbd>
          </button>
        </div>
      </div>
    {/if}
    <div class="view">
      <div class="frame">
        {#if shows === HTML}
          <HtmlPage bind:this={htmlView} {html} label="The note as an HTML page"
            online={(line, word) => onjump(line, word ? { word } : undefined)} onmenu={openMenu} />
        {:else}
          <PagePreview bind:this={pdfView} {data} label="Pages of the PDF" onerror={(message) => (error = message)} onpages={(n) => (count = n)}
            onpage={(index) => onjump(pageLine(pages, index))} overlay={pictures.length ? marks : null}
            ondouble={(index, top, word) => onjump(spotLine(spots, pages, index, top), word ? { word } : undefined)}
            onmenu={pdfMenu} />
        {/if}
      </div>
    </div>
  </div>
</aside>

<ContextMenu {menu} label="The page" onclose={() => (menu = null)} />

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
                aria-pressed={placeOf(picture) === align} onclick={() => onresize(picture, { align })}>
                <Icon name={ALIGN_ICONS[align][0]} size={13} />
              </button>
            {/each}
            <!-- a press while the field is open leaves it open, rather than writing it and opening it again -->
            <button type="button" class="caption" title={CAPTION_HELP.button} aria-expanded={captioning === captionKey(picture)}
              onmousedown={(event) => { if (captioning === captionKey(picture)) event.preventDefault(); }}
              onclick={() => { stating = null; posting = null; captioning = captionKey(picture); }}>Caption</button>
            {#if entity && sourceable[sourceKey(entity)]}
              <button type="button" class="source" title={SOURCE_HELP.button} aria-expanded={stating === captionKey(picture)}
                onclick={() => { captioning = null; posting = null; stating = captionKey(picture); }}>Source…</button>
            {/if}
            {#if entity?.type === 'proof'}
              {@const posted = postedAddress(entity)}
              <button type="button" class="posted" class:kept={Boolean(posted)}
                title={posted ? `${POSTED_HELP.button}. Now: ${posted}` : POSTED_HELP.button}
                aria-expanded={posting === captionKey(picture)}
                onclick={() => { captioning = null; stating = null; posting = captionKey(picture); }}>{posted ? 'Posted ✓' : 'Posted…'}</button>
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
      {#if posting === captionKey(picture) && entity}
        {@const place = captionPlace(picture.box)}
        <div class="caption-here" style:left={place.left} style:width={place.width} style:top={place.top} use:postedHere={picture}></div>
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
  .whole {
    display: inline-flex; align-items: center; justify-content: center; flex: none; width: 22px; height: 22px; margin: -2px -6px -2px -2px;
    padding: 0; border: none; border-radius: var(--r-sm); background: none; color: var(--text-3); cursor: pointer;
  }
  .whole:hover { background: var(--bg-3); color: var(--text-1); }
  .whole:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  /* the preview's own box, which takes the screen: the page in a frame of the width picked */
  .stage { flex: 1; min-height: 0; display: flex; flex-direction: column; background: var(--bg-0); }
  .stage:global(.covering) { position: fixed; inset: 0; z-index: 2000; }
  .view { flex: 1; min-height: 0; display: flex; justify-content: center; }
  .frame { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
  .stage:not([data-width='desktop']) .view { padding: 20px 16px; background: var(--bg-3); }
  .stage[data-width='tablet'] .frame { flex: 0 1 820px; }
  .stage[data-width='phone'] .frame { flex: 0 1 390px; }
  .stage:not([data-width='desktop']) .frame {
    overflow: hidden; border-radius: 10px; box-shadow: 0 0 0 1px var(--border-strong), var(--shadow-2);
  }
  .screen-bar {
    flex: none; display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 16px;
    height: 40px; padding: 0 10px 0 16px; border-bottom: 1px solid var(--border); background: var(--bg-1); color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .screen-said { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .screen-said strong { margin-right: 8px; color: var(--text-1); font-size: var(--fs-sm); font-weight: 600; }
  .screen-tools { display: flex; align-items: center; gap: 10px; }
  .screen-end { display: flex; align-items: center; justify-content: flex-end; gap: 12px; }
  .widths { display: inline-flex; flex: none; border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden; }
  .widths button {
    padding: 2px 9px; border: none; border-left: 1px solid var(--border); background: var(--bg-1); color: var(--text-2);
    font: inherit; font-size: var(--fs-xs); cursor: pointer; white-space: nowrap;
  }
  .widths button:first-child { border-left: none; }
  .widths button:hover:not(.on) { background: var(--bg-3); color: var(--text-1); }
  .widths button.on { background: var(--bg-3); color: var(--text-1); font-weight: 600; box-shadow: inset 0 -2px 0 var(--accent); }
  .widths button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .exit {
    display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 5px 0 9px; border: 1px solid var(--border);
    border-radius: var(--r-md); background: var(--bg-1); color: var(--text-1); font: inherit; cursor: pointer;
  }
  .exit:hover { background: var(--bg-3); }
  .exit:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .exit kbd {
    padding: 0 4px; border: 1px solid var(--border); border-radius: 3px; color: var(--text-3); font: inherit; font-size: 10px; line-height: 15px;
  }
  /* a narrow window (the extension's panel): the switches and Exit, the title left out */
  @media (max-width: 640px) {
    .screen-bar { grid-template-columns: auto minmax(0, 1fr); padding-left: 10px; }
    .screen-said { display: none; }
  }
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
  .picture-bar button.caption, .picture-bar button.source, .picture-bar button.posted { margin-left: 4px; padding: 0 8px; white-space: nowrap; }
  .picture-bar button.posted.kept { color: var(--accent); }
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
