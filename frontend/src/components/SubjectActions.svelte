<script>
  import { api } from '../lib/api.js';
  import { entityTypes, entityFields, entityLabel } from '../lib/entityTypes.svelte.js';
  import { reloadCase, toast } from '../lib/state.svelte.js';
  import MergeSubjects from './MergeSubjects.svelte';

  let { caseId, entity, disabled = false, twin = null, onchanged } = $props();
  let changing = $state(false);
  let merging = $state(false);
  let candidate = $state(null);
  let nextType = $state('');
  let busy = $state(false);
  let error = $state('');
  let losses = $state([]);
  let history = $state([]);
  let historyError = $state('');
  const entry = $derived(entityTypes().find((type) => type.type === entity.type));
  const types = $derived(entityTypes().filter((type) => type.retypable));
  const retained = $derived(Object.entries(entity.attrs?._retained_fields ?? {}).filter(([key]) => entity.attrs?.[key] != null && !entityFields(entity.type).some((field) => field.key === key)));
  const subjectId = $derived(entity.id);
  $effect(() => {
    subjectId;
    changing = false;
    merging = false;
    losses = [];
    error = '';
  });
  $effect(() => {
    const id = entity.id;
    entity;
    history = [];
    if (!entry?.mergeable) return;
    let live = true;
    api.get(`/api/cases/${caseId}/entities/${id}/merges`)
      .then((result) => { if (live) { history = result.merges; historyError = ''; } })
      .catch((cause) => { if (live) historyError = cause.message; });
    return () => { live = false; };
  });
  async function patch(body) {
    if (busy || disabled) return;
    busy = true;
    error = '';
    try {
      const saved = await api.patch(`/api/cases/${caseId}/entities/${entity.id}`, body);
      changing = false;
      onchanged?.(saved);
      await reloadCase();
      toast('Subject updated', 'ok');
    } catch (cause) { error = cause.message; }
    finally { busy = false; }
  }
  async function undo(id) {
    if (busy || disabled) return;
    busy = true;
    error = '';
    try {
      const result = await api.post(`/api/cases/${caseId}/merges/${id}/undo`);
      losses = result.lost ?? [];
      await reloadCase();
      const chain = await api.get(`/api/cases/${caseId}/entities/${entity.id}/chain`);
      onchanged?.(chain.entity);
      toast(losses.length ? 'Merge undone with changes to review' : 'Merge undone', losses.length ? 'warn' : 'ok');
    } catch (cause) { error = cause.message; }
    finally { busy = false; }
  }
  async function merged(result) {
    merging = false;
    onchanged?.(result.survivor);
    await reloadCase();
    losses = result.warnings ?? [];
    toast(losses.length ? 'Subjects merged with changes to review' : 'Subjects merged', losses.length ? 'warn' : 'ok', 8000, { label: 'Undo', onClick: () => undo(result.merge) });
  }
  const shown = (value) => typeof value === 'object' ? JSON.stringify(value) : String(value);
</script>

{#if entry?.retypable || entry?.mergeable}
  <div class="subject-actions">
    <div class="buttons">
      {#if entry.retypable}<button class="btn btn-ghost btn-sm" disabled={disabled || busy} aria-expanded={changing} onclick={() => { changing = !changing; nextType = entity.type; }}>Change type…</button>{/if}
      {#if entry.mergeable}<button class="btn btn-ghost btn-sm" disabled={disabled || busy} onclick={() => { candidate = null; merging = true; }}>Merge…</button>{/if}
      {#if twin && entry.mergeable}<button class="btn btn-ghost btn-sm" disabled={disabled || busy} onclick={() => { candidate = twin; merging = true; }}>Merge with <bdi>{twin.label}</bdi>…</button>{/if}
    </div>
    {#if disabled}<small>Save your edits before changing type or merging.</small>{/if}
    {#if changing}
      <div class="buttons">
        <select class="select" aria-label="New type" value={nextType} onchange={(event) => (nextType = event.currentTarget.value)} disabled={busy}>{#each types as type (type.type)}<option value={type.type}>{type.label}</option>{/each}</select>
        <button class="btn btn-primary btn-sm" disabled={busy || nextType === entity.type} onclick={() => patch({ type: nextType })}>Change type</button>
        <button class="btn btn-ghost btn-sm" disabled={busy} onclick={() => (changing = false)}>Cancel</button>
      </div>
    {/if}
    {#each retained as [key, oldType] (key)}
      <div class="retained">
        <small>Kept from {entityLabel(oldType)}</small>
        <span><strong>{entityFields(oldType).find((field) => field.key === key)?.label ?? key}:</strong> <bdi>{shown(entity.attrs[key])}</bdi></span>
        <button class="btn btn-ghost btn-sm" disabled={disabled || busy} onclick={() => patch({ attrs: { [key]: null } })}>Remove {entityFields(oldType).find((field) => field.key === key)?.label ?? key}</button>
      </div>
    {/each}
    {#each history as record (record.id)}
      <div class="history"><span>Merged from <bdi>{record.merged_label}</bdi></span><button class="btn btn-ghost btn-sm" disabled={disabled || busy} onclick={() => undo(record.id)}>Undo</button></div>
    {/each}
    {#if historyError}<p class="error">Could not load merge history: {historyError}</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if losses.length}<div role="status"><p>Changes to review:</p><ul>{#each losses as loss}<li>{loss}</li>{/each}</ul></div>{/if}
  </div>
{/if}
{#if merging}<MergeSubjects {caseId} {entity} initialOther={candidate} onclose={() => (merging = false)} onmerged={merged} />{/if}

<style>
  .subject-actions { display: grid; gap: 8px; padding-block: 8px; border-block: 1px solid var(--border); }
  .buttons, .history { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .buttons .select { width: auto; flex: 1; min-width: 100px; }
  .retained { display: grid; gap: 3px; overflow-wrap: anywhere; }
  .retained button { justify-self: start; }
  small { color: var(--text-3); font-size: var(--fs-xs); }
  p { margin: 0; }
  .error { color: var(--danger); }
</style>
