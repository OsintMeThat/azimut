/**
 * Edits made on the map, drawn where they landed before the layer has saved them.
 *
 * A feature let go on the map used to wait for the write, then for the layer to
 * be read back, and showed at its old place in between. Now the editor and
 * every map drawing the layer put it where it landed at once, and the saved
 * layer replaces that drawing when it comes back. A refused edit goes back.
 *
 * A landing is `{ keys, offset?, geometry?, properties?, feature? }`: `offset`
 * shifts every point of those features by `[dLon, dLat]`, `geometry` replaces
 * their shape, and `properties` is added to what they say, a null taking a field
 * off. `feature` is one just added (a pin put down, a shape ended with Enter),
 * drawn until the layer read back holds it under its own key.
 */

/** The group fields a feature takes when it sets none of its own (`layerediting.GROUP_STYLE`). */
const GROUP_STYLE = ['line_dash', 'line_arrow', 'area_fill', 'fill_opacity'];

/**
 * What a feature says once drawn, as `layerediting.drawing` writes it from its
 * group: its group's name, sizes and look, its colour or its whole style when
 * the group gives one, and how its own icon is drawn (`icons`, the layer's
 * `{key: {mode, name}}`).
 */
export function drawnAs(properties, group, icons = {}) {
  const drawn = { ...properties };
  if (group) {
    drawn.category = group.name;
    drawn.icon_scale = drawn.marker_size || group.size || 1;
    drawn.stroke_width = drawn.line_width || group.stroke || 2;
    for (const field of GROUP_STYLE) if (!(field in drawn) && group[field] !== undefined && group[field] !== null && group[field] !== '') drawn[field] = group[field];
    if ((group.labels && drawn.label !== 'off') || drawn.label === 'on') drawn.show_label = true;
    if (group.events) drawn.event = true;
    if (group.mode === 'uniform') Object.assign(drawn, { colour: group.colour, symbol: group.symbol, icon: group.icon || '' });
    else if (group.mode === 'colour') drawn.colour = group.colour;
  }
  if (drawn.icon) {
    const look = icons?.[drawn.icon] ?? {};
    drawn.icon_mode = look.mode === 'disc' ? 'disc' : 'image';
    if (look.name) drawn.icon_name = look.name;
  }
  return drawn;
}

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
 * it was, so it stays put. Features no landing names are handed back as they were,
 * and the ones just added come last, on top.
 */
export function landAt(features, landings) {
  if (!landings?.length) return features;
  const named = landings.map((landing) => new Set(landing.keys));
  const landed = !features?.length ? features ?? [] : features.map((feature) => {
    const key = feature.properties?.key;
    if (key === undefined || feature.properties.$trail || feature.properties.$change) return feature;
    let moved = feature;
    landings.forEach((landing, index) => { if (!landing.feature && named[index].has(key)) moved = put(moved, landing); });
    return moved;
  });
  // numbered after the rest, as the layer numbers what it draws, so the map sorts them on top
  const added = landings.filter((landing) => landing.feature)
    .map((landing, at) => ({ ...landing.feature, properties: { ...landing.feature.properties, index: landed.length + at } }));
  return added.length ? [...landed, ...added] : landed;
}
