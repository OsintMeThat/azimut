<script>
  /** Pick several endpoints for one of a Temporal Claim's typed connectors. */
  import { api } from '../lib/api.js';
  import { buildCatalogQuery } from '../lib/catalog.js';
  import { entityIcon } from '../lib/entityIcon.js';
  import { entityTypes, loadEntityTypes } from '../lib/entityTypes.svelte.js';
  import { loadRelationTypes, relationOptions } from '../lib/relations.svelte.js';
  import Icon from './Icon.svelte';
  import SearchInput from './SearchInput.svelte';

  let {
    caseId,
    relationType,
    label,
    hint = '',
    selected = $bindable([]),
    locked = [],
  } = $props();

  loadEntityTypes();
  loadRelationTypes();

  let open = $state(false);
  let query = $state('');
  let rows = $state([]);
  let loading = $state(false);
  let seq = 0;

  const lockedIds = $derived(new Set(locked.map((item) => item.id)));
  const selectedIds = $derived(new Set(selected.map((item) => item.id)));
  const acceptedTypes = $derived(
    entityTypes()
      .filter((entry) =>
        relationOptions('claim', entry.type, 'claim').some(
          (option) => option.type === relationType && option.direction === 'out'
        )
      )
      .map((entry) => entry.type)
  );

  $effect(() => {
    const term = query.trim();
    const types = acceptedTypes;
    if (!open || !caseId || !types.length) return;
    const mine = ++seq;
    loading = true;
    api
      .get(buildCatalogQuery(caseId, { types, query: term, limit: 200 }))
      .then((page) => {
        if (mine === seq) rows = page.items ?? [];
      })
      .catch(() => {
        if (mine === seq) rows = [];
      })
      .finally(() => {
        if (mine === seq) loading = false;
      });
  });

  function add(entity) {
    if (!selectedIds.has(entity.id) && !lockedIds.has(entity.id)) {
      selected = [...selected, { id: entity.id, label: entity.label, type: entity.type }];
    }
    query = '';
  }

  function remove(id) {
    selected = selected.filter((item) => item.id !== id);
  }
</script>

<div class="target-picker">
  <div class="target-head">
    <div>
      <span class="modal-label">{label}</span>
      {#if hint}<p>{hint}</p>{/if}
    </div>
    <button class="btn btn-ghost btn-sm" class:on={open} onclick={() => (open = !open)}>
      <Icon name={open ? 'x' : 'plus'} size={12} /> {open ? 'Close' : 'Add'}
    </button>
  </div>

  {#if locked.length || selected.length}
    <div class="chips">
      {#each locked as item (item.id)}
        <span class="chip locked"><Icon name={entityIcon(item)} size={11} />{item.label}</span>
      {/each}
      {#each selected as item (item.id)}
        <span class="chip">
          <Icon name={entityIcon(item)} size={11} />{item.label}
          <button title={`Remove ${item.label}`} onclick={() => remove(item.id)}><Icon name="x" size={10} /></button>
        </span>
      {/each}
    </div>
  {/if}

  {#if open}
    <div class="picker-body">
      <SearchInput bind:value={query} placeholder="Search the case…" width="100%" />
      <div class="results">
        {#each rows as entity (entity.id)}
          <button
            class:selected={selectedIds.has(entity.id) || lockedIds.has(entity.id)}
            disabled={selectedIds.has(entity.id) || lockedIds.has(entity.id)}
            onclick={() => add(entity)}
          >
            <Icon name={entityIcon(entity)} size={12} />
            <span>{entity.label}</span>
            <small>{entity.type}</small>
          </button>
        {:else}
          <p class="empty">{loading ? 'Searching…' : 'No matching case items'}</p>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .target-picker { display: grid; gap: 6px; }
  .target-head { display: flex; align-items: start; justify-content: space-between; gap: 12px; }
  .target-head p { margin: 2px 0 0; color: var(--text-3); font-size: var(--fs-xs); }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .chip {
    display: inline-flex; align-items: center; gap: 5px; min-width: 0;
    padding: 4px 7px; border: 1px solid var(--border); border-radius: 999px;
    background: var(--bg-2); color: var(--text-2); font-size: var(--fs-xs);
  }
  .chip.locked { border-style: dashed; }
  .chip button { display: grid; padding: 0; border: 0; background: none; color: var(--text-3); cursor: pointer; }
  .picker-body { display: grid; gap: 5px; }
  .results {
    max-height: 180px; overflow: auto; border: 1px solid var(--border);
    border-radius: var(--r-sm); background: var(--bg-2);
  }
  .results > button {
    width: 100%; display: grid; grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center; gap: 7px; padding: 7px 8px; border: 0;
    border-bottom: 1px solid var(--border); background: transparent; color: var(--text-2);
    text-align: left; cursor: pointer;
  }
  .results > button:last-child { border-bottom: 0; }
  .results > button:hover:not(:disabled) { background: var(--bg-3); color: var(--text-1); }
  .results > button.selected { opacity: .45; }
  .results span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .results small { color: var(--text-3); }
  .empty { margin: 0; padding: 12px; color: var(--text-3); text-align: center; font-size: var(--fs-xs); }
</style>
