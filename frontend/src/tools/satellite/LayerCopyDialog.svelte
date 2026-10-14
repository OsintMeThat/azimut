<script>
  /**
   * A feature of a source layer — a GeoConfirmed event, a My Maps pin — copied
   * into one of the analyst's layers, marked as somebody else's geolocation.
   *
   * The layer chosen last in this case comes up first, since a run of copies
   * usually lands in one place.
   */
  import { untrack } from 'svelte';
  import Modal from '../../components/Modal.svelte';
  import { api } from '../../lib/api.js';
  import { addedLayers } from '../../lib/map/addedLayersState.svelte.js';
  import { caseState } from '../../lib/state.svelte.js';
  import { UNNAMED } from '../../lib/map/addedLayers.js';

  let { controller } = $props();
  // the feature it was opened on; another one opens the dialog afresh (`LayerAddDialogs`)
  const job = untrack(() => controller.copying);
  const owner = job.caseId;
  const memory = `azimut:copy-layer:${owner}`;
  const targets = $derived(addedLayers.rows.filter((row) => row.editable));
  /** The layer chosen last in this case, else the first; '' is a new layer. */
  let target = $state(untrack(() => {
    const last = localStorage.getItem(memory);
    return targets.some((row) => row.name === last) ? last : targets[0]?.name ?? '';
  }));
  let groups = $state([]);
  let group = $state('');
  let title = $state('Copied points');
  let busy = $state(false);

  $effect(() => {
    const name = target;
    groups = []; group = '';
    if (!name) return;
    api.get(`/api/cases/${owner}/map-layers/${encodeURIComponent(name)}/edit`)
      .then((answer) => { if (target === name) { groups = answer.groups ?? []; group = groups[0]?.id ?? ''; } })
      .catch(() => {});
  });

  async function copy() {
    busy = true;
    try {
      let row = targets.find((one) => one.name === target);
      if (!row) row = await addedLayers.createEditable(title.trim() || 'Copied points');
      if (!row || caseState.current?.id !== owner) return;
      localStorage.setItem(memory, row.name);
      await controller.copyTo(row, group || null);
    } finally { busy = false; }
  }
</script>

<Modal title="Copy to my layer" onclose={() => controller.cancelCopy()} width="380px">
  <p class="lead">“{job.feature.properties?.name || UNNAMED}” from {job.row.title}, kept as somebody else's geolocation with its day and the addresses its note cites.</p>
  {#if targets.length}
    <label class="field"><span>Layer</span>
      <select aria-label="Layer to copy into" bind:value={target}>
        {#each targets as row (row.name)}<option value={row.name}>{row.title}</option>{/each}
        <option value="">New layer…</option>
      </select>
    </label>
  {/if}
  {#if !target}
    <label class="field"><span>Name</span><input aria-label="New layer name" bind:value={title} maxlength="200" /></label>
  {:else if groups.length > 1}
    <label class="field"><span>Group</span>
      <select aria-label="Group to copy into" bind:value={group}>
        {#each groups as one (one.id)}<option value={one.id}>{one.name}</option>{/each}
      </select>
    </label>
  {/if}
  <div class="actions">
    <button class="btn btn-sm" onclick={() => controller.cancelCopy()}>Cancel</button>
    <button class="btn btn-primary btn-sm" disabled={busy || (!target && !title.trim())} onclick={copy}>Copy</button>
  </div>
</Modal>

<style>
  .lead { margin: 0 0 10px; color: var(--text-3); font-size: var(--fs-xs); }
  .field { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: var(--fs-xs); }
  .field > span { width: 44px; flex: none; color: var(--text-3); }
  .field select, .field input { flex: 1; min-width: 0; }
  .actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 14px; }
</style>
