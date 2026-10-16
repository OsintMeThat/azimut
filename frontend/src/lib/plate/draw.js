/**
 * Everything on a map plate that is not a map, drawn on one canvas.
 *
 * The editor draws it over its live maps at the screen's resolution, and the export
 * draws it again over the maps' print-resolution pictures: one function, so what is
 * on the screen is what is on the paper. Boxes are in millimetres and `scale` says how
 * many canvas pixels a millimetre is; a point of the ground is placed through the map
 * it stands on (`geo.js`), from the view that map reports.
 *
 * What only the editor shows (a placeholder, an annotation of another day drawn
 * faintly, the guides) is drawn when `context.editing` says so, never in an export.
 *
 * A video's transition draws the page again while what is new on a beat appears
 * (`context.reveal`): faded in, or drawn along its lines as far as `t` has gone.
 */
import { MM_PER_PT, PX_PER_MM, fillTokens, fontFamily, pageSize, shownOn, standsOver } from './page.js';
import { posterKey } from './clip.js';
import { bearingTo, circle, corners, decimalLabel, degreeLabel, distance, graticule, project, scaleBar, sector, travel, utmGrid, utmLabel } from './geo.js';
import { backColourOf, backOf, defaultSize, inkOf } from './words.js';
import { qrMatrix } from './qr.js';
import { drawSignature, signatureWidth } from '../brandMark.js';

/** How a legend row is drawn: a marker, a line, an area, or the past. */
export const SWATCHES = ['point', 'line', 'area', 'trail', 'gained', 'lost', 'new'];

const HALO = 'rgba(255,255,255,0.92)';
const MAP_KINDS = ['map', 'inset'];

function font(theme, sizePt, weight, scale, element = {}) {
  return `${element.italic ? 'italic ' : ''}${weight} ${Math.max(1, sizePt * MM_PER_PT * scale)}px ${fontFamily(element.font ?? theme?.font)}, sans-serif`;
}

/** Lines of text that fit `width` canvas pixels, the given breaks kept. */
export function wrap(ctx, text, width) {
  const out = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > width) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

function boxPx(element, scale) {
  const [x, y, w, h] = element.box;
  return { x: x * scale, y: y * scale, w: w * scale, h: h * scale };
}

/** The map an element reads, as its frame on the canvas and the view it shows. */
function frameOf(element, context) {
  const map = context.spec.elements.find((item) => item.id === element.of);
  return map ? frameOfMap(map, context) : null;
}

function frameOfMap(map, context) {
  const live = context.views?.[map.id];
  if (!live) return null;
  const box = boxPx(map, context.scale);
  const ratio = context.scale / PX_PER_MM;
  return { map, box, view: live.view, frame: live.frame,
    // a map in 3D places the ground through its own camera, the heights included
    at: (point) => {
      const [px, py] = live.project ? live.project(point) : project(live.view, live.frame, point);
      return [box.x + px * ratio, box.y + py * ratio];
    } };
}

/** Whether a map is tilted, so what assumes a flat map (a scale, a grid) says it does not hold. */
const tilted = (view) => (view?.pitch ?? 0) > 0.5;

/** The first `t` of a line of canvas points, by its length: what a line drawn along its way has reached. */
export function partOf(points, t = 1) {
  if (t >= 1 || points.length < 2) return points;
  const lengths = points.slice(1).map((point, index) => Math.hypot(point[0] - points[index][0], point[1] - points[index][1]));
  let left = Math.max(0, t) * lengths.reduce((sum, value) => sum + value, 0);
  const out = [points[0]];
  for (const [index, length] of lengths.entries()) {
    const [a, b] = [points[index], points[index + 1]];
    if (length >= left) {
      const k = length ? left / length : 0;
      out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]);
      return out;
    }
    out.push(b);
    left -= length;
  }
  return out;
}

/** The dash a line style draws, scaled to its width. */
function dashFor(line, width) {
  if (line === 'dashed') return [width * 3.2, width * 2];
  if (line === 'dotted') return [width * 0.1, width * 1.8];
  return [];
}

/** Clip to a map's frame, less the maps laid over it, so its own drawing never runs over them. */
function clipToMap(ctx, map, context) {
  const box = boxPx(map, context.scale);
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  const after = context.spec.elements.slice(context.spec.elements.indexOf(map) + 1);
  for (const other of after) {
    if (!MAP_KINDS.includes(other.kind) || other.hidden) continue;
    const o = boxPx(other, context.scale);
    if (o.x < box.x + box.w && o.x + o.w > box.x && o.y < box.y + box.h && o.y + o.h > box.y) ctx.rect(o.x, o.y, o.w, o.h);
  }
  ctx.clip('evenodd');
}

// -- writing -----------------------------------------------------------------------------

/** How a box writes its text: face, case, spacing, alignment, halo. Returns whether it ran past its box. */
function writeLines(ctx, element, context, text, box, { pad = 0, clip = true, sizePt = element.size ?? 10, colour, halo, backing } = {}) {
  const { scale, spec } = context;
  const theme = spec.theme;
  ctx.font = font(theme, sizePt, element.weight ?? 400, scale, element);
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${((element.tracking ?? 0) / 100) * sizePt * MM_PER_PT * scale}px`;
  ctx.fillStyle = colour ?? (element.colour || theme.ink);
  ctx.textBaseline = 'top';
  const lineHeight = sizePt * MM_PER_PT * scale * (element.leading ?? 1.25);
  const shown = element.upper ? String(text).toUpperCase() : String(text);
  const lines = wrap(ctx, shown, Math.max(1, box.w - 2 * pad));
  const height = lines.length * lineHeight;
  const room = box.h - 2 * pad;
  const top = element.valign === 'middle' ? box.y + pad + (room - height) / 2
    : element.valign === 'bottom' ? box.y + box.h - pad - height : box.y + pad;
  if (clip) { ctx.save(); ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip(); }
  const placed = lines.map((line) => {
    const width = ctx.measureText(line).width;
    return [line, width, element.align === 'center' ? box.x + (box.w - width) / 2
      : element.align === 'right' ? box.x + box.w - pad - width : box.x + pad];
  });
  if (backing && placed.length) {
    // one plain band under the whole block, tight round the words
    const em = sizePt * MM_PER_PT * scale;
    const left = Math.min(...placed.map(([, , x]) => x)) - 0.3 * em;
    const right = Math.max(...placed.map(([, width, x]) => x + width)) + 0.3 * em;
    ctx.save(); ctx.fillStyle = backing; ctx.fillRect(left, top - 0.1 * em, right - left, height + 0.1 * em); ctx.restore();
  }
  placed.forEach(([line, , x], index) => {
    const y = top + index * lineHeight;
    if (halo ?? element.halo) {
      ctx.save();
      ctx.strokeStyle = typeof (halo ?? element.halo) === 'string' ? (halo ?? element.halo) : HALO;
      ctx.lineWidth = Math.max(2, sizePt * MM_PER_PT * scale * 0.28); ctx.lineJoin = 'round';
      ctx.strokeText(line, x, y);
      ctx.restore();
    }
    ctx.fillText(line, x, y);
  });
  if (clip) ctx.restore();
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  return height > room + 0.5 || lines.some((line) => ctx.measureText(line).width > box.w - 2 * pad + 0.5);
}

function writeBox(ctx, element, context, text) {
  const box = boxPx(element, context.scale);
  const pad = (element.fill || element.border ? 1.6 : 0) * context.scale;
  if (element.fill) { ctx.fillStyle = element.fill; ctx.fillRect(box.x, box.y, box.w, box.h); }
  if (element.border) {
    ctx.strokeStyle = context.spec.theme.ink; ctx.lineWidth = Math.max(1, 0.25 * context.scale);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
  }
  return writeLines(ctx, element, context, text, box, { pad });
}

/**
 * The credits a plate owes: never cut. They shrink to fit their box, down to a size
 * still read in print, and past that they run on rather than lose a source. Over a
 * map they stand on a band of the paper's colour, so dark ground never swallows them:
 * a halo round letters this small blurs them.
 */
function writeCredits(ctx, element, context, text) {
  const box = boxPx(element, context.scale);
  const theme = context.spec.theme;
  const back = backOf(element);
  const pad = (back === 'box' || element.border ? 1.2 : 0) * context.scale;
  if (back === 'box') { ctx.fillStyle = backColourOf(element, theme); ctx.fillRect(box.x, box.y, box.w, box.h); }
  let size = element.size ?? 5.5;
  ctx.font = font(theme, size, 400, context.scale, element);
  const lineHeight = (pt) => pt * MM_PER_PT * context.scale * 1.25;
  while (size > 4.5 && wrap(ctx, text, box.w - 2 * pad).length * lineHeight(size) > box.h) {
    size -= 0.25;
    ctx.font = font(theme, size, 400, context.scale, element);
  }
  const overMap = context.spec.elements.some((map) => MAP_KINDS.includes(map.kind) && overlaps(map.box, element.box));
  writeLines(ctx, { ...element, valign: element.valign ?? 'bottom' }, context, text, box,
    { pad, clip: false, sizePt: size, colour: element.colour || theme.ink, backing: overMap && back === 'band' ? `${theme.paper}d9` : null });
  return wrap(ctx, text, box.w - 2 * pad).length * lineHeight(size) > box.h + 0.5;
}

const overlaps = (a, b) => a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];

// -- maps ----------------------------------------------------------------------------------

/** The grid's ink: what the analyst set, else light over imagery or a dark ground, dark over a pale one. */
function gridInk(map, theme) {
  if (map.grid_style?.colour) return { line: `${map.grid_style.colour}99`, label: map.grid_style.colour, halo: theme.paper };
  const dark = map.basemap === 'plain-dark' || (map.basemap && !String(map.basemap).startsWith('plain'));
  return dark ? { line: 'rgba(255,255,255,0.55)', label: '#ffffff', halo: 'rgba(0,0,0,0.75)' }
    : { line: 'rgba(21,24,30,0.35)', label: theme.ink, halo: HALO };
}

/** Where a sampled grid line meets each edge of the frame, in frame pixels. */
function edgeCrossings(points, frame) {
  const found = {};
  for (let index = 1; index < points.length; index += 1) {
    const [x1, y1] = points[index - 1];
    const [x2, y2] = points[index];
    for (const [edge, axis, value] of [['top', 1, 0], ['bottom', 1, frame.height], ['left', 0, 0], ['right', 0, frame.width]]) {
      const a = axis ? y1 : x1;
      const b = axis ? y2 : x2;
      if ((a - value) * (b - value) > 0 || a === b) continue;
      const t = (value - a) / (b - a);
      const point = [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
      const along = axis ? point[0] : point[1];
      if (along < 0 || along > (axis ? frame.width : frame.height)) continue;
      found[edge] ??= point;
    }
  }
  return found;
}

function drawGrid(ctx, element, context) {
  const live = context.views?.[element.id];
  // a grid's lines are straight only on a flat map
  if (!live || element.grid === 'none' || !element.grid || tilted(live.view)) return;
  const { scale, spec } = context;
  const box = boxPx(element, scale);
  const ratio = scale / PX_PER_MM;
  const style = element.grid_style ?? {};
  const utm = element.grid === 'utm' || element.grid === 'mgrs';
  const grid = utm ? utmGrid(live.view, live.frame, style.step ?? null) : graticule(live.view, live.frame, style.step ?? null);
  const ink = gridInk(element, spec.theme);
  const label = (line) => (utm ? utmLabel(line.value, grid.step, element.grid === 'mgrs')
    : style.format === 'dd' ? decimalLabel(line.value, line.axis, grid.step) : degreeLabel(line.value, line.axis, grid.step));
  ctx.save();
  clipToMap(ctx, element, context);
  ctx.lineWidth = Math.max(0.5, 0.15 * scale);
  ctx.strokeStyle = ink.line;
  const tick = 1.6 * scale;
  for (const line of grid.lines) {
    const points = line.points.map(([px, py]) => [box.x + px * ratio, box.y + py * ratio]);
    const crossing = edgeCrossings(line.points, live.frame);
    if (style.ticks) {
      // a graduated frame: the lines only where they meet the edge
      for (const [edge, [px, py]] of Object.entries(crossing)) {
        const x = box.x + px * ratio;
        const y = box.y + py * ratio;
        ctx.beginPath();
        if (edge === 'top') { ctx.moveTo(x, y); ctx.lineTo(x, y + tick); }
        if (edge === 'bottom') { ctx.moveTo(x, y); ctx.lineTo(x, y - tick); }
        if (edge === 'left') { ctx.moveTo(x, y); ctx.lineTo(x + tick, y); }
        if (edge === 'right') { ctx.moveTo(x, y); ctx.lineTo(x - tick, y); }
        ctx.strokeStyle = ink.label; ctx.lineWidth = Math.max(1, 0.3 * scale); ctx.stroke();
      }
    } else {
      ctx.beginPath();
      points.forEach(([x, y], index) => { if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.strokeStyle = ink.line; ctx.lineWidth = Math.max(0.5, 0.15 * scale);
      ctx.stroke();
    }
    ctx.font = font(spec.theme, 6, 600, scale);
    const text = label(line);
    const width = ctx.measureText(text).width;
    const sides = style.sides === 'four' ? ['top', 'bottom', 'left', 'right'] : ['top', 'left'];
    for (const edge of sides) {
      const at = crossing[edge];
      if (!at) continue;
      const x = box.x + at[0] * ratio;
      const y = box.y + at[1] * ratio;
      const pos = { top: [x + 2, box.y + 2 + (style.ticks ? tick : 0)], bottom: [x + 2, box.y + box.h - 6.5 * MM_PER_PT * scale - 2 - (style.ticks ? tick : 0)],
        left: [box.x + 2 + (style.ticks ? tick : 0), y + 2], right: [box.x + box.w - width - 2 - (style.ticks ? tick : 0), y + 2] }[edge];
      ctx.textBaseline = 'top';
      ctx.lineWidth = Math.max(1, 0.5 * scale); ctx.strokeStyle = ink.halo; ctx.lineJoin = 'round';
      ctx.strokeText(text, pos[0], pos[1]); ctx.fillStyle = ink.label; ctx.fillText(text, pos[0], pos[1]);
    }
  }
  if (utm) {
    const zone = `${element.grid === 'mgrs' ? 'MGRS' : 'UTM'} ${grid.zone}${grid.north ? 'N' : 'S'}`;
    ctx.font = font(spec.theme, 6, 700, scale);
    const w = ctx.measureText(zone).width;
    ctx.strokeStyle = ink.halo; ctx.lineWidth = Math.max(1, 0.5 * scale);
    ctx.strokeText(zone, box.x + box.w - w - 2, box.y + box.h - 6.5 * MM_PER_PT * scale - 2);
    ctx.fillStyle = ink.label; ctx.fillText(zone, box.x + box.w - w - 2, box.y + box.h - 6.5 * MM_PER_PT * scale - 2);
  }
  ctx.restore();
}

/** The ground a map shows, outlined on the map it is drawn from: an inset's, or a detail's. */
function drawFootprint(ctx, outer, inner, context, { connect = false } = {}) {
  const { scale, spec } = context;
  const outerLive = context.views?.[outer.id];
  const innerLive = context.views?.[inner.id];
  if (!outerLive || !innerLive) return;
  const ratio = scale / PX_PER_MM;
  const ob = boxPx(outer, scale);
  // a leaning map outlines the ground it looks at, short of the horizon
  const ring = corners(innerLive.view, innerLive.frame).map((point) => {
    const [px, py] = project(outerLive.view, outerLive.frame, point);
    return [ob.x + px * ratio, ob.y + py * ratio];
  });
  ctx.save();
  ctx.beginPath(); ctx.rect(ob.x, ob.y, ob.w, ob.h); ctx.clip();
  ctx.beginPath();
  ring.forEach(([x, y], index) => { if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.closePath();
  ctx.fillStyle = `${spec.theme.accent}22`; ctx.fill();
  ctx.strokeStyle = spec.theme.accent; ctx.lineWidth = Math.max(1, 0.4 * scale); ctx.stroke();
  ctx.restore();
  if (!connect) return;
  // two lines from the outlined ground to the detail's frame, from the corners nearest it
  const ib = boxPx(inner, scale);
  const frameCorners = [[ib.x, ib.y], [ib.x + ib.w, ib.y], [ib.x + ib.w, ib.y + ib.h], [ib.x, ib.y + ib.h]];
  const pairs = ring.map((point, index) => [point, frameCorners[index], Math.hypot(point[0] - frameCorners[index][0], point[1] - frameCorners[index][1])])
    .sort((a, b) => a[2] - b[2]).slice(0, 2);
  ctx.save();
  ctx.strokeStyle = spec.theme.accent; ctx.lineWidth = Math.max(1, 0.3 * scale);
  for (const [from, to] of pairs) { ctx.beginPath(); ctx.moveTo(from[0], from[1]); ctx.lineTo(to[0], to[1]); ctx.stroke(); }
  ctx.restore();
}

function drawFrame(ctx, element, context) {
  const { scale, spec } = context;
  const box = boxPx(element, scale);
  if (element.kind === 'map') drawGrid(ctx, element, context);
  if (element.kind === 'inset') {
    const outer = spec.elements.find((item) => item.id === element.of);
    if (outer) drawFootprint(ctx, element, outer, context);
  }
  if (element.kind === 'map' && element.of) {
    const parent = spec.elements.find((item) => item.id === element.of);
    if (parent) drawFootprint(ctx, parent, element, context, { connect: true });
  }
  if (element.border !== false) {
    ctx.strokeStyle = spec.theme.ink; ctx.lineWidth = Math.max(1, 0.3 * scale * (element.width ?? 1));
    ctx.strokeRect(box.x, box.y, box.w, box.h);
  }
}

// -- the legend, the scale, the north -----------------------------------------------------

function drawSwatch(ctx, entry, x, y, size, context) {
  const { scale } = context;
  ctx.save();
  if (entry.kind === 'point') {
    const picture = context.markerImage?.(entry.symbol || 'pin', entry.colour, { status: entry.status ?? '' });
    if (picture) ctx.drawImage(picture, x, y, size, size);
    else { ctx.fillStyle = entry.colour; ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 3, 0, Math.PI * 2); ctx.fill(); }
  } else if (entry.kind === 'new') {
    ctx.strokeStyle = entry.colour; ctx.lineWidth = Math.max(1.5, 0.45 * scale);
    ctx.fillStyle = 'rgba(255, 212, 0, 0.2)';
    ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size * 0.36, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  } else if (entry.kind === 'line' || entry.kind === 'trail') {
    ctx.strokeStyle = entry.colour; ctx.lineWidth = Math.max(1, 0.6 * scale); ctx.lineCap = 'round';
    if (entry.kind === 'trail') { ctx.setLineDash([size / 6, size / 6]); ctx.globalAlpha = 0.6; }
    ctx.beginPath(); ctx.moveTo(x + 1, y + size * 0.65); ctx.lineTo(x + size - 1, y + size * 0.35); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.rect(x + 1, y + size * 0.15, size - 2, size * 0.7);
    ctx.save(); ctx.clip();
    if (entry.kind === 'area') {
      ctx.fillStyle = entry.colour; ctx.globalAlpha = 0.25; ctx.fillRect(x, y, size, size);
    } else {
      // gains in close stripes one way, losses in sparser ones the other, as on the map
      ctx.strokeStyle = entry.colour; ctx.lineWidth = Math.max(1, (entry.kind === 'gained' ? 0.35 : 0.25) * scale);
      ctx.globalAlpha = entry.kind === 'gained' ? 0.85 : 0.5;
      const gap = size / (entry.kind === 'gained' ? 5 : 3.5);
      for (let offset = -size; offset < size * 2; offset += gap) {
        ctx.beginPath();
        if (entry.kind === 'gained') { ctx.moveTo(x + offset, y + size); ctx.lineTo(x + offset + size, y); }
        else { ctx.moveTo(x + offset, y); ctx.lineTo(x + offset + size, y + size); }
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = entry.colour; ctx.lineWidth = Math.max(1, 0.25 * scale);
    if (entry.kind === 'lost') ctx.setLineDash([size / 8, size / 10]);
    ctx.strokeRect(x + 1, y + size * 0.15, size - 2, size * 0.7);
  }
  ctx.restore();
}

function drawLegend(ctx, element, context) {
  const { scale, spec } = context;
  const theme = spec.theme;
  const box = boxPx(element, scale);
  const entries = (context.legend?.[element.id] ?? context.legend?.[element.of] ?? []).filter((entry) => !entry.off);
  if (element.fill) { ctx.fillStyle = element.fill; ctx.fillRect(box.x, box.y, box.w, box.h); }
  if (element.border) { ctx.strokeStyle = theme.ink; ctx.lineWidth = Math.max(1, 0.25 * scale); ctx.strokeRect(box.x, box.y, box.w, box.h); }
  const size = element.size ?? 8;
  const pad = 2 * scale;
  const line = size * MM_PER_PT * scale * 1.55;
  const swatch = size * MM_PER_PT * scale * 1.35;
  ctx.save();
  ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
  ctx.textBaseline = 'middle';
  ctx.fillStyle = element.colour || theme.ink;
  ctx.font = font(theme, size * 1.15, 700, scale, element);
  ctx.fillText(element.text || 'Legend', box.x + pad, box.y + pad + line / 2);
  const columns = element.columns ?? 1;
  const columnWidth = (box.w - 2 * pad) / columns;
  const perColumn = Math.max(1, Math.ceil(entries.length / columns));
  ctx.font = font(theme, size, 400, scale, element);
  entries.forEach((entry, index) => {
    const column = Math.floor(index / perColumn);
    const row = index % perColumn;
    const x = box.x + pad + column * columnWidth;
    const y = box.y + pad + line * (row + 1.25);
    drawSwatch(ctx, entry, x, y + (line - swatch) / 2, swatch, context);
    ctx.fillStyle = element.colour || theme.ink;
    const label = entry.label;
    const room = columnWidth - swatch - 2 * scale;
    let text = label;
    while (text.length > 1 && ctx.measureText(text).width > room) text = text.slice(0, -2);
    ctx.fillText(text === label ? text : `${text}…`, x + swatch + 1.5 * scale, y + line / 2);
  });
  if (!entries.length && context.editing) {
    ctx.fillStyle = theme.ink; ctx.globalAlpha = 0.5;
    ctx.fillText('What the map draws is listed here', box.x + pad, box.y + pad + line * 1.75);
  }
  ctx.restore();
  return pad * 2 + line * (perColumn + 1.25);
}

function drawBar(ctx, context, x, top, length, height, segments, label, style, theme, ink = theme.ink) {
  const { scale } = context;
  ctx.strokeStyle = ink; ctx.lineWidth = Math.max(1, 0.2 * scale);
  if (style === 'line') {
    ctx.beginPath(); ctx.moveTo(x, top + height); ctx.lineTo(x + length, top + height);
    ctx.moveTo(x, top); ctx.lineTo(x, top + height); ctx.moveTo(x + length, top); ctx.lineTo(x + length, top + height); ctx.stroke();
  } else if (style === 'ticks') {
    ctx.beginPath(); ctx.moveTo(x, top + height); ctx.lineTo(x + length, top + height);
    for (let index = 0; index <= segments; index += 1) {
      const at = x + (length / segments) * index;
      ctx.moveTo(at, top + (index % segments === 0 ? 0 : height / 2)); ctx.lineTo(at, top + height);
    }
    ctx.stroke();
  } else {
    for (let index = 0; index < segments; index += 1) {
      ctx.fillStyle = index % 2 ? (theme.paper ?? '#fff') : ink;
      ctx.fillRect(x + (length / segments) * index, top, length / segments, height);
    }
    ctx.strokeRect(x, top, length, height);
  }
  ctx.fillStyle = ink; ctx.textBaseline = 'top';
  ctx.fillText('0', x - 0.5 * scale, top + height + 0.6 * scale);
  const width = ctx.measureText(label).width;
  ctx.fillText(label, x + length - width / 2, top + height + 0.6 * scale);
}

function drawScale(ctx, element, context) {
  const { scale, spec } = context;
  const map = frameOf(element, context);
  if (!map) return;
  const box = boxPx(element, scale);
  const theme = spec.theme;
  if (tilted(map.view)) {
    // the ground shrinks toward the horizon of a tilted map: no one length holds across it
    if (context.editing) haloText(ctx, 'No scale on a tilted map', box.x + box.w / 2, box.y + box.h / 2, theme.ink, context, 6);
    return;
  }
  if (element.fill) { ctx.fillStyle = element.fill; ctx.globalAlpha = 0.85; ctx.fillRect(box.x, box.y, box.w, box.h); ctx.globalAlpha = 1; }
  const ratio = scale / PX_PER_MM;
  const pad = 1.2 * scale;
  const units = element.units && element.units !== 'auto' ? element.units : context.imperial ? 'imperial' : 'metric';
  const bars = units === 'both' ? [false, true] : [units === 'imperial'];
  const share = (box.h - 2 * pad) / bars.length;
  ctx.font = font(theme, element.size && element.size !== 10 ? element.size : 7, 600, scale, element);
  bars.forEach((imperial, index) => {
    const bar = scaleBar(map.view, (box.w - 2 * pad) / ratio * 0.72, imperial);
    const height = Math.max(2, Math.min(share * 0.32, 1.3 * scale));
    drawBar(ctx, context, box.x + pad, box.y + pad + index * share, bar.pixels * ratio, height, bar.segments, bar.label, element.variant ?? 'bar', theme,
      element.colour || theme.ink);
  });
}

function drawNorth(ctx, element, context) {
  const { scale, spec } = context;
  const map = frameOf(element, context);
  const box = boxPx(element, scale);
  const theme = spec.theme;
  const turn = -((map?.view.bearing ?? 0) * Math.PI) / 180;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h * 0.6;
  const length = Math.min(box.w * 1.1, box.h * 0.75);
  if (element.fill) {
    // a backing, so the arrow reads on any ground
    ctx.save(); ctx.globalAlpha = 0.85; ctx.fillStyle = element.fill;
    ctx.beginPath(); ctx.arc(cx, box.y + box.h / 2, Math.max(box.w, box.h) * 0.55, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(turn);
  const half = length * 0.32;
  ctx.lineWidth = Math.max(1, 0.2 * scale); ctx.strokeStyle = theme.ink;
  const variant = element.variant ?? 'arrow';
  if (variant === 'simple') {
    ctx.beginPath(); ctx.moveTo(0, length / 2); ctx.lineTo(0, -length / 2); ctx.lineTo(-half * 0.6, -length / 2 + half); ctx.moveTo(0, -length / 2); ctx.lineTo(half * 0.6, -length / 2 + half);
    ctx.lineWidth = Math.max(1, 0.35 * scale); ctx.stroke();
  } else if (variant === 'star') {
    for (let index = 0; index < 4; index += 1) {
      ctx.save(); ctx.rotate((index * Math.PI) / 2);
      const tip = index === 0 ? length / 2 : length * 0.36;
      ctx.beginPath(); ctx.moveTo(0, -tip); ctx.lineTo(half * 0.45, 0); ctx.lineTo(0, 0); ctx.closePath();
      ctx.fillStyle = theme.ink; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -tip); ctx.lineTo(-half * 0.45, 0); ctx.lineTo(0, 0); ctx.closePath();
      ctx.fillStyle = theme.paper ?? '#fff'; ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  } else if (variant !== 'letter') {
    ctx.beginPath(); ctx.moveTo(0, -length / 2); ctx.lineTo(half, length / 2); ctx.lineTo(0, length * 0.3); ctx.closePath();
    ctx.fillStyle = theme.paper ?? '#fff'; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -length / 2); ctx.lineTo(-half, length / 2); ctx.lineTo(0, length * 0.3); ctx.closePath();
    ctx.fillStyle = theme.ink; ctx.fill(); ctx.stroke();
  }
  ctx.fillStyle = theme.ink;
  ctx.font = font(theme, Math.max(6, (length / scale / MM_PER_PT) * (variant === 'letter' ? 0.9 : 0.42)), 700, scale);
  ctx.textAlign = 'center'; ctx.textBaseline = variant === 'letter' ? 'middle' : 'bottom';
  ctx.fillText('N', 0, variant === 'letter' ? 0 : -length / 2 - 0.3 * scale);
  ctx.restore();
}

// -- pictures ----------------------------------------------------------------------------

/** The key a picture is kept under in `context.images`: its file, the signature, or its own data. */
export const pictureKey = (element) => element.data ? `data:${element.id}` : element.src || '';

function drawImage(ctx, element, context) {
  const box = boxPx(element, context.scale);
  const picture = context.images?.get?.(pictureKey(element));
  if (element.at && element.of) drawLeader(ctx, element, context, box, { colour: element.colour || context.spec.theme.ink });
  if (!picture) {
    if (!context.editing) return;
    ctx.save();
    ctx.strokeStyle = context.spec.theme.ink; ctx.globalAlpha = 0.35; ctx.setLineDash([4, 3]);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.restore();
    return;
  }
  const width = picture.width ?? picture.naturalWidth;
  const height = picture.height ?? picture.naturalHeight;
  ctx.save();
  ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
  const fit = element.fit === 'cover' ? Math.max(box.w / width, box.h / height) : Math.min(box.w / width, box.h / height);
  ctx.drawImage(picture, box.x + (box.w - width * fit) / 2, box.y + (box.h - height * fit) / 2, width * fit, height * fit);
  ctx.restore();
  if (element.border) {
    ctx.strokeStyle = element.colour || context.spec.theme.ink; ctx.lineWidth = Math.max(1, 0.25 * context.scale * (element.width ?? 1));
    ctx.strokeRect(box.x, box.y, box.w, box.h);
  }
}

// -- videos ------------------------------------------------------------------------------

/**
 * A video of a step: its still frame where the clip starts (an export draws it, the
 * editor shows the video itself under the page's writing), its frame, the line
 * saying its source, and the leader to the point it shows. `over` draws only what
 * stands on top of the running clip: the frame and the source line.
 */
function drawVideo(ctx, element, context, { over = false } = {}) {
  const box = boxPx(element, context.scale);
  const theme = context.spec.theme;
  if (!over) {
    if (element.at && element.of) drawLeader(ctx, element, context, box, { colour: element.colour || theme.ink });
    const still = context.editing ? null : context.images?.get?.(posterKey(element));
    if (still) {
      const width = still.width ?? still.videoWidth;
      const height = still.height ?? still.videoHeight;
      ctx.save();
      ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
      ctx.fillStyle = '#000'; ctx.fillRect(box.x, box.y, box.w, box.h);
      const fit = element.fit === 'cover' ? Math.max(box.w / width, box.h / height) : Math.min(box.w / width, box.h / height);
      ctx.drawImage(still, box.x + (box.w - width * fit) / 2, box.y + (box.h - height * fit) / 2, width * fit, height * fit);
      ctx.restore();
    } else if (context.editing && !element.src) {
      ctx.save();
      ctx.strokeStyle = theme.ink; ctx.globalAlpha = 0.35; ctx.setLineDash([4, 3]);
      ctx.strokeRect(box.x, box.y, box.w, box.h);
      ctx.restore();
    }
  }
  if (element.caption && element.text) {
    const sizePt = element.size ?? 7;
    const band = Math.min(box.h * 0.4, sizePt * MM_PER_PT * context.scale * 1.9);
    ctx.save();
    if (backOf(element) === 'box') {
      ctx.fillStyle = element.fill ? `${element.fill}9e` : 'rgba(0, 0, 0, 0.62)';
      ctx.fillRect(box.x, box.y + box.h - band, box.w, band);
    }
    ctx.font = font(theme, sizePt, 600, context.scale, element);
    ctx.fillStyle = inkOf(element, theme); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const pad = 1.2 * context.scale;
    let line = String(element.text);
    while (line.length > 1 && ctx.measureText(line).width > box.w - 2 * pad) line = `${line.slice(0, -2)}…`;
    ctx.fillText(line, box.x + pad, box.y + box.h - band / 2);
    ctx.restore();
  }
  if (element.border) {
    ctx.strokeStyle = element.colour || theme.ink; ctx.lineWidth = Math.max(1, 0.25 * context.scale * (element.width ?? 1));
    ctx.strokeRect(box.x, box.y, box.w, box.h);
  }
}

/**
 * What stands over a step's running clips, on a see-through page: each clip's frame
 * and source line. The export lays it on the moving picture so the clip never covers them.
 */
export function drawOver(ctx, spec, context) {
  for (const element of spec.elements) {
    if (element.kind !== 'video' || element.hidden || !shownOn(element, context.at ?? null, context.place)) continue;
    ctx.save();
    ctx.globalAlpha = element.opacity ?? 1;
    drawVideo(ctx, element, { ...context, spec }, { over: true });
    ctx.restore();
  }
}

// -- labels, arrows and what stands on the ground ------------------------------------------

/** The point on a box's edge facing `to`, where a leader leaves it. */
function edgeToward(box, [tx, ty]) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (!dx && !dy) return [cx, cy];
  const fit = Math.min(Math.abs((box.w / 2) / (dx || 1e-9)), Math.abs((box.h / 2) / (dy || 1e-9)));
  return [cx + dx * Math.min(1, fit), cy + dy * Math.min(1, fit)];
}

function arrowHead(ctx, [x, y], angle, size) {
  ctx.beginPath(); ctx.moveTo(x, y);
  ctx.lineTo(x - Math.cos(angle - 0.42) * size, y - Math.sin(angle - 0.42) * size);
  ctx.lineTo(x - Math.cos(angle + 0.42) * size, y - Math.sin(angle + 0.42) * size);
  ctx.closePath(); ctx.fill();
}

/** A leader from a box to the ground point it names: straight, elbowed or curved, ended by a dot or an arrow. */
function drawLeader(ctx, element, context, box, { colour }) {
  const map = frameOf(element, context);
  const point = map && element.at ? map.at(element.at) : null;
  if (!point || element.leader === 'none') return;
  const inside = point[0] >= box.x && point[0] <= box.x + box.w && point[1] >= box.y && point[1] <= box.y + box.h;
  if (inside) return;
  const { scale } = context;
  const [ex, ey] = edgeToward(box, point);
  ctx.save();
  ctx.strokeStyle = colour; ctx.fillStyle = colour; ctx.lineWidth = Math.max(1, 0.25 * scale * (element.width ?? 1));
  ctx.beginPath(); ctx.moveTo(ex, ey);
  let angle = Math.atan2(point[1] - ey, point[0] - ex);
  if (element.leader === 'elbow') {
    ctx.lineTo(point[0], ey); ctx.lineTo(point[0], point[1]);
    angle = Math.atan2(point[1] - ey, 0) || Math.PI / 2;
  } else if (element.leader === 'curve') {
    const cx = (ex + point[0]) / 2 - (point[1] - ey) * 0.25;
    const cy = (ey + point[1]) / 2 + (point[0] - ex) * 0.25;
    ctx.quadraticCurveTo(cx, cy, point[0], point[1]);
    angle = Math.atan2(point[1] - cy, point[0] - cx);
  } else ctx.lineTo(point[0], point[1]);
  ctx.stroke();
  const end = element.end ?? 'dot';
  if (end === 'dot') { ctx.beginPath(); ctx.arc(point[0], point[1], Math.max(1.5, 0.6 * scale), 0, Math.PI * 2); ctx.fill(); }
  if (end === 'arrow') arrowHead(ctx, point, angle, Math.max(4, 2 * scale));
  ctx.restore();
}

function drawLabel(ctx, element, context) {
  // a text on the map stands over its point, wherever this day or step frames the map, and on it only
  const map = standsOver(element) ? frameOf(element, context) : null;
  const point = map?.at(element.at);
  if (!point) return drawLabelIn(ctx, element, context, boxPx(element, context.scale));
  const box = boxPx(element, context.scale);
  ctx.save();
  ctx.beginPath(); ctx.rect(map.box.x, map.box.y, map.box.w, map.box.h); ctx.clip();
  const ran = drawLabelIn(ctx, element, context, { ...box, x: point[0] - box.w / 2, y: point[1] - box.h / 2 });
  ctx.restore();
  return ran;
}

/** A label's words, in their look, in `box` on the canvas, and its leader to its point. */
function drawLabelIn(ctx, element, context, box) {
  const { scale, spec } = context;
  const theme = spec.theme;
  const colour = element.colour || theme.ink;
  drawLeader(ctx, element, context, box, { colour });
  ctx.save();
  if (element.style === 'number') {
    const radius = Math.min(box.w, box.h) / 2;
    ctx.fillStyle = element.fill || theme.accent;
    ctx.beginPath(); ctx.arc(box.x + box.w / 2, box.y + box.h / 2, radius, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = theme.paper; ctx.lineWidth = Math.max(1, 0.3 * scale); ctx.stroke();
    ctx.fillStyle = element.colour || '#ffffff';
    ctx.font = font(theme, (element.size ?? 9) * 1.05, 700, scale, element);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(context.numberOf?.(element.id) ?? '•'), box.x + box.w / 2, box.y + box.h / 2 + 0.2 * scale);
    ctx.restore();
    return false;
  }
  if (element.style !== 'plain') {
    ctx.fillStyle = element.fill || theme.paper || '#fff';
    ctx.strokeStyle = colour; ctx.lineWidth = Math.max(1, 0.25 * scale);
    const radius = element.style === 'bubble' ? Math.min(box.h / 2, 2 * scale) : 0;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(box.x, box.y, box.w, box.h, radius) : ctx.rect(box.x, box.y, box.w, box.h);
    ctx.fill(); ctx.stroke();
  }
  ctx.restore();
  const plainHalo = element.back === 'none' ? false : element.fill || true;
  return writeLines(ctx, { ...element, align: element.align ?? 'center', valign: 'middle', weight: element.weight ?? 600, halo: (element.style ?? 'plain') === 'plain' ? plainHalo : element.halo },
    context, element.text || '', box, { pad: element.style === 'plain' ? 0 : 1 * scale, clip: false, colour });
}

/** The points of an arrow's path on the canvas, bent by `bend` along its length. */
function arrowPath(a, b, bend) {
  const steps = 24;
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const normal = length ? [-(b[1] - a[1]) / length, (b[0] - a[0]) / length] : [0, 0];
  const control = [mid[0] + normal[0] * bend * length * 0.5, mid[1] + normal[1] * bend * length * 0.5];
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    return [(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * control[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * control[1] + t * t * b[1]];
  });
}

function drawArrow(ctx, element, context, t = 1) {
  const { scale, spec } = context;
  const map = frameOf(element, context);
  if (!map) return;
  const a = map.at(element.at);
  const b = map.at(element.to);
  const width = Math.max(1, (element.width ?? 1) * scale);
  const head = Math.max(width * 3.2, 2.5 * scale) * (element.head ?? 1);
  const colour = element.colour || spec.theme.accent;
  // drawn along its way, an arrow is the part of itself it has reached, its head at the tip
  const whole = arrowPath(a, b, element.bend ?? 0);
  const path = partOf(whole, t);
  const tip = path.at(-1);
  const angleAt = (index) => Math.atan2(path[index][1] - path[index - 1][1], path[index][0] - path[index - 1][0]);
  if (path.length < 2) return;
  ctx.save();
  // cut at its map's frame, as everything on the ground is
  ctx.beginPath(); ctx.rect(map.box.x, map.box.y, map.box.w, map.box.h); ctx.clip();
  ctx.strokeStyle = colour; ctx.fillStyle = colour; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (element.shape === 'offensive') {
    // the broad arrow of an advance: a band that narrows toward its head
    const tail = width * 2.2;
    const neck = width * 1.4;
    const left = [];
    const right = [];
    const last = path.length - 1;
    const stop = Math.max(1, Math.round(last * (1 - Math.min(0.45, (head * 1.6) / Math.max(1, Math.hypot(tip[0] - a[0], tip[1] - a[1]))))));
    for (let index = 0; index <= stop; index += 1) {
      const angle = angleAt(Math.max(1, index));
      const half = tail + (neck - tail) * (index / stop);
      left.push([path[index][0] - Math.sin(angle) * half, path[index][1] + Math.cos(angle) * half]);
      right.push([path[index][0] + Math.sin(angle) * half, path[index][1] - Math.cos(angle) * half]);
    }
    const angle = angleAt(last);
    const base = path[stop];
    const wide = neck * 2.2;
    ctx.beginPath();
    left.forEach(([x, y], index) => { if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.lineTo(base[0] - Math.sin(angle) * wide, base[1] + Math.cos(angle) * wide);
    ctx.lineTo(tip[0], tip[1]);
    ctx.lineTo(base[0] + Math.sin(angle) * wide, base[1] - Math.cos(angle) * wide);
    right.toReversed().forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.closePath();
    ctx.globalAlpha *= 0.85; ctx.fill(); ctx.globalAlpha /= 0.85;
    ctx.strokeStyle = spec.theme.ink; ctx.lineWidth = Math.max(1, 0.15 * scale); ctx.stroke();
  } else {
    strokeWithHeads(ctx, path, { width, head, line: element.line, heads: element.heads ?? 'end' });
  }
  ctx.restore();
  if (element.text && t >= 1) wordsAlong(ctx, element, context, whole, width);
}

/**
 * A line of canvas points stroked with its heads: `end`, `both` or `none`. The line
 * stops short of a head so its round cap does not show past the point.
 */
function strokeWithHeads(ctx, path, { width, head, line, heads }) {
  const a = path[0];
  const b = path.at(-1);
  const angleAt = (index) => Math.atan2(path[index][1] - path[index - 1][1], path[index][0] - path[index - 1][0]);
  ctx.lineWidth = width;
  ctx.setLineDash(dashFor(line, width));
  const short = head * 0.7;
  const trimmed = path.filter(([x, y]) => (heads === 'none' || Math.hypot(b[0] - x, b[1] - y) >= short)
    && (heads !== 'both' || Math.hypot(a[0] - x, a[1] - y) >= short));
  if (trimmed.length < 2) trimmed.splice(0, trimmed.length, a, b);
  ctx.beginPath();
  trimmed.forEach(([x, y], index) => { if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.stroke();
  ctx.setLineDash([]);
  if (heads !== 'none') arrowHead(ctx, b, angleAt(path.length - 1), head);
  if (heads === 'both') arrowHead(ctx, a, angleAt(1) + Math.PI, head);
}

/** An element's words along the middle of its line, turned to read upright, above it. */
function wordsAlong(ctx, element, context, path, width) {
  const { scale } = context;
  const lengths = path.slice(1).map((point, index) => Math.hypot(point[0] - path[index][0], point[1] - path[index][1]));
  let left = lengths.reduce((sum, value) => sum + value, 0) / 2;
  let index = 0;
  while (index < lengths.length - 1 && left > lengths[index]) { left -= lengths[index]; index += 1; }
  const [a, b] = [path[index], path[index + 1] ?? path[index]];
  const k = lengths[index] ? left / lengths[index] : 0;
  let angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
  ctx.save();
  // the words stay on their map, as the line does
  const map = frameOf(element, context);
  if (map) { ctx.beginPath(); ctx.rect(map.box.x, map.box.y, map.box.w, map.box.h); ctx.clip(); }
  ctx.translate(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k); ctx.rotate(angle);
  groundWords(ctx, element.text, 0, -width / 2 - 0.6 * scale, element, context, { baseline: 'bottom' });
  ctx.restore();
}

/**
 * Words written over the ground, in the element's face, weight, style and colour:
 * on a halo of the paper (as they always were), on nothing, or in a box of its fill.
 */
function groundWords(ctx, text, x, y, element, context, { sizePt = element.size ?? defaultSize(element.kind), baseline = 'middle' } = {}) {
  const { scale, spec } = context;
  const words = element.upper ? String(text).toUpperCase() : String(text);
  ctx.save();
  ctx.font = font(spec.theme, sizePt, element.weight ?? 700, scale, element);
  ctx.textAlign = 'center'; ctx.textBaseline = baseline;
  const back = backOf(element);
  if (back === 'box') {
    const em = sizePt * MM_PER_PT * scale;
    const width = ctx.measureText(words).width;
    const top = baseline === 'bottom' ? y - em * 1.2 : baseline === 'top' ? y - em * 0.15 : y - em * 0.68;
    ctx.fillStyle = backColourOf(element, spec.theme);
    ctx.fillRect(x - width / 2 - 0.35 * em, top, width + 0.7 * em, em * 1.36);
  } else if (back === 'halo') {
    ctx.lineWidth = Math.max(2, 0.7 * scale); ctx.strokeStyle = spec.theme.paper ?? HALO; ctx.lineJoin = 'round';
    ctx.strokeText(words, x, y);
  }
  ctx.fillStyle = inkOf(element, spec.theme); ctx.fillText(words, x, y);
  ctx.restore();
}

/** A line of ground points through which a curve runs smoothly (Catmull-Rom), as canvas points. */
export function smoothThrough(points, steps = 12) {
  if (points.length < 3) return points;
  const out = [points[0]];
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(points.length - 1, index + 2)];
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([0, 1].map((axis) => 0.5 * ((2 * p1[axis]) + (-p0[axis] + p2[axis]) * t + (2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * t2
        + (-p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis]) * t3)));
    }
  }
  return out;
}

/**
 * A symbol, one of the markers the case's layers draw, standing over its point of the
 * ground however the map is framed: as wide as its box, turned as it is set, cut at its
 * map's frame. The marker is drawn at the size it prints at (`context.markerImage`).
 */
function drawSymbol(ctx, element, context) {
  const map = frameOf(element, context);
  const point = map?.at(element.at);
  if (!point) return;
  const side = Math.min(element.box[2], element.box[3]) * context.scale;
  const picture = context.markerImage?.(element.symbol || 'pin', element.colour || context.spec.theme.accent, { status: element.status || '' }, side);
  if (!picture) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(map.box.x, map.box.y, map.box.w, map.box.h); ctx.clip();
  ctx.translate(point[0], point[1]);
  if (element.rotate) ctx.rotate((element.rotate * Math.PI) / 180);
  ctx.drawImage(picture, -side / 2, -side / 2, side, side);
  ctx.restore();
}

/** A line on the ground: from point to point, or curved through them, dashed or not, with heads, and its words along it. */
function drawLine(ctx, element, context, t = 1) {
  const { scale, spec } = context;
  const map = frameOf(element, context);
  if (!map || (element.points?.length ?? 0) < 2) return;
  const through = element.points.map((point) => map.at(point));
  const whole = element.shape === 'curve' ? smoothThrough(through) : through;
  const path = partOf(whole, t);
  if (path.length < 2) return;
  const width = Math.max(1, 0.3 * scale * (element.width ?? 1));
  const head = Math.max(width * 3.2, 2.5 * scale) * (element.head ?? 1);
  ctx.save();
  ctx.beginPath(); ctx.rect(map.box.x, map.box.y, map.box.w, map.box.h); ctx.clip();
  ctx.strokeStyle = element.colour || spec.theme.accent; ctx.fillStyle = ctx.strokeStyle;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  strokeWithHeads(ctx, path, { width, head, line: element.line, heads: element.heads ?? 'none' });
  ctx.restore();
  if (element.text && t >= 1) wordsAlong(ctx, element, context, whole, width);
}

/** A ring of ground points as a path on the canvas. */
function groundPath(ctx, map, ring, close = true) {
  ctx.beginPath();
  ring.forEach((point, index) => {
    const [x, y] = map.at(point);
    if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  });
  if (close) ctx.closePath();
}

function hatch(ctx, box, colour, scale, gap = 1.6) {
  ctx.strokeStyle = colour; ctx.lineWidth = Math.max(1, 0.25 * scale);
  const step = gap * scale;
  for (let offset = -box.h; offset < box.w + box.h; offset += step) {
    ctx.beginPath(); ctx.moveTo(box.x + offset, box.y + box.h); ctx.lineTo(box.x + offset + box.h, box.y); ctx.stroke();
  }
}

/** An area on the ground in one of the looks: filled, hatched, glowing or outlined. */
function paintArea(ctx, map, ring, element, context) {
  const { scale, spec } = context;
  const colour = element.colour || spec.theme.accent;
  const width = Math.max(1, 0.3 * scale * (element.width ?? 1));
  ctx.save();
  ctx.beginPath(); ctx.rect(map.box.x, map.box.y, map.box.w, map.box.h); ctx.clip();
  groundPath(ctx, map, ring);
  if (element.look === 'hatch') {
    ctx.save(); ctx.clip(); hatch(ctx, map.box, colour, scale); ctx.restore();
    groundPath(ctx, map, ring);
  } else if (element.look === 'glow') {
    ctx.shadowColor = colour; ctx.shadowBlur = 4 * scale;
    ctx.fillStyle = `${colour}26`; ctx.fill();
  } else if (element.look !== 'outline') {
    ctx.fillStyle = `${colour}40`; ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.setLineDash(dashFor(element.line, width));
  ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.stroke();
  ctx.restore();
}

/** The ground outside a zone dimmed, a spotlight on what it holds. */
function paintMask(ctx, map, ring, element) {
  ctx.save();
  ctx.beginPath(); ctx.rect(map.box.x, map.box.y, map.box.w, map.box.h); ctx.clip();
  ctx.beginPath();
  ctx.rect(map.box.x, map.box.y, map.box.w, map.box.h);
  ring.forEach((point, index) => { const [x, y] = map.at(point); if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.closePath();
  ctx.fillStyle = `rgba(0,0,0,${element.mask?.darkness ?? 0.55})`;
  ctx.fill('evenodd');
  ctx.restore();
}

function haloText(ctx, text, x, y, colour, context, sizePt = 7, element = {}) {
  const { scale, spec } = context;
  ctx.save();
  ctx.font = font(spec.theme, sizePt, 700, scale, element);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(2, 0.7 * scale); ctx.strokeStyle = spec.theme.paper ?? HALO; ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = colour; ctx.fillText(text, x, y);
  ctx.restore();
}

/** A length as the plate writes it, in the units it is set in. */
export function lengthLabel(metres, imperial = false) {
  if (imperial) {
    const miles = metres / 1609.344;
    return miles >= 0.5 ? `${miles.toFixed(miles >= 10 ? 0 : 1)} mi` : `${Math.round(metres / 0.3048)} ft`;
  }
  return metres >= 1000 ? `${(metres / 1000).toFixed(metres >= 10000 ? 0 : 1)} km` : `${Math.round(metres)} m`;
}

/** What stands on the ground, cut at its map's frame like the ground itself: its words and marks never spill onto the page. */
function drawGround(ctx, element, context, t = 1) {
  const map = frameOf(element, context);
  if (!map) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(map.box.x, map.box.y, map.box.w, map.box.h); ctx.clip();
  groundIn(ctx, map, element, context, t);
  ctx.restore();
}

function groundIn(ctx, map, element, context, t) {
  const { scale, spec } = context;
  const colour = element.colour || spec.theme.accent;
  if (element.kind === 'zone') {
    if (element.mask?.on) paintMask(ctx, map, element.points, element);
    paintArea(ctx, map, element.points, element, context);
    if (element.text) {
      const middle = element.points.reduce((sum, [lon, lat]) => [sum[0] + lon / element.points.length, sum[1] + lat / element.points.length], [0, 0]);
      const [x, y] = map.at(middle);
      groundWords(ctx, element.text, x, y, element, context);
    }
  } else if (element.kind === 'ring') {
    const radii = element.radii?.length ? element.radii : [1];
    for (const km of radii) {
      const ring = circle(element.at, km * 1000);
      paintArea(ctx, map, ring, { ...element, look: element.look === 'fill' ? 'outline' : element.look }, context);
      const [x, y] = map.at(ring[0]);
      groundWords(ctx, lengthLabel(km * 1000, context.imperial), x, y, element, context);
    }
    const [cx, cy] = map.at(element.at);
    ctx.save(); ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(cx, cy, Math.max(1.5, 0.6 * scale), 0, Math.PI * 2); ctx.fill(); ctx.restore();
    if (element.text) groundWords(ctx, element.text, cx, cy - 2.4 * scale, element, context, { baseline: 'bottom' });
  } else if (element.kind === 'cone') {
    const reach = (element.reach ?? 1) * 1000;
    paintArea(ctx, map, sector(element.at, element.bearing ?? 0, element.spread ?? 60, reach), element, context);
    const [cx, cy] = map.at(element.at);
    ctx.save(); ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(cx, cy, Math.max(2, 0.8 * scale), 0, Math.PI * 2); ctx.fill(); ctx.restore();
    if (element.text) {
      // its words in the middle of what it sees
      const [x, y] = map.at(travel(element.at, element.bearing ?? 0, reach * 0.6));
      groundWords(ctx, element.text, x, y, element, context);
    }
  } else if (element.kind === 'measure') {
    const a = map.at(element.at);
    const whole = map.at(element.to);
    const b = partOf([a, whole], t).at(-1);
    const width = Math.max(1, 0.3 * scale * (element.width ?? 1));
    ctx.save();
    ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.setLineDash(dashFor(element.line ?? 'dashed', width));
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    ctx.setLineDash([]);
    const angle = Math.atan2(whole[1] - a[1], whole[0] - a[0]);
    const tick = 1.4 * scale;
    for (const [x, y] of t >= 1 ? [a, b] : [a]) {
      ctx.beginPath(); ctx.moveTo(x - Math.sin(angle) * tick, y + Math.cos(angle) * tick); ctx.lineTo(x + Math.sin(angle) * tick, y - Math.cos(angle) * tick); ctx.stroke();
    }
    ctx.restore();
    if (t < 1) return;
    const metres = distance(element.at, element.to);
    const said = element.text || `${lengthLabel(metres, context.imperial)} · ${Math.round(bearingTo(element.at, element.to))}°`;
    groundWords(ctx, said, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 2 * scale, element, context);
  }
}

// -- the page's own blocks -----------------------------------------------------------------

function drawShape(ctx, element, context) {
  const { scale, spec } = context;
  const box = boxPx(element, scale);
  const width = Math.max(1, 0.3 * scale * (element.width ?? 1));
  ctx.save();
  ctx.setLineDash(dashFor(element.line, width));
  ctx.strokeStyle = element.colour || spec.theme.ink; ctx.lineWidth = width;
  ctx.beginPath();
  if (element.shape === 'ellipse') ctx.ellipse(box.x + box.w / 2, box.y + box.h / 2, box.w / 2, box.h / 2, 0, 0, Math.PI * 2);
  else if (element.shape === 'line') { ctx.moveTo(box.x, box.y + box.h / 2); ctx.lineTo(box.x + box.w, box.y + box.h / 2); }
  else ctx.rect(box.x, box.y, box.w, box.h);
  if (element.fill && element.shape !== 'line') { ctx.fillStyle = element.fill; ctx.fill(); }
  if (element.border !== false) ctx.stroke();
  ctx.restore();
}

function drawKey(ctx, element, context) {
  const { scale, spec } = context;
  const box = boxPx(element, scale);
  const items = context.numbered ?? [];
  if (element.fill) { ctx.fillStyle = element.fill; ctx.fillRect(box.x, box.y, box.w, box.h); }
  if (element.border) { ctx.strokeStyle = spec.theme.ink; ctx.lineWidth = Math.max(1, 0.25 * scale); ctx.strokeRect(box.x, box.y, box.w, box.h); }
  const size = element.size ?? 8;
  const pad = 2 * scale;
  const line = size * MM_PER_PT * scale * 1.6;
  ctx.save(); ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
  let y = box.y + pad;
  if (element.text) {
    ctx.font = font(spec.theme, size * 1.15, 700, scale, element);
    ctx.fillStyle = element.colour || spec.theme.ink; ctx.textBaseline = 'top';
    ctx.fillText(element.text, box.x + pad, y); y += line * 1.1;
  }
  for (const item of items) {
    const radius = line * 0.36;
    ctx.fillStyle = item.fill || spec.theme.accent;
    ctx.beginPath(); ctx.arc(box.x + pad + radius, y + line / 2, radius, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.font = font(spec.theme, size * 0.85, 700, scale); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(item.number), box.x + pad + radius, y + line / 2 + 0.2 * scale);
    ctx.textAlign = 'left';
    ctx.fillStyle = element.colour || spec.theme.ink; ctx.font = font(spec.theme, size, 400, scale, element);
    const lines = wrap(ctx, item.text || '', box.w - 3 * pad - 2 * radius);
    lines.forEach((text, index) => ctx.fillText(text, box.x + 2 * pad + 2 * radius, y + line / 2 + index * line * 0.8));
    y += line * Math.max(1, lines.length * 0.8 + 0.2);
  }
  ctx.restore();
  return y + pad - box.y;
}

function drawTable(ctx, element, context) {
  const { scale, spec } = context;
  const box = boxPx(element, scale);
  const rows = context.tables?.[element.id] ?? [];
  if (element.fill) { ctx.fillStyle = element.fill; ctx.fillRect(box.x, box.y, box.w, box.h); }
  if (element.border) { ctx.strokeStyle = spec.theme.ink; ctx.lineWidth = Math.max(1, 0.25 * scale); ctx.strokeRect(box.x, box.y, box.w, box.h); }
  const size = element.size ?? 7;
  const pad = 1.6 * scale;
  const line = size * MM_PER_PT * scale * 1.5;
  ctx.save(); ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
  ctx.textBaseline = 'middle';
  let y = box.y + pad;
  ctx.fillStyle = element.colour || spec.theme.ink;
  ctx.font = font(spec.theme, size * 1.1, 700, scale, element);
  ctx.fillText(element.text || (element.source === 'sources' ? 'Sources' : 'Chronology'), box.x + pad, y + line / 2);
  y += line * 1.2;
  ctx.font = font(spec.theme, size, 400, scale, element);
  const first = Math.min(box.w * 0.32, ...rows.map(([lead]) => ctx.measureText(lead).width + 2 * pad));
  for (const [index, [lead, text]] of rows.entries()) {
    if (index % 2) { ctx.save(); ctx.globalAlpha = 0.06; ctx.fillStyle = spec.theme.ink; ctx.fillRect(box.x, y, box.w, line); ctx.restore(); }
    ctx.fillStyle = element.colour || spec.theme.ink;
    ctx.font = font(spec.theme, size, 600, scale, element);
    ctx.fillText(lead, box.x + pad, y + line / 2);
    ctx.font = font(spec.theme, size, 400, scale, element);
    let said = String(text ?? '');
    const room = box.w - first - 2 * pad;
    while (said.length > 1 && ctx.measureText(said).width > room) said = said.slice(0, -2);
    ctx.fillText(said === String(text ?? '') ? said : `${said}…`, box.x + first + pad, y + line / 2);
    y += line;
  }
  if (!rows.length && context.editing) { ctx.globalAlpha = 0.5; ctx.fillText('Nothing dated on this map yet', box.x + pad, y + line / 2); }
  ctx.restore();
  return y + pad - box.y;
}

function drawQr(ctx, element, context) {
  const { scale, spec } = context;
  const box = boxPx(element, scale);
  const matrix = qrMatrix(element.text || '');
  if (!matrix) {
    if (context.editing) haloText(ctx, 'Too long for a QR code', box.x + box.w / 2, box.y + box.h / 2, spec.theme.accent, context, 6);
    return;
  }
  const quiet = 2;
  const count = matrix.length + quiet * 2;
  const side = Math.min(box.w, box.h);
  const cell = side / count;
  const x0 = box.x + (box.w - side) / 2;
  const y0 = box.y + (box.h - side) / 2;
  ctx.fillStyle = element.fill || '#ffffff'; ctx.fillRect(x0, y0, side, side);
  ctx.fillStyle = element.colour || '#000000';
  matrix.forEach((row, r) => row.forEach((dark, c) => {
    if (dark) ctx.fillRect(x0 + (c + quiet) * cell, y0 + (r + quiet) * cell, cell + 0.4, cell + 0.4);
  }));
}

function drawTimeline(ctx, element, context) {
  const { scale, spec } = context;
  const box = boxPx(element, scale);
  const moments = context.moments ?? [];
  if (element.fill) { ctx.fillStyle = element.fill; ctx.fillRect(box.x, box.y, box.w, box.h); }
  if (!moments.length) {
    if (context.editing) haloText(ctx, 'No layer here is followed over time', box.x + box.w / 2, box.y + box.h / 2, spec.theme.ink, context, 6);
    return;
  }
  const pad = 2 * scale;
  const y = box.y + box.h * 0.45;
  const x0 = box.x + pad;
  const x1 = box.x + box.w - pad;
  const colour = element.colour || spec.theme.ink;
  const at = context.at ?? moments.at(-1);
  const index = Math.max(0, moments.indexOf(at) < 0 ? moments.length - 1 : moments.indexOf(at));
  const xOf = (i) => (moments.length < 2 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (moments.length - 1));
  ctx.save();
  ctx.strokeStyle = colour; ctx.lineWidth = Math.max(1, 0.35 * scale);
  ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
  ctx.lineWidth = Math.max(1, 0.5 * scale); ctx.strokeStyle = spec.theme.accent;
  ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(xOf(index), y); ctx.stroke();
  moments.forEach((_, i) => {
    ctx.fillStyle = i <= index ? spec.theme.accent : colour;
    ctx.beginPath(); ctx.arc(xOf(i), y, (i === index ? 1.3 : 0.6) * scale, 0, Math.PI * 2); ctx.fill();
  });
  ctx.font = font(spec.theme, element.size ?? 7, 400, scale, element);
  ctx.fillStyle = colour; ctx.textBaseline = 'top';
  const said = (moment) => context.dayLabel?.(moment) ?? moment;
  ctx.textAlign = 'left'; ctx.fillText(said(moments[0]), x0, y + 1.6 * scale);
  ctx.textAlign = 'right'; ctx.fillText(said(moments.at(-1)), x1, y + 1.6 * scale);
  ctx.font = font(spec.theme, (element.size ?? 7) * 1.2, 700, scale, element);
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillStyle = spec.theme.accent;
  const lx = Math.max(x0 + 8 * scale, Math.min(x1 - 8 * scale, xOf(index)));
  ctx.fillText(said(moments[index]), lx, y - 1.4 * scale);
  ctx.restore();
}

/**
 * The analyst's signature: the picture set in Settings, and beside it the words that sign
 * (`{handle}` and the day, unless rewritten), on whichever side the element is aligned to.
 */
function drawSigned(ctx, element, context) {
  const { scale } = context;
  const box = boxPx(element, scale);
  const picture = context.images?.get?.('@signature');
  let room = box;
  if (picture) {
    const width = Math.min(box.w * 0.55, (picture.width ?? picture.naturalWidth) * (box.h / (picture.height ?? picture.naturalHeight)));
    const right = element.align === 'right';
    ctx.drawImage(picture, right ? box.x + box.w - width : box.x, box.y, width, box.h);
    const gap = 1.5 * scale;
    room = right ? { ...box, w: box.w - width - gap } : { ...box, x: box.x + width + gap, w: box.w - width - gap };
  }
  const text = fillTokens(element.text ?? '{handle}', context.tokens);
  if (text.trim()) return writeLines(ctx, { ...element, valign: element.valign ?? 'middle' }, context, text, room, { clip: false });
  if (!picture && context.editing) haloText(ctx, 'Your signature, set in Settings', box.x + box.w / 2, box.y + box.h / 2, context.spec.theme.ink, context, 6);
  return false;
}

/** "Made with" and the Azimut mark and name, the lockup set tight beside the words. */
function drawBrand(ctx, element, context) {
  const { scale, spec } = context;
  const box = boxPx(element, scale);
  const ink = element.colour || spec.theme.ink;
  const prefix = element.text ?? 'Made with';
  ctx.font = font(spec.theme, element.size ?? 6, 400, scale, element);
  const lead = prefix ? ctx.measureText(`${prefix} `).width : 0;
  const height = Math.max(1, Math.min(box.h, (box.w - lead) / signatureWidth(1, { tight: true })));
  const total = lead + signatureWidth(height, { tight: true });
  const left = element.align === 'left' ? box.x : element.align === 'center' ? box.x + (box.w - total) / 2 : box.x + box.w - total;
  const middle = box.y + box.h / 2;
  if (prefix) { ctx.fillStyle = ink; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(prefix, left, middle); }
  drawSignature(ctx, left + total, middle, { height, ink, tight: true });
}

// -- the page ----------------------------------------------------------------------------

/** The paper under everything: a colour, a gradient, or a picture covering it. */
export function drawBackground(ctx, spec, context) {
  const { width, height } = pageSize(spec.page);
  const w = width * context.scale;
  const h = height * context.scale;
  if (spec.page?.transparent && !context.editing) return;
  const background = spec.page?.background ?? {};
  ctx.fillStyle = spec.theme.paper;
  if (background.kind === 'gradient') {
    // the angle as CSS reads it: 0 runs upward, 90 to the right, so the screen and the file agree
    const angle = ((background.angle ?? 90) * Math.PI) / 180;
    const dx = (Math.sin(angle) * w) / 2;
    const dy = (-Math.cos(angle) * h) / 2;
    const gradient = ctx.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy);
    gradient.addColorStop(0, spec.theme.paper);
    gradient.addColorStop(1, background.colour || spec.theme.paper);
    ctx.fillStyle = gradient;
  }
  ctx.fillRect(0, 0, w, h);
  const picture = background.kind === 'image' ? context.images?.get?.('data:background') : null;
  if (picture) {
    const fit = Math.max(w / picture.width, h / picture.height);
    ctx.drawImage(picture, (w - picture.width * fit) / 2, (h - picture.height * fit) / 2, picture.width * fit, picture.height * fit);
  }
}

/** The page's own frame, and the editor's guides: the margins and the middle. */
function drawPageFrame(ctx, spec, context) {
  const { width, height } = pageSize(spec.page);
  const { scale } = context;
  if (spec.page?.frame) {
    ctx.save(); ctx.strokeStyle = spec.theme.ink; ctx.lineWidth = Math.max(1, 0.5 * scale);
    ctx.strokeRect(2.5 * scale, 2.5 * scale, (width - 5) * scale, (height - 5) * scale); ctx.restore();
  }
  if (spec.page?.guides && context.editing) {
    const margin = Math.max(6, Math.round(Math.min(width, height) * 0.045)) * scale;
    ctx.save(); ctx.strokeStyle = 'rgba(236,72,153,0.8)'; ctx.lineWidth = 1; ctx.setLineDash([6, 4]);
    ctx.strokeRect(margin, margin, width * scale - 2 * margin, height * scale - 2 * margin);
    ctx.beginPath(); ctx.moveTo((width * scale) / 2, 0); ctx.lineTo((width * scale) / 2, height * scale);
    ctx.moveTo(0, (height * scale) / 2); ctx.lineTo(width * scale, (height * scale) / 2); ctx.stroke();
    // a feed crops a tall page to 4:5 and a wide one to 1.91:1; the middle band is what survives
    const crop = width > height ? [width, width / 1.91] : [width, width * 1.25];
    if (crop[1] < height) {
      ctx.strokeStyle = 'rgba(59,130,246,0.8)';
      ctx.strokeRect(0, ((height - crop[1]) / 2) * scale, width * scale, crop[1] * scale);
    }
    ctx.restore();
  }
}

/**
 * Draw a plate's page.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} spec the plate
 * @param {object} context `scale` (canvas pixels a millimetre), `views` (`{ id: { view, frame } }`
 *   of each map), `legend` (`{ legendId: rows }`), `credits` (`{ mapId: text }`), `images`
 *   (a Map of the pictures by `pictureKey`), `markerImage(symbol, colour, marks)`, `tokens`
 *   (`fillTokens`' words), `at` (the plate's day), `place` (the step it is on, `placeOf`), `numbered`, `numberOf(id)`, `tables`,
 *   `moments`, `dayLabel`, `refShown(element)`, and for an export `paper` (fill the page)
 *   and `maps` (`{ id: canvas }`, each map's picture at this scale). `editing` draws
 *   what only the editor shows; `ghosts` draws other days' annotations faintly.
 *   `reveal` (`{ ids, t, mode }`) draws the elements of `ids` as far as a transition
 *   has brought them in, `t` from 0 to 1: faded in, or drawn along (`mode` "draw").
 * @returns {Map<string, number|null>} the elements whose words run past their box, each with the
 *   height in millimetres it needs when its drawer can say (a legend, a table, the numbered list)
 */
export function drawPage(ctx, spec, context) {
  const full = { ...context, spec };
  const { scale } = context;
  const overflow = new Map();
  if (context.paper) drawBackground(ctx, spec, context);
  for (const element of spec.elements) {
    if (context.maps && MAP_KINDS.includes(element.kind) && context.maps[element.id] && !element.hidden && shownOn(element, context.at ?? null, context.place)) {
      const box = boxPx(element, scale);
      ctx.save();
      ctx.globalAlpha = element.opacity ?? 1;
      ctx.drawImage(context.maps[element.id], box.x, box.y, box.w, box.h);
      ctx.restore();
    }
  }
  const reveal = context.reveal ?? null;
  for (const element of spec.elements) {
    if (element.hidden) continue;
    const today = shownOn(element, context.at ?? null, context.place) && (context.refShown?.(element) ?? true);
    if (!today && !(context.editing && context.ghosts)) continue;
    // what a transition brings in: faded in, or drawn as far as it has gone
    const coming = reveal?.ids?.has(element.id) ? Math.max(0, Math.min(1, reveal.t)) : 1;
    const drawn = reveal?.mode === 'draw' && ['arrow', 'line', 'measure'].includes(element.kind);
    if (coming <= 0) continue;
    ctx.save();
    ctx.globalAlpha = (element.opacity ?? 1) * (today ? 1 : 0.22) * (drawn ? 1 : coming);
    if (element.rotate && !['map', 'inset', 'arrow', 'zone', 'ring', 'cone', 'measure', 'line', 'video', 'symbol'].includes(element.kind)) {
      const box = boxPx(element, scale);
      ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
      ctx.rotate((element.rotate * Math.PI) / 180);
      ctx.translate(-(box.x + box.w / 2), -(box.y + box.h / 2));
    }
    let ran = false;
    switch (element.kind) {
      case 'map':
      case 'inset': drawFrame(ctx, element, full); break;
      case 'text': ran = writeBox(ctx, element, full, fillTokens(element.text, context.tokens)); break;
      case 'credits': ran = writeCredits(ctx, element, full, context.credits?.[element.of] || 'Map data credits'); break;
      case 'legend': ran = drawLegend(ctx, element, full); break;
      case 'scale': drawScale(ctx, element, full); break;
      case 'north': drawNorth(ctx, element, full); break;
      case 'image': drawImage(ctx, element, full); break;
      case 'video': drawVideo(ctx, element, full); break;
      case 'label': ran = drawLabel(ctx, element, full); break;
      case 'symbol': drawSymbol(ctx, element, full); break;
      case 'arrow': drawArrow(ctx, element, full, drawn ? coming : 1); break;
      case 'line': drawLine(ctx, element, full, drawn ? coming : 1); break;
      case 'zone':
      case 'ring':
      case 'cone':
      case 'measure': drawGround(ctx, element, full, drawn ? coming : 1); break;
      case 'shape': drawShape(ctx, element, full); break;
      case 'key': ran = drawKey(ctx, element, full); break;
      case 'table': ran = drawTable(ctx, element, full); break;
      case 'qr': drawQr(ctx, element, full); break;
      case 'timeline': drawTimeline(ctx, element, full); break;
      case 'signature': ran = drawSigned(ctx, element, full); break;
      case 'brand': drawBrand(ctx, element, full); break;
      default: break;
    }
    // a drawer that lists rows says the height it needs; the others say whether they ran past
    if (typeof ran === 'number') { if (ran > boxPx(element, scale).h + 0.5) overflow.set(element.id, Math.ceil((ran / scale) * 10) / 10); }
    else if (ran) overflow.set(element.id, null);
    ctx.restore();
  }
  drawPageFrame(ctx, spec, full);
  return overflow;
}
