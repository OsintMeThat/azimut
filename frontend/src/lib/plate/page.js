/**
 * A map plate's page: its paper, its elements, and the house layout a new one opens on.
 *
 * Everything on a plate is placed in millimetres (`engine/mapplates.py` keeps the same
 * shape), and drawn at `PX_PER_MM` CSS pixels a millimetre: the page a 96 dpi screen
 * shows at its true size. The editor scales that page to fit the window, and the
 * export draws it again at print resolution, so a line is the same weight on the
 * screen and on the paper.
 */
import { mutedOf } from './design.js';

export const PX_PER_MM = 96 / 25.4;
/** Points to millimetres: text sizes are set in points, as on paper. */
export const MM_PER_PT = 25.4 / 72;

/** Paper in millimetres, portrait (`engine/mapplates.PAPERS`). `custom` reads the page's own size. */
export const PAPERS = {
  a5: { label: 'A5', size: [148, 210] },
  a4: { label: 'A4', size: [210, 297] },
  a3: { label: 'A3', size: [297, 420] },
  letter: { label: 'Letter', size: [215.9, 279.4] },
  screen: { label: 'Screen 16:9, story 9:16', size: [190.5, 338.67] },
  square: { label: 'Square 1:1', size: [200, 200] },
  social: { label: 'Post 4:5', size: [216, 270] },
  custom: { label: 'Custom size', size: null },
};

/**
 * The faces a plate is set in, each with the Arabic face behind it so a place name in
 * Arabic script is drawn rather than boxed. The files are loaded by `plateFontFaces.js`.
 */
const ARABIC = '"Noto Sans Arabic"';
export const FONTS = {
  inter: { label: 'Inter', family: `Inter, ${ARABIC}` },
  barlow: { label: 'Barlow Condensed', family: `"Barlow Condensed", ${ARABIC}` },
  condensed: { label: 'Roboto Condensed', family: `"Roboto Condensed", ${ARABIC}` },
  serif: { label: 'Source Serif', family: `"Source Serif 4", ${ARABIC}` },
  oxanium: { label: 'Oxanium', family: `Oxanium, ${ARABIC}` },
  plexmono: { label: 'IBM Plex Mono', family: `"IBM Plex Mono", ${ARABIC}` },
};
/** The family a font id names, for a canvas or an engine's text. */
export const fontFamily = (id) => (FONTS[id] ?? FONTS.inter).family;

/**
 * The faces a plate writes in, as `document.fonts.load` takes them: its own face and
 * every element's, in each weight, and upright and italic. A canvas never asks for a
 * face it lacks, so the page is drawn once they are in, not in the browser's default.
 */
export function facesOf(spec) {
  const ids = new Set([spec?.theme?.font ?? 'inter', ...(spec?.elements ?? []).map((element) => element.font).filter(Boolean)]);
  return [...ids].flatMap((id) => ['400', '600', '700', 'italic 400'].map((weight) => `${weight} 16px ${fontFamily(id)}`));
}

export const DEFAULT_THEME = { paper: '#ffffff', ink: '#15181e', accent: '#c8102e', font: 'inter', preset: '' };

/**
 * Looks a plate is set in at one press: the paper, the ink and the accent, the face,
 * and the ground its maps are drawn on.
 */
/** The imagery as it comes: what every look but a grey one leaves it as. */
export const NEUTRAL_TONE = Object.freeze({ opacity: 1, saturation: 0, brightness: 1, contrast: 0, hue: 0 });

export const THEMES = {
  press: { label: 'Press', theme: { paper: '#ffffff', ink: '#15181e', accent: '#c8102e', font: 'inter' }, ground: 'plain' },
  sand: { label: 'Sand', theme: { paper: '#efe6d2', ink: '#3a2f1f', accent: '#9b3b1a', font: 'condensed' }, ground: 'plain',
    plain: { ground: '#e9dfc7', water: '#b9c7c9', wood: '#d9d3b4', urban: '#e2d6bb', road: '#f6efe0', border: '#7d6a4f', name: '#4a3d2b' } },
  night: { label: 'Night', theme: { paper: '#12161b', ink: '#e8ebef', accent: '#f2b134', font: 'inter' }, ground: 'plain-dark' },
  report: { label: 'Report', theme: { paper: '#ffffff', ink: '#1f2a44', accent: '#0072b2', font: 'serif' }, ground: 'plain' },
  mono: { label: 'Black and white', theme: { paper: '#ffffff', ink: '#000000', accent: '#000000', font: 'plexmono' }, ground: 'plain',
    plain: { ground: '#f2f2f2', water: '#cfcfcf', wood: '#e3e3e3', urban: '#e8e8e8', road: '#ffffff', border: '#6f6f6f', name: '#2b2b2b' },
    tone: { saturation: -1 } },
  // the heights in colour and the contour lines of a survey's map, and the khaki of a staff map
  survey: { label: 'Survey', theme: { paper: '#ffffff', ink: '#2b2a26', accent: '#b4232a', font: 'condensed' }, ground: 'plain-topo' },
  staff: { label: 'Staff', theme: { paper: '#efe9d4', ink: '#24221a', accent: '#8a1c1c', font: 'barlow' }, ground: 'plain-staff' },
  // the editorial looks: a newspaper's page, a situation room's screen, a humanitarian report, an atlas
  newsroom: { label: 'Newsroom', theme: { paper: '#f7f4ee', ink: '#1b1a17', accent: '#c8102e', font: 'serif' }, ground: 'plain-news' },
  situation: { label: 'Situation room', theme: { paper: '#0e1217', ink: '#e7eaee', accent: '#ff4b3e', font: 'condensed' }, ground: 'plain-dark' },
  tactical: { label: 'Tactical', theme: { paper: '#0b1520', ink: '#d6f2ff', accent: '#4fd1ff', font: 'plexmono' }, ground: 'plain-tactical' },
  humanitarian: { label: 'Humanitarian', theme: { paper: '#ffffff', ink: '#1f2d3a', accent: '#0a77c2', font: 'inter' }, ground: 'plain-humanitarian' },
  atlas: { label: 'Atlas', theme: { paper: '#fbfaf6', ink: '#2b2a26', accent: '#8a1c1c', font: 'serif' }, ground: 'plain-relief' },
  brief: { label: 'Brief', theme: { paper: '#ffffff', ink: '#111418', accent: '#d4351c', font: 'barlow' }, ground: 'plain-grey' },
};

/**
 * A plate in one of the looks: the page's paper, ink, accent and face, every map's
 * plain ground and its palette, and the imagery's whole tone, which a look that is
 * not grey sets back to as it comes. The backings of the legend, the scale and the
 * north follow the paper.
 */
export function inLook(spec, id) {
  const preset = THEMES[id];
  if (!preset) return spec;
  return {
    ...spec,
    theme: { ...spec.theme, ...preset.theme, preset: id },
    elements: spec.elements.map((element) => {
      if (element.kind === 'map' || element.kind === 'inset') {
        const plain = String(element.basemap ?? 'plain').startsWith('plain');
        return { ...element, ...(plain ? { basemap: preset.ground, plain: { ...(element.plain ?? {}), colours: { ...(preset.plain ?? {}) } } } : {}),
          tone: { ...NEUTRAL_TONE, ...(preset.tone ?? {}) } };
      }
      // what wore the page's paper, ink, accent or muted ink wears the new ones; a colour of its own stays
      const swap = (hex) => {
        const was = String(hex ?? '').toLowerCase();
        if (!was) return hex;
        if (was === String(spec.theme.paper).toLowerCase()) return preset.theme.paper;
        if (was === String(spec.theme.ink).toLowerCase()) return preset.theme.ink;
        if (was === String(spec.theme.accent).toLowerCase()) return preset.theme.accent;
        if (was === mutedOf(spec.theme).toLowerCase()) return mutedOf(preset.theme);
        return hex;
      };
      if (element.kind === 'qr') return element;
      return { ...element, ...(element.fill ? { fill: swap(element.fill) } : {}), ...(element.colour ? { colour: swap(element.colour) } : {}) };
    }),
  };
}

/** What each kind of element is called where the analyst reads it. */
export const KIND_LABELS = {
  map: 'Map', inset: 'Inset map', legend: 'Legend', text: 'Text', scale: 'Scale bar', north: 'North arrow',
  image: 'Picture', label: 'Label', arrow: 'Arrow', credits: 'Credits', shape: 'Shape', ring: 'Range rings',
  cone: 'View cone', zone: 'Zone', measure: 'Distance', key: 'Numbered list', table: 'Table', qr: 'QR code',
  timeline: 'Date strip', signature: 'Signature', brand: 'Made with Azimut', video: 'Video', line: 'Line', symbol: 'Symbol',
};

/** The kinds that stand on a map's ground: placed by a press on a map, kept out of templates. */
export const ON_THE_GROUND = ['label', 'arrow', 'ring', 'cone', 'zone', 'measure', 'line', 'symbol'];
/** The kinds on the ground held by a box of their own on the page, moved and sized by it: a label, a symbol. */
export const BOXED_ON_THE_GROUND = ['label', 'symbol'];
/** The kinds a plate draws as maps, under everything else. */
export const MAP_KINDS = ['map', 'inset'];
/** At most this many maps and insets on a plate: each is a live map, and a browser draws only so many at once (`engine/mapplates.MAX_MAPS`). */
export const MAX_MAPS = 8;
/** The words that say so, wherever a map would be one too many. */
export const TOO_MANY_MAPS = `A plate holds ${MAX_MAPS} maps and insets at most: the browser draws only so many at once`;
/** How many maps and insets `elements` hold; a globe inset is drawn on the page, not as a live map, and is not one. */
export const mapCount = (elements) => elements.filter((element) => MAP_KINDS.includes(element.kind) && !element.globe).length;

/** The view an inset is drawn at over its map's view `of`: the same centre, its own zoom or four and a half levels out, north up. */
export const insetView = (inset, of) => ({ lat: of.lat, lon: of.lon, zoom: inset.zoom ?? Math.max(0, of.zoom - 4.5), bearing: 0 });

/**
 * What a plate's map can lay over its ground: the relief shading, then the key-less
 * layers the Map draws (`map/basemap.js`), each credited on the page. Live fires are
 * left out: they need a key and say "now", where a plate says its own day.
 */
export const PLATE_OVERLAYS = [['relief', 'Relief shading'], ['boundaries', 'Borders and big names'], ['placenames', 'Town and village names'],
  ['roads', 'Roads, drawn over imagery'], ['railway', 'Railways'], ['power', 'Power lines and plants'], ['seamarks', 'Sea marks'],
  ['gpstraces', 'GPS traces'], ['nightlights', 'Night lights']];

/** A text on the map, a label without a leader, or a symbol: it stands over its point however the map is framed. */
export const standsOver = (element) => (element.kind === 'symbol' || (element.kind === 'label' && element.leader === 'none')) && !!element.at && !!element.of;

/** The symbol a new one is: a marker of the case's layers (`map/layerSymbols.json`). */
export const SYMBOL = Object.freeze({ symbol: 'badge-crosshair', size: 7 });

/**
 * A label's box round its words, from its top left corner: the width its longest line
 * takes. `measure(line)` gives a line's width in millimetres when the face is known
 * (`textMeasurer`); without it, a fair guess from the letter count.
 */
export function labelBox(element, measure = null) {
  const lines = String(element.text || ' ').split('\n');
  const size = element.size ?? 9;
  const framed = element.style && element.style !== 'plain';
  if (element.style === 'number') {
    const side = Math.max(4, size * MM_PER_PT * 1.7);
    return [element.box[0], element.box[1], round(side), round(side)];
  }
  const longest = measure ? Math.max(...lines.map((line) => measure(line, element))) : Math.max(...lines.map((line) => line.length)) * size * 0.19;
  const width = Math.min(160, Math.max(8, longest + (framed ? 3 : 1)));
  const height = Math.max(4, lines.length * size * MM_PER_PT * (element.leading ?? 1.2) + (framed ? 2 : 0.5));
  return [element.box[0], element.box[1], round(width), round(height)];
}

/** A canvas measure of a line in millimetres, in the element's face, size and weight. */
export function textMeasurer(theme, ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')) {
  return (line, element) => {
    if (!ctx) return String(line).length * (element.size ?? 9) * 0.19;
    const size = (element.size ?? 9) * MM_PER_PT * 10;
    ctx.font = `${element.italic ? 'italic ' : ''}${element.weight ?? 600} ${size}px ${fontFamily(element.font ?? theme?.font)}, sans-serif`;
    const text = element.upper ? String(line).toUpperCase() : String(line);
    return (ctx.measureText(text).width + text.length * size * (element.tracking ?? 0) / 100) / 10;
  };
}

/** The page's width and height in millimetres, turned as it is set; a custom paper as given. */
export function pageSize(page) {
  if (page?.paper === 'custom' && Array.isArray(page.size)) return { width: page.size[0], height: page.size[1] };
  const [width, height] = (PAPERS[page?.paper]?.size ?? PAPERS.a4.size);
  return page?.orientation === 'portrait' ? { width, height } : { width: height, height: width };
}

/** Whether a paper can be turned: a square, or a size typed in, cannot. */
export const turnable = (page) => page?.paper !== 'square' && page?.paper !== 'custom';

/** How far the editor zooms the page: from a tenth of its true size up to eight times it. */
export const PAGE_ZOOM = { min: 0.1, max: 8 };

/**
 * Where the editor shows the page when it fits the window, a margin round it:
 * `{ scale, x, y }`, x and y where the page's corner stands in the window. `top`
 * is kept clear over it, for a bar floating there.
 */
export function fitPage(page, viewport, margin = 24, top = 0) {
  const tall = viewport.height - top;
  const scale = Math.max(PAGE_ZOOM.min, Math.min((viewport.width - 2 * margin) / page.width, (tall - 2 * margin) / page.height));
  return { scale, x: (viewport.width - page.width * scale) / 2, y: top + (tall - page.height * scale) / 2 };
}

/** The most pixels the editor's drawing of a page holds, about 64 MB. */
export const DECOR_MAX_PIXELS = 16_000_000;

/**
 * Canvas pixels a CSS pixel of the page holds while the editor shows it at `scale`
 * (`page` in CSS pixels), so a page zoomed past its true size is drawn again sharp
 * rather than stretched. It climbs in steps of √2, so a wheel turn redraws a few
 * times, and stops at `DECOR_MAX_PIXELS`.
 */
export function decorDensity(page, scale, dpr = 1) {
  if (!(scale > 1)) return dpr;
  const wanted = dpr * scale;
  const stepped = Math.SQRT2 ** Math.ceil(Math.log(wanted) / Math.log(Math.SQRT2) - 1e-9);
  const room = Math.sqrt(DECOR_MAX_PIXELS / Math.max(1, page.width * page.height));
  return Math.max(dpr, Math.min(stepped, room));
}

/** The page zoomed by `factor` round a point of the window, which keeps the paper under it. */
export function zoomPageAt(camera, factor, [px, py]) {
  const scale = Math.min(PAGE_ZOOM.max, Math.max(PAGE_ZOOM.min, camera.scale * factor));
  const k = scale / camera.scale;
  return { scale, x: px - (px - camera.x) * k, y: py - (py - camera.y) * k };
}

let counter = 0;
/** A fresh element id, unique within the session and short enough for the backend's bound. */
export function newId(kind) {
  counter += 1;
  return `${kind}${Date.now().toString(36)}${counter.toString(36)}`.slice(-40);
}

/** The plate's main map: the first one placed that is not a detail of another. */
export function mainMap(spec) {
  const maps = spec?.elements?.filter((element) => element.kind === 'map') ?? [];
  return maps.find((element) => !element.of) ?? maps[0] ?? null;
}

/**
 * Maps first, the rest after, each keeping its order. Maps are drawn under the page's
 * writing, so a list where a map came later would pick it over what is drawn on it.
 */
export function mapsFirst(elements) {
  return [...elements.filter((element) => MAP_KINDS.includes(element.kind)),
    ...elements.filter((element) => !MAP_KINDS.includes(element.kind))];
}

// -- the order the editor lists ------------------------------------------------------

/** The elements the editor lists, top first: the day's and the shown step's, another step's waiting on it. */
export function listedOf(spec, at, place) {
  return [...spec.elements].reverse().filter((element) => !element.step || shownOn(element, at, place));
}

/** The place in that list, top first, a row taken to `index` can have: the writing stays above the maps, a map among them. */
export function landingIn(list, id, index) {
  const maps = list.findIndex((element) => MAP_KINDS.includes(element.kind));
  const floor = maps < 0 ? list.length : maps;
  if (MAP_KINDS.includes(list.find((element) => element.id === id)?.kind)) return Math.min(list.length, Math.max(floor, index));
  return Math.max(0, Math.min(floor, index));
}

/**
 * The page's elements once `id` lands at `index` of the list (`listedOf`), above the
 * row listed there. What the list leaves out keeps its place; the same elements come
 * back when the row would not move.
 */
export function restacked(elements, list, id, index) {
  const from = list.findIndex((element) => element.id === id);
  const to = landingIn(list, id, index);
  if (from < 0 || to === from || to === from + 1) return elements;
  const whole = [...elements].reverse();
  const [moved] = whole.splice(whole.findIndex((element) => element.id === id), 1);
  const above = list[to];
  const at = above ? whole.findIndex((element) => element.id === above.id) : whole.findIndex((element) => element.id === list.at(-1).id) + 1;
  whole.splice(at, 0, moved);
  return mapsFirst(whole.reverse());
}

/** Where one step forward (`by` 1) or back (-1) takes a row of the list, or null when it can go no further. */
export function stepOf(list, id, by) {
  const from = list.findIndex((element) => element.id === id);
  if (from < 0) return null;
  const to = landingIn(list, id, by > 0 ? from - 1 : from + 2);
  return to === from || to === from + 1 ? null : to;
}

/** The ids of the house layout, which a change of paper lays out again rather than stretches. */
export const HOUSE_IDS = ['map', 'title', 'subtitle', 'legend', 'inset', 'cartouche', 'scale', 'north', 'credits'];

/** The boxes of the house layout on a page: a column beside the map when landscape, a band under it when upright. */
function houseBoxes(page) {
  const { width, height } = pageSize(page);
  const margin = Math.max(6, Math.round(Math.min(width, height) * 0.045));
  const band = 16;
  const mapTop = margin + band;
  if (height > width * 1.05) {
    // upright: the map across the page, the legend, the inset and the cartouche under it
    const under = Math.round(Math.min(70, height * 0.24));
    const mapWidth = width - 2 * margin;
    const mapHeight = height - mapTop - margin - under - 10;
    const row = mapTop + mapHeight + 7;
    const third = (mapWidth - 8) / 3;
    return {
      map: [margin, mapTop, mapWidth, mapHeight],
      title: [margin, margin - 1, mapWidth, 9],
      subtitle: [margin, margin + 8, mapWidth, 6],
      credits: [margin, mapTop + mapHeight + 1, mapWidth, 5],
      legend: [margin, row, third * 1.4, under],
      inset: [margin + third * 1.4 + 4, row, third * 0.9, under],
      cartouche: [margin + third * 2.3 + 8, row, third * 0.7, under],
      scale: [margin + 4, mapTop + mapHeight - 10, 40, 6],
      north: [margin + mapWidth - 12, mapTop + 4, 8, 12],
    };
  }
  const column = Math.min(70, Math.round(width * 0.24));
  const mapWidth = width - 2 * margin - column - 6;
  const mapHeight = height - mapTop - margin - 7;
  const right = margin + mapWidth + 6;
  const legendHeight = Math.round(mapHeight * 0.45);
  const insetHeight = Math.round(mapHeight * 0.28);
  return {
    map: [margin, mapTop, mapWidth, mapHeight],
    title: [margin, margin - 1, mapWidth, 9],
    subtitle: [margin, margin + 8, mapWidth, 6],
    credits: [margin, mapTop + mapHeight + 1, mapWidth, 5],
    legend: [right, mapTop, column, legendHeight],
    inset: [right, mapTop + legendHeight + 4, column, insetHeight],
    cartouche: [right, mapTop + legendHeight + insetHeight + 8, column, mapHeight - legendHeight - insetHeight - 8],
    scale: [margin + 4, mapTop + mapHeight - 10, 40, 6],
    north: [margin + mapWidth - 12, mapTop + 4, 8, 12],
  };
}

/**
 * The house layout a new plate opens on, for a page of that paper: a title band, the
 * map, the legend, an inset and the cartouche (beside the map, or under it on an
 * upright page), the scale and the north on the map, and the credits under it.
 * The title names the case by its token, so a template made from it names the next one.
 */
export function houseLayout({ paper = 'a4', orientation = 'landscape', view = null, layers = [] } = {}) {
  const page = { paper, orientation };
  const boxes = houseBoxes(page);
  const box = (id) => boxes[id].map(round);
  const map = { id: 'map', kind: 'map', box: box('map'),
    view: view ?? { lat: 48.85, lon: 2.35, zoom: 9, bearing: 0 }, basemap: 'plain', overlays: ['relief'],
    layers: layers.map((name) => ({ name, hidden: [], stroke: 1, icons: 1 })), grid: 'none' };
  return {
    page,
    theme: { ...DEFAULT_THEME },
    time: { at: null, trail: true, since: null, window: null },
    elements: [
      map,
      { id: 'inset', kind: 'inset', box: box('inset'), of: 'map', zoom: null, border: true },
      { id: 'title', kind: 'text', box: box('title'), text: '{case}', size: 18, weight: 700, align: 'left', name: 'Title' },
      { id: 'subtitle', kind: 'text', box: box('subtitle'), text: 'Situation as of {date}', size: 10, weight: 400, align: 'left', name: 'Subtitle' },
      { id: 'legend', kind: 'legend', box: box('legend'), of: 'map', size: 8, border: true, columns: 1 },
      { id: 'cartouche', kind: 'text', box: box('cartouche'), text: '{case}\nMade {today}', size: 7, weight: 400, align: 'left', border: true, name: 'Cartouche' },
      { id: 'scale', kind: 'scale', box: box('scale'), of: 'map', fill: '#ffffff' },
      { id: 'north', kind: 'north', box: box('north'), of: 'map', fill: '#ffffff' },
      { id: 'credits', kind: 'credits', box: box('credits'), of: 'map', size: 5.5, align: 'right' },
    ],
  };
}

/** The kinds whose drawing has its own proportions: on another paper they grow evenly, never stretch. */
const EVEN = ['north', 'scale', 'image', 'qr', 'label', 'key'];

/**
 * The same plate on another paper or turned. The house layout's own elements are laid
 * out again for the new page, so an upright page gets the upright layout; everything
 * else keeps its share of the page, and what has its own proportions (a north arrow, a
 * picture, a label) keeps them.
 */
export function onPaper(spec, page) {
  const before = pageSize(spec.page);
  const after = pageSize(page);
  const sx = after.width / before.width;
  const sy = after.height / before.height;
  const even = Math.min(sx, sy);
  const house = HOUSE_IDS.every((id) => spec.elements.some((element) => element.id === id));
  const boxes = house ? houseBoxes(page) : null;
  return {
    ...spec,
    page,
    elements: spec.elements.map((element) => {
      if (boxes?.[element.id]) return { ...element, box: boxes[element.id].map(round) };
      const [x, y, w, h] = element.box;
      const box = EVEN.includes(element.kind)
        ? [(x + w / 2) * sx - (w * even) / 2, (y + h / 2) * sy - (h * even) / 2, w * even, h * even]
        : element.kind === 'text' ? [x * sx, y * sy, w * sx, h * Math.max(even, Math.min(sx, sy, 1))]
          : [x * sx, y * sy, w * sx, h * sy];
      return { ...element, box: box.map(round) };
    }),
  };
}

const round = (value) => Math.round(value * 10) / 10;

/**
 * A plate's layout with its data taken out, as a template keeps it
 * (`engine/mapplates.template_of`): no ground, no layers, no case pictures, no days.
 * A picture kept inside the plate, or the signature, is layout and stays.
 */
export function templateOf(spec) {
  return {
    page: { ...spec.page },
    theme: { ...spec.theme },
    // how long a day holds in the video is the layout's; no day of its own is
    time: spec.time?.hold ? { hold: spec.time.hold } : {},
    ...(spec.transitions ? { transitions: { ...spec.transitions } } : {}),
    elements: spec.elements
      .filter((element) => !ON_THE_GROUND.includes(element.kind) && element.kind !== 'video' && !element.step)
      // eslint-disable-next-line no-unused-vars
      .map(({ view, layers, names, release, onward, until, layer, at, to, ref, points, step, carry, ...kept }) => {
        if (kept.src && kept.src !== SIGNATURE) delete kept.src;
        return kept;
      }),
  };
}

/** A picture's `src` naming the signature badge set in Settings. */
export const SIGNATURE = '@signature';

/** Where a template's map looks over `view`: there, or two and a half levels closer for a detail of another map. */
const framedFor = (element, view) => (element.of ? { ...view, zoom: Math.min(20, view.zoom + 2.5) } : { ...view });

/**
 * A new plate from a template: its maps look where `view` says and draw `layers`.
 * An element reading a map the template does not hold is left out.
 */
export function fromTemplate(data, { view, layers = [] } = {}) {
  const maps = new Set(data.elements.filter((element) => element.kind === 'map').map((element) => element.id));
  return {
    ...(data.ready ? { ready: data.ready } : {}),
    page: { ...data.page },
    theme: { ...DEFAULT_THEME, ...data.theme },
    time: { at: null, trail: true, since: null, window: null, ...(data.time?.hold ? { hold: data.time.hold } : {}) },
    ...(data.transitions ? { transitions: { ...data.transitions } } : {}),
    elements: mapsFirst(data.elements
      .filter((element) => !element.of || maps.has(element.of))
      .map((element) => element.kind === 'map'
        ? { ...element, view: framedFor(element, view ?? { lat: 20, lon: 0, zoom: 1, bearing: 0 }),
          layers: layers.map((name) => ({ name, hidden: [], stroke: 1, icons: 1 })) }
        : { ...element })),
  };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December'];

/** A day as a page writes it: `12 October 2026`, and the time after it when there is one. */
export function longDay(moment) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?$/.exec(String(moment ?? ''));
  if (!match) return '';
  const day = `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
  return match[4] ? `${day}, ${match[4]}` : day;
}

/**
 * The words a plate's text stands for: `{date}` the day the plate is drawn on, else
 * the day its layers last changed (`updated`), else today; `{today}`, `{case}`,
 * `{title}`, `{updated}`, `{scale}` (the main map's, as `1:25,000`), `{imagery}` (the
 * date of the Wayback release the main map shows), `{handle}` (the signature's, from
 * Settings), `{coords}` and `{mgrs}` (the main map's middle, as the app writes
 * coordinates and as MGRS), `{from}` and `{to}` (the first and last day a played plate
 * shows), and `{count}` (what the main map shows in its frame on the plate's day),
 * `{count:destroyed}` or `{count:damaged}` (of that state) and `{count:<group>}` (of a
 * group), each counted by `count(key)`.
 */
export function fillTokens(text, { date = null, updated = '', imagery = '', caseName = '', title = '', scale = '', handle = '', coords = '', mgrs = '',
  from = '', to = '', count = null, today = new Date() } = {}) {
  // today on this computer's calendar, not on UTC's, which is still yesterday after midnight east of it
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  // a line holding a word that fills in empty (no handle set, no imagery dated) drops the separators it leaves at its ends
  const empty = Object.entries({ '{handle}': handle, '{imagery}': imagery, '{coords}': coords, '{mgrs}': mgrs, '{from}': from, '{to}': to,
    '{case}': caseName, '{title}': title, '{scale}': scale }).filter(([, value]) => !value).map(([token]) => token);
  return String(text ?? '').split('\n').map((line) => (empty.some((token) => line.includes(token)) ? tidied(fill(line)) : fill(line))).join('\n');

  function fill(line) {
    return line
      .replaceAll('{date}', longDay(date) || longDay(updated) || longDay(iso))
      .replaceAll('{today}', longDay(iso))
      .replaceAll('{updated}', longDay(updated) || longDay(iso))
      .replaceAll('{case}', caseName)
      .replaceAll('{title}', title)
      .replaceAll('{scale}', scale)
      .replaceAll('{imagery}', imagery)
      .replaceAll('{handle}', handle)
      .replaceAll('{coords}', coords)
      .replaceAll('{mgrs}', mgrs)
      .replaceAll('{from}', longDay(from))
      .replaceAll('{to}', longDay(to))
      .replace(/\{count(?::([^{}]{1,60}))?\}/g, (_, key = '') => String(count?.(key.trim()) ?? 0));
  }
}

/** A line with the separators a missing word left at its ends, or doubled in its middle, taken away. */
function tidied(line) {
  return line.replace(/\s*([·,|/–—-]\s*){2,}/g, ' · ').replace(/\s+[,;:](?=\s)/g, '').replace(/^[\s·,|/–—-]+/, '')
    .replace(/[\s·,|/–—:-]+$/, '').replace(/\s+\./g, '.');
}

/** The words `fillTokens` knows, as the inspector lists them. */
export const TOKENS = ['{date}', '{today}', '{updated}', '{case}', '{title}', '{scale}', '{imagery}', '{handle}', '{coords}', '{mgrs}', '{from}', '{to}',
  '{count}', '{count:destroyed}'];

/** What each of the words says once filled in, as a hover on it says. */
export const TOKEN_SAID = {
  '{date}': 'The plate\'s day, else the day its layers last changed',
  '{today}': 'Today',
  '{updated}': 'The day the plate\'s layers last changed',
  '{case}': 'The case\'s name',
  '{title}': 'The plate\'s name',
  '{scale}': 'The main map\'s scale, as 1:25,000',
  '{imagery}': 'The date of the imagery the main map shows',
  '{handle}': 'Your handle, set in Settings › Publishing',
  '{coords}': 'The main map\'s middle, as the app writes coordinates',
  '{mgrs}': 'The main map\'s middle, in MGRS',
  '{from}': 'The first day the plate plays',
  '{to}': 'The last day the plate plays',
  '{count}': 'How many features the main map shows; {count:<group>} counts one group',
  '{count:destroyed}': 'How many it shows destroyed; {count:damaged} counts the damaged',
};

// -- the days an annotation is shown on ------------------------------------------------

/**
 * What a plate with no day keeps its steps, held seconds and framings under: its page,
 * the layers as they stand. A plate whose layers change is always on a day of the
 * calendar instead (`settleOn`). The key is "now", the name it had when a played
 * plate could stand on a now that slid to the next day.
 */
export const PAGE = 'now';

/** The plate's day as its steps, its seconds and its framings are kept under: a moment, or the page. */
export const dayOf = (at) => at ?? PAGE;

/** Whether `a` comes before `b`, the page after every moment. */
export function dayBefore(a, b) {
  if (a === b) return false;
  if (a === PAGE) return false;
  if (b === PAGE) return true;
  return a < b;
}

/** Whether the last day `until` is over by `day`: a day without its time lasts until it ends. */
const over = (until, day) => dayBefore(until, day === PAGE ? day : day.slice(0, until.length));

/** Whether an element belongs to some days rather than to every day. */
export const dated = (element) => !!(element.onward || element.until);

/** The element shown from `day` on, its end pulled along when it came before. No day: from the first. */
export function startOn(element, day) {
  const onward = day || null;
  const pulled = onward && element.until && over(element.until, onward);
  return { ...element, onward, until: pulled ? (onward === PAGE ? null : onward) : element.until ?? null };
}

/** The element shown up to `day`, its start pulled back when it came after. No day, or the page: to the last. */
export function endOn(element, day) {
  const until = day && day !== PAGE ? day : null;
  const pulled = until && element.onward && over(until, element.onward);
  return { ...element, onward: pulled ? until : element.onward ?? null, until };
}

/** The element's days stretched to reach the day `at`, the ones between with them. */
export function bringTo(element, at) {
  if (shownOn(element, at)) return element;
  const day = dayOf(at);
  return element.onward && dayBefore(day, element.onward) ? startOn(element, day) : endOn(element, day);
}

/** The element shown on `at` and every day after it. */
export const carryOn = (element, at) => endOn(bringTo(element, at), null);

/** The days an element is shown on, in a few words; `label` names a day. */
export function periodSaid(element, label) {
  const { onward, until } = element;
  if (!onward && !until) return 'Every day';
  if (onward === PAGE) return 'Only on the page';
  if (onward === until) return `Only on ${label(onward)}`;
  if (!until) return `From ${label(onward)} on`;
  return onward ? `${label(onward)} to ${label(until)}` : `Up to ${label(until)}`;
}

/** A new annotation on a played plate belongs to the day it is made on. */
export const bornOn = (at, playable) => (playable ? endOn(startOn({}, dayOf(at)), dayOf(at)) : {});

/** Whether a plate whose layers change still stands on no day, or keeps something under its page. */
export function unsettled(spec) {
  if (!spec) return false;
  if (!spec.time?.at) return true;
  if ([spec.steps, spec.holds, spec.framing].some((table) => table && PAGE in table)) return true;
  return (spec.elements ?? []).some((element) => element.onward === PAGE || element.until === PAGE);
}

/**
 * A plate whose layers change, put on the day `day` when it stands on none, and with
 * what it kept under its page moved there: its steps after the day's own, its held
 * seconds and framings where the day has none, the annotations made on it. What a
 * plate made before stood on "now" stood on the day it was last saved, which is the
 * day to give, so it opens where it was left. Answers the fields that change.
 */
export function settleOn(spec, day) {
  const steps = { ...(spec.steps ?? {}) };
  if (PAGE in steps) {
    steps[day] = [...(steps[day] ?? []), ...steps[PAGE]].slice(0, MAX_STEPS);
    delete steps[PAGE];
  }
  const held = (table) => {
    const out = { ...(table ?? {}) };
    if (PAGE in out) {
      if (!(day in out)) out[day] = out[PAGE];
      delete out[PAGE];
    }
    return out;
  };
  const framing = held(spec.framing);
  if (spec.framing?.[PAGE] && spec.framing?.[day]) framing[day] = { ...spec.framing[PAGE], ...spec.framing[day] };
  const kept = new Set(Object.values(steps).flat().map((step) => step.id));
  // made on the page, an annotation was shown only there: it is the day's alone; up to the page, it runs on
  const elements = (spec.elements ?? []).filter((element) => !element.step || kept.has(element.step))
    .map((element) => (element.onward === PAGE ? { ...element, onward: day, until: day }
      : element.until === PAGE ? { ...element, until: null } : element));
  return { time: { ...spec.time, at: spec.time?.at ?? day }, steps, holds: held(spec.holds), framing, elements };
}

// -- the steps of a day ------------------------------------------------------------------

/** How long a step without a video holds, in seconds, unless it is set. */
export const STEP_SECONDS = 3;
/** At most this many steps on one day. */
export const MAX_STEPS = 30;

/** The steps of the plate's day `at`, in order. */
export const stepsOf = (spec, at) => spec?.steps?.[dayOf(at)] ?? [];

/**
 * Where the plate is within its day, as `shownOn` reads it: the ids of the day's
 * steps, and the one shown (-1 for the day itself, before any step).
 */
export function placeOf(spec, at, step = spec?.time?.step ?? null) {
  const steps = stepsOf(spec, at).map((item) => item.id);
  return { steps, index: step ? steps.indexOf(step) : -1 };
}

/** The step the plate is on, when its day holds it, else null: the day itself. */
export function currentStep(spec, at, step = spec?.time?.step ?? null) {
  return (step && stepsOf(spec, at).find((item) => item.id === step)) || null;
}

/**
 * Whether an element is shown on the plate's day `at`, at the step `place` says. An
 * element of a step is shown on that step only, or on it and the steps after it when
 * it is carried; an element of the day shows on every step of it. An element of the
 * day is shown from `onward` to `until`, both kept; without `onward` it runs from the
 * first day, without `until` up to now, and with neither it is shown every day.
 */
export function shownOn(element, at, place = null) {
  if (element.step) {
    const index = place?.steps?.indexOf(element.step) ?? -1;
    if (index < 0) return false;
    return element.carry ? place.index >= index : place.index === index;
  }
  const day = dayOf(at);
  if (element.onward && dayBefore(day, element.onward)) return false;
  return !element.until || !over(element.until, day);
}

/** A new element made while the plate is on a step belongs to it, else to the day as `bornOn` says. */
export const bornAt = (at, playable, step) => (step ? { step, carry: false, onward: null, until: null } : bornOn(at, playable));

/** A new step for the day `at`, after the step `after` (null: first), and the plate's steps with it. */
export function addStep(spec, at, after = null, step = { id: newId('s'), name: '', duration: STEP_SECONDS }) {
  const day = dayOf(at);
  const list = [...stepsOf(spec, at)];
  const index = after ? list.findIndex((item) => item.id === after) + 1 : 0;
  list.splice(Math.max(0, index), 0, step);
  return { steps: { ...(spec.steps ?? {}), [day]: list.slice(0, MAX_STEPS) }, step };
}

/**
 * The plate without the step `id`, and without what belongs to it. A day left
 * without steps is no longer listed.
 */
export function withoutStep(spec, id) {
  const steps = {};
  for (const [day, list] of Object.entries(spec.steps ?? {})) {
    const kept = list.filter((item) => item.id !== id);
    if (kept.length) steps[day] = kept;
  }
  const framing = Object.fromEntries(Object.entries(spec.framing ?? {}).filter(([key]) => key !== id));
  return { ...spec, steps, framing, elements: spec.elements.filter((element) => element.step !== id),
    time: { ...spec.time, step: spec.time?.step === id ? null : spec.time?.step ?? null } };
}

/**
 * The plate with a copy of the step `id` of the day `at` played right after it: its
 * name, its seconds and how it comes in, what stands on it (each copied with an id of
 * its own, its group kept together) and how it frames the maps.
 * `{ steps, framing, elements, step }`, or null when the day holds no such step.
 */
export function duplicatedStep(spec, at, id) {
  const list = stepsOf(spec, at);
  const source = list.find((item) => item.id === id);
  if (!source || list.length >= MAX_STEPS) return null;
  const step = { ...source, id: newId('s'), ...(source.name ? { name: `${source.name}, again` } : {}) };
  const { steps } = addStep(spec, at, id, step);
  const groups = new Map();
  const regroup = (group) => (group ? (groups.get(group) ?? groups.set(group, newId('g')).get(group)) : group);
  const copies = spec.elements.filter((element) => element.step === id)
    .map((element) => ({ ...JSON.parse(JSON.stringify(element)), id: newId(element.kind), step: step.id, group: regroup(element.group) }));
  const framing = { ...(spec.framing ?? {}), ...(spec.framing?.[id] ? { [step.id]: { ...spec.framing[id] } } : {}) };
  return { steps, framing, elements: mapsFirst([...spec.elements, ...copies]), step: step.id };
}

/** The day's steps with `id` moved to `index`. */
export function movedStep(spec, at, id, index) {
  const list = [...stepsOf(spec, at)];
  const from = list.findIndex((item) => item.id === id);
  if (from < 0) return spec.steps ?? {};
  const [step] = list.splice(from, 1);
  list.splice(Math.max(0, Math.min(list.length, index > from ? index - 1 : index)), 0, step);
  return { ...(spec.steps ?? {}), [dayOf(at)]: list };
}

/** The days the plate was told to play, with the day `day` among them (`on`) or without it. */
export function pickedDays(spec, day, on) {
  const kept = (spec?.days ?? []).filter((item) => item !== day);
  return on && day !== PAGE ? [...kept, day].sort() : kept;
}

/** Whether the plate holds a step on any day. */
export const hasSteps = (spec) => Object.values(spec?.steps ?? {}).some((list) => list.length > 0);

// -- a map framed day by day -------------------------------------------------------------

/** The key a day or a step frames its maps under: the step's id, else the day. */
export const beatKey = (at, step = null) => step || dayOf(at);

/**
 * How a map is framed on the beat `key`, among the beats a play goes through, in
 * `order` (their keys): `{ view, own, first }`. A beat framing the map its own way is
 * `own`. Another keeps the framing of the last beat before it that has one, else the
 * map's own view. The first beat, and a beat the play does not go through, show the
 * map's own view, which is what framing the map there moves.
 */
export function framingOf(spec, map, order, key) {
  const own = spec?.framing?.[key]?.[map.id];
  if (own) return { view: own, own: true, first: false };
  const index = order.indexOf(key);
  if (index <= 0) return { view: map.view, own: false, first: true };
  for (let before = index - 1; before >= 0; before -= 1) {
    const found = spec?.framing?.[order[before]]?.[map.id];
    if (found) return { view: found, own: false, first: false };
  }
  return { view: map.view, own: false, first: false };
}

/** The plate's framings with the map `id` framed `view` on the beat `key`; `view` null lets the beat keep the one before. */
export function framedAs(spec, key, id, view) {
  const framing = { ...(spec.framing ?? {}) };
  const maps = { ...(framing[key] ?? {}) };
  if (view) maps[id] = view; else delete maps[id];
  if (Object.keys(maps).length) framing[key] = maps; else delete framing[key];
  return framing;
}

/** The keys of the beats a play goes through, in order (`clip.beats`). */
export const beatKeys = (list) => list.map((beat) => beatKey(beat.day, beat.step));

// -- how the video goes from one beat to the next ------------------------------------------

/** A plate's transitions when it sets none: off, and when on, a fade, the maps moving blurred, what is new fading in. */
export const TRANSITIONS = Object.freeze({ on: false, seconds: 0.8, fade: true, move: true, blur: true, appear: 'fade' });

/** The plate's transitions, every setting it leaves out as `TRANSITIONS` has it. */
export const transitionsOf = (spec) => ({ ...TRANSITIONS, ...(spec?.transitions ?? {}) });
