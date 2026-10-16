/**
 * The quiet ground a map plate is drawn on: water, woods, roads, borders and
 * names in pale greys, so the case's own lines and marks are what the eye reads.
 *
 * Satellite imagery is the ground of an investigation and the wrong ground for a
 * situation map: everything on it competes with the front line. This is what the
 * published conflict maps are drawn on, made from OpenFreeMap's vector tiles
 * (OpenMapTiles schema), which are free, key-less and carry no quota, the same
 * source the Map's place names come from (`lib/map/placeNames.js`).
 *
 * Text is drawn by the browser in the plate's own font, handed in as `font`: the
 * engine has no glyph URL (`engine.js`), so this asks for tiles and nothing else. The relief shading
 * reads the heights the 3D map reads, through the app (`/api/terrain/sources`).
 *
 * Two topographic grounds read those heights further, the world over: the heights
 * tinted from lowland green to rock and snow, a stronger shading, contour lines traced
 * by the plate itself (`contours.js`), and the summits named with their heights.
 * "Topographic" is in the colours of a national survey's map, "Staff map" in the
 * khaki and olive of a military one.
 */

export const PLAIN_ATTRIBUTION = '© OpenMapTiles © OpenStreetMap contributors · OpenFreeMap';
const SOURCE = 'plate-plain';
const RELIEF = 'plate-plain-relief';
const CONTOURS = 'plate-plain-contours';
const PREFIX = 'plate-plain-';

/** The two palettes: paper for print, night for a screen. */
export const PALETTES = {
  light: { ground: '#f3f1ec', water: '#c6d4de', wood: '#e2e7dc', urban: '#e9e5de', building: '#dcd7cf',
    road: '#ffffff', casing: '#d3cdc3', minor: '#fbfaf7', rail: '#b9b3a9', border: '#8f8a83', name: '#4b4a47',
    halo: 'rgba(255,255,255,0.9)', waterName: '#5f7d93', shade: '#5c5a55' },
  dark: { ground: '#1d2126', water: '#2b3a47', wood: '#232a25', urban: '#262a2f', building: '#30353b',
    road: '#3a4048', casing: '#14171b', minor: '#2f343b', rail: '#4a5058', border: '#7b8189', name: '#c9ccd1',
    halo: 'rgba(0,0,0,0.85)', waterName: '#7f9db3', shade: '#000000' },
  topo: { ground: '#f4f1e8', water: '#a9cde8', wood: '#b9d89a', urban: '#ece2d2', building: '#d6cab6',
    road: '#ffffff', casing: '#c4ad8a', minor: '#fffaf0', rail: '#8f8576', border: '#7d4f8c', name: '#2f2d29',
    halo: 'rgba(255,255,255,0.88)', waterName: '#2f6b9c', shade: '#5a4f42', contour: '#9a6236', peak: '#4a3a2a' },
  staff: { ground: '#e7e1c6', water: '#93b3bf', wood: '#a8b886', urban: '#d3c7a6', building: '#bdb08b',
    road: '#f3ecd4', casing: '#7a6b48', minor: '#ece4c8', rail: '#5f573f', border: '#3b3424', name: '#24221a',
    halo: 'rgba(231,225,198,0.9)', waterName: '#2f4f5c', shade: '#3a3423', contour: '#7f5f33', peak: '#24221a' },
};

/** The heights tinted on a topographic ground, by palette: metres, then colour. */
export const TINTS = {
  topo: [[0, '#c3dba9'], [150, '#dbe7b7'], [400, '#eeeac0'], [800, '#efdcab'], [1200, '#e3c595'], [1800, '#d4ad84'],
    [2500, '#c29f88'], [3200, '#d6ccc3'], [4200, '#f6f4f1']],
  staff: [[0, '#d8d4ae'], [300, '#d3cb9b'], [800, '#c8b886'], [1500, '#b8a176'], [2500, '#a48f6b'], [4000, '#d6cebf']],
};

/** The palette a plain ground is drawn in, by the ground's id. */
export function groundPalette(basemap = 'plain') {
  return { 'plain-dark': 'dark', 'plain-topo': 'topo', 'plain-staff': 'staff' }[basemap] ?? 'light';
}

/** Whether a ground reads the heights for its tints, contour lines and summits. */
export const topographic = (basemap) => basemap === 'plain-topo' || basemap === 'plain-staff';

const FONT = ['ui-sans-serif', 'system-ui', 'sans-serif'];
const ROAD = ['get', 'class'];

/** The name a place is written by: in Latin letters, as written there, or in one language. */
export function nameField(lang = 'latin') {
  if (lang === 'local') return ['get', 'name'];
  if (lang === 'latin') return ['coalesce', ['get', 'name:latin'], ['get', 'name']];
  return ['coalesce', ['get', `name:${lang}`], ['get', 'name:latin'], ['get', 'name']];
}

/** A CSS family list (`Inter, "Noto Sans Arabic"`) as the engine's font stack. */
export function fontStack(family) {
  if (!family) return FONT;
  return [...String(family).split(',').map((name) => name.trim().replace(/^"|"$/g, '')).filter(Boolean), 'sans-serif'];
}

/** Which places are named at each density: fewer, as usual, or more. */
const PLACES = { low: ['city', 'town'], normal: ['city', 'town', 'village'], high: ['city', 'town', 'village', 'suburb', 'hamlet'] };

/**
 * The engine layers of the plain ground, from the lowest. Pure, so tests read its shape.
 * `options` leaves out the roads, the buildings or the names, and sets the names'
 * language, density and face.
 */
export function plainLayers(palette = PALETTES.light, { roads = true, rails = true, buildings = true, names = true, lang = 'latin',
  density = 'normal', font = null, topo = null } = {}) {
  const layer = (id, rest) => ({ id: `${PREFIX}${id}`, source: SOURCE, ...rest });
  const NAME = nameField(lang);
  const FONT = fontStack(font);
  const all = [
    { id: `${PREFIX}ground`, type: 'background', paint: { 'background-color': palette.ground } },
    // on a topographic ground the woods are a wash over the tinted heights, not a cover
    layer('wood', { type: 'fill', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['wood', 'forest']]],
      paint: { 'fill-color': palette.wood, 'fill-opacity': topo ? 0.5 : 0.8 } }),
    layer('urban', { type: 'fill', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['residential', 'commercial', 'industrial']]],
      paint: { 'fill-color': palette.urban, 'fill-opacity': 0.9 } }),
    layer('water', { type: 'fill', 'source-layer': 'water', paint: { 'fill-color': palette.water } }),
    layer('river', { type: 'line', 'source-layer': 'waterway',
      paint: { 'line-color': palette.water, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 14, 2.5] } }),
    layer('building', { type: 'fill', 'source-layer': 'building', minzoom: 13, paint: { 'fill-color': palette.building } }),
    layer('road-casing', { type: 'line', 'source-layer': 'transportation', minzoom: 9,
      filter: ['in', ROAD, ['literal', ['motorway', 'trunk', 'primary', 'secondary']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': palette.casing, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.6, 15, 9] } }),
    layer('road-minor', { type: 'line', 'source-layer': 'transportation', minzoom: 11,
      filter: ['in', ROAD, ['literal', ['tertiary', 'minor', 'service', 'track']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': palette.minor, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 16, 4] } }),
    layer('road', { type: 'line', 'source-layer': 'transportation', minzoom: 5,
      filter: ['in', ROAD, ['literal', ['motorway', 'trunk', 'primary', 'secondary']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': palette.road, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 9, 1, 15, 7] } }),
    layer('rail', { type: 'line', 'source-layer': 'transportation', minzoom: 8, filter: ['==', ROAD, 'rail'],
      paint: { 'line-color': palette.rail, 'line-width': 1, 'line-dasharray': [3, 2] } }),
    layer('border', { type: 'line', 'source-layer': 'boundary', filter: ['<=', ['get', 'admin_level'], 4],
      paint: { 'line-color': palette.border, 'line-dasharray': [4, 2, 1, 2],
        'line-width': ['case', ['==', ['get', 'admin_level'], 2], 1.4, 0.7] } }),
    ...(topo?.contours ? contourLayers(palette, FONT) : []),
    layer('water-name', { type: 'symbol', 'source-layer': 'water_name', minzoom: 6,
      layout: { 'text-field': NAME, 'text-font': FONT, 'text-size': 11, 'text-max-width': 8 },
      paint: { 'text-color': palette.waterName, 'text-halo-color': palette.halo, 'text-halo-width': 1 } }),
    layer('place', { type: 'symbol', 'source-layer': 'place',
      filter: ['in', ['get', 'class'], ['literal', PLACES[density] ?? PLACES.normal]],
      layout: { 'text-field': NAME, 'text-font': FONT, 'text-max-width': 8, 'text-padding': density === 'high' ? 1 : 4,
        'text-size': ['match', ['get', 'class'], 'city', 14, 'town', 12, 'village', 10.5, 9.5],
        'symbol-sort-key': ['match', ['get', 'class'], 'city', 0, 'town', 1, 'village', 2, 3] },
      paint: { 'text-color': palette.name, 'text-halo-color': palette.halo, 'text-halo-width': 1.4 } }),
    ...(topo?.peaks ? [layer('peak', { type: 'symbol', 'source-layer': 'mountain_peak', minzoom: 7,
      filter: ['has', 'name'],
      layout: { 'text-field': ['case', ['has', 'ele'], ['concat', '▲ ', NAME, '\n', ['to-string', ['get', 'ele']], ' m'], ['concat', '▲ ', NAME]],
        'text-font': FONT, 'text-size': 9.5, 'text-max-width': 9, 'text-padding': 3,
        'symbol-sort-key': ['-', 0, ['coalesce', ['get', 'ele'], 0]] },
      paint: { 'text-color': palette.peak ?? palette.name, 'text-halo-color': palette.halo, 'text-halo-width': 1.2 } })] : []),
  ];
  const left = new Set([...(roads ? [] : ['road-casing', 'road-minor', 'road']), ...(rails ? [] : ['rail']), ...(buildings ? [] : ['building']),
    ...(names ? [] : ['water-name', 'place', 'peak'])].map((id) => `${PREFIX}${id}`));
  return all.filter((entry) => !left.has(entry.id));
}

/** The contour lines' layers: every line thin, every fifth bolder and written with its height along it. */
function contourLayers(palette, font) {
  const colour = palette.contour ?? palette.shade;
  return [
    { id: `${PREFIX}contour`, type: 'line', source: CONTOURS, filter: ['!', ['get', 'index']],
      paint: { 'line-color': colour, 'line-opacity': 0.75, 'line-width': 0.7 } },
    { id: `${PREFIX}contour-index`, type: 'line', source: CONTOURS, filter: ['get', 'index'],
      paint: { 'line-color': colour, 'line-opacity': 0.95, 'line-width': 1.3 } },
    { id: `${PREFIX}contour-label`, type: 'symbol', source: CONTOURS, filter: ['get', 'index'],
      layout: { 'symbol-placement': 'line', 'text-field': ['to-string', ['get', 'ele']], 'text-font': font, 'text-size': 9,
        'symbol-spacing': 320, 'text-padding': 4 },
      paint: { 'text-color': colour, 'text-halo-color': palette.halo, 'text-halo-width': 1.4 } },
  ];
}

/** An empty set of lines, what the contour lines start as until they are traced. */
const NO_LINES = { type: 'FeatureCollection', features: [] };

/** Hand the plain ground its contour lines, as traced for the view (`contours.contourLines`). */
export function setContours(map, lines) {
  map.getSource?.(CONTOURS)?.setData?.(lines ?? NO_LINES);
}

/** The palette a map asks for: the light or the dark one, its own colours over it. */
export function paletteOf(name = 'light', colours = {}) {
  const base = PALETTES[name] ?? PALETTES.light;
  const own = Object.fromEntries(Object.entries(colours ?? {}).filter(([, hex]) => /^#[0-9a-f]{6}$/i.test(hex)));
  return { ...base, ...own, ...(own.road ? { minor: own.road } : {}) };
}

/**
 * Lay the plain ground under whatever the map already draws, or take it away.
 *
 * `relief` is `/api/terrain/sources`' answer, or null to leave the shading off.
 */
export function showPlain(map, { palette = 'light', relief = null, shade = true, colours: own = {}, intensity = 1,
  tints = true, contours = true, peaks = true, ...options } = {}) {
  hidePlain(map);
  const colours = paletteOf(palette, own);
  const topo = TINTS[palette] ? { tints: tints !== false && !!relief?.tiles, contours: contours !== false, peaks: peaks !== false } : null;
  const before = map.getLayersOrder()[0];
  map.addSource(SOURCE, { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: PLAIN_ATTRIBUTION });
  if (topo?.contours) map.addSource(CONTOURS, { type: 'geojson', data: NO_LINES });
  const layers = plainLayers(colours, { ...options, topo });
  for (const entry of layers) map.addLayer(entry, before);
  if (!relief?.tiles) return;
  map.addSource(RELIEF, { type: 'raster-dem', tiles: [relief.tiles], tileSize: relief.tile_size,
    maxzoom: relief.max_zoom, encoding: relief.encoding, attribution: relief.sources?.[0]?.attribution ?? '' });
  if (topo?.tints) {
    // the heights' colours, straight over the land, under the woods, the towns and the water
    map.addLayer({ id: `${PREFIX}tints`, type: 'color-relief', source: RELIEF,
      paint: { 'color-relief-opacity': 0.85, 'color-relief-color': ['interpolate', ['linear'], ['elevation'], ...TINTS[palette].flat()] } },
      `${PREFIX}wood`);
  }
  if (shade || topo) {
    // over the ground and the water, under the roads and the names
    map.addLayer({ id: `${PREFIX}relief`, type: 'hillshade', source: RELIEF,
      paint: { 'hillshade-shadow-color': colours.shade, 'hillshade-exaggeration': Math.min(1, (topo ? 0.45 : 0.35) * intensity),
        'hillshade-highlight-color': palette === 'dark' ? '#000000' : '#ffffff' } },
      map.getLayer(`${PREFIX}building`) ? `${PREFIX}building` : map.getLayer(`${PREFIX}road-casing`) ? `${PREFIX}road-casing` : undefined);
  }
}

export function hidePlain(map) {
  for (const id of map.getLayersOrder()) if (id.startsWith(PREFIX)) map.removeLayer(id);
  for (const id of [SOURCE, RELIEF, CONTOURS]) if (map.getSource(id)) map.removeSource(id);
}
