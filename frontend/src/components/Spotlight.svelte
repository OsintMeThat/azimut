<script>
  /**
   * A picture of the guide (`lib/guide.js` shotOf) with one control lit and named: the
   * rest dims, a ring closes round the control, and its name sits beside it. For the
   * tour and What's new (components/Onboarding.svelte), where a page says one thing,
   * so nothing is numbered and nothing waits on a hover. Without an anchor the picture
   * is shown whole.
   *
   * The rectangles are in the pixels the page was laid out in when the picture was
   * made, so the overlay shares the picture's own coordinates and scales with it.
   */
  let { shot, anchor = null, label = '' } = $props();

  const uid = $props.id();
  /** Room left round the control, in the shot's pixels, so the ring clears its edge. */
  const PAD = 6;

  const rect = $derived(anchor ? (shot.anchors?.[anchor] ?? null) : null);
  const box = $derived(rect && { x: rect.x - PAD, y: rect.y - PAD, w: rect.w + PAD * 2, h: rect.h + PAD * 2 });
  const share = (value, total) => `${(value / total) * 100}%`;
  // the name goes under the control, over it when the control sits low on the picture
  const below = $derived(box && box.y + box.h < shot.height * 0.8);
  // and hangs off the side the control is nearer, so it never leaves the picture
  const side = $derived.by(() => {
    if (!box) return 'middle';
    const middle = box.x + box.w / 2;
    return middle < shot.width * 0.25 ? 'start' : middle > shot.width * 0.75 ? 'end' : 'middle';
  });
  const nameX = $derived(!box ? 0 : side === 'start' ? box.x : side === 'end' ? box.x + box.w : box.x + box.w / 2);
</script>

<figure class="spot">
  <img src={shot.src} alt="" draggable="false" />
  {#if box}
    <svg viewBox="0 0 {shot.width} {shot.height}" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <mask id="{uid}-hole">
          <rect width={shot.width} height={shot.height} fill="white" />
          <rect x={box.x} y={box.y} width={box.w} height={box.h} rx="8" fill="black" />
        </mask>
      </defs>
      <rect class="veil" width={shot.width} height={shot.height} mask="url(#{uid}-hole)" />
    </svg>
    <span
      class="ring"
      style:left={share(box.x, shot.width)}
      style:top={share(box.y, shot.height)}
      style:width={share(box.w, shot.width)}
      style:height={share(box.h, shot.height)}
      aria-hidden="true"
    ></span>
    {#if label}
      <span
        class="name {side}"
        class:above={!below}
        style:left={share(nameX, shot.width)}
        style:top={share(below ? box.y + box.h : box.y, shot.height)}>{label}</span
      >
    {/if}
  {/if}
</figure>

<style>
  .spot {
    position: relative;
    margin: 0;
    max-width: 100%;
    border-radius: var(--r-lg);
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 10px 34px rgba(0, 0, 0, 0.45);
    line-height: 0;
  }
  img {
    display: block;
    width: auto;
    height: auto;
    max-width: 100%;
    max-height: var(--spot-h, 50vh);
  }
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .veil {
    fill: rgba(6, 8, 12, 0.46);
    animation: show 0.3s var(--ease) 0.12s backwards;
  }
  /* White and ink rather than the app's amber: the picture already carries the app's
     own colours, and a mark drawn in them reads as part of the screen. */
  .ring {
    position: absolute;
    border: 2px solid #fff;
    border-radius: 8px;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5);
    pointer-events: none;
    animation: show 0.3s var(--ease) 0.12s backwards;
  }
  /* one ring going out from it, twice, so the eye lands there first */
  .ring::after {
    content: '';
    position: absolute;
    inset: -2px;
    border: 2px solid #fff;
    border-radius: inherit;
    opacity: 0;
    animation: ping 1.4s var(--ease) 0.45s 2;
  }
  .name {
    position: absolute;
    translate: -50% 8px;
    padding: 5px 10px;
    border-radius: 999px;
    background: rgba(17, 17, 17, 0.94);
    border: 1px solid rgba(255, 255, 255, 0.18);
    color: #f5f5f5;
    font-size: var(--fs-sm);
    font-weight: 600;
    line-height: 1.2;
    white-space: nowrap;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
    pointer-events: none;
    animation: rise 0.3s var(--ease) 0.25s backwards;
  }
  .name.start {
    translate: 0 8px;
  }
  .name.end {
    translate: -100% 8px;
  }
  .name.above {
    translate: -50% calc(-100% - 8px);
  }
  .name.start.above {
    translate: 0 calc(-100% - 8px);
  }
  .name.end.above {
    translate: -100% calc(-100% - 8px);
  }
  @keyframes show {
    from {
      opacity: 0;
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
  @keyframes ping {
    from {
      opacity: 0.8;
      transform: scale(1);
    }
    to {
      opacity: 0;
      transform: scale(1.25);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .veil,
    .ring,
    .ring::after,
    .name {
      animation: none;
    }
  }
</style>
