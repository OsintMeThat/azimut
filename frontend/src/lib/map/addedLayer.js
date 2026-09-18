/**
 * One added layer on the map: a GeoJSON source and the GL layers over it.
 *
 * **Not DOM markers.** The case's own pins are one `div` each (`surface.js`),
 * which is right for a few hundred rich, draggable, hoverable marks and caps out
 * around a thousand or two. A layer somebody else made holds tens of thousands,
 * and none of them is interactive beyond a read-only card — so it is a source
 * with `circle`, `symbol`, `line` and `fill` layers, which MapLibre paints in
 * one pass and culls to the viewport for free. Nothing here filters by viewport
 * or truncates the data: the engine already does the first and the second would
 * be a map lying about what it read.
 *
 * Three things this has to do that the curated overlays do not:
 *
 * - **Decluttering is collision, not a cap.** At low zoom the symbols would be a
 *   solid mat, and a cap taken in file order clumps badly — a KML is ordered by
 *   folder or by creation, never by geography. `icon-allow-overlap: false` lets
 *   MapLibre drop a symbol that overlaps one already placed, which gives an
 *   evenly spread map that densifies as you zoom in, for nothing.
 * - **Icons are registered at runtime.** The engine deliberately loads no style
 *   URL, no sprite and no glyphs (`engine.js`), and this must not be the reason
 *   it starts. Each pictogram is drawn to a canvas here and handed to
 *   `map.addImage` as an **SDF**, which is what lets one image per shape be
 *   tinted to any colour a source asked for — the alternative is one registered
 *   image per (shape × colour) pair, which explodes on a map with twenty groups.
 * - **A source's own icons are a second symbol layer, not a second option on the
 *   first.** They arrive as real PNGs the backend composed
 *   (`engine/maplayers.py`), which means non-SDF, which means no `icon-color`
 *   and no `icon-halo-*` — the colour is already in the pixels. Mixing SDF and
 *   non-SDF images in one symbol layer is not something MapLibre renders
 *   reliably, so the points split by whether their icon loaded: the ones that
 *   did draw the source's picture, the ones that did not draw our tinted shape.
 *   That split is also the fallback. An icon that 404s, decodes badly or never
 *   arrives costs its features nothing beyond the pictogram they would have had.
 * - **No map labels.** `text-field` needs real glyphs, which the engine does not
 *   load and which this feature will not make it load. A feature's name lives in
 *   the hover reading and in the card, both resolved through the engine's own
 *   hit testing.
 */
import { Popup } from 'maplibre-gl';
import { paths } from '../../components/Icon.svelte';
import { categoryColour } from './addedLayers.js';

/** The pictogram per geometry kind. Three shapes is the whole vocabulary, and
 *  what every feature falls back to when the source drew no icon of its own. */
const GLYPHS = { point: 'pin', line: 'line', area: 'polygon' };

/** How big an icon is drawn into its own image, before the engine scales it. */
const ICON_PIXELS = 64;

/**
 * Empty pixels kept around the glyph inside that image.
 *
 * The outline is drawn *outside* the shape, so a glyph filling its own image
 * would have its outline cut off at the edge — worst at the pin's tip, which is
 * the part that names the point.
 */
const ICON_PAD = 10;

/**
 * How far from the edge the distance field still means something.
 *
 * The outline can only be as wide as the field can measure, so this is what
 * bounds `icon-halo-width` below: too small and the outline is clipped into a
 * hard ring, which looks worse than none.
 */
const ICON_SPREAD = 8;

/** …and how much of that is shown. An added layer sits under the case's own
 *  marks in weight as well as in stacking order. */
const ICON_SCALE = 0.4;

/**
 * …and the weight a source's own icon is drawn at.
 *
 * The backend composes every one of them to one painted weight (`ICON_SIDE`),
 * which is what makes a single number right here: a 16px road sign and a 512px
 * badge come out of the same door, so a My Maps cannot have one group towering
 * over another just because its creator uploaded a bigger PNG.
 *
 * Lower than the pictogram above it, because a real icon is a filled picture
 * where ours is a stroked outline: at equal size the picture reads heavier, and
 * these are somebody else's marks sitting under the case's own.
 */
const SOURCE_ICON_SCALE = 0.28;

/**
 * The white edge around every mark.
 *
 * A foreign layer is drawn in the source's own colours, and a source picks them
 * against its own basemap — never against this case's imagery. A dark green pin
 * on a field and a pale one on concrete both disappear. The outline is what
 * makes the colour readable wherever the analyst happens to be looking, and it
 * costs nothing: `icon-halo-*` only works on SDF icons, which is already the
 * format chosen so the source's colour could tint our pictogram.
 */
const ICON_OUTLINE = '#fff';
/** Enough to lift the mark off the ground under it, and no more: past about a
 *  pixel the edge starts reading as the mark and the colour as its filling. */
const ICON_OUTLINE_WIDTH = 0.8;

/**
 * The frame a searched-for feature is shown in.
 *
 * A pin has no extent at all, so the box collapses to a point and the ceiling is
 * what decides the zoom; a district frames itself. One rule for all three kinds,
 * and the same numbers the map's other handoffs travel by (`Satellite.svelte`).
 */
const REVEAL_PADDING = [48, 48];
const REVEAL_ZOOM = 17;

/**
 * How far off its point a card hangs.
 *
 * A pin stands above the ground it claims — its image is `ICON_PIXELS` tall,
 * shown at `ICON_SCALE`, and pulled back down by the padding under its tip — so
 * a card opened at the point itself would cover the mark that was clicked. An
 * edge or an area is clicked where it is, and takes the smaller gap.
 */
const PIN_CARD_OFFSET = Math.round((ICON_PIXELS - ICON_PAD) * ICON_SCALE);
const EDGE_CARD_OFFSET = 12;

let layers = 0; // one id prefix per layer, so two of them never collide

/** The card a feature opens, dressed like every other card on this map
 *  (`lib/map/engine.css`) and closed the same two ways: its own cross, or the
 *  next click anywhere. */
function defaultPopup(offset) {
  return new Popup({
    className: 'added-layer-card',
    closeOnClick: true,
    focusAfterOpen: false,
    maxWidth: '320px',
    offset,
  });
}

/** The image `addImage` knows a pictogram by. Shared: they are SDFs, so one
 *  copy serves every layer and every colour. */
export function iconName(kind) {
  return `azimut-layer-${kind}`;
}

/**
 * …and the one it knows a source's own icon by.
 *
 * Shared between layers too, and safely: the key is the backend's content hash
 * of what the icon *is* — its address, its colour, its scale, its anchor — so
 * two layers naming the same key are asking for the same pixels. Two My Maps
 * that both use Google's red pin register it once.
 */
export function sourceIconName(key) {
  return `azimut-source-${key}`;
}

/** One composed icon, fetched from the case folder and decoded by the engine. */
async function defaultLoadIcon(map, url) {
  const loaded = await map.loadImage(url);
  return loaded?.data ?? null;
}

/**
 * A pictogram as a signed-distance-field image.
 *
 * SDF is the whole reason the colour rule works: MapLibre tints an SDF icon with
 * `icon-color`, so the source's own colour paints our shape. A plain image would
 * have to be re-registered per colour.
 *
 * The field is crude — inside the stroke is opaque, outside falls off over a few
 * pixels — which is all a 48px pictogram needs, and it keeps this to a canvas
 * and no dependency.
 */
export function iconImage(kind, size = ICON_PIXELS, make = defaultCanvas) {
  const canvas = make(size, size);
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.clearRect(0, 0, size, size);
  // inset, so the outline drawn outside the shape has pixels to live in
  const scale = (size - ICON_PAD * 2) / 24;
  context.setTransform(scale, 0, 0, scale, ICON_PAD, ICON_PAD);
  context.strokeStyle = '#fff';
  context.fillStyle = '#fff';
  context.lineWidth = 2.4;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  const path = new Path2D(paths[GLYPHS[kind] ?? 'pin']);
  if (kind === 'point') context.fill(path);
  context.stroke(path);
  context.setTransform(1, 0, 0, 1, 0, 0);

  const pixels = context.getImageData(0, 0, size, size);
  return { width: size, height: size, data: sdf(pixels.data, size, ICON_SPREAD) };
}

function defaultCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Alpha → the distance field MapLibre reads.
 *
 * MapLibre treats an SDF's alpha channel as distance from the shape's edge, with
 * 0.5 the edge itself. Drawn opaque, a pictogram already says inside from
 * outside; this spreads that boundary over a few pixels so the icon has an edge
 * to antialias rather than a cliff.
 */
function sdf(data, size, spread = ICON_SPREAD) {
  const out = new Uint8ClampedArray(data.length);
  const inside = (x, y) =>
    x >= 0 && y >= 0 && x < size && y < size && data[(y * size + x) * 4 + 3] > 127;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      let distance = spread;
      for (let radius = 0; radius <= spread && distance === spread; radius += 1) {
        // the first ring at which this pixel disagrees with the one it is in
        for (let dy = -radius; dy <= radius; dy += 1) {
          for (let dx = -radius; dx <= radius; dx += 1) {
            if (inside(x + dx, y + dy) !== inside(x, y)) {
              distance = Math.min(distance, Math.hypot(dx, dy));
            }
          }
        }
      }
      const signed = inside(x, y) ? distance : -distance;
      out[index] = out[index + 1] = out[index + 2] = 255;
      out[index + 3] = Math.round(((signed / spread) * 0.5 + 0.5) * 255);
    }
  }
  return out;
}

/** Register the three pictograms once on a map, if they are not there already. */
export function registerIcons(map, build = iconImage) {
  for (const kind of Object.keys(GLYPHS)) {
    const name = iconName(kind);
    if (map.hasImage?.(name)) continue;
    const image = build(kind);
    if (image) map.addImage(name, image, { sdf: true });
  }
}

/**
 * What a category is painted, as one expression over the whole layer.
 *
 * Built as a `match` on the category name rather than resolved per feature into
 * the data: the colour a legend row shows and the colour the map draws are then
 * the same value read from the same place, and switching one cannot leave the
 * other behind.
 */
export function colourExpression(categories = []) {
  if (!categories.length) return categoryColour(null, 0);
  const match = ['match', ['get', 'category']];
  categories.forEach((category, index) => {
    match.push(category.name, categoryColour(category, index));
  });
  match.push(categoryColour(null, 0));
  return match;
}

/** Which features are drawn: everything, minus the categories switched off. */
export function visibilityFilter(hidden = []) {
  if (!hidden.length) return null;
  return ['!', ['in', ['get', 'category'], ['literal', [...hidden]]]];
}

/**
 * @param {object} engine the façade from `engine.js`
 * @param {object} [opts]
 * @param {(feature: object) => HTMLElement} [opts.card] the read-only popup's body
 * @param {(offset: number) => object} [opts.popup] the card itself, swappable so
 *   the click path can be read off a test without standing up the engine's own popup
 * @param {(key: string) => string} [opts.iconUrl] where this case keeps the
 *   source's composed icons. Absent — a layer added without the box ticked, or one
 *   whose icons could not be made — and every point draws the app's own pictogram.
 * @param {(map: object, url: string) => Promise<object|null>} [opts.loadIcon]
 */
export function createAddedLayer(
  engine,
  { card, popup = defaultPopup, iconUrl = null, loadIcon = defaultLoadIcon } = {}
) {
  const map = engine.impl;
  const prefix = `added-${++layers}`;
  const SOURCE = `${prefix}-src`;
  const FILL = `${prefix}-fill`;
  const LINE = `${prefix}-line`;
  const DOT = `${prefix}-dot`;
  const MARK = `${prefix}-mark`;
  const OWN = `${prefix}-own`;
  const PAINTED = [FILL, LINE, DOT, MARK, OWN];

  let built = false;
  let shown = true;
  let categories = [];
  let collection = null; // what was last drawn, so a feature can be found by number
  let open = null; // the read-only card, so it can be closed by name
  let releaseClicks = null;
  // Bumped by every `set` and by `destroy`, so a set whose icons were still
  // loading when the layer moved on lands nowhere.
  let generation = 0;
  const listeners = [];

  function build(attribution) {
    if (built) return;
    built = true;
    registerIcons(map);
    map.addSource(SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      // the credit line the source is owed, picked up by the engine's own
      // attribution control exactly as a curated overlay's is
      attribution,
    });
    const colour = ['to-color', ['get', '$colour']];
    map.addLayer({
      id: FILL,
      type: 'fill',
      source: SOURCE,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': colour, 'fill-opacity': 0.18 },
    });
    map.addLayer({
      id: LINE,
      type: 'line',
      source: SOURCE,
      filter: ['!=', ['geometry-type'], 'Point'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': colour, 'line-width': 2, 'line-opacity': 0.9 },
    });
    // Under the symbols, and only while they are being dropped: far out, the
    // collision below hides most of a dense layer, and a dot per feature is what
    // keeps the map honest about how much is really there. Close in, every
    // symbol is placed, so the same dot is just a bead stuck under each pin —
    // it fades out over the zooms where that changes.
    map.addLayer({
      id: DOT,
      type: 'circle',
      source: SOURCE,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 0],
        'circle-color': colour,
        'circle-opacity': 0.85,
      },
    });
    map.addLayer({
      id: MARK,
      type: 'symbol',
      source: SOURCE,
      filter: ['all', ['==', ['geometry-type'], 'Point'], ['!', ['has', '$own']]],
      layout: {
        'icon-image': ['get', '$icon'],
        'icon-size': ICON_SCALE,
        'icon-anchor': 'bottom',
        // The decluttering, and the whole of it: MapLibre hides a symbol that
        // overlaps one already placed, so the map spreads evenly and densifies
        // as it is zoomed into. A cap in file order would clump.
        'icon-allow-overlap': false,
        'icon-ignore-placement': false,
        // …and who wins a contested spot. File order, so the answer is at least
        // the same one twice running.
        'symbol-sort-key': ['get', 'index'],
      },
      paint: {
        'icon-color': colour,
        'icon-opacity': 0.95,
        'icon-halo-color': ICON_OUTLINE,
        'icon-halo-width': ICON_OUTLINE_WIDTH,
        'icon-halo-blur': 0.2,
        // The anchor is the image's bottom edge, and the padding that gives the
        // outline room to draw sits between that edge and the pin's tip. Without
        // this the pin floats its own padding above the ground, which reads as
        // the dot underneath having come loose from it.
        'icon-translate': [0, ICON_PAD * ICON_SCALE],
      },
    });
    // The source's own pictures, which is a separate layer rather than a second
    // `icon-image` on the one above: these are plain PNGs, the ones above are
    // SDFs, and MapLibre does not reliably render both out of one symbol layer.
    // Everything SDF buys — the tint, the white outline — is already in these
    // pixels, composed by the backend, so there is nothing to paint here.
    map.addLayer({
      id: OWN,
      type: 'symbol',
      source: SOURCE,
      filter: ['all', ['==', ['geometry-type'], 'Point'], ['has', '$own']],
      layout: {
        'icon-image': ['get', '$own'],
        'icon-size': SOURCE_ICON_SCALE,
        // The anchor is the middle because the backend padded each image until
        // the pixel the source anchors it by *was* the middle — a pin's tip
        // lands on the ground without a per-feature offset to carry.
        'icon-anchor': 'center',
        'icon-allow-overlap': false,
        'icon-ignore-placement': false,
        'symbol-sort-key': ['get', 'index'],
      },
      paint: { 'icon-opacity': 0.95 },
    });
    bindHandlers();
    if (!shown) applyVisibility();
  }

  /**
   * The card, and the only thing a feature answers.
   *
   * Read-only by construction: it is given what the source states and offers no
   * way out of itself. Nothing in an added layer enters the case.
   */
  function bindHandlers() {
    const bind = (type, handler) => {
      map.on(type, PAINTED, handler);
      listeners.push([type, PAINTED, handler]);
    };
    bind('click', (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      showCard(feature, event.lngLat);
    });
    bind('mouseenter', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    bind('mouseleave', () => {
      map.getCanvas().style.cursor = '';
    });
    releaseClicks = engine.claimClicks?.(PAINTED) ?? null;
  }

  /**
   * Open the card on a feature, hung off the feature's own point.
   *
   * Not off the cursor: a pin is clicked on its head, a good twenty pixels above
   * the ground it claims, and the two are then the same *ground* distance apart
   * at every zoom — which shows on screen as the card sliding away from its own
   * mark the further you zoom in. A point states where it is, so that is what
   * the card is pinned to; an edge or an area has no one point, and is read
   * where it was touched.
   */
  function showCard(feature, at) {
    if (!card) return;
    closeCard();
    const point = feature.geometry?.type === 'Point' ? feature.geometry.coordinates : null;
    open = popup(point ? PIN_CARD_OFFSET : EDGE_CARD_OFFSET)
      .setLngLat(point ?? at)
      .setDOMContent(card(feature.properties ?? {}))
      .addTo(map);
    open.on('close', () => {
      open = null;
    });
  }

  function closeCard() {
    open?.remove();
    open = null;
  }

  /**
   * Register every source icon these features ask for, and say which arrived.
   *
   * The whole of the fallback, and the reason it needs no switch on the panel:
   * a key that is not in the returned set is a key no feature is routed by, so
   * an icon that 404s, decodes badly or times out leaves its features drawing
   * the app's own pictogram in the source's colour. One layer being undressed is
   * not a map that stopped working.
   *
   * All of them at once rather than in turn: they are a few dozen small files
   * off localhost, and doing them serially would show as the icons appearing
   * one by one.
   */
  async function registerSourceIcons(features) {
    const arrived = new Set();
    if (!iconUrl) return arrived;
    const keys = new Set();
    for (const feature of features) {
      const key = feature?.properties?.icon;
      if (key) keys.add(key);
    }
    await Promise.all(
      [...keys].map(async (key) => {
        const name = sourceIconName(key);
        if (map.hasImage?.(name)) {
          arrived.add(key);
          return;
        }
        try {
          const image = await loadIcon(map, iconUrl(key));
          if (!image) return;
          // checked again: two layers sharing an icon can both be loading it
          if (!map.hasImage?.(name)) map.addImage(name, image);
          arrived.add(key);
        } catch {
          /* this key's features keep the pictogram they already had */
        }
      })
    );
    return arrived;
  }

  function applyVisibility() {
    for (const layer of PAINTED) {
      if (map.getLayer(layer)) {
        map.setLayoutProperty(layer, 'visibility', shown ? 'visible' : 'none');
      }
    }
  }

  return {
    /**
     * Put a parsed collection on the map. Every feature, every time: the source
     * is the whole layer and the engine culls what is off screen.
     */
    async set(data, { categories: groups = [], hidden = [], attribution } = {}) {
      build(attribution);
      categories = groups;
      collection = data;
      const mine = ++generation;
      // Before the data, not after: a feature is only routed to the source-icon
      // layer once its image is registered, so there is no frame in which a
      // point asks for a picture the map does not have and draws nothing.
      const ready = await registerSourceIcons(data?.features ?? []);
      if (mine !== generation || !built) return;

      const colour = colourExpression(groups);
      const features = (data?.features ?? []).map((feature) => ({
        ...feature,
        properties: {
          ...feature.properties,
          // Resolved into the data rather than expressed per layer, because the
          // icon has to be chosen per feature and the colour has to fall back
          // per feature when the source painted only some of them.
          $icon: iconName(kindOf(feature.geometry)),
          ...(ready.has(feature.properties?.icon)
            ? { $own: sourceIconName(feature.properties.icon) }
            : null),
        },
      }));
      map.getSource(SOURCE)?.setData({ type: 'FeatureCollection', features });
      for (const layer of PAINTED) {
        if (layer === OWN || !map.getLayer(layer)) continue;
        const property = layer === MARK ? 'icon-color' : layer === FILL ? 'fill-color' : layer === DOT ? 'circle-color' : 'line-color';
        map.setPaintProperty(layer, property, featureColour(colour));
      }
      this.filter(hidden);
    },

    /**
     * Hide exactly the categories named, and nothing else.
     *
     * A filter rather than a second source: the features stay loaded, so the row
     * can keep saying how many there are while saying how many are drawn.
     */
    filter(hidden = []) {
      if (!built) return;
      const rule = visibilityFilter(hidden);
      const base = {
        [FILL]: ['==', ['geometry-type'], 'Polygon'],
        [LINE]: ['!=', ['geometry-type'], 'Point'],
        [DOT]: ['==', ['geometry-type'], 'Point'],
        // The two symbol layers split the points between them on the one
        // question of whether this feature's own icon is registered.
        [MARK]: ['all', ['==', ['geometry-type'], 'Point'], ['!', ['has', '$own']]],
        [OWN]: ['all', ['==', ['geometry-type'], 'Point'], ['has', '$own']],
      };
      for (const layer of PAINTED) {
        if (!map.getLayer(layer)) continue;
        map.setFilter(layer, rule ? ['all', base[layer], rule] : base[layer]);
      }
      closeCard();
    },

    /**
     * Frame one feature and open its card — what picking a search result does.
     *
     * The second way into this layer, and deliberately the same one: it ends at
     * the card a click ends at, which states what the source says and offers no
     * route out of itself. Finding a feature is not adopting it.
     *
     * False when the number names nothing here, which is what a card opened on
     * the wrong feature would otherwise be.
     */
    reveal(index) {
      const feature = featureAt(collection, index);
      const extent = feature && featureExtent(feature.geometry);
      if (!extent) return false;
      engine.fitBounds(extent, {
        padding: REVEAL_PADDING,
        maxZoom: REVEAL_ZOOM,
        animate: true,
      });
      showCard(feature, [(extent.west + extent.east) / 2, (extent.south + extent.north) / 2]);
      return true;
    },

    /** Keep the features, take them off the map (or put them back). */
    visible(on) {
      shown = on;
      if (!built) return;
      applyVisibility();
      if (!on) closeCard();
    },

    /** What the legend is painting, so a caller can read it back. */
    categories() {
      return categories;
    },

    destroy() {
      closeCard();
      collection = null;
      generation += 1;
      releaseClicks?.();
      releaseClicks = null;
      for (const [type, on, handler] of listeners) map.off(type, on, handler);
      listeners.length = 0;
      if (built) {
        for (const layer of PAINTED) {
          if (map.getLayer(layer)) map.removeLayer(layer);
        }
        if (map.getSource(SOURCE)) map.removeSource(SOURCE);
      }
      built = false;
    },
  };
}

/**
 * The source's own colour where it stated one, the category's where it did not.
 *
 * Per feature, because a My Maps often paints half a folder and leaves the rest
 * on the default — and a legend row saying one colour while half its marks draw
 * another is exactly the kind of quiet lie this feature must not tell.
 */
function featureColour(fallback) {
  return ['case', ['!=', ['get', 'colour'], ''], ['to-color', ['get', 'colour']], fallback];
}

/**
 * The feature the backend numbered `index`, or nothing.
 *
 * The number *is* the position — `_collection` writes it while it fills the
 * array — so the hit is direct. The scan behind it costs nothing on the miss
 * that cannot happen, and what it rules out is a card opened on the wrong
 * feature, which on a map somebody makes decisions from is the failure worth
 * two lines to refuse.
 */
export function featureAt(collection, index) {
  const features = collection?.features ?? [];
  const at = features[index];
  if (at?.properties?.index === index) return at;
  return features.find((feature) => feature?.properties?.index === index) ?? null;
}

/**
 * Where one feature is, as a box to frame the camera on.
 *
 * A point gives a box with no extent, which the façade answers by clamping to
 * the ceiling it was given — so a pin, a road and a district are one rule here
 * rather than three. Nothing is materialised: a traced coastline is half a
 * million points, and the four numbers are all that is wanted from them.
 */
export function featureExtent(geometry) {
  let north = -Infinity;
  let south = Infinity;
  let east = -Infinity;
  let west = Infinity;
  eachCoordinate(geometry, (lon, lat) => {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  });
  return west > east ? null : { north, south, east, west };
}

/** Mirrors the backend's `_coordinates`: every position, however nested. */
function eachCoordinate(geometry, visit) {
  if (geometry?.type === 'GeometryCollection') {
    for (const child of geometry.geometries ?? []) eachCoordinate(child, visit);
    return;
  }
  walk(geometry?.coordinates, visit);
}

function walk(node, visit) {
  if (!Array.isArray(node)) return;
  if (node.length >= 2 && typeof node[0] === 'number' && typeof node[1] === 'number') {
    visit(node[0], node[1]);
    return;
  }
  for (const child of node) walk(child, visit);
}

/** Mirrors the backend's `_kind`: three shapes, and nothing finer. */
export function kindOf(geometry) {
  const type = String(geometry?.type ?? '');
  if (type.includes('Point')) return 'point';
  if (type.includes('Line')) return 'line';
  return 'area';
}
