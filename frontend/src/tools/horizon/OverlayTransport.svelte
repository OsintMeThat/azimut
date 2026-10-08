<script>
  /**
   * A video's time, under the view: play and pause, the moment on show, and
   * the pins that keep the view's alignment at moments of it. Between two
   * pins the view turns as the camera did, so a pan is matched by aligning
   * its two ends. The scrubber steps a frame at a time from the keyboard.
   */
  import Icon from '../../components/Icon.svelte';
  import { clockTime } from '../../lib/inspect.js';

  let {
    /** The overlay (state/overlay.svelte.js), holding a video. */
    overlay,
  } = $props();

  const length = $derived(overlay.duration || 0);
  const share = (time) => (length > 0 ? Math.min(100, Math.max(0, (time / length) * 100)) : 0);
  const playTitle = $derived(
    !overlay.playable
      ? 'This browser cannot play this video: scrub to read its frames'
      : overlay.playing
        ? 'Pause (Space)'
        : 'Play (Space)'
  );
</script>

<div class="transport" role="group" aria-label="Video">
  <button
    type="button"
    class="act play"
    disabled={!overlay.playable}
    onclick={() => overlay.togglePlay()}
    title={playTitle}
    aria-label={overlay.playing ? 'Pause' : 'Play'}
  >
    <Icon name={overlay.playing ? 'pause' : 'play'} size={14} />
  </button>
  <span class="time mono">{clockTime(overlay.time)}</span>
  <div class="track">
    <input
      type="range"
      min="0"
      max={length || 1}
      step={1 / (overlay.fps || 30)}
      value={overlay.time}
      oninput={(event) => overlay.seek(Number(event.currentTarget.value))}
      aria-label="Moment in the video"
      aria-valuetext={clockTime(overlay.time)}
      title="Arrow keys step a frame"
    />
    {#each overlay.pins as pin (pin.time)}
      <button
        type="button"
        class="pin-mark"
        style:left="calc(8px + (100% - 16px) * {share(pin.time) / 100})"
        onclick={() => overlay.seek(pin.time)}
        title="Pinned at {clockTime(pin.time)}"
        aria-label="Go to the pin at {clockTime(pin.time)}"
      ></button>
    {/each}
  </div>
  <span class="time mono end">{clockTime(length)}</span>
  {#if overlay.pinnedHere}
    <button type="button" class="act on" onclick={() => overlay.unpin(overlay.time)} title="Forget the alignment kept at this moment">
      <Icon name="pin" size={14} />Unpin
    </button>
  {:else}
    <button
      type="button"
      class="act"
      onclick={() => overlay.pin()}
      title="Keep this alignment at {clockTime(overlay.time)}: between pins the view follows the video"
    >
      <Icon name="pin" size={14} />Pin the view here
    </button>
  {/if}
  {#if overlay.pins.length > 1 || (overlay.pins.length === 1 && !overlay.pinnedHere)}
    <button type="button" class="act" onclick={() => overlay.clearPins()} title="Forget every pin">Clear pins ({overlay.pins.length})</button>
  {/if}
</div>

<style>
  .transport {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 44px;
    padding: 0 10px;
    border-top: 1px solid var(--border);
    background: var(--bg-1);
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .act {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 9px;
    border: none;
    border-radius: var(--r-md);
    background: transparent;
    color: var(--text-2);
    font: inherit;
    white-space: nowrap;
    cursor: pointer;
  }
  .act:hover:not(:disabled) {
    color: var(--text-1);
    background: color-mix(in srgb, var(--text-1) 7%, transparent);
  }
  .act.on {
    color: var(--accent);
    background: var(--accent-soft);
  }
  .act:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .play {
    width: 30px;
    padding: 0;
    justify-content: center;
    box-shadow: inset 0 0 0 1px var(--border);
    color: var(--text-1);
  }
  .act:focus-visible,
  input:focus-visible,
  .pin-mark:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .time {
    min-width: 46px;
    color: var(--text-1);
  }
  .time.end {
    color: var(--text-2);
    text-align: right;
  }
  .track {
    position: relative;
    flex: 1;
    min-width: 80px;
    display: flex;
    align-items: center;
  }
  .track input {
    width: 100%;
    margin: 0;
    accent-color: var(--accent);
  }
  /* a pin is a small diamond over the track, the moment it keeps; the track's
     ends sit half a thumb in from its box */
  .pin-mark {
    position: absolute;
    top: -9px;
    width: 9px;
    height: 9px;
    padding: 0;
    border: 1.5px solid var(--bg-1);
    background: var(--accent);
    transform: translateX(-50%) rotate(45deg);
    cursor: pointer;
  }
</style>
