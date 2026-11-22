/**
 * A line's or an area's name put where it reads best by hand.
 *
 * The map finds a place for a shape's name on its own. The analyst can drag the
 * name elsewhere in the layer editor, and the feature keeps that point as
 * `label_at: [lon, lat]` (`layerediting.STYLE_FIELDS`), one place for every day of
 * a layer followed over time. Every map that draws the layer writes the name
 * there: the Map, a plate, the globe, and a notebook's map (`notes_maps.label_anchor`).
 * A point's name sits under its marker, so a point never has one.
 *
 * A placed name is drawn as a point of its own in the layer's source (`namePoints`),
 * marked `$label`, which only the names' GL layer reads; the feature it names is
 * marked `$placed` so that layer leaves its own place alone. Never `$name`: the
 * engine's worker reads that key as the class of what it is handed, and refuses
 * the whole source.
 */

/** Where a feature's name was put by hand, `[lon, lat]`, or null: two numbers on the map. */
export function namePlace(properties) {
  const at = properties?.label_at;
  if (!Array.isArray(at) || at.length !== 2) return null;
  const [lon, lat] = at;
  if (typeof lon !== 'number' || typeof lat !== 'number' || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return Math.abs(lon) <= 180 && Math.abs(lat) <= 90 ? [lon, lat] : null;
}

/** Whether a feature is a line or an area, the only shapes whose name can be put by hand. */
export const nameMoves = (feature) => {
  const type = String(feature?.geometry?.type ?? '');
  return !!type && !type.includes('Point') && type !== 'GeometryCollection';
};

/** Whether the map writes a feature's name, as `layerediting.drawing` decides it from its group. */
export function nameShown(properties, group) {
  if (!String(properties?.name ?? '').trim()) return false;
  return properties.label === 'on' || (!!group?.labels && properties.label !== 'off');
}

/** Where a drawn feature's name goes: its place put by hand, or null where the map finds it one. */
export function placedName(feature) {
  const properties = feature?.properties;
  if (!properties?.show_label || !properties.name || properties.$trail || properties.$change || !nameMoves(feature)) return null;
  return namePlace(properties);
}

/**
 * The names put by hand among drawn features, each a point of its own carrying
 * its feature's properties, so a card or a filter reads it as that feature.
 */
export function namePoints(features) {
  const out = [];
  for (const feature of features ?? []) {
    const at = placedName(feature);
    if (at) out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: at }, properties: { ...feature.properties, $label: true } });
  }
  return out;
}
