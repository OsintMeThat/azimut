<script>
  /**
   * What one point of a proof can do besides being moved on the map: join one
   * of the analyst's layers, become the conclusion, or go. Going is a trash
   * button of its own beside the menu, in plain sight, on every point but the
   * first.
   *
   * Joining a layer goes a step at a time, in the one menu (`LayerTargetSteps`):
   * the layer, its group, then the marker's icon when the group's features each
   * have their own. A proof with unsaved changes is saved first, since the
   * marker follows the proof as saved; a point the imagery only proposed is
   * checked on the map first.
   */
  import Icon from '../../components/Icon.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import LayerTargetSteps from '../satellite/LayerTargetSteps.svelte';

  let {
    index, coords = '', proposed = false, canSave = true, unsaved = false, busy = false, caseId = null,
    /** The case's layers, the one used last first, and the `layer|group` keys this point is already in. */
    targets = [], held = new Set(),
    onadd, oncreate, oncheck, onraise = null, onremove = null,
  } = $props();
  let open = $state(false);
  let anchor = $state(null);
  /** Where the menu stands: the layers (null), a layer's groups, or a group's icon. */
  let step = $state(null);
  const label = $derived(`Point ${index + 1} actions`);
  const ready = $derived(!!coords.trim() && !proposed && canSave);

  function close() { open = false; step = null; }
  /** Close, then run: what `run` needs is read before, since closing resets the step. */
  function act(run) { close(); run(); }
</script>

<!-- Joining a layer is what the menu is mostly for, so it wears the layers icon,
     on a button with a face like the eye beside it so it reads as one to press. -->
<button type="button" class="point-more" aria-label={label} title="Layers and more" aria-expanded={open} bind:this={anchor}
  onclick={() => (open ? close() : (open = true))}><Icon name="layers" size={14} /></button>
{#if onremove}
  <button type="button" class="point-more point-remove" aria-label={`Remove point ${index + 1}`} title="Remove this point"
    onclick={() => { close(); onremove(); }}><Icon name="trash" size={13} /></button>
{/if}

{#if open}
  <FloatingMenu {anchor} align="end" width={step?.group ? 264 : 248} {label} onclose={close}>
    {#if !step}
      <p class="fm-head">Add to a layer</p>
      {#if !coords.trim()}
        <p class="fm-note">Write the point first.</p>
      {:else if proposed}
        <button type="button" class="fm-item" onclick={() => act(oncheck)}>
          <Icon name="crosshair" size={14} /><span class="fm-grow">Check this point on the map first</span></button>
      {:else if !canSave}
        <p class="fm-note">Add a picture first. The proof is saved before its point joins a layer.</p>
      {/if}
    {/if}
    {#if ready}
      <LayerTargetSteps bind:step {targets} {held} {busy} {caseId} {oncreate} onadd={(choice) => act(() => onadd(choice))} />
    {/if}
    {#if !step}
      {#if ready && unsaved}<p class="fm-note">The proof is saved first, so the layer follows what it says.</p>{/if}
      {#if onraise}
        <div class="fm-sep"></div>
        <button type="button" class="fm-item" onclick={() => act(onraise)}>
          <Icon name="chevronUp" size={14} /><span class="fm-grow">Make it the conclusion</span></button>
      {/if}
    {/if}
  </FloatingMenu>
{/if}

<style>
  .point-more {
    display: grid; place-items: center; flex: none; width: 28px; align-self: stretch; min-height: 28px;
    border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-3); color: var(--text-3); cursor: pointer;
    transition: color 0.12s var(--ease), border-color 0.12s var(--ease);
  }
  .point-more:hover { color: var(--text-1); border-color: var(--text-3); }
  .point-more[aria-expanded='true'] { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
  .point-remove:hover { color: var(--danger, #e05c5c); border-color: var(--danger, #e05c5c); }
</style>
