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
  import L from 'leaflet';
  import { paths } from '../../components/Icon.svelte';
  import { precisionMetres } from '../../lib/sheetRoles.js';

  let { map = null, points = [] } = $props();
  let group = null;

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

  function icon(point) {
    const coarse = point.decimals <= COARSE_DECIMALS ? ' sheet-mark-coarse' : '';
    return L.divIcon({
      className: 'sheet-mark-wrap',
      html: `<span class="sheet-mark${coarse}">${glyph(12)}</span>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
  }

  $effect(() => {
    if (!map) return;
    group?.remove();
    group = L.layerGroup(
      points.flatMap((point) => {
        const metres = precisionMetres(point.decimals);
        const marker = L.marker([point.lat, point.lon], {
          icon: icon(point),
          keyboard: true,
          title:
            point.decimals <= COARSE_DECIMALS
              ? `${point.label} — written to ${point.decimals} decimals, about ${metres} m`
              : point.label,
        });
        marker.bindTooltip(point.label, { direction: 'top', offset: [0, -12] });
        if (point.decimals > COARSE_DECIMALS) return [marker];
        const circle = L.circle([point.lat, point.lon], {
          radius: metres,
          color: TINT,
          weight: 1,
          opacity: 0.75,
          fillColor: TINT,
          fillOpacity: 0.08,
          interactive: false,
        });
        return [circle, marker];
      }),
    ).addTo(map);
  });

  $effect(() => () => {
    group?.remove();
    group = null;
  });
</script>

<style>
  /* Leaflet builds these outside this component's markup, so they have to be global.
     The saved layer's geometry in this layer's tint. */
  :global(.sheet-mark-wrap) { border: 0; background: none; }
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
