<script>
  /**
   * The case's shared areas: the ground this case watches, named and coloured
   * once and referenced by every routine and pass that sweeps it.
   *
   * A row reads like the map: the colour it is drawn in, its name, how big it
   * is and what uses it. Pressing a row frames it; editing is asked for rather
   * than always on screen, so the list stays a list.
   *
   * A new shape reaches every routine that watches the area, from its next
   * run, since a routine reads its areas when it runs. A finished run froze
   * its own copy and keeps the ground it swept. Saving the shape as a new area
   * leaves the routines on the old one.
   */
  import { untrack } from 'svelte';
  import { api } from '../../lib/api.js';
  import { ensureCase, prefs, reloadCase } from '../../lib/state.svelte.js';
  import { zoneRing } from '../../lib/map/analyzers.js';
  import { formatArea, polygonArea } from '../../lib/measure.js';
  import { plural } from '../../lib/map/detections.js';
  import { closeOnOutsidePointer } from '../../lib/dismiss.js';
  import Icon from '../../components/Icon.svelte';
  import Modal from '../../components/Modal.svelte';

  let { caseId, areas = [], groups = [], routines = [], selectedArea = null, hidden = $bindable([]),
    zones = $bindable([]), drawing = $bindable('select'),
    /** The shape the map shows its corners for. */
    selectedZone = $bindable(null),
    onrefresh = async () => {}, onusecurrentview = () => {}, onframe = () => {} } = $props();

  let error = $state('');
  let busy = $state(false);
  let removing = $state(null);
  let editing = $state(null);
  let search = $state('');
  /** Groups opened by hand; every group starts folded, the first one too. */
  let unfolded = $state({});
  const open = (group) => !!search || !!unfolded[group.id];
  /** The one ⋯ menu open: a press anywhere else, or a choice in it, shuts it. */
  let openMenu = $state.raw(null);
  let creatingGroup = $state(false);
  let newGroupName = $state('');
  let removingGroup = $state(null);
  let editingGroup = $state(null);
  let dragging = $state(null);
  let landing = $state(null);
  /** The area whose corners are on the map, and whether it was drawn before. */
  let reshaping = $state(null);

  const users = $derived(removing ? routines.filter((routine) => routine.zones?.some((z) => z.id === removing.id)) : []);
  const usedBy = (area) => routines.filter((routine) => routine.zones?.some((z) => z.id === area.id)).length;
  const size = (area) => formatArea(
    polygonArea(area.geometry.coordinates[0].slice(0, -1).map(([lon, lat]) => ({ lon, lat }))),
    prefs.units
  );
  const ringOf = (area) => [{ kind: 'polygon', points: area.geometry.coordinates[0] }];
  const groupedIds = $derived(new Set(groups.flatMap((group) => group.area_ids ?? [])));
  const ungrouped = $derived(areas.filter((area) => !groupedIds.has(area.id)));
  const members = (group) => (group.area_ids ?? []).map((id) => areas.find((area) => area.id === id)).filter(Boolean);
  const matches = (name) => name.toLowerCase().includes(search.trim().toLowerCase());
  const visibleUngrouped = $derived(ungrouped.filter((area) => !search || matches(area.name)));
  function groupBody(group, patch = {}) {
    const body = { title: group.title, area_ids: group.area_ids ?? [], position: group.position,
      pending_review: group.pending_review ?? [], ...patch };
    return { ...body, pending_review: body.pending_review.filter((review) => body.area_ids.includes(review.saved_area_id)) };
  }

  async function act(fn) {
    if (busy) return;
    busy = true; error = '';
    try { await fn(); await onrefresh(); await reloadCase(); }
    catch (e) { error = e.message; }
    finally { busy = false; }
  }
  async function save(zone) {
    const owner = await ensureCase();
    const ring = zoneRing(zone);
    await api.post(`/api/cases/${owner.id}/analysis/areas`, { name: zone.name, colour: '#38bdf8',
      geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] } });
    zones = zones.filter((z) => z.id !== zone.id); drawing = 'select';
  }
  async function update(area, patch) {
    await api.put(`/api/cases/${caseId}/analysis/areas/${area.id}`, {
      name: area.name, colour: area.colour, geometry: area.geometry, position: area.position, ...patch,
    });
  }

  async function updateGroup(group, patch) {
    await api.put(`/api/cases/${caseId}/analysis/zones/${group.id}`, groupBody(group, patch));
  }

  function resolveReview(group, review, current) {
    const area_ids = current
      ? [...new Set(group.area_ids.map((id) => id === review.saved_area_id ? review.current_area_id : id))]
      : group.area_ids;
    const pending_review = (group.pending_review ?? []).filter((item) => item.saved_area_id !== review.saved_area_id);
    void act(() => updateGroup(group, { area_ids, pending_review }));
  }

  async function createGroup() {
    if (!newGroupName.trim()) return;
    const owner = await ensureCase();
    await api.post(`/api/cases/${owner.id}/analysis/zones`, {
      title: newGroupName.trim(), area_ids: [],
    });
    newGroupName = '';
    search = '';
    creatingGroup = false;
    await onrefresh(owner.id);
  }

  async function reorderGroups(fromId, toId) {
    if (fromId === toId) return;
    const ordered = [...groups];
    const from = ordered.findIndex((group) => group.id === fromId);
    const to = ordered.findIndex((group) => group.id === toId);
    if (from < 0 || to < 0) return;
    ordered.splice(to, 0, ordered.splice(from, 1)[0]);
    await act(async () => {
      for (const [position, group] of ordered.entries()) {
        if (group.position !== position) await updateGroup(group, { position });
      }
    });
  }

  async function changeMembership(areaId, fromId, toId, beforeId = null, add = false) {
    const next = new Map(groups.map((group) => [group.id, [...(group.area_ids ?? [])]]));
    if (toId === null) {
      for (const ids of next.values()) {
        const at = ids.indexOf(areaId);
        if (at >= 0) ids.splice(at, 1);
      }
    } else {
      if (!add && fromId && fromId !== toId) {
        const source = next.get(fromId);
        const at = source?.indexOf(areaId) ?? -1;
        if (at >= 0) source.splice(at, 1);
      }
      const target = next.get(toId);
      if (!target) return;
      const old = target.indexOf(areaId);
      if (old >= 0) target.splice(old, 1);
      const at = beforeId ? target.indexOf(beforeId) : -1;
      target.splice(at < 0 ? target.length : at, 0, areaId);
    }
    await act(async () => {
      for (const group of groups) {
        const ids = next.get(group.id);
        if (ids.join('\0') !== (group.area_ids ?? []).join('\0')) await updateGroup(group, { area_ids: ids });
      }
      if (toId === null) {
        const ordered = [...ungrouped];
        const area = areas.find((entry) => entry.id === areaId);
        if (area && !ordered.some((entry) => entry.id === areaId)) {
          const at = beforeId ? ordered.findIndex((entry) => entry.id === beforeId) : -1;
          ordered.splice(at < 0 ? ordered.length : at, 0, area);
          for (const [position, entry] of ordered.entries()) {
            if (entry.position !== position) await update(entry, { position });
          }
        }
      }
    });
  }

  function removeFromGroup(areaId, group) {
    const ids = (group.area_ids ?? []).filter((id) => id !== areaId);
    void act(() => updateGroup(group, { area_ids: ids }));
  }

  async function reorderUngrouped(fromId, toId, after = false) {
    if (fromId === toId) return;
    const moved = ungrouped.find((area) => area.id === fromId);
    const ordered = ungrouped.filter((area) => area.id !== fromId);
    const to = ordered.findIndex((area) => area.id === toId);
    if (!moved || to < 0) return;
    ordered.splice(to + Number(after), 0, moved);
    await act(async () => {
      for (const [position, area] of ordered.entries()) {
        if (area.position !== position) await update(area, { position });
      }
    });
  }

  function shiftArea(areaId, groupId, step) {
    const siblings = groupId ? members(groups.find((group) => group.id === groupId)) : ungrouped;
    const index = siblings.findIndex((area) => area.id === areaId);
    if (index + step < 0 || index + step >= siblings.length) return;
    if (groupId) {
      const before = step < 0 ? siblings[index - 1].id : siblings[index + 2]?.id ?? null;
      void changeMembership(areaId, groupId, groupId, before);
    } else {
      void reorderUngrouped(areaId, siblings[index + step].id, step > 0);
    }
  }

  function startDrag(event, item) {
    if (busy) { event.preventDefault(); return; }
    dragging = item;
    landing = null;
    event.dataTransfer?.setData('text/plain', item.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  function dragOverArea(event, areaId, groupId) {
    if (dragging?.kind !== 'area') return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const bounds = event.currentTarget.getBoundingClientRect();
    landing = dragging.id === areaId ? null : {
      kind: 'area', id: areaId, groupId, after: event.clientY > bounds.top + bounds.height / 2,
    };
  }

  function dragOverGroup(event, groupId) {
    if (!dragging || (groupId === null && dragging.kind !== 'area')) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    if (dragging.kind === 'area') {
      landing = dragging.from === groupId && groupId === null ? null : { kind: 'group', id: groupId, area: true };
    } else {
      const from = groups.findIndex((group) => group.id === dragging.id);
      const to = groups.findIndex((group) => group.id === groupId);
      landing = from < 0 || to < 0 || from === to ? null : {
        kind: 'group', id: groupId, area: false, after: from < to,
      };
    }
  }

  function leaveDrop(event) {
    if (!event.currentTarget.contains(event.relatedTarget)) landing = null;
  }

  function endDrag() {
    dragging = null;
    landing = null;
  }

  function dropOnGroup(event, groupId) {
    event.preventDefault();
    const item = dragging;
    endDrag();
    if (item?.kind === 'group') void reorderGroups(item.id, groupId);
    if (item?.kind === 'area') void changeMembership(item.id, item.from, groupId);
  }

  function dropOnArea(event, areaId, groupId) {
    event.preventDefault();
    event.stopPropagation();
    const item = dragging;
    endDrag();
    if (item?.kind !== 'area' || item.id === areaId) return;
    const target = event.currentTarget.getBoundingClientRect();
    const after = event.clientY > target.top + target.height / 2;
    const siblings = groupId ? members(groups.find((group) => group.id === groupId)) : ungrouped;
    const index = siblings.findIndex((area) => area.id === areaId);
    const beforeId = after ? siblings[index + 1]?.id ?? null : areaId;
    if (groupId === null && item.from === null) void reorderUngrouped(item.id, areaId, after);
    else void changeMembership(item.id, item.from, groupId, beforeId);
  }
  /** The area put on the map as a shape to drag, in place of its own outline. */
  function reshape(area) {
    reshaping = { area, wasHidden: hidden.includes(area.id) };
    zones = [...zones.filter((zone) => zone.id !== area.id),
      { id: area.id, name: area.name, kind: 'polygon', points: area.geometry.coordinates[0].slice(0, -1) }];
    if (!reshaping.wasHidden) hidden = [...hidden, area.id];
    drawing = 'select';
    selectedZone = area.id;
    editing = null;
    onframe(ringOf(area));
  }

  function endReshape() {
    if (!reshaping) return;
    const { area, wasHidden } = reshaping;
    zones = zones.filter((zone) => zone.id !== area.id);
    if (!wasHidden) hidden = hidden.filter((id) => id !== area.id);
    if (selectedZone === area.id) selectedZone = null;
    reshaping = null;
  }

  async function saveShape(asNew) {
    const { area } = reshaping;
    const ring = zoneRing(zones.find((zone) => zone.id === area.id));
    const geometry = { type: 'Polygon', coordinates: [[...ring, ring[0]]] };
    if (asNew) {
      await api.post(`/api/cases/${caseId}/analysis/areas`, { name: `${area.name} · new shape`, colour: area.colour, geometry });
    } else {
      await update(area, { geometry });
    }
    endReshape();
  }

  // Leaving the tab halfway puts the area back as it was.
  $effect(() => () => untrack(endReshape));

  const toggle = (id) => (hidden = hidden.includes(id) ? hidden.filter((value) => value !== id) : [...hidden, id]);
  /** A group's eye: one of its areas on the map shows as on, and hides them all. */
  function toggleGroup(group) {
    const ids = members(group).map((area) => area.id);
    const anyShown = ids.some((id) => !hidden.includes(id));
    hidden = anyShown ? [...new Set([...hidden, ...ids])] : hidden.filter((id) => !ids.includes(id));
  }

  function closeMenu() {
    if (openMenu) openMenu.open = false;
    openMenu = null;
  }
  function menuToggled(event) {
    const menu = event.currentTarget;
    if (menu.open) {
      if (openMenu && openMenu !== menu) openMenu.open = false;
      openMenu = menu;
    } else if (openMenu === menu) {
      openMenu = null;
    }
  }
  $effect(() => (openMenu ? closeOnOutsidePointer(openMenu, closeMenu) : undefined));
  const chose = (event) => { if (event.target.closest('button')) closeMenu(); };
  const menuKey = (event) => { if (event.key === 'Escape' && openMenu) closeMenu(); };
</script>

<svelte:window onkeydown={menuKey} />

<div class="area-actions primary-tools">
  <button class="btn btn-sm" class:active={drawing === 'polygon'}
    onclick={() => (drawing = drawing === 'polygon' ? 'select' : 'polygon')}>Draw an area</button>
  <button class="btn btn-sm" onclick={onusecurrentview}>Use current view</button>
  {#if areas.length > 1}
    <button class="btn btn-sm" onclick={() => onframe(areas.flatMap(ringOf))}>Show all</button>
  {/if}
</div>
<div class="area-actions list-tools">
  <input aria-label="Search areas or groups" placeholder="Search areas or groups…" bind:value={search} />
  <button class="btn btn-sm" onclick={() => (creatingGroup = !creatingGroup)}>New group</button>
</div>
{#if creatingGroup}
  <div class="area-actions">
    <input aria-label="New group name" bind:value={newGroupName} maxlength="120" />
    <button class="btn btn-sm btn-primary" disabled={busy || !newGroupName.trim()}
      onclick={() => act(createGroup)}>Create</button>
  </div>
{/if}
{#if error}<p class="warn" role="alert">{error}</p>{/if}
{#if drawing === 'polygon'}<p class="hint">Click corners; Enter finishes, Escape cancels.</p>{/if}

{#if reshaping}
  {@const watching = usedBy(reshaping.area)}
  <div class="reshape" role="group" aria-label={`Reshaping ${reshaping.area.name}`}>
    <p><strong>{reshaping.area.name}</strong> · drag its corners on the map.</p>
    <p class="hint">{watching
      ? `${plural(watching, 'routine')} ${watching === 1 ? 'watches' : 'watch'} it: the next runs sweep the new shape.`
      : 'No routine watches it yet.'} Finished runs keep the ground they swept.</p>
    <div class="area-actions">
      <button class="btn btn-sm btn-primary" disabled={busy} onclick={() => act(() => saveShape(false))}>Save shape</button>
      <button class="btn btn-sm" disabled={busy} title="Keep this area as it was, and its routines on it"
        onclick={() => act(() => saveShape(true))}>Save as a new area</button>
      <button class="btn btn-sm" disabled={busy} onclick={endReshape}>Cancel</button>
    </div>
  </div>
{/if}

{#each zones.filter((zone) => zone.id !== reshaping?.area.id) as zone (zone.id)}
  <div class="draft">
    <input aria-label="Area name" bind:value={zone.name} maxlength="120" />
    <button class="btn btn-sm btn-primary" disabled={busy} onclick={() => act(() => save(zone))}>Save as area</button>
  </div>
{/each}

{#if !areas.length}
  <div class="empty">
    <p>No shared area in this case yet.</p>
    <p class="hint">Draw one here and every routine can watch it.</p>
  </div>
{/if}

{#snippet areaRow(area, groupId)}
  {@const off = hidden.includes(area.id)}
  <div class="area-row" role="group" aria-label={area.name} class:selected={selectedArea === area.id} class:off
    class:dragging={dragging?.kind === 'area' && dragging.id === area.id && dragging.from === groupId}
    class:landing-before={landing?.kind === 'area' && landing.id === area.id && landing.groupId === groupId && !landing.after}
    class:landing-after={landing?.kind === 'area' && landing.id === area.id && landing.groupId === groupId && landing.after}
    ondragover={(event) => dragOverArea(event, area.id, groupId)}
    ondragleave={leaveDrop}
    ondrop={(event) => dropOnArea(event, area.id, groupId)}>
    <button class="drag-handle" draggable="true" aria-label={`Drag ${area.name}`}
      ondragstart={(event) => startDrag(event, { kind: 'area', id: area.id, from: groupId })}
      ondragend={endDrag}>⠿</button>
    <button class="cmp-icon" aria-label={off ? `Show ${area.name}` : `Hide ${area.name}`} aria-pressed={!off}
      title={off ? 'Show on the map' : 'Hide on the map'} onclick={() => toggle(area.id)}>
      <Icon name={off ? 'eyeOff' : 'eye'} size={14} />
    </button>
    <span class="swatch" style={`--tint: ${area.colour}`}></span>
    <button class="name" title="Frame this area" onclick={() => onframe(ringOf(area))}>
      <strong>{area.name}</strong>
      <small>{size(area)}{usedBy(area) ? ` · ${plural(usedBy(area), 'routine')}` : ''}</small>
    </button>
    <button class="cmp-icon" aria-label={`Edit ${area.name}`} title="Rename, recolour or reshape"
      onclick={() => (editing = editing === area.id ? null : area.id)}><Icon name="edit" size={13} /></button>
    <details class="item-menu" ontoggle={menuToggled}>
      <summary aria-label={`More actions for ${area.name}`} title="More actions">⋯</summary>
      <div class="menu-content" role="presentation" onclick={chose} onchange={closeMenu}>
        <button disabled={busy} onclick={() => shiftArea(area.id, groupId, -1)}>Move up</button>
        <button disabled={busy} onclick={() => shiftArea(area.id, groupId, 1)}>Move down</button>
        {#if groups.some((group) => !group.area_ids?.includes(area.id))}
          <select aria-label={`Add ${area.name} to group`} disabled={busy}
            onchange={(event) => { if (event.currentTarget.value) void changeMembership(area.id, groupId, event.currentTarget.value, null, true); event.currentTarget.value = ''; }}>
            <option value="">Add to group…</option>
            {#each groups.filter((group) => !group.area_ids?.includes(area.id)) as group (group.id)}
              <option value={group.id}>{group.title}</option>
            {/each}
          </select>
        {/if}
        <select aria-label={`Move ${area.name} to group`} disabled={busy}
          onchange={(event) => { const value = event.currentTarget.value; if (value) void changeMembership(area.id, groupId, value === 'ungrouped' ? null : value); event.currentTarget.value = ''; }}>
          <option value="">Move to…</option>
          <option value="ungrouped">Ungrouped</option>
          {#each groups.filter((group) => group.id !== groupId) as group (group.id)}
            <option value={group.id}>{group.title}</option>
          {/each}
        </select>
        {#if groupId}
          <button disabled={busy} onclick={() => removeFromGroup(area.id, groups.find((group) => group.id === groupId))}>Remove from this group</button>
        {/if}
        <button disabled={busy} onclick={() => (removing = area)}>Delete area</button>
      </div>
    </details>
  </div>
  {#if editing === area.id}
    <div class="edit">
      <input type="color" aria-label={`Colour of ${area.name}`} value={area.colour} disabled={busy}
        onchange={(e) => act(() => update(area, { colour: e.currentTarget.value }))} />
      <input aria-label={`Rename ${area.name}`} value={area.name} maxlength="120" disabled={busy}
        onchange={(e) => act(() => update(area, { name: e.currentTarget.value }))} />
      <button class="btn btn-sm" disabled={busy || !!reshaping} onclick={() => reshape(area)}>Reshape on the map</button>
    </div>
  {/if}
{/snippet}

{#each groups as group, index (group.id)}
  {@const matched = members(group).filter((area) => !search || matches(group.title) || matches(area.name))}
  {#if !search || matches(group.title) || matched.length}
    <section class="area-group" aria-label={group.title}>
      <div class="group-head" role="group" aria-label={`Drop into ${group.title}`}
        class:dragging={dragging?.kind === 'group' && dragging.id === group.id}
        class:landing-area={landing?.kind === 'group' && landing.id === group.id && landing.area}
        class:landing-before={landing?.kind === 'group' && landing.id === group.id && !landing.area && !landing.after}
        class:landing-after={landing?.kind === 'group' && landing.id === group.id && !landing.area && landing.after}
        ondragover={(event) => dragOverGroup(event, group.id)}
        ondragleave={leaveDrop}
        ondrop={(event) => dropOnGroup(event, group.id)}>
        <button class="drag-handle" draggable="true" aria-label={`Drag group ${group.title}`}
          ondragstart={(event) => startDrag(event, { kind: 'group', id: group.id })}
          ondragend={endDrag}>⠿</button>
        <button class="fold" aria-expanded={open(group)}
          onclick={() => (unfolded = { ...unfolded, [group.id]: !unfolded[group.id] })}>
          <Icon name={open(group) ? 'chevronDown' : 'chevronRight'} size={12} />
          <span class="group-icon"><Icon name={open(group) ? 'folderOpen' : 'folder'} size={15} /></span>
          <strong class="group-title">{group.title}</strong>
          <!-- The colours its areas are drawn in, so a folded group still reads as its ground. -->
          <span class="group-tints" aria-hidden="true">
            {#each members(group).slice(0, 5) as area (area.id)}<span class="swatch" style={`--tint: ${area.colour}`}></span>{/each}
          </span>
          <small class="group-count">{members(group).length}</small>
        </button>
        {#if members(group).length}
          {@const off = members(group).every((area) => hidden.includes(area.id))}
          <button class="cmp-icon" aria-label={off ? `Show group ${group.title}` : `Hide group ${group.title}`}
            aria-pressed={!off} title={off ? 'Show its areas on the map' : 'Hide its areas on the map'}
            onclick={() => toggleGroup(group)}>
            <Icon name={off ? 'eyeOff' : 'eye'} size={14} />
          </button>
        {/if}
        <details class="item-menu" ontoggle={menuToggled}>
          <summary aria-label={`More actions for group ${group.title}`} title="More actions">⋯</summary>
          <div class="menu-content" role="presentation" onclick={chose}>
            <button disabled={busy || index === 0} onclick={() => reorderGroups(group.id, groups[index - 1].id)}>Move up</button>
            <button disabled={busy || index === groups.length - 1} onclick={() => reorderGroups(group.id, groups[index + 1].id)}>Move down</button>
            <button onclick={() => (editingGroup = editingGroup === group.id ? null : group.id)}>Rename group</button>
            <button disabled={busy} onclick={() => (removingGroup = group)}>Delete group</button>
          </div>
        </details>
      </div>
      {#if editingGroup === group.id}
        <div class="edit"><input aria-label={`Rename group ${group.title}`} value={group.title} maxlength="120"
          onchange={(event) => { const title = event.currentTarget.value.trim(); if (title) void act(() => updateGroup(group, { title })); }} /></div>
      {/if}
      {#if group.pending_review?.length}
        <div class="group-review">
          <p>Choose which shape this group should use.</p>
          {#each group.pending_review as review (review.saved_area_id)}
            {@const savedArea = areas.find((area) => area.id === review.saved_area_id)}
            {@const currentArea = areas.find((area) => area.id === review.current_area_id)}
            <div><strong>{review.name}</strong>
              {#if savedArea}<button class="link" onclick={() => onframe(ringOf(savedArea))}>Show saved</button>{/if}
              {#if currentArea}<button class="link" onclick={() => onframe(ringOf(currentArea))}>Show current</button>{/if}
              <button class="btn btn-sm" disabled={busy} onclick={() => resolveReview(group, review, false)}>Keep saved</button>
              <button class="btn btn-sm" disabled={busy || !currentArea}
                onclick={() => resolveReview(group, review, true)}>Use current</button>
            </div>
          {/each}
        </div>
      {/if}
      {#if open(group) && matched.length}
        <div class="group-members">
          {#each matched as area (area.id)}{@render areaRow(area, group.id)}{/each}
        </div>
      {:else if open(group) && !members(group).length}
        <p class="hint group-empty">Empty. Drag an area here.</p>
      {/if}
    </section>
  {/if}
{/each}

{#if visibleUngrouped.length || (!search && (areas.length || groups.length))}
  <section class="area-group ungrouped" aria-label="Ungrouped">
    <div class="ungrouped-head" role="group" aria-label="Drop into Ungrouped"
      class:landing-area={landing?.kind === 'group' && landing.id === null && landing.area}
      ondragover={(event) => dragOverGroup(event, null)}
      ondragleave={leaveDrop}
      ondrop={(event) => dropOnGroup(event, null)}><strong>Ungrouped</strong><small>{plural(visibleUngrouped.length, 'area')}</small></div>
    {#each visibleUngrouped as area (area.id)}{@render areaRow(area, null)}{/each}
  </section>
{/if}

{#if removing}
  <Modal title={`Delete ${removing.name}?`} onclose={() => (removing = null)}>
    {#if users.length}
      <p>Remove this area from these routines first:</p>
      <ul>{#each users as routine (routine.id)}<li>{routine.title}</li>{/each}</ul>
    {:else}
      <p>The area moves to Trash. Existing runs keep their own copy.</p>
      <button class="btn btn-danger" disabled={busy} onclick={() => act(async () => {
        await api.del(`/api/cases/${caseId}/analysis/areas/${removing.id}`); removing = null;
      })}>Move to Trash</button>
    {/if}
    {#if error}<p class="warn" role="alert">{error}</p>{/if}
  </Modal>
{/if}

{#if removingGroup}
  <Modal title={`Delete ${removingGroup.title}?`} onclose={() => (removingGroup = null)}>
    <p>The areas stay in this case.</p>
    <button class="btn btn-danger" disabled={busy} onclick={() => act(async () => {
      await api.del(`/api/cases/${caseId}/analysis/zones/${removingGroup.id}`); removingGroup = null;
    })}>Move group to Trash</button>
  </Modal>
{/if}

<style>
  .area-actions, .draft, .edit { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .primary-tools { padding-bottom: 10px; border-bottom: 1px solid var(--border); }
  .list-tools { flex-wrap: nowrap; padding: 4px 0 10px; }
  .list-tools input { min-width: 0; }
  .draft, .edit { padding: 7px 0; }
  .area-group { display: grid; gap: 0; margin-top: 8px; }
  /* A group is a band and its areas hang off a rail under it, so a folder
     never reads as one more area in the list. */
  .group-members { margin: 2px 0 4px 12px; padding-left: 6px; border-left: 2px solid var(--border-strong); }
  .group-members > .area-row:last-child { border-bottom: 0; }
  .group-empty { margin: 4px 0 2px 20px; }
  .group-head, .ungrouped-head { position: relative; display: flex; align-items: center; gap: 5px;
    min-height: 36px; padding: 3px 5px; border-radius: var(--r-sm);
    transition: background 120ms ease, box-shadow 120ms ease, opacity 120ms ease; }
  .group-head { background: var(--bg-2); }
  .group-head:hover { background: var(--bg-3); }
  .group-head.dragging, .area-row.dragging { opacity: 0.42; }
  .group-head.landing-area, .ungrouped-head.landing-area {
    background: var(--accent-soft); box-shadow: inset 0 0 0 2px var(--accent); }
  .group-head.landing-before, .area-row.landing-before { box-shadow: inset 0 3px 0 var(--accent); }
  .group-head.landing-after, .area-row.landing-after { box-shadow: inset 0 -3px 0 var(--accent); }
  .ungrouped-head { margin-top: 6px; border-bottom: 1px solid var(--border); color: var(--text-2); }
  .ungrouped-head > strong { flex: 1; font-size: var(--fs-xs); font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
  .ungrouped-head small { color: var(--text-3); font-size: 10px; }
  .fold { display: flex; flex: 1; align-items: center; gap: 6px; min-width: 0; text-align: left; font-size: var(--fs-xs); }
  .group-icon { display: grid; place-items: center; flex: 0 0 auto; color: var(--accent); }
  .group-title { flex: 0 1 auto; min-width: 0; overflow: hidden; font-size: var(--fs-sm); font-weight: 650;
    text-overflow: ellipsis; white-space: nowrap; }
  .group-tints { display: flex; flex: 1; gap: 2px; min-width: 0; }
  .group-tints .swatch { width: 7px; height: 7px; }
  .group-count { flex: 0 0 auto; min-width: 18px; padding: 0 5px; border-radius: 9px; background: var(--bg-1);
    color: var(--text-2); font-size: 10.5px; line-height: 16px; text-align: center; font-variant-numeric: tabular-nums; }
  .drag-handle { flex: 0 0 auto; width: 16px; padding: 0; cursor: grab; color: var(--text-3); font-size: 14px; }
  .drag-handle:active { cursor: grabbing; }
  .item-menu { position: relative; flex: 0 0 auto; }
  .item-menu summary { display: grid; place-items: center; width: 20px; height: 22px; cursor: pointer;
    color: var(--text-2); list-style: none; }
  .item-menu summary::-webkit-details-marker { display: none; }
  .menu-content { position: absolute; right: 0; top: 22px; z-index: 20; display: grid; gap: 3px;
    min-width: 174px; padding: 6px; border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-1); box-shadow: 0 4px 18px #0003; }
  .menu-content button, .menu-content select { width: 100%; padding: 5px 6px; text-align: left;
    font-size: var(--fs-xs); }
  .menu-content button:hover { background: var(--bg-2); }
  .group-review { display: grid; gap: 5px; padding: 7px; border: 1px solid var(--accent);
    border-radius: var(--r-sm); background: var(--accent-soft); }
  .group-review p { margin: 0; font-size: var(--fs-xs); }
  .group-review > div { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; }
  .group-review strong { flex: 1; min-width: 80px; font-size: var(--fs-xs); }
  .reshape {
    display: grid;
    gap: 6px;
    padding: 8px 9px;
    border: 1px solid var(--accent);
    border-radius: var(--r-sm);
    background: var(--accent-soft);
  }
  .reshape p { margin: 0; font-size: var(--fs-xs); }
  .area-row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 4px;
    border-bottom: 1px solid var(--border);
    border-radius: var(--r-sm);
    transition: background 120ms ease, box-shadow 120ms ease, opacity 120ms ease;
  }
  @media (prefers-reduced-motion: reduce) {
    .area-row, .group-head, .ungrouped-head { transition: none; }
  }
  .area-row:hover { background: var(--bg-2); }
  .area-row.selected { background: var(--accent-soft); }
  .area-row.off .name { opacity: 0.55; }
  .swatch { flex: 0 0 auto; width: 9px; height: 9px; border-radius: 2px; background: var(--tint); }
  .name { display: grid; flex: 1; gap: 1px; min-width: 0; text-align: left; }
  .name strong { overflow: hidden; font-size: var(--fs-sm); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .name small { color: var(--text-2); font-size: var(--fs-xs); }
  .name:hover strong { color: var(--accent); }
  .empty {
    display: grid;
    gap: 7px;
    padding: 18px 4px;
    border-top: 1px solid var(--border);
    text-align: left;
  }
  .empty p { margin: 0; font-size: var(--fs-sm); color: var(--text-2); }
  input:not([type]) { flex: 1; width: 100px; }
  input[type='color'] { width: 26px; height: 26px; padding: 0; }
  .active { outline: 1px solid var(--accent); }
</style>
