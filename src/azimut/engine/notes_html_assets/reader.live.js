/*
 * Azimut reader, its live maps. A web folder carries this beside MapLibre GL JS
 * (engine/notes_web.py), and the reader loads it only once the page is read over the web
 * (`online` in reader.map.js): the single HTML file never holds it. Each map becomes a live
 * MapLibre map over OpenFreeMap's vector map, in the same figure and from the same data. The
 * cards, the legend, the timeline, the steps and the story stay the reader's own (`figure.azMap`),
 * which hands the drawing over (`attach`); the drawing stays under the live map until it is ready,
 * and for good when it cannot be: no WebGL, the base map out of reach, a data saver on.
 */

/** A mark's side on the screen at its own size 1, as the drawing has it. */
const MARKER_PX = 26;
/** The pixels a pictogram is drawn at from its 64-unit symbol, sharp on a dense screen. */
const ICON_PX = 128;
/** How long a step and the whole map take to fly to, as in the drawing. */
const STEP_MS = 1300;
const WHOLE_MS = 1100;
/** How long the live map has to be ready before the drawing keeps the page. */
const GIVE_UP_MS = 20000;
/** How deep the live map goes, and how wide it lets the reader see round the map. */
const MAX_ZOOM = 18;
const MIN_ZOOM = 1;
/**
 * The base a map with a ground opens on: `satellite`, the ground as filed over OpenFreeMap's map,
 * so the live map takes over from the drawing as it stands and a step looks at the pictures filed
 * for it; or `map`, OpenFreeMap's map alone, which a map with no ground always opens on.
 */
const FIRST_BASE = 'satellite';
/**
 * A map's own base (`base:` in its block) as the live map draws it: a street map or a dark one is
 * OpenFreeMap's own style alone, sharper than the picture filed for the page; a topographic map is
 * the picture filed, over OpenFreeMap's map, named as such on its switch.
 */
const OWN_BASES = {
  map: { opens: 'map', switch: false },
  dark: { opens: 'map', switch: false, style: 'dark' },
  topographic: { opens: 'satellite', switch: true, filed: 'Topographic (as filed)', hint: 'The topographic map filed with the map, as in the report' },
};
/** What a mark's name is set in, under it, as in the drawing (`LABEL_PX` of reader.map.js). */
const LABEL_PX = 11;
/** A marker looking one way: the wedge outside its rim, in its 64 units about its middle (`BEARING_WEDGE`). */
const WEDGE = 'M0 -45L9 -32H-9Z';
/** Where a plain marker's square stands so its tip is on its point, in its 64 units (`TIP_TOP`). */
const TIP_TOP = -56.3;
/** How strongly a point of each confidence is drawn, as the app's map draws it. */
const CONFIDENCE_ALPHA = { probable: 0.8, claimed: 0.55 };
/** What the base map owes, as OpenFreeMap asks it to be said. */
const BASE_CREDIT = [
  ['OpenFreeMap', 'https://openfreemap.org'],
  ['© OpenMapTiles', 'https://www.openmaptiles.org/'],
  ['Data from OpenStreetMap', 'https://www.openstreetmap.org/copyright'],
];
const FEATURES = 'az-features';
const ARROWS = 'az-arrows';

/**
 * Turn `figures` into live maps, as each comes near the screen. `said` is what the page names
 * (`script#az-gl`): the MapLibre build and its style sheet in the folder, and the base map's
 * style. `maplibre` stands in for the build (the tests'); `now` mounts every map at once.
 * Answers a promise for each map mounted at once, settling with its live map or null.
 */
export async function start(figures, said, { maplibre = null, now = false } = {}) {
  const doc = figures[0]?.ownerDocument;
  const win = doc?.defaultView;
  if (!doc || !win || win.navigator?.connection?.saveData) return [];
  if (!maplibre && !webgl(doc)) return [];
  let library = maplibre;
  if (!library) {
    await sheet(doc, said.css);
    library = await import(new URL(said.maplibre, doc.baseURI).href);
  }
  if (now || typeof win.IntersectionObserver !== 'function') return figures.map((figure) => mount(figure, said, library));
  const near = new win.IntersectionObserver((seen) => {
    for (const one of seen) {
      if (!one.isIntersecting) continue;
      near.unobserve(one.target);
      mount(one.target, said, library);
    }
  }, { rootMargin: '600px 0px' });
  for (const figure of figures) near.observe(figure);
  return [];
}

function webgl(doc) {
  try {
    const canvas = doc.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/** MapLibre's style sheet, beside the page's, loaded before its map is made. */
function sheet(doc, href) {
  return new Promise((resolve) => {
    if (!href) { resolve(); return; }
    const link = make(doc, 'link', { rel: 'stylesheet', href });
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => resolve(), { once: true });
    doc.head.append(link);
  });
}

function make(doc, tag, attrs = {}, text) {
  const node = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  if (text != null) node.textContent = text;
  return node;
}

const svgNode = (doc, tag, attrs = {}) => {
  const node = doc.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  return node;
};

const hex = (value) => (/^#[0-9a-fA-F]{6}$/.test(String(value || '')) ? String(value).toLowerCase() : '#0072b2');
const number = (value, fallback) => (Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value) : fallback);
const mercX = (lon) => (lon + 180) / 360;
const mercY = (lat) => {
  const sine = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
  return 0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI);
};

// -- what the map draws -------------------------------------------------------------------

/** The icon a point wears: its symbol in the drawing, the proof's own, or none. */
function iconOf(feature) {
  const style = feature.style || {};
  if (style.proof) return style.pov ? 'proof-pov' : 'proof';
  return String(style.icon || '');
}

/** How a line is dashed, as the app's map dashes it: its own dash, else probable dashed and claimed dotted. */
function dashOf(style) {
  if (style.dash === 'dashed' || style.dash === 'dotted') return style.dash;
  return { probable: 'dashed', claimed: 'dotted' }[style.confidence] || '';
}

/**
 * The map's features as GeoJSON, their days and their look in each one's properties, and
 * the heads of the lines that end in an arrow, each turned the way its line runs.
 */
export function geojson(data) {
  const features = [];
  const arrows = [];
  for (const feature of data.features || []) {
    const style = feature.style || {};
    const properties = { id: String(feature.id), kind: feature.kind, color: hex(style.color), width: number(style.width, 2), alpha: number(style.alpha, 1) };
    if (feature.from) properties.from = feature.from;
    if (feature.until) properties.until = feature.until;
    const dash = dashOf(style);
    if (dash) properties.dash = dash;
    let geometry = null;
    if (feature.kind === 'point') {
      properties.icon = iconOf(feature);
      properties.s = number(style.size, 1);
      if (Number.isFinite(Number(style.bearing)) && style.bearing !== null && style.bearing !== '') properties.bearing = Number(style.bearing);
      if (style.tip) properties.tip = true;
      properties.sure = CONFIDENCE_ALPHA[style.confidence] || 1;
      geometry = { type: 'Point', coordinates: feature.coords };
    } else if (feature.kind === 'line') {
      geometry = { type: 'MultiLineString', coordinates: feature.coords };
      for (const part of style.arrow ? feature.coords : []) {
        const heads = style.arrow === 'both' ? [[part.at(-2), part.at(-1)], [part[1], part[0]]] : [[part.at(-2), part.at(-1)]];
        for (const [from, to] of heads) {
          if (!from || !to) continue;
          const turn = (Math.atan2(mercX(to[0]) - mercX(from[0]), mercY(from[1]) - mercY(to[1])) * 180) / Math.PI;
          arrows.push({ type: 'Feature', geometry: { type: 'Point', coordinates: to },
            properties: { ...properties, kind: 'arrow', turn: Math.round(turn * 10) / 10 } });
        }
      }
    } else if (feature.kind === 'area') {
      properties.fill = ['none', 'hatch', 'solid'].includes(style.fill) ? style.fill : 'solid';
      properties.opacity = number(style.opacity, 0.18);
      geometry = { type: 'MultiPolygon', coordinates: feature.coords };
    }
    if (geometry) features.push({ type: 'Feature', id: properties.id, geometry, properties });
  }
  return { features: { type: 'FeatureCollection', features }, arrows: { type: 'FeatureCollection', features: arrows } };
}

/** On the map that day: from its first day to its last, both kept; every feature with no day. */
export function onDay(day) {
  if (!day) return true;
  return ['all',
    ['any', ['!', ['has', 'from']], ['<=', ['string', ['get', 'from']], day]],
    ['any', ['!', ['has', 'until']], ['<=', day, ['string', ['get', 'until']]]]];
}

const kind = (name) => ['==', ['get', 'kind'], name];
const state = (name) => ['boolean', ['feature-state', name], false];
const alpha = (value) => ['*', value, ['get', 'alpha']];
/** The dashes of the drawing, in line widths as MapLibre counts them. */
const DASHES = ['match', ['get', 'dash'],
  'dashed', ['literal', [3, 2]], 'dotted', ['literal', [0.4, 1.8]], 'claimed', ['literal', [0.8, 1.6]],
  'probable', ['literal', [3.2, 1.6]], ['literal', [1, 0]]];

/** The layers a map adds over its base, bottom to top, each with what it shows of the features. */
export function layers() {
  const area = ['all', kind('area'), ['!=', ['get', 'fill'], 'none'], ['!=', ['get', 'fill'], 'hatch']];
  const lines = kind('line');
  const outline = kind('area');
  return [
    { id: 'az-area-fill', type: 'fill', source: FEATURES, base: area,
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': alpha(['get', 'opacity']) } },
    { id: 'az-area-hatch', type: 'fill', source: FEATURES, base: ['all', kind('area'), ['==', ['get', 'fill'], 'hatch']],
      paint: { 'fill-pattern': ['concat', 'hatch-', ['slice', ['get', 'color'], 1]], 'fill-opacity': alpha(1) } },
    { id: 'az-past-fill', type: 'fill', source: FEATURES, past: true, base: area,
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': alpha(['*', 0.38, ['get', 'opacity']]) } },
    { id: 'az-past-line', type: 'line', source: FEATURES, past: true, base: ['any', lines, outline],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': alpha(0.38), 'line-dasharray': ['literal', [1.4, 1.8]] } },
    { id: 'az-area-line', type: 'line', source: FEATURES, base: ['all', outline, ['!', ['has', 'dash']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': alpha(1) } },
    { id: 'az-area-dash', type: 'line', source: FEATURES, base: ['all', outline, ['has', 'dash']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': alpha(1), 'line-dasharray': DASHES } },
    { id: 'az-line-halo', type: 'line', source: FEATURES, base: lines,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': ['+', ['get', 'width'], 3],
        // no halo but on the one pointed at or picked, as the app's map draws a line
        'line-opacity': alpha(['case', ['any', state('picked'), state('hover')], 0.95, 0]) } },
    { id: 'az-line', type: 'line', source: FEATURES, base: ['all', lines, ['!', ['has', 'dash']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': alpha(0.9) } },
    { id: 'az-line-dash', type: 'line', source: FEATURES, base: ['all', lines, ['has', 'dash']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': alpha(0.9), 'line-dasharray': DASHES } },
    { id: 'az-arrows', type: 'symbol', source: ARROWS, base: true,
      layout: { 'icon-image': ['concat', 'arrow-', ['slice', ['get', 'color'], 1]], 'icon-size': ['/', ['get', 'width'], 2],
        'icon-rotate': ['get', 'turn'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true },
      paint: { 'icon-opacity': alpha(1) } },
    { id: 'az-glow', type: 'circle', source: FEATURES, base: kind('point'),
      // a glow round the mark, past its edge as the drawing's drop shadow is
      paint: { 'circle-radius': ['*', 21, ['get', 's']], 'circle-color': '#ffffff', 'circle-blur': 0.55,
        'circle-opacity': ['case', state('away'), 0, state('picked'), 0.9, state('hover'), 0.65, state('new'), 0.75, 0] } },
    { id: 'az-bearing', type: 'symbol', source: FEATURES, base: ['all', kind('point'), ['has', 'bearing']],
      // which way a marker looks: a wedge outside its rim, under it, turned with the map
      layout: { 'icon-image': 'az-bearing', 'icon-size': ['get', 's'], 'icon-rotate': ['get', 'bearing'], 'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true, 'icon-ignore-placement': true },
      paint: { 'icon-opacity': ['case', state('away'), 0, alpha(1)] } },
    { id: 'az-points', type: 'symbol', source: FEATURES, base: kind('point'),
      // a plain marker stands on its tip, a badge or an icon on its middle
      layout: { 'icon-image': ['get', 'icon'], 'icon-size': ['get', 's'], 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'icon-anchor': ['case', ['has', 'tip'], 'bottom', 'center'],
        'icon-offset': ['case', ['has', 'tip'], ['literal', [0, ((64 + TIP_TOP) * MARKER_PX) / 64]], ['literal', [0, 0]]] },
      paint: { 'icon-opacity': ['case', state('away'), 0, ['*', alpha(1), ['coalesce', ['get', 'sure'], 1]]] } },
  ];
}

/** The layers a press on the map picks a feature from, the topmost first. */
const PICKED_FROM = ['az-points', 'az-line-halo', 'az-line', 'az-line-dash', 'az-area-line', 'az-area-dash', 'az-area-fill', 'az-area-hatch'];

// -- the pictograms ---------------------------------------------------------------------------

/** A transform as the drawing writes it on a symbol's path: translate, scale, rotate about a point. */
function transformed(context, text) {
  for (const [, name, args] of String(text || '').matchAll(/(translate|scale|rotate)\(([^)]*)\)/g)) {
    const values = args.split(/[\s,]+/).filter(Boolean).map(Number);
    if (name === 'translate') context.translate(values[0] || 0, values[1] || 0);
    else if (name === 'scale') context.scale(values[0] || 1, values[1] ?? values[0] ?? 1);
    else if (name === 'rotate') {
      const [turn = 0, x = 0, y = 0] = values;
      context.translate(x, y);
      context.rotate((turn * Math.PI) / 180);
      context.translate(-x, -y);
    }
  }
}

/** A canvas of `side` pixels, its 2D context, or null where there is none. */
function canvasOf(doc, side) {
  const canvas = doc.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext?.('2d');
  return context ? { canvas, context } : null;
}

function loaded(doc, src) {
  return new Promise((resolve) => {
    const image = new doc.defaultView.Image();
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener('error', () => resolve(null), { once: true });
    image.src = src;
  });
}

/**
 * One pictogram as pixels, drawn from the drawing's own symbol (the map's glyphs,
 * markers.json, as the engine writes them): its paths through `Path2D`, a layer's own picture
 * where it has one. Null where the page cannot draw.
 */
export async function pictogram(symbol, side = ICON_PX) {
  const doc = symbol.ownerDocument;
  const win = doc.defaultView;
  // an icon drawn past the marker's square keeps all of it, on a larger picture about the same middle
  const units = Math.max(64, Number(symbol.getAttribute('data-side')) || 64);
  side = Math.round((side * units) / 64);
  const made = canvasOf(doc, side);
  if (!made || typeof win.Path2D !== 'function') return null;
  const { context } = made;
  context.scale(side / units, side / units);
  context.translate((units - 64) / 2, (units - 64) / 2);
  for (const part of symbol.children) {
    context.save();
    if (part.localName === 'path') {
      transformed(context, part.getAttribute('transform'));
      const shape = new win.Path2D(part.getAttribute('d') || '');
      const fill = part.getAttribute('fill');
      if (fill && fill !== 'none') { context.fillStyle = fill; context.fill(shape, 'nonzero'); }
      const stroke = part.getAttribute('stroke');
      if (stroke && stroke !== 'none') {
        context.strokeStyle = stroke;
        context.lineWidth = Number(part.getAttribute('stroke-width')) || 1;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        const dash = String(part.getAttribute('stroke-dasharray') || '').split(/[\s,]+/).map(Number).filter((one) => one > 0);
        context.setLineDash?.(dash);
        context.stroke(shape);
        context.setLineDash?.([]);
      }
    } else if (part.localName === 'image') {
      const picture = await loaded(doc, part.getAttribute('href') || '');
      const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((name, at) => Number(part.getAttribute(name)) || (at > 1 ? 64 : 0));
      const ink = part.getAttribute('data-ink');
      // a silhouette in a disc is inked in the disc's glyph colour, as the drawing's filter inks it
      const inked = picture && ink ? canvasOf(doc, side) : null;
      if (inked) {
        inked.context.setTransform(context.getTransform());
        inked.context.drawImage(picture, x, y, w, h);
        inked.context.setTransform(1, 0, 0, 1, 0, 0);
        inked.context.globalCompositeOperation = 'source-in';
        inked.context.fillStyle = ink;
        inked.context.fillRect(0, 0, side, side);
        context.save();
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.drawImage(inked.canvas, 0, 0);
        context.restore();
      } else if (picture) context.drawImage(picture, x, y, w, h);
    }
    context.restore();
  }
  return context.getImageData(0, 0, side, side);
}

/** A colour's stripes for a hatched area, and its arrow head, drawn small. */
function hatch(doc, colour) {
  const made = canvasOf(doc, 16);
  if (!made) return null;
  const { context } = made;
  context.fillStyle = colour;
  context.globalAlpha = 0.12;
  context.fillRect(0, 0, 16, 16);
  context.globalAlpha = 0.6;
  context.strokeStyle = colour;
  context.lineWidth = 3;
  for (const shift of [-16, 0, 16]) {
    context.beginPath();
    context.moveTo(shift, 16);
    context.lineTo(shift + 16, 0);
    context.stroke();
  }
  return context.getImageData(0, 0, 16, 16);
}

function arrow(doc, colour) {
  const made = canvasOf(doc, 40);
  if (!made) return null;
  const { context } = made;
  context.fillStyle = colour;
  context.beginPath();
  context.moveTo(20, 2);
  context.lineTo(38, 38);
  context.lineTo(2, 38);
  context.closePath();
  context.fill();
  return context.getImageData(0, 0, 40, 40);
}

/**
 * The wedge a marker looking one way wears, pointing up before it is turned, as the drawing draws it:
 * on a square half as wide again as the marker's, as the app's map draws it, so its tip has room.
 */
function wedge(doc) {
  const side = ICON_PX * 1.5;
  const made = canvasOf(doc, side);
  if (!made || typeof doc.defaultView.Path2D !== 'function') return null;
  const { context } = made;
  context.scale(ICON_PX / 64, ICON_PX / 64);
  context.translate(48, 48);
  const shape = new doc.defaultView.Path2D(WEDGE);
  context.lineJoin = 'round';
  context.lineWidth = 3;
  context.strokeStyle = 'rgba(0, 0, 0, 0.6)';
  context.stroke(shape);
  context.fillStyle = '#ffffff';
  context.fill(shape);
  return context.getImageData(0, 0, side, side);
}

/** A mark with no pictogram of its own: a disc of its colour, ringed white. */
function disc(doc, colour) {
  const made = canvasOf(doc, ICON_PX);
  if (!made) return null;
  const { context } = made;
  context.fillStyle = colour;
  context.strokeStyle = '#ffffff';
  context.lineWidth = ICON_PX / 16;
  context.beginPath();
  context.arc(ICON_PX / 2, ICON_PX / 2, ICON_PX * 0.3, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  return context.getImageData(0, 0, ICON_PX, ICON_PX);
}

/** Every picture the map's layers name, added to the map before they are. */
async function pictures(map, figure, shaped) {
  const doc = figure.ownerDocument;
  const drawing = figure.querySelector('.az-map-stage svg.az-map-svg');
  const keys = new Map();
  const colours = new Set();
  for (const feature of shaped.features.features) {
    colours.add(feature.properties.color);
    if (feature.properties.kind !== 'point') continue;
    const symbol = feature.properties.icon && drawing?.querySelector(`[id="${figure.id}-mk-${feature.properties.icon}"]`);
    if (symbol) keys.set(feature.properties.icon, symbol);
    else feature.properties.icon = `disc-${feature.properties.color.slice(1)}`;
  }
  const add = (name, image, ratio = 1) => { if (image && !map.hasImage?.(name)) map.addImage(name, image, { pixelRatio: ratio }); };
  for (const [key, symbol] of keys) add(key, await pictogram(symbol), ICON_PX / MARKER_PX);
  if (shaped.features.features.some((feature) => feature.properties.bearing != null)) add('az-bearing', wedge(doc), ICON_PX / MARKER_PX);
  for (const colour of colours) {
    add(`hatch-${colour.slice(1)}`, hatch(doc, colour), 1);
    add(`arrow-${colour.slice(1)}`, arrow(doc, colour), 4);
    add(`disc-${colour.slice(1)}`, disc(doc, colour), ICON_PX / MARKER_PX);
  }
}

// -- one map ----------------------------------------------------------------------------------

/**
 * One figure's live map: made beside its drawing, unseen, and given the drawing's place once it
 * has drawn its base and its features. Answers a promise of its controls, or of null when the
 * drawing keeps the page.
 */
export function mount(figure, said, maplibre) {
  const reader = figure.azMap;
  let data = null;
  try { data = JSON.parse(figure.querySelector('script.az-map-data')?.textContent || 'null'); } catch { data = null; }
  const stage = figure.querySelector('.az-map-stage');
  if (!reader?.attach || !data?.features || !stage || figure.azLive) return Promise.resolve(null);
  const doc = figure.ownerDocument;
  const win = doc.defaultView;
  const reduced = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  const still = () => Boolean(reduced?.matches);
  const ident = figure.id;
  const title = data.title || 'Map';

  const holder = make(doc, 'div', { class: 'az-gl', 'aria-hidden': 'true' });
  const box = make(doc, 'div', { class: 'az-gl-map' });
  holder.append(box);
  stage.after(holder);
  const own = OWN_BASES[data.base] || null;
  let map;
  try {
    map = new maplibre.Map({
      container: box,
      style: (own?.style && said[own.style]) || said.style,
      bounds: data.bounds,
      fitBoundsOptions: { padding: 0 },
      attributionControl: false,
      cooperativeGestures: true,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      maxZoom: MAX_ZOOM,
      minZoom: MIN_ZOOM,
      fadeDuration: still() ? 0 : 200,
      locale: { 'Map.Title': `Map: ${title}. Arrows move it, plus and minus zoom` },
    });
  } catch {
    holder.remove();
    return Promise.resolve(null);
  }
  map.touchZoomRotate?.disableRotation?.();
  map.keyboard?.disableRotation?.();
  figure.azLive = { map };

  const shaped = geojson(data);
  const byId = new Map((data.features || []).map((feature) => [String(feature.id), feature]));
  const drawn = layers();
  let base = data.ground?.src ? own?.opens || FIRST_BASE : 'map';
  let day = '';
  let past = [];
  /** What a map page's layer switcher took off the map, read off the drawing as its past is. */
  let off = new Set();
  /** What the reader shares once the map is handed over (`attach`), null till then. */
  let shared = null;
  let ready = false;
  let gone = false;
  let picked = null;
  let hovered = null;
  const away = new Set();
  const flashes = new Map();
  /** The map's size as last laid out, and the view it had when the figure took the whole screen. */
  let laid = [box.clientWidth, box.clientHeight];
  let back = null;
  map.on('resize', () => { laid = [box.clientWidth, box.clientHeight]; });

  // -- what it draws ----------------------------------------------------------------------------

  async function build() {
    await pictures(map, figure, shaped);
    map.addSource(FEATURES, { type: 'geojson', data: shaped.features, promoteId: 'id' });
    map.addSource(ARROWS, { type: 'geojson', data: shaped.arrows });
    // the ground as filed, and its sharper parts, under the base map's names: the run of labels its style ends on
    const below = map.getStyle?.()?.layers || [];
    const last = below.findLastIndex((layer) => layer.type !== 'symbol');
    const names = below[last + 1]?.id;
    const grounds = [];
    if (data.ground?.bounds) grounds.push({ id: 'az-ground', src: pictureOf(data.ground.src), bounds: data.ground.bounds });
    (data.details || []).forEach((detail, index) => {
      if (detail?.bounds) grounds.push({ id: `az-detail-${index + 1}`, src: pictureOf(detail.src), bounds: detail.bounds });
    });
    for (const { id, src, bounds } of grounds) {
      if (!src) continue;
      const [west, south, east, north] = bounds;
      map.addSource(id, { type: 'image', url: src, coordinates: [[west, north], [east, north], [east, south], [west, south]] });
      map.addLayer({ id, type: 'raster', source: id, layout: { visibility: base === 'satellite' ? 'visible' : 'none' },
        paint: { 'raster-saturation': -0.38, 'raster-brightness-max': 0.86, 'raster-contrast': 0.04, 'raster-fade-duration': 0 } }, names);
    }
    for (const layer of drawn) {
      const { base: shown, past: faint, ...spec } = layer;
      map.addLayer({ ...spec, filter: faint ? ['all', shown, ['in', ['get', 'id'], ['literal', []]]] : shown });
    }
    overlay();
    tools();
    events();
  }

  /** A picture the data names by its tag's id (`#map-1-ground`), as its whole address in the folder. */
  function pictureOf(src) {
    let text = String(src || '');
    if (text.startsWith('#')) text = doc.getElementById(text.slice(1))?.getAttribute('src') || '';
    return text ? new URL(text, doc.baseURI).href : '';
  }

  // -- the day, a step, a card ---------------------------------------------------------------

  const controls = {
    map,
    /** Show the features of `day`, a line or an area gone by then faint where it last stood. */
    day(next, { quiet = false } = {}) {
      const before = day;
      day = next || '';
      // the drawing has already read which of its lines and areas are gone (`setDay`)
      past = [...stage.querySelectorAll('.az-f.az-past')].map((node) => node.dataset.id);
      // and which a map page's layer switcher took off
      off = new Set([...stage.querySelectorAll('.az-f.az-hidden')].map((node) => node.dataset.id));
      const kept = off.size ? [['!', ['in', ['get', 'id'], ['literal', [...off]]]]] : [];
      for (const layer of drawn) {
        if (!map.getLayer?.(layer.id)) continue;
        map.setFilter(layer.id, layer.past ? ['all', layer.base, ['in', ['get', 'id'], ['literal', past]]] : ['all', layer.base, onDay(day), ...kept]);
      }
      if (!quiet && before && !still()) {
        const shown = (feature) => (!feature.from || feature.from <= day) && (!feature.until || day <= feature.until);
        const was = (feature) => (!feature.from || feature.from <= before) && (!feature.until || before <= feature.until);
        flash((data.features || []).filter((feature) => feature.kind === 'point' && shown(feature) && !was(feature)).map((feature) => String(feature.id)));
      }
      keys();
      place();
    },
    /** Fly where a step looks: `{center, zoom, bearing, pitch}`; at once with motion turned down. */
    look(view, { smooth = true, focus = [] } = {}) {
      if (!view?.center) return;
      const camera = { center: view.center, zoom: number(view.zoom, map.getZoom()), bearing: number(view.bearing, 0), pitch: number(view.pitch, 0) };
      if (smooth && !still()) map.flyTo({ ...camera, duration: STEP_MS, essential: true });
      else map.jumpTo(camera);
      flash(focus);
    },
    /** Where it looks, `{center, zoom}`, for a map page's address. */
    where() {
      const center = map.getCenter();
      return { center: [center.lng, center.lat], zoom: map.getZoom() };
    },
    /** The whole map, as the drawing shows it. */
    whole() {
      map.fitBounds(data.bounds, { padding: 0, bearing: 0, pitch: 0, duration: still() ? 0 : WHOLE_MS });
    },
    /** The feature whose card is open, lit; null for none. */
    pick(id) {
      if (picked) setState(picked, { picked: false });
      picked = id ? String(id) : null;
      if (picked) setState(picked, { picked: true });
      place();
    },
    /**
     * The figure took the whole screen (`on`) or gave it back. The map is sized again on the same
     * middle, as much closer as what it showed can be while all of it stays in sight, and back again
     * to the view it had when it comes back unmoved. On the whole screen there is no page to scroll,
     * so it takes the wheel and one finger as its own.
     */
    screen(on) {
      const [w0, h0] = laid;
      if (on) back = { center: map.getCenter(), zoom: map.getZoom() };
      const unmoved = !on && back?.full && stillAt(back.full);
      map.resize?.();
      const [w1, h1] = laid;
      if (unmoved) map.jumpTo({ center: back.center, zoom: back.zoom });
      else if (w0 && h0 && w1 && h1) map.jumpTo({ center: map.getCenter(), zoom: map.getZoom() + Math.log2(Math.min(w1 / w0, h1 / h0)) });
      if (on) back.full = { center: map.getCenter(), zoom: map.getZoom() };
      else back = null;
      if (on) map.cooperativeGestures?.disable?.();
      else map.cooperativeGestures?.enable?.();
      place();
    },
  };
  const stillAt = (view) => Math.abs(map.getZoom() - view.zoom) < 1e-3
    && Math.abs(map.getCenter().lng - view.center.lng) < 1e-6 && Math.abs(map.getCenter().lat - view.center.lat) < 1e-6;

  function setState(id, values) {
    if (!byId.has(id)) return;
    try { map.setFeatureState({ source: FEATURES, id }, values); } catch { /* not drawn yet */ }
  }

  /** Light what a step or a new day brings for a moment, as the drawing does. */
  function flash(ids) {
    if (still()) return;
    for (const id of ids) {
      clearTimeout(flashes.get(id));
      setState(id, { new: true });
      flashes.set(id, setTimeout(() => { setState(id, { new: false }); flashes.delete(id); }, 1500));
    }
  }

  // -- marks spread apart, their names and the keys to reach them ---------------------------------

  let over = null;
  let leaders = null;
  let spread = null;
  let bubbles = null;
  let labels = null;
  let keyRow = null;
  let focused = null;

  function overlay() {
    const room = map.getCanvasContainer?.() || box;
    over = svgNode(doc, 'svg', { class: 'az-map-svg az-gl-over', 'aria-hidden': 'true', focusable: 'false' });
    leaders = svgNode(doc, 'g', { class: 'az-leaders' });
    spread = svgNode(doc, 'g', { class: 'az-points' });
    bubbles = svgNode(doc, 'g', { class: 'az-bubbles' });
    labels = svgNode(doc, 'g', { class: 'az-labels' });
    over.append(leaders, spread, bubbles, labels);
    room.append(over);
    keyRow = make(doc, 'div', { class: 'az-gl-keys' });
    room.append(keyRow);
    over.addEventListener('click', (event) => {
      const crowd = event.target.closest?.('.az-bubble');
      const mark = event.target.closest?.('.az-f');
      if (!crowd && !mark) return;
      event.stopPropagation();
      if (crowd) into(crowd.azIds || []);
      else reader.open(mark.dataset.id, map.getCanvas?.());
    });
  }

  /** Where a feature's key stands: a point, a line's middle corner, an area's first corner. */
  function anchorOf(feature) {
    if (feature.kind === 'point') return feature.coords;
    const line = feature.kind === 'line' ? feature.coords[0] : feature.coords[0]?.[0];
    return line?.[Math.floor((line.length - 1) / 2)] || null;
  }

  /** One key a feature, in the drawing's order, for the keyboard: Tab reaches it, Enter opens its card. */
  function keys() {
    if (!keyRow) return;
    const order = [...stage.querySelectorAll('svg.az-map-svg .az-f')];
    const shown = order.filter((node) => !node.classList.contains('az-off'));
    const kept = focused && shown.some((node) => node.dataset.id === focused.dataset.for) ? focused : null;
    keyRow.replaceChildren(...shown.map((node) => {
      if (kept && kept.dataset.for === node.dataset.id) return kept;
      const key = make(doc, 'button', { type: 'button', class: 'az-gl-key', 'aria-label': node.getAttribute('aria-label') || 'Feature' });
      key.dataset.for = node.dataset.id;
      return key;
    }));
    if (focused && !kept) focused = null;
  }

  function events() {
    keyRow.addEventListener('focusin', (event) => {
      const key = event.target.closest?.('.az-gl-key');
      if (!key) return;
      focused = key;
      const feature = byId.get(key.dataset.for);
      const at = feature && anchorOf(feature);
      if (at) {
        const point = map.project(at);
        const { clientWidth: w, clientHeight: h } = box;
        if (point.x < 24 || point.y < 24 || point.x > w - 24 || point.y > h - 24) map.easeTo({ center: at, duration: still() ? 0 : 400 });
      }
      place();
    });
    keyRow.addEventListener('focusout', (event) => { if (event.target === focused) { focused.style.transform = ''; focused = null; } });
    keyRow.addEventListener('keydown', (event) => {
      const key = event.target.closest?.('.az-gl-key');
      if (key && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        reader.open(key.dataset.for, key);
      }
    });
    box.addEventListener('keydown', (event) => {
      if (event.target.closest?.('.az-gl-key')) return;
      if (event.key === '0') { event.preventDefault(); controls.whole(); }
      else if (event.key === 'Escape') reader.close();
    });
    map.on('click', (event) => {
      const id = pickedAt(event.point);
      if (id) reader.open(id, map.getCanvas?.());
      else reader.close();
    });
    map.on('mousemove', (event) => {
      const id = pickedAt(event.point);
      if (id !== hovered) {
        if (hovered) setState(hovered, { hover: false });
        hovered = id;
        if (hovered) setState(hovered, { hover: true });
        const canvas = map.getCanvas?.();
        if (canvas) canvas.style.cursor = id ? 'pointer' : '';
      }
    });
    map.on('move', place);
    map.on('resize', place);
    map.on('moveend', () => figure.dispatchEvent(new win.CustomEvent('az-moved')));
  }

  /** The feature under a press, the marks first; never a mark spread away from that spot. */
  function pickedAt(point) {
    const box6 = [[point.x - 6, point.y - 6], [point.x + 6, point.y + 6]];
    const found = map.queryRenderedFeatures(box6, { layers: PICKED_FROM.filter((id) => map.getLayer?.(id)) }) || [];
    for (const feature of found) {
      const id = String(feature.properties?.id ?? feature.id ?? '');
      if (id && !away.has(id)) return id;
    }
    return null;
  }

  /** Move in on a crowd until its marks stand apart, as the drawing does. */
  function into(ids) {
    const points = ids.map((id) => byId.get(id)?.coords).filter(Boolean);
    if (!points.length) return;
    const lons = points.map((one) => one[0]);
    const lats = points.map((one) => one[1]);
    const bounds = [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
    const { clientWidth: w, clientHeight: h } = box;
    const camera = map.cameraForBounds?.(bounds, { padding: Math.min(w, h) * 0.22 }) || {};
    const zoom = Math.min(MAX_ZOOM, Math.max(map.getZoom() + 1, number(camera.zoom, map.getZoom() + 1)));
    const center = camera.center || [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2];
    if (still()) map.jumpTo({ center, zoom }); else map.flyTo({ center, zoom, duration: 900 });
  }

  /**
   * Each frame the map moves: the marks that would cover one another spread round their place with
   * a leader to each true spot, a crowd past a dozen a count to press, the names beside their marks
   * kept off one another, the focused key on its feature. The drawing's own rule (`arrange`).
   */
  function place() {
    if (!over || !shared) return;
    const { clientWidth: w, clientHeight: h } = box;
    over.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const shown = [];
    for (const feature of data.features || []) {
      if (feature.kind !== 'point' || off.has(String(feature.id))) continue;
      if (day && ((feature.from && feature.from > day) || (feature.until && day > feature.until))) continue;
      const at = map.project(feature.coords);
      if (at.x < -60 || at.y < -60 || at.x > w + 60 || at.y > h + 60) continue;
      shown.push({ id: String(feature.id), x: at.x, y: at.y });
    }
    const where = shared.arrange(shown, { bubbles: map.getZoom() < MAX_ZOOM - 0.3, from: shared.crowdFrom });
    const crowded = new Set(where.crowds.flatMap((crowd) => crowd.ids));
    const moved = new Set([...where.keys()].filter((id) => !crowded.has(id)));
    const hidden = new Set([...crowded, ...moved]);
    for (const id of away) if (!hidden.has(id)) { setState(id, { away: false }); away.delete(id); }
    for (const id of hidden) if (!away.has(id)) { setState(id, { away: true }); away.add(id); }
    const lines = [];
    const marks = [];
    for (const one of shown) {
      if (!moved.has(one.id)) continue;
      const [x, y] = where.get(one.id);
      const feature = byId.get(one.id);
      const colour = hex(feature.style?.color);
      const leader = svgNode(doc, 'g', { class: 'az-leader' });
      leader.append(svgNode(doc, 'line', { x1: one.x.toFixed(1), y1: one.y.toFixed(1), x2: x.toFixed(1), y2: y.toFixed(1) }),
        svgNode(doc, 'circle', { cx: one.x.toFixed(1), cy: one.y.toFixed(1), r: 2.6, fill: colour }));
      lines.push(leader);
      const size = number(feature.style?.size, 1);
      const mark = svgNode(doc, 'g', { class: `az-f az-point${picked === one.id ? ' az-picked' : ''}`, 'data-id': one.id,
        transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${((MARKER_PX * size) / 64).toFixed(4)})` });
      const icon = iconOf(feature);
      const style = feature.style || {};
      if (Number.isFinite(Number(style.bearing)) && style.bearing !== null && style.bearing !== '') {
        mark.append(svgNode(doc, 'path', { class: 'az-bearing', d: WEDGE, transform: `rotate(${Number(style.bearing)})`, fill: '#fff',
          stroke: 'rgba(0,0,0,.6)', 'stroke-width': 3, 'stroke-linejoin': 'round' }));
      }
      const use = svgNode(doc, 'use', { href: `#${ident}-mk-${icon}`, x: -32, y: style.tip ? TIP_TOP : -32, width: 64, height: 64 });
      if (CONFIDENCE_ALPHA[style.confidence]) use.setAttribute('opacity', String(CONFIDENCE_ALPHA[style.confidence]));
      mark.append(use);
      marks.push([y, mark]);
    }
    leaders.replaceChildren(...lines);
    spread.replaceChildren(...marks.sort((a, b) => a[0] - b[0]).map((one) => one[1]));
    // a count takes a press; the keyboard reaches each of its marks by its own key instead
    bubbles.replaceChildren(...where.crowds.map((crowd) => {
      const count = shared.bubble(crowd, 1);
      count.setAttribute('tabindex', '-1');
      return count;
    }));
    // the names of the marks that say theirs, top first, none over another
    const taken = [];
    const names = [];
    const atOf = new Map(shown.map((one) => [one.id, where.get(one.id) || [one.x, one.y]]));
    for (const one of shown.slice().sort((a, b) => a.y - b.y)) {
      const feature = byId.get(one.id);
      if (!feature.style?.label || crowded.has(one.id) || !feature.label) continue;
      const [x, y] = atOf.get(one.id);
      const words = String(feature.label).slice(0, 34);
      // under its mark, as the app's map writes it
      const size = number(feature.style?.label_size, LABEL_PX);
      const span = words.length * size * 0.56;
      const base = y + size * 1.75;
      const box4 = [x - span / 2, base - size * 0.8, x + span / 2, base + size * 0.25];
      if (taken.some((other) => box4[0] < other[2] && other[0] < box4[2] && box4[1] < other[3] && other[1] < box4[3])) continue;
      taken.push(box4);
      const text = svgNode(doc, 'text', { class: 'az-label', x: x.toFixed(1), y: base.toFixed(1), 'font-size': size, 'text-anchor': 'middle' });
      text.textContent = words;
      names.push(text);
    }
    // a line's or an area's name on its middle, as the drawing writes it, kept off the marks' names
    for (const feature of data.features || []) {
      if (feature.kind === 'point' || !feature.at || !feature.style?.label || !feature.label) continue;
      if (day && ((feature.from && feature.from > day) || (feature.until && day > feature.until))) continue;
      const at = map.project(feature.at);
      if (at.x < -60 || at.y < -60 || at.x > w + 60 || at.y > h + 60) continue;
      const words = String(feature.label).slice(0, 34);
      const span = words.length * LABEL_PX * 0.56;
      const box4 = [at.x - span / 2, at.y - LABEL_PX * 0.7, at.x + span / 2, at.y + LABEL_PX * 0.5];
      if (taken.some((other) => box4[0] < other[2] && other[0] < box4[2] && box4[1] < other[3] && other[1] < box4[3])) continue;
      taken.push(box4);
      const text = svgNode(doc, 'text', { class: 'az-label', x: at.x.toFixed(1), y: (at.y + LABEL_PX * 0.35).toFixed(1), 'font-size': LABEL_PX, 'text-anchor': 'middle' });
      text.textContent = words;
      names.push(text);
    }
    labels.replaceChildren(...names);
    if (focused) {
      const feature = byId.get(focused.dataset.for);
      const spot = feature?.kind === 'point' ? atOf.get(String(feature.id)) : null;
      const at = spot || (feature && anchorOf(feature) ? Object.values(map.project(anchorOf(feature))) : null);
      if (at) focused.style.transform = `translate(${Number(at[0]).toFixed(1)}px, ${Number(at[1]).toFixed(1)}px)`;
    }
    scale();
  }

  // -- tools, scale, credit, base ----------------------------------------------------------------

  let ruler = null;
  let credit = null;

  function tools() {
    const bar = make(doc, 'div', { class: 'az-map-tools' });
    const tool = (act, text, label) => make(doc, 'button', { type: 'button', 'data-act': act, title: label, 'aria-label': label }, text);
    const zooms = make(doc, 'div', { class: 'az-map-zoom' });
    zooms.append(tool('in', '+', 'Zoom in'), tool('out', '−', 'Zoom out'), tool('fit', '⤢', 'The whole map'));
    bar.append(zooms);
    // the drawing's own screen button, which the reader says as it goes (`screen` in reader.map.js)
    const screen = stage.querySelector('.az-map-screen');
    if (screen && reader.screen) bar.append(screen.cloneNode(true));
    bar.addEventListener('click', (event) => {
      const act = event.target.closest?.('button')?.dataset.act;
      const duration = still() ? 0 : 260;
      if (act === 'in') map.zoomIn({ duration });
      else if (act === 'out') map.zoomOut({ duration });
      else if (act === 'fit') controls.whole();
      else if (act === 'full') reader.screen();
    });
    holder.append(bar);
    // the north arrow the drawing wears, over the live map too
    const north = stage.querySelector('.az-map-north');
    if (north) holder.append(north.cloneNode(true));
    if (data.ground?.src && (!own || own.switch)) {
      const choice = make(doc, 'div', { class: 'az-gl-base', role: 'group', 'aria-label': 'Base map' });
      const option = (value, words, hint) => {
        const button = make(doc, 'button', { type: 'button', 'data-base': value, title: hint, 'aria-pressed': String(base === value) }, words);
        button.addEventListener('click', () => choose(value));
        return button;
      };
      choice.append(option('map', 'Map', 'OpenFreeMap, from OpenStreetMap'),
        option('satellite', own?.filed || 'Satellite (as filed)', own?.hint || 'The imagery filed with the map, as in the report'));
      holder.append(choice);
    }
    ruler = data.scale === 'off' ? null : make(doc, 'div', { class: 'az-map-scale', 'aria-hidden': 'true' });
    credit = make(doc, 'p', { class: 'az-gl-credit' });
    holder.append(...[ruler, credit].filter(Boolean));
    credits();
  }

  /** The base the map is drawn on: OpenFreeMap's map, or the ground as filed over it. */
  function choose(value) {
    base = value === 'satellite' ? 'satellite' : 'map';
    for (const id of ['az-ground', ...(data.details || []).map((_, index) => `az-detail-${index + 1}`)]) {
      if (map.getLayer?.(id)) map.setLayoutProperty(id, 'visibility', base === 'satellite' ? 'visible' : 'none');
    }
    for (const button of holder.querySelectorAll('.az-gl-base button')) button.setAttribute('aria-pressed', String(button.dataset.base === base));
    holder.dataset.base = base;
    credits();
  }

  function credits() {
    if (!credit) return;
    const parts = [];
    if (base === 'satellite' && data.ground?.credit) parts.push(make(doc, 'span', { class: 'az-gl-imagery' }, data.ground.credit));
    for (const [words, href] of BASE_CREDIT) parts.push(make(doc, 'a', { href, target: '_blank', rel: 'noopener noreferrer' }, words));
    credit.replaceChildren(...parts.flatMap((part, index) => (index ? [make(doc, 'span', { class: 'az-gl-dot' }, ' · '), part] : [part])));
  }

  /** A round distance about a hundred pixels long, at the map's middle, as the drawing's. */
  function scale() {
    if (!ruler) return;
    const lat = map.getCenter().lat;
    const metres = (40075016.7 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
    let length = 1;
    for (const step of [1, 2, 5]) for (let power = 0; power < 8; power += 1) {
      const value = step * 10 ** power;
      if (value / metres <= 110 && value > length) length = value;
    }
    ruler.style.width = `${Math.round(length / metres)}px`;
    ruler.textContent = length >= 1000 ? `${length / 1000} km` : `${length} m`;
  }

  // -- the hand-over -----------------------------------------------------------------------------

  /**
   * The live map takes the map over, still unseen: from the view the drawing shows, on its day, its
   * card lit. The reader moves it from then on; it is shown once it has drawn (`reveal`).
   */
  function take() {
    const [west, south, east, north] = reader.seen?.() || data.bounds;
    const whole = data.bounds;
    if (Math.abs(west - whole[0]) + Math.abs(east - whole[2]) > (whole[2] - whole[0]) * 0.02) {
      map.fitBounds([[west, south], [east, north]], { padding: 0, duration: 0 });
    }
    shared = reader.attach(controls);
    controls.day(shared.day, { quiet: true });
    if (shared.picked) controls.pick(shared.picked);
    // taken over on the whole screen: the map's gestures are its own already
    if (shared.full) map.cooperativeGestures?.disable?.();
  }

  /** Shown in the drawing's place, fading in over it. */
  function reveal() {
    holder.dataset.base = base;
    holder.removeAttribute('aria-hidden');
    figure.classList.add('az-gl-on');
    holder.classList.add('az-on');
  }

  // -- made, then handed over, or given up ---------------------------------------------------

  return new Promise((resolve) => {
    let tileOk = false;
    const giveUp = () => {
      if (gone) return;
      gone = true;
      clearTimeout(timer);
      if (shared) reader.attach(null);
      shared = null;
      try { map.remove(); } catch { /* already gone */ }
      holder.remove();
      figure.classList.remove('az-gl-on');
      delete figure.azLive;
      resolve(null);
    };
    const timer = setTimeout(() => { if (!ready) giveUp(); }, GIVE_UP_MS);
    map.on('error', (event) => {
      // a style that cannot be read keeps the drawing; a tile that fails is the base map's to show
      if (!ready && !event?.sourceId && !event?.tile) giveUp();
    });
    map.on('data', (event) => {
      if (event?.dataType === 'source' && event.tile && !String(event.sourceId || '').startsWith('az-')) tileOk = true;
    });
    map.getCanvas?.()?.addEventListener?.('webglcontextlost', giveUp);
    map.on('load', async () => {
      // a base with no tiles of its own has none to wait for
      tileOk ||= !Object.keys(map.getStyle?.()?.sources || {}).length;
      try {
        await build();
      } catch {
        giveUp();
        return;
      }
      if (gone) return;
      take();
      map.once('idle', () => {
        if (gone) return;
        if (!tileOk) { giveUp(); return; }
        clearTimeout(timer);
        ready = true;
        reveal();
        resolve(controls);
      });
    });
  });
}
