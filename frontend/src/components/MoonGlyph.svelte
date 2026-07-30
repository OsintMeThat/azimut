<script>
  // The moon at its actual phase, for the places that are not a view of the sky:
  // a table row, the map's readout. A crescent draws as a crescent, a full moon
  // as a whole disc, a new moon as the bare outline — nothing is picked from a
  // set of canned shapes, the terminator is where the geometry puts it.
  import { litPath, glyphRotation } from '../lib/moonphase.js';

  let {
    illuminated = 0,
    phaseAngle = 180,
    waxing = true,
    limb = null,
    size = 15,
    color = 'var(--sky-moon)',
  } = $props();

  const radius = $derived(size / 2 - 1);
  const lit = $derived(litPath(radius, illuminated, phaseAngle));
  const turn = $derived(glyphRotation(waxing, limb));
</script>

<svg
  width={size}
  height={size}
  viewBox="{-size / 2} {-size / 2} {size} {size}"
  role="img"
  aria-label="{Math.round(illuminated * 100)}% lit"
>
  <g transform="rotate({turn})">
    <circle r={radius} fill={color} opacity="0.18" />
    <path d={lit} fill={color} />
  </g>
  <!-- unrotated and drawn last: at new moon this ring is the entire glyph -->
  <circle r={radius} fill="none" stroke={color} stroke-opacity="0.5" />
</svg>

<style>
  svg {
    display: block;
    flex-shrink: 0;
  }
</style>
