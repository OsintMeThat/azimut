/**
 * A layer to draw on, declared rather than built.
 *
 * A caller says *what is on the map* — lines, rectangles, dots, marks — as
 * plain data, and the surface renders it. That is the whole point: the engine
 * this app started on had polyline and rectangle objects, MapLibre has GeoJSON
 * sources with style layers and DOM markers, and an API shaped like either
 * one's primitives would have to be written twice. This one is shaped like the
 * question instead.
 *
 * What that costs, and why it is still worth it:
 *
 * - **Shapes carry an id**, because a sweep restyles one cell of a thousand on
 *   every keypress and rebuilding the lattice each time is not an option.
 * - **Styles use their own words** (`stroke`, `fill`, `dash`), translated here.
 *   The values are the expensive part — a lattice that reads over dark imagery,
 *   a flag colour that works for a colour-blind analyst — and they must not be
 *   re-picked when the engine changes.
 * - **A mark is HTML at a position**, which both engines can do and neither
 *   does the same way.
 *
 * How it is put together, because MapLibre's shape is not the API's:
 *
 * - **One source per surface, three layers over it.** MapLibre paints a whole
 *   layer in one pass, so a thousand grid cells cost one draw rather than a
 *   thousand nodes — the reason the old engine needed a canvas renderer here is
 *   gone with it.
 * - **Style lives in feature properties**, read by data-driven paint
 *   expressions. That is what lets one layer paint shapes that do not look
 *   alike, and what lets `patch` change one of them without touching the rest.
 * - **A dash is the exception**: MapLibre scales a dash pattern by the line
 *   width, so a pattern cannot be read off a feature. Each distinct pattern
 *   gets its own thin layer instead, made the first time it appears.
 * - **A circle in metres is a traced ring**, not a scaled dot: it is a claim
 *   about the ground, and a pixel radius interpolated over zoom stops being
 *   true away from the equator.
 *
 * One surface is one set of layers: `visible(false)` keeps the shapes and hides
 * them, which is what an eye toggle means.
 */
import { Marker, Popup } from 'maplibre-gl';
import { destination } from '../measure.js';

/** Points around a traced ring. Enough that a circle reads as one at any zoom. */
const RING_STEPS = 64;

/** What the old engine painted an unstyled shape with, kept so nothing moved. */
const DEFAULTS = { stroke: '#3388ff', strokeWidth: 3, strokeOpacity: 1, radius: 10 };

let surfaces = 0; // one id prefix per surface, so two of them never collide

/**
 * Neutral style → the properties the paint expressions read.
 *
 * Every value the layers ask for is resolved here rather than defaulted in an
 * expression: `['get', 'strokeOpacity']` on a shape that never mentioned it
 * reads as 0, which paints nothing at all.
 */
export function styleProperties(style = {}) {
  const properties = {
    stroke: style.stroke ?? DEFAULTS.stroke,
    strokeWidth: style.strokeWidth ?? DEFAULTS.strokeWidth,
    strokeOpacity: style.strokeOpacity ?? DEFAULTS.strokeOpacity,
    radius: style.radius ?? DEFAULTS.radius,
    interactive: style.interactive ?? true,
  };
  // An unfilled shape is one the fill layer must not claim, so the key is
  // absent rather than transparent — the layer filters on having it at all.
  if (style.fill != null) {
    properties.fill = style.fill;
    properties.fillOpacity = style.fillOpacity ?? 0.2;
  }
  if (style.dash) properties.dashKey = dashKey(style.dash, properties.strokeWidth);
  return properties;
}

/**
 * The layer a dash belongs to.
 *
 * MapLibre counts a dash in line widths, not pixels, so the same pattern on two
 * different strokes is two different patterns. Callers write pixels, as the old
 * engine took them, and the width is folded in here.
 */
export function dashKey(dash, strokeWidth) {
  return `${String(dash).trim().split(/[\s,]+/).join('-')}@${strokeWidth}`;
}

/** …and the pattern that key stands for, in the units MapLibre wants. */
export function dashArray(key) {
  const [pattern, width] = key.split('@');
  return pattern.split('-').map((length) => Number(length) / Number(width));
}

/** A ring on the ground, `metres` from `at` all the way round. */
export function metreRing(at, metres) {
  const ring = [];
  for (let step = 0; step <= RING_STEPS; step += 1) {
    const point = destination(at, (360 * step) / RING_STEPS, metres);
    ring.push([point.lon, point.lat]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}

function line(points) {
  return { type: 'LineString', coordinates: points.map((point) => [point.lon, point.lat]) };
}

function ring(points) {
  const coordinates = points.map((point) => [point.lon, point.lat]);
  const [first] = coordinates;
  const last = coordinates.at(-1);
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) coordinates.push(first);
  return { type: 'Polygon', coordinates: [coordinates] };
}

function box({ north, south, east, west }) {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
}

/** The geometry one declared shape draws as, or null if it draws no geometry. */
export function shapeGeometry(shape) {
  switch (shape.kind) {
    case 'line':
      return line(shape.points);
    case 'polygon':
      return ring(shape.points);
    case 'rect':
      return box(shape.bounds);
    case 'dot':
      return { type: 'Point', coordinates: [shape.at.lon, shape.at.lat] };
    case 'circle':
      return metreRing(shape.at, shape.radiusM);
    case 'geojson':
      return shape.geometry;
    default:
      throw new Error(`unknown shape: ${shape.kind}`);
  }
}

/**
 * @param {object} engine the façade from `engine.js`
 * @param {object} [opts]
 * @param {(id: any) => void} [opts.onPopupOpen] a card was opened on a mark
 * @param {(id: any) => void} [opts.onPopupClose] …and closed again
 */
export function createSurface(engine, { onPopupOpen, onPopupClose } = {}) {
  const map = engine.impl;
  const prefix = `sfc-${++surfaces}`;
  const SOURCE = `${prefix}-shapes`;
  const FILL = `${prefix}-fill`;
  const LINE = `${prefix}-line`;
  const DOT = `${prefix}-dot`;

  let features = []; // the collection currently in the source
  let byShape = new Map(); // shape id → feature id
  let shapes = new Map(); // shape id → the shape as declared, for its handlers
  let marks = new Map(); // shape id → { marker, shape }
  let dashLayers = new Map(); // dash key → layer id
  let nextFeature = 1;
  let shown = true;
  let built = false;
  let openOn = null; // the mark whose card is up, so it can be closed by name
  let card = null; // the open card itself
  let tip = null; // the shared hover reading
  let tipAnchor; // the side it hangs on, which is the one thing it is rebuilt for
  let pointing = false; // this surface is the one holding the pointer cursor
  let releaseClicks = null;
  let answering = false; // something on this surface answers a click
  const listeners = []; // [type, layerId, handler] to unbind on destroy

  function paintLayers() {
    return [FILL, ...dashLayers.values(), LINE, DOT];
  }

  /**
   * Drawn shapes sit above the basemap and its labels, which is simply where
   * they land: `basemap.js` inserts below the first layer it does not own, and
   * these are appended.
   */
  function build() {
    if (built) return;
    built = true;
    map.addSource(SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addLayer({
      id: FILL,
      type: 'fill',
      source: SOURCE,
      filter: ['has', 'fill'],
      paint: {
        'fill-color': ['to-color', ['get', 'fill']],
        'fill-opacity': ['to-number', ['get', 'fillOpacity']],
      },
    });
    map.addLayer({
      id: LINE,
      type: 'line',
      source: SOURCE,
      // a dashed stroke is painted by its own layer, below
      filter: ['all', ['has', 'stroke'], ['!', ['has', 'dashKey']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: lineStroke(),
    });
    map.addLayer({
      id: DOT,
      type: 'circle',
      source: SOURCE,
      // Only a dot, and a dot is the one thing drawn as a bare point. Without
      // the guard this layer would put a circle on *every vertex* of every line
      // and polygon in the surface, which is what a circle layer does.
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': ['to-number', ['get', 'radius']],
        // a dot with no fill of its own is filled with its own stroke colour,
        // as the engine we came from filled it — and `fillOpacity` is then 0,
        // so it stays an outline
        'circle-color': ['to-color', ['coalesce', ['get', 'fill'], ['get', 'stroke']]],
        'circle-opacity': ['to-number', ['get', 'fillOpacity']],
        'circle-stroke-color': ['to-color', ['get', 'stroke']],
        'circle-stroke-width': ['to-number', ['get', 'strokeWidth']],
        'circle-stroke-opacity': ['to-number', ['get', 'strokeOpacity']],
      },
    });
    if (!shown) applyVisibility();
  }

  function lineStroke() {
    return {
      'line-color': ['to-color', ['get', 'stroke']],
      'line-width': ['to-number', ['get', 'strokeWidth']],
      'line-opacity': ['to-number', ['get', 'strokeOpacity']],
    };
  }

  function dashLayer(key) {
    const existing = dashLayers.get(key);
    if (existing) return existing;
    const id = `${prefix}-dash-${dashLayers.size}`;
    dashLayers.set(key, id);
    map.addLayer(
      {
        id,
        type: 'line',
        source: SOURCE,
        filter: ['==', ['get', 'dashKey'], key],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { ...lineStroke(), 'line-dasharray': dashArray(key) },
      },
      // under the solid strokes, as the old engine drew them: a dashed hint
      // never covers a line that means something
      map.getLayer(LINE) ? LINE : undefined
    );
    if (!shown) map.setLayoutProperty(id, 'visibility', 'none');
    return id;
  }

  function source() {
    return map.getSource(SOURCE);
  }

  function push() {
    source()?.setData({ type: 'FeatureCollection', features });
  }

  // --- marks -----------------------------------------------------------------

  /**
   * Where the element's centre goes, so that the point the caller named sits on
   * the coordinate. Callers give a size and the pixel inside it that is "the
   * spot" (a pin's tip, a glyph's middle), which is how the old engine took it.
   */
  function markOffset(shape) {
    const [width, height] = shape.size ?? [0, 0];
    const [x, y] = shape.anchor ?? [width / 2, height / 2];
    return [width / 2 - x, height / 2 - y];
  }

  /**
   * The caller's glyph on a mark's element, swappable.
   *
   * Only the classes the caller named are exchanged: the engine puts its own on
   * this element — the ones that position it at all — and replacing the whole
   * `className` on a restyle would drop the mark to the corner of the map.
   */
  function dressMark(element, shape) {
    const previous = element.dataset.markClass;
    if (previous) element.classList.remove(...previous.split(' '));
    const named = (shape.className ?? '').trim();
    if (named) element.classList.add(...named.split(/\s+/));
    element.dataset.markClass = named;
    element.innerHTML = shape.html ?? '';
    element.style.width = shape.size ? `${shape.size[0]}px` : '';
    element.style.height = shape.size ? `${shape.size[1]}px` : '';
    return element;
  }

  function buildMark(shape) {
    const element = dressMark(document.createElement('div'), shape);
    if (shape.title) element.title = shape.title;
    if (shape.zIndex) element.style.zIndex = String(shape.zIndex);
    // The engine leaves a custom element's focusability to us. A mark that
    // opens a card is a control and takes the keyboard; a drag handle or a
    // hundred pins in a stack are not, and would only lengthen the tab order.
    if (shape.keyboard !== false && (shape.popup || shape.onClick)) {
      element.tabIndex = 0;
      element.setAttribute('role', 'button');
    }
    const marker = new Marker({
      element,
      anchor: 'center',
      offset: markOffset(shape),
      draggable: !!shape.draggable,
    })
      .setLngLat([shape.at.lon, shape.at.lat])
      .addTo(map);

    if (shape.popup || shape.onClick) {
      // The mark answers its own click; the map's handler — which drops a
      // polygon vertex or plants the sky anchor — must not fire behind it.
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        shape.onClick?.(shape.id);
        // the same mark pressed again puts its card away, which is what a card
        // on a mark does everywhere — and the stopped click cannot do it
        if (!shape.popup) return;
        if (openOn === shape.id) closeCard();
        else openCard(shape, marker);
      });
      element.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        element.click();
      });
    }
    if (shape.onContextMenu) {
      element.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        shape.onContextMenu(shape.id);
      });
    }
    if (shape.onOver) element.addEventListener('mouseenter', () => shape.onOver(shape.id));
    if (shape.onOut) element.addEventListener('mouseleave', () => shape.onOut(shape.id));
    if (shape.tip) {
      element.addEventListener('mouseenter', () => showTip(shape.tip, shape.at));
      element.addEventListener('mouseleave', hideTip);
    }
    if (shape.onDragStart) marker.on('dragstart', () => shape.onDragStart(shape.id));
    if (shape.onDrag) {
      marker.on('drag', () => {
        const at = marker.getLngLat();
        shape.onDrag({ lat: at.lat, lon: at.lng }, shape.id);
      });
    }
    if (shape.onDragEnd) marker.on('dragend', () => shape.onDragEnd(shape.id));
    if (!shown) element.style.display = 'none';
    return marker;
  }

  // --- the card a mark opens -------------------------------------------------

  /**
   * The content is built when the card opens, not when the mark is drawn: a
   * layer of two hundred marks must not mount two hundred cards nobody asked
   * for. The engine's own marker-popup binding would build it up front, so the
   * card is opened here instead.
   */
  function openCard(shape, marker) {
    closeCard();
    const popup = new Popup({
      className: shape.popup.className,
      maxWidth: shape.popup.maxWidth == null ? 'none' : `${shape.popup.maxWidth}px`,
      closeOnClick: true,
      focusAfterOpen: false,
    });
    popup.setLngLat(marker.getLngLat());
    popup.setDOMContent(shape.popup.content());
    popup.on('close', () => {
      if (card !== popup) return;
      card = null;
      openOn = null;
      onPopupClose?.(shape.id);
    });
    popup.addTo(map);
    if (shape.popup.minWidth != null) {
      popup.getElement()?.style.setProperty('--popup-min-width', `${shape.popup.minWidth}px`);
    }
    card = popup;
    openOn = shape.id;
    onPopupOpen?.(shape.id);
  }

  function closeCard() {
    card?.remove();
    card = null;
    openOn = null;
  }

  // --- the reading a shape gives under the cursor ----------------------------

  /**
   * One reading is up at a time, and it is rebuilt only when the side it hangs
   * on changes: a path's reading follows the cursor, so this runs on every
   * mousemove over it.
   */
  function showTip(declared, at, lngLat) {
    const { text, sticky = false, direction, offset } = typeof declared === 'string'
      ? { text: declared }
      : declared;
    // 'top' is where the reading goes; a card's anchor names the side of it
    // nearest the point, so the two are opposites
    const anchor = direction === 'top' ? 'bottom' : undefined;
    if (!tip || tipAnchor !== anchor) {
      tip?.remove();
      tipAnchor = anchor;
      tip = new Popup({
        anchor,
        className: 'map-tip',
        closeButton: false,
        closeOnClick: false,
        focusAfterOpen: false,
        maxWidth: 'none',
      });
    }
    tip.setText(text);
    tip.setOffset(offset ?? 0);
    if (sticky) tip.trackPointer();
    else tip.setLngLat(lngLat ?? [at.lon, at.lat]);
    if (!tip.isOpen()) tip.addTo(map);
  }

  function hideTip() {
    tip?.remove();
  }

  // --- what a painted shape answers -----------------------------------------

  function shapeOf(feature) {
    return shapes.get(feature?.properties?.sid);
  }

  function usable(feature) {
    return feature?.properties?.interactive !== false;
  }

  /**
   * One handler across all of this surface's layers, not one per layer.
   *
   * A shape is in as many layers as it has paint — an outlined, filled cell is
   * in two — and a listener per layer would answer the same click twice, which
   * on a search grid means cycling a cell straight past the mark that was
   * meant. Rebound after every `set`, because a new dash pattern is a new layer
   * and a reading on a dashed ray still has to be heard.
   */
  function rebindHandlers() {
    for (const [type, layers, handler] of listeners) map.off(type, layers, handler);
    listeners.length = 0;
    const layers = paintLayers().filter((id) => map.getLayer(id));
    if (!layers.length) return;
    const bind = (type, handler) => {
      map.on(type, layers, handler);
      listeners.push([type, layers, handler]);
    };
    const hit = (event) => shapeOf(event.features?.find(usable));
    bind('click', (event) => {
      const shape = hit(event);
      if (shape?.onClick) shape.onClick(shape.id);
    });
    bind('contextmenu', (event) => {
      const shape = hit(event);
      if (shape?.onContextMenu) shape.onContextMenu(shape.id);
    });
    bind('mousemove', (event) => {
      const shape = hit(event);
      if (shape?.tip) showTip(shape.tip, null, event.lngLat);
      // a shape that answers a click says so, as the old engine's paths did
      if (shape?.onClick && !pointing) {
        pointing = true;
        map.getCanvas().style.cursor = 'pointer';
      }
    });
    bind('mouseleave', () => {
      hideTip();
      // only what this surface set, so leaving one shape does not clear the
      // cursor another surface is holding
      if (pointing) {
        pointing = false;
        map.getCanvas().style.cursor = '';
      }
    });
  }

  function applyVisibility() {
    for (const layer of paintLayers()) {
      if (map.getLayer(layer)) {
        map.setLayoutProperty(layer, 'visibility', shown ? 'visible' : 'none');
      }
    }
    for (const { marker } of marks.values()) {
      marker.getElement().style.display = shown ? '' : 'none';
    }
  }

  function dropMarks() {
    for (const { marker } of marks.values()) marker.remove();
    marks = new Map();
  }

  /**
   * Only a surface whose shapes answer clicks holds the map's own handler back,
   * and only over the shapes that actually answer. Re-made whenever the layer
   * list changes, since the claim is a list of names.
   */
  function refreshClaim() {
    releaseClicks?.();
    releaseClicks = answering
      ? engine.claimClicks(paintLayers(), ['!=', ['get', 'interactive'], false])
      : null;
  }

  return {
    /** Replace everything on this layer. */
    set(declared) {
      build();
      dropMarks();
      closeCard();
      hideTip();
      features = [];
      byShape = new Map();
      shapes = new Map();
      answering = false;
      let anonymous = 0;
      for (const shape of declared ?? []) {
        if (!shape) continue;
        // a shape with no id of its own still needs one: the source is keyed by
        // feature id, and `patch` is the only thing that ever asks for a name
        const id = shape.id ?? `anon-${anonymous++}`;
        shapes.set(id, shape);
        answering ||= !!(shape.onClick || shape.onContextMenu);
        if (shape.kind === 'marker') {
          marks.set(id, { marker: buildMark({ ...shape, id }), shape });
          continue;
        }
        const feature = nextFeature++;
        const properties = styleProperties(shape.style);
        // a pattern needs the layer that paints it before the feature asking
        // for it lands, or the shape is in no line layer at all and vanishes
        if (properties.dashKey) dashLayer(properties.dashKey);
        byShape.set(id, feature);
        features.push({
          type: 'Feature',
          id: feature,
          geometry: shapeGeometry(shape),
          properties: { ...properties, sid: id },
        });
      }
      push();
      rebindHandlers();
      refreshClaim();
    },

    /**
     * Change one shape without touching the others: a new style, a new outline
     * while a handle is dragged, a mark's own glyph. `icon` takes the same
     * `html`/`className`/`size`/`anchor` a mark was declared with.
     */
    patch(id, patch) {
      const mark = marks.get(id);
      if (mark) {
        if (patch.icon) {
          dressMark(mark.marker.getElement(), patch.icon);
          mark.marker.setOffset(markOffset(patch.icon));
        }
        if (patch.at) mark.marker.setLngLat([patch.at.lon, patch.at.lat]);
        return true;
      }
      const feature = byShape.get(id);
      if (feature == null) return false;
      const shape = shapes.get(id);
      const diff = { id: feature };
      if (patch.style) {
        const properties = styleProperties(patch.style);
        // a fill or a dash that was set and is now gone has to leave the
        // feature, or its layer keeps painting the shape
        diff.removeProperties = ['fill', 'fillOpacity', 'dashKey'].filter(
          (key) => !(key in properties)
        );
        diff.addOrUpdateProperties = Object.entries(properties).map(([key, value]) => ({
          key,
          value,
        }));
        if (properties.dashKey) {
          const before = dashLayers.size;
          dashLayer(properties.dashKey);
          // a pattern seen for the first time is a new layer, and both the
          // handlers and the click claim are lists of layer names
          if (dashLayers.size !== before) {
            rebindHandlers();
            refreshClaim();
          }
        }
      }
      const moved = patch.points
        ? { ...shape, points: patch.points }
        : patch.bounds
          ? { ...shape, bounds: patch.bounds }
          : patch.at
            ? { ...shape, at: patch.at }
            : null;
      if (moved) diff.newGeometry = shapeGeometry(moved);
      source()?.updateData({ update: [diff] });
      // keep the declared shape current, so a later move starts from this one
      if (moved) shapes.set(id, moved);
      return true;
    },

    /** Is this shape on the layer? */
    has(id) {
      return byShape.has(id) || marks.has(id);
    },

    /**
     * A mark's own element, for a class the CSS paints — the hover that ties a
     * row in the panel to its pin on the map. Undefined for a painted shape,
     * which has no element of its own to light up.
     */
    element(id) {
      return marks.get(id)?.marker.getElement();
    },

    /** Close the open card, wherever it is. */
    closePopup() {
      if (openOn != null) closeCard();
    },

    clear() {
      dropMarks();
      closeCard();
      hideTip();
      features = [];
      byShape = new Map();
      shapes = new Map();
      answering = false;
      push();
      refreshClaim();
    },

    /** Keep the shapes, take them off the map (or put them back). */
    visible(on) {
      shown = on;
      if (!built) return;
      applyVisibility();
      if (!on) {
        closeCard();
        hideTip();
      }
    },

    destroy() {
      dropMarks();
      closeCard();
      tip?.remove();
      tip = null;
      answering = false;
      refreshClaim();
      for (const [type, layers, handler] of listeners) map.off(type, layers, handler);
      listeners.length = 0;
      // Each of these is asked for before it is taken away, because the map
      // itself may already be gone: a tool tearing down destroys its own
      // surfaces before its map, but an overlay component's cleanup runs when
      // Svelte unmounts it, which is not ordered against either.
      if (built) {
        for (const layer of paintLayers()) {
          if (map.getLayer(layer)) map.removeLayer(layer);
        }
        if (map.getSource(SOURCE)) map.removeSource(SOURCE);
      }
      dashLayers = new Map();
      byShape = new Map();
      shapes = new Map();
      features = [];
      built = false;
    },
  };
}
