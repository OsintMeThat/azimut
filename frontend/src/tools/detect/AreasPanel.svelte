<script>
  /**
   * The case's shared areas: the ground this case watches, named and coloured
   * once and referenced by every routine and pass that sweeps it.
   *
   * A row reads like the map: the colour it is drawn in, its name, how big it
   * is and what uses it. Pressing a row frames it; editing is asked for rather
   * than always on screen, so the list stays a list.
   *
   * A new shape reaches every routine that watches the area, from its next
   * run, since a routine reads its areas when it runs. A finished run froze
   * its own copy and keeps the ground it swept. Saving the shape as a new area
   * leaves the routines on the old one.
   */
  import { untrack } from 'svelte';
  import { api } from '../../lib/api.js';
  import { ensureCase, prefs, reloadCase } from '../../lib/state.svelte.js';
  import { zoneRing } from '../../lib/map/analyzers.js';
  import { formatArea, polygonArea } from '../../lib/measure.js';
  import { plural } from '../../lib/map/detections.js';
  import Icon from '../../components/Icon.svelte';
  import Modal from '../../components/Modal.svelte';

  let { caseId, areas = [], routines = [], selectedArea = null, hidden = $bindable([]),
    zones = $bindable([]), drawing = $bindable('select'),
    /** The shape the map shows its corners for. */
    selectedZone = $bindable(null),
    onrefresh = async () => {}, onusecurrentview = () => {}, onframe = () => {} } = $props();

  let error = $state('');
  let busy = $state(false);
  let removing = $state(null);
  let editing = $state(null);
  /** The area whose corners are on the map, and whether it was drawn before. */
  let reshaping = $state(null);

  const users = $derived(removing ? routines.filter((routine) => routine.zones?.some((z) => z.id === removing.id)) : []);
  const usedBy = (area) => routines.filter((routine) => routine.zones?.some((z) => z.id === area.id)).length;
  const size = (area) => formatArea(
    polygonArea(area.geometry.coordinates[0].slice(0, -1).map(([lon, lat]) => ({ lon, lat }))),
    prefs.units
  );
  const ringOf = (area) => [{ kind: 'polygon', points: area.geometry.coordinates[0] }];

  async function act(fn) {
    busy = true; error = '';
    try { await fn(); await onrefresh(); await reloadCase(); }
    catch (e) { error = e.message; }
    finally { busy = false; }
  }
  async function save(zone) {
    const owner = await ensureCase();
    const ring = zoneRing(zone);
    await api.post(`/api/cases/${owner.id}/analysis/areas`, { name: zone.name, colour: '#38bdf8',
      geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] } });
    zones = zones.filter((z) => z.id !== zone.id); drawing = 'select';
  }
  async function update(area, patch) {
    await api.put(`/api/cases/${caseId}/analysis/areas/${area.id}`, {
      name: area.name, colour: area.colour, geometry: area.geometry, ...patch,
    });
  }
  /** The area put on the map as a shape to drag, in place of its own outline. */
  function reshape(area) {
    reshaping = { area, wasHidden: hidden.includes(area.id) };
    zones = [...zones.filter((zone) => zone.id !== area.id),
      { id: area.id, name: area.name, kind: 'polygon', points: area.geometry.coordinates[0].slice(0, -1) }];
    if (!reshaping.wasHidden) hidden = [...hidden, area.id];
    drawing = 'select';
    selectedZone = area.id;
    editing = null;
    onframe(ringOf(area));
  }

  function endReshape() {
    if (!reshaping) return;
    const { area, wasHidden } = reshaping;
    zones = zones.filter((zone) => zone.id !== area.id);
    if (!wasHidden) hidden = hidden.filter((id) => id !== area.id);
    if (selectedZone === area.id) selectedZone = null;
    reshaping = null;
  }

  async function saveShape(asNew) {
    const { area } = reshaping;
    const ring = zoneRing(zones.find((zone) => zone.id === area.id));
    const geometry = { type: 'Polygon', coordinates: [[...ring, ring[0]]] };
    if (asNew) {
      await api.post(`/api/cases/${caseId}/analysis/areas`, { name: `${area.name} · new shape`, colour: area.colour, geometry });
    } else {
      await update(area, { geometry });
    }
    endReshape();
  }

  // Leaving the tab halfway puts the area back as it was.
  $effect(() => () => untrack(endReshape));

  const toggle = (id) => (hidden = hidden.includes(id) ? hidden.filter((value) => value !== id) : [...hidden, id]);
</script>

<div class="area-actions">
  <button class="btn btn-sm" class:active={drawing === 'polygon'}
    onclick={() => (drawing = drawing === 'polygon' ? 'select' : 'polygon')}>Draw an area</button>
  <button class="btn btn-sm" onclick={onusecurrentview}>Use current view</button>
  {#if areas.length > 1}
    <button class="btn btn-sm" onclick={() => onframe(areas.flatMap(ringOf))}>Show all</button>
  {/if}
</div>
{#if error}<p class="warn" role="alert">{error}</p>{/if}
{#if drawing === 'polygon'}<p class="hint">Click corners; Enter finishes, Escape cancels.</p>{/if}

{#if reshaping}
  {@const watching = usedBy(reshaping.area)}
  <div class="reshape" role="group" aria-label={`Reshaping ${reshaping.area.name}`}>
    <p><strong>{reshaping.area.name}</strong> · drag its corners on the map.</p>
    <p class="hint">{watching
      ? `${plural(watching, 'routine')} ${watching === 1 ? 'watches' : 'watch'} it: the next runs sweep the new shape.`
      : 'No routine watches it yet.'} Finished runs keep the ground they swept.</p>
    <div class="area-actions">
      <button class="btn btn-sm btn-primary" disabled={busy} onclick={() => act(() => saveShape(false))}>Save shape</button>
      <button class="btn btn-sm" disabled={busy} title="Keep this area as it was, and its routines on it"
        onclick={() => act(() => saveShape(true))}>Save as a new area</button>
      <button class="btn btn-sm" disabled={busy} onclick={endReshape}>Cancel</button>
    </div>
  </div>
{/if}

{#each zones.filter((zone) => zone.id !== reshaping?.area.id) as zone (zone.id)}
  <div class="draft">
    <input aria-label="Area name" bind:value={zone.name} maxlength="120" />
    <button class="btn btn-sm btn-primary" disabled={busy} onclick={() => act(() => save(zone))}>Save as area</button>
  </div>
{/each}

{#if !areas.length}
  <div class="empty">
    <p>No shared area in this case yet.</p>
    <p class="hint">Draw one here and every routine can watch it.</p>
  </div>
{/if}

{#each areas as area (area.id)}
  {@const off = hidden.includes(area.id)}
  <div class="area-row" class:selected={selectedArea === area.id} class:off>
    <button class="cmp-icon" aria-label={off ? `Show ${area.name}` : `Hide ${area.name}`} aria-pressed={!off}
      title={off ? 'Show on the map' : 'Hide on the map'} onclick={() => toggle(area.id)}>
      <Icon name={off ? 'eyeOff' : 'eye'} size={14} />
    </button>
    <span class="swatch" style={`--tint: ${area.colour}`}></span>
    <button class="name" title="Frame this area" onclick={() => onframe(ringOf(area))}>
      <strong>{area.name}</strong>
      <small>{size(area)}{usedBy(area) ? ` · ${plural(usedBy(area), 'routine')}` : ''}</small>
    </button>
    <button class="cmp-icon" aria-label={`Edit ${area.name}`} title="Rename, recolour or reshape"
      onclick={() => (editing = editing === area.id ? null : area.id)}><Icon name="edit" size={13} /></button>
    <button class="cmp-icon" title="Delete area" aria-label={`Delete ${area.name}`} disabled={busy}
      onclick={() => (removing = area)}><Icon name="trash" size={13} /></button>
  </div>
  {#if editing === area.id}
    <div class="edit">
      <input type="color" aria-label={`Colour of ${area.name}`} value={area.colour} disabled={busy}
        onchange={(e) => act(() => update(area, { colour: e.currentTarget.value }))} />
      <input aria-label={`Rename ${area.name}`} value={area.name} maxlength="120" disabled={busy}
        onchange={(e) => act(() => update(area, { name: e.currentTarget.value }))} />
      <button class="btn btn-sm" disabled={busy || !!reshaping} onclick={() => reshape(area)}>Reshape on the map</button>
    </div>
  {/if}
{/each}

{#if removing}
  <Modal title={`Delete ${removing.name}?`} onclose={() => (removing = null)}>
    {#if users.length}
      <p>Remove this area from these routines first:</p>
      <ul>{#each users as routine (routine.id)}<li>{routine.title}</li>{/each}</ul>
    {:else}
      <p>The area moves to Trash. Existing runs keep their own copy.</p>
      <button class="btn btn-danger" disabled={busy} onclick={() => act(async () => {
        await api.del(`/api/cases/${caseId}/analysis/areas/${removing.id}`); removing = null;
      })}>Move to Trash</button>
    {/if}
    {#if error}<p class="warn" role="alert">{error}</p>{/if}
  </Modal>
{/if}

<style>
  .area-actions, .draft, .edit { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .draft, .edit { padding: 7px 0; }
  .reshape {
    display: grid;
    gap: 6px;
    padding: 8px 9px;
    border: 1px solid var(--accent);
    border-radius: var(--r-sm);
    background: var(--accent-soft);
  }
  .reshape p { margin: 0; font-size: var(--fs-xs); }
  .area-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 4px;
    border-radius: var(--r-sm);
  }
  .area-row:hover { background: var(--bg-2); }
  .area-row.selected { background: var(--accent-soft); }
  .area-row.off .name { opacity: 0.55; }
  .swatch { flex: 0 0 auto; width: 10px; height: 10px; border-radius: 3px; background: var(--tint); }
  .name { display: grid; flex: 1; gap: 1px; min-width: 0; text-align: left; }
  .name strong { overflow: hidden; font-size: var(--fs-xs); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .name small { color: var(--text-3); font-size: 10.5px; }
  .name:hover strong { color: var(--accent); }
  .empty {
    display: grid;
    gap: 4px;
    padding: 14px 12px;
    border: 1px dashed var(--border);
    border-radius: var(--r-sm);
    text-align: center;
  }
  .empty p { margin: 0; font-size: var(--fs-xs); color: var(--text-2); }
  input:not([type]) { flex: 1; width: 100px; }
  input[type='color'] { width: 26px; height: 26px; padding: 0; }
  .active { outline: 1px solid var(--accent); }
</style>
