<script>
  import { MARK_LABEL_MAX, preciseClock, sortedMarks, tileAt, tileStyle } from '../../lib/inspectPlayer.js';
  import { clockTime } from '../../lib/inspect.js';
  import { INSPECT_HELP } from '../../lib/inspectHelp.js';
  import Icon from '../../components/Icon.svelte';

  // The Moments tab beside the video: the marks the analyst set on it, kept with the
  // file's work, and what a scan found, the shot changes with the sharpest frame of
  // each shot, and the sharpest frames overall.
  //
  // `onseek(time)` goes to a frame by its own timestamp; `oncapture(time)` cuts it.
  let {
    marks = $bindable([]),
    focusId = null,
    onaddmark,
    onremovemark,
    onseek,
    oncapture,
    scan = null,
    scanning = false,
    progress = null,
    onscan,
    tiles = null,
    stripUrl = null,
  } = $props();

  const ordered = $derived(sortedMarks(marks));
  const shots = $derived(scan?.shots ?? []);
  const picks = $derived(scan?.frames ?? []);
  const maxScore = $derived(Math.max(1e-9, ...picks.map((s) => s.score)));

  // A mark just added by its key is labelled straight away.
  function autofocus(node, id) {
    if (id === focusId) node.focus();
  }
</script>

<div class="module">
  <div class="block">
    <div class="block-head">
      <span class="head"><Icon name="flag" size={14} /> Marks</span>
      <button class="btn btn-sm" onclick={() => onaddmark?.()} title={INSPECT_HELP.addMark}>
        <Icon name="plus" size={13} /> Mark here
      </button>
    </div>
    {#if !ordered.length}
      <p class="hint">Mark a moment to come back to it. M marks where the video is.</p>
    {/if}
    {#each ordered as m (m.id)}
      <div class="mark-row">
        <button class="btn btn-ghost btn-xs mono stamp" onclick={() => onseek?.(m.time)} title={INSPECT_HELP.markSeek}>{preciseClock(m.time)}</button>
        <input
          class="input mark-label"
          dir="auto"
          bind:value={m.label}
          maxlength={MARK_LABEL_MAX}
          placeholder="What happens here"
          aria-label="Mark label"
          title={INSPECT_HELP.markLabel}
          onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          use:autofocus={m.id}
        />
        <button class="btn btn-ghost btn-xs" onclick={() => oncapture?.(m.time)} title={INSPECT_HELP.captureHere} aria-label="Capture this frame">
          <Icon name="camera" size={13} />
        </button>
        <button class="btn btn-ghost btn-xs" onclick={() => onremovemark?.(m.id)} title={INSPECT_HELP.markRemove} aria-label="Remove mark">
          <Icon name="x" size={12} />
        </button>
      </div>
    {/each}
  </div>

  <div class="block">
    <div class="block-head">
      <span class="head"><Icon name="scissors" size={14} /> Shots and sharp frames</span>
      <button class="btn btn-sm" disabled={scanning} onclick={() => onscan?.()} title={INSPECT_HELP.scan}>
        <Icon name={scanning ? 'clock' : 'search'} size={13} />
        {scanning ? `Scanning…${progress != null ? ` ${Math.round(progress)}%` : ''}` : scan ? 'Scan again' : 'Scan'}
      </button>
    </div>
    {#if !scan && !scanning}
      <p class="hint">Reads every frame once to find where the shot changes and which frames are sharpest.</p>
    {/if}
    {#if scan}
      <p class="sub">{shots.length === 1 ? 'One shot' : `${shots.length} shots`}</p>
      <div class="shots">
        {#each shots as s, i (s.start)}
          {@const tile = tileAt(s.best, tiles)}
          <div class="shot-card">
            <button class="shot-pick" onclick={() => onseek?.(s.best)} title={INSPECT_HELP.shot}>
              {#if tile && stripUrl}
                <span class="shot-thumb" style={tileStyle(tile, tiles, stripUrl)}></span>
              {:else}
                <span class="shot-thumb blank"><Icon name="video" size={16} /></span>
              {/if}
              <span class="shot-label mono">{i + 1} · {clockTime(s.start)}</span>
            </button>
            <button class="shot-cap" onclick={() => oncapture?.(s.best)} title={INSPECT_HELP.captureHere} aria-label="Capture the sharpest frame of this shot">
              <Icon name="camera" size={12} />
            </button>
          </div>
        {/each}
      </div>
      {#if picks.length}
        <p class="sub">Sharpest frames</p>
        {#each picks as s (s.time)}
          <div class="sugg" class:top={s.rank === 0}>
            <span class="mono">{clockTime(s.time)}</span>
            <div class="bar"><div class="fill" style:width={`${(s.score / maxScore) * 100}%`}></div></div>
            <button class="btn btn-ghost btn-xs" onclick={() => onseek?.(s.time)} title={INSPECT_HELP.seekHere} aria-label="Go to this frame">
              <Icon name="eye" size={13} />
            </button>
            <button class="btn btn-xs" onclick={() => oncapture?.(s.time)} title={INSPECT_HELP.captureHere} aria-label="Capture this frame">
              <Icon name="camera" size={13} />
            </button>
          </div>
        {/each}
      {/if}
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
  .block-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    font-size: var(--fs-sm);
  }
  .hint {
    color: var(--text-3);
    font-size: var(--fs-xs);
    margin: 0;
  }
  .sub {
    margin: 2px 0 0;
    color: var(--text-3);
    font-size: var(--fs-xs);
    font-weight: 600;
  }
  .mark-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .stamp {
    flex-shrink: 0;
    font-size: var(--fs-xs);
  }
  .mark-label {
    flex: 1;
    min-width: 0;
    padding: 3px 6px;
    font-size: var(--fs-sm);
  }
  .shots {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
    gap: 6px;
  }
  .shot-card {
    position: relative;
  }
  .shot-pick {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-0);
    overflow: hidden;
    cursor: pointer;
  }
  .shot-pick:hover {
    border-color: var(--accent);
  }
  .shot-thumb {
    display: block;
    align-self: center;
    zoom: 0.56;
  }
  .shot-thumb.blank {
    zoom: 1;
    width: 100%;
    height: 50px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-3);
  }
  .shot-label {
    padding: 0 4px 2px;
    font-size: 10px;
    color: var(--text-2);
    text-align: left;
  }
  .shot-cap {
    position: absolute;
    top: 3px;
    right: 3px;
    display: flex;
    padding: 2px;
    border: 0;
    border-radius: 3px;
    background: rgba(10, 10, 10, 0.7);
    color: #fff;
    cursor: pointer;
  }
  .shot-cap:hover {
    background: var(--accent);
    color: var(--accent-text);
  }
  .sugg {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 1px 0;
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
