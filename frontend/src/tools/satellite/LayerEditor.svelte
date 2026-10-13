<script>
  import Icon from '../../components/Icon.svelte';
  import LayerIconPicker from './LayerIconPicker.svelte';
  import symbols from '../../lib/map/layerSymbols.json';
  import { tick } from 'svelte';
  import ConfirmDialog from '../../components/ConfirmDialog.svelte';
  import { moveName } from '../../lib/map/addedLayers.js';

  let { controller, places = [], onstart, ondone, onfly, ondeleteplace } = $props();
  const COLOURS = [['#0072b2', 'Blue'], ['#d55e00', 'Orange'], ['#009e73', 'Green'], ['#cc79a7', 'Purple'], ['#f0e442', 'Yellow']];
  const selected = $derived(controller.selected);
  const groups = $derived(controller.groups ?? []);
  const activeGroup = $derived(groups.find((group) => group.id === controller.group));
  let changes = $state({ name: '', description: '', colour: '#0072b2', symbol: 'pin', group: '' });
  const selectedGroup = $derived(groups.find((group) => group.id === changes.group));
  let folded = $state(new Set());
  let editingGroup = $state('');
  let newGroup = $state(false);
  let groupName = $state('');
  let picking = $state(false);
  let query = $state('');
  let checked = $state([]);
  let root = $state(null);
  let discard = $state(false);
  let dragged = $state('');
  let draggedFeatures = $state([]);
  let featureDrop = $state(null);
  let editingDetails = $state(false);
  let layerDetails = $state({ title: '', description: '' });
  let gap = $state(-1);
  let groupList = $state(null);
  let sizes = $state({});
  let strokes = $state({});
  let limits = $state({});
  let bulkStyle = $state({ colour: '#0072b2', symbol: 'pin' });
  const selection = $derived(controller.selection ?? []);
  const symbolIcons = new Map(symbols.map((symbol) => [symbol.id, symbol.icon]));
  function dismissMenus(event) {
    const target = event.target;
    const inside = target instanceof Element && root?.contains(target);
    if (editingGroup && (!inside || target.closest('.group-controls')?.dataset.groupId !== editingGroup
      || !target.closest('.group-settings, [data-group-menu-trigger]'))) editingGroup = '';
    if (picking && (!inside || !target.closest('.place-picker, [data-place-picker-trigger], .destination-field'))) picking = false;
    if (newGroup && (!inside || !target.closest('.new-group, [data-new-group-trigger]'))) newGroup = false;
    if (editingDetails && (!inside || !target.closest('.layer-details, [data-layer-details-trigger]'))) editingDetails = false;
  }
  $effect(() => {
    if (!editingGroup && !picking && !newGroup && !editingDetails) return;
    window.addEventListener('click', dismissMenus, true);
    return () => window.removeEventListener('click', dismissMenus, true);
  });
  const used = $derived(new Set(controller.features.map((feature) => feature.properties.place_id)));
  const available = $derived(places.filter((place) => !used.has(place.id)
    && (place.title ?? place.label ?? '').toLowerCase().includes(query.toLowerCase())));
  const membersByGroup = $derived.by(() => {
    const result = new Map();
    for (const feature of controller.features) {
      const id = feature.properties.group;
      if (!result.has(id)) result.set(id, []);
      result.get(id).push(feature);
    }
    return result;
  });
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
  const detailsChanged = $derived(layerDetails.title.trim() !== (controller.editor.title ?? '')
    || layerDetails.description.trim() !== (controller.editor.description ?? ''));
  async function saveDetails() {
    if (!detailsChanged) return;
    if (!layerDetails.title.trim()) return null;
    layerDetails.title = layerDetails.title.trim(); layerDetails.description = layerDetails.description.trim();
    const patch = Object.fromEntries(Object.entries(layerDetails).map(([key, value]) => [key, value.trim()])
      .filter(([key, value]) => value !== (controller.editor[key] ?? '')));
    return controller.updateDetails(patch);
  }

  $effect(() => {
    const props = selected?.properties;
    if (props) changes = controller.form ?? { name: props.name ?? '', description: props.description ?? '',
      colour: props.colour || '#0072b2', symbol: props.symbol || 'pin', group: props.group ?? '' };
  });

  function saveSelected() {
    const before = selected?.properties;
    if (!before) return;
    const initial = { ...before, colour: before.colour || '#0072b2', symbol: before.symbol || 'pin' };
    const patch = Object.fromEntries(Object.entries(changes).filter(([key, value]) =>
      value !== (initial[key] ?? '')));
    if (Object.keys(patch).length) return controller.update(before.key, patch);
  }

  const formChanged = $derived.by(() => {
    const props = selected?.properties;
    if (!props) return false;
    return Object.entries(changes).some(([key, value]) => value !==
      (key === 'colour' ? props.colour || '#0072b2' : key === 'symbol' ? props.symbol || 'pin' : props[key] ?? ''));
  });
  async function done() {
    if (controller.sketch && controller.complete && !(await controller.saveGeometry())) return;
    if (formChanged && await saveSelected() === null) return;
    if (detailsChanged && await saveDetails() === null) return;
    if (controller.finish) { if (await controller.finish()) ondone?.(); }
    else ondone?.();
  }
  async function back() {
    if (controller.changed || formChanged || detailsChanged) discard = true;
    else if (await controller.finish?.(false)) ondone?.();
    else if (!controller.finish) ondone?.();
  }
  async function discardChanges() {
    if (await controller.finish(true)) { discard = false; ondone?.(); }
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
    if (answer) { newGroup = false; groupName = ''; editingGroup = answer.group.id; }
  }

  async function addPlaces() {
    const answer = await controller.addPlaces(checked);
    if (answer) { picking = false; checked = []; query = ''; }
  }
</script>

<svelte:window ondragover={dragOver} ondrop={drop} />

{#snippet styleFields(value, prefix, point = true, onchange = null)}
  <div class="style-row">
    {#if point}
      <LayerIconPicker bind:value={value.symbol} colour={value.colour} label={prefix} {onchange} />
    {/if}
    <div class="palette" role="group" aria-label={`${prefix} palette`}>
      {#each COLOURS as [colour, label]}
        <button type="button" class="swatch" class:chosen={value.colour === colour}
          style={`--swatch:${colour}`} aria-label={`${prefix} ${label.toLowerCase()}`} title={label}
          aria-pressed={value.colour === colour}
          onclick={() => { value.colour = colour; onchange?.({ colour }); }}></button>
      {/each}
      <input type="color" aria-label={`${prefix} colour`} title="Custom colour" bind:value={value.colour}
        onchange={() => onchange?.({ colour: value.colour })} />
    </div>
  </div>
{/snippet}

<section class="editor" aria-label="Layer editor" bind:this={root}>
  <header class="editor-head">
    <Icon name="stack" size={13} />
    <button class="editor-title layer-title" aria-label="Edit layer details" title="Rename layer or add a description"
      data-layer-details-trigger aria-expanded={editingDetails} onclick={() => (editingDetails = !editingDetails)}>
      <span>{controller.editor.title}</span><Icon name="edit" size={11} />
    </button>
    <button class="icon-act" aria-label="Download this layer" title="Download layer" disabled={controller.pending > 0 || controller.loading || !!controller.sketch}
      onclick={async () => { if (formChanged && await saveSelected() === null) return; if (detailsChanged && await saveDetails() === null) return; controller.download(controller.editor); }}><Icon name="download" size={14} /></button>
    <button class="icon-act back" aria-label="Back from layer editor" title="Back" disabled={controller.pending > 0 || controller.loading} onclick={back}><Icon name="chevronLeft" size={14} /></button>
    <button class="btn btn-primary btn-sm done" disabled={controller.loading || controller.pending > 0 || !layerDetails.title.trim() || (controller.sketch && !controller.complete)} onclick={done}><Icon name="check" size={12} /> Done</button>
  </header>
  {#if editingDetails && !controller.loading}
    <div class="layer-details">
      <label><span>Name</span><input aria-label="Layer name" bind:value={layerDetails.title} maxlength="200" /></label>
      <label><span>Description (optional)</span><textarea aria-label="Layer description" bind:value={layerDetails.description} maxlength="4000" rows="2"></textarea></label>
      <button class="btn btn-sm" disabled={controller.pending > 0 || !layerDetails.title.trim() || !detailsChanged}
        onclick={async () => { if (await saveDetails() !== null) editingDetails = false; }}>Save layer details</button>
    </div>
  {:else if controller.editor.description}
    <p class="note layer-description">{controller.editor.description}</p>
  {/if}
  {#if controller.editor.origin}
    <p class="note">Copy of {controller.editor.origin.source.name || controller.editor.origin.source.url}</p>
  {/if}
  {#if controller.loading}
    <p class="note">Opening layer…</p>
  {:else}
    <div class="toolbar">
      <button type="button" class="btn btn-sm" class:chosen={controller.placing}
        aria-pressed={controller.placing} onclick={() => {
          picking = false;
          controller.placing ? controller.stop() : onstart();
        }}>
        <Icon name="pin" size={12} /> {controller.placing ? 'Stop adding' : 'Add markers'}
      </button>
      <button type="button" class="btn btn-sm" aria-expanded={picking} data-place-picker-trigger
        onclick={() => { controller.stop(); picking = !picking; }}>
        <Icon name="link" size={12} /> Add case places
      </button>
      <button type="button" class="btn btn-sm" class:chosen={controller.sketch?.type === 'LineString'}
        onclick={() => { picking = false; controller.startShape('LineString'); }}><Icon name="line" size={12} /> Draw line</button>
      <button type="button" class="btn btn-sm" class:chosen={controller.sketch?.type === 'Polygon'}
        onclick={() => { picking = false; controller.startShape('Polygon'); }}><Icon name="polygon" size={12} /> Draw area</button>
    </div>
    {#if groups.length > 1 && (controller.placing || picking || controller.sketch)}
      <label class="inline-field destination-field"><span>Into</span>
        <select aria-label="Destination group" bind:value={controller.group}>
          {#each groups as group (group.id)}<option value={group.id}>{group.name}</option>{/each}
        </select>
      </label>
    {/if}
    {#if controller.sketch}
      <div class="sketch-controls">
        <p class="note">{controller.sketch.type === 'Selection' ? 'Drag the handle to move the selection. Enter to save, Esc to cancel.' : controller.sketch.type === 'Point' ? 'Drag the handle or click the new position.' : 'Click to add points; drag handles to adjust. Enter to save, Esc to cancel.'}</p>
        {#if selected?.properties.place_id}<p class="note">The case place keeps its coordinates.</p>{/if}
        <div class="selection-actions">
          <button class="btn btn-sm" disabled={!controller.complete || controller.pending > 0} onclick={() => controller.saveGeometry()}>Save geometry</button>
          {#if !controller.sketch.key}<button class="icon-act" aria-label="Undo last point" title="Undo last point" onclick={() => controller.undoVertex()}><Icon name="undo" size={12} /></button>{/if}
          <button class="icon-act" aria-label="Cancel geometry edit" title="Cancel" onclick={() => controller.stop()}><Icon name="x" size={12} /></button>
        </div>
      </div>
    {/if}
    {#if controller.placing}
      <p class="note">Click to add markers; Esc to stop.</p>
      <input aria-label="New marker name" bind:value={controller.draft.name} maxlength="300" placeholder="Automatic name" />
      {#if activeGroup?.mode === 'uniform'}
        <p class="note">Uses the style of {activeGroup.name}.</p>
      {:else}
        {@render styleFields(controller.draft, 'New marker')}
      {/if}
    {/if}
    {#if picking}
      <div class="place-picker">
        <input type="search" aria-label="Find case places" bind:value={query} placeholder="Find a case place" />
        <div class="picker-actions">
          <button type="button" class="text-act" disabled={!available.length}
            onclick={() => (checked = [...new Set([...checked, ...available.slice(0, 100).map((place) => place.id)])])}>Select shown</button>
          <button type="button" class="text-act" disabled={!checked.length} onclick={() => (checked = [])}>Clear</button>
        </div>
        <ul class="place-options">
          {#each available.slice(0, 100) as place (place.id)}
            <li><label><input type="checkbox" value={place.id} bind:group={checked} />
              <span>{place.title ?? place.label}</span></label></li>
          {/each}
        </ul>
        {#if !available.length}<p class="note">No case places to add.</p>{/if}
        {#if available.length > 100}<p class="note">First 100 shown; search to find more.</p>{/if}
        <button class="btn btn-sm" disabled={!checked.length || controller.pending > 0} onclick={addPlaces}>
          Add selected{checked.length ? ` (${checked.length})` : ''}
        </button>
      </div>
    {/if}
    <p class="note">Markers stay in this layer until saved as case places.</p>
    {#if selection.length > 1}
      <div class="selection bulk-selection">
        <div class="selection-head"><span>{selection.length} selected</span>
          <button class="icon-act" aria-label="Clear selection" title="Clear selection" onclick={() => controller.select(null)}><Icon name="x" size={12} /></button></div>
        <div class="selection-actions">
          <button class="btn btn-sm" disabled={controller.pending > 0} onclick={() => controller.moveSelection()}><Icon name="move" size={12} /> Move selection</button>
          <button class="icon-act danger" aria-label="Remove selected from layer" title="Remove selected from layer" disabled={controller.pending > 0} onclick={() => controller.removeSelection()}><Icon name="trash" size={12} /></button>
        </div>
        <label class="inline-field"><span>Move to group</span><select aria-label="Selected features group" value=""
          onchange={(event) => { controller.updateSelection({ group: event.currentTarget.value }); event.currentTarget.value = ''; }}>
          <option value="" disabled>Choose group</option>{#each groups as group}<option value={group.id}>{group.name}</option>{/each}</select></label>
        {@render styleFields(bulkStyle, 'Selection')}
        <button class="btn btn-sm" disabled={controller.pending > 0} onclick={() => controller.updateSelection({ ...bulkStyle })}>Apply style to selection</button>
        <p class="note">Uniform groups keep their group style.</p>
      </div>
    {/if}
    {#if controller.pending}<p class="saving" role="status">Saving {controller.pending}…</p>{/if}

    {#if selected}
      <div class="selection">
        <div class="selection-head">
          <Icon name="edit" size={12} /><span>Edit feature</span>
          <button class="icon-act" aria-label="Close feature editor" title="Close feature editor"
            onclick={() => controller.select(null)}><Icon name="x" size={12} /></button>
        </div>
        <input aria-label="Selected marker name" bind:value={changes.name} maxlength="300" placeholder="Name" />
        {#if groups.length > 1}
          <label class="inline-field"><span>Group</span>
            <select aria-label="Selected marker group" bind:value={changes.group}>
              {#each groups as group (group.id)}<option value={group.id}>{group.name}</option>{/each}
            </select>
          </label>
        {/if}
        {#if selectedGroup?.mode === 'uniform'}
          <p class="note">Uses the style of {selectedGroup.name}.</p>
        {:else}
          {@render styleFields(changes, 'Selected marker', selected.geometry.type === 'Point')}
        {/if}
        <details class="notes"><summary><Icon name="note" size={11} /> Note</summary>
          <textarea aria-label="Selected marker note" bind:value={changes.description} maxlength="4000" rows="2"></textarea>
        </details>
        <div class="selection-actions">
          <button class="btn btn-sm" disabled={controller.pending > 0} onclick={saveSelected}>Save changes</button>
          <button class="icon-act danger" disabled={controller.pending > 0} aria-label="Remove from this layer"
            title="Remove from this layer" onclick={() => controller.remove(selected.properties.key)}>
            <Icon name="trash" size={13} />
          </button>
        </div>
        {#if ['Point', 'LineString', 'Polygon'].includes(selected.geometry.type)}
          <button class="text-act" onclick={() => controller.editGeometry()}><Icon name="edit" size={11} /> {selected.geometry.type === 'Point' ? 'Move marker' : 'Edit geometry'}</button>
        {/if}
        {#if selected.geometry.type === 'Point'}
          {#if selected.properties.place_id}
            <div class="membership"><Icon name="link" size={11} /><span>Saved as case place</span>
              <button type="button" class="text-act danger" onclick={() => ondeleteplace?.(selected.properties.place_id)}>Delete case place</button>
            </div>
          {:else}
            <button class="text-act promote" disabled={controller.pending > 0}
              onclick={() => controller.promote(selected.properties.key)}><Icon name="plus" size={11} /> Save as case place</button>
          {/if}
        {/if}
      </div>
    {/if}

    <div class="groups" bind:this={groupList}>
      {#each groups as group, index (group.id)}
        {@const members = membersByGroup.get(group.id) ?? []}
        {@const hidden = controller.editor.hidden?.includes(group.name)}
        <div class="group" data-feature-group={group.id} class:active-group={controller.group === group.id}
          class:feature-target={featureDrop?.group === group.id} class:drop-before={gap === index} class:drop-after={gap === groups.length && index === groups.length - 1}>
          <div class="group-controls" data-group-id={group.id}>
          <div class="group-head">
            <button class="icon-act group-grip" draggable="true" aria-label={`Move group ${group.name}`} title="Drag to reorder" data-group-grip={group.id}
              onkeydown={(event) => nudge(event, group, index)}
              ondragstart={(event) => { draggedFeatures = []; featureDrop = null; dragged = group.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', group.name); }}
              ondragend={() => { dragged = ''; gap = -1; }}><Icon name="grip" size={14} stroke={2.5} /></button>
            <button class="icon-act eye" class:on={!hidden} aria-label={`Show group ${group.name}`}
              aria-pressed={!hidden} title={hidden ? 'Show this group' : 'Hide this group'}
              onclick={() => controller.toggleGroup(group)}><Icon name="eye" size={12} /></button>
            <button class="group-title" aria-expanded={!folded.has(group.id)} onclick={() => {
              controller.group = group.id; fold(group.id);
            }}><Icon name={folded.has(group.id) ? 'chevronRight' : 'chevronDown'} size={11} />
              <span class="group-dot" style={`--swatch:${group.colour}`}></span>
              <span class="name">{group.name}</span><span class="count">{members.length}</span>
            </button>
            <button class="icon-act" aria-label={`Edit group ${group.name}`} title="Edit group style" data-group-menu-trigger
              onclick={() => { controller.group = group.id; editingGroup = editingGroup === group.id ? '' : group.id; }}>
              <Icon name="edit" size={12} />
            </button>
          </div>
          {#if editingGroup === group.id}
            <div class="group-settings">
              <input aria-label="Group name" value={group.name} maxlength="200"
                onchange={(event) => controller.updateGroup(group.id, { name: event.currentTarget.value })} />
              <select aria-label="Group style" value={group.mode}
                onchange={(event) => controller.updateGroup(group.id, { mode: event.currentTarget.value })}>
                <option value="uniform">Uniform style</option><option value="individual">Individual styles</option>
              </select>
              {#if group.mode === 'uniform'}
                {@render styleFields(group, 'Group', true, (changes) => controller.updateGroup(group.id, changes))}
              {/if}
              <label class="size-field"><span>Icon size</span>
                <input type="range" min="0.5" max="3" step="0.25" value={sizes[group.id] ?? group.size ?? 1} aria-label={`Icon size for ${group.name}`}
                  oninput={(event) => { sizes[group.id] = Number(event.currentTarget.value); }}
                  onchange={async () => { const result = await controller.updateGroup(group.id, { size: sizes[group.id] ?? group.size ?? 1 }); if (result === null) delete sizes[group.id]; }} />
                <output>{Math.round((sizes[group.id] ?? group.size ?? 1) * 100)}%</output>
              </label>
              <label class="size-field"><span>Line width</span>
                <input type="range" min="0.5" max="12" step="0.5" value={strokes[group.id] ?? group.stroke ?? 2} aria-label={`Line width for ${group.name}`}
                  oninput={(event) => { strokes[group.id] = Number(event.currentTarget.value); }}
                  onchange={async () => { const result = await controller.updateGroup(group.id, { stroke: strokes[group.id] ?? group.stroke ?? 2 }); if (result === null) delete strokes[group.id]; }} />
                <output>{strokes[group.id] ?? group.stroke ?? 2}px</output>
              </label>
              {#if groups.length > 1}
                <button class="text-act" disabled={controller.pending > 0} onclick={() => controller.removeGroup(group.id)}>
                  Remove group, keep features
                </button>
              {/if}
            </div>
          {/if}
          </div>
          {#if !folded.has(group.id)}
            {#if members.length > 1}<button class="text-act select-group" onclick={() => controller.selectGroup(group.id)}>Select all {members.length}</button>{/if}
            <ul class="features" class:drop-end={featureDrop?.group === group.id && !featureDrop.before}>
              {#each members.slice(-(limits[group.id] ?? 100)).toReversed() as feature (feature.properties.key)}
                <li data-feature-key={feature.properties.key}
                  class:dragging={draggedFeatures.includes(feature.properties.key)}
                  class:drop-before={featureDrop?.group === group.id && featureDrop.before === feature.properties.key}>
                <button class="icon-act feature-grip" draggable="true" data-feature-grip={feature.properties.key}
                  aria-label={`Move ${feature.properties.name || 'Unnamed feature'}`} title="Drag to reorder or move to a group"
                  disabled={controller.pending > 0 || !!controller.sketch} onkeydown={(event) => nudgeFeature(event, feature)}
                  ondragstart={(event) => startFeatureDrag(event, feature)} ondragend={() => { draggedFeatures = []; featureDrop = null; }}>
                  <Icon name="grip" size={14} stroke={2.5} /></button>
                <button class="feature-row" aria-pressed={selection.includes(feature.properties.key)}
                  class:active={selection.includes(feature.properties.key) || selected?.properties.key === feature.properties.key}
                  onclick={async (event) => { if (event.shiftKey || event.ctrlKey || event.metaKey) controller.toggleSelected(feature.properties.key, members.toReversed().map((feature) => feature.properties.key), event.shiftKey);
                    else { controller.select(feature.properties.key); onfly?.(feature); } await tick(); root?.querySelector('.selection')?.scrollIntoView?.({ block: 'nearest' }); }}>
                  <span class="feature-symbol" style={`color:${group.mode === 'uniform' ? group.colour : feature.properties.colour || group.colour}`}>
                    <Icon name={feature.geometry.type === 'Point'
                      ? symbolIcons.get(group.mode === 'uniform' ? group.symbol : feature.properties.symbol) || 'pin'
                      : 'polygon'} size={12} />
                  </span>
                  <span class="name">{feature.properties.name || 'Unnamed feature'}</span>
                  {#if feature.properties.place_id}<Icon name="link" size={10} />{/if}
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
      {/each}
    </div>
    {#if newGroup}
      <form class="new-group" onsubmit={(event) => { event.preventDefault(); createGroup(); }}>
        <input aria-label="New group name" bind:value={groupName} placeholder="Group name" maxlength="200" />
        <button class="icon-act" aria-label="Create group" title="Create group" disabled={!groupName.trim() || controller.pending > 0}><Icon name="check" size={13} /></button>
        <button type="button" class="icon-act" aria-label="Cancel new group" title="Cancel" onclick={() => (newGroup = false)}><Icon name="x" size={12} /></button>
      </form>
    {:else}
      <button class="add" data-new-group-trigger onclick={() => (newGroup = true)}><Icon name="plus" size={12} /> New group</button>
    {/if}
    <p class="tally">{controller.features.length} {controller.features.length === 1 ? 'feature' : 'features'}</p>
  {/if}
</section>

{#if discard}
  <ConfirmDialog title="Discard changes?" message="Return this layer to how it was when editing started?"
    detail="Case places saved separately stay in the case."
    confirmLabel="Discard changes" tone="danger" icon="undo" busy={controller.pending > 0} onconfirm={discardChanges} oncancel={() => (discard = false)} />
{/if}

<style>
  .editor { padding: 8px 8px 0; font-size: var(--fs-xs); }
  .editor-head, .toolbar, .style-row, .palette, .selection-head, .selection-actions, .group-head, .membership, .new-group { display: flex; align-items: center; gap: 6px; }
  .editor-title, .selection-head > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .editor-head { position: sticky; top: 0; z-index: 8; background: var(--bg-1); }
  .editor-title { font-size: var(--fs-sm); }
  .done { flex: none; min-height: 27px; gap: 4px; }
  .back { color: var(--text-2); }
  .size-field { display: flex; align-items: center; gap: 5px; margin-top: 7px; color: var(--text-3); font-size: 10px; }
  .size-field input[type='range'] { flex: 1; min-width: 0; padding: 0; height: 18px; accent-color: var(--accent); }
  .size-field output { width: 34px; text-align: right; }
  .icon-act.group-grip, .icon-act.feature-grip { cursor: grab; color: var(--text-2); }
  .group-grip:active, .feature-grip:active { cursor: grabbing; }
  .layer-title { display: flex; align-items: center; gap: 5px; text-align: left; cursor: pointer; }
  .layer-title > span { overflow: hidden; text-overflow: ellipsis; }
  .layer-title :global(svg) { flex: none; color: var(--text-3); }
  .layer-title:hover :global(svg) { color: var(--text-1); }
  .layer-details { margin-top: 7px; padding: 7px; background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius-1); }
  .layer-details label { display: grid; gap: 3px; margin-bottom: 6px; color: var(--text-3); font-size: 10px; }
  .layer-details textarea { margin-top: 0; }
  .layer-description { white-space: pre-wrap; display: -webkit-box; line-clamp: 2; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .group.drop-before { border-top: 2px solid var(--accent); }
  .group.drop-after { border-bottom: 2px solid var(--accent); }
  .group.feature-target > .group-controls > .group-head { background: var(--accent-soft); }
  .features li.drop-before { box-shadow: inset 0 2px var(--accent); }
  .features li.dragging { opacity: .5; }
  .features.drop-end { box-shadow: inset 0 -2px var(--accent); }
  .toolbar { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; margin-top: 8px; }
  .toolbar > button { min-width: 0; justify-content: center; gap: 4px; padding: 4px; font-size: 10px; }
  input:not([type='checkbox']):not([type='color']), select, textarea { width: 100%; min-width: 0; padding: 4px 6px; font-size: var(--fs-xs); line-height: 1.35; border-radius: var(--radius-1); }
  input:not([type='checkbox']):not([type='color']), select { height: 27px; }
  textarea { resize: vertical; margin-top: 5px; }
  .style-row { margin-top: 6px; flex-wrap: wrap; }
  .palette { gap: 5px; }
  .swatch { width: 14px; height: 14px; border-radius: 50%; background: var(--swatch); border: 1px solid transparent; cursor: pointer; }
  .swatch.chosen { outline: 1px solid var(--text-1); outline-offset: 2px; }
  input[type='color'] { width: 24px; height: 23px; padding: 1px; border: 1px solid var(--border); background: var(--bg-2); cursor: pointer; }
  .inline-field { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
  .inline-field > span { color: var(--text-3); width: 35px; flex: none; }
  .note, .tally, .saving, .group-empty { margin: 6px 0; color: var(--text-3); font-size: 10px; line-height: 1.4; }
  .note { overflow-wrap: anywhere; }
  .saving { color: var(--accent); }
  .selection { margin: 8px 0; padding: 7px; border: 1px solid var(--border); border-radius: var(--radius-1); background: var(--bg-2); }
  .selection-head { color: var(--text-3); margin-bottom: 4px; }
  .selection-head .icon-act { margin-left: auto; }
  .selection-actions { margin-top: 6px; }
  .selection-actions .danger { margin-left: auto; }
  .bulk-selection { position: sticky; top: 38px; z-index: 7; }
  .bulk-selection .inline-field > span { width: 80px; }
  .bulk-selection:has(:global(.icon-menu)) { z-index: 11; }
  .notes { margin-top: 6px; color: var(--text-3); }
  summary { cursor: pointer; font-size: 10px; }
  summary :global(svg) { vertical-align: middle; }
  .membership { margin-top: 7px; font-size: 10px; color: var(--text-3); flex-wrap: wrap; }
  .text-act { display: inline-flex; align-items: center; gap: 4px; color: var(--text-3); font-size: 10px; padding: 3px 0; cursor: pointer; text-align: left; }
  .text-act:hover { color: var(--text-1); }
  .text-act.danger:hover { color: var(--danger); }
  .promote { margin-top: 4px; color: var(--accent); }
  .icon-act { display: grid; place-items: center; flex: none; width: 22px; height: 22px; color: var(--text-3); border-radius: var(--radius-1); cursor: pointer; }
  .icon-act:hover:not(:disabled) { background: var(--bg-3); color: var(--text-1); }
  .icon-act.danger:hover:not(:disabled) { color: var(--danger); }
  .eye.on { color: var(--accent); }
  .groups { margin-top: 10px; }
  .group { margin-bottom: 4px; border-bottom: 1px solid var(--border); padding-bottom: 3px; }
  .group-head { gap: 2px; min-height: 26px; }
  .group-title { display: flex; align-items: center; gap: 5px; flex: 1; min-width: 0; text-align: left; color: var(--text-2); cursor: pointer; }
  .active-group .group-title { color: var(--text-1); }
  .group-dot { width: 8px; height: 8px; background: var(--swatch); border-radius: 2px; flex: none; }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .count { font-size: 10px; color: var(--text-3); }
  .group-settings { padding: 4px 4px 5px 24px; }
  .group-settings > select { margin-top: 5px; }
  ul { list-style: none; margin: 0; padding: 0; }
  .features .feature-row { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; min-height: 24px; padding: 3px 5px; text-align: left; color: var(--text-2); font-size: var(--fs-xs); cursor: pointer; }
  .features .feature-row:hover, .features .feature-row.active { background: var(--bg-3); color: var(--text-1); }
  .features { max-height: min(340px, 45vh); overflow-y: auto; }
  .features li { display: flex; align-items: center; padding-left: 8px; }
  .feature-grip { padding: 0; }
  .select-group { margin: 3px 0 3px 28px; }
  .feature-symbol { display: grid; place-items: center; flex: none; }
  .group-empty { padding-left: 29px; }
  .add { display: flex; align-items: center; gap: 6px; width: 100%; padding: 5px 8px; border: 1px dashed var(--border); border-radius: var(--radius-1); color: var(--text-3); font-size: var(--fs-xs); cursor: pointer; }
  .add:hover { border-color: var(--text-3); color: var(--text-1); }
  .new-group { padding: 3px 0; }
  .place-picker { border: 1px solid var(--border); padding: 6px; margin-top: 6px; border-radius: var(--radius-1); }
  .place-options { max-height: 180px; overflow-y: auto; margin: 5px 0; }
  .place-options label { display: flex; align-items: center; gap: 6px; padding: 3px 0; cursor: pointer; }
  .place-options span { overflow-wrap: anywhere; }
  .picker-actions { display: flex; align-items: center; justify-content: space-between; }
  .chosen { color: var(--accent); border-color: var(--accent); }
</style>
