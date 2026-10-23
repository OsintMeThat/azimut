<script>
  /**
   * The welcome a version opens with (lib/welcome.js): its number, and where the guide
   * is. The card sits in the middle and a dotted line runs from it to the `?` in the
   * topbar, which stays lit through the veil, so the reader sees which button is meant
   * rather than reading a direction to it. Pressing the lit `?` opens the guide as it
   * always does, and closing the card shrinks it into that button, so the eye follows
   * it to where the guide lives. Without the button to point at, the card sits alone.
   *
   * `onclose({ mute, guide })` is told whether "Don't show this again" was ticked and
   * whether the reader asked for the guide.
   */
  import Icon from './Icon.svelte';
  import Logo from './Logo.svelte';
  import { portal } from '../lib/fullscreen.js';
  import { isTopOverlay, joinOverlays } from '../lib/overlayStack.js';

  let { version, anchor = null, onclose } = $props();

  const uid = $props.id();
  const FLIGHT_MS = 420;

  let mute = $state(false);
  let rect = $state(null);
  let view = $state({ w: 0, h: 0 });
  let box = $state({ left: 0, top: 0, w: 0, h: 0 });
  let root = $state(null);
  let card = $state(null);
  let leaving = $state(false);

  const self = {};
  $effect(() => joinOverlays(self, () => close(false)));

  // offsets rather than the drawn box, so the card's arrival doesn't move the line
  function measure() {
    view = { w: window.innerWidth, h: window.innerHeight };
    if (card) box = { left: card.offsetLeft, top: card.offsetTop, w: card.offsetWidth, h: card.offsetHeight };
    const mark = anchor?.getBoundingClientRect();
    rect = mark && mark.width ? mark : null;
  }
  $effect(() => {
    measure();
    document.fonts?.ready.then(measure);
  });

  // the topbar can still be settling under the veil (a case loading adds buttons
  // before the `?`), so the button is followed while the card is up
  $effect(() => {
    let seen = '';
    let frame = requestAnimationFrame(function follow() {
      const mark = anchor?.getBoundingClientRect();
      const at = mark ? `${mark.left} ${mark.top} ${mark.width} ${mark.height}` : '';
      if (at !== seen) {
        seen = at;
        measure();
      }
      frame = requestAnimationFrame(follow);
    });
    return () => cancelAnimationFrame(frame);
  });

  /**
   * Out of the card's side and up into the button, or out of its top when the
   * button sits above the card (a narrow window). Both ends leave and arrive square,
   * so the curve reads as drawn rather than plotted.
   */
  const lead = $derived.by(() => {
    if (!rect) return null;
    const end = { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.bottom + 10) };
    const right = box.left + box.w;
    if (end.x > right + 64) {
      const start = { x: right, y: box.top + 38 };
      const c1 = Math.round(start.x + (end.x - start.x) * 0.6);
      const c2 = Math.round(end.y + (start.y - end.y) * 0.6);
      return { start, end, d: `M${start.x} ${start.y} C${c1} ${start.y} ${end.x} ${c2} ${end.x} ${end.y}` };
    }
    const start = { x: Math.min(Math.max(end.x, box.left + 40), right - 40), y: box.top };
    const rise = Math.round((start.y - end.y) / 2);
    return { start, end, d: `M${start.x} ${start.y} C${start.x} ${start.y - rise} ${end.x} ${end.y + rise} ${end.x} ${end.y}` };
  });

  $effect(() => {
    const returnTo = document.activeElement;
    queueMicrotask(() => root?.querySelector('.go')?.focus());
    return () => {
      if (returnTo?.isConnected) returnTo.focus?.();
    };
  });

  const still = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  /**
   * Put away, the card flies into the `?` before it goes. Asked for the guide, it goes
   * at once, since the guide opening is where the eye should be.
   */
  function close(guide) {
    if (leaving) return;
    if (guide || !rect || !card?.animate || still()) {
      onclose({ mute, guide });
      return;
    }
    leaving = true;
    const dx = Math.round(rect.left + rect.width / 2 - (box.left + box.w / 2));
    const dy = Math.round(rect.top + rect.height / 2 - (box.top + box.h / 2));
    const flight = [
      card.animate([{ translate: '0 0', scale: 1 }, { translate: `${dx}px ${dy}px`, scale: 0.06 }], {
        duration: FLIGHT_MS,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        fill: 'forwards',
      }),
      card.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FLIGHT_MS, easing: 'cubic-bezier(0.8, 0, 1, 1)', fill: 'forwards' }),
    ];
    Promise.all(flight.map((a) => a.finished)).finally(() => onclose({ mute, guide: false }));
  }

  function onkeydown(e) {
    if (e.key === 'Escape' && isTopOverlay(self)) close(false);
  }

  /** Tab stays on the card and the lit button rather than walking the page behind. */
  function trap(e) {
    if (e.key !== 'Tab' || !root) return;
    const items = [...root.querySelectorAll('button, input')];
    const [first, last] = [items[0], items.at(-1)];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
</script>

<svelte:window {onkeydown} onresize={measure} />

<div class="welcome" class:leaving use:portal bind:this={root} onkeydown={trap} role="presentation">
  <div class="veil" class:plain={!rect} onclick={() => close(false)} role="presentation"></div>
  {#if rect}
    <button
      class="lit"
      style:left="{rect.left - 3}px"
      style:top="{rect.top - 3}px"
      style:width="{rect.width + 6}px"
      style:height="{rect.height + 6}px"
      aria-label="Open the guide"
      title="Open the guide"
      onclick={() => close(true)}
    ></button>
  {/if}
  <div class="card" bind:this={card} role="dialog" aria-modal="true" aria-labelledby="welcome-title">
    <header>
      <Logo size={34} />
      <div>
        <p class="eyebrow">Welcome to</p>
        <h2 id="welcome-title">Azimut <span class="version">{version}</span></h2>
      </div>
    </header>
    <p class="how">
      On any screen, <span class="key" role="img" aria-label="?"><Icon name="help" size={14} /></span> at the
      top right opens the guide on the tool you are in, each control numbered on a picture.
    </p>
    <label class="mute">
      <input type="checkbox" bind:checked={mute} />
      Don't show this again until the next version
    </label>
    <footer>
      <button class="btn btn-ghost btn-sm" onclick={() => close(false)}>Close</button>
      <button class="btn btn-primary btn-sm go" onclick={() => close(true)}>
        Open the guide <Icon name="arrowRight" size={13} />
      </button>
    </footer>
  </div>
  {#if lead}
    <svg class="lead" width={view.w} height={view.h} aria-hidden="true">
      <mask id="{uid}-reveal" maskUnits="userSpaceOnUse" x="0" y="0" width={view.w} height={view.h}>
        <path class="reveal" d={lead.d} pathLength="1" />
      </mask>
      <path class="trail" d={lead.d} mask="url(#{uid}-reveal)" />
      <circle class="port" cx={lead.start.x} cy={lead.start.y} r="4" />
    </svg>
  {/if}
</div>

<style>
  /* over the topbar (1200) as well as the tool, unlike a modal, since the veil has to
     dim the topbar round the one button it points at */
  /* the veil is dark in either theme, so the line and the ring round the `?` are light
     in both */
  .welcome {
    --ink: #f5f5f5;
    position: fixed;
    inset: 0;
    z-index: 1300;
    display: grid;
    place-items: center;
    padding: 12px;
  }
  .welcome.leaving {
    pointer-events: none;
  }
  .veil {
    position: absolute;
    inset: 0;
  }
  .veil.plain {
    background: rgba(4, 7, 12, 0.72);
    animation: dim 0.3s var(--ease) backwards;
  }
  /* the topbar's own `?`, left bright in a veil cut round it */
  .lit {
    position: fixed;
    border-radius: 10px;
    /* the glow sits unlit in the list, so lighting it never interpolates the veil */
    box-shadow:
      0 0 0 2px var(--ink),
      0 0 22px 4px rgba(245, 245, 245, 0),
      0 0 0 9999px rgba(4, 7, 12, 0.72);
    cursor: pointer;
    animation: dim 0.3s var(--ease) backwards;
    transition: box-shadow 0.2s var(--ease);
  }
  .lit::after {
    content: '';
    position: absolute;
    inset: -2px;
    border-radius: inherit;
    border: 2px solid var(--ink);
    /* once the line has reached it */
    animation: ping 1.8s var(--ease) 0.85s infinite backwards;
  }
  .leaving .veil.plain,
  .leaving .lit {
    opacity: 0;
    transition: opacity 0.42s var(--ease);
  }
  @keyframes dim {
    from {
      opacity: 0;
    }
  }
  @keyframes ping {
    from {
      opacity: 0.7;
      transform: scale(1);
    }
    to {
      opacity: 0;
      transform: scale(1.7);
    }
  }
  .card {
    position: relative;
    width: min(380px, calc(100vw - 24px));
    padding: 20px 20px 16px;
    background: var(--bg-1);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-lg);
    box-shadow:
      0 24px 64px rgba(0, 0, 0, 0.55),
      0 2px 8px rgba(0, 0, 0, 0.3);
    animation: arrive 0.32s var(--ease) 0.06s backwards;
  }
  @keyframes arrive {
    from {
      opacity: 0;
      translate: 0 10px;
      scale: 0.97;
    }
  }
  /* drawn from the card to the `?`, then its dots drift that way */
  .lead {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: visible;
  }
  .reveal {
    fill: none;
    stroke: #fff;
    stroke-width: 14;
    stroke-dasharray: 1 1;
    stroke-dashoffset: 0;
    animation: draw 0.55s var(--ease) 0.3s backwards;
  }
  .leaving .reveal {
    animation: retract 0.42s cubic-bezier(0.4, 0, 0.2, 1) forwards;
  }
  @keyframes draw {
    from {
      stroke-dashoffset: 1;
    }
  }
  @keyframes retract {
    to {
      stroke-dashoffset: -1;
    }
  }
  .trail {
    fill: none;
    stroke: var(--ink);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-dasharray: 0 7;
    stroke-opacity: 0.7;
    animation: flow 0.9s linear infinite;
    transition:
      stroke-opacity 0.2s var(--ease),
      stroke-width 0.2s var(--ease);
  }
  @keyframes flow {
    to {
      stroke-dashoffset: -7;
    }
  }
  .port {
    fill: var(--ink);
    stroke: rgba(245, 245, 245, 0.22);
    stroke-width: 6;
    paint-order: stroke;
    animation: dim 0.2s var(--ease) 0.3s backwards;
    transition: opacity 0.12s var(--ease);
  }
  .leaving .port {
    opacity: 0;
  }
  /* pointing at the `?` from the card lights the way to it */
  .welcome:has(.key:hover, .go:hover, .lit:hover) .trail {
    stroke-opacity: 1;
    stroke-width: 2.6;
  }
  .welcome:has(.key:hover, .go:hover, .lit:hover) .lit {
    box-shadow:
      0 0 0 2px var(--ink),
      0 0 22px 4px rgba(245, 245, 245, 0.35),
      0 0 0 9999px rgba(4, 7, 12, 0.72);
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .eyebrow {
    font-size: var(--fs-xs);
    color: var(--text-3);
    letter-spacing: 0.04em;
  }
  h2 {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-xl);
    font-weight: 700;
  }
  .version {
    padding: 2px 8px;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: var(--bg-2);
    font-size: var(--fs-sm);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--text-2);
  }
  .how {
    margin-top: 14px;
    color: var(--text-2);
    font-size: var(--fs-sm);
    line-height: 1.5;
  }
  .key {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    margin: 0 1px;
    vertical-align: -6px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-1);
    transition:
      border-color 0.2s var(--ease),
      background 0.2s var(--ease);
  }
  .mute {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 16px;
    color: var(--text-3);
    font-size: var(--fs-sm);
    cursor: pointer;
  }
  .mute input {
    accent-color: var(--text-1);
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }
  .go {
    gap: 6px;
  }
  .key:hover {
    border-color: var(--text-1);
    background: var(--bg-3);
  }
  @media (prefers-reduced-motion: reduce) {
    .veil.plain,
    .lit,
    .lit::after,
    .card,
    .reveal,
    .trail,
    .port {
      animation: none;
    }
  }
</style>
