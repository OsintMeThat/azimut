<script>
  /**
   * Where the Notebook opens: the case's notes as cards, what they hold said on
   * each, a search through their words, and the notes a new one starts from.
   * One press opens a note, and its ⋯ puts it beside the tools or in a tab of
   * its own.
   */
  import { untrack } from 'svelte';
  import { api } from '../../lib/api.js';
  import { timeAgo } from '../../lib/analysisViews.js';
  import { READY_NOTES } from '../../lib/notes/ready.js';
  import Icon from '../../components/Icon.svelte';
  import SearchInput from '../../components/SearchInput.svelte';

  let {
    caseId,
    rows = [],
    loading = false,
    templates = [],
    onopen,
    onnew,
    onstart,
    onmenu,
  } = $props();

  let query = $state('');
  let sort = $state('recent');
  let folder = $state('');
  let found = $state(null); // { items, total } for the words typed, or null
  let searching = $state(false);

  const caseNotes = $derived(rows.find((row) => row.id === 'case') ?? null);
  const filed = $derived(rows.filter((row) => row.id !== 'case'));
  const folders = $derived([...new Set(filed.map((row) => row.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b)));
  const shown = $derived(filed
    .filter((row) => !folder || row.folder === folder || row.folder.startsWith(`${folder}/`))
    .sort((a, b) => (sort === 'name'
      ? a.title.localeCompare(b.title)
      : String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))));

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
    if (row.words) parts.push(`${row.words} word${row.words === 1 ? '' : 's'}`);
    if (row.tasks?.open) parts.push(`${row.tasks.open} to do`);
    if (row.mentions) parts.push(`cites ${row.mentions}`);
    return parts.filter(Boolean).join(' · ');
  }

  function firstLine(body) {
    return String(body ?? '').split('\n').map((line) => line.replace(/^[#>\-*\s[\]!]+/, '').trim()).find(Boolean) ?? 'An empty page';
  }
</script>

<div class="start">
  <div class="start-col">
    <div class="start-head">
      <div>
        <h3>Notes</h3>
        <p>The case's writing: leads, write-ups and a log, citing what the case holds.</p>
      </div>
      <button class="btn btn-primary" onclick={onnew} data-guide="notebook.new"><Icon name="plus" size={15} /> New note</button>
    </div>
    <p class="hint">In a note, type @ to cite a place, a person or a file, and / for headings, tasks, pictures and diagrams.</p>

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
      <h4>Case notes</h4>
      <div class="note-card wide" data-guide="notebook.case">
        <button type="button" class="open" onclick={() => onopen('case')} title="Open the case notes">
          <span class="name"><Icon name="note" size={14} /> Case notes</span>
          <span class="excerpt">{caseNotes?.excerpt || 'The case’s own page, always here. A log of the work fits it well.'}</span>
          {#if caseNotes?.updated_at}<span class="said">{said(caseNotes)}</span>{/if}
        </button>
        <button type="button" class="more" aria-label="Actions for the case notes" title="More"
          onclick={(event) => onmenu({ id: 'case', title: 'Case notes' }, event.currentTarget)}><Icon name="more" size={13} /></button>
      </div>

      <h4>In this case{filed.length ? ` · ${filed.length}` : ''}</h4>
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
      {:else if shown.length}
        <div class="cards" data-guide="notebook.cards">
          {#each shown as row (row.id)}
            <div class="note-card">
              <button type="button" class="open" onclick={() => onopen(row.id)} title={`Open ${row.title}`}>
                <span class="name">{row.title}</span>
                {#if row.folder}<span class="folder"><Icon name="folder" size={11} /> {row.folder}</span>{/if}
                <span class="excerpt">{row.excerpt || 'Nothing written yet.'}</span>
                <span class="said">{said(row)}</span>
              </button>
              <button type="button" class="more" aria-label={`Actions for ${row.title}`} title="More"
                onclick={(event) => onmenu(row, event.currentTarget)}><Icon name="more" size={13} /></button>
            </div>
          {/each}
        </div>
      {:else}
        <p class="empty-note">No note yet. Start one from below, or with New note.</p>
      {/if}

      {#if templates.length}
        <h4>Your templates</h4>
        <div class="tiles">
          {#each templates as template (template.id)}
            <button type="button" class="tile" onclick={() => onstart({ name: template.name, body: template.data?.body ?? '', folder: template.data?.folder ?? '' })}
              title="A new note from this template">
              <span class="name">{template.name}</span><span class="said">{firstLine(template.data?.body)}</span>
            </button>
          {/each}
        </div>
      {/if}
      <h4>Start from</h4>
      <div class="tiles" data-guide="notebook.ready">
        {#each READY_NOTES as ready (ready.id)}
          <button type="button" class="tile" onclick={() => onstart({ name: ready.id === 'blank' ? 'Note' : ready.name, body: ready.body, folder: '' })}
            title="A new note from it, opened at once">
            <span class="name">{ready.name}</span><span class="said">{ready.note}</span>
          </button>
        {/each}
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
  .note-card .open {
    display: flex; flex-direction: column; gap: 5px; width: 100%; padding: 12px 34px 12px 14px; border: none; background: none;
    color: inherit; text-align: left; cursor: pointer; font: inherit; min-height: 118px;
  }
  .note-card.wide .open { min-height: 0; }
  .name { font-weight: 600; color: var(--text-1); display: inline-flex; align-items: center; gap: 6px; overflow-wrap: anywhere; }
  .folder { color: var(--text-3); font-size: var(--fs-xs); display: inline-flex; align-items: center; gap: 4px; }
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
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
  .tile {
    display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--r-md);
    background: var(--bg-1); color: inherit; text-align: left; cursor: pointer; font: inherit;
  }
  .tile:hover { border-color: var(--accent); }
  .tile .said { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hits { display: flex; flex-direction: column; gap: 6px; }
  .hit {
    display: flex; flex-direction: column; gap: 3px; padding: 9px 12px; border: 1px solid var(--border); border-radius: var(--r-md);
    background: var(--bg-1); color: inherit; text-align: left; cursor: pointer; font: inherit;
  }
  .hit:hover { border-color: var(--accent); }
  .hit-title { font-weight: 600; display: inline-flex; align-items: center; gap: 6px; }
  .hit-title small { color: var(--text-3); font-weight: 400; font-size: var(--fs-xs); margin-left: 6px; }
  .hit-said { color: var(--text-2); font-size: var(--fs-sm); }
</style>
