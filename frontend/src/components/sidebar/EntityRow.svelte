<script>
  // One entity row. The folder tree and the result list render the same row, so
  // it is a component rather than a snippet owned by either of them.
  import { ENTITY_TOOL, gotoCapture } from '../../lib/navigate.js';
  import { fileUrl } from '../../lib/fileUrl.js';
  import { folderOf } from '../../lib/folderTree.js';
  import { entityIcon } from '../../lib/entityIcon.js';
  import Icon from '../Icon.svelte';

  let {
    entity,
    caseId,
    depth = 0,
    meta = null,
    suggested = false,
    dragging = false,
    selected = false,
    onactivate = () => {},
    oninfo = () => {},
    onunfile = () => {},
    onconfirm = () => {},
    ondismiss = () => {},
    ondragstart = () => {},
    ondragend = () => {},
  } = $props();

  const isClickable = $derived(
    entity.type === 'note' || entity.type === 'capture' || !!ENTITY_TOOL[entity.type]
  );
</script>

<!-- The role and tab stop deliberately exist only for activatable entity types. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="entity"
  class:suggested
  class:clickable={isClickable}
  class:dragging
  class:selected
  style="padding-left: {8 + depth * 14}px"
  draggable={!suggested}
  ondragstart={(ev) => ondragstart(ev, entity)}
  ondragend={() => ondragend()}
  onclick={(ev) => onactivate(entity, ev)}
  role={isClickable ? 'button' : undefined}
  tabindex={isClickable ? 0 : undefined}
  onkeydown={(ev) => ev.key === 'Enter' && onactivate(entity, ev)}
>
  {#if !suggested}<Icon name="grip" size={13} />{/if}
  {#if entity.thumb}
    <img class="entity-thumb" src={fileUrl(caseId, entity.thumb)} alt="" loading="lazy" />
  {:else}
    <Icon name={entityIcon(entity)} size={14} />
  {/if}
  <div class="e-body">
    <span class="e-label">{entity.label}</span>
    <span class="e-meta">{meta ?? entity.type}</span>
  </div>

  {#if suggested}
    <button class="btn btn-ghost btn-sm" title="Confirm" onclick={(ev) => { ev.stopPropagation(); onconfirm(entity); }}>
      <Icon name="check" size={13} />
    </button>
    <button class="btn btn-ghost btn-sm" title="Dismiss" onclick={(ev) => { ev.stopPropagation(); ondismiss(entity); }}>
      <Icon name="x" size={13} />
    </button>
  {:else}
    {#if entity.type === 'capture' && entity.attrs?.lat != null}
      <button
        class="btn btn-ghost btn-sm act"
        title="Go to these coordinates on the map"
        onclick={(ev) => { ev.stopPropagation(); gotoCapture(entity); }}
      >
        <Icon name="crosshair" size={13} />
      </button>
    {/if}
    {#if entity.type === 'media' && entity.attrs?.path}
      <a
        class="btn btn-ghost btn-sm act"
        title="Open in new tab"
        href={fileUrl(caseId, entity.attrs.path)}
        target="_blank"
        rel="noreferrer"
        onclick={(ev) => ev.stopPropagation()}
      >
        <Icon name="external" size={13} />
      </a>
    {/if}
    <button
      class="btn btn-ghost btn-sm act"
      title="Details"
      onclick={(ev) => { ev.stopPropagation(); oninfo(entity); }}
    >
      <Icon name="note" size={13} />
    </button>
    {#if folderOf(entity)}
      <button
        class="btn btn-ghost btn-sm act del"
        title="Unfile from this folder"
        onclick={(ev) => { ev.stopPropagation(); onunfile(entity); }}
      >
        <Icon name="folderMinus" size={13} />
      </button>
    {/if}
  {/if}
</div>

<style>
  .entity {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 6px 8px;
    border-radius: var(--r-sm);
    color: var(--text-2);
  }
  .entity:hover { background: var(--bg-2); }
  .entity.clickable { cursor: pointer; }
  .entity.dragging { opacity: 0.5; }
  .entity.selected { background: var(--accent-soft); box-shadow: inset 2px 0 0 var(--accent); }
  .entity > :global(svg:first-child) { color: var(--text-3); flex-shrink: 0; }
  .entity:not(.suggested) > :global(svg:first-child) { cursor: grab; }
  .entity.suggested {
    background: var(--accent-soft);
    border: 1px dashed var(--accent);
    margin-bottom: 4px;
  }
  .e-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .entity-thumb {
    width: 28px;
    height: 28px;
    flex: 0 0 28px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    object-fit: cover;
    background: var(--bg-2);
  }
  .e-label {
    font-size: var(--fs-sm);
    color: var(--text-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .e-meta {
    font-size: var(--fs-xs);
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .act { opacity: 0; flex-shrink: 0; }
  .entity:hover .act { opacity: 1; }
  .del:hover { color: var(--danger, #e55); }
</style>
