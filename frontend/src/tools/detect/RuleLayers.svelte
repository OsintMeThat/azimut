<script>
  /**
   * What each rule of the analyzer being built keeps, painted on the map in
   * the rule's colour. The engine sends one byte a pixel over the preview's
   * tiles (a bit per rule, detect_rules.py); this lays it on the ground
   * through the map's own frame, so it stays put however the map is panned,
   * zoomed or turned, and repaints only when a rule is shown, hidden or hovered.
   */
  import { compose, cssMatrix, imageToMercator, invert, screenToMercator } from '../../lib/map/groundFrame.js';
  import { RULE_COLOURS, paintMask } from '../../lib/map/analyzerRules.js';

  let { engine, element, preview = null, shown = [], hover = null, colours = RULE_COLOURS } = $props();

  let canvas = $state(null);
  let bits = $state(null);
  let revision = $state(0);

  $effect(() => {
    if (!engine) return;
    return engine.on('view-move', () => revision++);
  });

  /** One byte a pixel out of the PNG the engine sent: its first channel. */
  async function decode(base64, width, height) {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const scratch = document.createElement('canvas');
    scratch.width = width;
    scratch.height = height;
    const context = scratch.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const rgba = context.getImageData(0, 0, width, height).data;
    const out = new Uint8Array(width * height);
    for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4];
    return out;
  }

  $effect(() => {
    const mask = preview?.mask;
    const [width, height] = preview?.size ?? [0, 0];
    if (!mask) { bits = null; return; }
    let cancelled = false;
    decode(mask, width, height)
      .then((decoded) => { if (!cancelled) bits = decoded; })
      .catch(() => { if (!cancelled) bits = null; });
    return () => { cancelled = true; };
  });

  $effect(() => {
    if (!canvas || !bits || !preview) return;
    const [width, height] = preview.size;
    if (bits.length !== width * height) return;
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').putImageData(new ImageData(paintMask(bits, { shown, hover, colours }), width, height), 0, 0);
  });

  const transform = $derived.by(() => {
    revision;
    if (!engine?.frame || !element || !preview?.box) return '';
    const box = element.getBoundingClientRect();
    const frame = { ...engine.frame(), width: box.width || 1, height: box.height || 1 };
    const [width, height] = preview.size;
    return cssMatrix(compose(invert(screenToMercator(frame)), imageToMercator(preview.box, width, height)));
  });
</script>

{#if preview?.mask}
  <canvas bind:this={canvas} class="rule-layers" style:transform={transform} aria-label="What each rule keeps"></canvas>
{/if}

<style>
  .rule-layers {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 540;
    transform-origin: 0 0;
    image-rendering: pixelated;
    pointer-events: none;
  }
</style>
