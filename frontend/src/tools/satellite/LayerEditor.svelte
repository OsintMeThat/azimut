<script>
  /**
   * What a personal layer holds, beside the map that edits it.
   *
   * The map's bar does everything done to features (`LayerEditBar`); this
   * panel says what each one is, in the sheet of the selection
   * (`LayerFeatureSheet`), and keeps the groups in their order. Everything
   * saves as it is set; Discard, in the layer's menu, takes the whole session
   * back.
   */
  import Icon from '../../components/Icon.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import LayerFeatureSheet from './LayerFeatureSheet.svelte';
  import LayerGroupMenu from './LayerGroupMenu.svelte';
  import MarkerSymbol from './MarkerSymbol.svelte';
  import { tick } from 'svelte';
  import ConfirmDialog from '../../components/ConfirmDialog.svelte';
  import { moveName } from '../../lib/map/addedLayers.js';
  import { api } from '../../lib/api.js';
  import { caseState, toast } from '../../lib/state.svelte.js';
  import { openEntity } from '../../lib/navigate.js';
  import { layerPalette } from '../../lib/map/layerPalette.svelte.js';

  let { controller, ondone, onfly, ondeleteplace } = $props();
  $effect(() => layerPalette.load(controller.editor?.caseId));
  const selected = $derived(controller.selected);
  const groups = $derived(controller.groups ?? []);
  let folded = $state(new Set());
  let groupMenu = $state(null);
  let layerMenu = $state(false);
  let layerMenuAnchor = $state(null);
  let describing = $state(false);
  let newGroup = $state(false);
  let groupName = $state('');
  let query = $state('');
  let root = $state(null);
  let discard = $state(false);
  let dragged = $state('');
  let draggedFeatures = $state([]);
  let featureDrop = $state(null);
  let layerDetails = $state({ title: '', description: '' });
  let gap = $state(-1);
  let groupList = $state(null);
  let limits = $state({});
  const selection = $derived(controller.selection ?? []);
  const busy = $derived(controller.loading || controller.pending > 0);
  // The new-group field goes away on a press outside it.
  $effect(() => {
    if (!newGroup) return;
    const outside = (event) => { if (!(event.target instanceof Element) || !event.target.closest('.new-group, [data-new-group-trigger]')) newGroup = false; };
    window.addEventListener('click', outside, true);
    return () => window.removeEventListener('click', outside, true);
  });
  const needle = $derived(query.trim().toLowerCase());
  const matches = (feature) => !needle || `${feature.properties.name ?? ''} ${feature.properties.entity_label ?? ''}`.toLowerCase().includes(needle);
  const membersByGroup = $derived.by(() => {
    const result = new Map();
    for (const feature of controller.features) {
      if (!matches(feature)) continue;
      const id = feature.properties.group;
      if (!result.has(id)) result.set(id, []);
      result.get(id).push(feature);
    }
    return result;
  });
  const found = $derived(needle ? [...membersByGroup.values()].reduce((sum, members) => sum + members.length, 0) : 0);
  let foldedFor = '';
  $effect(() => {
    const name = controller.editor.name;
    if (controller.loading || !name || name === foldedFor) return;
    foldedFor = name;
    folded = new Set(groups.length > 5 ? groups.slice(1).map((group) => group.id) : []);
  });

  $effect(() => {
    layerDetails = controller.details ?? { title: controller.editor.title ?? '', description: controller.editor.description ?? '' };
  });

  async function done() {
    if (await controller.done()) ondone?.();
  }
  /** The layer's name and description save when their field is left; an empty name goes back. */
  async function saveDetails() {
    if (!layerDetails.title.trim()) { layerDetails.title = controller.editor.title ?? ''; return; }
    if (controller.detailsChanged) await controller.saveDetails();
  }
  async function download() {
    layerMenu = false;
    if (controller.formChanged && !(await controller.saveForm())) return;
    if (controller.detailsChanged && !(await controller.saveDetails())) return;
    controller.download(controller.editor);
  }
  async function discardChanges() {
    if (await controller.finish(true)) { discard = false; ondone?.(); }
  }
  /** The case item a marker follows, opened where it is worked on. */
  async function openFollowed(id) {
    const owner = caseState.current?.id;
    try {
      const chain = await api.get(`/api/cases/${owner}/entities/${id}/chain`);
      if (caseState.current?.id === owner) openEntity(chain.entity, true);
    } catch (error) { toast(error.message, 'danger'); }
  }
  function dragOver(event) {
    if (draggedFeatures.length) {
      const target = event.target instanceof Element ? event.target.closest('[data-feature-group]') : null;
      if (!target || !groupList?.contains(target)) { featureDrop = null; return; }
      const id = target.dataset.featureGroup;
      const list = target.querySelector('.features');
      const moving = new Set(draggedFeatures);
      let before = null;
      if (list?.contains(event.target)) {
        const box = list.getBoundingClientRect();
        if (event.clientY < box.top + 20) list.scrollTop -= 12;
        else if (event.clientY > box.bottom - 20) list.scrollTop += 12;
        const nodes = [...list.children].filter((node) => !moving.has(node.dataset.featureKey));
        const next = nodes.find((node) => { const rect = node.getBoundingClientRect(); return event.clientY < rect.top + rect.height / 2; });
        if (next) before = next.dataset.featureKey;
        else if (nodes.length) {
          const order = (membersByGroup.get(id) ?? []).toReversed().filter((feature) => !moving.has(feature.properties.key));
          const last = order.findIndex((feature) => feature.properties.key === nodes.at(-1).dataset.featureKey);
          before = order[last + 1]?.properties.key ?? null;
        }
      }
      featureDrop = { group: id, before };
      event.preventDefault(); event.dataTransfer.dropEffect = 'move';
      return;
    }
    if (!dragged) return;
    const box = groupList?.getBoundingClientRect();
    if (!box || event.clientX < box.left - 32 || event.clientX > box.right + 32
      || event.clientY < box.top - 16 || event.clientY > box.bottom + 16) { gap = -1; return; }
    const nodes = [...groupList.children];
    gap = nodes.findIndex((node) => { const rect = node.getBoundingClientRect(); return event.clientY < rect.top + rect.height / 2; });
    if (gap < 0) gap = groups.length;
    event.preventDefault(); event.dataTransfer.dropEffect = 'move';
  }
  function drop(event) {
    if (draggedFeatures.length) {
      const target = event.target instanceof Element ? event.target.closest('[data-feature-group]') : null;
      if (featureDrop && target?.dataset.featureGroup === featureDrop.group && groupList?.contains(target)) {
        event.preventDefault();
        controller.reorderFeatures([...draggedFeatures], featureDrop.group, featureDrop.before);
      }
      draggedFeatures = []; featureDrop = null;
      return;
    }
    if (!dragged) return;
    event.preventDefault();
    if (gap >= 0) controller.reorderGroups(moveName(groups.map((group) => group.id), dragged, gap));
    dragged = ''; gap = -1;
  }
  function startFeatureDrag(event, feature) {
    const key = feature.properties.key;
    dragged = ''; gap = -1;
    draggedFeatures = selection.includes(key) ? [...selection] : [key];
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', draggedFeatures.join(','));
  }
  async function nudgeFeature(event, feature) {
    const step = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (!step) return;
    event.preventDefault();
    const key = feature.properties.key, id = feature.properties.group;
    const keys = selection.includes(key) ? [...selection] : [key];
    const moving = new Set(keys), order = (membersByGroup.get(id) ?? []).toReversed().map((feature) => feature.properties.key);
    const rest = order.filter((key) => !moving.has(key));
    const first = order.findIndex((key) => moving.has(key));
    const last = order.findLastIndex((key) => moving.has(key));
    const neighbour = step < 0 ? order[first - 1] : order[last + 1];
    if (!neighbour) return;
    const before = step < 0 ? neighbour : rest[rest.indexOf(neighbour) + 1] ?? null;
    await controller.reorderFeatures(keys, id, before);
    await tick(); root?.querySelector(`[data-feature-grip="${CSS.escape(key)}"]`)?.focus();
  }
  async function nudge(event, group, index) {
    const step = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (!step || index + step < 0 || index + step >= groups.length) return;
    event.preventDefault();
    await controller.reorderGroups(moveName(groups.map((group) => group.id), group.id, step > 0 ? index + 2 : index - 1));
    await tick(); root?.querySelector(`[data-group-grip="${CSS.escape(group.id)}"]`)?.focus();
  }

  function fold(id) {
    const next = new Set(folded);
    if (next.has(id)) next.delete(id); else next.add(id);
    folded = next;
  }

  async function createGroup() {
    if (!groupName.trim()) return;
    const answer = await controller.addGroup(groupName.trim());
    if (answer) { newGroup = false; groupName = ''; }
  }
</script>

<svelte:window ondragover={dragOver} ondrop={drop} />

<section class="editor" aria-label="Layer editor" bind:this={root}>
  <header class="editor-head">
    <Icon name="stack" size={13} />
    <input class="title" aria-label="Layer name" title="Rename the layer" bind:value={layerDetails.title} maxlength="200"
      disabled={controller.loading} onchange={saveDetails} onkeydown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
    <button type="button" class="icon-act" aria-label="Layer actions" title="More" aria-expanded={layerMenu}
      bind:this={layerMenuAnchor} disabled={controller.loading} onclick={() => (layerMenu = !layerMenu)}><Icon name="more" size={14} /></button>
    <!-- The press keeps the focus where it is: leaving a field would save it, and
         the saving would disable Done before the click lands. Done saves it anyway. -->
    <button class="btn btn-primary btn-sm done" disabled={busy || !layerDetails.title.trim() || (controller.sketch && !controller.complete)}
      onmousedown={(event) => event.preventDefault()} onclick={done}><Icon name="check" size={12} /> Done</button>
  </header>
  {#if describing || controller.editor.description || layerDetails.description}
    <!-- svelte-ignore a11y_autofocus -->
    <textarea class="description" aria-label="Layer description" placeholder="What this layer shows" bind:value={layerDetails.description}
      maxlength="4000" rows="2" autofocus={describing} disabled={controller.loading}
      onchange={saveDetails} onblur={() => (describing = false)}></textarea>
  {/if}
  {#if controller.editor.origin}
    <p class="note">Copy of {controller.editor.origin.source.name || controller.editor.origin.source.url}</p>
  {/if}
  {#if controller.loading}
    <p class="note">Opening layer…</p>
  {:else}
    {#if controller.pending}<p class="saving" role="status">Saving {controller.pending}…</p>{/if}
    <LayerFeatureSheet {controller} onfollowed={openFollowed} {ondeleteplace} />

    <input type="search" class="find" aria-label="Find in this layer" placeholder="Find in this layer" bind:value={query} />
    {#if needle}<p class="note">{found ? `${found} found` : 'Nothing by that name.'}</p>{/if}
    <div class="groups" bind:this={groupList}>
      {#each groups as group, index (group.id)}
        {@const members = membersByGroup.get(group.id) ?? []}
        {@const hidden = controller.editor.hidden?.includes(group.name)}
        {@const open = needle ? members.length > 0 : !folded.has(group.id)}
        {#if !needle || members.length}
        <div class="group" data-feature-group={group.id} class:active-group={controller.group === group.id}
          class:feature-target={featureDrop?.group === group.id} class:drop-before={gap === index} class:drop-after={gap === groups.length && index === groups.length - 1}>
          <!-- The whole row drags; the grip says so, and moves it from the keyboard. -->
          <div class="group-head" role="group" aria-label={`Group ${group.name}`} draggable="true"
            ondragstart={(event) => { draggedFeatures = []; featureDrop = null; dragged = group.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', group.name); }}
            ondragend={() => { dragged = ''; gap = -1; }}>
            <button class="icon-act grip" aria-label={`Move group ${group.name}`} title="Drag to reorder" data-group-grip={group.id}
              onkeydown={(event) => nudge(event, group, index)}><Icon name="grip" size={14} stroke={2.5} /></button>
            <button class="icon-act eye" class:on={!hidden} aria-label={`Show group ${group.name}`}
              aria-pressed={!hidden} title={hidden ? 'Show this group' : 'Hide this group'}
              onclick={() => controller.toggleGroup(group)}><Icon name={hidden ? 'eyeOff' : 'eye'} size={13} /></button>
            <button class="group-title" aria-expanded={open} onclick={() => { controller.group = group.id; fold(group.id); }}>
              <Icon name={open ? 'chevronDown' : 'chevronRight'} size={11} />
              {#if group.mode === 'uniform'}<MarkerSymbol symbol={group.symbol} colour={group.colour} size={15} />
              {:else}<span class="group-dot" style={`--swatch:${group.colour}`}></span>{/if}
              <span class="name">{group.name}</span><span class="count">{members.length}</span>
            </button>
            <button class="icon-act more" aria-label={`Settings of group ${group.name}`} title="Group settings" aria-expanded={groupMenu?.id === group.id}
              onclick={(event) => { controller.group = group.id; groupMenu = groupMenu?.id === group.id ? null : { id: group.id, anchor: event.currentTarget }; }}>
              <Icon name="more" size={14} />
            </button>
          </div>
          {#if groupMenu?.id === group.id}
            <LayerGroupMenu {controller} {group} anchor={groupMenu?.anchor ?? null} members={members.length} onclose={() => (groupMenu = null)} />
          {/if}
          {#if open}
            <ul class="features" class:drop-end={featureDrop?.group === group.id && !featureDrop.before}>
              {#each members.slice(-(limits[group.id] ?? 100)).toReversed() as feature (feature.properties.key)}
                {@const paint = group.mode === 'uniform' ? group.colour : feature.properties.colour || group.colour}
                <li data-feature-key={feature.properties.key} draggable={controller.pending > 0 || !!controller.sketch ? 'false' : 'true'}
                  class:dragging={draggedFeatures.includes(feature.properties.key)}
                  class:drop-before={featureDrop?.group === group.id && featureDrop.before === feature.properties.key}
                  ondragstart={(event) => startFeatureDrag(event, feature)} ondragend={() => { draggedFeatures = []; featureDrop = null; }}>
                <button class="icon-act grip" data-feature-grip={feature.properties.key}
                  aria-label={`Move ${feature.properties.name || 'Unnamed feature'}`} title="Drag to reorder or move to a group"
                  disabled={controller.pending > 0 || !!controller.sketch} onkeydown={(event) => nudgeFeature(event, feature)}>
                  <Icon name="grip" size={14} stroke={2.5} /></button>
                <button class="feature-row" aria-pressed={selection.includes(feature.properties.key)}
                  class:active={selection.includes(feature.properties.key) || selected?.properties.key === feature.properties.key}
                  onclick={async (event) => { if (event.shiftKey || event.ctrlKey || event.metaKey) controller.toggleSelected(feature.properties.key, members.toReversed().map((feature) => feature.properties.key), event.shiftKey);
                    else { controller.select(feature.properties.key); onfly?.(feature); } await tick(); root?.querySelector('.sheet')?.scrollIntoView?.({ block: 'nearest' }); }}>
                  <span class="feature-symbol" style={`color:${paint}`}>
                    {#if feature.geometry.type === 'Point'}
                      <MarkerSymbol symbol={(group.mode === 'uniform' ? group.symbol : feature.properties.symbol) || 'pin'} colour={paint}
                        status={feature.properties.status ?? ''} external={feature.properties.provenance === 'external'} size={15} />
                    {:else}<Icon name={String(feature.geometry.type).includes('Line') ? 'line' : 'polygon'} size={12} />{/if}
                  </span>
                  <span class="name">{feature.properties.name || 'Unnamed feature'}</span>
                  {#if feature.properties.date}<span class="day">{feature.properties.date}</span>{/if}
                  {#if feature.properties.entity_id}<Icon name="link" size={10} />{/if}
                </button></li>
              {/each}
            </ul>
            {#if !members.length}<p class="group-empty">Empty group</p>{/if}
            {#if members.length > (limits[group.id] ?? 100)}
              <button class="add" onclick={() => { limits[group.id] = Math.min(members.length, (limits[group.id] ?? 100) + 100); }}>Show 100 more ({members.length})</button>
              <button class="text-act" onclick={() => { limits[group.id] = members.length; }}>Show all {members.length}</button>
            {/if}
          {/if}
        </div>
        {/if}
      {/each}
    </div>
    {#if newGroup}
      <form class="new-group" onsubmit={(event) => { event.preventDefault(); createGroup(); }}>
        <!-- svelte-ignore a11y_autofocus -->
        <input aria-label="New group name" bind:value={groupName} placeholder="Group name" maxlength="200" autofocus />
        <button class="icon-act" aria-label="Create group" title="Create group" disabled={!groupName.trim() || controller.pending > 0}><Icon name="check" size={13} /></button>
        <button type="button" class="icon-act" aria-label="Cancel new group" title="Cancel" onclick={() => (newGroup = false)}><Icon name="x" size={12} /></button>
      </form>
    {:else}
      <button class="add" data-new-group-trigger onclick={() => (newGroup = true)}><Icon name="plus" size={12} /> New group</button>
    {/if}
    <p class="tally">{controller.features.length} {controller.features.length === 1 ? 'feature' : 'features'}</p>
  {/if}
</section>

{#if layerMenu}
  <FloatingMenu anchor={layerMenuAnchor} align="end" width={220} label="Layer actions" onclose={() => (layerMenu = false)}>
    <button type="button" class="fm-item" onclick={() => { layerMenu = false; describing = true; }}>
      <Icon name="note" size={14} /><span class="fm-grow">{controller.editor.description ? 'Edit the description' : 'Add a description'}</span></button>
    <button type="button" class="fm-item" disabled={busy || !!controller.sketch} onclick={download}>
      <Icon name="download" size={14} /><span class="fm-grow">Download layer</span></button>
    <div class="fm-sep"></div>
    <button type="button" class="fm-item danger" disabled={busy || !controller.changed} onclick={() => { layerMenu = false; discard = true; }}>
      <Icon name="undo" size={14} /><span class="fm-grow">Discard changes…</span></button>
  </FloatingMenu>
{/if}

{#if discard}
  <ConfirmDialog title="Discard changes?" message="Return this layer to how it was when editing started?"
    detail="Case places saved separately stay in the case."
    confirmLabel="Discard changes" tone="danger" icon="undo" busy={controller.pending > 0} onconfirm={discardChanges} oncancel={() => (discard = false)} />
{/if}

<style>
  .editor { padding: 8px 8px 0; font-size: var(--fs-xs); }
  .editor-head, .new-group { display: flex; align-items: center; gap: 4px; }
  .editor-head { position: sticky; top: 0; z-index: 8; margin: -8px -8px 0; padding: 8px 8px 6px; background: var(--bg-1); }
  .editor-head > :global(svg) { flex: none; color: var(--text-3); }
  .title { flex: 1; min-width: 0; height: 28px; padding: 3px 6px; border: 1px solid transparent; border-radius: var(--r-sm); background: transparent;
    color: var(--text-1); font-size: var(--fs-sm); font-weight: 600; }
  .title:hover { border-color: var(--border); }
  .title:focus { border-color: var(--accent); background: var(--bg-2); }
  .done { flex: none; min-height: 27px; gap: 4px; }
  .description { width: 100%; margin: 2px 0 0; padding: 4px 6px; border: 1px solid transparent; border-radius: var(--r-sm); background: transparent;
    color: var(--text-2); font-size: var(--fs-xs); line-height: 1.4; resize: vertical; }
  .description:hover { border-color: var(--border); }
  .description:focus { border-color: var(--accent); background: var(--bg-2); color: var(--text-1); }
  .group.drop-before { border-top: 2px solid var(--accent); }
  .group.drop-after { border-bottom: 2px solid var(--accent); }
  .group.feature-target > .group-head { background: var(--accent-soft); }
  .features li.drop-before { box-shadow: inset 0 2px var(--accent); }
  .features li.dragging { opacity: .5; }
  .features.drop-end { box-shadow: inset 0 -2px var(--accent); }
  .find, .new-group input { width: 100%; min-width: 0; height: 27px; padding: 4px 6px; font-size: var(--fs-xs); border-radius: var(--radius-1); }
  .note, .tally, .saving, .group-empty { margin: 6px 0; color: var(--text-3); font-size: 10px; line-height: 1.4; }
  .note { overflow-wrap: anywhere; }
  .saving { color: var(--accent); }
  .find { margin-top: 10px; }
  .text-act { display: inline-flex; align-items: center; gap: 4px; color: var(--text-3); font-size: 10px; padding: 3px 0; cursor: pointer; text-align: left; }
  .text-act:hover { color: var(--text-1); }
  .icon-act { display: grid; place-items: center; flex: none; width: 24px; height: 24px; color: var(--text-3); border-radius: var(--radius-1); cursor: pointer; }
  .icon-act:hover:not(:disabled) { background: var(--bg-3); color: var(--text-1); }
  .eye.on { color: var(--accent); }
  /* The grips show on the row the pointer or the keyboard is on: the row is what drags. */
  .grip { width: 16px; color: var(--text-3); cursor: grab; opacity: 0; }
  .group-head:hover .grip, .features li:hover .grip, .grip:focus-visible { opacity: 1; }
  .group-head[draggable='true'], .features li[draggable='true'] { cursor: grab; }
  .groups { margin-top: 8px; }
  .group { margin-bottom: 2px; }
  .group-head { display: flex; align-items: center; gap: 1px; min-height: 30px; padding-right: 2px; border-radius: var(--r-sm); }
  .group-head:hover { background: var(--bg-2); }
  .group-head .more { opacity: .6; }
  .group-head:hover .more, .group-head .more[aria-expanded='true'] { opacity: 1; }
  .group-title { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; padding: 4px 2px; text-align: left; color: var(--text-2); font-size: var(--fs-xs); font-weight: 600; cursor: pointer; }
  .active-group .group-title { color: var(--text-1); }
  .group-dot { width: 10px; height: 10px; background: var(--swatch); border-radius: 3px; flex: none; }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .count, .day { font-size: 10px; font-weight: 400; color: var(--text-3); }
  ul { list-style: none; margin: 0; padding: 0; }
  .features .feature-row { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; min-height: 26px; padding: 3px 6px; border-radius: var(--r-sm); text-align: left; color: var(--text-2); font-size: var(--fs-xs); cursor: pointer; }
  .features .feature-row:hover, .features .feature-row.active { background: var(--bg-3); color: var(--text-1); }
  .features .feature-row.active { box-shadow: inset 2px 0 var(--accent); }
  .features { max-height: min(340px, 45vh); overflow-y: auto; }
  .features li { display: flex; align-items: center; padding-left: 10px; }
  .feature-symbol { display: grid; place-items: center; flex: none; }
  .group-empty { padding-left: 34px; }
  .add { display: flex; align-items: center; gap: 6px; width: 100%; margin-top: 6px; padding: 5px 8px; border: 1px dashed var(--border); border-radius: var(--radius-1); color: var(--text-3); font-size: var(--fs-xs); cursor: pointer; }
  .add:hover { border-color: var(--text-3); color: var(--text-1); }
  .new-group { padding: 3px 0; }
</style>
