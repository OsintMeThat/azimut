<script>
  /**
   * The way to an update, the same in the startup pop-up, on Home and in
   * Settings → System: the binary for this system straight from the release when
   * there is one, and the release page either way. A pip install updates from a
   * terminal (UpdateSteps), so its release page stays the quiet button.
   *
   * Pressing the download hands the file to the browser, which says nothing back
   * when it finishes, so `onstart` fires on the press and the host shows the
   * steps (UpdateSteps) from then on.
   */
  import Icon from './Icon.svelte';
  import { downloadInPlace, systemLabel } from '../lib/updateSteps.js';

  let { update, onstart, dot = false } = $props();

  const download = $derived(update?.download_url ?? '');

  // A plain press downloads in place; a middle or modified press keeps what the
  // link would do anywhere else.
  function press(event) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    downloadInPlace(download);
    onstart?.();
  }
</script>

{#if download}
  <a class="btn btn-sm btn-primary dotted" href={download} rel="noreferrer" onclick={press}>
    <Icon name="download" size={13} /> Download for {systemLabel(update.install?.system)}
    {#if dot}<span class="update-dot" aria-label="an update is waiting"></span>{/if}
  </a>
{/if}
<a
  class="btn btn-sm dotted"
  class:btn-primary={!download && update?.install?.kind !== 'package'}
  href={update?.url}
  target="_blank"
  rel="noreferrer"
>
  Release page <Icon name="external" size={11} />
  {#if dot && !download}<span class="update-dot" aria-label="an update is waiting"></span>{/if}
</a>
