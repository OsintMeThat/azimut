<script>
  import { tick, untrack } from 'svelte';
  import { api } from '../lib/api.js';
  import { caseState, openCase, toast, uiState } from '../lib/state.svelte.js';
  import { buildCatalogQuery } from '../lib/catalog.js';
  import { entityLabel, entityTypes } from '../lib/entityTypes.svelte.js';
  import { entityIcon, entityKindLabel } from '../lib/entityIcon.js';
  import { openEntity } from '../lib/navigate.js';
  import { matchRuns, paletteTools } from '../lib/commandPalette.js';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';

  let { open = $bindable(false), tools = [] } = $props();
  let query = $state('');
  let documents = $state([]);
  let documentCase = $state(null);
  let cases = $state([]);
  let selected = $state(0);
  let loading = $state(false);
  let errors = $state([]);
  let total = $state(0);
  let list = $state(null);
  let loadedCase = $state(null);
  let loadedQuery = $state('');
  let openAfterSearch = false;
  let answered = false;

  const documentTypes = $derived(entityTypes()
    .filter((entry) => ['document', 'collected'].includes(entry.family))
    .map((entry) => entry.type));
  const toolRows = $derived(paletteTools(tools, loadedQuery));
  const documentRows = $derived(documents.map((entity) => ({
    kind: 'document', id: entity.id, label: entity.label, caseId: documentCase,
    detail: [entityKindLabel(entity, entityLabel(entity.type)), entity.attrs?.folder].filter(Boolean).join(' · '),
    icon: entityIcon(entity), entity,
  })));
  const caseRows = $derived(cases.map((item) => ({
    kind: 'case', id: item.id, label: item.name ?? item.id,
    detail: [item.scratch ? 'Scratch' : 'Case', item.id === caseState.current?.id ? 'Current' : ''].filter(Boolean).join(' · '), icon: 'folder',
  })));
  const groups = $derived(loadedQuery
    ? [{ label: 'Tools', rows: toolRows }, { label: 'Documents', rows: documentRows }, { label: 'Cases', rows: caseRows }]
    : [{ label: 'Recently added', rows: documentRows }, { label: 'Tools', rows: toolRows }, { label: 'Cases', rows: caseRows }]);
  const rows = $derived(groups.flatMap((group) => group.rows));

  $effect(() => {
    if (open) {
      query = '';
      loadedQuery = '';
      documents = [];
      cases = [];
      total = 0;
      selected = 0;
      answered = false;
    }
  });

  $effect(() => {
    if (!open) return;
    const caseId = caseState.current?.id;
    const text = query.trim();
    const types = documentTypes;
    const controller = new AbortController();
    openAfterSearch = false;
    if (caseId !== untrack(() => loadedCase)) {
      documents = [];
      cases = [];
      total = 0;
    }
    errors = [];
    loading = true;

    const timer = setTimeout(async () => {
      const caseQuery = new URLSearchParams({ limit: '8' });
      if (text) caseQuery.set('q', text);
      const requests = [api.get(`/api/cases?${caseQuery}`, { signal: controller.signal })];
      if (caseId && types.length) {
        requests.push(api.get(buildCatalogQuery(caseId, {
          types, query: text, limit: text ? 20 : 8, order: text ? 'relevance' : '-created',
        }), { signal: controller.signal }));
      }
      const [caseResult, documentResult] = await Promise.allSettled(requests);
      if (controller.signal.aborted || !open || caseId !== caseState.current?.id || text !== query.trim()) return;
      const active = untrack(() => rows[selected]);
      if (caseResult.status === 'fulfilled') cases = caseResult.value;
      else { cases = []; errors.push('Could not load cases.'); }
      if (documentResult?.status === 'fulfilled') {
        documents = documentResult.value.items ?? [];
        documentCase = caseId;
        total = documentResult.value.total ?? documents.length;
      } else if (documentResult?.status === 'rejected' || (caseId && !types.length)) {
        documents = [];
        total = 0;
        errors.push('Could not load documents.');
      }
      // A refreshed answer to the same words keeps the row the analyst was on; the
      // first answer and new words start from the top, which is what Enter should open.
      const sameQuery = answered && text === loadedQuery;
      answered = true;
      loadedCase = caseId;
      loadedQuery = text;
      selected = sameQuery ? Math.max(0, rows.findIndex((row) => row.kind === active?.kind && row.id === active?.id)) : 0;
      if (!sameQuery && list) list.scrollTop = 0;
      loading = false;
      if (openAfterSearch) { openAfterSearch = false; void choose(rows[selected]); }
    }, text ? 150 : 0);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  });

  function close() {
    openAfterSearch = false;
    open = false;
  }

  async function choose(row) {
    if (!row) return;
    if (row.kind === 'document' && row.caseId !== caseState.current?.id) return;
    try {
      if (row.kind === 'tool') { close(); uiState.tool = row.id; }
      else if (row.kind === 'document') { close(); await openEntity(row.entity); }
      else {
        if (row.id !== caseState.current?.id) await openCase(row.id);
        if (caseState.current?.id === row.id) { close(); uiState.tool = 'overview'; }
      }
    } catch (error) {
      toast(error.message || 'Could not open this item.', 'danger');
    }
  }

  async function onKeydown(event) {
    if (event.isComposing) return;
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (!rows.length) return;
      selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
      await tick();
      list?.querySelector(`#go-to-result-${selected}`)?.scrollIntoView?.({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (loading) openAfterSearch = true;
      else void choose(rows[selected]);
    }
  }

  function focus(node) {
    queueMicrotask(() => node.isConnected && node.focus());
  }

</script>

{#if open}
  <Modal title="Go to" width="640px" align="top" bare onclose={close}>
    <div class="search" class:busy={loading}>
      <Icon name="search" size={18} />
      <input
        use:focus bind:value={query} onkeydown={onKeydown}
        placeholder="Search tools, cases and documents…" aria-label="Search tools, cases and documents"
        role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="go-to-results"
        aria-activedescendant={rows[selected] ? `go-to-result-${selected}` : undefined}
        autocomplete="off" spellcheck="false"
      />
      <button class="esc" type="button" onclick={close} aria-label="Close" title="Close">Esc</button>
    </div>
    <div class="results" id="go-to-results" role="listbox" aria-label="Destinations" bind:this={list}>
      {#each groups as group (group.label)}
        {#if group.rows.length}
          <div class="group" role="group" aria-label={group.label}>
            <h4>{group.label}</h4>
            {#each group.rows as row (`${row.kind}:${row.id}`)}
              {@const index = rows.indexOf(row)}
              <button
                class="result" class:active={selected === index} id={`go-to-result-${index}`}
                type="button" role="option" aria-selected={selected === index}
                onclick={() => choose(row)} onpointermove={() => (selected = index)}
              >
                <span class="glyph"><Icon name={row.icon} size={15} /></span>
                <span class="name" dir="auto">{#each matchRuns(row.label, loadedQuery) as run, i (i)}{#if run.hit}<b>{run.text}</b>{:else}{run.text}{/if}{/each}</span>
                {#if row.detail}<span class="detail" dir="auto">{row.detail}</span>{/if}
                <kbd class="enter" aria-hidden="true"><Icon name="enter" size={11} stroke={2.2} /></kbd>
              </button>
            {/each}
          </div>
        {/if}
      {/each}
    </div>
    <div class="status" role="status">
      {#if !loading && !rows.length && !errors.length}
        <p class="none">{loadedQuery ? `No matches for “${loadedQuery}”.` : 'No matches.'}</p>
      {/if}
      {#each errors as error}<p class="error"><Icon name="alert" size={13} />{error}</p>{/each}
      {#if !loading && loadedQuery && total > documents.length}
        <p>Showing {documents.length} of {total} documents; refine your search.</p>
      {/if}
    </div>
    <footer>
      <span><kbd>↑</kbd><kbd>↓</kbd> Choose</span>
      <span><kbd><Icon name="enter" size={11} stroke={2.2} /></kbd> Open</span>
      {#if loading}<span class="searching">Searching…</span>{/if}
    </footer>
  </Modal>
{/if}

<style>
  .search {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 14px 0 18px;
    border-bottom: 1px solid var(--border);
    color: var(--text-3);
  }
  .search:focus-within { color: var(--text-2); }
  .search input {
    flex: 1;
    min-width: 0;
    height: 56px;
    padding: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--text-1);
    font-size: var(--fs-lg);
  }
  .search input::placeholder { color: var(--text-3); }
  /* What used to be a line of text: a sliver of the accent running under the field. */
  .search.busy::after {
    content: '';
    position: absolute;
    left: 0;
    bottom: -1px;
    width: 30%;
    height: 2px;
    background: linear-gradient(90deg, transparent, var(--accent), transparent);
    animation: sweep 0.9s var(--ease) infinite;
  }
  @keyframes sweep {
    from { transform: translateX(-100%); }
    to { transform: translateX(340%); }
  }
  .esc {
    padding: 3px 7px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-sm);
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .esc:hover { color: var(--text-1); background: var(--bg-3); }

  .results {
    max-height: min(440px, 56dvh);
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 8px;
  }
  .group { padding: 6px 0 4px; }
  .group + .group { border-top: 1px solid var(--border); }
  h4 {
    padding: 8px 10px 6px;
    color: var(--text-3);
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .result {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 40px;
    padding: 6px 10px;
    border-radius: var(--r-md);
    text-align: left;
    color: var(--text-1);
  }
  .result.active { background: var(--bg-3); }
  .glyph {
    display: grid;
    place-items: center;
    flex: none;
    width: 28px;
    height: 28px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-2);
    color: var(--text-2);
  }
  .result.active .glyph { border-color: transparent; background: var(--accent-soft); color: var(--accent); }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-md);
  }
  .name b { font-weight: 700; color: var(--text-1); text-decoration: underline; text-decoration-color: var(--accent); text-underline-offset: 3px; }
  .detail {
    flex: none;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .result.active .detail { color: var(--text-2); }
  .enter { visibility: hidden; }
  .result.active .enter { visibility: visible; }

  .status { color: var(--text-3); font-size: var(--fs-xs); }
  .status p { padding: 8px 18px; }
  .status p:first-child { padding-top: 10px; }
  .status p:last-child { padding-bottom: 10px; }
  .status .none { padding: 28px 18px; text-align: center; font-size: var(--fs-sm); }
  .status .error { display: flex; align-items: center; gap: 6px; color: var(--danger); }

  footer {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 9px 18px;
    border-top: 1px solid var(--border);
    background: var(--bg-0);
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .searching { margin-left: auto; }
  kbd {
    display: inline-grid;
    place-items: center;
    min-width: 18px;
    height: 18px;
    margin-right: 3px;
    padding: 0 4px;
    border: 1px solid var(--border-strong);
    border-bottom-width: 2px;
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-2);
    font: inherit;
    font-size: 0.68rem;
    line-height: 1;
  }
  @media (max-width: 480px) {
    .search { padding: 0 10px 0 14px; }
    .search input { font-size: var(--fs-md); }
    .detail { max-width: 32%; }
    footer { gap: 12px; padding: 9px 14px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .search.busy::after { animation: none; width: 100%; opacity: 0.5; }
  }
</style>
