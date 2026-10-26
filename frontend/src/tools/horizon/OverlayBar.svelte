<script>
  /**
   * The band over the view while a photo or a video lies on it holds what is
   * done on the picture, read left to right as the work goes: how much of it
   * shows against the terrain, or a blink between the two; the skyline traced
   * or found on it, and the photo's corners to pull; how far the terrain's
   * skyline lies from the trace, with the fit that closes it as the one lit
   * act; then every gesture and key. What is said about the photo (its file,
   * what is known of it, the places Fit found) is the inspector's Photo group.
   *
   * The photo and the terrain are named once, at the two ends of the slider,
   * and what is done to one sits by its name: a press on the name shows it
   * alone, the hand beside it says a drag and the wheel move it. Both hands
   * lit move both, the photo held to the terrain, which keeps the match once
   * it is good. How the ground is drawn stays on the view, as without a photo.
   */
  import { tick } from 'svelte';
  import Icon from '../../components/Icon.svelte';
  import DistanceChips from './DistanceChips.svelte';
  import { clockTime } from '../../lib/inspect.js';
  import { gapDegrees, gapSpan } from '../../lib/horizon/overlay.js';
  import { detailsTitle, editing, magnetTitle, pressTool, TRACE_TOOLS, toolBlocked, toolOn } from '../../lib/horizon/traceTools.js';
  import { AS_SEARCHED } from '../../lib/horizon/laid.js';

  let {
    /** The overlay (state/overlay.svelte.js). */
    overlay,
    /** How far the trace lies from the terrain's skyline (`traceGap`), or null. */
    gap = null,
    /** Asked to turn the view onto the trace. */
    onfit = () => {},
    /** Whether the fit is searching the turn. */
    fitting = false,
    /** Asked to find the skyline in the photo. */
    ondetect = () => {},
    /** Asked to show the photo above the terrain, the same frame on both. */
    onside = () => {},
    /** Whether that is being drawn. */
    siding = false,
  } = $props();

  const terrainShare = $derived(Math.round((1 - overlay.mix) * 100));
  const what = $derived(overlay.source?.kind === 'video' ? 'Video' : 'Photo');
  const away = $derived(overlay.source?.kind === 'video' && overlay.strokes.length > 0 && !overlay.traceShown);
  const isPhoto = $derived(overlay.source?.kind === 'image');

  /** The hand beside one end of the slider: lit when a drag and the wheel move that side. */
  function hand(side) {
    const name = side === 'photo' ? what.toLowerCase() : 'terrain';
    const on = overlay.moves === side || overlay.moves === 'both';
    // a panorama turns with the terrain alone
    const held = overlay.isPanorama && side === 'photo';
    let title = `Move the ${name} too, both held together (L)`;
    if (held) title = 'A panorama stays put: turn the terrain under it';
    else if (overlay.moves === 'both') title = 'Drag and the wheel move both, held together (L)';
    else if (on) title = `Drag and the wheel move the ${name}`;
    return { side, on, title, label: `Move the ${name}`, held };
  }
  const hands = $derived({ photo: hand('photo'), terrain: hand('terrain') });

  /** The gestures and keys over a photo, by what they are for. */
  const KEYS = [
    {
      title: 'Align',
      rows: [
        [['Drag'], 'Move what a hand is lit beside: the photo, the terrain or both'],
        [['Wheel'], 'Zoom it, or pinch'],
        [['Arrows'], 'Move it a step, + and − to zoom'],
        [['Shift', 'drag'], 'Roll the terrain about the pivot'],
        [['Shift', 'click'], 'Set the pivot'],
        [['Shift', 'wheel'], 'Change the lens'],
        [['Alt', 'wheel'], 'Change the eye height'],
        [['W'], 'Reshape the photo by its corners and edges'],
        [['L'], 'Move both, or back to one alone'],
      ],
    },
    {
      title: 'Look',
      rows: [
        [['Space', 'drag'], 'Move both, or the middle button'],
        [['Space', 'wheel'], 'Look closer at both'],
        [['0'], 'Show the whole photo'],
        [['B'], 'Blink between photo and terrain'],
      ],
    },
    {
      title: 'Trace',
      rows: [
        [['T'], 'Draw along the skyline'],
        [['R'], 'Draw a ridge seen against farther land'],
        [['P'], 'Pair a line in front with the line behind it'],
        [['X'], 'Cut a collage where its frames meet'],
        [['S'], "Draw along the sea's horizon"],
        [['K'], 'Say how far a line stands'],
        [['O'], 'Say only sky stands above a line'],
        [['I'], 'Mark a key line, three at most'],
        [['G'], 'Brush where the picture may be bent'],
        [['M'], 'Snap to edges, or not'],
        [['Alt', 'drag'], 'Draw the other way, snapped or not'],
        [['E'], 'Rub out'],
        [['H'], 'Hide or show the trace'],
        [['D'], 'Show how far the terrain may be off, the cuts and the pairs'],
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
  let bar = $state();

  /**
   * How far the band has given up its words, 0 to `TIGHTEST`. Read off what
   * overflows rather than off fixed widths, so whatever the band holds (a
   * trace, what is known, the places found) its last button never runs out of
   * the view; each step is tried in turn before the screen is painted. The
   * last one lays the band on two rows rather than hide a button.
   */
  const TIGHTEST = 6;
  let tight = $state(0);
  let narrowed = 0;
  async function narrow() {
    const mine = ++narrowed;
    for (let level = 0; level <= TIGHTEST; level += 1) {
      tight = level;
      await tick();
      if (mine !== narrowed || !bar || bar.scrollWidth <= bar.clientWidth) return;
    }
  }
  // what the band holds changes its width: a trace, its tools, the gap
  $effect(() => {
    void [overlay.source?.kind, overlay.strokes.length, overlay.erasing, overlay.warped, overlay.tracing, overlay.busy, overlay.error];
    void [overlay.linking, overlay.cutting, overlay.distancing, overlay.clearing, overlay.keying, overlay.bending, overlay.pen, overlay.front];
    void [gap, fitting, away];
    narrow();
  });
  $effect(() => {
    if (!bar || typeof ResizeObserver !== 'function') return;
    let width = bar.clientWidth;
    const watch = new ResizeObserver(() => {
      if (bar.clientWidth === width) return;
      width = bar.clientWidth;
      narrow();
    });
    watch.observe(bar);
    return () => watch.disconnect();
  });

  /** A press anywhere else, or Escape, folds the list of keys away. */
  function onWindowPointer(event) {
    if (keysOpen && !keysBox?.contains(event.target) && !keysButton?.contains(event.target)) keysOpen = false;
  }
  function onWindowKey(event) {
    if (keysOpen && event.key === 'Escape') {
      event.stopPropagation();
      keysOpen = false;
    }
  }
</script>

<svelte:window onpointerdown={onWindowPointer} onkeydown={onWindowKey} />

{#snippet handButton(side)}
  {@const one = hands[side]}
  <button
    type="button"
    class="act icon hand"
    class:on={one.on}
    aria-pressed={one.on}
    disabled={one.held}
    onclick={() => overlay.pressHand(side)}
    title={one.title}
    aria-label={one.label}
  >
    <Icon name="hand" size={15} />
  </button>
{/snippet}

<div
  bind:this={bar}
  class="overlay-bar"
  class:t1={tight >= 1}
  class:t2={tight >= 2}
  class:t3={tight >= 3}
  class:t4={tight >= 4}
  class:t5={tight >= 5}
  class:t6={tight >= 6}
  role="toolbar"
  aria-label="Photo over the view"
>
  {@render handButton('photo')}
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
  {@render handButton('terrain')}
  <button
    type="button"
    class="act"
    class:on={overlay.blink}
    aria-pressed={overlay.blink}
    onclick={() => overlay.setBlink(!overlay.blink)}
    title="Switch between the {what.toLowerCase()} and the terrain (B)"
    aria-label="Blink"
  >
    <Icon name="blink" size={14} /><span class="word spare">Blink</span>
  </button>
  <button
    type="button"
    class="act"
    disabled={siding}
    aria-busy={siding}
    onclick={onside}
    title="Show the {what.toLowerCase()} above the terrain, the same frame on both"
    aria-label="Side by side"
  >
    <Icon name="columns" size={14} /><span class="word spare">Side by side</span>
  </button>

  <span class="divider" aria-hidden="true"></span>

  <div class="zone tools">
    <button
      type="button"
      class="act"
      class:on={toolOn(overlay, 'sky')}
      aria-pressed={toolOn(overlay, 'sky')}
      onclick={() => pressTool(overlay, 'sky')}
      title={TRACE_TOOLS[0].title}
      aria-label={TRACE_TOOLS[0].name}
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
      <Icon name="profile" size={14} /><span class="word minor">Detect</span>
    </button>
    {#if overlay.strokes.length || editing(overlay)}
      <span class="sub" role="group" aria-label="The trace">
        {#each TRACE_TOOLS.slice(1) as tool (tool.id)}
          {@const on = toolOn(overlay, tool.id)}
          {@const blocked = toolBlocked(overlay, tool.id)}
          <button
            type="button"
            class="act icon"
            class:on
            aria-pressed={on}
            disabled={Boolean(blocked) && !on}
            onclick={() => pressTool(overlay, tool.id)}
            title={blocked || tool.title}
            aria-label={tool.name}
          >
            <Icon name={tool.icon} size={14} />
          </button>
        {/each}
        <button
          type="button"
          class="act icon"
          class:on={overlay.magnet}
          aria-pressed={overlay.magnet}
          onclick={() => overlay.setMagnet(!overlay.magnet)}
          title={magnetTitle(overlay.magnet)}
          aria-label="Snap to edges"
        >
          <Icon name="magnet" size={14} />
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
          class:on={overlay.details}
          aria-pressed={overlay.details}
          onclick={() => overlay.setDetails(!overlay.details)}
          title={detailsTitle(overlay.details)}
          aria-label="Details"
        >
          <Icon name="info" size={14} />
        </button>
      </span>
    {/if}
    {#if isPhoto}
      <button
        type="button"
        class="act"
        class:on={overlay.warping}
        aria-pressed={overlay.warping}
        disabled={overlay.locked || overlay.isPanorama}
        onclick={() => overlay.setWarping(!overlay.warping)}
        title={overlay.isPanorama
          ? 'A panorama keeps its shape'
          : overlay.locked
            ? 'Move one alone to reshape the photo'
            : 'Pull the photo by its corners or edges, to square a slanted photo or squeeze a stretched one (W)'}
        aria-label="Reshape the photo"
      >
        <Icon name="polygon" size={14} /><span class="word minor">Reshape</span>
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
      {#if overlay.asSearched}
        <button
          type="button"
          class="act on"
          aria-pressed="true"
          onclick={() => overlay.layFlat()}
          title={AS_SEARCHED[overlay.asSearched.kind] ?? AS_SEARCHED.pieces}
          aria-label="Lay the photo flat"
        >
          <Icon name="layers" size={14} /><span class="word minor">As searched</span>
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
        disabled={overlay.locked || fitting}
        aria-busy={fitting}
        onclick={onfit}
        title={overlay.locked ? 'Move one alone to fit again' : 'Find your trace on the whole turn and lay the terrain on it'}
        aria-label="Fit to trace"
      >
        {#if fitting}<span class="spinner" aria-hidden="true"></span>{:else}<Icon name="wand" size={14} />{/if}<span
          class="word long">{fitting ? 'Fitting…' : 'Fit to trace'}</span
        ><span class="word short">Fit</span>
      </button>
    {:else if overlay.tracing}
      <span class="say">{overlay.pen === 'ridge' ? 'Draw along a ridge seen against farther land.' : `Draw along the skyline in the ${what.toLowerCase()}.`}</span>
    {:else if overlay.linking}
      <span class="say">{overlay.front === null ? 'Click the line in front, then the one behind it.' : 'Now click the line behind it.'}</span>
    {:else if overlay.cutting}
      <span class="say">Click where two frames of the collage meet.</span>
    {:else if overlay.distancing}
      <DistanceChips {overlay} />
    {:else if overlay.clearing}
      <span class="say">Click a skyline line with only sky above it.</span>
    {:else if overlay.keying}
      <span class="say">Click a skyline line that matters most, three at most.</span>
    {:else if overlay.bending}
      <span class="say">Brush over the part that may be bent.</span>
    {:else if overlay.busy}
      <span class="say"><span class="spinner" aria-hidden="true"></span>Opening…</span>
    {:else if overlay.error}
      <span class="say bad">{overlay.error}</span>
    {/if}
  </div>

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
  .act:hover,
  .end:hover {
    color: var(--text-1);
    background: color-mix(in srgb, var(--text-1) 7%, transparent);
  }
  .act.on {
    color: var(--accent);
    background: var(--accent-soft);
  }
  /* out, a hand stays faint beside its word, so the lit one reads first */
  .act.hand {
    padding: 0 6px;
    color: var(--text-3);
  }
  .act.hand:hover {
    color: var(--text-1);
  }
  .act.hand.on {
    color: var(--accent);
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
  /* the fit is the band's one lit act: everything else gives way before it does */
  .reading {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
    padding-right: 4px;
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
  .act.primary .spinner {
    border-color: color-mix(in srgb, var(--accent-text) 30%, transparent);
    border-top-color: var(--accent-text);
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
  /* as the band narrows (`tight`), the gap's number and every button stay; their words go, the least needed
     first, as the slider shortens, then the slider leaves its two ends, which still set the photo or the terrain
     alone; past that the band takes a second row */
  .short {
    display: none;
  }
  .t1 .gap .span,
  .t1 .long {
    display: none;
  }
  .t1 .short {
    display: inline;
  }
  .t2 .spare,
  .t2 .minor {
    display: none;
  }
  .t2 .fade input {
    width: 90px;
  }
  .t3 .word:not(.short) {
    display: none;
  }
  .t4 .fade input {
    width: 64px;
  }
  .t5 .fade input,
  .t5 .short {
    display: none;
  }
  .t5 .act {
    padding: 0 7px;
  }
  .t5 .divider {
    margin: 0 1px;
  }
  .overlay-bar.t6 {
    flex-wrap: wrap;
    row-gap: 4px;
    height: auto;
    padding-block: 6px;
  }
</style>
