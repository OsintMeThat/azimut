<script>
  /**
   * Said once, on arriving in Post without the capture extension: why it is worth having
   * here. It fills the whole thread in the site's own composer, pictures included, and
   * can reply under the source post or capture it into the case. Nothing is blocked
   * without it: Copy and Publish still work, and the header keeps a quiet line.
   */
  import Modal from '../../components/Modal.svelte';
  import Icon from '../../components/Icon.svelte';

  let { oninstall, onlater } = $props();
</script>

<Modal title="Post works best with the extension" width="480px" onclose={() => onlater?.()}>
  <div class="ew">
    <span class="ew-mark" aria-hidden="true"><Icon name="crop" size={26} /></span>
    <p>
      The capture extension fills the whole thread in X or Bluesky, pictures included, and
      can reply under the source post or capture it into the case. Pressing Post stays yours.
    </p>
    <p class="ew-quiet">Without it, Copy and Publish work as they always have.</p>
    <div class="ew-actions">
      <button type="button" class="btn" onclick={() => onlater?.()}>Not now</button>
      <button type="button" class="btn btn-primary" onclick={() => oninstall?.()}>
        <Icon name="download" size={14} /> How to install
      </button>
    </div>
  </div>
</Modal>

<style>
  .ew { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
  .ew-mark {
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent);
  }
  p { margin: 0; color: var(--text-1); font-size: var(--fs-sm); line-height: 1.55; }
  .ew-quiet { color: var(--text-3); font-size: var(--fs-xs); }
  .ew-actions { display: flex; justify-content: flex-end; gap: 8px; align-self: stretch; margin-top: 6px; }
</style>
