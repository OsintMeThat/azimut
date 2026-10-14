<script>
  /** A personal marker as the map draws it, for pickers and lists. */
  import { markerParts, partTransform, MARKER_PIXELS } from '../../lib/map/markerGlyphs.js';

  let { symbol = 'pin', colour = '#0072b2', size = 22, status = '', external = false } = $props();
  const parts = $derived(markerParts(symbol, colour, { status, external }));
</script>

<svg class="marker-symbol" width={size} height={size} viewBox={`0 0 ${MARKER_PIXELS} ${MARKER_PIXELS}`} aria-hidden="true"
  stroke-linecap="round" stroke-linejoin="round">
  {#each parts as part, index (index)}
    <path d={part.d} transform={partTransform(part)} fill={part.fill ?? 'none'}
      stroke={part.stroke ?? 'none'} stroke-width={part.stroke ? part.width : undefined}
      stroke-dasharray={part.dash?.join(' ')} />
  {/each}
</svg>

<style>
  .marker-symbol { display: block; flex: none; }
</style>
