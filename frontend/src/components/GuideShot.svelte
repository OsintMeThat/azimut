<script>
  /**
   * A tool photographed in the demo case, with a number on each control its guide page
   * explains (`lib/guide.js`).
   *
   * At rest the picture carries its numbers and nothing else: a frame round every
   * control crossed the others once a page had six. The one being read, from its number
   * or its line in the legend, is lit instead: the rest of the picture dims, a ring
   * closes round the control, its name shows beside its number, and the light glides
   * from one control to the next. The rectangles are in the pixels the page was laid out
   * in when the picture was made, so the overlay shares the picture's own coordinates
   * and scales with it. A number whose control leads somewhere carries a chevron, and
   * pressing it shows the screen it opens.
   */
  import Icon from './Icon.svelte';
  import { PIN_ROOM, pinSpots } from '../lib/guide.js';

  let { shot, marks, active = $bindable(null), onopen } = $props();

  const uid = $props.id();
  /** Room left round a control, in the shot's pixels, so its ring does not sit on its edge. */
  const PAD = 5;
  let width = $state(0);

  const placed = $derived(
    pinSpots(
      marks
        .map((mark, index) => {
          const rect = shot.anchors[mark.anchor];
          if (!rect) return null;
          return {
            n: index + 1,
            title: mark.title,
            leads: Boolean(mark.opens),
            x: rect.x - PAD,
            y: rect.y - PAD,
            w: rect.w + PAD * 2,
            h: rect.h + PAD * 2,
          };
        })
        .filter(Boolean),
      shot,
      // the room two numbers need on screen, in the picture's pixels at the size it is shown
      width ? (PIN_ROOM * shot.width) / width : PIN_ROOM
    )
  );
  const lit = $derived(placed.find((mark) => mark.n === active) ?? null);
  // The hole and the ring stay where the last control was while the veil fades out,
  // so lighting the next one glides there rather than jumping from the corner.
  let last = null;
  const hole = $derived.by(() => (last = lit ?? last));
  const share = (value, total) => `${(value / total) * 100}%`;
</script>

<figure class="shot" style:aspect-ratio="{shot.width} / {shot.height}" bind:clientWidth={width}>
  <img src={shot.src} alt="" draggable="false" />
  <svg viewBox="0 0 {shot.width} {shot.height}" aria-hidden="true">
    <defs>
      <mask id="{uid}-veil">
        <rect width={shot.width} height={shot.height} fill="white" />
        {#if hole}
          <rect class="glide" x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx="8" fill="black" />
        {/if}
      </mask>
    </defs>
    <rect class="veil" class:on={lit} width={shot.width} height={shot.height} mask="url(#{uid}-veil)" />
    {#if hole}
      <rect
        class="frame glide"
        class:on={lit}
        x={hole.x}
        y={hole.y}
        width={hole.w}
        height={hole.h}
        rx="8"
        vector-effect="non-scaling-stroke"
      />
    {/if}
  </svg>
  {#each placed as mark (mark.n)}
    {@const right = mark.pin.x > shot.width * 0.62}
    <button
      class="pin"
      class:on={active === mark.n}
      class:dim={active !== null && active !== mark.n}
      class:leads={mark.leads}
      style:left={share(mark.pin.x, shot.width)}
      style:top={share(mark.pin.y, shot.height)}
      aria-label={mark.leads ? `${mark.n}. ${mark.title}: see what it opens` : `${mark.n}. ${mark.title}`}
      title={mark.leads ? 'See what it opens' : undefined}
      onmouseenter={() => (active = mark.n)}
      onmouseleave={() => (active = null)}
      onfocus={() => (active = mark.n)}
      onblur={() => (active = null)}
      onclick={() => mark.leads && onopen?.(mark.n - 1)}
    >
      {mark.n}
      {#if mark.leads}<Icon name="chevronRight" size={11} />{/if}
    </button>
    {#if active === mark.n}
      <span
        class="name"
        class:right
        style:left={share(mark.pin.x, shot.width)}
        style:top={share(mark.pin.y, shot.height)}
        aria-hidden="true">{mark.title}</span
      >
    {/if}
  {/each}
</figure>

<style>
  .shot {
    position: relative;
    width: 100%;
    margin: 0;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-lg);
    overflow: hidden;
    background: var(--bg-0);
    box-shadow: var(--shadow-2);
  }
  img,
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  svg {
    pointer-events: none;
  }
  .veil {
    fill: rgba(6, 8, 12, 0.62);
    opacity: 0;
    transition: opacity 0.2s var(--ease);
  }
  .veil.on {
    opacity: 1;
  }
  .glide {
    transition:
      x 0.22s var(--ease),
      y 0.22s var(--ease),
      width 0.22s var(--ease),
      height 0.22s var(--ease),
      opacity 0.2s var(--ease);
  }
  /* White and ink rather than the app's amber: the picture already carries the app's
     own colours, and a mark drawn in them reads as part of the screen. */
  .frame {
    fill: none;
    stroke: #fff;
    stroke-width: 2;
    opacity: 0;
    filter: drop-shadow(0 0 1.5px rgba(0, 0, 0, 0.9));
  }
  .frame.on {
    opacity: 1;
  }
  .pin {
    position: absolute;
    z-index: 1;
    transform: translate(-50%, -50%);
    min-width: 22px;
    height: 22px;
    padding: 0 6px;
    border-radius: 11px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 1px;
    background: #f5f5f5;
    color: #111;
    font-size: 11.5px;
    font-weight: 750;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    box-shadow:
      0 0 0 1.5px rgba(0, 0, 0, 0.5),
      0 2px 8px rgba(0, 0, 0, 0.45);
    cursor: default;
    transition:
      transform 0.15s var(--ease),
      opacity 0.2s var(--ease);
  }
  .pin.leads {
    padding: 0 3px 0 7px;
    cursor: pointer;
  }
  .pin.on {
    z-index: 2;
    transform: translate(-50%, -50%) scale(1.15);
  }
  .pin.dim {
    opacity: 0.4;
  }
  .pin:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 2px;
  }
  /* the name of the control being read, beside its number */
  .name {
    position: absolute;
    z-index: 2;
    transform: translate(18px, -50%);
    padding: 4px 9px;
    border-radius: 999px;
    background: rgba(17, 17, 17, 0.94);
    border: 1px solid rgba(255, 255, 255, 0.16);
    color: #f5f5f5;
    font-size: var(--fs-xs);
    font-weight: 600;
    white-space: nowrap;
    pointer-events: none;
    box-shadow: var(--shadow-1);
    animation: rise 0.16s var(--ease);
  }
  .name.right {
    transform: translate(calc(-100% - 18px), -50%);
  }
  @keyframes rise {
    from {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .veil,
    .glide,
    .pin,
    .name {
      transition: none;
      animation: none;
    }
  }
</style>
