/**
 * Edits made on the map, drawn where they landed before the layer has saved them.
 *
 * A feature let go on the map used to wait for the write, then for the layer to
 * be read back, and showed at its old place in between. Now the editor and
 * every map drawing the layer put it where it landed at once, and the saved
 * layer replaces that drawing when it comes back. A refused edit goes back.
 *
 * A landing is `{ keys, offset?, geometry?, properties? }`: `offset` shifts
 * every point of those features by `[dLon, dLat]`, `geometry` replaces their
 * shape, and `properties` is added to what they say, a null taking a field off.
 */

const shift = (node, [dx, dy]) => (typeof node?.[0] === 'number'
  ? [node[0] + dx, node[1] + dy, ...node.slice(2)]
  : (node ?? []).map((child) => shift(child, [dx, dy])));

/** One feature with one landing put on it. */
function put(feature, landing) {
  let { geometry, properties } = feature;
  if (landing.geometry) geometry = landing.geometry;
  else if (landing.offset && geometry) geometry = { ...geometry, coordinates: shift(geometry.coordinates, landing.offset) };
  if (landing.properties) {
    properties = { ...properties, ...landing.properties };
    for (const [field, value] of Object.entries(landing.properties)) if (value === null) delete properties[field];
  }
  return { ...feature, geometry, properties };
}

/**
 * `features` with each landing put on them, in order, so two moves made one
 * after the other add up. A trail or a change drawn under a feature shows where
 * it was, so it stays put. Features no landing names are handed back as they were.
 */
export function landAt(features, landings) {
  if (!landings?.length || !features?.length) return features;
  const named = landings.map((landing) => new Set(landing.keys));
  return features.map((feature) => {
    const key = feature.properties?.key;
    if (key === undefined || feature.properties.$trail || feature.properties.$change) return feature;
    let landed = feature;
    landings.forEach((landing, index) => { if (named[index].has(key)) landed = put(landed, landing); });
    return landed;
  });
}
