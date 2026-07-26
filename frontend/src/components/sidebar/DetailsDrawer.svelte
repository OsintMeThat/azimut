<script>
  // Zone 3: the selection editor, over the sidebar rather than under the tree.
  // The body is EntityDetails, unchanged — the Media Library modal shares it.
  import Icon from '../Icon.svelte';
  import EntityDetails from '../EntityDetails.svelte';

  let { entity, onclose = () => {}, ondeleted = () => {} } = $props();

  function focus(node) { node.focus(); }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="drawer">
  <div class="drawer-head">
    <button class="btn btn-ghost btn-sm" title="Back to the case" onclick={onclose} use:focus>
      <Icon name="chevronLeft" size={14} />
    </button>
    <span class="label">{entity.label}</span>
    <button class="btn btn-ghost btn-sm" title="Close details" onclick={onclose}>
      <Icon name="x" size={13} />
    </button>
  </div>
  <div class="drawer-body">
    <EntityDetails entityId={entity.id} {onclose} {ondeleted} />
  </div>
</div>

<style>
  .drawer {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: flex;
    flex-direction: column;
    background: var(--bg-1);
  }
  .drawer-head {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 10px 8px;
    border-bottom: 1px solid var(--border);
  }
  .label {
    flex: 1;
    min-width: 0;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .drawer-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 6px 10px 12px;
    font-size: var(--fs-sm);
  }
</style>
