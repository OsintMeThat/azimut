/**
 * A Horizon view written out as a picture: the view alone, the whole turn, or
 * the photo beside the terrain it was matched on, in a row or a column.
 *
 * The pixels come from the view itself (HorizonView `exportPicture`), drawn
 * at the export's size through the camera asked for; this composes them with
 * what explains them, in the inks Compare's exports use: the view's name and
 * where it stood and looked in a header, the summit names over the picture
 * (and the skyline traced on the photo, when asked: it is working material),
 * a ruler of directions under it, and the credits and, unless left out, the
 * signature in the footer. Everything is placed from the camera the
 * picture was drawn through, in its own CSS pixels times `scale`.
 *
 * A blink is the same chrome twice, the photo then the terrain, which the app
 * turns into a GIF (api/compare.py, `/compare/gif`).
 */
import { EXPORT_STYLE, drawTag, signFooter, signatureRoom } from '../map/compareExport.js';
import { HZ } from './marks.js';
import { windOf } from './geometry.js';
import { skylineAt } from './panorama.js';
import { rayFor, turnBetween } from './camera.js';

const { INK, MUTED, BAND, ACCENT, FONT, MONO } = EXPORT_STYLE;

/** The widest picture an export draws, in pixels: past it a GPU may refuse the target. */
export const EXPORT_MAX_PX = 6144;
/** How many pixels a CSS pixel of the view becomes in an export, at most. */
export const EXPORT_DENSITY = 2;
/**
 * The whole turn's width in CSS pixels, which the ground is sharpened for:
 * ten a degree, drawn at the export's widest, about seventeen a degree.
 */
export const TURN_CSS_WIDTH = 3600;

/** The kinds of export, in the order the menu offers them. `photo` ones need a photo laid. */
export const EXPORT_KINDS = Object.freeze([
  { id: 'view', label: 'This view', hint: 'The view as it shows, with its names', photo: false },
  { id: 'turn', label: 'Whole turn', hint: 'All 360° from the eye, north to north', photo: false },
  { id: 'row', label: 'Photo beside the terrain', hint: 'Left and right, the ridge lines on both', photo: true },
  { id: 'column', label: 'Photo above the terrain', hint: 'Top and bottom, the ridge lines on both', photo: true },
  { id: 'blink', label: 'Blink, photo and terrain', hint: 'A GIF that switches between the two', photo: true },
]);

/** How many export pixels a CSS pixel becomes, for a picture `width` CSS pixels wide. */
export function exportScale(width, { most = EXPORT_MAX_PX, density = EXPORT_DENSITY } = {}) {
  if (!(width > 0)) return 1;
  return Math.max(1, Math.min(density, most / width));
}

/**
 * The camera the whole turn is drawn through: north at both ends, south in the
 * middle, from a little over the highest ridge down to the ground in front,
 * one scale across and down.
 */
export function turnCamera(panorama, { width = TURN_CSS_WIDTH, mode = 'ground' } = {}) {
  let top = -90;
  let low = 90;
  for (let azimuth = 0; azimuth < 360; azimuth += 1) {
    const elevation = skylineAt(panorama, azimuth);
    if (!Number.isFinite(elevation)) continue;
    top = Math.max(top, elevation);
    low = Math.min(low, elevation);
  }
  if (top < low) {
    top = 5;
    low = -5;
  }
  // a walker sees a little ground in front; a drone and an aircraft look down on it
  const floor = mode === 'ground' ? -8 : -25;
  const upper = top + 4;
  const lower = Math.min(floor, low - 6);
  const span = Math.max(16, upper - lower);
  return {
    projection: 'panorama',
    heading: 180,
    tilt: upper - span / 2,
    roll: 0,
    fov: 360,
    width,
    height: Math.round((width * span) / 360),
  };
}

/** A heading as the header says it: "facing 107° ESE"-like, on the eight winds. */
function facingText(heading) {
  const turn = Math.round(((heading % 360) + 360) % 360) % 360;
  return `facing ${turn}° ${windOf(turn)}`;
}

/**
 * What the header says of where the view stood and looked, one line:
 * "46.55860, 7.83530 · on foot, 1.7 m · facing 107° E · lens 60.6° · 14 Jul 2024 17:30".
 */
export function standingText({ observer, camera, sky = null, kind = 'view' }) {
  if (!observer) return '';
  const who = { ground: 'on foot', drone: 'drone', aircraft: 'aircraft' }[observer.mode] ?? observer.mode;
  const height = observer.mode === 'aircraft' ? `${Math.round(observer.height)} m above the sea` : `${observer.height} m`;
  const parts = [`${observer.lat.toFixed(5)}, ${observer.lon.toFixed(5)}`, `${who}, ${height}`];
  if (kind !== 'turn' && camera) {
    parts.push(facingText(camera.heading));
    parts.push(camera.projection === 'panorama' ? `${Math.round(camera.fov)}° across` : `lens ${Number(camera.fov.toFixed(1))}°`);
  }
  if (sky?.on && sky.date) parts.push(`${dayText(sky.date)} ${sky.time}`);
  return parts.join('  ·  ');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dayText(day) {
  const [year, month, date] = String(day).split('-').map(Number);
  return year && month && date ? `${date} ${MONTHS[month - 1]} ${year}` : String(day);
}

/** What an exported view is called: its name, then what kind of picture it is. */
export function viewFilename(title, kind) {
  const stem = String(title ?? '').replace(/[\\/:*?"<>|#%]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'horizon';
  const what = { view: '', turn: ' 360', row: ' photo beside terrain', column: ' photo above terrain', blink: '', capture: ' capture' }[kind] ?? '';
  return `${stem}${what}`;
}

/**
 * An area of the screen, `{ x, y, width, height }` in CSS pixels, kept within
 * a screen `size` big and whole pixels; null when too small to be a picture.
 */
export function areaWithin(area, size, { least = 8 } = {}) {
  if (!area || !(size?.width > 0) || !(size?.height > 0)) return null;
  const left = Math.max(0, Math.min(area.x, area.x + area.width));
  const top = Math.max(0, Math.min(area.y, area.y + area.height));
  const right = Math.min(size.width, Math.max(area.x, area.x + area.width));
  const bottom = Math.min(size.height, Math.max(area.y, area.y + area.height));
  const kept = { x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) };
  return kept.width >= least && kept.height >= least ? kept : null;
}

/**
 * What a picture of an area of the screen faces, and how wide it is: the
 * direction under its middle, and the angle between its left and right edges
 * there. Returns `{ heading, tilt, fov }`.
 */
export function areaLens(camera, area) {
  const middle = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
  const centre = rayFor(camera, middle.x, middle.y);
  const left = rayFor(camera, area.x, middle.y);
  const right = rayFor(camera, area.x + area.width, middle.y);
  return { heading: centre.azimuth, tilt: centre.elevation, fov: Math.abs(turnBetween(left.azimuth, right.azimuth)) };
}

/**
 * What the view wrote over itself, for an area of it: moved to the area's
 * corner, and the names and the marked point outside it left out (the ruler's
 * ticks are drawn only where the picture is).
 */
export function layersIn(layers, area) {
  const inside = (x, y) => x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height;
  const labels = (layers.labels ?? [])
    .filter((label) => inside(label.left + label.width / 2, label.baseline) && inside(label.x, label.y))
    .map((label) => ({ ...label, x: label.x - area.x, y: label.y - area.y, left: label.left - area.x, baseline: label.baseline - area.y }));
  const ticks = (layers.ticks ?? []).map((tick) => ({ ...tick, x: tick.x - area.x }));
  const trace = (layers.trace ?? []).map((stroke) => stroke.map((p) => ({ x: p.x - area.x, y: p.y - area.y })));
  const target = layers.target && inside(layers.target.x, layers.target.y) ? { ...layers.target, x: layers.target.x - area.x, y: layers.target.y - area.y } : null;
  return { labels, ticks, trace, target };
}

function canvasOf(width, height, makeCanvas) {
  const canvas = makeCanvas ? makeCanvas() : document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/** Summit names over the picture, as the view sets them, in its inks. */
function drawNames(ctx, labels, x0, y0, s, daylight) {
  const ink = daylight ? '#14181d' : INK;
  const halo = daylight ? 'rgba(255,255,255,.65)' : 'rgba(10,12,15,.85)';
  ctx.font = `600 ${Math.round(11.5 * s)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  for (const label of labels) {
    const x = x0 + label.x * s;
    const summit = y0 + label.y * s;
    const baseline = y0 + label.baseline * s;
    if (summit - 4 * s > baseline + 4 * s) {
      ctx.strokeStyle = daylight ? 'rgba(20,24,29,.45)' : 'rgba(227,227,227,.4)';
      ctx.lineWidth = s;
      ctx.beginPath();
      ctx.moveTo(x, baseline + 4 * s);
      ctx.lineTo(x, summit - 4 * s);
      ctx.stroke();
    }
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(x, summit, 1.6 * s, 0, Math.PI * 2);
    ctx.fill();
    const middle = x0 + (label.left + label.width / 2) * s;
    ctx.strokeStyle = halo;
    ctx.lineWidth = 3 * s;
    ctx.strokeText(label.name, middle, baseline);
    ctx.fillText(label.name, middle, baseline);
  }
  ctx.textAlign = 'left';
}

/** The skyline traced on the photo, yellow on a dark edge, as the view draws it. */
function drawTrace(ctx, trace, x0, y0, s) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const [width, colour] of [[4.5, 'rgba(0,0,0,.55)'], [2, HZ.mark]]) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width * s;
    for (const stroke of trace) {
      if (stroke.length < 2) continue;
      ctx.beginPath();
      stroke.forEach((p, i) => (i ? ctx.lineTo(x0 + p.x * s, y0 + p.y * s) : ctx.moveTo(x0 + p.x * s, y0 + p.y * s)));
      ctx.stroke();
    }
  }
}

/** The point marked on the map, where the view shows it: a ring in its in-sight colour. */
function drawTarget(ctx, target, x0, y0, s) {
  if (!target) return;
  ctx.strokeStyle = target.visible ? HZ.seen : HZ.hidden;
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.arc(x0 + target.x * s, y0 + target.y * s, 7 * s, 0, Math.PI * 2);
  ctx.stroke();
}

/** The directions under a picture: a tick a step, named on the compass points. */
function drawRuler(ctx, ticks, x0, y0, width, s) {
  ctx.fillStyle = BAND;
  ctx.fillRect(x0, y0, width, RULER * s);
  ctx.font = `${Math.round(10.5 * s)}px ${MONO}`;
  ctx.textAlign = 'center';
  for (const tick of ticks) {
    const x = x0 + tick.x * s;
    if (x < x0 - 1 || x > x0 + width + 1) continue;
    ctx.strokeStyle = tick.named ? ACCENT : MUTED;
    ctx.lineWidth = s;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y0 + 5 * s);
    ctx.stroke();
    if (!tick.label) continue;
    ctx.fillStyle = tick.named ? ACCENT : MUTED;
    ctx.fillText(tick.label, Math.min(x0 + width - 14 * s, Math.max(x0 + 14 * s, x)), y0 + 17 * s);
  }
  ctx.textAlign = 'left';
}

const HEADER = 48;
const RULER = 24;
const FOOTER = 26;

/** The header: the view's name, and where it stood and looked, right-aligned when there is room. */
function drawHeader(ctx, { title, standing }, width, s) {
  ctx.fillStyle = BAND;
  ctx.fillRect(0, 0, width, HEADER * s);
  const left = 16 * s;
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(15 * s)}px ${FONT}`;
  ctx.fillStyle = INK;
  const name = title || 'Horizon';
  ctx.fillText(name, left, (HEADER / 2) * s, width * 0.45);
  const taken = left + Math.min(ctx.measureText(name).width, width * 0.45);
  if (standing) {
    ctx.font = `${Math.round(11 * s)}px ${MONO}`;
    const span = ctx.measureText(standing).width;
    const x = width - span - 16 * s;
    ctx.fillStyle = MUTED;
    // on a narrow picture the reading goes under the name, small, rather than over it
    if (x > taken + 16 * s) ctx.fillText(standing, x, (HEADER / 2) * s);
    else ctx.fillText(standing, left, (HEADER - 9) * s, width - 32 * s);
  }
  ctx.textBaseline = 'alphabetic';
}

function drawFooter(ctx, credits, width, height, s, signed) {
  ctx.fillStyle = BAND;
  ctx.fillRect(0, height - FOOTER * s, width, FOOTER * s);
  const signature = signed && signFooter(ctx, width - 14 * s, height - 13 * s, s) ? signatureRoom(s) : 0;
  ctx.fillStyle = MUTED;
  ctx.font = `${Math.round(10 * s)}px ${FONT}`;
  ctx.fillText(credits || '', 16 * s, height - 9 * s, Math.max(0, width - 32 * s - signature));
}

/**
 * One panel: the picture, what is written over it, its tag, and its ruler.
 * `picture` is a drawn canvas; `layers` what HorizonView placed for its camera.
 */
function drawPanel(ctx, picture, layers, x0, y0, s, { tag = '', daylight = true, trace = false } = {}) {
  ctx.drawImage(picture, x0, y0);
  drawNames(ctx, layers.labels ?? [], x0, y0, s, daylight);
  if (trace) drawTrace(ctx, layers.trace ?? [], x0, y0, s);
  drawTarget(ctx, layers.target, x0, y0, s);
  if (tag) drawTag(ctx, tag, x0 + 12 * s, y0 + 12 * s, { scale: s, accent: tag.startsWith('Photo') });
  drawRuler(ctx, layers.ticks ?? [], x0, y0 + picture.height, picture.width, s);
}

/**
 * The view alone, or the whole turn: `{ picture, layers, scale }` from
 * HorizonView, the header's `title` and `standing`, the footer's `credits`.
 */
export function composeView({ picture, layers = {}, scale, title = '', standing = '', credits = '', tag = '', daylight = true, trace = false, signed = true, makeCanvas }) {
  if (!picture?.width) throw new Error('the view must be drawn before it can be exported');
  const s = scale;
  const width = picture.width;
  const height = (HEADER + RULER + FOOTER) * s + picture.height;
  const output = canvasOf(width, height, makeCanvas);
  const ctx = output.getContext('2d');
  if (!ctx) throw new Error('this browser cannot compose the picture');
  drawHeader(ctx, { title, standing }, width, s);
  drawPanel(ctx, picture, layers, 0, HEADER * s, s, { tag, daylight, trace });
  drawFooter(ctx, credits, output.width, output.height, s, signed);
  return output;
}

/** The tag a photo's panel carries: it says so when the photo was reshaped by hand. */
export const photoTag = (reshaped) => (reshaped ? 'Photo, reshaped' : 'Photo');

/**
 * The photo and the terrain it was matched on, the same frame through the
 * same lens, side by side (`row`) or one over the other (`column`), the ridge
 * lines and the trace on both. A photo pulled by its corners or edges is
 * tagged so (`reshaped`).
 */
export function composePair({ photo, terrain, layers = {}, scale, layout = 'row', title = '', standing = '', credits = '', daylight = true, trace = false, signed = true, reshaped = false, makeCanvas }) {
  if (!photo?.width || !terrain?.width) throw new Error('the view must be drawn before it can be exported');
  const s = scale;
  const gap = Math.round(6 * s);
  const panelHeight = photo.height + RULER * s;
  const row = layout === 'row';
  const width = row ? photo.width * 2 + gap : photo.width;
  const height = HEADER * s + (row ? panelHeight : panelHeight * 2 + gap) + FOOTER * s;
  const output = canvasOf(width, height, makeCanvas);
  const ctx = output.getContext('2d');
  if (!ctx) throw new Error('this browser cannot compose the picture');
  ctx.fillStyle = BAND;
  ctx.fillRect(0, 0, output.width, output.height);
  drawHeader(ctx, { title, standing }, width, s);
  const top = HEADER * s;
  drawPanel(ctx, photo, layers, 0, top, s, { tag: photoTag(reshaped), daylight, trace });
  if (row) drawPanel(ctx, terrain, layers, photo.width + gap, top, s, { tag: 'Terrain, simulated', daylight, trace });
  else drawPanel(ctx, terrain, layers, 0, top + panelHeight + gap, s, { tag: 'Terrain, simulated', daylight, trace });
  drawFooter(ctx, credits, output.width, output.height, s, signed);
  return output;
}

/** The colours a blink GIF must keep exactly: the export's inks, the trace, the marks. */
export function blinkColours() {
  const colours = [INK, MUTED, BAND, ACCENT, HZ.mark, HZ.seen, HZ.hidden, '#14181d', '#e3e3e3'];
  return [...new Set(colours.map((c) => c.toLowerCase()))].join(',');
}
