<script>
  /**
   * A worklist made out of what the case already believes.
   *
   * The missing half of the promotion road. Rows have always been able to become entities;
   * an analyst holding forty places in the graph and wanting to work through them had to
   * retype the forty, because the Board has nowhere to write a verdict and the sheet had no
   * way to hear about the graph.
   *
   * Two answers and one press: which type, and which of its fields deserve a column.
   * Nothing else travels — a sheet holding every attribute of every entity would be a
   * second copy of the graph, and the second copy is the one that goes stale. The rows come
   * back pointing at what they came from, so editing them and promoting them again updates
   * those entities rather than minting twins.
   */
  import Icon from './Icon.svelte';
  import { api } from '../lib/api.js';
  import { entityIcon } from '../lib/entityIcon.js';
  import { entityFields, entityLabel, loadEntityTypes } from '../lib/entityTypes.svelte.js';

  let { caseId, busy = false, onmake, onclose } = $props();

  /** What the route takes at most. Mirrors `engine/sheetfromcase.MAX_FROM_CASE`: past two
   *  thousand rows nobody works through it, and the honest answer is a filtered Board. */
  const MAX_ROWS = 2000;

  let counts = $state([]);
  let type = $state('');
  let fields = $state([]);
  let title = $state('');
  let touched = $state(false);

  loadEntityTypes();

  $effect(() => {
    if (!caseId) return;
    let live = true;
    api
      .get(`/api/cases/${caseId}/catalog/summary`)
      .then((answer) => {
        if (!live) return;
        counts = Object.entries(answer.by_type ?? {})
          .map(([id, count]) => ({ id, count }))
          .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
        if (!type && counts.length) type = counts[0].id;
      })
      .catch(() => {});
    return () => (live = false);
  });

  // The fields belong to the type, so a choice made for a person means nothing for a place.
  $effect(() => {
    void type;
    fields = [];
  });

  // Named after what it holds until the analyst says otherwise, which is what they would
  // have typed anyway.
  $effect(() => {
    if (!touched && type) title = `${entityLabel(type)} to check`;
  });

  const available = $derived(entityFields(type).filter((field) => field.kind !== 'geojson'));
  const held = $derived(counts.find((entry) => entry.id === type)?.count ?? 0);
  const taken = $derived(Math.min(held, MAX_ROWS));
  const ready = $derived(Boolean(type && title.trim() && held));

  function toggle(key) {
    fields = fields.includes(key) ? fields.filter((entry) => entry !== key) : [...fields, key];
  }
</script>

<div class="from-case">
  <p class="label">What is in it</p>
  {#if counts.length}
    <div class="types">
      {#each counts as entry (entry.id)}
        <button class="chip" class:on={type === entry.id} onclick={() => (type = entry.id)}>
          <Icon name={entityIcon({ type: entry.id })} size={11} />
          {entityLabel(entry.id)} <small>{entry.count}</small>
        </button>
      {/each}
    </div>
  {:else}
    <p class="note">This case holds no entities yet.</p>
  {/if}

  <label class="row">
    <span>Name</span>
    <input class="input" bind:value={title} placeholder="Places to check"
           oninput={() => (touched = true)} />
  </label>

  {#if available.length}
    <p class="label">
      And which fields get a column. None is fine if the sheet only carries your own.
    </p>
    <div class="fields">
      {#each available as field (field.key)}
        <label class="check">
          <input type="checkbox" checked={fields.includes(field.key)}
                 onchange={() => toggle(field.key)} />
          <span title={field.hint ?? ''}>{field.label}</span>
        </label>
      {/each}
    </div>
  {/if}

  <p class="says" class:none={!ready}>
    {#if !held}
      This case holds nothing of that type.
    {:else}
      <strong>{taken}</strong> {taken === 1 ? 'row' : 'rows'}, one per
      {entityLabel(type).toLowerCase()}, plus a status and a note to work in.
      {#if held > MAX_ROWS}<span>Only the first {MAX_ROWS} by name.</span>{/if}
    {/if}
  </p>
  <p class="note">
    Each row points back at what it came from, so promoting it later updates that entity instead
    of making a second one.
  </p>

  <div class="modal-row">
    <div class="spacer"></div>
    <button class="btn" onclick={onclose}>Cancel</button>
    <button class="btn btn-primary" disabled={busy || !ready}
            onclick={() => onmake({ title: title.trim(), type, fields, limit: MAX_ROWS })}>
      {busy ? 'Building' : 'Build the sheet'}
    </button>
  </div>
</div>

<style>
  .from-case { display: flex; flex-direction: column; min-height: 0; }
  .label { color: var(--text-3); font-size: var(--fs-xs); margin: 12px 0 5px; line-height: 1.5; }
  .label:first-child { margin-top: 0; }
  .types { display: flex; flex-wrap: wrap; gap: 4px; }
  .chip {
    display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px;
    border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-2); color: var(--text-2); font-size: var(--fs-xs);
  }
  .chip:hover { border-color: var(--border-strong); color: var(--text-1); }
  .chip.on { border-color: var(--accent); color: var(--accent); }
  .chip small { color: var(--text-3); }
  .row {
    display: grid; grid-template-columns: 90px minmax(0, 1fr); align-items: center;
    gap: 8px; margin-top: 12px;
  }
  .row span { color: var(--text-2); font-size: var(--fs-sm); }
  .fields {
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px 10px;
    max-height: 180px; overflow: auto;
  }
  .check { display: flex; align-items: center; gap: 7px; color: var(--text-2); font-size: var(--fs-xs); }
  .check span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .says {
    margin-top: 12px; padding: 6px 8px; border-radius: var(--r-sm);
    background: var(--accent-soft); color: var(--accent); font-size: var(--fs-xs);
    line-height: 1.5;
  }
  .says.none { background: var(--bg-2); color: var(--text-3); }
  .says strong { font-weight: 600; }
  .says span { color: var(--text-3); }
  .note { color: var(--text-3); font-size: var(--fs-xs); line-height: 1.5; padding: 4px 0; }
  .modal-row { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
  .spacer { flex: 1; }
</style>
