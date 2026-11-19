<script>
  /**
   * The infographic builder, beside the note while the page is drawn in it: the title band,
   * the panels in reading order (drag to reorder, half or wide, add one, take one out), the
   * look, one legend for a colour column the charts share, its colours, Export as a picture
   * and To Post.
   *
   * Every press writes the block's own text through the editor as one change, so one Undo
   * (`lib/notes/editor/infographicText.js` says what each writes). The builder holds nothing
   * of its own: it reads the infographic again from the note each time, the `k`-th of the
   * note, so typing above it keeps it found.
   *
   * "Add a panel" shows each table of the note drawn as every kind it fits by the chart's own
   * kind picker (`POST /notes/figure/kinds`), from its real rows, and the note's maps; the
   * analyst picks one by its picture and it is written as a chart under its table would be
   * (`editor/infographicPanels.js`). Every kind from scratch follows, the picker's own cards:
   * the one picked is written with its columns and no row, and its form opens in its card
   * (`editor/chartForm.js`). Nothing is made of numbers the note does not hold.
   *
   * Pressing a chart's row opens the chart's own settings card (`editor/chartCard.js`) under
   * it: title, what it counts, by what, coloured by what, and Edit the data, the kind's form;
   * each choice writes that panel's lines inside the infographic, one Undo each. The look is
   * the page's, set once below.
   */
  import { untrack } from 'svelte';
  import { api } from '../../lib/api.js';
  import { toast } from '../../lib/state.svelte.js';
  import { layerPalette } from '../../lib/map/layerPalette.svelte.js';
  import { noteToPost } from '../../lib/notes/toPost.js';
  import { drawingOf } from '../../lib/notes/editor/infographicBlock.js';
  import {
    EACH_PANEL, HALF, KEY_FIGURES_PANEL, LOOKS, WIDE, WORDS_PANEL, addPanel, infographicsIn, movePanel, panelText, readInfographic,
    removePanel, withLegend, withPanelText, withSetting, withWidth,
  } from '../../lib/notes/editor/infographicText.js';
  import { chartPanel, noteMaps, noteTables } from '../../lib/notes/editor/infographicPanels.js';
  import { chartKinds, drawChart } from '../../lib/notes/editor/chartFigure.js';
  import { chartForm, chartSettings, rowsSaid, scratchGallery, starterBlock } from '../../lib/notes/editor/chartCard.js';
  import { readChart, withSettings } from '../../lib/notes/editor/chartText.js';
  import Icon from '../../components/Icon.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';

  let {
    caseId,
    noteId = null,
    /** The note as it is now (its doc's text): the builder reads its infographic from it. */
    text = '',
    /** The note editor's handle: `text()` and `replace(from, to, insert, expected)`. */
    editor,
    /** Where the infographic asked for stands in the note (an offset in it), and the panel pressed. */
    from = 0,
    panel = null,
    onclose,
  } = $props();

  /** The looks, said as the export dialog says them. */
  const LOOK_WORDS = { report: 'Report', book: 'Book', dark: 'Dark' };
  const LOOK_HINTS = { report: 'Light paper, the reference', book: 'Beige paper, red and black, a printed book', dark: 'Dark, like the map plates' };
  /** The pictures Export makes: the destination the route draws, its name, its line. */
  const SIZES = [
    { size: 'x', label: 'X, 16:9', hint: 'A post on X, panels set side by side' },
    { size: 'portrait', label: '4:5', hint: 'Taller, for a feed' },
    { size: 'square', label: '1:1', hint: 'Square' },
    { size: 'page', label: 'PDF page', hint: 'The page as the PDF prints it' },
    { size: 'svg', label: 'SVG', hint: 'For a designer: shapes and words kept' },
  ];
  const KIND_WORDS = { chart: 'Chart', map: 'Map', words: 'Words' };
  const PANEL_ICONS = { chart: 'chart', map: 'mapArea', words: 'text' };

  // the k-th infographic of the note, k found once from where it was asked
  const k = (() => {
    const found = infographicsIn(text);
    const inside = found.findIndex((one) => from >= one.from && from <= one.to);
    if (inside >= 0) return inside;
    const after = found.findIndex((one) => one.from >= from);
    return after >= 0 ? after : Math.max(0, found.length - 1);
  })();
  const block = $derived(infographicsIn(text)[k] ?? null);
  const read = $derived(block ? readInfographic(block.source) : null);
  const noteKey = $derived(noteId && noteId !== 'case' ? noteId : '');

  let drawing = $state(null);
  $effect(() => {
    const source = block?.source;
    if (!source || !caseId) { drawing = null; return; }
    let live = true;
    drawingOf(caseId, noteKey, source).then((drawn) => { if (live) drawing = drawn?.error ? null : drawn; });
    return () => { live = false; };
  });

  /** Write the infographic again through the editor, as one change: one Undo. */
  function edit(transform) {
    const now = editor?.text?.() ?? '';
    const one = infographicsIn(now)[k];
    if (!one) return false;
    const next = transform(one.source);
    if (next === one.source) return false;
    return Boolean(editor.replace(one.from, one.to, next, one.source));
  }

  // -- the title band ------------------------------------------------------------------
  function setBand(key, value) {
    edit((source) => withSetting(source, key, value));
  }
  function bandKey(event) {
    if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
  }

  // -- the panels ----------------------------------------------------------------------
  let dragging = $state(-1);
  let over = $state(-1);
  // the panel pressed in the note, picked once when the builder opens
  let focused = $state((() => panel)());
  function drop(target) {
    // a title typed in a card is written first, to the panel it is about
    if (dragging >= 0 && target >= 0 && dragging !== target) {
      closeCard();
      edit((source) => movePanel(source, dragging, target));
    }
    dragging = -1;
    over = -1;
  }
  function rowKey(event, index) {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const to = index + (event.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= (read?.panels.length ?? 0)) return;
    closeCard();
    if (edit((source) => movePanel(source, index, to))) focused = to;
  }
  function remove(index) {
    closeCard();
    edit((source) => removePanel(source, index));
  }

  // -- a chart panel's settings: the chart's own card, writing inside the page ---------
  /** The panel whose card is open, its index, or -1, and whether it shows its settings or its form. */
  let carded = $state(-1);
  let cardForm = $state(false);
  let cardHost = $state(null);
  let cardDrawn = $state(null);
  let card = null;
  const cardText = $derived(carded >= 0 && block ? panelText(block.source, carded) : '');
  function closeCard() {
    card?.commit();
    card?.destroy();
    card = null;
    carded = -1;
    cardForm = false;
    cardDrawn = null;
  }
  function pressRow(index, one) {
    focused = index;
    if (one.kind !== 'chart') return;
    if (carded === index) { closeCard(); return; }
    closeCard();
    carded = index;
  }
  // the card is drawn once its place is, and drawn again as the panel's lines change
  $effect(() => {
    const host = cardHost;
    const index = carded;
    const form = cardForm;
    if (!host || index < 0) return;
    // made once per panel opened: what it reads later is read when it is drawn again, not here
    let made = null;
    untrack(() => {
      host.replaceChildren();
      host.classList.remove('cf-form');
      const write = (changes) => edit((source) => withPanelText(source, index, withSettings(panelText(source, index), changes)));
      made = card = form
        ? chartForm(host, {
          state: () => ({ source: block ? panelText(block.source, index) : '', drawn: cardDrawn }),
          write: (next) => edit((source) => withPanelText(source, index, next)),
          caseId,
          onClose: () => { card?.commit(); cardForm = false; },
        })
        : chartSettings(host, {
          state: () => {
            const now = block ? panelText(block.source, index) : '';
            return { chart: readChart(now), drawn: cardDrawn };
          },
          write,
          editData: () => { card?.commit(); cardForm = true; },
        });
      card.focus();
    });
    // a picker the card opened goes with it, the builder closed included
    return () => made?.destroy();
  });
  $effect(() => {
    const now = cardText;
    if (!now || !caseId) return;
    let live = true;
    drawChart({ caseId, noteId: noteKey, text: now }).then((answer) => {
      if (!live) return;
      cardDrawn = answer?.error ? null : answer;
      untrack(() => card?.refresh());
    });
    untrack(() => card?.refresh());
    return () => { live = false; };
  });
  function panelName(one) {
    if (one.kind === 'chart' && one.chartKind) return one.chartKind[0].toUpperCase() + one.chartKind.slice(1);
    return KIND_WORDS[one.kind] ?? one.kind;
  }

  // -- add a panel ---------------------------------------------------------------------
  let adding = $state(false);
  /** Each table of the note with the kinds it fits, as the chart's kind picker draws them. */
  let galleries = $state([]);
  let maps = $state([]);
  async function openAdd() {
    adding = !adding;
    if (!adding) return;
    const now = editor?.text?.() ?? text;
    maps = noteMaps(now);
    const tables = noteTables(now);
    galleries = tables.map((found) => ({ found, answer: null }));
    tables.forEach((found, at) => {
      chartKinds({ caseId, noteId: noteKey, text: now.slice(found.from, found.to) }).then((answer) => {
        // the list is the state's own copy: a table is known again by its line
        if (galleries[at]?.found.line === found.line) galleries[at] = { found, answer };
      });
    });
  }
  function add(made, width = '') {
    if (edit((source) => addPanel(source, made, width))) {
      adding = false;
      focused = (read?.panels.length ?? 1) - 1;
    }
  }
  /** The chart a kind picked makes of its table, written as one under the table would be. */
  function addChart(found, kind) {
    add(chartPanel(editor?.text?.() ?? text, found, kind, noteKey));
  }
  /** A chart of a kind from scratch: its columns and no row, its form open in its card. */
  function addScratch(kind) {
    const at = read?.panels.length ?? 0;
    closeCard();
    add(starterBlock(kind));
    carded = at;
    cardForm = true;
  }
  /** The picker's own cards of every kind from scratch, in the offers. */
  function scratchKinds(node) {
    scratchGallery(node, addScratch);
  }

  // -- look, legend, colours -----------------------------------------------------------
  const lookNow = $derived(read?.settings.look?.value?.toLowerCase() || drawing?.look || 'report');
  const sharing = $derived(String(read?.settings.legend?.value ?? '').toLowerCase() !== EACH_PANEL);
  const column = $derived(drawing?.legend?.column ?? '');
  const colours = $derived(drawing?.legend?.values ?? []);
  const ownColours = $derived(colours.filter((one) => one.origin === 'order'));
  $effect(() => { if (caseId) layerPalette.load(caseId); });
  async function keepColours() {
    try {
      await layerPalette.keep(caseId, ownColours);
      toast('Kept for the case: every chart, map and layer paints them the same', 'ok', 4000);
    } catch (error) {
      toast(`Colours not kept: ${error.message}`, 'warn');
    }
  }
  const ORIGIN_WORDS = { case: 'the case’s', grade: 'grade ramp', order: 'this page’s', chart: 'the chart’s', highlight: 'highlight' };

  // -- out of the note -----------------------------------------------------------------
  let exportAnchor = $state(null);
  async function exportPicture(size) {
    exportAnchor = null;
    if (!block) return;
    const format = size === 'svg' ? 'svg' : 'png';
    try {
      const { data } = await api.postBytes(`/api/cases/${encodeURIComponent(caseId)}/notes/infographic`,
        { text: block.source, note: noteKey, format, size: size === 'svg' ? 'page' : size });
      const blob = new Blob([data], { type: format === 'svg' ? 'image/svg+xml' : 'image/png' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      const name = (read?.settings.title?.value || 'infographic').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'infographic';
      link.download = `${name}-${size}.${format}`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 4000);
    } catch (error) {
      toast(`Picture not made: ${error.message}`, 'warn');
    }
  }
  async function toPost() {
    const now = editor?.text?.() ?? text;
    const one = infographicsIn(now)[k];
    if (!one || !noteKey) return;
    try {
      await noteToPost(caseId, noteKey, now, { from: one.from, to: one.to });
    } catch (error) {
      toast(`Not sent to Post: ${error.message}`, 'warn');
    }
  }
</script>

<aside class="ib" aria-label="Infographic builder">
  <header class="ib-bar">
    <Icon name="grid" size={15} />
    <h2 class="ib-name">Infographic</h2>
    <button type="button" class="btn btn-ghost btn-xs" title="Close the builder" aria-label="Close the builder" onclick={() => onclose?.()}>
      <Icon name="x" size={14} /></button>
  </header>
  {#if !read}
    <p class="ib-none">This infographic is no longer in the note.</p>
  {:else}
    <div class="ib-scroll">
      <section class="ib-part" aria-labelledby="ib-band">
        <h3 class="ib-head" id="ib-band">Title band</h3>
        <label class="ib-field"><span class="ib-word">Kicker</span>
          <input class="input" value={read.settings.kicker?.value ?? ''} placeholder="Place · period" title="The small line above the title"
            onchange={(event) => setBand('kicker', event.currentTarget.value)} onkeydown={bandKey} /></label>
        <label class="ib-field"><span class="ib-word">Title</span>
          <input class="input" value={read.settings.title?.value ?? ''} placeholder="At least … : say what the page counts" title="What the page says, a count said as at least when it is a floor"
            onchange={(event) => setBand('title', event.currentTarget.value)} onkeydown={bandKey} /></label>
        <label class="ib-field"><span class="ib-word">Standfirst</span>
          <textarea class="textarea" rows="2" value={read.settings.standfirst?.value ?? ''} placeholder="Every figure is a minimum: …"
            title="One or two sentences under the title"
            onchange={(event) => setBand('standfirst', event.currentTarget.value)}></textarea></label>
      </section>

      <section class="ib-part" aria-labelledby="ib-panels">
        <h3 class="ib-head" id="ib-panels">Panels <span class="ib-aside">drag to reorder</span></h3>
        <ol class="ib-panels">
          {#each read.panels as one, index (`${index}:${one.kind}:${one.title}`)}
            <li class="ib-panel" class:ib-over={over === index && dragging !== index} class:ib-picked={focused === index}
              draggable="true"
              ondragstart={(event) => { dragging = index; event.dataTransfer?.setData('text/plain', String(index)); }}
              ondragover={(event) => { if (dragging >= 0) { event.preventDefault(); over = index; } }}
              ondragleave={() => { if (over === index) over = -1; }}
              ondrop={(event) => { event.preventDefault(); drop(index); }}
              ondragend={() => { dragging = -1; over = -1; }}>
              <span class="ib-grip" title="Drag to reorder, or Alt+↑ and Alt+↓"><Icon name="grip" size={13} /></span>
              <Icon name={PANEL_ICONS[one.kind] ?? 'chart'} size={13} />
              <button type="button" class="ib-panel-name" aria-expanded={one.kind === 'chart' ? carded === index : undefined}
                title={one.kind === 'chart' ? `${one.title || panelName(one)} · its settings · Alt+↑ and Alt+↓ move it`
                  : `${one.title || panelName(one)} · Alt+↑ and Alt+↓ move it`}
                onfocus={() => (focused = index)} onclick={() => pressRow(index, one)} onkeydown={(event) => rowKey(event, index)}>
                <span class="ib-panel-title">{one.title || panelName(one)}</span>
                {#if one.title}<span class="ib-panel-kind">{panelName(one)}</span>{/if}
              </button>
              <span class="ib-widths" role="group" aria-label="Width">
                <button type="button" class="ib-width" aria-pressed={one.width === HALF} title="Half the page: a column"
                  onclick={() => edit((source) => withWidth(source, index, HALF))}>Half</button>
                <button type="button" class="ib-width" aria-pressed={one.width === WIDE} title="Across the page"
                  onclick={() => edit((source) => withWidth(source, index, WIDE))}>Wide</button>
              </span>
              <button type="button" class="ib-remove" title="Take this panel out" aria-label={`Take out ${one.title || panelName(one)}`}
                onclick={() => remove(index)}><Icon name="x" size={12} /></button>
            </li>
            {#if carded === index}
              <li class="ib-card-row">
                <div class="ib-card" bind:this={cardHost}></div>
                {#if !cardForm}<p class="ib-note">The look is the page’s, set under Look.</p>{/if}
              </li>
            {/if}
          {/each}
        </ol>
        <button type="button" class="ib-add" aria-expanded={adding} onclick={openAdd}>
          <Icon name="plus" size={13} /> Add a panel: a chart, a map, words</button>
        {#if adding}
          <div class="ib-offers" role="region" aria-label="Add a panel">
            {#each galleries as gallery (gallery.found.line)}
              <div class="ib-table">
                <p class="ib-table-name">{gallery.found.heading || 'A table'}
                  <span class="ib-aside">{rowsSaid(gallery.found.table.rows.length)}</span></p>
                {#if !gallery.answer}
                  <p class="ib-note">Drawing each kind from these rows…</p>
                {:else if gallery.answer.error}
                  <p class="ib-note">Not drawn: {gallery.answer.error}</p>
                {:else}
                  <div class="ib-kinds">
                    {#each gallery.answer.kinds as kind (kind.kind)}
                      <button type="button" class="ib-kind" title={kind.title ? `${kind.label}: ${kind.title}` : kind.label}
                        aria-label={kind.title ? `${kind.label}: ${kind.title}` : kind.label} onclick={() => addChart(gallery.found, kind)}>
                        <span class="ib-thumb" aria-hidden="true">{@html kind.svg}</span>
                        <span class="ib-kind-name">{kind.label}</span>
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
            <div class="ib-table">
              <p class="ib-table-name">From scratch <span class="ib-aside">a form for any kind</span></p>
              <div class="ib-scratch" use:scratchKinds></div>
            </div>
            <div class="ib-more">
                {#each maps as map, index (index)}
                  <button type="button" class="btn btn-sm" title="This map of the note, as a panel" onclick={() => add(map.block)}>
                    <Icon name="mapArea" size={13} /> {map.title || 'Map'}</button>
                {:else}
                  <span class="ib-note" title="/ › Interactive map puts one in the note">No map in this note yet</span>
                {/each}
                <button type="button" class="btn btn-sm" title="A heading and a few words" onclick={() => add(WORDS_PANEL)}>
                  <Icon name="text" size={13} /> Words</button>
                <button type="button" class="btn btn-sm" title="Big figures with the words under them, to fill in" onclick={() => add(KEY_FIGURES_PANEL)}>
                  <Icon name="hash" size={13} /> Key figures</button>
            </div>
          </div>
        {/if}
      </section>

      <section class="ib-part" aria-labelledby="ib-look">
        <h3 class="ib-head" id="ib-look">Look</h3>
        <span class="ib-looks" role="group" aria-labelledby="ib-look">
          {#each LOOKS as name (name)}
            <button type="button" class="ib-look" aria-pressed={lookNow === name} title={LOOK_HINTS[name]}
              onclick={() => edit((source) => withSetting(source, 'look', name === 'report' ? '' : name))}>{LOOK_WORDS[name]}</button>
          {/each}
        </span>
      </section>

      <section class="ib-part" aria-labelledby="ib-colours">
        <h3 class="ib-head" id="ib-colours">Colours <span class="ib-aside">kept by the case</span></h3>
        <label class="ib-switch" title={column ? `Charts coloured by ${column} share one legend at the top, every value kept` : 'Charts that colour by the same column share one legend'}>
          <input type="checkbox" role="switch" checked={sharing} onchange={(event) => edit((source) => withLegend(source, event.currentTarget.checked))} />
          <span>One legend{column ? ` for ${column}` : ''}, at the top</span>
        </label>
        {#if colours.length}
          <ul class="ib-colours">
            {#each colours as one (one.value)}
              <li class="ib-colour">
                <span class="ib-swatch" class:ib-hatch={one.hatch} class:ib-outline={one.outline} style={`--swatch:${one.colour}`}></span>
                <span class="ib-colour-name">{one.value}</span>
                <span class="ib-colour-from" title="Where the colour comes from">{ORIGIN_WORDS[one.origin] ?? ''}</span>
                <code class="ib-hex">{one.colour}</code>
              </li>
            {/each}
          </ul>
          {#if ownColours.length}
            <button type="button" class="btn btn-sm" title="Name these colours in the case, so every chart, map and layer paints them the same"
              onclick={keepColours}>Keep these colours for the case</button>
          {/if}
        {:else}
          <p class="ib-note">No colour column shared by two charts yet.</p>
        {/if}
      </section>

      {#if drawing?.warnings?.length}
        <section class="ib-part" aria-labelledby="ib-check">
          <h3 class="ib-head" id="ib-check">The check says</h3>
          <ul class="ib-warnings">
            {#each drawing.warnings as warning, index (index)}
              <li class="ib-warning" data-kind={warning.kind}>{warning.message}</li>
            {/each}
          </ul>
        </section>
      {/if}
    </div>
    <footer class="ib-foot">
      <button type="button" class="btn btn-primary btn-sm" aria-haspopup="menu" title="One picture of the whole page"
        onclick={(event) => (exportAnchor = exportAnchor ? null : event.currentTarget)}>
        <Icon name="download" size={13} /> Export as a picture <Icon name="chevronDown" size={12} /></button>
      <button type="button" class="btn btn-sm" title="Open Post with the page as one picture, nothing posted" disabled={!noteKey} onclick={toPost}>
        <Icon name="post" size={13} /> To Post</button>
    </footer>
  {/if}
</aside>

{#if exportAnchor}
  <FloatingMenu anchor={exportAnchor} width={250} label="Export as a picture" onclose={() => (exportAnchor = null)}>
    {#each SIZES as one (one.size)}
      <button type="button" class="fm-item" title={one.hint} onclick={() => exportPicture(one.size)}>
        <span class="fm-grow">{one.label}</span><span class="ib-aside">{one.hint}</span></button>
    {/each}
  </FloatingMenu>
{/if}

<style>
  .ib { display: flex; flex-direction: column; min-height: 0; min-width: 0; border-left: 1px solid var(--border); background: var(--bg-1); }
  .ib-bar { display: flex; align-items: center; gap: 8px; padding: 6px 10px 6px 14px; border-bottom: 1px solid var(--border); color: var(--text-2); }
  .ib-name { flex: 1; margin: 0; font-size: var(--fs-sm); font-weight: 650; color: var(--text-1); }
  .ib-scroll { flex: 1; min-height: 0; overflow: auto; }
  .ib-none { margin: 0; padding: 16px 14px; color: var(--text-3); font-size: var(--fs-sm); }
  .ib-part { padding: 12px 14px 14px; border-bottom: 1px solid var(--border); }
  .ib-head {
    display: flex; align-items: baseline; justify-content: space-between; margin: 0 0 8px; color: var(--text-3);
    font-size: var(--fs-xs); font-weight: 650; letter-spacing: .06em; text-transform: uppercase;
  }
  .ib-aside { color: var(--text-3); font-size: var(--fs-xs); font-weight: 400; letter-spacing: 0; text-transform: none; }
  .ib-field { display: flex; flex-direction: column; gap: 3px; margin-bottom: 8px; }
  .ib-word { color: var(--text-3); font-size: var(--fs-xs); }
  .ib-field .textarea { resize: vertical; min-height: 44px; }
  .ib-panels { list-style: none; margin: 0 0 6px; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .ib-panel {
    display: flex; align-items: center; gap: 6px; padding: 3px 4px 3px 2px; border-radius: var(--r-sm); color: var(--text-2);
    border: 1px solid transparent;
  }
  .ib-panel:hover { background: var(--bg-2); }
  .ib-panel.ib-picked { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 7%, transparent); }
  .ib-panel.ib-over { box-shadow: inset 0 2px 0 var(--accent); }
  .ib-grip { display: inline-flex; color: var(--text-3); cursor: grab; }
  .ib-panel-name {
    flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; padding: 1px 0; border: none; background: none;
    color: var(--text-1); font: inherit; font-size: var(--fs-sm); line-height: 1.25; text-align: left; cursor: pointer;
  }
  .ib-panel-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ib-panel-kind { color: var(--text-3); font-size: var(--fs-xs); }
  .ib-widths, .ib-looks { display: inline-flex; border: 1px solid var(--border-strong); border-radius: var(--r-sm); overflow: hidden; }
  .ib-width, .ib-look {
    padding: 2px 7px; border: none; background: transparent; color: var(--text-2); font: inherit; font-size: var(--fs-xs); cursor: pointer;
  }
  .ib-look { padding: 4px 14px; font-size: var(--fs-sm); }
  .ib-width + .ib-width, .ib-look + .ib-look { border-left: 1px solid var(--border-strong); }
  .ib-width[aria-pressed='true'], .ib-look[aria-pressed='true'] { background: var(--bg-3); color: var(--text-1); font-weight: 650; }
  .ib-width:hover, .ib-look:hover { color: var(--text-1); }
  .ib-remove {
    display: inline-flex; padding: 3px; border: none; border-radius: var(--r-sm); background: none; color: var(--text-3); cursor: pointer;
  }
  .ib-remove:hover, .ib-remove:focus-visible { color: var(--danger); background: var(--bg-3); }
  .ib-add {
    display: inline-flex; align-items: center; gap: 6px; padding: 4px 2px; border: none; background: none; color: var(--accent);
    font: inherit; font-size: var(--fs-sm); cursor: pointer;
  }
  .ib-add:hover, .ib-add:focus-visible { text-decoration: underline; }
  .ib-offers { margin-top: 8px; padding: 10px; border: 1px solid var(--border); border-radius: var(--r-md, 6px); background: var(--bg-0); }
  .ib-table + .ib-table { margin-top: 12px; }
  .ib-table-name { margin: 0 0 6px; font-size: var(--fs-sm); color: var(--text-1); font-weight: 600; }
  .ib-kinds { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
  .ib-kind {
    display: flex; flex-direction: column; gap: 4px; padding: 5px; border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-1); color: var(--text-2); font: inherit; font-size: var(--fs-xs); cursor: pointer; text-align: center;
  }
  .ib-kind:hover, .ib-kind:focus-visible { border-color: var(--accent); color: var(--text-1); }
  .ib-thumb { display: block; height: 92px; overflow: hidden; border-radius: 3px; background: #fff; }
  .ib-thumb :global(svg) { display: block; width: 100%; height: 100%; }
  .ib-more { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 12px; }
  .ib-note { margin: 0; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.4; }
  .ib-switch { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; color: var(--text-1); font-size: var(--fs-sm); cursor: pointer; }
  .ib-colours { list-style: none; margin: 0 0 10px; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .ib-colour { display: flex; align-items: center; gap: 8px; font-size: var(--fs-sm); color: var(--text-1); }
  .ib-swatch { flex: none; width: 13px; height: 13px; border-radius: 3px; background: var(--swatch); }
  .ib-swatch.ib-hatch { background: repeating-linear-gradient(45deg, var(--swatch) 0 2px, color-mix(in srgb, var(--swatch) 40%, #fff) 2px 5px); }
  .ib-swatch.ib-outline { background: transparent; box-shadow: inset 0 0 0 1.5px var(--swatch); }
  .ib-colour-name { flex: 1; min-width: 0; }
  .ib-colour-from { color: var(--text-3); font-size: var(--fs-xs); }
  .ib-hex { color: var(--text-3); font-size: var(--fs-xs); }
  .ib-warnings { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: var(--fs-xs); color: var(--text-1); }
  .ib-warning { display: flex; gap: 6px; line-height: 1.4; }
  .ib-warning::before { content: ''; flex: none; width: 5px; height: 5px; margin-top: .45em; border-radius: 50%; background: var(--warn); }
  .ib-warning[data-kind='missing']::before { background: var(--danger); }
  .ib-card-row { list-style: none; padding: 2px 0 8px 22px; }
  .ib-card { display: flex; flex-direction: column; gap: 9px; padding: 10px; border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-2); }
  .ib-card :global(.cm-chart-field) { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .ib-card :global(.cm-chart-field-name) { color: var(--text-3); font-size: var(--fs-xs); }
  .ib-card :global(.cm-chart-columns) { display: flex; flex-direction: column; gap: 8px; }
  .ib-card :global(.cm-chart-looks), .ib-card :global([hidden]) { display: none; }
  .ib-card :global(.cm-chart-select), .ib-card :global(.cm-chart-title) {
    box-sizing: border-box; width: 100%; min-height: 28px; padding: 4px 8px; border: 1px solid var(--border-strong); border-radius: 5px;
    background: var(--bg-1); color: var(--text-1); font: inherit; font-size: var(--fs-sm); outline: none;
  }
  .ib-card :global(.cm-chart-title) { resize: none; line-height: 1.4; font-weight: 600; overflow: hidden; }
  .ib-card :global(.cm-chart-select:focus), .ib-card :global(.cm-chart-title:focus) { border-color: var(--accent); }
  .ib-card :global(.cm-chart-proposed) { color: var(--text-3); font-size: var(--fs-xs); }
  .ib-card :global(.cm-chart-proposed em) { color: var(--text-2); }
  .ib-card :global(.cm-chart-use) {
    margin-left: 6px; padding: 0; border: none; background: none; color: var(--accent); font: inherit; cursor: pointer; text-decoration: underline;
  }
  .ib-card-row > .ib-note { margin-top: 4px; }
  /* a kind from scratch: the picker's cards, two across; its form in the card, its rows wrapping */
  .ib-scratch { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
  .ib-scratch :global(.cf-scratch) {
    display: flex; align-items: center; gap: 8px; min-width: 0; padding: 6px; border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-1); font: inherit; text-align: left; cursor: pointer;
  }
  .ib-scratch :global(.cf-scratch:hover), .ib-scratch :global(.cf-scratch:focus-visible) { border-color: var(--accent); outline: none; }
  .ib-scratch :global(.cf-sketch), .ib-scratch :global(.cf-sketch svg) { width: 40px; height: 25px; }
  .ib-scratch :global(.cf-scratch-needs) { font-size: 10.5px; }
  .ib-card:global(.cf-form) { padding: 10px; border-bottom: none; }
  .ib-foot { display: flex; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--border); background: var(--bg-1); }
</style>
