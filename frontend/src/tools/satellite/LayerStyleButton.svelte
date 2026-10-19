<script>
  /**
   * The style of personal-layer features, picked in one place: the group they
   * belong to, their icon and their colour.
   *
   * The same button sits on the map's edit bar, in the feature sheet and in a
   * group's settings, so restyling reads the same wherever it starts. Every
   * pick is applied at once; the palette (`LayerStylePalette`) stays open until
   * a press outside it, so an icon and a colour are two clicks, not two trips.
   */
  import Icon from '../../components/Icon.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import MarkerSymbol from './MarkerSymbol.svelte';
  import LayerStylePalette from './LayerStylePalette.svelte';
  import choices from '../../lib/map/layerSymbols.json';
  import { layerPalette } from '../../lib/map/layerPalette.svelte.js';
  import { iconLibrary } from '../../lib/iconLibrary.svelte.js';

  let {
    label, symbol = 'pin', colour = '#0072b2', point = true, mixed = false,
    /** The own icon worn, '' for none; the layer it is in, and that layer's `{key: {mode, name}}`. */
    icon = '', layer = null, meta = null, own = true,
    /** Styles already in the layer, `{ symbol, colour, icon? }`, offered first. */
    used = [],
    /** The groups a feature can be moved into, with the one it is in ('' for several). */
    groups = [], group = '', groupLabel = 'Group', ongroup = null,
    note = '', caseId = null, disabled = false, size = 20, title = 'Style',
    onpick,
    /** `(open)`, as the palette opens and closes, for what must step aside from it. */
    onopen = null,
  } = $props();

  let open = $state(false);
  $effect(() => { onopen?.(open); });
  let trigger = $state(null);
  const picked = $derived(choices.find((choice) => choice.id === symbol) ?? choices[0]);
  const worn = $derived(icon ? iconLibrary.look(icon, { caseId, layer, meta }) : null);
  const wornName = $derived(worn ? worn.name || 'own icon' : picked.label);
  const colourName = $derived(layerPalette.nameOf(colour));
</script>

<button type="button" class="style-button" bind:this={trigger} aria-label={label} aria-expanded={open} {disabled}
  title={mixed ? `${title}: several` : point ? `${title}: ${wornName}${colourName ? `, ${colourName}` : ''}` : title}
  onclick={() => (open = !open)}>
  {#if point}<MarkerSymbol symbol={picked.id} {colour} icon={worn} {size} />
  {:else}<span class="dot" style={`--swatch:${colour}`}></span>{/if}
  {#if mixed}<span class="mixed">+</span>{/if}
  <Icon name="chevronDown" size={10} />
</button>

{#if open}
  <FloatingMenu anchor={trigger} width={256} role="group" label={`${label} picker`} onclose={() => (open = false)}>
    {#if note}<p class="fm-note">{note}</p>{/if}
    {#if groups.length > 1 && ongroup}
      <label class="group-row"><span>{groupLabel}</span>
        <select aria-label={`${label} group`} value={group} onchange={(event) => ongroup(event.currentTarget.value)}>
          {#if !group}<option value="" disabled>Several</option>{/if}
          {#each groups as one (one.id)}<option value={one.id}>{one.name}</option>{/each}
        </select>
      </label>
    {/if}
    <LayerStylePalette {label} {symbol} {colour} {icon} {layer} {meta} {own} {point} {mixed} {used} {caseId} {onpick} />
  </FloatingMenu>
{/if}

<style>
  .style-button { display: inline-flex; align-items: center; gap: 3px; flex: none; height: 30px; padding: 0 5px; border-radius: var(--r-sm); color: var(--text-3); cursor: pointer; }
  .style-button:hover:not(:disabled), .style-button[aria-expanded='true'] { background: var(--bg-3); color: var(--text-1); }
  .style-button:disabled { opacity: .4; cursor: default; }
  .mixed { margin-left: -2px; color: var(--text-2); font-size: 11px; font-weight: 700; }
  .dot { width: 14px; height: 14px; border-radius: 3px; background: var(--swatch); border: 1px solid #0004; }
  .group-row { display: flex; align-items: center; gap: 8px; margin: 3px 4px 6px; color: var(--text-3); }
  .group-row select { flex: 1; min-width: 0; height: 26px; padding: 2px 6px; font-size: var(--fs-xs); }
</style>
