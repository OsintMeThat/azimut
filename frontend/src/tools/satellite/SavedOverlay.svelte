<script>
  /**
   * Session-only Saved navigation layer.
   * Owns its drawing surface and rebuilds it when items or zoom change.
   */
  import { mount, unmount } from 'svelte';
  import { createSurface } from '../../lib/map/surface.js';
  import { paths } from '../../components/Icon.svelte';
  import { groupSavedMarkers, markerPrecision } from '../../lib/savedMarkers.js';
  import { TEARDROP, TEARDROP_CARD_OFFSET } from '../../lib/mapMarkers.js';
  import { openEntity } from '../../lib/navigate.js';
  import SavedPopup from './SavedPopup.svelte';

  let {
    engine = null,
    items = [],
    caseId,
    coords,
    fullscreen = false,
    hoveredId = $bindable(null),
    onopen,
    onedit,
    onproof,
    onpost,
    onshowproofs,
    onrefresh,
  } = $props();

  const GLYPH = { place: 'pin', capture: 'satellite', screenshot: 'screen', proof: 'proof' };

  let zoom = $state(null);

  // Keep marker elements by item id for hover sync without a rebuild.
  let elements = $state(new Map());

  function glyph(name, size) {
    return (
      `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor"` +
      ` stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
      `<path d="${paths[name] ?? paths.alert}"/></svg>`
    );
  }

  function icon(mark) {
    // Mixed stacks use the shared place glyph.
    const kind = mark.kinds.length > 1 ? 'place' : mark.kinds[0];
    const count =
      mark.items.length > 1 ? `<i class="saved-mark-count">${mark.items.length}</i>` : '';
    // A proof borrowing capture coordinates appears as a dot on that capture.
    const worked = mark.items.some((row) => row.proofs > 0)
      ? '<i class="saved-mark-worked"></i>'
      : '';
    return {
      className: 'saved-mark-wrap',
      html: `<span class="saved-mark saved-mark-${kind}">${glyph(GLYPH[kind] ?? 'pin', 13)}${count}${worked}</span>`,
      ...TEARDROP,
    };
  }

  // Mount the card's content as a component, inside the popup's own element.
  let mounted = null;

  function popupContent(mark) {
    const host = document.createElement('div');
    if (mounted) unmount(mounted);
    const close = (then) => (arg) => {
      surface.closePopup();
      then?.(arg);
    };
    mounted = mount(SavedPopup, {
      target: host,
      props: {
        items: mark.items,
        caseId,
        coords,
        fullscreen,
        onopen: close(onopen),
        onedit: close(onedit),
        onproof: close(onproof),
        onpost: close(onpost),
        onshowproofs: close(onshowproofs),
        // opening a related media leaves the map, so close the card first — the
        // same gesture as every other row here, rather than a popup that
        // vanishes without saying it would
        onentity: close(openEntity),
        onrefresh: () => onrefresh?.(),
      },
    });
    return host;
  }

  // How tightly the marks are grouped follows the zoom, and only the zoom: a pan
  // settles at the same zoom, reads the same number, and rebuilds nothing.
  $effect(() => {
    if (!engine) return;
    zoom = engine.getZoom();
    return engine.on('view-settled', (view) => (zoom = view.zoom));
  });

  // Is a card open? Rebuilding the layer destroys it, and the card is a surface
  // the analyst works in — settling relations, reading a stack. So a refreshed
  // index waits for the card to close rather than pulling it out from under them.
  let popupOpen = $state(false);

  // The surface is redrawn by `rebuild` and torn down when the overlay itself
  // goes away — deliberately not through the data effect's cleanup, which Svelte
  // runs before every re-run, including one that decides to defer.
  let surface = null;
  let builtFor = null; // the case the current layer was built for

  $effect(() => {
    if (!engine) return;
    return () => {
      surface?.destroy();
      surface = null;
      elements = new Map();
      if (mounted) {
        unmount(mounted);
        mounted = null;
      }
    };
  });

  $effect(() => {
    const rows = items;
    const cid = caseId;
    const precision = markerPrecision(zoom);
    const held = popupOpen; // tracked, so closing the card applies what waited
    if (!engine) return;
    // A different case is never deferred: leaving another case's marks on the map
    // would be worse than closing a card.
    if (held && builtFor === cid) return;
    builtFor = cid;
    rebuild(rows, precision);
  });

  /**
   * How tightly a mark is pinned, as a shape under its pin (ONTOLOGY §2).
   *
   * A pin dropped on a guess is the lie this fixes: "somewhere on the north quay"
   * draws as the circle it is. A footprint wins over a radius when both are set,
   * because a traced shape says more than the circle around it.
   *
   * A mark with neither returns nothing and draws exactly as it always has —
   * absence is a state, never something to flag.
   */
  function shapesFor(mark, id) {
    const row = mark.items.find((r) => r.footprint || r.radius_m > 0);
    if (!row) return [];
    const style = {
      stroke: '#f5a623',
      strokeWidth: 1.5,
      strokeOpacity: 0.9,
      fill: '#f5a623',
      fillOpacity: 0.12,
      // never steals the click from the pin it sits under
      interactive: false,
    };
    return row.footprint
      ? [{ id: `${id}:shape`, kind: 'geojson', geometry: row.footprint, style }]
      : [{ id: `${id}:shape`, kind: 'circle', at: mark, radiusM: row.radius_m, style }];
  }

  function rebuild(rows, precision) {
    const marks = groupSavedMarkers(rows, precision);
    surface ??= createSurface(engine, {
      onPopupOpen: () => (popupOpen = true),
      onPopupClose: () => (popupOpen = false),
    });
    surface.set(
      marks.flatMap((mark, at) => [
        // the shape first, so the pin stays on top of its own uncertainty
        ...shapesFor(mark, at),
        {
          id: at,
          kind: 'marker',
          at: mark,
          ...icon(mark),
          title: mark.items.length > 1 ? `${mark.items.length} saved here` : mark.items[0].title,
          keyboard: false,
          onOver: () => (hoveredId = mark.items[0].key ?? mark.items[0].id),
          onOut: () => (hoveredId = null),
          // every mark opens its card, one item or five: clicking a pin should
          // tell you what is there before it moves the map out from under you
          popup: {
            content: () => popupContent(mark),
            className: 'saved-popup',
            minWidth: 296,
            maxWidth: 330,
            offset: TEARDROP_CARD_OFFSET,
          },
        },
      ])
    );
    // one proof can hold two points, so identity here is the row key, not the
    // entity: hovering either place must light that place
    const next = new Map();
    marks.forEach((mark, at) => {
      const element = surface.element(at);
      for (const row of mark.items) next.set(row.key ?? row.id, element);
    });
    elements = next;
  }

  // hover sync, both directions: the tree and the modal set hoveredId, the
  // markers above set it too, and this is the one place that paints it
  let lit = null;
  $effect(() => {
    const id = hoveredId;
    if (lit && lit !== elements.get(id)) lit.classList.remove('is-hovered');
    lit = id ? (elements.get(id) ?? null) : null;
    lit?.classList.add('is-hovered');
  });
</script>

<style>
  /* The map builds these elements itself, outside this component's markup, so
     the marker styles have to be global. One colour family throughout — the
     overlay must read as a single layer, not as a legend. */
  :global(.saved-mark) {
    position: relative;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 50% 50% 50% 2px;
    transform: rotate(-45deg);
    background: var(--accent);
    color: var(--accent-text);
    box-shadow: 0 0 0 1.5px rgba(0, 0, 0, 0.55), 0 2px 5px rgba(0, 0, 0, 0.45);
    transition: transform 0.12s var(--ease);
  }
  :global(.saved-mark > svg) {
    transform: rotate(45deg);
  }
  /* a place is the point itself and carries no imagery — outlined, so a stack
     of captures never hides behind one */
  :global(.saved-mark-place) {
    background: rgba(20, 20, 20, 0.82);
    color: var(--accent);
    box-shadow: 0 0 0 1.5px var(--accent), 0 2px 5px rgba(0, 0, 0, 0.45);
  }
  :global(.saved-mark-count) {
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
    font-weight: 700;
    font-style: normal;
    line-height: 15px;
    text-align: center;
  }
  /* One dot however many proofs: the mark says "already worked", the card says
     how many. The mark is rotated -45°, so the *top edge* of the box is what
     reads as up-left on screen — and the count badge, on the top-right corner,
     reads as straight up. They never collide. */
  :global(.saved-mark-worked) {
    position: absolute;
    top: -3px;
    left: 8px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 0 0 1.5px rgba(0, 0, 0, 0.55);
  }
  :global(.saved-mark-wrap.is-hovered .saved-mark),
  :global(.saved-mark-wrap:hover .saved-mark) {
    transform: rotate(-45deg) scale(1.25);
    z-index: 500;
  }
</style>
