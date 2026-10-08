<script>
  /**
   * The band over the view while a photo or a video lies on it: which file,
   * how much of it shows against the terrain (or a blink between the two), the
   * skyline traced on it and how far the terrain's lies from it, and a way to
   * take it away. It sits above the frame rather than on it, so nothing covers
   * the photo being matched.
   */
  import Icon from '../../components/Icon.svelte';
  import { clockTime } from '../../lib/inspect.js';
  import { gapDegrees, gapSpan } from '../../lib/horizon/overlay.js';

  let {
    /** The overlay (state/overlay.svelte.js). */
    overlay,
    /** How far the trace lies from the terrain's skyline (`traceGap`), or null. */
    gap = null,
    /** Asked to lay another file. */
    onchange = () => {},
    /** Asked to turn the view onto the trace. */
    onfit = () => {},
  } = $props();

  const terrainShare = $derived(Math.round((1 - overlay.mix) * 100));
  const what = $derived(overlay.source?.kind === 'video' ? 'Video' : 'Photo');
  const away = $derived(overlay.source?.kind === 'video' && overlay.strokes.length > 0 && !overlay.traceShown);
</script>

<div class="overlay-bar" role="toolbar" aria-label="Photo over the view">
  <button type="button" class="file" onclick={onchange} title="Lay another photo or video">
    <Icon name={overlay.source?.kind === 'video' ? 'video' : 'image'} size={14} />
    <span class="name">{overlay.source?.name ?? ''}</span>
    <Icon name="chevronDown" size={12} />
  </button>

  <div class="fade" class:dim={overlay.blink}>
    <button
      type="button"
      class="end"
      class:on={overlay.mix === 1 && !overlay.blink}
      aria-pressed={overlay.mix === 1 && !overlay.blink}
      onclick={() => overlay.setMix(1)}
      title="Show only the {what.toLowerCase()}, the ridge lines over it">{what}</button
    >
    <input
      type="range"
      min="0"
      max="100"
      step="1"
      value={terrainShare}
      oninput={(event) => overlay.setMix(1 - Number(event.currentTarget.value) / 100)}
      aria-label="{what} or terrain"
      aria-valuetext="{100 - terrainShare}% {what.toLowerCase()}"
    />
    <button
      type="button"
      class="end"
      class:on={overlay.mix === 0 && !overlay.blink}
      aria-pressed={overlay.mix === 0 && !overlay.blink}
      onclick={() => overlay.setMix(0)}
      title="Show only the terrain">Terrain</button
    >
  </div>

  <button
    type="button"
    class="act"
    class:on={overlay.blink}
    aria-pressed={overlay.blink}
    onclick={() => overlay.setBlink(!overlay.blink)}
    title="Switch between the {what.toLowerCase()} and the terrain (B)"
  >
    <Icon name="blink" size={14} /><span class="word">Blink</span>
  </button>

  <span class="divider" aria-hidden="true"></span>

  <button
    type="button"
    class="act"
    class:on={overlay.tracing}
    aria-pressed={overlay.tracing}
    onclick={() => overlay.setTracing(!overlay.tracing)}
    title="Draw along the skyline in the {what.toLowerCase()} (T)"
  >
    <Icon name="freehand" size={14} /><span class="word">Trace skyline</span>
  </button>

  <div class="reading" aria-live="polite">
    {#if away}
      <span class="say">Trace drawn at <span class="mono">{clockTime(overlay.traceTime)}</span></span>
      <button type="button" class="act" onclick={() => overlay.seekTrace()}>Go there</button>
    {:else if gap}
      <span class="gap" title="The median angle between your trace and the terrain's skyline">
        <strong class="mono">Gap {gapDegrees(gap)}°</strong><span class="span">over {gapSpan(gap)}° of skyline</span>
      </span>
      <button type="button" class="act" onclick={onfit} title="Turn, tilt and roll the terrain to meet your trace">
        <Icon name="wand" size={14} /><span class="word">Fit to trace</span>
      </button>
    {:else if overlay.tracing}
      <span class="say">Draw along the skyline in the {what.toLowerCase()}.</span>
    {:else if overlay.busy}
      <span class="say"><span class="spinner" aria-hidden="true"></span>Opening…</span>
    {:else if overlay.error}
      <span class="say bad">{overlay.error}</span>
    {/if}
  </div>

  <button
    type="button"
    class="act close"
    onclick={() => overlay.remove()}
    title="Take the {what.toLowerCase()} away"
    aria-label="Take the {what.toLowerCase()} away"
  >
    <Icon name="x" size={14} />
  </button>
</div>

<style>
  .overlay-bar {
    container-type: inline-size;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 40px;
    padding: 0 8px 0 10px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-1);
    font-size: var(--fs-xs);
    color: var(--text-2);
  }
  .file,
  .act,
  .end {
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
  .file {
    max-width: 230px;
    box-shadow: inset 0 0 0 1px var(--border);
    color: var(--text-1);
  }
  .file .name {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .file:hover,
  .act:hover,
  .end:hover {
    color: var(--text-1);
    background: color-mix(in srgb, var(--text-1) 7%, transparent);
  }
  .act.on,
  .end.on {
    color: var(--accent);
    background: var(--accent-soft);
  }
  .file:focus-visible,
  .act:focus-visible,
  .end:focus-visible,
  input:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .fade {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .fade.dim {
    opacity: 0.55;
  }
  /* the two ends are buttons alike, lit only at the end the slider sits at */
  .end {
    height: 24px;
    padding: 0 7px;
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .fade {
    gap: 8px;
  }
  .fade input {
    width: 130px;
    accent-color: var(--accent);
  }
  .divider {
    flex: none;
    width: 1px;
    height: 20px;
    background: var(--border);
  }
  .reading {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    margin-left: auto;
    overflow: hidden;
  }
  .gap {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    white-space: nowrap;
  }
  .gap strong {
    color: var(--text-1);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .gap .span {
    color: var(--text-2);
  }
  .say {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bad {
    color: var(--danger);
  }
  .close {
    padding: 0 7px;
  }
  .spinner {
    width: 10px;
    height: 10px;
    border: 2px solid color-mix(in srgb, var(--text-1) 25%, transparent);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  /* a narrow view keeps the icons and says the rest in their tooltips */
  @container (max-width: 820px) {
    .word {
      display: none;
    }
    .file {
      max-width: 150px;
    }
  }
  @container (max-width: 640px) {
    .fade input {
      width: 70px;
    }
    .gap .span {
      display: none;
    }
  }
</style>
