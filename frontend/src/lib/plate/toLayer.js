/**
 * What was drawn by hand on a plate's map, made into one of the case's layers, so a
 * map begun in one go can become something that lasts: shown on the Map, kept in
 * other plates, followed over time.
 *
 * Each annotation becomes a feature of a personal layer as the import reads one
 * (`engine/maplayers._personal_style`): a zone and a ring or a cone as an area, a line,
 * an arrow and a distance as a line, a symbol and a label as a point named by its
 * words, each in its colour, its group the kind it was, its first and last day kept.
 */
import { ON_THE_GROUND } from './page.js';
import { circle, sector } from './geo.js';

/** What each kind becomes in the layer: its group's name. */
const GROUPS = { zone: 'Zones', line: 'Lines', arrow: 'Arrows', measure: 'Distances', ring: 'Rings', cone: 'Views', symbol: 'Symbols', label: 'Labels' };
const MOMENT = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;
const close = (ring) => (ring.length && (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) ? [...ring, ring[0]] : ring);
const round = (point) => point.map((value) => Math.round(value * 1e6) / 1e6);

/** The annotations standing on map `mapId` that can become features: everything on its ground but a feature's own label and a country focus. */
export function drawnOn(spec, mapId) {
  return spec.elements.filter((element) => ON_THE_GROUND.includes(element.kind) && element.kind !== 'focus' && element.of === mapId && !element.ref);
}

/** The geometries one annotation becomes. */
function geometries(element) {
  switch (element.kind) {
    case 'zone': return element.points?.length >= 3 ? [{ type: 'Polygon', coordinates: [close(element.points.map(round))] }] : [];
    case 'line': return element.points?.length >= 2 ? [{ type: 'LineString', coordinates: element.points.map(round) }] : [];
    case 'arrow':
    case 'measure': return element.at && element.to ? [{ type: 'LineString', coordinates: [round(element.at), round(element.to)] }] : [];
    case 'ring': return element.at ? (element.radii ?? []).map((km) => ({ type: 'Polygon', coordinates: [close(circle(element.at, km * 1000).map(round))] })) : [];
    case 'cone': return element.at ? [{ type: 'Polygon', coordinates: [close(sector(element.at, element.bearing ?? 0, element.spread ?? 60, (element.reach ?? 1) * 1000).map(round))] }] : [];
    case 'symbol':
    case 'label': return element.at ? [{ type: 'Point', coordinates: round(element.at) }] : [];
    default: return [];
  }
}

/**
 * The annotations of map `mapId` as a personal layer's GeoJSON, in `theme`'s accent
 * where they hold no colour of their own: `{ geojson, used }`, `used` the ids of the
 * annotations it holds.
 */
export function annotationsLayer(spec, mapId, title = 'Drawn on the plate') {
  const features = [];
  const used = [];
  for (const element of drawnOn(spec, mapId)) {
    const shapes = geometries(element);
    if (!shapes.length) continue;
    used.push(element.id);
    const words = String(element.text ?? '').trim();
    for (const geometry of shapes) {
      features.push({ type: 'Feature', geometry, properties: {
        name: words || element.name || '',
        category: GROUPS[element.kind],
        colour: element.colour || spec.theme?.accent || '#c8102e',
        ...(element.kind === 'symbol' ? { symbol: element.symbol ?? 'pin', status: element.status ?? '' } : {}),
        ...(['zone', 'line', 'arrow', 'measure', 'ring', 'cone'].includes(element.kind) ? { stroke_width: Math.min(12, Math.max(0.5, (element.width ?? 1) * 2)) } : {}),
        ...(MOMENT.test(element.onward ?? '') ? { date: element.onward } : {}),
        ...(MOMENT.test(element.until ?? '') ? { date_end: element.until } : {}),
      } });
    }
  }
  return { geojson: { type: 'FeatureCollection', name: title, azimut_personal_layer: 1, features }, used };
}
