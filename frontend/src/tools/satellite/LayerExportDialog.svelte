<script>
  import Modal from '../../components/Modal.svelte';
  import { downloadLayer } from '../../lib/map/layerExport.js';
  import { toast } from '../../lib/state.svelte.js';
  let { target, onclose } = $props();
  let busy = $state('');
  async function download(format) {
    busy = format;
    try { await downloadLayer(target.caseId, target.row, format); onclose(); }
    catch (error) { toast(error.message, 'danger'); }
    finally { busy = ''; }
  }
</script>
<Modal title="Download layer" onclose={() => { if (!busy) onclose(); }} width="340px">
  <p>{target.row.title}</p>
  <div class="formats">
    {#each [['kmz', 'KMZ', 'Includes icons for Google Earth or My Maps.'], ['kml', 'KML', 'Geometry, groups and style fields.'], ['geojson', 'GeoJSON', 'Geometry and style fields for GIS tools.']] as [format, name, detail]}
      <button class="btn" disabled={!!busy} onclick={() => download(format)}><strong>{busy === format ? 'Preparing…' : name}</strong><span>{detail}</span></button>
    {/each}
  </div>
</Modal>
<style>
  p { margin: 0 0 10px; font-size: var(--fs-sm); }
  .formats { display: grid; gap: 6px; }
  .formats button { display: grid; justify-items: start; gap: 3px; text-align: left; padding: 9px; }
  .formats span { color: var(--text-3); font-size: 11px; }
</style>
