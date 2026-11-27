<script module>
  /** Room kept from the window's edge, and between the arrow and the bubble's corners. */
  const EDGE = 8;
  const CORNER = 14;
  /** Between the control's foot and the bubble, the arrow's tip a little short of it. */
  const GAP = 10;
  /** Between the control and its ring, so the ring clears the control's own edge. */
  const RING = 5;
  /** How far the ring's echo travels out, in pixels across, whatever the control's size. */
  const PING = 24;

  /**
   * Where a bubble `width` wide sits under the control at `rect`, between `room.left`
   * and `room.right` (the window, or the panel the control is in): centred on the
   * control where it fits, slid inward at an edge, its arrow (`arrow`, from the
   * bubble's left) still on the control's middle. Given its `height` and the room's
   * `bottom`, a bubble with no room under the control goes over it (`above`).
   */
  export function placeUnder(rect, width, room, height = 0) {
    const middle = rect.left + rect.width / 2;
    const left = Math.max(room.left + EDGE, Math.min(middle - width / 2, room.right - EDGE - width));
    const arrow = Math.min(Math.max(middle - left, CORNER), width - CORNER);
    const place = { left: Math.round(left), top: Math.round(rect.bottom + GAP), arrow: Math.round(arrow) };
    const floor = (room.bottom ?? Infinity) - EDGE;
    if (place.top + height <= floor) return place;
    const over = rect.top - GAP - height;
    if (over >= EDGE) return { ...place, top: Math.round(over), above: true };
    // a control as tall as the window: the bubble stays on screen, over its foot
    return { ...place, top: Math.round(Math.max(EDGE, floor - height)) };
  }
</script>

<script>
  /**
   * A word pointed at one control, with an arrow, for a moment: under the control,
   * inside `within` when given (the panel the control is in) so it never spills over
   * the work beside it, and never in the way. It takes no focus and holds no key, so
   * whatever was being done goes on. It goes on its action, on ✕, on Escape, on a
   * press anywhere else, after `timeout` (held while the pointer rests on it), and as
   * soon as the control is gone; a resize or a scroll moves it with the control.
   *
   * `ring` also closes a ring round the control, for the guide pointing at a control in
   * the live app (lib/showInApp.svelte.js). The ring takes no press, so the control
   * under it still works.
   */
  import Icon from './Icon.svelte';

  let { anchor, within = null, text, action = '', onaction, onclose, timeout = 10_000, ring = false } = $props();

  let bubble = $state(null);
  let place = $state(null);
  let lit = $state(null);

  function measure() {
    const rect = anchor?.isConnected ? anchor.getBoundingClientRect() : null;
    if (!rect?.width) {
      onclose?.();
      return;
    }
    // with a ring, the bubble points at the ring rather than into it
    const aim = ring
      ? { left: rect.left - RING, top: rect.top - RING, width: rect.width + RING * 2, height: rect.height + RING * 2, bottom: rect.bottom + RING }
      : rect;
    if (ring) lit = aim;
    if (!bubble) return;
    const box = within?.isConnected ? within.getBoundingClientRect() : null;
    const room = {
      left: Math.max(0, box?.left ?? 0),
      right: Math.min(window.innerWidth, box?.right ?? Infinity),
      bottom: window.innerHeight,
    };
    place = placeUnder(aim, bubble.offsetWidth, room, bubble.offsetHeight);
  }

  // Measured once drawn, and again whenever the control or the window changes size:
  // after the frame, so a sidebar that refits itself to the window has done so.
  $effect(() => {
    if (!bubble) return;
    measure();
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(later) : null;
    observer?.observe(anchor);
    window.addEventListener('resize', later);
    // a scroll does not bubble, so a panel scrolling the control along is heard on the way down
    document.addEventListener('scroll', later, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', later);
      document.removeEventListener('scroll', later, { capture: true });
    };
  });

  let timer = 0;
  const leaveIn = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(() => onclose?.(), ms);
  };
  $effect(() => {
    leaveIn(timeout);
    return () => clearTimeout(timer);
  });

  // Heard before anything else, and handed on: the press or the key still does its own work.
  $effect(() => {
    const away = (event) => {
      if (!bubble?.contains(event.target)) onclose?.();
    };
    const key = (event) => {
      if (event.key === 'Escape') onclose?.();
    };
    const gone = () => onclose?.();
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key, true);
    document.addEventListener('fullscreenchange', gone);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('fullscreenchange', gone);
    };
  });
</script>

{#if ring && lit}
  <span
    class="ring"
    style:left="{lit.left}px"
    style:top="{lit.top}px"
    style:width="{lit.width}px"
    style:height="{lit.height}px"
    style:--grow-x={1 + PING / lit.width}
    style:--grow-y={1 + PING / lit.height}
    aria-hidden="true"
  ></span>
{/if}
<div
  class="coachmark"
  class:placed={place != null}
  class:above={place?.above}
  role="status"
  bind:this={bubble}
  style:left={place ? `${place.left}px` : '0'}
  style:top={place ? `${place.top}px` : '0'}
  style:--arrow={place ? `${place.arrow}px` : '50%'}
  onpointerenter={() => clearTimeout(timer)}
  onpointerleave={() => leaveIn(4000)}
>
  <span class="dot" aria-hidden="true"></span>
  <span class="words">{text}</span>
  {#if action}
    <button type="button" class="act" onclick={() => onaction?.()}>{action}</button>
  {/if}
  <button type="button" class="shut" aria-label="Close" title="Close" onclick={() => onclose?.()}>
    <Icon name="x" size={13} />
  </button>
</div>

<style>
  /* The app's raised surface, as a toast is, and the accent's dot that the toggle and
     the To-do tab carry for the same scenes. Over the top bar's dropdowns (1200) and
     under the welcome (1300). */
  .coachmark {
    position: fixed;
    z-index: 1250;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 6px 6px 12px;
    border-radius: var(--r-lg);
    background: var(--bg-2);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-2);
    color: var(--text-1);
    font-size: var(--fs-sm);
    font-weight: 500;
    white-space: nowrap;
    visibility: hidden;
  }
  .coachmark.placed {
    visibility: visible;
    animation: arrive 0.24s var(--ease) backwards;
  }
  /* the arrow: a square turned on its corner, its two upper edges the bubble's own */
  .coachmark::before {
    content: '';
    position: absolute;
    top: -6px;
    left: calc(var(--arrow) - 6px);
    width: 11px;
    height: 11px;
    background: inherit;
    border-left: 1px solid var(--border-strong);
    border-top: 1px solid var(--border-strong);
    transform: rotate(45deg);
  }
  /* over the control, the arrow hangs from the bubble's foot */
  .coachmark.above::before {
    top: auto;
    bottom: -6px;
    border: 0;
    border-right: 1px solid var(--border-strong);
    border-bottom: 1px solid var(--border-strong);
  }
  .coachmark.above.placed {
    animation-name: arrive-over;
  }
  /* The guide's look on its pictures (Spotlight.svelte), in the accent here because
     the live screen is no picture. Its dark edge holds it on a light page or imagery.
     The bubble comes later in the page, so it paints over the ring at the same level. */
  .ring {
    position: fixed;
    z-index: 1250;
    box-sizing: border-box;
    border: 2px solid var(--accent);
    border-radius: 8px;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5);
    pointer-events: none;
    animation: motion-fade-in var(--motion-pop) var(--ease) backwards;
  }
  /* one ring going out from it, twice, so the eye lands there first */
  .ring::after {
    content: '';
    position: absolute;
    inset: -2px;
    border: 2px solid var(--accent);
    border-radius: inherit;
    opacity: 0;
    animation: ping 1.4s var(--ease) 0.3s 2;
  }
  .dot {
    flex-shrink: 0;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
  }
  /* the one act, tinted rather than filled, as a scene's Geolocate is in its row */
  .act {
    margin-left: 4px;
    padding: 2px 10px;
    border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
    border-radius: var(--r-sm);
    background: var(--accent-soft);
    color: var(--text-1);
    font-size: var(--fs-xs);
    font-weight: 600;
    transition: background 0.15s var(--ease), border-color 0.15s var(--ease), color 0.15s var(--ease);
  }
  .act:hover,
  .act:focus-visible {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-text);
  }
  .shut {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: var(--r-sm);
    color: var(--text-3);
    transition: background 0.15s var(--ease), color 0.15s var(--ease);
  }
  .shut:hover,
  .shut:focus-visible {
    background: var(--bg-3);
    color: var(--text-1);
  }
  @keyframes arrive {
    from {
      opacity: 0;
      translate: 0 -4px;
    }
  }
  @keyframes arrive-over {
    from {
      opacity: 0;
      translate: 0 4px;
    }
  }
  /* the same few pixels out on a button as on a whole panel */
  @keyframes ping {
    from {
      opacity: 0.8;
      transform: scale(1);
    }
    to {
      opacity: 0;
      transform: scale(var(--grow-x), var(--grow-y));
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .coachmark.placed,
    .coachmark.above.placed,
    .ring::after {
      animation: none;
    }
  }
</style>
