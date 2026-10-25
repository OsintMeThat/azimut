<script>
  /**
   * What a personal layer holds, beside the map that edits it.
   *
   * The map's bar does everything done to features (`LayerEditBar`); this
   * panel says what each one is, in the sheet of the selection
   * (`LayerFeatureSheet`), and keeps the groups in their order. Everything
   * saves as it is set; Discard, beside Done, takes the whole session back.
   */
  import Icon from '../../components/Icon.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import LayerFeatureSheet from './LayerFeatureSheet.svelte';
  import LayerGroupMenu from './LayerGroupMenu.svelte';
  import LayerKeyButton from './LayerKeyButton.svelte';
  import MarkerSymbol from './MarkerSymbol.svelte';
  import { tick, untrack } from 'svelte';
  import ConfirmDialog from '../../components/ConfirmDialog.svelte';
  import { moveName } from '../../lib/map/addedLayers.js';
  import { caseState } from '../../lib/state.svelte.js';
  import { openFollowed } from '../../lib/map/followed.js';
  import { layerPalette } from '../../lib/map/layerPalette.svelte.js';
  import LayerTrackPanel from './LayerTrackPanel.svelte';
  import { changesOn, spanLabel, spanOf } from '../../lib/map/layerHistory.js';
  import { axisZone } from '../../lib/caseAxis.svelte.js';
  import ClockField from '../../components/ClockField.svelte';
  import { LAYER_HELP } from '../../lib/map/layerHelp.js';
  import { iconLibrary } from '../../lib/iconLibrary.svelte.js';

  let { controller, ondone, onfly, ondeleteplace } = $props();
  /** What a marker or a group wearing one of the analyst's icons shows in the list. */
  const iconOf = (key) => (key ? iconLibrary.look(key, { caseId: controller.editor?.caseId, layer: controller.editor?.name, meta: controller.icons }) : null);
  $effect(() => layerPalette.load(controller.editor?.caseId));
  const selected = $derived(controller.selected);
  const groups = $derived(controller.groups ?? []);
  /** The colours the layer's features wear and the icons its markers wear, as their groups draw them, for the key to name. */
  const worn = $derived.by(() => {
    const byId = new Map(groups.map((group) => [group.id, group]));
    const colours = new Set(), keys = new Set();
    for (const feature of controller.features ?? []) {
      const group = byId.get(feature.properties.group);
      const own = group?.mode === 'uniform' || group?.mode === 'colour' ? group : feature.properties;
      if (own?.colour || group?.colour) colours.add(String(own?.colour || group.colour).toLowerCase());
      if (!String(feature.geometry?.type ?? '').includes('Point')) continue;
      const style = group?.mode === 'uniform' ? group : feature.properties;
      keys.add(style.icon || style.symbol || 'pin');
    }
    return { colours: [...colours], keys: [...keys] };
  });
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
  const busy = $derived(controller.loading);
  // The new-group field goes away on a press outside it.
  $effect(() => {
    if (!newGroup) return;
    const outside = (event) => { if (!(event.target instanceof Element) || !event.target.closest('.new-group, [data-new-group-trigger]')) newGroup = false; };
    window.addEventListener('click', outside, true);
    return () => window.removeEventListener('click', outside, true);
  });
  const needle = $derived(query.trim().toLowerCase());
  /** A search reads what a feature says: its name, its note, its day, its status, its sources. */
  const matches = (feature) => {
    if (!needle) return true;
    const said = feature.properties;
    return [said.name, said.entity_label, said.description, said.date, said.status, said.confidence, ...(said.links ?? [])]
      .some((value) => String(value ?? '').toLowerCase().includes(needle));
  };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /** A feature's day as the list writes it: `14 Oct 2026`. */
  const day = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
    return match ? `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}` : '';
  };
  const tracked = $derived(!!controller.editor.track?.on);
  /** When a feature shows, as its row says it on a layer followed over time. */
  const when = (feature, group) => spanLabel(spanOf(feature), { event: !!group.events });
  /** The first words of a feature's note, under a name that says little. */
  const gist = (feature) => String(feature.properties.description ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
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
  /** How many rows of a group the list shows, the newest first. */
  const limitOf = (id) => limits[id] ?? 100;
  /** The rows on show, each group open and cut at its limit. */
  const shownKeys = $derived.by(() => {
    const keys = new Set();
    for (const group of groups) {
      const members = membersByGroup.get(group.id) ?? [];
      if (needle ? !members.length : folded.has(group.id)) continue;
      for (const feature of members.slice(-limitOf(group.id))) keys.add(feature.properties.key);
    }
    return keys;
  });
  /**
   * One feature picked opens its sheet under its row, the rest of the list in view;
   * several picked, or one whose row is not on show, open it above the list.
   */
  const inlineKey = $derived(selection.length <= 1 && selected && shownKeys.has(selected.properties.key) ? selected.properties.key : '');
  /** A feature picked on the map: its group opens and its row comes into the list, then into view. */
  let fromList = '';
  let revealed = '';
  $effect(() => {
    const key = selection.length <= 1 ? selected?.properties.key ?? '' : '';
    if (!key || key === revealed) { if (!key) revealed = ''; return; }
    revealed = key;
    const picked = selected;
    untrack(() => {
      if (needle && !matches(picked)) return;
      const id = picked.properties.group;
      const members = membersByGroup.get(id) ?? [];
      const at = members.findIndex((feature) => feature.properties.key === key);
      if (at < 0) return;
      const from = members.length - at;
      if (folded.has(id)) { const next = new Set(folded); next.delete(id); folded = next; }
      if (from > limitOf(id)) limits[id] = Math.min(members.length, Math.ceil(from / 100) * 100);
      // a row pressed stays under the pointer (`keepPlace`); only a pick on the map scrolls the list
      if (fromList === key) { fromList = ''; return; }
      tick().then(() => root?.querySelector(`[data-feature-key="${CSS.escape(key)}"]`)?.scrollIntoView?.({ block: 'nearest' }));
    });
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
  /** Before the clock is ever set, a layer follows the case's clock, as every date field does. */
  function switchTrack() {
    layerMenu = false;
    const on = !controller.editor.track?.on;
    controller.setTrack(controller.editor.track ? { on } : { on, zone: axisZone(controller.editor.caseId) || 'UTC' });
  }
  async function sendToMyMaps() {
    layerMenu = false;
    if (controller.formChanged && !(await controller.saveForm())) return;
    if (controller.detailsChanged && !(await controller.saveDetails())) return;
    controller.sendToMyMaps(controller.editor);
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
        const next = nodes.find((node) => { const rect = (node.querySelector('.line') ?? node).getBoundingClientRect(); return event.clientY < rect.top + rect.height / 2; });
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

  /**
   * Pick from the list without the list jumping: the sheet folding away above it, or
   * opening above the list, moves the rows, so the panel scrolls by as much and the
   * pressed row stays under the pointer.
   */
  async function keepPlace(row, act) {
    const before = row?.getBoundingClientRect().top ?? 0;
    act();
    await tick();
    const after = row?.isConnected ? row.getBoundingClientRect().top : before;
    let scroller = root?.parentElement;
    while (scroller && scroller !== document.body && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    if (scroller && scroller !== document.body && Math.abs(after - before) > 1) scroller.scrollTop += after - before;
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
    <LayerKeyButton caseId={controller.editor?.caseId} colours={worn.colours} worn={worn.keys} look={iconOf} disabled={controller.loading} />
    <button type="button" class="icon-act more-btn" aria-label="Layer actions" title="Description, time, download" aria-expanded={layerMenu}
      bind:this={layerMenuAnchor} disabled={controller.loading} onclick={() => (layerMenu = !layerMenu)}><Icon name="more" size={14} /></button>
    <!-- with nothing changed it is a way back out: no question to ask -->
    <button type="button" class="icon-act more-btn discard-btn" aria-label="Discard changes"
      title={controller.changed ? 'Put the layer back as it was when editing started' : 'Stop editing, nothing changed'}
      disabled={busy} onclick={() => (controller.changed ? (discard = true) : discardChanges())}><Icon name="undo" size={14} /></button>
    <!-- Leaving the layer from the panel too, where the eye is. The press keeps the focus where
         it is: leaving a field would save it, and Done saves it anyway. -->
    <button class="btn btn-primary btn-sm done" title="Save what is left in a field and stop editing this layer"
      disabled={busy || !layerDetails.title.trim() || (controller.sketch && !controller.complete)}
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
    <!-- the day shown stays in view at the top while the list scrolls under it, with the sheet of what is not a row on show -->
    <div class="sheet-dock">
      {#if controller.editor.track?.on}<LayerTrackPanel {controller} />{/if}
      {#if !inlineKey}<LayerFeatureSheet {controller} onfollowed={(id) => openFollowed(caseState.current?.id, id)} {ondeleteplace} />{/if}
    </div>

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
              {#if group.mode === 'uniform'}<MarkerSymbol symbol={group.symbol} colour={group.colour} icon={iconOf(group.icon)} size={15} />
              {:else}<span class="group-dot" style={`--swatch:${group.colour}`}></span>{/if}
              <span class="name">{group.name}</span><span class="count">{members.length}</span>
            </button>
            <button class="icon-act more more-btn" aria-label={`Settings of group ${group.name}`} title="Group settings" aria-expanded={groupMenu?.id === group.id}
              onclick={(event) => { controller.group = group.id; groupMenu = groupMenu?.id === group.id ? null : { id: group.id, anchor: event.currentTarget }; }}>
              <Icon name="more" size={14} />
            </button>
          </div>
          {#if groupMenu?.id === group.id}
            <LayerGroupMenu {controller} {group} anchor={groupMenu?.anchor ?? null} members={members.length} onclose={() => (groupMenu = null)} />
          {/if}
          {#if open}
            <!-- a group holding the open sheet lets the panel scroll it, the sheet never squeezed into its box -->
            <ul class="features" class:holding={members.some((feature) => feature.properties.key === inlineKey)}
              class:drop-end={featureDrop?.group === group.id && !featureDrop.before}>
              {#each members.slice(-limitOf(group.id)).toReversed() as feature (feature.properties.key)}
                {@const paint = group.mode === 'uniform' || group.mode === 'colour' ? group.colour : feature.properties.colour || group.colour}
                <li data-feature-key={feature.properties.key}
                  class:dragging={draggedFeatures.includes(feature.properties.key)}
                  class:drop-before={featureDrop?.group === group.id && featureDrop.before === feature.properties.key}>
                <!-- the line drags, not the sheet under it, whose fields select text -->
                <div class="line" role="none" draggable={controller.pending > 0 || !!controller.sketch ? 'false' : 'true'}
                  ondragstart={(event) => startFeatureDrag(event, feature)} ondragend={() => { draggedFeatures = []; featureDrop = null; }}>
                <button class="icon-act grip" data-feature-grip={feature.properties.key}
                  aria-label={`Move ${feature.properties.name || 'Unnamed feature'}`} title="Drag to reorder or move to a group"
                  disabled={controller.pending > 0 || !!controller.sketch} onkeydown={(event) => nudgeFeature(event, feature)}>
                  <Icon name="grip" size={14} stroke={2.5} /></button>
                <button class="feature-row" aria-pressed={selection.includes(feature.properties.key)} class:absent={feature.properties.$absent}
                  title={feature.properties.$absent ? 'Not on the map on the layer\'s day' : null}
                  class:active={selection.includes(feature.properties.key) || selected?.properties.key === feature.properties.key}
                  onclick={async (event) => { if (event.shiftKey || event.ctrlKey || event.metaKey) controller.toggleSelected(feature.properties.key, members.toReversed().map((feature) => feature.properties.key), event.shiftKey);
                    else { fromList = feature.properties.key; await keepPlace(event.currentTarget, () => controller.select(feature.properties.key)); onfly?.(feature); } }}>
                  <span class="feature-symbol" style={`color:${paint}`}>
                    {#if feature.geometry.type === 'Point'}
                      <MarkerSymbol symbol={(group.mode === 'uniform' ? group.symbol : feature.properties.symbol) || 'pin'} colour={paint}
                        icon={iconOf(group.mode === 'uniform' ? group.icon : feature.properties.icon)}
                        status={feature.properties.status ?? ''} external={feature.properties.provenance === 'external'} size={15} />
                    {:else}<Icon name={String(feature.geometry.type).includes('Line') ? 'line' : 'polygon'} size={12} />{/if}
                  </span>
                  <span class="name" title={gist(feature) || null}>{feature.properties.name || 'Unnamed feature'}{#if gist(feature)}<small>{gist(feature)}</small>{/if}</span>
                  {#if tracked}
                    {#if changesOn(feature, controller.cursor)}<span class="today" title="Changes on the day shown"></span>{/if}
                    {@const said = when(feature, group)}
                    <span class="day" class:open-ended={said === 'Always' || said === 'No day'}>{said}</span>
                  {:else if feature.properties.date}<span class="day">{day(feature.properties.date)}</span>{/if}
                  {#if feature.properties.entity_id}<Icon name="link" size={10} />{/if}
                </button></div>
                {#if feature.properties.key === inlineKey}
                  <LayerFeatureSheet {controller} inline onfollowed={(id) => openFollowed(caseState.current?.id, id)} {ondeleteplace} />
                {/if}
                </li>
              {/each}
            </ul>
            {#if !members.length}<p class="group-empty">Empty group</p>{/if}
            {#if members.length > limitOf(group.id)}
              <button class="add" onclick={() => { limits[group.id] = Math.min(members.length, limitOf(group.id) + 100); }}>Show 100 more ({members.length})</button>
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
    <button type="button" class="fm-item" role="menuitemcheckbox" aria-checked={!!controller.editor.track?.on} disabled={busy} title={LAYER_HELP.track} onclick={switchTrack}>
      <Icon name="clock" size={14} /><span class="fm-grow">Track over time</span>
      {#if controller.editor.track?.on}<Icon name="check" size={13} />{/if}</button>
    {#if controller.editor.track?.on}
      <!-- how a tracked layer dates its states: set once, so kept in the menu rather than over the list -->
      <div class="fm-sub" role="group" aria-label="Date states by" title={LAYER_HELP.precision}>
        <span>Dated to</span>
        <button type="button" class="fm-pill" aria-pressed={(controller.editor.track.precision ?? 'day') === 'day'} disabled={busy}
          onclick={() => controller.setTrack({ precision: 'day' })}>the day</button>
        <button type="button" class="fm-pill" aria-pressed={controller.editor.track.precision === 'time'} disabled={busy}
          onclick={() => controller.setTrack({ precision: 'time' })}>day and time</button>
      </div>
      <div class="fm-sub" title={LAYER_HELP.clock}><span>Clock</span><ClockField value="" clock={{ zone: controller.editor.track.zone ?? 'UTC', fixed: '' }} timed={false} disabled={busy}
        onpick={(zone) => { if (zone) controller.setTrack({ zone }); }} /></div>
    {/if}
    <button type="button" class="fm-item" disabled={busy || !!controller.sketch} onclick={download}>
      <Icon name="download" size={14} /><span class="fm-grow">Download layer</span></button>
    <button type="button" class="fm-item" disabled={busy || !!controller.sketch} onclick={sendToMyMaps}>
      <Icon name="upload" size={14} /><span class="fm-grow">Send to My Maps…</span></button>
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
  .done { flex: none; min-height: 27px; gap: 4px; }
  .sheet-dock { position: sticky; top: 40px; z-index: 7; max-height: 60vh; overflow-y: auto; background: var(--bg-1); }
  .sheet-dock:empty { display: none; }
  .editor-head > :global(svg) { flex: none; color: var(--text-3); }
  .title { flex: 1; min-width: 0; height: 28px; padding: 3px 6px; border: 1px solid transparent; border-radius: var(--r-sm); background: transparent;
    color: var(--text-1); font-size: var(--fs-sm); font-weight: 600; }
  .title:hover { border-color: var(--border); }
  .title:focus { border-color: var(--accent); background: var(--bg-2); }
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
  .group-head:hover .grip, .features .line:hover .grip, .grip:focus-visible { opacity: 1; }
  .group-head[draggable='true'], .features .line[draggable='true'] { cursor: grab; }
  .groups { margin-top: 8px; }
  .group { margin-bottom: 2px; }
  .group-head { display: flex; align-items: center; gap: 1px; min-height: 30px; padding-right: 2px; border-radius: var(--r-sm); }
  .group-head:hover { background: var(--bg-2); }
  /* a menu button reads as one: a ⋯ nobody sees is a menu nobody opens */
  .more-btn { border: 1px solid var(--border); background: var(--bg-2); color: var(--text-1); }
  .more-btn:hover:not(:disabled), .more-btn[aria-expanded='true'] { border-color: var(--accent); }
  .discard-btn:hover:not(:disabled) { border-color: var(--danger); color: var(--danger); }
  .discard-btn:disabled { opacity: 0.45; cursor: default; }
  .group-title { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; padding: 4px 2px; text-align: left; color: var(--text-2); font-size: var(--fs-xs); font-weight: 600; cursor: pointer; }
  .active-group .group-title { color: var(--text-1); }
  .group-dot { width: 10px; height: 10px; background: var(--swatch); border-radius: 3px; flex: none; }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name small { margin-left: 6px; color: var(--text-3); font-size: 10px; }
  .fm-sub { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; padding: 3px 10px 5px 32px; color: var(--text-3); font-size: 11px; }
  .fm-pill { padding: 1px 7px; border: 1px solid var(--border); border-radius: 999px; color: var(--text-2); font-size: 11px; cursor: pointer; }
  .fm-pill[aria-pressed='true'] { border-color: var(--accent); background: var(--accent-soft); color: var(--text-1); }
  .count, .day { font-size: 10px; font-weight: 400; color: var(--text-3); }
  .day { flex: none; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .day.open-ended { opacity: .7; }
  /* the map rings what changes on the day shown; the list marks it the same yellow */
  .today { flex: none; width: 6px; height: 6px; border-radius: 50%; background: #ffd400; /* addedLayer.js NEW_COLOUR */ }
  ul { list-style: none; margin: 0; padding: 0; }
  .features .feature-row { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; min-height: 26px; padding: 3px 6px; border-radius: var(--r-sm); text-align: left; color: var(--text-2); font-size: var(--fs-xs); cursor: pointer; }
  .features .feature-row:hover, .features .feature-row.active { background: var(--bg-3); color: var(--text-1); }
  .features .feature-row.active { box-shadow: inset 2px 0 var(--accent); }
  .features .feature-row.absent { opacity: .45; }
  .features { max-height: min(340px, 45vh); overflow-y: auto; }
  .features.holding { max-height: none; overflow-y: visible; }
  .features li { padding-left: 10px; }
  .features .line { display: flex; align-items: center; }
  .feature-symbol { display: grid; place-items: center; flex: none; }
  .group-empty { padding-left: 34px; }
  .add { display: flex; align-items: center; gap: 6px; width: 100%; margin-top: 6px; padding: 5px 8px; border: 1px dashed var(--border); border-radius: var(--radius-1); color: var(--text-3); font-size: var(--fs-xs); cursor: pointer; }
  .add:hover { border-color: var(--text-3); color: var(--text-1); }
  .new-group { padding: 3px 0; }
</style>
