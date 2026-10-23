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
  import { personalLayers } from '../../lib/map/personalLayers.svelte.js';
  import { openFollowed } from '../../lib/map/followed.js';
  import { fileUrl } from '../../lib/fileUrl.js';
  import { asOf, isTracked } from '../../lib/map/layerHistory.js';
  import { landAt } from '../../lib/map/landings.js';

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
    /** A source feature handed over to be copied into one of the analyst's layers. */
    oncopyfeature = null,
    /** `{ start(name), end(name, outcome) }`: told when a layer begins drawing and
     *  how it ended (`drawn`, `failed` or `dropped`), which is what lets a case
     *  put its layers back in turn and leave off one that took the page down. */
    watch = null,
  } = $props();

  async function copy(text) {
    await copyText(text);
  }

  /** name → { layer, sha, moment, collection, settled, landed } so a refreshed snapshot
   *  redraws, a tracked layer's moved cursor redraws from what is in hand, and
   *  nothing else does. `settled` once `watch` heard how its drawing ended;
   *  `landed`, the editor's edits drawn on it until a read of the layer holds them. */
  const live = new Map();
  /** The editor's landings this map has already taken, so none is put on twice. */
  const taken = new WeakSet();

  /** Say once how one layer's drawing ended. */
  function settle(name, entry, outcome) {
    if (entry.settled) return;
    entry.settled = true;
    watch?.end(name, outcome);
  }

  /**
   * Once the map has drawn what it was handed: the engine tiles a layer off the
   * page's thread, so a layer is only drawn when the map next goes idle. Bounded,
   * since a map kept moving never does.
   */
  function idle() {
    const map = engine?.impl;
    if (!map?.once) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 10000);
      map.once('idle', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** What a layer's engine layers are built for: a change of it builds them again. */
  const shapeOf = (row) => JSON.stringify([!!row.editable, isTracked(row), row.icons ?? 0, row.title]);

  /** What a tracked layer's cursor reads, as one key: a change redraws it. */
  const momentKey = (row) => isTracked(row) ? JSON.stringify(row.time ?? null) : '';

  /** The features a row draws: all of them, or a tracked layer as it stood at its moment. */
  function drawn(row, collection) {
    if (!isTracked(row) || !collection) return collection;
    const time = row.time ?? {};
    return asOf(collection, time.at ?? null, { trail: time.trail !== false, since: time.since ?? null, window: time.window ?? null });
  }

  /** What the editor holds off a layer while the analyst drags it; nothing once it is let go. */
  function heldOff(name) {
    const drag = untrack(() => personalLayers.dragging);
    return drag?.offset && !drag.landing && drag.name === name ? drag.keys : [];
  }

  function paint(row, entry) {
    const collection = drawn(row, entry.collection);
    return entry.layer.set(entry.landed.length && collection ? { ...collection, features: landAt(collection.features, entry.landed) } : collection, {
      categories: row.categories,
      hidden: row.hidden,
      period: row.period,
      attribution: attribution(row),
      held: heldOff(row.name),
    });
  }

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

  /**
   * What an own marker follows, on its card, each opened on a press: the footage
   * first, then the proof geolocating it, or the file alone.
   */
  function followedPictures(properties) {
    if (!properties.entity_id) return [];
    const proof = properties.entity_type === 'proof';
    const label = properties.entity_label || 'Untitled';
    return [
      properties.source_picture && { src: fileUrl(caseId, properties.source_picture), caption: 'Source',
        title: `Open the footage “${properties.source_label || 'Untitled'}”`, open: () => openFollowed(caseId, properties.source_id) },
      properties.entity_picture && { src: fileUrl(caseId, properties.entity_picture), caption: proof ? 'Proof' : 'Source',
        title: proof ? `Open the proof “${label}”` : `Open “${label}”`, open: () => openFollowed(caseId, properties.entity_id) },
    ].filter(Boolean);
  }

  function drop(name) {
    const entry = live.get(name);
    if (entry) settle(name, entry, 'dropped');
    entry?.layer.destroy();
    // a map that goes keeps no dragged copy waiting on it
    for (const landing of entry?.landed ?? []) personalLayers.landed(landing);
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
      // A layer edited or refreshed keeps its engine layers and takes its new features
      // in place: tearing them down and building them again is what each edit waited
      // on, and what made the map flash under the hand.
      if (existing && existing.sha !== row.sha256 && existing.settled && existing.shape === shapeOf(row)) {
        existing.sha = row.sha256;
        const entry = existing;
        // the landings saved before this read was asked for are in it, so it stops drawing them
        const through = entry.landed.filter((landing) => landing.saved);
        drawing(caseId, row.name).then((collection) => {
          if (live.get(row.name) !== entry || entry.sha !== row.sha256) return;
          entry.collection = collection;
          entry.read = row.sha256;
          entry.landed = entry.landed.filter((landing) => !through.includes(landing));
          const current = layers.find((item) => item.name === row.name) ?? row;
          entry.moment = momentKey(current);
          paint(current, entry);
        }).catch(() => {});
        continue;
      }
      if (existing && existing.sha === row.sha256) {
        if (existing.moment !== momentKey(row)) {
          existing.moment = momentKey(row);
          if (existing.collection) untrack(() => paint(row, existing));
          continue;
        }
        // already drawn from these bytes: only the legend or the period can have moved
        existing.layer.filter(row.hidden, row.period);
        continue;
      }
      if (existing) drop(row.name);
      const layer = createAddedLayer(engine, {
        editable: !!row.editable,
        history: isTracked(row),
        card: (properties, point) => {
          const card = layerCard(row.title, { coords: fmtCoords, copy, pictures: followedPictures })(properties, point);
          const own = row.editable && properties.key;
          if (own || oncopyfeature) {
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
            if (own && onedit) action('Edit feature', 'edit', () => onedit(row, properties.key));
            if (own && onremovefeature) action('Remove from this layer', 'trash', () => onremovefeature(row, properties.key));
            if (own && properties.entity_type === 'place' && ondeleteplace) {
              action('Delete case place', 'link', () => ondeleteplace(properties.entity_id));
            }
            const footer = document.createElement('div');
            footer.className = 'layer-card-footer';
            footer.append(actions);
            // somebody else's feature, put in one of the analyst's layers with the
            // menu a proof's point and a file use, opened from this button
            if (!own && oncopyfeature) {
              const add = document.createElement('button');
              add.type = 'button';
              add.className = 'layer-card-add';
              const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
              svg.setAttribute('viewBox', '0 0 24 24');
              svg.setAttribute('width', '12'); svg.setAttribute('height', '12');
              svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
              svg.setAttribute('stroke-width', '1.8');
              svg.setAttribute('aria-hidden', 'true');
              const path = document.createElementNS(svg.namespaceURI, 'path');
              path.setAttribute('d', paths.layers);
              svg.append(path);
              add.append(svg, 'Add to a layer');
              add.addEventListener('click', (event) => {
                event.stopPropagation();
                const feature = live.get(row.name)?.layer.feature(properties.index);
                if (feature) oncopyfeature(row, feature, add);
              });
              footer.append(add);
            }
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
      layer.interactive(untrack(() => interactive && row.name !== personalLayers.editor?.name));
      const entry = { layer, sha: row.sha256, read: null, moment: momentKey(row), collection: null, settled: false, shape: shapeOf(row), landed: [] };
      live.set(row.name, entry);
      watch?.start(row.name);
      drawing(caseId, row.name)
        .then(async (collection) => {
          // the layer may have been switched off while its features were loading
          if (live.get(row.name) !== entry) return;
          entry.collection = collection;
          entry.read = entry.sha;
          // the row as it is now: its cursor may have moved while this loaded
          const current = layers.find((item) => item.name === row.name) ?? row;
          entry.moment = momentKey(current);
          const painted = paint(current, entry);
          restack();
          await painted;
          await idle();
          if (live.get(row.name) === entry) settle(row.name, entry, 'drawn');
        })
        .catch(() => {
          if (live.get(row.name) !== entry) return;
          settle(row.name, entry, 'failed');
          drop(row.name);
        });
    }
    restack();
  });

  // The layer being edited answers its clicks in the editor, which picks what is pressed: never a card.
  $effect(() => {
    const enabled = interactive, edited = personalLayers.editor?.name;
    for (const [name, { layer }] of live) layer.interactive(enabled && name !== edited);
  });

  // The features being dragged in the editor leave the map while their copies move.
  // Once let go, the drawing that puts them where they landed brings them back.
  $effect(() => {
    const drag = personalLayers.dragging;
    void layers;
    for (const [name, { layer }] of live) if (!(drag?.landing && drag.name === name)) layer.hide(heldOff(name));
  });

  /**
   * An edit let go on the map is drawn where it landed at once, and the dragged
   * copies over it go once it is on screen. One the layer refused goes back; a
   * saved one is drawn until a read of the layer holds it.
   */
  $effect(() => {
    const landings = personalLayers.landings;
    untrack(() => {
      for (const [name, entry] of live) {
        // refused, or saved into the very read this map holds (nothing changed): drawn right without it
        const gone = entry.landed.filter((landing) => !landings.includes(landing) && (!landing.saved || landing.sha === entry.read));
        const fresh = landings.filter((landing) => landing.name === name && !taken.has(landing));
        if (!gone.length && !fresh.length) continue;
        fresh.forEach((landing) => taken.add(landing));
        entry.landed = [...entry.landed.filter((landing) => !gone.includes(landing)), ...fresh];
        const row = layers.find((item) => item.name === name);
        if (!entry.collection || !row) continue;
        fresh.forEach((landing) => personalLayers.claim(landing));
        paint(row, entry)
          .then(() => entry.layer.drawn?.())
          .catch(() => {})
          .finally(() => fresh.forEach((landing) => personalLayers.landed(landing)));
      }
    });
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
  :global(.layer-card-facts) {
    margin: 4px 0 0;
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  /* What the marker follows, side by side: the footage, then the proof. */
  :global(.layer-card-pictures) { display: flex; gap: 6px; margin: 6px 0 0; }
  :global(.layer-card-picture) {
    position: relative;
    flex: 1;
    min-width: 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: #000;
    overflow: hidden;
    cursor: pointer;
  }
  :global(.layer-card-picture:hover), :global(.layer-card-picture:focus-visible) { border-color: var(--accent); }
  :global(.layer-card-picture img) { display: block; width: 100%; height: 96px; object-fit: cover; }
  :global(.layer-card-picture span) {
    position: absolute; left: 4px; bottom: 4px; padding: 0 5px; border-radius: 999px;
    background: rgb(0 0 0 / 0.65); color: #fff; font-size: 10px;
  }
  :global(.layer-card-add) {
    display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 8px;
    border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-3);
    color: var(--text-1); font-size: var(--fs-xs); cursor: pointer;
  }
  :global(.layer-card-add:hover), :global(.layer-card-add:focus-visible) { border-color: var(--accent); color: var(--accent); }
  :global(.layer-card-link) {
    display: block;
    margin-top: 4px;
    overflow: hidden;
    font-size: var(--fs-xs);
    text-decoration: underline;
    text-overflow: ellipsis;
    white-space: nowrap;
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
