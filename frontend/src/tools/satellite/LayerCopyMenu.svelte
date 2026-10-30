<script>
  /**
   * A feature of a source layer (a GeoConfirmed event, a My Maps pin) put into
   * one of the analyst's layers from its card, with the menu a proof's point and
   * a file use (`LayerTargetSteps`): the layer, its group, then the marker's icon,
   * starting on the feature's own colour, and on its own icon when its map
   * dressed it in one. It stays somebody else's geolocation, with its day and
   * the addresses its note cites (`copyTo`).
   */
  import { untrack } from 'svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import LayerTargetSteps from './LayerTargetSteps.svelte';
  import { orderedTargets } from './itemLayers.svelte.js';
  import { api } from '../../lib/api.js';
  import { addedLayers } from '../../lib/map/addedLayersState.svelte.js';
  import { UNNAMED } from '../../lib/map/addedLayers.js';
  import { iconVersion, layerIconUrl } from '../../lib/map/ownIcons.js';

  let { controller } = $props();
  // the feature it was opened on; another one opens the menu afresh (`LayerAddDialogs`)
  const job = untrack(() => controller.copying);
  const owner = job.caseId;
  const memory = `azimut:layer-last:${owner}`;
  const colour = job.feature.properties?.colour;
  const worn = job.feature.properties?.icon;
  const ownIcon = worn && job.row?.icons && job.feature.geometry?.type === 'Point'
    ? { key: worn, from: job.row.name, src: layerIconUrl(owner, job.row.name, worn, iconVersion(job.row)),
        mode: job.feature.properties.icon_mode === 'disc' ? 'disc' : 'image', name: job.feature.properties.icon_name ?? '' }
    : null;
  let targets = $state.raw([]);
  let step = $state(null);
  let busy = $state(false);
  const last = () => { try { return localStorage.getItem(memory) ?? ''; } catch { return ''; } };

  async function read() {
    try { targets = await api.get(`/api/cases/${owner}/layer-targets`); } catch { targets = []; }
  }
  read();

  async function create(title) {
    busy = true;
    try {
      const row = await addedLayers.createEditable(title);
      if (!row) return null;
      await read();
      return row.name;
    } finally { busy = false; }
  }
  async function add({ layer, group, style, status }) {
    const row = addedLayers.rows.find((one) => one.name === layer.name)
      ?? { name: layer.name, title: layer.title, editable: true };
    try { localStorage.setItem(memory, row.name); } catch { /* the order is a convenience */ }
    busy = true;
    try { await controller.copyTo(row, group?.id ?? null, style, status); } finally { busy = false; }
  }
</script>

<FloatingMenu anchor={job.anchor ?? null} width={step?.group ? 264 : 248} label="Add to a layer" onclose={() => controller.cancelCopy()}>
  {#if !step}
    <p class="fm-head">Add to a layer</p>
    <p class="fm-note">“{job.feature.properties?.name || UNNAMED}” stays {job.row.title}'s geolocation, with its day and sources.</p>
  {/if}
  <LayerTargetSteps bind:step targets={orderedTargets(targets, last())} {busy} caseId={owner}
    point={job.feature.geometry?.type === 'Point'} initial={/^#[0-9a-f]{6}$/i.test(colour ?? '') ? { colour } : null} {ownIcon}
    oncreate={create} onadd={add} />
</FloatingMenu>
