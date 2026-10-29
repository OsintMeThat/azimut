<script>
  import Modal from './Modal.svelte';
  import UpdateButtons from './UpdateButtons.svelte';
  import UpdateSteps from './UpdateSteps.svelte';
  import { markdownHtml } from '../lib/markdown.js';
  import { updateState, updatesState, dismissUpdate } from '../lib/state.svelte.js';

  let mute = $state(false);
  // Once the download is pressed the pop-up turns into its steps; the browser
  // never says when the file is in, so there is nothing to wait for.
  let started = $state(false);

  const notes = $derived(markdownHtml(updateState.notes));
  const update = $derived(updatesState.app);

  function close() {
    dismissUpdate(started ? false : mute);
  }
</script>

<Modal
  title={started ? `Update to ${updateState.latest}` : `${updateState.latest} is live`}
  onclose={close}
  width="600px"
>
  {#if started}
    <UpdateSteps {update} />
    <div class="actions end">
      <button class="btn btn-sm" onclick={close}>Done</button>
    </div>
  {:else}
    <p class="lead">
      A newer version of Azimut is out.
      {#if update?.current}You have <span class="mono">v{update.current}</span>.{/if}
    </p>

    {#if updateState.notes}
      <!-- Release body from our own GitHub release, written in Markdown. It goes
           through the same renderer as the Notebook, which strips unsafe HTML. -->
      <div class="notes markdown">{@html notes}</div>
    {/if}

    <!-- nothing to download for a pip install: its terminal steps are the way -->
    {#if update?.install?.kind === 'package'}
      <UpdateSteps {update} framed />
    {/if}

    <div class="actions">
      <label class="mute">
        <input type="checkbox" bind:checked={mute} />
        Don't show this again
      </label>
      <div class="buttons">
        <UpdateButtons {update} onstart={() => (started = true)} />
      </div>
    </div>

    <p class="note">
      You can always update later from Settings → System.
    </p>
  {/if}
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
  .actions.end {
    justify-content: flex-end;
  }
  .buttons {
    display: flex;
    flex-direction: row-reverse;
    gap: 8px;
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
