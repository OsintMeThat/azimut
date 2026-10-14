<script>
  /**
   * A personal layer out of the case: a file in one of three formats, or the
   * file a My Maps is sent.
   *
   * A tracked layer goes out as it is now, as it stood on the day its cursor is
   * on, or (KML, KMZ, GeoJSON) with every state dated so a time slider reads it.
   * My Maps keeps no history and Google offers no way to write to one, so
   * sending is a KMZ of one day, the My Maps opened beside it, and three steps
   * said here.
   */
  import Modal from '../../components/Modal.svelte';
  import { api } from '../../lib/api.js';
  import { downloadLayer } from '../../lib/map/layerExport.js';
  import { addedLayers } from '../../lib/map/addedLayersState.svelte.js';
  import { isTracked, momentLabel } from '../../lib/map/layerHistory.js';
  import { toast } from '../../lib/state.svelte.js';

  let { target, onclose } = $props();
  const row = $derived(addedLayers.rows.find((item) => item.name === target.row.name) ?? target.row);
  const tracked = $derived(isTracked(row));
  const cursor = $derived(tracked ? addedLayers.time(row.name).at : null);
  // svelte-ignore state_referenced_locally
  let mode = $state(target.mode === 'mymaps' ? 'mymaps' : 'download');
  /** 'now', 'cursor' or 'history'. */
  let which = $state('now');
  $effect(() => { if (which === 'cursor' && cursor === null) which = 'now'; });
  // svelte-ignore state_referenced_locally
  let address = $state(target.row.mymaps ?? '');
  let busy = $state('');

  const at = $derived(which === 'cursor' ? cursor : null);
  const valid = (text) => /^https:\/\/(www\.)?google\.[a-z.]+\/maps\/d\/\S*$/i.test(text.trim());

  async function download(format) {
    busy = format;
    try {
      await downloadLayer(target.caseId, row, format, { at, history: which === 'history' });
      onclose();
    } catch (error) { toast(error.message, 'danger'); }
    finally { busy = ''; }
  }

  async function send() {
    const text = address.trim();
    if (!valid(text)) { toast('Paste the address of your My Maps, from its editor', 'danger', 4000); return; }
    busy = 'mymaps';
    try {
      if (text !== (row.mymaps ?? '')) {
        const answer = await api.patch(`/api/cases/${target.caseId}/map-layers/${encodeURIComponent(row.name)}/edit`, { mymaps: text });
        addedLayers.edited(target.caseId, answer.layer);
      }
      await downloadLayer(target.caseId, row, 'kmz', { at });
      // the analyst's own map, opened on their press: the one address this reaches
      window.open(text, '_blank', 'noopener');
      toast('KMZ saved. Replace the layer in My Maps with it.', 'ok', 5000);
      onclose();
    } catch (error) { toast(error.message, 'danger'); }
    finally { busy = ''; }
  }
</script>

<Modal title={mode === 'mymaps' ? 'Send to My Maps' : 'Download layer'} onclose={() => { if (!busy) onclose(); }} width="380px">
  <p class="layer">{row.title}</p>

  {#if tracked}
    <fieldset class="which">
      <legend>{mode === 'mymaps' ? 'My Maps keeps no history: send one day' : 'What goes in the file'}</legend>
      <label><input type="radio" bind:group={which} value="now" /> The layer now</label>
      <label class:off={cursor === null}><input type="radio" bind:group={which} value="cursor" disabled={cursor === null} />
        {cursor === null ? 'The layer on its day (move its cursor first)' : `The layer on ${momentLabel(cursor)}`}</label>
      {#if mode === 'download'}
        <label><input type="radio" bind:group={which} value="history" /> Every state, dated for a time slider</label>
      {/if}
    </fieldset>
  {/if}

  {#if mode === 'download'}
    <div class="formats">
      {#each [['kmz', 'KMZ', 'Includes icons for Google Earth or My Maps.'], ['kml', 'KML', 'Geometry, groups and style fields.'], ['geojson', 'GeoJSON', 'Geometry and style fields for GIS tools.']] as [format, name, detail] (format)}
        <button class="btn" disabled={!!busy} onclick={() => download(format)}><strong>{busy === format ? 'Preparing…' : name}</strong><span>{detail}</span></button>
      {/each}
    </div>
    <button type="button" class="switch" onclick={() => { mode = 'mymaps'; if (which === 'history') which = 'now'; }}>Send to My Maps instead</button>
  {:else}
    <label class="address">
      <span>Your My Maps</span>
      <input type="url" bind:value={address} placeholder="https://www.google.com/maps/d/edit?mid=…" maxlength="2000" />
    </label>
    <ol class="steps">
      <li>Press the button: the KMZ is saved and your My Maps opens.</li>
      <li>In My Maps, on the old layer: ⋮, then Delete this layer.</li>
      <li>Add layer, then Import, and choose the file just saved.</li>
    </ol>
    <p class="note">The address stays with this layer. Free, with your Google account.</p>
    <div class="acts">
      <button type="button" class="switch" onclick={() => (mode = 'download')}>Download a file instead</button>
      <button class="btn btn-primary" disabled={!!busy || !valid(address)} onclick={send}>
        {busy === 'mymaps' ? 'Preparing…' : 'Save KMZ and open My Maps'}</button>
    </div>
  {/if}
</Modal>

<style>
  .layer { margin: 0 0 10px; font-size: var(--fs-sm); font-weight: 600; }
  .which { margin: 0 0 12px; padding: 0; border: 0; display: grid; gap: 5px; }
  .which legend { margin-bottom: 4px; color: var(--text-3); font-size: 11px; }
  .which label { display: flex; align-items: center; gap: 6px; font-size: var(--fs-xs); cursor: pointer; }
  .which label.off { color: var(--text-3); }
  .formats { display: grid; gap: 6px; }
  .formats button { display: grid; justify-items: start; gap: 3px; text-align: left; padding: 9px; }
  .formats span { color: var(--text-3); font-size: 11px; }
  .switch { margin-top: 10px; padding: 0; color: var(--text-3); font-size: 11px; cursor: pointer; }
  .switch:hover { color: var(--text-1); text-decoration: underline; }
  .address { display: grid; gap: 4px; font-size: 11px; color: var(--text-3); }
  .address input { height: 28px; padding: 3px 7px; font-size: var(--fs-xs); }
  .steps { margin: 12px 0 6px; padding-left: 18px; display: grid; gap: 4px; font-size: var(--fs-xs); color: var(--text-2); }
  .note { margin: 0 0 12px; color: var(--text-3); font-size: 11px; }
  .acts { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .acts .switch { margin: 0; }
</style>
