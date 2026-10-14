/**
 * A map plate's page: its paper, its elements, and the house layout a new one opens on.
 *
 * Everything on a plate is placed in millimetres (`engine/mapplates.py` keeps the same
 * shape), and drawn at `PX_PER_MM` CSS pixels a millimetre: the page a 96 dpi screen
 * shows at its true size. The editor scales that page to fit the window, and the
 * export draws it again at print resolution, so a line is the same weight on the
 * screen and on the paper.
 */

export const PX_PER_MM = 96 / 25.4;
/** Points to millimetres: text sizes are set in points, as on paper. */
export const MM_PER_PT = 25.4 / 72;

/** Paper in millimetres, portrait (`engine/mapplates.PAPERS`). */
export const PAPERS = {
  a5: { label: 'A5', size: [148, 210] },
  a4: { label: 'A4', size: [210, 297] },
  a3: { label: 'A3', size: [297, 420] },
  letter: { label: 'Letter', size: [215.9, 279.4] },
  screen: { label: 'Screen 16:9', size: [190.5, 338.67] },
  square: { label: 'Square', size: [200, 200] },
};

export const FONTS = {
  inter: { label: 'Inter', family: 'Inter' },
  barlow: { label: 'Barlow Condensed', family: '"Barlow Condensed"' },
  oxanium: { label: 'Oxanium', family: 'Oxanium' },
  plexmono: { label: 'IBM Plex Mono', family: '"IBM Plex Mono"' },
};

export const DEFAULT_THEME = { paper: '#ffffff', ink: '#15181e', accent: '#c8102e', font: 'inter' };

/** What each kind of element is called where the analyst reads it. */
export const KIND_LABELS = {
  map: 'Map', inset: 'Inset map', legend: 'Legend', text: 'Text', scale: 'Scale bar', north: 'North arrow',
  image: 'Picture', label: 'Label', arrow: 'Arrow', credits: 'Credits',
};

/** A label's box round its words, from its top left corner: about the width its longest line takes. */
export function labelBox(element) {
  const lines = String(element.text || ' ').split('\n');
  const longest = Math.max(...lines.map((line) => line.length));
  const size = element.size ?? 9;
  const framed = element.style && element.style !== 'plain';
  const width = Math.min(120, Math.max(8, longest * size * 0.19 + (framed ? 3 : 1)));
  const height = Math.max(4, lines.length * size * 0.44 + (framed ? 2 : 0.5));
  return [element.box[0], element.box[1], Math.round(width * 10) / 10, Math.round(height * 10) / 10];
}

/** The page's width and height in millimetres, turned as it is set. */
export function pageSize(page) {
  const [width, height] = (PAPERS[page?.paper] ?? PAPERS.a4).size;
  return page?.orientation === 'portrait' ? { width, height } : { width: height, height: width };
}

let counter = 0;
/** A fresh element id, unique within the session and short enough for the backend's bound. */
export function newId(kind) {
  counter += 1;
  return `${kind}${Date.now().toString(36).slice(-4)}${counter.toString(36)}`;
}

/** The plate's main map: the first one placed. */
export function mainMap(spec) {
  return spec?.elements?.find((element) => element.kind === 'map') ?? null;
}

/**
 * The house layout a new plate opens on, for a page of that paper: a title band, the
 * map, a column with the legend, an inset and the cartouche, the scale and the north
 * on the map, and the credits under it.
 */
export function houseLayout({ paper = 'a4', orientation = 'landscape', view = null, layers = [], title = '' } = {}) {
  const page = { paper, orientation };
  const { width, height } = pageSize(page);
  const margin = Math.max(6, Math.round(Math.min(width, height) * 0.045));
  const band = 16;
  const column = Math.min(70, Math.round(width * 0.24));
  const mapWidth = width - 2 * margin - column - 6;
  const mapTop = margin + band;
  const mapHeight = height - mapTop - margin - 6;
  const right = margin + mapWidth + 6;
  const map = { id: 'map', kind: 'map', box: [margin, mapTop, mapWidth, mapHeight],
    view: view ?? { lat: 48.85, lon: 2.35, zoom: 9, bearing: 0 }, basemap: 'plain', overlays: ['relief'],
    layers: layers.map((name) => ({ name, hidden: [], stroke: 1 })), grid: 'none' };
  const legendHeight = Math.round(mapHeight * 0.45);
  const insetHeight = Math.round(mapHeight * 0.28);
  return {
    page,
    theme: { ...DEFAULT_THEME },
    time: { at: null, trail: true, since: null, window: 7 },
    elements: [
      map,
      { id: 'title', kind: 'text', box: [margin, margin - 1, mapWidth, 9], text: title || 'Title', size: 18, weight: 700, align: 'left' },
      { id: 'subtitle', kind: 'text', box: [margin, margin + 8, mapWidth, 6], text: 'Situation as of {date}', size: 10, weight: 400, align: 'left' },
      { id: 'legend', kind: 'legend', box: [right, mapTop, column, legendHeight], of: 'map', size: 8, border: true, columns: 1 },
      { id: 'inset', kind: 'inset', box: [right, mapTop + legendHeight + 4, column, insetHeight], of: 'map', zoom: null, border: true },
      { id: 'cartouche', kind: 'text', box: [right, mapTop + legendHeight + insetHeight + 8, column, mapHeight - legendHeight - insetHeight - 8],
        text: '{case}\nMade {today}', size: 7, weight: 400, align: 'left', border: true },
      { id: 'scale', kind: 'scale', box: [margin + 4, mapTop + mapHeight - 10, 40, 6], of: 'map', fill: '#ffffff' },
      { id: 'north', kind: 'north', box: [margin + mapWidth - 12, mapTop + 4, 8, 12], of: 'map' },
      { id: 'credits', kind: 'credits', box: [margin, mapTop + mapHeight + 1, mapWidth, 4], of: 'map', size: 5.5, align: 'right' },
    ],
  };
}

/**
 * The same plate on another paper or turned: every element keeps its share of the
 * page, so the layout reads the same, larger or smaller.
 */
export function onPaper(spec, page) {
  const before = pageSize(spec.page);
  const after = pageSize(page);
  const sx = after.width / before.width;
  const sy = after.height / before.height;
  return {
    ...spec,
    page,
    elements: spec.elements.map((element) => ({
      ...element,
      box: [element.box[0] * sx, element.box[1] * sy, element.box[2] * sx, element.box[3] * sy].map(round),
    })),
  };
}

const round = (value) => Math.round(value * 10) / 10;

/** A plate's layout with its data taken out, as a template keeps it (`engine/mapplates.template_of`). */
export function templateOf(spec) {
  return {
    page: { ...spec.page },
    theme: { ...spec.theme },
    time: {},
    elements: spec.elements
      .filter((element) => element.kind !== 'label' && element.kind !== 'arrow')
      .map(({ view, layers, src, names, ...kept }) => kept),
  };
}

/**
 * A new plate from a template: its maps look where `view` says and draw `layers`.
 * An element reading a map the template does not hold is left out.
 */
export function fromTemplate(data, { view, layers = [] } = {}) {
  const maps = new Set(data.elements.filter((element) => element.kind === 'map').map((element) => element.id));
  return {
    page: { ...data.page },
    theme: { ...DEFAULT_THEME, ...data.theme },
    time: { at: null, trail: true, since: null, window: 7 },
    elements: data.elements
      .filter((element) => !element.of || maps.has(element.of))
      .map((element) => element.kind === 'map'
        ? { ...element, view: { ...(view ?? { lat: 48.85, lon: 2.35, zoom: 9, bearing: 0 }) },
          layers: layers.map((name) => ({ name, hidden: [], stroke: 1 })) }
        : { ...element }),
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
 * The words a plate's text stands for: `{date}` the day the plate is drawn on (today
 * when it has none), `{today}`, `{case}` and `{title}`.
 */
export function fillTokens(text, { date = null, caseName = '', title = '', today = new Date() } = {}) {
  const iso = today.toISOString().slice(0, 10);
  return String(text ?? '')
    .replaceAll('{date}', longDay(date) || longDay(iso))
    .replaceAll('{today}', longDay(iso))
    .replaceAll('{case}', caseName)
    .replaceAll('{title}', title);
}
