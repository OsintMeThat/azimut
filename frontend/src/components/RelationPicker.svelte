<script>
  /**
   * State one relation by hand: pick the other entity, then how it reads.
   *
   * A collected value rather than an action, because the subject often does not
   * exist yet — the Satellite save gate lets the analyst say "this photo was shot
   * here" while filling in a place the case has never held. The host files the
   * choice with `saveRelation` once it has both ends.
   *
   * The searchable list is bounded (the catalog endpoint, one short page), and
   * only the entity types the vocabulary accepts for this subject are offered.
   */
  import { api } from '../lib/api.js';
  import { buildCatalogQuery } from '../lib/catalog.js';
  import { caseState } from '../lib/state.svelte.js';
  import { loadRelationTypes, relatableTypes, relationOptions } from '../lib/relations.svelte.js';
  import Icon from './Icon.svelte';
  import SearchInput from './SearchInput.svelte';

  let {
    subjectType, // entity type the relation is being stated about
    value = $bindable(null), // { entityId, label, entityType, type, direction } | null
  } = $props();

  const PAGE = 8; // a short page: this is a picker, not a browser
  const ENTITY_ICON = {
    media: 'media', capture: 'satellite', place: 'pin', proof: 'proof',
    post: 'post', 'inspect-session': 'inspect', note: 'note', bookmark: 'link',
  };

  loadRelationTypes();

  let query = $state('');
  let results = $state([]);
  let open = $state(false);
  let searching = $state(false);
  let seq = 0;

  const types = $derived(relatableTypes(subjectType));
  // The chosen entity decides which verbs are available: a place accepts "was
  // shot at" from a photo, and nothing at all from another place.
  const options = $derived(value ? relationOptions(subjectType, value.entityType) : []);

  $effect(() => {
    const caseId = caseState.current?.id;
    const wanted = types;
    const term = query.trim();
    if (!open || !caseId || !wanted.length) return;
    const mine = ++seq;
    searching = true;
    api
      .get(buildCatalogQuery(caseId, { types: wanted, query: term, limit: PAGE }))
      .then((page) => {
        if (mine !== seq) return; // a newer keystroke already answered
        results = page.items ?? [];
      })
      .catch(() => {
        if (mine === seq) results = [];
      })
      .finally(() => {
        if (mine === seq) searching = false;
      });
  });

  function choose(entity) {
    const [first] = relationOptions(subjectType, entity.type);
    if (!first) return; // the vocabulary has no reading for this pair
    value = {
      entityId: entity.id,
      label: entity.label,
      entityType: entity.type,
      type: first.type,
      direction: first.direction,
    };
    open = false;
    query = '';
  }

  function setType(event) {
    const picked = options.find((o) => o.type === event.currentTarget.value);
    if (picked) value = { ...value, type: picked.type, direction: picked.direction };
  }
</script>

{#if types.length}
  <div class="picker">
    {#if value}
      <div class="chosen">
        <Icon name={ENTITY_ICON[value.entityType] ?? 'file'} size={13} />
        <span class="chosen-label" title={value.label}>{value.label}</span>
        {#if options.length > 1}
          <select class="select verb-select" value={value.type} onchange={setType}>
            {#each options as option (option.type)}
              <option value={option.type}>{option.label}</option>
            {/each}
          </select>
        {:else}
          <span class="verb">{options[0]?.label ?? value.type}</span>
        {/if}
        <button class="btn btn-ghost btn-sm" title="Remove this relation" onclick={() => (value = null)}>
          <Icon name="x" size={12} />
        </button>
      </div>
    {:else if open}
      <SearchInput bind:value={query} placeholder="Search the case…" width="100%" />
      <div class="results">
        {#each results as entity (entity.id)}
          <button class="result" onclick={() => choose(entity)}>
            <Icon name={ENTITY_ICON[entity.type] ?? 'file'} size={12} />
            <span class="result-label">{entity.label}</span>
            <span class="result-type">{entity.type}</span>
          </button>
        {/each}
        {#if !results.length}
          <p class="hint">{searching ? 'Searching…' : 'Nothing to relate here yet.'}</p>
        {/if}
      </div>
    {:else}
      <button class="btn btn-sm add" onclick={() => (open = true)}>
        <Icon name="link" size={13} /> Relate to…
      </button>
    {/if}
  </div>
{/if}

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .add {
    align-self: flex-start;
  }
  .chosen {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    padding: 4px 6px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    font-size: var(--fs-sm);
    color: var(--text-2);
  }
  .chosen-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .verb {
    flex-shrink: 0;
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 999px;
    background: var(--bg-3);
    color: var(--text-3);
  }
  .verb-select {
    flex: 0 0 auto;
    max-width: 150px;
    font-size: var(--fs-xs);
  }
  .results {
    display: flex;
    flex-direction: column;
    gap: 1px;
    max-height: 168px;
    overflow-y: auto;
  }
  .result {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    padding: 5px 6px;
    border: 0;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text-2);
    font: inherit;
    font-size: var(--fs-sm);
    text-align: left;
    cursor: pointer;
  }
  .result:hover {
    background: var(--bg-2);
    color: var(--text-1);
  }
  .result-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .result-type {
    flex-shrink: 0;
    font-size: 10px;
    color: var(--text-3);
  }
  .hint {
    margin: 2px 0;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
</style>
