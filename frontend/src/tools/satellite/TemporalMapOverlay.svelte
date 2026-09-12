<script>
  /**
   * Session-only marks for whatever the Timeline window puts on the ground.
   *
   * Drawn as the saved index's own pins are — the same teardrop, count badge and
   * card — because they are the same gesture on the same map, and a second visual
   * language would only ask the analyst to learn the map twice. The tint is the one
   * difference, and it earns its place: both layers can be on at once, and this one
   * is transient.
   */
  import { mount, unmount } from 'svelte';
  import { createSurface } from '../../lib/map/surface.js';
  import { paths } from '../../components/Icon.svelte';
  import { groupTemporalMapItems } from '../../lib/temporalMap.js';
  import { TEARDROP, TEARDROP_CARD_OFFSET } from '../../lib/mapMarkers.js';
  import TemporalPopup from './TemporalPopup.svelte';

  let { engine = null, items = [], caseId = '', onopen = () => {} } = $props();
  let surface = null;
  let mounted = null;

  function glyph(name, size) {
    return (
      `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor"` +
      ` stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
      `<path d="${paths[name] ?? paths.alert}"/></svg>`
    );
  }

  function icon(mark) {
    const count = mark.items.length > 1 ? `<i class="temporal-mark-count">${mark.items.length}</i>` : '';
    return {
      className: 'temporal-mark-wrap',
      html: `<span class="temporal-mark">${glyph('clock', 13)}${count}</span>`,
      ...TEARDROP,
    };
  }

  function card(mark) {
    const host = document.createElement('div');
    if (mounted) unmount(mounted);
    mounted = mount(TemporalPopup, {
      target: host,
      props: {
        place: mark,
        items: mark.items,
        caseId,
        onopen: (item) => {
          surface.closePopup();
          onopen(item);
        },
        // Following a row leaves the map, so the card closes first — the same gesture
        // as the saved layer's, rather than a popup that vanishes without saying it
        // would.
        onleave: () => surface.closePopup(),
      },
    });
    return host;
  }

  /** How tightly the statement is placed, as the shape under its pin. */
  function area(mark) {
    const style = {
      stroke: '#35b6a0',
      strokeWidth: 1.5,
      strokeOpacity: 0.9,
      fill: '#35b6a0',
      fillOpacity: 0.12,
      interactive: false,
    };
    if (mark.footprint) return { kind: 'geojson', geometry: mark.footprint, style };
    if (Number(mark.radius_m) > 0) {
      return { kind: 'circle', at: mark, radiusM: Number(mark.radius_m), style };
    }
    return null;
  }

  $effect(() => {
    const marks = groupTemporalMapItems(items);
    if (!engine) return;
    surface ??= createSurface(engine);
    surface.set(
      marks.flatMap((mark) => [
        // the shape first, so the pin stays on top of its own uncertainty
        area(mark),
        {
          kind: 'marker',
          at: mark,
          ...icon(mark),
          title:
            mark.items.length === 1
              ? mark.items[0].label
              : `${mark.items.length} statements at ${mark.label}`,
          popup: {
            content: () => card(mark),
            className: 'temporal-popup',
            minWidth: 272,
            maxWidth: 320,
            offset: TEARDROP_CARD_OFFSET,
          },
        },
      ])
    );
  });

  $effect(() => () => {
    surface?.destroy();
    surface = null;
    if (mounted) {
      unmount(mounted);
      mounted = null;
    }
  });
</script>

<style>
  /* The map builds these elements itself, outside this component's markup, so the
     marker styles have to be global. The saved layer's geometry throughout — the
     teardrop, the badge on its corner, the lift on hover — in this layer's tint. */
  :global(.temporal-mark) {
    position: relative;
    display: grid;
    width: 24px;
    height: 24px;
    place-items: center;
    border-radius: 50% 50% 50% 2px;
    transform: rotate(-45deg);
    background: rgba(20, 20, 20, .82);
    box-shadow: 0 0 0 1.5px #35b6a0, 0 2px 5px rgba(0, 0, 0, .45);
    color: #35b6a0;
    transition: transform .12s var(--ease);
  }
  :global(.temporal-mark > svg) { transform: rotate(45deg); }
  :global(.temporal-mark-count) {
    position: absolute;
    top: -5px;
    right: -5px;
    min-width: 15px;
    padding: 0 3px;
    border-radius: 8px;
    transform: rotate(45deg);
    background: #141414;
    color: #fff;
    font-size: 9px;
    font-style: normal;
    font-weight: 700;
    line-height: 15px;
    text-align: center;
  }
  :global(.temporal-mark-wrap:hover .temporal-mark) {
    z-index: 500;
    transform: rotate(-45deg) scale(1.25);
  }
</style>
