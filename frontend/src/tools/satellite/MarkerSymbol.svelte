<script>
  /**
   * A personal marker as the map draws it, for pickers and lists. `icon`, an own
   * icon's `{ src, mode }`, draws it in its disc or as it is instead of `symbol`.
   */
  import { markerParts, partTransform, MARKER_PIXELS, ownParts, OWN_GLYPH } from '../../lib/map/markerGlyphs.js';
  import { loadPicture, readyPicture } from '../../lib/map/ownIcons.js';
  import { glyphInk } from '../../lib/proofIcons.js';

  let { symbol = 'pin', colour = '#0072b2', size = 22, status = '', external = false, icon = null } = $props();
  const own = $derived(icon?.src ? icon : null);
  const parts = $derived(own ? null : markerParts(symbol, colour, { status, external }));
  const ground = $derived(own ? ownParts(colour, { mode: own.mode, status, external }) : null);
  // The painted part of the picture, once read, so a padded layer icon is not drawn small.
  // Raw, and never read by the effect that writes it: a picture held in plain $state is
  // wrapped in a new proxy at each write, and an effect reading what it writes then
  // runs for ever (effect_update_depth_exceeded), which froze every button of the app.
  let picture = $state.raw(null);
  $effect(() => {
    const src = own?.src;
    const ready = src ? readyPicture(src) : null;
    picture = ready;
    if (src && !ready) loadPicture(src).then((read) => { if (own?.src === src) picture = read; });
  });
  const place = $derived.by(() => {
    if (!own) return null;
    const width = picture?.image?.width || 0, height = picture?.image?.height || 0;
    if (own.mode === 'disc') {
      const box = picture?.box ?? (width ? { x: 0, y: 0, w: width, h: height } : null);
      if (!box) return { x: 32 - OWN_GLYPH / 2, y: 32 - OWN_GLYPH / 2, width: OWN_GLYPH, height: OWN_GLYPH, whole: true };
      const fit = OWN_GLYPH / Math.max(box.w, box.h, 1);
      return { x: 32 - (box.x + box.w / 2) * fit, y: 32 - (box.y + box.h / 2) * fit, width: width * fit, height: height * fit };
    }
    // as it is: its painted part filling the disc's room, wherever its padding put it
    const box = picture?.box ?? (width ? { x: 0, y: 0, w: width, h: height } : null);
    if (!box) return { x: 6, y: 6, width: 52, height: 52, whole: true };
    const fit = 52 / Math.max(box.w, box.h, 1);
    return { x: 32 - (box.x + box.w / 2) * fit, y: 32 - (box.y + box.h / 2) * fit, width: width * fit, height: height * fit };
  });
  const mask = `marker-mask-${Math.random().toString(36).slice(2, 10)}`;
</script>

<svg class="marker-symbol" width={size} height={size} viewBox={`0 0 ${MARKER_PIXELS} ${MARKER_PIXELS}`} aria-hidden="true"
  stroke-linecap="round" stroke-linejoin="round">
  {#if own && place}
    {#each ground.under as part, index (index)}
      <path d={part.d} transform={partTransform(part)} fill={part.fill ?? 'none'}
        stroke={part.stroke ?? 'none'} stroke-width={part.stroke ? part.width : undefined}
        stroke-dasharray={part.dash?.join(' ')} />
    {/each}
    {#if own.mode === 'disc'}
      <defs>
        <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width={MARKER_PIXELS} height={MARKER_PIXELS} style="mask-type: alpha">
          <image href={own.src} x={place.x} y={place.y} width={place.width} height={place.height}
            preserveAspectRatio="xMidYMid meet" />
        </mask>
      </defs>
      <rect x="0" y="0" width={MARKER_PIXELS} height={MARKER_PIXELS} fill={glyphInk(colour, 1)} mask={`url(#${mask})`} />
    {:else}
      <image href={own.src} x={place.x} y={place.y} width={place.width} height={place.height} preserveAspectRatio="xMidYMid meet" />
    {/if}
    {#each ground.over as part, index (index)}
      <path d={part.d} transform={partTransform(part)} fill={part.fill ?? 'none'}
        stroke={part.stroke ?? 'none'} stroke-width={part.stroke ? part.width : undefined}
        stroke-dasharray={part.dash?.join(' ')} />
    {/each}
  {:else if parts}
    {#each parts as part, index (index)}
      <path d={part.d} transform={partTransform(part)} fill={part.fill ?? 'none'}
        stroke={part.stroke ?? 'none'} stroke-width={part.stroke ? part.width : undefined}
        stroke-dasharray={part.dash?.join(' ')} />
    {/each}
  {/if}
</svg>

<style>
  .marker-symbol { display: block; flex: none; }
</style>
