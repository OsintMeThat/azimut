/**
 * The recap map of a video thread: the places of the video on one 16:9 picture, for
 * Recap first's first post, in place of the proofs sheet when the places spread far
 * enough apart to be told apart on a map.
 *
 * **What it shows.** Each place a numbered pin, the number and the colour `#scenes` and
 * the strip give it (`lib/videoThread.js`); a small scale bar; the imagery's credit,
 * always; and, when asked, a dashed line joining the places in the video's order, the
 * analyst's signature and the Azimut mark. No title: the post's `#scenes` is its legend.
 * No north arrow either: the map is always north up. Framed by itself on every place,
 * with room for what is drawn round them.
 *
 * **How it is drawn.** As Map plate draws a page (`lib/plate/draw.js` `drawPage`): the
 * map is one element of a small plate made here, the pins its numbered labels, the line
 * and the credits its own elements, the credit worded by `lib/plate/credits.js`. The
 * ground is the background's tiles, asked of the app's tile route (`/api/tiles`) and laid
 * side by side at the zoom the picture needs, a few at a time. The scale bar is drawn
 * here, a thin line and its length with a halo rather than a plate's boxed bar. The
 * signature and the mark are drawn as a proof draws them (`lib/composer.js`
 * `signatureBox`, `lib/proofMark.js`), from the analyst's default proof style: the
 * signature sits just above the credit, the mark small in the top right corner.
 *
 * **Local first.** Nothing here reaches the network unless `loadTile` is given: the
 * preview is drawn first on a plain ground, and the tiles come once the analyst asks.
 *
 * The full picture is 1600 × 900, as the sheet, a JPEG under Bluesky's 1 MB; the preview
 * is the same page drawn smaller, its ground asked at the zoom that size needs.
 */
import { drawPage } from './plate/draw.js';
import { distance, fromWorld, scaleBar, toWorld } from './plate/geo.js';
import { MM_PER_PT, PX_PER_MM } from './plate/page.js';
import { plateCredits } from './plate/credits.js';
import {
  SIG_MARGIN, SIG_TEXT_SIZE, anchoredPos, isLightColor, newSignature, newSignatureText, normalizeAzimutMark, newAzimutMark,
  signatureBox, signaturePairPositions,
} from './composer.js';
import { drawMark, markBox } from './proofMark.js';
import { labelCoords } from './naming.js';

export const MAP_WIDTH = 1600;
export const MAP_HEIGHT = 900;
/** Bluesky takes a picture up to 1 MB (`lib/videoLimits.js`), with room to spare, as the sheet. */
export const MAP_MAX_BYTES = 950_000;
export const MAP_TYPE = 'image/jpeg';
const QUALITIES = [0.9, 0.82, 0.74, 0.66];

/** The two grounds the map can stand on, as the app's basemaps name them. */
export const BACKGROUNDS = Object.freeze({ satellite: 'esri-world-imagery', map: 'osm' });
export const BACKGROUND_NAMES = Object.freeze({ satellite: 'Satellite', map: 'Map' });
/** How far apart the places must stand for a map to tell them apart, in metres. */
export const MIN_SPREAD = 30;
/** The deepest tiles asked, whatever the places' spread: what the free imagery holds. */
export const MAX_TILE_ZOOM = 19;
/** The most tiles asked at once: the six connections a browser keeps to the app, less one. */
const AT_ONCE = 5;

/** What a map starts on: the satellite ground, no line, signature and mark as the proofs. */
export const DEFAULT_MAP_OPTIONS = Object.freeze({ background: 'satellite', line: false, signature: false, mark: false });

/** The options as a draft keeps them, anything unknown read as the default. */
export function mapOptions(value = {}) {
  const given = value && typeof value === 'object' ? value : {};
  return {
    background: Object.hasOwn(BACKGROUNDS, given.background) ? given.background : DEFAULT_MAP_OPTIONS.background,
    line: given.line === true,
    signature: given.signature === true,
    mark: given.mark === true,
  };
}

// The page as Map plate measures one: millimetres, drawn at `MM` canvas pixels each at
// full size, so its type is read on a phone when the picture is shown a quarter its size.
const MM = 12;
const PAGE = { width: MAP_WIDTH / MM, height: MAP_HEIGHT / MM };
const CREDIT_SIZE = 6; // the credit's type, in points
// the credit's strip at the foot of the map, in millimetres: one line of it, and the band
// a plate lays under its words (`lib/plate/draw.js` `writeLines`)
const STRIP = CREDIT_SIZE * MM_PER_PT * (1.25 + 0.1);
const PIN = 6.5; // a pin's width, in millimetres
// what the framing keeps clear round the places' middles, as shares of the page, a pin's
// half included: the scale, the signature, the mark and the credit sit in that margin
const ROOM = { side: 0.12, top: 0.16, bottom: 0.26 };

/** The colours a scene is drawn in on Inspect's bar (`app.css` --anno-N), for a picture. */
const SCENE_HEX = {
  'var(--anno-1)': '#ff5252',
  'var(--anno-2)': '#40c4ff',
  'var(--anno-3)': '#ffd740',
  'var(--anno-4)': '#69f0ae',
  'var(--anno-5)': '#e040fb',
  'var(--anno-6)': '#ff9e40',
};
export const sceneHex = (colour) => SCENE_HEX[colour] ?? (/^#[0-9a-f]{6}$/i.test(colour ?? '') ? colour : '#40c4ff');

/**
 * The places a thread's slides pin (`videoThread.videoSlides`), each its conclusion's
 * point: `{ number, name, lon, lat, colour }`, numbered as `#scenes` numbers them. A
 * slide with no point to pin keeps its number and is left off the map.
 */
export function recapPlaces(slides) {
  return (slides ?? []).flatMap((slide, i) => {
    const point = (slide?.row?.points ?? []).find((one) => Number.isFinite(one?.lat) && Number.isFinite(one?.lon));
    if (!point) return [];
    return [{ number: i + 1, name: slide.name, lon: point.lon, lat: point.lat, colour: sceneHex(slide.row?.color) }];
  });
}

/** The frame the map shows on the page, in Map plate's CSS pixels. */
export const MAP_FRAME = Object.freeze({ width: PAGE.width * PX_PER_MM, height: PAGE.height * PX_PER_MM });

/**
 * The view that frames every place, or why there is none: `{ ok: true, view }`, or
 * `{ ok: false, why }`, `why` being `none` (no place to pin), `one` (a single place) or
 * `close` (all within `MIN_SPREAD` metres, which a map cannot tell apart).
 */
export function recapFit(places) {
  const list = places ?? [];
  if (!list.length) return { ok: false, why: 'none' };
  const spots = new Set(list.map((one) => labelCoords(one)));
  if (spots.size < 2) return { ok: false, why: 'one' };
  let spread = 0;
  for (const a of list) for (const b of list) spread = Math.max(spread, distance([a.lon, a.lat], [b.lon, b.lat]));
  if (spread < MIN_SPREAD) return { ok: false, why: 'close' };
  const world = list.map((one) => toWorld([one.lon, one.lat], 0));
  const xs = world.map(([x]) => x);
  const ys = world.map(([, y]) => y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const roomW = MAP_FRAME.width * (1 - 2 * ROOM.side);
  const roomH = MAP_FRAME.height * (1 - ROOM.top - ROOM.bottom);
  const fits = Math.min(roomW / Math.max(x1 - x0, 1e-9), roomH / Math.max(y1 - y0, 1e-9));
  // no deeper than the tiles a full picture would ask hold pixels for
  const deepest = MAX_TILE_ZOOM - 1 - Math.log2(MAP_WIDTH / MAP_FRAME.width);
  const zoom = Math.min(Math.log2(fits), deepest);
  // the places in the middle of the room left them, which sits a little above the page's
  const scale = 2 ** zoom;
  const shift = ((ROOM.bottom - ROOM.top) / 2) * MAP_FRAME.height / scale;
  const [lon, lat] = fromWorld([(x0 + x1) / 2, (y0 + y1) / 2 + shift], 0);
  return { ok: true, view: { lon, lat, zoom, bearing: 0 } };
}

/** The ink a pin's number is written in on its colour. */
const numberInk = (colour) => (isLightColor(colour) ? '#14171c' : '#ffffff');

/**
 * The bottom corner the scale takes: the left one, unless the signature stands there
 * and leaves the right one free.
 */
export function scaleCorner(signed = { logo: null, text: null }) {
  const taken = new Set([signed.logo, signed.text].filter(Boolean).map((one) => one.anchor ?? 'br'));
  return taken.has('bl') && !taken.has('br') ? 'br' : 'bl';
}

/**
 * The signature and the mark the map carries, or null for each: the signature where the
 * analyst's proof style puts it, the mark as that style draws it, small in the top right
 * corner whatever corner the proofs give it.
 */
export function signing(options, { style = null, logo = null, handle = '' } = {}) {
  const wanted = mapOptions(options);
  const sign = wanted.signature
    ? {
        logo: logo ? (style?.signature ?? newSignature()) : null,
        text: handle?.trim() ? (style?.signatureText ?? newSignatureText()) : null,
      }
    : { logo: null, text: null };
  const mark = wanted.mark ? { ...(normalizeAzimutMark(style?.azimutMark) ?? newAzimutMark()), anchor: 'tr' } : null;
  return { logo: sign.logo, text: sign.text, mark };
}

/**
 * The map as a plate (`lib/plate/page.js`'s shape): one page the picture's size, the map
 * over all of it, a pin per place, the line when asked, and the credit in its strip.
 */
export function recapPlate(fit, places, options) {
  const wanted = mapOptions(options);
  const elements = [
    { id: 'map', kind: 'map', box: [0, 0, PAGE.width, PAGE.height], view: fit.view, basemap: BACKGROUNDS[wanted.background],
      overlays: [], layers: [], grid: 'none', border: false },
  ];
  if (wanted.line && places.length > 1) {
    elements.push({ id: 'line', kind: 'line', of: 'map', points: [...places].sort((a, b) => a.number - b.number).map((one) => [one.lon, one.lat]),
      line: 'dashed', width: 1.3, heads: 'none', colour: wanted.background === 'map' ? '#15181e' : '#ffffff' });
  }
  // the first place drawn last, on top of a neighbour it touches
  for (const place of [...places].reverse()) {
    elements.push({ id: `pin-${place.number}`, kind: 'label', of: 'map', at: [place.lon, place.lat], leader: 'none', style: 'number',
      box: [0, 0, PIN, PIN], fill: place.colour, colour: numberInk(place.colour), size: 10 });
  }
  elements.push({ id: 'credits', kind: 'credits', of: 'map', size: CREDIT_SIZE, align: 'right', box: [0, PAGE.height - STRIP, PAGE.width, STRIP] });
  return {
    page: { paper: 'custom', size: [PAGE.width, PAGE.height], orientation: 'landscape' },
    theme: { paper: '#ffffff', ink: '#15181e', accent: '#c8102e', font: 'inter', preset: '' },
    time: { at: null, trail: true, since: null, window: null },
    elements,
  };
}

/** The credit the map prints: its background's, as a plate words it. */
export function recapCredit(plate, providers = []) {
  return plateCredits(plate, { providers }) || 'Imagery credits';
}

/**
 * The tiles a ground of `width` × `height` canvas pixels needs, for `view` framed as
 * `MAP_FRAME`: `{ zoom, scale, tiles: [{ x, y, z, left, top, size }] }`, each tile placed
 * in canvas pixels. The zoom is the one nearest a tile pixel a canvas pixel.
 */
export function groundTiles(view, width, height, { maxZoom = MAX_TILE_ZOOM } = {}) {
  // one tile pixel a canvas pixel: the 256-pixel grid's zoom, a plate's being on 512
  const want = view.zoom + Math.log2(width / MAP_FRAME.width) + 1;
  const zoom = Math.max(0, Math.min(maxZoom, Math.round(want)));
  const per = 2 ** (zoom - want); // tile pixels a canvas pixel
  const [cx, cy] = toWorld([view.lon, view.lat], zoom - 1);
  const left = cx - (width / 2) * per;
  const top = cy - (height / 2) * per;
  const count = 2 ** zoom;
  const tiles = [];
  for (let ty = Math.floor(top / 256); ty <= Math.floor((top + height * per) / 256); ty += 1) {
    if (ty < 0 || ty >= count) continue;
    for (let tx = Math.floor(left / 256); tx <= Math.floor((left + width * per) / 256); tx += 1) {
      tiles.push({ x: ((tx % count) + count) % count, y: ty, z: zoom, left: (tx * 256 - left) / per, top: (ty * 256 - top) / per, size: 256 / per });
    }
  }
  return { zoom, scale: per, tiles };
}

/** A tile of the app's tile route, decoded, or null where there is none. */
export async function loadAppTile(provider, { x, y, z }) {
  const res = await fetch(`/api/tiles/${encodeURIComponent(provider)}/${z}/${x}/${y}`);
  if (!res.ok || res.status === 204) return null;
  return createImageBitmap(await res.blob());
}

function defaultCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** A plain ground for a map whose tiles were not asked for yet: the preview before the press. */
const PLAIN = { satellite: '#2b3138', map: '#ece8df' };

/**
 * The ground under the map: its tiles laid side by side on a canvas of `width` ×
 * `height`, a few asked at a time, or a plain ground when `loadTile` is null. A tile that
 * does not come leaves the plain ground showing there. Answers the canvas and how many
 * tiles were missing.
 */
export async function drawGround(view, background, width, height, { loadTile = null, makeCanvas = defaultCanvas } = {}) {
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = PLAIN[background] ?? PLAIN.satellite;
  ctx.fillRect(0, 0, width, height);
  if (!loadTile) return { canvas, missing: 0, asked: 0 };
  const { tiles } = groundTiles(view, width, height);
  let missing = 0;
  let next = 0;
  const work = async () => {
    while (next < tiles.length) {
      const tile = tiles[next];
      next += 1;
      let picture = null;
      try {
        picture = await loadTile(BACKGROUNDS[background] ?? BACKGROUNDS.satellite, tile);
      } catch {
        picture = null;
      }
      if (!picture) {
        missing += 1;
        continue;
      }
      // a hair over its place, so no seam shows between two tiles
      ctx.drawImage(picture, Math.floor(tile.left), Math.floor(tile.top), Math.ceil(tile.size) + 1, Math.ceil(tile.size) + 1);
      picture.close?.();
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, tiles.length) }, work));
  return { canvas, missing, asked: tiles.length };
}

/** The scale bar's measures, in the picture's own pixels: its longest, its line, its end ticks and its words. */
export const SCALE_BAR = Object.freeze({ most: 170, line: 3, tick: 9, text: 21 });

/**
 * Where the scale bar stands and what it says, in the picture's own pixels: `{ x, y,
 * length, label }`, `y` its line. In the bottom left corner, the credit's row, or above
 * the credit in the right one when the signature takes the left.
 */
export function scalePlace(view, corner = 'bl') {
  const per = MAP_WIDTH / MAP_FRAME.width; // picture pixels a frame pixel
  const bar = scaleBar(view, SCALE_BAR.most / per);
  const length = bar.pixels * per;
  const left = corner !== 'br';
  return {
    x: left ? SIG_MARGIN : MAP_WIDTH - SIG_MARGIN - length,
    y: left ? MAP_HEIGHT - SIG_MARGIN : MAP_HEIGHT - STRIP * MM - SIG_MARGIN,
    length,
    label: bar.label,
  };
}

/** The scale bar: a thin line ticked at its ends, its length over it, haloed so it reads on any ground. */
function drawScaleBar(ctx, view, background, corner) {
  const { x, y, length, label } = scalePlace(view, corner);
  if (!(length > 0)) return;
  const plain = background === 'map';
  const ink = plain ? '#15181e' : '#ffffff';
  const halo = plain ? 'rgba(255, 255, 255, 0.9)' : 'rgba(0, 0, 0, 0.55)';
  const { line, tick, text } = SCALE_BAR;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(x, y - tick);
    ctx.lineTo(x, y);
    ctx.lineTo(x + length, y);
    ctx.lineTo(x + length, y - tick);
  };
  trace();
  ctx.strokeStyle = halo;
  ctx.lineWidth = line + 3;
  ctx.stroke();
  trace();
  ctx.strokeStyle = ink;
  ctx.lineWidth = line;
  ctx.stroke();
  ctx.font = `600 ${text}px Inter, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = 4;
  ctx.strokeStyle = halo;
  ctx.strokeText(label, x + length / 2, y - 5);
  ctx.fillStyle = ink;
  ctx.fillText(label, x + length / 2, y - 5);
  ctx.restore();
}

/**
 * The signature and the mark, drawn as a proof draws them, in the picture's own pixels
 * (`MAP_WIDTH` × `MAP_HEIGHT`): the signature a proof's margin above the credit's strip,
 * the mark in the top right corner.
 */
function drawSigning(ctx, signed, { logo = null, handle = '' }) {
  const width = MAP_WIDTH;
  const height = MAP_HEIGHT - STRIP * MM;
  const drawn = [];
  const natural = logo ? [logo.naturalWidth || logo.width, logo.naturalHeight || logo.height] : null;
  const logoBox = signed.logo && natural ? signatureBox(signed.logo, width, height, natural) : null;
  let handleSize = null;
  if (signed.text && handle.trim()) {
    ctx.font = `bold ${signed.text.size ?? SIG_TEXT_SIZE}px Inter, sans-serif`;
    handleSize = { w: ctx.measureText(handle.trim()).width, h: (signed.text.size ?? SIG_TEXT_SIZE) * 1.2 };
  }
  const pair = logoBox && handleSize ? signaturePairPositions(signed.logo, signed.text, width, height, logoBox, handleSize.w, handleSize.h) : null;
  if (logoBox) {
    const box = pair?.logo ?? logoBox;
    ctx.save();
    ctx.globalAlpha = signed.logo.opacity ?? 1;
    ctx.drawImage(logo, box.x, box.y, box.w, box.h);
    ctx.restore();
    drawn.push(box);
  }
  if (handleSize) {
    const at = pair?.handle ?? anchoredPos(signed.text, width, height, handleSize.w, handleSize.h);
    ctx.save();
    ctx.globalAlpha = signed.text.opacity ?? 1;
    ctx.font = `bold ${signed.text.size ?? SIG_TEXT_SIZE}px Inter, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    // a dark halo, so a white handle reads on bright ground
    ctx.lineWidth = Math.max(2, (signed.text.size ?? SIG_TEXT_SIZE) * 0.14);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.lineJoin = 'round';
    ctx.strokeText(handle.trim(), at.x, at.y);
    ctx.fillStyle = signed.text.color ?? '#ffffff';
    ctx.fillText(handle.trim(), at.x, at.y);
    ctx.restore();
    drawn.push({ x: at.x, y: at.y, w: handleSize.w, h: handleSize.h });
  }
  if (signed.mark) {
    const box = markBox(signed.mark, width, height, { avoid: drawn });
    // over the map, as over a proof's picture: the light ink and its dark halo
    drawMark(ctx, signed.mark, box, '#14171c');
  }
}

/**
 * Draw the map of `places` on a canvas of `width` × `height` (the picture's shape).
 *
 * - `fit`: `recapFit`'s view; `options`: `mapOptions`'s.
 * - `providers`: `/api/satellite/providers`, for the background's credit.
 * - `loadTile(provider, tile)`: a tile's picture, or leave it out for a plain ground.
 * - `style`, `logo`, `handle`: the analyst's default proof style, logo and handle.
 */
export async function drawRecapMap(places, fit, options, {
  width = MAP_WIDTH,
  height = MAP_HEIGHT,
  providers = [],
  loadTile = null,
  style = null,
  logo = null,
  handle = '',
  makeCanvas = defaultCanvas,
} = {}) {
  const wanted = mapOptions(options);
  const signed = signing(wanted, { style, logo, handle });
  const plate = recapPlate(fit, places, wanted);
  const ground = await drawGround(fit.view, wanted.background, width, height, { loadTile, makeCanvas });
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const numbers = new Map(places.map((one) => [`pin-${one.number}`, one.number]));
  drawPage(ctx, plate, {
    scale: MM * (width / MAP_WIDTH),
    paper: true,
    editing: false,
    views: { map: { view: fit.view, frame: MAP_FRAME } },
    maps: { map: ground.canvas },
    credits: { credits: recapCredit(plate, providers) },
    numberOf: (id) => numbers.get(id) ?? '',
  });
  ctx.save();
  ctx.scale(width / MAP_WIDTH, height / MAP_HEIGHT);
  drawScaleBar(ctx, fit.view, wanted.background, scaleCorner(signed));
  if (signed.logo || signed.text || signed.mark) drawSigning(ctx, signed, { logo, handle });
  ctx.restore();
  return { canvas, missing: ground.missing, asked: ground.asked };
}

function encode(canvas, type, quality) {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('the map could not be encoded'))), type, quality),
  );
}

/** The full map as a JPEG under `MAP_MAX_BYTES`, the quality lowered a step at a time. */
export async function buildRecapMap(places, fit, options, deps = {}) {
  const drawn = await drawRecapMap(places, fit, options, { ...deps, width: MAP_WIDTH, height: MAP_HEIGHT });
  let blob = null;
  for (const quality of QUALITIES) {
    blob = await encode(drawn.canvas, MAP_TYPE, quality);
    if (blob.size <= MAP_MAX_BYTES) break;
  }
  return { blob, missing: drawn.missing, asked: drawn.asked };
}

/** The preview's size: small, its ground a dozen tiles or so. */
export const PREVIEW_WIDTH = 480;
export const PREVIEW_HEIGHT = 270;

/** A small map to look at before it is made: a URL to show it, and `revoke()` to let it go. */
export async function recapMapPreview(places, fit, options, deps = {}) {
  const drawn = await drawRecapMap(places, fit, options, { ...deps, width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT });
  const blob = await encode(drawn.canvas, MAP_TYPE, 0.86);
  const url = URL.createObjectURL(blob);
  return { url, missing: drawn.missing, revoke: () => URL.revokeObjectURL(url) };
}
