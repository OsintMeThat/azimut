<script>
  /**
   * The right-click menu on a feature of the layer being edited: what is
   * done to it most, where the pointer already is. It acts on the selection,
   * which the right-click has made sure holds the feature.
   */
  import Icon from '../../components/Icon.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import LayerSelectionStyle from './LayerSelectionStyle.svelte';

  let { controller, at, onclose } = $props();
  const STATUSES = [['', 'Intact'], ['damaged', 'Damaged'], ['destroyed', 'Destroyed']];
  const selection = $derived(controller.selection ?? []);
  const chosen = $derived(controller.features.filter((feature) => selection.includes(feature.properties.key)));
  const only = $derived(chosen.length === 1 ? chosen[0] : null);
  const statuses = $derived(new Set(chosen.map((feature) => feature.properties.status ?? '')));
  const turned = $derived(chosen.some((feature) => feature.geometry.type === 'Point' && feature.properties.bearing !== undefined && feature.properties.bearing !== null));
  const reshapable = $derived(!!only && !only.properties.entity_id
    && ['LineString', 'Polygon', 'MultiLineString', 'MultiPolygon'].includes(only.geometry.type));
  const busy = $derived(controller.pending > 0);

  function act(run) { run(); onclose?.(); }
</script>

{#if chosen.length}
  <FloatingMenu {at} width={232} label="Feature actions" {onclose}>
    <p class="fm-head">{only ? only.properties.name || 'Unnamed feature' : `${chosen.length} selected`}</p>
    <div class="line"><span>Style</span><LayerSelectionStyle {controller} label="Feature style" size={18} disabled={busy} /></div>
    <div class="status" role="group" aria-label="Status">
      {#each STATUSES as [status, label] (status)}
        <button type="button" aria-pressed={statuses.size === 1 && statuses.has(status)} disabled={busy}
          onclick={() => controller.updateSelection({ status: status || null })}>{label}</button>
      {/each}
    </div>
    <div class="fm-sep"></div>
    {#if turned}
      <button type="button" class="fm-item" disabled={busy} onclick={() => act(() => controller.updateSelection({ bearing: null }))}>
        <Icon name="compass" size={14} /><span class="fm-grow">Clear the direction</span></button>
    {/if}
    {#if reshapable}
      <button type="button" class="fm-item" disabled={busy} onclick={() => act(() => controller.editGeometry())}>
        <Icon name="edit" size={14} /><span class="fm-grow">Reshape</span></button>
    {/if}
    {#if only?.geometry.type === 'Point' && !only.properties.entity_id}
      <button type="button" class="fm-item" disabled={busy} onclick={() => act(() => controller.promote(only.properties.key))}>
        <Icon name="pin" size={14} /><span class="fm-grow">Save as case place</span></button>
    {/if}
    <button type="button" class="fm-item danger" disabled={busy} onclick={() => act(() => controller.removeSelection())}>
      <Icon name="trash" size={14} /><span class="fm-grow">{only ? 'Remove from the layer' : `Remove ${chosen.length} from the layer`}</span></button>
  </FloatingMenu>
{/if}

<style>
  .line { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 4px 0 8px; color: var(--text-2); font-size: var(--fs-sm); }
  .status { display: flex; margin: 5px 6px 3px; border: 1px solid var(--border); border-radius: var(--r-sm); overflow: hidden; }
  .status button { flex: 1; padding: 4px 3px; color: var(--text-2); font-size: 11px; cursor: pointer; }
  .status button + button { border-left: 1px solid var(--border); }
  .status button:hover:not(:disabled) { background: var(--bg-3); }
  .status button[aria-pressed='true'] { background: var(--accent-soft); color: var(--text-1); }
</style>
