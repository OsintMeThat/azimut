<script>
  /**
   * Pick several endpoints for one of a Temporal Claim's typed connectors.
   *
   * The finder (`EntityFinder.svelte`) shows the kinds the connector accepts as chips,
   * so the evidence list reads as files, captures, proofs, pages and notes rather than
   * as everything the case holds. Evidence comes newest first.
   */
  import { entityIcon } from '../lib/entityIcon.js';
  import { entityTypes, loadEntityTypes } from '../lib/entityTypes.svelte.js';
  import { loadRelationTypes, relationOptions } from '../lib/relations.svelte.js';
  import EntityFinder from './EntityFinder.svelte';
  import Icon from './Icon.svelte';

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

  function add(entity) {
    if (!selectedIds.has(entity.id) && !lockedIds.has(entity.id)) {
      selected = [...selected, { id: entity.id, label: entity.label, type: entity.type, attrs: entity.attrs }];
    }
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
    <button class="btn btn-ghost btn-sm" class:on={open} aria-expanded={open} onclick={() => (open = !open)}>
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
      <EntityFinder
        {caseId}
        types={acceptedTypes}
        exclude={[...lockedIds, ...selectedIds]}
        order={relationType === 'cites' ? '-created' : ''}
        label={`Find ${label.toLowerCase()}`}
        placeholder={relationType === 'cites' ? 'Find a file, capture, proof, page or note…' : relationType === 'at' ? 'Find a place…' : 'Find a person, a group, an object…'}
        onpick={add}
        onclose={() => (open = false)}
      />
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
  .picker-body { padding: 8px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-1); }
</style>
