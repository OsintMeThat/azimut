<script>
  /**
   * Point a sheet cell at an entity the case already holds.
   *
   * A single search bar is not enough here and the reason is worth stating: the
   * analyst pointing a cell at an entity usually does **not** know the label. The
   * cell says `3rd Bde` and the case holds `3rd Separate Brigade`; it says `AB-123`
   * and the case holds a vehicle filed under a folder. Typing into a bar only works
   * when you already know the answer.
   *
   * So the picker leads with what the case *has*: a count per type, taken from the
   * catalog summary, and a list that is populated before a key is pressed. Narrowing
   * by type is one click and it says how big each answer is first — the same rule the
   * catalog's own filter menu follows, so nobody picks a term and lands on nothing.
   */
  import { untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import { api } from '../lib/api.js';
  import { entityIcon } from '../lib/entityIcon.js';

  let { caseId, cellText = '', current = null, onpick, onclear, onclose } = $props();

  /** One page. Not a ceiling: `next_cursor` carries the rest, and the count above the
   *  list says how much rest there is — a case of a thousand entities is walkable
   *  rather than silently cut at the first forty. */
  const PAGE = 40;

  /** How the **whole filtered set** is ordered, server-side. That is the point: sorting
   *  the forty rows already loaded answers a different question from sorting the
   *  thousand that match. A→Z leads because a picker is used to find a name.
   *  Mirrors `store/cursors._PAGE_ORDERS`. */
  const ORDERS = [
    { id: 'label', label: 'A→Z' },
    { id: '-label', label: 'Z→A' },
    { id: '-created', label: 'Newest' },
    { id: 'created', label: 'Oldest' },
  ];

  /** Seeded from the cell once, then the analyst's to change. Untracked on purpose:
   *  a picker that reset the box every time the cell behind it changed would fight
   *  whoever is typing in it. */
  let query = $state(untrack(() => String(cellText ?? '').trim()));
  let type = $state(null);
  let order = $state('label');
  let items = $state([]);
  let cursor = $state(null);
  /** How many match what is being asked — not how many are on screen. */
  let matching = $state(0);
  let counts = $state([]);
  let total = $state(0);
  let loading = $state(true);
  let loadingMore = $state(false);
  let highlighted = $state(0);
  let listElement = $state(null);

  $effect(() => {
    if (!caseId) return;
    let live = true;
    api
      .get(`/api/cases/${caseId}/catalog/summary`)
      .then((answer) => {
        if (!live) return;
        total = answer.total ?? 0;
        counts = Object.entries(answer.by_type ?? {})
          .map(([id, count]) => ({ id, count }))
          .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
      })
      .catch(() => {});
    return () => (live = false);
  });

  function page(term, wanted, chosen, from) {
    const params = new URLSearchParams({ limit: String(PAGE), order: chosen });
    if (term) params.set('q', term);
    if (wanted) params.set('type', wanted);
    if (from) params.set('cursor', from);
    return api.get(`/api/cases/${caseId}/catalog/entities?${params}`);
  }

  // One effect for the first page, keyed on all three questions asked of it, so a type
  // chosen while a word is typed narrows rather than replacing. Changing any of them
  // starts the list over: a cursor belongs to the query it was issued for.
  $effect(() => {
    const term = query.trim();
    const wanted = type;
    const chosen = order;
    if (!caseId) return;
    let live = true;
    loading = true;
    page(term, wanted, chosen, null)
      .then((answer) => {
        if (!live) return;
        items = answer.items ?? [];
        cursor = answer.next_cursor ?? null;
        matching = answer.total ?? items.length;
        highlighted = 0;
        loading = false;
      })
      .catch(() => {
        if (!live) return;
        items = [];
        cursor = null;
        matching = 0;
        loading = false;
      });
    return () => (live = false);
  });

  /** The next page, appended. Deliberately a press rather than an infinite scroll: a
   *  list that grows while it is being read moves the row under the pointer. */
  async function more() {
    if (!cursor || loadingMore) return;
    loadingMore = true;
    try {
      const answer = await page(query.trim(), type, order, cursor);
      items = [...items, ...(answer.items ?? [])];
      cursor = answer.next_cursor ?? null;
    } catch {
      cursor = null;
    } finally {
      loadingMore = false;
    }
  }

  function onKey(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      highlighted = Math.min(Math.max(highlighted + step, 0), Math.max(0, items.length - 1));
      // Walking onto the last row loads the next page: the keyboard should not stop
      // at a boundary the list only has because it pages.
      if (highlighted === items.length - 1) more();
      listElement?.children[highlighted]?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (event.key === 'Enter' && items[highlighted]) {
      event.preventDefault();
      onpick(items[highlighted]);
    }
  }
</script>

<div class="picker">
  <!-- svelte-ignore a11y_autofocus -->
  <input class="input" autofocus placeholder="Find an entity by name" bind:value={query}
         aria-label="Find an entity" onkeydown={onKey} />

  {#if counts.length}
    <div class="types">
      <button class="chip" class:on={!type} onclick={() => (type = null)}>
        Everything <small>{total}</small>
      </button>
      {#each counts as entry (entry.id)}
        <button class="chip" class:on={type === entry.id}
                onclick={() => (type = type === entry.id ? null : entry.id)}>
          <Icon name={entityIcon({ type: entry.id })} size={11} />
          {entry.id} <small>{entry.count}</small>
        </button>
      {/each}
    </div>
  {/if}

  <div class="bar">
    <span class="shown">
      {#if items.length}
        <strong>{items.length}</strong> of {matching} shown
      {/if}
    </span>
    <div class="orders">
      {#each ORDERS as entry (entry.id)}
        <button class="order" class:on={order === entry.id}
                onclick={() => (order = entry.id)}>{entry.label}</button>
      {/each}
    </div>
  </div>

  <div class="results" bind:this={listElement}>
    {#each items as entity, index (entity.id)}
      <button class="result" class:on={index === highlighted} class:linked={entity.id === current}
              onclick={() => onpick(entity)} onpointerenter={() => (highlighted = index)}>
        <Icon name={entityIcon(entity)} size={14} />
        <span class="label">{entity.label}</span>
        {#if entity.folder}<small class="folder">{entity.folder}</small>{/if}
        <small class="type">{entity.type}</small>
        {#if entity.id === current}<Icon name="check" size={12} />{/if}
      </button>
    {:else}
      <p class="hint">
        {#if loading}
          Looking.
        {:else if query.trim() || type}
          Nothing in this case matches. {total} {total === 1 ? 'entity' : 'entities'} filed
          in all — clear the box to see them.
        {:else}
          This case holds no entities yet.
        {/if}
      </p>
    {/each}

    {#if cursor}
      <button class="more" onclick={more} disabled={loadingMore}>
        {loadingMore ? 'Loading' : `Load ${Math.min(PAGE, matching - items.length)} more`}
      </button>
    {/if}
  </div>

  <div class="foot">
    {#if current}
      <button class="btn btn-danger btn-sm" onclick={onclear}>Clear the link</button>
    {/if}
    <div class="spacer"></div>
    <small class="keys">↑↓ to move · Enter to pick</small>
    <button class="btn btn-sm" onclick={onclose}>Cancel</button>
  </div>
</div>

<style>
  .picker { display: flex; flex-direction: column; min-height: 0; }
  .types { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
  .chip {
    display: inline-flex; align-items: center; gap: 5px; padding: 2px 7px;
    border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-2); color: var(--text-2); font-size: var(--fs-xs);
  }
  .chip:hover { border-color: var(--border-strong); color: var(--text-1); }
  .chip.on { border-color: var(--accent); color: var(--accent); }
  .chip small { color: var(--text-3); }

  .bar { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
  .shown { flex: 1; color: var(--text-3); font-size: var(--fs-xs); }
  .shown strong { color: var(--text-1); font-weight: 600; }
  .orders { display: flex; }
  .order {
    padding: 2px 7px; color: var(--text-3); font-size: var(--fs-xs);
    border: 1px solid var(--border); border-left-width: 0;
  }
  .order:first-child { border-left-width: 1px; border-radius: var(--r-sm) 0 0 var(--r-sm); }
  .order:last-child { border-radius: 0 var(--r-sm) var(--r-sm) 0; }
  .order:hover { color: var(--text-1); background: var(--bg-2); }
  .order.on { color: var(--accent); background: var(--bg-2); }

  .results {
    max-height: 340px; min-height: 120px; overflow: auto; margin-top: 6px;
    border: 1px solid var(--border); border-radius: var(--r-sm);
  }
  .more {
    width: 100%; padding: 8px; color: var(--text-2); font-size: var(--fs-sm);
    border-top: 1px solid var(--border);
  }
  .more:hover { background: var(--bg-2); color: var(--text-1); }
  .more:disabled { color: var(--text-3); }
  .result {
    display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto auto;
    align-items: center; gap: 8px; width: 100%; padding: 7px 9px;
    color: var(--text-2); text-align: left; font-size: var(--fs-sm);
  }
  .result:hover, .result.on { background: var(--bg-2); color: var(--text-1); }
  .result.on { box-shadow: inset 2px 0 0 var(--accent); }
  .result.linked { color: var(--accent); }
  .result .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .result small { color: var(--text-3); font-size: var(--fs-xs); }
  .result .folder { font-family: var(--font-mono); }
  .result .type {
    padding: 1px 5px; border-radius: var(--r-sm); background: var(--bg-3);
  }
  .hint { padding: 14px 10px; color: var(--text-3); font-size: var(--fs-sm); line-height: 1.5; }

  .foot { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
  .spacer { flex: 1; }
  .keys { color: var(--text-3); font-size: var(--fs-xs); }
</style>
