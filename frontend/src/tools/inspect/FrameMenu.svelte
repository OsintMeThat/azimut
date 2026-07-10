<script>
  import { api } from '../../lib/api.js';
  import { caseState, toast } from '../../lib/state.svelte.js';
  import { adjustDefaults, buildOps, previewStyle, cropImgStyle, styleText } from '../../lib/inspect.js';
  import Icon from '../../components/Icon.svelte';
  import AdjustSliders from './AdjustSliders.svelte';

  // Right-panel menu for the Frame tab. Works on the *active* tray frame:
  // pick it, adjust it (live-previewed), crop it, or analyse it — all without
  // filing anything. The recipe is committed later from the Save tab.
  let { session, filters, analyses, activeFrame, shared, removeFrame, setActive } = $props();

  let showAnalyze = $state(false);
  let analyzing = $state(null);
  let analysis = $state(null);
  let canvasEl = $state();

  function reset() {
    if (!activeFrame) return;
    activeFrame.adjust = adjustDefaults(filters);
    activeFrame.crop = null;
    shared.cropMode = false;
  }

  function toggleCrop() {
    shared.cropMode = !shared.cropMode;
  }

  function clearCrop() {
    if (activeFrame) activeFrame.crop = null;
    shared.cropMode = false;
  }

  async function runAnalysis(name) {
    if (!activeFrame) return;
    analyzing = name;
    analysis = null;
    try {
      analysis = await api.post(`/api/cases/${caseState.current.id}/inspect/analyze`, {
        path: activeFrame.path,
        name,
        time: activeFrame.time ?? null,
        ops: buildOps(filters, activeFrame.adjust, activeFrame.crop),
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
  <div class="tray">
    {#each session.frames as fr, i (fr.id)}
      <div class="thumb" class:active={fr.id === session.activeFrameId}>
        <button class="pick" onclick={() => setActive(fr.id)} title={fr.time != null ? `Image ${i + 1} · t=${fr.time.toFixed(2)}s` : `Image ${i + 1}`}>
          <img
            class:cropped={fr.crop}
            src={fr.url}
            alt={`Image ${i + 1}`}
            style={styleText(cropImgStyle(fr.crop))}
            style:filter={previewStyle(filters, fr.adjust).filter}
          />
          <span class="num">{i + 1}</span>
          {#if session.saved[`frame:${fr.id}`]}<span class="saved" title="Saved"><Icon name="check" size={11} /></span>{/if}
        </button>
        <button class="del" onclick={() => removeFrame(fr.id)} aria-label="Remove frame"><Icon name="x" size={12} /></button>
      </div>
    {/each}
    {#if session.frames.length === 0}
      <p class="empty">No frames yet — capture some in the Selection tab.</p>
    {/if}
  </div>

  {#if activeFrame}
    <div class="section">
      <AdjustSliders {filters} values={activeFrame.adjust} />
      <div class="crop-row">
        <button class="btn btn-sm" class:active={shared.cropMode} onclick={toggleCrop}>
          <Icon name="crop" size={14} /> {shared.cropMode ? 'Drag on image…' : 'Crop region'}
        </button>
        {#if activeFrame.crop}
          <span class="crop-info mono">
            {Math.round(activeFrame.crop.w * 100)}% × {Math.round(activeFrame.crop.h * 100)}%
          </span>
          <button class="btn btn-ghost btn-xs" onclick={clearCrop} aria-label="Clear crop"><Icon name="x" size={13} /></button>
        {/if}
      </div>
      <button class="btn btn-ghost btn-sm reset" onclick={reset}><Icon name="reset" size={14} /> Reset frame</button>
    </div>

    <div class="section">
      <button class="section-head as-btn" onclick={() => (showAnalyze = !showAnalyze)}>
        <span><Icon name="eye" size={14} /> Analyze</span>
        <Icon name={showAnalyze ? 'chevronDown' : 'chevronRight'} size={14} />
      </button>
      {#if showAnalyze}
        <div class="atabs">
          {#each analyses as a (a.id)}
            <button class="btn btn-sm" class:active={analyzing === a.id} onclick={() => runAnalysis(a.id)}>{a.label}</button>
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
      {/if}
    </div>
  {/if}
</div>

<style>
  .module {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .tray {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .thumb {
    position: relative;
    width: 60px;
    height: 60px;
  }
  .thumb .pick {
    position: relative;
    width: 100%;
    height: 100%;
    border-radius: var(--r-sm);
    overflow: hidden;
    border: 2px solid transparent;
    padding: 0;
  }
  .thumb.active .pick {
    border-color: var(--accent);
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .thumb .del {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--bg-2);
    border: 1px solid var(--border-strong);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-2);
  }
  .num {
    position: absolute;
    top: 2px;
    left: 2px;
    min-width: 15px;
    height: 15px;
    padding: 0 3px;
    border-radius: 4px;
    background: rgba(6, 9, 14, 0.7);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    line-height: 15px;
    text-align: center;
  }
  .saved {
    position: absolute;
    bottom: 2px;
    left: 2px;
    background: var(--accent);
    color: #10141c;
    border-radius: 4px;
    display: flex;
    padding: 1px;
  }
  .empty {
    color: var(--text-3);
    font-size: var(--fs-xs);
    margin: 4px 0;
  }
  .section {
    border-top: 1px solid var(--border);
    padding-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 9px;
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
  .reset {
    align-self: flex-start;
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
