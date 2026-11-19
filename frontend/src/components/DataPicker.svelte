<script>
  /**
   * Where a figure's rows come from: the infographic's Data bar's *Change…*, and a chart's
   * settings card's. A menu under the press lists the case's sheets first (recommended: the
   * Sheet tool or Excel edits them, and Read again brings every chart up to date), then the
   * tables of this note, then **New data…**: a table pasted, an .xlsx or a CSV, named and kept
   * as a new sheet of the case (`lib/notes/newData.js`), which the Sheet tool then shows.
   *
   * The one picked is read at once (`editor/infographicData.js`'s `readData`) and handed to
   * `onpick({ origin, data })`; `inherit`, given (a panel of an infographic), offers the page's
   * own data first, handed as `onpick({ inherit: true })`. Nothing here writes the note.
   */
  import { onMount } from 'svelte';
  import FloatingMenu from './FloatingMenu.svelte';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';
  import { reloadCase, toast } from '../lib/state.svelte.js';
  import { chartSources } from '../lib/notes/editor/chartFigure.js';
  import { readData, rowsWord, sourceChoices } from '../lib/notes/editor/infographicData.js';
  import { createData, fileKind, gridToSheet, readPaste } from '../lib/notes/newData.js';

  let {
    caseId,
    noteId = '',
    /** The note as it is now, for its own tables. */
    noteText = '',
    anchor = null,
    /** The origin in use, marked in the list. */
    current = '',
    /** `{ label }`: the page's own data, offered first to a panel of an infographic. */
    inherit = null,
    onpick,
    onclose,
    /** What lists the case's sheets (`GET /notes/figure/sources`). */
    sources = chartSources,
  } = $props();

  let step = $state('menu');
  let sheets = $state(null);
  let failed = $state('');
  let reading = $state('');

  onMount(async () => {
    const answer = await sources({ caseId, noteId });
    if (answer?.error) failed = answer.error;
    sheets = answer?.sheets ?? [];
  });

  const choices = $derived(sourceChoices({ sheets: sheets ?? [], noteId, noteText, current }));
  const sheetChoices = $derived(choices.filter((one) => one.group === 'sheet'));
  const tableChoices = $derived(choices.filter((one) => one.group === 'table'));

  /** Read the source picked, then hand it over. */
  async function pick(origin) {
    reading = origin;
    const data = await readData({ caseId, noteId, noteText, origin, fresh: true });
    reading = '';
    if (data.error || !data.found) {
      toast(data.error ? `Not read: ${data.error}` : 'That table is no longer in the case.', 'warn');
      return;
    }
    onpick?.({ origin, data });
  }

  // -- New data… --------------------------------------------------------------------
  let name = $state('');
  let text = $state('');
  let html = $state('');
  let header = $state(true);
  let file = $state(null);
  let picker = $state(null);
  let making = $state(false);
  const grid = $derived(file ? null : readPaste({ html, text }));
  const sheet = $derived(grid ? gridToSheet(grid, { header }) : null);
  const workbook = $derived(Boolean(file && fileKind(file.name) === 'xlsx'));
  const ready = $derived(Boolean((file || sheet?.columns.length) && (workbook || name.trim())));
  $effect(() => { if (grid) header = grid.header; });

  function pasted(event) {
    const data = event.clipboardData;
    if (!data) return;
    event.preventDefault();
    html = data.getData('text/html') ?? '';
    text = data.getData('text/plain') ?? '';
    file = null;
  }

  function typed(event) {
    // words typed over a paste are read as text: the paste's table is gone with them
    html = '';
    text = event.currentTarget.value;
  }

  function chose(files) {
    const one = files?.[0];
    if (!one) return;
    if (!fileKind(one.name)) {
      toast('Choose an .xlsx or a .csv file.', 'warn');
      return;
    }
    file = one;
    text = '';
    html = '';
    if (!name.trim()) name = one.name.replace(/\.[^.]+$/, '');
  }

  async function make() {
    if (!ready || making) return;
    making = true;
    try {
      const made = await createData({ caseId, name, grid, header, file });
      await reloadCase();
      const others = made.others.length ? ` ${made.others.length === 1 ? 'Its other tab' : `Its ${made.others.length} other tabs`} too: ${made.others.join(', ')}.` : '';
      toast(`Kept as the sheet “${made.title}”: the Sheet tool shows it.${others}`, 'ok', 5000);
      await pick(`sheet:${made.id}`);
    } catch (error) {
      toast(`Data not made: ${error.message}`, 'warn');
    } finally {
      making = false;
    }
  }

  const preview = $derived(sheet ? sheet.rows.slice(0, 4) : []);
</script>

{#if step === 'menu'}
  <FloatingMenu {anchor} width={320} label="Data" column {onclose}>
    <div class="dp-list">
      {#if inherit}
        <button type="button" class="fm-item" title="Read its rows from the infographic’s data, as the other panels do"
          onclick={() => onpick?.({ inherit: true })}>
          <Icon name="grid" size={14} /><span class="fm-grow">The infographic’s data</span><small class="dp-hint">{inherit.label}</small></button>
        <div class="fm-sep"></div>
      {/if}
      <p class="fm-head dp-head">Sheets of the case
        <span class="dp-rec" title="A sheet is edited in the Sheet tool or in Excel, and Read again brings every chart drawn from it up to date">Recommended</span></p>
      {#if sheets === null}
        <p class="fm-note">Listing the case’s sheets…</p>
      {:else if failed}
        <p class="fm-note">Not listed: {failed}</p>
      {:else if !sheetChoices.length}
        <p class="fm-note">No sheet yet. New data… makes one from a paste or a file.</p>
      {/if}
      {#each sheetChoices as one (one.origin)}
        <button type="button" class="fm-item" disabled={Boolean(reading)} title={one.columns.length ? `Columns: ${one.columns.join(', ')}` : one.label}
          onclick={() => pick(one.origin)}>
          <Icon name="grid" size={14} /><span class="fm-grow">{one.label}</span>
          <small class="dp-hint">{reading === one.origin ? 'Reading…' : one.hint.replace('Sheet · ', '')}</small>
          {#if one.current}<span class="fm-tick" aria-label="In use"><Icon name="check" size={13} /></span>{/if}</button>
      {/each}
      {#if tableChoices.length}
        <p class="fm-head">Tables of this note</p>
        {#each tableChoices as one (one.origin)}
          <button type="button" class="fm-item" disabled={Boolean(reading)} title={one.columns.length ? `Columns: ${one.columns.join(', ')}` : one.label}
            onclick={() => pick(one.origin)}>
            <Icon name="table" size={14} /><span class="fm-grow">{one.label}</span>
            <small class="dp-hint">{reading === one.origin ? 'Reading…' : one.hint.replace('This note · ', '')}</small>
            {#if one.current}<span class="fm-tick" aria-label="In use"><Icon name="check" size={13} /></span>{/if}</button>
        {/each}
      {/if}
    </div>
    <div class="fm-sep"></div>
    <button type="button" class="fm-item" title="A table pasted, an .xlsx or a CSV, kept as a new sheet of the case"
      onclick={() => (step = 'new')}>
      <Icon name="plus" size={14} /><span class="fm-grow">New data…</span><small class="dp-hint">paste, .xlsx, CSV</small></button>
  </FloatingMenu>
{:else}
  <Modal title="New data" width="600px" align="top" {onclose}>
    <form class="nd" onsubmit={(event) => { event.preventDefault(); make(); }}>
      <label class="nd-field"><span class="nd-word">Name</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input class="input" bind:value={name} placeholder="Vehicle register" autofocus disabled={workbook}
          title={workbook ? 'Each tab of a workbook is named as its tab' : 'The sheet’s name, as the Sheet tool lists it'} /></label>
      {#if !file}
        <label class="nd-field"><span class="nd-word">Paste a table</span>
          <textarea class="textarea nd-paste" rows="5" value={text} onpaste={pasted} oninput={typed} spellcheck="false"
            placeholder="Cells copied from Excel, LibreOffice, Google Sheets or a web page"></textarea></label>
        {#if sheet}
          <p class="nd-said">{rowsWord(sheet.rows.length)} · {sheet.columns.length} columns</p>
          <div class="nd-preview">
            <table>
              <thead><tr>{#each sheet.columns.slice(0, 6) as column, at (at)}<th>{column}</th>{/each}</tr></thead>
              <tbody>
                {#each preview as row, index (index)}
                  <tr>{#each row.slice(0, 6) as cell, at (at)}<td title={cell}>{cell}</td>{/each}</tr>
                {/each}
              </tbody>
            </table>
          </div>
          <label class="nd-check"><input type="checkbox" bind:checked={header} /> The first row names the columns</label>
        {:else if text.trim()}
          <p class="nd-said nd-warn">No table in this: copy cells from a spreadsheet, or a table from a page.</p>
        {/if}
      {/if}
      <p class="nd-file">
        {#if file}
          <Icon name="file" size={14} /> <strong>{file.name}</strong>
          <button type="button" class="nd-link" onclick={() => (file = null)}>Paste instead</button>
        {:else}
          Or <button type="button" class="nd-link" onclick={() => picker?.click()}>choose a file…</button> .xlsx or .csv
        {/if}
        <input bind:this={picker} type="file" accept=".xlsx,.csv,.tsv,.txt" hidden onchange={(event) => chose(event.currentTarget.files)} />
      </p>
      {#if workbook}
        <p class="nd-note">Each tab is kept as a sheet named as its tab; the first one is the data.</p>
      {/if}
      <p class="nd-note">Kept as a sheet of the case: the Sheet tool or Excel edits it, and Read again brings the charts up to date.</p>
      <footer class="nd-foot">
        <button type="button" class="btn btn-sm" onclick={() => onclose?.()}>Cancel</button>
        <button type="submit" class="btn btn-primary btn-sm" disabled={!ready || making}>{making ? 'Making…' : 'Make the sheet'}</button>
      </footer>
    </form>
  </Modal>
{/if}

<style>
  .dp-list { min-height: 0; overflow-y: auto; }
  .dp-head { display: flex; align-items: center; gap: 6px; }
  .dp-rec {
    padding: 0 6px; border-radius: 8px; background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent);
    font-size: 9.5px; letter-spacing: .03em;
  }
  .dp-hint { flex: none; color: var(--text-3); font-size: 11px; }
  .nd { display: flex; flex-direction: column; gap: 10px; }
  .nd-field { display: flex; flex-direction: column; gap: 4px; }
  .nd-word { color: var(--text-3); font-size: var(--fs-xs); }
  .nd-paste { resize: vertical; min-height: 84px; font-family: var(--font-mono); font-size: 11.5px; white-space: pre; }
  .nd-said { margin: 0; color: var(--text-2); font-size: var(--fs-sm); }
  .nd-warn { color: var(--warn); }
  .nd-preview { max-width: 100%; overflow-x: auto; border: 1px solid var(--border); border-radius: var(--r-sm); }
  .nd-preview table { border-collapse: collapse; font-size: 11.5px; }
  .nd-preview th, .nd-preview td {
    max-width: 14em; padding: 3px 8px; border-bottom: 1px solid var(--border); border-right: 1px solid var(--border); overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; text-align: left;
  }
  .nd-preview th { background: var(--bg-2); color: var(--text-2); font-weight: 600; }
  .nd-check { display: flex; align-items: center; gap: 8px; color: var(--text-1); font-size: var(--fs-sm); }
  .nd-file { display: flex; align-items: center; gap: 6px; margin: 0; color: var(--text-2); font-size: var(--fs-sm); }
  .nd-link { padding: 0; border: none; background: none; color: var(--accent); font: inherit; cursor: pointer; text-decoration: underline; }
  .nd-note { margin: 0; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.4; }
  .nd-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
</style>
