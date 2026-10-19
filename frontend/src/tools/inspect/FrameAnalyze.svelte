<script>
  import { INSPECT_HELP } from '../../lib/inspectHelp.js';
  import Icon from '../../components/Icon.svelte';

  // The Analyze tab beside one frame: readings run on the frame as it reads now
  // (`/inspect/analyze`), and the searches that start from it. A reading that comes
  // back as a picture is laid over the frame in the viewer rather than shrunk into
  // this panel; the parent holds it, since the viewer draws it.
  //
  // `analysis` belongs to the frame and the edits it was run on: `current` says the
  // frame still reads that way, and a stale one asks to be run again.
  let {
    frame, analyses, analysis = null, current = false, running = null, onrun,
    reverse, horizon = null,
  } = $props();

  let reversing = $state(false);

  async function reverseActive() {
    if (reversing) return;
    reversing = true;
    try {
      await reverse(frame);
    } finally {
      reversing = false;
    }
  }
</script>

<div class="module">
  <div class="block">
    <span class="head">Readings</span>
    <div class="runs">
      {#each analyses as a (a.id)}
        <button
          class="btn btn-sm"
          class:active={analysis?.id === a.id && current}
          disabled={!!running}
          onclick={() => onrun(a.id)}
          title={a.id === 'ela' ? INSPECT_HELP.ela : a.label}
        >{a.label}</button>
      {/each}
    </div>
    {#if running}
      <p class="hint"><Icon name="clock" size={13} /> Reading the frame…</p>
    {:else if analysis && !current}
      <p class="hint">The frame changed since. Run it again to read it as it is now.</p>
    {:else if analysis?.kind === 'image'}
      <label class="toggle" title={INSPECT_HELP.elaShow}>
        <input type="checkbox" bind:checked={analysis.shown} /> Show over the frame
      </label>
      <label class="opacity" title={INSPECT_HELP.elaOpacity}>
        <span>Strength</span>
        <input type="range" min="0.1" max="1" step="0.05" bind:value={analysis.opacity} disabled={!analysis.shown} />
      </label>
      {#if analysis.note}<p class="note"><Icon name="alert" size={13} /> {analysis.note}</p>{/if}
    {:else if analysis?.kind === 'keyvalue'}
      <table class="kv"><tbody>
        {#each Object.entries(analysis.rows ?? {}) as [k, v] (k)}<tr><th>{k}</th><td class="mono">{v}</td></tr>{/each}
      </tbody></table>
    {:else if analysis?.kind === 'text'}
      <pre class="text">{analysis.text}</pre>
    {/if}
  </div>

  <div class="block">
    <span class="head">Search from it</span>
    <button class="btn btn-sm wide" disabled={reversing} onclick={reverseActive} title={INSPECT_HELP.reverse}>
      <Icon name="search" size={14} /> {reversing ? 'Preparing…' : 'Reverse image search'}
    </button>
    {#if horizon}
      <button class="btn btn-sm wide" onclick={() => horizon(frame)} title={INSPECT_HELP.horizon}>
        <Icon name="compass" size={14} /> Match in Horizon
      </button>
    {/if}
  </div>
</div>

<style>
  .module {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .block + .block {
    border-top: 1px solid var(--border);
    padding-top: 12px;
  }
  .head {
    font-weight: 600;
    font-size: var(--fs-sm);
  }
  .runs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .btn.active {
    color: var(--accent);
    border-color: var(--accent);
  }
  .wide {
    align-self: flex-start;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-sm);
    color: var(--text-2);
  }
  .toggle input {
    accent-color: var(--accent);
  }
  .opacity {
    display: grid;
    grid-template-columns: 70px 1fr;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-sm);
    color: var(--text-2);
  }
  .opacity input {
    width: 100%;
    accent-color: var(--accent);
  }
  .hint {
    color: var(--text-3);
    font-size: var(--fs-xs);
    margin: 0;
    display: flex;
    gap: 5px;
    align-items: center;
  }
  .note {
    display: flex;
    gap: 6px;
    font-size: var(--fs-xs);
    color: var(--warn, #d8a24a);
    margin: 0;
  }
  .kv {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-xs);
  }
  .kv th {
    text-align: left;
    color: var(--text-3);
    font-weight: 600;
    padding: 3px 8px 3px 0;
    vertical-align: top;
    white-space: nowrap;
  }
  .kv td {
    padding: 3px 0;
    color: var(--text-2);
    word-break: break-all;
  }
  .text {
    font-size: var(--fs-xs);
    white-space: pre-wrap;
    color: var(--text-2);
  }
</style>
