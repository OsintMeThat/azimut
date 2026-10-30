<script>
  /**
   * A ground drawn small, as it looks: for a plain ground, its land, a coast and its
   * water, a road, a border, the heights when it tints or shades them and a name in
   * its ink, all in its own palette; for imagery and the street maps, their colours.
   * The gallery of grounds and the map bar's menu both show it.
   */
  import { GROUNDS, PALETTES, TINTS } from '../../lib/plate/plainBasemap.js';

  let { id, width = 64, height = 42, x = undefined, y = undefined } = $props();

  const style = $derived(GROUNDS[id] ?? null);
  const palette = $derived(style ? PALETTES[style.palette] : null);
  const tints = $derived(style?.tints ? TINTS[style.tints] : null);
  /** The colours of the grounds that are pictures or street maps, for their sample. */
  const PICTURES = {
    'esri-world-imagery': ['#3f4f2e', '#7d7350', '#55603a'],
    'esri-wayback': ['#46553a', '#8a7d58', '#5d6a44'],
    s2cloudless: ['#5b6e3e', '#a69a6c', '#3d5f7a'],
    sentinel2: ['#6b6f4a', '#b3a77c', '#47667d'],
    osm: ['#f2efe9', '#f7c46c', '#aad3df'],
    opentopomap: ['#d7e3b8', '#b9a27a', '#97c2d8'],
  };
  const picture = $derived(PICTURES[id] ?? ['#8a8f96', '#6b7076', '#9aa1a8']);
  const uid = $derived(`gs-${id}-${width}`);
</script>

<svg class="ground-swatch" viewBox="0 0 64 42" {x} {y} {width} {height} aria-hidden="true" preserveAspectRatio="xMidYMid slice">
  {#if palette}
    <defs>
      <linearGradient id="{uid}-shade" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color={palette.highlight ?? '#ffffff'} stop-opacity="0.35" />
        <stop offset="1" stop-color={palette.shade} stop-opacity="0.45" />
      </linearGradient>
    </defs>
    <rect width="64" height="42" fill={palette.ground} />
    {#if tints}
      <path d="M0 30 C10 18 18 16 26 22 C32 12 40 6 50 14 C56 19 60 18 64 16 V42 H0 Z" fill={tints[2][1]} />
      <path d="M22 26 C30 16 38 10 48 17 C52 20 56 20 60 19 V42 H18 Z" fill={tints[4][1]} />
      <path d="M36 20 C40 13 44 11 48 15 C50 17 52 18 54 18 L50 26 H34 Z" fill={tints.at(-1)[1]} />
    {:else}
      <path d="M4 34 C12 26 20 28 26 24 C30 21 34 23 38 26" fill="none" stroke={palette.wood} stroke-width="7" stroke-linecap="round" opacity="0.9" />
    {/if}
    {#if style.shade?.own}
      <path d="M18 30 C28 14 40 8 52 16 L56 30 Z" fill="url(#{uid}-shade)" />
    {/if}
    <path d="M42 42 C44 34 50 30 64 29 V42 Z" fill={palette.water} />
    {#if style.coast === 'lines'}
      <path d="M45.5 42 C47.5 35.5 52.5 32.5 64 31.6" fill="none" stroke={palette.coast ?? palette.waterName} stroke-width="0.6" opacity="0.8" />
      <path d="M49 42 C51 38 55 35.5 64 34.6" fill="none" stroke={palette.coast ?? palette.waterName} stroke-width="0.6" opacity="0.45" />
    {:else if style.coast === 'glow'}
      <path d="M43.5 42 C45.5 34.8 51 31.2 64 30.4" fill="none" stroke={palette.coast} stroke-width="2.4" opacity="0.5" />
    {/if}
    <path d="M0 14 C14 18 22 10 36 14 S56 22 64 20" fill="none" stroke={palette.casing} stroke-width="3.2" stroke-linecap="round" />
    <path d="M0 14 C14 18 22 10 36 14 S56 22 64 20" fill="none" stroke={palette.road} stroke-width="1.8" stroke-linecap="round" />
    <path d="M30 0 C28 8 34 14 31 22 S36 34 33 42" fill="none" stroke={palette.border} stroke-width="0.8" stroke-dasharray="3 1.5 0.8 1.5" />
    <!-- a name, as a short line of ink with its halo -->
    <rect x="5" y="4.5" width="17" height="4.4" rx="1" fill={palette.ground} opacity="0.75" />
    <rect x="6" y="5.6" width="15" height="2.2" rx="1.1" fill={palette.name} />
  {:else}
    <rect width="64" height="42" fill={picture[0]} />
    <path d="M0 26 C14 18 26 30 40 22 S58 14 64 18 V42 H0 Z" fill={picture[1]} opacity="0.85" />
    <path d="M38 42 C42 34 50 32 64 31 V42 Z" fill={picture[2]} opacity="0.9" />
  {/if}
</svg>

<style>
  .ground-swatch { display: block; flex: none; border-radius: 3px; }
</style>
