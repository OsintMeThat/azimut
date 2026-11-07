<script module>
  /** Room kept from the window's edge, and between the arrow and the bubble's corners. */
  const EDGE = 8;
  const CORNER = 14;
  /** Between the control's foot and the bubble, the arrow's tip a little short of it. */
  const GAP = 10;

  /**
   * Where a bubble `width` wide sits under the control at `rect`, between `room.left`
   * and `room.right` (the window, or the panel the control is in): centred on the
   * control where it fits, slid inward at an edge, its arrow (`arrow`, from the
   * bubble's left) still on the control's middle.
   */
  export function placeUnder(rect, width, room) {
    const middle = rect.left + rect.width / 2;
    const left = Math.max(room.left + EDGE, Math.min(middle - width / 2, room.right - EDGE - width));
    const arrow = Math.min(Math.max(middle - left, CORNER), width - CORNER);
    return { left: Math.round(left), top: Math.round(rect.bottom + GAP), arrow: Math.round(arrow) };
  }
</script>

<script>
  /**
   * A word pointed at one control, with an arrow, for a moment: under the control,
   * inside `within` when given (the panel the control is in) so it never spills over
   * the work beside it, and never in the way. It takes no focus and holds no key, so
   * whatever was being done goes on. It goes on its action, on ✕, on Escape, on a
   * press anywhere else, after `timeout` (held while the pointer rests on it), and as
   * soon as the control is gone; a resize moves it with the control.
   */
  import Icon from './Icon.svelte';

  let { anchor, within = null, text, action = '', onaction, onclose, timeout = 10_000 } = $props();

  let bubble = $state(null);
  let place = $state(null);

  function measure() {
    const rect = anchor?.isConnected ? anchor.getBoundingClientRect() : null;
    if (!rect?.width) {
      onclose?.();
      return;
    }
    if (!bubble) return;
    const box = within?.isConnected ? within.getBoundingClientRect() : null;
    const room = { left: Math.max(0, box?.left ?? 0), right: Math.min(window.innerWidth, box?.right ?? Infinity) };
    place = placeUnder(rect, bubble.offsetWidth, room);
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
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', later);
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

<div
  class="coachmark"
  class:placed={place != null}
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
  @media (prefers-reduced-motion: reduce) {
    .coachmark.placed {
      animation: none;
    }
  }
</style>
