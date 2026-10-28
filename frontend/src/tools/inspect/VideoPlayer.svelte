<script>
  import {
    SPEEDS, faster as fasterRate, frameDuration, frameIndex, loopIsSet, loopRestart, preciseClock,
    seekInto, setLoopEnd, shownFrameTime, slower as slowerRate, speedLabel, stepTarget,
  } from '../../lib/inspectPlayer.js';
  import { ViewTransform } from '../../lib/viewTransform.svelte.js';
  import { INSPECT_HELP } from '../../lib/inspectHelp.js';
  import Icon from '../../components/Icon.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import TurnGuide from '../../components/TurnGuide.svelte';
  import PlayerTrack from './PlayerTrack.svelte';

  // The clip, read closely: zoomed, panned and turned like a frame
  // (`lib/viewTransform.svelte.js`), stepped a frame at a time, slowed, looped,
  // with what is known about it laid along the bar (`PlayerTrack`).
  //
  // `shared` is the bridge with the panel. The player writes `currentTime` and
  // `frameTime`, the timestamp of the frame on screen, which is what a capture
  // sends; it reads `seekTo` from whoever wants the clip somewhere.
  let {
    src,
    filter = '',
    transform = '',
    quarterTurn = false,
    duration = 0,
    fps = null,
    shared = $bindable(),
    video = $bindable(),
    frames = [],
    marks = [],
    shots = [],
    picks = [],
    tiles = null,
    stripUrl = null,
    waveform = null,
    original = false,
    oncapture,
  } = $props();

  let shell = $state();
  let canvas = $state();
  let layerEl = $state();
  let stageEl = $state();
  let canvasSize = $state({ width: 0, height: 0 });
  let paused = $state(true);
  let muted = $state(false);
  let rate = $state(1);
  let loop = $state({ a: null, b: null });
  let mediaDuration = $state(0);
  let speedAnchor = $state(null);
  let speedOpen = $state(false);
  const view = new ViewTransform();

  const totalDuration = $derived(duration || mediaDuration || 0);
  const shown = $derived(shownFrameTime(shared.currentTime, fps, shared.frameTime));
  const frameNumber = $derived(frameIndex(shown, fps) + 1);
  const frameCount = $derived(totalDuration ? Math.max(1, Math.round(totalDuration / frameDuration(fps))) : 0);
  const maxWidth = $derived(
    canvasSize.width ? `${quarterTurn ? canvasSize.height : canvasSize.width}px` : undefined
  );
  const maxHeight = $derived(
    canvasSize.height ? `${quarterTurn ? canvasSize.width : canvasSize.height}px` : undefined
  );

  $effect(() => {
    if (!canvas) return;
    const update = () => {
      const rect = canvas.getBoundingClientRect();
      canvasSize = { width: rect.width, height: rect.height };
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    return () => observer.disconnect();
  });

  // A seek asked for elsewhere: a mark, a shot, a rename that reopened the clip.
  $effect(() => {
    if (shared.seekTo != null && video) {
      seek(shared.seekTo);
      shared.seekTo = null;
    }
  });

  $effect(() => {
    if (video) video.playbackRate = rate;
  });

  // The frame the browser actually drew, so the clock and a capture name the very
  // frame on screen, even on a variable frame rate. It also keeps the loop to the
  // frame, where `timeupdate` would overshoot B by a quarter of a second.
  $effect(() => {
    const el = video;
    if (!el?.requestVideoFrameCallback) return;
    let handle = 0;
    const tick = (_now, meta) => {
      shared.frameTime = meta.mediaTime;
      const back = loopRestart(meta.mediaTime, loop);
      if (back != null && !el.paused) el.currentTime = seekInto(back, fps, totalDuration);
      handle = el.requestVideoFrameCallback(tick);
    };
    handle = el.requestVideoFrameCallback(tick);
    return () => el.cancelVideoFrameCallback?.(handle);
  });

  function seek(time) {
    if (!video) return;
    // until the new frame is drawn, the one on screen is worked out from the time
    shared.frameTime = null;
    video.currentTime = time;
    shared.currentTime = time;
  }

  function ontimeupdate() {
    const t = video?.currentTime ?? 0;
    shared.currentTime = t;
    if (!video?.requestVideoFrameCallback) {
      const back = loopRestart(t, loop);
      if (back != null && !video.paused) seek(seekInto(back, fps, totalDuration));
    }
  }

  export function togglePlay() {
    if (!video) return;
    if (video.paused) {
      // a loop set behind the playhead starts from its own beginning
      if (loopIsSet(loop) && (shown < loop.a || shown >= loop.b)) seek(seekInto(loop.a, fps, totalDuration));
      video.play().catch(() => {});
    } else video.pause();
  }

  /** Step by `seconds` from the frame on screen; one frame is `±frameDuration(fps)`. */
  export function stepBy(seconds) {
    if (!video) return;
    video.pause();
    seek(stepTarget(shown, seconds, fps, totalDuration));
  }

  export const stepFrames = (n) => stepBy(n * frameDuration(fps));
  export const slower = () => (rate = slowerRate(rate));
  export const faster = () => (rate = fasterRate(rate));

  function seekBar(time, exact) {
    seek(exact ? seekInto(time, fps, totalDuration) : time);
  }

  function toggleMute() {
    if (!video) return;
    video.muted = !video.muted;
    muted = video.muted;
  }

  function toggleFullscreen() {
    if (document.fullscreenElement === shell) document.exitFullscreen?.();
    else shell?.requestFullscreen?.();
  }

  function onwheel(e) {
    e.preventDefault();
    view.wheel(e, e.currentTarget.getBoundingClientRect());
  }

  function onpointerdown(e) {
    if (e.button === 1) {
      e.preventDefault();
      view.turnFrom(e, { viewport: canvas, layer: layerEl, stage: stageEl });
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    view.panFrom(e, { onclick: togglePlay });
  }
</script>

<div class="video-shell" bind:this={shell}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="video-canvas"
    class:rotating={view.turning}
    bind:this={canvas}
    {onwheel}
    {onpointerdown}
    onmousedown={(e) => e.button === 1 && e.preventDefault()}
    onauxclick={(e) => e.preventDefault()}
  >
    <div class="zoom-layer" bind:this={layerEl} style:transform={view.layerCss}>
      <div class="stage" bind:this={stageEl} style:transform={view.stageCss} style:transform-origin="0 0">
        <!-- svelte-ignore a11y_media_has_caption -->
        <video
          bind:this={video}
          {src}
          playsinline
          preload="auto"
          onloadedmetadata={() => (mediaDuration = video?.duration ?? 0)}
          {ontimeupdate}
          onseeked={() => (shared.currentTime = video?.currentTime ?? 0)}
          onplay={() => (paused = false)}
          onpause={() => (paused = true)}
          onvolumechange={() => (muted = video?.muted ?? false)}
          style:filter={original ? '' : filter}
          style:max-width={maxWidth}
          style:max-height={maxHeight}
          style:transform
        ></video>
      </div>
    </div>
    {#if view.turning}
      <TurnGuide x={view.pivot.x} y={view.pivot.y} />
    {/if}
    {#if original}
      <span class="original-tag">Without adjustments</span>
    {/if}
    <div class="view-ctl">
      {#if view.dirty}
        {#if view.zoom !== 1}<span class="val">{Math.round(view.zoom * 100)}%</span>{/if}
        {#if view.angle !== 0}<span class="val">{view.angle}°</span>{/if}
        <button class="btn btn-ghost btn-sm" onclick={() => view.reset()} title={INSPECT_HELP.fit}>
          <Icon name="eye" size={14} /> Fit
        </button>
      {:else}
        <span class="hint">scroll zoom · drag pan · middle-drag turns · click plays</span>
      {/if}
    </div>
  </div>

  <div class="player-bar" data-guide="inspect.player">
    <PlayerTrack
      duration={totalDuration}
      time={shown}
      {frames}
      {marks}
      {shots}
      {picks}
      {loop}
      {tiles}
      {stripUrl}
      {waveform}
      onseek={seekBar}
    />
    <div class="controls">
      <button class="player-btn" onclick={togglePlay} aria-label={paused ? 'Play' : 'Pause'} title={INSPECT_HELP.play}>
        <Icon name={paused ? 'play' : 'pause'} size={16} />
      </button>
      <button class="player-btn" onclick={() => stepFrames(-1)} aria-label="Back one frame" title={INSPECT_HELP.frameBack}>
        <Icon name="chevronLeft" size={16} />
      </button>
      <button class="player-btn" onclick={() => stepFrames(1)} aria-label="Forward one frame" title={INSPECT_HELP.frameForward}>
        <Icon name="chevronRight" size={16} />
      </button>
      <span class="player-time mono" title={INSPECT_HELP.clock}>
        <span class="now">{preciseClock(shown)}</span>
        <span class="of">/ {preciseClock(totalDuration)}</span>
        {#if frameCount}<span class="of">· frame {frameNumber} of {frameCount}</span>{/if}
      </span>
      <button
        class="player-btn wide"
        class:on={rate !== 1}
        bind:this={speedAnchor}
        onclick={() => (speedOpen = !speedOpen)}
        aria-label="Playback speed"
        title={INSPECT_HELP.speed}
      >{speedLabel(rate)}</button>
      <span class="loop-ctl" role="group" aria-label="Loop" data-guide="inspect.loop">
        <button class="player-btn ab" class:on={loop.a != null} onclick={() => (loop = setLoopEnd(loop, 'a', shown))} title={INSPECT_HELP.loopA}>A</button>
        <button class="player-btn ab" class:on={loop.b != null} onclick={() => (loop = setLoopEnd(loop, 'b', shown + frameDuration(fps)))} title={INSPECT_HELP.loopB}>B</button>
        {#if loop.a != null || loop.b != null}
          <button class="player-btn" onclick={() => (loop = { a: null, b: null })} aria-label="Stop looping" title={INSPECT_HELP.loopClear}>
            <Icon name="x" size={13} />
          </button>
        {/if}
      </span>
      <span class="spacer"></span>
      <span class="player-btn keys" title={INSPECT_HELP.keys}><Icon name="keyboard" size={16} /></span>
      <button class="player-btn" onclick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} title={INSPECT_HELP.mute}>
        <Icon name={muted ? 'volumeOff' : 'volume'} size={16} />
      </button>
      <button class="player-btn" onclick={toggleFullscreen} aria-label="Full screen" title={INSPECT_HELP.fullscreen}>
        <Icon name="maximize" size={16} />
      </button>
      <button class="player-btn capture" onclick={() => oncapture?.()} aria-label="Capture this frame" title={INSPECT_HELP.captureIcon}>
        <Icon name="camera" size={17} />
      </button>
    </div>
  </div>
</div>

{#if speedOpen}
  <FloatingMenu anchor={speedAnchor} width={120} label="Playback speed" onclose={() => (speedOpen = false)}>
    {#each SPEEDS as s (s)}
      <button class="fm-item speed-item" class:on={s === rate} role="menuitemradio" aria-checked={s === rate} onclick={() => { rate = s; speedOpen = false; }}>
        {speedLabel(s)}
      </button>
    {/each}
  </FloatingMenu>
{/if}

<style>
  .video-shell {
    width: 100%;
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-0);
  }
  .video-canvas {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: grab;
    touch-action: none;
  }
  .video-canvas.rotating {
    cursor: grabbing;
  }
  .zoom-layer {
    position: relative;
    transform-origin: center center;
    display: inline-block;
    line-height: 0;
  }
  .stage {
    position: relative;
    display: inline-block;
    line-height: 0;
  }
  .stage video {
    display: block;
    transform-origin: center;
    box-shadow: var(--shadow-2);
  }
  .view-ctl {
    position: absolute;
    right: 10px;
    bottom: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 6px;
    border-radius: var(--r-md);
    background: rgba(22, 22, 22, 0.85);
    border: 1px solid var(--border);
  }
  .val {
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }
  .hint {
    font-size: 11px;
    color: var(--text-3);
    user-select: none;
  }
  .original-tag {
    position: absolute;
    left: 10px;
    top: 10px;
    padding: 2px 8px;
    border-radius: var(--r-sm);
    background: rgba(22, 22, 22, 0.85);
    border: 1px solid var(--border);
    color: var(--text-2);
    font-size: var(--fs-xs);
    pointer-events: none;
  }
  .player-bar {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px 6px;
    border-top: 1px solid var(--border);
    background: var(--bg-1);
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  .player-btn {
    width: 28px;
    height: 28px;
    flex: 0 0 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--r-sm);
    color: var(--text-2);
    font-size: var(--fs-xs);
    font-weight: 600;
  }
  .player-btn:hover:not(:disabled):not(.keys) {
    color: var(--text-1);
    background: var(--bg-2);
  }
  .player-btn.on {
    color: var(--accent);
  }
  .player-btn.wide {
    width: auto;
    flex-basis: auto;
    padding: 0 7px;
    font-variant-numeric: tabular-nums;
  }
  .player-btn.ab {
    width: 24px;
    flex-basis: 24px;
  }
  .player-btn.keys {
    color: var(--text-3);
    cursor: help;
  }
  .player-btn.capture {
    color: var(--accent);
  }
  .loop-ctl {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    margin-left: 4px;
  }
  .player-time {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    margin: 0 6px;
    flex-shrink: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    font-size: var(--fs-xs);
  }
  .now {
    color: var(--text-1);
    font-weight: 700;
  }
  .of {
    color: var(--text-3);
  }
  .spacer {
    flex: 1;
  }
  .speed-item.on {
    color: var(--accent);
  }
</style>
