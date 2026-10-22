/**
 * The flat map's style, read for the globe.
 *
 * The globe draws what the flat map holds (mirror.js), so it reads the same
 * layers the same way: a layer's filter and its paint and layout values are
 * the engine's own expressions, evaluated here by the engine's own style
 * library for one feature at one zoom. Nothing is restyled for the globe, and
 * a layer a tool adds tomorrow is drawn on it the day it is written.
 *
 * Zooms are the engine's (512 px tiles), one shallower than the app's.
 */
import { Color, Formatted, ResolvedImage, featureFilter, latest, normalizePropertyExpression } from '@maplibre/maplibre-gl-style-spec';

/** Layers laid on the ground, in a tile's picture. */
export const DRAPED = new Set(['raster', 'line', 'fill']);
/** Layers that stand facing the eye: a mark keeps its size on screen at any distance. */
export const STANDING = new Set(['circle', 'symbol']);

/** A value the engine's library handed back, as plain data a canvas takes. */
export function plain(value) {
  if (value instanceof Color) return value.toString();
  if (value instanceof Formatted) return value.toString();
  if (value instanceof ResolvedImage) return value.name;
  if (value && typeof value === 'object' && Array.isArray(value.values)) return value.values;
  return value;
}

/** A feature as the library reads it: its geometry's type by name, its properties, its id. */
export function evaluable(type, properties, id) {
  return { type, properties: properties ?? {}, id };
}

/**
 * One layer of the style, ready to be asked about one feature.
 *
 * @param {object} spec the layer as the engine serialises it
 * @returns the layer, or null for one the globe does not draw
 */
export function compileLayer(spec) {
  if (!DRAPED.has(spec.type) && !STANDING.has(spec.type)) return null;
  const filter = featureFilter(spec.filter, `layers.${spec.id}.filter`).filter;
  const made = new Map();

  function property(group, name) {
    const key = `${group}.${name}`;
    if (made.has(key)) return made.get(key);
    const specification = latest[`${group}_${spec.type}`]?.[name];
    const value = spec[group]?.[name] ?? specification?.default;
    let expression = null;
    if (specification && value !== undefined) {
      try {
        expression = normalizePropertyExpression(value, name, specification);
      } catch {
        // a value the library refuses is drawn as if unset, never thrown at the frame
        expression = null;
      }
    }
    made.set(key, expression);
    return expression;
  }

  const read = (group) => (name, zoom, feature) => {
    const expression = property(group, name);
    if (!expression) return undefined;
    try {
      return plain(expression.evaluate({ zoom }, feature, feature?.state ?? {}));
    } catch {
      return undefined;
    }
  };

  return {
    id: spec.id,
    type: spec.type,
    source: spec.source,
    sourceLayer: spec['source-layer'] ?? null,
    visible: (spec.layout?.visibility ?? 'visible') !== 'none',
    /** Whether the layer is drawn at this zoom: from its least zoom up to, not at, its greatest. */
    inRange: (zoom) => zoom >= (spec.minzoom ?? 0) && zoom < (spec.maxzoom ?? 24),
    accepts(zoom, feature) {
      try {
        return filter({ zoom }, feature);
      } catch {
        return false;
      }
    },
    paint: read('paint'),
    layout: read('layout'),
  };
}

/** A colour string with its opacity multiplied in, for a canvas that paints one colour per call. */
export function withOpacity(colour, opacity = 1) {
  if (opacity >= 1 || !colour) return colour;
  const parsed = Color.parse(colour);
  if (!parsed) return colour;
  const a = parsed.a * Math.max(0, opacity);
  // Color holds its channels premultiplied
  const un = (c) => Math.round(parsed.a > 0 ? (c / parsed.a) * 255 : 0);
  return `rgba(${un(parsed.r)},${un(parsed.g)},${un(parsed.b)},${a})`;
}
