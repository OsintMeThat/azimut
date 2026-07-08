<script>
  import { onMount } from 'svelte';
  import { api } from '../../lib/api.js';
  import { caseState, toast } from '../../lib/state.svelte.js';
  import Icon from '../../components/Icon.svelte';

  // Read-only inspectors. Each analysis returns one of a few render kinds
  // (keyvalue / histogram / image / text) so new analyses need no new UI here.
  let { source } = $props();

  let analyses = $state([]);
  let active = $state(null);
  let result = $state(null);
  let running = $state(false);
  let canvasEl = $state();

  onMount(async () => {
    analyses = (await api.get('/api/inspect/ops')).analyses;
  });

  async function run(name) {
    active = name;
    running = true;
    result = null;
    try {
      result = await api.post(`/api/cases/${caseState.current.id}/inspect/analyze`, {
        path: source.path,
        name,
      });
      if (result.kind === 'histogram') requestAnimationFrame(drawHistogram);
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      running = false;
    }
  }

  function drawHistogram() {
    if (!canvasEl || result?.kind !== 'histogram') return;
    const ctx = canvasEl.getContext('2d');
    const W = (canvasEl.width = canvasEl.clientWidth);
    const H = (canvasEl.height = 120);
    ctx.clearRect(0, 0, W, H);
    const ch = result.channels;
    const peak = Math.max(1, ...ch.r, ...ch.g, ...ch.b);
    ctx.globalCompositeOperation = 'lighter';
    for (const [name, color] of [
      ['r', 'rgba(230,70,70,0.8)'],
      ['g', 'rgba(70,210,110,0.8)'],
      ['b', 'rgba(90,140,240,0.8)'],
    ]) {
      ctx.beginPath();
      ctx.moveTo(0, H);
      ch[name].forEach((v, i) => ctx.lineTo((i / 255) * W, H - (v / peak) * H));
      ctx.lineTo(W, H);
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
</script>

<div class="module">
  <div class="tabs">
    {#each analyses as a (a.id)}
      <button class="btn btn-sm" class:active={active === a.id} onclick={() => run(a.id)}>
        {a.label}
      </button>
    {/each}
  </div>

  {#if running}
    <p class="status"><Icon name="clock" size={14} /> Analysing…</p>
  {:else if result}
    {#if result.kind === 'keyvalue'}
      <table class="kv">
        <tbody>
          {#each Object.entries(result.rows) as [k, v] (k)}
            <tr><th>{k}</th><td class="mono">{v}</td></tr>
          {/each}
        </tbody>
      </table>
    {:else if result.kind === 'histogram'}
      <canvas bind:this={canvasEl} class="hist"></canvas>
      <p class="legend"><span class="r">R</span> <span class="g">G</span> <span class="b">B</span> intensity 0→255</p>
    {:else if result.kind === 'image'}
      <img class="analysis-img" src={result.data_url} alt="analysis" />
      {#if result.note}<p class="note"><Icon name="alert" size={13} /> {result.note}</p>{/if}
    {:else if result.kind === 'text'}
      <pre class="text">{result.text}</pre>
    {/if}
  {:else}
    <p class="status dim">Pick an analysis above.</p>
  {/if}
</div>

<style>
  .module {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .btn.active {
    color: var(--accent);
    border-color: var(--accent);
  }
  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-3);
    font-size: var(--fs-sm);
  }
  .status.dim {
    color: var(--text-3);
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
  .kv tr + tr {
    border-top: 1px solid var(--border);
  }
  .hist {
    width: 100%;
    height: 120px;
    background: var(--bg-0);
    border-radius: var(--r-sm);
  }
  .legend {
    font-size: var(--fs-xs);
    color: var(--text-3);
    margin: 0;
  }
  .legend .r {
    color: #e64646;
  }
  .legend .g {
    color: #46d26e;
  }
  .legend .b {
    color: #5a8cf0;
  }
  .analysis-img {
    width: 100%;
    border-radius: var(--r-sm);
    background: #000;
  }
  .note {
    display: flex;
    gap: 6px;
    font-size: var(--fs-xs);
    color: var(--warn, #d8a24a);
    margin: 0;
  }
  .text {
    font-size: var(--fs-xs);
    white-space: pre-wrap;
    color: var(--text-2);
  }
</style>
