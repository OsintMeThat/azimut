<script>
  /**
   * A measure put into one of the case's layers, with the menu a proof's point
   * and a copied feature use (`LayerTargetSteps`): the layer, then its group.
   * It lands as a line or an area named by what it reads, its name written on
   * the map and its text in the notes, and leaves the tool for the layer.
   */
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import LayerTargetSteps from './LayerTargetSteps.svelte';
  import { orderedTargets } from './itemLayers.svelte.js';
  import { api } from '../../lib/api.js';
  import { addedLayers } from '../../lib/map/addedLayersState.svelte.js';
  import { personalLayers } from '../../lib/map/personalLayers.svelte.js';
  import { toast } from '../../lib/state.svelte.js';

  let {
    caseId,
    /** `tool.feature(id)`: `{ geometry, name, description }`. */
    feature,
    anchor = null,
    onclose = () => {},
    /** It is in the layer named. */
    ondone = () => {},
  } = $props();

  const memory = () => `azimut:layer-last:${caseId}`;
  let targets = $state.raw([]);
  let step = $state(null);
  let busy = $state(false);
  const last = () => {
    try {
      return localStorage.getItem(memory()) ?? '';
    } catch {
      return '';
    }
  };

  async function read() {
    try {
      targets = await api.get(`/api/cases/${caseId}/layer-targets`);
    } catch {
      targets = [];
    }
  }
  read();

  async function create(title) {
    busy = true;
    try {
      const row = await addedLayers.createEditable(title);
      if (!row) return null;
      await read();
      return row.name;
    } finally {
      busy = false;
    }
  }

  async function add({ layer, group }) {
    try {
      localStorage.setItem(memory(), layer.name);
    } catch {
      /* the order is a convenience */
    }
    // on a layer followed over time, a feature appears on the day it shows
    const row = addedLayers.rows.find((one) => one.name === layer.name);
    const at = row?.track?.on ? addedLayers.time?.(layer.name)?.at : null;
    busy = true;
    try {
      const answer = await api.post(`/api/cases/${caseId}/map-layers/${encodeURIComponent(layer.name)}/shapes`, {
        geometry: feature.geometry,
        name: feature.name,
        description: feature.description,
        colour: '#f5a623',
        label: 'on',
        ...(group ? { group: group.id } : {}),
        ...(at ? { at } : {}),
      });
      if (answer?.layer) addedLayers.edited(caseId, answer.layer);
      if (personalLayers.editor?.name === layer.name) personalLayers.refresh();
      toast(`Kept in ${layer.title}`, 'ok', 2600);
      ondone(layer);
    } catch (error) {
      toast(error.message, 'danger', 5000);
    } finally {
      busy = false;
    }
  }
</script>

<FloatingMenu {anchor} width={step?.group ? 264 : 248} label="Keep in a layer" {onclose}>
  {#if !step}
    <p class="fm-head">Keep in a layer</p>
    <p class="fm-note">“{feature.name}” goes in as a {feature.geometry.type === 'LineString' ? 'line' : 'shape'}, named on the map, with its points in the notes.</p>
  {/if}
  <LayerTargetSteps bind:step targets={orderedTargets(targets, last())} {busy} {caseId} point={false} oncreate={create} onadd={add} />
</FloatingMenu>
