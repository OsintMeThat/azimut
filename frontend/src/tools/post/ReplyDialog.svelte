<script>
  /**
   * Reply under a Bluesky post without the extension. Bluesky has no page that opens a
   * reply box with words in it, so this says so and does the next best thing in one
   * press: the reply is copied and the source post opens, to paste it under.
   */
  import Modal from '../../components/Modal.svelte';
  import Icon from '../../components/Icon.svelte';

  let { oncopy, oninstall, onclose } = $props();
</script>

<Modal title="Reply on Bluesky" width="460px" {onclose}>
  <p class="rd">Bluesky opens a reply box only through the capture extension. Copy the post, then paste it under the source.</p>
  <div class="rd-actions">
    <button type="button" class="btn btn-ghost" onclick={() => oninstall?.()}>How to install</button>
    <span class="rd-grow"></span>
    <button type="button" class="btn" onclick={() => onclose?.()}>Cancel</button>
    <button type="button" class="btn btn-primary" onclick={() => oncopy?.()}>
      <Icon name="copy" size={14} /> Copy and open the source
    </button>
  </div>
</Modal>

<style>
  .rd { margin: 0 0 14px; color: var(--text-1); font-size: var(--fs-sm); line-height: 1.55; }
  .rd-actions { display: flex; align-items: center; gap: 8px; }
  .rd-grow { flex: 1; }
</style>
