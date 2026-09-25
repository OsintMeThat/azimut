<script>
  /**
   * The added layers on the map, one GL source each.
   *
   * Thin on purpose: `lib/map/addedLayer.js` owns the engine side, this owns the
   * lifecycle — which layers are drawn right now, which have to be torn down,
   * and what a click or a right-click on one of their features opens.
   *
   * That card is **read-only, by construction rather than by restraint**: it is
   * built from the strings the source stated, and its one control copies the
   * feature's point. There is no route from a feature into the case, because a
   * feature here is somebody else's claim and the case is this analyst's work.
   * The right-click opens the map's own point menu on the pin's point: a place
   * saved from it is the analyst's, and carries nothing of the feature. How the
   * card is laid out lives in `lib/map/layerCard.js`; only its lifecycle lives
   * here.
   */
  import { createAddedLayer } from '../../lib/map/addedLayer.js';
  import { attribution, UNNAMED } from '../../lib/map/addedLayers.js';
  import { layerCard } from '../../lib/map/layerCard.js';
  import { fmtCoords, toast } from '../../lib/state.svelte.js';

  let {
    engine = null,
    caseId = '',
    layers = [],
    drawing,
    /** The search result the panel sent here: `{ name, index, at }`, or null. */
    picked = null,
    /** `({ lat, lon, x, y, feature?, layer? })`: the map's point menu, opened on
     *  a feature. `feature` and `layer` name a pin whose point the menu is on. */
    onmenu = null,
  } = $props();

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Coordinates copied', 'ok', 1600);
    } catch {
      toast('The browser refused the clipboard', 'warn');
    }
  }

  /** name → { layer, sha } so a refreshed snapshot redraws and nothing else does. */
  const live = new Map();

  /**
   * Where this layer's own icons are, or nothing when it has none.
   *
   * Always a path on this server. The source's addresses were followed once, by
   * the backend, at the moment the analyst ticked the box; what is left of them
   * here is a content hash per image, so the browser asks localhost for a
   * picture rather than Google for the one a My Maps pointed at.
   */
  function iconUrlFor(row) {
    if (!row.icons) return null;
    const base = `/api/cases/${caseId}/map-layers/${encodeURIComponent(row.name)}/icons`;
    return (key) => `${base}/${key}`;
  }

  function drop(name) {
    live.get(name)?.layer.destroy();
    live.delete(name);
  }

  $effect(() => {
    if (!engine || !caseId) return;
    const wanted = new Set(layers.map((row) => row.name));
    for (const name of [...live.keys()]) {
      if (!wanted.has(name)) drop(name);
    }
    for (const row of layers) {
      const existing = live.get(row.name);
      if (existing && existing.sha === row.sha256) {
        // already drawn from these bytes: only the legend or the period can have moved
        existing.layer.filter(row.hidden, row.period);
        continue;
      }
      if (existing) drop(row.name);
      const layer = createAddedLayer(engine, {
        card: layerCard(row.title, { coords: fmtCoords, copy }),
        iconUrl: iconUrlFor(row),
        menu: (at, properties) =>
          onmenu?.(properties ? { ...at, feature: properties.name || UNNAMED, layer: row.title } : at),
      });
      live.set(row.name, { layer, sha: row.sha256 });
      drawing(caseId, row.name)
        .then((collection) => {
          // the layer may have been switched off while its features were loading
          if (live.get(row.name)?.layer !== layer) return;
          layer.set(collection, {
            categories: row.categories,
            hidden: row.hidden,
            period: row.period,
            attribution: attribution(row),
          });
        })
        .catch(() => drop(row.name));
    }
  });

  /**
   * A match picked in the panel, framed and opened on the map.
   *
   * Declared after the effect above on purpose: switching a group back on runs
   * that one, and it closes whatever card is open. Opening ours first would
   * hand it straight back.
   */
  let went = 0;
  $effect(() => {
    if (!picked || picked.at === went) return;
    went = picked.at;
    live.get(picked.name)?.layer.reveal(picked.index);
  });

  $effect(() => () => {
    for (const name of [...live.keys()]) drop(name);
  });
</script>

<style>
  /* The card is built outside this component's markup, so its rules are global.
     Only what is inside it: the card's own surface is the one every mark on this
     map opens on, and it is dressed once in `lib/map/engine.css`.

     Deliberately plain — it states what the source says and nothing else. */
  :global(.layer-card h4) {
    margin: 0;
    color: var(--text-1);
    font-size: var(--fs-sm);
  }
  :global(.layer-card-group) {
    margin: 2px 0 0;
    color: var(--text-3);
    font-size: 10px;
  }
  /* The point, read like the Saved card's and pressed to copy: text first,
     the glyph only saying that it can be pressed. */
  :global(.layer-card-where) {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin: 4px 0 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-2);
    font-size: var(--fs-xs);
    text-align: left;
  }
  :global(button.layer-card-where) {
    cursor: pointer;
  }
  :global(button.layer-card-where:hover),
  :global(button.layer-card-where:focus-visible) {
    color: var(--text-1);
  }
  :global(.layer-card-body) {
    margin: 6px 0 0;
    max-height: 220px;
    overflow-y: auto;
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  :global(.layer-card-text) {
    margin: 0 0 6px;
    white-space: pre-wrap;
  }
  /* A labelled line, drawn as the row the source wrote: the label above its
     value, because a popup is 320px wide and a two-column row would leave the
     values a few words each. */
  :global(.layer-card-field) {
    display: flex;
    flex-direction: column;
    margin-bottom: 6px;
  }
  :global(.layer-card-label) {
    color: var(--text-3);
    font-size: 10px;
  }
  :global(.layer-card-value) {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  /* The app's own link colour, underlined: a foreign address inside a wall of
     the source's text has to read as clickable before it is hovered. */
  :global(.layer-card-body a) {
    text-decoration: underline;
    overflow-wrap: anywhere;
  }
  :global(.layer-card-body > :last-child) {
    margin-bottom: 0;
  }
  /* Whose map this came from, signed in the corner: quiet, because it answers a
     question the analyst only asks when several layers are drawn at once. */
  :global(.layer-card-from) {
    margin: 8px 0 0;
    color: var(--text-3);
    font-size: 10px;
    text-align: right;
  }
</style>
