<script>
  import Icon from './Icon.svelte';
  import { pollWhile } from '../lib/poll.js';
  import {
    discardOldWorkspace,
    humanBytes,
    inspectFolder,
    moveProgress,
    moveWorkspace,
    offers,
    readStatus,
    useDefaultFolder,
    useFolder,
  } from '../lib/workspace.js';

  let { onchange } = $props();

  let status = $state(null);
  let path = $state('');
  let verdict = $state(null);
  let busy = $state(false);
  let error = $state('');
  let stop = () => {};

  const move = $derived(status?.move ?? null);
  const progress = $derived(moveProgress(move));
  const can = $derived(offers(verdict));

  $effect(() => {
    refresh();
    return () => stop();
  });

  async function refresh() {
    try {
      status = await readStatus();
    } catch (e) {
      error = e.message || 'Could not read the workspace';
      return;
    }
    stop();
    if (status.moving) {
      stop = pollWhile(
        () => true,
        async () => {
          status = await readStatus();
          if (!status.moving) {
            stop();
            verdict = null;
            path = '';
            onchange?.(status);
          }
        },
        500
      );
    }
  }

  async function run(action) {
    busy = true;
    error = '';
    try {
      return await action();
    } catch (e) {
      error = e.message || 'That did not work';
      return null;
    } finally {
      busy = false;
    }
  }

  async function check() {
    verdict = await run(() => inspectFolder(path));
  }

  async function use() {
    const next = await run(() => useFolder(verdict.root));
    if (next) settle(next);
  }

  async function goDefault() {
    const next = await run(() => useDefaultFolder());
    if (next) settle(next);
  }

  async function start() {
    const started = await run(() => moveWorkspace(verdict.root));
    if (started) await refresh();
  }

  async function discard() {
    await run(() => discardOldWorkspace());
    await refresh();
  }

  function settle(next) {
    status = next;
    verdict = null;
    path = '';
    onchange?.(next);
  }
</script>

<section class="group">
  <h3>Workspace folder</h3>

  {#if status?.environment}
    <p class="note">
      AZIMUT_HOME is set, so this run uses <span class="mono">{status.root}</span>. Unset it to
      choose a folder here.
    </p>
  {:else}
    <dl class="facts">
      <dt>Current</dt>
      <dd class="mono">{status?.root ?? '—'}</dd>
      <dt>Holds</dt>
      <dd>{status?.cases ?? 0} case{status?.cases === 1 ? '' : 's'}</dd>
    </dl>

    {#if move && !move.done}
      <div class="progress" role="status">
        <div class="bar"><div class="fill" style:width="{progress.percent}%"></div></div>
        <span class="step">
          {progress.label}
          {#if move.step === 'copying' && move.total_bytes}
            <span class="sub">
              {humanBytes(move.copied_bytes)} of {humanBytes(move.total_bytes)}
            </span>
          {/if}
        </span>
      </div>
      <p class="note">Leave this tab open. Azimut is closed to other work until it finishes.</p>
    {:else}
      {#if move?.error}
        <p class="problem">The move stopped: {move.error}. Nothing was lost.</p>
      {/if}

      <div class="picker">
        <input
          class="input mono"
          bind:value={path}
          placeholder="/path/to/a/folder"
          aria-label="Folder"
          onkeydown={(e) => e.key === 'Enter' && check()}
        />
        <button class="btn btn-sm" onclick={check} disabled={busy || !path.trim()}>Check</button>
      </div>

      {#if verdict}
        <div class="verdict">
          {#each verdict.problems as problem}
            <p class="problem">{problem}</p>
          {/each}
          {#each verdict.warnings as warning}
            <p class="warning">{warning}</p>
          {/each}
          {#if verdict.ok}
            {#if verdict.nested}
              <p class="note">
                That folder holds other files, so Azimut would use
                <span class="mono">{verdict.root}</span> inside it.
              </p>
            {/if}
            {#if verdict.state === 'workspace'}
              <p class="note">
                Already an Azimut workspace, with {verdict.cases} case{verdict.cases === 1
                  ? ''
                  : 's'}.
              </p>
            {/if}
            {#if can.strands}
              <p class="warning">
                Using it leaves {can.strands} case{can.strands === 1 ? '' : 's'} in the current
                folder.
              </p>
            {/if}
            <div class="actions">
              {#if can.use}
                <button class="btn btn-sm" onclick={use} disabled={busy}>
                  <Icon name="folderOpen" size={13} /> Use this folder
                </button>
              {/if}
              {#if can.move}
                <button class="btn btn-sm btn-primary" onclick={start} disabled={busy}>
                  Move everything here
                </button>
              {/if}
            </div>
          {/if}
        </div>
      {/if}

      {#if move?.done && !move.error && move.kept_aside}
        <div class="kept">
          <p class="note">
            The old folder is still at <span class="mono">{move.kept_aside}</span>.
          </p>
          <button class="btn btn-sm btn-danger" onclick={discard} disabled={busy}>
            Delete the old copy
          </button>
        </div>
      {/if}

      {#if status?.pointed}
        <button class="btn btn-ghost btn-sm" onclick={goDefault} disabled={busy}>
          Back to {status.default_root}
        </button>
      {/if}
    {/if}

    {#if error}
      <p class="problem">{error}</p>
    {/if}
  {/if}
</section>

<style>
  /* This block sits inside Settings' Storage section and inside the stopped-workspace
     panel. Neither parent's scoped styles reach in here, so the group heading,
     the fact list and the notes are restated with the shared tokens — same
     shape as every other Settings group. */
  .group {
    padding: 14px 0 18px;
  }
  h3 {
    font-size: var(--fs-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-3);
    margin-bottom: 12px;
  }
  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 18px;
    margin: 0;
    font-size: var(--fs-sm);
  }
  .facts dt {
    color: var(--text-3);
    font-size: var(--fs-xs);
    align-self: center;
  }
  .facts dd {
    margin: 0;
    color: var(--text-1);
    overflow-wrap: anywhere;
  }
  .note {
    color: var(--text-3);
    font-size: var(--fs-xs);
    line-height: 1.5;
    margin-top: 8px;
  }
  .picker {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }
  .picker .input {
    flex: 1;
    min-width: 0;
  }
  .verdict {
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .actions,
  .kept {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    margin-top: 6px;
  }
  .problem {
    color: var(--danger);
    font-size: var(--fs-xs);
    margin: 0;
  }
  .warning {
    color: var(--warn);
    font-size: var(--fs-xs);
    margin: 0;
  }
  .progress {
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .bar {
    height: 6px;
    border-radius: 3px;
    background: var(--bg-2);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--accent);
    transition: width 0.2s linear;
  }
  .step {
    font-size: var(--fs-xs);
    color: var(--text-2);
  }
  .step .sub {
    color: var(--text-3);
  }
</style>
