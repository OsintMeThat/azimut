<script>
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import { updateState, dismissUpdate } from '../lib/state.svelte.js';

  let mute = $state(false);

  function close() {
    dismissUpdate(mute);
  }
</script>

<Modal title="{updateState.latest} is live" onclose={close} width="520px">
  <p class="lead">A newer version of Azimut is out. Grab it to stay current.</p>

  {#if updateState.notes}
    <!-- release body from our own GitHub release; rendered as plain text, never
         as HTML, so there is nothing to inject -->
    <pre class="notes">{updateState.notes}</pre>
  {/if}

  <div class="actions">
    <label class="mute">
      <input type="checkbox" bind:checked={mute} />
      Don't show this again
    </label>
    <a
      class="btn btn-sm btn-primary"
      href={updateState.url}
      target="_blank"
      rel="noreferrer"
      onclick={close}
    >
      <Icon name="download" size={13} /> Download {updateState.latest}
      <Icon name="external" size={11} />
    </a>
  </div>

  <p class="note">
    You can always update later from Settings → Updates.
  </p>
</Modal>

<style>
  .lead {
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  .notes {
    margin: 12px 0;
    padding: 10px 12px;
    max-height: 40vh;
    overflow: auto;
    background: var(--bg-0);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    color: var(--text-2);
    font-size: var(--fs-sm);
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 14px;
  }
  .mute {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--text-3);
    font-size: var(--fs-sm);
  }
  .note {
    margin-top: 12px;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
</style>
