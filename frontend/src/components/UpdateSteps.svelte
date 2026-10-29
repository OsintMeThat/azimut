<script>
  /**
   * How to update (lib/updateSteps.js has the words): what to do once the download
   * is under way for a binary, and the terminal steps for a pip install. It stays
   * readable after Azimut is closed: the page is already drawn, and nothing here
   * needs the server.
   *
   * `framed` sets the steps apart when they share the space with other content,
   * as a pip install's steps do under the release notes.
   */
  import UpdateCommand from './UpdateCommand.svelte';
  import { updateSteps } from '../lib/updateSteps.js';

  let { update, framed = false } = $props();

  const install = $derived(update?.install);
  const steps = $derived(updateSteps(install));
</script>

<div class="update-steps" class:framed>
  {#if install?.kind === 'package'}
    <p class="head">Update with pipx</p>
  {:else}
    <p>
      Your browser is downloading <span class="mono">{update?.asset}</span>. Then:
    </p>
  {/if}
  <ol>
    {#each steps as step (step.text)}
      <li>
        {step.text}
        {#each step.code ?? [] as line (line)}
          <UpdateCommand command={line} />
        {/each}
        {#if step.note}<span class="step-note">{step.note}</span>{/if}
      </li>
    {/each}
  </ol>
  {#if install?.workspace}
    <p class="stays">
      Your cases and settings stay in <span class="mono">{install.workspace}</span>.
    </p>
  {/if}
</div>

<style>
  .update-steps {
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  .framed {
    margin: 12px 0;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-left: 2px solid var(--accent);
    border-radius: var(--r-md);
    background: var(--bg-1);
  }
  .head {
    color: var(--text-1);
    font-weight: 600;
  }
  ol {
    margin: 10px 0;
    padding-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  li :global(.command) {
    margin-top: 4px;
  }
  .step-note {
    display: block;
    margin-top: 4px;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .stays {
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
</style>
