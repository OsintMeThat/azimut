<script>
  /**
   * The wheel a turn is steered with: a dot on the grabbed point and the circle
   * outside which the pointer's sweep is read (`lib/turn.js`). Every view that
   * turns draws this same guide while the middle button is held.
   */
  import { TURN_RADIUS } from '../lib/turn.js';

  /** The grabbed point, in px of the positioned parent. */
  let { x, y } = $props();
  const size = TURN_RADIUS * 2 + 4;
  const mid = size / 2;
</script>

<svg
  class="turn-guide"
  width={size}
  height={size}
  viewBox="0 0 {size} {size}"
  style:left={`${x}px`}
  style:top={`${y}px`}
  aria-hidden="true"
>
  <circle class="wheel" cx={mid} cy={mid} r={TURN_RADIUS} />
  <circle class="dot" cx={mid} cy={mid} r="2" />
</svg>

<style>
  .turn-guide {
    position: absolute;
    z-index: 650;
    transform: translate(-50%, -50%);
    pointer-events: none;
    overflow: visible;
    color: #fff;
    filter: drop-shadow(0 0 1.5px rgba(0, 0, 0, 0.7));
  }
  .wheel {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.25;
    stroke-dasharray: 4 4;
    opacity: 0.75;
  }
  .dot {
    fill: currentColor;
  }
</style>
