<script>
  /**
   * Choosing where a case item joins the analyst's layers, a step at a time
   * inside one menu: the layer, then its group when it has several, then, for a
   * group whose features each have their own style, the marker's icon and
   * colour; for a group in one colour, its icon alone. A group with one style
   * takes the item at once.
   *
   * The menu around it owns `step` (null at the list of layers), so it can show
   * its own rows beside the list and drop them once a layer is open. `onadd`
   * gets `{ layer, group, style, status }` as chosen, read before the menu closes:
   * the state of what it shows (intact, damaged, destroyed) is set on the way, from
   * the row at the top, whichever step the menu is at. The
   * icon step starts on `initial` (a copied feature's own colour) over the
   * group's, and a line or an area (`point` false) skips it.
   *
   * A point copied out of a map that dressed it in its own icon (`ownIcon`,
   * `{ key, from, src, mode, name }`) keeps it unless another is picked: "Its
   * own icon" comes first in the icon step, already chosen, and the target layer
   * takes a copy of the picture (`icon_from`).
   */
  import Icon from '../../components/Icon.svelte';
  import MarkerSymbol from './MarkerSymbol.svelte';
  import LayerStylePalette from './LayerStylePalette.svelte';
  import { ICON_HELP, LAYER_HELP, STATUS_CHOICES } from '../../lib/map/layerHelp.js';
  import { iconLibrary } from '../../lib/iconLibrary.svelte.js';

  let {
    /** The case's layers, the one used last first, and the `layer|group` keys the item is already in. */
    targets = [], held = new Set(), busy = false, caseId = null, point = true, initial = null, ownIcon = null,
    step = $bindable(null),
    onadd, oncreate,
  } = $props();
  let creating = $state(false);
  let title = $state('');
  let style = $state({ symbol: 'pin', colour: '#0072b2' });
  /** What the item shows, as the marker will say it: '' intact, or damaged, or destroyed. */
  let status = $state('');
  /** A layer just made for the item, opened as soon as the list holds it. */
  let made = $state('');
  const layer = $derived(step ? targets.find((one) => one.name === step.layer) ?? null : null);
  const group = $derived(layer && step?.group ? layer.groups.find((one) => one.id === step.group) ?? null : null);
  const inGroup = (one, part) => held.has(`${one.name}|${part?.id ?? ''}`);
  const wearsOwn = $derived(!!ownIcon && style.icon === ownIcon.key && !!style.icon_from);
  /** What the marker will wear: its own icon, one picked, or none. */
  const shown = $derived(wearsOwn ? ownIcon
    : style.icon && layer ? iconLibrary.look(style.icon, { caseId, layer: layer.name, meta: layer.icons }) : null);
  const groupLook = (one, part) => (part.icon ? iconLibrary.look(part.icon, { caseId, layer: one.name, meta: one.icons }) : null);
  /** A pick in the palette replaces the point's own icon: what it holds is the library's or this layer's. */
  function pickStyle(changes) {
    const next = { ...style, ...changes };
    // a group in one colour paints its markers itself
    if (group?.mode === 'colour') next.colour = group.colour;
    if ('icon' in changes) delete next.icon_from;
    style = next;
  }
  const inLayer = (one) => one.groups.some((part) => inGroup(one, part));

  function chooseLayer(one) {
    if (one.groups.length > 1) step = { layer: one.name };
    else chooseGroup(one, one.groups[0]);
  }
  function chooseGroup(one, part) {
    if (!part || part.mode === 'uniform' || !point) { onadd({ layer: one, group: part ?? null, style: null, status }); return; }
    style = { symbol: initial?.symbol || part.symbol || 'pin',
      colour: (part.mode === 'colour' ? part.colour : initial?.colour || part.colour) || '#0072b2',
      ...(ownIcon ? { icon: ownIcon.key, icon_from: ownIcon.from } : {}) };
    step = { layer: one.name, group: part.id };
  }
  function back() { step = step?.group && layer?.groups.length > 1 ? { layer: step.layer } : null; }
  async function create(event) {
    event.preventDefault();
    const name = title.trim();
    if (!name) return;
    const created = await oncreate(name);
    creating = false; title = '';
    if (created) made = created;
  }
  $effect(() => {
    if (!made) return;
    const found = targets.find((one) => one.name === made);
    if (found) { made = ''; chooseLayer(found); }
  });
</script>

{#snippet state()}
  <div class="state" role="group" aria-label="What it shows" title={LAYER_HELP.status}>
    {#each STATUS_CHOICES as [value, label, said] (value)}
      <button type="button" class:short={!value} aria-pressed={status === value} aria-label={value ? label : said} title={said}
        onclick={() => (status = value)}>{label}</button>
    {/each}
  </div>
{/snippet}

{#if layer && group}
  <button type="button" class="step-back" aria-label="Back" onclick={back}>
    <Icon name="chevronLeft" size={13} /><span>{layer.title}{layer.groups.length > 1 ? ` › ${group.name}` : ''}</span></button>
  {@render state()}
  {#if ownIcon}
    <button type="button" class="fm-item own" aria-pressed={wearsOwn} title={ICON_HELP.itsOwnHint}
      onclick={() => (style = { ...style, icon: ownIcon.key, icon_from: ownIcon.from })}>
      <MarkerSymbol colour={style.colour} icon={ownIcon} {status} size={20} />
      <span class="fm-grow">{ICON_HELP.itsOwn}</span>
      {#if wearsOwn}<span class="fm-tick"><Icon name="check" size={13} /></span>{/if}
    </button>
  {/if}
  <LayerStylePalette label="Point icon" symbol={style.symbol} colour={style.colour} icon={wearsOwn ? '' : style.icon ?? ''}
    used={layer.styles ?? []} {caseId} layer={layer.name} meta={layer.icons ?? null} colours={group.mode !== 'colour'} onpick={pickStyle} />
  <div class="add-row">
    <button type="button" class="btn btn-primary btn-sm" disabled={busy}
      onclick={() => onadd({ layer, group, style: { ...style }, status })}>
      <MarkerSymbol symbol={style.symbol} colour={style.colour} icon={shown} {status} size={18} /> Add to {layer.groups.length > 1 ? group.name : layer.title}</button>
  </div>
{:else if layer}
  <button type="button" class="step-back" aria-label="Back" onclick={back}>
    <Icon name="chevronLeft" size={13} /><span>{layer.title}</span></button>
  {@render state()}
  {#each layer.groups as part (part.id)}
    {@const inside = inGroup(layer, part)}
    <button type="button" class="fm-item" disabled={busy || inside} title={inside ? `Already in ${part.name}` : `Add to ${part.name}`}
      onclick={() => chooseGroup(layer, part)}>
      {#if part.mode === 'uniform'}<MarkerSymbol symbol={part.symbol} colour={part.colour} icon={groupLook(layer, part)} size={16} />
      {:else}<span class="dot" style={`--swatch:${part.colour ?? '#0072b2'}`}></span>{/if}
      <span class="fm-grow">{part.name}</span>
      {#if inside}<span class="fm-tick"><Icon name="check" size={13} /></span>
      {:else if part.mode !== 'uniform' && point}<Icon name="chevronRight" size={12} />{/if}
    </button>
  {/each}
{:else}
  {@render state()}
  <div class="targets">
    {#each targets as one (one.name)}
      {@const inside = inLayer(one)}
      {@const direct = one.groups.length === 1 && (one.groups[0]?.mode === 'uniform' || !point)}
      <button type="button" class="fm-item" disabled={busy || (one.groups.length === 1 && inside)}
        title={inside ? `Already in ${one.title}` : `Add to ${one.title}`} onclick={() => chooseLayer(one)}>
        <Icon name="stack" size={14} />
        <span class="fm-grow">{one.title}</span>
        {#if inside}<span class="fm-tick"><Icon name="check" size={13} /></span>{/if}
        {#if !direct && !(one.groups.length === 1 && inside)}<Icon name="chevronRight" size={12} />{/if}
      </button>
    {/each}
  </div>
  {#if creating}
    <form class="create" onsubmit={create}>
      <!-- svelte-ignore a11y_autofocus -->
      <input class="input" aria-label="New layer name" bind:value={title} placeholder="Layer name" maxlength="200" autofocus />
      <button type="submit" class="btn btn-primary btn-sm" disabled={busy || !title.trim()}>Create</button>
    </form>
  {:else}
    <button type="button" class="fm-item" disabled={busy} onclick={() => (creating = true)}>
      <Icon name="plus" size={14} /><span class="fm-grow">New layer…</span></button>
  {/if}
{/if}

<style>
  .targets { max-height: 220px; overflow-y: auto; }
  .state { display: flex; margin: 2px 4px 6px; border: 1px solid var(--border); border-radius: var(--r-sm); overflow: hidden; background: var(--bg-1); }
  .state button { flex: 1; min-width: 0; padding: 4px 3px; color: var(--text-2); font-size: 11px; cursor: pointer; }
  .state button + button { border-left: 1px solid var(--border); }
  .state button.short { flex: 0 0 26px; }
  .state button:hover { background: var(--bg-3); }
  .state button[aria-pressed='true'] { background: var(--accent-soft); color: var(--text-1); font-weight: 600; }
  .dot { width: 12px; height: 12px; margin: 0 2px; border-radius: 3px; background: var(--swatch); flex: none; }
  /* where the menu stands stays in sight while a long list of icons scrolls under it */
  .step-back { position: sticky; top: -5px; z-index: 1; display: flex; align-items: center; gap: 6px; width: 100%; margin-bottom: 4px; padding: 5px 6px;
    border-bottom: 1px solid var(--border); background: var(--bg-1); color: var(--text-2); font-size: var(--fs-xs); font-weight: 600; text-align: left; cursor: pointer; }
  .step-back:hover { color: var(--text-1); }
  .step-back span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .add-row { position: sticky; bottom: -5px; margin: 4px -5px -5px; padding: 7px 8px; border-top: 1px solid var(--border); background: var(--bg-1); }
  .add-row .btn { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; }
  .create { display: flex; gap: 6px; padding: 4px 6px; }
  .create .input { flex: 1; min-width: 0; height: 28px; font-size: var(--fs-xs); }
</style>
