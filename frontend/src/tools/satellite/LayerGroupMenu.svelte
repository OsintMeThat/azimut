<script>
  /**
   * A group's settings, from the ⋯ on its row: its name, whether all its
   * features share one style, names on the map, sizes, and the group itself.
   * Each setting is saved as it changes.
   */
  import Icon from '../../components/Icon.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import LayerStyleButton from './LayerStyleButton.svelte';
  import { usedStyles } from '../../lib/map/layerStyle.js';

  let { controller, group, anchor, members = 0, onclose } = $props();
  const busy = $derived(controller.pending > 0);
  const uniform = $derived(group.mode === 'uniform');
  // A slider shows where it is held while it moves, and saves where it is let go.
  let size = $state(null);
  let stroke = $state(null);
  const used = $derived(usedStyles(controller.features ?? [], controller.groups ?? []));

  async function slide(field, value, reset) {
    const result = await controller.updateGroup(group.id, { [field]: value });
    if (result === null) reset();
  }
</script>

<FloatingMenu {anchor} align="end" width={250} role="group" label={`Settings of group ${group.name}`} {onclose}>
  <label class="field"><span>Name</span>
    <input aria-label="Group name" value={group.name} maxlength="200"
      onchange={(event) => controller.updateGroup(group.id, { name: event.currentTarget.value })}
      onkeydown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
  <label class="switch"><input type="checkbox" aria-label="One style for the whole group" checked={uniform} disabled={busy}
    onchange={(event) => controller.updateGroup(group.id, { mode: event.currentTarget.checked ? 'uniform' : 'individual' })} />
    One style for the whole group</label>
  {#if uniform}
    <div class="field"><span>Style</span>
      <LayerStyleButton label="Group style" symbol={group.symbol} colour={group.colour} {used} caseId={controller.editor?.caseId ?? null}
        disabled={busy} onpick={(changes) => controller.updateGroup(group.id, changes)} /></div>
  {/if}
  <label class="switch"><input type="checkbox" aria-label={`Names on the map for ${group.name}`} checked={!!group.labels} disabled={busy}
    onchange={(event) => controller.updateGroup(group.id, { labels: event.currentTarget.checked })} /> Names on the map</label>
  {#if controller.editor?.track?.on}
    <!-- a strike fades after its day where a position stays: what the layer's cursor reads -->
    <label class="switch" title="Each one fades after its day, and leaves the map some days later"><input type="checkbox"
      aria-label={`${group.name} are events`} checked={!!group.events} disabled={busy}
      onchange={(event) => controller.updateGroup(group.id, { events: event.currentTarget.checked })} /> Events: fade after their day</label>
  {/if}
  <label class="field slider"><span>Icon size</span>
    <input type="range" min="0.5" max="3" step="0.25" value={size ?? group.size ?? 1} aria-label={`Icon size for ${group.name}`}
      oninput={(event) => { size = Number(event.currentTarget.value); }}
      onchange={() => slide('size', size ?? group.size ?? 1, () => (size = null))} />
    <output>{Math.round((size ?? group.size ?? 1) * 100)}%</output></label>
  <label class="field slider"><span>Line width</span>
    <input type="range" min="0.5" max="12" step="0.5" value={stroke ?? group.stroke ?? 2} aria-label={`Line width for ${group.name}`}
      oninput={(event) => { stroke = Number(event.currentTarget.value); }}
      onchange={() => slide('stroke', stroke ?? group.stroke ?? 2, () => (stroke = null))} />
    <output>{stroke ?? group.stroke ?? 2}px</output></label>
  <div class="fm-sep"></div>
  {#if members > 1}
    <button type="button" class="fm-item" onclick={() => { controller.selectGroup(group.id); onclose?.(); }}>
      <Icon name="cursor" size={14} /><span class="fm-grow">Select all {members}</span></button>
  {/if}
  {#if (controller.groups ?? []).length > 1}
    <button type="button" class="fm-item danger" disabled={busy} onclick={() => { controller.removeGroup(group.id); onclose?.(); }}>
      <Icon name="trash" size={14} /><span class="fm-grow">Remove the group, keep its features</span></button>
  {/if}
</FloatingMenu>

<style>
  .field { display: flex; align-items: center; gap: 8px; min-height: 30px; padding: 0 6px; color: var(--text-3); font-size: 11px; }
  .field > span { width: 58px; flex: none; }
  .field input:not([type='range']) { flex: 1; min-width: 0; height: 26px; padding: 3px 6px; font-size: var(--fs-xs); }
  .slider input { flex: 1; min-width: 0; height: 18px; padding: 0; accent-color: var(--accent); }
  .slider output { width: 34px; text-align: right; color: var(--text-2); }
  .switch { display: flex; align-items: center; gap: 8px; min-height: 28px; padding: 0 6px; color: var(--text-1); font-size: var(--fs-xs); cursor: pointer; }
</style>
