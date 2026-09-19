<script>
  import Icon from '../../components/Icon.svelte';

  let {
    src,
    filter = '',
    transform = '',
    quarterTurn = false,
    duration = 0,
    currentTime = 0,
    video = $bindable(),
    ontimeupdate,
  } = $props();

  let shell = $state();
  let canvas = $state();
  let canvasSize = $state({ width: 0, height: 0 });
  let paused = $state(true);
  let muted = $state(false);
  let mediaDuration = $state(0);

  const totalDuration = $derived(duration || mediaDuration || 0);
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

  function togglePlayback() {
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }

  function seek(e) {
    if (!video) return;
    video.currentTime = Number(e.currentTarget.value);
    ontimeupdate(video.currentTime);
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

  function fmt(value) {
    const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
</script>

<div class="video-shell" bind:this={shell}>
  <div class="video-canvas" bind:this={canvas}>
    <!-- svelte-ignore a11y_media_has_caption -->
    <video
      bind:this={video}
      {src}
      playsinline
      onloadedmetadata={() => (mediaDuration = video?.duration ?? 0)}
      ontimeupdate={() => ontimeupdate(video?.currentTime ?? 0)}
      onplay={() => (paused = false)}
      onpause={() => (paused = true)}
      onvolumechange={() => (muted = video?.muted ?? false)}
      style:filter
      style:max-width={maxWidth}
      style:max-height={maxHeight}
      style:transform
    ></video>
  </div>
  <div class="player-bar">
    <button class="player-btn" onclick={togglePlayback} aria-label={paused ? 'Play' : 'Pause'} title={paused ? 'Play' : 'Pause'}>
      <Icon name={paused ? 'play' : 'pause'} size={16} />
    </button>
    <input
      class="player-seek"
      type="range"
      min="0"
      max={totalDuration}
      step="any"
      value={currentTime}
      oninput={seek}
      aria-label="Video position"
    />
    <span class="player-time mono">{fmt(currentTime)} / {fmt(totalDuration)}</span>
    <button class="player-btn" onclick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute' : 'Mute'}>
      <Icon name={muted ? 'volumeOff' : 'volume'} size={16} />
    </button>
    <button class="player-btn" onclick={toggleFullscreen} aria-label="Full screen" title="Full screen">
      <Icon name="maximize" size={16} />
    </button>
  </div>
</div>

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
  }
  .video-canvas video {
    position: absolute;
    inset: 0;
    margin: auto;
    display: block;
    transform-origin: center;
    box-shadow: var(--shadow-2);
  }
  .player-bar {
    flex-shrink: 0;
    min-height: 40px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 9px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-1);
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
  }
  .player-btn:hover {
    color: var(--text-1);
    background: var(--bg-2);
  }
  .player-seek {
    flex: 1;
    min-width: 60px;
    accent-color: var(--accent);
  }
  .player-time {
    flex-shrink: 0;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
</style>
