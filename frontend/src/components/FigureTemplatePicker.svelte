<script>
  /**
   * Start a figure from a template, or apply one to a chart or a map: the analyst's own
   * templates of that figure (Settings › Templates › Figures), then, for an infographic, the
   * ready ones the app ships. The one picked is applied by the server
   * (`lib/notes/figureTemplates.js`, `applyFigure`), which matches the template's columns
   * onto the data's by name; a column the data does not name is asked in a second step,
   * *Match the columns*: one of the data's columns, the rows counted for a column that
   * counts, or by hand, the panel then opening its own form. An infographic's map panels are
   * asked there too, when the note holds maps: one of them, its look set by the template, or
   * an empty map. Nothing is guessed: a suggestion is a column whose name holds the
   * template's, said and changeable.
   *
   * It writes nothing: `onapply(answer, record)` gets the server's answer, the infographic's
   * `text` (its map panels already the ones picked) or a chart's or a map's `changes`.
   */
  import FloatingMenu from './FloatingMenu.svelte';
  import Icon from './Icon.svelte';
  import { templatesState } from '../lib/state.svelte.js';
  import {
    BY_HAND, FIGURE_NAMES, applyFigure, figureSaid, mappingOf, readyFigures, stepChoices, stepRows,
  } from '../lib/notes/figureTemplates.js';
  import { readInfographic, withPanelText } from '../lib/notes/editor/infographicText.js';
  import { readMap, withMapSettings } from '../lib/notes/editor/mapText.js';

  let {
    anchor = null,
    /** `infographic`, `chart` or `map`. */
    figure = 'infographic',
    /** What it meets: `{ table, origin, name }` (a page's data, a chart's own rows), or null for none. */
    data = null,
    /** The note's maps, `{ label, text }`, offered for an infographic's map panels. */
    maps = [],
    onapply,
    onclose,
    apply = applyFigure,
    ready = readyFigures,
  } = $props();

  const TITLES = { infographic: 'Start from a template', chart: 'Apply a chart template', map: 'Apply a map template' };
  const NONE = {
    infographic: 'No infographic template of yours yet: Settings › Templates › Figures makes one from a page of a case.',
    chart: 'No chart template yet. Settings › Templates › Figures makes one, blank or from a chart of a case.',
    map: 'No map template yet. Settings › Templates › Figures makes one, blank or from a map of a case.',
  };
  /** An empty map, for a map panel the analyst sets later. */
  const EMPTY_MAP = 'empty';

  const yours = $derived((templatesState.figure ?? []).filter((record) => (record.data?.figure ?? 'infographic') === figure));
  let readyOnes = $state([]);
  $effect(() => {
    if (figure !== 'infographic') return;
    let live = true;
    ready().then((list) => { if (live) readyOnes = list; }).catch(() => {});
    return () => { live = false; };
  });

  const dataSaid = $derived(figure === 'map' ? 'Its look only: the map keeps its layers, its frame and its steps.'
    : figure === 'chart' ? 'Its kind and settings, its columns matched to this chart’s by name. The rows and the title stay.'
      : data ? `With ${data.name}: its panels read its columns by name, and what it does not name is asked.`
        : 'No data yet: each panel opens its own form. Choose data first to draw them from a sheet.');

  let step = $state('list');
  let picked = $state(null);
  let answer = $state(null);
  let rows = $state([]);
  let mapRows = $state([]);
  let busy = $state(false);
  let said = $state('');

  /** The template's map panels, each offered the note's maps, the first ones in order. */
  function mapPanels(record) {
    if (figure !== 'infographic' || !maps.length) return [];
    return readInfographic(record?.data?.text ?? '').panels.map((panel, index) => ({ panel, index }))
      .filter((one) => one.panel.kind === 'map')
      .map((one, at) => ({ index: one.index, value: String(Math.min(at, maps.length - 1)) }));
  }

  async function pick(record) {
    if (busy) return;
    picked = record;
    said = '';
    busy = true;
    try {
      const first = await apply({ template: record.data, table: data?.table ?? '', origin: data?.origin ?? '' });
      answer = first;
      rows = first.ask ? stepRows(first) : [];
      mapRows = mapPanels(record);
      if (first.ask || mapRows.length) step = 'match';
      else finish(first);
    } catch (error) {
      said = `Not applied: ${error.message}`;
    } finally {
      busy = false;
    }
  }

  /** Match the columns › Apply: the server writes with the columns given, then the maps picked go in. */
  async function confirm() {
    if (busy || !picked) return;
    busy = true;
    said = '';
    try {
      let result = answer;
      if (answer?.ask) {
        const { mapping, rows: counted } = mappingOf(rows, answer.columns ?? []);
        result = await apply({ template: picked.data, table: data?.table ?? '', origin: data?.origin ?? '', mapping, rows: counted });
      }
      finish(result);
    } catch (error) {
      said = `Not applied: ${error.message}`;
    } finally {
      busy = false;
    }
  }

  /** An infographic's map panels made of the note's maps picked, each in the template's look. */
  function withMaps(text) {
    let next = text;
    for (const row of mapRows) {
      if (row.value === EMPTY_MAP) continue;
      const chosen = maps[Number(row.value)];
      const panel = readInfographic(next).panels[row.index];
      if (!chosen || !panel || panel.kind !== 'map') continue;
      const look = readInfographic(next).lines.slice(panel.from, panel.to + 1).join('\n');
      next = withPanelText(next, row.index, withMapSettings(chosen.text, lookOf(look)));
    }
    return next;
  }

  /** The look a template's map sets: every setting it keeps, '' for one left at the default. */
  function lookOf(text) {
    const map = readMap(text);
    return {
      base: map.base, 'proof points': map.proofPoints, labels: map.labels, crowds: map.crowds, north: map.north, scale: map.scale,
      timeline: map.timeline, speed: map.speed, card: map.card === null ? '' : map.card.join(', ') || 'none', size: map.size, legend: map.legend,
    };
  }

  function finish(result) {
    if (figure === 'chart' && result?.reads !== 'data') {
      said = result?.notes?.[0] ? `Nothing changed: ${result.notes[0]}.` : 'Nothing changed: a column it needs was not given.';
      step = 'list';
      return;
    }
    const final = figure === 'infographic' && result?.text ? { ...result, text: withMaps(result.text) } : result;
    onapply?.(final, picked);
    onclose?.();
  }

  function back() {
    step = 'list';
    answer = null;
    rows = [];
    mapRows = [];
  }
</script>

<FloatingMenu {anchor} width={360} label={TITLES[figure]} role="dialog" column {onclose}>
  {#if step === 'list'}
    <p class="fm-head">{TITLES[figure]}</p>
    <p class="fm-note ftp-said">{dataSaid}</p>
    <div class="ftp-list">
      {#if yours.length}
        <p class="fm-head">Yours</p>
        {#each yours as record (record.id)}
          <button type="button" class="fm-item ftp-item" disabled={busy} onclick={() => pick(record)}>
            <Icon name={figure === 'map' ? 'mapArea' : figure === 'chart' ? 'chart' : 'grid'} size={14} />
            <span class="ftp-words"><span class="fm-grow">{record.name}</span><small>{figureSaid(record.data)}</small></span>
            {#if busy && picked?.id === record.id}<small class="ftp-busy">Reading…</small>{/if}
          </button>
        {/each}
      {:else if figure !== 'infographic'}
        <p class="fm-note">{NONE[figure]}</p>
      {/if}
      {#if figure === 'infographic'}
        {#if !yours.length}<p class="fm-note">{NONE.infographic}</p>{/if}
        <p class="fm-head">Ready</p>
        {#each readyOnes as record (record.id)}
          <button type="button" class="fm-item ftp-item" disabled={busy} onclick={() => pick(record)}>
            <Icon name="grid" size={14} />
            <span class="ftp-words"><span class="fm-grow">{record.name}</span><small>{record.about}</small></span>
            {#if busy && picked?.id === record.id}<small class="ftp-busy">Reading…</small>{/if}
          </button>
        {/each}
      {/if}
    </div>
    {#if said}<p class="fm-note ftp-warn" role="status">{said}</p>{/if}
  {:else}
    <button type="button" class="fm-item ftp-back" onclick={back}><Icon name="chevronLeft" size={13} /><span class="fm-grow">{picked?.name ?? FIGURE_NAMES[figure]}</span></button>
    <div class="fm-sep"></div>
    <div class="ftp-step" role="group" aria-label="Match the columns">
      {#if rows.length}
        <p class="fm-head">Match the columns</p>
        <p class="fm-note">{data?.name ?? 'The data'} does not name these. Pick its column for each; one filled by hand opens its panel’s form.</p>
        {#each rows as row, index (row.column)}
          <label class="ftp-row">
            <span class="ftp-col"><strong>{row.column}</strong><small>{row.said}</small></span>
            <select class="ftp-select" aria-label={`The data’s column for ${row.column}`} bind:value={rows[index].value}>
              {#each stepChoices(row, answer?.columns ?? []) as choice (choice.value)}
                <option value={choice.value}>{choice.label}</option>
              {/each}
            </select>
          </label>
        {/each}
      {/if}
      {#if mapRows.length}
        <p class="fm-head">Its maps</p>
        <p class="fm-note">A map of this note takes the template’s look; an empty one is set in the note.</p>
        {#each mapRows as row, index (row.index)}
          <label class="ftp-row">
            <span class="ftp-col"><strong>Map panel {index + 1}</strong></span>
            <select class="ftp-select" aria-label={`The map for map panel ${index + 1}`} bind:value={mapRows[index].value}>
              {#each maps as map, at (at)}<option value={String(at)}>{map.label}</option>{/each}
              <option value={EMPTY_MAP}>An empty map</option>
            </select>
          </label>
        {/each}
      {/if}
    </div>
    {#if said}<p class="fm-note ftp-warn" role="status">{said}</p>{/if}
    <div class="ftp-acts">
      <span class="ftp-left">{rows.filter((row) => row.value === BY_HAND && row.required).length ? 'Filled by hand: those panels open empty' : ''}</span>
      <button type="button" class="btn btn-primary btn-sm" disabled={busy} onclick={confirm}>{busy ? 'Applying…' : 'Apply'}</button>
    </div>
  {/if}
</FloatingMenu>

<style>
  .ftp-said { margin-top: 0; }
  .ftp-list { overflow-y: auto; min-height: 0; }
  .ftp-item { align-items: flex-start; }
  .ftp-item > :global(svg) { margin-top: 2px; }
  .ftp-words { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 1px; }
  .ftp-words small, .ftp-busy { color: var(--text-3); font-size: 11px; line-height: 1.35; white-space: normal; }
  .ftp-back { color: var(--text-2); }
  .ftp-step { overflow-y: auto; min-height: 0; }
  .ftp-row { display: grid; grid-template-columns: minmax(0, 1fr) 150px; align-items: center; gap: 10px; padding: 5px 8px; }
  .ftp-col { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
  .ftp-col strong { color: var(--text-1); font-size: var(--fs-sm); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ftp-col small { color: var(--text-3); font-size: 11px; line-height: 1.35; }
  .ftp-select { width: 100%; min-width: 0; padding: 4px 6px; border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-2); color: var(--text-1); font-size: var(--fs-xs); }
  .ftp-acts { display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding: 8px 8px 4px; border-top: 1px solid var(--border); margin-top: 4px; }
  .ftp-left { flex: 1; color: var(--text-3); font-size: 11px; }
  .ftp-warn { color: var(--warn, #b7791f); }
</style>
