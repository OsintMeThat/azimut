<script>
  /**
   * The added layers on the map, one GL source each.
   *
   * Thin on purpose: `lib/map/addedLayer.js` owns the engine side, this owns the
   * lifecycle — which layers are drawn right now, which have to be torn down,
   * and what a click or a right-click on one of their features opens.
   *
   * Source cards show their saved fields and copy the feature's point. A
   * personal layer also offers an explicit handoff to its feature editor.
   * The right-click opens the map's own point menu on the pin's point: a place
   * saved from it is the analyst's, and carries nothing of the feature. How the
   * card is laid out lives in `lib/map/layerCard.js`; only its lifecycle lives
   * here.
   */
  import { untrack } from 'svelte';
  import { createAddedLayer } from '../../lib/map/addedLayer.js';
  import { attribution, UNNAMED } from '../../lib/map/addedLayers.js';
  import { layerCard } from '../../lib/map/layerCard.js';
  import { fmtCoords, toast } from '../../lib/state.svelte.js';
  import { copyText } from '../../lib/clipboard.js';
  import { paths } from '../../components/Icon.svelte';

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
    /** False while the map's own tool holds the pointer: a measure, a pin, an
     *  area being drawn. Its clicks then go to the tool, not to a card. */
    interactive = true,
    /** Personal layers can hand a feature to their editor. */
    onedit = null,
    onremovefeature = null,
    ondeleteplace = null,
  } = $props();

  async function copy(text) {
    await copyText(text);
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

  /**
   * Stack the drawn layers as the panel lists them, the first on top.
   *
   * The block stays where the first one sits, and each next one goes just under
   * the one before, so what the case draws itself keeps its place around them.
   * Run again whenever a layer finishes building, since a late one lands on top.
   */
  function restack() {
    let above = null;
    for (const row of layers) {
      const layer = live.get(row.name)?.layer;
      if (!layer?.floor()) continue;
      if (above) layer.stackUnder(above);
      above = layer;
    }
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
        editable: !!row.editable,
        card: (properties, point) => {
          const card = layerCard(row.title, { coords: fmtCoords, copy })(properties, point);
          if (row.editable && properties.key) {
            const actions = document.createElement('div');
            actions.className = 'layer-card-actions';
            const action = (label, icon, run) => {
              const button = document.createElement('button');
              button.type = 'button';
              button.className = 'layer-card-action';
              button.setAttribute('aria-label', label);
              button.title = label;
              const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
              svg.setAttribute('viewBox', '0 0 24 24');
              svg.setAttribute('width', '12'); svg.setAttribute('height', '12');
              svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
              svg.setAttribute('stroke-width', '1.8');
              svg.setAttribute('aria-hidden', 'true');
              const path = document.createElementNS(svg.namespaceURI, 'path');
              path.setAttribute('d', paths[icon]);
              svg.append(path);
              button.append(svg);
              button.addEventListener('click', (event) => { event.stopPropagation(); run(); });
              actions.append(button);
            };
            if (onedit) action('Edit feature', 'edit', () => onedit(row, properties.key));
            if (onremovefeature) action('Remove from this layer', 'trash', () => onremovefeature(row, properties.key));
            if (properties.place_id && ondeleteplace) {
              action('Delete case place', 'link', () => ondeleteplace(properties.place_id));
            }
            const footer = document.createElement('div');
            footer.className = 'layer-card-footer';
            footer.append(actions);
            const from = card.querySelector('.layer-card-from');
            if (from) footer.append(from);
            card.append(footer);
          }
          return card;
        },
        iconUrl: iconUrlFor(row),
        menu: (at, properties) =>
          onmenu?.(properties ? { ...at, feature: properties.name || UNNAMED, layer: row.title } : at),
      });
      layer.interactive(untrack(() => interactive));
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
          restack();
        })
        .catch(() => { if (live.get(row.name)?.layer === layer) drop(row.name); });
    }
    restack();
  });

  $effect(() => {
    const enabled = interactive;
    for (const { layer } of live.values()) layer.interactive(enabled);
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
  :global(.layer-card-footer) { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
  :global(.layer-card-actions) { display: flex; align-items: center; gap: 3px; }
  :global(.layer-card-action) { display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: var(--radius-1); background: transparent; color: var(--text-2); cursor: pointer; }
  :global(.layer-card-action:hover) { background: var(--bg-3); color: var(--accent); }
  :global(.layer-card-action[aria-label='Remove from this layer']:hover), :global(.layer-card-action[aria-label='Delete case place']:hover) { color: var(--danger); }
  :global(.layer-card-footer .layer-card-from) { margin: 0 0 0 auto; }
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
