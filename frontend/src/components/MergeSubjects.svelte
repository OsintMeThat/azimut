<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { entityFields, entityLabel } from '../lib/entityTypes.svelte.js';
  import EntityFinder from './EntityFinder.svelte';
  import Modal from './Modal.svelte';

  let { caseId, entity, initialOther = null, onclose, onmerged } = $props();
  let other = $state(null);
  let keepId = $state('');
  let preview = $state(null);
  let error = $state('');
  let loading = $state(false);
  let saving = $state(false);
  let seq = 0;
  const survivor = $derived(keepId === other?.id ? other : entity);
  const absorbed = $derived(keepId === other?.id ? entity : other);
  const display = (value) => typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
  const fieldName = (key) => entityFields(entity.type).find((field) => field.key === key)?.label ?? ({ notes: 'Notes', folder: 'Folder' }[key] ?? key);
  const visible = (fields) => Object.entries(fields ?? {}).filter(([key]) => !key.startsWith('_'));

  function choose(candidate) {
    other = candidate;
    keepId = (candidate.provenance?.at ?? '') < (entity.provenance?.at ?? '') ? candidate.id : entity.id;
  }
  onMount(() => { if (initialOther) choose(initialOther); });
  $effect(() => {
    const keep = survivor?.id;
    const lose = absorbed?.id;
    const mine = ++seq;
    preview = null;
    error = '';
    if (!lose) return;
    loading = true;
    let live = true;
    api.get(`/api/cases/${caseId}/entities/${keep}/merge-preview?other=${encodeURIComponent(lose)}`)
      .then((result) => { if (live && mine === seq) preview = result; })
      .catch((cause) => { if (live && mine === seq) error = cause.message; })
      .finally(() => { if (live && mine === seq) loading = false; });
    return () => { live = false; };
  });
  async function save() {
    if (!preview || preview.refused?.length || saving || loading) return;
    saving = true;
    error = '';
    try {
      const result = await api.post(`/api/cases/${caseId}/entities/${survivor.id}/merge`, { other: absorbed.id });
      onmerged?.(result);
    } catch (cause) {
      error = cause.message;
    } finally {
      saving = false;
    }
  }
</script>

<Modal title="Merge subjects" width="720px" onclose={() => { if (!saving) onclose?.(); }}>
  <div class="merge-body">
    <p>Choose another {entityLabel(entity.type).toLowerCase()} that represents the same subject.</p>
    {#if !other}
      <EntityFinder {caseId} types={[entity.type]} exclude={[entity.id]} label="Find the duplicate" placeholder="Search by name or identifier…" onpick={choose} />
    {:else}
      <div class="survivors" role="group" aria-label="Subject to keep">
        {#each [entity, other] as candidate (candidate.id)}
          <button class="choice" class:chosen={survivor.id === candidate.id} aria-pressed={survivor.id === candidate.id} disabled={saving} onclick={() => (keepId = candidate.id)}>
            <small>{survivor.id === candidate.id ? 'Keep' : 'Merge into the other'}</small>
            <strong dir="auto">{candidate.label}</strong>
            <span>Created {candidate.provenance?.at?.slice(0, 10) ?? 'date unknown'}</span>
          </button>
        {/each}
      </div>
      <button class="btn btn-ghost btn-sm another" disabled={saving} onclick={() => { other = null; keepId = ''; }}>Choose another subject</button>
      {#if loading}<p role="status">Checking what will move…</p>{/if}
      {#if preview}
        <div class="table-wrap">
          <table aria-label="Fields after merging">
            <thead><tr><th>Kept</th><th>Added from <bdi>{absorbed.label}</bdi></th><th>Conflicts</th></tr></thead>
            <tbody><tr>
              <td>{#each visible(preview.fields.kept) as [key, value]}<p><strong>{fieldName(key)}</strong><span dir="auto">{display(value)}</span></p>{:else}No filled fields{/each}</td>
              <td>{#each visible(preview.fields.added) as [key, value]}<p><strong>{fieldName(key)}</strong><span dir="auto">{display(value)}</span></p>{:else}None{/each}</td>
              <td>{#each preview.fields.conflicts as conflict}<p><strong>{conflict.label}</strong><span dir="auto">{display(conflict.kept)} stays; {display(conflict.other)} goes into Notes.</span></p>{:else}None{/each}</td>
            </tr></tbody>
          </table>
        </div>
        <ul class="effects">
          <li>{preview.links.moved} relations move; {preview.links.twins} identical relations combine; {preview.links.loops} links between these subjects are removed.</li>
          <li>{preview.images.moved ?? 0} photos move; {preview.images.twins ?? 0} duplicate photos combine.</li>
          <li>{preview.pins.moved ?? 0} graph positions move; {preview.pins.kept ?? 0} existing positions stay.</li>
          <li>{preview.views.length} saved views and {preview.sheets} sheets follow the kept subject.</li>
          <li>{preview.notes} notes keep their text and open the kept subject.</li>
        </ul>
        {#if preview.refused?.length}
          <div class="error" role="alert">These relations prevent the merge:
            <ul>{#each preview.refused as link}<li>{link.type}: {link.reason}</li>{/each}</ul>
          </div>
        {/if}
        <p class="hint">Undo remains available in Details until this case is exported and imported as a bundle.</p>
      {/if}
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="actions">
      <button class="btn" disabled={saving} onclick={onclose}>Cancel</button>
      <button class="btn btn-primary" disabled={!preview || loading || saving || Boolean(preview?.refused?.length)} onclick={save}>{saving ? 'Merging…' : 'Merge subjects'}</button>
    </div>
  </div>
</Modal>

<style>
  .merge-body { display: grid; gap: 12px; font-size: var(--fs-sm); }
  p { margin: 0; }
  .survivors { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .choice { display: grid; gap: 5px; padding: 10px; text-align: left; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-2); color: var(--text-2); cursor: pointer; overflow-wrap: anywhere; }
  .choice.chosen { border-color: var(--accent); background: var(--accent-soft); }
  .choice small { color: var(--accent); }
  .choice span, .hint { color: var(--text-3); font-size: var(--fs-xs); }
  .another { justify-self: start; }
  .table-wrap { overflow: auto; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { width: 33%; padding: 8px; border: 1px solid var(--border); text-align: left; vertical-align: top; overflow-wrap: anywhere; }
  th { background: var(--bg-2); font-size: var(--fs-xs); }
  td p { display: grid; gap: 2px; margin-bottom: 7px; }
  .effects { margin: 0; padding-left: 18px; display: grid; gap: 5px; color: var(--text-2); }
  .actions { display: flex; justify-content: end; gap: 8px; }
  .error { color: var(--danger); }
</style>
