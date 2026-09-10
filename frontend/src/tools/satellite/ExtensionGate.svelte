<script>
  /**
   * The Google widget basemap can only be captured through the browser
   * extension: screen pixels are the only thing Google's terms allow out of the
   * widget, and the extension is the promptless way to get them.
   *
   * So this explains it and points at Settings. Never a half-working share flow,
   * and never a quiet fallback to filing some other image instead.
   */
  import Modal from '../../components/Modal.svelte';

  let { onclose, onsettings } = $props();
</script>

<Modal title="Capture needs the browser extension" {onclose} width="460px">
  <p class="gate-hint">
    Google's terms allow nothing programmatic out of this basemap. A capture
    here is a <strong>screenshot of the tab</strong>, and the Azimut Capture
    extension is what takes it (one grab per click, no screen-share prompt,
    works in fullscreen). Other basemaps are not affected.
  </p>
  <p class="gate-hint">
    Install it from <strong>Settings → Capture extension</strong>, then reload
    this tab.
  </p>
  <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
    <button class="btn" onclick={onclose}>Cancel</button>
    <button class="btn btn-primary" onclick={onsettings}>Open Settings</button>
  </div>
</Modal>

<style>
  .gate-hint {
    font-size: var(--fs-sm);
    color: var(--text-2);
    margin: 0 0 12px;
  }
</style>
