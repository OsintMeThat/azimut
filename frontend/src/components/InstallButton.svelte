<script>
  /**
   * Install and restart: the one press that installs a version the box downloaded,
   * the same in the pop-up, on Home and in Settings → System. Disabled, saying why,
   * until the version is ready and nothing is at work that a restart would cut short.
   */
  import Icon from './Icon.svelte';
  import { selfUpdate, installNow } from '../lib/selfUpdateState.svelte.js';
  import { INSTALL_LABEL, canInstall } from '../lib/selfUpdate.js';

  let { dot = false } = $props();
  let pressing = $state(false);

  const why = $derived(
    selfUpdate.busy ||
      (selfUpdate.state === 'ready' ? 'Closes Azimut and opens it again on the new version.' : 'Waits for the download to finish.'),
  );

  async function press() {
    pressing = true;
    try {
      await installNow();
    } finally {
      pressing = false;
    }
  }
</script>

<button
  class="btn btn-sm btn-primary dotted"
  disabled={!canInstall(selfUpdate) || pressing}
  aria-busy={pressing}
  title={why}
  onclick={press}
>
  <Icon name="rotateRight" size={12} />
  {INSTALL_LABEL}
  {#if dot}<span class="update-dot" aria-label="an update is waiting"></span>{/if}
</button>
