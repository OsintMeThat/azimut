/**
 * What a shape being drawn in a personal layer measures, said beside the pointer
 * as it is drawn: a line's length, an area's surface, a circle's radius, a box's
 * two sides. Points are `[lon, lat]`, as the sketch holds them.
 */
import { formatArea, formatDistance, haversine, pathLength, polygonArea } from '../measure.js';

const at = ([lon, lat]) => ({ lat, lon });

/** How far a circle being drawn reaches, in metres: from its centre to its ring. Null before both are down. */
export function circleRadius(sketch) {
  const edge = sketch?.shape === 'circle' && sketch.anchor ? sketch.rings?.[0]?.[0] : null;
  return edge ? haversine(at(sketch.anchor), at(edge)) : null;
}

/**
 * The size of a new shape as drawn so far, with `pointer` (`[lon, lat]`) as the
 * corner the next click would lay; '' when there is nothing to measure yet.
 * A shape being reshaped is measured in its sheet once saved.
 */
export function sketchReading(sketch, pointer = null, units = 'metric') {
  if (!sketch || sketch.key || !['LineString', 'Polygon'].includes(sketch.type)) return '';
  if (sketch.shape === 'circle') {
    const radius = circleRadius(sketch);
    return radius ? `Radius ${formatDistance(radius, units)}` : '';
  }
  if (sketch.shape === 'rect') {
    const ring = sketch.anchor ? sketch.rings?.[0] ?? [] : [];
    if (ring.length < 4) return '';
    return `${formatDistance(haversine(at(ring[0]), at(ring[1])), units)} × ${formatDistance(haversine(at(ring[1]), at(ring[2])), units)}`;
  }
  const points = [...(sketch.rings?.[0] ?? []), ...(pointer ? [pointer] : [])].map(at);
  if (sketch.type === 'Polygon' && points.length >= 3) return formatArea(polygonArea(points), units);
  return points.length >= 2 ? formatDistance(pathLength(points), units) : '';
}
