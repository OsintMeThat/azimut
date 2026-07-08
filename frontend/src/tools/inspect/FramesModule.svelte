<script>
  import { api } from '../../lib/api.js';
  import { caseState, uiState, reloadCase, toast } from '../../lib/state.svelte.js';
  import Icon from '../../components/Icon.svelte';

  // Extracts frames from a video into the case (spec v2 gesture).
  let { source, probeInfo, shared, onProduced } = $props();

  let suggestions = $state([]);
  let scanning = $state(false);
  let capturing = $state(false);

  const duration = $derived(probeInfo?.duration ?? 0);

  function fmt(t) {
    const m = Math.floor(t / 60);
    const s = (t % 60).toFixed(2).padStart(5, '0');
    return `${m}:${s}`;
  }

  function step(delta) {
    const t = Math.min(Math.max((shared.currentTime ?? 0) + delta, 0), duration || Infinity);
    shared.seekTo = t;
  }

  async function capture(time = shared.currentTime ?? 0) {
    capturing = true;
    try {
      const res = await api.post(`/api/cases/${caseState.current.id}/inspect/frame`, {
        path: source.path,
        time,
      });
      await reloadCase();
      onProduced(res);
      toast(
        res.duplicate ? 'That frame is already in the case' : `Frame captured at ${fmt(time)}`,
        res.duplicate ? 'warn' : 'ok'
      );
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      capturing = false;
    }
  }

  async function suggest() {
    scanning = true;
    suggestions = [];
    try {
      const { job_id } = await api.post(`/api/cases/${caseState.current.id}/inspect/suggest`, {
        path: source.path,
        bins: 12,
      });
      const frames = await poll(job_id);
      suggestions = frames;
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      scanning = false;
    }
  }

  async function poll(jobId) {
    for (;;) {
      const job = await api.get(`/api/jobs/${jobId}`);
      if (job.status === 'done') return job.result.frames;
      if (job.status === 'error') throw new Error(job.error);
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  const maxScore = $derived(Math.max(1, ...suggestions.map((s) => s.score)));
</script>

<div class="module">
  <div class="now">
    <span class="mono time">{fmt(shared.currentTime ?? 0)}</span>
    <span class="dim">/ {fmt(duration)}</span>
  </div>

  <div class="stepper">
    <button class="btn btn-sm" onclick={() => step(-1)} title="Back 1s">-1s</button>
    <button class="btn btn-sm" onclick={() => step(-0.1)} title="Back 0.1s">-0.1</button>
    <button class="btn btn-sm" onclick={() => step(0.1)} title="Forward 0.1s">+0.1</button>
    <button class="btn btn-sm" onclick={() => step(1)} title="Forward 1s">+1s</button>
  </div>

  <button class="btn btn-primary w-full" disabled={capturing} onclick={() => capture()}>
    <Icon name="image" size={15} /> Capture this frame
  </button>

  <div class="section">
    <div class="section-head">
      <span>Sharpest frames</span>
      <button class="btn btn-ghost btn-sm" disabled={scanning} onclick={suggest}>
        <Icon name={scanning ? 'clock' : 'search'} size={13} />
        {scanning ? 'Scanning…' : 'Scan'}
      </button>
    </div>
    <p class="hint">Samples the clip and ranks frames by focus — sharper is higher.</p>

    {#each suggestions as s (s.time)}
      <div class="sugg" class:top={s.rank === 0}>
        <span class="mono">{fmt(s.time)}</span>
        <div class="bar"><div class="fill" style:width={`${(s.score / maxScore) * 100}%`}></div></div>
        <button class="btn btn-ghost btn-xs" onclick={() => (shared.seekTo = s.time)} title="Seek here">
          <Icon name="eye" size={13} />
        </button>
        <button class="btn btn-xs" disabled={capturing} onclick={() => capture(s.time)} title="Capture">
          <Icon name="image" size={13} />
        </button>
      </div>
    {/each}
  </div>
</div>

<style>
  .module {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .now {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: var(--fs-lg);
  }
  .time {
    font-weight: 700;
    color: var(--accent);
  }
  .dim {
    color: var(--text-3);
    font-size: var(--fs-sm);
  }
  .stepper {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
  }
  .w-full {
    width: 100%;
    justify-content: center;
  }
  .section {
    border-top: 1px solid var(--border);
    padding-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-weight: 600;
    font-size: var(--fs-sm);
  }
  .hint {
    color: var(--text-3);
    font-size: var(--fs-xs);
    margin: 0 0 4px;
  }
  .sugg {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 0;
  }
  .sugg.top .fill {
    background: var(--accent);
  }
  .sugg .mono {
    font-size: var(--fs-xs);
    color: var(--text-2);
    min-width: 52px;
  }
  .bar {
    flex: 1;
    height: 6px;
    border-radius: 3px;
    background: var(--bg-2);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--text-3);
  }
</style>
