<script>
  /**
   * After Install and restart: the version was downloaded, its signature checked and
   * it was tried before the press, so those steps are behind already; the tab waits
   * for the new version to answer, then reloads (lib/selfUpdateState.svelte.js).
   * If nothing answers, it says what to do with the version kept beside it.
   */
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import { restart, selfUpdate } from '../lib/selfUpdateState.svelte.js';
  import { RESTART_STEPS, oldName } from '../lib/selfUpdate.js';

  const lost = $derived(restart.phase === 'lost');
  const program = $derived(String(selfUpdate.install?.program ?? '').split(/[\\/]/).pop() || 'azimut');
</script>

<Modal
  title={lost ? 'Azimut did not come back' : `Updating to ${restart.version}`}
  onclose={() => (restart.phase = '')}
  width="440px"
>
  {#if lost}
    <p class="sub">
      It did not answer within two minutes. Start Azimut again. If it will not start, rename
      <span class="mono">{oldName(program)}</span> back to <span class="mono">{program}</span>.
    </p>
  {:else}
    <p class="sub">Azimut closes and opens again. This tab comes back on its own.</p>
    <ul class="steps">
      {#each RESTART_STEPS as step, i (step)}
        {@const last = i === RESTART_STEPS.length - 1}
        <li class:done={!last} class:now={last}>
          <span class="mark" aria-hidden="true">
            {#if !last}<Icon name="check" size={11} />{/if}
          </span>
          {step}
        </li>
      {/each}
    </ul>
    <p class="foot">Cases and settings are not touched.</p>
  {/if}
</Modal>

<style>
  .sub {
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  .steps {
    list-style: none;
    margin: 14px 0 4px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .steps li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 8px;
    border-radius: var(--r-md);
    color: var(--text-1);
    font-size: var(--fs-sm);
  }
  .steps li.now {
    background: var(--bg-2);
  }
  .mark {
    display: grid;
    place-items: center;
    flex: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1.5px solid var(--border-strong);
  }
  .done .mark {
    background: var(--ok);
    border-color: var(--ok);
    color: var(--bg-0);
  }
  .now .mark {
    border-color: var(--accent);
    border-top-color: transparent;
    animation: turn 0.8s linear infinite;
  }
  @keyframes turn {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .now .mark {
      animation: none;
    }
  }
  .foot {
    margin-top: 10px;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
</style>
