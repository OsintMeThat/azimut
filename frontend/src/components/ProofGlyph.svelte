<script>
  /** One proof symbol, drawn for the interface: the toolbar, the picker and the
   *  layer list. The canvas draws the same drawings through Konva; this is the DOM
   *  half so a button can show what it stamps. Everything follows `color`, the
   *  theme's by default, and carved details are holes, as an interface icon's are.
   *  A model is drawn at `view` once the models have landed. */
  import { BADGE_GLYPHS } from '../lib/map/markerGlyphs.js';
  import { MODEL_VIEWS } from '../lib/icons/modelMeta.js';
  import { loadModels, modelsNow } from '../lib/icons/loadModels.svelte.js';
  import { isModel } from '../lib/icons/catalog.js';
  import { ICON_BOX, iconByName } from '../lib/proofIcons.js';

  let { name, size = 20, color = 'currentColor', view = 'top' } = $props();

  const entry = $derived(iconByName(name));
  const layers = $derived(BADGE_GLYPHS[name] ?? null);
  const model = $derived(isModel(name));
  const angle = $derived(MODEL_VIEWS.find((v) => v.id === view) ?? MODEL_VIEWS[0]);
  const mask = `glyph-mask-${Math.random().toString(36).slice(2, 10)}`;

  $effect(() => {
    if (model && !modelsNow()) loadModels();
  });

  const drawing = $derived.by(() => {
    const engine = model ? modelsNow() : null;
    const shape = engine?.modelById(name);
    if (!shape) return '';
    return engine.modelSvg(shape, {
      px: size, mode: 'mono', heading: angle.heading, tilt: angle.tilt, pad: 1.04, line: 0.3,
    });
  });
  const turn = (rotate) => (rotate ? `rotate(${rotate} 12 12)` : undefined);
</script>

{#if model}
  <!-- style:color, so a caller's colour reaches the drawing's currentColor -->
  <span class="model" style:width="{size}px" style:height="{size}px" style:color={color === 'currentColor' ? null : color}>
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- drawn by lib/icons/paint.js from the app's own numbers -->
    {@html drawing}
  </span>
{:else if layers}
  <svg width={size} height={size} viewBox="0 0 {ICON_BOX} {ICON_BOX}" aria-hidden="true" focusable="false"
    stroke-linecap="round" stroke-linejoin="round">
    <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width={ICON_BOX} height={ICON_BOX}>
      {#each layers as [mode, d, opts], i (i)}
        {@const solid = mode === 'fill' || mode === 'cut'}
        {@const paint = mode === 'fill' || mode === 'line' ? 'white' : 'black'}
        <path {d} transform={turn(opts?.rotate)} fill={solid ? paint : 'none'} stroke={solid ? 'none' : paint}
          stroke-width={solid ? undefined : opts?.width ?? (mode === 'line' ? 2.2 : 1.3)} />
      {/each}
    </mask>
    <rect width={ICON_BOX} height={ICON_BOX} fill={color} mask="url(#{mask})" />
  </svg>
{:else if entry?.path}
  <svg width={size} height={size} viewBox="0 0 {ICON_BOX} {ICON_BOX}" aria-hidden="true" focusable="false">
    <path d={entry.path} fill={color} fill-rule="evenodd" />
  </svg>
{/if}

<style>
  /* Shaded from the theme's ink, pulled toward mid grey: a model's dark parts are
     darker than its colour, and on a light theme they would all run to black. */
  .model { display: inline-block; flex: none; color: color-mix(in srgb, currentColor 60%, #b8b8b8); }
  .model :global(svg) { display: block; }
</style>
