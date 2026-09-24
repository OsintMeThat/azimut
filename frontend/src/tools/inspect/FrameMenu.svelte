<script>
  import { api } from '../../lib/api.js';
  import { caseState, toast } from '../../lib/state.svelte.js';
  import { adjustDefaults, buildFrameOps } from '../../lib/inspect.js';
  import Icon from '../../components/Icon.svelte';
  import AdjustSliders from './AdjustSliders.svelte';
  import CropControls from './CropControls.svelte';
  import OrientationControls from './OrientationControls.svelte';
  import SaveToCase from './SaveToCase.svelte';

  // The panel beside one frame: turn it, adjust it, crop it, then save it as
  // media or read it closer. Edits are kept with the file's work as they are
  // made; only Save to case puts a file in the Media Library.
  let {
    frame, filters, analyses, shared,
    cropAspect = $bindable(null), cropEditing = $bindable(false), beginCrop, commitCrop,
    setRotation, rotationBusy = false, reverse, onduplicate,
    frameSave, folder = $bindable(''),
  } = $props();

  let analyzing = $state(null);
  let analysis = $state(null);
  let canvasEl = $state();
  let reversing = $state(false);

  // A reading belongs to the frame it was run on.
  $effect(() => {
    frame.id;
    analysis = null;
  });

  async function reverseActive() {
    if (reversing) return;
    reversing = true;
    try {
      await reverse(frame);
    } finally {
      reversing = false;
    }
  }

  async function reset() {
    frame.adjust = adjustDefaults(filters);
    frame.crop = null;
    shared.cropMode = false;
    cropAspect = null;
    cropEditing = false;
    await setRotation(0);
  }

  function clearCrop() {
    frame.crop = null;
    shared.cropMode = false;
    cropAspect = null;
    cropEditing = false;
  }

  async function runAnalysis(name) {
    analyzing = name;
    analysis = null;
    try {
      analysis = await api.post(`/api/cases/${caseState.current.id}/inspect/analyze`, {
        path: frame.path,
        name,
        time: frame.time ?? null,
        ops: buildFrameOps(filters, frame),
      });
      if (analysis.kind === 'histogram') requestAnimationFrame(drawHistogram);
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      analyzing = null;
    }
  }

  function drawHistogram() {
    if (!canvasEl || analysis?.kind !== 'histogram') return;
    const ctx = canvasEl.getContext('2d');
    const W = (canvasEl.width = canvasEl.clientWidth);
    const H = (canvasEl.height = 120);
    ctx.clearRect(0, 0, W, H);
    const ch = analysis.channels;
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
  <div class="section first">
    <div class="section-head"><span>Orientation</span></div>
    <OrientationControls
      value={frame.rotation ?? 0}
      disabled={rotationBusy}
      onchange={setRotation}
      hint="The saved image uses this orientation."
    />
    <AdjustSliders {filters} values={frame.adjust} />
    <div class="crop-block">
      <div class="crop-row">
        {#if cropEditing}
          <button class="btn btn-sm active" onclick={() => commitCrop?.()} title="Apply the crop (Enter)">
            <Icon name="check" size={14} /> Apply crop
          </button>
          <button class="btn btn-ghost btn-xs" onclick={() => (shared.cropMode = true)} title="Draw a fresh region">
            <Icon name="crop" size={13} /> Redraw
          </button>
        {:else}
          <button class="btn btn-sm" onclick={() => beginCrop?.()}>
            <Icon name="crop" size={14} /> {frame.crop ? 'Edit crop' : 'Crop region'}
          </button>
          {#if frame.crop}
            <span class="crop-info">or double-click the image</span>
          {/if}
        {/if}
      </div>
      {#if cropEditing}
        <CropControls bind:crop={frame.crop} bind:aspect={cropAspect} natW={frame.w} natH={frame.h} onclear={clearCrop} />
      {/if}
    </div>
    <div class="row">
      <button class="btn btn-ghost btn-sm" onclick={reset}><Icon name="reset" size={14} /> Reset frame</button>
      <button class="btn btn-ghost btn-sm" onclick={() => onduplicate?.(frame)} title="A second copy to crop or adjust differently">
        <Icon name="copy" size={14} /> Duplicate
      </button>
    </div>
  </div>

  <div class="section">
    <SaveToCase
      defaultName={frameSave.defaultName}
      filedPath={frameSave.filedPath}
      busy={frameSave.busy}
      blocked={frameSave.blocked}
      bind:folder
      onsave={frameSave.onsave}
    />
  </div>

  <div class="section">
    <div class="section-head"><span><Icon name="eye" size={14} /> Analyze</span></div>
    <div class="atabs">
      {#each analyses as a (a.id)}
        <button class="btn btn-sm" class:active={analyzing === a.id} disabled={!!analyzing} onclick={() => runAnalysis(a.id)}>{a.label}</button>
      {/each}
    </div>
    {#if analyzing}
      <p class="hint"><Icon name="clock" size={13} /> Analysing…</p>
    {:else if analysis}
      {#if analysis.kind === 'keyvalue'}
        <table class="kv"><tbody>
          {#each Object.entries(analysis.rows) as [k, v] (k)}<tr><th>{k}</th><td class="mono">{v}</td></tr>{/each}
        </tbody></table>
      {:else if analysis.kind === 'histogram'}
        <canvas bind:this={canvasEl} class="hist"></canvas>
      {:else if analysis.kind === 'image'}
        <img class="ana-img" src={analysis.data_url} alt="analysis" />
        {#if analysis.note}<p class="note"><Icon name="alert" size={13} /> {analysis.note}</p>{/if}
      {:else if analysis.kind === 'text'}
        <pre class="text">{analysis.text}</pre>
      {/if}
    {/if}
    <button
      class="btn btn-sm reverse"
      disabled={reversing}
      onclick={reverseActive}
      title="Search the web for this image as it is adjusted and cropped here"
    >
      <Icon name="search" size={14} /> {reversing ? 'Preparing…' : 'Reverse image search'}
    </button>
  </div>
</div>

<style>
  .module {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .section {
    border-top: 1px solid var(--border);
    padding-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .crop-block {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .crop-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .crop-info {
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .btn.active {
    color: var(--accent);
    border-color: var(--accent);
  }
  .reverse {
    align-self: flex-start;
  }
  .row {
    display: flex;
    gap: 6px;
  }
  .section.first {
    border-top: 0;
    padding-top: 0;
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
  .atabs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .hint {
    color: var(--text-3);
    font-size: var(--fs-xs);
    margin: 0;
    display: flex;
    gap: 5px;
    align-items: center;
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
  .ana-img {
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
