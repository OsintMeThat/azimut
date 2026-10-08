<script>
  /**
   * The band over the view while a photo or a video lies on it, read left to
   * right as the work goes: which file; how much of it shows against the
   * terrain, or a blink between the two; the skyline traced or found on it,
   * and the photo's corners to pull; how far the terrain's skyline lies from
   * the trace, with the fit that closes it as the one lit act, and the lock
   * that holds the match once it is good; then how the ground is drawn,
   * every gesture and key, and a way to take the photo away.
   * It sits above the frame rather than on it, so nothing covers the photo
   * being matched, and the ground's own controls leave the view for it.
   */
  import Icon from '../../components/Icon.svelte';
  import PictureControls from './PictureControls.svelte';
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
    /** Asked to find the skyline in the photo. */
    ondetect = () => {},
    /** The tab's view state, for how the ground is drawn under the photo; none hides that menu. */
    view = null,
    /** Whether a Copernicus key is set, and how to ask for the setup when it is not (PictureControls). */
    copernicus = false,
    onsetup = () => {},
  } = $props();

  const terrainShare = $derived(Math.round((1 - overlay.mix) * 100));
  const what = $derived(overlay.source?.kind === 'video' ? 'Video' : 'Photo');
  const away = $derived(overlay.source?.kind === 'video' && overlay.strokes.length > 0 && !overlay.traceShown);
  const isPhoto = $derived(overlay.source?.kind === 'image');
  const GROUND_NAMES = { relief: 'Relief', imagery: 'Satellite', plain: 'Plain' };

  /** The gestures and keys over a photo, by what they are for. */
  const KEYS = [
    {
      title: 'Align',
      rows: [
        [['Drag'], 'Move the terrain under the photo'],
        [['Shift', 'drag'], 'Roll about the pivot'],
        [['Shift', 'click'], 'Set the pivot'],
        [['Shift', 'wheel'], 'Change the lens'],
        [['Alt', 'wheel'], 'Change the eye height'],
        [['W'], 'Reshape the photo by its corners'],
        [['L'], 'Pin the photo to the terrain, or unpin it'],
      ],
    },
    {
      title: 'Look',
      rows: [
        [['Wheel'], 'Look closer, or pinch'],
        [['Space', 'drag'], 'Move around the photo, or the middle button'],
        [['0'], 'Show the whole photo'],
        [['B'], 'Blink between photo and terrain'],
      ],
    },
    {
      title: 'Trace',
      rows: [
        [['T'], 'Draw along the skyline'],
        [['Alt', 'drag'], 'Draw without snapping'],
        [['E'], 'Rub out'],
        [['H'], 'Hide or show the trace'],
        [['Ctrl', 'Z'], 'Take the last change back'],
        [['Esc'], 'Put the pen down'],
      ],
    },
  ];
  const VIDEO_KEYS = {
    title: 'Video',
    rows: [
      [['Space'], 'Play or pause'],
      [[','], 'A frame back'],
      [['.'], 'A frame on'],
    ],
  };
  const groups = $derived(overlay.source?.kind === 'video' ? [...KEYS, VIDEO_KEYS] : KEYS);

  let keysOpen = $state(false);
  let keysButton = $state();
  let keysBox = $state();
  let groundOpen = $state(false);
  let groundButton = $state();
  let groundBox = $state();

  /** A press anywhere else, or Escape, folds a list away. */
  function onWindowPointer(event) {
    if (keysOpen && !keysBox?.contains(event.target) && !keysButton?.contains(event.target)) keysOpen = false;
    if (groundOpen && !groundBox?.contains(event.target) && !groundButton?.contains(event.target)) groundOpen = false;
  }
  function onWindowKey(event) {
    if ((keysOpen || groundOpen) && event.key === 'Escape') {
      event.stopPropagation();
      keysOpen = false;
      groundOpen = false;
    }
  }
</script>

<svelte:window onpointerdown={onWindowPointer} onkeydown={onWindowKey} />

<div class="overlay-bar" role="toolbar" aria-label="Photo over the view">
  <button type="button" class="file" onclick={onchange} title="Lay another photo or video">
    <Icon name={overlay.source?.kind === 'video' ? 'video' : 'image'} size={14} />
    <span class="name">{overlay.source?.name ?? ''}</span>
    <Icon name="chevronDown" size={12} />
  </button>

  <span class="divider" aria-hidden="true"></span>

  <div class="zone fade" class:dim={overlay.blink}>
    <!-- the two ends say which way the slider goes, and a press goes all the way there -->
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
    <Icon name="blink" size={14} /><span class="word spare">Blink</span>
  </button>

  <span class="divider" aria-hidden="true"></span>

  <div class="zone tools">
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
    <button
      type="button"
      class="act"
      onclick={ondetect}
      title="Find the skyline from the colours of sky and ground"
      aria-label="Detect the skyline"
    >
      <Icon name="profile" size={14} /><span class="word">Detect</span>
    </button>
    {#if overlay.strokes.length || overlay.erasing}
      <span class="sub" role="group" aria-label="The trace">
        <button
          type="button"
          class="act icon"
          class:on={overlay.erasing}
          aria-pressed={overlay.erasing}
          onclick={() => overlay.setErasing(!overlay.erasing)}
          title="Rub out part of the trace (E)"
          aria-label="Rub out part of the trace"
        >
          <Icon name="eraser" size={14} />
        </button>
        <button
          type="button"
          class="act icon"
          aria-pressed={overlay.traceHidden}
          onclick={() => overlay.setTraceHidden(!overlay.traceHidden)}
          title="{overlay.traceHidden ? 'Show' : 'Hide'} the trace (H)"
          aria-label="{overlay.traceHidden ? 'Show' : 'Hide'} the trace"
        >
          <Icon name={overlay.traceHidden ? 'eyeOff' : 'eye'} size={14} />
        </button>
        <button
          type="button"
          class="act icon"
          onclick={() => overlay.clearTrace()}
          disabled={!overlay.strokes.length}
          title="Clear the whole trace (Ctrl+Z brings it back)"
          aria-label="Clear the whole trace"
        >
          <Icon name="trash" size={14} />
        </button>
      </span>
    {/if}
    {#if isPhoto}
      <button
        type="button"
        class="act"
        class:on={overlay.warping}
        aria-pressed={overlay.warping}
        disabled={overlay.locked}
        onclick={() => overlay.setWarping(!overlay.warping)}
        title={overlay.locked ? 'Unlock the photo to reshape it' : 'Pull the photo by its corners, to square a photo taken at a slant (W)'}
        aria-label="Reshape the photo"
      >
        <Icon name="polygon" size={14} /><span class="word">Reshape</span>
      </button>
      {#if overlay.warped}
        <button
          type="button"
          class="act icon"
          disabled={overlay.locked}
          onclick={() => overlay.resetWarp()}
          title="Put the photo back square in the frame"
          aria-label="Square the photo again"
        >
          <Icon name="reset" size={14} />
        </button>
      {/if}
    {/if}
  </div>

  <div class="reading" aria-live="polite">
    {#if away}
      <span class="say">Trace drawn at <span class="mono">{clockTime(overlay.traceTime)}</span></span>
      <button type="button" class="act" onclick={() => overlay.seekTrace()}>Go there</button>
    {:else if gap}
      <span class="gap" title="The median angle between your trace and the terrain's skyline, over {gapSpan(gap)}° of it">
        <strong class="mono">Gap {gapDegrees(gap)}°</strong><span class="span">over {gapSpan(gap)}° of skyline</span>
      </span>
      <button
        type="button"
        class="act primary"
        disabled={overlay.locked}
        onclick={onfit}
        title={overlay.locked ? 'Unlock the photo to fit it again' : 'Turn, tilt and roll the terrain to meet your trace'}
        aria-label="Fit to trace"
      >
        <Icon name="wand" size={14} /><span class="word long">Fit to trace</span><span class="word short">Fit</span>
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
    class="act"
    class:on={overlay.locked}
    aria-pressed={overlay.locked}
    onclick={() => overlay.setLocked(!overlay.locked)}
    title={overlay.locked
      ? 'Unpin the photo from the terrain, back to matching it (L)'
      : 'Pin the photo to the terrain: drag and zoom then move over the terrain with the photo on it (L)'}
    aria-label="Lock the photo to the terrain"
  >
    <Icon name="lock" size={14} /><span class="word">{overlay.locked ? 'Locked' : 'Lock'}</span>
  </button>

  {#if view}
    <button
      bind:this={groundButton}
      type="button"
      class="act"
      class:on={groundOpen}
      aria-expanded={groundOpen}
      aria-controls="hz-photo-ground"
      onclick={() => (groundOpen = !groundOpen)}
      title="How the ground is drawn under the {what.toLowerCase()}"
    >
      <Icon name="layers" size={14} /><span class="word">{GROUND_NAMES[view.ground] ?? 'Ground'}</span>
      <Icon name="chevronDown" size={12} />
    </button>
  {/if}

  <button
    bind:this={keysButton}
    type="button"
    class="act icon"
    class:on={keysOpen}
    aria-expanded={keysOpen}
    aria-controls="hz-photo-keys"
    onclick={() => (keysOpen = !keysOpen)}
    title="Gestures and keys"
    aria-label="Gestures and keys"
  >
    <Icon name="keyboard" size={14} />
  </button>

  <button
    type="button"
    class="act icon close"
    onclick={() => overlay.remove()}
    title="Take the {what.toLowerCase()} away"
    aria-label="Take the {what.toLowerCase()} away"
  >
    <Icon name="x" size={14} />
  </button>

  {#if groundOpen && view}
    <div bind:this={groundBox} class="pop ground" id="hz-photo-ground" role="dialog" aria-label="Ground under the {what.toLowerCase()}">
      <h3>Ground under the {what.toLowerCase()}</h3>
      <PictureControls {view} {copernicus} {onsetup} />
    </div>
  {/if}

  {#if keysOpen}
    <div bind:this={keysBox} class="pop keys" id="hz-photo-keys" role="dialog" aria-label="Gestures and keys">
      {#each groups as group (group.title)}
        <section>
          <h3>{group.title}</h3>
          <dl>
            {#each group.rows as [keys, what] (what)}
              <dt>
                {#each keys as key, index (index)}{#if index}<span class="plus">+</span>{/if}<kbd>{key}</kbd>{/each}
              </dt>
              <dd>{what}</dd>
            {/each}
          </dl>
        </section>
      {/each}
    </div>
  {/if}
</div>

<style>
  .overlay-bar {
    position: relative;
    container-type: inline-size;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 42px;
    padding: 0 8px 0 10px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-1);
    font-size: var(--fs-xs);
    color: var(--text-2);
  }
  /* one kind of button all along the band: no box at rest, a soft ground on hover, amber when on */
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
  .act.icon {
    padding: 0 7px;
  }
  .file {
    max-width: 230px;
    color: var(--text-1);
    font-weight: 600;
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
  .act.on {
    color: var(--accent);
    background: var(--accent-soft);
  }
  /* the one act the band leads to: closing the gap */
  .act.primary {
    background: var(--accent);
    color: var(--accent-text);
    font-weight: 600;
  }
  .act.primary:hover:not(:disabled) {
    background: var(--accent-hover, var(--accent));
    color: var(--accent-text);
  }
  .file:focus-visible,
  .act:focus-visible,
  .end:focus-visible,
  input:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .zone {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .sub {
    display: inline-flex;
    align-items: center;
    gap: 0;
    margin: 0 2px;
    padding: 0 2px;
    border-radius: var(--r-md);
    background: color-mix(in srgb, var(--text-1) 4%, transparent);
  }
  .fade {
    gap: 6px;
  }
  .fade.dim {
    opacity: 0.55;
  }
  /* the slider's two ends are its labels: lit only at the end it sits at */
  .end {
    height: 24px;
    padding: 0 4px;
    color: var(--text-3);
  }
  .end.on {
    color: var(--text-1);
    background: transparent;
    font-weight: 600;
  }
  .fade input {
    width: 120px;
    accent-color: var(--accent);
  }
  .divider {
    flex: none;
    width: 1px;
    height: 20px;
    margin: 0 4px;
    background: var(--border);
  }
  .reading {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    margin-left: auto;
    padding-right: 4px;
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
    color: var(--text-3);
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
  .act:disabled {
    opacity: 0.4;
    cursor: default;
  }
  /* a list folded down over the view's top right corner */
  .pop {
    position: absolute;
    top: calc(100% + 6px);
    right: 8px;
    z-index: 30;
    display: grid;
    gap: 10px;
    max-height: 70vh;
    overflow-y: auto;
    padding: 12px 14px;
    border-radius: var(--r-md);
    background: var(--bg-1);
    box-shadow:
      0 0 0 1px var(--border),
      0 8px 24px rgba(0, 0, 0, 0.35);
    color: var(--text-1);
  }
  .keys {
    width: 340px;
  }
  .ground {
    --hz-glass: var(--bg-2);
    right: 48px;
    justify-items: start;
  }
  .ground :global(.picture) {
    align-items: flex-start;
  }
  .pop h3 {
    margin: 0 0 4px;
    color: var(--text-2);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .keys dl {
    display: grid;
    grid-template-columns: 96px 1fr;
    gap: 5px 12px;
    margin: 0;
  }
  .keys dt {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    white-space: nowrap;
  }
  .keys dd {
    margin: 0;
    color: var(--text-2);
  }
  .keys kbd {
    padding: 0 5px;
    border-radius: var(--r-sm);
    background: var(--bg-2);
    box-shadow: inset 0 -1px 0 var(--border);
    color: var(--text-1);
    font: inherit;
    font-size: 11px;
    line-height: 18px;
  }
  .keys .plus {
    color: var(--text-2);
    font-size: 10px;
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
  /* as the band narrows, the gap's number and every button stay; their words go, the least needed first */
  .short {
    display: none;
  }
  @container (max-width: 1300px) {
    .gap .span,
    .long {
      display: none;
    }
    .short {
      display: inline;
    }
  }
  @container (max-width: 1120px) {
    .spare {
      display: none;
    }
    .file {
      max-width: 160px;
    }
    .fade input {
      width: 90px;
    }
  }
  @container (max-width: 940px) {
    .word {
      display: none;
    }
    .file {
      max-width: 130px;
    }
  }
  @container (max-width: 640px) {
    .fade input {
      width: 64px;
    }
  }
</style>
