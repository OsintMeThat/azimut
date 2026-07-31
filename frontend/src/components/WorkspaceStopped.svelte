<script>
  /**
   * Shown instead of the app when the workspace can't be worked in.
   *
   * Two reasons, and they need different sentences. A folder that isn't there
   * is never recreated: an empty workspace where an investigation used to be is
   * the fastest way to conclude the work is gone. A folder another Azimut holds
   * is fine — it just isn't ours, and the way out is to close the other one, or
   * to say it is a ghost and take it.
   *
   * Either way the picker Settings uses is right here, so pointing somewhere
   * else is one action away.
   */
  import Logo from './Logo.svelte';
  import Wordmark from './Wordmark.svelte';
  import WorkspaceFolder from './WorkspaceFolder.svelte';
  import { takeWorkspaceLock } from '../lib/workspace.js';

  let { reason, root, detail = '' } = $props();

  let busy = $state(false);
  let error = $state('');

  async function take() {
    busy = true;
    error = '';
    try {
      await takeWorkspaceLock();
      location.reload();
    } catch (e) {
      error = e.message || 'Could not take the workspace';
      busy = false;
    }
  }
</script>

<div class="stop">
  <div class="panel">
    <div class="brand">
      <Logo size={30} />
      <Wordmark height={14} />
    </div>

    {#if reason === 'locked'}
      <h2>Another Azimut has this workspace</h2>
      <p class="where">{detail}</p>
      <p class="note">
        Two instances writing one workspace lose settings and can leave a case half-migrated, so
        this one hasn't touched it. Close the other Azimut and reload.
      </p>
      <div class="actions">
        <button class="btn btn-sm" onclick={() => location.reload()} disabled={busy}>Reload</button>
        <button class="btn btn-sm btn-danger" onclick={take} disabled={busy}>
          Take it anyway
        </button>
      </div>
      <p class="note">
        Take it only if that Azimut is gone. A lock can outlive it on a synced folder, or when two
        machines disagree about the time.
      </p>
      {#if error}
        <p class="problem">{error}</p>
      {/if}
    {:else}
      <h2>The workspace folder isn't there</h2>
      <p class="where">Azimut expected it at <span class="mono">{root}</span>.</p>
      <p class="note">
        An external drive that isn't plugged in, a folder that was renamed, or a sync client that
        hasn't finished. Nothing has been deleted or recreated.
      </p>
    {/if}

    <WorkspaceFolder onchange={() => location.reload()} />
  </div>
</div>

<style>
  .stop {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-0);
    padding: 24px;
    overflow: auto;
    z-index: 950;
  }
  .panel {
    width: min(560px, 100%);
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    padding: 24px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 9px;
    margin-bottom: 18px;
  }
  h2 {
    margin: 0 0 6px;
    font-size: var(--fs-lg);
    font-weight: 600;
  }
  .where {
    margin: 0 0 10px;
    font-size: var(--fs-sm);
  }
  .note {
    color: var(--text-3);
    font-size: var(--fs-xs);
    line-height: 1.5;
    margin-top: 8px;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin: 10px 0;
  }
  .problem {
    color: var(--danger);
    font-size: var(--fs-xs);
    margin: 0;
  }
</style>
