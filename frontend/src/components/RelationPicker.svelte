<script>
  /**
   * State one relation by hand: pick the other entity, then how it reads.
   *
   * A collected value rather than an action, because the subject often does not
   * exist yet — the Satellite save gate lets the analyst say "this photo was recorded
   * here" while filling in a place the case has never held. The host files the
   * choice with `saveRelation` once it has both ends.
   *
   * The searchable list is bounded (the catalog endpoint, one short page), and
   * only the entity types the vocabulary accepts for this subject are offered.
   */
  import { api } from '../lib/api.js';
  import { buildCatalogQuery } from '../lib/catalog.js';
  import { caseState } from '../lib/state.svelte.js';
  import {
    loadRelationTypes,
    relatableTypes,
    relationHint,
    relationOptions,
  } from '../lib/relations.svelte.js';
  import { entityLabel, loadEntityTypes } from '../lib/entityTypes.svelte.js';
  import { entityIcon } from '../lib/entityIcon.js';
  import Icon from './Icon.svelte';
  import SearchInput from './SearchInput.svelte';

  let {
    subjectType, // entity type the relation is being stated about
    subject = null, // full entity when media-kind rules or self-filtering matter
    subjectId = null,
    action = 'relation', // regular relation or the separate mention gesture
    relationType = null, // fixed connector, used by the Claim editor
    expanded = false, // Details opens this as a small, explicit composer
    busy = false,
    oncommit = null,
    oncancel = null,
    value = $bindable(null), // { entityId, label, entityType, type, direction } | null
  } = $props();

  const FETCH = 500; // one bounded catalog page, displayed inside the scroll area
  loadRelationTypes();
  loadEntityTypes(); // the icons come from the entity registry, not a map kept here

  let query = $state('');
  let results = $state([]);
  let open = $state(false);
  let searching = $state(false);
  let committing = $state(false);
  let seq = 0;

  $effect(() => {
    if (expanded) open = true;
  });

  const subjectEnd = $derived(subject ?? subjectType);
  const types = $derived(relatableTypes(subjectEnd, action));
  const actionLabel = $derived(action === 'mention' ? 'Add mention' : 'Add relation');
  const clearLabel = $derived(action === 'mention' ? 'Clear mention' : 'Clear relation');
  const commitBusy = $derived(busy || committing);

  /** What this subject may be related to, in words.
   *
   *  An empty result used to read as "nothing can be related here", where the truth
   *  is usually "the case holds none of the types this one joins" — a proof relates
   *  to an account or a claim, and a case that has neither shows an empty list with
   *  no way to know that. The vocabulary is directed and typed on purpose, so the
   *  surface has to say what it is waiting for.
   */
  const accepted = $derived(
    types
      .map((type) => entityLabel(type))
      .sort((a, b) => a.localeCompare(b))
      .join(', ')
  );
  // The chosen entity decides which verbs are available: a place accepts "was
  // recorded at" from a photo, and nothing at all from another place.
  const options = $derived(
    value
      ? relationOptions(subjectEnd, { type: value.entityType, attrs: value.attrs }, action)
          .filter((option) => !relationType || option.type === relationType)
      : []
  );
  // The same split the relation list draws, on the control that states the edge:
  // the registry says which verbs head their own section, nothing here does.
  const verbGroups = $derived.by(() => {
    const groups = new Map();
    for (const option of options) {
      const group = option.group ?? '';
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(option);
    }
    return [...groups].map(([group, list]) => ({ group, options: list }));
  });

  /** Keep the compact first page representative when several target types are
   *  legal. Without this, eight people could hide the only Network from an IP
   *  until the analyst already knew what to search for. A typed search keeps the
   *  server's relevance order instead. */
  function visibleResults(items, term) {
    if (term) return items;
    const firstByType = [];
    const rest = [];
    const seen = new Set();
    for (const entity of items) {
      if (seen.has(entity.type)) rest.push(entity);
      else {
        seen.add(entity.type);
        firstByType.push(entity);
      }
    }
    return [...firstByType, ...rest];
  }

  $effect(() => {
    const caseId = caseState.current?.id;
    const wanted = types;
    const term = query.trim();
    if (!open || !caseId || !wanted.length) return;
    const mine = ++seq;
    searching = true;
    api
      .get(buildCatalogQuery(caseId, { types: wanted, query: term, limit: FETCH }))
      .then((page) => {
        if (mine !== seq) return; // a newer keystroke already answered
        const compatible = (page.items ?? [])
          .filter((entity) => entity.id !== subjectId)
          .filter((entity) =>
            relationOptions(subjectEnd, entity, action)
              .some((option) => !relationType || option.type === relationType)
          );
        results = visibleResults(compatible, term);
      })
      .catch(() => {
        if (mine === seq) results = [];
      })
      .finally(() => {
        if (mine === seq) searching = false;
      });
  });

  function choose(entity) {
    const [first] = relationOptions(subjectEnd, entity, action)
      .filter((option) => !relationType || option.type === relationType);
    if (!first) return; // the vocabulary has no reading for this pair
    value = {
      entityId: entity.id,
      label: entity.label,
      entityType: entity.type,
      attrs: entity.attrs ?? {},
      type: first.type,
      direction: first.direction,
    };
    open = false;
    query = '';
  }

  function setType(event) {
    const picked = options.find(
      (option) => `${option.type}:${option.direction}` === event.currentTarget.value
    );
    if (picked) value = { ...value, type: picked.type, direction: picked.direction };
  }

  function cancel() {
    value = null;
    query = '';
    open = false;
    oncancel?.();
  }

  async function commit() {
    if (!value || !oncommit || commitBusy) return;
    committing = true;
    try {
      await oncommit(value);
    } catch {
      // The host reports the error. Keep the choice so it can be tried again.
    } finally {
      committing = false;
    }
  }
</script>

{#if types.length}
  <div class="picker" class:composer={expanded}>
    {#if value}
      <div class="chosen">
        <Icon name={entityIcon({ type: value.entityType })} size={13} />
        <span class="chosen-label" title={value.label}>{value.label}</span>
        {#if action !== 'mention' && options.length > 1}
          <select
            class="select verb-select"
            value={`${value.type}:${value.direction}`}
            title={relationHint(value.type)}
            onchange={setType}
          >
            <!-- Headed verbs sit under their heading here too, so the reading the
                 analyst picks is already sorted into what it will look like in the
                 list below. -->
            {#each verbGroups as verbs (verbs.group)}
              {#if verbs.group}
                <optgroup label={verbs.group}>
                  {#each verbs.options as option (`${option.type}:${option.direction}`)}
                    <option value={`${option.type}:${option.direction}`}>{option.label}</option>
                  {/each}
                </optgroup>
              {:else}
                {#each verbs.options as option (`${option.type}:${option.direction}`)}
                  <option value={`${option.type}:${option.direction}`}>{option.label}</option>
                {/each}
              {/if}
            {/each}
          </select>
        {:else if action !== 'mention'}
          <span class="verb">{options[0]?.label ?? value.type}</span>
        {/if}
        <button class="btn btn-ghost btn-sm" title={clearLabel} onclick={() => { value = null; open = true; }}>
          <Icon name="x" size={12} />
        </button>
      </div>
      {#if expanded}
        <div class="composer-actions">
          <button class="btn btn-ghost btn-sm" onclick={cancel}>Cancel</button>
          <button class="btn btn-primary btn-sm" disabled={commitBusy} onclick={commit}>
            {commitBusy ? 'Adding…' : actionLabel}
          </button>
        </div>
      {/if}
    {:else if open}
      <div class="search-row">
        <SearchInput bind:value={query} placeholder="Search the case…" width="100%" />
        {#if expanded}
          <button class="btn btn-ghost btn-sm" title="Close" onclick={cancel}>
            <Icon name="x" size={12} />
          </button>
        {/if}
      </div>
      <div class="results">
        {#each results as entity (entity.id)}
          <button class="result" onclick={() => choose(entity)}>
            <Icon name={entityIcon(entity)} size={12} />
            <span class="result-label">{entity.label}</span>
            <span class="result-type">{entity.type}</span>
          </button>
        {/each}
        {#if !results.length}
          <p class="hint">
            {#if searching}
              Searching…
            {:else if query.trim()}
              Nothing matches.
            {:else if accepted}
              This case holds no {accepted} to {action === 'mention' ? 'mention' : 'relate this to'}.
            {:else}
              Nothing in the vocabulary relates to this.
            {/if}
          </p>
        {/if}
      </div>
    {:else if !expanded}
      <button class="btn btn-sm add" onclick={() => (open = true)}>
        <Icon name="link" size={13} /> {actionLabel}
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
  .picker.composer {
    gap: 8px;
    padding-top: 9px;
    border-top: 1px solid var(--border);
  }
  .search-row,
  .composer-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .search-row :global(.search-input) {
    flex: 1;
    min-width: 0;
  }
  .composer-actions {
    justify-content: flex-end;
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
