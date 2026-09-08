/**
 * A layer to draw on, declared rather than built.
 *
 * A caller says *what is on the map* — lines, rectangles, dots, marks — as
 * plain data, and the surface renders it. That is the whole point: the engine
 * we are leaving has polyline and rectangle objects, and the one we are moving
 * to (SPEC v3) has GeoJSON sources with style layers and DOM markers. An API
 * shaped like either engine's primitives would have to be written twice, so
 * this one is shaped like the question instead.
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
 * One surface is one layer: `visible(false)` keeps the shapes and takes the
 * layer off the map, which is what an eye toggle means.
 */
import L from 'leaflet';

/**
 * Neutral style → the engine's own.
 *
 * Only what the caller stated is passed on: an engine merges these over its own
 * defaults, so handing it `opacity: undefined` is not "leave it alone", it is
 * "paint with undefined".
 */
function pathStyle(style = {}) {
  const out = { fill: style.fill != null, interactive: style.interactive ?? true };
  const named = {
    color: style.stroke,
    weight: style.strokeWidth,
    opacity: style.strokeOpacity,
    dashArray: style.dash,
    radius: style.radius,
    fillColor: style.fill,
    fillOpacity: style.fill != null ? (style.fillOpacity ?? 0.2) : undefined,
  };
  for (const [key, value] of Object.entries(named)) {
    if (value !== undefined) out[key] = value;
  }
  // a dash that was set and then cleared has to be cleared on the engine too
  if (style.dash === null) out.dashArray = null;
  return out;
}

function latLngs(points) {
  return points.map((point) => [point.lat, point.lon]);
}

function corners({ north, south, east, west }) {
  return [
    [south, west],
    [north, east],
  ];
}

function bindTip(layer, tip) {
  if (!tip) return layer;
  const { text, sticky = false, direction, offset } = typeof tip === 'string' ? { text: tip } : tip;
  const options = { sticky };
  if (direction) options.direction = direction;
  if (offset) options.offset = offset;
  return layer.bindTooltip(text, options);
}

/**
 * Wire the handlers a shape declared.
 *
 * A click on a shape is not also a click on the map underneath: a cell of a
 * search grid cycles its own status, and the map's click handler — which drops
 * a polygon vertex or plants the sky anchor — must not fire behind it.
 */
function bindHandlers(layer, shape) {
  const stop = (handler) => (event) => {
    L.DomEvent.stop(event);
    handler(shape.id);
  };
  if (shape.onClick) layer.on('click', stop(shape.onClick));
  if (shape.onContextMenu) layer.on('contextmenu', stop(shape.onContextMenu));
  if (shape.onOver) layer.on('mouseover', () => shape.onOver(shape.id));
  if (shape.onOut) layer.on('mouseout', () => shape.onOut(shape.id));
  return layer;
}

function markIcon(shape) {
  return L.divIcon({
    className: shape.className ?? '',
    html: shape.html ?? '',
    iconSize: shape.size,
    iconAnchor: shape.anchor,
  });
}

/**
 * @param {object} engine the façade from `engine.js`
 * @param {object} [opts]
 * @param {'svg'|'canvas'} [opts.renderer] canvas for a lattice of hundreds of
 *   shapes, where one SVG node per cell is what makes a pan stutter
 * @param {(id: any) => void} [opts.onPopupOpen] a card was opened on a mark
 * @param {(id: any) => void} [opts.onPopupClose] …and closed again
 */
export function createSurface(
  engine,
  { renderer = 'svg', onPopupOpen, onPopupClose } = {}
) {
  let group = null;
  let drawn = new Map(); // shape id → the engine object rendering it
  let shown = true;
  let openOn = null; // the mark whose card is up, so it can be closed by name
  const shared = renderer === 'canvas' ? L.canvas({ padding: 0.5 }) : null;

  function held() {
    if (!group) group = L.layerGroup();
    if (shown && !engine.leaflet.hasLayer(group)) group.addTo(engine.leaflet);
    return group;
  }

  function build(shape) {
    const style = pathStyle(shape.style);
    if (shared && shape.kind !== 'marker') style.renderer = shared;
    switch (shape.kind) {
      case 'line':
        return bindTip(L.polyline(latLngs(shape.points), style), shape.tip);
      case 'polygon':
        return bindTip(L.polygon(latLngs(shape.points), style), shape.tip);
      case 'rect':
        // a rectangle is its own kind rather than four corners of a polygon:
        // the engine can move one without rebuilding it, and a grid does
        return bindTip(L.rectangle(corners(shape.bounds), style), shape.tip);
      case 'dot':
        // a fixed pixel radius, so it stays readable at every zoom
        return bindTip(L.circleMarker([shape.at.lat, shape.at.lon], style), shape.tip);
      case 'circle':
        // a radius in metres, so it is a claim about the ground
        return bindTip(
          L.circle([shape.at.lat, shape.at.lon], { ...style, radius: shape.radiusM }),
          shape.tip
        );
      case 'geojson':
        return L.geoJSON(shape.geometry, { style: () => style });
      case 'marker': {
        const marker = L.marker([shape.at.lat, shape.at.lon], {
          icon: markIcon(shape),
          draggable: !!shape.draggable,
          keyboard: shape.keyboard ?? true,
          title: shape.title,
          zIndexOffset: shape.zIndex ?? 0,
        });
        if (shape.popup) {
          // The content is built when the card opens, not when the mark is
          // drawn: a layer of two hundred marks must not mount two hundred
          // cards nobody asked for.
          marker.bindPopup(() => shape.popup.content(), {
            className: shape.popup.className,
            minWidth: shape.popup.minWidth,
            maxWidth: shape.popup.maxWidth,
            autoPanPadding: shape.popup.padding ?? [24, 24],
          });
          marker.on('popupopen', () => {
            openOn = marker;
            onPopupOpen?.(shape.id);
          });
          marker.on('popupclose', () => {
            if (openOn === marker) openOn = null;
            onPopupClose?.(shape.id);
          });
        }
        if (shape.onDragStart) marker.on('dragstart', () => shape.onDragStart(shape.id));
        if (shape.onDrag) {
          marker.on('drag move', () => {
            const at = marker.getLatLng();
            shape.onDrag({ lat: at.lat, lon: at.lng }, shape.id);
          });
        }
        if (shape.onDragEnd) marker.on('dragend', () => shape.onDragEnd(shape.id));
        return bindTip(marker, shape.tip);
      }
      default:
        throw new Error(`unknown shape: ${shape.kind}`);
    }
  }

  return {
    /** Replace everything on this layer. */
    set(shapes) {
      const layer = held();
      layer.clearLayers();
      drawn = new Map();
      for (const shape of shapes ?? []) {
        if (!shape) continue;
        const rendered = bindHandlers(build(shape), shape);
        // bubblingMouseEvents defaults on: a shape that answers a click must
        // not let the same click through to the map
        if (shape.onClick || shape.onContextMenu) rendered.options.bubblingMouseEvents = false;
        rendered.addTo(layer);
        if (shape.id != null) drawn.set(shape.id, rendered);
      }
    },

    /**
     * Change one shape without touching the others: a new style, a new outline
     * while a handle is dragged, a mark's own glyph. `icon` takes the same
     * `html`/`className`/`size`/`anchor` a mark was declared with.
     */
    patch(id, patch) {
      const rendered = drawn.get(id);
      if (!rendered) return false;
      if (patch.style) rendered.setStyle(pathStyle(patch.style));
      if (patch.icon) rendered.setIcon(markIcon(patch.icon));
      if (patch.points) rendered.setLatLngs(latLngs(patch.points));
      if (patch.bounds) rendered.setBounds(corners(patch.bounds));
      if (patch.at) rendered.setLatLng([patch.at.lat, patch.at.lon]);
      return true;
    },

    /** Is this shape on the layer? */
    has(id) {
      return drawn.has(id);
    },

    /**
     * A mark's own element, for a class the CSS paints — the hover that ties a
     * row in the panel to its pin on the map. Undefined while the layer is off
     * the map, since there is then nothing drawn to light up.
     */
    element(id) {
      return drawn.get(id)?.getElement?.();
    },

    /** Close the open card, wherever it is. */
    closePopup() {
      openOn?.closePopup();
    },

    clear() {
      group?.clearLayers();
      drawn = new Map();
      openOn = null;
    },

    /** Keep the shapes, take the layer off the map (or put it back). */
    visible(on) {
      shown = on;
      if (!group) return;
      if (on) held();
      else engine.leaflet.removeLayer(group);
    },

    destroy() {
      group?.remove();
      group = null;
      drawn = new Map();
    },
  };
}
