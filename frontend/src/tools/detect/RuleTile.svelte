<script>
  /**
   * One tile of a test laid on the ground: a canvas of the engine's mask,
   * painted in the rules' colours and set on the map by the matrix it is given.
   * It repaints only when a rule is shown, hidden or hovered.
   */
  import { paintMask } from '../../lib/map/analyzerRules.js';

  let { bits, size, transform, shown = [], hover = null, colours = [], veil = 0 } = $props();
  let canvas = $state(null);

  $effect(() => {
    if (!canvas || !bits || bits.length !== size * size) return;
    canvas.width = size;
    canvas.height = size;
    const painted = paintMask(bits, { shown, hover, colours, veil });
    canvas.getContext('2d').putImageData(new ImageData(painted, size, size), 0, 0);
  });
</script>

<canvas bind:this={canvas} class="rule-tile" style:transform={transform}></canvas>

<style>
  .rule-tile {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: 0 0;
    image-rendering: pixelated;
    pointer-events: none;
  }
</style>
