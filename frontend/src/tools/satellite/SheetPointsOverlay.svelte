<script>
  /**
   * A sheet's column of coordinates, on the map, for as long as the tab is open.
   *
   * Drawn with the saved index's geometry — the same teardrop, the same badge, the lift
   * on hover — because it is the same gesture on the same map, in this layer's own tint.
   *
   * The one thing it says that no other layer does: **how precisely each point was
   * written.** A cell holding `48.85, 2.35` is a claim about a kilometre, not about a
   * building, and a worklist full of two-decimal coordinates looks exactly like a
   * worklist of addresses until the circles are drawn. So the imprecision is the shape,
   * and the pin sits on top of it.
   */
  import { createSurface } from '../../lib/map/surface.js';
  import { paths } from '../../components/Icon.svelte';
  import { precisionMetres } from '../../lib/sheetRoles.js';

  let { engine = null, points = [] } = $props();
  let surface = null;

  const TINT = '#c58af9';

  /** Past this the cell says a neighbourhood, not a place, and the circle is worth
   *  drawing. Three decimals is about a hundred metres, which a building fits in. */
  const COARSE_DECIMALS = 2;

  function glyph(size) {
    return (
      `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor"` +
      ` stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
      `<path d="${paths.table}"/></svg>`
    );
  }

  function mark(coarse) {
    return {
      className: 'sheet-mark-wrap',
      html: `<span class="sheet-mark${coarse ? ' sheet-mark-coarse' : ''}">${glyph(12)}</span>`,
      size: [24, 24],
      anchor: [12, 12],
    };
  }

  $effect(() => {
    if (!engine) return;
    surface ??= createSurface(engine);
    surface.set(
      points.flatMap((point) => {
        const metres = precisionMetres(point.decimals);
        const coarse = point.decimals <= COARSE_DECIMALS;
        const marker = {
          kind: 'marker',
          at: point,
          ...mark(coarse),
          title: coarse
            ? `${point.label} — written to ${point.decimals} decimals, about ${metres} m`
            : point.label,
          tip: { text: point.label, direction: 'top', offset: [0, -12] },
        };
        if (!coarse) return [marker];
        // the shape first, so the pin stays on top of its own imprecision
        return [
          {
            kind: 'circle',
            at: point,
            radiusM: metres,
            style: {
              stroke: TINT,
              strokeWidth: 1,
              strokeOpacity: 0.75,
              fill: TINT,
              fillOpacity: 0.08,
              interactive: false,
            },
          },
          marker,
        ];
      })
    );
  });

  $effect(() => () => {
    surface?.destroy();
    surface = null;
  });
</script>

<style>
  /* The map builds these outside this component's markup, so they have to be
     global. The saved layer's geometry in this layer's tint. */
  :global(.sheet-mark) {
    position: relative; display: grid; width: 24px; height: 24px; place-items: center;
    border-radius: 50% 50% 50% 2px; transform: rotate(-45deg);
    background: rgba(20, 20, 20, 0.82);
    box-shadow: 0 0 0 1.5px #c58af9, 0 2px 5px rgba(0, 0, 0, 0.45);
    color: #c58af9; transition: transform 0.12s var(--ease);
  }
  /* A point written to a kilometre is drawn as one: dashed, so the pin reads as the
     centre of a guess rather than as an answer. */
  :global(.sheet-mark-coarse) { box-shadow: 0 0 0 1.5px #c58af9, 0 0 0 3px rgba(197, 138, 249, 0.25); }
  :global(.sheet-mark > svg) { transform: rotate(45deg); }
  :global(.sheet-mark-wrap:hover .sheet-mark) { z-index: 500; transform: rotate(-45deg) scale(1.25); }
</style>
