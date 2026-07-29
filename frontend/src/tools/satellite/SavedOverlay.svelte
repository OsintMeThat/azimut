<script>
  /**
   * Session-only Saved navigation layer.
   * Owns the Leaflet group and rebuilds it when items or zoom change.
   */
  import { mount, unmount } from 'svelte';
  import L from 'leaflet';
  import { paths } from '../../components/Icon.svelte';
  import { groupSavedMarkers, markerPrecision } from '../../lib/savedMarkers.js';
  import { openEntity } from '../../lib/navigate.js';
  import SavedPopup from './SavedPopup.svelte';

  let {
    map = null,
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
    return L.divIcon({
      className: 'saved-mark-wrap',
      html: `<span class="saved-mark saved-mark-${kind}">${glyph(GLYPH[kind] ?? 'pin', 13)}${count}${worked}</span>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
  }

  // Mount popup content as a component inside Leaflet's container.
  let mounted = null;

  function popupContent(mark) {
    const host = document.createElement('div');
    if (mounted) unmount(mounted);
    mounted = mount(SavedPopup, {
      target: host,
      props: {
        items: mark.items,
        caseId,
        coords,
        fullscreen,
        onopen: (row) => {
          map.closePopup();
          onopen(row);
        },
        onedit: (row) => {
          map.closePopup();
          onedit(row);
        },
        onproof: (row) => {
          map.closePopup();
          onproof?.(row);
        },
        onpost: (post) => {
          map.closePopup();
          onpost?.(post);
        },
        onshowproofs: () => {
          map.closePopup();
          onshowproofs?.();
        },
        // opening a related media leaves the map, so close the card first — the
        // same gesture as every other row here, rather than a popup that
        // vanishes without saying it would
        onentity: (entity) => {
          map.closePopup();
          openEntity(entity);
        },
        onrefresh: () => onrefresh?.(),
      },
    });
    return host;
  }

  $effect(() => {
    if (!map) return;
    const sync = () => (zoom = map.getZoom());
    sync();
    map.on('zoomend', sync);
    return () => map.off('zoomend', sync);
  });

  // Is a card open? Rebuilding the layer destroys it, and the card is a surface
  // the analyst works in — settling relations, reading a stack. So a refreshed
  // index waits for the card to close rather than pulling it out from under them.
  let popupOpen = $state(false);
  $effect(() => {
    if (!map) return;
    const opened = () => (popupOpen = true);
    const closed = () => (popupOpen = false);
    map.on('popupopen', opened);
    map.on('popupclose', closed);
    return () => {
      map.off('popupopen', opened);
      map.off('popupclose', closed);
    };
  });

  // The group is replaced by `rebuild` and torn down when the overlay itself goes
  // away — deliberately not through the data effect's cleanup, which Svelte runs
  // before every re-run, including one that decides to defer.
  let group = null;
  let builtFor = null; // the case the current layer was built for

  $effect(() => {
    if (!map) return;
    return () => {
      group?.remove();
      group = null;
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
    if (!map) return;
    // A different case is never deferred: leaving another case's marks on the map
    // would be worse than closing a card.
    if (held && builtFor === cid) return;
    builtFor = cid;
    rebuild(rows, precision);
  });

  function rebuild(rows, precision) {
    const marks = groupSavedMarkers(rows, precision);
    const next = new Map();
    group?.remove();
    group = L.layerGroup(
      marks.map((mark) => {
        const marker = L.marker([mark.lat, mark.lon], {
          icon: icon(mark),
          title: mark.items.length > 1 ? `${mark.items.length} saved here` : mark.items[0].title,
          keyboard: false,
        });
        marker.on('add', () => {
          // one proof can hold two points, so identity here is the row key,
          // not the entity: hovering either place must light that place
          for (const row of mark.items) next.set(row.key ?? row.id, marker.getElement());
        });
        marker.on('mouseover', () => (hoveredId = mark.items[0].key ?? mark.items[0].id));
        marker.on('mouseout', () => (hoveredId = null));
        // every mark opens its card, one item or five: clicking a pin should
        // tell you what is there before it moves the map out from under you
        marker.bindPopup(() => popupContent(mark), {
          className: 'saved-popup',
          minWidth: 296,
          maxWidth: 330,
          autoPanPadding: [24, 24],
        });
        return marker;
      })
    ).addTo(map);
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
  /* Leaflet builds these elements itself, outside this component's markup, so
     the marker styles have to be global. One colour family throughout — the
     overlay must read as a single layer, not as a legend. */
  :global(.saved-mark-wrap) {
    background: none;
    border: none;
  }
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
  /* Leaflet's default popup is a white speech bubble; over imagery it has to be
     one of the app's own surfaces instead. */
  :global(.saved-popup .leaflet-popup-content-wrapper) {
    background: var(--bg-1);
    color: var(--text-1);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-2);
    padding: 2px;
  }
  :global(.saved-popup .leaflet-popup-content) {
    margin: 10px 12px;
    line-height: 1.4;
  }
  :global(.saved-popup .leaflet-popup-tip) {
    background: var(--bg-1);
    border: 1px solid var(--border-strong);
    box-shadow: none;
  }
  :global(.saved-popup .leaflet-popup-close-button) {
    color: var(--text-3) !important;
    padding: 6px 7px 0 0 !important;
  }
  :global(.saved-popup .leaflet-popup-close-button:hover) {
    color: var(--text-1) !important;
    background: none !important;
  }
</style>
