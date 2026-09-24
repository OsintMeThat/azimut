<script>
  import { api } from '../../lib/api.js';
  import { caseState, toast } from '../../lib/state.svelte.js';
  import { adjustDefaults, isNeutral } from '../../lib/inspect.js';
  import Icon from '../../components/Icon.svelte';
  import AdjustSliders from './AdjustSliders.svelte';
  import OrientationControls from './OrientationControls.svelte';
  import SaveToCase from './SaveToCase.svelte';

  // The panel beside the video: scrub it, capture frames (kept with the video's
  // work as they are taken), and tune the whole clip. A turned or adjusted clip
  // can be saved as a new video; the original is never touched.
  let {
    probeInfo, shared, videoFilters, work, capture,
    videoEdited = false, videoSave, folder = $bindable(''),
  } = $props();

  let suggestions = $state([]);
  let scanning = $state(false);
  let capturing = $state(false);
  let showGear = $state(false);

  const duration = $derived(probeInfo?.duration ?? 0);
  // one frame at the clip's rate — the difference between a readable plate
  // and a blurry one (falls back to 30 fps when ffprobe gave none)
  const frameDur = $derived(probeInfo?.fps ? 1 / probeInfo.fps : 1 / 30);

  function fmt(t) {
    const m = Math.floor(t / 60);
    const s = (t % 60).toFixed(2).padStart(5, '0');
    return `${m}:${s}`;
  }

  function step(delta) {
    const t = Math.min(Math.max((shared.currentTime ?? 0) + delta, 0), duration || Infinity);
    shared.seekTo = t;
  }

  async function grab(time = shared.currentTime ?? 0) {
    capturing = true;
    try {
      await capture(time);
    } finally {
      capturing = false;
    }
  }

  async function suggest() {
    scanning = true;
    suggestions = [];
    try {
      const { job_id } = await api.post(`/api/cases/${caseState.current.id}/inspect/suggest`, {
        path: work.source.path,
        count: 12,
      });
      suggestions = await poll(job_id);
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
  const gearActive = $derived(!isNeutral(videoFilters, work.videoAdjust));

  function resetVideoAdjust() {
    work.videoAdjust = adjustDefaults(videoFilters);
  }
</script>

<div class="module">
  <div class="now">
    <span class="mono time">{fmt(shared.currentTime ?? 0)}</span>
    <span class="dim">/ {fmt(duration)}</span>
  </div>

  <div class="stepper">
    <button class="btn btn-sm" onclick={() => step(-1)} title="Back 1s (Shift+←)">-1s</button>
    <button class="btn btn-sm" onclick={() => step(-0.1)} title="Back 0.1s">-0.1</button>
    <button class="btn btn-sm" onclick={() => step(-frameDur)} title="Back 1 frame (← or ,)">-1f</button>
    <button class="btn btn-sm" onclick={() => step(frameDur)} title="Forward 1 frame (→ or .)">+1f</button>
    <button class="btn btn-sm" onclick={() => step(0.1)} title="Forward 0.1s">+0.1</button>
    <button class="btn btn-sm" onclick={() => step(1)} title="Forward 1s (Shift+→)">+1s</button>
  </div>

  <button class="btn btn-primary w-full" disabled={capturing} onclick={() => grab()}>
    <Icon name="image" size={15} /> Capture frame
  </button>

  <div class="section">
    <div class="section-head"><span>Orientation</span></div>
    <OrientationControls
      value={work.videoRotation}
      onchange={(angle) => (work.videoRotation = angle)}
      hint="New frames and a saved video use this orientation."
    />
  </div>

  <div class="section">
    <button class="section-head as-btn" onclick={() => (showGear = !showGear)}>
      <span><Icon name="settings" size={14} /> Video adjustments {#if gearActive}<span class="dot"></span>{/if}</span>
      <Icon name={showGear ? 'chevronDown' : 'chevronRight'} size={14} />
    </button>
    {#if showGear}
      <p class="hint">Applies to the whole clip and to the frames captured from now on.</p>
      <AdjustSliders filters={videoFilters} values={work.videoAdjust} />
      <button class="btn btn-ghost btn-sm reset" disabled={!gearActive} onclick={resetVideoAdjust}>
        <Icon name="reset" size={14} /> Reset adjustments
      </button>
    {/if}
  </div>

  {#if videoEdited}
    <div class="section">
      <SaveToCase
        defaultName={videoSave.defaultName}
        filedPath={videoSave.filedPath}
        busy={videoSave.busy}
        bind:folder
        hint="Re-encodes the whole clip turned and adjusted as shown."
        onsave={videoSave.onsave}
      />
    </div>
  {/if}

  <div class="section">
    <div class="section-head">
      <span>Sharpest frames</span>
      <button class="btn btn-ghost btn-sm" disabled={scanning} onclick={suggest}>
        <Icon name={scanning ? 'clock' : 'search'} size={13} />
        {scanning ? 'Scanning…' : 'Scan'}
      </button>
    </div>
    <p class="hint">Samples the clip and ranks frames by focus. Higher scores are sharper.</p>
    {#each suggestions as s (s.time)}
      <div class="sugg" class:top={s.rank === 0}>
        <span class="mono">{fmt(s.time)}</span>
        <div class="bar"><div class="fill" style:width={`${(s.score / maxScore) * 100}%`}></div></div>
        <button class="btn btn-ghost btn-xs" onclick={() => (shared.seekTo = s.time)} title="Seek here">
          <Icon name="eye" size={13} />
        </button>
        <button class="btn btn-xs" disabled={capturing} onclick={() => grab(s.time)} title="Capture">
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
    grid-template-columns: repeat(6, 1fr);
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
    gap: 8px;
  }
  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-weight: 600;
    font-size: var(--fs-sm);
  }
  .section-head span {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .as-btn {
    width: 100%;
    background: none;
    color: var(--text-1);
    text-align: left;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
  }
  .hint {
    color: var(--text-3);
    font-size: var(--fs-xs);
    margin: 0;
  }
  .reset {
    align-self: flex-start;
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
