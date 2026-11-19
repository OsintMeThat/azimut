<script>
  /**
   * A sheet on a map, in one press: which column holds the place, which names a point,
   * colours it, dates it and fills its card, each proposed from the sheet's own roles
   * (`lib/sheetMap.suggestChoice`) and corrected here. Every choice asks the server what it
   * would put on the map (`engine/sheetmap.py`), so the counts said are the ones the layer
   * gets: the rows with no place it can read are counted and listed with why, never left
   * out in silence.
   *
   * Opened from the Sheet tool on the sheet on screen, or from a note's map card with no
   * sheet yet, when it first lists the case's sheets. A sheet that already makes a layer
   * says so, and offers to update it rather than make a second.
   */
  import { untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';
  import { api } from '../lib/api.js';
  import { keyIndex } from '../lib/sheet.js';
  import {
    MAX_CARD, datedWords, howWords, makeSheetMap, placedWords, previewSheetMap, suggestChoice, unplacedWords,
    updateFromSheet,
  } from '../lib/sheetMap.js';

  let {
    caseId,
    /** The sheet on screen, with its table and sidecar; none from a note's map card. */
    sheetId = '',
    table = null,
    meta = null,
    sheetTitle = '',
    /** `(row)`: the layer is made. */
    onmade,
    /** `(answer)`: an existing layer was brought level with the sheet. */
    onupdated = null,
    onclose,
  } = $props();

  let picked = $state(untrack(() => sheetId));
  let sheets = $state(null);
  let held = $state(untrack(() => (table ? { columns: table.columns, rows: table.rows, meta: meta ?? {}, title: sheetTitle } : null)));
  let choice = $state(untrack(() => (held ? suggestChoice(held, held.meta) : null)));
  let title = $state(untrack(() => sheetTitle));
  let plan = $state(null);
  let asking = $state(false);
  let problem = $state('');
  let making = $state(false);
  let listOpen = $state(false);

  const columns = $derived(held ? held.columns.filter((_, index) => index !== keyIndex(held.columns)) : []);

  // From a note: the case's sheets, to pick one.
  $effect(() => {
    if (picked || sheets || !caseId) return;
    api.get(`/api/cases/${caseId}/sheets`).then((answer) => (sheets = answer?.sheets ?? []), () => (sheets = []));
  });

  // A sheet picked from the list: its table, read once, then the proposal.
  $effect(() => {
    if (!picked || held || !caseId) return;
    const asked = picked;
    api.get(`/api/cases/${caseId}/sheets/${asked}`).then((sheet) => {
      if (picked !== asked) return;
      held = { columns: sheet.columns, rows: sheet.rows, meta: sheet.meta ?? {}, title: sheet.title };
      choice = suggestChoice(held, held.meta);
      title = sheet.title;
    }, (error) => (problem = error?.message ?? 'This sheet could not be read'));
  });

  // Every choice: what it would put on the map, as the server would make it.
  let seq = 0;
  $effect(() => {
    if (!picked || !choice || !caseId) return;
    const asked = JSON.stringify(choice);
    if (!choice.place) {
      plan = null;
      problem = '';
      return;
    }
    const ticket = ++seq;
    asking = true;
    const timer = setTimeout(() => {
      previewSheetMap(caseId, picked, JSON.parse(asked)).then((answer) => {
        if (ticket !== seq) return;
        plan = answer;
        problem = '';
      }, (error) => {
        if (ticket !== seq) return;
        plan = null;
        problem = error?.message ?? 'This choice cannot be read';
      }).finally(() => { if (ticket === seq) asking = false; });
    }, 120);
    return () => clearTimeout(timer);
  });

  function set(key, value) {
    choice = { ...choice, [key]: value, ...(key === 'start' && !value ? { end: '' } : {}) };
  }

  function toggleCard(name) {
    const card = choice.card.includes(name) ? choice.card.filter((one) => one !== name) : [...choice.card, name];
    if (card.length <= MAX_CARD) set('card', columns.filter((one) => card.includes(one)));
  }

  async function make() {
    if (!plan?.placed || making) return;
    making = true;
    try {
      onmade?.(await makeSheetMap(caseId, picked, choice, title.trim()));
    } catch (error) {
      problem = error?.message ?? 'The layer could not be made';
    } finally {
      making = false;
    }
  }

  async function update(layer) {
    making = true;
    try {
      onupdated?.(await updateFromSheet(caseId, layer.name));
    } catch (error) {
      problem = error?.message ?? 'The layer could not be updated';
    } finally {
      making = false;
    }
  }

  const dialogTitle = $derived(held?.title ? `Show “${held.title}” on a map` : 'Show a sheet on a map');
</script>

<Modal title={dialogTitle} {onclose} width="680px" align="top">
  {#if !picked}
    <p class="lead">Each row with a place becomes a point of a new layer of the case.</p>
    {#if sheets === null}
      <p class="said">Reading the sheets…</p>
    {:else if !sheets.length}
      <p class="said">This case has no sheet yet. Make one in the Sheet tool, from a file or a pasted table.</p>
    {:else}
      <ul class="sheets" aria-label="Sheets">
        {#each sheets as sheet (sheet.id)}
          <li>
            <button type="button" class="sheet" onclick={() => (picked = sheet.id)}>
              <Icon name="table" size={13} /><span>{sheet.title}</span>
              <small>{sheet.rows} {sheet.rows === 1 ? 'row' : 'rows'}</small>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {:else if !held || !choice}
    <p class="said">{problem || 'Reading the sheet…'}</p>
  {:else}
    <div class="form">
      <span class="name">Place</span>
      <div class="pair">
        <select class="input" aria-label="Place column" value={choice.place} onchange={(event) => set('place', event.currentTarget.value)}>
          <option value="">Choose a column…</option>
          {#each columns as column (column)}<option value={column}>{column}</option>{/each}
        </select>
        <select class="input" aria-label="Longitude column" title="A place written as two columns of numbers: which holds the longitude"
          value={choice.lon} onchange={(event) => set('lon', event.currentTarget.value)}>
          <option value="">Longitude in the same cell</option>
          {#each columns.filter((column) => column !== choice.place) as column (column)}<option value={column}>Longitude: {column}</option>{/each}
        </select>
      </div>

      <span class="name">Name</span>
      <select class="input" aria-label="Name column" value={choice.name} onchange={(event) => set('name', event.currentTarget.value)}>
        <option value="">Row number</option>
        {#each columns as column (column)}<option value={column}>{column}</option>{/each}
      </select>

      <span class="name">Colour by</span>
      <div class="stack">
        <select class="input" aria-label="Colour column" value={choice.colour} onchange={(event) => set('colour', event.currentTarget.value)}>
          <option value="">One colour</option>
          {#each columns as column (column)}<option value={column}>{column}</option>{/each}
        </select>
        {#if plan?.groups?.length && choice.colour}
          <ul class="swatches" aria-label="Colours">
            {#each plan.groups as group (group.value)}
              <li><i style:background={group.colour}></i>{group.value}<small>{group.count}</small></li>
            {/each}
          </ul>
        {/if}
      </div>

      <span class="name">Dates</span>
      <div class="pair">
        <select class="input" aria-label="From column" value={choice.start} onchange={(event) => set('start', event.currentTarget.value)}>
          <option value="">Not dated</option>
          {#each columns as column (column)}<option value={column}>From: {column}</option>{/each}
        </select>
        <select class="input" aria-label="Until column" disabled={!choice.start} value={choice.end} onchange={(event) => set('end', event.currentTarget.value)}>
          <option value="">No end</option>
          {#each columns.filter((column) => column !== choice.start) as column (column)}<option value={column}>Until: {column}</option>{/each}
        </select>
      </div>

      <span class="name">Card</span>
      <div class="chips" role="group" aria-label="What a point's card shows">
        {#each columns.filter((column) => column !== choice.place && column !== choice.lon && column !== choice.name) as column (column)}
          <button type="button" class="pick" class:on={choice.card.includes(column)} aria-pressed={choice.card.includes(column)}
            disabled={!choice.card.includes(column) && choice.card.length >= MAX_CARD}
            onclick={() => toggleCard(column)}>{column}</button>
        {/each}
      </div>

      <span class="name">Layer</span>
      <input class="input" aria-label="Layer name" placeholder={held.title} bind:value={title} maxlength="200" />
    </div>

    <div class="plan" aria-live="polite">
      {#if problem}
        <p class="warn"><Icon name="alert" size={12} /> {problem}</p>
      {:else if !choice.place}
        <p class="said">Choose the column that holds the place: coordinates, a grid reference or a place the case holds.</p>
      {:else if plan}
        <p class="head"><strong>{placedWords(plan)}</strong> {howWords(plan.hows)}</p>
        {#if plan.unplaced_count}
          <button type="button" class="fold" aria-expanded={listOpen} onclick={() => (listOpen = !listOpen)}>
            <Icon name={listOpen ? 'chevronDown' : 'chevronRight'} size={11} /> {unplacedWords(plan)}
          </button>
          {#if listOpen}
            <ul class="unplaced" aria-label="Rows off the map">
              {#each plan.unplaced as row (row.row || row.number)}
                <li><b>Row {row.number}</b><span>{row.name}</span><code>{row.text || '—'}</code><em>{row.said}</em></li>
              {/each}
              {#if plan.unplaced_count > plan.unplaced.length}<li class="more">and {plan.unplaced_count - plan.unplaced.length} more</li>{/if}
            </ul>
          {/if}
        {/if}
        {#if datedWords(plan, choice)}<p class="said">{datedWords(plan, choice)}</p>{/if}
        {#each plan.layers ?? [] as layer (layer.name)}
          <p class="made">
            <Icon name="stack" size={12} />
            <span>It already makes the layer “{layer.title}”.{layer.sheet?.changed ? ' The sheet changed since.' : ''}</span>
            <button type="button" class="btn btn-sm" disabled={making || layer.sheet?.gone} onclick={() => update(layer)}>Update it</button>
          </p>
        {/each}
      {:else if asking}
        <p class="said">Reading…</p>
      {/if}
    </div>
  {/if}

  <div class="foot">
    <span class="hint">An ordinary layer of the case: every map can show it, and it remembers this sheet.</span>
    <button class="btn" onclick={onclose}>Cancel</button>
    {#if picked && held}
      <button class="btn btn-primary" disabled={!plan?.placed || making || Boolean(problem)} onclick={make}>
        {making ? 'Making…' : plan?.placed ? `Make the layer (${plan.placed} ${plan.placed === 1 ? 'point' : 'points'})` : 'Make the layer'}
      </button>
    {/if}
  </div>
</Modal>

<style>
  .lead, .said { color: var(--text-2); font-size: var(--fs-sm); line-height: 1.5; margin: 0 0 8px; }
  .sheets { display: flex; flex-direction: column; max-height: 320px; overflow: auto; margin: 0; padding: 0; list-style: none; border: 1px solid var(--border); border-radius: var(--r-sm); }
  .sheets li { border-bottom: 1px solid var(--border); }
  .sheets li:last-child { border-bottom: 0; }
  .sheet {
    display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 10px; border: 0;
    background: none; color: var(--text-1); font: inherit; font-size: var(--fs-sm); text-align: left; cursor: pointer;
  }
  .sheet:hover, .sheet:focus-visible { background: var(--bg-2); }
  .sheet span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sheet small { color: var(--text-3); }
  .form { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 8px 12px; align-items: start; }
  .form .name { color: var(--text-2); font-size: var(--fs-sm); padding-top: 6px; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .stack { display: flex; flex-direction: column; gap: 6px; }
  .swatches { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 0; padding: 0; list-style: none; font-size: var(--fs-xs); color: var(--text-2); }
  .swatches li { display: inline-flex; align-items: center; gap: 5px; }
  .swatches i { width: 10px; height: 10px; border-radius: 50%; border: 1px solid rgba(0, 0, 0, 0.25); }
  .swatches small { color: var(--text-3); }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .pick {
    border: 1px solid var(--border); border-radius: 999px; padding: 2px 9px; background: none; color: var(--text-2);
    font: inherit; font-size: var(--fs-xs); cursor: pointer;
  }
  .pick.on { background: var(--accent-bg, rgba(43, 108, 176, 0.14)); border-color: var(--accent); color: var(--text-1); }
  .pick:disabled { opacity: 0.45; cursor: default; }
  .plan { margin-top: 14px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-1); min-height: 44px; }
  .plan .head { margin: 0 0 6px; font-size: var(--fs-sm); color: var(--text-2); }
  .plan .head strong { color: var(--text-1); }
  .warn { display: flex; align-items: center; gap: 6px; margin: 0; color: var(--anno-6, #c0392b); font-size: var(--fs-sm); }
  .fold { display: inline-flex; align-items: center; gap: 4px; border: 0; background: none; padding: 0; color: var(--text-2); font: inherit; font-size: var(--fs-sm); cursor: pointer; }
  .unplaced { margin: 6px 0; padding: 0; list-style: none; max-height: 180px; overflow: auto; font-size: var(--fs-xs); border-top: 1px solid var(--border); }
  .unplaced li { display: grid; grid-template-columns: 52px minmax(0, 1fr) minmax(0, 1.2fr) max-content; gap: 10px; padding: 4px 0; border-bottom: 1px solid var(--border); align-items: baseline; }
  .unplaced span, .unplaced code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .unplaced code { font-family: var(--font-mono); color: var(--text-2); }
  .unplaced em { color: var(--text-3); font-style: normal; white-space: nowrap; }
  .unplaced .more { display: block; color: var(--text-3); }
  .made { display: flex; align-items: center; gap: 8px; margin: 8px 0 0; font-size: var(--fs-sm); color: var(--text-2); }
  .made span { flex: 1; }
  .foot { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
  .foot .hint { flex: 1; color: var(--text-3); font-size: var(--fs-xs); }
</style>
