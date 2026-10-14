<script>
  /**
   * Add what the case has already placed — places, proofs, captures, views,
   * comparisons, located files — as markers that follow it.
   *
   * Read when it opens, from disk only. A proof that concludes on three points
   * is three rows, one per point, and only the points somebody checked.
   */
  import Modal from '../../components/Modal.svelte';
  import Icon from '../../components/Icon.svelte';
  import { api } from '../../lib/api.js';
  import { caseState } from '../../lib/state.svelte.js';

  let { controller } = $props();
  const KINDS = [['', 'All'], ['place', 'Places'], ['proof', 'Proofs'], ['media', 'Files'],
    ['capture', 'Captures'], ['comparison', 'Comparisons'], ['view', 'Views']];
  const ICONS = { place: 'pin', proof: 'proof', media: 'image', capture: 'satellite', screenshot: 'satellite', comparison: 'compare', view: 'horizon' };
  let rows = $state(null);
  let failed = $state('');
  let query = $state('');
  let kind = $state('');
  let checked = $state([]);
  const owner = caseState.current?.id;
  const keyOf = (row) => `${row.id}@${row.lat},${row.lon}`;
  /** Points the layer already shows, so the list says so rather than adding twice. */
  const held = $derived(new Set(controller.features.filter((feature) => feature.properties.entity_id)
    .map((feature) => `${feature.properties.entity_id}@${feature.geometry.coordinates[1]},${feature.geometry.coordinates[0]}`)));
  const shown = $derived((rows ?? []).filter((row) => (!kind || row.kind === kind || (kind === 'capture' && row.kind === 'screenshot'))
    && (!query.trim() || row.title.toLowerCase().includes(query.trim().toLowerCase()))));
  const counts = $derived(Object.fromEntries(KINDS.map(([id]) => [id, (rows ?? []).filter((row) => !id || row.kind === id
    || (id === 'capture' && row.kind === 'screenshot')).length])));

  $effect(() => {
    if (!owner) return;
    api.get(`/api/cases/${owner}/layer-links`)
      .then((list) => { if (caseState.current?.id === owner) rows = list; })
      .catch((error) => { failed = error.message; rows = []; });
  });

  async function add() {
    const picked = (rows ?? []).filter((row) => checked.includes(keyOf(row)))
      .map((row) => ({ id: row.id, lat: row.lat, lon: row.lon }));
    if (await controller.addLinks(picked)) controller.closeLinking();
  }
</script>

<Modal title="Add from the case" onclose={() => controller.closeLinking()} width="460px" align="top">
  <p class="lead">Each marker follows what it was added from: move the proof or the place, and the marker moves with it.</p>
  <input type="search" aria-label="Find in the case" placeholder="Find by name" bind:value={query} />
  <div class="kinds" role="group" aria-label="Kinds">
    {#each KINDS as [id, label]}
      {#if !id || counts[id]}
        <button type="button" aria-pressed={kind === id} onclick={() => (kind = id)}>{label} <span>{counts[id]}</span></button>
      {/if}
    {/each}
  </div>
  {#if rows === null}
    <p class="note">Reading the case…</p>
  {:else if failed}
    <p class="note">{failed}</p>
  {:else if !rows.length}
    <p class="note">Nothing in this case has a point on the map yet.</p>
  {:else}
    <div class="picker-actions">
      <button type="button" class="text-act" disabled={!shown.length}
        onclick={() => (checked = [...new Set([...checked, ...shown.filter((row) => !held.has(keyOf(row))).slice(0, 200).map(keyOf)])])}>Select shown</button>
      <button type="button" class="text-act" disabled={!checked.length} onclick={() => (checked = [])}>Clear</button>
    </div>
    <ul aria-label="Located in the case">
      {#each shown.slice(0, 300) as row (keyOf(row))}
        {@const already = held.has(keyOf(row))}
        <li><label class:already>
          <input type="checkbox" value={keyOf(row)} bind:group={checked} disabled={already} />
          <Icon name={ICONS[row.kind] ?? 'pin'} size={12} />
          <span class="title">{row.title || 'Untitled'}</span>
          {#if already}<span class="tag">In the layer</span>{/if}
        </label></li>
      {/each}
    </ul>
    {#if shown.length > 300}<p class="note">First 300 shown; search to find more.</p>{/if}
  {/if}
  <div class="actions">
    <button class="btn btn-sm" onclick={() => controller.closeLinking()}>Cancel</button>
    <button class="btn btn-primary btn-sm" disabled={!checked.length || controller.pending > 0} onclick={add}>
      Add{checked.length ? ` ${checked.length}` : ''}</button>
  </div>
</Modal>

<style>
  .lead, .note { margin: 0 0 8px; color: var(--text-3); font-size: var(--fs-xs); }
  input[type='search'] { width: 100%; }
  .kinds { display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0; }
  .kinds button { padding: 2px 8px; border: 1px solid var(--border); border-radius: 999px; font-size: 11px; color: var(--text-2); cursor: pointer; }
  .kinds button span { color: var(--text-3); }
  .kinds button[aria-pressed='true'] { border-color: var(--accent); color: var(--text-1); background: var(--accent-soft); }
  .picker-actions { display: flex; justify-content: space-between; }
  .text-act { color: var(--text-3); font-size: 11px; cursor: pointer; }
  .text-act:hover:not(:disabled) { color: var(--text-1); }
  ul { list-style: none; margin: 4px 0 0; padding: 0; max-height: 320px; overflow-y: auto; }
  label { display: flex; align-items: center; gap: 7px; padding: 4px 2px; font-size: var(--fs-xs); color: var(--text-2); cursor: pointer; }
  label :global(svg) { flex: none; color: var(--text-3); }
  label.already { color: var(--text-3); cursor: default; }
  .title { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .tag { font-size: 10px; color: var(--text-3); }
  .actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 12px; }
</style>
