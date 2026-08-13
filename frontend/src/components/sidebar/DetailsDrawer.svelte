<script>
  // Zone 3: the selection editor, over the sidebar rather than under the tree.
  // The body is EntityDetails, unchanged — the Media Library modal shares it.
  import Icon from '../Icon.svelte';
  import ConfirmDialog from '../ConfirmDialog.svelte';
  import EntityDetails from '../EntityDetails.svelte';

  let { entity, onclose = () => {}, ondeleted = () => {} } = $props();

  function focus(node) { node.focus(); }

  // The panel's fields wait for Save, so the back arrow, the close button and
  // Escape ask before dropping an edit. The panel's own `onclose` is its hand-off
  // to another tool and closes without asking: it has already navigated.
  let dirty = $state(false);
  let discarding = $state(false);

  function requestClose() {
    if (dirty) discarding = true;
    else onclose();
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && requestClose()} />

<div class="drawer">
  <div class="drawer-head">
    <button class="btn btn-ghost btn-sm" title="Back to the case" onclick={requestClose} use:focus>
      <Icon name="chevronLeft" size={14} />
    </button>
    <span class="label">{entity.label}</span>
    <button class="btn btn-ghost btn-sm" title="Close details" onclick={requestClose}>
      <Icon name="x" size={13} />
    </button>
  </div>
  <div class="drawer-body">
    <EntityDetails entityId={entity.id} bind:dirty {onclose} {ondeleted} />
  </div>
</div>

{#if discarding}
  <ConfirmDialog
    title="Discard changes?"
    message="This item has edits that Save has not taken."
    confirmLabel="Discard"
    icon="alert"
    onconfirm={() => { discarding = false; dirty = false; onclose(); }}
    oncancel={() => (discarding = false)}
  />
{/if}

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
