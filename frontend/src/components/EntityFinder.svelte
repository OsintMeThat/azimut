<script>
  /**
   * Find one thing in the case to attach, among the types a connector accepts.
   *
   * A source can be a file, a map capture, a proof, a web page, a note or another
   * claim, and one list of all of them read as everything the case holds. So the
   * kinds the case actually has are chips above the list, each with its count, and
   * every row says what it is: its picture when it has one, its type, the kind of
   * file, its folder and the day it came in. The newest come first when asked, which
   * is where the source being cited usually is.
   */
  import { api } from '../lib/api.js';
  import { buildCatalogQuery } from '../lib/catalog.js';
  import { entityIcon } from '../lib/entityIcon.js';
  import { entitySearchMatches } from '../lib/entitySearch.js';
  import { entityLabel } from '../lib/entityTypes.svelte.js';
  import { fileUrl } from '../lib/fileUrl.js';
  import { folderOf } from '../lib/folderTree.js';
  import Icon from './Icon.svelte';

  let {
    caseId,
    /** The types the connector accepts. */
    types = [],
    /** Ids already attached, left out of the list. */
    exclude = [],
    /** `-created` for newest first, or '' for the catalog's own order. */
    order = '',
    placeholder = 'Search the case…',
    label = 'Search the case',
    onpick,
    onclose,
  } = $props();

  const PAGE = 30;
  let query = $state('');
  let kind = $state('');
  let rows = $state([]);
  let more = $state(false);
  let loading = $state(false);
  let active = $state(0);
  let summary = $state(null);
  let input = $state();
  let seq = 0;

  $effect(() => {
    if (!caseId) return;
    let live = true;
    api.get(`/api/cases/${caseId}/catalog/summary`)
      .then((body) => { if (live) summary = body; })
      .catch(() => {});
    return () => { live = false; };
  });

  /** The kinds worth a chip: the accepted types this case holds any of. */
  const kinds = $derived(
    types
      .map((type) => ({ type, label: entityLabel(type), count: Number(summary?.by_type?.[type] ?? 0) }))
      .filter((entry) => entry.count > 0)
  );

  const hidden = $derived(new Set(exclude));
  const shown = $derived(rows.filter((entity) => !hidden.has(entity.id)));

  $effect(() => {
    const term = query.trim();
    const wanted = kind ? [kind] : types;
    if (!caseId || !wanted.length) return;
    const mine = ++seq;
    loading = true;
    api
      .get(buildCatalogQuery(caseId, { types: wanted, query: term || undefined, limit: PAGE, order, previews: true }))
      .then((page) => {
        if (mine !== seq) return;
        rows = page.items ?? [];
        more = Boolean(page.next_cursor);
        active = 0;
      })
      .catch(() => {
        if (mine === seq) rows = [];
      })
      .finally(() => {
        if (mine === seq) loading = false;
      });
  });

  $effect(() => {
    input?.focus();
  });

  const day = (at) => {
    const date = new Date(at ?? '');
    return Number.isNaN(date.getTime())
      ? ''
      : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  /** What a row is, in a few words: its type, the kind of file, where it is filed
   *  and when it came in. */
  function describe(entity) {
    const kindOfFile = entity.type === 'media' ? entity.attrs?.kind : '';
    const folder = folderOf(entity);
    return [
      entityLabel(entity.type),
      kindOfFile && kindOfFile !== 'file' ? kindOfFile : '',
      folder ? `in ${folder}` : '',
      day(entity.provenance?.at) ? `added ${day(entity.provenance?.at)}` : '',
    ].filter(Boolean).join(' · ');
  }

  function reason(entity) {
    if (!query.trim()) return null;
    const match = entitySearchMatches(entity, query)[0];
    return match && match.field !== 'label' ? match : null;
  }

  function pick(entity) {
    if (entity) onpick?.(entity);
  }

  function onkeydown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!shown.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      active = (active + step + shown.length) % shown.length;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      pick(shown[active]);
    } else if (event.key === 'Escape' && onclose) {
      event.preventDefault();
      event.stopPropagation();
      onclose();
    }
  }
</script>

<div class="finder">
  <div class="search">
    <Icon name="search" size={13} />
    <input
      bind:this={input}
      type="search"
      dir="auto"
      autocomplete="off"
      aria-label={label}
      {placeholder}
      bind:value={query}
      {onkeydown}
    />
  </div>

  {#if kinds.length > 1}
    <div class="kinds" role="group" aria-label="Kinds">
      <button class:on={!kind} aria-pressed={!kind} onclick={() => (kind = '')}>All</button>
      {#each kinds as entry (entry.type)}
        <button class:on={kind === entry.type} aria-pressed={kind === entry.type} onclick={() => (kind = kind === entry.type ? '' : entry.type)}>
          {entry.label}<em>{entry.count}</em>
        </button>
      {/each}
    </div>
  {/if}

  <ul class="rows" role="listbox" aria-label={label}>
    {#each shown as entity, index (entity.id)}
      {@const why = reason(entity)}
      <li
        role="option"
        aria-selected={index === active}
        class:active={index === active}
        onpointerenter={() => (active = index)}
        onpointerdown={(event) => { event.preventDefault(); pick(entity); }}
      >
        <span class="picture">
          {#if entity.thumb}
            <img src={entity.thumb.startsWith('data:') ? entity.thumb : fileUrl(caseId, entity.thumb)} alt="" loading="lazy" />
          {:else}
            <Icon name={entityIcon(entity)} size={14} />
          {/if}
        </span>
        <span class="text">
          <span class="name" dir="auto">{entity.label}</span>
          <small>{describe(entity)}{#if why} · <span dir="auto">{why.label}: {why.value}</span>{/if}</small>
        </span>
      </li>
    {:else}
      <li class="none">
        {#if loading}Searching…
        {:else if query.trim()}Nothing here by that name{kind ? ` among the ${entityLabel(kind).toLowerCase()} kind` : ''}
        {:else}Nothing of this kind in the case yet{/if}
      </li>
    {/each}
    {#if more && shown.length}
      <li class="none">More below these {shown.length}: type a few letters to narrow</li>
    {/if}
  </ul>
</div>

<style>
  .finder { display: grid; gap: 6px; min-width: 0; }
  .search {
    display: flex; align-items: center; gap: 6px; padding: 5px 9px;
    border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-2); color: var(--text-3);
  }
  .search:focus-within { border-color: var(--accent); }
  .search input { flex: 1; min-width: 0; border: 0; background: none; color: var(--text-1); font: inherit; font-size: var(--fs-sm); outline: none; }
  .kinds { display: flex; flex-wrap: wrap; gap: 4px; }
  .kinds button {
    display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px;
    border: 1px solid var(--border); border-radius: 999px; background: none;
    color: var(--text-2); font-size: var(--fs-xs); cursor: pointer;
  }
  .kinds button.on { border-color: var(--accent); color: var(--text-1); background: var(--accent-soft); }
  .kinds em { color: var(--text-3); font-style: normal; font-size: 10px; }
  .rows { max-height: 260px; overflow: auto; margin: 0; padding: 0; list-style: none; }
  .rows li {
    display: grid; grid-template-columns: 34px minmax(0, 1fr); align-items: center; gap: 9px;
    padding: 5px 6px; border-radius: var(--r-sm); cursor: pointer; color: var(--text-2);
  }
  .rows li.active { background: var(--bg-3); color: var(--text-1); }
  .rows li.none { display: block; padding: 10px; color: var(--text-3); font-size: var(--fs-xs); text-align: center; cursor: default; }
  .picture {
    width: 34px; height: 26px; display: grid; place-items: center; overflow: hidden;
    border-radius: 3px; background: var(--bg-2); color: var(--text-3);
  }
  .picture img { width: 100%; height: 100%; object-fit: cover; }
  .text { display: grid; min-width: 0; }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--fs-sm); }
  .text small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-3); font-size: 10px; }
</style>
