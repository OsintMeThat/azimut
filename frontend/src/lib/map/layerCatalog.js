/**
 * Every layer a map can lay over its picture, stated once.
 *
 * Satellite, Compare, Detect and Horizon each kept a list of their own, and the
 * four had drifted apart: one said "Road network" where another said where the
 * roads came from, and Horizon offered three layers out of ten. A tool now takes
 * this list whole and decides only which layers start on.
 *
 * The analyst's own layers (a KMZ, a My Maps, a GeoConfirmed conflict) are not
 * here: they belong to the case, and every map reads them from one store
 * (`addedLayersState.svelte.js`).
 */

/** The headings the menu lists the layers under, in order. */
export const LAYER_GROUPS = Object.freeze([
  { id: 'reference', label: 'Reference' },
  { id: 'events', label: 'Events' },
  { id: 'case', label: 'Case' },
]);

/**
 * `imageryOnly`: drawn for a satellite picture and not over a street map, which
 * already carries its own names and roads. `keyed`: needs a free key in Settings.
 */
export const LAYERS = Object.freeze([
  { id: 'boundaries', label: 'Borders', group: 'reference', title: 'Country, region and district borders, from OpenStreetMap via OpenFreeMap' },
  {
    id: 'placenames',
    label: 'Place names',
    group: 'reference',
    imageryOnly: true,
    title: 'Towns, villages and hamlets, from OpenStreetMap via OpenFreeMap',
  },
  { id: 'roads', label: 'Roads', group: 'reference', imageryOnly: true, title: 'Road network over the imagery, from Esri' },
  { id: 'railway', label: 'Railways', group: 'reference', title: 'Tracks, sidings and stations, from OpenRailwayMap' },
  {
    id: 'power',
    label: 'Power lines',
    group: 'reference',
    title: 'Power lines by voltage, towers, substations, pipelines and masts, from Open Infrastructure Map',
  },
  { id: 'seamarks', label: 'Sea marks', group: 'reference', title: 'Buoys, lights, harbours and fairways, from OpenSeaMap' },
  { id: 'gpstraces', label: 'GPS traces', group: 'reference', title: 'Raw GPS tracks uploaded to OpenStreetMap, mapped or not' },
  {
    id: 'firms',
    label: 'Active fires',
    group: 'events',
    keyed: true,
    title: 'Thermal detections from NASA FIRMS, live or from the archive',
  },
  { id: 'nightlights', label: 'Night lights', group: 'events', title: 'The ground at night, from NASA’s VIIRS passes' },
  // The case's own points, each a layer of its own: the places saved in it, and its
  // photos and videos where they were placed. Captures are not drawn on a map: they
  // are listed in the Saved panel, and a scene's in its pill.
  { id: 'places', label: 'Places', group: 'case', title: 'The places saved in this case' },
  // A switch under Places rather than a layer of its own (`of`): each place's name
  // written under its mark. Off until asked for, since a name covers the ground under it.
  { id: 'places-names', label: 'Names', group: 'case', of: 'places', title: "Each place's name under its mark" },
  { id: 'media', label: 'Media', group: 'case', title: "This case's photos and videos where they were placed" },
]);

/** Layers that became others: the one Saved work layer, whose switch drew either the
 *  case's media or its places (or its captures, no longer on a map), is both now. */
const BECAME = { saved: ['places', 'media'] };

const BY_ID = new Map(LAYERS.map((layer) => [layer.id, layer]));

/** One layer's entry, or null for an id nobody offers (a retired one). */
export function layerInfo(id) {
  return BY_ID.get(id) ?? null;
}

/**
 * A stored list of layer ids, kept ordered, unique and known.
 *
 * A session or a preference saved with a layer that has since been retired
 * opens without it rather than asking the map for a layer it cannot draw, and
 * one saved with a layer that became others opens with those (`BECAME`).
 */
export function knownLayers(value) {
  const asked = new Set((Array.isArray(value) ? value : []).flatMap((id) => BECAME[id] ?? [id]));
  return LAYERS.map((layer) => layer.id).filter((id) => asked.has(id));
}

/** The case's own point layers, which a map draws itself rather than lay over its picture. */
export const CASE_POINT_LAYERS = Object.freeze(['places', 'places-names', 'media']);

/**
 * The layers a capture says it carries, in words for its details: the catalogue's
 * names, the places with their names when those were written, the scene's leads,
 * and the analyst's own layers by name (`api/satellite.capture_oblique`).
 */
export function capturedLayerWords(ids = [], names = []) {
  const list = Array.isArray(ids) ? ids : [];
  const words = [];
  for (const id of list) {
    if (id === 'places-names') continue;
    if (id === 'places') words.push(list.includes('places-names') ? 'Places with names' : 'Places');
    else if (id === 'leads') words.push('Leads');
    else if (id === 'added') words.push(...(names?.length ? names : ['Your layers']));
    else words.push(layerInfo(id)?.label ?? id);
  }
  return words.join(', ');
}
