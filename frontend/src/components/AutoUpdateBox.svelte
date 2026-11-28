<script>
  /**
   * The box in the new-version pop-up, where most analysts meet it: Download new
   * versions automatically, what it does, and the download's progress once ticked.
   * The same setting as Settings → System. Ticking only downloads; installing waits
   * for Install and restart (lib/selfUpdate.js has the words).
   */
  import Icon from './Icon.svelte';
  import { prefs } from '../lib/state.svelte.js';
  import { retry, selfUpdate, setAutoDownload } from '../lib/selfUpdateState.svelte.js';
  import { AUTO, RETRY_LABEL, autoBox, progressLine } from '../lib/selfUpdate.js';

  let { install } = $props();

  const box = $derived(
    autoBox(install, selfUpdate, { on: prefs.updateAutoDownload, checkOnStart: prefs.updateCheckOnStart }),
  );
  const ticked = $derived(prefs.updateAutoDownload && !box.disabled);
  const line = $derived(progressLine(selfUpdate));
</script>

{#if box.shown}
  <div class="auto-box" class:ticked>
    <label title={AUTO.title}>
      <input
        type="checkbox"
        checked={prefs.updateAutoDownload}
        disabled={box.disabled}
        onchange={(e) => setAutoDownload(e.currentTarget.checked)}
      />
      {AUTO.label}
    </label>
    {#if box.disabled}
      <p class="hint">{box.hint}</p>
    {:else if !ticked}
      <p class="hint">{AUTO.popHint}</p>
    {:else if line.kind}
      {#if line.kind !== 'failed'}
        <div class="bar" role="progressbar" aria-valuenow={line.percent} aria-valuemin="0" aria-valuemax="100">
          <i style:width="{line.percent}%"></i>
        </div>
      {/if}
      <p class="line {line.kind}">
        {#if line.kind === 'ready'}<Icon name="check" size={12} />{/if}
        {#if line.kind === 'failed'}<Icon name="alert" size={12} />{/if}
        {line.text}
        {#if line.kind === 'failed'}<button class="btn btn-xs" onclick={retry}>{RETRY_LABEL}</button>{/if}
      </p>
    {/if}
  </div>
{/if}

<style>
  .auto-box {
    margin-top: 14px;
    padding: 10px 12px;
    border: 1px dashed color-mix(in srgb, var(--accent) 45%, transparent);
    border-radius: var(--r-md);
    background: linear-gradient(90deg, var(--accent-soft), transparent 70%);
    transition: border-color var(--motion-hover) var(--ease);
  }
  .auto-box.ticked {
    border-style: solid;
    border-color: color-mix(in srgb, var(--accent) 60%, transparent);
  }
  label {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-1);
    font-size: var(--fs-sm);
    font-weight: 500;
    cursor: pointer;
  }
  .hint {
    margin: 3px 0 0 22px;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .bar {
    height: 4px;
    margin: 9px 0 0 22px;
    border-radius: 4px;
    background: var(--bg-3);
    overflow: hidden;
  }
  .bar i {
    display: block;
    height: 100%;
    border-radius: 4px;
    background: var(--accent);
    transition: width 250ms linear;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 6px 0 0 22px;
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .line.ready {
    color: var(--ok);
  }
  .line.failed {
    color: var(--danger);
  }
</style>
