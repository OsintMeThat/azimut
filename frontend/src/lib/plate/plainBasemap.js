/**
 * The quiet grounds a map plate is drawn on: water, woods, roads, borders and
 * names in a palette of their own, so the case's own lines and marks are what the
 * eye reads.
 *
 * Satellite imagery is the ground of an investigation and the wrong ground for a
 * situation map: everything on it competes with the front line. These are what the
 * published conflict maps are drawn on, made from OpenFreeMap's vector tiles
 * (OpenMapTiles schema), which are free, key-less and carry no quota, the same
 * source the Map's place names come from (`lib/map/placeNames.js`).
 *
 * Text is drawn by the browser in the plate's own font, handed in as `font`: the
 * engine has no glyph URL (`engine.js`), so this asks for tiles and nothing else. The
 * engine reads a face's weight and slant off the first name of its stack, so a
 * name stack led by `"Inter Italic"` writes in Inter's italic (`styled`). The relief
 * shading reads the heights the 3D map reads, through the app (`/api/terrain/sources`).
 *
 * Each ground is a style (`GROUNDS`): a palette, how strongly its relief is shaded
 * and by how many lights, whether it tints the heights and traces contour lines
 * (the topographic ones), and how its coasts are drawn. Every style reads the same
 * tiles, so switching one asks for nothing new.
 */

export const PLAIN_ATTRIBUTION = '© OpenMapTiles © OpenStreetMap contributors · OpenFreeMap';
const SOURCE = 'plate-plain';
const RELIEF = 'plate-plain-relief';
const CONTOURS = 'plate-plain-contours';
const PREFIX = 'plate-plain-';

/** The palettes the styles are drawn in. */
export const PALETTES = {
  light: { ground: '#f3f1ec', water: '#c6d4de', wood: '#e2e7dc', urban: '#e9e5de', building: '#dcd7cf',
    road: '#ffffff', casing: '#d3cdc3', minor: '#fbfaf7', rail: '#b9b3a9', border: '#8f8a83', name: '#4b4a47',
    halo: 'rgba(255,255,255,0.9)', waterName: '#5f7d93', shade: '#5c5a55' },
  grey: { ground: '#f2f2f0', water: '#d3d9dc', wood: '#e9ebe6', urban: '#eaeae7', building: '#dfdfdb',
    road: '#ffffff', casing: '#dadad6', minor: '#fafaf9', rail: '#c9c9c5', border: '#9d9d9a', name: '#68686a',
    halo: 'rgba(255,255,255,0.92)', waterName: '#8698a1', shade: '#77777a' },
  news: { ground: '#f1ece2', water: '#c9d6da', wood: '#e5e3d2', urban: '#e8e0d2', building: '#ddd3c3',
    road: '#fbf8f2', casing: '#dcd2c1', minor: '#f6f1e7', rail: '#bdb2a0', border: '#968a78', name: '#3b362e',
    halo: 'rgba(250,247,240,0.92)', waterName: '#557483', shade: '#6b5c4a', coast: '#869fa8' },
  dark: { ground: '#1d2126', water: '#2b3a47', wood: '#232a25', urban: '#262a2f', building: '#30353b',
    road: '#3a4048', casing: '#14171b', minor: '#2f343b', rail: '#4a5058', border: '#7b8189', name: '#c9ccd1',
    halo: 'rgba(0,0,0,0.85)', waterName: '#7f9db3', shade: '#000000', highlight: '#000000' },
  toner: { ground: '#ffffff', water: '#1b1b1b', wood: '#ffffff', urban: '#f1f1f1', building: '#d6d6d6',
    road: '#151515', casing: '#ffffff', minor: '#6a6a6a', rail: '#151515', border: '#000000', name: '#000000',
    halo: 'rgba(255,255,255,0.95)', waterName: '#ffffff', waterHalo: 'rgba(0,0,0,0.9)', shade: '#000000', coast: '#6a6a6a',
    military: '#e6e6e6', militaryEdge: '#4a4a4a' },
  tactical: { ground: '#0d1b2a', water: '#07111b', wood: '#10212d', urban: '#152a3b', building: '#1c3449',
    road: '#2e6d8c', casing: '#0b1622', minor: '#1d4559', rail: '#2a5a72', border: '#4fd1ff', name: '#a6e9ff',
    halo: 'rgba(7,17,27,0.9)', waterName: '#3f8fb0', shade: '#000000', highlight: '#1f3d58', coast: '#2b9fd0' },
  relief: { ground: '#eef0e6', water: '#b6cfdd', wood: '#cddbbd', urban: '#e7dfd2', building: '#d6ccbc',
    road: '#fffdf8', casing: '#cbbfae', minor: '#fbf8f1', rail: '#9b9284', border: '#7c6d86', name: '#2f2d29',
    halo: 'rgba(255,253,246,0.9)', waterName: '#3c6c8c', shade: '#3e4c69', highlight: '#fff4d8' },
  humanitarian: { ground: '#f7f7f7', water: '#c4e1f2', wood: '#e9f0e3', urban: '#ebebeb', building: '#e1e1e1',
    road: '#ffffff', casing: '#d6d6d6', minor: '#fdfdfd', rail: '#bfbfbf', border: '#4f86c1', name: '#2f3a45',
    halo: 'rgba(255,255,255,0.92)', waterName: '#3a7cab', shade: '#7b858e' },
  topo: { ground: '#f4f1e8', water: '#a9cde8', wood: '#b9d89a', urban: '#ece2d2', building: '#d6cab6',
    road: '#ffffff', casing: '#c4ad8a', minor: '#fffaf0', rail: '#8f8576', border: '#7d4f8c', name: '#2f2d29',
    halo: 'rgba(255,255,255,0.88)', waterName: '#2f6b9c', shade: '#5a4f42', contour: '#9a6236', peak: '#4a3a2a' },
  staff: { ground: '#e7e1c6', water: '#93b3bf', wood: '#a8b886', urban: '#d3c7a6', building: '#bdb08b',
    road: '#f3ecd4', casing: '#7a6b48', minor: '#ece4c8', rail: '#5f573f', border: '#3b3424', name: '#24221a',
    halo: 'rgba(231,225,198,0.9)', waterName: '#2f4f5c', shade: '#3a3423', contour: '#7f5f33', peak: '#24221a' },
};

/** The heights tinted on a ground that colours them, by tint: metres, then colour. */
export const TINTS = {
  topo: [[0, '#c3dba9'], [150, '#dbe7b7'], [400, '#eeeac0'], [800, '#efdcab'], [1200, '#e3c595'], [1800, '#d4ad84'],
    [2500, '#c29f88'], [3200, '#d6ccc3'], [4200, '#f6f4f1']],
  staff: [[0, '#d8d4ae'], [300, '#d3cb9b'], [800, '#c8b886'], [1500, '#b8a176'], [2500, '#a48f6b'], [4000, '#d6cebf']],
  // a Swiss survey's relief: green-grey lowlands, warm middle heights, pale rock and snow
  relief: [[0, '#b7cea6'], [200, '#cbdbab'], [600, '#e2e1b3'], [1200, '#e7d4a6'], [2000, '#dbc3a5'], [3000, '#d8d1ca'],
    [4500, '#f7f7f4']],
};

/**
 * The grounds a plate offers, in the order the gallery shows them: the label, the
 * palette, and what the style does beyond its colours.
 *
 * - `shade`: the relief, drawn whether or not the map asks for it (`own`), at a
 *   strength, by one light or several (`multidirectional`).
 * - `tints`: the heights coloured. `contours`: the contour lines and the summits.
 * - `coast`: the water's edge drawn as lines going out from it, or as a glow.
 * - `dark`: a ground light words and lines are written over.
 */
export const GROUNDS = {
  plain: { label: 'Plain', palette: 'light' },
  'plain-grey': { label: 'Light grey', palette: 'grey' },
  'plain-news': { label: 'Newsroom', palette: 'news', shade: { own: true, strength: 0.45, multidirectional: true }, coast: 'lines' },
  'plain-humanitarian': { label: 'Humanitarian', palette: 'humanitarian' },
  'plain-relief': { label: 'Shaded relief', palette: 'relief', tints: 'relief', woods: 0.45,
    shade: { own: true, strength: 0.55, multidirectional: true } },
  'plain-topo': { label: 'Topographic, heights in colour', palette: 'topo', tints: 'topo', contours: true, woods: 0.5,
    shade: { own: true, strength: 0.45 } },
  'plain-staff': { label: 'Staff map', palette: 'staff', tints: 'staff', contours: true, woods: 0.5, shade: { own: true, strength: 0.45 } },
  'plain-toner': { label: 'Toner, black and white', palette: 'toner', coast: 'lines' },
  'plain-dark': { label: 'Plain, dark', palette: 'dark', dark: true },
  'plain-tactical': { label: 'Tactical, dark blue', palette: 'tactical', dark: true, coast: 'glow' },
};

/** `[id, label]` of every plain ground, in the gallery's order. */
export const PLAIN_GROUNDS = Object.entries(GROUNDS).map(([id, style]) => [id, style.label]);

/** The style a ground is drawn in; imagery and unknown ids read as the plain one. */
export const groundStyle = (basemap = 'plain') => GROUNDS[basemap] ?? GROUNDS.plain;

/** The palette a plain ground is drawn in, by the ground's id. */
export const groundPalette = (basemap = 'plain') => groundStyle(basemap).palette;

/** Whether a ground reads the heights for its contour lines and summits. */
export const topographic = (basemap) => !!GROUNDS[basemap]?.contours;

/** Whether a ground shades its relief whether or not the map asks for it. */
export const selfShaded = (basemap) => !!GROUNDS[basemap]?.shade?.own;

/** Whether a ground reads the heights at all, as this map draws it: its own relief or the shading asked for. */
export const readsHeights = (basemap, overlays = []) =>
  String(basemap || 'plain').startsWith('plain') ? selfShaded(basemap) || overlays.includes('relief') : overlays.includes('relief');

/** Whether words and lines are written light over this ground: a dark plain one, or imagery. */
export const darkGround = (basemap) => !!basemap && (!String(basemap).startsWith('plain') || !!GROUNDS[basemap]?.dark);

const FONT = ['ui-sans-serif', 'system-ui', 'sans-serif'];
const ROAD = ['get', 'class'];

/** The name a place is written by: in Latin letters, as written there, or in one language. */
export function nameField(lang = 'latin') {
  if (lang === 'local') return ['get', 'name'];
  if (lang === 'latin') return ['coalesce', ['get', 'name:latin'], ['get', 'name']];
  return ['coalesce', ['get', `name:${lang}`], ['get', 'name:latin'], ['get', 'name']];
}

/** The name a feature's properties write in `lang`, as `nameField` reads it. */
export function nameOf(properties = {}, lang = 'latin') {
  const keys = lang === 'local' ? ['name'] : lang === 'latin' ? ['name:latin', 'name'] : [`name:${lang}`, 'name:latin', 'name'];
  return keys.map((key) => properties[key]).find((value) => value !== undefined && value !== null && value !== '') ?? '';
}

/** The ground's layers that write names, which a click on a framed map can hide one of. */
const NAME_LAYERS = ['river-name', 'water-name', 'country', 'region', 'airfield-name', 'place', 'peak'];
export const NAME_LAYER_IDS = NAME_LAYERS.map((id) => `${PREFIX}${id}`);

/**
 * A CSS family list (`Inter, "Noto Sans Arabic"`) as the engine's font stack.
 *
 * The engine writes the names into a canvas font as they are, so a name that is not
 * plain words keeps its quotes: `Source Serif 4` unquoted is no font at all, and the
 * canvas would draw every place name in its own 10-pixel default.
 */
export function fontStack(family) {
  if (!family) return FONT;
  const names = String(family).split(',').map((name) => name.trim().replace(/^"|"$/g, '')).filter(Boolean);
  return [...names.map((name) => (PLAIN_NAME.test(name) ? name : `"${name.replaceAll('"', '')}"`)), 'sans-serif'];
}
/** A family name a canvas font reads without quotes: words that each start with a letter. */
const PLAIN_NAME = /^-?[A-Za-z_][\w-]*(\s+-?[A-Za-z_][\w-]*)*$/;

/**
 * A stack written in its face's `variant` ("Italic", "Bold", "Bold Italic"): the engine
 * reads the weight and the slant off the stack's first name, which is no font of its
 * own, so the browser falls through to the face itself and writes it that way.
 */
export function styled(stack, variant) {
  const first = String(stack[0] ?? 'sans-serif').replace(/^"|"$/g, '');
  return [`"${first} ${variant}"`, ...stack];
}

/** Which places are named at each detail: fewer, as usual, or more. */
const PLACES = { low: ['city', 'town'], normal: ['city', 'town', 'village'], high: ['city', 'town', 'village', 'suburb', 'hamlet'] };

/** A hex colour `t` of the way to `to`. */
export function mix(hex, to, t) {
  const parse = (value) => [1, 3, 5].map((at) => parseInt(String(value).slice(at, at + 2), 16));
  if (!/^#[0-9a-f]{6}$/i.test(hex) || !/^#[0-9a-f]{6}$/i.test(to) || t <= 0) return hex;
  const [a, b] = [parse(hex), parse(to)];
  return `#${a.map((value, index) => Math.round(value + (b[index] - value) * Math.min(1, t)).toString(16).padStart(2, '0')).join('')}`;
}

/** The colours that come forward with a ground's presence, and the names, which come half as far, to stay read. */
const FADES = ['water', 'wood', 'urban', 'building', 'road', 'casing', 'minor', 'rail', 'border', 'coast', 'contour'];
const HALF_FADES = ['name', 'waterName', 'peak'];

/**
 * A palette drawn at a presence between 0.2 and 1: everything but the land drawn
 * that much nearer the land's own colour, so a quiet ground can be made quieter.
 */
export function present(palette, presence = 1) {
  const t = 1 - Math.max(0.2, Math.min(1, presence ?? 1));
  if (t <= 0) return palette;
  const out = { ...palette };
  for (const key of FADES) if (out[key]) out[key] = mix(out[key], palette.ground, t);
  for (const key of HALF_FADES) if (out[key]) out[key] = mix(out[key], palette.ground, t / 2);
  return out;
}

/** The borders a ground draws, by the deepest level it goes to: countries, their regions, or the districts in them too. */
export const ADMIN_LEVELS = { countries: 2, regions: 4, districts: 6 };

/**
 * The colours a palette lends what it holds no colour of its own for: fields, sand,
 * ice and marsh, military ground, airfields, and the road numbers' shields. Each is
 * the land's own colour drawn a little toward what it is, so every style keeps its
 * quiet and a dark ground stays dark.
 */
export function derived(palette) {
  const dark = /^#([0-3][0-9a-f]){3}$/i.test(palette.ground);
  return {
    fields: mix(palette.ground, palette.wood, 0.35),
    sand: mix(palette.ground, dark ? '#6b6044' : '#e6d49c', 0.4),
    ice: mix(palette.ground, '#ffffff', dark ? 0.1 : 0.6),
    marsh: mix(palette.ground, palette.water, 0.35),
    military: palette.military ?? mix(palette.ground, '#b23a32', dark ? 0.18 : 0.1),
    militaryEdge: palette.militaryEdge ?? mix(palette.border, '#b23a32', 0.55),
    apron: mix(palette.ground, palette.name, 0.08),
    runway: mix(palette.ground, palette.name, dark ? 0.3 : 0.32),
    taxiway: mix(palette.ground, palette.name, 0.2),
    shield: mix(palette.ground, '#ffffff', dark ? 0.12 : 0.85),
  };
}

/** The picture a road number is written on: a small rounded box of `fill` in a rim of `rim`, drawn at twice its size. */
export function shieldImage(fill, rim) {
  const [width, height] = [24, 20];
  const parse = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  const [inside, edge] = [parse(fill), parse(rim)];
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // the corners rounded off, a two-pixel rim inside them
      const cx = Math.max(3 - x, x - (width - 4), 0);
      const cy = Math.max(3 - y, y - (height - 4), 0);
      const reach = Math.hypot(cx, cy);
      if (reach > 3.5) continue;
      const rimmed = x < 2 || y < 2 || x >= width - 2 || y >= height - 2 || reach > 1.8;
      data.set([...(rimmed ? edge : inside), 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}
const SHIELD = 'plate-plain-shield';
/** A feature drawn as an area, or as a line, whether the tiles hold one part of it or several. */
const AREA = ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]];
const LINE = ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]];

/**
 * The engine layers of a plain ground, from the lowest. Pure, so tests read its shape.
 * `options` leaves out the roads, the buildings or the names, and sets the names'
 * language, the detail and the face; `style` is the ground's (`GROUNDS`). What an
 * investigation reads on a ground is drawn too, each can be left out: fields, sand,
 * ice and marsh (`cover`), military ground, airfields with their runways and names,
 * the road numbers (`refs`), the borders to the depth `admin` says with the disputed
 * ones dotted, ferries and piers.
 */
export function plainLayers(palette = PALETTES.light, { roads = true, rails = true, buildings = true, names = true, lang = 'latin',
  density = 'normal', font = null, topo = null, style = GROUNDS.plain, admin = 'regions', cover = true, military = true,
  airfields = true, refs = true, hidden_names: hidden = [] } = {}) {
  const layer = (id, rest) => ({ id: `${PREFIX}${id}`, source: SOURCE, ...rest });
  const NAME = nameField(lang);
  const FONT = fontStack(font);
  const ITALIC = styled(FONT, 'Italic');
  const BOLD = styled(FONT, 'Bold');
  const detail = PLACES[density] ? density : 'normal';
  const lent = derived(palette);
  const deepest = ADMIN_LEVELS[admin] ?? ADMIN_LEVELS.regions;
  const COVER = [['fields', 'farmland', 9, 0.55], ['sand', 'sand', 6, 0.8], ['ice', 'ice', 4, 0.9], ['marsh', 'wetland', 8, 0.6]];
  const all = [
    { id: `${PREFIX}ground`, type: 'background', paint: { 'background-color': palette.ground } },
    // on a ground that tints its heights the woods are a wash over the tints, not a cover
    layer('wood', { type: 'fill', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['wood', 'forest']]],
      paint: { 'fill-color': palette.wood, 'fill-opacity': style.woods ?? (topo ? 0.5 : 0.8) } }),
    ...(cover ? COVER.map(([key, kind, minzoom, opacity]) => layer(`cover-${key}`, { type: 'fill', 'source-layer': 'landcover', minzoom,
      filter: ['==', ['get', 'class'], kind], paint: { 'fill-color': lent[key], 'fill-opacity': opacity } })) : []),
    layer('urban', { type: 'fill', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['residential', 'commercial', 'industrial']]],
      paint: { 'fill-color': palette.urban, 'fill-opacity': 0.9 } }),
    ...(military ? [
      layer('military', { type: 'fill', 'source-layer': 'landuse', minzoom: 8, filter: ['==', ['get', 'class'], 'military'],
        paint: { 'fill-color': lent.military, 'fill-opacity': 0.9 } }),
      layer('military-edge', { type: 'line', 'source-layer': 'landuse', minzoom: 10, filter: ['==', ['get', 'class'], 'military'],
        paint: { 'line-color': lent.militaryEdge, 'line-width': 0.8, 'line-dasharray': [3, 2], 'line-opacity': 0.8 } }),
    ] : []),
    layer('water', { type: 'fill', 'source-layer': 'water', paint: { 'fill-color': palette.water } }),
    ...coastLayers(palette, style.coast, layer),
    layer('river', { type: 'line', 'source-layer': 'waterway',
      paint: { 'line-color': palette.water, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 14, 2.5] } }),
    // a pier stands out over the water in the land's own colour
    layer('pier', { type: 'line', 'source-layer': 'transportation', minzoom: 13, filter: ['==', ROAD, 'pier'],
      paint: { 'line-color': palette.ground, 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1, 16, 5] } }),
    ...(airfields ? [
      layer('apron', { type: 'fill', 'source-layer': 'aeroway', filter: ['all', AREA, ['in', ['get', 'class'], ['literal', ['apron', 'aerodrome']]]],
        paint: { 'fill-color': lent.apron, 'fill-opacity': 0.9 } }),
      layer('runway-area', { type: 'fill', 'source-layer': 'aeroway', filter: ['all', AREA, ['in', ['get', 'class'], ['literal', ['runway', 'taxiway']]]],
        paint: { 'fill-color': lent.runway } }),
      layer('taxiway', { type: 'line', 'source-layer': 'aeroway', minzoom: 11, filter: ['all', LINE, ['==', ['get', 'class'], 'taxiway']],
        paint: { 'line-color': lent.taxiway, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 11, 0.5, 16, 8] } }),
      layer('runway', { type: 'line', 'source-layer': 'aeroway', filter: ['all', LINE, ['==', ['get', 'class'], 'runway']],
        paint: { 'line-color': lent.runway, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 10, 1.2, 13, 5, 16, 30] } }),
    ] : []),
    ...(detail === 'low' ? [] : [layer('building', { type: 'fill', 'source-layer': 'building', minzoom: 13, paint: { 'fill-color': palette.building } })]),
    layer('road-casing', { type: 'line', 'source-layer': 'transportation', minzoom: 9,
      filter: ['in', ROAD, ['literal', ['motorway', 'trunk', 'primary', 'secondary']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': palette.casing, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.6, 15, 9] } }),
    ...(detail === 'low' ? [] : [layer('road-minor', { type: 'line', 'source-layer': 'transportation', minzoom: detail === 'high' ? 10 : 11,
      filter: ['in', ROAD, ['literal', ['tertiary', 'minor', 'service', 'track']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': palette.minor, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.4, 11, 0.5, 16, 4] } })]),
    layer('road', { type: 'line', 'source-layer': 'transportation', minzoom: 5,
      filter: ['in', ROAD, ['literal', ['motorway', 'trunk', 'primary', 'secondary']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': palette.road, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 9, 1, 15, 7] } }),
    layer('rail', { type: 'line', 'source-layer': 'transportation', minzoom: 8, filter: ['==', ROAD, 'rail'],
      paint: { 'line-color': palette.rail, 'line-width': 1, 'line-dasharray': [3, 2] } }),
    layer('ferry', { type: 'line', 'source-layer': 'transportation', minzoom: 7, filter: ['==', ROAD, 'ferry'],
      paint: { 'line-color': palette.waterName, 'line-width': 0.8, 'line-dasharray': [2, 2], 'line-opacity': 0.7 } }),
    ...(deepest >= 6 ? [layer('border-district', { type: 'line', 'source-layer': 'boundary', minzoom: 8,
      filter: ['all', ['in', ['get', 'admin_level'], ['literal', [5, 6]]], ['!=', ['get', 'maritime'], 1]],
      paint: { 'line-color': palette.border, 'line-width': 0.5, 'line-dasharray': [2, 2], 'line-opacity': 0.7 } })] : []),
    // the borders at sea, the claimed and the disputed ones drawn apart
    layer('border', { type: 'line', 'source-layer': 'boundary',
      filter: ['all', ['<=', ['get', 'admin_level'], Math.min(deepest, 4)], ['!=', ['get', 'maritime'], 1], ['!=', ['get', 'disputed'], 1]],
      paint: { 'line-color': palette.border, 'line-dasharray': [4, 2, 1, 2],
        'line-width': ['case', ['==', ['get', 'admin_level'], 2], 1.4, 0.7] } }),
    layer('border-disputed', { type: 'line', 'source-layer': 'boundary', filter: ['all', ['==', ['get', 'disputed'], 1], ['!=', ['get', 'maritime'], 1]],
      paint: { 'line-color': palette.border, 'line-width': 1.2, 'line-dasharray': [1, 2.5] } }),
    layer('border-sea', { type: 'line', 'source-layer': 'boundary', minzoom: 4, filter: ['all', ['==', ['get', 'maritime'], 1], ['==', ['get', 'admin_level'], 2]],
      paint: { 'line-color': palette.waterName, 'line-width': 0.6, 'line-dasharray': [4, 3], 'line-opacity': 0.5 } }),
    ...(topo?.contours ? contourLayers(palette, FONT) : []),
    // the water written in italic, the seas spaced out, the rivers along their course
    layer('river-name', { type: 'symbol', 'source-layer': 'waterway', minzoom: 10, filter: ['all', ['has', 'name'], ['==', ['get', 'class'], 'river']],
      layout: { 'symbol-placement': 'line', 'text-field': NAME, 'text-font': ITALIC, 'text-size': 10, 'symbol-spacing': 360, 'text-letter-spacing': 0.06 },
      paint: { 'text-color': palette.waterName, 'text-halo-color': palette.halo, 'text-halo-width': 1.2 } }),
    layer('water-name', { type: 'symbol', 'source-layer': 'water_name', minzoom: 3,
      layout: { 'text-field': NAME, 'text-font': ITALIC, 'text-max-width': 8,
        'text-size': ['match', ['get', 'class'], 'ocean', 13, 'sea', 12, 11],
        'text-letter-spacing': ['match', ['get', 'class'], ['ocean', 'sea', 'bay'], 0.18, 0.04] },
      paint: { 'text-color': palette.waterName, 'text-halo-color': palette.waterHalo ?? palette.halo, 'text-halo-width': 1 } }),
    // the regions in spaced capitals while the map is wide enough to hold them, under the towns
    layer('region', { type: 'symbol', 'source-layer': 'place', minzoom: 4, maxzoom: 8, filter: ['==', ['get', 'class'], 'state'],
      layout: { 'text-field': NAME, 'text-font': FONT, 'text-transform': 'uppercase', 'text-letter-spacing': 0.14, 'text-size': 9, 'text-max-width': 8 },
      paint: { 'text-color': palette.name, 'text-halo-color': palette.halo, 'text-halo-width': 1.2, 'text-opacity': 0.6 } }),
    ...(airfields ? [layer('airfield-name', { type: 'symbol', 'source-layer': 'aerodrome_label', minzoom: 9, filter: ['has', 'name'],
      layout: { 'text-field': ['concat', '✈ ', NAME], 'text-font': FONT, 'text-size': 9.5, 'text-max-width': 9, 'text-padding': 4 },
      paint: { 'text-color': palette.name, 'text-halo-color': palette.halo, 'text-halo-width': 1.2, 'text-opacity': 0.85 } })] : []),
    layer('place', { type: 'symbol', 'source-layer': 'place',
      filter: ['in', ['get', 'class'], ['literal', PLACES[detail]]],
      layout: { 'text-field': NAME, 'text-max-width': 8, 'text-padding': detail === 'high' ? 1 : 4,
        // a capital stands out in its face's bold
        'text-font': ['case', ['==', ['get', 'capital'], 2], ['literal', BOLD], ['literal', FONT]],
        'text-size': ['match', ['get', 'class'], 'city', 14, 'town', 12, 'village', 10.5, 9.5],
        'symbol-sort-key': ['match', ['get', 'class'], 'city', 0, 'town', 1, 'village', 2, 3] },
      paint: { 'text-color': palette.name, 'text-halo-color': palette.halo, 'text-halo-width': 1.4 } }),
    // the countries last, so they are placed first: the engine places the top layers' words before the ones under them
    layer('country', { type: 'symbol', 'source-layer': 'place', maxzoom: 7, filter: ['==', ['get', 'class'], 'country'],
      layout: { 'text-field': NAME, 'text-font': BOLD, 'text-transform': 'uppercase', 'text-letter-spacing': 0.2, 'text-max-width': 7,
        'text-size': ['interpolate', ['linear'], ['zoom'], 2, 9, 6, 14] },
      paint: { 'text-color': palette.name, 'text-halo-color': palette.halo, 'text-halo-width': 1.4, 'text-opacity': 0.85 } }),
    // the road numbers on their shields, upright whichever way the road runs
    ...(refs ? [layer('ref', { type: 'symbol', 'source-layer': 'transportation_name', minzoom: 7,
      filter: ['all', ['has', 'ref'], ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]], ['<=', ['coalesce', ['get', 'ref_length'], 9], 8]],
      layout: { 'symbol-placement': 'line', 'symbol-spacing': 420, 'text-field': ['get', 'ref'], 'text-font': BOLD, 'text-size': 8.5,
        'text-rotation-alignment': 'viewport', 'icon-rotation-alignment': 'viewport', 'icon-image': SHIELD,
        'icon-text-fit': 'both', 'icon-text-fit-padding': [1, 3, 1, 3], 'text-padding': 6 },
      paint: { 'text-color': palette.name } })] : []),
    ...(topo?.peaks ? [layer('peak', { type: 'symbol', 'source-layer': 'mountain_peak', minzoom: 7,
      filter: ['has', 'name'],
      layout: { 'text-field': ['case', ['has', 'ele'], ['concat', '▲ ', NAME, '\n', ['to-string', ['get', 'ele']], ' m'], ['concat', '▲ ', NAME]],
        'text-font': FONT, 'text-size': 9.5, 'text-max-width': 9, 'text-padding': 3,
        'symbol-sort-key': ['-', 0, ['coalesce', ['get', 'ele'], 0]] },
      paint: { 'text-color': palette.peak ?? palette.name, 'text-halo-color': palette.halo, 'text-halo-width': 1.2 } })] : []),
  ];
  const left = new Set([...(roads ? [] : ['road-casing', 'road-minor', 'road', 'ref']), ...(rails ? [] : ['rail']), ...(buildings ? [] : ['building']),
    ...(names ? [] : NAME_LAYERS)].map((id) => `${PREFIX}${id}`));
  const kept = all.filter((entry) => !left.has(entry.id));
  if (!hidden.length) return kept;
  // the names the analyst took off, as this map writes them
  const shown = ['!', ['in', NAME, ['literal', hidden]]];
  return kept.map((entry) => (NAME_LAYER_IDS.includes(entry.id) ? { ...entry, filter: entry.filter ? ['all', entry.filter, shown] : shown } : entry));
}

/**
 * The water's edge, drawn from the inside of the water: lines going out from the
 * coast, fainter as they go, as an engraved map draws it, or a glow along it. A water
 * polygon's rings run so that its right-hand side is the water, so a positive offset
 * falls in the water whatever side the land is on.
 */
function coastLayers(palette, coast, layer) {
  if (!coast) return [];
  const colour = palette.coast ?? palette.waterName;
  const edge = { 'source-layer': 'water', filter: AREA, minzoom: 4 };
  if (coast === 'glow') {
    return [layer('coast-glow', { type: 'line', ...edge,
      paint: { 'line-color': colour, 'line-width': 5, 'line-blur': 5, 'line-offset': 2.5, 'line-opacity': 0.55 } })];
  }
  return [[1.5, 0.85], [4, 0.55], [7, 0.3]].map(([offset, opacity], index) => layer(`coast-${index + 1}`, { type: 'line', ...edge,
    paint: { 'line-color': colour, 'line-width': 0.8, 'line-offset': offset, 'line-opacity': opacity } }));
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

/** The palette a map asks for: its ground's, its own colours over it. */
export function paletteOf(name = 'light', colours = {}) {
  const base = PALETTES[name] ?? PALETTES.light;
  const own = Object.fromEntries(Object.entries(colours ?? {}).filter(([, hex]) => /^#[0-9a-f]{6}$/i.test(hex)));
  return { ...base, ...own, ...(own.road ? { minor: own.road } : {}) };
}

/** How strongly a ground's relief is shaded, at the map's own `intensity`: 0 when it draws none. */
export function shadeStrength(basemap, { shaded = false, intensity = 1 } = {}) {
  const style = groundStyle(basemap);
  if (!style.shade?.own && !shaded) return 0;
  return Math.min(1, (style.shade?.strength ?? 0.35) * intensity);
}

/** The four lights a ground shaded from several sides is lit by, from the west round to the north-east. */
const LIGHTS = [270, 315, 0, 45];

/** A hillshade's paint: one light from the north-west, or four round the north. */
export function hillshadePaint(palette, strength, multidirectional = false) {
  const highlight = palette.highlight ?? '#ffffff';
  if (!multidirectional) {
    return { 'hillshade-shadow-color': palette.shade, 'hillshade-exaggeration': strength, 'hillshade-highlight-color': highlight };
  }
  return { 'hillshade-method': 'multidirectional', 'hillshade-exaggeration': strength,
    'hillshade-illumination-direction': LIGHTS, 'hillshade-illumination-altitude': LIGHTS.map(() => 35),
    'hillshade-shadow-color': LIGHTS.map(() => palette.shade), 'hillshade-highlight-color': LIGHTS.map(() => highlight) };
}

/**
 * Lay a plain ground under whatever the map already draws, or take it away.
 *
 * `ground` is the ground's id (`GROUNDS`); `relief` is `/api/terrain/sources`' answer,
 * or null to leave the heights unread; `shade` is the shading the map asks for, which
 * a self-shaded ground draws anyway; `presence` how far its colours come forward.
 */
export function showPlain(map, { ground = 'plain', relief = null, shade = true, colours: own = {}, intensity = 1, presence = 1,
  tints = true, contours = true, peaks = true, ...options } = {}) {
  hidePlain(map);
  const style = groundStyle(ground);
  const colours = present(paletteOf(style.palette, own), presence);
  const tinted = !!style.tints && tints !== false && !!relief?.tiles;
  const topo = style.contours || style.tints ? { contours: !!style.contours && contours !== false, peaks: !!style.contours && peaks !== false } : null;
  const before = map.getLayersOrder()[0];
  map.addSource(SOURCE, { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: PLAIN_ATTRIBUTION });
  if (topo?.contours) map.addSource(CONTOURS, { type: 'geojson', data: NO_LINES });
  const layers = plainLayers(colours, { ...options, topo, style });
  if (layers.some((entry) => entry.id === `${PREFIX}ref`) && !map.hasImage?.(SHIELD)) {
    const lent = derived(colours);
    map.addImage?.(SHIELD, shieldImage(lent.shield, colours.border), { pixelRatio: 2, stretchX: [[5, 19]], stretchY: [[5, 15]], content: [4, 4, 20, 16] });
  }
  for (const entry of layers) map.addLayer(entry, before);
  if (!relief?.tiles) return;
  map.addSource(RELIEF, { type: 'raster-dem', tiles: [relief.tiles], tileSize: relief.tile_size,
    maxzoom: relief.max_zoom, encoding: relief.encoding, attribution: relief.sources?.[0]?.attribution ?? '' });
  if (tinted) {
    // the heights' colours, straight over the land, under the woods, the towns and the water
    map.addLayer({ id: `${PREFIX}tints`, type: 'color-relief', source: RELIEF,
      paint: { 'color-relief-opacity': 0.85, 'color-relief-color': ['interpolate', ['linear'], ['elevation'], ...TINTS[style.tints].flat()] } },
      `${PREFIX}wood`);
  }
  const strength = shadeStrength(ground, { shaded: shade, intensity });
  if (strength > 0) {
    // over the ground and the water, under the roads and the names
    map.addLayer({ id: `${PREFIX}relief`, type: 'hillshade', source: RELIEF, paint: hillshadePaint(colours, strength, style.shade?.multidirectional) },
      map.getLayer(`${PREFIX}building`) ? `${PREFIX}building` : map.getLayer(`${PREFIX}road-casing`) ? `${PREFIX}road-casing` : undefined);
  }
}

export function hidePlain(map) {
  for (const id of map.getLayersOrder()) if (id.startsWith(PREFIX)) map.removeLayer(id);
  if (map.hasImage?.(SHIELD)) map.removeImage(SHIELD);
  for (const id of [SOURCE, RELIEF, CONTOURS]) if (map.getSource(id)) map.removeSource(id);
}

const IMAGERY_RELIEF = 'plate-imagery-relief';
const IMAGERY_HEIGHTS = 'plate-imagery-heights';

/**
 * The relief shaded over imagery, just above the picture `over` (its layer's id):
 * a soft shading that lets the slopes be read on a flat photograph. Taken away when
 * `strength` is 0 or the heights are not known.
 */
export function showImageryRelief(map, { relief = null, over, strength = 0.35 } = {}) {
  hideImageryRelief(map);
  if (!relief?.tiles || strength <= 0 || !map.getLayer(over)) return;
  map.addSource(IMAGERY_HEIGHTS, { type: 'raster-dem', tiles: [relief.tiles], tileSize: relief.tile_size,
    maxzoom: relief.max_zoom, encoding: relief.encoding, attribution: relief.sources?.[0]?.attribution ?? '' });
  const order = map.getLayersOrder();
  const above = order[order.indexOf(over) + 1];
  map.addLayer({ id: IMAGERY_RELIEF, type: 'hillshade', source: IMAGERY_HEIGHTS,
    paint: hillshadePaint({ shade: '#000000', highlight: '#ffffff' }, Math.min(1, strength), true) }, above);
}

export function hideImageryRelief(map) {
  if (map.getLayer(IMAGERY_RELIEF)) map.removeLayer(IMAGERY_RELIEF);
  if (map.getSource(IMAGERY_HEIGHTS)) map.removeSource(IMAGERY_HEIGHTS);
}
