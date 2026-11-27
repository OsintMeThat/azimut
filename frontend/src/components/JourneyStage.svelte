<script module>
  /** Room left round a lit control, in the picture's pixels, and the bubble's width in px. */
  const PAD = 6;
  const BUBBLE = 340;
  /** How long a new screen takes to come in before its control is lit. */
  const SETTLE = 300;

  /**
   * Where the bubble stands beside a control lit at `box` (px in a frame `w`×`h`): under
   * it, over it, then to its right or its left, the first that keeps it whole and off
   * the control. A control filling most of the screen leaves no such room: the bubble
   * then takes the screen's corner it covers least of it. `arrow` is how far in its tip
   * sits, under or over the control.
   *
   * Over a film, `moves` says where it moves (guide/motion.mjs: rows of digits, 0 for
   * still), and the bubble takes the spot clear of the control that hides least of it,
   * a corner of the screen if need be: the film is what the reader watches.
   */
  /** The bubble's width beside the picture, and the room kept round it there. */
  const SIDE = 300;
  const SIDE_GAP = 16;
  /** What the column beside the picture takes off the stage's width. */
  export const SIDE_ROOM = SIDE + SIDE_GAP * 2;

  /**
   * Whether the bubble stands in a column beside the picture rather than over it: when the
   * stage (`w`×`h` px) is wide enough that the picture keeps three quarters of its width
   * or more. Read on a usual screen's shape, not each picture's, so the picture does not
   * jump from one side to the other as the screens change.
   */
  export function besidePicture(w, h) {
    if (!(w > 0 && h > 0)) return false;
    return w - SIDE_ROOM >= 0.75 * Math.min(w, h * 1.6);
  }

  /**
   * The bubble in its column left of a frame `frameH` high, centred in a stage `stageH`
   * high: level with the control lit at `box`, kept whole on the stage, its tip pointing
   * at the control.
   */
  export function sideSpot(box, frameH, stageH, height) {
    const top0 = -(stageH - frameH) / 2;
    const middle = box.y + box.h / 2;
    const top = Math.min(Math.max(middle - height / 2, top0 + 8), top0 + stageH - height - 8);
    return { side: 'side', left: -(SIDE + SIDE_GAP), top, arrow: Math.min(Math.max(middle - top - 6, 14), height - 26) };
  }

  export function bubbleSpot(box, w, h, height, moves = null) {
    const M = 12;
    const GAP = 14;
    const clampX = (x) => Math.min(Math.max(x, M), w - BUBBLE - M);
    const clampY = (y) => Math.min(Math.max(y, M), h - height - M);
    const middle = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    const tries = [
      { side: 'below', left: clampX(middle.x - BUBBLE / 2), top: box.y + box.h + GAP },
      { side: 'above', left: clampX(middle.x - BUBBLE / 2), top: box.y - height - GAP },
      { side: 'beside', left: box.x + box.w + GAP, top: clampY(middle.y - height / 2) },
      { side: 'beside', left: box.x - BUBBLE - GAP, top: clampY(middle.y - height / 2) },
    ];
    const corners = [
      [M, M],
      [w - BUBBLE - M, M],
      [M, h - height - M],
      [w - BUBBLE - M, h - height - M],
    ].map(([left, top]) => ({ side: 'inside', left, top }));
    const whole = (spot) => spot.left >= M - 0.5 && spot.left + BUBBLE <= w - M + 0.5 && spot.top >= M - 0.5 && spot.top + height <= h - M + 0.5;
    const covered = (spot) =>
      Math.max(0, Math.min(spot.left + BUBBLE, box.x + box.w) - Math.max(spot.left, box.x)) *
      Math.max(0, Math.min(spot.top + height, box.y + box.h) - Math.max(spot.top, box.y));
    const withArrow = (spot) =>
      spot.side === 'below' || spot.side === 'above'
        ? { ...spot, arrow: Math.min(Math.max(middle.x - spot.left - 6, 16), BUBBLE - 28) }
        : spot;
    if (moves?.length) {
      const rows = moves.length;
      const cols = moves[0].length;
      // the motion a spot hides: each cell's digit times the share of it under the bubble
      const hides = (spot) => {
        let sum = 0;
        for (let row = 0; row < rows; row += 1) {
          const overY = Math.min(spot.top + height, ((row + 1) * h) / rows) - Math.max(spot.top, (row * h) / rows);
          if (overY <= 0) continue;
          for (let col = 0; col < cols; col += 1) {
            const overX = Math.min(spot.left + BUBBLE, ((col + 1) * w) / cols) - Math.max(spot.left, (col * w) / cols);
            if (overX > 0) sum += Number(moves[row][col]) * overX * overY;
          }
        }
        return sum;
      };
      const open = [...tries, ...corners].filter((spot) => whole(spot) && covered(spot) === 0);
      // the first spot that hides least, so a still film keeps the bubble by its control
      if (open.length) return withArrow(open.reduce((best, spot) => (hides(spot) < hides(best) ? spot : best)));
    }
    const clear = tries.find((spot) => whole(spot) && covered(spot) === 0);
    if (clear) return withArrow(clear);
    return corners.reduce((best, spot) => (covered(spot) < covered(best) ? spot : best));
  }
</script>

<script>
  /**
   * A journey's step played over the screen it happens on (components/GuideDialog.svelte):
   * the picture large, the control to press lit and the rest dimmed, and a bubble that
   * says what the step is for, then what to press, one action after the other. A field
   * to fill (`typed`) reads Done, every other action Next. The step's
   * tip comes once, with its first action; a press that needs its own comes with it. The light glides between two
   * controls of one screen, and waits for a new screen to come in rather than cross it.
   *
   * Pressing the last action brings the next step in under a line saying where the
   * press landed (`landing`). A question is asked over its
   * screen, blurred, its answers as cards. The result shows what the journey made, and
   * on the practice case how close the answer came.
   */
  import { untrack } from 'svelte';
  import { fade } from 'svelte/transition';
  import Icon from './Icon.svelte';
  import { stepIcon } from './JourneyTrail.svelte';
  import { JOURNEY_CAVEAT, shotOf, toolLabel } from '../lib/guide.js';

  let {
    step,
    act = 0,
    landing = null,
    here = null,
    answer = null,
    canBack = false,
    showable = true,
    onact,
    onpressed,
    onback,
    onchoose,
    onshow,
    onexample,
    onbegin = () => {},
    nodes = [],
    // `{ icon, label }` of the start a journey with one per kind of file is read on, said on every step
    branch = null,
  } = $props();

  const mark = $derived(step.marks?.[act] ?? null);
  const shotName = $derived(mark?.shot ?? step.shot);
  const picture = $derived(shotOf(shotName));
  const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  // the frame takes the picture's shape as large as the stage lets it (CSS), and is
  // measured only to place the light and the bubble: unmeasured, it reads at the
  // picture's own size
  let frameW = $state(0);
  let stageW = $state(0);
  let stageH = $state(0);
  // on a stage wide enough, the bubble stands beside the picture and covers none of it
  const beside = $derived(besidePicture(stageW, stageH));
  const size = $derived.by(() => {
    if (!picture) return null;
    const w = frameW || picture.width;
    return { w, h: (w * picture.height) / picture.width };
  });

  /** The control lit, in the picture's pixels, with the screen it is on; null while a screen comes in. */
  let lit = $state(null);
  let glide = $state(false);
  $effect(() => {
    const rect = !step.ask && !step.result && !step.welcome && mark ? picture?.anchors?.[mark.anchor] : null;
    const target = rect ? { rect, shot: shotName } : null;
    const was = untrack(() => lit);
    if (!target) {
      lit = null;
      return;
    }
    if (was?.shot === target.shot) {
      glide = true;
      lit = target;
      return;
    }
    glide = false;
    lit = null;
    const timer = setTimeout(() => (lit = target), still ? 0 : SETTLE);
    return () => clearTimeout(timer);
  });

  const box = $derived.by(() => {
    if (!lit || !size || !picture) return null;
    const sx = size.w / picture.width;
    const sy = size.h / picture.height;
    const { x, y, w, h } = lit.rect;
    return { x: (x - PAD) * sx, y: (y - PAD) * sy, w: (w + PAD * 2) * sx, h: (h + PAD * 2) * sy };
  });
  let bubbleH = $state(160);
  // over a film, clear of where it moves; a reader who asked for less motion sees the still
  const spot = $derived.by(() => {
    if (!box || !size) return null;
    if (beside) return sideSpot(box, size.h, stageH, bubbleH);
    return bubbleSpot(box, size.w, size.h, bubbleH, picture.film && !still ? picture.moves : null);
  });

  // the next action on this screen, or on to the screen the last one opens
  function press() {
    if (act < step.marks.length - 1) return onact(act + 1);
    onpressed();
  }

  // where the last press landed, said for a moment over the screen it opened; the words
  // stay while the line fades
  let banner = $state('');
  let saying = $state(false);
  $effect(() => {
    if (!landing) return;
    banner = landing.text;
    saying = true;
    const timer = setTimeout(() => (saying = false), 4200);
    return () => {
      clearTimeout(timer);
      saying = false;
    };
  });

  const nodeOf = (id) => nodes.find((node) => node.id === id);
  const iconOf = (id) => (id === 'result' ? 'flag' : stepIcon(nodeOf(id) ?? {}));
</script>

<div class="stage" bind:clientWidth={stageW} bind:clientHeight={stageH}>
  {#if size && picture}
    <div class="frame" style:--ratio={picture.width / picture.height} style:--reserve="{beside && !step.welcome ? SIDE_ROOM : 0}px" bind:clientWidth={frameW}>
      <div class="screen" class:blurred={step.ask || step.welcome}>
        {#key picture.src}
          <!-- a reader who asked for less motion gets the still the film was made from, as in GuideShot -->
          {#if picture.film && !still}
            <video class="shot" src={picture.film} poster={picture.src} autoplay loop muted playsinline transition:fade={{ duration: still ? 0 : 260 }}></video>
          {:else}
            <img class="shot" src={picture.src} alt="" draggable="false" transition:fade={{ duration: still ? 0 : 260 }} />
          {/if}
        {/key}
        {#if box}
          <div
            class="hole"
            class:glide
            style:left="{box.x}px"
            style:top="{box.y}px"
            style:width="{box.w}px"
            style:height="{box.h}px"
            in:fade={{ duration: still ? 0 : 180 }}
          ></div>
          <div
            class="ring"
            class:glide
            style:left="{box.x}px"
            style:top="{box.y}px"
            style:width="{box.w}px"
            style:height="{box.h}px"
            aria-hidden="true"
          ></div>
        {/if}
      </div>

      {#if spot && mark}
        <div
          class="bubble {spot.side}"
          class:glide
          style:left="{spot.left}px"
          style:top="{spot.top}px"
          style:--arrow="{spot.arrow ?? 0}px"
          bind:offsetHeight={bubbleH}
          role="group"
          aria-label="What to press"
          in:fade={{ duration: still ? 0 : 160 }}
        >
          <div class="eyebrow">
            <span class="bubble-tool"><Icon name={stepIcon(step)} size={13} />{mark.place ?? step.place ?? toolLabel(step.tool)}</span>
            {#if branch}<span class="branch" title="The way you are reading: the other start, on the left of the trail, reads it again for the other kind"><Icon name={branch.icon} size={12} />{branch.label}</span>{/if}
            {#if step.marks.length > 1}
              <span class="dots" aria-label="Action {act + 1} of {step.marks.length}">
                {#each step.marks as _, index (index)}<i class:on={index <= act}></i>{/each}
              </span>
            {/if}
          </div>
          {#if act === 0 && step.text}
            <p class="about">{step.text}</p>
          {/if}
          <p class="name">{mark.title}</p>
          <p class="press">{mark.text}</p>
          {#if mark.tip ?? (act === 0 ? step.tip : null)}
            <p class="tip"><Icon name="bulb" size={14} /><span><strong>Tip</strong> {mark.tip ?? step.tip}</span></p>
          {/if}
          <div class="acts">
            {#if act > 0 || canBack}
              <button type="button" class="quiet" onclick={() => (act > 0 ? onact(act - 1) : onback())}>Back</button>
            {/if}
            {#if showable}
              <button type="button" class="quiet show" onclick={() => onshow(mark)} title="Opens {step.place ?? toolLabel(step.tool)} on your case and rings {mark.title}">
                Show me <Icon name="external" size={12} />
              </button>
            {/if}
            <button type="button" class="go" onclick={press}>
              {mark.typed ? 'Done' : 'Next'}
              <Icon name="arrowRight" size={13} />
            </button>
          </div>
        </div>
      {/if}

      {#if banner}
        <div class="landing" class:on={saying} aria-live="polite">
          <span class="landed">You land on</span>
          <span>{banner}</span>
        </div>
      {/if}

      {#if step.ask}
        <div class="fork" in:fade={{ duration: still ? 0 : 240 }}>
          <div class="panel">
            <p class="eyebrow"><Icon name="help" size={13} />{step.label}{#if branch}<span class="branch"><Icon name={branch.icon} size={12} />{branch.label}</span>{/if}</p>
            <h3>{step.text}</h3>
            <div class="cards">
              {#each step.choices as choice (choice.to)}
                {@const next = here?.here === step.id && here.next.includes(choice.to)}
                <button type="button" class="choice" class:next onclick={() => onchoose(choice.to)}>
                  <span class="icon"><Icon name={iconOf(choice.to)} size={19} /></span>
                  <strong>{choice.label}</strong>
                  <span>{choice.text}</span>
                  {#if nodeOf(choice.to)?.optional}<em>Optional</em>{/if}
                </button>
              {/each}
            </div>
            {#if canBack}
              <button type="button" class="quiet back" onclick={onback}>Back</button>
            {/if}
          </div>
        </div>
      {/if}

      {#if step.welcome}
        <!-- the journey's welcome, over what it makes: what it walks, and that it is one example -->
        <div class="fork welcome" in:fade={{ duration: still ? 0 : 240 }}>
          <div class="panel">
            <p class="eyebrow"><Icon name="flag" size={13} />Journey</p>
            <h3>{step.title}</h3>
            <p class="lead">{step.lead}</p>
            <p class="tools" aria-label="The tools it goes through">
              {#each step.tools as one (one.id)}<span class="tool-chip"><Icon name={one.icon} size={13} />{one.label}</span>{/each}
            </p>
            <div class="example">
              <Icon name="info" size={16} />
              <p>{JOURNEY_CAVEAT}</p>
            </div>
            <div class="starts">
              {#each step.starts as start (start.id)}
                <button type="button" class="go" onclick={() => onbegin(start.id)}>
                  {#if step.starts.length > 1}<Icon name={start.icon} size={14} />Start with {start.label.toLowerCase()}{:else}Start{/if}
                  <Icon name="arrowRight" size={13} />
                </button>
              {/each}
            </div>
          </div>
        </div>
      {/if}

      {#if step.result}
        <div class="result" in:fade={{ duration: still ? 0 : 240 }}>
          <div class="result-words">
          {#if answer}
            <div class="verdict" class:right={answer.right}>
              <span class="verdict-mark"><Icon name={answer.right ? 'check' : 'crosshair'} size={22} /></span>
              <div>
                <strong>{answer.right ? 'Found' : 'Not there yet'}</strong>
                <span>{answer.said}</span>
              </div>
            </div>
          {:else}
            <p class="said">{step.text}</p>
          {/if}
          </div>
          {#if step.example}
            <button type="button" class="go" onclick={onexample}>Try this search <Icon name="arrowRight" size={13} /></button>
          {/if}
        </div>
      {/if}
    </div>

  {/if}
</div>

<style>
  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
    display: grid;
    place-items: center;
    margin: 0 22px;
    container-type: size;
  }
  /* room kept on its left for the bubble's column (`--reserve`), the picture centred in the rest */
  .frame {
    position: relative;
    width: min(calc(100cqw - var(--reserve, 0px)), calc(100cqh * var(--ratio)));
    margin-left: var(--reserve, 0px);
    aspect-ratio: var(--ratio);
    border-radius: 12px;
    background: #000;
    box-shadow:
      0 18px 50px rgba(0, 0, 0, 0.55),
      0 0 0 1px var(--border-strong);
  }
  .screen {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    overflow: hidden;
    transition: filter var(--motion-move) var(--ease);
  }
  .screen.blurred {
    filter: blur(7px) brightness(0.42) saturate(0.8);
  }
  /* the screen leaving keeps its own shape while the frame takes the next one's */
  .shot {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .hole {
    position: absolute;
    border-radius: 9px;
    box-shadow: 0 0 0 300vmax rgba(6, 6, 6, 0.62);
    pointer-events: none;
  }
  .ring {
    position: absolute;
    border-radius: 11px;
    border: 2px solid var(--accent);
    box-shadow: 0 0 22px color-mix(in srgb, var(--accent) 45%, transparent);
    pointer-events: none;
  }
  .ring::after {
    content: '';
    position: absolute;
    inset: -2px;
    border-radius: inherit;
    border: 2px solid var(--accent);
    animation: ping 1.8s var(--ease-out) infinite;
  }
  @keyframes ping {
    0% {
      opacity: 0.9;
      transform: scale(1);
    }
    80%,
    100% {
      opacity: 0;
      transform: scale(1.35);
    }
  }
  /* two controls of one screen: the light glides from one to the other */
  .hole.glide,
  .ring.glide,
  .bubble.glide {
    transition:
      left 0.5s var(--ease),
      top 0.5s var(--ease),
      width 0.5s var(--ease),
      height 0.5s var(--ease);
  }

  .bubble {
    position: absolute;
    z-index: 3;
    width: 340px;
    padding: 13px 15px 11px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--bg-1) 96%, transparent);
    border: 1px solid var(--border-strong);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(8px);
  }
  .bubble.below::before,
  .bubble.above::before {
    content: '';
    position: absolute;
    left: var(--arrow);
    top: -7px;
    width: 12px;
    height: 12px;
    background: inherit;
    border-left: 1px solid var(--border-strong);
    border-top: 1px solid var(--border-strong);
    transform: rotate(45deg);
  }
  .bubble.above::before {
    top: auto;
    bottom: -7px;
    transform: rotate(225deg);
  }
  /* in its column beside the picture, its tip at the control's height */
  .bubble.side {
    width: 300px;
  }
  .bubble.side::before {
    content: '';
    position: absolute;
    right: -7px;
    top: var(--arrow);
    width: 12px;
    height: 12px;
    background: inherit;
    border-right: 1px solid var(--border-strong);
    border-top: 1px solid var(--border-strong);
    transform: rotate(45deg);
  }
  .eyebrow {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--text-3);
  }
  .bubble-tool {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--accent);
  }
  /* the way being read, a photo's or a video's: a chip of its own, so the two never blur */
  .branch {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    letter-spacing: 0.04em;
  }
  .dots {
    display: flex;
    gap: 4px;
    margin-left: auto;
  }
  .dots i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--bg-3);
  }
  .dots i.on {
    background: var(--accent);
  }
  /* what the step is for, said once over its first action */
  .about {
    margin: 8px 0 0;
    font-size: 13px;
    color: var(--text-3);
    line-height: 1.4;
  }
  .name {
    margin: 8px 0 2px;
    font-size: 16px;
    font-weight: 650;
    color: var(--text-1);
  }
  .press {
    margin: 0;
    font-size: 14px;
    color: var(--text-2);
    line-height: 1.45;
  }
  .tip {
    display: flex;
    gap: 8px;
    margin: 11px 0 0;
    padding: 8px 10px;
    border: 1px solid color-mix(in srgb, var(--info) 30%, transparent);
    border-radius: 8px;
    background: var(--info-soft);
    font-size: 12.5px;
    color: var(--text-1);
    line-height: 1.45;
  }
  .tip strong {
    margin-right: 2px;
    color: var(--info);
  }
  .tip :global(svg) {
    flex-shrink: 0;
    margin-top: 2px;
    color: var(--info);
  }
  .acts {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
  }
  .quiet {
    padding: 6px 8px;
    border-radius: 7px;
    color: var(--text-3);
  }
  .quiet:hover {
    color: var(--text-1);
    background: var(--bg-2);
  }
  .go {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    padding: 7px 13px;
    border-radius: 8px;
    background: var(--accent);
    color: var(--accent-text);
    font-weight: 650;
  }
  .go:hover {
    background: var(--accent-hover);
  }

  .landing {
    position: absolute;
    z-index: 4;
    left: 50%;
    top: 16px;
    translate: -50% 0;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 72%;
    padding: 9px 14px 9px 12px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--bg-1) 95%, transparent);
    border: 1px solid var(--border-strong);
    border-left: 3px solid var(--accent);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    font-size: 13.5px;
    color: var(--text-1);
    pointer-events: none;
    opacity: 0;
    transition: opacity var(--motion-move) var(--ease);
  }
  .landing.on {
    opacity: 1;
  }
  .landed {
    flex-shrink: 0;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--accent);
  }

  .fork {
    position: absolute;
    inset: 0;
    z-index: 3;
    display: grid;
    place-items: center;
  }
  .panel {
    width: min(760px, 88%);
    text-align: center;
  }
  .panel .eyebrow {
    justify-content: center;
    color: var(--accent);
    letter-spacing: 0.1em;
  }
  h3 {
    margin: 8px 0 20px;
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--text-1);
  }
  .cards {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    gap: 12px;
  }
  .choice {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 16px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--bg-2) 92%, transparent);
    border: 1px solid var(--border-strong);
    text-align: left;
    font-size: 13px;
    color: var(--text-2);
    transition:
      transform var(--motion-hover) var(--ease),
      border-color var(--motion-hover) var(--ease);
  }
  .choice:hover {
    transform: translateY(-3px);
    border-color: var(--accent);
  }
  .choice.next {
    border-color: color-mix(in srgb, var(--accent) 60%, transparent);
  }
  .choice strong {
    font-size: 15px;
    color: var(--text-1);
  }
  .choice .icon {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    margin-bottom: 4px;
    border-radius: 10px;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .choice em {
    align-self: flex-start;
    margin-top: 4px;
    padding: 1px 7px;
    border: 1px dashed var(--border-strong);
    border-radius: 999px;
    font-size: 10.5px;
    font-style: normal;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-3);
  }
  .back {
    margin-top: 14px;
  }

  .result {
    position: absolute;
    left: 50%;
    bottom: 18px;
    z-index: 3;
    translate: -50% 0;
    display: flex;
    align-items: center;
    gap: 16px;
    max-width: 86%;
    padding: 14px 16px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--bg-1) 95%, transparent);
    border: 1px solid var(--border-strong);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55);
  }  .result-words {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  /* the welcome: the journey's own words over what it makes, its starts as the way in */
  .welcome .lead {
    margin: -8px 0 14px;
    font-size: 15px;
    color: var(--text-2);
  }
  .welcome .tools {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
    margin: 0 0 18px;
  }
  .welcome .tool-chip {
    display: inline-flex;
    flex-direction: row;
    white-space: nowrap;
    align-items: center;
    gap: 5px;
    padding: 3px 9px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--bg-1) 80%, transparent);
    border: 1px solid var(--border-strong);
    font-size: 12px;
    color: var(--text-2);
  }
  .welcome .example {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    max-width: 560px;
    margin: 0 auto 20px;
    padding: 12px 14px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--bg-1) 92%, transparent);
    border: 1px solid var(--border-strong);
    border-left: 3px solid var(--accent);
    text-align: left;
    font-size: 13.5px;
    color: var(--text-1);
  }
  .welcome .example p {
    margin: 0;
  }
  .welcome .example > :global(svg) {
    flex-shrink: 0;
    margin-top: 2px;
    color: var(--accent);
  }
  .welcome .starts {
    display: flex;
    justify-content: center;
    gap: 10px;
  }
  .welcome .starts .go {
    margin-left: 0;
  }

  .said {
    margin: 0;
    font-size: 14px;
    color: var(--text-1);
  }
  .verdict {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .verdict div {
    display: flex;
    flex-direction: column;
    font-size: 13px;
    color: var(--text-2);
  }
  .verdict strong {
    font-size: 17px;
    color: var(--text-1);
  }
  .verdict-mark {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--bg-3);
    color: var(--text-2);
  }
  .verdict.right .verdict-mark {
    background: var(--ok-soft);
    color: var(--ok);
  }
  .verdict.right strong {
    color: var(--ok);
  }

  .show {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  @media (prefers-reduced-motion: reduce) {
    .ring::after {
      animation: none;
    }
    .screen {
      transition: none;
    }
  }
</style>
