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
   *
   * A scene being geolocated in the clip (`viewer.scene`) is marked on the bar in
   * its colour, a band over a passage and a pin at an instant, and a press on its
   * mark goes back to where it starts. Nothing loops: the clip plays on past it.
   * A time handed in (`viewer.cue`) is shown once, paused.
   */
  import { untrack } from 'svelte';
  import Icon from '../../components/Icon.svelte';
  import {
    frameDuration, preciseClock, seekInto, shownFrameTime, speedLabel, stepTarget,
  } from '../../lib/inspectPlayer.js';
  import { nextSlowRate } from '../../lib/refViewers.js';
  import { momentTime } from '../../lib/scenes.js';

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
    /** The scene's stretch as the hairline at rest marks it: `{ left, width, color }`. */
    sceneMark = $bindable(null),
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

  // The scene's place on the bar, as fractions of the clip once its length is known.
  const scene = $derived(viewer.scene && Number.isFinite(viewer.scene.start) ? viewer.scene : null);
  const mark = $derived.by(() => {
    if (!scene || !(duration > 0)) return null;
    const left = Math.min(1, Math.max(0, scene.start / duration));
    const right = Number.isFinite(scene.end) ? Math.min(1, Math.max(left, scene.end / duration)) : null;
    return {
      left: `${left * 100}%`,
      width: right == null ? null : `${(right - left) * 100}%`,
      color: scene.color ?? 'var(--accent)',
    };
  });
  const sceneWords = $derived(
    scene ? [scene.label, momentTime({ start: scene.start, end: scene.end })].filter(Boolean).join(' · ') : '',
  );

  $effect(() => {
    sceneMark = mark;
  });

  // A time handed in is shown once, paused, whenever the clip can seek.
  $effect(() => {
    const clip = video;
    const at = viewer.cue;
    if (!clip || at == null) return;
    const show = () => {
      clip.pause();
      seek(seekInto(at, viewer.fps, Number.isFinite(clip.duration) ? clip.duration : 0));
      viewer.cue = null;
    };
    if (clip.readyState >= 1) {
      show();
      return;
    }
    clip.addEventListener('loadedmetadata', show, { once: true });
    return () => clip.removeEventListener('loadedmetadata', show);
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

  /** Back to the frame the scene starts on, paused. */
  function toScene() {
    if (!video || !scene) return;
    video.pause();
    seek(seekInto(scene.start, viewer.fps, duration));
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
  <span class="vb-track">
    {#if mark}
      <!-- the scene under the bar, inset by half the thumb as the browser draws the track -->
      <span class="vb-lane" aria-hidden="true">
        <span
          class="vb-scene"
          class:pin={mark.width == null}
          data-testid="ref-scene"
          style:left={mark.left}
          style:width={mark.width}
          style:--scene={mark.color}
        ></span>
      </span>
    {/if}
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
  </span>
  <span class="vb-time mono" title="Time of the frame on screen">{preciseClock(shown)}</span>
</div>
<div class="vb-row">
  {@render fade?.()}
  <span class="vb-gap"></span>
  {@render zoom?.()}
  {#if mark}
    <button
      class="vb-btn vb-to-scene"
      style:--scene={mark.color}
      onclick={toScene}
      title={`Back to the start of the scene, ${sceneWords}`}
      aria-label="Back to the scene"
    >
      <Icon name="pin" size={13} />
    </button>
  {/if}
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
  .vb-track {
    position: relative;
    flex: 1;
    min-width: 60px;
    display: flex;
    margin: 0 4px;
  }
  .vb-lane {
    position: absolute;
    left: 5px;
    right: 5px;
    top: 0;
    bottom: 0;
    pointer-events: none;
  }
  /* The scene: a tinted stretch around the track, edged in its colour; an instant, a pin. */
  .vb-scene {
    position: absolute;
    top: 2px;
    bottom: 2px;
    min-width: 3px;
    border-radius: 2px;
    background: color-mix(in srgb, var(--scene) 40%, transparent);
    box-shadow: inset 0 -2px 0 var(--scene);
  }
  .vb-scene.pin {
    width: 2px;
    min-width: 0;
    margin-left: -1px;
    top: 0;
    bottom: 0;
    border-radius: 1px;
    background: var(--scene);
    box-shadow: none;
  }
  .vb-to-scene :global(svg) {
    color: var(--scene);
  }
  .vb-scrub {
    position: relative;
    flex: 1;
    min-width: 0;
    width: 100%;
    height: 14px;
    margin: 0;
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
