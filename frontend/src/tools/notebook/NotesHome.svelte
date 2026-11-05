<script>
  /**
   * Where the Notebook opens: the case's notes as cards, what they hold said on
   * each, a search through their words, and the templates a new one starts from,
   * each shown by its first page as it prints.
   *
   * One press opens a note, and its ⋯ pins it to the side or puts it in a tab of
   * its own. Ticking cards picks them, Shift for a run of them, Select all for a
   * whole folder; the bar at the foot exports the picked notes or makes a report
   * that includes them as chapters, in the order they were picked.
   *
   * Beside the ready templates, *From the case* writes a note of every geolocation
   * of a period (`FromCaseDialog.svelte`).
   */
  import { untrack } from 'svelte';
  import { api } from '../../lib/api.js';
  import { timeAgo } from '../../lib/analysisViews.js';
  import { READY_NOTES } from '../../lib/notes/ready.js';
  import { isReport, styleLabel } from '../../lib/notes/look.js';
  import Icon from '../../components/Icon.svelte';
  import SearchInput from '../../components/SearchInput.svelte';
  import PageThumb from './PageThumb.svelte';
  import FromCaseDialog from './FromCaseDialog.svelte';
  import { FROM_CASE_LOOK, FROM_CASE_SAMPLE } from '../../lib/notes/fromCase.js';

  let {
    caseId,
    rows = [],
    loading = false,
    templates = [],
    selected = $bindable([]),
    onopen,
    onnew,
    onstart,
    onmenu,
    onexport = () => {},
    onreport = () => {},
  } = $props();

  let query = $state('');
  let sort = $state('recent');
  let folder = $state('');
  let found = $state(null); // { items, total } for the words typed, or null
  let searching = $state(false);
  let armed = $state(false); // Select pressed with nothing picked yet
  let fromCase = $state(false); // the From the case dialog is open
  let anchorId = null; // where a Shift-press run starts

  const caseNotes = $derived(rows.find((row) => row.id === 'case') ?? null);
  const filed = $derived(rows.filter((row) => row.id !== 'case'));
  const folders = $derived([...new Set(filed.map((row) => row.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b)));
  const shown = $derived(filed
    .filter((row) => !folder || row.folder === folder || row.folder.startsWith(`${folder}/`))
    .sort((a, b) => (sort === 'name'
      ? a.title.localeCompare(b.title)
      : String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))));
  const reports = $derived(shown.filter(isReport));
  const others = $derived(shown.filter((row) => !isReport(row)));
  /** The cards in the order they are on screen, which a Shift-press run follows. */
  const order = $derived([...reports.map((row) => row.id), 'case', ...others.map((row) => row.id)]);
  const selecting = $derived(armed || selected.length > 0);
  const picked = $derived(new Set(selected));

  // the notes picked were exported or made a report: the picking is over
  let hadPicked = false;
  $effect(() => {
    const count = selected.length;
    untrack(() => {
      if (hadPicked && !count) armed = false;
      hadPicked = count > 0;
    });
  });

  // the words are looked for inside every note, on the server, a moment after typing stops
  $effect(() => {
    const words = query.trim();
    const id = caseId;
    if (!words) {
      found = null;
      searching = false;
      return;
    }
    searching = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api.get(`/api/cases/${id}/notes/search?${new URLSearchParams({ q: words, limit: '50' })}`, { signal: controller.signal })
        .then((result) => { if (untrack(() => query.trim()) === words) found = result; })
        .catch(() => {})
        .finally(() => { if (!controller.signal.aborted) searching = false; });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  });

  function said(row) {
    const parts = [timeAgo(row.updated_at)];
    if (row.includes) parts.push(`${row.includes} chapter${row.includes === 1 ? '' : 's'}`);
    if (row.words) parts.push(`${row.words} word${row.words === 1 ? '' : 's'}`);
    if (row.tasks?.open) parts.push(`${row.tasks.open} to do`);
    if (row.mentions) parts.push(`cites ${row.mentions}`);
    return parts.filter(Boolean).join(' · ');
  }

  /** Tick or untick a card; with Shift, every card from the last one ticked to this one. */
  function pick(id, run = false) {
    if (run && anchorId && anchorId !== id) {
      const from = order.indexOf(anchorId);
      const to = order.indexOf(id);
      if (from >= 0 && to >= 0) {
        const span = order.slice(Math.min(from, to), Math.max(from, to) + 1);
        selected = [...selected, ...span.filter((item) => !picked.has(item))];
        anchorId = id;
        return;
      }
    }
    selected = picked.has(id) ? selected.filter((item) => item !== id) : [...selected, id];
    anchorId = id;
  }

  /** Every note the folder shown holds, the case notes left as they are. */
  function pickAll() {
    const ids = shown.map((row) => row.id);
    const all = ids.every((id) => picked.has(id));
    selected = all ? selected.filter((id) => !ids.includes(id)) : [...selected, ...ids.filter((id) => !picked.has(id))];
  }

  function cancel() {
    selected = [];
    armed = false;
    anchorId = null;
  }

  /** A press on a card opens it, or picks it while notes are being picked. */
  function press(id, event) {
    if (selecting) pick(id, event.shiftKey);
    else onopen(id);
  }

  function key(event) {
    if (event.key !== 'Escape' || !selecting || event.defaultPrevented) return;
    if (event.target?.closest?.('input, textarea, [role="dialog"], .float-menu')) return;
    cancel();
  }
</script>

<svelte:window onkeydown={key} />

{#snippet card(row, wide = false)}
  {@const on = picked.has(row.id)}
  <div class="note-card" class:wide class:on class:selecting data-guide={row.id === 'case' ? 'notebook.case' : undefined}>
    <button type="button" class="open" onclick={(event) => press(row.id, event)}
      title={selecting ? `Pick ${row.title}` : row.id === 'case' ? 'Open the case notes' : `Open ${row.title}`}>
      <span class="name">{#if row.id === 'case'}<Icon name="note" size={14} />{/if} {row.title}</span>
      {#if isReport(row)}
        <span class="kind"><Icon name="layers" size={11} /> {styleLabel(row.look?.style ?? 'plain')}</span>
      {:else if row.folder}
        <span class="folder"><Icon name="folder" size={11} /> {row.folder}</span>
      {/if}
      <span class="excerpt">{row.excerpt || (row.id === 'case' ? 'The case’s own page, always here. A log of the work fits it well.' : 'Nothing written yet.')}</span>
      {#if row.updated_at}<span class="said">{said(row)}</span>{/if}
    </button>
    <input type="checkbox" class="pick" checked={on} aria-label={`Pick ${row.title}`}
      title="Pick it, Shift-click for a run"
      onclick={(event) => pick(row.id, event.shiftKey)} />
    <button type="button" class="more" aria-label={`Actions for ${row.id === 'case' ? 'the case notes' : row.title}`} title="More"
      onclick={(event) => onmenu({ id: row.id, title: row.title }, event.currentTarget)}><Icon name="more" size={13} /></button>
  </div>
{/snippet}

{#snippet tile(item, guide = undefined)}
  <button type="button" class="tile" title="A new note from it, opened at once" data-guide={guide}
    onclick={() => onstart({ name: item.start, body: item.body, folder: item.folder, look: item.look })}>
    <span class="stage"><PageThumb name={item.start} body={item.body} look={item.look} width={118} /></span>
    <span class="tile-name">{item.name}</span>
    <span class="tile-said">{item.note}</span>
  </button>
{/snippet}

<div class="start">
  <div class="start-col">
    <div class="start-head">
      <div>
        <h3>Notes</h3>
        <p>The case's writing: leads, write-ups and a log, citing what the case holds.</p>
      </div>
      <button class="btn btn-primary" onclick={onnew} data-guide="notebook.new"><Icon name="plus" size={15} /> New note</button>
    </div>
    <p class="hint">In a note, type @ to cite a place, a person or a file, and / for headings, tasks, pictures, diagrams and chapters.</p>

    <div class="find" data-guide="notebook.search">
      <SearchInput bind:value={query} placeholder="Find words in the notes…" width="100%" />
      {#if !query.trim()}
        <div class="sorts" role="group" aria-label="Order">
          <button type="button" class:on={sort === 'recent'} aria-pressed={sort === 'recent'} onclick={() => (sort = 'recent')}>Recent</button>
          <button type="button" class:on={sort === 'name'} aria-pressed={sort === 'name'} onclick={() => (sort = 'name')}>Name</button>
        </div>
      {/if}
    </div>

    {#if query.trim()}
      <h4>{searching && !found ? 'Searching…' : `${found?.total ?? 0} note${found?.total === 1 ? '' : 's'} with these words`}</h4>
      <div class="hits">
        {#each found?.items ?? [] as hit (hit.id)}
          <button type="button" class="hit" onclick={() => onopen(hit.id, { line: hit.line })}>
            <span class="hit-title"><Icon name="note" size={13} /> {hit.title}{#if hit.folder}<small>{hit.folder}</small>{/if}</span>
            <span class="hit-said">{hit.snippet}</span>
          </button>
        {/each}
      </div>
    {:else}
      {#if reports.length}
        <h4>Reports · {reports.length}</h4>
        <div class="cards" data-guide="notebook.reports">
          {#each reports as row (row.id)}{@render card(row)}{/each}
        </div>
      {/if}

      <h4>Case notes</h4>
      {@render card({ id: 'case', title: 'Case notes', excerpt: caseNotes?.excerpt ?? '', updated_at: caseNotes?.updated_at ?? '',
        words: caseNotes?.words, tasks: caseNotes?.tasks, mentions: caseNotes?.mentions, look: caseNotes?.look, includes: caseNotes?.includes }, true)}

      <div class="section-head">
        <h4>In this case{filed.length ? ` · ${filed.length}` : ''}</h4>
        {#if shown.length}
          <button type="button" class="link" onclick={() => (selecting ? pickAll() : (armed = true))}
            title={selecting ? 'Pick every note shown, or none' : 'Pick notes to export them or to make a report'}>
            {selecting ? (shown.every((row) => picked.has(row.id)) ? 'Select none' : `Select all ${shown.length}`) : 'Select'}
          </button>
        {/if}
      </div>
      {#if folders.length}
        <div class="folders" role="group" aria-label="Folder">
          <button type="button" class:on={!folder} onclick={() => (folder = '')}>All</button>
          {#each folders as name (name)}
            <button type="button" class:on={folder === name} onclick={() => (folder = folder === name ? '' : name)}>{name}</button>
          {/each}
        </div>
      {/if}
      {#if loading && !rows.length}
        <p class="empty-note">Reading the notes…</p>
      {:else if others.length}
        <div class="cards" data-guide="notebook.cards">
          {#each others as row (row.id)}{@render card(row)}{/each}
        </div>
      {:else if !reports.length}
        <p class="empty-note">No note yet. Start one from below, or with New note.</p>
      {/if}

      {#if templates.length}
        <h4>Your templates</h4>
        <div class="tiles">
          {#each templates as template (template.id)}
            {@render tile({ name: template.name, start: template.name, note: styleLabel(template.data?.look?.style ?? 'plain'),
              body: template.data?.body ?? '', folder: template.data?.folder ?? '', look: template.data?.look ?? null })}
          {/each}
        </div>
      {/if}
      <h4>Start from</h4>
      <div class="tiles" data-guide="notebook.ready">
        {#each READY_NOTES as ready (ready.id)}
          {@render tile({ name: ready.name, start: ready.id === 'blank' ? 'Note' : ready.name, note: ready.note,
            body: ready.body, folder: '', look: ready.look })}
          {#if ready.id === 'blank'}
            <button type="button" class="tile" title="A note of every geolocation of a period" data-guide="notebook.from-case"
              onclick={() => (fromCase = true)}>
              <span class="stage"><PageThumb name="Geolocations, 1–14 March 2026" body={FROM_CASE_SAMPLE} look={FROM_CASE_LOOK} width={118} /></span>
              <span class="tile-name">From the case</span>
              <span class="tile-said">A period's geolocations</span>
            </button>
          {/if}
        {/each}
      </div>
    {/if}

    {#if fromCase}
      <FromCaseDialog {caseId} taken={filed.map((row) => row.title)} onclose={() => (fromCase = false)}
        oncreate={(start) => onstart(start)} />
    {/if}

    {#if selecting}
      <div class="select-bar" role="toolbar" aria-label="Picked notes" data-guide="notebook.selection">
        <span class="count">{selected.length ? `${selected.length} selected` : 'Pick notes'}</span>
        <button type="button" class="btn btn-sm" disabled={!selected.length} title="One PDF per note, in the export folder"
          onclick={() => onexport([...selected])}><Icon name="download" size={13} /> Export as PDF</button>
        <button type="button" class="btn btn-sm btn-primary" disabled={!selected.length}
          title="A new note that includes these as chapters, in the order picked"
          onclick={() => onreport([...selected])}><Icon name="layers" size={13} /> Make a report</button>
        <button type="button" class="btn btn-ghost btn-sm" onclick={cancel}>Cancel</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .start { flex: 1; min-height: 0; overflow: auto; }
  .start-col { max-width: 920px; margin: 0 auto; padding: 28px 20px 40px; }
  .start-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .start-head h3 { margin: 0 0 4px; }
  .start-head p, .hint, .empty-note { margin: 0; color: var(--text-3); font-size: var(--fs-sm); }
  .hint { margin: 8px 0 16px; font-size: var(--fs-xs); }
  h4 { margin: 20px 0 8px; color: var(--text-3); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
  .section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .link {
    border: none; background: none; padding: 0; color: var(--text-2); font: inherit; font-size: var(--fs-xs); cursor: pointer;
  }
  .link:hover { color: var(--accent); }
  .find { display: flex; align-items: center; gap: 10px; }
  .find :global(.search-box) { flex: 1; }
  .sorts, .folders { display: flex; gap: 2px; flex-wrap: wrap; }
  .folders { margin-bottom: 10px; }
  .sorts button, .folders button {
    border: 1px solid var(--border); background: var(--bg-1); color: var(--text-2); border-radius: var(--r-sm);
    padding: 3px 9px; font: inherit; font-size: var(--fs-xs); cursor: pointer;
  }
  .sorts button.on, .folders button.on { color: var(--text-1); border-color: var(--accent); }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; }
  .note-card { position: relative; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-1); }
  .note-card:hover { border-color: var(--accent); }
  .note-card.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); background: var(--accent-soft); }
  .note-card .open {
    display: flex; flex-direction: column; gap: 5px; width: 100%; padding: 12px 58px 12px 14px; border: none; background: none;
    color: inherit; text-align: left; cursor: pointer; font: inherit; min-height: 118px;
  }
  .note-card.wide .open { min-height: 0; }
  .name { font-weight: 600; color: var(--text-1); display: inline-flex; align-items: center; gap: 6px; overflow-wrap: anywhere; }
  .folder, .kind { color: var(--text-3); font-size: var(--fs-xs); display: inline-flex; align-items: center; gap: 4px; }
  .kind { color: var(--accent); }
  .excerpt {
    color: var(--text-2); font-size: var(--fs-sm); line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 3;
    line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; flex: 1;
  }
  .said { color: var(--text-3); font-size: var(--fs-xs); }
  .more {
    position: absolute; top: 8px; right: 6px; border: none; background: none; color: var(--text-3); cursor: pointer;
    padding: 4px; border-radius: var(--r-sm);
  }
  .more:hover { color: var(--text-1); background: var(--bg-3); }
  /* the box to pick a card: on hover, and on every card once picking has begun */
  .pick {
    position: absolute; top: 11px; right: 34px; width: 15px; height: 15px; margin: 0; accent-color: var(--accent); cursor: pointer;
    opacity: 0; transition: opacity .12s var(--ease);
  }
  .note-card:hover .pick, .pick:focus-visible, .note-card.selecting .pick, .note-card.on .pick { opacity: 1; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(156px, 1fr)); gap: 10px; }
  .tile {
    display: flex; flex-direction: column; gap: 3px; padding: 0 0 10px; border: 1px solid var(--border); border-radius: var(--r-md);
    background: var(--bg-1); color: inherit; text-align: left; cursor: pointer; font: inherit; overflow: hidden;
  }
  .tile:hover { border-color: var(--accent); }
  .stage {
    display: flex; justify-content: center; height: 128px; padding-top: 14px; margin-bottom: 7px; overflow: hidden;
    background: var(--bg-0); border-bottom: 1px solid var(--border);
  }
  .tile:hover .stage :global(.thumb) { transform: translateY(-3px); }
  .stage :global(.thumb) { transition: transform .18s var(--ease); }
  .tile-name { padding: 0 11px; font-weight: 600; color: var(--text-1); font-size: var(--fs-sm); }
  .tile-said { padding: 0 11px; color: var(--text-3); font-size: var(--fs-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hits { display: flex; flex-direction: column; gap: 6px; }
  .hit {
    display: flex; flex-direction: column; gap: 3px; padding: 9px 12px; border: 1px solid var(--border); border-radius: var(--r-md);
    background: var(--bg-1); color: inherit; text-align: left; cursor: pointer; font: inherit;
  }
  .hit:hover { border-color: var(--accent); }
  .hit-title { font-weight: 600; display: inline-flex; align-items: center; gap: 6px; }
  .hit-title small { color: var(--text-3); font-weight: 400; font-size: var(--fs-xs); margin-left: 6px; }
  .hit-said { color: var(--text-2); font-size: var(--fs-sm); }
  .select-bar {
    position: sticky; bottom: 14px; z-index: 5; display: flex; align-items: center; gap: 8px; width: fit-content; margin: 22px auto 0;
    padding: 7px 8px 7px 14px; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--bg-2); box-shadow: var(--shadow-2);
  }
  .count { margin-right: 6px; color: var(--text-1); font-size: var(--fs-sm); font-weight: 600; }
</style>
