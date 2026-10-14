<script>
  /**
   * What one point of a proof can do besides being moved on the map: join one
   * of the analyst's layers, become the conclusion, or go.
   *
   * Joining a layer goes a step at a time, in the one menu: the layer, then its
   * group when it has several, then, for a group whose features each have their
   * own style, the icon and colour of this marker. A group with one style takes
   * the point at once. A proof with unsaved changes is saved first, since the
   * marker follows the proof as saved; a point the imagery only proposed is
   * checked on the map first.
   */
  import Icon from '../../components/Icon.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import MarkerSymbol from '../satellite/MarkerSymbol.svelte';
  import LayerStylePalette from '../satellite/LayerStylePalette.svelte';

  let {
    index, coords = '', proposed = false, canSave = true, unsaved = false, busy = false, caseId = null,
    /** The case's layers, the one used last first, and the `layer|group` keys this point is already in. */
    targets = [], held = new Set(),
    onadd, oncreate, oncheck, onraise = null, onremove = null,
  } = $props();
  let open = $state(false);
  let anchor = $state(null);
  let creating = $state(false);
  let title = $state('');
  /** Where the menu stands: the layers (null), a layer's groups, or a group's icon. */
  let step = $state(null);
  let style = $state({ symbol: 'pin', colour: '#0072b2' });
  /** A layer just made for this point, opened as soon as the list holds it. */
  let made = $state('');
  const label = $derived(`Point ${index + 1} actions`);
  const layer = $derived(step ? targets.find((one) => one.name === step.layer) ?? null : null);
  const group = $derived(layer && step?.group ? layer.groups.find((one) => one.id === step.group) ?? null : null);
  const inGroup = (one, part) => held.has(`${one.name}|${part?.id ?? ''}`);
  const inLayer = (one) => one.groups.some((part) => inGroup(one, part));

  function close() { open = false; creating = false; title = ''; step = null; made = ''; }
  /** Close, then run: what `run` needs is read before, since closing resets the step. */
  function act(run) { close(); run(); }
  function chooseLayer(one) {
    if (one.groups.length > 1) step = { layer: one.name };
    else chooseGroup(one, one.groups[0]);
  }
  function chooseGroup(one, part) {
    if (!part || part.mode === 'uniform') { act(() => onadd({ layer: one, group: part ?? null, style: null })); return; }
    style = { symbol: part.symbol || 'pin', colour: part.colour || '#0072b2' };
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

<button type="button" class="point-more" aria-label={label} title="More" aria-expanded={open} bind:this={anchor}
  onclick={() => (open ? close() : (open = true))}><Icon name="more" size={14} /></button>

{#if open}
  <FloatingMenu {anchor} align="end" width={step?.group ? 264 : 248} {label} onclose={close}>
    {#if layer && group}
      <button type="button" class="step-back" aria-label="Back" onclick={back}>
        <Icon name="chevronLeft" size={13} /><span>{layer.title}{layer.groups.length > 1 ? ` › ${group.name}` : ''}</span></button>
      <LayerStylePalette label="Point icon" symbol={style.symbol} colour={style.colour} used={layer.styles ?? []} {caseId}
        onpick={(changes) => (style = { ...style, ...changes })} />
      <div class="add-row">
        <button type="button" class="btn btn-primary btn-sm" disabled={busy}
          onclick={() => { const chosen = { layer, group, style: { ...style } }; act(() => onadd(chosen)); }}>
          <MarkerSymbol symbol={style.symbol} colour={style.colour} size={18} /> Add to {layer.groups.length > 1 ? group.name : layer.title}</button>
      </div>
    {:else if layer}
      <button type="button" class="step-back" aria-label="Back" onclick={back}>
        <Icon name="chevronLeft" size={13} /><span>{layer.title}</span></button>
      {#each layer.groups as part (part.id)}
        {@const inside = inGroup(layer, part)}
        <button type="button" class="fm-item" disabled={busy || inside} title={inside ? `Already in ${part.name}` : `Add to ${part.name}`}
          onclick={() => chooseGroup(layer, part)}>
          {#if part.mode === 'uniform'}<MarkerSymbol symbol={part.symbol} colour={part.colour} size={16} />
          {:else}<span class="dot" style={`--swatch:${part.colour ?? '#0072b2'}`}></span>{/if}
          <span class="fm-grow">{part.name}</span>
          {#if inside}<span class="fm-tick"><Icon name="check" size={13} /></span>
          {:else if part.mode !== 'uniform'}<Icon name="chevronRight" size={12} />{/if}
        </button>
      {/each}
    {:else}
      <p class="fm-head">Add to a layer</p>
      {#if !coords.trim()}
        <p class="fm-note">Write the point first.</p>
      {:else if proposed}
        <button type="button" class="fm-item" onclick={() => act(oncheck)}>
          <Icon name="crosshair" size={14} /><span class="fm-grow">Check this point on the map first</span></button>
      {:else if !canSave}
        <p class="fm-note">Add a picture first. The proof is saved before its point joins a layer.</p>
      {:else}
        <div class="targets">
          {#each targets as one (one.name)}
            {@const inside = inLayer(one)}
            {@const direct = one.groups.length === 1 && one.groups[0]?.mode === 'uniform'}
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
        {#if unsaved}<p class="fm-note">The proof is saved first, so the layer follows what it says.</p>{/if}
      {/if}
      {#if onraise || onremove}<div class="fm-sep"></div>{/if}
      {#if onraise}
        <button type="button" class="fm-item" onclick={() => act(onraise)}>
          <Icon name="chevronUp" size={14} /><span class="fm-grow">Make it the conclusion</span></button>
      {/if}
      {#if onremove}
        <button type="button" class="fm-item danger" onclick={() => act(onremove)}>
          <Icon name="x" size={14} /><span class="fm-grow">Remove this point</span></button>
      {/if}
    {/if}
  </FloatingMenu>
{/if}

<style>
  .point-more { display: grid; place-items: center; flex: none; width: 24px; height: 28px; border-radius: var(--r-sm); color: var(--text-3); cursor: pointer; }
  .point-more:hover, .point-more[aria-expanded='true'] { background: var(--bg-3); color: var(--text-1); }
  .targets { max-height: 220px; overflow-y: auto; }
  .dot { width: 12px; height: 12px; margin: 0 2px; border-radius: 3px; background: var(--swatch); flex: none; }
  .step-back { display: flex; align-items: center; gap: 6px; width: 100%; margin-bottom: 4px; padding: 5px 6px; border-bottom: 1px solid var(--border);
    color: var(--text-2); font-size: var(--fs-xs); font-weight: 600; text-align: left; cursor: pointer; }
  .step-back:hover { color: var(--text-1); }
  .step-back span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .add-row { position: sticky; bottom: -5px; margin: 4px -5px -5px; padding: 7px 8px; border-top: 1px solid var(--border); background: var(--bg-1); }
  .add-row .btn { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; }
  .create { display: flex; gap: 6px; padding: 4px 6px; }
  .create .input { flex: 1; min-width: 0; height: 28px; font-size: var(--fs-xs); }
</style>
