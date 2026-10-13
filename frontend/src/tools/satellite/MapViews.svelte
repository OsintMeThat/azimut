<script>
  import { untrack } from 'svelte';
  import Modal from '../../components/Modal.svelte';
  import Icon from '../../components/Icon.svelte';
  import { api } from '../../lib/api.js';
  import { caseState, ensureCase, reloadCase, toast, uiState } from '../../lib/state.svelte.js';
  import { personalLayers } from '../../lib/map/personalLayers.svelte.js';
  import { addedLayers } from '../../lib/map/addedLayersState.svelte.js';
  import { captureMapView, applyMapView, layerLegend } from '../../lib/map/mapViews.js';
  import { deletedToast } from '../../lib/trash.js';
  let { tool, engine, provider, rows = [], scope, onprovider } = $props();
  const active = $derived(uiState.tool === tool);
  let items = $state([]), title = $state('My map'), note = $state(''), showLegend = $state(true);
  let busy = $state(false);
  let editing = $state('');
  const displayedLegend = $derived(layerLegend(scope?.rows ?? []));
  $effect(() => {
    if (!active || !personalLayers.maps) return;
    const dialog = personalLayers.maps;
    const owner = caseState.current?.id;
    let cancelled = false;
    untrack(async () => {
      items = []; editing = ''; title = 'My map'; note = ''; showLegend = true;
      try {
        const list = owner ? await api.get(`/api/cases/${owner}/map-views`) : [];
        if (cancelled || personalLayers.maps !== dialog || caseState.current?.id !== owner) return;
        items = list;
        const item = list.find((row) => row.id === dialog.name);
        if (item) {
          editing = item.id; title = item.title; note = item.note; showLegend = item.show_legend;
          if (!personalLayers.editor && engine) await open(item);
        }
      }
      catch (error) { if (!cancelled) toast(error.message, 'danger'); }
    });
    return () => { cancelled = true; };
  });
  async function save() {
    busy = true;
    const dialog = personalLayers.maps;
    try {
      await personalLayers.whenSaved();
      await addedLayers.whenLoaded(caseState.current?.id);
      if (personalLayers.maps !== dialog) return;
      const body = captureMapView({ engine, provider, rows, layers: scope.rows, title, note, showLegend });
      const owner = await ensureCase();
      if (dialog.caseId && dialog.caseId !== owner.id) return;
      dialog.caseId = owner.id;
      if (editing) body.id = editing;
      const saved = await api.post(`/api/cases/${owner.id}/map-views`, body);
      if (caseState.current?.id !== owner.id || personalLayers.maps !== dialog) return;
      items = editing ? items.map((row) => row.id === editing ? saved : row) : [...items, saved];
      personalLayers.setLegend(saved, owner.id); await reloadCase();
      toast('Map saved', 'ok');
    } catch (error) { toast(error.message, 'danger'); }
    finally { busy = false; }
  }
  async function open(item) {
    busy = true;
    const owner = caseState.current?.id;
    try {
      await addedLayers.whenLoaded(owner);
      if (caseState.current?.id !== owner) return;
      const missing = await applyMapView(item, { caseId: owner, api, layers: addedLayers, scope, rows, engine, onprovider, currentCase: () => caseState.current?.id });
      personalLayers.setLegend(item, owner); personalLayers.closeMaps();
      if (missing.length) toast(`${missing.length} layers are no longer in this case`, 'warn');
    } catch (error) { toast(error.message, 'danger'); }
    finally { busy = false; }
  }
  async function remove(item) {
    busy = true;
    const owner = caseState.current?.id;
    try {
      const result = await api.del(`/api/cases/${owner}/map-views/${item.id}`);
      if (caseState.current?.id !== owner) return;
      items = items.filter((row) => row.id !== item.id); deletedToast(owner, result, 'Map'); await reloadCase();
    } catch (error) { toast(error.message, 'danger'); }
    finally { busy = false; }
  }
</script>

{#if active && personalLayers.maps}
  <Modal title="Saved maps" onclose={() => { if (!busy) personalLayers.closeMaps(); }} width="400px">
    <p class="note">Save this camera, visible layers and legend. Layers keep their current data.</p>
    <label>Name<input aria-label="Map name" bind:value={title} maxlength="200" /></label>
    <label>Legend note<textarea aria-label="Legend note" bind:value={note} maxlength="2000" rows="2"></textarea></label>
    <label class="check"><input type="checkbox" bind:checked={showLegend} /> Show legend</label>
    <button class="btn btn-primary btn-sm" disabled={busy || !engine || !title.trim()} onclick={save}>{editing ? 'Update with this view' : 'Save this map'}</button>
    {#if editing}<button class="btn btn-sm" disabled={busy} onclick={() => { editing = ''; title = 'My map'; note = ''; showLegend = true; }}>New map</button>{/if}
    {#if personalLayers.editor}<p class="note">Finish layer editing before opening another map.</p>{/if}
    <ul aria-label="Saved maps">
      {#each items as item (item.id)}<li><button class="open" disabled={busy || !engine || !!personalLayers.editor} onclick={() => open(item)}>{item.title}</button>
        <button class="icon-act" aria-label={`Edit map ${item.title}`} title="Edit map composition" disabled={busy} onclick={() => { editing = item.id; title = item.title; note = item.note; showLegend = item.show_legend; }}><Icon name="edit" size={12} /></button>
        <button class="icon-act" aria-label={`Remove map ${item.title}`} title="Move to Trash" disabled={busy} onclick={() => remove(item)}><Icon name="trash" size={12} /></button></li>{/each}
    </ul>
    {#if !items.length}<p class="note">No maps saved yet.</p>{/if}
  </Modal>
{/if}
{#if active && personalLayers.legend && personalLayers.legend.caseId === caseState.current?.id && personalLayers.legend.view.show_legend}
  <aside class="map-legend" aria-label="Map legend">
    <header><strong>{personalLayers.legend.view.title}</strong><button class="icon-act" aria-label="Hide map legend" title="Hide legend" onclick={() => personalLayers.setLegend(null)}><Icon name="x" size={11} /></button></header>
    {#if personalLayers.legend.view.note}<p>{personalLayers.legend.view.note}</p>{/if}
    <ul>{#each displayedLegend as item}<li><span class="dot" style:background={item.colour}></span>{item.label}</li>{/each}</ul>
  </aside>
{/if}

<style>
  label { display: grid; gap: 4px; font-size: var(--fs-sm); margin: 8px 0; }
  .check { display: flex; align-items: center; }
  .note { font-size: 11px; color: var(--text-3); }
  ul { padding: 0; margin: 10px 0 0; list-style: none; }
  li { display: flex; align-items: center; gap: 6px; padding: 4px 0; font-size: 11px; }
  .open { flex: 1; text-align: left; color: var(--text-2); cursor: pointer; }
  .map-legend { position: absolute; bottom: 40px; left: 58px; z-index: 600; max-width: 260px; max-height: 220px; overflow-y: auto; padding: 8px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-1); }
  .map-legend header { display: flex; align-items: center; gap: 8px; }
  .map-legend strong { flex: 1; font-size: 11px; }
  .map-legend p { white-space: pre-wrap; font-size: 10px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
</style>
