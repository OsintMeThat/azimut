<script>
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import { markdownHtml } from '../lib/markdown.js';
  import { updateState, dismissUpdate } from '../lib/state.svelte.js';

  let mute = $state(false);

  const notes = $derived(markdownHtml(updateState.notes));

  function close() {
    dismissUpdate(mute);
  }
</script>

<Modal title="{updateState.latest} is live" onclose={close} width="600px">
  <p class="lead">A newer version of Azimut is out. Grab it to stay current.</p>

  {#if updateState.notes}
    <!-- Release body from our own GitHub release, written in Markdown. It goes
         through the same renderer as the Notebook, which strips unsafe HTML. -->
    <div class="notes markdown">{@html notes}</div>
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
    You can always update later from Settings → System.
  </p>
</Modal>

<style>
  .lead {
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  .notes {
    margin: 12px 0;
    padding: 12px 14px;
    max-height: 40vh;
    overflow: auto;
    background: var(--bg-0);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  /* A release note leads with its own headings, which would otherwise shout
     over the modal title. */
  .notes :global(h1),
  .notes :global(h2) {
    font-size: var(--fs-md);
    font-weight: 600;
  }
  .notes :global(h3) {
    font-size: var(--fs-sm);
    font-weight: 600;
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
