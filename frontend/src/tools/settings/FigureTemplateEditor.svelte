<script>
  /**
   * A figure template edited in Settings, its sketch beside it: the template is the block's
   * own text (`{ figure, text }`, `engine/figuretemplates.py`), each change written with the
   * Notebook's own writers, so what is saved reads as a figure of a note would.
   *
   * - **an infographic**: the band's words every page starts with (left empty, each page
   *   writes its own), the look, one legend or one per chart, and its panels: moved, half or
   *   wide, taken out, added (a chart of any kind, a map, words); a chart's kind and the
   *   names of the columns it reads, a map's look, a words panel's words;
   * - **a chart**: its kind, its columns' names and its style;
   * - **a map**: its look, as its card sets it: base, size, legend, north arrow, scale, the
   *   names, crowds, the timeline and Play, what a card shows.
   *
   * A template holds no row, title, source, layer or place: the server takes them out on save.
   */
  import Icon from '../../components/Icon.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import FigureTemplateSketch from './FigureTemplateSketch.svelte';
  import { FORMS, starterBlock } from '../../lib/notes/editor/chartFormText.js';
  import { readChart, setting, withSettings } from '../../lib/notes/editor/chartText.js';
  import {
    EACH_PANEL, HALF, WIDE, WORDS_PANEL, addPanel, movePanel, panelText, readInfographic, removePanel, withLegend, withPanelText,
    withSetting, withWidth,
  } from '../../lib/notes/editor/infographicText.js';
  import { CARD_PARTS, readMap, withMapSettings } from '../../lib/notes/editor/mapText.js';
  import {
    BASE_NAMES, CARD_NAMES, LABEL_NAMES, LEGEND_NAMES, SCALE_NAMES, SIZE_NAMES, SPEED_NAMES,
  } from '../../lib/notes/editor/mapCard.js';
  import {
    ROLE_WORDS, chartColumns, columnRole, countsRows, figureSaid, kindChoices, kindLabel, mapSaid, renameColumn, templatePanels,
  } from '../../lib/notes/figureTemplates.js';

  let { data = $bindable() } = $props();

  const figure = $derived(data?.figure ?? 'infographic');
  const text = $derived(data?.text ?? '');
  const read = $derived(figure === 'infographic' ? readInfographic(text) : null);
  const panels = $derived(figure === 'infographic' ? templatePanels(text) : []);

  /** Write the template's text again. */
  function set(next) {
    if (next !== text) data = { ...data, text: next };
  }

  const LOOKS = [{ value: '', label: 'As the note' }, { value: 'report', label: 'Report' }, { value: 'book', label: 'Book' }, { value: 'dark', label: 'Dark' }];
  const BAND = [
    { key: 'kicker', label: 'Kicker', hint: 'The small line above the title' },
    { key: 'title', label: 'Title', hint: 'What the page says' },
    { key: 'standfirst', label: 'Standfirst', hint: 'One or two sentences under the title' },
  ];
  const PANEL_ICONS = { chart: 'chart', map: 'mapArea', words: 'text' };

  // -- the panels --
  let open = $state(-1);
  let addAnchor = $state(null);
  let kindsOpen = $state(false);

  function panelName(panel) {
    if (panel.kind === 'chart') return kindLabel(panel.chartKind);
    return panel.kind === 'map' ? 'Map' : 'Words';
  }
  function panelSaid(panel) {
    if (panel.kind === 'map') return mapSaid(panel.text);
    if (panel.kind === 'words') return panel.text.split('\n').find((line) => line.trim())?.replace(/^#+\s*/, '') ?? '';
    if (panel.chartKind === 'key figures') return 'Typed in each page';
    return panel.columns.length ? `Reads ${panel.columns.join(', ')}` : 'Reads no column';
  }
  function move(index, to) {
    if (to < 0 || to >= panels.length) return;
    set(movePanel(text, index, to));
    if (open === index) open = to;
  }
  function rowKey(event, index) {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    move(index, index + (event.key === 'ArrowUp' ? -1 : 1));
  }
  function remove(index) {
    set(removePanel(text, index));
    if (open === index) open = -1;
  }
  function add(made) {
    addAnchor = null;
    kindsOpen = false;
    set(addPanel(text, made));
    open = panels.length;
  }
  const writePanel = (index) => (next) => set(withPanelText(text, index, next));

  // -- a chart --
  function setKind(source, kind, write) {
    const chart = readChart(source);
    const changes = { kind };
    const form = FORMS[kind];
    // a kind of parts is drawn by one column: a colour column becomes its parts
    if (form?.colours && !form.split && setting(chart, 'colour by')) {
      changes.by = setting(chart, 'colour by');
      changes['colour by'] = '';
    }
    write(withSettings(source, changes));
  }
  function rename(source, column, event, write) {
    const next = renameColumn(source, column, event.currentTarget.value);
    if (next === source) event.currentTarget.value = column;
    else write(next);
  }
  function columnKey(event) {
    if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
  }

  // -- a map --
  /** What a map's card shows, each part on or off. */
  function cardParts(source) {
    const card = readMap(source).card;
    return card === null ? [...CARD_PARTS] : card;
  }
  function toggleCard(source, part, write) {
    const now = cardParts(source);
    const next = now.includes(part) ? now.filter((one) => one !== part) : CARD_PARTS.filter((one) => one === part || now.includes(one));
    write(withMapSettings(source, { card: next.length === CARD_PARTS.length ? '' : next.join(', ') || 'none' }));
  }
</script>

{#snippet seg(label, options, value, onpick)}
  <div class="fte-field">
    <span class="fte-word">{label}</span>
    <div class="fte-seg" role="radiogroup" aria-label={label}>
      {#each options as option (option.value)}
        <button type="button" class="fte-seg-btn" class:on={option.value === value} role="radio" aria-checked={option.value === value}
          title={option.title ?? option.label} onclick={() => option.value !== value && onpick(option.value)}>{option.label}</button>
      {/each}
    </div>
  </div>
{/snippet}

{#snippet chartFields(source, write)}
  {@const kind = (setting(readChart(source), 'kind') || 'bars').toLowerCase()}
  {@const choices = kindChoices(kind)}
  {@const columns = chartColumns(source)}
  <div class="fte-field">
    <span class="fte-word">Kind</span>
    {#if choices.length > 1}
      <select class="fte-select" aria-label="Kind" value={kind} onchange={(event) => setKind(source, event.currentTarget.value, write)}>
        {#each choices as one (one)}<option value={one}>{kindLabel(one)}</option>{/each}
      </select>
    {:else}
      <span class="fte-fixed">{kindLabel(kind)}</span>
    {/if}
  </div>
  {#if kind === 'key figures'}
    <p class="fte-note">Key figures are typed in each page: they never read a sheet.</p>
  {:else}
    <div class="fte-field fte-top">
      <span class="fte-word">Columns</span>
      <div class="fte-columns">
        {#each columns as column (column)}
          {@const role = columnRole(source, column)}
          <label class="fte-column">
            <input class="input fte-input" value={column} aria-label={`Column ${column}`} title="The data’s column of this name is read; rename it to match yours"
              onchange={(event) => rename(source, column, event, write)} onkeydown={columnKey} />
            <small>{role ? ROLE_WORDS[role] : 'read'}</small>
          </label>
        {/each}
        {#if FORMS[kind]?.family === 'categories' && countsRows(source)}
          <p class="fte-note">Counts the rows: one row, one {kind === 'pictograms' || kind === 'silhouette rows' ? 'glyph' : 'unit'}.</p>
        {/if}
      </div>
    </div>
  {/if}
  {@render seg('Style', LOOKS.map((one) => (one.value ? one : { ...one, label: 'As the page' })), setting(readChart(source), 'style'),
    (value) => write(withSettings(source, { style: value })))}
{/snippet}

{#snippet mapFields(source, write)}
  {@const map = readMap(source)}
  {@const put = (changes) => write(withMapSettings(source, changes))}
  {@render seg('Base', Object.entries(BASE_NAMES).map(([value, label]) => ({ value, label })), map.base || 'satellite',
    (value) => put({ base: value === 'satellite' ? '' : value }))}
  {@render seg('Size', Object.entries(SIZE_NAMES).map(([value, label]) => ({ value, label })), map.size || 'wide',
    (value) => put({ size: value === 'wide' ? '' : value }))}
  {@render seg('Legend', Object.entries(LEGEND_NAMES).map(([value, label]) => ({ value, label })), map.legend || 'shown',
    (value) => put({ legend: value === 'shown' ? '' : value }))}
  {@render seg('North arrow', [{ value: '', label: 'Off' }, { value: 'on', label: 'On' }], map.north === 'on' ? 'on' : '',
    (value) => put({ north: value }))}
  {@render seg('Scale', ['off', '', 'on'].map((value) => ({ value, label: SCALE_NAMES[value] })), map.scale,
    (value) => put({ scale: value }))}
  {@render seg('Names', ['', 'on', 'off'].map((value) => ({ value, label: LABEL_NAMES[value] })), map.labels,
    (value) => put({ labels: value }))}
  {@render seg('Crowds', [{ value: 'off', label: 'Off' }, { value: '8', label: '8' }, { value: '', label: '12' }, { value: '20', label: '20' }],
    map.crowds === '12' ? '' : map.crowds, (value) => put({ crowds: value }))}
  {@render seg('Proofs', [{ value: '', label: 'Every point' }, { value: 'filmed', label: 'Where filmed' }], map.proofPoints === 'filmed' ? 'filmed' : '',
    (value) => put({ 'proof points': value }))}
  {@render seg('Timeline', [{ value: '', label: 'On' }, { value: 'off', label: 'Off' }], map.timeline === 'off' ? 'off' : '',
    (value) => put({ timeline: value }))}
  {@render seg('Play', Object.entries(SPEED_NAMES).map(([value, label]) => ({ value: value === 'normal' ? '' : value, label })),
    map.speed === 'normal' ? '' : map.speed, (value) => put({ speed: value }))}
  <div class="fte-field">
    <span class="fte-word">Cards show</span>
    <div class="fte-checks" role="group" aria-label="Cards show">
      {#each CARD_PARTS as part (part)}
        <label class="fte-check"><input type="checkbox" checked={cardParts(source).includes(part)} onchange={() => toggleCard(source, part, write)} />
          {CARD_NAMES[part]}</label>
      {/each}
    </div>
  </div>
{/snippet}

<div class="fte">
  <aside class="fte-side">
    <FigureTemplateSketch {data} width={190} />
    <p class="fte-said">{figureSaid(data)}</p>
    <p class="fte-note">A template keeps no row, no title, no source, and no map’s layers or place: each figure made from it takes them from its own data.</p>
  </aside>

  <div class="fte-main">
    {#if figure === 'infographic' && read}
      <section class="fte-part" aria-labelledby="fte-band">
        <h4 id="fte-band">Title band</h4>
        {#each BAND as one (one.key)}
          <label class="fte-field"><span class="fte-word">{one.label}</span>
            <input class="input" value={read.settings[one.key]?.value ?? ''} placeholder="Each page writes its own" title={one.hint}
              onchange={(event) => set(withSetting(text, one.key, event.currentTarget.value))} /></label>
        {/each}
      </section>

      <section class="fte-part" aria-labelledby="fte-look">
        <h4 id="fte-look">Look</h4>
        {@render seg('Look', LOOKS, read.settings.look?.value?.toLowerCase() ?? '', (value) => set(withSetting(text, 'look', value)))}
        {@render seg('Legend', [{ value: 'shared', label: 'One for a shared column', title: 'Charts colouring by the same column share one legend on top' },
          { value: 'each', label: 'One per chart' }],
          String(read.settings.legend?.value ?? '').toLowerCase() === EACH_PANEL ? 'each' : 'shared', (value) => set(withLegend(text, value === 'shared')))}
      </section>

      <section class="fte-part" aria-labelledby="fte-panels">
        <h4 id="fte-panels">Panels <small>Alt+↑ and Alt+↓ move one</small></h4>
        {#if !panels.length}<p class="fte-note">No panel yet: add a chart, a map or words.</p>{/if}
        <ol class="fte-panels">
          {#each panels as panel, index (`${index}:${panel.kind}:${panel.chartKind}`)}
            <li class="fte-panel" class:open={open === index}>
              <div class="fte-panel-row">
                <Icon name={PANEL_ICONS[panel.kind] ?? 'chart'} size={14} />
                <button type="button" class="fte-panel-name" aria-expanded={open === index} onclick={() => (open = open === index ? -1 : index)}
                  onkeydown={(event) => rowKey(event, index)}>
                  <span class="fte-panel-title">{panelName(panel)}</span>
                  <span class="fte-panel-said">{panelSaid(panel)}</span>
                </button>
                <span class="fte-seg fte-widths" role="group" aria-label="Width">
                  <button type="button" class="fte-seg-btn" class:on={panel.width === HALF} aria-pressed={panel.width === HALF}
                    onclick={() => set(withWidth(text, index, HALF))}>Half</button>
                  <button type="button" class="fte-seg-btn" class:on={panel.width === WIDE} aria-pressed={panel.width === WIDE}
                    onclick={() => set(withWidth(text, index, WIDE))}>Wide</button>
                </span>
                <button type="button" class="btn btn-ghost btn-xs" title="Move up" aria-label={`Move ${panelName(panel)} up`} disabled={index === 0}
                  onclick={() => move(index, index - 1)}><Icon name="chevronUp" size={13} /></button>
                <button type="button" class="btn btn-ghost btn-xs" title="Move down" aria-label={`Move ${panelName(panel)} down`} disabled={index === panels.length - 1}
                  onclick={() => move(index, index + 1)}><Icon name="chevronDown" size={13} /></button>
                <button type="button" class="btn btn-ghost btn-xs" title="Take this panel out" aria-label={`Take out ${panelName(panel)}`}
                  onclick={() => remove(index)}><Icon name="x" size={13} /></button>
              </div>
              {#if open === index}
                <div class="fte-panel-body">
                  {#if panel.kind === 'chart'}
                    {@render chartFields(panel.text, writePanel(index))}
                  {:else if panel.kind === 'map'}
                    {@render mapFields(panel.text, writePanel(index))}
                  {:else}
                    <label class="fte-field fte-top"><span class="fte-word">Words</span>
                      <textarea class="textarea" rows="3" value={panel.text} aria-label="Words"
                        onchange={(event) => set(withPanelText(text, index, event.currentTarget.value.trim() || WORDS_PANEL))}></textarea></label>
                  {/if}
                </div>
              {/if}
            </li>
          {/each}
        </ol>
        <button type="button" class="btn btn-sm" aria-haspopup="menu" aria-expanded={Boolean(addAnchor)}
          onclick={(event) => { addAnchor = addAnchor ? null : event.currentTarget; kindsOpen = false; }}>
          <Icon name="plus" size={13} /> Add a panel <Icon name="chevronDown" size={12} /></button>
      </section>
    {:else if figure === 'chart'}
      <section class="fte-part">{@render chartFields(text, set)}</section>
    {:else}
      <section class="fte-part">{@render mapFields(text, set)}</section>
    {/if}
  </div>
</div>

{#if addAnchor}
  <FloatingMenu anchor={addAnchor} width={260} label="Add a panel" onclose={() => { addAnchor = null; kindsOpen = false; }}>
    {#if kindsOpen}
      <button type="button" class="fm-item" onclick={() => (kindsOpen = false)}><Icon name="chevronLeft" size={13} /><span class="fm-grow">A chart</span></button>
      <div class="fm-sep"></div>
      {#each Object.entries(FORMS) as [kind, form] (kind)}
        <button type="button" class="fm-item" onclick={() => add(starterBlock(kind))}>
          <span class="fm-grow">{form.label}</span><small class="fte-hint">{form.needs}</small></button>
      {/each}
    {:else}
      <button type="button" class="fm-item" onclick={() => (kindsOpen = true)}><Icon name="chart" size={14} /><span class="fm-grow">A chart</span><Icon name="chevronRight" size={13} /></button>
      <button type="button" class="fm-item" onclick={() => add('::: map\n:::')}><Icon name="mapArea" size={14} /><span class="fm-grow">A map</span></button>
      <button type="button" class="fm-item" onclick={() => add(WORDS_PANEL)}><Icon name="text" size={14} /><span class="fm-grow">Words</span></button>
    {/if}
  </FloatingMenu>
{/if}

<style>
  .fte { display: grid; grid-template-columns: 210px minmax(0, 1fr); gap: 22px; align-items: start; }
  .fte-side { position: sticky; top: 0; display: flex; flex-direction: column; gap: 8px; }
  .fte-said { margin: 0; color: var(--text-2); font-size: var(--fs-xs); }
  .fte-note { margin: 0; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.45; }
  .fte-main { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
  .fte-part { display: flex; flex-direction: column; gap: 8px; }
  .fte-part h4 { display: flex; align-items: baseline; gap: 8px; margin: 0 0 2px; color: var(--text-3); font-size: 10.5px; font-weight: 700;
    letter-spacing: 0.06em; text-transform: uppercase; }
  .fte-part h4 small { font-weight: 400; letter-spacing: 0; text-transform: none; }
  .fte-field { display: grid; grid-template-columns: 96px minmax(0, 1fr); align-items: center; gap: 10px; }
  .fte-field.fte-top { align-items: start; }
  .fte-word { color: var(--text-2); font-size: var(--fs-xs); }
  .fte-top .fte-word { padding-top: 6px; }
  .fte-fixed { color: var(--text-1); font-size: var(--fs-sm); }
  .fte-select { justify-self: start; min-width: 180px; padding: 5px 8px; border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-2); color: var(--text-1); font-size: var(--fs-sm); }
  .fte-seg { display: inline-flex; justify-self: start; flex-wrap: wrap; border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden; }
  .fte-seg-btn { padding: 4px 10px; border: 0; border-left: 1px solid var(--border); background: var(--bg-2); color: var(--text-2);
    font: inherit; font-size: var(--fs-xs); cursor: pointer; }
  .fte-seg-btn:first-child { border-left: 0; }
  .fte-seg-btn:hover { background: var(--bg-3); color: var(--text-1); }
  .fte-seg-btn.on { background: var(--accent); color: var(--accent-text); font-weight: 600; }
  .fte-columns { display: flex; flex-direction: column; gap: 6px; }
  .fte-column { display: grid; grid-template-columns: minmax(0, 220px) auto; align-items: center; gap: 8px; }
  .fte-column small { color: var(--text-3); font-size: var(--fs-xs); }
  .fte-input { padding: 4px 8px; font-size: var(--fs-sm); }
  .fte-checks { display: flex; flex-wrap: wrap; gap: 4px 14px; }
  .fte-check { display: inline-flex; align-items: center; gap: 5px; color: var(--text-1); font-size: var(--fs-xs); }
  .fte-panels { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
  .fte-panel { border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-2); }
  .fte-panel.open { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); }
  .fte-panel-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; color: var(--text-2); }
  .fte-panel-name { display: flex; flex: 1; min-width: 0; flex-direction: column; align-items: flex-start; gap: 1px; padding: 0; border: 0;
    background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
  .fte-panel-title { color: var(--text-1); font-size: var(--fs-sm); font-weight: 600; }
  .fte-panel-said { max-width: 100%; overflow: hidden; color: var(--text-3); font-size: var(--fs-xs); text-overflow: ellipsis; white-space: nowrap; }
  .fte-widths { flex: none; }
  .fte-panel-body { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px 12px; border-top: 1px solid var(--border); }
  .fte-hint { color: var(--text-3); font-size: 11px; }
</style>
