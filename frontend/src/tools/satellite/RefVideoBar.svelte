<script>
  /**
   * The slim player under a reference clip. The clip's native controls would
   * zoom with it, so it gets these: play, a bar to scrub, the time of the frame
   * on screen, a frame back or forward, slow motion, sound, and that frame kept
   * as a picture in a window of its own.
   *
   * The arithmetic is the Inspect player's (`lib/inspectPlayer.js`): a frame is
   * named by its own timestamp, and a step seeks half a frame into the next.
   * Where the clip was rides on the viewer, since docking draws the window again.
   */
  import { untrack } from 'svelte';
  import Icon from '../../components/Icon.svelte';
  import { frameDuration, preciseClock, shownFrameTime, speedLabel, stepTarget } from '../../lib/inspectPlayer.js';
  import { nextSlowRate } from '../../lib/refViewers.js';

  let {
    /** The clip's element, owned by the window it plays in. */
    video,
    viewer,
    /** The window's fade control, first on the second row. */
    fade,
    /** The zoom readout, while the clip is zoomed in. */
    zoom = null,
    /** The frame on screen, as a JPEG data URL, and its time. */
    onkeep,
    /** How far the clip has played, as a width, for the hairline at rest. */
    progress = $bindable('0%'),
  } = $props();

  let paused = $state(true);
  let time = $state(0);
  let presented = $state(null); // the frame the browser last drew, when it says
  let duration = $state(0);

  const shown = $derived(shownFrameTime(time, viewer.fps, presented));
  const fill = $derived(duration ? `${Math.min(100, (shown / duration) * 100)}%` : '0%');

  $effect(() => {
    progress = fill;
  });

  $effect(() => {
    const clip = video;
    if (!clip) return;
    const pane = untrack(() => viewer);
    const read = () => {
      paused = clip.paused;
      time = clip.currentTime;
      duration = Number.isFinite(clip.duration) ? clip.duration : 0;
    };
    // a window drawn again (docked, floated back) picks the clip up where it was
    const resume = () => {
      read();
      if (pane.at > 0) clip.currentTime = pane.at;
      if (pane.playing) clip.play().catch(() => {});
    };
    const events = ['play', 'pause', 'timeupdate', 'durationchange', 'seeked'];
    for (const name of events) clip.addEventListener(name, read);
    if (clip.readyState >= 1) resume();
    else clip.addEventListener('loadedmetadata', resume, { once: true });
    let handle = 0;
    if (clip.requestVideoFrameCallback) {
      const tick = (_now, meta) => {
        presented = meta.mediaTime;
        time = clip.currentTime;
        handle = clip.requestVideoFrameCallback(tick);
      };
      handle = clip.requestVideoFrameCallback(tick);
    }
    return () => {
      for (const name of events) clip.removeEventListener(name, read);
      clip.removeEventListener('loadedmetadata', resume);
      clip.cancelVideoFrameCallback?.(handle);
      if (clip.readyState >= 1) {
        pane.at = clip.currentTime;
        pane.playing = !clip.paused;
      }
    };
  });

  $effect(() => {
    if (video) video.playbackRate = viewer.rate;
  });

  $effect(() => {
    if (video) video.muted = viewer.muted;
  });

  function seek(to) {
    if (!video) return;
    presented = null; // until the new frame is drawn, the one on screen is worked out
    video.currentTime = to;
    time = to;
  }

  export function togglePlay() {
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }

  export function stepFrames(n) {
    if (!video) return;
    video.pause();
    seek(stepTarget(shown, n * frameDuration(viewer.fps), viewer.fps, duration));
  }

  /** The frame on screen, at the clip's own size, held as the session's. */
  function keep() {
    if (!video?.videoWidth) return;
    video.pause();
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    let still;
    try {
      canvas.getContext('2d').drawImage(video, 0, 0);
      still = canvas.toDataURL('image/jpeg', 0.95);
    } catch {
      return; // a canvas the browser will not draw or read back
    }
    onkeep?.(still, shown);
  }
</script>

<div class="vb-row">
  <button class="vb-btn" onclick={togglePlay} title={paused ? 'Play' : 'Pause'} aria-label={paused ? 'Play' : 'Pause'}>
    <Icon name={paused ? 'play' : 'pause'} size={13} />
  </button>
  <input
    class="vb-scrub"
    type="range"
    min="0"
    max={duration || 1}
    step="any"
    value={shown}
    disabled={!duration}
    style:--fill={fill}
    oninput={(e) => seek(Number(e.currentTarget.value))}
    aria-label="Position"
  />
  <span class="vb-time mono" title="Time of the frame on screen">{preciseClock(shown)}</span>
</div>
<div class="vb-row">
  {@render fade?.()}
  <span class="vb-gap"></span>
  {@render zoom?.()}
  <button class="vb-btn" onclick={() => stepFrames(-1)} title="Back one frame" aria-label="Back one frame">
    <Icon name="chevronLeft" size={13} />
  </button>
  <button class="vb-btn" onclick={() => stepFrames(1)} title="Forward one frame" aria-label="Forward one frame">
    <Icon name="chevronRight" size={13} />
  </button>
  <button
    class="vb-rate"
    class:lit={viewer.rate !== 1}
    onclick={() => (viewer.rate = nextSlowRate(viewer.rate))}
    title={nextSlowRate(viewer.rate) === 1 ? 'Normal speed' : 'Slower'}
    aria-label="Speed"
  >
    {speedLabel(viewer.rate)}
  </button>
  <button
    class="vb-btn"
    onclick={() => (viewer.muted = !viewer.muted)}
    title={viewer.muted ? 'Sound on' : 'Mute'}
    aria-label={viewer.muted ? 'Sound on' : 'Mute'}
  >
    <Icon name={viewer.muted ? 'volumeOff' : 'volume'} size={13} />
  </button>
  <button class="vb-btn" onclick={keep} title="Keep this frame as a picture" aria-label="Keep this frame">
    <Icon name="camera" size={13} />
  </button>
</div>

<style>
  .vb-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
    min-height: 24px;
    color: var(--text-3);
  }
  .vb-gap {
    flex: 1;
  }
  .vb-btn,
  .vb-rate {
    display: grid;
    place-items: center;
    height: 22px;
    border-radius: var(--r-sm);
    color: var(--text-2);
    cursor: pointer;
    flex-shrink: 0;
  }
  .vb-btn {
    width: 22px;
  }
  .vb-rate {
    min-width: 32px;
    padding: 0 4px;
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
  }
  .vb-btn:hover,
  .vb-rate:hover {
    color: var(--text-1);
    background: rgba(255, 255, 255, 0.08);
  }
  .vb-rate.lit {
    color: var(--accent);
  }
  .vb-time {
    flex-shrink: 0;
    min-width: 58px;
    padding: 0 2px 0 6px;
    text-align: right;
    font-size: var(--fs-xs);
    color: var(--text-2);
  }
  .vb-scrub {
    flex: 1;
    min-width: 60px;
    height: 14px;
    margin: 0 4px;
    background: transparent;
    appearance: none;
    cursor: pointer;
  }
  .vb-scrub:disabled {
    cursor: default;
    opacity: 0.5;
  }
  .vb-scrub::-webkit-slider-runnable-track {
    height: 3px;
    border-radius: 2px;
    background: linear-gradient(to right, var(--accent) var(--fill), rgba(255, 255, 255, 0.22) var(--fill));
  }
  .vb-scrub::-moz-range-track {
    height: 3px;
    border-radius: 2px;
    background: linear-gradient(to right, var(--accent) var(--fill), rgba(255, 255, 255, 0.22) var(--fill));
  }
  .vb-scrub::-webkit-slider-thumb {
    appearance: none;
    width: 10px;
    height: 10px;
    margin-top: -3.5px;
    border: none;
    border-radius: 50%;
    background: var(--text-1);
  }
  .vb-scrub::-moz-range-thumb {
    width: 10px;
    height: 10px;
    border: none;
    border-radius: 50%;
    background: var(--text-1);
  }
</style>
